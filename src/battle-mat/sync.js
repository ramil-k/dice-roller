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
// Images: an attached map image starts life as a data URI in the node's url
// (so the mat works offline and without any server). In a room that is a
// multi-megabyte value inside the CRDT - every peer downloads it on every
// connect and every device has to fit it into localStorage - so once a
// session is up, externalizeImages() uploads every data-URI image to the
// room's image store on the sync server and swaps the url for the
// short, immutable URL it returns; Yjs then garbage-collects the old value.
//
// Invite links: any page that mounts <battle-toolbar> joins a room when its
// URL carries "#bm-room=<code>" (the hash never reaches the static host and
// works on forks/mirrors of the site). The sync panel offers a copy-link
// button for the current room.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_KEY, getStore } from './store.js';
import { EXT, getNode } from './canvas-doc.js';
import { AWARENESS_EVENT, PRESENCE_EVENT } from './presence.js';
import { getAdjectives } from './adjectives.js';
import { dlog, caller, docSummary, vpOf } from './debug.js';

export const SYNC_KEY = 'battle-mat-sync';
export const DEFAULT_SERVER = 'https://universal.ramilkarimov.me:9443';

const LOCAL_ORIGIN = 'battle-mat-local';
const PUSH_DEBOUNCE = 250;
const CURSOR_THROTTLE = 40; // ms between cursor awareness broadcasts

// Presence identity: no accounts anywhere. The sync panel lets the player
// pick a name and a color (persisted in PROFILE_KEY); without them the name
// falls back to the site's optional tg-login profile (dnd-tg-user), and the
// color derives from the Yjs client id. Every player additionally gets an
// instance adjective (the same localizable list that names duplicate
// combatants), chosen by client id - so two people who are both "Рамиль"
// still read differently at the table, and a player with no name at all is
// "Свирепый игрок" - the generic word comes from the toolbar's
// label-syncplayer (setPlayerWord), "Player" by default.
export const USER_COLORS = ['#e0464c', '#f4a83a', '#f4c430', '#5fb98d', '#58b7d8', '#7d97e8', '#b078d8', '#d86fa8'];
export const PROFILE_KEY = 'battle-mat-profile';

function loadProfile(storage = globalThis.localStorage) {
  try {
    const p = JSON.parse(storage?.getItem(PROFILE_KEY) ?? 'null');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

// The stored overrides only - the UI prefills its fields from this.
export function getProfile() {
  return loadProfile();
}

// Merge {name?, color?} into the stored profile (null clears a field) and
// push the new identity into every live session, so peers see the rename
// or recolor immediately.
export function setProfile(patch, storage = globalThis.localStorage) {
  const next = { ...loadProfile(storage), ...patch };
  for (const k of ['name', 'color']) {
    if (next[k] == null || next[k] === '') delete next[k];
  }
  try {
    if (Object.keys(next).length > 0) storage.setItem(PROFILE_KEY, JSON.stringify(next));
    else storage.removeItem(PROFILE_KEY);
  } catch {
    /* storage unavailable - the change still applies to live sessions */
  }
  for (const session of sessions.values()) {
    session.provider.awareness.setLocalStateField('user', localUser(session.ydoc.clientID));
  }
  return next;
}

const DEFAULT_PLAYER_WORD = 'Player';
let playerWord = DEFAULT_PLAYER_WORD;

// The word shown in place of a missing name ("Свирепый игрок"); the toolbar
// and the screen both push their label-syncplayer here. Empty resets.
export function setPlayerWord(word) {
  playerWord = typeof word === 'string' && word.trim() !== '' ? word.trim() : DEFAULT_PLAYER_WORD;
  for (const session of sessions.values()) {
    session.provider.awareness.setLocalStateField('user', localUser(session.ydoc.clientID));
  }
}

// Pure: the display name for a player. A nameless player is "<adjective>
// <word>"; with no adjective list either, "<word> NN" keeps peers apart.
export function displayName(name, clientId, { adjectives = [], word = DEFAULT_PLAYER_WORD } = {}) {
  const adjective = adjectives.length > 0 ? adjectives[clientId % adjectives.length] : null;
  const who = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  if (adjective === null && who === null) return `${word} ${(clientId % 90) + 10}`;
  return [adjective, who ?? word].filter(Boolean).join(' ').slice(0, 32);
}

function localUser(clientId) {
  const prof = loadProfile();
  let name = typeof prof.name === 'string' && prof.name.trim() !== '' ? prof.name.trim() : null;
  if (name === null) {
    try {
      const u = JSON.parse(globalThis.localStorage?.getItem('dnd-tg-user') ?? 'null');
      name = u?.first_name ?? u?.username ?? null;
    } catch {
      /* no tg profile - fall through */
    }
  }
  const color =
    typeof prof.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(prof.color)
      ? prof.color
      : USER_COLORS[clientId % USER_COLORS.length];
  return { name: displayName(name, clientId, { adjectives: getAdjectives(), word: playerWord }), color };
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

// `ops` (optional) collects a human-readable trace of what was sent.
const diffMap = (ymap, prevFlat, curFlat, ops, label = '') => {
  for (const [k, v] of Object.entries(curFlat)) {
    if (!(k in prevFlat) || !same(prevFlat[k], v)) {
      ymap.set(k, clone(v));
      ops?.push(`${label}set ${k}=${k === 'url' || k === 'ext.points' ? '…' : JSON.stringify(v)}`);
    }
  }
  for (const k of Object.keys(prevFlat)) {
    if (!(k in curFlat)) {
      ymap.delete(k);
      ops?.push(`${label}DELETE ${k}`);
    }
  }
};

// Diff `doc` against `prev` (the last synced snapshot) and apply the changes
// to the Y.Doc in one local-origin transaction. Assigns "ext.seq" to new
// nodes (mutating them in the plain doc) so every replica can restore the
// nodes-array order deterministically. A node that is in the snapshot but no
// longer in the Y.Doc was deleted by a peer, not added locally: it is left
// alone (the following materialize drops it), never re-created.
export function pushDoc(ydoc, doc, prev, ops) {
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
      if (!yn && before) {
        ops?.push(`node ${node.id.slice(0, 8)} removed remotely - not re-added`);
      } else if (!yn) {
        ((node[EXT] ??= {}).seq ??= ++maxSeq);
        yNodes.set(node.id, new Y.Map(Object.entries(flattenNode(node)).map(([k, v]) => [k, clone(v)])));
        ops?.push(`add node ${node.id.slice(0, 8)} (${node[EXT]?.kind}${node[EXT]?.locked ? ', locked' : ''})`);
      } else if (before) {
        diffMap(yn, flattenNode(before), flattenNode(node), ops, `${node.id.slice(0, 8)}: `);
      } else {
        ops?.push(`node ${node.id.slice(0, 8)} exists remotely but not in snapshot - NOT diffed`);
      }
    }
    for (const id of prevNodes.keys()) {
      if (!curIds.has(id) && yNodes.has(id)) {
        yNodes.delete(id);
        ops?.push(`remove node ${id.slice(0, 8)}`);
      }
    }

    diffMap(yMeta, prev ? flattenMeta(prev) : {}, flattenMeta(doc), ops, 'meta: ');
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
// images by link (pure parts covered by tests)

export const isDataImage = (url) => typeof url === 'string' && url.startsWith('data:image/');

// Nodes whose picture still travels inline - candidates for upload.
export const dataImageNodes = (doc) => (doc?.nodes ?? []).filter((n) => isDataImage(n.url));

// Absolute URL of an uploaded image from the server's {path} answer.
export const imageUrl = (server, path) => `${server.replace(/\/+$/, '')}${path}`;

export async function uploadImage(blob, { server = DEFAULT_SERVER, room }) {
  const res = await fetch(`${server}/rooms/${encodeURIComponent(room)}/images`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  if (!res.ok) throw new Error(`image upload failed (${res.status})`);
  return imageUrl(server, (await res.json()).path);
}

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
    server,
    status: 'connecting',
    provider,
    ydoc,
    ready: false,
    applying: false,
    snapshot: null,
    pushTimer: null,
    externalizing: null,
  };
  sessions.set(storageKey, session);
  store.synced = true; // the room, not other tabs' storage writes, drives this store

  const pushNow = () => {
    clearTimeout(session.pushTimer);
    session.pushTimer = null;
    const ops = [];
    pushDoc(ydoc, store.doc, session.snapshot, ops);
    dlog('sync', `push -> room ${room}: ${ops.length} op(s)`, {
      ops,
      doc: docSummary(store.doc),
      snapshot: session.snapshot ? docSummary(session.snapshot) : '(none)',
      from: caller(),
    });
    session.snapshot = clone(store.doc);
  };

  const applyRemote = () => {
    session.applying = true;
    try {
      const local = store.doc[EXT]?.viewport;
      const next = materializeDoc(ydoc, { viewport: local });
      dlog('sync', `applyRemote <- room ${room} (keeping local viewport ${vpOf(store.doc)})`, {
        before: docSummary(store.doc),
        after: docSummary(next),
        yNodes: ydoc.getMap('nodes').size,
        from: caller(),
      });
      session.snapshot = clone(next);
      store.setDoc(next, { persist: true });
    } finally {
      session.applying = false;
    }
  };
  dlog('sync', `startSync room=${room} server=${server} clientID=${ydoc.clientID}`, {
    local: docSummary(store.doc),
    from: caller(),
  });

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
    if (e.type === 'change') {
      dlog('sync', `store change full=${e.full} ready=${session.ready} applying=${session.applying}` +
        ` -> ${!session.ready || session.applying ? 'ignored' : session.pushTimer === null ? 'push scheduled' : 'push already pending'}`);
    }
    if (!session.ready || session.applying || e.type !== 'change') return;
    if (session.pushTimer === null) {
      session.pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE);
    }
  });

  ydoc.on('update', (update, origin) => {
    const originName = origin === LOCAL_ORIGIN ? 'local' : origin === null ? 'null' : origin === provider ? 'provider(remote)' : typeof origin;
    dlog('sync', `ydoc update origin=${originName} bytes=${update.byteLength} ready=${session.ready}` +
      `${!session.ready || origin === LOCAL_ORIGIN || origin === null ? ' -> ignored' : ' -> push pending local edits, then applyRemote'}`);
    if (!session.ready || origin === LOCAL_ORIGIN || origin === null) return;
    // fold not-yet-pushed local edits in first, then materialize the merge
    pushNow();
    applyRemote();
  });

  provider.on('status', ({ status }) => {
    dlog('sync', `provider status: ${status} (room ${room})`);
    session.status = status === 'connected' ? 'connected' : 'connecting';
    emitStatus(storageKey, session);
  });
  provider.on('connection-close', (ev) => dlog('sync', `ws closed code=${ev?.code} reason=${ev?.reason}`));
  provider.on('connection-error', (ev) => dlog('sync', 'ws error', ev));

  provider.once('sync', () => {
    dlog('sync', `first sync with room ${room}: ${hasContent(ydoc) ? 'room has content - adopting it' : 'room empty - seeding from local'}`, {
      yNodes: ydoc.getMap('nodes').size,
      yMeta: ydoc.getMap('meta').toJSON(),
    });
    if (hasContent(ydoc)) {
      applyRemote(); // the room is the source of truth
    } else {
      pushNow(); // fresh room - seed it from the local encounter
    }
    session.ready = true;
    session.status = 'connected';
    emitStatus(storageKey, session);
    // inline images (the seed, or a room from before images-by-link) move to
    // the server now that the session is up
    externalizeImages(storageKey);
  });

  emitStatus(storageKey, session);
  return session;
}

// Upload every data-URI image of the store's doc to the session's room and
// replace the urls (one commit at the end, so the swap syncs like any other
// field edit). No session, nothing inline, or an upload already running -> a
// no-op. Resolves to the number of images moved; a failed upload leaves that
// node inline (it still works, just heavy) and is logged.
export async function externalizeImages(storageKey = DEFAULT_KEY) {
  const session = sessions.get(storageKey);
  if (!session) return 0;
  if (session.externalizing) return session.externalizing;
  const store = getStore(storageKey);
  const run = async () => {
    let moved = 0;
    for (const { id, url } of dataImageNodes(store.doc)) {
      try {
        const blob = await (await fetch(url)).blob();
        const link = await uploadImage(blob, session);
        // the doc may have been replaced meanwhile - re-find, and only swap
        // if nobody changed the picture in between
        const node = getNode(store.doc, id);
        if (!node || node.url !== url || sessions.get(storageKey) !== session) continue;
        node.url = link;
        moved += 1;
        dlog('sync', `image ${id.slice(0, 8)} uploaded (${Math.round(blob.size / 1024)} KB) -> ${link}`);
      } catch (err) {
        dlog('sync', `image ${id.slice(0, 8)} upload failed - kept inline`, err);
      }
    }
    if (moved > 0) store.commit();
    return moved;
  };
  session.externalizing = run().finally(() => {
    session.externalizing = null;
  });
  return session.externalizing;
}

export function stopSync(storageKey = DEFAULT_KEY, { forget = true } = {}) {
  const session = sessions.get(storageKey);
  dlog('sync', `stopSync forget=${forget} hadSession=${Boolean(session)}`, { from: caller() });
  if (session) {
    clearTimeout(session.pushTimer);
    clearTimeout(session.cursorTimer);
    if (session.onPresence) window.removeEventListener(PRESENCE_EVENT, session.onPresence);
    session.unsubscribe?.();
    getStore(storageKey).synced = false;
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
