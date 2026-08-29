// The sync bridge: plain JSON Canvas doc <-> Y.Doc. Pure logic - no network,
// replication is simulated by exchanging Yjs updates between two docs.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EXT, emptyDoc, makeImage, makeToken } from '../src/battle-mat/canvas-doc.js';
import {
  dataImageNodes,
  displayName,
  hasContent,
  imageUrl,
  isDataImage,
  materializeDoc,
  parseRoomHash,
  pushDoc,
} from '../src/battle-mat/sync.js';

const sampleDoc = () => {
  const doc = emptyDoc();
  const a = makeToken({ x: 64, y: 64, url: 'a.png', name: 'Bakhit', hp: 12, hpMax: 12 });
  a.id = 'tok-a';
  const b = makeToken({ x: 128, y: 0, url: 'b.png', name: 'Goblin', tokenKind: 'monster', hp: 7 });
  b.id = 'tok-b';
  const map = makeImage({ x: 0, y: 0, width: 800, height: 600, url: 'map.png' });
  map.id = 'img-map';
  doc.nodes.push(a, b, map);
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
    expect(out.nodes.map((n) => n.id)).toEqual(['tok-a', 'tok-b', 'img-map']);
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

  it('a peer that receives a deletion does not resurrect the node on its next push', () => {
    const y1 = new Y.Doc();
    const y2 = new Y.Doc();
    const base = sampleDoc();
    pushDoc(y1, base, null);
    replicate(y1, y2);
    const doc1 = materializeDoc(y1, {});
    const doc2 = materializeDoc(y2, {}); // replica 2's synced snapshot

    // replica 1 removes tok-b; the deletion reaches replica 2
    const removed = structuredClone(doc1);
    removed.nodes = removed.nodes.filter((n) => n.id !== 'tok-b');
    pushDoc(y1, removed, doc1);
    replicate(y1, y2);

    // replica 2 pushes its (still old) plain doc before materializing the
    // remote change - exactly what the live bridge does on every remote update.
    // Its own pending edit to tok-a must go through; tok-b must stay gone.
    const stale = structuredClone(doc2);
    stale.nodes.find((n) => n.id === 'tok-a')[EXT].hp = 3;
    const ops = [];
    pushDoc(y2, stale, doc2, ops);
    expect(ops.some((op) => op.startsWith('add node'))).toBe(false);

    syncBoth(y1, y2);
    for (const y of [y1, y2]) {
      const out = materializeDoc(y, {});
      expect(out.nodes.map((n) => n.id)).toEqual(['tok-a', 'img-map']);
      expect(out.nodes[0][EXT].hp).toBe(3);
    }
  });

  it('keeps node order stable across replicas via ext.seq', () => {
    const y1 = new Y.Doc();
    const doc = sampleDoc();
    pushDoc(y1, doc, null);
    // seq was assigned back into the plain doc
    expect(doc.nodes.map((n) => n[EXT].seq)).toEqual([1, 2, 3]);

    const y2 = new Y.Doc();
    replicate(y1, y2);
    expect(materializeDoc(y2, {}).nodes.map((n) => n.id)).toEqual(['tok-a', 'tok-b', 'img-map']);
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

  it('image lock and size are separate fields: a lock and a resize merge', () => {
    const y1 = new Y.Doc();
    const y2 = new Y.Doc();
    const base = sampleDoc();
    pushDoc(y1, base, null);
    replicate(y1, y2);

    // replica 1 pins the map down while replica 2 is still resizing it
    const doc1 = materializeDoc(y1, {});
    const locked = structuredClone(doc1);
    locked.nodes.find((n) => n.id === 'img-map')[EXT].locked = true;
    pushDoc(y1, locked, doc1);

    const doc2 = materializeDoc(y2, {});
    const resized = structuredClone(doc2);
    Object.assign(resized.nodes.find((n) => n.id === 'img-map'), { x: -40, y: -30, width: 1000, height: 750 });
    pushDoc(y2, resized, doc2);

    syncBoth(y1, y2);
    for (const y of [y1, y2]) {
      const img = materializeDoc(y, {}).nodes.find((n) => n.id === 'img-map');
      expect(img[EXT].locked).toBe(true);
      expect([img.x, img.y, img.width, img.height]).toEqual([-40, -30, 1000, 750]);
    }

    // unlocking deletes the key rather than writing false
    const doc1b = materializeDoc(y1, {});
    const unlocked = structuredClone(doc1b);
    delete unlocked.nodes.find((n) => n.id === 'img-map')[EXT].locked;
    pushDoc(y1, unlocked, doc1b);
    replicate(y1, y2);
    const img2 = materializeDoc(y2, {}).nodes.find((n) => n.id === 'img-map');
    expect('locked' in img2[EXT]).toBe(false);
  });
});

describe('images by link', () => {
  it('finds only the nodes whose picture is still inline', () => {
    const doc = sampleDoc();
    const inline = makeImage({ x: 0, y: 0, width: 10, height: 10, url: 'data:image/png;base64,AAAA' });
    inline.id = 'img-inline';
    const tokenInline = makeToken({ x: 0, y: 0, url: 'data:image/jpeg;base64,BBBB', name: 'Selfie' });
    tokenInline.id = 'tok-inline';
    doc.nodes.push(inline, tokenInline);
    expect(dataImageNodes(doc).map((n) => n.id)).toEqual(['img-inline', 'tok-inline']);
    expect(dataImageNodes({ nodes: [] })).toEqual([]);
    expect(isDataImage('https://x/y.png')).toBe(false);
    expect(isDataImage('data:text/plain,hi')).toBe(false);
    expect(isDataImage(undefined)).toBe(false);
  });

  it('builds the image URL from the server base and the returned path', () => {
    expect(imageUrl('https://sync.example:9443', '/rooms/brave-otter-4821/images/abc.png')).toBe(
      'https://sync.example:9443/rooms/brave-otter-4821/images/abc.png',
    );
    expect(imageUrl('https://sync.example:9443/', '/rooms/r/images/a.jpg')).toBe('https://sync.example:9443/rooms/r/images/a.jpg');
  });
});

describe('invite-link hash', () => {
  it('parses valid room hashes', () => {
    expect(parseRoomHash('#bm-room=brave-otter-4821')).toBe('brave-otter-4821');
    expect(parseRoomHash('#bm-room=silent-basilisk-8900')).toBe('silent-basilisk-8900');
    expect(parseRoomHash('#bm-room=%20brave-otter-4821%20')).toBe('brave-otter-4821');
  });

  it('rejects anything else', () => {
    for (const bad of ['', '#', '#toc-anchor', '#bm-room=', '#bm-room=UPPER-case-1234', '#bm-room=a-b-12', '#bm-room=../etc', null, undefined]) {
      expect(parseRoomHash(bad)).toBe(null);
    }
  });
});

describe('player display name', () => {
  const adjectives = ['Reckless', 'Sneaky'];

  it('prefixes the name with the adjective picked by client id', () => {
    expect(displayName('Ramil', 1, { adjectives })).toBe('Sneaky Ramil');
  });

  it('shows the generic word in place of a missing name', () => {
    expect(displayName(null, 0, { adjectives, word: 'игрок' })).toBe('Reckless игрок');
    expect(displayName('   ', 0, { adjectives, word: 'игрок' })).toBe('Reckless игрок');
    expect(displayName(null, 0, { adjectives })).toBe('Reckless Player');
  });

  it('numbers nameless players when there are no adjectives', () => {
    expect(displayName(null, 5, { word: 'игрок' })).toBe('игрок 15');
    expect(displayName('Ramil', 5)).toBe('Ramil');
  });
});
