// Ghost touches player: three different outcomes depending on the ghost's
// current mode, matching the original arcade —
//   'chase'      — the ghost is dangerous: lose a life. If any are left,
//                  the player and every ghost reset to their spawn
//                  positions and play continues; at 0 lives it's game over.
//   'frightened' — the ghost is vulnerable: it gets eaten (becomes 'eaten'
//                  eyes heading home) and the player scores a bonus that
//                  doubles with each ghost eaten during the same power
//                  pellet's window (200, 400, 800, 1600, ...).
//   'eaten'      — already just eyes, harmless; passes through the player.

import { GRID_STEP } from './maze.js';
import { resetPositions } from './gameState.js';

// Half a grid cell — a proximity check, not the exact col/row match pellets
// use. Player and ghosts both move continuously between cell centers
// (movement.js), so two entities can pass right by each other mid-corridor
// without ever landing on the same (col, row) in the same frame; a distance
// threshold catches that near-miss the way an exact-cell check wouldn't.
const COLLISION_DISTANCE = GRID_STEP * 0.5;
const GHOST_EAT_BASE_SCORE = 200;

export function checkGhostCollision(state) {
  for (const ghost of state.ghosts) {
    if (ghost.state === 'eaten') continue;

    const distance = Math.hypot(ghost.x - state.player.x, ghost.y - state.player.y);
    if (distance >= COLLISION_DISTANCE) continue;

    if (ghost.state === 'frightened') {
      ghost.state = 'eaten';
      state.score += GHOST_EAT_BASE_SCORE * 2 ** state.ghostEatStreak;
      state.ghostEatStreak++;
      continue;
    }

    state.lives -= 1;
    if (state.lives <= 0) {
      state.gameOver = true;
    } else {
      resetPositions(state);
    }
    // Stop after the first life-costing hit this frame instead of
    // continuing to check the rest of `state.ghosts`: at 0 lives there's no
    // resetPositions to pull everyone apart again, so a second still-
    // overlapping chase ghost would otherwise cost a second life in the
    // same frame the game just ended.
    return true;
  }
  return false;
}
