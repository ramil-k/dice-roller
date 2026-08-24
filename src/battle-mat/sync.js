// Remote sync for the battle-mat encounter: a CRDT bridge between the plain
// JSON Canvas doc in the store (store.js) and a Yjs document replicated via
// dice-roller-sync (wss). Components keep mutating the plain doc and calling
// commit(); this module diffs those edits into fine-grained Yjs operations
// (one op per node field), so five people editing different tokens at once
// merge without losing anything - a conflict needs two edits to the *same
// field* of the same node, and then last write wins on that field only.
//
// Y.Doc layout:
//   nodes: Y.Map<nodeId, Y.Map<field, value>>  - node props flat; the node's
//          x-battleMat entries are prefixed "ext." so hp and position merge
//          independently. "ext.seq" (assigned on add) restores array order.
//   meta:  Y.Map with flat "grid.*" / "combat.*" keys and "edges".
//   The viewport is deliberately NOT synced - pan/zoom stays per device.
//
// Room semantics: the room code is the secret. Starting sync against an
// empty room seeds it from the local encounter; joining a room with content
// adopts the room's state (the room is the source of truth on connect).
// While connected, edits merge live in both directions.
//
// Invite links: any page that mounts <battle-toolbar> joins a room when its
// URL carries "#bm-room=<code>" (the hash never reaches the static host and
// works on forks/mirrors of the site). The sync panel offers a copy-link
// button for the current room.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_KEY, getStore } from './store.js';
import { EXT } from './canvas-doc.js';
import { AWARENESS_EVENT, PRESENCE_EVENT } from './presence.js';

export const SYNC_KEY = 'battle-mat-sync';
export const DEFAULT_SERVER = 'https://universal.ramilkarimov.me:9443';

const LOCAL_ORIGIN = 'battle-mat-local';
const PUSH_DEBOUNCE = 250;
const CURSOR_THROTTLE = 40; // ms between cursor awareness broadcasts

// Presence identity: no accounts anywhere, so the name comes from the site's
// optional tg-login profile (dnd-tg-user in localStorage) with a numbered
// fallback, and the color is derived from the Yjs client id.
const USER_COLORS = ['#e0464c', '#f4a83a', '#f4c430', '#5fb98d', '#58b7d8', '#7d97e8', '#b078d8', '#d86fa8'];

function localUser(clientId) {
  let name = null;
  try {
    const u = JSON.parse(globalThis.localStorage?.getItem('dnd-tg-user') ?? 'null');
    name = u?.first_name ?? u?.username ?? null;
  } catch {
    /* no profile - fall through */
  }
  return {
    name: (name ?? `Player ${(clientId % 90) + 10}`).slice(0, 24),
    color: USER_COLORS[clientId % USER_COLORS.length],
  };
}

// ---------------------------------------------------------------------------
// config ({server?, room}) in localStorage

export function loadSyncConfig(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SYNC_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return typeof cfg?.room === 'string' && cfg.room !== '' ? cfg : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg, storage = globalThis.localStorage) {
  try {
    if (cfg === null) storage.removeItem(SYNC_KEY);
    else storage.setItem(SYNC_KEY, JSON.stringify(cfg));
  } catch {
    // storage unavailable - sync just won't survive a reload
  }
}

// ---------------------------------------------------------------------------
// plain doc <-> Y.Doc bridge (pure; covered by test/battle-mat-sync.test.js)

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

const flattenNode = (node) => {
  const flat = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'id') continue;
    if (k === EXT) {
      for (const [ek, ev] of Object.entries(v ?? {})) flat[`ext.${ek}`] = ev;
    } else {
      flat[k] = v;
    }
  }
  return flat;
};

const unflattenNode = (id, flat) => {
  const node = { id };
  const ext = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('ext.')) ext[k.slice(4)] = v;
    else node[k] = v;
  }
  if (Object.keys(ext).length > 0) node[EXT] = ext;
  return node;
};

const flattenMeta = (doc) => {
  const flat = {};
  const ext = doc[EXT] ?? {};
  for (const [k, v] of Object.entries(ext.grid ?? {})) flat[`grid.${k}`] = v;
  for (const [k, v] of Object.entries(ext.combat ?? {})) flat[`combat.${k}`] = v;
  if ((doc.edges ?? []).length > 0) flat.edges = doc.edges;
  return flat;
};

const diffMap = (ymap, prevFlat, curFlat) => {
  for (const [k, v] of Object.entries(curFlat)) {
    if (!(k in prevFlat) || !same(prevFlat[k], v)) ymap.set(k, clone(v));
  }
  for (const k of Object.keys(prevFlat)) {
    if (!(k in curFlat)) ymap.delete(k);
  }
};

// Diff `doc` against `prev` (the last synced snapshot) and apply the changes
// to the Y.Doc in one local-origin transaction. Assigns "ext.seq" to new
// nodes (mutating them in the plain doc) so every replica can restore the
// nodes-array order deterministically.
export function pushDoc(ydoc, doc, prev) {
  const yNodes = ydoc.getMap('nodes');
  const yMeta = ydoc.getMap('meta');
  ydoc.transact(() => {
    let maxSeq = 0;
    yNodes.forEach((yn) => {
      maxSeq = Math.max(maxSeq, yn.get('ext.seq') ?? 0);
    });
    for (const node of doc.nodes) {
      maxSeq = Math.max(maxSeq, node[EXT]?.seq ?? 0);
    }

    const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
    const curIds = new Set();
    for (const node of doc.nodes) {
      curIds.add(node.id);
      const before = prevNodes.get(node.id);
      const yn = yNodes.get(node.id);
      if (!yn) {
        ((node[EXT] ??= {}).seq ??= ++maxSeq);
        yNodes.set(node.id, new Y.Map(Object.entries(flattenNode(node)).map(([k, v]) => [k, clone(v)])));
      } else if (before) {
        diffMap(yn, flattenNode(before), flattenNode(node));
      }
    }
    for (const id of prevNodes.keys()) {
      if (!curIds.has(id) && yNodes.has(id)) yNodes.delete(id);
    }

    diffMap(yMeta, prev ? flattenMeta(prev) : {}, flattenMeta(doc));
  }, LOCAL_ORIGIN);
}

// Build a fresh plain doc from the Y.Doc. The viewport is taken from the
// caller (the local, unsynced one).
export function materializeDoc(ydoc, { viewport } = {}) {
  const nodes = [];
  ydoc.getMap('nodes').forEach((yn, id) => nodes.push(unflattenNode(id, yn.toJSON())));
  const seqOf = (n) => n[EXT]?.seq ?? Number.MAX_SAFE_INTEGER;
  nodes.sort((a, b) => seqOf(a) - seqOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const meta = ydoc.getMap('meta').toJSON();
  const grid = {};
  const combat = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k.startsWith('grid.')) grid[k.slice(5)] = v;
    else if (k.startsWith('combat.')) combat[k.slice(7)] = v;
  }
  return {
    nodes,
    edges: clone(meta.edges) ?? [],
    [EXT]: { version: 1, grid, viewport: clone(viewport) ?? {}, combat },
  };
}

export const hasContent = (ydoc) =>
  ydoc.getMap('nodes').size > 0 || ydoc.getMap('meta').size > 0;

// ---------------------------------------------------------------------------
// live session

const sessions = new Map(); // storageKey -> session

const emitStatus = (key, session) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('battle-mat-sync-status', {
      detail: { key, room: session?.room ?? null, status: session?.status ?? 'off' },
    }),
  );
};

export function syncState(storageKey = DEFAULT_KEY) {
  const s = sessions.get(storageKey);
  return s ? { room: s.room, status: s.status } : { room: null, status: 'off' };
}

// Connect the store to a room. Resolves the session once the first sync with
// the server finished (state adopted or seeded).
export function startSync(storageKey = DEFAULT_KEY, { server = DEFAULT_SERVER, room } = {}) {
  stopSync(storageKey, { forget: false });
  const store = getStore(storageKey);
  const ydoc = new Y.Doc();
  const wsBase = `${server.replace(/^http/, 'ws')}/ws`;
  const provider = new WebsocketProvider(wsBase, room, ydoc, { connect: true });

  const session = {
    room,
    status: 'connecting',
    provider,
    ydoc,
    ready: false,
    applying: false,
    snapshot: null,
    pushTimer: null,
  };
  sessions.set(storageKey, session);

  const pushNow = () => {
    clearTimeout(session.pushTimer);
    session.pushTimer = null;
    pushDoc(ydoc, store.doc, session.snapshot);
    session.snapshot = clone(store.doc);
  };

  const applyRemote = () => {
    session.applying = true;
    try {
      const local = store.doc[EXT]?.viewport;
      const next = materializeDoc(ydoc, { viewport: local });
      session.snapshot = clone(next);
      store.setDoc(next, { persist: true });
    } finally {
      session.applying = false;
    }
  };

  // --- presence: cursors and tracker focus ride on Yjs awareness. The UI
  // publishes local state via PRESENCE_EVENT and renders peers from
  // AWARENESS_EVENT (see presence.js); the server relays awareness updates
  // to the whole room.
  const awareness = provider.awareness;
  awareness.setLocalStateField('user', localUser(ydoc.clientID));
  const emitAwareness = () => {
    const states = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId !== ydoc.clientID && state?.user) states.push({ clientId, ...state });
    });
    window.dispatchEvent(new CustomEvent(AWARENESS_EVENT, { detail: { key: storageKey, states } }));
  };
  awareness.on('change', emitAwareness);
  session.onPresence = (e) => {
    const { key, patch } = e.detail ?? {};
    if (key !== storageKey || !patch) return;
    if ('focus' in patch) awareness.setLocalStateField('focus', patch.focus);
    if ('cursor' in patch) {
      // pointermove fires way faster than peers need to see it - trailing
      // throttle, always broadcasting the latest position
      session.cursor = patch.cursor;
      if (session.cursorTimer == null) {
        session.cursorTimer = setTimeout(() => {
          session.cursorTimer = null;
          awareness.setLocalStateField('cursor', session.cursor);
        }, CURSOR_THROTTLE);
      }
    }
  };
  window.addEventListener(PRESENCE_EVENT, session.onPresence);

  session.unsubscribe = store.subscribe((e) => {
    if (!session.ready || session.applying || e.type !== 'change') return;
    if (session.pushTimer === null) {
      session.pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE);
    }
  });

  ydoc.on('update', (_update, origin) => {
    if (!session.ready || origin === LOCAL_ORIGIN || origin === null) return;
    // fold not-yet-pushed local edits in first, then materialize the merge
    pushNow();
    applyRemote();
  });

  provider.on('status', ({ status }) => {
    session.status = status === 'connected' ? 'connected' : 'connecting';
    emitStatus(storageKey, session);
  });

  provider.once('sync', () => {
    if (hasContent(ydoc)) {
      applyRemote(); // the room is the source of truth
    } else {
      pushNow(); // fresh room - seed it from the local encounter
    }
    session.ready = true;
    session.status = 'connected';
    emitStatus(storageKey, session);
  });

  emitStatus(storageKey, session);
  return session;
}

export function stopSync(storageKey = DEFAULT_KEY, { forget = true } = {}) {
  const session = sessions.get(storageKey);
  if (session) {
    clearTimeout(session.pushTimer);
    clearTimeout(session.cursorTimer);
    if (session.onPresence) window.removeEventListener(PRESENCE_EVENT, session.onPresence);
    session.unsubscribe?.();
    session.provider.destroy();
    session.ydoc.destroy();
    sessions.delete(storageKey);
    // peers are gone from this client's point of view - let the UI clear
    // any cursors and focus rings it drew
    window.dispatchEvent(new CustomEvent(AWARENESS_EVENT, { detail: { key: storageKey, states: [] } }));
  }
  if (forget) saveSyncConfig(null);
  emitStatus(storageKey, null);
}

// ---------------------------------------------------------------------------
// room REST helpers + entry points for the UI / the eager shell

export async function createRoom(server = DEFAULT_SERVER) {
  const res = await fetch(`${server}/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`room creation failed (${res.status})`);
  return (await res.json()).code;
}

export async function roomExists(room, server = DEFAULT_SERVER) {
  const res = await fetch(`${server}/rooms/${encodeURIComponent(room)}`);
  return res.ok;
}

// Create a room seeded from the current encounter, remember it, connect.
export async function createAndConnect(storageKey = DEFAULT_KEY, server = DEFAULT_SERVER) {
  const room = await createRoom(server);
  saveSyncConfig({ server, room });
  startSync(storageKey, { server, room });
  return room;
}

// Join an existing room (its state replaces the local encounter).
export async function joinRoom(room, storageKey = DEFAULT_KEY, server = DEFAULT_SERVER) {
  if (!(await roomExists(room, server))) throw new Error('unknown-room');
  saveSyncConfig({ server, room });
  startSync(storageKey, { server, room });
}

// --- invite links (#bm-room=<code>) ----------------------------------------

export const ROOM_HASH_PREFIX = '#bm-room=';
const ROOM_RE = /^[a-z]+-[a-z]+-\d{4}$/;
const JOIN_CONFIRM = 'Joining a room replaces the current encounter with the room state. Continue?';

// Pure parser for the invite-link hash (covered by tests).
export function parseRoomHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(ROOM_HASH_PREFIX)) return null;
  const room = decodeURIComponent(hash.slice(ROOM_HASH_PREFIX.length)).trim();
  return ROOM_RE.test(room) ? room : null;
}

export function roomFromUrl() {
  try {
    return parseRoomHash(window.location.hash);
  } catch {
    return null;
  }
}

// Invite link to `room` on the current page.
export function inviteLink(room) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${ROOM_HASH_PREFIX}${room}`;
}

const stripRoomHash = () => {
  try {
    if (parseRoomHash(window.location.hash)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    /* history unavailable */
  }
};

// Handle an invite link: join the room, asking first only when there is a
// local encounter to lose. Following a link to the already-configured room
// just resumes it. Returns 'joined' | 'already' | 'cancelled'.
export async function joinFromLink(room, storageKey = DEFAULT_KEY, { confirmText = JOIN_CONFIRM } = {}) {
  const cfg = loadSyncConfig();
  if (cfg?.room === room) {
    maybeStartSync(storageKey);
    stripRoomHash();
    return 'already';
  }
  const store = getStore(storageKey);
  const hasLocal = (store.doc.nodes?.length ?? 0) > 0;
  if (hasLocal && !window.confirm(confirmText)) return 'cancelled';
  await joinRoom(room, storageKey, cfg?.server ?? DEFAULT_SERVER);
  stripRoomHash();
  return 'joined';
}

// Called by the battle-toolbar eager shell on page load: resume the
// configured session, if any.
export function maybeStartSync(storageKey = DEFAULT_KEY) {
  const cfg = loadSyncConfig();
  if (!cfg || sessions.has(storageKey)) return;
  startSync(storageKey, { server: cfg.server ?? DEFAULT_SERVER, room: cfg.room });
}
