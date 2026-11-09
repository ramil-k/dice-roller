// Combat journal: what happened in the fight, posted to the sync server.
//
// A sync room (sync.js) is a CRDT snapshot - it knows the encounter as it is
// now, never how it got there: a removed token and yesterday's hit points
// are gone, and the roll log (roll-dice.js, localStorage `roll-dice-log`)
// holds the last 50 rolls of one browser. This module turns the edits made
// in this tab and the rolls made on this page into events and appends them
// to the room's append-only journal (`POST /rooms/<code>/events` on
// dice-roller-sync; `GET ...?format=text` reads the fight back as prose-ready
// lines).
//
// Only the author logs: every store `change` with `full: false` is a local
// commit() (the mat, the tracker, <add-to-battle>), so it is diffed against
// the snapshot taken after the previous change and the difference - tokens
// added/removed, HP, initiative, renames, turns - goes out under this
// player's presence name and color. A `full: true` change is the room's
// state arriving (or an import/clear) and only resets the snapshot: the
// peer who made that edit logs it on their side. Rolls arrive as the
// bubbling, composed `roll` events every <roll-dice> / <roll-any-dice> /
// <battle-toolbar> dispatches.
//
// Nothing is posted unless the page is in a room (`battle-mat-sync` in
// localStorage has a room); events are batched a second after the last one
// and retried with a backoff when the server is unreachable, so a flaky
// connection delays the journal rather than losing it (the server stamps
// `seq` and `t` on arrival).
//
// The two pure halves - the document diff and the roll mapping - are
// covered by test/battle-mat-event-log.test.js. This module deliberately
// does not import sync.js (that chunk bundles yjs and a page that only
// rolls dice must not pay for it): the room config, the profile key, the
// default server and the player-name rule are mirrored here, and the test
// asserts the copies agree.

import { EXT, getExt, nodeKind } from './canvas-doc.js';
import { getStore, DEFAULT_KEY } from './store.js';
import { getAdjectives } from './adjectives.js';
import { dlog } from './debug.js';

// --- mirrored from sync.js (test-checked) -----------------------------------
export const SYNC_KEY = 'battle-mat-sync';
export const PROFILE_KEY = 'battle-mat-profile';
export const DEFAULT_SERVER = 'https://universal.ramilkarimov.me:9443';
export const USER_COLORS = ['#e0464c', '#f4a83a', '#f4c430', '#5fb98d', '#58b7d8', '#7d97e8', '#b078d8', '#d86fa8'];
const DEFAULT_PLAYER_WORD = 'Player';

export const FLUSH_DELAY = 1000;
export const RETRY_DELAYS = [5000, 15000, 60000];
export const QUEUE_LIMIT = 1000; // events kept while the server is away

const readJson = (storage, key) => {
  try {
    const v = JSON.parse(storage?.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

// { server, room } when the page is in a room, else null.
export function readSyncConfig(storage = globalThis.localStorage) {
  const cfg = readJson(storage, SYNC_KEY);
  return typeof cfg?.room === 'string' && cfg.room !== '' ? { server: cfg.server ?? DEFAULT_SERVER, room: cfg.room } : null;
}

// The same rule as sync.js displayName(): "<adjective> <name>", a nameless
// player is "<adjective> <word>", without adjectives "<word> NN".
export function displayName(name, seed, { adjectives = [], word = DEFAULT_PLAYER_WORD } = {}) {
  const adjective = adjectives.length > 0 ? adjectives[seed % adjectives.length] : null;
  const who = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  if (adjective === null && who === null) return `${word} ${(seed % 90) + 10}`;
  return [adjective, who ?? word].filter(Boolean).join(' ').slice(0, 32);
}

// This player's presence identity, { name, color }: the sync panel profile,
// falling back to the site's tg-login name and the seed-derived color -
// exactly what peers see next to this player's cursor. A missing seed is
// created and stored the way sync.js does it, so both agree afterwards.
export function localIdentity(storage = globalThis.localStorage, { adjectives = getAdjectives(), word = DEFAULT_PLAYER_WORD } = {}) {
  const prof = readJson(storage, PROFILE_KEY) ?? {};
  let seed = prof.seed;
  if (!Number.isSafeInteger(seed) || seed < 0) {
    seed = Math.floor(Math.random() * 2 ** 31);
    try {
      storage.setItem(PROFILE_KEY, JSON.stringify({ ...prof, seed }));
    } catch {
      /* storage unavailable */
    }
  }
  let name = typeof prof.name === 'string' && prof.name.trim() !== '' ? prof.name.trim() : null;
  if (name === null) {
    const u = readJson(storage, 'dnd-tg-user');
    name = u?.first_name ?? u?.username ?? null;
  }
  const color = typeof prof.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(prof.color) ? prof.color : USER_COLORS[seed % USER_COLORS.length];
  return { name: displayName(name, seed, { adjectives, word }), color };
}

// --- pure: document snapshot and diff ---------------------------------------

const num = (v) => (Number.isFinite(v) ? v : null);

// What the journal cares about, lifted out of the canvas doc: combatants
// with their stats, the round and the active combatant. Cheap to take on
// every commit (no urls, no strokes, no terrain).
export function combatSnapshot(doc) {
  const tokens = new Map();
  for (const n of doc?.nodes ?? []) {
    if (nodeKind(n) !== 'token') continue;
    const ext = n[EXT];
    tokens.set(n.id, {
      id: n.id,
      name: typeof ext.name === 'string' ? ext.name : '',
      kind: ext.tokenKind === 'monster' ? 'monster' : 'player',
      hp: num(ext.hp),
      hpMax: num(ext.hpMax),
      ac: num(ext.ac),
      initiative: num(ext.initiative),
    });
  }
  const combat = doc ? getExt(doc).combat : {};
  return { tokens, round: num(combat.round) ?? 1, activeNodeId: combat.activeNodeId ?? null };
}

// The events that take `prev` to `next` (both combatSnapshot()s), without
// `by`: token-add, rename, hp, initiative, token-remove, then turn or
// combat-reset. A token that appears and disappears within one diff cannot
// happen (snapshots bracket a single commit), and stat edits of a token
// added in the same commit ride on its token-add.
export function diffSnapshots(prev, next) {
  const events = [];
  const ev = (type, data) => events.push({ type, data });
  for (const [id, cur] of next.tokens) {
    const was = prev.tokens.get(id);
    if (!was) {
      const data = { nodeId: id, name: cur.name, kind: cur.kind };
      if (cur.hp !== null) data.hp = cur.hp;
      if (cur.hpMax !== null) data.hpMax = cur.hpMax;
      if (cur.ac !== null) data.ac = cur.ac;
      ev('token-add', data);
      continue;
    }
    if (was.name !== cur.name) ev('rename', { nodeId: id, from: was.name, to: cur.name });
    if (was.hp !== cur.hp) ev('hp', { nodeId: id, name: cur.name, from: was.hp, to: cur.hp });
    if (was.initiative !== cur.initiative) ev('initiative', { nodeId: id, name: cur.name, value: cur.initiative });
  }
  for (const [id, was] of prev.tokens) {
    if (!next.tokens.has(id)) ev('token-remove', { nodeId: id, name: was.name });
  }
  if (prev.round !== next.round || prev.activeNodeId !== next.activeNodeId) {
    const reset = next.round === 1 && next.activeNodeId === null;
    if (reset) {
      ev('combat-reset', {});
    } else {
      const active = next.tokens.get(next.activeNodeId);
      ev('turn', { round: next.round, activeNodeId: next.activeNodeId, activeName: active?.name ?? null });
    }
  }
  return events;
}

export const diffDocs = (prevDoc, nextDoc) => diffSnapshots(combatSnapshot(prevDoc), combatSnapshot(nextDoc));

// --- pure: a <roll-dice> result -> event -------------------------------------

// `result` is what dice.js roll() returns ({ total, formula, terms }); faces
// are the kept die values in rolling order, crit follows the d20 rule
// (dice.js critFromResult) so the story can celebrate a natural 20.
export function rollEvent(result, { label = null } = {}) {
  const faces = [];
  let crit = null;
  for (const term of result?.terms ?? []) {
    if (term.type !== 'dice') continue;
    for (const r of term.rolls ?? []) {
      if (!r.kept) continue;
      faces.push(r.value);
      if (term.sides === 20 && term.sign >= 0) {
        if (r.value === 20) crit = 'success';
        else if (r.value === 1 && crit === null) crit = 'failure';
      }
    }
  }
  const data = { formula: String(result?.formula ?? ''), total: num(result?.total), faces };
  if (typeof label === 'string' && label.trim() !== '') data.label = label.trim().slice(0, 80);
  if (crit) data.crit = crit;
  return { type: 'roll', data };
}

// --- live: queue, batching, posting -----------------------------------------

const logs = new Map(); // storageKey -> log

export async function postEvents(server, room, events, { fetchFn = globalThis.fetch, keepalive = false } = {}) {
  const res = await fetchFn(`${server.replace(/\/+$/, '')}/rooms/${encodeURIComponent(room)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
    keepalive,
  });
  if (!res.ok) throw new Error(`event post failed (${res.status})`);
  return res.json();
}

// Start journaling the store under `storageKey` (idempotent per key). The
// log reads the room from localStorage at the moment an event happens, so
// it follows joins and leaves without being restarted; with no room the
// event is dropped. `word` is the toolbar's label-syncplayer (the generic
// player word); `storage`/`fetchFn`/`now` are for tests.
export function startEventLog(storageKey = DEFAULT_KEY, { word, storage = globalThis.localStorage, fetchFn = globalThis.fetch } = {}) {
  if (logs.has(storageKey)) {
    if (word) logs.get(storageKey).word = word;
    return logs.get(storageKey);
  }
  const store = getStore(storageKey);
  const log = {
    word: word || DEFAULT_PLAYER_WORD,
    queue: [], // [{ room, server, event }]
    timer: null,
    inflight: false,
    failures: 0,
    snapshot: combatSnapshot(store.doc),
  };
  logs.set(storageKey, log);

  const enqueue = (events) => {
    const cfg = readSyncConfig(storage);
    if (!cfg || events.length === 0) return;
    const by = localIdentity(storage, { word: log.word });
    for (const e of events) log.queue.push({ ...cfg, event: { ...e, by } });
    if (log.queue.length > QUEUE_LIMIT) log.queue.splice(0, log.queue.length - QUEUE_LIMIT);
    dlog('events', `${events.length} event(s) queued for room ${cfg.room}`, events);
    schedule(FLUSH_DELAY);
  };

  const schedule = (delay) => {
    if (log.timer !== null) return;
    log.timer = setTimeout(() => {
      log.timer = null;
      flush();
    }, delay);
  };

  // One batch per room+server pair at the head of the queue; the rest waits
  // for the next flush (a room switch mid-queue is the only way to get two).
  const flush = async ({ keepalive = false } = {}) => {
    if (log.inflight || log.queue.length === 0) return;
    const { room, server } = log.queue[0];
    const batch = [];
    while (batch.length < 200 && batch.length < log.queue.length && log.queue[batch.length].room === room && log.queue[batch.length].server === server) {
      batch.push(log.queue[batch.length].event);
    }
    log.inflight = true;
    try {
      await postEvents(server, room, batch, { fetchFn, keepalive });
      log.queue.splice(0, batch.length);
      log.failures = 0;
      dlog('events', `${batch.length} event(s) posted to room ${room}`);
      if (log.queue.length) schedule(0);
    } catch (err) {
      const delay = RETRY_DELAYS[Math.min(log.failures, RETRY_DELAYS.length - 1)];
      log.failures += 1;
      dlog('events', `post to room ${room} failed - retry in ${delay} ms`, err);
      schedule(delay);
    } finally {
      log.inflight = false;
    }
  };

  log.unsubscribe = store.subscribe((e) => {
    if (e.type !== 'change') return;
    const next = combatSnapshot(store.doc);
    if (!e.full) enqueue(diffSnapshots(log.snapshot, next));
    log.snapshot = next;
  });

  log.onRoll = (e) => {
    const result = e.detail;
    if (!result || typeof result.total !== 'number') return;
    const target = e.target;
    const label = target?.getAttribute?.('label') ?? target?.dataset?.label ?? null;
    enqueue([rollEvent(result, { label })]);
  };
  // the tab is closing: send what is queued right away, keepalive lets the
  // request outlive the page
  log.onPageHide = () => {
    if (log.timer !== null) {
      clearTimeout(log.timer);
      log.timer = null;
    }
    flush({ keepalive: true });
  };
  if (typeof document !== 'undefined') document.addEventListener('roll', log.onRoll);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', log.onPageHide);

  log.flush = () => flush();
  log.stop = () => {
    log.unsubscribe();
    if (typeof document !== 'undefined') document.removeEventListener('roll', log.onRoll);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', log.onPageHide);
    if (log.timer !== null) clearTimeout(log.timer);
    logs.delete(storageKey);
  };
  return log;
}

export function stopEventLog(storageKey = DEFAULT_KEY) {
  logs.get(storageKey)?.stop();
}
