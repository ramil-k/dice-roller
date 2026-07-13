import { describe, it, expect } from 'vitest';
import {
  EXT,
  emptyDoc,
  getExt,
  makeToken,
  makeImage,
  makeStroke,
  nodeKind,
  addNode,
  removeNode,
  getNode,
  moveNode,
  nodeAt,
  resolveColor,
  validateCanvas,
  serialize,
} from '../src/battle-mat/canvas-doc.js';

const OFFICIAL_TYPES = ['text', 'file', 'link', 'group'];

describe('emptyDoc', () => {
  it('has nodes, edges and the extension key', () => {
    const doc = emptyDoc();
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(doc[EXT].version).toBe(1);
    expect(doc[EXT].grid.cellSize).toBe(64);
    expect(doc[EXT].viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('node constructors', () => {
  it('makeToken produces a spec-valid link node', () => {
    const t = makeToken({ x: 10.4, y: 20.6, size: 64, url: 'https://x/y.svg', name: 'Bors', tokenKind: 'player' });
    expect(OFFICIAL_TYPES).toContain(t.type);
    expect(t.type).toBe('link');
    expect(typeof t.id).toBe('string');
    expect(t.x).toBe(10);
    expect(t.y).toBe(21);
    expect(t.width).toBe(64);
    expect(t.height).toBe(64);
    expect(t.url).toBe('https://x/y.svg');
    expect(t[EXT]).toMatchObject({ kind: 'token', name: 'Bors', tokenKind: 'player' });
    expect(nodeKind(t)).toBe('token');
  });

  it('makeImage produces a link node with kind image', () => {
    const img = makeImage({ x: 0, y: 0, width: 300.2, height: 200, url: 'data:image/png;base64,AA==' });
    expect(img.type).toBe('link');
    expect(img.width).toBe(300);
    expect(nodeKind(img)).toBe('image');
  });

  it('makeStroke computes the bounding box and normalizes points', () => {
    const s = makeStroke({ shape: 'pen', points: [[100, 50], [110, 70], [90, 60]], color: '#e05a5a' });
    expect(s.type).toBe('text');
    expect(s.text).toBe('');
    expect(s.x).toBe(90);
    expect(s.y).toBe(50);
    expect(s.width).toBe(20);
    expect(s.height).toBe(20);
    expect(s[EXT].points).toEqual([[10, 0], [20, 20], [0, 10]]);
    expect(nodeKind(s)).toBe('stroke');
  });

  it('makeStroke keeps degenerate boxes at least 1px so nodes stay valid', () => {
    const s = makeStroke({ shape: 'line', points: [[5, 5], [5, 5]] });
    expect(s.width).toBe(1);
    expect(s.height).toBe(1);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeToken({ x: 0, y: 0, url: 'u' }).id));
    expect(ids.size).toBe(100);
  });
});

describe('doc CRUD', () => {
  it('adds, moves and removes nodes', () => {
    const doc = emptyDoc();
    const t = addNode(doc, makeToken({ x: 0, y: 0, url: 'u' }));
    expect(getNode(doc, t.id)).toBe(t);
    expect(moveNode(doc, t.id, 128.4, 64)).toBe(true);
    expect(t.x).toBe(128);
    expect(t.y).toBe(64);
    expect(removeNode(doc, t.id)).toBe(true);
    expect(removeNode(doc, t.id)).toBe(false);
    expect(doc.nodes).toHaveLength(0);
  });

  it('moveNode on a missing id reports false', () => {
    expect(moveNode(emptyDoc(), 'nope', 0, 0)).toBe(false);
  });
});

describe('nodeAt', () => {
  it('prefers tokens over strokes over images and later nodes within a kind', () => {
    const doc = emptyDoc();
    const img = addNode(doc, makeImage({ x: 0, y: 0, width: 500, height: 500, url: 'u' }));
    const s = addNode(doc, makeStroke({ shape: 'pen', points: [[0, 0], [100, 100]] }));
    const t1 = addNode(doc, makeToken({ x: 40, y: 40, size: 20, url: 'u' }));
    const t2 = addNode(doc, makeToken({ x: 45, y: 45, size: 20, url: 'u' }));
    expect(nodeAt(doc, 50, 50)).toBe(t2);
    removeNode(doc, t2.id);
    expect(nodeAt(doc, 50, 50)).toBe(t1);
    removeNode(doc, t1.id);
    expect(nodeAt(doc, 50, 50)).toBe(s);
    removeNode(doc, s.id);
    expect(nodeAt(doc, 50, 50)).toBe(img);
    expect(nodeAt(doc, 900, 900)).toBeNull();
  });
});

describe('resolveColor', () => {
  it('passes hex through and maps presets to hex', () => {
    expect(resolveColor('#123456')).toBe('#123456');
    for (const preset of ['1', '2', '3', '4', '5', '6']) {
      expect(resolveColor(preset)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('falls back on missing or unknown colors', () => {
    expect(resolveColor(undefined, '#abc')).toBe('#abc');
    expect(resolveColor('7', '#abc')).toBe('#abc');
    expect(resolveColor('', '#abc')).toBe('#abc');
  });
});

describe('validateCanvas', () => {
  it('round-trips a serialized doc', () => {
    const doc = emptyDoc();
    addNode(doc, makeToken({ x: 1, y: 2, url: 'u', name: 'A' }));
    addNode(doc, makeStroke({ shape: 'rect', points: [[0, 0], [50, 30]] }));
    const res = validateCanvas(JSON.parse(serialize(doc)));
    expect(res.ok).toBe(true);
    expect(res.doc.nodes).toHaveLength(2);
    expect(res.doc.nodes[0][EXT].kind).toBe('token');
    expect(res.doc[EXT].grid.cellSize).toBe(64);
  });

  it('preserves foreign nodes, edges and unknown top-level keys', () => {
    const foreign = {
      nodes: [{ id: 'a', type: 'text', text: 'hello', x: 0, y: 0, width: 100, height: 50 }],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'a' }],
      somethingElse: { keep: true },
    };
    const res = validateCanvas(foreign);
    expect(res.ok).toBe(true);
    expect(nodeKind(res.doc.nodes[0])).toBeNull();
    expect(res.doc.edges).toHaveLength(1);
    expect(res.doc.somethingElse).toEqual({ keep: true });
    // normalization fills in grid/viewport defaults
    expect(getExt(res.doc).grid.snap).toBe(true);
  });

  it('rejects structurally broken input', () => {
    expect(validateCanvas(null).ok).toBe(false);
    expect(validateCanvas([]).ok).toBe(false);
    expect(validateCanvas({ nodes: 'nope' }).ok).toBe(false);
    expect(validateCanvas({ nodes: [{ id: '', x: 0, y: 0, width: 1, height: 1 }] }).ok).toBe(false);
    expect(validateCanvas({ nodes: [{ id: 'a', x: 'NaN', y: 0, width: 1, height: 1 }] }).ok).toBe(false);
    expect(
      validateCanvas({
        nodes: [
          { id: 'a', x: 0, y: 0, width: 1, height: 1 },
          { id: 'a', x: 0, y: 0, width: 1, height: 1 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('tolerates a missing edges array', () => {
    const res = validateCanvas({ nodes: [] });
    expect(res.ok).toBe(true);
    expect(res.doc.edges).toEqual([]);
  });
});
