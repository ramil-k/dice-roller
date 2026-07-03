// Rigorous regularity checks: a correctly-constructed Platonic solid must have
// congruent regular faces — equal vertex counts, equal edge lengths, and every
// face the same distance from center (equal inradius). These catch bad face
// detection that a mere face-count test misses.
import { describe, it, expect } from 'vitest';
import { _internal } from '../src/geometry.js';

const { GENERATORS, normalize, centroid } = _internal;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Expected vertices-per-face for each Platonic/trapezohedral die.
const FACE_SIZE = { 4: 3, 6: 4, 8: 3, 12: 5, 20: 3 };

describe('polyhedron regularity', () => {
  for (const sides of [4, 6, 8, 12, 20]) {
    describe(`d${sides}`, () => {
      const { vertices, faces } = GENERATORS[sides]();

      it('every face has the expected number of distinct vertices', () => {
        for (const f of faces) {
          expect(f).toHaveLength(FACE_SIZE[sides]);
          expect(new Set(f).size).toBe(FACE_SIZE[sides]); // no repeats
        }
      });

      it('all edges within a face have equal length (regular polygon)', () => {
        for (const f of faces) {
          const edges = f.map((vi, k) => {
            const vj = f[(k + 1) % f.length];
            return len(sub(vertices[vi], vertices[vj]));
          });
          const first = edges[0];
          for (const e of edges) expect(e).toBeCloseTo(first, 5);
        }
      });

      it('all faces are equidistant from the center (equal inradius)', () => {
        const inradii = faces.map((f) =>
          len(centroid(f.map((i) => vertices[i])))
        );
        const first = inradii[0];
        for (const r of inradii) expect(r).toBeCloseTo(first, 5);
      });

      it('faces are planar (all vertices lie on the face plane)', () => {
        for (const f of faces) {
          const pts = f.map((i) => vertices[i]);
          const c = centroid(pts);
          const n = normalize(c);
          const d0 = dot(pts[0], n);
          for (const p of pts) expect(dot(p, n)).toBeCloseTo(d0, 5);
        }
      });
    });
  }
});
