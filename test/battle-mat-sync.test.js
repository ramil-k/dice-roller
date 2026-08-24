// The sync bridge: plain JSON Canvas doc <-> Y.Doc. Pure logic - no network,
// replication is simulated by exchanging Yjs updates between two docs.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EXT, emptyDoc, makeToken } from '../src/battle-mat/canvas-doc.js';
import { hasContent, materializeDoc, pushDoc } from '../src/battle-mat/sync.js';

const sampleDoc = () => {
  const doc = emptyDoc();
  const a = makeToken({ x: 64, y: 64, url: 'a.png', name: 'Bakhit', hp: 12, hpMax: 12 });
  a.id = 'tok-a';
  const b = makeToken({ x: 128, y: 0, url: 'b.png', name: 'Goblin', tokenKind: 'monster', hp: 7 });
  b.id = 'tok-b';
  doc.nodes.push(a, b);
  doc[EXT].grid.cellSize = 50;
  doc[EXT].combat.round = 3;
  return doc;
};

const replicate = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
const syncBoth = (y1, y2) => {
  replicate(y1, y2);
  replicate(y2, y1);
};

describe('battle-mat sync bridge', () => {
  it('round-trips a doc through the Y.Doc', () => {
    const doc = sampleDoc();
    const ydoc = new Y.Doc();
    expect(hasContent(ydoc)).toBe(false);
    pushDoc(ydoc, doc, null);
    expect(hasContent(ydoc)).toBe(true);

    const out = materializeDoc(ydoc, { viewport: { x: 5, y: 6, zoom: 2 } });
    expect(out.nodes.map((n) => n.id)).toEqual(['tok-a', 'tok-b']);
    expect(out.nodes[0][EXT].name).toBe('Bakhit');
    expect(out.nodes[0].x).toBe(64);
    expect(out[EXT].grid.cellSize).toBe(50);
    expect(out[EXT].combat.round).toBe(3);
    expect(out[EXT].viewport).toEqual({ x: 5, y: 6, zoom: 2 }); // caller's, not synced
  });

  it('merges concurrent edits to different fields without losing either', () => {
    const y1 = new Y.Doc();
    const y2 = new Y.Doc();
    const base = sampleDoc();
    pushDoc(y1, base, null);
    replicate(y1, y2);

    // replica 1 moves tok-a; replica 2 damages tok-b - concurrently
    const doc1 = materializeDoc(y1, {});
    const moved = structuredClone(doc1);
    moved.nodes.find((n) => n.id === 'tok-a').x = 640;
    pushDoc(y1, moved, doc1);

    const doc2 = materializeDoc(y2, {});
    const hurt = structuredClone(doc2);
    hurt.nodes.find((n) => n.id === 'tok-b')[EXT].hp = 1;
    pushDoc(y2, hurt, doc2);

    syncBoth(y1, y2);
    for (const y of [y1, y2]) {
      const out = materializeDoc(y, {});
      expect(out.nodes.find((n) => n.id === 'tok-a').x).toBe(640);
      expect(out.nodes.find((n) => n.id === 'tok-b')[EXT].hp).toBe(1);
    }
  });

  it('propagates deletions and added nodes', () => {
    const y1 = new Y.Doc();
    const y2 = new Y.Doc();
    const base = sampleDoc();
    pushDoc(y1, base, null);
    replicate(y1, y2);

    const doc1 = materializeDoc(y1, {});
    const removed = structuredClone(doc1);
    removed.nodes = removed.nodes.filter((n) => n.id !== 'tok-b');
    pushDoc(y1, removed, doc1);

    const doc2 = materializeDoc(y2, {});
    const added = structuredClone(doc2);
    const c = makeToken({ x: 0, y: 0, url: 'c.png', name: 'Wolf' });
    c.id = 'tok-c';
    added.nodes.push(c);
    pushDoc(y2, added, doc2);

    syncBoth(y1, y2);
    const ids = materializeDoc(y1, {}).nodes.map((n) => n.id);
    expect(ids).toContain('tok-c');
    expect(ids).not.toContain('tok-b');
  });

  it('keeps node order stable across replicas via ext.seq', () => {
    const y1 = new Y.Doc();
    const doc = sampleDoc();
    pushDoc(y1, doc, null);
    // seq was assigned back into the plain doc
    expect(doc.nodes.map((n) => n[EXT].seq)).toEqual([1, 2]);

    const y2 = new Y.Doc();
    replicate(y1, y2);
    expect(materializeDoc(y2, {}).nodes.map((n) => n.id)).toEqual(['tok-a', 'tok-b']);
  });

  it('meta edits merge with node edits', () => {
    const y1 = new Y.Doc();
    const y2 = new Y.Doc();
    const base = sampleDoc();
    pushDoc(y1, base, null);
    replicate(y1, y2);

    const doc1 = materializeDoc(y1, {});
    const next1 = structuredClone(doc1);
    next1[EXT].combat.round = 4;
    next1[EXT].combat.activeNodeId = 'tok-b';
    pushDoc(y1, next1, doc1);

    const doc2 = materializeDoc(y2, {});
    const next2 = structuredClone(doc2);
    next2[EXT].grid.cellSize = 70;
    pushDoc(y2, next2, doc2);

    syncBoth(y1, y2);
    const out = materializeDoc(y2, {});
    expect(out[EXT].combat.round).toBe(4);
    expect(out[EXT].combat.activeNodeId).toBe('tok-b');
    expect(out[EXT].grid.cellSize).toBe(70);
  });
});
