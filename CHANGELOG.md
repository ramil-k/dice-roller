# Changelog

## Unreleased

- `<battle-toolbar>` — a new always-visible vertical dock pinned to the
  bottom-right corner with initiative, battle map and dice buttons (the
  recommended page-level entry point; localizable via `label-*`).
- The battle-mat overlay became the **battle screen**: a full-viewport CSS
  grid with the map, the token pool and the embedded initiative tracker
  stacked on the left (pool and tracker rows at their natural height) and a
  toolbar column on the right — the map tools group at its top and, aligned
  to the bottom like the page dock, dock-style controls: area toggles
  (persisted per device in the new `battle-mat-ui` localStorage key), a d20
  button that opens the dice roller on top, and the close button at the very
  bottom. `openBattleMat()` gained `labels` and `show` options; the pool
  moved from a floating card to a full-width row.
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
