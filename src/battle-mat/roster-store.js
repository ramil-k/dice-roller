// Persistent token pool ("who is available for this battle") shared by
// <add-to-battle> buttons and the battle mat's token pool. Entries are
// *instances*, not types: clicking "add to battle" twice yields two wolves,
// and the second one gets a random adjective ("Reckless Wolf") so the DM can
// tell them apart on the mat and in the initiative tracker.
//
// Same architecture as the encounter store in store.js: one in-memory
// instance per storage key (module-level registry — every chunk that imports
// this module shares it), subscribers notified on every change, cross-tab
// sync via the `storage` event, and injectable storage for tests. All
// storage access is try/catch'd — the pool keeps working in-memory when
// localStorage is unavailable or full.
//
// Entry shape: { id, baseName, adjective|null, name, image, kind, size, hp,
// ac, initMod } where `name` is the precomputed display name and kind is
// 'player' | 'monster'. hp/ac/initMod are numbers or absent; size is a D&D
// size word (tiny…gargantuan). All of them are copied onto the token when it
// is placed on the mat — size decides how many grid cells the token spans
// (SIZE_CELLS in canvas-doc.js).
//
// DOM-free (except the storage listener); covered by
// test/battle-mat-roster-store.test.js.

import { newId } from './canvas-doc.js';

export const DEFAULT_ROSTER_KEY = 'battle-mat-roster';

export function loadRoster(key = DEFAULT_ROSTER_KEY, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e === 'object' && typeof e.name === 'string' && typeof e.id === 'string');
  } catch {
    return [];
  }
}

function saveRoster(key, entries, storage) {
  try {
    storage.setItem(key, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

const stores = new Map();

// The shared pool store, one instance per storage key. Options are honored
// only by the call that creates the store (tests use unique keys and a stub
// storage).
export function getRosterStore(key = DEFAULT_ROSTER_KEY, { storage = globalThis.localStorage } = {}) {
  let store = stores.get(key);
  if (store) return store;

  let entries = loadRoster(key, storage);
  const subscribers = new Set();
  const notify = () => {
    for (const fn of [...subscribers]) fn();
    // a DOM-level echo for the eager half of <add-to-battle>: its badge
    // tracks the pool without pulling this chunk in (it re-reads storage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('battle-mat-roster-change', { detail: { key } }));
    }
  };
  const commit = () => {
    saveRoster(key, entries, storage);
    notify();
  };

  store = {
    key,
    get entries() {
      return entries;
    },

    // Add one instance of a type ({name, image, kind, hp, ac, initMod}).
    // The first living instance keeps the plain name; later ones get a
    // random unused adjective from `adjectives`, falling back to a numeric
    // suffix when the list runs dry (or was never provided).
    add(type, { adjectives = [] } = {}) {
      const baseName = type.name ?? 'Token';
      const kind = type.kind === 'monster' ? 'monster' : 'player';
      const siblings = entries.filter((e) => e.baseName === baseName && e.kind === kind);
      let adjective = null;
      let name = baseName;
      if (siblings.length) {
        const used = new Set(siblings.map((e) => e.adjective).filter(Boolean));
        const free = adjectives.filter((a) => !used.has(a));
        if (free.length) {
          adjective = free[Math.floor(Math.random() * free.length)];
          name = `${adjective} ${baseName}`;
        } else {
          name = `${baseName} ${siblings.length + 1}`;
        }
      }
      const instance = { id: newId(), baseName, adjective, name, kind };
      if (type.image != null) instance.image = type.image;
      if (typeof type.size === 'string' && type.size) instance.size = type.size;
      for (const f of ['hp', 'ac', 'initMod']) {
        const v = Number(type[f]);
        if (Number.isFinite(v)) instance[f] = v;
      }
      entries = [...entries, instance];
      commit();
      return instance;
    },

    remove(id) {
      const next = entries.filter((e) => e.id !== id);
      if (next.length === entries.length) return false;
      entries = next;
      commit();
      return true;
    },

    countOf(baseName, kind = 'player') {
      return entries.filter((e) => e.baseName === baseName && e.kind === kind).length;
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  // Cross-tab sync: `storage` fires in *other* tabs when this key is written.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== key) return;
      entries = loadRoster(key, storage);
      notify();
    });
  }

  stores.set(key, store);
  return store;
}
