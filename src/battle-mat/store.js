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
import { dlog, caller, docSummary, vpOf } from './debug.js';

export const DEFAULT_KEY = 'battle-mat-canvas';

export function loadDoc(key = DEFAULT_KEY, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const res = validateCanvas(JSON.parse(raw));
    if (!res.ok) dlog('store', `loadDoc(${key}): stored doc rejected: ${res.error}`, { rawLength: raw.length });
    return res.ok ? res.doc : null;
  } catch (err) {
    dlog('store', `loadDoc(${key}) threw`, err);
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
    dlog('store', `autosave write ${ok ? 'ok' : 'FAILED'}`, docSummary(doc));
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
    // a DOM-level echo of document changes for lightweight listeners (the
    // <add-to-battle> instance badge) that don't hold a store subscription
    if (event.type === 'change' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('battle-mat-change', { detail: { key } }));
    }
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
      dlog('store', `setDoc persist=${persist} (doc replaced wholesale)`, {
        before: docSummary(doc),
        after: docSummary(next),
        from: caller(),
      });
      doc = next;
      if (persist) autosaver.schedule(doc);
      notify({ type: 'change', full: true });
    },
    commit() {
      dlog('store', 'commit', { ...docSummary(doc), from: caller() });
      // Structural changes (add/remove token, turn, stat edits) are infrequent
      // and things watch localStorage for them — the <add-to-battle> badge and
      // other tabs — so write immediately instead of on the debounce. (Only
      // the high-frequency viewport `save()` stays debounced.)
      autosaver.schedule(doc);
      autosaver.flush();
      notify({ type: 'change', full: false });
    },
    save() {
      dlog('store', `save (viewport-only) ${vpOf(doc)}`, { from: caller(2) });
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
      dlog('store', 'storage event: another tab/page wrote this key - adopting its doc (viewport included!)', {
        current: docSummary(doc),
        stored: loaded ? docSummary(loaded) : '(invalid)',
        rawLength: e.newValue.length,
      });
      if (loaded) store.setDoc(loaded, { persist: false });
    });
  }

  stores.set(key, store);
  return store;
}
