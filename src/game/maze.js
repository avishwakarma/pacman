// Maze geometry for the AgentNexus maze — the walls, decoratively spelling
// out the maze's branding across two rows, are extracted from the approved
// design SVG so what you see in the game matches the source design
// exactly. Coordinates are in the SVG's own unit space (1320x1084); the
// renderer decides how to scale that to the canvas. Everything — wall
// rects, the border, the ghost pen — is laid out on a 40-unit grid, so
// movement and pellet placement can both walk that same 40-unit grid (see
// GRID_STEP below and forEachGridCell()).
//
// The letters are CLOSED shapes in this version of the design: they are
// solid walls, exactly like a wallRect, not open corridors. isWall(x, y)
// accounts for this directly — there's no separate "is this a letter"
// check needed elsewhere.
//
// This file only owns geometry + "is this point a wall" queries. Where
// pellets go, how the player moves, and how ghosts behave are Stage 1 work
// — see player.js, ghosts.js, pellets.js, collisions.js.

export const MAZE_WIDTH = 1320;
export const MAZE_HEIGHT = 1084;
export const GRID_STEP = 40;

// The play area is this bounding rect, minus the notches cut into the
// border (small decorative gaps, same idea as a warp-tunnel gap). Note
// BOUNDARY.height (998) is not an exact multiple of GRID_STEP — see
// forEachGridCell() for how the last row is handled.
export const BOUNDARY = { x: 40, y: 42, width: 1240, height: 998 };

export const BOUNDARY_POLYGON = [
  [40, 42], [600.5, 42], [600.5, 121.6], [680, 121.6], [680, 42], [1280, 42], [1280, 517.14],
  [1240.5, 517.14], [1240.5, 556.9], [1280, 556.9], [1280, 1040], [680, 1040], [680, 962.39],
  [600.5, 962.39], [600.5, 1040], [40, 1040], [40, 557.42], [80.5, 557.42], [80.5, 517.64], [40, 517.64], [40, 42],
];

// Solid obstacle blocks scattered through the open lattice around and
// between the letters (top/bottom rows, the band between the two words).
export const WALL_RECTS = [
  { x: 80, y: 80, width: 120, height: 40 },
  { x: 80, y: 961, width: 120, height: 40 },
  { x: 800, y: 80, width: 120, height: 40 },
  { x: 800, y: 960, width: 120, height: 40 },
  { x: 360, y: 80, width: 40, height: 40 },
  { x: 360, y: 960, width: 40, height: 40 },
  { x: 1080, y: 80, width: 40, height: 40 },
  { x: 1080, y: 960, width: 80, height: 40 },
  { x: 720, y: 80, width: 40, height: 40 },
  { x: 720, y: 960, width: 40, height: 40 },
  { x: 1160, y: 80, width: 80, height: 40 },
  { x: 1200, y: 960, width: 40, height: 40 },
  { x: 440, y: 80, width: 40, height: 40 },
  { x: 440, y: 960, width: 40, height: 40 },
  { x: 520, y: 80, width: 40, height: 40 },
  { x: 520, y: 960, width: 40, height: 40 },
  { x: 240, y: 80, width: 80, height: 40 },
  { x: 240, y: 960, width: 80, height: 40 },
  { x: 960, y: 80, width: 80, height: 40 },
  { x: 960, y: 960, width: 80, height: 40 },
  { x: 160, y: 400, width: 123, height: 40 },
  { x: 200, y: 480, width: 80, height: 40 },
  { x: 840, y: 480, width: 40, height: 40 },
  { x: 920, y: 480, width: 80, height: 40 },
  { x: 1120, y: 480, width: 80, height: 40 },
  { x: 1040, y: 560, width: 160, height: 40 },
  { x: 1040, y: 400, width: 120, height: 40 },
  { x: 840, y: 560, width: 80, height: 40 },
  { x: 1040, y: 480, width: 40, height: 40 },
  { x: 960, y: 400, width: 40, height: 40 },
  { x: 80, y: 400, width: 40, height: 40 },
  { x: 1200, y: 400, width: 40, height: 40 },
  { x: 120, y: 560, width: 80, height: 40 },
  { x: 320, y: 480, width: 40, height: 40 },
  { x: 120, y: 480, width: 40, height: 40 },
  { x: 240, y: 560, width: 81, height: 40 },
  { x: 240, y: 640, width: 41, height: 40 },
  { x: 80, y: 720, width: 41, height: 120 },
  { x: 80, y: 880, width: 41, height: 40 },
  { x: 322, y: 640, width: 41, height: 40 },
  { x: 760, y: 639, width: 40, height: 40 },
  { x: 960, y: 560, width: 40, height: 40 },
  { x: 1000, y: 639, width: 40, height: 40 },
  { x: 1080, y: 639, width: 40, height: 40 },
  { x: 1160, y: 720, width: 80, height: 40 },
  { x: 1160, y: 801, width: 80, height: 40 },
  { x: 1160, y: 881, width: 80, height: 40 },
  { x: 360, y: 560, width: 81, height: 40 },
  { x: 400, y: 480, width: 41, height: 40 },
  { x: 321, y: 400, width: 80, height: 40 },
  { x: 441, y: 400, width: 200, height: 40 },
  { x: 519, y: 640, width: 200, height: 40 },
  { x: 680, y: 400, width: 120, height: 40 },
  { x: 840, y: 400, width: 80, height: 40 },
  { x: 401, y: 640, width: 80, height: 40 },
  { x: 80, y: 640, width: 119, height: 40 },
  { x: 841, y: 639, width: 120, height: 40 },
  { x: 1160, y: 639, width: 80, height: 40 },
];

// The ghost house, sitting in the gap between the two rows of letters.
export const GHOST_PEN_POLYGON = [
  [800.5, 599.5], [800.5, 480], [681, 480], [681, 519.5], [761.5, 519.5], [761.5, 560],
  [516, 560], [516, 519.5], [601, 519.5], [601, 480], [481, 480], [481, 599.5], [800.5, 599.5],
];

// Closed letter shapes. Each entry is one letter; a letter may be made of
// more than one closed subpath (e.g. a top bar plus a separate hook), the
// same way a single SVG <path> can combine several subpaths into one
// filled shape. Solid — these are walls, not open corridors.
export const LETTER_SHAPES = [
  {
    color: '#A22FAA',
    subpaths: [
      [[320, 200], [280, 200], [280, 334.13], [280, 360], [305, 360], [440, 360], [440, 239.5], [360, 239.5], [360, 280], [400, 280], [400, 320], [320, 320], [320, 200]],
      [[320, 200], [320, 160], [440, 160], [440, 200], [320, 200]],
    ],
  },
  {
    color: '#BB3131',
    subpaths: [
      [[200, 200.5], [200, 160], [105, 160], [80, 160], [80, 185.88], [80, 360], [120, 360], [120, 280], [200, 280], [200, 360], [240, 360], [240, 200.5], [200, 200.5]],
      [[200, 200.5], [200, 240], [120, 240], [120, 200.5], [200, 200.5]],
    ],
  },
  {
    color: '#FFAC1C',
    subpaths: [
      [[520, 320], [520, 359], [640, 359], [640, 320], [520, 320]],
      [[520, 320], [480, 320], [480, 184.88], [480, 160], [504.75, 160], [640, 160], [640, 200.5], [520, 200], [520, 240], [600, 240], [600, 280], [520, 280], [520, 320]],
    ],
  },
  {
    color: '#20B03F',
    subpaths: [
      [[760, 320], [760, 280], [720, 280], [720, 360.5], [680, 360.5], [680, 160], [720, 160], [720, 200], [760, 200], [760, 240], [800, 240], [800, 160], [840, 160], [840, 360], [800, 360], [800, 320], [760, 320]],
    ],
  },
  {
    color: '#BB3131',
    subpaths: [
      [[880, 200], [880, 160], [1040.5, 160], [1040.5, 200], [1000, 200], [1000, 360], [920, 360], [920, 200], [880, 200]],
    ],
  },
  {
    color: '#2AC795',
    subpaths: [
      [[1080, 259.5], [1080, 200], [1120, 200], [1120, 160], [1240, 160], [1240, 200], [1160, 200], [1160, 240], [1200, 240], [1200, 280], [1240, 280], [1240, 334.13], [1200, 334.13], [1200, 359], [1080, 359], [1080, 320.5], [1160, 320.5], [1160, 284.38], [1104.75, 284.38], [1104.75, 259.5], [1080, 259.5]],
    ],
  },
  {
    color: '#FFAC1C',
    subpaths: [
      [[403, 879], [403, 918], [523, 918], [523, 879], [403, 879]],
      [[403, 879], [363, 879], [363, 743.88], [363, 719], [387.75, 719], [523, 719], [523, 759.5], [403, 759], [403, 799], [483, 799], [483, 839], [403, 839], [403, 879]],
    ],
  },
  {
    color: '#A22FAA',
    subpaths: [
      [[242, 879], [242, 839], [202, 839], [202, 919.5], [162, 919.5], [162, 719], [202, 719], [202, 759], [242, 759], [242, 799], [282, 799], [282, 719], [322, 719], [322, 919], [282, 919], [282, 879], [242, 879]],
    ],
  },
  {
    color: '#2AC795',
    subpaths: [
      [[960, 817.5], [960, 758], [1000, 758], [1000, 718], [1120, 718], [1120, 758], [1040, 758], [1040, 798], [1080, 798], [1080, 838], [1120, 838], [1120, 892.13], [1080, 892.13], [1080, 917], [960, 917], [960, 878.5], [1040, 878.5], [1040, 842.38], [984.75, 842.38], [984.75, 817.5], [960, 817.5]],
    ],
  },
  {
    color: '#20B03F',
    subpaths: [
      [[560, 800], [560, 721], [600, 721], [600, 760], [680, 760], [680, 721], [720, 721], [720, 800], [680, 800], [680, 840], [720, 840], [720, 921], [680, 921], [680, 880.5], [600, 880.5], [600, 921], [560, 921], [560, 840], [600, 840], [600, 800], [560, 800]],
    ],
  },
  {
    color: '#BB3131',
    subpaths: [
      [[880, 880], [800, 880], [800, 720], [760, 720], [760, 895], [760, 920], [784.83, 920], [880, 920], [880, 880]],
      [[880, 880], [880, 720], [920, 720], [920, 880], [880, 880]],
    ],
  },
];

const LETTER_LINE_CLEARANCE = 8; // half the 6px stroke width, plus a small margin

// --- collision queries ---------------------------------------------------

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

// Signed area test used by the winding-number check below.
function isLeft(x1, y1, x2, y2, px, py) {
  return (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
}

// Nonzero-winding-rule point-in-polygon across a set of (possibly several)
// closed subpaths — matches how a single SVG <path> with multiple subpaths
// resolves its fill, which is how each multi-part letter is authored.
function windingNumberInside(x, y, subpaths) {
  let wn = 0;
  for (const ring of subpaths) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if (y1 <= y) {
        if (y2 > y && isLeft(x1, y1, x2, y2, x, y) > 0) wn++;
      } else if (y2 <= y && isLeft(x1, y1, x2, y2, x, y) < 0) {
        wn--;
      }
    }
  }
  return wn !== 0;
}

function distanceToSegment(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function isInsideBoundary(x, y) {
  return pointInPolygon(x, y, BOUNDARY_POLYGON);
}

export function isInsideGhostPen(x, y) {
  return pointInPolygon(x, y, GHOST_PEN_POLYGON);
}

export function isInsideLetterFill(x, y) {
  return LETTER_SHAPES.some(({ subpaths }) => windingNumberInside(x, y, subpaths));
}

// Minimum distance from (x, y) to any letter's boundary line. The letters
// are drawn with a 6px stroke, so the visible line extends a few units
// either side of the mathematical fill boundary — a point can be just
// outside the fill and still overlap the rendered stroke. Used by isWall
// below, and useful on its own for anything that wants a soft clearance
// (e.g. keeping a spawn point comfortably away from a letter).
export function distanceToLetterLines(x, y) {
  let min = Infinity;
  for (const { subpaths } of LETTER_SHAPES) {
    for (const points of subpaths) {
      for (let i = 0; i < points.length - 1; i++) {
        const d = distanceToSegment(x, y, points[i], points[i + 1]);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

// True if (x, y) is solid — outside the play area, inside a wall block,
// inside the ghost pen, or inside/on a letter (letters are closed shapes
// in this design, so they block movement exactly like a wallRect).
export function isWall(x, y) {
  if (!isInsideBoundary(x, y)) return true;
  if (WALL_RECTS.some((r) => pointInRect(x, y, r))) return true;
  if (isInsideGhostPen(x, y)) return true;
  if (isInsideLetterFill(x, y)) return true;
  if (distanceToLetterLines(x, y) < LETTER_LINE_CLEARANCE) return true;
  return false;
}

// Grid dimensions. Uses ceil, not floor: BOUNDARY.width divides evenly by
// GRID_STEP (1240 / 40 = 31) but BOUNDARY.height doesn't (998 / 40 =
// 24.95) — flooring would silently drop the last, slightly short row
// along the bottom border.
export const GRID_COLS = Math.ceil(BOUNDARY.width / GRID_STEP);
export const GRID_ROWS = Math.ceil(BOUNDARY.height / GRID_STEP);

// The maze-unit center point of a given (col, row) grid cell. The min()
// clamp keeps the last row/col's center inside the boundary instead of
// overshooting it, for the same reason GRID_COLS/GRID_ROWS use ceil above.
// This is the single source of truth for the grid <-> maze-unit mapping —
// movement, pellet placement, and spawn search all go through it so they
// can never drift out of sync with each other.
export function gridCellCenter(col, row) {
  const x = Math.min(BOUNDARY.x + col * GRID_STEP + GRID_STEP / 2, BOUNDARY.x + BOUNDARY.width - GRID_STEP / 2);
  const y = Math.min(BOUNDARY.y + row * GRID_STEP + GRID_STEP / 2, BOUNDARY.y + BOUNDARY.height - GRID_STEP / 2);
  return [x, y];
}

// Walks every cell of the 40-unit grid the maze is built on and calls
// callback(x, y, col, row) with each cell's center point — x/y in maze
// units, col/row as 0-based grid indices. Only calls back for cells whose
// center actually falls inside the play area; it's up to the caller to
// additionally check isWall(x, y) for whatever else counts as blocked
// (walls, the pen, letters).
export function forEachGridCell(callback) {
  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      const [x, y] = gridCellCenter(col, row);
      if (isInsideBoundary(x, y)) callback(x, y, col, row);
    }
  }
}

// Spirals outward from (targetCol, targetRow) — checking the ring of cells
// at each increasing distance — until it finds a grid cell whose center
// isn't a wall, and returns it. Used for spawn points (player, ghosts) so
// they're computed against the maze's actual geometry instead of a
// hand-verified magic coordinate that would silently go stale if the maze
// changes.
export function findOpenCellNear(targetCol, targetRow) {
  const maxRadius = Math.max(GRID_COLS, GRID_ROWS);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dRow = -radius; dRow <= radius; dRow++) {
      for (let dCol = -radius; dCol <= radius; dCol++) {
        if (Math.max(Math.abs(dCol), Math.abs(dRow)) !== radius) continue;
        const col = targetCol + dCol;
        const row = targetRow + dRow;
        const [x, y] = gridCellCenter(col, row);
        if (!isWall(x, y)) return { col, row, x, y };
      }
    }
  }
  throw new Error(`findOpenCellNear: no open cell found near (${targetCol}, ${targetRow})`);
}

// Breadth-first search 4-directionally from (seedCol, seedRow) across
// every open (non-wall) cell, returning a Map of "col,row" -> distance in
// steps from the seed. This is the actual shortest-path distance through
// the maze's corridors, not straight-line distance — the two can differ
// wildly (a cell 3 corridors away by straight-line might be 20 steps away
// by the only real path in), and anything that needs a real "which way is
// actually closer" answer (ghost chase logic, most obviously) needs this,
// not Euclidean distance.
export function bfsDistances(seedCol, seedRow) {
  const seedKey = `${seedCol},${seedRow}`;
  const distances = new Map([[seedKey, 0]]);
  const queue = [[seedCol, seedRow]];
  const neighborOffsets = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head++];
    const distance = distances.get(`${col},${row}`);
    for (const [dCol, dRow] of neighborOffsets) {
      const nextCol = col + dCol;
      const nextRow = row + dRow;
      if (nextCol < 0 || nextCol >= GRID_COLS || nextRow < 0 || nextRow >= GRID_ROWS) continue;
      const key = `${nextCol},${nextRow}`;
      if (distances.has(key)) continue;
      const [x, y] = gridCellCenter(nextCol, nextRow);
      if (isWall(x, y)) continue;
      distances.set(key, distance + 1);
      queue.push([nextCol, nextRow]);
    }
  }

  return distances;
}

// The set of "col,row" keys actually reachable from (seedCol, seedRow) by
// ordinary movement — a different question from isWall(): a letter drawn
// as an outline (rather than a solid block) has an enclosed interior —
// e.g. the hole inside an "A" — that is genuinely open floor (isWall is
// false there) but has no connected path in from anywhere else, since
// every cell around it is the letter's own stroke. Anything that places
// content by "is this cell open" alone (pellets, most obviously) needs
// this reachability filter too, or it'll place something the player can
// never actually reach.
export function computeReachableCells(seedCol, seedRow) {
  return new Set(bfsDistances(seedCol, seedRow).keys());
}
