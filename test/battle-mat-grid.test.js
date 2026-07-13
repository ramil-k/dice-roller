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
