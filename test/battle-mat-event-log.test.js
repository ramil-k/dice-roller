// The combat journal's pure parts: canvas doc snapshots -> events, roll
// results -> events, and the copies of sync.js constants it carries so a
// page can log without loading the yjs chunk.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXT, emptyDoc, addNode, makeToken, getExt } from '../src/battle-mat/canvas-doc.js';
import {
  addCombatant,
  clearCombat,
  nextTurn,
  removeCombatant,
  renameCombatant,
  resetCombat,
  setHp,
  setInitiative,
} from '../src/battle-mat/combat.js';
import * as sync from '../src/battle-mat/sync.js';
import {
  DEFAULT_SERVER,
  PROFILE_KEY,
  SYNC_KEY,
  USER_COLORS,
  combatSnapshot,
  diffDocs,
  diffSnapshots,
  displayName,
  localIdentity,
  readSyncConfig,
  rollEvent,
} from '../src/battle-mat/event-log.js';

const clone = (doc) => structuredClone(doc);

const fight = () => {
  const doc = emptyDoc();
  const hero = makeToken({ x: 0, y: 0, url: 'a.png', name: 'Bakhit', hp: 12, hpMax: 12, ac: 15 });
  hero.id = 'hero';
  const goblin = makeToken({ x: 64, y: 0, url: 'g.png', name: 'Goblin', tokenKind: 'monster', hp: 7, hpMax: 7 });
  goblin.id = 'goblin';
  addNode(doc, hero);
  addNode(doc, goblin);
  return doc;
};

describe('diffDocs', () => {
  it('is empty for an unchanged doc and ignores non-combat edits', () => {
    const doc = fight();
    expect(diffDocs(doc, clone(doc))).toEqual([]);
    const moved = clone(doc);
    moved.nodes[0].x = 128;
    moved[EXT].grid.cellSize = 50;
    expect(diffDocs(doc, moved)).toEqual([]);
  });

  it('reports added combatants with their stats (reserve ones too)', () => {
    const before = emptyDoc();
    const after = clone(before);
    const t = addCombatant(after, { name: 'Wolf', kind: 'monster', hp: 11, ac: 13 });
    expect(diffDocs(before, after)).toEqual([
      { type: 'token-add', data: { nodeId: t.id, name: 'Wolf', kind: 'monster', hp: 11, hpMax: 11, ac: 13 } },
    ]);
    // a registry icon without stats
    const plain = clone(after);
    addNode(plain, { ...makeToken({ x: 0, y: 0, url: 'u', name: 'Barrel' }), id: 'barrel' });
    expect(diffDocs(after, plain)).toEqual([{ type: 'token-add', data: { nodeId: 'barrel', name: 'Barrel', kind: 'player' } }]);
  });

  it('reports hp, initiative and renames per token, in token order', () => {
    const before = fight();
    const after = clone(before);
    setHp(after, 'goblin', 2);
    setInitiative(after, 'hero', 18);
    renameCombatant(after, 'goblin', 'Grik');
    expect(diffDocs(before, after)).toEqual([
      { type: 'initiative', data: { nodeId: 'hero', name: 'Bakhit', value: 18 } },
      { type: 'rename', data: { nodeId: 'goblin', from: 'Goblin', to: 'Grik' } },
      { type: 'hp', data: { nodeId: 'goblin', name: 'Grik', from: 7, to: 2 } },
    ]);
    // a cleared field reads as null, not 0
    const cleared = clone(after);
    setHp(cleared, 'goblin', '');
    expect(diffDocs(after, cleared)).toEqual([{ type: 'hp', data: { nodeId: 'goblin', name: 'Grik', from: 2, to: null } }]);
  });

  it('reports turns with the active name and a new round', () => {
    const before = fight();
    setInitiative(before, 'hero', 18);
    setInitiative(before, 'goblin', 5);
    const after = clone(before);
    nextTurn(after);
    expect(diffDocs(before, after)).toEqual([{ type: 'turn', data: { round: 1, activeNodeId: 'hero', activeName: 'Bakhit' } }]);
    const third = clone(after);
    nextTurn(third);
    nextTurn(third); // wraps: round 2, hero again
    expect(diffDocs(after, third)).toEqual([{ type: 'turn', data: { round: 2, activeNodeId: 'hero', activeName: 'Bakhit' } }]);
  });

  it('reports a reset as combat-reset, and the tracker Reset as removals plus reset', () => {
    const before = fight();
    getExt(before).combat.round = 3;
    getExt(before).combat.activeNodeId = 'goblin';
    const reset = clone(before);
    resetCombat(reset);
    expect(diffDocs(before, reset)).toEqual([{ type: 'combat-reset', data: {} }]);

    const ended = clone(before);
    clearCombat(ended);
    expect(diffDocs(before, ended)).toEqual([
      { type: 'token-remove', data: { nodeId: 'hero', name: 'Bakhit' } },
      { type: 'token-remove', data: { nodeId: 'goblin', name: 'Goblin' } },
      { type: 'combat-reset', data: {} },
    ]);
    // nothing to reset on a fresh encounter: just the removals
    const fresh = fight();
    const cleared = clone(fresh);
    clearCombat(cleared);
    expect(diffDocs(fresh, cleared).map((e) => e.type)).toEqual(['token-remove', 'token-remove']);
  });

  it('removing the active combatant logs the removal and the turn pointer clearing', () => {
    const before = fight();
    getExt(before).combat.round = 2;
    getExt(before).combat.activeNodeId = 'goblin';
    const after = clone(before);
    removeCombatant(after, 'goblin');
    expect(diffDocs(before, after)).toEqual([
      { type: 'token-remove', data: { nodeId: 'goblin', name: 'Goblin' } },
      { type: 'turn', data: { round: 2, activeNodeId: null, activeName: null } },
    ]);
  });

  it('works on snapshots directly and tolerates a missing doc', () => {
    const snap = combatSnapshot(fight());
    expect([...snap.tokens.keys()]).toEqual(['hero', 'goblin']);
    expect(snap).toMatchObject({ round: 1, activeNodeId: null });
    expect(diffSnapshots(combatSnapshot(null), snap).map((e) => e.type)).toEqual(['token-add', 'token-add']);
  });
});

describe('rollEvent', () => {
  const d20 = (...values) => ({
    total: values.reduce((a, b) => a + b, 0) + 5,
    formula: `${values.length}d20+5`,
    terms: [
      { type: 'dice', sign: 1, count: values.length, sides: 20, rolls: values.map((value) => ({ value, sides: 20, kept: true })) },
      { type: 'mod', sign: 1, value: 5 },
    ],
  });

  it('keeps the formula, the total, the kept faces and a label', () => {
    expect(rollEvent(d20(12), { label: ' attack ' })).toEqual({
      type: 'roll',
      data: { formula: '1d20+5', total: 17, faces: [12], label: 'attack' },
    });
    expect(rollEvent(d20(7)).data.label).toBeUndefined();
  });

  it('drops dropped dice and flags natural 20 / 1 like dice.js', () => {
    const adv = d20(1, 20);
    adv.terms[0].rolls[0].kept = false;
    expect(rollEvent(adv).data).toMatchObject({ faces: [20], crit: 'success' });
    expect(rollEvent(d20(1)).data.crit).toBe('failure');
    expect(rollEvent(d20(1, 20)).data.crit).toBe('success'); // success wins
    const minus = d20(20);
    minus.terms[0].sign = -1;
    expect(rollEvent(minus).data.crit).toBeUndefined();
  });
});

describe('the copies of sync.js settings', () => {
  it('agree with sync.js', () => {
    expect(SYNC_KEY).toBe(sync.SYNC_KEY);
    expect(PROFILE_KEY).toBe(sync.PROFILE_KEY);
    expect(DEFAULT_SERVER).toBe(sync.DEFAULT_SERVER);
    expect(USER_COLORS).toEqual(sync.USER_COLORS);
    const adjectives = ['Reckless', 'Sly'];
    for (const [name, seed] of [['Ramil', 3], ['', 7], ['  Аня ', 10], [null, 4]]) {
      expect(displayName(name, seed, { adjectives, word: 'игрок' })).toBe(sync.displayName(name, seed, { adjectives, word: 'игрок' }));
      expect(displayName(name, seed)).toBe(sync.displayName(name, seed));
    }
  });
});

describe('readSyncConfig / localIdentity', () => {
  const storage = (init = {}) => {
    const map = new Map(Object.entries(init));
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      map,
    };
  };

  afterEach(() => vi.restoreAllMocks());

  it('reads the room with the default server, null without a room', () => {
    expect(readSyncConfig(storage())).toBeNull();
    expect(readSyncConfig(storage({ [SYNC_KEY]: '{"room":""}' }))).toBeNull();
    expect(readSyncConfig(storage({ [SYNC_KEY]: '{"room":"brave-otter-1234"}' }))).toEqual({ server: DEFAULT_SERVER, room: 'brave-otter-1234' });
    expect(readSyncConfig(storage({ [SYNC_KEY]: '{"room":"r-r-0001","server":"http://localhost:3000"}' })).server).toBe('http://localhost:3000');
    expect(readSyncConfig(storage({ [SYNC_KEY]: '{bad' }))).toBeNull();
  });

  it('takes name and color from the profile, falls back to tg-login and the seed color', () => {
    const s = storage({ [PROFILE_KEY]: JSON.stringify({ name: 'Ramil', color: '#58b7d8', seed: 5 }) });
    expect(localIdentity(s, { adjectives: ['Sly'], word: 'Player' })).toEqual({ name: 'Sly Ramil', color: '#58b7d8' });
    const tg = storage({ [PROFILE_KEY]: JSON.stringify({ seed: 1 }), 'dnd-tg-user': JSON.stringify({ first_name: 'Аня' }) });
    expect(localIdentity(tg, { adjectives: [], word: 'Player' })).toEqual({ name: 'Аня', color: USER_COLORS[1] });
    // no seed yet: one is drawn and stored, so sync.js reuses it later
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fresh = storage();
    const id = localIdentity(fresh, { adjectives: [], word: 'Player' });
    const stored = JSON.parse(fresh.map.get(PROFILE_KEY));
    expect(stored.seed).toBe(2 ** 30);
    expect(id).toEqual({ name: `Player ${(2 ** 30 % 90) + 10}`, color: USER_COLORS[2 ** 30 % USER_COLORS.length] });
  });
});
