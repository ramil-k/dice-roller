// <battle-mat> — standalone launcher button for the battle screen (opened on
// its map area). A normal in-flow element: to float it in a page corner,
// style the host from the page (position: fixed + inset + z-index). Pages
// that want the full dock (initiative + map + dice buttons, localized labels)
// should use <battle-toolbar> instead.
//
// This module is the *eager* half of the component and deliberately imports
// nothing from the rest of the package: everything map-related (overlay,
// grid, tools, icon registry) lives behind a dynamic import() in _activate(),
// so pages pay nothing for the battle mat until someone actually opens it.
//
// Attributes:
//   storage-key  localStorage key for this mat's autosaved canvas
//                (default "battle-mat-canvas"; use distinct keys for
//                distinct maps)
//   roster       JSON array of extra pool tokens provided by the page, e.g.
//                [{ "name": "Aria", "image": "https://...", "kind": "player",
//                   "size": "large", "hp": 20, "ac": 15, "initMod": 2 }]
//
// Properties:
//   roster       same as the attribute, as a live array (property wins)
//
// Content pages add combatants straight to the shared encounter with
// <add-to-battle> (they appear here as tokens and in the initiative
// tracker); the `roster` pool is just for ad-hoc extra tokens.
//
// The overlay stores its state as a JSON Canvas 1.0 document
// (https://jsoncanvas.org) — see README for the format details.

const FAB_CSS = `
  :host {
    --bm-fab-bg: #3f8f6b;
    --bm-fab-fg: #ffffff;
    display: inline-block;
  }

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
        show: 'map',
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
