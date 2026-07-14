// <initiative-tracker> — corner widget tracking turn order for the battle
// mat's encounter. It reads and writes the same JSON Canvas document as
// <battle-mat> (shared per-key store), so tokens dropped on the mat appear
// here as combatants, and both components see each other's edits live.
//
// This module is the *eager* half and imports nothing from the rest of the
// package: the panel implementation (and the shared store/document code)
// loads via a dynamic import() the first time the widget is expanded, and is
// shared with the battle-mat chunk by the bundler.
//
// A normal in-flow element (the panel opens below the button and pushes
// content, like a disclosure). Pages that pin the host (position: fixed) can
// flip the growth direction and panel alignment with
// --bm-trk-direction (column | column-reverse) and
// --bm-trk-align (flex-start | flex-end).
//
// Attributes:
//   storage-key  localStorage key of the encounter, must match the
//                <battle-mat> it pairs with (default "battle-mat-canvas")
//   label-title, label-round, label-next, label-reset, label-empty,
//   label-hp, label-ac, label-init
//                localized UI strings (defaults are English; see
//                DEFAULT_LABELS in battle-mat/tracker.js)

const TRACKER_CSS = `
  :host {
    --bm-trk-bg: rgb(24 27 36 / 0.96);
    --bm-trk-fg: #f3f4f6;
    --bm-trk-muted: #9aa2b1;
    --bm-trk-accent: #f4c430;
    --bm-trk-edge: #4a5263;
    --bm-trk-btn-bg: #2a2f3d;
    display: inline-flex;
    flex-direction: var(--bm-trk-direction, column);
    align-items: var(--bm-trk-align, flex-start);
    gap: 0.6rem;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 0.85rem;
    color: var(--bm-trk-fg);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: 1px solid var(--bm-trk-edge);
    border-radius: 50%;
    background: var(--bm-trk-btn-bg);
    color: var(--bm-trk-fg);
    cursor: pointer;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.3);
    transition: transform 0.12s ease, background 0.15s ease;
  }
  .toggle:hover { transform: translateY(-1px); }
  .toggle:focus-visible { outline: 2px solid var(--bm-trk-accent); outline-offset: 2px; }
  .toggle[disabled] { cursor: progress; opacity: 0.7; }
  .toggle .icon { width: 1.4rem; height: 1.4rem; }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(23rem, calc(100vw - 2.5rem));
    max-height: min(24rem, 70vh);
    border: 1px solid var(--bm-trk-edge);
    border-radius: 0.7rem;
    background: var(--bm-trk-bg);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
    overflow: hidden;
  }
  .panel[hidden] { display: none; }
  .loading { padding: 0.9rem; color: var(--bm-trk-muted); }
`;

// A d20 with a "1st" flag: turn order marker.
const TRACKER_ICON = `
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 5.5h10M4 9.5h10M4 13.5h10"/>
    <path d="M4 18.5h16"/>
    <path d="M17.5 4.5v9M17.5 4.5l2.5 2"/>
  </svg>
`;

export class InitiativeTracker extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      this._root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = TRACKER_CSS;
      this._root.appendChild(style);

      this._panel = document.createElement('div');
      this._panel.className = 'panel';
      this._panel.hidden = true;
      this._panel.id = 'panel';

      this._toggle = document.createElement('button');
      this._toggle.type = 'button';
      this._toggle.className = 'toggle';
      this._toggle.setAttribute('aria-label', this.getAttribute('label-title') ?? 'Initiative tracker');
      this._toggle.setAttribute('aria-expanded', 'false');
      this._toggle.setAttribute('aria-controls', 'panel');
      this._toggle.innerHTML = TRACKER_ICON;
      this._toggle.addEventListener('click', () => this._setOpen(this._panel.hidden));

      // Toggle first (reading and tab order); the default column opens the
      // panel below it, --bm-trk-direction: column-reverse opens it above.
      this._root.append(this._toggle, this._panel);

      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this._panel.hidden) {
          this._setOpen(false);
          this._toggle.focus();
        }
      });
    }
  }

  disconnectedCallback() {
    this._tracker?.dispose();
    this._tracker = null;
  }

  async _setOpen(open) {
    this._panel.hidden = !open;
    this._toggle.setAttribute('aria-expanded', String(open));
    if (!open || this._tracker || this._loading) return;

    // First expand: load the panel implementation (shared with battle-mat).
    this._loading = true;
    this._toggle.setAttribute('disabled', '');
    const note = document.createElement('div');
    note.className = 'loading';
    note.textContent = 'Loading';
    this._panel.appendChild(note);
    try {
      const mod = await import('./battle-mat/tracker.js');
      note.remove();
      // label-* attributes override the English defaults (localization)
      const labels = {};
      for (const key of ['title', 'round', 'next', 'reset', 'empty', 'hp', 'ac', 'init']) {
        const v = this.getAttribute(`label-${key}`);
        if (v !== null) labels[key] = v;
      }
      this._tracker = mod.buildTracker(this._panel, {
        storageKey: this.getAttribute('storage-key') ?? 'battle-mat-canvas',
        labels,
      });
    } catch (err) {
      note.textContent = 'Failed to load';
      console.error('initiative-tracker: failed to load the panel module', err);
    } finally {
      this._toggle.removeAttribute('disabled');
      this._loading = false;
    }
  }
}

// Self-register on import (guarded so double-imports don't throw).
if (typeof customElements !== 'undefined' && !customElements.get('initiative-tracker')) {
  customElements.define('initiative-tracker', InitiativeTracker);
}
