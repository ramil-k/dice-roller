import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  pinchUpdate,
  fitBounds,
} from '../src/battle-mat/viewport.js';

describe('screenToWorld / worldToScreen', () => {
  it('are inverses at various viewports', () => {
    const cases = [
      DEFAULT_VIEWPORT,
      { x: 100, y: -50, zoom: 2 },
      { x: -3.5, y: 7.25, zoom: 0.25 },
    ];
    for (const vp of cases) {
      const w = screenToWorld(vp, 123, 456);
      const s = worldToScreen(vp, w.x, w.y);
      expect(s.x).toBeCloseTo(123);
      expect(s.y).toBeCloseTo(456);
    }
  });

  it('maps the viewport origin to screen (0, 0)', () => {
    const vp = { x: 40, y: 60, zoom: 3 };
    expect(worldToScreen(vp, 40, 60)).toEqual({ x: 0, y: 0 });
  });
});

describe('panBy', () => {
  it('moves the world origin opposite the pointer delta, scaled by zoom', () => {
    const vp = panBy({ x: 0, y: 0, zoom: 2 }, 100, -50);
    expect(vp).toEqual({ x: -50, y: 25, zoom: 2 });
  });

  it('keeps the dragged world point under the pointer', () => {
    const vp = { x: 10, y: 20, zoom: 1.5 };
    const before = screenToWorld(vp, 200, 200);
    const panned = panBy(vp, 30, 40);
    const after = screenToWorld(panned, 230, 240);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor invariant', () => {
    for (const vp of [DEFAULT_VIEWPORT, { x: 55, y: -20, zoom: 0.5 }, { x: -10, y: 300, zoom: 4 }]) {
      for (const factor of [1.2, 0.8, 2.5]) {
        const before = screenToWorld(vp, 300, 150);
        const zoomed = zoomAt(vp, factor, 300, 150);
        const after = screenToWorld(zoomed, 300, 150);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
      }
    }
  });

  it('clamps zoom to bounds', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: MAX_ZOOM }, 10, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: MIN_ZOOM }, 0.001, 0, 0).zoom).toBe(MIN_ZOOM);
  });
});

describe('clampZoom', () => {
  it('bounds values and rejects non-finite input', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });
});

describe('pinchUpdate', () => {
  it('scales by the pointer-distance ratio', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    // fingers move apart symmetrically around (100, 100): distance doubles
    const next = pinchUpdate(vp, { x: 50, y: 100 }, { x: 150, y: 100 }, { x: 0, y: 100 }, { x: 200, y: 100 });
    expect(next.zoom).toBeCloseTo(2);
    // midpoint is unchanged, so the world point under it stays put
    const before = screenToWorld(vp, 100, 100);
    const after = screenToWorld(next, 100, 100);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('pans when the midpoint moves without scaling', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    // both fingers translate +40 in x, constant distance
    const next = pinchUpdate(vp, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 0 }, { x: 140, y: 0 });
    expect(next.zoom).toBeCloseTo(1);
    const before = screenToWorld(vp, 50, 0);
    const after = screenToWorld(next, 90, 0);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('survives a zero previous distance', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const next = pinchUpdate(vp, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(next.zoom).toBeCloseTo(1);
  });
});

describe('fitBounds', () => {
  it('fits the box inside the padded screen and centres it', () => {
    const b = { minX: 100, minY: 200, maxX: 2100, maxY: 1200 };
    const vp = fitBounds(b, 1000, 600, { padding: 50 });
    expect(vp.zoom).toBeCloseTo(0.45); // width-bound: 900 / 2000
    const tl = worldToScreen(vp, b.minX, b.minY);
    const br = worldToScreen(vp, b.maxX, b.maxY);
    expect(tl.x).toBeCloseTo(50);
    expect(br.x).toBeCloseTo(950);
    expect((tl.y + br.y) / 2).toBeCloseTo(300);
    expect(tl.y).toBeGreaterThanOrEqual(50);
    expect(br.y).toBeLessThanOrEqual(550);
  });

  it('caps the zoom at maxZoom for a small box', () => {
    const vp = fitBounds({ minX: 0, minY: 0, maxX: 64, maxY: 64 }, 1000, 600);
    expect(vp.zoom).toBe(1);
    const c = worldToScreen(vp, 32, 32);
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(300);
  });

  it('stops at MIN_ZOOM for a huge box', () => {
    const vp = fitBounds({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, 1000, 600);
    expect(vp.zoom).toBe(MIN_ZOOM);
  });

  it('centres a zero-size box without dividing by zero', () => {
    const vp = fitBounds({ minX: 10, minY: 20, maxX: 10, maxY: 20 }, 800, 400);
    expect(vp).toEqual({ x: 10 - 400, y: 20 - 200, zoom: 1 });
  });

  it('handles a box that is a vertical line', () => {
    const vp = fitBounds({ minX: 0, minY: 0, maxX: 0, maxY: 1000 }, 800, 600, { padding: 50 });
    expect(vp.zoom).toBeCloseTo(0.5);
    expect(Number.isFinite(vp.x)).toBe(true);
  });
});
