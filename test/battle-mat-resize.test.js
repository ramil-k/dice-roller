import { describe, it, expect } from 'vitest';
import { HANDLES, isCorner, resizeBox } from '../src/battle-mat/resize.js';

const box = { x: 100, y: 100, width: 200, height: 100 };

describe('resize handles', () => {
  it('names eight handles, four of them corners', () => {
    expect(HANDLES).toHaveLength(8);
    expect(HANDLES.filter(isCorner)).toEqual(['nw', 'ne', 'se', 'sw']);
  });

  it('an edge handle moves only its edge, the opposite one stays put', () => {
    expect(resizeBox(box, 'e', { x: 350, y: 999 })).toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(resizeBox(box, 'w', { x: 50, y: 0 })).toEqual({ x: 50, y: 100, width: 250, height: 100 });
    expect(resizeBox(box, 's', { x: 0, y: 250 })).toEqual({ x: 100, y: 100, width: 200, height: 150 });
    expect(resizeBox(box, 'n', { x: 0, y: 80 })).toEqual({ x: 100, y: 80, width: 200, height: 120 });
  });

  it('a free corner moves both edges it sits on', () => {
    expect(resizeBox(box, 'se', { x: 400, y: 300 })).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(resizeBox(box, 'nw', { x: 0, y: 50 })).toEqual({ x: 0, y: 50, width: 300, height: 150 });
  });

  it('a corner with keepAspect scales both axes from the anchored corner', () => {
    // pulled further horizontally: width 400 wins -> scale 2
    const se = resizeBox(box, 'se', { x: 500, y: 150 }, { keepAspect: true });
    expect(se).toEqual({ x: 100, y: 100, width: 400, height: 200 });
    // anchored at the bottom-right: the box grows leftwards/upwards
    const nw = resizeBox(box, 'nw', { x: 0, y: 190 }, { keepAspect: true });
    expect(nw.x + nw.width).toBe(300);
    expect(nw.y + nw.height).toBe(200);
    expect(nw.width / nw.height).toBeCloseTo(2);
    expect(nw.width).toBe(300);
  });

  it('an edge with keepAspect scales the other axis around its center', () => {
    const e = resizeBox(box, 'e', { x: 500, y: 0 }, { keepAspect: true });
    expect(e).toEqual({ x: 100, y: 50, width: 400, height: 200 });
  });

  it('never flips: crossing the anchor pins the box at minSize', () => {
    const past = resizeBox(box, 'e', { x: -500, y: 0 }, { minSize: 8 });
    expect(past).toEqual({ x: 100, y: 100, width: 8, height: 100 });
    const pastNw = resizeBox(box, 'nw', { x: 900, y: 900 }, { minSize: 8 });
    expect(pastNw.x + pastNw.width).toBe(300);
    expect(pastNw.y + pastNw.height).toBe(200);
    expect(pastNw.width).toBe(8);
    expect(pastNw.height).toBe(8);
    const aspect = resizeBox(box, 'se', { x: -500, y: -500 }, { keepAspect: true, minSize: 8 });
    expect(Math.min(aspect.width, aspect.height)).toBe(8);
    expect(aspect.width / aspect.height).toBeCloseTo(2);
  });
});
