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
anywhere on the page. It renders a floating button pinned to a corner; clicking
it opens the same overlay in **builder** mode, where you add and remove any dice
from a tray, adjust a flat modifier, and roll the pool.

```html
<roll-any-dice></roll-any-dice>
```

Attributes:

| Attribute  | Values                                                       | Default        |
| ---------- | ------------------------------------------------------------ | -------------- |
| `position` | `bottom-right`, `bottom-left`, `top-right`, `top-left`       | `bottom-right` |
| `dice`     | space/comma-separated die sizes to offer, e.g. `dice="6 20"` (sizes outside 2–1000 are ignored) | `4 6 8 10 12 20` |

```html
<roll-any-dice position="bottom-left" dice="6 20"></roll-any-dice>
```

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
small round button pinned to a corner (bottom-left by default) that expands
into a scrollable panel — time, formula, and total per roll, crits tinted,
newest first — with a **Clear** button.

```html
<roll-log></roll-log>
```

| Attribute  | Values                                                 | Default       |
| ---------- | ------------------------------------------------------ | ------------- |
| `position` | `bottom-left`, `bottom-right`, `top-left`, `top-right` | `bottom-left` |

The log updates live on every roll and on every clear, including rolls made in
other tabs of the same site. It is stored under the `roll-dice-log` key in
`localStorage`. Programmatic access: `readRollLog()` / `clearRollLog()` are
exported from the module.

The panel is themable via the `--rd-log-*` custom properties set on the
element: `--rd-log-bg`, `--rd-log-fg`, `--rd-log-muted`, `--rd-log-accent`,
`--rd-log-edge`, `--rd-log-btn-bg`.

## `<battle-mat>` — grid battle map

A floating corner button that opens a full-screen battle map: a pannable,
zoomable square grid where you drag player and monster tokens from a pool at
the top, draw with pen and shapes, erase, measure distances with a ruler, and
attach map images with the grid aligned over them.

```html
<battle-mat></battle-mat>
<script>
  document.querySelector('battle-mat').roster = [
    { name: 'Aria', image: 'https://example.com/aria.png', kind: 'player' },
    { name: 'Dire Wolf', image: 'https://example.com/wolf.png', kind: 'monster' },
  ];
</script>
```

**The map code loads lazily.** The `battle-mat` entry is a small trigger
element; everything else (overlay, tools, icon registry) is fetched via a
dynamic `import()` the first time the button is clicked. Nothing map-related
is downloaded before that.

```js
import '@ramilkos/roll-dice/battle-mat';
```

The package ships as ES modules only (no UMD — UMD bundles cannot code-split,
and the map chunk must stay lazy). If you self-host `dist/battle-mat.js`,
also host the `battle-mat-overlay-*.js` chunk next to it; the dynamic import
resolves relative to the entry file. Bundlers handle the split automatically.

| Attribute     | Values                                                 | Default             |
| ------------- | ------------------------------------------------------ | ------------------- |
| `position`    | `bottom-left`, `bottom-right`, `top-left`, `top-right` | `bottom-right`      |
| `storage-key` | any string — `localStorage` key for this map           | `battle-mat-canvas` |
| `roster`      | JSON array (see below); the `roster` property wins     | `[]`                |

Roster entries are `{ name, image, kind }` where `kind` is `"player"` or
`"monster"`. They fill the **Party** and **Foes** tabs of the token pool;
after them come the built-in icon categories (Humanoids, Animals, Monsters).

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
closes an open settings panel, then the overlay itself, returning focus to
the button that opened it.

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
  "viewport": { "x": 0, "y": 0, "zoom": 1 } }
```

Nodes from imported files that battle-mat does not understand are kept
untouched (rendered as labeled boxes) and survive an export round-trip.

If autosave fails (private browsing, or a large map image exceeding the
`localStorage` quota) the map keeps working in memory and the status bar
suggests using **Export**.

### Built-in token icons

The Humanoids / Animals / Monsters pool tabs use
[Chikin Icons](https://sergeychikin.ru/365/) — an icon pack drawn by Sergey
Chikin (sergeychikin.ru). The icons are hot-linked from his site at runtime,
not bundled or redistributed with this package. They are free to use, but
**commercial use requires a license from the author** — see the terms at
[sergeychikin.ru/365](https://sergeychikin.ru/365/). If the site is
unreachable, those tabs show empty avatars; roster tokens are unaffected.
Maps you export reference the icons by URL and never inline them.

### Theming

Set the `--bm-*` custom properties on `battle-mat` (button: `--bm-fab-bg`,
`--bm-fab-fg`) or globally on `:root` for the overlay palette: `--bm-bg`,
`--bm-surface`, `--bm-fg`, `--bm-muted`, `--bm-accent`, `--bm-edge`,
`--bm-grid-line`, `--bm-token-player`, `--bm-token-monster`.

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
- `src/battle-mat/` — the lazily-loaded map implementation: `overlay.js` (shell),
  `view.js` (SVG scene), `tools.js` (pointer state machine), and the pure
  modules `canvas-doc.js`, `grid.js`, `viewport.js`, `registry.js`, `store.js`.
- `index.html` — live demo with several formulas and a roll-event log.
- `test/` — Vitest suites: dice logic, geometry, regularity, and the pure battle-mat modules.

## Browser support

Modern evergreen browsers (custom elements v1, Shadow DOM, SVG, `color-mix`).
Uses `crypto.getRandomValues` for fair rolls, falling back to `Math.random`.
