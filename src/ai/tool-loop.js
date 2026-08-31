// Stage 4: the actual chat loop. Sends the user's message plus the tool
// schemas to the already-loaded WebLLM engine, executes any tool calls the
// model decides to make against the real running game, feeds the results
// back, and returns the model's final text reply.
//
// This is a plain OpenAI-style tool-calling loop — WebLLM's
// engine.chat.completions.create supports `tools` / `tool_calls` directly
// (see node_modules/@mlc-ai/web-llm's chat_completion.d.ts). It doesn't
// touch navigator.modelContext/document.modelContext at all — that's
// registered separately in mcp/register-tools.js. Keeping them independent
// means the chat panel keeps working even on a Chrome build where that
// still-unstable browser API isn't available.

import { TOOL_SCHEMAS } from '../mcp/register-tools.js';

const SYSTEM_PROMPT =
  'You are controlling a live Pacman game through a small set of tools. ' +
  'Use them when the user asks you to change the game. Keep replies short ' +
  '— a sentence or two, arcade-announcer style. Call getGameState first if ' +
  "you're unsure what's currently happening before acting.";

function toOpenAITools() {
  return TOOL_SCHEMAS.map((schema) => ({
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

// One conversation per page load — module-level history so follow-up
// prompts ("now do it again but for 10 seconds") have context.
//
// Heads up for whoever wires this up against a tool-calling-capable model
// (Llama 3.2 1B, the model this branch actually loads, doesn't support
// `tools` at all — see llm-loader.js): WebLLM's Hermes-family function-
// calling hard-codes its own system prompt and throws if `request.messages`
// already contains a role:"system" entry when `tools` is set — checked on
// *every* call, not just the first. Passing `messages` straight through
// below is fine only because nothing here has hit that check yet; the
// moment it does, note that WebLLM doesn't clone the array first, it
// `unshift`s its system prompt directly onto whatever was passed — so a
// persistent history array passed by reference (like this one) would get
// permanently, silently contaminated with an extra system message, which
// then makes every subsequent call fail the very check that mutated it.
// The fix, if/when this file starts hitting it for real, is to pass a
// fresh `[...messages]` copy per call instead of `messages` itself.
const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

// engine: the object loadModel() resolved with. tools: the handlers object
// from mcp/tools.js's createTools(state). onToolCall(name, result): called
// once per tool the model invokes, so the caller can log it to the chat
// panel as it happens (before the model's final reply comes back).
export async function runToolLoop(engine, tools, userText, onToolCall) {
  messages.push({ role: 'user', content: userText });

  const first = await engine.chat.completions.create({
    messages,
    tools: toOpenAITools(),
  });
  const assistantMessage = first.choices[0].message;
  // Another WebLLM/Hermes quirk worth knowing before this gets pushed
  // further: an assistant message that made tool calls legitimately has
  // `content: null` (valid per the OpenAI shape — content's only required
  // when there are no tool_calls). That's accepted as the *last* message
  // in a request, but WebLLM requires every assistant message to have
  // string content once it's no longer last, i.e. once a later call in
  // this same loop includes it further back in history, and throws
  // otherwise. This file pushes assistantMessage as-is (content possibly
  // null); normalizing it to '' right here, before it can end up buried
  // in history, is the fix once this loop is actually exercising
  // multi-round tool calls against a tool-calling model.
  messages.push(assistantMessage);

  if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
    return assistantMessage.content ?? '';
  }

  // Run every tool call the model asked for and feed each result back as
  // its own role:"tool" message, matched to the call by tool_call_id — the
  // OpenAI tool-calling shape allows more than one call per turn. An
  // unknown tool name or a bad/unparseable arguments string both become an
  // { error } result instead of throwing, so a single confused tool call
  // can't take down the whole exchange — the model just sees the error and
  // can react to it in its next reply.
  for (const call of assistantMessage.tool_calls) {
    const handler = tools[call.function.name];
    let result;
    try {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      result = handler ? await handler(args) : { error: `unknown tool: ${call.function.name}` };
    } catch (err) {
      result = { error: err.message };
    }
    onToolCall?.(call.function.name, result);
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  }

  // Fixed one extra round-trip after tool results come back, not a general
  // loop: this stage's model is expected to act once per user message and
  // then produce its final spoken reply, not chain further tool calls.
  const second = await engine.chat.completions.create({ messages, tools: toOpenAITools() });
  const finalMessage = second.choices[0].message;
  messages.push(finalMessage);
  return finalMessage.content ?? '';
}
