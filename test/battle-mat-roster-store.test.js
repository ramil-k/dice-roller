import { describe, it, expect } from 'vitest';
import { getRosterStore, loadRoster, DEFAULT_ROSTER_KEY } from '../src/battle-mat/roster-store.js';

// Minimal in-memory localStorage stand-in (Node has no localStorage).
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

let seq = 0;
const freshStore = (storage = memoryStorage()) => ({
  store: getRosterStore(`roster-test-${seq++}`, { storage }),
  storage,
});

const ADJ = ['Reckless', 'Sly', 'Grumpy'];

describe('getRosterStore basics', () => {
  it('is a per-key singleton', () => {
    const { store } = freshStore();
    expect(getRosterStore(store.key)).toBe(store);
  });

  it('adds instances and persists them', () => {
    const { store, storage } = freshStore();
    const wolf = store.add({ name: 'Wolf', kind: 'monster', image: 'w.jpg', hp: 11, ac: 13, initMod: 1, size: 'large' });
    expect(wolf).toMatchObject({ baseName: 'Wolf', name: 'Wolf', kind: 'monster', hp: 11, ac: 13, initMod: 1, size: 'large' });
    expect(wolf.adjective).toBeNull();
    const raw = loadRoster(store.key, storage);
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe(wolf.id);
  });

  it('coerces stats to numbers and drops the invalid ones', () => {
    const { store } = freshStore();
    const e = store.add({ name: 'Bat', kind: 'monster', hp: '5', ac: 'nope', initMod: '+2' });
    expect(e.hp).toBe(5);
    expect(e.initMod).toBe(2);
    expect('ac' in e).toBe(false);
  });

  it('keeps working in-memory when storage throws', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    const { store } = freshStore(storage);
    store.add({ name: 'Wolf', kind: 'monster' });
    expect(store.entries).toHaveLength(1);
  });

  it('loadRoster tolerates corrupt data', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{oops');
    expect(loadRoster('k', storage)).toEqual([]);
    storage.setItem('k', '[{"no":"name"},null,{"id":"1","name":"Ok","baseName":"Ok","kind":"monster"}]');
    expect(loadRoster('k', storage)).toHaveLength(1);
  });

  it('returns [] for the default key in Node (no localStorage)', () => {
    expect(loadRoster(DEFAULT_ROSTER_KEY)).toEqual([]);
  });
});

describe('instance naming', () => {
  it('first instance keeps the plain name, later ones get unused adjectives', () => {
    const { store } = freshStore();
    const first = store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ADJ });
    const second = store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ADJ });
    const third = store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ADJ });
    expect(first.name).toBe('Wolf');
    expect(ADJ).toContain(second.adjective);
    expect(third.adjective).not.toBe(second.adjective);
    expect(second.name).toBe(`${second.adjective} Wolf`);
  });

  it('falls back to numeric suffixes when adjectives run dry', () => {
    const { store } = freshStore();
    for (let i = 0; i < 4; i++) store.add({ name: 'Rat', kind: 'monster' }, { adjectives: ['Sly'] });
    const names = store.entries.map((e) => e.name).sort();
    expect(names).toEqual(['Rat', 'Rat 3', 'Rat 4', 'Sly Rat']);
  });

  it('same name with different kinds does not collide', () => {
    const { store } = freshStore();
    store.add({ name: 'Ghost', kind: 'monster' }, { adjectives: ADJ });
    const player = store.add({ name: 'Ghost', kind: 'player' }, { adjectives: ADJ });
    expect(player.name).toBe('Ghost');
  });

  it('a removed instance frees its adjective', () => {
    const { store } = freshStore();
    store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ['Sly'] });
    const sly = store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ['Sly'] });
    expect(sly.name).toBe('Sly Wolf');
    store.remove(sly.id);
    const again = store.add({ name: 'Wolf', kind: 'monster' }, { adjectives: ['Sly'] });
    expect(again.name).toBe('Sly Wolf');
  });
});

describe('remove / countOf / subscribe', () => {
  it('removes by id and reports misses', () => {
    const { store } = freshStore();
    const e = store.add({ name: 'Wolf', kind: 'monster' });
    expect(store.remove('nope')).toBe(false);
    expect(store.remove(e.id)).toBe(true);
    expect(store.entries).toHaveLength(0);
  });

  it('counts instances of a type', () => {
    const { store } = freshStore();
    store.add({ name: 'Wolf', kind: 'monster' });
    store.add({ name: 'Wolf', kind: 'monster' });
    store.add({ name: 'Wolf', kind: 'player' });
    expect(store.countOf('Wolf', 'monster')).toBe(2);
    expect(store.countOf('Wolf', 'player')).toBe(1);
    expect(store.countOf('Bear', 'monster')).toBe(0);
  });

  it('notifies subscribers on add and remove, and unsubscribes', () => {
    const { store } = freshStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const e = store.add({ name: 'Wolf', kind: 'monster' });
    store.remove(e.id);
    expect(calls).toBe(2);
    off();
    store.add({ name: 'Wolf', kind: 'monster' });
    expect(calls).toBe(2);
  });
});
