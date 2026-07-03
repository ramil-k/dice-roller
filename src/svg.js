// SVG renderer for 3D polyhedral dice.
//
// We already have correct 3D geometry (geometry.js). To draw a die we:
//   1. rotate every vertex by the settle rotation (result face toward camera,
//      at a natural 3/4 tilt),
//   2. project to 2D with a light perspective divide,
//   3. keep only front-facing faces (outward normal has +Z after rotation),
//   4. sort those back-to-front (painter's algorithm) and emit one <polygon>
//      per face, shaded by the face normal against a fixed light,
//   5. draw the face number at each visible face's projected centroid, with the
//      result face brightest/largest.
//
// Output is an <svg> element. No DOM measurement, no dependencies.

import { buildPolyhedron, settleRotation, apply3 } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Fixed light direction (from upper-front-right), normalized.
const LIGHT = (() => {
  const l = [0.4, 0.7, 0.9];
  const m = Math.hypot(...l);
  return [l[0] / m, l[1] / m, l[2] / m];
})();

// Perspective camera: viewer at z = +CAM looking toward -Z. A larger CAM is
// closer to orthographic (less exaggeration of the near/top face). Vertices
// live in a unit sphere (radius 1).
const CAM = 8;

const polyCache = new Map();
function getPoly(sides) {
  if (!polyCache.has(sides)) polyCache.set(sides, buildPolyhedron(sides));
  return polyCache.get(sides);
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Project a rotated 3D point (unit-sphere space) to 2D pixel coords in a
// viewBox of [-R, R]. Applies a mild perspective divide.
const SCALE = 0.9; // fill factor within the viewBox
function project(p, R) {
  const denom = CAM - p[2];
  const f = CAM / denom; // >1 for points nearer the camera
  return [p[0] * f * R * SCALE, -p[1] * f * R * SCALE]; // y flips (screen down)
}

// Build the SVG for one rolled die.
//   sides   : die type (4,6,8,10,12,20)
//   value   : rolled value (1..sides), placed on the result face
//   tint    : base fill color (hex)
//   spin    : in-plane spin degrees for per-die variety
// Returns an <svg> element, or null if the die type has no solid.
export function buildDieSVG(sides, value, tint, spin = 0) {
  const poly = getPoly(sides);
  if (!poly) return null;

  const R = 100; // viewBox half-extent
  const svg = svgEl('svg', {
    viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`,
    width: '100%',
    height: '100%',
  });

  const rot = settleRotation(poly.faces[0].normal, spin, sides);

  // Rotate all vertices and all face normals once.
  const rv = poly.vertices.map((p) => apply3(rot, p));

  // Assign face numbers: result value on face 0, the rest fill 1..sides.
  const others = [];
  for (let n = 1; n <= sides; n++) if (n !== value) others.push(n);
  const faceNumbers = [value, ...others];

  // Compute per-face data: rotated normal, projected centroid, depth.
  const faces = poly.faces.map((f, i) => {
    const rn = apply3(rot, f.normal);
    const rc = apply3(rot, f.center);
    const pts2d = f.indices.map((vi) => project(rv[vi], R));
    const cx = pts2d.reduce((s, p) => s + p[0], 0) / pts2d.length;
    const cy = pts2d.reduce((s, p) => s + p[1], 0) / pts2d.length;
    return {
      i,
      number: faceNumbers[i],
      normalZ: rn[2],
      light: Math.max(0, rn[0] * LIGHT[0] + rn[1] * LIGHT[1] + rn[2] * LIGHT[2]),
      depth: rc[2],
      pts2d,
      cx,
      cy,
      isResult: i === 0,
    };
  });

  // Front-facing only (rotated normal points toward camera). Sort back-to-front
  // so nearer faces paint last (painter's algorithm).
  const visible = faces
    .filter((f) => f.normalZ > 0.001)
    .sort((a, b) => a.depth - b.depth);

  for (const f of visible) {
    // Shade: ambient + diffuse. Result face gets a small brightness boost.
    const shade = 0.4 + 0.6 * f.light + (f.isResult ? 0.08 : 0);
    const fill = shadeColor(tint, Math.min(1.15, shade));
    const points = f.pts2d.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
    svg.appendChild(
      svgEl('polygon', {
        points,
        fill,
        stroke: 'rgba(0,0,0,0.55)',
        'stroke-width': 1.5,
        'stroke-linejoin': 'round',
      })
    );

    // Number: draw on faces that are reasonably front-facing so back-side
    // numbers don't clutter. Result face always drawn, larger and brighter.
    if (f.isResult || f.normalZ > 0.35) {
      const size = f.isResult ? 46 : 26;
      const opacity = f.isResult ? 1 : 0.55;
      const t = svgEl('text', {
        x: f.cx.toFixed(2),
        y: f.cy.toFixed(2),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': 'system-ui, sans-serif',
        'font-weight': '800',
        'font-size': size,
        fill: '#f7f8fa',
        opacity,
        style: 'paint-order:stroke;stroke:rgba(0,0,0,0.5);stroke-width:3px',
      });
      t.textContent = String(f.number);
      svg.appendChild(t);
    }
  }

  return svg;
}

// Multiply a hex color's RGB by `factor` (clamped), returning an rgb() string.
function shadeColor(hex, factor) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const c = (x) => Math.round(Math.max(0, Math.min(255, x * factor)));
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
}
