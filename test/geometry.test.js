import { describe, it, expect } from 'vitest';
import {
  buildPolyhedron,
  settleRotation,
  apply3,
  _internal,
} from '../src/geometry.js';

const EXPECTED_FACES = { 4: 4, 6: 6, 8: 8, 10: 10, 12: 12, 20: 20 };

describe('buildPolyhedron', () => {
  for (const [sides, count] of Object.entries(EXPECTED_FACES)) {
    it(`d${sides} has ${count} faces and a full vertex list`, () => {
      const poly = buildPolyhedron(Number(sides));
      expect(poly).not.toBeNull();
      expect(poly.faces).toHaveLength(count);
      expect(poly.vertices.length).toBeGreaterThan(0);
    });

    it(`d${sides} vertices fit within the unit sphere (max radius = 1)`, () => {
      const poly = buildPolyhedron(Number(sides));
      const radii = poly.vertices.map((v) => Math.hypot(...v));
      for (const r of radii) expect(r).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.max(...radii)).toBeCloseTo(1, 5);
    });

    it(`d${sides} face normals are unit length and distinct`, () => {
      const poly = buildPolyhedron(Number(sides));
      const seen = [];
      for (const f of poly.faces) {
        expect(Math.hypot(...f.normal)).toBeCloseTo(1, 5);
        for (const s of seen) {
          const d = f.normal[0] * s[0] + f.normal[1] * s[1] + f.normal[2] * s[2];
          expect(d).toBeLessThan(0.999);
        }
        seen.push(f.normal);
      }
    });

    it(`d${sides} face indices reference real vertices in outward order`, () => {
      const poly = buildPolyhedron(Number(sides));
      for (const f of poly.faces) {
        for (const idx of f.indices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(poly.vertices.length);
        }
        // centroid should lie in the direction of the outward normal
        const d =
          f.center[0] * f.normal[0] +
          f.center[1] * f.normal[1] +
          f.center[2] * f.normal[2];
        expect(d).toBeGreaterThan(0);
      }
    });
  }
});

describe('rotationBetween (face squaring)', () => {
  const { rotationBetween } = _internal;
  it('rotates a face normal to point exactly at the camera (+Z)', () => {
    const poly = buildPolyhedron(20);
    for (const f of poly.faces) {
      const rot = rotationBetween(f.normal, [0, 0, 1]);
      const pointed = apply3(rot, f.normal);
      expect(pointed[2]).toBeCloseTo(1, 5);
    }
  });
});

describe('settleRotation', () => {
  it('keeps the result face front-most for every value and die', () => {
    // With the per-die 3/4 viewing tilt the result-face normal no longer equals
    // +Z, but it must still have the greatest Z of all faces — for EVERY rolled
    // value (the in-plane spin varies per value, so we check them all).
    for (const sides of [4, 6, 8, 10, 12, 20]) {
      const poly = buildPolyhedron(sides);
      for (let value = 1; value <= sides; value++) {
        const spin = (value * 47) % 360;
        const m = settleRotation(poly.faces[0].normal, spin, sides);
        const zs = poly.faces.map((f) => apply3(m, f.normal)[2]);
        const runnerUp = Math.max(...zs.slice(1));
        expect(zs[0]).toBeGreaterThan(runnerUp + 0.015);
      }
    }
  });
});
