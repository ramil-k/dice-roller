// SharedWorker entry: the browser-wide sync hub (sync-hub.js). Built as a
// classic self-contained script (vite --mode worker -> dist/battle-mat-
// sync-worker.js) so that a site embedding the toolbar cross-origin can
// host a one-line same-origin shim
//
//   importScripts('https://ramil-k.github.io/dice-roller/battle-mat-sync-worker.js');
//
// SharedWorker only accepts same-origin script URLs, while importScripts
// inside a classic worker needs no CORS. The shim URL never changes, so the
// worker outlives client deploys - which is why the hub carries no bridge
// semantics (see sync-hub.js) and why its port protocol must stay
// backwards compatible.
import { createHub } from './sync-hub.js';

const hub = createHub();
self.onconnect = (e) => {
  for (const port of e.ports) hub.attach(port);
};
