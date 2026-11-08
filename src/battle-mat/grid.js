// Square-grid math: snapping, cell lookup, and ruler measurement. All
// coordinates are world units (CSS pixels at zoom 1); the grid may be shifted
// by offsetX/offsetY so users can align it to an attached map image.
//
// DOM-free; covered by test/battle-mat-grid.test.js.

export const MIN_CELL = 8;
export const MAX_CELL = 512;

// Clamp a user-entered cell size to sane bounds; non-numeric input falls back
// to the given default so a cleared input can't wedge the grid.
export function clampCellSize(n, fallback = 64) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(v)));
}

// Nearest grid intersection to a world point.
export function snapPoint(x, y, grid) {
  const s = grid.cellSize;
  return {
    x: Math.round((x - grid.offsetX) / s) * s + grid.offsetX,
    y: Math.round((y - grid.offsetY) / s) * s + grid.offsetY,
  };
}

// Column/row of the cell containing a world point.
export function cellOf(x, y, grid) {
  const s = grid.cellSize;
  return {
    col: Math.floor((x - grid.offsetX) / s),
    row: Math.floor((y - grid.offsetY) / s),
  };
}

// Snap a token to the grid by its center. `x`/`y` is the token's top-left
// origin and `size` its width/height. Tokens spanning an odd number of cells
// (sub-cell ones included) center in the cell under their center; even spans
// center on the nearest grid intersection instead, so a 2x2 token covers
// exactly four cells rather than straddling nine.
export function snapTokenOrigin(x, y, size, grid) {
  const s = grid.cellSize;
  const cx = x + size / 2;
  const cy = y + size / 2;
  if (Math.max(1, Math.round(size / s)) % 2 === 0) {
    const p = snapPoint(cx, cy, grid);
    return { x: p.x - size / 2, y: p.y - size / 2 };
  }
  const { col, row } = cellOf(cx, cy, grid);
  return {
    x: col * s + grid.offsetX + (s - size) / 2,
    y: row * s + grid.offsetY + (s - size) / 2,
  };
}

// Euclidean ruler distance between two world points, in cells and feet.
export function measure(x1, y1, x2, y2, grid) {
  const cells = Math.hypot(x2 - x1, y2 - y1) / grid.cellSize;
  return { cells, feet: cells * (grid.feetPerCell ?? 5) };
}

export function formatMeasure(m) {
  const cells = (Math.round(m.cells * 10) / 10).toFixed(1);
  const feet = Math.round(m.feet);
  return `${cells} cells · ${feet} ft`;
}

// ---- terrain painting ------------------------------------------------------

// Cells covered by a square brush of `size` cells per side at a world point.
// Odd sizes center on the cell under the pointer; even sizes center on the
// nearest intersection (same rule as snapTokenOrigin), so a 2x2 brush paints
// exactly four cells. Returns [[col, row], ...] in row-major order.
export function brushCells(x, y, size, grid) {
  const n = Math.max(1, Math.round(size));
  const s = grid.cellSize;
  let col0;
  let row0;
  if (n % 2 === 1) {
    const { col, row } = cellOf(x, y, grid);
    col0 = col - (n - 1) / 2;
    row0 = row - (n - 1) / 2;
  } else {
    col0 = Math.round((x - grid.offsetX) / s) - n / 2;
    row0 = Math.round((y - grid.offsetY) / s) - n / 2;
  }
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push([col0 + c, row0 + r]);
  return cells;
}

// Max pointer distance from a grid line (as a fraction of the cell) at which
// a wall stroke still lands on that line.
export const EDGE_SNAP = 0.35;

// Nearest cell edge to a world point. An edge is identified by the cell it
// bounds on the north ('n', its top side) or west ('w', its left side), so
// every grid line segment has exactly one key. `distance` is in world units;
// callers compare it against EDGE_SNAP * cellSize. `prefer` ('n' | 'w')
// restricts the choice to edges of that orientation: a wall stroke moving
// along a grid line wants the segment it runs on, not the perpendicular one
// it brushes past at a corner.
export function nearestEdge(x, y, grid, prefer = null) {
  const s = grid.cellSize;
  const u = (x - grid.offsetX) / s;
  const v = (y - grid.offsetY) / s;
  const col = Math.floor(u);
  const row = Math.floor(v);
  const fu = u - col;
  const fv = v - row;
  const candidates = [
    { col, row, side: 'w', d: fu },
    { col: col + 1, row, side: 'w', d: 1 - fu },
    { col, row, side: 'n', d: fv },
    { col, row: row + 1, side: 'n', d: 1 - fv },
  ];
  let best = null;
  for (const c of candidates) {
    if (prefer && c.side !== prefer) continue;
    if (!best || c.d < best.d) best = c;
  }
  return { col: best.col, row: best.row, side: best.side, distance: best.d * s };
}

// World-space end points of an edge key, for rendering and hit-testing.
export function edgeSegment([col, row, side], grid) {
  const s = grid.cellSize;
  const x = col * s + grid.offsetX;
  const y = row * s + grid.offsetY;
  return side === 'n' ? { x1: x, y1: y, x2: x + s, y2: y } : { x1: x, y1: y, x2: x, y2: y + s };
}
