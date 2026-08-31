// Stage 4 (WebMCP): the tool handlers the model can call once registered
// via register-tools.js. Each one mutates `state` (gameState.js) directly,
// so the effect shows up on the very next rendered frame — no extra
// plumbing needed between "the model decided to do this" and "the game
// visibly did it." createTools(state) closes over one game's state and
// returns a plain object of { toolName: handler(args) } — register-tools.js
// pairs each handler up with its JSON Schema and description.

import { spawnGhost } from '../game/ghosts.js';
import { bfsDistances } from '../game/maze.js';

// register-tools.js's ghostOverload description hard-codes this number in
// English for the model to read — keep the two in sync by hand if this
// ever changes.
const GHOST_OVERLOAD_THRESHOLD = 5;
const GHOST_OVERLOAD_BONUS = 1000;

// Nearest reachable cell to the player, by real shortest path, that
// doesn't already have a power pellet on it — reuses maze.js's
// bfsDistances the same way ghosts.js and agent.js do, rather than a plain
// grid scan, so it can never land somewhere unreachable.
function findPowerPelletSpot(state) {
  const distances = [...bfsDistances(state.player.col, state.player.row).entries()];
  distances.sort((a, b) => a[1] - b[1]);
  for (const [key] of distances) {
    if (!state.powerPellets.has(key)) return key;
  }
  return null;
}

export function createTools(state) {
  return {
    getGameState() {
      return {
        score: state.score,
        ghostCount: state.ghosts.length,
        pelletsRemaining: state.pellets.size,
        powerPelletsRemaining: state.powerPellets.size,
        gameOver: state.gameOver,
      };
    },

    // No arguments taken or needed: game/ghosts.js's spawnGhost already
    // picks a "valid" position itself — spread out around the ghost pen
    // and snapped to the nearest open (non-wall) grid cell — so this
    // handler is pure passthrough plus reporting the result back.
    spawnGhost() {
      const ghost = spawnGhost(state);
      return { spawned: true, ghostId: ghost.id, ghostCount: state.ghosts.length };
    },

    // `seconds` comes straight from model-generated tool-call arguments,
    // so it's untyped in practice even though the schema says "number" —
    // Number(seconds) || 0 guards against it arriving as a string, NaN, or
    // missing entirely, and Math.max(0, ...) rules out a negative duration
    // un-freezing something that was never frozen.
    freezeGhosts({ seconds } = {}) {
      const duration = Math.max(0, Number(seconds) || 0);
      state.ghostsFreezeTimer = duration;
      return { frozenFor: duration };
    },

    // Displaces a regular pellet at that cell (delete before add order
    // doesn't matter here, they're different Sets) rather than stacking
    // both on one cell — there's only one pellet-looking thing per cell in
    // this game. `dropped: false` (in the practically-unreachable case
    // every reachable cell already has a power pellet) is a normal result,
    // not a thrown error, so the model can relay it in a reply instead of
    // treating it as a failure.
    dropPowerPellet() {
      const key = findPowerPelletSpot(state);
      if (!key) return { dropped: false, reason: 'no open cell available' };
      state.powerPellets.add(key);
      state.pellets.delete(key);
      const [col, row] = key.split(',').map(Number);
      return { dropped: true, col, row };
    },

    // The cheat-code payoff: once enough ghosts have piled up, wipe them
    // all at once and start fresh, with a score bonus for the drama. Below
    // the threshold this returns a structured `reason` string instead of
    // an error or a no-op — it's meant to be read back to the player
    // verbatim by the model (e.g. "you need more ghosts first"), which is
    // why it's phrased as a sentence rather than an error code.
    ghostOverload() {
      if (state.ghosts.length < GHOST_OVERLOAD_THRESHOLD) {
        return {
          triggered: false,
          reason: `need at least ${GHOST_OVERLOAD_THRESHOLD} ghosts on the board first (currently ${state.ghosts.length}) — spawn more`,
        };
      }
      const destroyed = state.ghosts.length;
      // Truncating the array in place (rather than reassigning state.ghosts)
      // keeps this working if anything else ever holds a reference to the
      // same array. Two fresh ghosts, not zero: the board goes back to a
      // normal playable state instead of ghost-free, which would trivialize
      // the rest of the round.
      state.ghosts.length = 0;
      state.score += GHOST_OVERLOAD_BONUS;
      spawnGhost(state);
      spawnGhost(state);
      return { triggered: true, destroyed, bonus: GHOST_OVERLOAD_BONUS };
    },
  };
}
