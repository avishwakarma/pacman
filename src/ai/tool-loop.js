// Stage 3: the actual chat loop. Sends the user's message plus the tool
// schemas to the already-loaded WebLLM engine, executes any tool calls the
// model decides to make against the real running game, feeds the results
// back, and returns the model's final text reply — or null if a tool ran
// but the model never produced one, since the tool card it rendered
// already says what happened and a text bubble on top of that would be
// nothing more than a placeholder (see runToolLoopUnlocked below).
//
// This is a plain OpenAI-style tool-calling loop — WebLLM's
// engine.chat.completions.create supports `tools` / `tool_calls` directly
// (see node_modules/@mlc-ai/web-llm's chat_completion.d.ts). It doesn't
// touch navigator.modelContext/document.modelContext at all — that's
// registered separately in mcp/register-tools.js. Keeping them independent
// means the chat panel keeps working even on a Chrome build where that
// still-unstable browser API isn't available.
//
// No system message here, on purpose: WebLLM hard-codes its own
// Hermes-2-Pro/Hermes-3 function-calling system prompt (the one listing
// the tool schemas, per Hermes's documented prompt format) and throws
// CustomSystemPromptError if `request.messages` contains a role:"system"
// entry at all when `tools` is set — checked on every single call, not
// just the first. So instead, the one-time behavior guidance below rides
// along inside the very first real message as plain user-role content.
//
// Related trap: `chatCompletion(request)` never clones `request.messages`
// before that check — when it injects its own system prompt, it
// `unshift`s it directly onto whatever array was passed in. Passing our
// persistent `messages` history straight through would get it permanently
// mutated after the very first call (a system message would end up baked
// into our own history), which would then trip the exact same check on
// the *next* call. Every call below passes a fresh `[...messages]` copy
// instead, so WebLLM's internal mutation lands on a throwaway array and
// our real history stays clean.
//
// One more WebLLM quirk this accounts for: an assistant message that made
// tool calls has `content: null` (valid per the OpenAI shape — content is
// only required when there are no tool_calls). That's fine as the *last*
// message in a request, but once it's no longer last (i.e. once a later
// call includes it further back in history), WebLLM requires every
// assistant message's content to be a string and throws otherwise. So
// every assistant message gets its content normalized to '' right when
// it's received, before it can ever end up buried in later history.
//
// Three more things this file owns and needs to, because they're all real
// failure modes hit live, not hypothetical:
//   - History is trimmed to whole turns once it gets long. Hermes-2-Pro-
//     Llama-3-8B only has a 4096-token context window (see its `overrides`
//     in node_modules' prebuilt config), and this conversation grows
//     unbounded — a long back-and-forth over the course of a demo will
//     eventually blow past that. Once that happens the model's output
//     visibly degrades (garbled, hallucinated tool names) long before
//     anything throws. Trimming always cuts at a 'user' message boundary,
//     never mid-turn, so a tool_calls message and its tool results can't
//     get split apart.
//   - Calls are serialized: if a human submits another message before the
//     previous one has finished resolving, an overlapping call against
//     the same shared `messages` array would interleave pushes and
//     corrupt the conversation. Every call now waits for whatever's
//     already in flight to finish first.
//   - A message that isn't clearly asking for one of the five actions
//     never reaches the model with `tools` attached at all — see
//     `mentionsAction` below. This one isn't a WebLLM quirk, it's this
//     small quantized model's own reliability ceiling: two separate
//     rewrites of GUIDANCE_PREAMBLE (telling it plainly not to call a
//     tool for a greeting) still weren't enough — hit live, a bare
//     "hi there" triggered a spawnGhost/freezeGhosts/dropPowerPellet/
//     getGameState spree that ran until it hit MAX_TOOL_ROUNDS, visibly
//     mutating the game for a message that asked for nothing. Prompt
//     wording alone couldn't be trusted to prevent that reliably, so the
//     decision moved out of the model and into plain, deterministic code.

import { TOOL_SCHEMAS } from '../mcp/register-tools.js';

const GUIDANCE_PREAMBLE =
  '(Playing a live Pacman game. Stay still by default — only call a ' +
  'tool when the message clearly and specifically asks you to change ' +
  'the game right now. A greeting, small talk, or a general question ' +
  "is not that, even if it mentions the game — for those, call nothing " +
  'at all, and just reply in one short sentence that you can spawn or ' +
  'freeze ghosts, drop a power pellet, wipe the board once enough ' +
  'ghosts are out, or report the score. You get exactly one tool call ' +
  'per message, never more, so pick the single one that actually ' +
  "answers the request — for more than one ghost, spawnGhost takes a " +
  "count, don't call it repeatedly, and don't spend your one call " +
  'checking the score or ghost count unless that IS the request. Keep ' +
  'every reply short — a sentence or two, arcade-announcer style — and ' +
  'never leave one blank, even after calling a tool.)\n\n';

// Deliberately loose and generous — false positives (offering tools for a
// message that turns out not to need one) just fall back to the model's
// own judgment, which is the status quo. False negatives (a real request
// worded around every one of these) are the actual cost, so this errs
// toward matching too much rather than too little. Keep in sync by hand
// with what the five tools in mcp/register-tools.js actually cover.
const ACTION_KEYWORDS = [
  'ghost', 'ghosts', 'spawn', 'freeze', 'frozen', 'pellet', 'pellets',
  'power', 'score', 'state', 'status', 'lives', 'life', 'wipe', 'clear',
  'overload', 'destroy', 'kill', 'board', 'maze', 'game',
];

// The reply for anything that doesn't clear the check above — written by
// hand once, not generated per turn, so it's exactly as accurate as the
// five tools actually are and never drifts or hallucinates a sixth one.
const CAPABILITIES_REPLY =
  'I can spawn one or more ghosts, freeze the ghosts for a few seconds, drop a power ' +
  'pellet, wipe the board once 5 or more ghosts are out, or tell you the ' +
  'current score, ghost count, and pellets left. What would you like?';

// Case-insensitive substring match against ACTION_KEYWORDS — deliberately
// this simple. It only has to catch "does this message plausibly want one
// of five specific things," not understand English; a real request about
// the game almost always contains one of these words somewhere, and a
// greeting or general question almost never does.
function mentionsAction(text) {
  const lower = text.toLowerCase();
  return ACTION_KEYWORDS.some((word) => lower.includes(word));
}

// Exactly two model calls, no more: one that may act, one that always
// replies. This used to be 4 "rounds," which in practice meant "however
// many rounds of tool calls the model feels like making" — hit live
// twice, most recently "spawn more ghosts" turning into four spawnGhost
// calls plus two freezeGhosts and a dropPowerPellet nobody asked for.
// This stage is meant to be reactive (see README's Stage 3 section: "the
// model acts once per message you send, then waits"), so the loop below
// now enforces that directly — at most one tool call actually executes
// per user message, no matter how many the model asks for in either
// round, full stop. Every tool takes whatever arguments it needs to
// satisfy a request in that one call (spawnGhost's `count`,
// freezeGhosts's `seconds`) specifically so this doesn't cost anything —
// "spawn two ghosts" is one call with count: 2, not two calls.
const MAX_TOOL_ROUNDS = 2;

// Keeps the model's context comfortably under its 4096-token window across
// a long autonomous session — see the header comment.
const MAX_HISTORY_MESSAGES = 20;

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
const messages = [];

// Only ever drops whole turns: finds the first 'user' message at or after
// the trim point and cuts there, so a tool_calls message never ends up
// separated from the tool results answering it.
function trimHistory() {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;
  let start = messages.length - MAX_HISTORY_MESSAGES;
  while (start < messages.length && messages[start].role !== 'user') start++;
  messages.splice(0, start);
}

async function runToolLoopUnlocked(engine, tools, userText, onToolCall) {
  // Deterministic gate, checked before this turn ever touches the model:
  // see the header comment for why prompt wording alone wasn't enough.
  // Doesn't add either side to `messages` — small talk isn't worth
  // spending context on, and skipping it means the *next* real request
  // still lands as message zero and gets GUIDANCE_PREAMBLE prepended.
  if (!mentionsAction(userText)) {
    return CAPABILITIES_REPLY;
  }

  const content = messages.length === 0 ? GUIDANCE_PREAMBLE + userText : userText;
  messages.push({ role: 'user', content });

  // Tracks whether this turn ran a tool for real, so a reply with nothing
  // useful to say can be told apart from a genuinely silent one — a real
  // action already rendered its own card in the chat log (see onToolCall
  // below), there's nothing a text bubble on top of that would add, so
  // this file returns null rather than a placeholder string in that case.
  // main.js only falls back to showing "(no reply)" when nothing happened
  // at all, no tool card and no text — see its own comment for why.
  let calledTool = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await engine.chat.completions.create({
        messages: [...messages],
        tools: toOpenAITools(),
      });
      const message = response.choices[0].message;
      if (message.content == null) message.content = '';
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        if (!message.content && calledTool) return null;
        return message.content;
      }

      for (const call of message.tool_calls) {
        if (calledTool) {
          // This turn's one action is already spent — every tool_call_id
          // still needs *some* 'tool' message answering it, or the next
          // request's history is malformed, but nothing past the first
          // one actually touches the game.
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ skipped: true, reason: 'already took one action this turn — wrap up your reply now' }),
          });
          continue;
        }

        calledTool = true;
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
    }

    // Reachable only if every round (including this last one) came back
    // as more tool_calls, never plain text — which means the first one,
    // back in round zero, already ran for real (calledTool must be true
    // to get here at all, see the loop above). Same situation as the
    // null case just above, reached a different way: one real action
    // already happened and rendered its own card, the model just never
    // produced a proper wrap-up after that. Same non-answer.
    return null;
  } finally {
    trimHistory();
  }
}

// Serializes every call through this queue — see the header comment for
// why concurrent calls against the shared `messages` history are unsafe.
let queue = Promise.resolve();

// engine: the object loadModel() resolved with. tools: the handlers object
// from mcp/tools.js's createTools(state). onToolCall(name, result): called
// once per tool the model invokes, so the caller can log it to the chat
// panel as it happens (before the model's final reply comes back).
export function runToolLoop(engine, tools, userText, onToolCall) {
  const run = () => runToolLoopUnlocked(engine, tools, userText, onToolCall);
  const result = queue.then(run, run);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
