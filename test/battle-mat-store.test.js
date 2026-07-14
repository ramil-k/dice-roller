import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDoc, saveDoc, createAutosaver, getStore, DEFAULT_KEY } from '../src/battle-mat/store.js';
import { emptyDoc, addNode, makeToken } from '../src/battle-mat/canvas-doc.js';

// Minimal in-memory localStorage stand-in (Node has no localStorage).
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('loadDoc / saveDoc', () => {
  it('round-trips a document', () => {
    const storage = memoryStorage();
    const doc = emptyDoc();
    addNode(doc, makeToken({ x: 64, y: 128, url: 'u', name: 'A' }));
    expect(saveDoc('k', doc, storage)).toBe(true);
    const loaded = loadDoc('k', storage);
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0]).toMatchObject({ x: 64, y: 128, type: 'link' });
  });

  it('returns null for a missing key', () => {
    expect(loadDoc('missing', memoryStorage())).toBeNull();
  });

  it('returns null for corrupt or invalid JSON', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    expect(loadDoc('k', storage)).toBeNull();
    storage.setItem('k', '{"nodes": "nope"}');
    expect(loadDoc('k', storage)).toBeNull();
  });

  it('returns null / false when storage is unavailable', () => {
    // default param resolves to globalThis.localStorage, undefined in Node
    expect(loadDoc(DEFAULT_KEY)).toBeNull();
    expect(saveDoc(DEFAULT_KEY, emptyDoc())).toBe(false);
  });

  it('reports false on quota errors instead of throwing', () => {
    const storage = {
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(saveDoc('k', emptyDoc(), storage)).toBe(false);
  });
});

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid schedules into one write', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const saver = createAutosaver('k', { delay: 500, storage });
    const doc = emptyDoc();
    saver.schedule(doc);
    vi.advanceTimersByTime(200);
    saver.schedule(doc);
    saver.schedule(doc);
    vi.advanceTimersByTime(499);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('writes the latest scheduled doc, not the first', () => {
    const storage = memoryStorage();
    const saver = createAutosaver('k', { delay: 100, storage });
    const first = emptyDoc();
    const second = emptyDoc();
    addNode(second, makeToken({ x: 0, y: 0, url: 'u' }));
    saver.schedule(first);
    saver.schedule(second);
    vi.advanceTimersByTime(100);
    expect(loadDoc('k', storage).nodes).toHaveLength(1);
  });

  it('flush saves immediately and cancels the timer', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const saver = createAutosaver('k', { delay: 500, storage });
    saver.schedule(emptyDoc());
    expect(saver.flush()).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending succeeds without writing', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const saver = createAutosaver('k', { delay: 500, storage });
    expect(saver.flush()).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reports write results through onResult', () => {
    const results = [];
    const failing = {
      setItem: () => {
        throw new Error('full');
      },
    };
    const saver = createAutosaver('k', { delay: 10, storage: failing, onResult: (ok) => results.push(ok) });
    saver.schedule(emptyDoc());
    vi.advanceTimersByTime(10);
    expect(results).toEqual([false]);
  });
});

describe('getStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // unique keys per test — the store registry is module-global by design
  let n = 0;
  const freshKey = () => `store-test-${++n}`;

  it('returns the same instance for the same key', () => {
    const key = freshKey();
    const storage = memoryStorage();
    const a = getStore(key, { storage });
    const b = getStore(key, { storage });
    expect(a).toBe(b);
    expect(getStore(freshKey(), { storage })).not.toBe(a);
  });

  it('loads the persisted doc on creation, or starts empty', () => {
    const storage = memoryStorage();
    const key = freshKey();
    const doc = emptyDoc();
    addNode(doc, makeToken({ x: 0, y: 0, url: 'u' }));
    saveDoc(key, doc, storage);
    expect(getStore(key, { storage }).doc.nodes).toHaveLength(1);
    expect(getStore(freshKey(), { storage }).doc.nodes).toHaveLength(0);
  });

  it('commit persists immediately (not on the debounce) and notifies', () => {
    const storage = memoryStorage();
    const key = freshKey();
    const store = getStore(key, { storage, delay: 100 });
    const events = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    addNode(store.doc, makeToken({ x: 0, y: 0, url: 'u' }));
    store.commit();
    // written synchronously — the add-to-battle badge and other tabs must see
    // structural changes at once, without waiting out the debounce
    expect(loadDoc(key, storage).nodes).toHaveLength(1);
    // the flush fires save-result before the change notification
    expect(events).toEqual([
      { type: 'save-result', ok: true },
      { type: 'change', full: false },
    ]);
    unsubscribe();
    store.commit();
    expect(events).toHaveLength(2);
  });

  it('setDoc replaces the doc, notifies full, and honors persist: false', () => {
    const storage = memoryStorage();
    const key = freshKey();
    const store = getStore(key, { storage, delay: 100 });
    const events = [];
    store.subscribe((e) => events.push(e));
    const next = emptyDoc();
    addNode(next, makeToken({ x: 0, y: 0, url: 'u' }));
    store.setDoc(next, { persist: false });
    expect(store.doc).toBe(next);
    expect(events).toEqual([{ type: 'change', full: true }]);
    vi.advanceTimersByTime(1000);
    expect(loadDoc(key, storage)).toBeNull(); // nothing was persisted
    store.setDoc(next);
    vi.advanceTimersByTime(100);
    expect(loadDoc(key, storage).nodes).toHaveLength(1);
  });

  it('save persists without notifying a change', () => {
    const storage = memoryStorage();
    const key = freshKey();
    const store = getStore(key, { storage, delay: 50 });
    const events = [];
    store.subscribe((e) => events.push(e));
    store.save();
    vi.advanceTimersByTime(50);
    expect(events).toEqual([{ type: 'save-result', ok: true }]);
  });

  it('flush writes pending changes immediately', () => {
    const storage = memoryStorage();
    const key = freshKey();
    const store = getStore(key, { storage, delay: 5000 });
    addNode(store.doc, makeToken({ x: 0, y: 0, url: 'u' }));
    store.commit();
    expect(store.flush()).toBe(true);
    expect(loadDoc(key, storage).nodes).toHaveLength(1);
  });
});
