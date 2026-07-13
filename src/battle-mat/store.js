// Battle-mat persistence and the shared per-key encounter store.
//
// Several components edit the same encounter document — the battle mat and
// the initiative tracker — so the document must have exactly one in-memory
// instance and one autosaver per storage key. `getStore(key)` provides that:
// ES modules are evaluated once per URL, so every chunk that imports this
// module (the mat overlay, the tracker panel) gets the same module-level
// registry and therefore the same store object. Components mutate the doc,
// call `commit()`, and react to each other through `subscribe`.
//
// Subscribers receive one of:
//   { type: 'change', full: false }   — nodes changed in place (re-render)
//   { type: 'change', full: true }    — the doc object was replaced (import,
//                                       clear, another tab wrote the key) —
//                                       re-read grid/viewport/combat too
//   { type: 'save-result', ok }       — an autosave write happened
//
// All storage access is try/catch'd, same as the roll log in roll-dice.js —
// localStorage can be unavailable (private browsing) or full
// (QuotaExceededError, likely here because attached map images are stored as
// data URIs), and the mat must keep working in-memory either way. `saveDoc`
// reports failure so the UI can suggest exporting to a file instead.
//
// Storage is injectable for tests (Node has no localStorage); covered by
// test/battle-mat-store.test.js.

import { validateCanvas, serialize, emptyDoc } from './canvas-doc.js';

export const DEFAULT_KEY = 'battle-mat-canvas';

export function loadDoc(key = DEFAULT_KEY, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const res = validateCanvas(JSON.parse(raw));
    return res.ok ? res.doc : null;
  } catch {
    return null;
  }
}

export function saveDoc(key, doc, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, serialize(doc));
    return true;
  } catch {
    return false;
  }
}

// Debounced autosave: `schedule(doc)` records the latest doc and arms a
// timer; rapid edits coalesce into one write. `flush()` saves immediately
// (used on overlay close) and reports the result; with nothing pending it
// counts as success. `onResult` hears about every actual write so the UI can
// surface quota failures.
export function createAutosaver(key, { delay = 500, storage = globalThis.localStorage, onResult } = {}) {
  let timer = null;
  let pending = null;

  const write = () => {
    const doc = pending;
    pending = null;
    timer = null;
    const ok = saveDoc(key, doc, storage);
    if (onResult) onResult(ok);
    return ok;
  };

  return {
    schedule(doc) {
      pending = doc;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      return pending === null ? true : write();
    },
  };
}

const stores = new Map();

// The shared encounter store, one instance per storage key. Options are
// honored only by the call that creates the store (tests use unique keys and
// pass a stub storage).
export function getStore(key = DEFAULT_KEY, { storage = globalThis.localStorage, delay = 500 } = {}) {
  let store = stores.get(key);
  if (store) return store;

  let doc = loadDoc(key, storage) ?? emptyDoc();
  const subscribers = new Set();
  const notify = (event) => {
    for (const fn of [...subscribers]) fn(event);
  };
  const autosaver = createAutosaver(key, {
    delay,
    storage,
    onResult: (ok) => notify({ type: 'save-result', ok }),
  });

  store = {
    key,
    get doc() {
      return doc;
    },
    // Replace the whole document (import, clear). `persist: false` is for
    // externally-written state that is already in storage.
    setDoc(next, { persist = true } = {}) {
      doc = next;
      if (persist) autosaver.schedule(doc);
      notify({ type: 'change', full: true });
    },
    commit() {
      autosaver.schedule(doc);
      notify({ type: 'change', full: false });
    },
    save() {
      autosaver.schedule(doc);
    },
    flush() {
      return autosaver.flush();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  // Cross-tab sync: `storage` fires in *other* tabs when this key is written.
  // Last write wins; the freshly stored doc replaces the local one.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== key || e.newValue === null) return;
      const loaded = loadDoc(key, storage);
      if (loaded) store.setDoc(loaded, { persist: false });
    });
  }

  stores.set(key, store);
  return store;
}
