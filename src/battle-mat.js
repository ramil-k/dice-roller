// <battle-mat> — corner launcher for the battle-map overlay.
//
// This module is the *eager* half of the component and deliberately imports
// nothing from the rest of the package: everything map-related (overlay,
// grid, tools, icon registry) lives behind a dynamic import() in _activate(),
// so pages pay nothing for the battle mat until someone actually opens it.
//
// Attributes:
//   position     bottom-right (default) | bottom-left | top-right | top-left
//   storage-key  localStorage key for this mat's autosaved canvas
//                (default "battle-mat-canvas"; use distinct keys for
//                distinct maps)
//   roster       JSON array of tokens for the pool, e.g.
//                [{ "name": "Aria", "image": "https://...", "kind": "player" }]
//
// Properties:
//   roster       same as the attribute, as a live array (property wins)
//
// The overlay stores its state as a JSON Canvas 1.0 document
// (https://jsoncanvas.org) — see README for the format details.

const FAB_CSS = `
  :host {
    --bm-fab-bg: #3f8f6b;
    --bm-fab-fg: #ffffff;
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
    background: var(--bm-fab-bg);
    color: var(--bm-fab-fg);
    cursor: pointer;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.3);
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
  }
  .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(0 0 0 / 0.35); }
  .fab:active { transform: translateY(0); }
  .fab:focus-visible { outline: 3px solid var(--bm-fab-bg); outline-offset: 3px; }
  .fab[disabled] { cursor: progress; opacity: 0.7; }
  .fab .icon { width: 1.9rem; height: 1.9rem; }
`;

// A small map-with-grid glyph (grid square, fold lines, a token dot).
const MAT_ICON = `
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
  </svg>
`;

export class BattleMat extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      this._root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = FAB_CSS;
      this._root.appendChild(style);

      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'fab';
      fab.setAttribute('aria-label', 'Open battle mat');
      fab.innerHTML = MAT_ICON;
      fab.addEventListener('click', () => this._activate());
      this._root.appendChild(fab);
      this._fab = fab;
    }
    if (!this.hasAttribute('position')) this.setAttribute('position', 'bottom-right');
  }

  // Pool roster: the property wins over the attribute; the attribute is JSON.
  // Invalid JSON degrades to an empty roster rather than throwing.
  get roster() {
    if (Array.isArray(this._roster)) return this._roster;
    const attr = this.getAttribute('roster');
    if (!attr) return [];
    try {
      const arr = JSON.parse(attr);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  set roster(value) {
    this._roster = Array.isArray(value) ? value : null;
  }

  // Load the map implementation on first open. The button is disabled while
  // the chunk loads (slow networks) and re-enabled on failure so a transient
  // network error is retryable with another click.
  async _activate() {
    if (this._loading) return;
    this._loading = true;
    this._fab.setAttribute('disabled', '');
    try {
      const mod = await import('./battle-mat/overlay.js');
      mod.openBattleMat({
        opener: this._fab,
        roster: this.roster,
        storageKey: this.getAttribute('storage-key') ?? 'battle-mat-canvas',
      });
    } catch (err) {
      console.error('battle-mat: failed to load the map module', err);
    } finally {
      this._fab.removeAttribute('disabled');
      this._loading = false;
    }
  }
}

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined' && !customElements.get('battle-mat')) {
  customElements.define('battle-mat', BattleMat);
}
