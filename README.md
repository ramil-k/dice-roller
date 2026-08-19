# &lt;roll-dice&gt;

Dependency-free web components for tabletop RPG sites. Wrap a dice formula in
`<roll-dice>` and clicking it opens a full-screen overlay with true 3D dice that
spin, settle on a result, and show the total plus a per-die breakdown. A
companion `<roll-any-dice>` element adds a floating button that opens a builder
for rolling any pool of dice on the fly.

Built with Vite; the component itself ships as a single self-contained bundle
with no runtime dependencies.

**[Live demo →](https://ramil-k.github.io/dice-roller/)**

## Install

Drop-in via a `<script>` tag — self-hosted on GitHub Pages, no build step or
npm needed:

```html
<script type="module"
  src="https://ramil-k.github.io/dice-roller/roll-dice.js"></script>

<roll-dice>2d6+3</roll-dice>
```

Or install from npm:

```
npm install @ramilkos/roll-dice
```

```js
import '@ramilkos/roll-dice'; // registers the <roll-dice> element
```

The formula can be given as text content or via the `formula` attribute (the
attribute wins if both are present):

```html
<roll-dice formula="4d6kh3">roll stats</roll-dice>
```

### Compact mode

Add the `compact` attribute to render just the die icon — an inline icon-only
trigger for tight spots like table rows or list items:

```html
<roll-dice formula="1d20+2" compact></roll-dice>
```

The formula stays available to assistive tech via `aria-label` and to sighted
users via the tooltip. An invalid formula keeps its visible error text even in
compact mode, so a broken trigger never looks like a working icon.

## `<roll-any-dice>` — freeform roller

For a persistent roller not tied to a single formula, drop a `<roll-any-dice>`
anywhere on the page — it is a normal in-flow button (see
[Positioning](#positioning-the-widgets) to float it in a corner). Clicking it
opens the same overlay in **builder** mode, where you add and remove any dice
from a tray, adjust a flat modifier, and roll the pool.

```html
<roll-any-dice></roll-any-dice>
```

Attributes:

| Attribute  | Values                                                       | Default        |
| ---------- | ------------------------------------------------------------ | -------------- |
| `dice`     | space/comma-separated die sizes to offer, e.g. `dice="6 20"` (sizes outside 2–1000 are ignored) | `4 6 8 10 12 20` |

It rolls through the same pipeline as `<roll-dice>` and dispatches the same
`roll` event, so host pages can react to freeform rolls too. The button colors
are themable via `--rd-fab-bg` / `--rd-fab-fg` set on the element.

## `<roll-log>` — roll history

Every completed roll (from `<roll-dice>` and `<roll-any-dice>` alike) is
appended to a `localStorage` log capped at the newest 50 entries, so the
history survives page reloads. The roll overlay always shows the log in its
bottom-left corner (time, formula, and total, newest first, with a **Clear**
button); a new roll appears there as its dice settle.

To also show the history on the page itself, drop a `<roll-log>` anywhere: a
small round button that expands into a scrollable panel — time, formula, and
total per roll, crits tinted, newest first — with a **Clear** button. The
panel opens below the button by default; see
[Positioning](#positioning-the-widgets) for pinning and flipping the
direction.

```html
<roll-log></roll-log>
```

The log updates live on every roll and on every clear, including rolls made in
other tabs of the same site. It is stored under the `roll-dice-log` key in
`localStorage`. Programmatic access: `readRollLog()` / `clearRollLog()` are
exported from the module.

The panel is themable via the `--rd-log-*` custom properties set on the
element: `--rd-log-bg`, `--rd-log-fg`, `--rd-log-muted`, `--rd-log-accent`,
`--rd-log-edge`, `--rd-log-btn-bg`.

## `<battle-toolbar>` — the dock

The recommended way to put the battle widgets on a page: an always-visible
vertical dock pinned to the bottom-right corner with three buttons —
initiative, battle map, dice. The first two open the shared
[battle screen](#battle-mat--the-battle-screen) with that area visible; the
dice button opens the [freeform roller](#roll-any-dice--freeform-roller)
overlay directly.

```html
<script type="module"
  src="https://ramil-k.github.io/dice-roller/battle-toolbar.js"></script>

<battle-toolbar></battle-toolbar>
```

```js
import '@ramilkos/roll-dice/battle-toolbar';
```

| Attribute     | Values                                                       | Default             |
| ------------- | ------------------------------------------------------------ | ------------------- |
| `storage-key` | `localStorage` key of the shared encounter                   | `battle-mat-canvas` |
| `roster`      | JSON array of extra pool tokens; the property wins           | `[]`                |
| `dice`        | die sizes the builder tray offers, e.g. `"6 20"`             | `4 6 8 10 12 20`    |
| `label-*`     | localized UI strings for the dock, the battle screen toolbar and the tracker area: `label-map`, `label-pool`, `label-dice` plus the tracker's `label-title`, `label-round`, `label-next`, `label-fill`, `label-reset`, `label-resetconfirm`, `label-empty`, `label-name`, `label-hp`, `label-ac`, `label-init`, `label-remove` | English |

Unlike the other widgets the dock pins itself flush into the corner
(`position: fixed; right: 0; bottom: 0`, only the top-left corner rounded);
adjust the spot with `--bt-right` / `--bt-bottom` / `--bt-z` and the look with
`--bt-bg`, `--bt-edge`, `--bt-radius` and the per-button accents
`--bt-accent-tracker` / `--bt-accent-mat` / `--bt-accent-dice` on the element. The element itself is
eager and tiny; both the battle screen and the dice overlay load via dynamic
`import()` on first click.

The standalone `<roll-any-dice>`, `<battle-mat>` and `<initiative-tracker>`
elements below remain available when you want a single button instead of the
whole dock.

## `<battle-mat>` — the battle screen

The battle screen is a full-viewport CSS grid: stacked on the left, the
**map** (a pannable, zoomable square grid where you drag player and monster
tokens from the pool, draw, erase, measure, attach map images), the **token
pool** row and the **initiative tracker** area (the same panel
`<initiative-tracker>` shows, embedded; the pool row takes its natural
height, the tracker row at least its content and half the map's share of the
free space, the map absorbs the rest) — and a toolbar column on the right, in
the same corner as the dock. The column has the map tools group at its top
and, bottom-aligned, dock-style controls: toggles for the three areas (the
choice persists per device in the `battle-mat-ui` `localStorage` key) and a
d20 button that opens the dice roller on top of the screen. Escape closes the
screen and returns to the page.

The screen always fills the viewport and its rows never collapse. A hidden
area just leaves its cell empty and transparent; with the map toggled off the
page shows through its cell and stays fully clickable — a HUD mode with only
the pool, the tracker and the toolbar overlaid.

`<battle-toolbar>` above is the usual way in; the standalone `<battle-mat>`
button opens the same screen on its map area:

```html
<battle-mat></battle-mat>
<script>
  document.querySelector('battle-mat').roster = [
    { name: 'Aria', image: 'https://example.com/aria.png', kind: 'player' },
    { name: 'Dire Wolf', image: 'https://example.com/wolf.png', kind: 'monster' },
  ];
</script>
```

**The screen code loads lazily.** The `battle-mat` entry is a small trigger
element; everything else (screen, tools, icon registry) is fetched via a
dynamic `import()` the first time the button is clicked. Nothing map-related
is downloaded before that.

```js
import '@ramilkos/roll-dice/battle-mat';
```

The package ships as ES modules only (no UMD — UMD bundles cannot code-split,
and the screen chunk must stay lazy). If you self-host `dist/battle-mat.js`,
also host the `battle-mat-overlay-*.js` chunk next to it; the dynamic import
resolves relative to the entry file. Bundlers handle the split automatically.

| Attribute     | Values                                                 | Default             |
| ------------- | ------------------------------------------------------ | ------------------- |
| `storage-key` | any string — `localStorage` key for this map           | `battle-mat-canvas` |
| `roster`      | JSON array (see below); the `roster` property wins     | `[]`                |

The button is a normal in-flow element — see
[Positioning](#positioning-the-widgets) to float it in a corner.

The token pool's first tab is **Reserve**: combatants added to the encounter
with [`<add-to-battle>`](#add-to-battle--add-a-combatant) that are not yet on
the map. They show up as rows in the initiative tracker immediately but stay
*off* the map until the DM drags (or click-to-places) one from Reserve onto a
cell — one token per combatant, carrying its name, size, stats and any rolled
initiative. Placing a combatant drops it from Reserve.

The **Party** and **Foes** tabs come from the page-provided `roster` array,
followed by the built-in icon categories (Humanoids, Animals, Monsters, Items —
chests, keys, potions, scrolls, gems and other set dressing). Unlike Reserve,
placing from these tabs mints a *new* token each time — `roster` is for ad-hoc
extra tokens. Placing a duplicate of a type already on the map gives it a random
adjective ("Reckless Wolf"), the same as `<add-to-battle>`.

Roster entries are `{ name, image, kind, size, hp, ac, initMod }` — `kind` is
`"player"` or `"monster"`, everything after it optional. `size` is a D&D size
word (`tiny`…`gargantuan`) deciding the token's footprint on the grid (large
2×2, huge 3×3, gargantuan 4×4 cells); `hp`/`ac`/`initMod` are copied onto the
token when it is placed and surface in the initiative tracker.

### Tools

- **Select / move** — drag tokens, drawings, and images; drag empty space to pan.
- **Pan** — drag anywhere to pan. Space+drag or middle-drag pans with any tool;
  the mouse wheel and two-finger pinch zoom around the cursor.
- **Pen, Line, Rectangle, Ellipse** — draw in one of the six preset colors.
- **Eraser** — click or sweep to remove a whole stroke, token, or image.
- **Ruler** — drag to measure; shows `cells · feet` live (5 ft per cell by
  default, configurable).
- **Attach image** — pick a file or drop one onto the map. Images larger than
  2048px are downscaled before storing (they persist as data URIs).
- **Grid settings** — cell size, offset X/Y (to align the grid with an attached
  map image), feet per cell, grid visibility, and snap-to-grid.
- **Export / Import** — download the map as a `.canvas` file or load one.
- **Clear** — remove all content, keeping grid and viewport settings.

Tokens snap to grid cells while snap is enabled. A plain click on a pool
avatar (or Enter/Space on it) arms click-to-place: the next click on the map
places the token — handy on touch screens; Escape or a second avatar click
disarms it.

Escape cancels the in-flight action first (drawing, drag, placement), then
closes an open settings panel, then the screen itself, returning focus to
the button that opened it. With the dice overlay open on top, Escape closes
just the dice.

### Storage format: JSON Canvas

The map autosaves (debounced) to `localStorage` as a
[JSON Canvas 1.0](https://jsoncanvas.org) document, and export/import uses the
same format. Every entity is a spec-valid node of an official type, so
`.canvas` files open in other JSON Canvas tools; battle-mat semantics live in
an `x-battleMat` extension property that conforming tools preserve:

| Entity          | Node `type` | Extension (`x-battleMat`)                              |
| --------------- | ----------- | ------------------------------------------------------ |
| Token           | `link`      | `{ kind: "token", name, source, tokenKind }`           |
| Attached image  | `link`      | `{ kind: "image" }` (`url` is a data URI)              |
| Stroke / shape  | `text`      | `{ kind: "stroke", shape, points, strokeWidth }`       |

Stroke points are stored relative to the node's `x`/`y`, and the node's box is
the drawing's bounding box, so foreign tools still place it correctly. Grid
and viewport settings ride in a top-level `x-battleMat` key:

```json
{ "version": 1,
  "grid": { "cellSize": 64, "visible": true, "snap": true,
            "offsetX": 0, "offsetY": 0, "feetPerCell": 5 },
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "combat": { "round": 1, "activeNodeId": null } }
```

`combat` and the tokens' `initiative` field belong to the
[initiative tracker](#initiative-tracker--turn-order) — one exported
`.canvas` file carries the whole encounter, turn state included.

Nodes from imported files that battle-mat does not understand are kept
untouched (rendered as labeled boxes) and survive an export round-trip.

If autosave fails (private browsing, or a large map image exceeding the
`localStorage` quota) the map keeps working in memory and the status bar
suggests using **Export**.

Beside the encounter document the screen keeps one more `localStorage` key,
`battle-mat-ui` — the area-visibility toggles (`{ "map": true, "pool": true,
"tracker": true }`). It is a per-device UI preference and is not part of the
exported `.canvas` file.

### Built-in token icons

The Humanoids / Animals / Monsters / Items pool tabs use
[Chikin Icons](https://sergeychikin.ru/365/) — an icon pack drawn by Sergey
Chikin (sergeychikin.ru). The SVGs are checked in under `public/365/` (each
under its original path within the set) and served from this repo's GitHub
Pages site; sergeychikin.ru cookie-gates direct requests, so hot-linking them
from the source domain no longer works. The icons are free to use, but
**commercial use requires a license from the author** — see the terms at
[sergeychikin.ru/365](https://sergeychikin.ru/365/) and the Chikin Icons
section of [LICENSE](LICENSE). Maps you export reference the icons by URL and
never inline them.

The categories in `src/battle-mat/registry.js` are hand-picked from the pack.
To browse it or add a category, use the scraper `scripts/chikin-catalog.mjs`,
which parses the icon index into `{ category, path, ru, en, name }` records
(note: the site's cookie gate means the scraper and any icon download need a
valid `realauth` cookie — obtain one by opening sergeychikin.ru in a browser
and pass it as a `Cookie: realauth=...` header; new icons go into
`public/365/<original path>`):

```sh
node scripts/chikin-catalog.mjs --list                 # categories + counts
node scripts/chikin-catalog.mjs --grep сундук          # find icons (RU or EN caption)
node scripts/chikin-catalog.mjs --category 170-weapon --registry Weapons
                                                        # paste-ready CATEGORIES block
```

Verify a new category renders (the pack has no machine-readable index, so paths
are only as good as the scrape) before committing.

### Theming

Set the `--bm-*` custom properties on `battle-mat` (button: `--bm-fab-bg`,
`--bm-fab-fg`) or globally on `:root` for the screen palette: `--bm-bg`,
`--bm-surface`, `--bm-fg`, `--bm-muted`, `--bm-accent`, `--bm-edge`,
`--bm-grid-line`, `--bm-token-player`, `--bm-token-monster`. The embedded
tracker area derives its `--bm-trk-*` tokens from that palette.

## `<add-to-battle>` — add a combatant

An "add this creature to the battle" button for content pages (bestiary
entries, character sheets, index cards). Every click adds one more combatant
to the shared encounter — a token in the same document the mat and tracker use
— so the creature shows up in the initiative tracker right away and in the
mat's **Reserve** pool. It is *not* dropped on the map automatically: the DM
places it from Reserve when it enters play (see the [pool](#tools)). The second
and later instances of a type get a random adjective ("Reckless Wolf") so they
can be told apart.

```html
<add-to-battle name="Wolf" kind="monster" image="/wolf.jpg"
  hp="11" ac="13" init-mod="2" size="medium">Add to battle</add-to-battle>
```

```js
import '@ramilkos/roll-dice/add-to-battle';
```

| Attribute     | Values                                                  | Default             |
| ------------- | ------------------------------------------------------- | ------------------- |
| `name`        | creature/type name (required)                           | —                   |
| `kind`        | `player` \| `monster` — token ring color                | `player`            |
| `image`       | avatar URL for the token                                | built-in icon       |
| `size`        | D&D size word (`tiny`…`gargantuan`) — token footprint   | `medium` (1 cell)   |
| `hp`, `ac`    | combat stats shown in the tracker                       | —                   |
| `init-mod`    | initiative modifier for the tracker's roll chip         | —                   |
| `storage-key` | encounter key, must match the paired `<battle-mat>`     | `battle-mat-canvas` |
| `label-added` | transient click feedback text                           | `Added`             |
| `compact`     | icon-only mode for tight rows                           | off                 |

The button shows a live `×N` badge with the number of instances of this
creature already in the encounter (synced across tabs). The element itself is
eager and tiny; the encounter store chunk loads on the first click.

The adjective set is a static property — override it once per page to
localize. The list is shared with the battle mat, so tokens dropped straight
onto the map from a pool tab get adjectived from the same set:

```js
import { AddToBattle } from '@ramilkos/roll-dice/add-to-battle';
AddToBattle.adjectives = ['Отчаянный', 'Трусливый', 'Шутливый'];
```

Theming: `--bm-atb-bg`, `--bm-atb-fg`, `--bm-atb-muted`, `--bm-atb-accent`,
`--bm-atb-edge`, `--bm-atb-radius` on the element.

## `<initiative-tracker>` — turn order

A standalone corner widget with the same initiative panel the battle screen
embeds as its tracker area — use it when you want turn order on the page
without opening the screen. It shares the encounter document: every token on
the mat is a combatant here, and edits sync live in both directions (same tab
and across tabs).

```html
<battle-mat></battle-mat>
<initiative-tracker></initiative-tracker>
```

```js
import '@ramilkos/roll-dice/initiative-tracker';
```

| Attribute     | Values                                                 | Default             |
| ------------- | ------------------------------------------------------ | ------------------- |
| `storage-key` | must match the paired `<battle-mat>`                   | `battle-mat-canvas` |
| `label-*`     | localized UI strings: `label-title`, `label-round`, `label-next`, `label-fill`, `label-reset`, `label-resetconfirm`, `label-empty`, `label-name`, `label-hp`, `label-ac`, `label-init`, `label-remove` | English |

The widget is a normal in-flow element; its panel opens below the toggle
button by default — see [Positioning](#positioning-the-widgets).

The panel lists combatants sorted by initiative (descending; unrolled ones
last, ties by name), including ones still in Reserve (not yet on the map). Each
row has an editable name field, editable HP (with a `/max` hint when the token
was placed with hit points), AC, and initiative, plus a button to remove the
combatant from the battle. When the page has the `<roll-dice>` component loaded,
each row also gets a compact `1d20±mod` chip (the modifier comes from the
token's `initMod`) that fills the initiative in. **Fill initiative** rolls a
d20 (plus each combatant's `initMod`) for everyone who has no initiative yet,
leaving already-rolled values alone. **Next** advances the turn and increments
the round on wrap; **Reset** ends the fight — it removes every combatant
(placed and reserve) from the encounter and the map after a confirm, and returns
to round 1. Player and monster rows are color-coded like their token rings.

Initiative lives on each token node (`x-battleMat.initiative`) and the round /
active combatant in the document's `combat` extension (see the format above),
so exporting the map exports the turn state too, and deleting a token on the
mat removes it from the order automatically.

Like the battle mat, the widget itself is a small eager element; the panel
code loads via dynamic `import()` on first expand and shares its chunks
(document model, store) with the battle-mat overlay, so the two components
always operate on the same in-memory document.

Theming: `--bm-trk-bg`, `--bm-trk-fg`, `--bm-trk-muted`, `--bm-trk-accent`,
`--bm-trk-edge`, `--bm-trk-btn-bg` on the element.

## Positioning the widgets

`<battle-toolbar>` pins itself flush into the bottom-right corner — move it
with `--bt-right` / `--bt-bottom` / `--bt-z` on the element.

`<roll-any-dice>`, `<roll-log>`, `<battle-mat>` and `<initiative-tracker>` are
plain in-flow elements (`display: inline-block` / `inline-flex`): put them in
a sidebar, a card, a toolbar — anywhere. None of them positions itself.

To get a single floating corner button, pin the host from the page:

```css
roll-any-dice {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 1000; /* whatever fits the page's stacking */
}
```

The two panel widgets open their panel *below* the toggle button by default.
When pinned to a bottom corner (or otherwise needing to grow the other way),
flip the direction and alignment with custom properties on the host —
`--rd-log-direction` / `--rd-log-align` for `<roll-log>`,
`--bm-trk-direction` / `--bm-trk-align` for `<initiative-tracker>`:

```css
roll-log {
  position: fixed;
  left: 1.25rem;
  bottom: 1.25rem;
  z-index: 1000;
  --rd-log-direction: column-reverse; /* panel opens upward */
}
initiative-tracker[data-pinned] {
  position: fixed;
  right: 1.25rem;
  top: 1.25rem;
  z-index: 1000;
  --bm-trk-align: flex-end; /* right-align the panel under the button */
}
```

The full-screen overlays (dice roller, battle screen) are unaffected — they
always mount into the top layer regardless of where their button sits.

## Develop

```
npm install
npm run dev      # Vite dev server for the demo (index.html)
npm test         # Vitest: dice logic, geometry, and battle-mat modules
npm run build    # library build → dist/ (both entries, one pass)
```

## Formula syntax

Standard RPG notation:

| Syntax        | Meaning                                   | Example     |
| ------------- | ----------------------------------------- | ----------- |
| `NdM`         | roll N dice of M sides                    | `2d6`       |
| `dM`          | implicit count of 1                       | `d20`       |
| `+K` / `-K`   | flat modifier                             | `2d6+3`     |
| multiple terms| sum several groups                        | `1d8+1d6+2` |
| `khX`         | keep highest X                            | `4d6kh3`    |
| `klX`         | keep lowest X                             | `2d20kl1`   |
| `dhX`         | drop highest X                            | `4d6dh1`    |
| `dlX`         | drop lowest X                             | `4d6dl1`    |

Advantage / disadvantage are just `2d20kh1` / `2d20kl1`.

Limits: 1–100 dice per term and 2–1000 sides per die. The freeform builder
enforces the same caps.

Dropped dice appear struck-through in the breakdown (e.g. `[~~2~~, 4, 5, 6] = 15`).

## Behavior

- Click, or focus and press **Enter** / **Space**, to roll.
- The overlay animates the dice, then reveals the total and breakdown.
- **Reroll** re-runs the same formula; **Done**, **Esc**, or a click outside
  closes it. Focus returns to the die that was clicked.
- Invalid formulas render as a dimmed, non-interactive chip with the reason in
  its tooltip / `aria-label` instead of opening a broken overlay.

## Critical hits

A kept **d20** landing on a natural **20** is a critical success; a natural **1**
is a fumble. The die that produced it gets a pulsing colored glow, the total is
tinted to match, and a short `Critical!` / `Fumble!` banner appears. Only kept
dice count (a dropped d20 from `2d20kl1` never crits) and only d20s; in a mixed
pool that rolls both a 20 and a 1, success wins. `prefers-reduced-motion` keeps
the color cues but drops the pulse.

The two tints are overridable from the host page via CSS custom properties —
set them on `:root` (they inherit into the overlay):

```css
:root {
  --rd-crit-success: #ffd54a; /* default gold */
  --rd-crit-failure: #ff5a5a; /* default red  */
}
```

## Dice

Every die is a **true 3D polyhedron**, constructed mathematically and rendered
as SVG:

- **d4** tetrahedron, **d6** cube, **d8** octahedron, **d10** pentagonal
  trapezohedron, **d12** dodecahedron, **d20** icosahedron.
- The solid's vertices are projected to 2D, back faces are culled, and each
  visible face is shaded by its normal against a fixed light for a sculpted 3D
  look — tinted per die type.
- The die settles at a natural 3/4 resting angle with the rolled value on the
  forward face (brightest and largest). Odd `dN` sizes fall back to a flat tile.

Geometry lives in `src/geometry.js` (pure math, unit-tested for face count,
regularity, and correct settling); the SVG renderer is `src/svg.js`.

`prefers-reduced-motion` skips the spin and jumps straight to the result.

## `roll` event

Each completed roll dispatches a bubbling, composed `roll` `CustomEvent`. The
`detail` is the full result object, so host pages can log to a chat, etc.

```js
document.addEventListener('roll', (e) => {
  const { formula, total, terms } = e.detail;
  console.log(`${formula} = ${total}`);
});
```

Result shape:

```js
{
  total: 12,
  formula: "2d6 + 3",
  terms: [
    { type: "dice", sign: 1, count: 2, sides: 6, keep: null,
      rolls: [ { value: 4, sides: 6, kept: true }, { value: 5, sides: 6, kept: true } ],
      subtotal: 9 },
    { type: "mod", sign: 1, value: 3 }
  ]
}
```

## Programmatic API

The component module re-exports the pure roll logic for scripting or testing:

```js
import { parseFormula, roll, poolToParsed } from '@ramilkos/roll-dice';
roll(parseFormula('4d6kh3'));   // -> result object
roll(poolToParsed([20, 6, 6], 2)); // build a roll from a pool of die sizes
```

## Files

- `src/dice.js` — pure formula parser + roller and the builder-pool helper (no DOM).
- `src/geometry.js` — mathematical polyhedron construction and settling.
- `src/svg.js` — projects the solids to shaded SVG dice.
- `src/roll-dice.js` — the `<roll-dice>` / `<roll-any-dice>` / `<roll-log>` elements + overlay (library entry).
- `src/battle-mat.js` — the `<battle-mat>` trigger element (second library entry, eager half).
- `src/battle-toolbar.js` — the `<battle-toolbar>` corner dock (library entry, eager).
- `src/initiative-tracker.js` — the `<initiative-tracker>` widget (library entry, eager half).
- `src/add-to-battle.js` — the `<add-to-battle>` pool button (library entry, eager half).
- `src/battle-mat/` — the lazily-loaded battle screen + tracker implementation:
  `overlay.js` (the screen: grid layout, toolbar, map shell), `view.js` (SVG
  scene), `tools.js` (pointer state
  machine), `tracker.js` (initiative panel), and the pure modules
  `canvas-doc.js`, `grid.js`, `viewport.js`, `combat.js` (turn order plus
  `addCombatant`), `registry.js`, `store.js` (the shared per-key encounter store).
- `index.html` — live demo with several formulas and a roll-event log.
- `test/` — Vitest suites: dice logic, geometry, regularity, and the pure battle-mat modules.

## Browser support

Modern evergreen browsers (custom elements v1, Shadow DOM, SVG, `color-mix`).
Uses `crypto.getRandomValues` for fair rolls, falling back to `Math.random`.

## License

Free for non-commercial use — see [LICENSE](LICENSE). Commercial use of the
code requires permission from the author (Ramil Karimov, ramil1017@gmail.com);
commercial use of the bundled Chikin Icons requires a license from
[Sergey Chikin](https://sergeychikin.ru/365/).
