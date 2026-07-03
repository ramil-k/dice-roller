// Mathematical 3D geometry for polyhedral dice, rendered with pure CSS
// `transform: matrix3d(...)` planes. No WebGL, no dependencies.
//
// For each supported die we build a set of triangular or polygonal faces. Each
// face is a flat CSS element placed in 3D by a 4x4 matrix that:
//   1. orients a unit face (lying in the XY plane, centered at origin) so its
//      outward normal matches the polyhedron face normal, and
//   2. translates it outward to the face's distance from the solid's center
//      (the inradius), scaled to the die's pixel size.
//
// We also expose, per face, the outward normal so the renderer can compute a
// settle rotation that turns a chosen face toward the camera (+Z).
//
// Everything here is pure math over Float arrays; it is DOM-free and unit
// tested. The renderer in roll-dice.js consumes `buildPolyhedron(sides)`.

// ----- tiny vec3 / quaternion helpers -------------------------------------

const v = (x, y, z) => [x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function normalize(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function centroid(points) {
  const s = points.reduce((acc, p) => add(acc, p), [0, 0, 0]);
  return scale(s, 1 / points.length);
}

// Rotation matrix (row-major 3x3, as flat 9) that maps unit vector `from` to
// unit vector `to`. Uses the shortest-arc (Rodrigues) rotation.
function rotationBetween(from, to) {
  const f = normalize(from);
  const t = normalize(to);
  const c = dot(f, t);
  if (c > 0.999999) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; // already aligned
  if (c < -0.999999) {
    // 180°: rotate about any axis orthogonal to f.
    let axis = cross(f, v(1, 0, 0));
    if (len(axis) < 1e-6) axis = cross(f, v(0, 1, 0));
    return axisAngleMatrix(normalize(axis), Math.PI);
  }
  const axis = normalize(cross(f, t));
  const angle = Math.acos(Math.max(-1, Math.min(1, c)));
  return axisAngleMatrix(axis, angle);
}

function axisAngleMatrix(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

// Apply a 3x3 row-major matrix to a vector.
function applyMat(rot, p) {
  return [
    rot[0] * p[0] + rot[1] * p[1] + rot[2] * p[2],
    rot[3] * p[0] + rot[4] * p[1] + rot[5] * p[2],
    rot[6] * p[0] + rot[7] * p[1] + rot[8] * p[2],
  ];
}

// ----- polyhedron vertex/face definitions ---------------------------------

// Each generator returns { vertices: [v3...], faces: [[vertexIndex...]...] }.
// Coordinates are unit-ish (centered at origin); we normalize scale later.

const PHI = (1 + Math.sqrt(5)) / 2;

function tetrahedron() {
  const vertices = [v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)];
  const faces = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  return { vertices, faces };
}

function cube() {
  const vertices = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push(v(x, y, z));
  // index = ((x==1)<<2)|((y==1)<<1)|(z==1)
  const idx = (x, y, z) => ((x > 0 ? 4 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 1 : 0));
  const faces = [
    [idx(1, -1, -1), idx(1, 1, -1), idx(1, 1, 1), idx(1, -1, 1)], // +X
    [idx(-1, -1, 1), idx(-1, 1, 1), idx(-1, 1, -1), idx(-1, -1, -1)], // -X
    [idx(-1, 1, -1), idx(-1, 1, 1), idx(1, 1, 1), idx(1, 1, -1)], // +Y
    [idx(-1, -1, 1), idx(-1, -1, -1), idx(1, -1, -1), idx(1, -1, 1)], // -Y
    [idx(-1, -1, 1), idx(1, -1, 1), idx(1, 1, 1), idx(-1, 1, 1)], // +Z
    [idx(1, -1, -1), idx(-1, -1, -1), idx(-1, 1, -1), idx(1, 1, -1)], // -Z
  ];
  return { vertices, faces };
}

function octahedron() {
  const vertices = [
    v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1),
  ];
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  return { vertices, faces };
}

function dodecahedron() {
  const p = PHI;
  const ip = 1 / PHI;
  // 20 vertices: the 8 cube corners (±1,±1,±1) plus the 12 rectangle vertices
  // (0, ±1/φ, ±φ) and cyclic permutations.
  const verts = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push(v(x, y, z));
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    verts.push(v(0, s * ip, t * p));
    verts.push(v(s * ip, t * p, 0));
    verts.push(v(s * p, 0, t * ip));
  }

  // Detect the 12 pentagonal faces from edge adjacency (edge length 2/φ).
  const faces = facesByCoplanarity(verts, (2 / PHI) * (1 / 1), 5);
  return { vertices: verts, faces };
}

// Generic planar-face detector for a convex solid centered at origin. Builds an
// adjacency graph from the given edge length, then for each vertex + two of its
// neighbours defines a face plane and gathers every vertex lying on it. Returns
// deduplicated, outward-CCW-ordered faces of exactly `faceSize` vertices.
function facesByCoplanarity(verts, edge, faceSize) {
  const eps = edge * 0.06;
  const near = (a, b) => Math.abs(len(sub(verts[a], verts[b])) - edge) < eps;
  const n = verts.length;
  const adj = verts.map((_, i) => {
    const ns = [];
    for (let j = 0; j < n; j++) if (j !== i && near(i, j)) ns.push(j);
    return ns;
  });

  const seen = new Set();
  const faces = [];
  for (let a = 0; a < n; a++) {
    for (const b of adj[a]) {
      // Face plane through a and two of a's neighbours (b and another).
      for (const c of adj[a]) {
        if (c === b) continue;
        const center = normalize(centroid([verts[a], verts[b], verts[c]]));
        // Gather all vertices coplanar with this face plane (same signed
        // distance along the plane normal). The plane normal is the direction
        // from the solid center to the face; approximate via these 3 points.
        const nrm = planeNormal(verts[a], verts[b], verts[c]);
        const facing = dot(nrm, verts[a]) < 0 ? scale(nrm, -1) : nrm;
        const d0 = dot(verts[a], facing);
        const onPlane = [];
        for (let k = 0; k < n; k++) {
          if (Math.abs(dot(verts[k], facing) - d0) < eps) onPlane.push(k);
        }
        if (onPlane.length !== faceSize) continue;
        const key = [...onPlane].sort((x, y) => x - y).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(orderRing(onPlane, verts, centroid(onPlane.map((i) => verts[i]))));
      }
    }
  }
  return faces;
}

// Unit normal of the plane through three points.
function planeNormal(a, b, c) {
  return normalize(cross(sub(b, a), sub(c, a)));
}

function icosahedron() {
  const p = PHI;
  const verts = [];
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    verts.push(v(0, s, t * p));
    verts.push(v(s, t * p, 0));
    verts.push(v(s * p, 0, t));
  }
  // 20 triangular faces: every triple of mutually-adjacent vertices (edge
  // length 2). Detect by nearest neighbours.
  const faces = trianglesFromVertices(verts, 2.0);
  return { vertices: verts, faces };
}

// Pentagonal trapezohedron (the classic d10): two offset pentagonal rings of
// vertices plus two apexes, giving 10 kite faces.
function trapezohedron10() {
  const verts = [];
  const n = 5;
  const zTop = 0.35;
  const r = 1;
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    verts.push(v(r * Math.cos(a), r * Math.sin(a), zTop)); // upper ring
  }
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n + Math.PI / n;
    verts.push(v(r * Math.cos(a), r * Math.sin(a), -zTop)); // lower ring (offset)
  }
  const apexTop = verts.push(v(0, 0, 1.4)) - 1;
  const apexBot = verts.push(v(0, 0, -1.4)) - 1;
  const faces = [];
  for (let i = 0; i < n; i++) {
    const u0 = i;
    const u1 = (i + 1) % n;
    const l = n + i;
    const lPrev = n + ((i + n - 1) % n);
    // Kite: apexTop, upperRing[i], lowerRing[i], upperRing[i+1]
    faces.push([apexTop, u0, l, u1]);
    // Kite on the bottom: apexBot, lowerRing[i], upperRing[i], lowerRing[i-1]
    faces.push([apexBot, l, u0, lPrev]);
  }
  return { vertices: verts, faces };
}

// Order a set of vertex indices into a ring around face center `c` (CCW when
// viewed from outside), so the polygon is drawn without self-intersection.
function orderRing(indices, verts, center) {
  const c = normalize(center);
  // Build a basis in the face plane.
  let ref = sub(verts[indices[0]], scale(c, dot(verts[indices[0]], c)));
  ref = normalize(ref);
  const up = cross(c, ref);
  const angleOf = (i) => {
    const proj = sub(verts[i], scale(c, dot(verts[i], c)));
    return Math.atan2(dot(proj, up), dot(proj, ref));
  };
  return [...indices].sort((a, b) => angleOf(a) - angleOf(b));
}

// Find all triangles whose three vertices are pairwise at (approximately) the
// given edge length — used for the icosahedron.
function trianglesFromVertices(verts, edge) {
  const eps = edge * 0.08;
  const near = (a, b) => Math.abs(len(sub(verts[a], verts[b])) - edge) < eps;
  const faces = [];
  const n = verts.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++) {
        if (near(a, b) && near(b, c) && near(a, c)) {
          faces.push(orientTriangle([a, b, c], verts));
        }
      }
  return faces;
}

// Ensure a triangle's winding is CCW as seen from outside (normal points away
// from the solid's center at origin).
function orientTriangle(tri, verts) {
  const [a, b, c] = tri;
  const nrm = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
  const cen = centroid([verts[a], verts[b], verts[c]]);
  if (dot(nrm, cen) < 0) return [a, c, b];
  return tri;
}

// ----- assemble a renderable polyhedron -----------------------------------

const GENERATORS = {
  4: tetrahedron,
  6: cube,
  8: octahedron,
  10: trapezohedron10,
  12: dodecahedron,
  20: icosahedron,
};

// Build a projection-ready description of a die:
//   {
//     vertices: [ [x,y,z], ... ],                     // normalized (circumradius 1)
//     faces: [ { indices, normal, center }, ... ]     // one per face
//   }
// `indices` lists the face's vertices in outward-CCW order; `normal` is the
// outward unit normal; `center` is the face centroid. The SVG renderer projects
// these vertices to 2D, culls back faces, shades by normal, and draws numbers.
export function buildPolyhedron(sides) {
  const gen = GENERATORS[sides];
  if (!gen) return null;
  const { vertices, faces } = gen();

  // Normalize so the circumradius is 1.
  const maxR = Math.max(...vertices.map(len));
  const nverts = vertices.map((p) => scale(p, 1 / maxR));

  const outFaces = faces.map((indices) => {
    const pts = indices.map((i) => nverts[i]);
    const center = centroid(pts);
    return { indices, center, normal: normalize(center) };
  });

  return { vertices: nverts, faces: outFaces };
}

// Per-die viewing tilt (degrees). After the result face is turned toward the
// camera, we tip the solid so it reads as a 3D volume rather than a flat face.
// The tilt is a top-down look — mostly about X (camera looks down at the die,
// revealing the top faces) with only a slight Y turn for dimensionality. Dice
// with more, closer-spaced faces (d20) tolerate less tilt before a neighbour
// face would out-face the result — the "front-most" test enforces the result
// face stays foremost for every value.
const VIEW_TILT = { 4: 34, 6: 30, 8: 24, 10: 20, 12: 22, 20: 15 };
const DEFAULT_TILT = 16;

// Row-major 3x3 rotation that turns `normal` toward the camera (+Z), adds a
// per-value in-plane spin, then applies the per-die top-down viewing tilt.
// Returned as a matrix the SVG renderer applies to every vertex before
// projecting.
export function settleRotation(normal, spinExtra = 0, sides = 0) {
  const t = VIEW_TILT[sides] ?? DEFAULT_TILT;
  const rot = rotationBetween(normal, v(0, 0, 1)); // square face to camera
  const spin = axisAngleMatrix(v(0, 0, 1), (spinExtra * Math.PI) / 180);
  // Top-down: tip the top of the die toward the viewer (negative X), with a
  // small Y turn so it isn't perfectly symmetric.
  const tiltX = axisAngleMatrix(v(1, 0, 0), (-t * Math.PI) / 180);
  const tiltY = axisAngleMatrix(v(0, 1, 0), (0.25 * t * Math.PI) / 180);
  return mul3(tiltY, mul3(tiltX, mul3(spin, rot)));
}

// Multiply two row-major 3x3 matrices.
export function mul3(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

// Apply a row-major 3x3 matrix to a vec3.
export function apply3(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}

// Exposed for tests.
export const _internal = {
  rotationBetween,
  axisAngleMatrix,
  applyMat,
  normalize,
  centroid,
  GENERATORS,
};
