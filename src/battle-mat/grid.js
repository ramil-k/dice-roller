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

// Snap a token so it sits centered in the cell under its own center. `x`/`y`
// is the token's top-left origin and `size` its width/height; tokens smaller
// or larger than a cell stay centered rather than hugging the cell corner.
export function snapTokenOrigin(x, y, size, grid) {
  const s = grid.cellSize;
  const { col, row } = cellOf(x + size / 2, y + size / 2, grid);
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
