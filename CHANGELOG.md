# Changelog

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
