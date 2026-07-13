// Battle-mat persistence: load/save the canvas document from localStorage and
// a debounced autosaver. All storage access is try/catch'd, same as the roll
// log in roll-dice.js — localStorage can be unavailable (private browsing,
// storage-disabled iframes) or full (QuotaExceededError, likely here because
// attached map images are stored as data URIs), and the mat must keep working
// in-memory either way. `saveDoc` reports failure so the UI can suggest
// exporting to a file instead.
//
// Storage is injectable for tests (Node has no localStorage); covered by
// test/battle-mat-store.test.js.

import { validateCanvas, serialize } from './canvas-doc.js';

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
