// One pellet per reachable open cell of the maze's 40-unit grid, plus a
// handful of larger power pellets near the corners, all keyed by
// "col,row" in Sets for O(1) lookup/removal.
//
// Pellet placement needs "reachable from where the player can actually
// go," not just "isWall is false" — a letter drawn as an outline has an
// enclosed interior (e.g. the hole inside an "A") that's open floor with
// no connected path in, so a plain isWall scan would place a phantom
// pellet the player can never reach. maze.js's computeReachableCells()
// is the flood-fill that filters those out.

const PELLET_SCORE = 10;
const POWER_PELLET_SCORE = 50;

function cellKey(col, row) {
  return `${col},${row}`;
}

// reachableCells: a Set of "col,row" keys from maze.js's
// computeReachableCells(). powerPelletKeys: an iterable of "col,row" keys
// (from gameState.js's power-pellet spawn search) to exclude — those
// cells get a power pellet instead of a regular one.
export function createPellets(reachableCells, powerPelletKeys) {
  const exclude = new Set(powerPelletKeys);
  const pellets = new Set();
  for (const key of reachableCells) {
    if (exclude.has(key)) continue;
    pellets.add(key);
  }
  return pellets;
}

// Exact-cell match, unlike the ghost/player collision check in
// collisions.js — a pellet only occupies a single grid cell, and the player
// is only ever exactly at a cell center or moving directly between two of
// them (movement.js), so "same col/row" can never miss a pickup the way a
// distance threshold would be needed to for two independently-moving
// entities.
export function tryEatPellet(state) {
  const key = cellKey(state.player.col, state.player.row);
  if (!state.pellets.has(key)) return false;
  state.pellets.delete(key);
  state.score += PELLET_SCORE;
  return true;
}

export function tryEatPowerPellet(state) {
  const key = cellKey(state.player.col, state.player.row);
  if (!state.powerPellets.has(key)) return false;
  state.powerPellets.delete(key);
  state.score += POWER_PELLET_SCORE;
  respawnPowerPellet(state);
  return true;
}

// Keeps exactly `state.powerPellets.size + 1` power pellets on the board at
// all times (i.e. always 4): every time one is eaten, a fresh one appears
// at a random reachable cell that doesn't already have one. Picked from
// `state.reachableCells` (maze.js's flood-fill from the player's spawn),
// not a plain grid scan, so it can never land somewhere the player can't
// actually get to (e.g. an enclosed letter interior). The player's own cell
// is excluded too, so a fresh power pellet never spawns directly underneath
// them and gets scored for free before it's ever actually visible.
function respawnPowerPellet(state) {
  const playerKey = cellKey(state.player.col, state.player.row);
  const candidates = [];
  for (const key of state.reachableCells) {
    if (key === playerKey) continue;
    if (state.powerPellets.has(key)) continue;
    candidates.push(key);
  }
  if (candidates.length === 0) return;

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  state.powerPellets.add(chosen);
  // Every reachable cell besides the original 4 power-pellet corners
  // already carries a regular pellet (see createPellets above), so the
  // newly-chosen cell needs its regular pellet cleared or the board would
  // show two pellets stacked on the same cell.
  state.pellets.delete(chosen);
}
