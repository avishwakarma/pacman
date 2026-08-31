// The single source of truth for what's happening in the game right now —
// score, the player, the ghosts, and which pellets are still on the
// board. Stage 2's WebMCP tools will read and mutate this object directly
// (e.g. spawnGhost pushes into `ghosts`), so the shape stays simple and
// flat:
//
//   {
//     score: 0,
//     lives: 5,
//     player: { x, y, col, row, direction, facing, queuedDirection },
//     ghosts: [{ id, color, x, y, col, row, direction, state, homeCol, homeRow }],
//     pellets: Set of "col,row" keys still uneaten,
//     powerPellets: Set of "col,row" keys still uneaten (always 4 — a new
//       one spawns elsewhere each time one is eaten, see pellets.js),
//     reachableCells: Set of "col,row" keys the player can actually reach,
//       kept around so a new power pellet can be placed reachably later,
//     frightenedTimer: seconds left of the current power-pellet window (0
//       when no ghosts are frightened),
//     ghostEatStreak: ghosts eaten so far during the current frightened
//       window, for the doubling 200/400/800/1600 bonus,
//     ghostsFreezeTimer: seconds left that ghost movement is paused for
//       (the WebMCP freezeGhosts tool sets this; 0 = not frozen),
//     agentActive: whether the Stage 3 autopilot (game/agent.js) is
//       currently driving the player instead of the keyboard,
//     gameOver: false,
//   }

import { GRID_COLS, GRID_ROWS, findOpenCellNear, gridCellCenter, computeReachableCells } from './maze.js';
import { createPellets } from './pellets.js';
import { spawnGhost } from './ghosts.js';

const GHOST_COUNT = 2; // matches the brief's "1 to 2 ghosts"
export const STARTING_LIVES = 5;

export function spawnPlayer() {
  // Below the ghost pen (which sits roughly in the vertical middle of the
  // maze), horizontally centered — computed against the actual maze
  // geometry rather than a hand-picked coordinate.
  const targetCol = Math.round(GRID_COLS / 2);
  const targetRow = Math.round(GRID_ROWS * 0.72);
  const { col, row, x, y } = findOpenCellNear(targetCol, targetRow);
  // facing starts equal to direction (both null, nothing to face yet) but
  // unlike direction never goes back to null once set — see movement.js's
  // advanceEntity for why the two need to differ once the player actually
  // moves and then stops at a wall.
  return { x, y, col, row, direction: null, facing: null, queuedDirection: null };
}

// One power pellet near each corner of the grid — the corner cells
// (0,0), (GRID_COLS-1,0), (0,GRID_ROWS-1), (GRID_COLS-1,GRID_ROWS-1)
// themselves, or the nearest open cell to each if a corner happens not to
// be open. Matches the corner placement from the approved maze design.
function spawnPowerPelletKeys() {
  const corners = [
    [0, 0],
    [GRID_COLS - 1, 0],
    [0, GRID_ROWS - 1],
    [GRID_COLS - 1, GRID_ROWS - 1],
  ];
  return corners.map(([col, row]) => {
    const cell = findOpenCellNear(col, row);
    return `${cell.col},${cell.row}`;
  });
}

export function createInitialState() {
  const player = spawnPlayer();
  const reachableCells = computeReachableCells(player.col, player.row);
  const powerPelletKeys = spawnPowerPelletKeys();

  const state = {
    score: 0,
    lives: STARTING_LIVES,
    gameOver: false,
    player,
    ghosts: [],
    pellets: createPellets(reachableCells, powerPelletKeys),
    powerPellets: new Set(powerPelletKeys),
    reachableCells,
    frightenedTimer: 0,
    ghostEatStreak: 0,
    ghostsFreezeTimer: 0,
    agentActive: false,
  };

  for (let i = 0; i < GHOST_COUNT; i++) spawnGhost(state);

  return state;
}

// Called after a life is lost (but the game isn't over yet): puts the
// player and every ghost back at their spawn positions, same as the
// classic arcade's brief "reset" beat after a death. Score and the
// pellets/powerPellets already on the board are untouched — only
// positions and the frightened/freeze timers reset.
export function resetPositions(state) {
  Object.assign(state.player, spawnPlayer());
  for (const ghost of state.ghosts) {
    const [x, y] = gridCellCenter(ghost.homeCol, ghost.homeRow);
    ghost.col = ghost.homeCol;
    ghost.row = ghost.homeRow;
    ghost.x = x;
    ghost.y = y;
    ghost.direction = null;
    ghost.state = 'chase';
  }
  state.frightenedTimer = 0;
  state.ghostEatStreak = 0;
  state.ghostsFreezeTimer = 0;
}
