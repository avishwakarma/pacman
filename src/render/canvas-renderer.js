// The Canvas 2D renderer — everything Canvas-2D-specific lives in this one
// file: the static maze structure (border, walls, ghost pen, letters), the
// per-frame dynamic draw (pellets, ghosts, player), and the true-edge-case
// fallback banner (something went wrong before the game loop could even
// start). Game-over text is a DOM overlay (see main.js), not drawn here —
// Canvas 2D and the WebGPU renderer share that one overlay instead of each
// needing their own text-rendering path.
//
// This is the guaranteed-available renderer — every browser with a
// <canvas> has Canvas 2D, no capability check needed (contrast
// utils/capability-check.js, which exists only for the WebGPU path). It
// draws the exact same maze, at the same colors and radii, as
// webgpu-renderer.js, but the two files share no code: Canvas 2D has
// built-in path/arc/curve primitives and a transform stack, so shapes here
// are expressed directly in those terms (ctx.arc, ctx.quadraticCurveTo,
// ctx.rotate) instead of going through gpu-shapes.js's triangle math. Where
// a rendering choice here exists only to match what the WebGPU side does
// differently, it's called out inline.

import { MAZE_WIDTH, MAZE_HEIGHT, GRID_STEP, gridCellCenter, BOUNDARY_POLYGON, WALL_RECTS, GHOST_PEN_POLYGON, LETTER_SHAPES } from '../game/maze.js';
import { FRIGHTENED_WARNING_TIME } from '../game/ghosts.js';

const PLAYER_RADIUS = GRID_STEP * 0.4;
const GHOST_RADIUS = GRID_STEP * 0.4;
const PELLET_RADIUS = 4;
const POWER_PELLET_RADIUS = 9;

const FRIGHTENED_COLOR = '#2121ff';
const FRIGHTENED_FLASH_COLOR = '#ffffff';
const FRIGHTENED_FLASH_INTERVAL = 0.2; // seconds per flash swap, during the warning window
const EYE_WHITE = '#eef2ff';
const EYE_PUPIL = '#1b2350';

const DIRECTION_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export function initCanvasRenderer(canvas) {
  canvas.width = MAZE_WIDTH;
  canvas.height = MAZE_HEIGHT;
  return canvas.getContext('2d');
}

// --- static maze structure ------------------------------------------------

function polygonPath(points) {
  const path = new Path2D();
  const [firstX, firstY] = points[0];
  path.moveTo(firstX, firstY);
  for (const [x, y] of points.slice(1)) path.lineTo(x, y);
  path.closePath();
  return path;
}

// Draws the parts of the maze that never change frame to frame: border,
// wall blocks, the ghost pen, and the letters.
export function drawMazeStructure(ctx) {
  const borderPath = polygonPath(BOUNDARY_POLYGON);
  ctx.fillStyle = '#181818';
  ctx.fill(borderPath);
  ctx.strokeStyle = '#2f35aa';
  ctx.lineWidth = 5;
  ctx.stroke(borderPath);

  ctx.fillStyle = '#010549';
  ctx.strokeStyle = '#2f35aa';
  ctx.lineWidth = 5;
  for (const r of WALL_RECTS) {
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
  const penPath = polygonPath(GHOST_PEN_POLYGON);
  ctx.fill(penPath);
  ctx.stroke(penPath);

  // Letters — closed shapes, each may combine multiple subpaths into one
  // filled shape with the browser's default nonzero fill rule, same as SVG.
  for (const letter of LETTER_SHAPES) {
    const path = new Path2D();
    for (const subpath of letter.subpaths) {
      const [firstX, firstY] = subpath[0];
      path.moveTo(firstX, firstY);
      for (const [x, y] of subpath.slice(1)) path.lineTo(x, y);
      path.closePath();
    }
    // The black fill matters here in a way it doesn't for the WebGPU side:
    // letters are drawn on top of the border's #181818 fill above, so
    // without their own fill a letter's interior would show that grey
    // through, not the maze's black background. webgpu-renderer.js skips
    // painting an equivalent letter fill entirely — #181818 vs pure black
    // reads as the same color at a glance, so it isn't worth the
    // nonzero-winding triangulation a filled multi-subpath letter would
    // need (Canvas 2D gets that fill rule for free via ctx.fill()'s
    // default 'nonzero' rule, no extra work required).
    ctx.fillStyle = '#000';
    ctx.fill(path);
    ctx.strokeStyle = letter.color;
    ctx.lineWidth = 6;
    ctx.stroke(path);
  }
}

// True edge case: something went wrong before the real game loop could
// start (e.g. maze geometry search failed) or canvas itself misbehaves.
// Still draws the full static maze rather than just an error message on a
// blank screen — the maze geometry itself is static data unrelated to
// whatever failed, so there's no reason a startup error should also hide
// it; a recognizable, familiar screen with a message at the bottom reads
// far less alarming than a plain error page.
export function renderFallback(canvas, reason) {
  canvas.width = MAZE_WIDTH;
  canvas.height = MAZE_HEIGHT;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMazeStructure(ctx);

  ctx.fillStyle = '#9099c2';
  ctx.font = '20px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(reason ?? 'Canvas 2D fallback — see SETUP.md', canvas.width / 2, canvas.height - 24);
}

// --- per-frame dynamic draw ------------------------------------------------

function drawPellets(ctx, state) {
  ctx.fillStyle = '#ffc79a';
  for (const key of state.pellets) {
    const [col, row] = key.split(',').map(Number);
    const [x, y] = gridCellCenter(col, row);
    ctx.beginPath();
    ctx.arc(x, y, PELLET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The glow here is a real per-pixel blur (ctx.shadowBlur), the one thing
// Canvas 2D can do that gpu-shapes.js can't cheaply — this pipeline has no
// blur/post-process step, so webgpu-renderer.js's pushPowerPellets fakes
// the same look with a couple of stacked, low-alpha circles instead.
function drawPowerPellets(ctx, state) {
  ctx.fillStyle = '#ffd8b8';
  ctx.shadowColor = 'rgba(255, 216, 184, 0.8)';
  ctx.shadowBlur = 10;
  for (const key of state.powerPellets) {
    const [col, row] = key.split(',').map(Number);
    const [x, y] = gridCellCenter(col, row);
    ctx.beginPath();
    ctx.arc(x, y, POWER_PELLET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  // shadowBlur/shadowColor are canvas-wide state, not scoped to this
  // function's draws — left alone, the blur would keep applying to every
  // shape drawn after this one (ghosts, the player). Only shadowBlur needs
  // resetting; leaving shadowColor stale is harmless since blur=0 disables
  // the shadow regardless of its color.
  ctx.shadowBlur = 0;
}

// This exact path — dome arc, then explicit lineTo's for the scalloped
// bottom — is the canonical shape of a ghost's body; gpu-shapes.js's
// ghostBodyOutline() re-derives the same silhouette as a discrete point
// list (an arc can't be a GPU vertex buffer) so it can be triangulated. If
// the shape changes here, that function needs the matching change or the
// two renderers will visibly drift apart.
function drawGhostBody(ctx, r, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.arc(0, -r * 0.1, r, Math.PI, 0, false); // dome
  ctx.lineTo(r, r * 0.7);
  const scallops = 4;
  const step = (2 * r) / scallops;
  for (let i = 0; i < scallops; i++) {
    const outerX = r - step * i;
    const midX = outerX - step / 2;
    ctx.lineTo(midX, r * 0.35);
    ctx.lineTo(outerX - step, r * 0.7);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEyes(ctx, r) {
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.2, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(r * 0.35, -r * 0.2, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = EYE_PUPIL;
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.15, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r * 0.4, -r * 0.15, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

// Frightened face: plain round white eyes (no direction-pointing pupils —
// the ghost isn't "looking" anywhere anymore, it's just scared) plus a
// wavy mouth, the same silhouette the arcade original uses to make
// "eatable right now" unmistakable at a glance.
function drawFrightenedFace(ctx, r) {
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r * 0.32, -r * 0.1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // A true quadratic bezier through each wave — Canvas 2D can stroke a
  // curve directly. gpu-shapes.js's wavyLinePoints has no curve primitive
  // to lean on, so it samples the same wave shape into discrete points
  // (via a sine, not a bezier) for strokePolyline to connect with straight
  // segments; close enough at this scale that the two look identical.
  ctx.strokeStyle = EYE_WHITE;
  ctx.lineWidth = r * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const waves = 4;
  const startX = -r * 0.65;
  const step = (r * 1.3) / waves;
  const baseY = r * 0.45;
  ctx.moveTo(startX, baseY);
  for (let i = 0; i < waves; i++) {
    const midX = startX + step * i + step / 2;
    const endX = startX + step * (i + 1);
    const peakY = i % 2 === 0 ? baseY - r * 0.22 : baseY + r * 0.1;
    ctx.quadraticCurveTo(midX, peakY, endX, baseY);
  }
  ctx.stroke();
}

function drawGhost(ctx, ghost, frightenedTimer) {
  const r = GHOST_RADIUS;
  ctx.save();
  ctx.translate(ghost.x, ghost.y);

  if (ghost.state === 'eaten') {
    // Eyes only — the body is "back at base" already, visually.
    drawEyes(ctx, r);
    ctx.restore();
    return;
  }

  if (ghost.state === 'frightened') {
    const flashing = frightenedTimer < FRIGHTENED_WARNING_TIME;
    const flashOn = flashing && Math.floor(frightenedTimer / FRIGHTENED_FLASH_INTERVAL) % 2 === 0;
    drawGhostBody(ctx, r, flashOn ? FRIGHTENED_FLASH_COLOR : FRIGHTENED_COLOR);
    drawFrightenedFace(ctx, r);
    ctx.restore();
    return;
  }

  drawGhostBody(ctx, r, ghost.color);
  drawEyes(ctx, r);
  ctx.restore();
}

function drawPlayer(ctx, player) {
  const r = PLAYER_RADIUS;
  const mouthAngle = 0.26 * Math.PI;
  // player.facing, not player.direction — direction goes null the instant
  // the player stops at a wall, which would otherwise snap the sprite to
  // face right (angle 0) regardless of which way it had actually been
  // walking. facing holds onto the last real direction instead, see
  // movement.js's setDirection.
  const rotation = DIRECTION_ANGLE[player.facing] ?? 0;

  // ctx.translate + ctx.rotate push onto Canvas 2D's transform stack, so
  // the mouth wedge below can be drawn once, centered at the origin,
  // facing right — the transform does the positioning and facing-direction
  // rotation. webgpu-renderer.js has no such transform stack (no uniform
  // to hold one), so its equivalent (pushPlayer) has to bake the rotation
  // directly into the wedge's angles before building any triangles.
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(rotation);
  ctx.fillStyle = '#ffd23b';
  ctx.beginPath();
  ctx.arc(0, 0, r, mouthAngle, Math.PI * 2 - mouthAngle);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function renderFrame(ctx, state) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawMazeStructure(ctx);
  drawPellets(ctx, state);
  drawPowerPellets(ctx, state);
  for (const ghost of state.ghosts) drawGhost(ctx, ghost, state.frightenedTimer);
  drawPlayer(ctx, state.player);
}
