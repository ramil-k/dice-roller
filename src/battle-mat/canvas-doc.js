// JSON Canvas 1.0 document model for the battle mat (https://jsoncanvas.org/spec/1.0/).
//
// Every battle-mat entity is a spec-valid node of an *official* type, so a
// `.canvas` export opens in any conforming tool (Obsidian etc.). Battle-mat
// semantics live in an `x-battleMat` extension property — conforming readers
// preserve unknown properties, while unknown node *types* may be rejected,
// which is why we never invent our own `type` values:
//   token  → type "link"  (url = avatar image URL, possibly a data URI)
//   image  → type "link"  (url = attached map image as a data URI)
//   stroke → type "text"  (empty text; x/y/width/height = bounding box, the
//                          geometry itself sits in x-battleMat.points relative
//                          to the node origin so moving the node moves the ink)
// Grid and viewport settings ride in a top-level `x-battleMat` key so an
// exported map round-trips together with its grid alignment.
//
// This module is DOM-free and covered by test/battle-mat-canvas-doc.test.js.

export const EXT = 'x-battleMat';

// Spec preset colors "1"-"6" (red, orange, yellow, green, cyan, purple). The
// spec names the hues but not exact values; these are our rendering choices.
const PRESET_COLORS = {
  1: '#e0464c',
  2: '#e07d34',
  3: '#dfb339',
  4: '#3aa858',
  5: '#39b3c8',
  6: '#8a63d2',
};

export const DEFAULT_GRID = {
  cellSize: 64,
  visible: true,
  snap: true,
  offsetX: 0,
  offsetY: 0,
  feetPerCell: 5,
};

export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export function defaultExt() {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    viewport: { ...DEFAULT_VIEWPORT },
  };
}

export function emptyDoc() {
  return { nodes: [], edges: [], [EXT]: defaultExt() };
}

// Extension accessor that tolerates docs imported from other tools (missing or
// partial x-battleMat): always returns a complete grid + viewport, writing the
// merged object back onto the doc so later mutations stick.
export function getExt(doc) {
  const ext = doc[EXT] ?? {};
  doc[EXT] = {
    version: ext.version ?? 1,
    grid: { ...DEFAULT_GRID, ...(ext.grid ?? {}) },
    viewport: { ...DEFAULT_VIEWPORT, ...(ext.viewport ?? {}) },
  };
  return doc[EXT];
}

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Map a spec color (hex string or preset "1"-"6") to a renderable hex value.
export function resolveColor(color, fallback = '#8a94ab') {
  if (typeof color !== 'string' || color === '') return fallback;
  if (color.startsWith('#')) return color;
  return PRESET_COLORS[color] ?? fallback;
}

const round = (n) => Math.round(n);

export function makeToken({ x, y, size = 64, url, name = '', source = 'roster', tokenKind = 'player', color }) {
  const node = {
    id: newId(),
    type: 'link',
    x: round(x),
    y: round(y),
    width: round(size),
    height: round(size),
    url,
    [EXT]: { kind: 'token', name, source, tokenKind },
  };
  if (color) node.color = color;
  return node;
}

export function makeImage({ x, y, width, height, url }) {
  return {
    id: newId(),
    type: 'link',
    x: round(x),
    y: round(y),
    width: Math.max(1, round(width)),
    height: Math.max(1, round(height)),
    url,
    [EXT]: { kind: 'image' },
  };
}

// Build a stroke/shape node from absolute world-coordinate points. For pen and
// line the point list is the geometry; for rect/ellipse the two points are
// opposite corners and the node's own box is the shape. Points are stored
// relative to the node origin so `moveNode` drags the whole drawing.
export function makeStroke({ shape = 'pen', points, color = '#e0464c', strokeWidth = 3 }) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const x = round(minX);
  const y = round(minY);
  return {
    id: newId(),
    type: 'text',
    text: '',
    x,
    y,
    width: Math.max(1, round(maxX - minX)),
    height: Math.max(1, round(maxY - minY)),
    color,
    [EXT]: {
      kind: 'stroke',
      shape,
      points: points.map(([px, py]) => [round(px - x), round(py - y)]),
      strokeWidth,
    },
  };
}

// Convenience readers used by rendering and tools. `nodeKind` returns the
// battle-mat kind or null for foreign nodes (kept for round-tripping).
export function nodeKind(node) {
  const kind = node?.[EXT]?.kind;
  return kind === 'token' || kind === 'image' || kind === 'stroke' ? kind : null;
}

export function addNode(doc, node) {
  doc.nodes.push(node);
  return node;
}

export function removeNode(doc, id) {
  const i = doc.nodes.findIndex((n) => n.id === id);
  if (i === -1) return false;
  doc.nodes.splice(i, 1);
  return true;
}

export function getNode(doc, id) {
  return doc.nodes.find((n) => n.id === id) ?? null;
}

export function moveNode(doc, id, x, y) {
  const node = getNode(doc, id);
  if (!node) return false;
  node.x = round(x);
  node.y = round(y);
  return true;
}

// Topmost node whose bounding box contains the world point, preferring tokens
// over strokes over images (matching the visual layer order), and later nodes
// over earlier ones within a kind (spec: last node paints on top).
export function nodeAt(doc, x, y) {
  for (const kind of ['token', 'stroke', 'image']) {
    for (let i = doc.nodes.length - 1; i >= 0; i--) {
      const n = doc.nodes[i];
      if (nodeKind(n) !== kind) continue;
      if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) return n;
    }
  }
  return null;
}

// Validate a parsed JSON value as a canvas document. Lenient by design: only
// the structural minimum is enforced (nodes array; per node a string id and
// finite geometry). Unknown node types/properties and all edges are preserved
// verbatim so foreign `.canvas` files survive an import → export round trip.
export function validateCanvas(json) {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'not an object' };
  }
  const nodes = json.nodes ?? [];
  if (!Array.isArray(nodes)) return { ok: false, error: 'nodes is not an array' };
  const seen = new Set();
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null) return { ok: false, error: 'node is not an object' };
    if (typeof n.id !== 'string' || n.id === '') return { ok: false, error: 'node without id' };
    if (seen.has(n.id)) return { ok: false, error: `duplicate node id ${n.id}` };
    seen.add(n.id);
    for (const f of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(n[f])) return { ok: false, error: `node ${n.id}: ${f} is not a number` };
    }
  }
  const edges = Array.isArray(json.edges) ? json.edges : [];
  const doc = { ...json, nodes, edges };
  getExt(doc); // normalize grid/viewport in place
  return { ok: true, doc };
}

// Stable, human-diffable serialization for exports and localStorage.
export function serialize(doc) {
  return JSON.stringify(doc, null, '\t');
}
