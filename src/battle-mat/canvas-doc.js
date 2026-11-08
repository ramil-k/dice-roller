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
//   terrain → type "text" (empty text; one node per material holding the
//                          painted grid cells `cells: [[col,row]]` or, for
//                          walls and doors, the cell edges `edges:
//                          [[col,row,'n'|'w']]`; x/y/width/height is the
//                          world bounding box recomputed on every paint)
// Grid and viewport settings ride in a top-level `x-battleMat` key so an
// exported map round-trips together with its grid alignment.
//
// This module is DOM-free and covered by test/battle-mat-canvas-doc.test.js.

import { dlog, caller } from './debug.js';
import { edgeSegment } from './grid.js';

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

// zoom 0.5 = the map starts twice as zoomed-out, so more of the grid and more
// tokens are visible at a glance (the DM zooms in as needed)
export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.5 };

// Combat state for the initiative tracker. Turn order is *computed* from the
// tokens' initiative values (see combat.js), so only the round counter and
// the active combatant are stored.
export const DEFAULT_COMBAT = { round: 1, activeNodeId: null };

export function defaultExt() {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    viewport: { ...DEFAULT_VIEWPORT },
    combat: { ...DEFAULT_COMBAT },
  };
}

export function emptyDoc() {
  return { nodes: [], edges: [], [EXT]: defaultExt() };
}

// Extension accessor that tolerates docs imported from other tools (missing
// or partial x-battleMat): fills in grid/viewport/combat defaults *in place*,
// preserving object identity across calls — several components hold on to
// the same doc, and a reference to ext.combat taken before this call must
// still be live after it.
const fillDefaults = (obj, defaults) => {
  for (const key of Object.keys(defaults)) obj[key] ??= defaults[key];
  return obj;
};

export function getExt(doc) {
  const ext = (doc[EXT] ??= {});
  ext.version ??= 1;
  fillDefaults((ext.grid ??= {}), DEFAULT_GRID);
  if (!ext.viewport || ['x', 'y', 'zoom'].some((k) => ext.viewport[k] == null)) {
    dlog('doc', 'getExt: viewport missing/partial - filling defaults (viewport RESET)', {
      had: ext.viewport ? { ...ext.viewport } : null,
      from: caller(),
    });
  }
  fillDefaults((ext.viewport ??= {}), DEFAULT_VIEWPORT);
  fillDefaults((ext.combat ??= {}), DEFAULT_COMBAT);
  return ext;
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

// D&D size word → how many grid cells a token spans per side.
export const SIZE_CELLS = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

export function cellsForSize(size) {
  return SIZE_CELLS[typeof size === 'string' ? size.toLowerCase() : ''] ?? 1;
}

export function makeToken({ x, y, size = 64, url, name = '', source = 'roster', tokenKind = 'player', color, hp, hpMax, ac, initMod }) {
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
  // combat stats ride on the token so the initiative tracker can show them;
  // absent fields stay absent (registry icons have no stats)
  for (const [key, v] of Object.entries({ hp, hpMax, ac, initMod })) {
    if (Number.isFinite(v)) node[EXT][key] = v;
  }
  if (color) node.color = color;
  return node;
}

// `locked` images cannot be moved, resized or erased on the mat (a map
// background the DM pins down); the flag lives in the extension so it
// travels with exports and sync rooms.
export function makeImage({ x, y, width, height, url, locked = false }) {
  const node = {
    id: newId(),
    type: 'link',
    x: round(x),
    y: round(y),
    width: Math.max(1, round(width)),
    height: Math.max(1, round(height)),
    url,
    [EXT]: { kind: 'image' },
  };
  if (locked) node[EXT].locked = true;
  return node;
}

export function isLocked(node) {
  return node?.[EXT]?.locked === true;
}

// Set or clear the lock. Clearing deletes the key (rather than storing
// false) so the sync bridge sends a field delete and exports stay minimal.
export function setLocked(doc, id, locked) {
  const node = getNode(doc, id);
  if (!node) return false;
  const ext = (node[EXT] ??= {});
  dlog('doc', `setLocked ${id.slice(0, 8)} -> ${locked}`, { was: ext.locked === true, from: caller() });
  if (locked) ext.locked = true;
  else delete ext.locked;
  return true;
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

// ---- terrain ---------------------------------------------------------------

// Materials a terrain brush can paint. `layer` decides both the sub-layer
// the view draws it in and what the node stores: 'fill' and 'overlay' hold
// cells (an overlay sits above any fill in the same cell: difficult-terrain
// hatching over grass), 'edge' holds cell edges (walls, doors). The order is
// the shelf order.
export const MATERIALS = [
  { id: 'wall', layer: 'edge' },
  { id: 'door', layer: 'edge' },
  { id: 'floor', layer: 'fill' },
  { id: 'grass', layer: 'fill' },
  { id: 'tree', layer: 'fill' },
  { id: 'water', layer: 'fill' },
  { id: 'dirt', layer: 'fill' },
  { id: 'sand', layer: 'fill' },
  { id: 'road', layer: 'fill' },
  { id: 'rock', layer: 'fill' },
  { id: 'swamp', layer: 'fill' },
  { id: 'ice', layer: 'fill' },
  { id: 'lava', layer: 'fill' },
  { id: 'pit', layer: 'fill' },
  { id: 'difficult', layer: 'overlay' },
];

const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export function materialLayer(id) {
  return MATERIAL_BY_ID.get(id)?.layer ?? null;
}

const cellKey = ([col, row]) => `${col},${row}`;
const edgeKey = ([col, row, side]) => `${col},${row},${side}`;

// The single terrain node of a material, or null.
export function terrainNode(doc, material) {
  return doc.nodes.find((n) => nodeKind(n) === 'terrain' && n[EXT].material === material) ?? null;
}

function ensureTerrainNode(doc, material) {
  const found = terrainNode(doc, material);
  if (found) return found;
  const layer = materialLayer(material);
  if (!layer) throw new Error(`unknown terrain material ${material}`);
  const node = {
    id: newId(),
    type: 'text',
    text: '',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    [EXT]: { kind: 'terrain', material, ...(layer === 'edge' ? { edges: [] } : { cells: [] }) },
  };
  doc.nodes.push(node);
  return node;
}

// Recompute a terrain node's world bounding box from its cells/edges under
// the given grid (the box feeds docBounds / fit-all; rendering reads the
// cells directly, so a stale box after a grid change is harmless until the
// next paint or refreshTerrainBounds).
export function terrainBounds(node, grid) {
  const ext = node[EXT];
  const s = grid.cellSize;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [col, row] of ext.cells ?? []) {
    const x = col * s + grid.offsetX;
    const y = row * s + grid.offsetY;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + s > maxX) maxX = x + s;
    if (y + s > maxY) maxY = y + s;
  }
  for (const edge of ext.edges ?? []) {
    const { x1, y1, x2, y2 } = edgeSegment(edge, grid);
    minX = Math.min(minX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxX = Math.max(maxX, x1, x2);
    maxY = Math.max(maxY, y1, y2);
  }
  if (!Number.isFinite(minX)) return false;
  node.x = round(minX);
  node.y = round(minY);
  node.width = Math.max(1, round(maxX - minX));
  node.height = Math.max(1, round(maxY - minY));
  return true;
}

export function refreshTerrainBounds(doc, grid) {
  for (const n of doc.nodes) if (nodeKind(n) === 'terrain') terrainBounds(n, grid);
}

// Drop a terrain node that has nothing left to draw.
function pruneTerrain(doc, node) {
  const ext = node[EXT];
  if ((ext.cells?.length ?? 0) === 0 && (ext.edges?.length ?? 0) === 0) removeNode(doc, node.id);
}

// Paint cells with a fill/overlay material. A fill replaces any other fill in
// the same cells (one ground per cell); an overlay only adds itself. Returns
// true when the document changed.
export function paintCells(doc, material, cells, grid) {
  const layer = materialLayer(material);
  if (layer !== 'fill' && layer !== 'overlay') return false;
  const node = ensureTerrainNode(doc, material);
  const have = new Set(node[EXT].cells.map(cellKey));
  let changed = false;
  for (const cell of cells) {
    const k = cellKey(cell);
    if (have.has(k)) continue;
    have.add(k);
    node[EXT].cells.push([cell[0], cell[1]]);
    changed = true;
  }
  if (layer === 'fill') {
    for (const other of doc.nodes) {
      if (other === node || nodeKind(other) !== 'terrain' || materialLayer(other[EXT].material) !== 'fill') continue;
      if (removeCellsFrom(other, cells)) {
        changed = true;
        terrainBounds(other, grid);
      }
    }
    for (const other of doc.nodes.filter((n) => n !== node && nodeKind(n) === 'terrain')) pruneTerrain(doc, other);
  }
  if (changed) terrainBounds(node, grid);
  return changed;
}

function removeCellsFrom(node, cells) {
  const drop = new Set(cells.map(cellKey));
  const before = node[EXT].cells.length;
  node[EXT].cells = node[EXT].cells.filter((c) => !drop.has(cellKey(c)));
  return node[EXT].cells.length !== before;
}

// Erase every fill and overlay from the given cells. Returns true when the
// document changed.
export function eraseCells(doc, cells, grid) {
  let changed = false;
  for (const node of [...doc.nodes]) {
    if (nodeKind(node) !== 'terrain' || !node[EXT].cells) continue;
    if (!removeCellsFrom(node, cells)) continue;
    changed = true;
    terrainBounds(node, grid);
    pruneTerrain(doc, node);
  }
  return changed;
}

// Paint cell edges with an edge material (wall, door). An edge holds one
// material at a time: a door placed on a wall replaces that wall segment.
export function paintEdges(doc, material, edges, grid) {
  if (materialLayer(material) !== 'edge') return false;
  const node = ensureTerrainNode(doc, material);
  const have = new Set(node[EXT].edges.map(edgeKey));
  let changed = false;
  for (const edge of edges) {
    const k = edgeKey(edge);
    if (have.has(k)) continue;
    have.add(k);
    node[EXT].edges.push([edge[0], edge[1], edge[2]]);
    changed = true;
  }
  for (const other of [...doc.nodes]) {
    if (other === node || nodeKind(other) !== 'terrain' || !other[EXT].edges) continue;
    if (!removeEdgesFrom(other, edges)) continue;
    changed = true;
    terrainBounds(other, grid);
    pruneTerrain(doc, other);
  }
  if (changed) terrainBounds(node, grid);
  return changed;
}

function removeEdgesFrom(node, edges) {
  const drop = new Set(edges.map(edgeKey));
  const before = node[EXT].edges.length;
  node[EXT].edges = node[EXT].edges.filter((e) => !drop.has(edgeKey(e)));
  return node[EXT].edges.length !== before;
}

export function eraseEdges(doc, edges, grid) {
  let changed = false;
  for (const node of [...doc.nodes]) {
    if (nodeKind(node) !== 'terrain' || !node[EXT].edges) continue;
    if (!removeEdgesFrom(node, edges)) continue;
    changed = true;
    terrainBounds(node, grid);
    pruneTerrain(doc, node);
  }
  return changed;
}

// Edges whose midpoint falls inside any of the given cells: what a terrain
// eraser sweep takes off the walls.
export function edgesInCells(doc, cells) {
  const want = new Set(cells.map(cellKey));
  const out = [];
  for (const node of doc.nodes) {
    if (nodeKind(node) !== 'terrain') continue;
    for (const edge of node[EXT].edges ?? []) {
      const [col, row, side] = edge;
      // the 'n' edge of (col,row) borders cells (col,row) and (col,row-1);
      // 'w' borders (col,row) and (col-1,row); either neighbor being swept
      // erases it
      const a = `${col},${row}`;
      const b = side === 'n' ? `${col},${row - 1}` : `${col - 1},${row}`;
      if (want.has(a) || want.has(b)) out.push(edge);
    }
  }
  return out;
}

// Convenience readers used by rendering and tools. `nodeKind` returns the
// battle-mat kind or null for foreign nodes (kept for round-tripping).
export function nodeKind(node) {
  const kind = node?.[EXT]?.kind;
  return kind === 'token' || kind === 'image' || kind === 'stroke' || kind === 'terrain' ? kind : null;
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

// World-space box around every node (tokens, images, strokes), or null for an
// empty map - what "show everything" fits into the screen.
export function docBounds(doc) {
  let b = null;
  for (const n of doc.nodes) {
    if (![n.x, n.y, n.width, n.height].every(Number.isFinite)) continue;
    b = b
      ? { minX: Math.min(b.minX, n.x), minY: Math.min(b.minY, n.y), maxX: Math.max(b.maxX, n.x + n.width), maxY: Math.max(b.maxY, n.y + n.height) }
      : { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
  }
  return b;
}

export function moveNode(doc, id, x, y) {
  const node = getNode(doc, id);
  if (!node) return false;
  node.x = round(x);
  node.y = round(y);
  return true;
}

// Replace a node's box (resize handles). Same rounding and >= 1 clamp as the
// constructors, so a resized node stays a valid canvas node.
export function resizeNode(doc, id, { x, y, width, height }) {
  const node = getNode(doc, id);
  if (!node) return false;
  node.x = round(x);
  node.y = round(y);
  node.width = Math.max(1, round(width));
  node.height = Math.max(1, round(height));
  return true;
}

// Topmost node whose bounding box contains the world point, preferring tokens
// over strokes over images (matching the visual layer order), and later nodes
// over earlier ones within a kind (spec: last node paints on top). Terrain is
// never hit: it is painted and erased by its own tools, not selected.
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
