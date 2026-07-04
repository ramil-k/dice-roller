// <roll-dice> — a zero-dependency web component for RPG sites.
//
// Usage (bundled build):
//   <script type="module" src="roll-dice.js"></script>
//   <roll-dice>2d6+3</roll-dice>
//   <roll-dice formula="4d6kh3">roll stats</roll-dice>
//
// Clicking the element opens a full-screen overlay with animated dice that spin
// and settle on a result, then shows the total and a per-die breakdown.
//
// The component dispatches a bubbling `roll` CustomEvent (detail = the roll
// result object) each time a roll completes, so host pages can react.
//
// The pure roll logic is re-exported (parseFormula, roll, rollDie) for
// programmatic use and testing.

import { parseFormula, roll, rollDie, poolToParsed } from './dice.js';
import { buildDieSVG } from './svg.js';

export { parseFormula, roll, rollDie };

// Per-die-type base tint (hex), used to shade the SVG faces.
const DIE_TINT = {
  4: '#e05a5a',
  6: '#e0a94a',
  8: '#4aa3e0',
  10: '#6bcf6b',
  12: '#b06be0',
  20: '#4a6ed0',
};
const DEFAULT_TINT = '#7a86a0';

// The standard polyhedral set offered by the <roll-any-dice> builder tray.
const BUILDER_SIDES = [4, 6, 8, 10, 12, 20];

// ---------------------------------------------------------------------------
// Styles (shared by the trigger shadow root and the overlay shadow root)
// ---------------------------------------------------------------------------

// The trigger is inline *text* — it shares the baseline and line-height of the
// surrounding copy, so `deal <roll-dice>2d6+3</roll-dice> damage` reads as one
// sentence. The rounded background highlight is painted on the inline box
// itself (with box-decoration-break so it survives line wraps); only horizontal
// padding is added, which an inline box honors without shifting the baseline or
// the line height. Vertical bleed comes from negative margins on the ::before,
// not padding, so neighboring lines never get pushed apart.
const TRIGGER_CSS = `
  :host {
    display: inline;
  }
  .chip {
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: 0.4em;
    padding-inline: 0.4em;
    background: color-mix(in srgb, currentColor 10%, transparent);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
    transition: background 0.15s ease;
  }
  .chip:hover { background: color-mix(in srgb, currentColor 18%, transparent); }
  .chip:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .chip.error {
    cursor: help;
    background: color-mix(in srgb, currentColor 6%, transparent);
    opacity: 0.8;
  }

  /* A small die glyph before the formula. Inline and baseline-aligned so it sits
     within the text run without perturbing line height. */
  .chip .icon {
    width: 1em;
    height: 1em;
    margin-inline-end: 0.3em;
    vertical-align: -0.15em;
  }
`;

// A tiny d20 glyph shown before the formula in the inline trigger: a face-on
// icosahedron. Viewed down a face normal a d20 reads as a regular hexagon whose
// visible faces form a central up-triangle, an inverted triangle around it, and
// the outer ring — the classic d20 silhouette.
const DIE_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="M12 2.2 21.5 7.6v8.8L12 21.8 2.5 16.4V7.6z"/>
    <path d="M6.7 9 12 15.5 17.3 9z"/>
    <path d="M12 2.2 6.7 9 2.5 7.6M12 2.2 17.3 9l4.2-1.4M6.7 9 2.5 16.4 12 21.8l9.5-5.4L17.3 9M12 15.5V21.8"/>
  </svg>`;

// Styles for the <roll-any-dice> floating launcher button, pinned to a page
// corner via the `position` attribute.
const LAUNCHER_CSS = `
  :host {
    --rd-fab-bg: #4a6ed0;
    --rd-fab-fg: #ffffff;
    position: fixed;
    z-index: 2147483646;
  }
  :host([position="bottom-left"])  { bottom: 1.25rem; left: 1.25rem; right: auto; top: auto; }
  :host([position="top-right"])    { top: 1.25rem; right: 1.25rem; bottom: auto; left: auto; }
  :host([position="top-left"])     { top: 1.25rem; left: 1.25rem; bottom: auto; right: auto; }
  /* Default and explicit bottom-right. */
  :host,
  :host([position="bottom-right"]) { bottom: 1.25rem; right: 1.25rem; top: auto; left: auto; }

  .fab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--rd-fab-bg);
    color: var(--rd-fab-fg);
    cursor: pointer;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.3);
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
  }
  .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(0 0 0 / 0.35); }
  .fab:active { transform: translateY(0); }
  .fab:focus-visible { outline: 3px solid var(--rd-fab-bg); outline-offset: 3px; }
  .fab .icon { width: 1.9rem; height: 1.9rem; }
`;

const OVERLAY_CSS = `
  :host {
    --rd-bg: rgb(15 17 24 / 0.92);
    --rd-fg: #f3f4f6;
    --rd-accent: #f4c430;
    --rd-muted: #9aa2b1;
    --rd-die-face: #2a2f3d;
    --rd-die-edge: #4a5263;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    color: var(--rd-fg);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--rd-bg);
    backdrop-filter: blur(4px);
    animation: fade 0.2s ease;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    max-width: min(92vw, 640px);
    max-height: 92vh;
    padding: 2rem 1.5rem;
    overflow: auto;
    text-align: center;
  }
  .formula-label {
    font-size: 1rem;
    letter-spacing: 0.02em;
    color: var(--rd-muted);
  }

  /* ---- Builder (dice tray) for <roll-any-dice> ---- */
  .builder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    width: 100%;
  }
  .pool {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.1rem;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .pool .empty { color: var(--rd-muted); font-weight: 400; font-size: 0.95rem; }
  .pool .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.2em 0.3em 0.2em 0.55em;
    border-radius: 0.5em;
    background: color-mix(in srgb, var(--rd-fg) 12%, transparent);
  }
  .pool .chip .x {
    display: inline-grid;
    place-items: center;
    width: 1.2em;
    height: 1.2em;
    border: none;
    border-radius: 50%;
    padding: 0;
    font: inherit;
    line-height: 1;
    color: var(--rd-muted);
    background: transparent;
    cursor: pointer;
  }
  .pool .chip .x:hover { background: color-mix(in srgb, var(--rd-fg) 20%, transparent); color: var(--rd-fg); }
  .pool .chip.mod { background: color-mix(in srgb, var(--rd-accent) 22%, transparent); }

  .tray {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }
  .tray .add {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.5em 0.7em;
    border-radius: 0.55em;
    border: 1px solid var(--rd-die-edge);
    background: var(--rd-die-face);
    color: var(--rd-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease, transform 0.05s ease;
  }
  .tray .add:hover { background: color-mix(in srgb, var(--rd-fg) 12%, var(--rd-die-face)); }
  .tray .add:active { transform: translateY(1px); }
  .tray .add .swatch {
    width: 0.85em;
    height: 0.85em;
    border-radius: 3px;
  }
  .tray .modctl {
    display: inline-flex;
    align-items: center;
    gap: 0.15em;
    padding: 0.15em 0.3em;
    border-radius: 0.55em;
    border: 1px solid var(--rd-die-edge);
    background: var(--rd-die-face);
  }
  .tray .modctl button {
    width: 1.9em;
    height: 1.9em;
    padding: 0;
    border: none;
    border-radius: 0.4em;
    background: transparent;
    color: var(--rd-fg);
    font: inherit;
    font-weight: 700;
    font-size: 1.05em;
    cursor: pointer;
  }
  .tray .modctl button:hover { background: color-mix(in srgb, var(--rd-fg) 14%, transparent); }
  .tray .modctl .modval { min-width: 2.4ch; text-align: center; font-weight: 700; }

  .dice-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 1.6rem 1.8rem;
    min-height: 110px;
  }

  /* ---- Die: an SVG 3D polyhedron (see svg.js) ----
     Each die is an <svg> whose faces are the projected, back-face-culled,
     shaded polygons of the real solid, with the rolled value on the forward
     face. The roll animation just spins/scales the whole SVG in. */
  .die {
    --size: 100px;
    width: var(--size);
    height: var(--size);
    filter: drop-shadow(0 6px 10px rgb(0 0 0 / 0.35));
  }
  .die svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .die.rolling {
    animation: tumble 1.05s cubic-bezier(0.25, 0.6, 0.35, 1) forwards;
    transform-origin: 50% 55%;
  }
  .die.dropped { opacity: 0.4; }
  /* Fallback tile for die types without a constructed solid. */
  .die.flat {
    display: grid;
    place-items: center;
    border-radius: 14%;
    background: color-mix(in srgb, var(--rd-die-edge) 40%, var(--rd-die-face));
    box-shadow: inset 0 0 0 1px var(--rd-die-edge);
    font-weight: 800;
    font-size: calc(var(--size) * 0.34);
  }
  .die.flat .lbl { display: block; font-size: calc(var(--size) * 0.14); color: var(--rd-muted); font-weight: 600; }

  /* ---- Result readout ---- */
  .result {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.35s ease, transform 0.35s ease;
  }
  .result.show { opacity: 1; transform: none; }
  .total {
    font-size: clamp(2.8rem, 12vw, 4.2rem);
    font-weight: 800;
    line-height: 1;
    color: var(--rd-accent);
  }
  .breakdown {
    font-size: 0.95rem;
    color: var(--rd-muted);
    max-width: 46ch;
    word-break: break-word;
  }
  .breakdown .drop {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 0.55em 1.1em;
    border-radius: 0.5em;
    border: 1px solid var(--rd-die-edge);
    background: var(--rd-die-face);
    color: var(--rd-fg);
    cursor: pointer;
    transition: background 0.15s ease, transform 0.05s ease;
  }
  button:hover { background: color-mix(in srgb, var(--rd-fg) 12%, var(--rd-die-face)); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
  button.primary { background: var(--rd-accent); color: #1a1200; border-color: transparent; }
  button.primary:hover { background: color-mix(in srgb, #fff 12%, var(--rd-accent)); }
  .close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .error-box {
    color: #ff9b9b;
    font-size: 1.1rem;
    max-width: 40ch;
  }

  @keyframes fade { from { opacity: 0; } }
  /* The die's 3D orientation is baked into the SVG; the roll just spins and
     scales the whole die in as it "lands". */
  @keyframes tumble {
    0%   { transform: rotate(-260deg) scale(0.55); opacity: 0; }
    55%  { transform: rotate(30deg) scale(1.08); opacity: 1; }
    100% { transform: rotate(0deg) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .backdrop { animation: none; }
    .die.rolling { animation: none; }
    .result { transition: none; }
  }
`;

// ---------------------------------------------------------------------------
// Die rendering
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Build one die DOM node: an SVG 3D polyhedron (see svg.js) with the rolled
// value on the forward face. For die types without a constructed solid (unusual
// `dN`), fall back to a flat labeled tile.
function buildDie(rollObj) {
  const { value, sides, kept } = rollObj;
  const die = el('div', `die d${sides}`);
  die.dataset.value = String(value);
  die.classList.toggle('dropped', !kept);

  const tint = DIE_TINT[sides] ?? DEFAULT_TINT;
  // A per-value in-plane spin so a pool of same-type dice doesn't look uniform.
  const spin = (value * 47) % 360;
  const svg = buildDieSVG(sides, value, tint, spin);

  if (svg) {
    die.appendChild(svg);
  } else {
    die.classList.add('flat');
    die.appendChild(el('span', 'num', String(value)));
    die.appendChild(el('span', 'lbl', `d${sides}`));
  }
  return die;
}

// ---------------------------------------------------------------------------
// Overlay controller
// ---------------------------------------------------------------------------

class DiceOverlay {
  constructor() {
    this.host = document.createElement('div');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.root.appendChild(style);
    this._onKeydown = this._onKeydown.bind(this);
    this.opener = null;
  }

  _onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      this._trapFocus(e);
    }
  }

  _trapFocus(e) {
    const focusable = this.root.querySelectorAll('button');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.root.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Open the overlay for a fixed parsed formula (<roll-dice>). `opener` is the
  // element to return focus to on close. `onRoll` is called with each result.
  open(parsed, opener, onRoll) {
    this.parsed = parsed;
    this.opener = opener || null;
    this.onRoll = onRoll || null;
    this.builder = false;
    this._buildShell();
    document.body.appendChild(this.host);
    document.addEventListener('keydown', this._onKeydown, true);
    this.rollAndShow();
  }

  // Open the overlay in builder mode (<roll-any-dice>): a dice tray lets the
  // user assemble any pool, then Roll runs it through the same pipeline as a
  // fixed formula. `sides` limits which die types the tray offers.
  openBuilder(opener, onRoll, { sides } = {}) {
    this.opener = opener || null;
    this.onRoll = onRoll || null;
    this.builder = true;
    this._traySides = sides && sides.length ? sides : BUILDER_SIDES;
    this._pool = []; // array of `sides` (one entry per die)
    this._mod = 0;
    this.parsed = null;
    this._buildShell();
    document.body.appendChild(this.host);
    document.addEventListener('keydown', this._onKeydown, true);
    this._renderPool();
  }

  close() {
    clearTimeout(this._revealTimer);
    document.removeEventListener('keydown', this._onKeydown, true);
    if (this.host.parentNode) this.host.parentNode.removeChild(this.host);
    if (this.opener && typeof this.opener.focus === 'function') {
      this.opener.focus();
    }
  }

  // Build the persistent overlay shell once per open: backdrop, panel, close
  // button, formula label, dice grid, result readout, and actions. Rerolling
  // only refreshes the contents (see rollAndShow) so the backdrop's fade-in
  // never re-triggers.
  _buildShell() {
    // Drop any previous shell (e.g. reopened after close), keep the <style>,
    // and start with a fresh element-ref map so stale refs from a prior mode
    // (fixed vs builder) can't linger.
    for (const child of Array.from(this.root.children)) {
      if (child.tagName !== 'STYLE') child.remove();
    }
    this._els = {};

    const backdrop = el('div', 'backdrop');
    backdrop.addEventListener('click', () => this.close());

    const panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const closeBtn = el('button', 'close');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.addEventListener('click', () => this.close());

    // In builder mode the interactive tray takes the place of the static
    // formula label; everything below (dice grid, result) is shared verbatim.
    const label = el('div', 'formula-label');
    let builder = null;
    if (this.builder) builder = this._buildTray();

    const grid = el('div', 'dice-grid');

    const resultBox = el('div', 'result');
    resultBox.setAttribute('aria-live', 'polite');

    const actions = el('div', 'actions');
    // Builder rolls the current pool; fixed formula rerolls the same formula.
    const rerollBtn = el('button', 'primary', this.builder ? 'Roll' : 'Reroll');
    rerollBtn.addEventListener('click', () => this.rollAndShow());
    const doneBtn = el('button', null, 'Done');
    doneBtn.addEventListener('click', () => this.close());
    actions.append(rerollBtn, doneBtn);

    panel.append(closeBtn, builder || label, grid, resultBox, actions);
    this.root.append(backdrop, panel);

    // Keep references so rerolls can refresh just the contents. Merge so the
    // builder tray's refs (pool, modval), set up in _buildTray above, survive.
    this._els = { ...this._els, panel, label, grid, resultBox, rerollBtn };
  }

  // Build the dice tray for builder mode: the current pool (removable chips),
  // a row of "add die" buttons, and a +/- modifier stepper.
  _buildTray() {
    const wrap = el('div', 'builder');

    const pool = el('div', 'pool');

    const tray = el('div', 'tray');
    for (const sides of this._traySides) {
      const btn = el('button', 'add');
      btn.type = 'button';
      const swatch = el('span', 'swatch');
      swatch.style.background = DIE_TINT[sides] ?? DEFAULT_TINT;
      btn.append(swatch, document.createTextNode(`d${sides}`));
      btn.setAttribute('aria-label', `Add a d${sides}`);
      btn.addEventListener('click', () => {
        this._pool.push(sides);
        this._renderPool();
      });
      tray.appendChild(btn);
    }

    // Modifier stepper.
    const modctl = el('div', 'modctl');
    const dec = el('button', null, '−'); // minus sign
    dec.type = 'button';
    dec.setAttribute('aria-label', 'Decrease modifier');
    const modval = el('span', 'modval', '+0');
    const inc = el('button', null, '+');
    inc.type = 'button';
    inc.setAttribute('aria-label', 'Increase modifier');
    dec.addEventListener('click', () => { this._mod--; this._renderPool(); });
    inc.addEventListener('click', () => { this._mod++; this._renderPool(); });
    modctl.append(dec, modval, inc);
    tray.appendChild(modctl);

    wrap.append(pool, tray);
    this._els = { ...this._els, pool, modval };
    return wrap;
  }

  // Re-render the pool chips and modifier readout, and keep `this.parsed` in
  // sync so Roll runs the current pool through the shared pipeline.
  _renderPool() {
    const { pool, modval, rerollBtn } = this._els;
    pool.textContent = '';

    if (!this._pool.length && this._mod === 0) {
      pool.appendChild(el('span', 'empty', 'Add dice below to build a roll'));
    }

    // One chip per die, grouped in insertion order.
    this._pool.forEach((sides, i) => {
      const chip = el('span', 'chip');
      const swatch = el('span', 'swatch');
      swatch.style.cssText =
        `width:0.8em;height:0.8em;border-radius:3px;background:${DIE_TINT[sides] ?? DEFAULT_TINT}`;
      chip.append(swatch, document.createTextNode(`d${sides}`));
      const x = el('button', 'x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove d${sides}`);
      x.addEventListener('click', () => {
        this._pool.splice(i, 1);
        this._renderPool();
      });
      chip.appendChild(x);
      pool.appendChild(chip);
    });

    if (this._mod !== 0) {
      const chip = el('span', 'chip mod', `${this._mod > 0 ? '+' : '−'}${Math.abs(this._mod)}`);
      pool.appendChild(chip);
    }

    if (modval) modval.textContent = `${this._mod >= 0 ? '+' : '−'}${Math.abs(this._mod)}`;

    this.parsed = poolToParsed(this._pool, this._mod);
    if (rerollBtn) rerollBtn.disabled = !this.parsed;
  }

  // Roll and refresh only the dynamic contents; the backdrop and panel persist.
  rollAndShow() {
    // In builder mode there may be nothing to roll yet.
    if (this.builder && !this.parsed) return;

    clearTimeout(this._revealTimer);
    const { panel, label, grid, resultBox, rerollBtn } = this._els;

    const result = roll(this.parsed);
    if (this.onRoll) this.onRoll(result);

    panel.setAttribute('aria-label', `Dice roll for ${result.formula}`);
    // Fixed-formula mode shows the formula as a static label; builder mode keeps
    // the live tray in that slot, so only update the label when it exists there.
    if (!this.builder) label.textContent = result.formula;

    // Rebuild the dice grid.
    grid.textContent = '';
    let dieIndex = 0;
    const reduceMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const term of result.terms) {
      if (term.type !== 'dice') continue;
      for (const r of term.rolls) {
        const die = buildDie(r);
        if (!reduceMotion) {
          die.classList.add('rolling');
          die.style.animationDelay = `${Math.min(dieIndex, 12) * 0.05}s`;
        }
        grid.appendChild(die);
        dieIndex++;
      }
    }

    // Reset then rebuild the result readout (hidden until the dice settle).
    resultBox.classList.remove('show');
    resultBox.textContent = '';
    resultBox.append(el('div', 'total', String(result.total)));
    const breakdown = el('div', 'breakdown');
    breakdown.appendChild(renderBreakdown(result));
    resultBox.appendChild(breakdown);

    // Reveal the result after the animation (or immediately if reduced).
    const revealDelay = reduceMotion ? 0 : 1100 + Math.min(dieIndex, 12) * 50;
    const reveal = () => {
      resultBox.classList.add('show');
      rerollBtn.focus();
    };
    if (revealDelay === 0) reveal();
    else this._revealTimer = setTimeout(reveal, revealDelay);
  }
}

// Build the per-die breakdown line, e.g. `[4, 5] + 3 = 12`, with dropped dice
// struck through.
function renderBreakdown(result) {
  const frag = document.createDocumentFragment();
  result.terms.forEach((term, i) => {
    const sep = el('span', null, i === 0 ? (term.sign < 0 ? '- ' : '') : term.sign < 0 ? ' - ' : ' + ');
    if (i > 0 || term.sign < 0) frag.appendChild(sep);

    if (term.type === 'mod') {
      frag.appendChild(el('span', null, String(term.value)));
    } else {
      frag.appendChild(el('span', null, '['));
      term.rolls.forEach((r, j) => {
        if (j > 0) frag.appendChild(el('span', null, ', '));
        frag.appendChild(el('span', r.kept ? null : 'drop', String(r.value)));
      });
      frag.appendChild(el('span', null, ']'));
    }
  });
  frag.appendChild(el('span', null, ` = `));
  frag.appendChild(el('strong', null, String(result.total)));
  return frag;
}

// ---------------------------------------------------------------------------
// Custom element
// ---------------------------------------------------------------------------

// Single shared overlay instance — only one roll is ever visible at a time.
let sharedOverlay = null;
function getOverlay() {
  if (!sharedOverlay) sharedOverlay = new DiceOverlay();
  return sharedOverlay;
}

export class RollDice extends HTMLElement {
  static get observedAttributes() {
    return ['formula'];
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this._root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = TRIGGER_CSS;
      this._root.appendChild(style);
      this._chip = document.createElement('span');
      this._chip.className = 'chip';
      this._root.appendChild(this._chip);

      this.addEventListener('click', () => this._activate());
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._activate();
        }
      });
    }
    // Defer so slotted text content is available on initial upgrade.
    queueMicrotask(() => this._render());
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this._render();
  }

  get formula() {
    // Attribute wins over text content when present.
    const attr = this.getAttribute('formula');
    if (attr != null && attr.trim()) return attr.trim();
    return (this.textContent || '').trim();
  }

  _render() {
    const raw = this.formula;
    let label = raw;
    this._parsed = null;
    this._error = null;

    try {
      this._parsed = parseFormula(raw);
      label = this._parsed.toString();
    } catch (err) {
      this._error = err.message;
    }

    this._chip.innerHTML = DIE_ICON;
    this._chip.appendChild(document.createTextNode(label || 'invalid'));

    if (this._error) {
      this._chip.classList.add('error');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', `Invalid dice formula: ${raw || '(empty)'} — ${this._error}`);
      this.setAttribute('title', this._error);
      this.removeAttribute('tabindex');
    } else {
      this._chip.classList.remove('error');
      this.setAttribute('role', 'button');
      this.setAttribute('tabindex', '0');
      this.setAttribute('aria-label', `Roll ${label}`);
      this.removeAttribute('title');
    }
  }

  _activate() {
    if (this._error || !this._parsed) return;
    getOverlay().open(this._parsed, this, (result) => {
      this.dispatchEvent(
        new CustomEvent('roll', {
          detail: result,
          bubbles: true,
          composed: true,
        })
      );
    });
  }
}

// ---------------------------------------------------------------------------
// <roll-any-dice> — a fixed corner launcher that opens the builder overlay,
// letting the user assemble and roll any pool of dice. Reuses the same overlay,
// dice rendering, and roll pipeline as <roll-dice>.
//
// Attributes:
//   position   bottom-right (default) | bottom-left | top-right | top-left
//   dice       space/comma-separated die sizes to offer, e.g. "6 20"
//              (defaults to the standard 4 6 8 10 12 20 set)
// ---------------------------------------------------------------------------

export class RollAnyDice extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      this._root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = LAUNCHER_CSS;
      this._root.appendChild(style);

      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'fab';
      fab.setAttribute('aria-label', 'Open dice roller');
      fab.innerHTML = DIE_ICON;
      fab.addEventListener('click', () => this._activate());
      this._root.appendChild(fab);
    }
    if (!this.hasAttribute('position')) this.setAttribute('position', 'bottom-right');
  }

  // Parse the optional `dice` attribute into a list of allowed die sizes.
  get _sides() {
    const attr = this.getAttribute('dice');
    if (!attr) return null;
    const sizes = attr
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 2);
    return sizes.length ? sizes : null;
  }

  _activate() {
    getOverlay().openBuilder(
      this,
      (result) => {
        this.dispatchEvent(
          new CustomEvent('roll', { detail: result, bubbles: true, composed: true })
        );
      },
      { sides: this._sides }
    );
  }
}

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined') {
  if (!customElements.get('roll-dice')) customElements.define('roll-dice', RollDice);
  if (!customElements.get('roll-any-dice')) customElements.define('roll-any-dice', RollAnyDice);
}
