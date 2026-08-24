# Changelog

## Unreleased

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

- `<add-to-battle>` — new `link` attribute: the URL of the creature's page is
  stored on the token (`x-battleMat.link`) and initiative-tracker rows show it
  as a small external-link anchor next to the name (opens in a new tab; rows
  without a link render no anchor). Localizable via `label-link` on
  `<battle-toolbar>` / `<initiative-tracker>`.

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
