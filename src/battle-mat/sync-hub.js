// The sync hub: one connection to dice-roller-sync per browser.
//
// A hub holds, per room, the room's Y.Doc replica, the single
// WebsocketProvider to the server, an IndexedDB copy of the replica (so the
// room survives reloads and works offline) and the MessagePorts of the tabs
// that use the room. Toward the tabs it speaks the y-websocket wire protocol
// exactly like the server does (see dice-roller-sync/src/wsdoc.js): a tab
// port is to the hub what a socket is to the server. The hub applies no
// bridge semantics of its own - the plain-doc <-> Y.Doc mapping stays in
// the tabs (sync.js) - which is what lets the hub outlive deploys: it runs
// in a SharedWorker reached through a stable URL (see sync-worker.js), while
// the tabs' chunks are hashed per build.
//
// The same code runs inside a tab when SharedWorker is unavailable (Chrome
// on Android, missing shim): sync-port.js then wires a MessageChannel to an
// in-page hub, and that tab simply gets its own connection.
//
// Port protocol (JSON control messages, Uint8Array for Yjs traffic):
//   tab -> hub   { type: 'hello', room, server, v, clientId }
//                { type: 'wake' }   network back / tab visible: reconnect now
//                { type: 'bye' }    tab closing (pagehide, stopSync)
//                Uint8Array         y-websocket sync / awareness message
//   hub -> tab   { type: 'status', status, pending, serverSynced, loaded }
//                { type: 'renew' }  re-announce your awareness state
//                Uint8Array
//
// status: 'connecting' (never had server state nor a replica), 'connected',
// 'offline' (had state; the server is unreachable, `pending` tab updates
// wait in the replica), 'outdated' (the server refused this bridge version
// or a newer tab is attached - the tab must reload).
//
// Versions: tabs announce their bridge version `v`. The server verifies a
// connection by the first awareness state it sees, so every tab behind one
// socket must agree: the hub tracks the highest `v` per room and turns older
// tabs away as outdated. When the server closes with CLOSE_OUTDATED the room
// stops reconnecting until a tab with a higher `v` shows up.
//
// Liveness: MessagePorts give no close event inside a SharedWorker, so the
// hub pings its ports every KEEPALIVE_MS with 'renew' - the tab answers by
// re-setting its awareness state (which also keeps it alive on the server
// and for peers, where a background tab's own throttled timers would not) -
// and forgets a port silent for PORT_TIMEOUT_MS, removing its presence.
//
// Pure: no DOM, no globals beyond timers; the WebSocket class and the
// persistence factory are injectable (tests run it under Node with
// MessageChannel).

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const HUB_PROTOCOL = 1;
export const CLOSE_OUTDATED = 4001;
export const KEEPALIVE_MS = 15_000;
export const PORT_TIMEOUT_MS = 90_000;
export const LINGER_MS = 60_000; // keep a room alive this long after its last tab left

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export const roomKey = (server, room) => `${server.replace(/\/+$/, '')}\n${room}`;
export const wsUrl = (server) => `${server.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws`;

const isBinary = (data) => data instanceof Uint8Array || data instanceof ArrayBuffer;
const asBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

const encodeAwareness = (awareness, clients) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
};

const encodeUpdate = (update) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

const post = (port, message) => {
  try {
    port.postMessage(message);
  } catch {
    // port gone - the liveness sweep forgets it
  }
};

// IndexedDB replica (y-indexeddb) where IndexedDB exists; null elsewhere
// (Node, a browser with storage disabled). Returns { whenLoaded, destroy }.
export const defaultPersistence = (name, ydoc) => {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const idb = new IndexeddbPersistence(name, ydoc);
    return { whenLoaded: idb.whenSynced, destroy: () => idb.destroy() };
  } catch {
    return null;
  }
};

export function createHub({
  WebSocketPolyfill,
  persistence = defaultPersistence,
  now = Date.now,
  keepaliveMs = KEEPALIVE_MS,
  portTimeoutMs = PORT_TIMEOUT_MS,
  lingerMs = LINGER_MS,
} = {}) {
  const rooms = new Map(); // roomKey -> entry
  const portRoom = new Map(); // port -> entry

  const statusOf = (entry) => {
    if (entry.outdated) return 'outdated';
    if (entry.provider.synced) return 'connected';
    return entry.serverSynced || entry.hasReplica ? 'offline' : 'connecting';
  };

  const statusMessage = (entry) => ({
    type: 'status',
    protocol: HUB_PROTOCOL,
    status: statusOf(entry),
    pending: entry.pending,
    serverSynced: entry.serverSynced,
    loaded: entry.loaded,
  });

  const broadcastStatus = (entry) => {
    const msg = statusMessage(entry);
    for (const port of entry.ports.keys()) post(port, msg);
  };

  const broadcast = (entry, bytes, except = null) => {
    for (const port of entry.ports.keys()) if (port !== except) post(port, bytes);
  };

  const openRoom = (server, room) => {
    const key = roomKey(server, room);
    let entry = rooms.get(key);
    if (entry) {
      clearTimeout(entry.lingerTimer);
      entry.lingerTimer = null;
      return entry;
    }
    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);
    awareness.setLocalState(null); // the hub itself is nobody
    const provider = new WebsocketProvider(wsUrl(server), room, ydoc, {
      awareness,
      disableBc: true,
      connect: true,
      ...(WebSocketPolyfill ? { WebSocketPolyfill } : {}),
    });
    entry = {
      key,
      server,
      room,
      ydoc,
      awareness,
      provider,
      ports: new Map(), // port -> { clients: Set<number>, lastSeen, v }
      pending: 0,
      serverSynced: false,
      loaded: false,
      hasReplica: false,
      outdated: false,
      maxV: 0,
      rejectedV: null,
      lingerTimer: null,
      persistence: null,
    };
    rooms.set(key, entry);

    entry.persistence = persistence(`battle-mat-room:${key}`, ydoc);
    Promise.resolve(entry.persistence?.whenLoaded)
      .catch(() => {})
      .then(() => {
        entry.loaded = true;
        entry.hasReplica = ydoc.getMap('nodes').size > 0 || ydoc.getMap('meta').size > 0;
        broadcastStatus(entry);
      });

    // a tab's edit -> the other tabs and (via the provider) the server; a
    // remote or replica edit -> every tab
    ydoc.on('update', (update, origin) => {
      const fromPort = entry.ports.has(origin);
      if (fromPort && !provider.synced) {
        entry.pending += 1;
        broadcastStatus(entry);
      }
      broadcast(entry, encodeUpdate(update), fromPort ? origin : null);
    });

    awareness.on('update', ({ added, updated, removed }, origin) => {
      const owned = entry.ports.get(origin);
      if (owned) {
        added.forEach((id) => owned.clients.add(id));
        removed.forEach((id) => owned.clients.delete(id));
      }
      const changed = added.concat(updated, removed);
      broadcast(entry, encodeAwareness(awareness, changed), owned ? origin : null);
    });

    provider.on('status', ({ status }) => {
      if (status === 'connected') {
        // the server lost this browser's presence with the old socket - ask
        // the tabs to announce themselves again (bumps their clocks, so the
        // server takes the states as new)
        for (const port of entry.ports.keys()) post(port, { type: 'renew' });
      }
      broadcastStatus(entry);
    });
    provider.on('sync', (synced) => {
      if (synced) {
        entry.serverSynced = true;
        entry.pending = 0;
      }
      broadcastStatus(entry);
    });
    provider.on('connection-close', (ev) => {
      if (ev?.code !== CLOSE_OUTDATED) return;
      // every attached tab runs the rejected bridge - stop retrying until a
      // newer tab shows up
      provider.shouldConnect = false;
      provider.disconnect();
      entry.outdated = true;
      entry.rejectedV = entry.maxV;
      broadcastStatus(entry);
    });

    return entry;
  };

  const closeRoom = (entry) => {
    rooms.delete(entry.key);
    clearTimeout(entry.lingerTimer);
    entry.provider.destroy();
    entry.persistence?.destroy?.();
    entry.awareness.destroy();
    entry.ydoc.destroy();
  };

  const detach = (port, { reason } = {}) => {
    const entry = portRoom.get(port);
    portRoom.delete(port);
    if (!entry) return;
    const owned = entry.ports.get(port);
    entry.ports.delete(port);
    if (owned && owned.clients.size > 0) {
      awarenessProtocol.removeAwarenessStates(entry.awareness, [...owned.clients], reason ?? 'bye');
    }
    port.onmessage = null;
    try {
      port.close?.();
    } catch {
      // already closed
    }
    if (entry.ports.size === 0) {
      clearTimeout(entry.lingerTimer);
      entry.lingerTimer = setTimeout(() => {
        if (entry.ports.size === 0) closeRoom(entry);
      }, lingerMs);
      entry.lingerTimer.unref?.();
    }
  };

  const hello = (port, { room, server, v }) => {
    if (typeof room !== 'string' || typeof server !== 'string') return;
    detach(port); // a second hello re-homes the port
    const entry = openRoom(server, room);
    const version = Number.isFinite(Number(v)) ? Number(v) : 0;
    if (version < entry.maxV) {
      post(port, { ...statusMessage(entry), status: 'outdated' });
      return;
    }
    if (version > entry.maxV) {
      entry.maxV = version;
      // the tabs on the older bridge must reload before they write again
      for (const [other, info] of [...entry.ports]) {
        if (info.v < version) {
          post(other, { ...statusMessage(entry), status: 'outdated' });
          detach(other, { reason: 'outdated' });
        }
      }
      if (entry.outdated && (entry.rejectedV === null || version > entry.rejectedV)) {
        entry.outdated = false;
        entry.rejectedV = null;
        entry.provider.wsUnsuccessfulReconnects = 0;
        entry.provider.connect();
      }
    }
    entry.ports.set(port, { clients: new Set(), lastSeen: now(), v: version });
    portRoom.set(port, entry);
    post(port, statusMessage(entry));
    // the handshake the server would do: our state vector, then presence
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, entry.ydoc);
    post(port, encoding.toUint8Array(encoder));
    const states = entry.awareness.getStates();
    if (states.size > 0) post(port, encodeAwareness(entry.awareness, [...states.keys()]));
  };

  const wake = (entry) => {
    const { provider } = entry;
    if (entry.outdated || provider.wsconnected) return;
    // skip the backoff: the network just came back / the user is looking
    provider.wsUnsuccessfulReconnects = 0;
    provider.disconnect();
    provider.connect();
  };

  const onBinary = (port, entry, bytes) => {
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, entry.ydoc, port);
        if (encoding.length(encoder) > 1) post(port, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), port);
      }
    } catch (err) {
      console.error('sync hub: bad message from a tab', err);
    }
  };

  const attach = (port) => {
    port.onmessage = (e) => {
      const data = e.data;
      const entry = portRoom.get(port);
      if (entry) entry.ports.get(port).lastSeen = now();
      if (isBinary(data)) {
        if (entry) onBinary(port, entry, asBytes(data));
        return;
      }
      switch (data?.type) {
        case 'hello':
          hello(port, data);
          break;
        case 'wake':
          if (entry) wake(entry);
          break;
        case 'bye':
          detach(port);
          break;
        default:
          break;
      }
    };
    port.start?.();
  };

  // liveness sweep + presence renewal
  const sweep = () => {
    const t = now();
    for (const entry of rooms.values()) {
      for (const [port, info] of [...entry.ports]) {
        if (t - info.lastSeen > portTimeoutMs) detach(port, { reason: 'timeout' });
        else post(port, { type: 'renew' });
      }
    }
  };
  const sweepTimer = setInterval(sweep, keepaliveMs);
  sweepTimer.unref?.();

  // the worker's own network signal; tabs send 'wake' for theirs
  const onOnline = () => {
    for (const entry of rooms.values()) wake(entry);
  };
  globalThis.addEventListener?.('online', onOnline);

  return {
    attach,
    rooms,
    sweep,
    destroy() {
      clearInterval(sweepTimer);
      globalThis.removeEventListener?.('online', onOnline);
      for (const port of [...portRoom.keys()]) detach(port);
      for (const entry of [...rooms.values()]) closeRoom(entry);
    },
  };
}
