// Pure geometry helpers for the WebGPU renderer: turn the maze's polygon
// data (rects, simple polygons, closed letter outlines) and the game's
// circles/wedges (pellets, ghosts, the player) into flat triangle lists
// WebGPU can draw directly. No WebGPU API calls live here on purpose — this
// is plain math, so it can be (and was) unit-tested with a plain Node
// script instead of a real GPU.
//
// Every shape function returns an array of triangles, each triangle an
// array of 3 [x, y] points in maze-unit space. webgpu-renderer.js is the
// layer that turns that + a color into the actual interleaved vertex data
// (see its pushTriangles) and uploads it — this file never touches a
// GPUDevice, GPUBuffer, or any other WebGPU object.

export function hexToRgba(hex, alpha = 1) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

export function rectTriangles(x, y, width, height) {
  const a = [x, y];
  const b = [x + width, y];
  const c = [x + width, y + height];
  const d = [x, y + height];
  return [
    [a, b, c],
    [a, c, d],
  ];
}

// Shoelace formula. Sign alone tells winding direction (positive = CCW,
// negative = CW) — that's all triangulateSimplePolygon needs it for, to
// normalize input to CCW before the ear test below (which assumes CCW).
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function isConvex(a, b, c) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return cross > 0; // polygon is normalized to CCW before this is called
}

// Which side of the line p1->p2 the point p3 falls on (sign of the cross
// product) — the building block for the standard "same side of all three
// edges" point-in-triangle test below.
function sign(p1, p2, p3) {
  return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
}

// True if p is inside (or on the boundary of) triangle abc: p is "inside"
// exactly when it's not simultaneously on the positive side of one edge and
// the negative side of another — i.e. all three edge tests agree in sign.
function pointInTriangle(p, a, b, c) {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Ear-clipping triangulation for a single simple (non-self-intersecting)
// polygon with no holes — exactly what the maze's border and ghost-pen
// outlines are. O(n^2), which is plenty fast for polygons this size (a few
// dozen points).
export function triangulateSimplePolygon(points) {
  let poly = points.slice();
  const first = poly[0];
  const last = poly[poly.length - 1];
  if (poly.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    poly = poly.slice(0, -1);
  }
  if (poly.length < 3) return [];
  if (signedArea(poly) < 0) poly.reverse(); // ear test below assumes CCW

  const indices = poly.map((_, i) => i);
  const triangles = [];
  // guard is a safety valve, not an expected limit: every polygon this
  // renders (maze border, ghost pen, a ghost body) clips out in well under
  // 100 iterations. It exists so a future degenerate/malformed polygon
  // fails soft — fewer triangles drawn — instead of hanging a frame.
  let guard = 0;
  while (indices.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const iPrev = indices[(i - 1 + indices.length) % indices.length];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % indices.length];
      const a = poly[iPrev];
      const b = poly[iCurr];
      const c = poly[iNext];
      if (!isConvex(a, b, c)) continue;

      let containsOther = false;
      for (const j of indices) {
        if (j === iPrev || j === iCurr || j === iNext) continue;
        if (pointInTriangle(poly[j], a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push([a, b, c]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input; keep whatever we already have
  }
  if (indices.length === 3) {
    triangles.push([poly[indices[0]], poly[indices[1]], poly[indices[2]]]);
  }
  return triangles;
}

// A square, axis-aligned regardless of the line's own direction — covers
// the gap a thick line's rectangle body leaves at each vertex where two
// segments meet at an angle. See strokePolyline below for why square (not
// mitered or round) caps are the right choice here.
function squareCap(center, halfWidth) {
  const [cx, cy] = center;
  const a = [cx - halfWidth, cy - halfWidth];
  const b = [cx + halfWidth, cy - halfWidth];
  const c = [cx + halfWidth, cy + halfWidth];
  const d = [cx - halfWidth, cy + halfWidth];
  return [
    [a, b, c],
    [a, c, d],
  ];
}

// Thick-line stroke along a polyline (open or already-closed — a closed
// ring works fine since the last point duplicating the first just draws a
// zero-length final segment, which is harmless). Every letter subpath and
// the border/pen outlines are entirely axis-aligned, so a square cap at
// every vertex is enough to cover the joints cleanly — the equivalent of a
// miter join, with none of miter's blow-up risk on sharp non-right angles
// (nothing in this maze has one).
export function strokePolyline(points, width) {
  const halfWidth = width / 2;
  const triangles = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * halfWidth;
    const ny = (dx / length) * halfWidth;
    const p1a = [x1 + nx, y1 + ny];
    const p1b = [x1 - nx, y1 - ny];
    const p2a = [x2 + nx, y2 + ny];
    const p2b = [x2 - nx, y2 - ny];
    triangles.push([p1a, p1b, p2a], [p1b, p2b, p2a]);
    triangles.push(...squareCap([x1, y1], halfWidth));
  }
  if (points.length > 0) triangles.push(...squareCap(points[points.length - 1], halfWidth));
  return triangles;
}

// A fan of triangles across an arbitrary angle range — full circles use
// endAngle - startAngle = 2*PI, but this is also what draws the player's
// mouth wedge (a circle with a slice missing) and a ghost's rounded dome.
export function arcFan(cx, cy, radius, startAngle, endAngle, segments = 20) {
  const triangles = [];
  const step = (endAngle - startAngle) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = startAngle + step * i;
    const a1 = startAngle + step * (i + 1);
    triangles.push([
      [cx, cy],
      [cx + radius * Math.cos(a0), cy + radius * Math.sin(a0)],
      [cx + radius * Math.cos(a1), cy + radius * Math.sin(a1)],
    ]);
  }
  return triangles;
}

export function circleTriangles(cx, cy, radius, segments = 20) {
  return arcFan(cx, cy, radius, 0, Math.PI * 2, segments);
}

// Doesn't reuse arcFan: arcFan's single `radius` scales x and y together,
// which can't produce an ellipse's independent rx/ry, so this repeats the
// same fan-triangulation loop with per-axis scaling instead.
export function ellipseTriangles(cx, cy, rx, ry, segments = 16) {
  const triangles = [];
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = step * i;
    const a1 = step * (i + 1);
    triangles.push([
      [cx, cy],
      [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)],
      [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)],
    ]);
  }
  return triangles;
}

// The classic Pacman body: a circle with a wedge missing for the mouth,
// same as arcFan(cx, cy, r, mouthAngle, 2*PI - mouthAngle) but named for
// clarity at the call site.
export function wedgeTriangles(cx, cy, radius, mouthAngle, rotation, segments = 16) {
  return arcFan(cx, cy, radius, mouthAngle + rotation, Math.PI * 2 - mouthAngle + rotation, segments);
}

// A ghost's silhouette — rounded dome on top, scalloped (wavy) flat bottom
// — as one ordered boundary ring, matching the path canvas-renderer.js
// draws with ctx.arc + explicit lineTo's for the scallops. Traced as a
// simple polygon (it is one — the scallop zigzag never crosses itself) so
// triangulateSimplePolygon can turn it into a fill regardless of whether
// it's convex, instead of assuming it's neatly fan-triangulable from one
// center point.
export function ghostBodyOutline(radius, domeSegments = 12) {
  const r = radius;
  const points = [];
  const domeCenter = [0, -r * 0.1];
  for (let i = 0; i <= domeSegments; i++) {
    const angle = Math.PI + (Math.PI * i) / domeSegments; // sweeps through the top
    points.push([domeCenter[0] + r * Math.cos(angle), domeCenter[1] + r * Math.sin(angle)]);
  }
  points.push([r, r * 0.7]);
  const scallops = 4;
  const step = (2 * r) / scallops;
  for (let i = 0; i < scallops; i++) {
    const outerX = r - step * i;
    const midX = outerX - step / 2;
    points.push([midX, r * 0.35]);
    points.push([outerX - step, r * 0.7]);
  }
  return points;
}

// A wavy horizontal line (the frightened-ghost mouth) as a stroke-ready
// point list, matching canvas-renderer.js's quadratic-curve mouth closely
// enough at this scale (sampled, not curved, but the same silhouette).
export function wavyLinePoints(startX, endX, baseY, peakUp, peakDown, waves = 4, samplesPerWave = 4) {
  const points = [];
  const totalWidth = endX - startX;
  const step = totalWidth / waves;
  for (let w = 0; w < waves; w++) {
    const peak = w % 2 === 0 ? baseY - peakUp : baseY + peakDown;
    for (let s = 0; s <= samplesPerWave; s++) {
      const t = s / samplesPerWave;
      const x = startX + step * w + step * t;
      // simple sine-shaped bump between baseY (at t=0/1) and peak (at t=0.5)
      const y = baseY + (peak - baseY) * Math.sin(Math.PI * t);
      points.push([x, y]);
    }
  }
  return points;
}
