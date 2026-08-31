// Stage 3: a simple autopilot that plays the game by itself. It reuses the
// exact same tools the ghost chase AI already uses — maze.js's bfsDistances
// (real shortest-path distance through the maze, not straight-line) and
// the same "gather open directions, minimize/maximize a distance map"
// pattern ghosts.js already established (see pickClosestDirection /
// pickFleeDirection there) — just aimed at a different goal: head for the
// nearest pellet, unless a chasing ghost is close enough to be a real
// threat, in which case flee it instead.
//
// Crucially, this file never touches movePlayer or the movement engine
// directly — it only ever sets state.player.queuedDirection, the exact
// field a keypress sets in player.js. The player's own movement code can't
// tell the difference between a human holding a direction key and the
// agent continuously re-deciding one, which is what keeps this file small.

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
