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
  docBounds,
  resizeNode,
  isLocked,
  setLocked,
  nodeAt,
  resolveColor,
  validateCanvas,
  serialize,
  cellsForSize,
  MATERIALS,
  materialLayer,
  terrainNode,
  paintCells,
  eraseCells,
  paintEdges,
  eraseEdges,
  edgesInCells,
  refreshTerrainBounds,
} from '../src/battle-mat/canvas-doc.js';

const OFFICIAL_TYPES = ['text', 'file', 'link', 'group'];

describe('emptyDoc', () => {
  it('has nodes, edges and the extension key', () => {
    const doc = emptyDoc();
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(doc[EXT].version).toBe(1);
    expect(doc[EXT].grid.cellSize).toBe(64);
    expect(doc[EXT].viewport).toEqual({ x: 0, y: 0, zoom: 0.5 });
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
    expect(img[EXT].locked).toBeUndefined(); // absent, not false: exports stay minimal
    expect(isLocked(img)).toBe(false);
  });

  it('makeImage can start locked', () => {
    const img = makeImage({ x: 0, y: 0, width: 10, height: 10, url: 'u', locked: true });
    expect(img[EXT].locked).toBe(true);
    expect(isLocked(img)).toBe(true);
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

  it('resizeNode rounds and keeps the box at least 1px', () => {
    const doc = emptyDoc();
    const img = addNode(doc, makeImage({ x: 0, y: 0, width: 100, height: 50, url: 'u' }));
    expect(resizeNode(doc, img.id, { x: 10.6, y: -3.2, width: 200.4, height: 0 })).toBe(true);
    expect([img.x, img.y, img.width, img.height]).toEqual([11, -3, 200, 1]);
    expect(resizeNode(doc, 'nope', { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('setLocked sets the flag and clearing removes the key', () => {
    const doc = emptyDoc();
    const img = addNode(doc, makeImage({ x: 0, y: 0, width: 10, height: 10, url: 'u' }));
    expect(setLocked(doc, img.id, true)).toBe(true);
    expect(isLocked(img)).toBe(true);
    expect(setLocked(doc, img.id, false)).toBe(true);
    expect(isLocked(img)).toBe(false);
    expect('locked' in img[EXT]).toBe(false);
    expect(setLocked(doc, 'nope', true)).toBe(false);
    expect(isLocked(null)).toBe(false);
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

describe('cellsForSize', () => {
  it('maps D&D size words to a per-side cell count', () => {
    expect(cellsForSize('tiny')).toBe(1);
    expect(cellsForSize('small')).toBe(1);
    expect(cellsForSize('medium')).toBe(1);
    expect(cellsForSize('Large')).toBe(2);
    expect(cellsForSize('huge')).toBe(3);
    expect(cellsForSize('gargantuan')).toBe(4);
  });

  it('defaults to one cell for unknown or absent sizes', () => {
    expect(cellsForSize('колоссальный')).toBe(1);
    expect(cellsForSize(undefined)).toBe(1);
    expect(cellsForSize(2)).toBe(1);
  });
});

describe('docBounds', () => {
  it('is null for an empty map', () => {
    expect(docBounds(emptyDoc())).toBe(null);
  });

  it('unions every node box', () => {
    const doc = emptyDoc();
    doc.nodes.push(
      { id: 'a', type: 'text', text: '', x: 10, y: 20, width: 64, height: 64 },
      { id: 'b', type: 'link', url: 'x', x: -100, y: 300, width: 50, height: 40 },
      { id: 'c', type: 'text', text: '', x: 500, y: -50, width: 10, height: 10 },
    );
    expect(docBounds(doc)).toEqual({ minX: -100, minY: -50, maxX: 510, maxY: 340 });
  });

  it('skips nodes without finite geometry', () => {
    const doc = emptyDoc();
    doc.nodes.push({ id: 'a', type: 'text', text: '', x: 0, y: 0, width: 10, height: 10 }, { id: 'b', type: 'text', x: NaN, y: 0, width: 1, height: 1 });
    expect(docBounds(doc)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe('terrain', () => {
  const grid = { cellSize: 64, offsetX: 0, offsetY: 0 };

  it('paintCells creates one node per material with a world bounding box', () => {
    const doc = emptyDoc();
    expect(paintCells(doc, 'grass', [[1, 1], [2, 1]], grid)).toBe(true);
    expect(paintCells(doc, 'grass', [[2, 1]], grid)).toBe(false); // already painted
    const node = terrainNode(doc, 'grass');
    expect(doc.nodes).toHaveLength(1);
    expect(node.type).toBe('text');
    expect(nodeKind(node)).toBe('terrain');
    expect(node[EXT].cells).toEqual([[1, 1], [2, 1]]);
    expect([node.x, node.y, node.width, node.height]).toEqual([64, 64, 128, 64]);
  });

  it('a fill replaces another fill in the same cell, an overlay stacks', () => {
    const doc = emptyDoc();
    paintCells(doc, 'grass', [[0, 0], [1, 0]], grid);
    paintCells(doc, 'water', [[1, 0]], grid);
    expect(terrainNode(doc, 'grass')[EXT].cells).toEqual([[0, 0]]);
    expect(terrainNode(doc, 'water')[EXT].cells).toEqual([[1, 0]]);
    paintCells(doc, 'difficult', [[0, 0]], grid);
    expect(terrainNode(doc, 'grass')[EXT].cells).toEqual([[0, 0]]);
    expect(terrainNode(doc, 'difficult')[EXT].cells).toEqual([[0, 0]]);
    // painting water over the last grass cell removes the empty grass node
    paintCells(doc, 'water', [[0, 0]], grid);
    expect(terrainNode(doc, 'grass')).toBeNull();
    expect(terrainNode(doc, 'difficult')[EXT].cells).toEqual([[0, 0]]);
  });

  it('eraseCells strips fills and overlays and prunes empty nodes', () => {
    const doc = emptyDoc();
    paintCells(doc, 'grass', [[0, 0], [1, 0]], grid);
    paintCells(doc, 'difficult', [[1, 0]], grid);
    expect(eraseCells(doc, [[1, 0]], grid)).toBe(true);
    expect(terrainNode(doc, 'difficult')).toBeNull();
    expect(terrainNode(doc, 'grass')[EXT].cells).toEqual([[0, 0]]);
    expect(eraseCells(doc, [[5, 5]], grid)).toBe(false);
  });

  it('paintEdges stores walls, a door replaces the wall segment, eraseEdges removes', () => {
    const doc = emptyDoc();
    expect(paintEdges(doc, 'wall', [[0, 0, 'n'], [1, 0, 'n']], grid)).toBe(true);
    const wall = terrainNode(doc, 'wall');
    expect([wall.x, wall.y, wall.width, wall.height]).toEqual([0, 0, 128, 1]);
    paintEdges(doc, 'door', [[1, 0, 'n']], grid);
    expect(wall[EXT].edges).toEqual([[0, 0, 'n']]);
    expect(terrainNode(doc, 'door')[EXT].edges).toEqual([[1, 0, 'n']]);
    expect(eraseEdges(doc, [[0, 0, 'n'], [1, 0, 'n']], grid)).toBe(true);
    expect(doc.nodes).toHaveLength(0);
  });

  it('rejects a material on the wrong layer', () => {
    const doc = emptyDoc();
    expect(paintCells(doc, 'wall', [[0, 0]], grid)).toBe(false);
    expect(paintEdges(doc, 'grass', [[0, 0, 'n']], grid)).toBe(false);
    expect(doc.nodes).toHaveLength(0);
  });

  it('edgesInCells finds the walls bordering swept cells', () => {
    const doc = emptyDoc();
    paintEdges(doc, 'wall', [[2, 2, 'n'], [2, 2, 'w'], [5, 5, 'n']], grid);
    expect(edgesInCells(doc, [[2, 1]])).toEqual([[2, 2, 'n']]); // from the cell above
    expect(edgesInCells(doc, [[1, 2]])).toEqual([[2, 2, 'w']]); // from the cell to the left
    expect(edgesInCells(doc, [[2, 2]])).toEqual([[2, 2, 'n'], [2, 2, 'w']]);
  });

  it('nodeAt ignores terrain, docBounds and refreshTerrainBounds include it', () => {
    const doc = emptyDoc();
    paintCells(doc, 'water', [[3, 3]], grid);
    expect(nodeAt(doc, 200, 200)).toBeNull();
    expect(docBounds(doc)).toEqual({ minX: 192, minY: 192, maxX: 256, maxY: 256 });
    refreshTerrainBounds(doc, { cellSize: 32, offsetX: 10, offsetY: 0 });
    expect(docBounds(doc)).toEqual({ minX: 106, minY: 96, maxX: 138, maxY: 128 });
  });

  it('terrain nodes pass validateCanvas and survive serialization', () => {
    const doc = emptyDoc();
    paintCells(doc, 'lava', [[0, 0]], grid);
    const back = validateCanvas(JSON.parse(serialize(doc)));
    expect(back.ok).toBe(true);
    expect(terrainNode(back.doc, 'lava')[EXT].cells).toEqual([[0, 0]]);
  });
});
