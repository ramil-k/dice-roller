// <battle-toolbar> — the always-visible dock: a vertical bar flush in the
// bottom-right corner (only its top-left corner rounded) with three buttons
// (initiative, battle map, dice). Initiative opens the shared battle screen
// (overlay.js) as a tracker HUD over the page (map hidden); the map button
// opens it with the map area up; the dice button opens the roll-dice builder
// overlay directly.
//
// This module is the *eager* half and deliberately imports nothing from the
// rest of the package: the battle screen and the dice overlay both load via
// dynamic import() on first use, so pages pay nothing until a click.
//
// The dock pins itself (position: fixed); pages adjust the spot and theme via
// custom properties on the host:
//   --bt-right / --bt-bottom / --bt-z          corner offsets (default 0) and stacking
//   --bt-radius                                top-left corner rounding
//   --bt-bg / --bt-edge / --bt-fg              dock background, border, hover
//   --bt-accent-tracker / -mat / -dice         per-button icon accents
//
// Attributes:
//   storage-key  localStorage key of the shared encounter document
//                (default "battle-mat-canvas")
//   roster       JSON array of extra pool tokens for the battle screen —
//                same format as <battle-mat>'s roster (property wins)
//   dice         space/comma-separated die sizes the dice tray offers
//   label-*      localized UI strings for the dock, the battle screen toolbar
//                and the tracker area: label-map, label-pool, label-dice
//                plus the tracker's label-title, label-round, label-next,
//                label-fill, label-reset, label-resetconfirm, label-empty,
//                label-name, label-hp, label-ac, label-init, label-remove
//                (defaults are English)

const DOCK_CSS = `
  :host {
    --bt-bg: rgb(24 27 36 / 0.85);
    --bt-edge: #4a5263;
    --bt-fg: #f3f4f6;
    --bt-accent-tracker: #f4c430;
    --bt-accent-mat: #5fb98d;
    --bt-accent-dice: #7d97e8;
    position: fixed;
    right: var(--bt-right, 0);
    bottom: var(--bt-bottom, 0);
    z-index: var(--bt-z, 1000);
    display: flex;
    flex-direction: column;
    padding: 0;
    /* flush to the corner: edges only where the dock meets the page,
       and a single rounded corner (top-left) */
    border: 1px solid var(--bt-edge);
    border-right: none;
    border-bottom: none;
    border-radius: var(--bt-radius, 1.25rem) 0 0 0;
    background: var(--bt-bg);
    backdrop-filter: blur(6px);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.12s ease;
  }
  button:hover { background: color-mix(in srgb, currentColor 14%, transparent); transform: translateY(-1px); }
  button:active { transform: translateY(0); }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  button[disabled] { cursor: progress; opacity: 0.6; }
  button .icon { width: 1.5rem; height: 1.5rem; }

  .b-tracker { color: var(--bt-accent-tracker); }
  .b-mat { color: var(--bt-accent-mat); }
  .b-dice { color: var(--bt-accent-dice); }
`;

// Crossed swords — Sergey Chikin's 170-weapon/weapon glyph, the same icon the
// standalone <initiative-tracker> toggle uses.
const TRACKER_ICON = `
  <svg class="icon" viewBox="0 0 150 190" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M120.12,145c-6.1,6.36-15.55-.75-13.75-7.35l-10.89-9.13-14,7-2.94-4.74,6.32-6.48-9.25-9.17-8.46,8.49,3.27,5.81C62.19,137.62,51.88,132,51.88,132L41.41,141.2l1.48,3c-9.23,9.08-21-3-12-11.89l2.9,1.33L43,123.06s-5.13-11.38,2.31-18.7L51,107.68l8.92-8.09L35.27,75.19l-1.7-15,15.11.62L74.84,86.06,99.5,63.7l17-2.7L114,76.72l-23.91,24,9.22,8.89,5.31-5.44,4.88,3-6.67,12.69,10,11.91C119.65,130.34,125.77,139.11,120.12,145ZM107.63,76.18l3.21-9.49L101,69.47S60.59,108,56,112.19s2.34,11.87,7.53,6.91S107.63,76.18,107.63,76.18Z"/>
  </svg>
`;

// A small map-with-grid glyph — the same drawing the <battle-mat> fab uses.
const MAT_ICON = `
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
  </svg>
`;

// The face-on d20 from roll-dice.js.
const DIE_ICON = `
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
       stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="M12 2.2 21.5 7.6v8.8L12 21.8 2.5 16.4V7.6z"/>
    <path d="M6.7 9 12 15.5 17.3 9z"/>
    <path d="M12 2.2 6.7 9 2.5 7.6M12 2.2 17.3 9l4.2-1.4M6.7 9 2.5 16.4 12 21.8l9.5-5.4L17.3 9M12 15.5V21.8"/>
  </svg>
`;

// label-* attribute suffixes → keys in the labels object handed to the battle
// screen (attribute names are lowercase; resetConfirm maps from resetconfirm).
const LABEL_KEYS = [
  'map', 'pool', 'dice',
  'title', 'round', 'next', 'fill', 'reset', 'resetConfirm', 'empty',
  'name', 'hp', 'ac', 'init', 'remove',
];

export class BattleToolbar extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this._root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = DOCK_CSS;
    this._root.appendChild(style);

    const button = (cls, icon, label, fn) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls;
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.innerHTML = icon;
      btn.addEventListener('click', () => fn(btn));
      this._root.appendChild(btn);
      return btn;
    };
    const L = this._labels();
    // Initiative opens the tracker as a HUD over the page (map hidden); the
    // map button brings the map area up.
    button('b-tracker', TRACKER_ICON, L.title ?? 'Initiative tracker', (btn) => this._openScreen(btn, { show: 'tracker', hide: 'map' }));
    button('b-mat', MAT_ICON, L.map ?? 'Battle map', (btn) => this._openScreen(btn, { show: 'map' }));
    button('b-dice', DIE_ICON, L.dice ?? 'Roll dice', (btn) => this._openDice(btn));
  }

  // Pool roster for the battle screen: property wins over the JSON attribute;
  // invalid JSON degrades to an empty roster rather than throwing.
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

  _labels() {
    const labels = {};
    for (const key of LABEL_KEYS) {
      const v = this.getAttribute(`label-${key.toLowerCase()}`);
      if (v !== null) labels[key] = v;
    }
    return labels;
  }

  // Die sizes for the builder tray (the `dice` attribute), or null for the
  // standard set. Bounds mirror roll-dice.js's parser limits.
  get _sides() {
    const attr = this.getAttribute('dice');
    if (!attr) return null;
    const sizes = attr
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 2 && n <= 1000);
    return sizes.length ? sizes : null;
  }

  // Both launchers load their implementation on first use; the button is
  // disabled while the chunk loads and re-enabled on failure so a transient
  // network error is retryable with another click.
  async _openScreen(btn, { show, hide }) {
    if (this._loading) return;
    this._loading = true;
    btn.setAttribute('disabled', '');
    try {
      const mod = await import('./battle-mat/overlay.js');
      mod.openBattleMat({
        opener: btn,
        roster: this.roster,
        storageKey: this.getAttribute('storage-key') ?? 'battle-mat-canvas',
        labels: this._labels(),
        show,
        hide,
      });
    } catch (err) {
      console.error('battle-toolbar: failed to load the battle screen module', err);
    } finally {
      btn.removeAttribute('disabled');
      this._loading = false;
    }
  }

  async _openDice(btn) {
    if (this._loading) return;
    this._loading = true;
    btn.setAttribute('disabled', '');
    try {
      const mod = await import('./roll-dice.js');
      mod.openDiceBuilder(btn, (result) => {
        this.dispatchEvent(new CustomEvent('roll', { detail: result, bubbles: true, composed: true }));
      }, { sides: this._sides });
    } catch (err) {
      console.error('battle-toolbar: failed to load the dice module', err);
    } finally {
      btn.removeAttribute('disabled');
      this._loading = false;
    }
  }
}

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined' && !customElements.get('battle-toolbar')) {
  customElements.define('battle-toolbar', BattleToolbar);
}
