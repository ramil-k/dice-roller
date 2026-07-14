import { describe, it, expect } from 'vitest';
import { EXT, emptyDoc, getExt, addNode, removeNode, makeToken, makeStroke } from '../src/battle-mat/canvas-doc.js';
import {
  combatants,
  getInitiative,
  setInitiative,
  getHp,
  getHpMax,
  setHp,
  getAc,
  setAc,
  getInitMod,
  turnOrder,
  nextTurn,
  resetCombat,
} from '../src/battle-mat/combat.js';

function encounter() {
  const doc = emptyDoc();
  const a = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'Aria' }));
  const b = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'Bors' }));
  const w = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'Wolf', tokenKind: 'monster' }));
  addNode(doc, makeStroke({ shape: 'pen', points: [[0, 0], [5, 5]] }));
  return { doc, a, b, w };
}

describe('combatants', () => {
  it('returns only token nodes', () => {
    const { doc } = encounter();
    expect(combatants(doc)).toHaveLength(3);
    expect(combatants(doc).every((n) => n[EXT].kind === 'token')).toBe(true);
  });
});

describe('initiative', () => {
  it('defaults to null and round-trips through setInitiative', () => {
    const { doc, a } = encounter();
    expect(getInitiative(a)).toBeNull();
    expect(setInitiative(doc, a.id, 17)).toBe(true);
    expect(getInitiative(a)).toBe(17);
  });

  it('clears initiative on non-numeric input and rejects non-tokens', () => {
    const { doc, a } = encounter();
    setInitiative(doc, a.id, 12);
    setInitiative(doc, a.id, '');
    expect(getInitiative(a)).toBeNull();
    const stroke = doc.nodes.find((n) => n[EXT]?.kind === 'stroke');
    expect(setInitiative(doc, stroke.id, 5)).toBe(false);
    expect(setInitiative(doc, 'missing', 5)).toBe(false);
  });
});

describe('turnOrder', () => {
  it('sorts by initiative descending with unrolled combatants last', () => {
    const { doc, a, b, w } = encounter();
    setInitiative(doc, b.id, 8);
    setInitiative(doc, w.id, 15);
    expect(turnOrder(doc).map((n) => n[EXT].name)).toEqual(['Wolf', 'Bors', 'Aria']);
  });

  it('breaks ties by name for a stable order', () => {
    const { doc, a, b, w } = encounter();
    for (const t of [a, b, w]) setInitiative(doc, t.id, 10);
    expect(turnOrder(doc).map((n) => n[EXT].name)).toEqual(['Aria', 'Bors', 'Wolf']);
  });
});

describe('nextTurn', () => {
  it('walks the order and increments the round on wrap', () => {
    const { doc, a, b, w } = encounter();
    setInitiative(doc, a.id, 20);
    setInitiative(doc, b.id, 10);
    setInitiative(doc, w.id, 15);
    const combat = getExt(doc).combat;
    expect(combat.round).toBe(1);
    expect(nextTurn(doc)[EXT].name).toBe('Aria');
    expect(nextTurn(doc)[EXT].name).toBe('Wolf');
    expect(nextTurn(doc)[EXT].name).toBe('Bors');
    expect(combat.round).toBe(1);
    expect(nextTurn(doc)[EXT].name).toBe('Aria');
    expect(combat.round).toBe(2);
  });

  it('recovers when the active combatant was deleted from the mat', () => {
    const { doc, a, b } = encounter();
    setInitiative(doc, a.id, 20);
    setInitiative(doc, b.id, 10);
    nextTurn(doc); // Aria active
    removeNode(doc, a.id);
    const next = nextTurn(doc);
    expect(next[EXT].name).toBe('Bors');
    expect(getExt(doc).combat.round).toBe(1); // recovery is not a wrap
  });

  it('returns null for an empty encounter', () => {
    expect(nextTurn(emptyDoc())).toBeNull();
  });
});

describe('resetCombat', () => {
  it('resets round and active combatant but keeps initiatives', () => {
    const { doc, a } = encounter();
    setInitiative(doc, a.id, 20);
    nextTurn(doc);
    nextTurn(doc);
    resetCombat(doc);
    const combat = getExt(doc).combat;
    expect(combat).toEqual({ round: 1, activeNodeId: null });
    expect(getInitiative(a)).toBe(20);
  });
});

describe('combat stats (hp / ac / initMod)', () => {
  it('makeToken stores provided stats and skips absent ones', () => {
    const doc = emptyDoc();
    const t = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'W', hp: 11, hpMax: 11, ac: 13, initMod: -1 }));
    const bare = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'B' }));
    expect(getHp(t)).toBe(11);
    expect(getHpMax(t)).toBe(11);
    expect(getAc(t)).toBe(13);
    expect(getInitMod(t)).toBe(-1);
    expect(getHp(bare)).toBeNull();
    expect(getAc(bare)).toBeNull();
    expect(getInitMod(bare)).toBeNull();
    expect('hp' in bare[EXT]).toBe(false);
  });

  it('setHp / setAc round-trip and a cleared input clears, not zeroes', () => {
    const { doc, a } = encounter();
    expect(setHp(doc, a.id, '7')).toBe(true);
    expect(getHp(a)).toBe(7);
    setHp(doc, a.id, '');
    expect(getHp(a)).toBeNull();
    expect('hp' in a[EXT]).toBe(false);
    setAc(doc, a.id, 15);
    expect(getAc(a)).toBe(15);
    setAc(doc, a.id, null);
    expect(getAc(a)).toBeNull();
  });

  it('setters reject non-tokens and unknown ids', () => {
    const { doc } = encounter();
    const stroke = doc.nodes.find((n) => n[EXT]?.kind === 'stroke');
    expect(setHp(doc, stroke.id, 5)).toBe(false);
    expect(setAc(doc, 'missing', 5)).toBe(false);
  });
});

describe('combat extension defaults', () => {
  it('emptyDoc and getExt provide combat state', () => {
    expect(emptyDoc()[EXT].combat).toEqual({ round: 1, activeNodeId: null });
    const foreign = { nodes: [], edges: [] };
    expect(getExt(foreign).combat).toEqual({ round: 1, activeNodeId: null });
  });
});
