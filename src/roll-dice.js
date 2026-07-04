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

import { parseFormula, roll, rollDie } from './dice.js';
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

// ---------------------------------------------------------------------------
// Styles (shared by the trigger shadow root and the overlay shadow root)
// ---------------------------------------------------------------------------

const TRIGGER_CSS = `
  :host {
    display: inline-block;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.15em 0.5em;
    border: 1px solid currentColor;
    border-radius: 0.4em;
    font: inherit;
    font-weight: 600;
    color: inherit;
    background: color-mix(in srgb, currentColor 8%, transparent);
    cursor: pointer;
    user-select: none;
    line-height: 1.3;
    transition: background 0.15s ease, transform 0.05s ease;
  }
  .chip:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
  .chip:active { transform: translateY(1px); }
  .chip:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .chip svg { width: 1em; height: 1em; flex: none; }
  .chip.error {
    cursor: help;
    border-style: dashed;
    opacity: 0.8;
  }
`;

// A tiny d20 glyph used in the trigger chip.
const DIE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
    <path d="M12 2 3 7v10l9 5 9-5V7z"/>
    <path d="M12 2v6m0 0 8 4m-8-4-8 4m8 4 8-4m-8 4v10m0-10-8-4m8 14-8-4m16 0-8 4"/>
  </svg>`;

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

  // Open the overlay for a parsed formula. `opener` is the element to return
  // focus to on close. `onRoll` is called with each roll result.
  open(parsed, opener, onRoll) {
    this.parsed = parsed;
    this.opener = opener || null;
    this.onRoll = onRoll || null;
    this._buildShell();
    document.body.appendChild(this.host);
    document.addEventListener('keydown', this._onKeydown, true);
    this.rollAndShow();
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
    // Drop any previous shell (e.g. reopened after close), keep the <style>.
    for (const child of Array.from(this.root.children)) {
      if (child.tagName !== 'STYLE') child.remove();
    }

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

    const label = el('div', 'formula-label');
    const grid = el('div', 'dice-grid');

    const resultBox = el('div', 'result');
    resultBox.setAttribute('aria-live', 'polite');

    const actions = el('div', 'actions');
    const rerollBtn = el('button', 'primary', 'Reroll');
    rerollBtn.addEventListener('click', () => this.rollAndShow());
    const doneBtn = el('button', null, 'Done');
    doneBtn.addEventListener('click', () => this.close());
    actions.append(rerollBtn, doneBtn);

    panel.append(closeBtn, label, grid, resultBox, actions);
    this.root.append(backdrop, panel);

    // Keep references so rerolls can refresh just the contents.
    this._els = { panel, label, grid, resultBox, rerollBtn };
  }

  // Roll and refresh only the dynamic contents; the backdrop and panel persist.
  rollAndShow() {
    clearTimeout(this._revealTimer);
    const { panel, label, grid, resultBox, rerollBtn } = this._els;

    const result = roll(this.parsed);
    if (this.onRoll) this.onRoll(result);

    panel.setAttribute('aria-label', `Dice roll for ${result.formula}`);
    label.textContent = result.formula;

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

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined' && !customElements.get('roll-dice')) {
  customElements.define('roll-dice', RollDice);
}
