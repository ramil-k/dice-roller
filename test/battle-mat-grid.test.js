import { describe, it, expect } from 'vitest';
import {
  clampCellSize,
  snapPoint,
  cellOf,
  snapTokenOrigin,
  measure,
  formatMeasure,
  MIN_CELL,
  MAX_CELL,
  brushCells,
  nearestEdge,
  edgeSegment,
  EDGE_SNAP,
} from '../src/battle-mat/grid.js';

const grid = (over = {}) => ({ cellSize: 64, offsetX: 0, offsetY: 0, feetPerCell: 5, ...over });

describe('clampCellSize', () => {
  it('clamps to bounds and rounds', () => {
    expect(clampCellSize(1)).toBe(MIN_CELL);
    expect(clampCellSize(10000)).toBe(MAX_CELL);
    expect(clampCellSize(64.6)).toBe(65);
  });

  it('falls back on non-numeric input', () => {
    expect(clampCellSize('abc')).toBe(64);
    expect(clampCellSize(NaN, 32)).toBe(32);
    expect(clampCellSize(undefined)).toBe(64);
  });
});

describe('snapPoint', () => {
  it('snaps to the nearest intersection', () => {
    expect(snapPoint(40, 100, grid())).toEqual({ x: 64, y: 128 });
    expect(snapPoint(30, 95, grid())).toEqual({ x: 0, y: 64 });
  });

  it('honors grid offsets', () => {
    const g = grid({ offsetX: 10, offsetY: -6 });
    expect(snapPoint(75, 60, g)).toEqual({ x: 74, y: 58 });
  });

  it('works with negative coordinates', () => {
    expect(snapPoint(-40, -100, grid())).toEqual({ x: -64, y: -128 });
  });
});

describe('cellOf', () => {
  it('returns the containing cell, offsets and negatives included', () => {
    expect(cellOf(70, 10, grid())).toEqual({ col: 1, row: 0 });
    expect(cellOf(-1, -1, grid())).toEqual({ col: -1, row: -1 });
    expect(cellOf(70, 10, grid({ offsetX: 8, offsetY: 12 }))).toEqual({ col: 0, row: -1 });
  });
});

describe('snapTokenOrigin', () => {
  it('centers a cell-sized token in the cell under its center', () => {
    expect(snapTokenOrigin(10, 10, 64, grid())).toEqual({ x: 0, y: 0 });
    expect(snapTokenOrigin(40, 70, 64, grid())).toEqual({ x: 64, y: 64 });
  });

  it('centers smaller tokens inside the cell', () => {
    // token center (26, 26) is in cell (0, 0); a 32px token centers at 16
    expect(snapTokenOrigin(10, 10, 32, grid())).toEqual({ x: 16, y: 16 });
  });

  it('honors offsets', () => {
    const g = grid({ offsetX: 10, offsetY: 10 });
    expect(snapTokenOrigin(12, 12, 64, g)).toEqual({ x: 10, y: 10 });
  });

  it('snaps even spans to intersections so a 2x2 covers exactly four cells', () => {
    // 128px token centered near intersection (64, 64) -> origin (0, 0)
    expect(snapTokenOrigin(10, 10, 128, grid())).toEqual({ x: 0, y: 0 });
    // center (154, 154) -> nearest intersection (128, 128)
    expect(snapTokenOrigin(90, 90, 128, grid())).toEqual({ x: 64, y: 64 });
    // 4x4: center (138, 138) -> intersection (128, 128), origin -0.5 cell each way
    expect(snapTokenOrigin(10, 10, 256, grid())).toEqual({ x: 0, y: 0 });
  });

  it('keeps odd multi-cell spans centered on a cell', () => {
    // 3x3 token with center in cell (1, 1) covers cells 0..2
    expect(snapTokenOrigin(0, 0, 192, grid())).toEqual({ x: 0, y: 0 });
  });
});

describe('measure', () => {
  it('measures a 3-4-5 triangle as 5 cells / 25 ft', () => {
    const m = measure(0, 0, 3 * 64, 4 * 64, grid());
    expect(m.cells).toBeCloseTo(5);
    expect(m.feet).toBeCloseTo(25);
  });

  it('uses feetPerCell', () => {
    const m = measure(0, 0, 128, 0, grid({ feetPerCell: 10 }));
    expect(m.feet).toBeCloseTo(20);
  });

  it('defaults feetPerCell to 5 when absent', () => {
    const m = measure(0, 0, 64, 0, { cellSize: 64, offsetX: 0, offsetY: 0 });
    expect(m.feet).toBeCloseTo(5);
  });
});

describe('formatMeasure', () => {
  it('formats cells to one decimal and feet to whole numbers', () => {
    expect(formatMeasure({ cells: 3.246, feet: 16.23 })).toBe('3.2 cells · 16 ft');
    expect(formatMeasure({ cells: 5, feet: 25 })).toBe('5.0 cells · 25 ft');
  });
});

describe('brushCells', () => {
  it('size 1 is the cell under the pointer', () => {
    expect(brushCells(70, 10, 1, grid())).toEqual([[1, 0]]);
  });

  it('odd sizes center on the pointer cell', () => {
    const cells = brushCells(70, 70, 3, grid());
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual([0, 0]);
    expect(cells[8]).toEqual([2, 2]);
  });

  it('even sizes center on the nearest intersection', () => {
    // pointer near intersection (64, 64): 2x2 covers cells 0..1
    expect(brushCells(60, 70, 2, grid())).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    // pointer near (128, 128)
    expect(brushCells(130, 120, 2, grid())).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);
  });

  it('honors offsets and negatives', () => {
    expect(brushCells(-1, -1, 1, grid())).toEqual([[-1, -1]]);
    expect(brushCells(70, 10, 1, grid({ offsetX: 8, offsetY: 12 }))).toEqual([[0, -1]]);
  });
});

describe('nearestEdge', () => {
  it('picks the closest side and normalizes east/south to the neighbor key', () => {
    expect(nearestEdge(5, 30, grid())).toMatchObject({ col: 0, row: 0, side: 'w', distance: 5 });
    expect(nearestEdge(60, 30, grid())).toMatchObject({ col: 1, row: 0, side: 'w', distance: 4 });
    expect(nearestEdge(30, 3, grid())).toMatchObject({ col: 0, row: 0, side: 'n', distance: 3 });
    expect(nearestEdge(30, 62, grid())).toMatchObject({ col: 0, row: 1, side: 'n', distance: 2 });
  });

  it('reports the distance to compare against EDGE_SNAP', () => {
    const e = nearestEdge(32, 32, grid());
    expect(e.distance).toBe(32);
    expect(e.distance > EDGE_SNAP * 64).toBe(true);
  });

  it('honors offsets', () => {
    expect(nearestEdge(12, 40, grid({ offsetX: 10 }))).toMatchObject({ col: 0, side: 'w', distance: 2 });
  });

  it('prefer keeps a stroke on the line it runs along at a corner', () => {
    // exactly on the corner (64, 64): both orientations are at distance 0
    expect(nearestEdge(64, 64, grid(), 'n')).toMatchObject({ col: 1, row: 1, side: 'n', distance: 0 });
    expect(nearestEdge(64, 64, grid(), 'w')).toMatchObject({ col: 1, row: 1, side: 'w', distance: 0 });
    // a hair past the corner along y = 64: the perpendicular 'w' edge is
    // closer than the 'n' one would be without the preference
    expect(nearestEdge(63.9, 64.5, grid(), 'n')).toMatchObject({ col: 0, row: 1, side: 'n' });
  });
});

describe('edgeSegment', () => {
  it('maps edge keys to world segments', () => {
    expect(edgeSegment([1, 2, 'n'], grid())).toEqual({ x1: 64, y1: 128, x2: 128, y2: 128 });
    expect(edgeSegment([1, 2, 'w'], grid({ offsetX: 4, offsetY: 6 }))).toEqual({ x1: 68, y1: 134, x2: 68, y2: 198 });
  });
});
