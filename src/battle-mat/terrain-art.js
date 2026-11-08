// Terrain materials: the SVG patterns a painted cell is filled with, the
// stroke style of walls and doors, and the path geometry that turns a
// terrain node's cells/edges into one <path>. Every pattern is drawn in a
// 64-unit tile (viewBox) and sized to the grid cell at run time, so the art
// scales with the cell and stays aligned to the lattice (pattern x/y follow
// the grid offset). Colors are CSS custom properties (--bm-mat-<id>) with
// the defaults below on the overlay :host, so a host page can retheme them.
//
// Material ids and layers live in canvas-doc.js MATERIALS; this module only
// knows how each looks. DOM-light: builds SVG elements via dom.js.

import { svgEl } from './dom.js';
import { edgeSegment } from './grid.js';

export const MATERIAL_COLORS = {
  wall: '#3a3d47',
  door: '#b5793a',
  floor: '#6e7079',
  grass: '#3f7a3a',
  tree: '#2f5b2d',
  water: '#2f6f9f',
  dirt: '#6e5436',
  sand: '#c9b27a',
  road: '#7d7568',
  rock: '#5c5f68',
  swamp: '#4a5e3a',
  ice: '#cfe3ee',
  lava: '#c8451f',
  pit: '#121318',
  difficult: '#000000',
};

const v = (id) => `var(--bm-mat-${id})`;
const darker = (id, pct) => `color-mix(in srgb, ${v(id)}, black ${pct}%)`;
const lighter = (id, pct) => `color-mix(in srgb, ${v(id)}, white ${pct}%)`;

const base = (id) => svgEl('rect', { x: 0, y: 0, width: 64, height: 64, style: `fill:${v(id)}` });
const path = (d, style) => svgEl('path', { d, style: `fill:none;stroke-linecap:round;stroke-linejoin:round;${style}` });
const spot = (cx, cy, r, fill) => svgEl('circle', { cx, cy, r, style: `fill:${fill}` });

// Tile art per material: a list of elements drawn in the 64x64 tile.
const ART = {
  floor: (id) => [
    base(id),
    // offset flagstones: a seam across the middle, verticals staggered per row
    path('M0 32H64M32 0V32M12 32V64M44 32V64', `stroke:${darker(id, 35)};stroke-width:2`),
  ],
  grass: (id) => [
    base(id),
    path(
      'M10 20l3-6 3 6M34 12l3-6 3 6M50 30l3-6 3 6M20 44l3-6 3 6M44 52l3-6 3 6M8 56l3-6 3 6',
      `stroke:${lighter(id, 28)};stroke-width:1.8`,
    ),
  ],
  tree: (id) => [
    base(id),
    spot(32, 32, 24, lighter(id, 22)),
    spot(26, 26, 14, lighter(id, 36)),
    path('M32 56v-10', `stroke:${darker(id, 45)};stroke-width:4`),
  ],
  water: (id) => [
    base(id),
    path('M-4 18q8-6 16 0t16 0 16 0 16 0 16 0M-4 42q8-6 16 0t16 0 16 0 16 0 16 0', `stroke:${lighter(id, 30)};stroke-width:2`),
  ],
  dirt: (id) => [
    base(id),
    ...[[10, 12, 2.4], [40, 8, 1.8], [54, 26, 2.6], [22, 34, 1.8], [8, 50, 2.2], [36, 52, 2.8], [58, 56, 1.6]].map(
      ([cx, cy, r]) => spot(cx, cy, r, darker(id, 30)),
    ),
  ],
  sand: (id) => [
    base(id),
    ...[[12, 10, 1.4], [30, 20, 1.2], [50, 8, 1.6], [8, 36, 1.3], [26, 48, 1.5], [46, 40, 1.2], [58, 58, 1.4]].map(
      ([cx, cy, r]) => spot(cx, cy, r, darker(id, 22)),
    ),
    path('M2 28q14-6 28 0M34 60q14-6 28 0', `stroke:${lighter(id, 25)};stroke-width:1.4`),
  ],
  road: (id) => [
    base(id),
    ...[[8, 8, 7, 5], [26, 10, 8, 5], [48, 6, 7, 5], [16, 26, 8, 5], [38, 28, 9, 5], [58, 24, 6, 5], [6, 44, 7, 5], [28, 46, 8, 5], [50, 44, 8, 5], [18, 60, 8, 5], [40, 62, 8, 5], [60, 60, 6, 5]].map(
      ([cx, cy, rx, ry]) => svgEl('ellipse', { cx, cy, rx, ry, style: `fill:${darker(id, 18)};stroke:${darker(id, 40)};stroke-width:1` }),
    ),
  ],
  rock: (id) => [
    base(id),
    path('M4 14l14 6 8-10 12 4 10-8 12 6M2 40l10-6 14 10 12-14 10 8 14-4M20 64l6-12 12 4', `stroke:${darker(id, 40)};stroke-width:1.8`),
    path('M6 16l14 6M36 50l10 8', `stroke:${lighter(id, 22)};stroke-width:1.2`),
  ],
  swamp: (id) => [
    base(id),
    svgEl('ellipse', { cx: 40, cy: 44, rx: 18, ry: 9, style: `fill:${darker(id, 28)}` }),
    path('M12 54V30M16 54V36M20 54V32M52 24V8M56 24V12', `stroke:${lighter(id, 30)};stroke-width:1.8`),
    path('M8 30l4-4M18 32l2-4', `stroke:${lighter(id, 30)};stroke-width:1.8`),
  ],
  ice: (id) => [
    base(id),
    path('M6 40l16-18 10 8 14-20', `stroke:${darker(id, 20)};stroke-width:1.4`),
    path('M48 44v10M43 49h10M14 10v8M10 14h8', `stroke:#ffffff;stroke-width:1.6`),
  ],
  lava: (id) => [
    base(id),
    svgEl('ellipse', { cx: 18, cy: 20, rx: 12, ry: 8, style: `fill:${darker(id, 55)}` }),
    svgEl('ellipse', { cx: 46, cy: 46, rx: 14, ry: 9, style: `fill:${darker(id, 55)}` }),
    svgEl('ellipse', { cx: 52, cy: 12, rx: 6, ry: 4, style: `fill:${darker(id, 55)}` }),
    spot(34, 34, 3, '#ffd166'),
    spot(10, 50, 2.2, '#ffd166'),
    spot(58, 28, 1.8, '#ffd166'),
  ],
  pit: (id) => [
    base(id),
    path('M0 0l10 8 6-4 10 6 8-6 12 8 6-4 12 6M0 64l8-6 8 4 10-8 8 4 12-6 8 6 10-4', `stroke:${lighter(id, 18)};stroke-width:1.4`),
    path('M18 30l6 10M40 26l-4 12', `stroke:${lighter(id, 10)};stroke-width:1.2`),
  ],
  difficult: () => [
    path('M-8 72L72-8M-8 40L40-8M24 72L72 24', 'stroke:rgb(0 0 0 / 0.45);stroke-width:3'),
  ],
};

export const PATTERNED = Object.keys(ART);

export function patternId(material) {
  return `bm-mat-${material}`;
}

// A <pattern> for a fill/overlay material, to be sized by updateMaterialPatterns.
export function buildMaterialPattern(material) {
  const pattern = svgEl('pattern', {
    id: patternId(material),
    patternUnits: 'userSpaceOnUse',
    viewBox: '0 0 64 64',
    width: 64,
    height: 64,
  });
  for (const node of ART[material](material)) pattern.appendChild(node);
  return pattern;
}

export function updateMaterialPatterns(patterns, grid) {
  for (const p of patterns) {
    p.setAttribute('width', grid.cellSize);
    p.setAttribute('height', grid.cellSize);
    p.setAttribute('x', grid.offsetX);
    p.setAttribute('y', grid.offsetY);
  }
}

// One subpath per painted cell, absolute world coordinates.
export function cellsPathD(cells, grid) {
  const s = grid.cellSize;
  let d = '';
  for (const [col, row] of cells) {
    d += `M${col * s + grid.offsetX} ${row * s + grid.offsetY}h${s}v${s}h${-s}z`;
  }
  return d;
}

// One subpath per edge; `inset` (0..0.5) trims both ends, which is how a
// door reads as a gap in the wall it sits on.
export function edgesPathD(edges, grid, inset = 0) {
  let d = '';
  for (const edge of edges) {
    const { x1, y1, x2, y2 } = edgeSegment(edge, grid);
    const ax = x1 + (x2 - x1) * inset;
    const ay = y1 + (y2 - y1) * inset;
    const bx = x2 - (x2 - x1) * inset;
    const by = y2 - (y2 - y1) * inset;
    d += `M${ax} ${ay}L${bx} ${by}`;
  }
  return d;
}

export const WALL_WIDTH = 0.16; // of a cell
export const DOOR_INSET = 0.14;

// Stroke style of an edge material, in world units for the given cell size.
export function edgeStyle(material, cellSize) {
  const w = cellSize * WALL_WIDTH;
  if (material === 'door') {
    return { style: `fill:none;stroke:${v('door')};stroke-width:${w};stroke-linecap:butt` };
  }
  return { style: `fill:none;stroke:${v('wall')};stroke-width:${w};stroke-linecap:round;stroke-linejoin:round` };
}

// Inline swatch for the terrain shelf: one tile of the pattern (or a short
// wall/door stroke) in a 64-unit box. The pattern copy gets its own id so the
// swatch does not depend on the map's <defs>.
export function materialSwatch(material) {
  const svg = svgEl('svg', { class: 'mat-swatch', viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  if (ART[material]) {
    const defs = svgEl('defs');
    const pattern = buildMaterialPattern(material);
    pattern.setAttribute('id', `bm-sw-${material}`);
    defs.appendChild(pattern);
    svg.append(defs, svgEl('rect', { x: 0, y: 0, width: 64, height: 64, fill: `url(#bm-sw-${material})` }));
  } else {
    const { style } = edgeStyle(material, 64);
    svg.appendChild(svgEl('path', { d: material === 'door' ? 'M14 32H50' : 'M8 32H56', style }));
  }
  return svg;
}
