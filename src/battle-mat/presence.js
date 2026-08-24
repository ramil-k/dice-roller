// Presence plumbing between the sync engine (sync.js) and the UI - live
// cursors on the map and focus rings on tracker inputs. Window events keep
// the modules decoupled: the tracker and the overlay never import the sync
// chunk (it bundles yjs), and with sync off nobody listens, so publishing is
// inert.
//
//   'battle-mat-presence'   detail { key, patch }   UI -> sync (local state)
//       patch.cursor: { x, y } in world coordinates, or null when the
//                     pointer leaves the map
//       patch.focus:  { nodeId, field } while a tracker input is focused,
//                     or null on blur
//   'battle-mat-awareness'  detail { key, states } sync -> UI (remote peers)
//       states: [{ clientId, user: { name, color }, cursor?, focus? }]

export const PRESENCE_EVENT = 'battle-mat-presence';
export const AWARENESS_EVENT = 'battle-mat-awareness';

export const publishPresence = (key, patch) => {
  window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: { key, patch } }));
};

// Peer-supplied values end up in styles and labels - keep them boring.
export const safeColor = (c, fallback = '#8a94ab') =>
  typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;

export const safeName = (n) => (typeof n === 'string' ? n.slice(0, 24) : '');
