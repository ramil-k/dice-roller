import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDoc, saveDoc, createAutosaver, DEFAULT_KEY } from '../src/battle-mat/store.js';
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
