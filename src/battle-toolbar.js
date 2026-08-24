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
//                label-name, label-hp, label-ac, label-init, label-remove,
//                and the sync panel's label-sync, label-synccreate,
//                label-syncjoin, label-syncleave, label-synccodeplaceholder,
//                label-syncoff, label-syncconnecting, label-syncconnected,
//                label-syncunknownroom, label-syncfailed, label-syncjoinconfirm,
//                label-synccopylink, label-synccopied, label-syncname,
//                label-synccolor, and the image card's label-image,
//                label-lock, label-unlock, label-imageremove
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

// Speedometer — Sergey Chikin's 028-transport/other/speedometer2 glyph
// (checked in under public/365/), the initiative button.
const TRACKER_ICON = `
  <svg class="icon" viewBox="25 76 100 78" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M106.29,130.28a31.72,31.72,0,0,0,1.56-5.91l12.55,1.28a52.47,52.47,0,0,1-.67,9.29Zm2-16.46,10.09-1.89a50.2,50.2,0,0,1,1.6,7.57l-11.59-.09A47.22,47.22,0,0,0,108.25,113.82Zm-1.14-7.39c-.26-.48-.53-1-.82-1.43l6.47-5.32a44.65,44.65,0,0,1,3.34,6.16L107.63,109C107.48,108.1,107.31,107.25,107.11,106.43Zm-25.17,3.12L98,95.46C92.18,90.88,84.66,88,75.44,88,44.61,88,30,116.72,36.67,139l8.15-1.6,2.36,5.21-12.12,6.65c-14.47-27.07,0-68.64,40.52-68.64,11.88,0,21.39,3.62,28.54,9.4l5.11-4.49,2,4.34L90.92,118.3Zm-6.79,4.93c15.52,0,15.42,23.71.27,23.71C58.82,138.19,59.57,114.48,75.15,114.48Zm43.14,26.8A48,48,0,0,1,115,149.6l-16.54-8.86a20,20,0,0,0,5.8-6.14Z"/>
  </svg>
`;

// Map — Sergey Chikin's 340-office/map glyph (checked in under public/365/).
const MAT_ICON = `
  <svg class="icon" viewBox="24 59 104 92" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M117.94,135.21l-28,11.53L65.35,128.29l-36.64,8.08L34.9,69.5l30.79-5.76L93.74,82.18l30.38-10.37Zm-5.19-43.94-1.86,8.9-5.44.8L101.38,109,97.83,104l-2.9-.18-1.17-.8-.27,3.78-3.26,1.43L87,103.63l-1.72,1,3.15,5.61,3.88,1.16-4.11,4.56L87,123.27l-7.94,1.9-3.53-5-1-9L68.35,108l-2.94-6.18.65-3.91,6-3.21L78.53,99l7-.75-.08-3.92L81,92l-.6,3.43L76.94,95l-1-4.09-4,.69-2.53-6,2.26-2.52,2.44,2.31,3.11.16,4.36-5.1L64.09,69.13l-5.68,1.13.78,1.21.8,5.28-1.12.65-7.39-5.77-2.63.52L48,78.92l3.95,3,.83-5.47,5.62,5L57.7,85.3l-4.65,3.19-.13,6.25-3.49-2.17L44.51,92l.31,3.12L49,96.57l-3.9,2.75-4.92-2.9-2.09-5.7-3.4,39.33,8.93-2.22,4.17-14.94-2.36-2.65-1.12-5.3,4.25-6.06,11.15,6.23-.49,2.15,5.6,4.31-3.94,5.53L59.4,119l-3.06,0-6.71,7.37,16.07-4,24.61,18.15,23.18-9.59,3.87-42Zm-6.79,36-2.75-1.91-5.83,4.57-1.55-6.31,5.72-8.76.81,2.11,2.32-.34.83-3.65,4.48,4.66-.24,6.6Z"/>
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
  'name', 'hp', 'ac', 'init', 'remove', 'link',
  'sync', 'syncCreate', 'syncJoin', 'syncLeave', 'syncCodePlaceholder',
  'syncOff', 'syncConnecting', 'syncConnected', 'syncUnknownRoom',
  'syncFailed', 'syncJoinConfirm', 'syncCopyLink', 'syncCopied',
  'syncName', 'syncColor',
  'image', 'lock', 'unlock', 'imageRemove',
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

    // Battle-mat sync: an invite link (#bm-room=<code>) joins its room, and a
    // session configured earlier resumes on load. Both probes are cheap, so
    // pages that never touched sync never load the chunk (it bundles yjs).
    const syncBoot = () => {
      let hasConfig = false;
      try {
        hasConfig = localStorage.getItem('battle-mat-sync') !== null;
      } catch {
        /* storage unavailable */
      }
      const hasLink = window.location.hash.startsWith('#bm-room=');
      if (!hasConfig && !hasLink) return;
      import('./battle-mat/sync.js')
        .then(async (m) => {
          const key = this.getAttribute('storage-key') ?? undefined;
          const room = m.roomFromUrl();
          if (!room) {
            m.maybeStartSync(key);
            return;
          }
          const L = this._labels();
          try {
            await m.joinFromLink(room, key, { confirmText: L.syncJoinConfirm });
          } catch (err) {
            if (err?.message === 'unknown-room') {
              window.alert(`${L.syncUnknownRoom ?? 'No such room'}: ${room}`);
            } else {
              console.error('battle-toolbar: failed to join the room link', err);
            }
          }
        })
        .catch((err) => console.error('battle-toolbar: failed to start sync', err));
    };
    syncBoot();
    // room links may also arrive without a page load (SPA-style navigation)
    window.addEventListener('hashchange', syncBoot);
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
