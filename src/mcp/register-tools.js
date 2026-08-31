// Stage 4 (WebMCP): the JSON Schema + description for every tool from
// tools.js, plus registering them against the browser's model-context API
// so any WebMCP-aware agent (not just our own chat panel) can discover and
// call them.
//
// This API is mid-migration and still genuinely unstable: it started on
// `navigator.modelContext`, but that's deprecated as of Chrome 150 in favor
// of `document.modelContext`, and the exact registration method shape has
// already changed more than once during the origin trial. See SETUP.md for
// the Chrome version/flag this needs — check it's still accurate before
// the workshop, this is the single most likely thing to have moved.
//
// TOOL_SCHEMAS is deliberately kept independent of that instability: it's
// a plain OpenAI-style function-schema array, the same shape WebLLM's own
// tool-calling expects (see ai/tool-loop.js). That means the chat panel's
// "the local model can call these tools" path works whether or not the
// browser-level WebMCP registration below succeeds — registerTools() is a
// best-effort bonus (so an external WebMCP-aware agent could also drive
// this game), not something the demo's core chat flow depends on.

// These `description` strings are the *only* thing the model ever sees for
// each tool (it never reads tools.js) — they're doing the job a docstring
// normally does for a human caller, so precision here (thresholds, what
// "valid" means, what happens on failure) directly determines whether the
// model calls a tool correctly and can explain the outcome sensibly.
export const TOOL_SCHEMAS = [
  {
    name: 'getGameState',
    description: 'Read the current score, ghost count, and pellets remaining. Call this before acting if you need to check the board first.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    // No parameters on purpose: the model never chooses *where* — the
    // handler (game/ghosts.js's spawnGhost) always picks the position
    // itself, spreading spawns out in a ring around the ghost pen and
    // snapping to the nearest actually-open grid cell (maze.js's
    // findOpenCellNear), so "valid" here just means "not inside a wall or
    // the pen, and not stacked on another ghost's exact spawn cell."
    name: 'spawnGhost',
    description: 'Add one more ghost to the maze at a valid spawn point.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    // `seconds` is untrusted model output — a free-form number, no min/max
    // enforced by the schema itself. The handler (tools.js) is what clamps
    // it to a sane non-negative value; the schema only documents intent.
    name: 'freezeGhosts',
    description: 'Stop every ghost from moving for a number of seconds.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'How many seconds to freeze ghost movement for.' },
      },
      required: ['seconds'],
      additionalProperties: false,
    },
  },
  {
    // No position parameter, same reasoning as spawnGhost: the handler
    // picks the nearest reachable open cell to the player itself (see
    // findPowerPelletSpot in tools.js) rather than trusting the model with
    // maze coordinates it has no reliable way to reason about.
    name: 'dropPowerPellet',
    description: 'Place a power pellet near the player. Eating it makes ghosts vulnerable for a short time.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    // The "5 or more ghosts" threshold named here must stay in sync with
    // GHOST_OVERLOAD_THRESHOLD in tools.js by hand — the model only ever
    // reads this description, never the constant, so if one changes
    // without the other the model will confidently state the wrong rule.
    name: 'ghostOverload',
    description: 'Cheat code: once 5 or more ghosts are on the board, destroys them all at once and awards a score bonus. Below that threshold it explains the condition instead of doing anything.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// tools: the object createTools(state) returned — { toolName: handler }.
// Registers each one against document.modelContext ?? navigator.modelContext
// if either exists; silently (but visibly, via the return value) no-ops if
// neither is available, rather than throwing and breaking the rest of the
// chat feature.
export function registerTools(tools) {
  const modelContext = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return { registered: false, reason: 'navigator.modelContext / document.modelContext is not available in this browser' };
  }

  let registeredCount = 0;
  for (const schema of TOOL_SCHEMAS) {
    const handler = tools[schema.name];
    if (!handler) continue; // schema/handler sets should always match, but don't crash the loop if they briefly don't
    try {
      // WebMCP's field names differ slightly from the OpenAI shape
      // (inputSchema/execute vs. parameters/handler) even though the JSON
      // Schema content is identical — this is the one place that mapping
      // happens. `args ?? {}` covers a no-parameter tool being invoked
      // with `undefined` rather than `{}`.
      modelContext.registerTool({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.parameters,
        execute: async (args) => handler(args ?? {}),
      });
      registeredCount++;
    } catch (err) {
      // One tool failing to register (e.g. a future WebMCP API shape
      // change) shouldn't stop the rest from registering.
      console.warn(`registerTools: failed to register "${schema.name}"`, err);
    }
  }

  return { registered: registeredCount > 0, count: registeredCount };
}
