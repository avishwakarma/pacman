// The WebGPU render pipeline: draws the maze (walls + letters from
// maze.js), pellets, ghosts, and the player every frame. Same visual
// language as the Canvas 2D renderer (render/canvas-renderer.js) — same
// colors, same shapes — but built from actual GPU-submitted triangles
// instead of Canvas 2D path calls, using the pure-math shape builders in
// utils/gpu-shapes.js.
//
// Everything is one vertex format — interleaved (x, y, r, g, b, a) floats
// — drawn by one pipeline (triangle-list, alpha-blended). There are two
// vertex buffers:
//   - a STATIC one for the maze structure (border, wall blocks, ghost pen,
//     letters), built once in initRenderer and never touched again — none
//     of that geometry changes frame to frame.
//   - a DYNAMIC one for everything that moves or changes (pellets, power
//     pellets, ghosts, the player), rebuilt from the live game state and
//     re-uploaded every frame.
// Both draw with the same pipeline in the same render pass, static first
// so the dynamic layer draws on top.

import { MAZE_WIDTH, MAZE_HEIGHT, GRID_STEP, BOUNDARY_POLYGON, WALL_RECTS, GHOST_PEN_POLYGON, LETTER_SHAPES, gridCellCenter } from '../game/maze.js';
import { FRIGHTENED_WARNING_TIME } from '../game/ghosts.js';
import {
  hexToRgba,
  rectTriangles,
  triangulateSimplePolygon,
  strokePolyline,
  circleTriangles,
  ellipseTriangles,
  wedgeTriangles,
  ghostBodyOutline,
  wavyLinePoints,
} from './utils/gpu-shapes.js';

// Radii, colors, timings below are deliberately kept in lockstep with
// canvas-renderer.js's own copies rather than imported/shared — each
// renderer file is meant to stand alone as "how do you draw this in this
// API", which only works if it isn't reaching into the other one.
const PLAYER_RADIUS = GRID_STEP * 0.4;
const GHOST_RADIUS = GRID_STEP * 0.4;
const PELLET_RADIUS = 4;
const POWER_PELLET_RADIUS = 9;

const BORDER_FILL = hexToRgba('#181818');
const WALL_STROKE = hexToRgba('#2f35aa');
const WALL_FILL = hexToRgba('#010549');
const PELLET_COLOR = hexToRgba('#ffc79a');
const POWER_PELLET_COLOR = hexToRgba('#ffd8b8');
const POWER_PELLET_GLOW = hexToRgba('#ffd8b8', 0.25);
const PLAYER_COLOR = hexToRgba('#ffd23b');
const EYE_WHITE = hexToRgba('#eef2ff');
const EYE_PUPIL = hexToRgba('#1b2350');
const FRIGHTENED_COLOR = hexToRgba('#2121ff');
const FRIGHTENED_FLASH_COLOR = hexToRgba('#ffffff');
const FRIGHTENED_FLASH_INTERVAL = 0.2;

const DIRECTION_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const FLOATS_PER_VERTEX = 6; // x, y, r, g, b, a

// MAZE_WIDTH/HEIGHT are spliced into the WGSL source as literal constants
// (not passed in via a uniform buffer) because they never change at
// runtime — the canvas is always exactly one maze's worth of pixels. That
// keeps the maze-units -> NDC conversion a plain per-vertex calculation
// with no uniform buffer, and no bind group, needed anywhere in this
// pipeline; see the `layout: 'auto'` pipeline below, which stays trivial
// as a result. Y is flipped (1.0 - ...) because maze-unit space has y
// growing downward (SVG/canvas convention, matching maze.js's coordinates)
// while WebGPU's NDC has y growing upward.
const VERTEX_SHADER_SOURCE = `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs_main(@location(0) pos: vec2f, @location(1) color: vec4f) -> VertexOut {
  var out: VertexOut;
  let ndcX = (pos.x / ${MAZE_WIDTH.toFixed(1)}) * 2.0 - 1.0;
  let ndcY = 1.0 - (pos.y / ${MAZE_HEIGHT.toFixed(1)}) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.color = color;
  return out;
}

// Flat pass-through: every vertex already carries its final color (see
// pushTriangles below), so there's no lighting, texturing, or per-fragment
// work to do — the rasterizer's own color interpolation across a triangle
// is all "shading" this scene needs.
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
`;

// Appends `triangles` (each [[x,y],[x,y],[x,y]]) to `out`, a plain JS array
// of floats, tagging every vertex with `color` ([r,g,b,a]). Building into a
// plain array first (not a typed array) keeps the shape builders simple —
// it only gets flattened into a Float32Array once, right before upload.
function pushTriangles(out, triangles, color, offsetX = 0, offsetY = 0) {
  for (const tri of triangles) {
    for (const [x, y] of tri) {
      out.push(x + offsetX, y + offsetY, color[0], color[1], color[2], color[3]);
    }
  }
}

function buildStaticMazeVertices() {
  const verts = [];

  const borderTris = triangulateSimplePolygon(BOUNDARY_POLYGON);
  pushTriangles(verts, borderTris, BORDER_FILL);
  pushTriangles(verts, strokePolyline(BOUNDARY_POLYGON, 5), WALL_STROKE);

  for (const rect of WALL_RECTS) {
    pushTriangles(verts, rectTriangles(rect.x, rect.y, rect.width, rect.height), WALL_FILL);
    pushTriangles(
      verts,
      strokePolyline(
        [
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x + rect.width, rect.y + rect.height],
          [rect.x, rect.y + rect.height],
          [rect.x, rect.y],
        ],
        5,
      ),
      WALL_STROKE,
    );
  }

  const penTris = triangulateSimplePolygon(GHOST_PEN_POLYGON);
  pushTriangles(verts, penTris, WALL_FILL);
  pushTriangles(verts, strokePolyline(GHOST_PEN_POLYGON, 5), WALL_STROKE);

  // Letters are stroke-only (see canvas-renderer.js's drawMazeStructure:
  // the fill is drawn black, which is indistinguishable from the canvas'
  // own clear color, so skipping the fill entirely looks identical without
  // needing a nonzero-winding triangulation across a letter's multiple
  // subpaths).
  for (const letter of LETTER_SHAPES) {
    const color = hexToRgba(letter.color);
    for (const subpath of letter.subpaths) {
      pushTriangles(verts, strokePolyline(subpath, 6), color);
    }
  }

  return verts;
}

function pushCircle(verts, cx, cy, radius, color) {
  pushTriangles(verts, circleTriangles(cx, cy, radius, 20), color);
}

function pushPellets(verts, state) {
  for (const key of state.pellets) {
    const [col, row] = key.split(',').map(Number);
    const [x, y] = gridCellCenter(col, row);
    pushCircle(verts, x, y, PELLET_RADIUS, PELLET_COLOR);
  }
}

function pushPowerPellets(verts, state) {
  for (const key of state.powerPellets) {
    const [col, row] = key.split(',').map(Number);
    const [x, y] = gridCellCenter(col, row);
    // A soft halo standing in for Canvas 2D's shadowBlur glow — a couple of
    // larger, low-alpha circles behind the solid pellet.
    pushCircle(verts, x, y, POWER_PELLET_RADIUS * 2.2, POWER_PELLET_GLOW);
    pushCircle(verts, x, y, POWER_PELLET_RADIUS * 1.5, POWER_PELLET_GLOW);
    pushCircle(verts, x, y, POWER_PELLET_RADIUS, POWER_PELLET_COLOR);
  }
}

function pushEyes(verts, cx, cy, r) {
  pushTriangles(verts, ellipseTriangles(cx - r * 0.35, cy - r * 0.2, r * 0.28, r * 0.34, 16), EYE_WHITE);
  pushTriangles(verts, ellipseTriangles(cx + r * 0.35, cy - r * 0.2, r * 0.28, r * 0.34, 16), EYE_WHITE);
  pushCircle(verts, cx - r * 0.3, cy - r * 0.15, r * 0.13, EYE_PUPIL);
  pushCircle(verts, cx + r * 0.4, cy - r * 0.15, r * 0.13, EYE_PUPIL);
}

function pushFrightenedFace(verts, cx, cy, r) {
  pushCircle(verts, cx - r * 0.32, cy - r * 0.1, r * 0.14, EYE_WHITE);
  pushCircle(verts, cx + r * 0.32, cy - r * 0.1, r * 0.14, EYE_WHITE);
  const mouth = wavyLinePoints(cx - r * 0.65, cx + r * 0.65, cy + r * 0.45, r * 0.22, r * 0.1, 4, 4);
  pushTriangles(verts, strokePolyline(mouth, r * 0.12), EYE_WHITE);
}

// Retriangulates ghostBodyOutline(r) from scratch for every ghost, every
// frame, even though every ghost shares the same radius and only its
// center/color differ — the offsetX/offsetY args to pushTriangles below
// already exist to place a shared shape at different centers without
// re-deriving its points. Caching one triangulated outline and reusing it
// per ghost would avoid the repeat ear-clipping work, but with at most a
// couple of ghosts on screen the redundant O(n^2) triangulation is well
// under budget, so it isn't worth the extra bookkeeping.
function pushGhost(verts, ghost, frightenedTimer) {
  const r = GHOST_RADIUS;
  if (ghost.state === 'eaten') {
    pushEyes(verts, ghost.x, ghost.y, r);
    return;
  }

  if (ghost.state === 'frightened') {
    const flashing = frightenedTimer < FRIGHTENED_WARNING_TIME;
    const flashOn = flashing && Math.floor(frightenedTimer / FRIGHTENED_FLASH_INTERVAL) % 2 === 0;
    const bodyColor = flashOn ? FRIGHTENED_FLASH_COLOR : FRIGHTENED_COLOR;
    const bodyTris = triangulateSimplePolygon(ghostBodyOutline(r));
    pushTriangles(verts, bodyTris, bodyColor, ghost.x, ghost.y);
    pushFrightenedFace(verts, ghost.x, ghost.y, r);
    return;
  }

  const bodyColor = hexToRgba(ghost.color);
  const bodyTris = triangulateSimplePolygon(ghostBodyOutline(r));
  pushTriangles(verts, bodyTris, bodyColor, ghost.x, ghost.y);
  pushEyes(verts, ghost.x, ghost.y, r);
}

// There's no per-draw transform to rotate the player with (no model matrix
// uniform — this pipeline has no bind group at all, see initRenderer) so
// facing direction is baked directly into the wedge's start/end angles
// before the triangles are ever built, unlike canvas-renderer.js's
// drawPlayer, which can just ctx.rotate() the canvas' transform stack.
function pushPlayer(verts, player) {
  // player.facing, not player.direction — see canvas-renderer.js's
  // drawPlayer for why (direction goes null the instant the player stops
  // at a wall, which would otherwise snap the sprite to face right).
  const rotation = DIRECTION_ANGLE[player.facing] ?? 0;
  const mouthAngle = 0.26 * Math.PI;
  const tris = wedgeTriangles(player.x, player.y, PLAYER_RADIUS, mouthAngle, rotation, 16);
  pushTriangles(verts, tris, PLAYER_COLOR);
}

function buildDynamicVertices(state) {
  const verts = [];
  pushPellets(verts, state);
  pushPowerPellets(verts, state);
  for (const ghost of state.ghosts) pushGhost(verts, ghost, state.frightenedTimer);
  pushPlayer(verts, state.player);
  return verts;
}

function createVertexBuffer(device, floatCount, label) {
  // Sized in floats, not bytes, so callers can reason in "how many floats
  // might this need" — usage COPY_DST so writeBuffer can refill it every
  // frame without recreating the buffer. The max(…, 1) matters when the
  // dynamic buffer is first created with nothing to put in it yet (see
  // dynamicBuffer below) — WebGPU rejects a zero-size buffer outright.
  const byteSize = Math.max(floatCount, 1) * 4;
  return device.createBuffer({
    label,
    size: byteSize,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

// `adapter` is a parameter, not requested here, because
// capability-check.js's checkWebGPUSupport() already had to request one to
// answer "is WebGPU usable at all" — requesting a second one would repeat
// that work and isn't guaranteed to hand back the same adapter.
export async function initRenderer(canvas, adapter) {
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('canvas.getContext("webgpu") returned null');

  canvas.width = MAZE_WIDTH;
  canvas.height = MAZE_HEIGHT;

  const format = navigator.gpu.getPreferredCanvasFormat();
  // alphaMode: 'opaque' governs how the canvas *element* composites over
  // the rest of the page, not blending within the scene — the pipeline's
  // own blend state below still handles translucent shapes (the power
  // pellet glow) layering over each other on the canvas. Opaque is right
  // here because every frame starts with a full-canvas clear (see
  // beginRenderPass below), so nothing behind the canvas element should
  // ever show through.
  context.configure({ device, format, alphaMode: 'opaque' });

  const shaderModule = device.createShaderModule({ code: VERTEX_SHADER_SOURCE });
  const pipeline = device.createRenderPipeline({
    // 'auto': this shader takes no uniforms or textures — every vertex is
    // self-contained (position + its own final color) — so there's nothing
    // for a bind group to carry, and no reason to hand-write an explicit
    // GPUBindGroupLayout that would just describe zero bindings.
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: FLOATS_PER_VERTEX * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position: 2 floats at the start
            { shaderLocation: 1, offset: 8, format: 'float32x4' }, // color: the next 4 floats (offset 8 = 2 * 4 bytes)
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          // Standard straight-alpha "over" blending, with the alpha channel
          // blended the same way so stacked translucent shapes (the power
          // pellet's layered glow circles) accumulate coverage correctly
          // instead of the top layer just overwriting the ones beneath it.
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    // No cullMode: both faces of every triangle draw regardless of winding
    // order. triangulateSimplePolygon does normalize its input to CCW, but
    // only because its ear-clipping math depends on winding, not because
    // anything here relies on face culling — there's no backface to hide
    // in a flat, top-down 2D scene.
    primitive: { topology: 'triangle-list' },
  });

  // The maze structure (border, walls, pen, letters) never changes after
  // startup, so it's built and uploaded exactly once here, not every frame
  // like the dynamic layer below.
  const staticVertices = buildStaticMazeVertices();
  const staticBuffer = createVertexBuffer(device, staticVertices.length, 'maze-static');
  device.queue.writeBuffer(staticBuffer, 0, new Float32Array(staticVertices));
  const staticVertexCount = staticVertices.length / FLOATS_PER_VERTEX;

  // Starts at capacity 1 (the smallest legal buffer) and grows on demand —
  // see getDynamicBuffer below — rather than pre-sizing for a worst-case
  // vertex count that would be pure guesswork this early.
  let dynamicBuffer = createVertexBuffer(device, 1, 'maze-dynamic');
  let dynamicBufferFloatCapacity = 1;

  return {
    device,
    context,
    pipeline,
    staticBuffer,
    staticVertexCount,
    // Grows the dynamic buffer only when the current frame's vertex data
    // won't fit, and grows with 50% headroom (not exactly to floatCount)
    // so a vertex count that hovers near a threshold — e.g. ghosts
    // flickering in and out of frightened mode, changing triangle counts —
    // doesn't reallocate a GPU buffer on every single frame. It never
    // shrinks back down, trading a little memory for that stability.
    getDynamicBuffer(floatCount) {
      if (floatCount > dynamicBufferFloatCapacity) {
        dynamicBuffer.destroy();
        dynamicBufferFloatCapacity = Math.ceil(floatCount * 1.5);
        dynamicBuffer = createVertexBuffer(device, dynamicBufferFloatCapacity, 'maze-dynamic');
      }
      return dynamicBuffer;
    },
  };
}

export function renderFrameGPU(renderer, state) {
  const { device, context, pipeline, staticBuffer, staticVertexCount } = renderer;

  // The whole dynamic layer — pellets, ghosts, the player — is rebuilt
  // from scratch every frame rather than updated in place. There's no
  // per-entity vertex tracking to maintain (an eaten pellet just isn't
  // pushed next frame; a ghost's triangle count can change frame to frame
  // as its state changes), at the cost of redoing this work 60 times a
  // second — fine at this vertex count, and much simpler than a persistent
  // per-entity buffer layout would be.
  const dynamicVertices = buildDynamicVertices(state);
  const dynamicFloatArray = new Float32Array(dynamicVertices);
  const dynamicBuffer = renderer.getDynamicBuffer(dynamicFloatArray.length);
  // Guards the (currently impossible, since the player alone always draws
  // something) case of a completely empty dynamic layer — writeBuffer with
  // zero bytes is unnecessary work at best and worth avoiding on principle.
  if (dynamicFloatArray.length > 0) device.queue.writeBuffer(dynamicBuffer, 0, dynamicFloatArray);
  const dynamicVertexCount = dynamicFloatArray.length / FLOATS_PER_VERTEX;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });

  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, staticBuffer);
  pass.draw(staticVertexCount);
  if (dynamicVertexCount > 0) {
    pass.setVertexBuffer(0, dynamicBuffer);
    pass.draw(dynamicVertexCount);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
}
