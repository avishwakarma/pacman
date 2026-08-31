// The autopilot: a simple, fully deterministic bot that plays the game by
// itself when toggled on from the HUD. It reuses the exact same BFS-based
// approach the ghost chase AI uses (see the identical
// chooseAmongOpenDirections pattern in ghosts.js) — head for the nearest
// pellet, flee a chasing ghost that gets too close.
//
// This is intentionally plain UI-controlled JS, not chat/LLM-controlled —
// an earlier version let the model turn it on and steer its strategy via
// WebMCP tools, but reliably getting a small local model to remember "the
// autopilot needs to be turned on" every check-in wasn't dependable enough
// for something this basic, and the periodic re-invocation added a lot of
// failure surface (context growth, races) for what it was worth. This
// stays simple and just works.
//
// It never touches movePlayer or the movement engine directly — it only
// ever sets state.player.queuedDirection, the exact field a keypress sets
// in player.js. The player's own movement code can't tell the difference
// between a human holding a direction key and this running every frame.

import { DIRECTIONS, REVERSE, isDirectionOpen } from './movement.js';
import { bfsDistances } from './maze.js';

// A chasing ghost within this many BFS steps is close enough to be worth
// running from instead of continuing toward a pellet.
const GHOST_DANGER_DISTANCE = 6;

export function toggleAgent(state, active) {
  state.agentActive = active ?? !state.agentActive;
}

export function isAgentActive(state) {
  return Boolean(state.agentActive);
}

// Same shape as ghosts.js's chooseAmongOpenDirections: gather the open
// directions from (col, row), drop a pointless straight reversal unless
// it's the only option, then let `pickBest` choose among what's left.
function chooseAmongOpenDirections(col, row, currentDirection, pickBest) {
  const open = Object.keys(DIRECTIONS).filter((direction) => isDirectionOpen(col, row, direction));
  if (open.length === 0) return null;
  const reverse = currentDirection ? REVERSE[currentDirection] : null;
  const nonReverse = open.filter((direction) => direction !== reverse);
  const options = nonReverse.length > 0 ? nonReverse : open;
  return pickBest(options);
}

// Picks randomly among whichever open directions tie for the best score
// (by `scoreFor`, e.g. "smallest distance to target") instead of always
// the same one — without this, ties were always broken in a fixed order
// (Object.keys(DIRECTIONS) order), so the autopilot walked the exact same
// path every single run. It's still never a wrong choice: every tied
// option is equally optimal, only which of several equally-good paths
// gets taken varies. Same tie-breaking-with-randomness pattern
// ghosts.js's frightened-flee logic already uses.
function pickBestWithRandomTiebreak(options, scoreFor, isBetter) {
  let bestScore = scoreFor(options[0]);
  for (const direction of options) {
    const score = scoreFor(direction);
    if (isBetter(score, bestScore)) bestScore = score;
  }
  const tied = options.filter((direction) => scoreFor(direction) === bestScore);
  return tied[Math.floor(Math.random() * tied.length)];
}

function stepToward(col, row, currentDirection, distanceToTarget) {
  return chooseAmongOpenDirections(col, row, currentDirection, (options) => {
    const scoreFor = (direction) => {
      const [dx, dy] = DIRECTIONS[direction];
      return distanceToTarget.get(`${col + dx},${row + dy}`) ?? Infinity;
    };
    return pickBestWithRandomTiebreak(options, scoreFor, (score, best) => score < best);
  });
}

function stepAway(col, row, currentDirection, distanceToThreat) {
  return chooseAmongOpenDirections(col, row, currentDirection, (options) => {
    const scoreFor = (direction) => {
      const [dx, dy] = DIRECTIONS[direction];
      return distanceToThreat.get(`${col + dx},${row + dy}`) ?? -Infinity;
    };
    return pickBestWithRandomTiebreak(options, scoreFor, (score, best) => score > best);
  });
}

// The nearest pellet or power pellet by real shortest-path distance from
// the player's current cell — `distanceFromPlayer` was computed once from
// there, so this is just a scan-and-compare over the two pellet sets.
function findNearestPelletKey(state, distanceFromPlayer) {
  let best = null;
  let bestDistance = Infinity;
  for (const key of state.pellets) {
    const distance = distanceFromPlayer.get(key);
    if (distance != null && distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  for (const key of state.powerPellets) {
    const distance = distanceFromPlayer.get(key);
    if (distance != null && distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return best;
}

// The closest ghost that's actually dangerous right now — a 'frightened'
// or 'eaten' ghost isn't a threat, only 'chase' is.
function findNearestThreat(state, distanceFromPlayer) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const ghost of state.ghosts) {
    if (ghost.state !== 'chase') continue;
    const distance = distanceFromPlayer.get(`${ghost.col},${ghost.row}`) ?? Infinity;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = ghost;
    }
  }
  return nearestDistance <= GHOST_DANGER_DISTANCE ? nearest : null;
}

export function updateAgent(state) {
  if (!isAgentActive(state) || state.gameOver) return;

  const { col, row, direction } = state.player;
  const distanceFromPlayer = bfsDistances(col, row);

  const threat = findNearestThreat(state, distanceFromPlayer);
  if (threat) {
    const distanceToThreat = bfsDistances(threat.col, threat.row);
    const next = stepAway(col, row, direction, distanceToThreat);
    if (next) state.player.queuedDirection = next;
    return;
  }

  const targetKey = findNearestPelletKey(state, distanceFromPlayer);
  if (!targetKey) return; // no pellets left — nothing to chase

  const [targetCol, targetRow] = targetKey.split(',').map(Number);
  const distanceToTarget = bfsDistances(targetCol, targetRow);
  const next = stepToward(col, row, direction, distanceToTarget);
  if (next) state.player.queuedDirection = next;
}
