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
  baseNameOf,
  countOfType,
  addCombatant,
  turnOrder,
  nextTurn,
  resetCombat,
  removeCombatant,
  isPlaced,
  reserveCombatants,
  placeCombatant,
  renameCombatant,
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

describe('addCombatant', () => {
  const ADJ = ['Reckless', 'Sly', 'Grumpy'];
  // deterministic rand: always pick the first free adjective
  const first = () => 0;

  it('adds a token combatant with stats and size footprint', () => {
    const doc = emptyDoc();
    const t = addCombatant(
      doc,
      { name: 'Wolf', kind: 'monster', image: 'w.jpg', size: 'large', hp: 11, ac: 13, initMod: 2 },
      { cellSize: 64 },
    );
    expect(t[EXT].kind).toBe('token');
    expect(t[EXT].name).toBe('Wolf');
    expect(t[EXT].baseName).toBe('Wolf');
    expect(t[EXT].tokenKind).toBe('monster');
    expect(t.width).toBe(128); // large -> 2 cells
    expect(getHp(t)).toBe(11);
    expect(getHpMax(t)).toBe(11);
    expect(getAc(t)).toBe(13);
    expect(getInitMod(t)).toBe(2);
    expect(combatants(doc)).toHaveLength(1);
    // new combatants start off the map (tracker + Reserve pool only)
    expect(isPlaced(t)).toBe(false);
    expect(t[EXT].placed).toBe(false);
  });

  it('first instance is plain, later ones get an unused adjective', () => {
    const doc = emptyDoc();
    const a = addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ADJ, rand: first });
    const b = addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ADJ, rand: first });
    const c = addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ADJ, rand: first });
    expect(a[EXT].name).toBe('Wolf');
    expect(a[EXT].adjective).toBeUndefined();
    expect(b[EXT].name).toBe('Reckless Wolf'); // first free
    expect(c[EXT].name).toBe('Sly Wolf'); // Reckless now used -> next free
    expect(baseNameOf(c)).toBe('Wolf');
  });

  it('falls back to numeric suffixes once adjectives run dry', () => {
    const doc = emptyDoc();
    for (let i = 0; i < 3; i++) addCombatant(doc, { name: 'Rat', kind: 'monster' }, { adjectives: ['Sly'], rand: first });
    const names = combatants(doc).map((n) => n[EXT].name).sort();
    expect(names).toEqual(['Rat', 'Rat 3', 'Sly Rat']);
  });

  it('same name different kinds do not collide', () => {
    const doc = emptyDoc();
    addCombatant(doc, { name: 'Ghost', kind: 'monster' }, { adjectives: ADJ, rand: first });
    const p = addCombatant(doc, { name: 'Ghost', kind: 'player' }, { adjectives: ADJ, rand: first });
    expect(p[EXT].name).toBe('Ghost');
  });

  it('countOfType counts by base name and kind', () => {
    const doc = emptyDoc();
    addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ADJ, rand: first });
    addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ADJ, rand: first });
    addCombatant(doc, { name: 'Wolf', kind: 'player' }, { adjectives: ADJ, rand: first });
    expect(countOfType(doc, 'Wolf', 'monster')).toBe(2);
    expect(countOfType(doc, 'Wolf', 'player')).toBe(1);
    expect(countOfType(doc, 'Bear', 'monster')).toBe(0);
  });
});

describe('removeCombatant', () => {
  it('removes a token from the encounter', () => {
    const { doc, a } = encounter();
    expect(removeCombatant(doc, a.id)).toBe(true);
    expect(combatants(doc).some((n) => n.id === a.id)).toBe(false);
  });

  it('clears the turn pointer when the active combatant is removed', () => {
    const { doc, a } = encounter();
    setInitiative(doc, a.id, 20);
    nextTurn(doc); // a becomes active
    expect(getExt(doc).combat.activeNodeId).toBe(a.id);
    removeCombatant(doc, a.id);
    expect(getExt(doc).combat.activeNodeId).toBeNull();
  });

  it('leaves the turn pointer alone when removing a non-active combatant', () => {
    const { doc, a, b } = encounter();
    setInitiative(doc, a.id, 20);
    nextTurn(doc); // a active
    removeCombatant(doc, b.id);
    expect(getExt(doc).combat.activeNodeId).toBe(a.id);
  });
});

describe('reserve / placed model', () => {
  it('addCombatant leaves the token unplaced and in the reserve', () => {
    const doc = emptyDoc();
    const t = addCombatant(doc, { name: 'Wolf', kind: 'monster' });
    expect(isPlaced(t)).toBe(false);
    expect(reserveCombatants(doc)).toHaveLength(1);
    expect(reserveCombatants(doc)[0].id).toBe(t.id);
  });

  it('placeCombatant flips the flag, sets rounded coords, and drops it from the reserve', () => {
    const doc = emptyDoc();
    const t = addCombatant(doc, { name: 'Wolf', kind: 'monster' });
    expect(placeCombatant(doc, t.id, 63.4, 128.6)).toBe(true);
    expect(isPlaced(t)).toBe(true);
    expect(t.x).toBe(63);
    expect(t.y).toBe(129);
    expect(reserveCombatants(doc)).toHaveLength(0);
    // a placed combatant is still a combatant (shows in the tracker)
    expect(combatants(doc)).toHaveLength(1);
  });

  it('placeCombatant rejects non-tokens and unknown ids', () => {
    const { doc } = encounter();
    const stroke = doc.nodes.find((n) => n[EXT]?.kind === 'stroke');
    expect(placeCombatant(doc, stroke.id, 0, 0)).toBe(false);
    expect(placeCombatant(doc, 'missing', 0, 0)).toBe(false);
  });

  it('isPlaced treats a legacy token (no placed flag) as placed', () => {
    const doc = emptyDoc();
    // tokens created directly on the mat have no `placed` flag — they are on it
    const t = addNode(doc, makeToken({ x: 0, y: 0, url: 'u', name: 'Direct' }));
    expect(isPlaced(t)).toBe(true);
    expect(reserveCombatants(doc)).toHaveLength(0);
  });
});

describe('renameCombatant', () => {
  it('sets name and base name and drops the auto adjective', () => {
    const doc = emptyDoc();
    const a = addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ['Reckless'], rand: () => 0 });
    const b = addCombatant(doc, { name: 'Wolf', kind: 'monster' }, { adjectives: ['Reckless'], rand: () => 0 });
    expect(b[EXT].name).toBe('Reckless Wolf');
    expect(renameCombatant(doc, b.id, '  Alpha  ')).toBe(true);
    expect(b[EXT].name).toBe('Alpha');
    expect(b[EXT].baseName).toBe('Alpha');
    expect('adjective' in b[EXT]).toBe(false);
    // renaming freed the "Reckless" grouping — a new Wolf is plain again? No:
    // base names diverged, so the original Wolf stands alone
    expect(countOfType(doc, 'Wolf', 'monster')).toBe(1);
  });

  it('rejects an empty or whitespace name (keeps the old name)', () => {
    const doc = emptyDoc();
    const a = addCombatant(doc, { name: 'Wolf', kind: 'monster' });
    expect(renameCombatant(doc, a.id, '   ')).toBe(false);
    expect(a[EXT].name).toBe('Wolf');
  });

  it('rejects non-tokens and unknown ids', () => {
    const { doc } = encounter();
    const stroke = doc.nodes.find((n) => n[EXT]?.kind === 'stroke');
    expect(renameCombatant(doc, stroke.id, 'X')).toBe(false);
    expect(renameCombatant(doc, 'missing', 'X')).toBe(false);
  });
});

describe('combat extension defaults', () => {
  it('emptyDoc and getExt provide combat state', () => {
    expect(emptyDoc()[EXT].combat).toEqual({ round: 1, activeNodeId: null });
    const foreign = { nodes: [], edges: [] };
    expect(getExt(foreign).combat).toEqual({ round: 1, activeNodeId: null });
  });
});
