// <add-to-battle> — an "add this creature to the battle" button for content
// pages (bestiary entries, character sheets, index cards). Every click adds
// one more combatant to the shared encounter — a token node in the same JSON
// Canvas document the battle mat and initiative tracker use — so the creature
// shows up in the tracker immediately and on the map (new tokens stack near
// the corner for the DM to fan out). The second and later instances of a type
// get a random adjective ("Reckless Wolf") so they can be told apart.
//
// Usage:
//   <add-to-battle name="Wolf" kind="monster" image="/wolf.jpg"
//     hp="11" ac="13" init-mod="2" size="medium">Add to battle</add-to-battle>
//   <add-to-battle compact name="Wolf" ...></add-to-battle>
//
// This module is the *eager* half: the encounter store loads via a dynamic
// import() on the first click. The instance-count badge works without the
// chunk — it re-reads the encounter document from localStorage on the
// `storage` event (other tabs) and on `battle-mat-change` (this tab, echoed
// by the store).
//
// Attributes:
//   name        creature/type name (required)
//   kind        player | monster (default player) — token ring color
//   image       avatar URL for the token
//   size        D&D size word (tiny…gargantuan) — token footprint in cells
//   hp, ac      combat stats shown in the tracker
//   init-mod    initiative modifier (the tracker offers a 1d20±mod roll chip)
//   link        URL of the creature's page — tracker rows show it as an anchor
//   storage-key encounter localStorage key (default "battle-mat-canvas"),
//               must match the paired <battle-mat> / <initiative-tracker>
//   label-added transient click feedback text (default "Added")
//   compact     icon-only mode for tight rows
//
// The adjective set is a static property — override it (e.g. to another
// language) once per page:
//   import { AddToBattle } from '.../add-to-battle.js';
//   AddToBattle.adjectives = ['Отчаянный', 'Трусливый', ...];
//
// A normal in-flow element. Theming via --bm-atb-* custom properties.

import { getAdjectives, setAdjectives } from './battle-mat/adjectives.js';

const DEFAULT_STORAGE_KEY = 'battle-mat-canvas';
const EXT = 'x-battleMat';

const CSS = `
  :host {
    --bm-atb-bg: #ffffff;
    --bm-atb-fg: #1e1e1e;
    --bm-atb-muted: #667085;
    --bm-atb-accent: #3f8f6b;
    --bm-atb-edge: #d6d9e0;
    --bm-atb-radius: 0.5rem;
    display: block;
    font-family: inherit;
  }

  button {
    appearance: none;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4em;
    font: inherit;
    font-size: 0.9rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5em 0.9em;
    border: 1px solid var(--bm-atb-edge);
    border-radius: var(--bm-atb-radius);
    background: var(--bm-atb-bg);
    color: var(--bm-atb-fg);
    cursor: pointer;
    transition: box-shadow 0.12s ease, color 0.15s ease;
  }
  button:hover { box-shadow: 0 2px 10px rgb(0 0 0 / 0.15); }
  button:focus-visible { outline: 2px solid var(--bm-atb-accent); outline-offset: 2px; }

  .icon { display: inline-flex; }
  .icon svg { width: 1.2em; height: 1.2em; }

  /* transient feedback swaps the label for a moment */
  button.flash slot { display: none; }
  .feedback { display: none; color: var(--bm-atb-accent); }
  button.flash .feedback { display: inline; }

  .badge {
    display: none;
    position: absolute;
    top: -0.55em;
    right: -0.4em;
    padding: 0.05em 0.4em;
    border-radius: 1em;
    border: 1px solid var(--bm-atb-edge);
    background: var(--bm-atb-accent);
    color: #fff;
    font-size: 0.72em;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  :host([data-count]) .badge { display: inline-block; }

  /* compact: icon-only, inline */
  :host([compact]) { display: inline-flex; vertical-align: middle; }
  :host([compact]) button {
    width: auto;
    padding: 0.15em;
    border: none;
    background: none;
    color: var(--bm-atb-muted);
    line-height: 0;
  }
  :host([compact]) button:hover { box-shadow: none; color: var(--bm-atb-accent); }
  :host([compact]) slot,
  :host([compact]) .feedback { display: none; }
  :host([compact]) .icon svg { width: 1.4em; height: 1.4em; }
  :host([compact]) .badge { top: -0.5em; right: -0.6em; }
  :host([compact]) button.flash { color: var(--bm-atb-accent); }
`;

// Crossed sword, stroke style (matches the package's hand-drawn icon set).
const SWORD_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6.2 17.8 17 4.5l2.5-.9-.9 2.5L5.3 16.9"/>
    <path d="M4.6 15.4 8.6 19.4M3.5 20.5l2.6-2.6"/>
  </svg>
`;

// Count combatants of a type directly from the stored encounter document,
// without loading the store/document chunk (the badge must stay lightweight).
function countInEncounter(key, baseName, kind, storage = globalThis.localStorage) {
  try {
    const doc = JSON.parse(storage.getItem(key));
    if (!doc || !Array.isArray(doc.nodes)) return 0;
    return doc.nodes.filter((n) => {
      const ext = n?.[EXT];
      if (!ext || ext.kind !== 'token') return false;
      const base = ext.baseName ?? ext.name;
      return base === baseName && (ext.tokenKind ?? 'player') === kind;
    }).length;
  } catch {
    return 0;
  }
}

// The avatar travels with the combatant into sync rooms, where peers may be
// on another origin (a fork of the site) - so a site-relative `image` is
// resolved against this page before it enters the encounter.
const absoluteUrl = (url) => {
  if (!url) return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
};

export class AddToBattle extends HTMLElement {
  // Override once per page to localize instance adjectives. Backed by the
  // shared adjectives module so the battle-mat overlay names duplicate tokens
  // (dropped straight onto the map) with the same list.
  static get adjectives() {
    return getAdjectives();
  }
  static set adjectives(list) {
    setAdjectives(list);
  }

  get storageKey() {
    return this.getAttribute('storage-key') ?? DEFAULT_STORAGE_KEY;
  }

  get kind() {
    return this.getAttribute('kind') === 'monster' ? 'monster' : 'player';
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this._root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;

      this._btn = document.createElement('button');
      this._btn.type = 'button';
      const name = this.getAttribute('name') ?? '';
      this._btn.setAttribute('aria-label', `Add ${name} to battle`);
      if (this.hasAttribute('compact')) this._btn.title = `Add ${name} to battle`;

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = SWORD_ICON;
      const slot = document.createElement('slot');
      slot.textContent = 'Add to battle';
      this._feedback = document.createElement('span');
      this._feedback.className = 'feedback';
      this._feedback.textContent = this.getAttribute('label-added') ?? 'Added';
      this._badge = document.createElement('span');
      this._badge.className = 'badge';
      this._badge.setAttribute('aria-hidden', 'true');

      this._btn.append(icon, slot, this._feedback, this._badge);
      this._btn.addEventListener('click', (e) => {
        // the button may sit inside a link (index cards) — don't navigate
        e.preventDefault();
        e.stopPropagation();
        this._add();
      });
      this._root.append(style, this._btn);

      this._refresh = (e) => {
        if (e?.type === 'storage' && e.key !== this.storageKey) return;
        if (e?.type === 'battle-mat-change' && e.detail?.key !== this.storageKey) return;
        this._renderCount();
      };
    }
    window.addEventListener('storage', this._refresh);
    window.addEventListener('battle-mat-change', this._refresh);
    this._renderCount();
  }

  disconnectedCallback() {
    window.removeEventListener('storage', this._refresh);
    window.removeEventListener('battle-mat-change', this._refresh);
  }

  _renderCount() {
    const n = countInEncounter(this.storageKey, this.getAttribute('name') ?? '', this.kind);
    if (n > 0) {
      this.dataset.count = n;
      this._badge.textContent = `×${n}`;
    } else {
      delete this.dataset.count;
      this._badge.textContent = '';
    }
  }

  async _add() {
    if (this._busy) return;
    this._busy = true;
    try {
      const [{ getStore }, { addCombatant }, { getExt }] = await Promise.all([
        import('./battle-mat/store.js'),
        import('./battle-mat/combat.js'),
        import('./battle-mat/canvas-doc.js'),
      ]);
      const attr = (a) => this.getAttribute(a) ?? undefined;
      const store = getStore(this.storageKey);
      addCombatant(
        store.doc,
        {
          name: attr('name'),
          kind: this.kind,
          image: absoluteUrl(attr('image')),
          size: attr('size'),
          hp: attr('hp'),
          ac: attr('ac'),
          initMod: attr('init-mod'),
          link: attr('link'),
        },
        { adjectives: AddToBattle.adjectives, cellSize: getExt(store.doc).grid.cellSize },
      );
      store.commit();
      this._btn.classList.add('flash');
      clearTimeout(this._flashId);
      this._flashId = setTimeout(() => this._btn.classList.remove('flash'), 1200);
    } catch (err) {
      console.error('add-to-battle: failed to add the combatant', err);
    } finally {
      this._busy = false;
    }
  }
}

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined' && !customElements.get('add-to-battle')) {
  customElements.define('add-to-battle', AddToBattle);
}
