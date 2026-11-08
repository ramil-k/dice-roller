// The sync hub (one socket per browser) and the tab-side port provider,
// under Node: MessageChannel ports stand in for SharedWorker ports, a fake
// WebSocket stands in for the server so offline / reconnect / version
// rejection can be driven by hand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { createHub, CLOSE_OUTDATED } from '../src/battle-mat/sync-hub.js';
import { HubProvider, openHubPort, REPLICA_GRACE } from '../src/battle-mat/sync-port.js';

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.OPEN = 1;
    this.sent = [];
    FakeWS.instances.push(this);
  }
  send(bytes) {
    this.sent.push(bytes);
  }
  close() {
    this.readyState = 3;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(bytes) {
    this.onmessage?.({ data: bytes });
  }
  // what the real server does after a client connects: step2 with its state
  serve(serverDoc = new Y.Doc()) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep2(enc, serverDoc);
    this.receive(encoding.toUint8Array(enc));
  }
  serverClose(code) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}
const lastWS = () => FakeWS.instances.at(-1);

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await tick(10);
  }
};

const SERVER = 'https://sync.example';
const cleanup = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()();
  FakeWS.instances.length = 0;
  vi.useRealTimers();
});

const makeHub = (opts = {}) => {
  const hub = createHub({ WebSocketPolyfill: FakeWS, persistence: () => null, ...opts });
  cleanup.push(() => hub.destroy());
  return hub;
};

// a "tab": its own Y.Doc + provider, wired to `hub` through a MessageChannel
const tab = (hub, { room = 'brave-otter-4821', version = 3 } = {}) => {
  const ydoc = new Y.Doc();
  const provider = new HubProvider(ydoc, { room, server: SERVER, version });
  provider.awareness.setLocalStateField('v', version);
  provider.awareness.setLocalStateField('user', { name: 'T', color: '#58b7d8', pid: version });
  const statuses = [];
  provider.on('status', (s) => statuses.push(s));
  const { port1, port2 } = new MessageChannel();
  hub.attach(port2);
  port1.postMessage(provider.hello);
  provider.connect({ port: port1, kind: 'page' });
  cleanup.push(() => {
    provider.destroy();
    ydoc.destroy();
    port1.close();
  });
  return { ydoc, provider, statuses, awareness: provider.awareness };
};

describe('sync hub', () => {
  it('opens one socket per room and relays edits and presence between tabs', async () => {
    const hub = makeHub();
    const a = tab(hub);
    const b = tab(hub);
    await until(() => FakeWS.instances.length === 1);
    expect(lastWS().url).toBe(`wss://sync.example/ws/brave-otter-4821`);

    a.ydoc.getMap('meta').set('combat.round', 4);
    await until(() => b.ydoc.getMap('meta').get('combat.round') === 4);

    a.awareness.setLocalStateField('cursor', { x: 1, y: 2 });
    await until(() => b.awareness.getStates().get(a.ydoc.clientID)?.cursor?.x === 1);
    // the hub itself is nobody in the room
    expect([...b.awareness.getStates().keys()].sort()).toEqual([a.ydoc.clientID, b.ydoc.clientID].sort());
  });

  it('counts edits made while the server is unreachable and clears them on sync', async () => {
    const hub = makeHub();
    const a = tab(hub);
    await until(() => FakeWS.instances.length === 1);
    a.ydoc.getMap('meta').set('combat.round', 1);
    a.ydoc.getMap('meta').set('combat.turn', 2);
    await until(() => a.provider.pending === 2);
    expect(a.provider.status).toBe('connecting'); // never had server state nor a replica
    expect(a.provider.synced).toBe(false);

    lastWS().open();
    lastWS().serve();
    await until(() => a.provider.synced);
    expect(a.provider.status).toBe('connected');
    expect(a.provider.pending).toBe(0);
    // the server got our handshake and the queued edits
    expect(lastWS().sent.length).toBeGreaterThan(0);
  });

  it('reports offline after a sync and reconnects at once on wake', async () => {
    const hub = makeHub();
    const a = tab(hub);
    await until(() => FakeWS.instances.length === 1);
    lastWS().open();
    lastWS().serve();
    await until(() => a.provider.status === 'connected');

    lastWS().serverClose(1006);
    await until(() => a.provider.status === 'offline');
    expect(a.provider.synced).toBe(true); // the session stays usable

    // y-websocket schedules its retry with backoff; wake skips it
    const before = FakeWS.instances.length;
    a.provider.wake();
    await until(() => FakeWS.instances.length > before);
    lastWS().open();
    lastWS().serve();
    await until(() => a.provider.status === 'connected');
  });

  it('turns an older tab away when a newer one shares the room', async () => {
    const hub = makeHub();
    const old = tab(hub, { version: 2 });
    await until(() => old.statuses.length > 0);
    const fresh = tab(hub, { version: 3 });
    await until(() => old.provider.status === 'outdated');
    expect(fresh.provider.status).not.toBe('outdated');
    // and a stale newcomer is refused right away
    const stale = tab(hub, { version: 1 });
    await until(() => stale.provider.status === 'outdated');
    const room = [...hub.rooms.values()][0];
    expect(room.ports.size).toBe(1);
  });

  it('stops after the server rejects the version and resumes for a newer tab', async () => {
    const hub = makeHub();
    const old = tab(hub, { version: 2 });
    await until(() => FakeWS.instances.length === 1);
    lastWS().open();
    lastWS().serverClose(CLOSE_OUTDATED);
    await until(() => old.provider.status === 'outdated');
    const room = [...hub.rooms.values()][0];
    expect(room.provider.shouldConnect).toBe(false);

    const sockets = FakeWS.instances.length;
    const fresh = tab(hub, { version: 3 });
    await until(() => FakeWS.instances.length > sockets);
    expect(room.provider.shouldConnect).toBe(true);
    await until(() => fresh.provider.status !== 'outdated');
  });

  it('drops the presence of a tab that said goodbye or went silent', async () => {
    let now = 1_000_000;
    const hub = makeHub({ now: () => now });
    const a = tab(hub);
    const b = tab(hub);
    const c = tab(hub);
    await until(() => a.awareness.getStates().size === 3);

    b.provider.destroy();
    await until(() => a.awareness.getStates().size === 2);
    expect(a.awareness.getStates().has(b.ydoc.clientID)).toBe(false);

    // c stops answering: the sweep forgets it after the port timeout
    const room = [...hub.rooms.values()][0];
    now += 100_000;
    // a keeps talking
    a.awareness.setLocalStateField('cursor', { x: 0, y: 0 });
    await until(() => [...room.ports.values()].some((p) => p.lastSeen === now));
    hub.sweep();
    await until(() => a.awareness.getStates().size === 1);
    expect(room.ports.size).toBe(1);
  });

  it('asks tabs to renew their presence on every sweep', async () => {
    const hub = makeHub();
    const a = tab(hub);
    await until(() => a.statuses.length > 0);
    const clockBefore = a.awareness.meta.get(a.ydoc.clientID).clock;
    hub.sweep();
    await until(() => a.awareness.meta.get(a.ydoc.clientID).clock > clockBefore);
  });
});

describe('hub provider readiness', () => {
  it('syncs at once when the hub has server state', async () => {
    const hub = makeHub();
    const a = tab(hub);
    await until(() => FakeWS.instances.length === 1);
    lastWS().open();
    lastWS().serve();
    await until(() => a.provider.synced);
  });

  it('syncs from the replica after the grace period when the server is silent', async () => {
    const hub = makeHub();
    const a = tab(hub);
    await until(() => a.statuses.length > 0); // loaded (no persistence = loaded)
    expect(a.provider.synced).toBe(false);
    await tick(REPLICA_GRACE + 100);
    expect(a.provider.synced).toBe(true);
  }, 6000);

  it('never syncs a tab the hub turned away', async () => {
    const hub = makeHub();
    tab(hub, { version: 3 });
    const old = tab(hub, { version: 2 });
    await until(() => old.provider.status === 'outdated');
    await tick(REPLICA_GRACE + 100);
    expect(old.provider.synced).toBe(false);
  }, 6000);
});

describe('openHubPort', () => {
  it('falls back to the in-page hub without SharedWorker', async () => {
    const { port, kind } = await openHubPort({ type: 'hello', room: 'x-y-1111', server: SERVER, v: 3 }, { SharedWorkerImpl: undefined });
    expect(kind).toBe('page');
    port.close();
  });

  it('falls back when the worker stays silent, keeping the hub replies otherwise', async () => {
    class SilentWorker {
      constructor() {
        this.port = new MessageChannel().port1;
      }
    }
    const { kind } = await openHubPort({ type: 'hello', room: 'x-y-1111', server: SERVER, v: 3 }, { SharedWorkerImpl: SilentWorker, timeout: 50 });
    expect(kind).toBe('page');

    class TalkativeWorker {
      constructor() {
        const { port1, port2 } = new MessageChannel();
        this.port = port1;
        port2.onmessage = () => {
          port2.postMessage({ type: 'status', status: 'connecting', pending: 0 });
          port2.postMessage(new Uint8Array([0, 0]));
        };
      }
    }
    const res = await openHubPort({ type: 'hello', room: 'x-y-1111', server: SERVER, v: 3 }, { SharedWorkerImpl: TalkativeWorker, timeout: 500 });
    expect(res.kind).toBe('worker');
    await tick();
    expect(res.queued.length).toBe(2); // status + the handshake, replayed by connect()
    res.port.close();
  });
});
