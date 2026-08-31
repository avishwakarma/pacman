// Arrow-key/WASD input and grid-based movement, on top of movement.js's
// shared grid-locked movement engine. Player-specific behavior is just the
// "which direction next?" decision: prefer whatever direction the player
// most recently queued (a keypress can be buffered ahead of reaching the
// next intersection, same as the original arcade game), falling back to
// continuing straight, falling back to stopping if neither is open.

import { isDirectionOpen, advanceEntity } from './movement.js';

// Both cases of each WASD letter: event.key reflects Shift/Caps Lock state
// ('a' becomes 'A'), so only mapping the lowercase form would silently drop
// input the moment Caps Lock is on.
const KEY_TO_DIRECTION = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

const PLAYER_SPEED = 200; // maze units/second — one grid cell every 0.2s

export function handleKeyDown(state, event) {
  const direction = KEY_TO_DIRECTION[event.key];
  if (!direction) return;
  event.preventDefault(); // arrow keys otherwise scroll the page
  state.player.queuedDirection = direction;
}

// state.player.queuedDirection is sticky, not a one-shot "turn now"
// request: it just records the last direction key pressed, and stays set
// until a different key overrides it. Combined with being re-checked every
// time the player is at a cell center (movement.js only calls this hook
// there), that's what lets holding a key steer the player through however
// many intersections keep offering that direction, without needing to
// tap the key again at each one.
function chooseNextDirection(state) {
  return (col, row, currentDirection) => {
    const queued = state.player.queuedDirection;
    if (queued && isDirectionOpen(col, row, queued)) return queued;
    if (currentDirection && isDirectionOpen(col, row, currentDirection)) return currentDirection;
    return null;
  };
}

export function movePlayer(state, deltaTime) {
  advanceEntity(state.player, deltaTime, PLAYER_SPEED, chooseNextDirection(state));
}
