# Changelog

## Unreleased

- Fixed: in a sync room, a combatant (or any node) removed by one peer came
  back a moment later. The bridge treated "node in my doc but not in the
  Y.Doc" as a local addition, so every *other* connected client - a second
  tab on the same device included - re-created the node it had just been
  told to drop, and the resurrection propagated back to the deleter. A node
  that is in the last synced snapshot but gone from the Y.Doc is now
  recognized as a remote deletion and left to the next materialize.

- Attached map images no longer travel inside the room document as data
  URIs. Once a session is connected, every inline image (the seed of a new
  room, an older room's content, a picture attached while in the room) is
  uploaded to the room's image store on the sync server
  (`POST /rooms/<code>/images`) and the node's `url` becomes a short,
  immutable link - the multi-megabyte value leaves the CRDT and Yjs
  garbage-collects it, so peers no longer download every picture on every
  connect and `localStorage` stops filling up with them. Outside a room
  nothing changes: images stay inline and the mat works offline. A failed
  upload keeps the image inline.

- `<add-to-battle>` resolves a site-relative `image` to an absolute URL
  before the combatant enters the encounter, so peers of a sync room on a
  different origin (a fork of the site) see the avatar.

- The battle screen survives page navigation within a tab: `<battle-toolbar>`
  reopens it on the next page in the same shape (tracker HUD or map, per the
  `battle-mat-ui` area toggles) without stealing focus. The open flag is the
  per-tab `sessionStorage` key `battle-mat-screen` - other tabs are not
  affected - and Escape clears it.

- Fixed: a `localStorage` write from another tab (or another page of the
  site) replaced the whole encounter including the writer's pan/zoom, so
  the viewport jumped; in a sync room the adopted (possibly older) copy then
  looked like a local edit and was pushed to the room, dropping edits such
  as an image lock. Cross-tab updates now keep the tab's own viewport, and a
  store driven by a sync room ignores storage events altogether.
- Verbose diagnostics: every path that replaces the document, moves the
  viewport or flips an image lock logs to the console (`[bm ...]` lines,
  incl. the exact field ops each sync push sends). On by default; set
  `localStorage['battle-mat-debug'] = 'off'` to silence.

- Battle map images can be selected, resized and locked. Clicking an
  attached image (select tool) draws a selection frame with eight resize
  handles and opens a card next to it — the image's size in px and grid
  cells, a lock toggle and a remove button. Corner handles keep the aspect
  ratio (hold Shift to free them), edge handles pull one side; images never
  snap to the grid. A locked image (`x-battleMat.locked: true`, carried by
  exports and merged per field in sync rooms like the size) cannot be
  moved, resized or erased — dragging it pans the map, a tap still selects
  it (dashed frame, no handles) so it can be unlocked. Delete/Backspace
  removes the selected unlocked image, Escape deselects. The card now
  survives whole-document updates (sync-room edits, other tabs) as long as
  its node still exists. Localizable via `label-image`, `label-lock`,
  `label-unlock`, `label-imageremove` on `<battle-toolbar>`.

- Sync rooms: the battle screen toolbar gained a sync button (Chikin's
  circumnavigation glyph) that opens a room panel — create a room from the
  current encounter or join one by code. While connected the encounter is a
  Yjs CRDT hosted by [dice-roller-sync](https://github.com/ramil-k/dice-roller-sync):
  everyone's edits merge live per field of a single node (pan/zoom stays
  local), the room replaces the local encounter on join (after a confirm)
  and an empty room is seeded from it on create. The session persists in
  `battle-mat-sync` and reconnects on page load, screen open or not; the
  engine is a separate lazy chunk (~45 KB gzip). The room name in the panel
  is an invite link (`#bm-room=<code>`, also copied by **Copy invite link**):
  opening it on any page with `<battle-toolbar>` joins the room, silently
  when there is no local encounter. Localizable via `label-sync*` on
  `<battle-toolbar>`.

- Presence in sync rooms: peers see each other's named, colored cursor on the
  map and a colored ring on the tracker input a peer is editing (name as the
  tooltip). The sync panel has a name field and a color palette
  (`battle-mat-profile`); the name falls back to the page's tg-login profile
  and is always prefixed with an instance adjective from the shared
  adjective list, so two players with the same name still differ (a nameless
  player is just the adjective). Presence rides on Yjs awareness and is never
  stored.

- The initiative tracker is a grid table now: rows are subgrids (columns
  line up across rows), the header is a wrapping flex row with a spacer, and
  below 600px each row wraps into two lines (marker + name, then HP / AC /
  initiative / remove).

- `<add-to-battle>` — new `link` attribute: the URL of the creature's page is
  stored on the token (`x-battleMat.link`) and initiative-tracker rows show it
  as a small external-link anchor next to the name (opens in a new tab; rows
  without a link render no anchor). The token card shows the same anchor in
  its header. Localizable via `label-link` on `<battle-toolbar>` /
  `<initiative-tracker>`.

- `<battle-toolbar>` — a new always-visible vertical dock pinned to the
  bottom-right corner with initiative, battle map and dice buttons (the
  recommended page-level entry point; localizable via `label-*`). The
  initiative button opens the tracker HUD without the map (`openBattleMat()`
  gained a `hide` option alongside `show`).
- The battle-mat overlay became the **battle screen**: a full-viewport CSS
  grid with the map, the token pool and the embedded initiative tracker
  stacked on the left (pool and tracker rows content-sized, the tracker
  capped at a third of the screen and zero when hidden) and a
  toolbar column on the right — the map tools group at its top and, aligned
  to the bottom like the page dock, dock-style controls: area toggles
  (persisted per device in the new `battle-mat-ui` localStorage key) and a
  d20 button that opens the dice roller on top; Escape closes the screen.
  The grid always fills the viewport; with the map toggled off the page
  shows through its cell and stays clickable (HUD mode).
  `openBattleMat()` gained `labels` and `show` options; the pool moved from
  a floating card to a full-width row.
- Token card: clicking a token on the map (select tool) or an
  initiative-tracker row opens a small card next to it with the combatant's
  name, HP, AC and initiative, plus a size row (1×1 … 4×4 cells) and a ring-color picker (six JSON Canvas
  presets + kind default; stored as the node's `color`, synced to the
  tracker and carried by exports). Node clicks tolerate up to 5px of pointer
  jitter — a shaky click no longer turns into a micro-drag. Tokens spanning
  an even number of cells snap by their center to grid intersections, so a
  2×2 token covers exactly four cells instead of straddling nine.
- Token name plates: hovering a token shows its name (replacing the native
  <title> tooltips); hold Shift to show every name on the map, or pin them
  with the new tag button in the tools bar (the touch path). Plates are
  uniform in size, left-aligned under the token, and render in their own
  layer above all tokens. The token-pool toggle moved from the toolbar's
  bottom controls into the tools bar, so the bottom mirrors the dock exactly
  (initiative, map, dice).
- The dice overlay now moves focus into itself on open, so a document-level
  Escape/Tab is handled by the topmost surface only (Escape over the battle
  screen closes just the dice).
- New export `openDiceBuilder(opener, onRoll, opts)` from the main entry.

## 0.1.0

Initial release.

- `<roll-dice>` — inline formula trigger (text or `formula` attribute, plus a
  compact icon-only mode) opening a full-screen overlay with mathematically
  constructed 3D SVG dice, keep/drop syntax, and critical hit / fumble
  animations on natural d20s.
- `<roll-any-dice>` — floating corner button opening the overlay in builder
  mode: assemble any pool from a dice tray, adjust a flat modifier, roll.
- `<roll-log>` — collapsible corner panel with the persistent roll history
  (`localStorage`, newest 50 rolls, synced across tabs).
- Bubbling `roll` event with the full result object on every completed roll.
- Programmatic API: `parseFormula`, `roll`, `rollDie`, `poolToParsed`,
  `readRollLog`, `clearRollLog`.
