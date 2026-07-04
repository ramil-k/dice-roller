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
| `dice`     | space/comma-separated die sizes to offer, e.g. `dice="6 20"` | `4 6 8 10 12 20` |

```html
<roll-any-dice position="bottom-left" dice="6 20"></roll-any-dice>
```

It rolls through the same pipeline as `<roll-dice>` and dispatches the same
`roll` event, so host pages can react to freeform rolls too.

## Develop

```
npm install
npm run dev      # Vite dev server for the demo (index.html)
npm test         # Vitest: dice logic + polyhedron geometry
npm run build    # library build → dist/
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

Dropped dice appear struck-through in the breakdown (e.g. `[~~2~~, 4, 5, 6] = 15`).

## Behavior

- Click, or focus and press **Enter** / **Space**, to roll.
- The overlay animates the dice, then reveals the total and breakdown.
- **Reroll** re-runs the same formula; **Done**, **Esc**, or a click outside
  closes it. Focus returns to the die that was clicked.
- Invalid formulas render as a dashed, non-interactive chip with the reason in
  its tooltip / `aria-label` instead of opening a broken overlay.

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
- `src/roll-dice.js` — the `<roll-dice>` / `<roll-any-dice>` elements + overlay (library entry).
- `index.html` — live demo with several formulas and a roll-event log.
- `test/` — Vitest suites: dice logic, geometry, and regularity.

## Browser support

Modern evergreen browsers (custom elements v1, Shadow DOM, SVG, `color-mix`).
Uses `crypto.getRandomValues` for fair rolls, falling back to `Math.random`.
