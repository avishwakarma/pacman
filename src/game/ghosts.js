// 1-2 ghosts that chase the player: at each grid cell, step toward
// whichever open neighbor cell is closest to the player by actual
// shortest path through the maze (maze.js's bfsDistances), not
// straight-line distance. Straight-line distance was tried first and gets
// ghosts permanently stuck — a corridor whose only branch leads away from
// the player still "looks" like progress step-by-step if the corridor
// happens to run roughly toward the player, so a ghost can end up
// oscillating forever between two dead ends never finding the real way
// around. Real shortest-path distance can't be fooled by corridor shape,
// so a ghost is only ever one graph-step away from making genuine
// progress. Movement itself reuses movement.js's shared grid-locked
// engine; a ghost's only job is the "which direction next?" decision:
// gather every currently-open direction, exclude a straight reversal when
// another option exists (so a ghost can't flip back on itself
// mid-corridor — it has to reach an actual intersection to change its
// mind, same as the original arcade ghosts), and pick whichever remaining
// option's cell has the smallest BFS distance to the player. Stage 2's
// spawnGhost/freezeGhosts/ghostOverload tools will operate on this same
// `ghosts` array via spawnGhost(state).

import { DIRECTIONS, REVERSE, isDirectionOpen, advanceEntity } from './movement.js';
import { GRID_COLS, GRID_ROWS, findOpenCellNear, bfsDistances } from './maze.js';

const GHOST_SPEED = 160; // maze units/second — slightly slower than the player
const FRIGHTENED_SPEED = 100; // slower still, so the player can actually catch one
const EATEN_SPEED = 240; // eyes-only, zipping home — faster than normal, matches the arcade original
const GHOST_COLORS = ['#ff4d4d', '#4dd9ff', '#ff8fd8', '#ff9f4d'];

// How long a ghost stays frightened after a power pellet, and how much of
// that window (at the end) it spends flashing as a "time's almost up"
// warning — same idea as the original arcade's blue-then-white flicker.
export const FRIGHTENED_DURATION = 8;
export const FRIGHTENED_WARNING_TIME = 2.5;

let nextGhostId = 1;

export function spawnGhost(state) {
  // Spread spawn points out a little around the ghost pen instead of
  // stacking every ghost on the same cell. This spawn cell also doubles as
  // the ghost's "home" — where it heads back to (as eyes) after being
  // eaten. The maze's actual ghost pen (maze.js's GHOST_PEN_POLYGON) is a
  // solid, doorless wall block in this design, so ghosts can never walk
  // into it; home is the nearest real open cell instead.
  const index = state.ghosts.length;
  const ring = Math.floor(index / 2) + 1;
  const side = index % 2 === 0 ? -1 : 1;
  const targetCol = Math.round(GRID_COLS / 2) + side * ring * 2;
  const targetRow = Math.round(GRID_ROWS / 2);
  const { col, row, x, y } = findOpenCellNear(targetCol, targetRow);

  const ghost = {
    id: `ghost-${nextGhostId++}`,
    color: GHOST_COLORS[index % GHOST_COLORS.length],
    x,
    y,
    col,
    row,
    direction: null,
    // 'chase' (hunting the player) | 'frightened' (fleeing, eatable) |
    // 'eaten' (eyes only, heading home to become 'chase' again).
    state: 'chase',
    homeCol: col,
    homeRow: row,
  };
  state.ghosts.push(ghost);
  return ghost;
}

// Shared by chase (minimize) and flee (maximize): gather the open
// directions from (col, row), excluding a straight reversal unless it's
// the only option, then let `pickBest` choose among what's left.
function chooseAmongOpenDirections(col, row, currentDirection, pickBest) {
  const open = Object.keys(DIRECTIONS).filter((direction) => isDirectionOpen(col, row, direction));
  if (open.length === 0) return null; // shouldn't happen in an open maze, but guard anyway

  const reverse = currentDirection ? REVERSE[currentDirection] : null;
  const nonReverse = open.filter((direction) => direction !== reverse);
  const options = nonReverse.length > 0 ? nonReverse : open; // dead end: reversing is the only option
  return pickBest(options, col, row);
}

// Chase (and "eaten heading home"): step toward whichever open neighbor is
// closest, by actual shortest path, to the target cell `distances` was
// computed from.
function pickClosestDirection(distances) {
  return (col, row, currentDirection) =>
    chooseAmongOpenDirections(col, row, currentDirection, (options) => {
      let best = options[0];
      let bestDistance = Infinity;
      for (const direction of options) {
        const [dx, dy] = DIRECTIONS[direction];
        const distance = distances.get(`${col + dx},${row + dy}`) ?? Infinity;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = direction;
        }
      }
      return best;
    });
}

// Frightened: flee toward whichever open neighbor is FARTHEST, by actual
// shortest path, from the player — not simply random (a truly random
// frightened ghost can wander straight back into the player), and not a
// naive "move away" heuristic either (same corridor-shape trap the chase AI
// had, just inverted). Ties are broken randomly so fleeing doesn't look
// perfectly deterministic.
function pickFleeDirection(distanceToPlayer) {
  return (col, row, currentDirection) =>
    chooseAmongOpenDirections(col, row, currentDirection, (options) => {
      let bestDistance = -Infinity;
      for (const direction of options) {
        const [dx, dy] = DIRECTIONS[direction];
        const distance = distanceToPlayer.get(`${col + dx},${row + dy}`) ?? -Infinity;
        if (distance > bestDistance) bestDistance = distance;
      }
      const best = options.filter((direction) => {
        const [dx, dy] = DIRECTIONS[direction];
        const distance = distanceToPlayer.get(`${col + dx},${row + dy}`) ?? -Infinity;
        return distance === bestDistance;
      });
      return best[Math.floor(Math.random() * best.length)];
    });
}

// Call when the player eats a power pellet: every ghost not already
// 'eaten' becomes frightened and immediately reverses direction (the
// original arcade's ghosts do this too — it's the "uh oh" beat that gives
// the player a real window to turn the tables). Eating another power
// pellet while ghosts are already frightened simply resets the timer and
// re-flips them, matching the arcade original.
export function startFrightenedMode(state) {
  state.frightenedTimer = FRIGHTENED_DURATION;
  state.ghostEatStreak = 0;
  for (const ghost of state.ghosts) {
    if (ghost.state === 'eaten') continue;
    ghost.state = 'frightened';
    if (ghost.direction) {
      const reversed = REVERSE[ghost.direction];
      if (isDirectionOpen(ghost.col, ghost.row, reversed)) ghost.direction = reversed;
    }
  }
}

// Ticks the frightened countdown; once it hits zero every still-frightened
// ghost (one already eaten and heading home is left alone) goes back to
// chasing. Also ticks the WebMCP freezeGhosts countdown (moveGhosts below
// is what actually honors it by skipping movement).
export function updateGhostModes(state, deltaTime) {
  if (state.ghostsFreezeTimer > 0) {
    state.ghostsFreezeTimer = Math.max(0, state.ghostsFreezeTimer - deltaTime);
  }

  if (state.frightenedTimer <= 0) return;
  state.frightenedTimer = Math.max(0, state.frightenedTimer - deltaTime);
  if (state.frightenedTimer === 0) {
    for (const ghost of state.ghosts) {
      if (ghost.state === 'frightened') ghost.state = 'chase';
    }
  }
}

export function moveGhosts(state, deltaTime) {
  // freezeGhosts (a WebMCP tool) just skips movement entirely for a while
  // — mode transitions (frightened timing out, etc.) still tick normally
  // via updateGhostModes, only the actual stepping-through-the-maze pauses.
  if (state.ghostsFreezeTimer > 0) return;

  // One BFS per frame, shared by every ghost — cheap (a few hundred
  // cells) and guarantees every ghost is reasoning about the same,
  // up-to-date shortest-path distances to the player's current cell.
  const distanceToPlayer = bfsDistances(state.player.col, state.player.row);
  const chase = pickClosestDirection(distanceToPlayer);
  const flee = pickFleeDirection(distanceToPlayer);

  for (const ghost of state.ghosts) {
    if (ghost.state === 'frightened') {
      advanceEntity(ghost, deltaTime, FRIGHTENED_SPEED, flee);
    } else if (ghost.state === 'eaten') {
      // BFS'd fresh per eaten ghost, per frame — eaten ghosts are rare and
      // short-lived, so this stays cheap in practice.
      const distanceToHome = bfsDistances(ghost.homeCol, ghost.homeRow);
      const goHome = pickClosestDirection(distanceToHome);
      advanceEntity(ghost, deltaTime, EATEN_SPEED, (col, row, currentDirection) => {
        if (col === ghost.homeCol && row === ghost.homeRow) {
          ghost.state = 'chase';
          return chase(col, row, currentDirection);
        }
        return goHome(col, row, currentDirection);
      });
    } else {
      advanceEntity(ghost, deltaTime, GHOST_SPEED, chase);
    }
  }
}
