// Tab side of the sync hub (sync-hub.js): a Yjs provider that talks to the
// hub over a MessagePort instead of a WebSocket, with the same surface
// sync.js used from y-websocket's WebsocketProvider - `awareness`,
// 'status' / 'sync' events, destroy().
//
// openHubPort() finds the hub: the SharedWorker at the configured same-origin
// URL (a shim importing dist/battle-mat-sync-worker.js, or that file itself
// on the demo site), or - when SharedWorker is missing, the URL fails, or
// the worker stays silent - an in-page hub over a MessageChannel. The
// in-page hub is a module singleton, so even the fallback shares one socket
// across this tab's sessions.

import { ObservableV2 } from 'lib0/observable';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createHub } from './sync-hub.js';

export const DEFAULT_WORKER_URL = '/battle-mat-sync-worker.js';
export const WORKER_HELLO_TIMEOUT = 1500;
// a resumed room with a replica but no server yet is usable after this long
export const REPLICA_GRACE = 3000;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// The shim's URL: set explicitly, else the `sync-worker` attribute of the
// page's <battle-toolbar> (read lazily, so <add-to-battle> on the same page
// finds it too), else the default at the site root.
let workerUrl = null;
export const setWorkerUrl = (url) => {
  workerUrl = typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
};
export const getWorkerUrl = () => {
  if (workerUrl) return workerUrl;
  const attr = globalThis.document?.querySelector?.('battle-toolbar[sync-worker]')?.getAttribute('sync-worker');
  return typeof attr === 'string' && attr.trim() !== '' ? attr.trim() : DEFAULT_WORKER_URL;
};

let inPageHub = null;
export const inPagePort = () => {
  inPageHub ??= createHub();
  const { port1, port2 } = new MessageChannel();
  inPageHub.attach(port2);
  return port1;
};

// Resolve a MessagePort to a hub. `hello` is sent through whichever port
// answers first; the worker gets WORKER_HELLO_TIMEOUT to prove it is alive.
// Resolves { port, kind: 'worker' | 'page', queued } - `queued` holds what
// the hub already sent in reply (its status, handshake), for the provider
// to replay once it owns the port.
export function openHubPort(hello, { url = getWorkerUrl(), timeout = WORKER_HELLO_TIMEOUT, SharedWorkerImpl = globalThis.SharedWorker } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      const port = inPagePort();
      port.postMessage(hello);
      resolve({ port, kind: 'page' });
    };
    if (typeof SharedWorkerImpl !== 'function') return fallback();
    let worker;
    try {
      worker = new SharedWorkerImpl(url, { name: 'battle-mat-sync' });
    } catch {
      return fallback();
    }
    const port = worker.port;
    const queued = [];
    const timer = setTimeout(() => {
      port.onmessage = null;
      fallback();
    }, timeout);
    worker.onerror = () => {
      clearTimeout(timer);
      port.onmessage = null;
      fallback();
    };
    port.onmessage = (e) => {
      queued.push(e.data);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onerror = null;
      // the hub answers hello with its status first; replies that land before
      // the provider takes the port over are replayed by connect()
      resolve({ port, kind: 'worker', queued });
    };
    port.start?.();
    port.postMessage(hello);
  });
}

// Provider over a MessagePort. `synced` (and the 'sync' event) mean "the
// replica is as good as it gets for now": the hub synced with the server,
// or it loaded a replica and REPLICA_GRACE passed without the server.
export class HubProvider extends ObservableV2 {
  constructor(ydoc, { room, server, version, awareness = new awarenessProtocol.Awareness(ydoc) } = {}) {
    super();
    this.doc = ydoc;
    this.awareness = awareness;
    this.room = room;
    this.server = server;
    this.version = version;
    this.port = null;
    this.kind = null;
    this.synced = false;
    this.status = 'connecting';
    this.pending = 0;
    this.hub = null; // last status message from the hub
    this.destroyed = false;
    this._graceTimer = null;

    this._updateHandler = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this._send(encoding.toUint8Array(encoder));
    };
    this._awarenessHandler = ({ added, updated, removed }, origin) => {
      if (origin === this) return; // what the hub told us needs no echo
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      this._send(encoding.toUint8Array(encoder));
    };
    ydoc.on('update', this._updateHandler);
    awareness.on('update', this._awarenessHandler);
  }

  get hello() {
    return { type: 'hello', room: this.room, server: this.server, v: this.version, clientId: this.doc.clientID };
  }

  // Attach a port (from openHubPort), replaying what the opener received.
  connect({ port, kind, queued = [] }) {
    if (this.destroyed) return;
    this.port = port;
    this.kind = kind;
    port.onmessage = (e) => this._onMessage(e.data);
    port.start?.();
    // the server's handshake: our state vector + our presence
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this._send(encoding.toUint8Array(encoder));
    if (this.awareness.getLocalState() !== null) {
      this._awarenessHandler({ added: [this.doc.clientID], updated: [], removed: [] });
    }
    for (const data of queued) this._onMessage(data);
    queued.length = 0;
  }

  wake() {
    this._send({ type: 'wake' });
  }

  _send(message) {
    if (!this.port) return;
    try {
      this.port.postMessage(message);
    } catch {
      // hub gone; a reload re-homes the tab
    }
  }

  _onMessage(data) {
    if (this.destroyed) return;
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) this._send(encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
      }
      return;
    }
    switch (data?.type) {
      case 'renew':
        if (this.awareness.getLocalState() !== null) this.awareness.setLocalState(this.awareness.getLocalState());
        break;
      case 'status':
        this._onStatus(data);
        break;
      default:
        break;
    }
  }

  _onStatus(msg) {
    this.hub = msg;
    this.pending = msg.pending ?? 0;
    this.status = msg.status;
    this.emit('status', [{ status: this.status, pending: this.pending }]);
    if (msg.status === 'outdated') {
      clearTimeout(this._graceTimer);
      return;
    }
    if (!this.synced) {
      if (msg.serverSynced) this._markSynced();
      else if (msg.loaded && this._graceTimer === null) {
        this._graceTimer = setTimeout(() => {
          this._graceTimer = null;
          if (!this.synced && !this.destroyed && this.hub?.status !== 'outdated') this._markSynced();
        }, REPLICA_GRACE);
      }
    }
  }

  _markSynced() {
    clearTimeout(this._graceTimer);
    this._graceTimer = null;
    this.synced = true;
    this.emit('sync', [true]);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._graceTimer);
    this.doc.off('update', this._updateHandler);
    this.awareness.off('update', this._awarenessHandler);
    this._send({ type: 'bye' });
    if (this.port) {
      this.port.onmessage = null;
      try {
        this.port.close?.();
      } catch {
        // already closed
      }
      this.port = null;
    }
    super.destroy();
  }
}
