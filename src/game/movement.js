// Shared grid-locked movement: an entity (player or ghost) only ever
// changes direction while sitting exactly on a grid-cell center, and moves
// in a straight line between centers at a fixed speed. This keeps every
// wall check exact (maze.js's isWall() is meant to be queried at cell
// centers) and gives both player.js and ghosts.js the same movement feel
// without duplicating the step/collision math between them — each file
// only supplies its own "which direction next?" decision.

import { GRID_COLS, GRID_ROWS, gridCellCenter, isWall } from './maze.js';

export const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export const REVERSE = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function isDirectionOpen(col, row, directionName) {
  const [dx, dy] = DIRECTIONS[directionName];
  const targetCol = col + dx;
  const targetRow = row + dy;
  // Bounds check BEFORE touching gridCellCenter: its last-row/col clamp
  // maps every out-of-range index to the same coordinate as the true last
  // one, so an unbounded check here would spuriously report cells one (or
  // more) past the maze edge as open — letting an entity's col/row drift
  // past the real grid while its on-screen position stays visually pinned
  // at the edge, permanently desyncing it from anything keyed by col/row
  // (like the pellet set).
  if (targetCol < 0 || targetCol >= GRID_COLS || targetRow < 0 || targetRow >= GRID_ROWS) return false;
  const [x, y] = gridCellCenter(targetCol, targetRow);
  return !isWall(x, y);
}

// Advances one grid-locked entity by dt seconds at the given speed
// (maze units/second). `chooseNextDirection(col, row, currentDirection)`
// is called every time the entity is exactly at a cell center and must
// decide what happens next — it should return an open direction name to
// keep moving, or null to stop there. This single hook covers both
// "starting from a stop" (currentDirection is null) and "reached the next
// center while already moving" (currentDirection is what it was heading).
// Speed is passed in per call rather than stored on the entity so the same
// engine can serve entities whose speed changes with their own state
// without this file needing to know why (the player's constant pace,
// vs. a ghost's chase/frightened/eaten speeds in ghosts.js).

// entity.facing (if the entity has one — only player.js's state does, see
// gameState.js) tracks the same thing entity.direction does, except it
// never goes back to null. direction has to go null the instant there's
// nowhere open to continue (that's what makes the entity actually stop),
// but a renderer picking a sprite's rotation off direction directly ends
// up snapping to whatever angle 0 means the moment that happens — hit
// live: Pacman visibly flipping to face right every time it stopped at a
// wall, regardless of which way it had been walking. facing just holds
// onto the last real direction instead, so "stopped" and "which way was I
// facing when I stopped" stay separate questions with separate answers.
function setDirection(entity, direction) {
  entity.direction = direction;
  if (direction != null && 'facing' in entity) entity.facing = direction;
}

export function advanceEntity(entity, dt, speed, chooseNextDirection) {
  if (entity.direction == null) {
    setDirection(entity, chooseNextDirection(entity.col, entity.row, entity.direction) ?? null);
    if (entity.direction == null) return;
  }

  const [dx, dy] = DIRECTIONS[entity.direction];
  const [targetX, targetY] = gridCellCenter(entity.col + dx, entity.row + dy);
  const remainingX = targetX - entity.x;
  const remainingY = targetY - entity.y;
  const remainingDist = Math.hypot(remainingX, remainingY);
  const step = speed * dt;

  if (step >= remainingDist) {
    // Reached (or passed) the next cell center this frame — snap exactly
    // to it rather than carrying the small overshoot, so position never
    // drifts off the grid over time.
    entity.x = targetX;
    entity.y = targetY;
    entity.col += dx;
    entity.row += dy;
    // Re-decide immediately, same frame, rather than waiting a tick: there's
    // no one-frame "stall" at each intersection, so continuing straight or
    // turning both read as one continuous motion instead of a stutter.
    setDirection(entity, chooseNextDirection(entity.col, entity.row, entity.direction) ?? null);
  } else {
    entity.x += (remainingX / remainingDist) * step;
    entity.y += (remainingY / remainingDist) * step;
  }
}
