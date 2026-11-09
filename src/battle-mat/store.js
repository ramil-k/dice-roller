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
// Undo/redo stack changes go to the separate `onHistory(fn)` listeners (the
// toolbar's two buttons), so `subscribe` keeps seeing document events only.
//
// All storage access is try/catch'd, same as the roll log in roll-dice.js —
// localStorage can be unavailable (private browsing) or full
// (QuotaExceededError, likely here because attached map images are stored as
// data URIs), and the mat must keep working in-memory either way. `saveDoc`
// reports failure so the UI can suggest exporting to a file instead.
//
// Undo: every store carries a history - `undo()` / `redo()` / `canUndo()` /
// `canRedo()`. Outside a sync room that is the local snapshot stack below
// (one entry per commit, fast series merged, the viewport left alone); in a
// room sync.js installs a Y.UndoManager-backed provider through
// `setHistory()` so that only this client's edits are undone, never a peer's.
//
// Storage is injectable for tests (Node has no localStorage); covered by
// test/battle-mat-store.test.js.

import { validateCanvas, serialize, emptyDoc, getExt, EXT } from './canvas-doc.js';
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

// ---------------------------------------------------------------------------
// local undo history (pure; the store wires it to commit/setDoc)

export const HISTORY_LIMIT = 50;
// commits closer together than this merge into one undo step (a token drag
// commits once anyway; this folds things like a burst of hp clicks)
export const HISTORY_CAPTURE = 500;

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k) || !deepEqual(a[k], b[k])) return false;
  }
  return true;
};

// A snapshot of everything but the viewport (pan/zoom is per device and
// never part of an undo step). Snapshots are immutable once taken, so a node
// that did not change since `prev` is shared with the previous snapshot
// instead of cloned - fifty steps of a map with a multi-megabyte image hold
// that image once, not fifty times.
export function snapshotDoc(doc, prev = null) {
  const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const nodes = (doc.nodes ?? []).map((n) => {
    const p = prevNodes.get(n.id);
    return p && deepEqual(p, n) ? p : structuredClone(n);
  });
  const { viewport: _viewport, ...ext } = doc[EXT] ?? {};
  return { nodes, edges: structuredClone(doc.edges ?? []), [EXT]: structuredClone(ext) };
}

const sameSnapshot = (a, b) =>
  a.nodes.length === b.nodes.length &&
  a.nodes.every((n, i) => n === b.nodes[i]) &&
  deepEqual(a.edges, b.edges) &&
  deepEqual(a[EXT], b[EXT]);

// A live document from a snapshot: fresh objects (components mutate the live
// doc in place, the snapshot must stay pristine) plus the given viewport.
export function restoreSnapshot(snap, viewport) {
  return {
    nodes: snap.nodes.map((n) => structuredClone(n)),
    edges: structuredClone(snap.edges),
    [EXT]: { ...structuredClone(snap[EXT]), viewport: structuredClone(viewport ?? {}) },
  };
}

// The snapshot stack. `base` is the state as of the last record (what the
// live doc looked like after its last commit); the undo stack holds the
// states before that, the redo stack the states undone. `record(doc)` is
// called after every commit: no change -> no step; a change within
// `captureTimeout` of the previous one extends that step instead of adding
// one. `undo()` / `redo()` move `base` and return the snapshot to restore
// (null when there is nothing to do). `reset(doc)` forgets everything - the
// doc was replaced from outside (another tab, a sync room).
export function createLocalHistory({ limit = HISTORY_LIMIT, captureTimeout = HISTORY_CAPTURE, now = Date.now } = {}) {
  let base = null;
  let undoStack = [];
  let redoStack = [];
  let lastRecord = null;

  return {
    reset(doc) {
      base = doc ? snapshotDoc(doc) : null;
      undoStack = [];
      redoStack = [];
      lastRecord = null;
    },
    record(doc) {
      if (base === null) {
        base = snapshotDoc(doc);
        return false;
      }
      const snap = snapshotDoc(doc, base);
      if (sameSnapshot(snap, base)) return false;
      const t = now();
      const merge = lastRecord !== null && t - lastRecord < captureTimeout && undoStack.length > 0;
      if (!merge) {
        undoStack.push(base);
        if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
      }
      redoStack = [];
      base = snap;
      lastRecord = t;
      return true;
    },
    // the next record starts a new step even if it comes right away
    stopCapturing() {
      lastRecord = null;
    },
    undo() {
      if (undoStack.length === 0) return null;
      redoStack.push(base);
      base = undoStack.pop();
      lastRecord = null;
      return base;
    },
    redo() {
      if (redoStack.length === 0) return null;
      undoStack.push(base);
      base = redoStack.pop();
      lastRecord = null;
      return base;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    get size() {
      return undoStack.length;
    },
  };
}

const stores = new Map();

// The shared encounter store, one instance per storage key. Options are
// honored only by the call that creates the store (tests use unique keys and
// pass a stub storage).
export function getStore(
  key = DEFAULT_KEY,
  { storage = globalThis.localStorage, delay = 500, historyLimit = HISTORY_LIMIT, captureTimeout = HISTORY_CAPTURE } = {},
) {
  let store = stores.get(key);
  if (store) return store;

  let doc = loadDoc(key, storage) ?? emptyDoc();
  const subscribers = new Set();
  // the local snapshot stack; `external` (a sync room's Y.UndoManager
  // provider) takes over while installed, see setHistory
  const local = createLocalHistory({ limit: historyLimit, captureTimeout });
  local.reset(doc);
  let external = null;
  let restoring = false; // an undo/redo is replacing the doc - not a new step
  const historyListeners = new Set();
  const notifyHistory = () => {
    for (const fn of [...historyListeners]) fn();
  };
  const notify = (event) => {
    for (const fn of [...subscribers]) fn(event);
    // a DOM-level echo of document changes for lightweight listeners (the
    // <add-to-battle> instance badge) that don't hold a store subscription.
    // The live doc rides along: storage may lag (debounced setDoc writes) or
    // have failed (quota), so listeners count from this, not from storage
    if (event.type === 'change' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('battle-mat-change', { detail: { key, doc } }));
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
      if (!external && !restoring) {
        // an import or a clear is an undo step; a doc written by another
        // tab (persist: false) is foreign - the old steps no longer apply
        if (persist) local.record(doc);
        else local.reset(doc);
      }
      notify({ type: 'change', full: true });
      if (!external) notifyHistory();
    },
    commit() {
      dlog('store', 'commit', { ...docSummary(doc), from: caller() });
      // Structural changes (add/remove token, turn, stat edits) are infrequent
      // and things watch localStorage for them — the <add-to-battle> badge and
      // other tabs — so write immediately instead of on the debounce. (Only
      // the high-frequency viewport `save()` stays debounced.)
      autosaver.schedule(doc);
      autosaver.flush();
      const step = external ? false : local.record(doc);
      notify({ type: 'change', full: false });
      if (step) notifyHistory();
    },
    // ---- undo / redo ----
    // Local: restore the snapshot with the current viewport and replace the
    // doc (a `full` change). In a room the installed provider undoes the
    // Yjs transaction and the bridge materializes the result.
    undo() {
      if (external) return external.undo();
      const snap = local.undo();
      if (!snap) return false;
      restoring = true;
      try {
        store.setDoc(restoreSnapshot(snap, getExt(doc).viewport));
      } finally {
        restoring = false;
      }
      return true;
    },
    redo() {
      if (external) return external.redo();
      const snap = local.redo();
      if (!snap) return false;
      restoring = true;
      try {
        store.setDoc(restoreSnapshot(snap, getExt(doc).viewport));
      } finally {
        restoring = false;
      }
      return true;
    },
    canUndo() {
      return external ? external.canUndo() : local.canUndo();
    },
    canRedo() {
      return external ? external.canRedo() : local.canRedo();
    },
    // Install an undo provider ({ undo, redo, canUndo, canRedo, onChange? })
    // in place of the local stack - sync.js does this for a connected room,
    // whose edits must be undone through the CRDT. `null` goes back to the
    // local stack, started afresh from the current doc (the room rewrote it).
    setHistory(provider) {
      external?.offChange?.();
      external = provider ?? null;
      if (external) {
        external.offChange = external.onChange?.(notifyHistory) ?? null;
      } else {
        local.reset(doc);
      }
      notifyHistory();
    },
    // Hear about undo/redo stack changes (canUndo/canRedo may have flipped).
    onHistory(fn) {
      historyListeners.add(fn);
      return () => historyListeners.delete(fn);
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
    // Set while a sync session drives this store (see the storage handler).
    synced: false,
    // Adopt what another tab wrote to the key (the `storage` handler's body,
    // callable directly for tests). Returns whether the doc was replaced.
    adoptStored() {
      const loaded = loadDoc(key, storage);
      if (store.synced) {
        dlog('store', 'storage event ignored: a sync room owns this store', {
          current: docSummary(doc),
          stored: loaded ? docSummary(loaded) : '(invalid)',
        });
        return false;
      }
      if (!loaded) return false;
      // keep this tab's pan/zoom - the other tab's viewport is its own
      getExt(loaded).viewport = { ...getExt(doc).viewport };
      dlog('store', 'storage event: another tab/page wrote this key - adopting its doc, keeping the local viewport', {
        current: docSummary(doc),
        stored: docSummary(loaded),
      });
      store.setDoc(loaded, { persist: false });
      return true;
    },
  };

  // Cross-tab sync: `storage` fires in *other* tabs when this key is written.
  // Last write wins; the freshly stored doc replaces the local one.
  //
  // Two exceptions. The viewport is per tab: the stored doc carries the
  // writer's pan/zoom, and adopting it would yank this tab's view around, so
  // the local viewport is kept. And while a sync room is the source of truth
  // (`store.synced`, set by sync.js) storage events are ignored entirely -
  // every tab in the room receives the same edits from the room, and adopting
  // another tab's (possibly older) write here would look like a local edit
  // that the bridge then pushes to the room, undoing someone's change.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== key || e.newValue === null) return;
      store.adoptStored();
    });
  }

  stores.set(key, store);
  return store;
}
