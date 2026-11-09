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

describe('adoptStored (cross-tab storage event)', () => {
  let n = 0;
  const key = () => `store-adopt-${++n}`;

  it('adopts the stored doc but keeps the local viewport', () => {
    const storage = memoryStorage();
    const k = key();
    const store = getStore(k, { storage });
    store.doc['x-battleMat'].viewport = { x: 500, y: 600, zoom: 2 };

    const other = emptyDoc();
    addNode(other, makeToken({ x: 64, y: 64, url: 'u', name: 'Wolf' }));
    other['x-battleMat'].viewport = { x: -100, y: -100, zoom: 0.25 };
    other['x-battleMat'].combat.round = 3;
    saveDoc(k, other, storage);

    const events = [];
    store.subscribe((e) => events.push(e));
    expect(store.adoptStored()).toBe(true);
    expect(store.doc.nodes).toHaveLength(1);
    expect(store.doc['x-battleMat'].combat.round).toBe(3);
    expect(store.doc['x-battleMat'].viewport).toEqual({ x: 500, y: 600, zoom: 2 });
    expect(events).toEqual([{ type: 'change', full: true }]);
  });

  it('ignores storage writes while a sync room owns the store', () => {
    const storage = memoryStorage();
    const k = key();
    const store = getStore(k, { storage });
    const mine = store.doc;
    addNode(mine, makeToken({ x: 0, y: 0, url: 'u', name: 'Locked' }));
    mine.nodes[0]['x-battleMat'].locked = true;

    const stale = emptyDoc();
    addNode(stale, structuredClone(mine.nodes[0]));
    delete stale.nodes[0]['x-battleMat'].locked;
    saveDoc(k, stale, storage);

    store.synced = true;
    const events = [];
    store.subscribe((e) => events.push(e));
    expect(store.adoptStored()).toBe(false);
    expect(store.doc).toBe(mine);
    expect(store.doc.nodes[0]['x-battleMat'].locked).toBe(true);
    expect(events).toEqual([]);

    store.synced = false;
    expect(store.adoptStored()).toBe(true);
    expect(store.doc.nodes[0]['x-battleMat'].locked).toBeUndefined();
  });

  it('leaves the doc alone when the stored value is invalid', () => {
    const storage = memoryStorage();
    const k = key();
    const store = getStore(k, { storage });
    const mine = store.doc;
    storage.setItem(k, '{broken');
    expect(store.adoptStored()).toBe(false);
    expect(store.doc).toBe(mine);
  });
});

describe('local undo history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let n = 0;
  const key = () => `store-undo-${++n}`;
  // every commit a separate step: the capture window is time-based
  const fresh = (opts = {}) => getStore(key(), { storage: memoryStorage(), ...opts });
  const tokenOf = (store, name) => store.doc.nodes.find((t) => t['x-battleMat'].name === name);
  const addToken = (store, name, x = 0) => {
    addNode(store.doc, makeToken({ x, y: 0, url: 'u', name, hp: 10, hpMax: 10 }));
    store.commit();
    vi.advanceTimersByTime(600);
  };

  it('starts with nothing to undo or redo', () => {
    const store = fresh();
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('undoes an hp edit and redoes it', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    tokenOf(store, 'Wolf')['x-battleMat'].hp = 3;
    store.commit();
    expect(store.canUndo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(tokenOf(store, 'Wolf')['x-battleMat'].hp).toBe(10);
    expect(store.canRedo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(tokenOf(store, 'Wolf')['x-battleMat'].hp).toBe(3);
    expect(store.canRedo()).toBe(false);
  });

  it('undoes adding and removing a token', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    addToken(store, 'Bear', 64);
    expect(store.doc.nodes).toHaveLength(2);
    store.undo();
    expect(store.doc.nodes.map((t) => t['x-battleMat'].name)).toEqual(['Wolf']);
    store.redo();
    expect(store.doc.nodes.map((t) => t['x-battleMat'].name)).toEqual(['Wolf', 'Bear']);
    const bear = tokenOf(store, 'Bear');
    store.doc.nodes.splice(store.doc.nodes.indexOf(bear), 1);
    store.commit();
    expect(store.doc.nodes).toHaveLength(1);
    store.undo();
    expect(store.doc.nodes).toHaveLength(2);
    expect(tokenOf(store, 'Bear')).toMatchObject({ id: bear.id, x: 64 });
  });

  it('a new edit after an undo drops the redo stack', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    addToken(store, 'Bear', 64);
    store.undo();
    addToken(store, 'Owl', 128);
    expect(store.canRedo()).toBe(false);
    expect(store.doc.nodes.map((t) => t['x-battleMat'].name)).toEqual(['Wolf', 'Owl']);
  });

  it('restores through store events as a full change and reports history changes', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    const events = [];
    store.subscribe((e) => events.push(e.type + (e.full === undefined ? '' : `:${e.full}`)));
    const history = [];
    store.onHistory(() => history.push([store.canUndo(), store.canRedo()]));
    store.undo();
    expect(events).toEqual(['change:true']);
    expect(history).toEqual([[false, true]]);
    expect(store.doc.nodes).toHaveLength(0);
    addToken(store, 'Bear');
    expect(history).toEqual([[false, true], [true, false]]);
  });

  it('a commit without changes is not a step', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    store.commit();
    store.commit();
    store.undo();
    expect(store.doc.nodes).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
  });

  it('leaves the viewport alone: pan/zoom is not a step and an undo keeps the current view', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    store.doc['x-battleMat'].viewport = { x: 100, y: 200, zoom: 2 };
    store.save();
    store.commit(); // a viewport-only commit changes nothing undoable
    expect(store.canUndo()).toBe(true); // just the token
    tokenOf(store, 'Wolf').x = 640;
    store.commit();
    store.doc['x-battleMat'].viewport = { x: -5, y: -6, zoom: 0.5 };
    store.save();
    store.undo();
    expect(tokenOf(store, 'Wolf').x).toBe(0);
    expect(store.doc['x-battleMat'].viewport).toEqual({ x: -5, y: -6, zoom: 0.5 });
    store.undo();
    expect(store.doc.nodes).toHaveLength(0);
    expect(store.doc['x-battleMat'].viewport).toEqual({ x: -5, y: -6, zoom: 0.5 });
    expect(store.canUndo()).toBe(false);
  });

  it('merges commits in quick succession into one step (a drag, a burst of clicks)', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    const wolf = tokenOf(store, 'Wolf');
    for (const x of [64, 128, 192]) {
      wolf.x = x;
      store.commit();
      vi.advanceTimersByTime(100);
    }
    expect(tokenOf(store, 'Wolf').x).toBe(192);
    store.undo();
    expect(tokenOf(store, 'Wolf').x).toBe(0);
    store.redo();
    expect(tokenOf(store, 'Wolf').x).toBe(192);
    // past the capture window the next commit is its own step
    vi.advanceTimersByTime(600);
    tokenOf(store, 'Wolf').x = 256;
    store.commit();
    store.undo();
    expect(tokenOf(store, 'Wolf').x).toBe(192);
  });

  it('keeps at most the configured number of steps', () => {
    const store = fresh({ historyLimit: 5 });
    for (let i = 0; i < 8; i++) addToken(store, `T${i}`, i * 64);
    let undone = 0;
    while (store.undo()) undone += 1;
    expect(undone).toBe(5);
    expect(store.doc.nodes.map((t) => t['x-battleMat'].name)).toEqual(['T0', 'T1', 'T2']);
  });

  it('import and clear are steps; a doc written by another tab resets the history', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    const cleared = emptyDoc();
    cleared['x-battleMat'] = store.doc['x-battleMat'];
    store.setDoc(cleared);
    expect(store.doc.nodes).toHaveLength(0);
    store.undo();
    expect(store.doc.nodes).toHaveLength(1);

    const foreign = emptyDoc();
    addNode(foreign, makeToken({ x: 0, y: 0, url: 'u', name: 'Other' }));
    store.setDoc(foreign, { persist: false });
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('a restored snapshot is a fresh object: editing it does not touch the stack', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    tokenOf(store, 'Wolf')['x-battleMat'].hp = 3;
    store.commit();
    vi.advanceTimersByTime(600);
    store.undo();
    tokenOf(store, 'Wolf')['x-battleMat'].hp = 7; // mutate the live doc after an undo
    store.commit();
    store.undo();
    expect(tokenOf(store, 'Wolf')['x-battleMat'].hp).toBe(10);
  });

  it('setHistory hands undo to a provider and back', () => {
    const store = fresh();
    addToken(store, 'Wolf');
    const calls = [];
    let listener = null;
    const provider = {
      undo: () => (calls.push('undo'), true),
      redo: () => (calls.push('redo'), true),
      canUndo: () => false,
      canRedo: () => true,
      onChange: (fn) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    };
    const events = [];
    store.onHistory(() => events.push('history'));
    store.setHistory(provider);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
    store.undo();
    store.redo();
    expect(calls).toEqual(['undo', 'redo']);
    expect(store.doc.nodes).toHaveLength(1);
    listener();
    expect(events).toEqual(['history', 'history']);
    // local edits while a provider is installed do not feed the local stack
    addToken(store, 'Bear', 64);
    store.setHistory(null);
    expect(listener).toBeNull();
    expect(store.canUndo()).toBe(false); // restarted from the current doc
    addToken(store, 'Owl', 128);
    store.undo();
    expect(store.doc.nodes.map((t) => t['x-battleMat'].name)).toEqual(['Wolf', 'Bear']);
  });
});

describe('snapshotDoc', () => {
  it('shares unchanged nodes with the previous snapshot and copies changed ones', async () => {
    const { snapshotDoc, restoreSnapshot } = await import('../src/battle-mat/store.js');
    const doc = emptyDoc();
    addNode(doc, makeToken({ x: 0, y: 0, url: 'data:image/png;base64,AAAA', name: 'A' }));
    addNode(doc, makeToken({ x: 64, y: 0, url: 'u', name: 'B' }));
    doc['x-battleMat'].viewport = { x: 1, y: 2, zoom: 3 };
    const first = snapshotDoc(doc);
    expect(first['x-battleMat'].viewport).toBeUndefined();
    expect(first.nodes[0]).not.toBe(doc.nodes[0]);
    doc.nodes[1].x = 128;
    const second = snapshotDoc(doc, first);
    expect(second.nodes[0]).toBe(first.nodes[0]);
    expect(second.nodes[1]).not.toBe(first.nodes[1]);
    expect(second.nodes[1].x).toBe(128);
    const live = restoreSnapshot(second, { x: 9, y: 9, zoom: 1 });
    expect(live.nodes[0]).not.toBe(second.nodes[0]);
    expect(live['x-battleMat'].viewport).toEqual({ x: 9, y: 9, zoom: 1 });
    expect(live['x-battleMat'].grid).toEqual(doc['x-battleMat'].grid);
  });
});
