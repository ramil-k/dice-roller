// The battle screen: a full-viewport top-layer surface laid out as a CSS grid
//   "map     toolbar"
//   "pool    toolbar"
//   "tracker toolbar"
// — a vertical toolbar column on the right (the same corner as the page
// dock): the map tools group at its top and, bottom-aligned, dock-style
// buttons that toggle the map, the token pool and the initiative tracker
// areas (state persisted in the battle-mat-ui localStorage key), plus a dice
// button that opens the roll-dice builder overlay on top of everything.
// Escape closes the screen (no close button).
// Mirrors the DiceOverlay architecture in roll-dice.js — a detached host
// element with its own shadow root, promoted into the top layer via the
// Popover API where available, with a fixed-position + max-z-index fallback
// elsewhere.
//
// One shared instance exists at a time (getOverlay()); <battle-toolbar> and
// <battle-mat> triggers call openBattleMat() from a dynamic import so none of
// this loads until the first open.

import { el, svgEl } from './dom.js';
import { ICONS } from './icons.js';
import {
  emptyDoc,
  getExt,
  getNode,
  nodeKind,
  addNode,
  makeToken,
  makeImage,
  validateCanvas,
  serialize,
  resolveColor,
  cellsForSize,
  EXT,
} from './canvas-doc.js';
import { clampCellSize, snapTokenOrigin } from './grid.js';
import { getStore, DEFAULT_KEY } from './store.js';
import {
  reserveCombatants,
  placeCombatant,
  instanceName,
  getHp,
  getHpMax,
  getAc,
  getInitiative,
  getInitMod,
} from './combat.js';
import { getAdjectives } from './adjectives.js';
import { CATEGORIES, iconUrl } from './registry.js';
import { buildScene, render, applyViewport, updateGrid } from './view.js';
import { attachTools } from './tools.js';
import { buildTracker } from './tracker.js';

const MAX_IMAGE_DIM = 2048; // attached images are downscaled to fit (quota)

// Which screen areas are visible — a per-device UI preference, so it lives in
// its own localStorage key rather than in the shared encounter document.
const UI_KEY = 'battle-mat-ui';
const AREAS = ['map', 'pool', 'tracker'];

function loadUiState() {
  const ui = { map: true, pool: true, tracker: true };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
    for (const area of AREAS) if (typeof saved[area] === 'boolean') ui[area] = saved[area];
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return ui;
}

function saveUiState(ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* storage unavailable */
  }
}

// English defaults for the screen toolbar; the tracker area has its own
// defaults (DEFAULT_LABELS in tracker.js). Overridden via open()'s `labels`.
const SCREEN_LABELS = {
  map: 'Map',
  pool: 'Token pool',
  title: 'Initiative',
  dice: 'Roll dice',
};

const TOOLS = [
  { id: 'select', label: 'Select and move' },
  { id: 'pan', label: 'Pan' },
  { id: 'pen', label: 'Pen' },
  { id: 'line', label: 'Line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'ruler', label: 'Ruler' },
];

// The six JSON Canvas preset colors double as the pen palette, so exported
// drawings keep first-class spec colors.
const PALETTE = [
  { preset: '1', label: 'Red' },
  { preset: '2', label: 'Orange' },
  { preset: '3', label: 'Yellow' },
  { preset: '4', label: 'Green' },
  { preset: '5', label: 'Cyan' },
  { preset: '6', label: 'Purple' },
];

const OVERLAY_CSS = `
  :host {
    --bm-bg: #14171f;
    --bm-surface: #1f2430;
    --bm-fg: #eef1f6;
    --bm-muted: #98a1b3;
    --bm-accent: #f4c430;
    --bm-edge: #394153;
    --bm-grid-line: rgb(from var(--bm-fg) r g b / 0.13);
    --bm-token-player: #4a9e6f;
    --bm-token-monster: #cf5a5a;
    /* the tracker panel CSS (tracker.js, injected into this shadow root when
       the tracker area first builds) reads these --bm-trk-* tokens */
    --bm-trk-fg: var(--bm-fg);
    --bm-trk-muted: var(--bm-muted);
    --bm-trk-accent: var(--bm-accent);
    --bm-trk-edge: var(--bm-edge);
    position: fixed;
    inset: 0;
    /* Fallback stacking for browsers without the Popover API (see _mount). */
    z-index: 2147483647;
    color: var(--bm-fg);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    /* Popover-UA resets: undo [popover] fit-content sizing, margins, border,
       padding and opaque background. */
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    max-width: none;
    max-height: none;
    overflow: visible;
    background: transparent;
  }

  /* The battle screen grid: the map / pool / tracker areas stacked on the
     left, the toolbar column on the right (same corner as the page dock).
     The grid always fills the whole viewport — the toolbar column stays
     full-height. The pool and tracker rows are content-sized, the tracker
     capped by fit-content(33%): its content up to a third of the screen
     (the 0.5fr share against the map's 1fr; an fr value is not allowed
     inside fit-content, hence the percentage), with the list scrolling
     beyond the cap. Area visibility is toggled via data-show-* attributes;
     a hidden pool/tracker contributes no content, so its row collapses to
     0. With the map off its 1fr cell stays, shows the page underneath, and
     pointer events pass through to it — only the remaining areas stay
     interactive (the :host is pointer-inert so it never swallows those
     clicks itself). */
  :host { pointer-events: none; }
  .mat-root {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    animation: bm-fade 0.15s ease;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 1fr max-content fit-content(33%);
    grid-template-areas:
      "map toolbar"
      "pool toolbar"
      "tracker toolbar";
  }
  .mat-root:not([data-show-map]) { pointer-events: none; }
  .mat-root:not([data-show-map]) :is(.screen-toolbar, .pool, .tracker-area, .token-card) { pointer-events: auto; }
  .mat-root:not([data-show-map]) .map-area { display: none; }
  .mat-root:not([data-show-pool]) .pool { display: none; }
  .mat-root:not([data-show-tracker]) .tracker-area { display: none; }
  @keyframes bm-fade { from { opacity: 0; } }

  /* --- screen toolbar (area toggles, dice, close) ----------------------------
     Styled like the <battle-toolbar> dock controls (same size, per-button
     accents, no gaps) and bottom-aligned, so it reads as the dock's
     continuation in the same corner. Pressed toggles show their accent;
     unpressed ones go muted. */
  .screen-toolbar {
    grid-area: toolbar;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0;
    background: var(--bm-surface);
    border-left: 1px solid var(--bm-edge);
    overflow-y: auto;
    /* the column spans all three rows — a definite zero height keeps its
       content out of the rows' intrinsic (max-content) sizing, min-height
       then stretches it back to the full grid area */
    height: 0;
    min-height: 100%;
  }
  /* the map tools sit at the top; the spacer pushes the dock-style controls
     to the bottom of the column */
  .screen-toolbar .spacer { flex: 1; }
  .screen-toolbar > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--bm-muted);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .screen-toolbar > button:hover { background: rgb(from var(--bm-fg) r g b / 0.08); }
  .screen-toolbar > .b-tracker { --tb-accent: #f4c430; }
  .screen-toolbar > .b-map { --tb-accent: #5fb98d; }
  .screen-toolbar > button[aria-pressed="true"] { color: var(--tb-accent); }
  .screen-toolbar > .b-dice { color: #7d97e8; }
  .screen-toolbar > button .icon { width: 1.5rem; height: 1.5rem; }

  /* --- map area -------------------------------------------------------------- */
  .map-area { grid-area: map; position: relative; overflow: hidden; min-height: 0; background: var(--bm-bg); }
  .mat { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; display: block; }
  .mat[data-mode="panning"], .mat[data-space] { cursor: grabbing; }
  .mat[data-tool="pan"] { cursor: grab; }
  .mat[data-tool="pen"], .mat[data-tool="line"], .mat[data-tool="rect"],
  .mat[data-tool="ellipse"], .mat[data-tool="ruler"] { cursor: crosshair; }
  .mat[data-tool="eraser"] { cursor: cell; }
  .mat[data-mode="placing"] { cursor: copy; }

  .grid-line { stroke: var(--bm-grid-line); stroke-width: 1; }
  /* Light discs: Chikin icons are black line art, so tokens sit on a bright
     circle to stay readable on the dark mat (photos read fine on it too). */
  .token-ring { fill: rgb(from var(--bm-fg) r g b / 0.92); stroke-width: 2.5; }
  .token-player .token-ring, .token-ring.token-player { stroke: var(--bm-token-player); }
  .token-monster .token-ring, .token-ring.token-monster { stroke: var(--bm-token-monster); }
  .layer-tokens .token { cursor: grab; }
  .ruler-line { stroke: var(--bm-accent); }
  .ruler-end { fill: var(--bm-accent); }
  .ruler-label {
    fill: var(--bm-fg);
    font-weight: 650;
    paint-order: stroke;
    stroke: rgb(from var(--bm-bg) r g b / 0.9);
    stroke-width: 0.25em;
  }
  .foreign-box { fill: rgb(from var(--bm-fg) r g b / 0.05); stroke: var(--bm-muted); stroke-dasharray: 6 4; }
  .foreign-label { fill: var(--bm-muted); font-size: 13px; }

  /* Token name plates (left-aligned with the token, in the labels layer
     above every token): hidden by default, shown while Shift is held
     (data-labels-shift, set by tools.js), via the tools-bar toggle
     (data-labels — the mobile path, no modifier keys there), or on token
     hover (data-hover, set in _wireTokenHover — replaces native <title>
     tooltips). */
  .token-label {
    fill: var(--bm-fg);
    font-weight: 650;
    paint-order: stroke;
    stroke: rgb(from var(--bm-bg) r g b / 0.9);
    stroke-width: 0.25em;
    pointer-events: none;
    display: none;
  }
  .mat[data-labels] .token-label, .mat[data-labels-shift] .token-label,
  .token-label[data-hover] { display: inline; }

  /* --- token pool (a full-width grid row) ----------------------------------- */
  .pool {
    grid-area: pool;
    min-width: 0;
    background: var(--bm-surface);
    border-top: 1px solid var(--bm-edge);
    padding: 0.5rem 0.65rem;
  }
  .pool .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 0.45rem; }
  .pool .tab {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--bm-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
  .pool .tab:hover { color: var(--bm-fg); }
  .pool .tab[aria-selected="true"] {
    color: var(--bm-fg);
    background: rgb(from var(--bm-fg) r g b / 0.08);
    border-color: var(--bm-edge);
  }
  .pool .tab:focus-visible, .avatar:focus-visible, .tools button:focus-visible,
  .swatch:focus-visible, .screen-toolbar > button:focus-visible, .settings :focus-visible {
    outline: 2px solid var(--bm-accent);
    outline-offset: 2px;
  }
  .pool .avatars { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.15rem; }
  .avatar {
    flex: 0 0 auto;
    width: 2.9rem;
    height: 2.9rem;
    padding: 0.3rem;
    border: 1px solid var(--bm-edge);
    border-radius: 50%;
    background: rgb(from var(--bm-fg) r g b / 0.88);
    cursor: grab;
    touch-action: none;
  }
  .avatar:hover { background: var(--bm-fg); }
  .avatar[aria-pressed="true"] { border-color: var(--bm-accent); box-shadow: 0 0 0 2px var(--bm-accent); }
  .avatar img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  /* photo avatars fill the circle (registry line art keeps the padded fit) —
     same split the map's token rendering makes */
  .avatar img.photo { border-radius: 50%; object-fit: cover; }
  .pool-ghost {
    position: fixed;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0.85;
    z-index: 10;
    width: 3rem;
    height: 3rem;
    padding: 0.3rem;
    border-radius: 50%;
    background: rgb(from var(--bm-fg) r g b / 0.88);
  }
  .pool-ghost img { width: 100%; height: 100%; object-fit: contain; }
  .pool-ghost img.photo { border-radius: 50%; object-fit: cover; }

  /* --- map tools (the top group of the screen toolbar column) ---------------
     Slightly tighter than the dock controls below so the whole column fits a
     laptop viewport without scrolling. */
  .tools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0;
  }
  .mat-root:not([data-show-map]) .tools { display: none; }
  .tools button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: none;
    border-radius: 0.55rem;
    background: transparent;
    color: var(--bm-muted);
    cursor: pointer;
  }
  .tools button:hover { color: var(--bm-fg); background: rgb(from var(--bm-fg) r g b / 0.08); }
  .tools button[aria-pressed="true"], .tools button[aria-expanded="true"] {
    color: var(--bm-bg);
    background: var(--bm-accent);
  }
  .tools .icon { width: 1.2rem; height: 1.2rem; }
  .tools .divider { height: 1px; margin: 0.25rem 0.3rem; background: var(--bm-edge); }
  .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; padding: 0.15rem 0.45rem; }
  /* .tools button sets 2.5rem sizing; swatches need their own (specificity) */
  .tools button.swatch {
    width: 0.95rem;
    height: 0.95rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
  }
  .tools button.swatch[aria-pressed="true"] { border-color: var(--bm-fg); }

  /* --- settings panel ------------------------------------------------------ */
  /* the display:grid below would defeat the hidden attribute without this */
  .settings[hidden] { display: none; }
  /* opens beside the toolbar column, i.e. against the map's right edge */
  .settings {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    grid-template-columns: auto auto;
    gap: 0.5rem 0.75rem;
    align-items: center;
    background: var(--bm-surface);
    border: 1px solid var(--bm-edge);
    border-radius: 0.8rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    padding: 0.9rem 1rem;
    font-size: 0.85rem;
  }
  .settings h2 { grid-column: 1 / -1; margin: 0 0 0.2rem; font-size: 0.9rem; }
  .settings label { color: var(--bm-muted); }
  .settings input[type="number"] {
    width: 4.5rem;
    font: inherit;
    color: var(--bm-fg);
    background: rgb(from var(--bm-fg) r g b / 0.07);
    border: 1px solid var(--bm-edge);
    border-radius: 0.4rem;
    padding: 0.25rem 0.4rem;
  }
  .settings input[type="checkbox"] { width: 1rem; height: 1rem; accent-color: var(--bm-accent); }

  /* --- token card (opened by clicking a token or a tracker row) ------------ */
  .token-card {
    position: absolute;
    width: max-content;
    max-width: 16rem;
    background: var(--bm-surface);
    border: 1px solid var(--bm-edge);
    border-radius: 0.7rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
    padding: 0.65rem 0.8rem;
    font-size: 0.85rem;
  }
  .token-card .tc-head {
    display: flex;
    align-items: center;
    gap: 0.45em;
    font-weight: 700;
    margin-bottom: 0.4rem;
  }
  .token-card .tc-dot { flex: 0 0 auto; width: 0.65em; height: 0.65em; border-radius: 50%; }
  .token-card .tc-stats { display: flex; gap: 0.9em; margin-bottom: 0.55rem; }
  .token-card .tc-stat { display: inline-flex; align-items: baseline; gap: 0.3em; }
  .token-card .tc-label { color: var(--bm-muted); font-size: 0.85em; }
  .token-card .tc-value { font-weight: 650; font-variant-numeric: tabular-nums; }
  .token-card .tc-swatches { display: flex; gap: 0.35rem; }
  .token-card .tc-swatches button {
    width: 1.15rem;
    height: 1.15rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
  }
  .token-card .tc-swatches button[aria-pressed="true"] { border-color: var(--bm-fg); }
  .token-card .tc-swatches button:focus-visible { outline: 2px solid var(--bm-accent); outline-offset: 2px; }
  /* the reset swatch shows the kind color it falls back to, dashed to differ */
  .token-card .tc-swatches .tc-reset { border: 2px dashed var(--bm-muted); }
  .token-card .tc-swatches .tc-reset[aria-pressed="true"] { border-color: var(--bm-fg); }

  /* --- status + close ------------------------------------------------------ */
  .status {
    position: absolute;
    bottom: 0.9rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bm-surface);
    border: 1px solid var(--bm-edge);
    border-radius: 2rem;
    padding: 0.35rem 1rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.15s ease;
  }
  .status:empty { opacity: 0; }
  .status.warn { color: #ffb0b0; border-color: #a05050; }

  /* --- initiative tracker area ----------------------------------------------
     buildTracker (tracker.js) fills this with .trk-head / .trk-list /
     .trk-empty; its own injected CSS handles the contents, this rule only
     shapes the grid area (max-content row: the tracker takes its natural
     height and the map absorbs the rest). */
  .tracker-area {
    grid-area: tracker;
    display: flex;
    flex-direction: column;
    /* overflow != visible zeroes the row's automatic minimum, letting the
       fit-content(33%) cap actually clamp it — the list scrolls beyond it */
    overflow: hidden;
    background: var(--bm-surface);
    border-top: 1px solid var(--bm-edge);
  }
`;

class BattleMatOverlay {
  constructor() {
    this.host = document.createElement('div');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.root.appendChild(style);
    this._onKeydown = this._onKeydown.bind(this);
  }

  // `labels` localizes the screen toolbar and the tracker area (see
  // SCREEN_LABELS and tracker.js DEFAULT_LABELS); `show` names an area
  // ('map' | 'pool' | 'tracker') that must be visible on open — the dock
  // button the user came in through — and `hide` one that must not be (the
  // initiative button opens the tracker as a HUD without the map).
  open({ opener, roster = [], storageKey = DEFAULT_KEY, labels = {}, show, hide } = {}) {
    this.opener = opener ?? null;
    this.roster = roster;
    this.storageKey = storageKey;
    this.labels = labels;
    this._ui = loadUiState();
    let uiChanged = false;
    if (show && AREAS.includes(show) && !this._ui[show]) {
      this._ui[show] = true;
      uiChanged = true;
    }
    if (hide && AREAS.includes(hide) && this._ui[hide]) {
      this._ui[hide] = false;
      uiChanged = true;
    }
    if (uiChanged) saveUiState(this._ui);
    // the encounter document is shared (initiative tracker, add-to-battle) —
    // all edits flow through the per-key store, re-renders through its events
    this.store = getStore(storageKey);
    this._unsubscribe?.();
    this._unsubscribe = this.store.subscribe((e) => this._onStoreEvent(e));
    this.tool = 'select';
    this.color = '1';
    this._buildShell();
    this._mount();
    document.addEventListener('keydown', this._onKeydown, true);
    this._syncFromDoc();
    this._screenButtons.get(show && AREAS.includes(show) ? show : 'map').focus();
  }

  close() {
    this._closeCard();
    this.tools?.detach();
    this._tracker?.dispose();
    this._tracker = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.store?.flush();
    document.removeEventListener('keydown', this._onKeydown, true);
    if (this.host.parentNode) this.host.parentNode.removeChild(this.host);
    if (this.opener && typeof this.opener.focus === 'function') this.opener.focus();
  }

  // Attach the overlay and, where the Popover API exists, promote it into the
  // top layer so it paints above any popover-based page UI (top-layer order
  // is show order — no z-index war). Same pattern as DiceOverlay._mount.
  _mount() {
    document.body.appendChild(this.host);
    if (this.host.showPopover) {
      this.host.setAttribute('popover', 'manual');
      try {
        this.host.showPopover();
      } catch {
        /* already shown */
      }
    }
    // Let a paired <initiative-tracker> lift itself back above us: top-layer
    // order is show order, so a tracker shown before us would be hidden behind
    // the mat until it re-shows. It listens for this and re-pops on top.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('battle-mat-open', { detail: { key: this.storageKey } }));
    }
  }

  // ---- shell ---------------------------------------------------------------

  _buildShell() {
    this._closeCard(); // reopened: drop the stale card and its dismiss listener
    this._tracker?.dispose(); // reopened: drop the previous tracker's store hook
    this._tracker = null;
    for (const child of Array.from(this.root.children)) {
      if (child.tagName !== 'STYLE') child.remove();
    }

    const rootEl = el('div', 'mat-root');
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', 'Battle screen');

    // Map area: the scene svg plus the grid-settings panel (the map tools
    // live at the top of the screen toolbar column).
    const mapArea = el('div', 'map-area');
    this.svg = svgEl('svg', { class: 'mat' });
    this.refs = buildScene(this.svg);
    mapArea.append(this.svg, this._buildSettings());

    this._status = el('div', 'status');
    this._status.setAttribute('aria-live', 'polite');

    this._trackerEl = el('div', 'tracker-area');

    rootEl.append(this._buildScreenToolbar(), mapArea, this._buildPool(), this._trackerEl, this._status);
    this._buildFileInputs(rootEl);
    this.root.appendChild(rootEl);
    this._rootEl = rootEl;
    this._applyUiState();

    // buildTracker injects its stylesheet into container.getRootNode(), so it
    // must run after the tracker area is attached under this shadow root.
    this._tracker = buildTracker(this._trackerEl, {
      storageKey: this.storageKey,
      labels: this.labels,
      onCombatantClick: (id, x, y) => this._openCard(id, x, y),
    });

    this._wireTools();
    this._wireImageDrop();
    this._wireTokenHover();
  }

  // Hovering a token shows its name plate (the replacement for the native
  // <title> tooltips the tokens used to carry).
  _wireTokenHover() {
    const labelFor = (target) => {
      const g = target.closest?.('.token');
      if (!g) return null;
      return this.refs.labels.querySelector(`[data-label-for="${CSS.escape(g.getAttribute('data-id'))}"]`);
    };
    this.refs.tokens.addEventListener('pointerover', (e) => {
      const label = labelFor(e.target);
      if (label === this._hoverLabel) return;
      this._hoverLabel?.removeAttribute('data-hover');
      label?.setAttribute('data-hover', '');
      this._hoverLabel = label;
    });
    this.refs.tokens.addEventListener('pointerout', (e) => {
      // only clear when actually leaving the token (not moving between its parts)
      if (labelFor(e.relatedTarget ?? document.body)) return;
      this._hoverLabel?.removeAttribute('data-hover');
      this._hoverLabel = null;
    });
  }

  // ---- token card ------------------------------------------------------------

  // A small card next to a clicked token (on the map) or tracker row: the
  // combatant's stats at a glance and a ring-color picker. One card at a
  // time; a second click on the same token toggles it away.
  _openCard(id, cx, cy) {
    if (this._cardId === id && this._card) {
      this._closeCard();
      return;
    }
    this._closeCard();
    const node = getNode(this.store.doc, id);
    if (!node) return;

    const card = el('div', 'token-card');
    this._card = card;
    this._cardId = id;
    this._renderCard(node);
    this._rootEl.appendChild(card);

    // next to the click point, clamped into the viewport
    const pad = 8;
    const r = card.getBoundingClientRect();
    card.style.left = `${Math.max(pad, Math.min(cx + 12, window.innerWidth - r.width - pad))}px`;
    card.style.top = `${Math.max(pad, Math.min(cy + 12, window.innerHeight - r.height - pad))}px`;

    // any press outside dismisses it — except on tokens and tracker rows,
    // whose own click handlers decide (toggle same / move to another)
    this._cardDismiss = (e) => {
      const t = e.composedPath()[0];
      if (!(t instanceof Element)) return;
      if (card.contains(t) || t.closest('.token') || t.closest('.trk-list li')) return;
      this._closeCard();
    };
    this.root.addEventListener('pointerdown', this._cardDismiss, true);
  }

  _closeCard() {
    if (!this._card) return;
    this._card.remove();
    this._card = null;
    this._cardId = null;
    this.root.removeEventListener('pointerdown', this._cardDismiss, true);
    this._cardDismiss = null;
  }

  // Re-read the node on store changes so tracker edits show up live; the
  // card dies with its combatant.
  _refreshCard() {
    if (!this._card) return;
    const node = getNode(this.store.doc, this._cardId);
    if (!node) this._closeCard();
    else this._renderCard(node);
  }

  _renderCard(node) {
    const card = this._card;
    const ext = node[EXT];
    const L = { hp: 'HP', ac: 'AC', init: 'Init', ...this.labels };
    const kindColor = ext.tokenKind === 'monster' ? 'var(--bm-token-monster)' : 'var(--bm-token-player)';
    card.replaceChildren();

    const head = el('div', 'tc-head');
    const dot = el('span', 'tc-dot');
    dot.style.background = node.color ? resolveColor(node.color) : kindColor;
    head.append(dot, el('span', 'tc-name', ext.name || 'Token'));
    card.appendChild(head);

    const stats = el('div', 'tc-stats');
    const stat = (label, value) => {
      const s = el('span', 'tc-stat');
      s.append(el('span', 'tc-label', label), el('span', 'tc-value', value));
      stats.appendChild(s);
    };
    const hpMax = getHpMax(node);
    stat(L.hp, `${getHp(node) ?? '–'}${hpMax != null ? `/${hpMax}` : ''}`);
    stat(L.ac, `${getAc(node) ?? '–'}`);
    const mod = getInitMod(node);
    stat(L.init, `${getInitiative(node) ?? '–'}${mod ? ` (${mod > 0 ? '+' : ''}${mod})` : ''}`);
    card.appendChild(stats);

    // ring color: the six JSON Canvas presets plus "kind default" (dashed)
    const swatches = el('div', 'tc-swatches');
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Token color');
    for (const { preset, label } of PALETTE) {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.style.background = resolveColor(preset);
      b.setAttribute('aria-pressed', String(node.color === preset));
      b.addEventListener('click', () => {
        node.color = preset;
        this._commit(); // change event re-renders map, tracker and this card
      });
      swatches.appendChild(b);
    }
    const reset = el('button', 'tc-reset');
    reset.type = 'button';
    reset.setAttribute('aria-label', 'Default color');
    reset.title = 'Default color';
    reset.style.background = kindColor;
    reset.setAttribute('aria-pressed', String(!node.color));
    reset.addEventListener('click', () => {
      delete node.color;
      this._commit();
    });
    swatches.appendChild(reset);
    card.appendChild(swatches);
  }

  // The right toolbar column: the map tools group at the top (which also
  // hosts the pool toggle), then — bottom-aligned like the page dock — the
  // tracker and map toggles and the dice roller launcher, mirroring the
  // dock's buttons exactly. No close button: Escape leaves the screen.
  _buildScreenToolbar() {
    const L = { ...SCREEN_LABELS, ...this.labels };
    const bar = el('div', 'screen-toolbar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Battle screen');
    bar.setAttribute('aria-orientation', 'vertical');

    // _buildToolbar registers the pool toggle here, so the map must exist
    // before the tools bar builds
    this._screenButtons = new Map();
    bar.append(this._buildToolbar(), el('div', 'spacer'));

    const toggles = [
      ['tracker', L.title], // the tracker's own panel title doubles as its name
      ['map', L.map],
    ];
    for (const [area, label] of toggles) {
      const btn = el('button', `b-${area}`);
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.innerHTML = ICONS[area];
      btn.addEventListener('click', () => this._toggleArea(area));
      this._screenButtons.set(area, btn);
      bar.appendChild(btn);
    }

    const dice = el('button', 'b-dice');
    dice.type = 'button';
    dice.setAttribute('aria-label', L.dice);
    dice.title = L.dice;
    dice.innerHTML = ICONS.dice;
    dice.addEventListener('click', () => this._openDice(dice));
    bar.appendChild(dice);
    return bar;
  }

  _toggleArea(area) {
    this._ui[area] = !this._ui[area];
    saveUiState(this._ui);
    this._applyUiState();
  }

  _applyUiState() {
    for (const area of AREAS) {
      this._rootEl.toggleAttribute(`data-show-${area}`, this._ui[area]);
      this._screenButtons.get(area).setAttribute('aria-pressed', String(this._ui[area]));
    }
  }

  // The dice builder overlay lives in the separate roll-dice chunk; load it on
  // demand. It mounts as a popover shown after us, so it paints on top.
  async _openDice(btn) {
    if (this._diceLoading) return;
    this._diceLoading = true;
    btn.setAttribute('disabled', '');
    try {
      const mod = await import('../roll-dice.js');
      mod.openDiceBuilder(btn);
    } catch (err) {
      console.error('battle screen: failed to load the dice module', err);
    } finally {
      btn.removeAttribute('disabled');
      this._diceLoading = false;
    }
  }

  _buildToolbar() {
    const bar = el('div', 'tools');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Battle map tools');
    bar.setAttribute('aria-orientation', 'vertical');

    this._toolButtons = new Map();
    for (const { id, label } of TOOLS) {
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.setAttribute('aria-pressed', String(id === this.tool));
      btn.innerHTML = ICONS[id];
      btn.addEventListener('click', () => this._setTool(id));
      this._toolButtons.set(id, btn);
      bar.appendChild(btn);
    }

    bar.appendChild(el('div', 'divider'));

    const swatches = el('div', 'swatches');
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Draw color');
    this._swatchButtons = new Map();
    for (const { preset, label } of PALETTE) {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.setAttribute('aria-label', `Draw in ${label.toLowerCase()}`);
      b.title = label;
      b.style.background = resolveColor(preset);
      b.setAttribute('aria-pressed', String(preset === this.color));
      b.addEventListener('click', () => {
        this.color = preset;
        for (const [p, sb] of this._swatchButtons) sb.setAttribute('aria-pressed', String(p === preset));
      });
      this._swatchButtons.set(preset, b);
      swatches.appendChild(b);
    }
    bar.appendChild(swatches);

    bar.appendChild(el('div', 'divider'));

    const action = (icon, label, fn) => {
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.innerHTML = ICONS[icon];
      btn.addEventListener('click', fn);
      bar.appendChild(btn);
      return btn;
    };
    action('image', 'Attach image', () => this._imageInput.click());
    this._settingsBtn = action('grid', 'Grid settings', () => this._toggleSettings());
    this._settingsBtn.setAttribute('aria-expanded', 'false');
    // view toggles: token name plates (the touch path — Shift does the same
    // held) and the token pool area (registered in _screenButtons so
    // _applyUiState drives its pressed state alongside the column toggles)
    this._labelsBtn = action('label', 'Show token names', () => this._toggleLabels());
    this._labelsBtn.setAttribute('aria-pressed', 'false');
    const L = { ...SCREEN_LABELS, ...this.labels };
    const poolBtn = action('pool', L.pool, () => this._toggleArea('pool'));
    this._screenButtons.set('pool', poolBtn);
    action('download', 'Export map file', () => this._export());
    action('upload', 'Import map file', () => this._importInput.click());
    action('trash', 'Clear the map', () => this._clear());
    return bar;
  }

  // Pin the name plates on (the click alternative to holding Shift).
  _toggleLabels() {
    const on = !this.svg.hasAttribute('data-labels');
    this.svg.toggleAttribute('data-labels', on);
    this._labelsBtn.setAttribute('aria-pressed', String(on));
  }

  // ---- token pool ----------------------------------------------------------

  // Tabs: the encounter's Reserve (combatants added via <add-to-battle> but
  // not yet dropped on the map) first, then the page-provided `roster` Party /
  // Foes, then the built-in registry categories.
  _poolTabs() {
    const entry = (t, source) => ({
      name: t.name ?? 'Token',
      image: t.image ?? iconUrl(t),
      kind: t.kind === 'monster' ? 'monster' : 'player',
      size: t.size,
      hp: t.hp,
      ac: t.ac,
      initMod: t.initMod,
      source,
    });
    const tabs = [];
    // Reserve — place these existing combatants onto the map (poolId = node id)
    const reserve = reserveCombatants(this.store.doc).map((n) => ({
      name: n[EXT].name ?? 'Token',
      image: n.url,
      kind: n[EXT].tokenKind ?? 'player',
      source: 'reserve',
      poolId: n.id,
      // line-art vs photo display hint from the node's original source
      art: n[EXT].source === 'registry',
    }));
    if (reserve.length) tabs.push({ id: 'reserve', label: 'Reserve', entries: reserve });

    const players = this.roster.filter((t) => t.kind !== 'monster');
    const monsters = this.roster.filter((t) => t.kind === 'monster');
    if (players.length) tabs.push({ id: 'party', label: 'Party', entries: players.map((t) => entry(t, 'roster')) });
    if (monsters.length) {
      // "Foes", not "Monsters" — the registry has a Monsters category already
      tabs.push({ id: 'foes', label: 'Foes', entries: monsters.map((t) => entry(t, 'roster')) });
    }
    for (const cat of CATEGORIES) {
      tabs.push({
        id: cat.id,
        label: cat.label,
        entries: cat.icons.map((icon) =>
          entry({ name: icon.name, image: iconUrl(icon), kind: cat.id === 'monsters' ? 'monster' : 'player' }, 'registry'),
        ),
      });
    }
    return tabs;
  }

  _buildPool() {
    const pool = el('div', 'pool');
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Token sets');
    const avatars = el('div', 'avatars');

    const data = this._poolTabs();
    const select = (id) => {
      this._poolTab = id;
      for (const btn of tabs.children) btn.setAttribute('aria-selected', String(btn.dataset.tab === id));
      const tab = data.find((t) => t.id === id);
      avatars.replaceChildren();
      for (const tokenEntry of (tab?.entries ?? [])) {
        avatars.appendChild(this._buildAvatar(tokenEntry));
      }
    };

    for (const tab of data) {
      const btn = el('button', 'tab', tab.label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.dataset.tab = tab.id;
      btn.addEventListener('click', () => select(tab.id));
      tabs.appendChild(btn);
    }
    pool.append(tabs, avatars);
    // keep the current tab across rebuilds when it survives (e.g. Reserve
    // shrinks as tokens are placed but is still non-empty)
    const initial = data.find((t) => t.id === this._poolTab) ?? data[0];
    if (initial) select(initial.id);
    this._poolEl = pool;
    return pool;
  }

  // The Reserve tab reflects encounter state; rebuild the pool in place when
  // the document changes (a combatant added on the page, placed, or removed).
  _rebuildPool() {
    if (!this._poolEl?.isConnected) return;
    const next = this._buildPool();
    const prev = this._rootEl.querySelector('.pool');
    if (prev && prev !== next) prev.replaceWith(next);
  }

  _buildAvatar(entry) {
    const btn = el('button', 'avatar');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Place ${entry.name}`);
    btn.setAttribute('aria-pressed', 'false');
    btn.title = entry.name;
    const img = el('img');
    img.src = entry.image;
    img.alt = '';
    img.loading = 'lazy';
    if (entry.source !== 'registry' && !entry.art) img.classList.add('photo');
    btn.appendChild(img);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.tools.startPoolDrag(entry, e);
    });
    btn.addEventListener('click', () => {
      // a drag that ended on the map flags itself; that click is not a place
      if (btn.dataset.dragged) {
        delete btn.dataset.dragged;
        return;
      }
      // second click on the armed avatar disarms it
      if (this._placingBtn === btn) {
        this.tools.cancelActive();
        return;
      }
      if (this._placingBtn) this._placingBtn.setAttribute('aria-pressed', 'false');
      // set before arming: onPlacingChange fires synchronously from armPlacement
      this._placingBtn = btn;
      this.tools.armPlacement(entry);
    });
    return btn;
  }

  // ---- settings ------------------------------------------------------------

  _buildSettings() {
    const panel = el('div', 'settings');
    panel.hidden = true;
    panel.appendChild(el('h2', null, 'Grid'));

    const grid = () => getExt(this.store.doc).grid;
    const numberRow = (label, key, { min, max, step = 1, clamp } = {}) => {
      const id = `bm-set-${key}`;
      const lab = el('label', null, label);
      lab.setAttribute('for', id);
      const input = el('input');
      input.type = 'number';
      input.id = id;
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      input.step = step;
      input.addEventListener('change', () => {
        const raw = Number(input.value);
        const value = clamp ? clamp(raw) : Number.isFinite(raw) ? raw : grid()[key];
        grid()[key] = value;
        input.value = value;
        this._applyGrid();
      });
      panel.append(lab, input);
      return input;
    };
    const checkboxRow = (label, key) => {
      const id = `bm-set-${key}`;
      const lab = el('label', null, label);
      lab.setAttribute('for', id);
      const input = el('input');
      input.type = 'checkbox';
      input.id = id;
      input.addEventListener('change', () => {
        grid()[key] = input.checked;
        this._applyGrid();
      });
      panel.append(lab, input);
      return input;
    };

    this._settingsInputs = {
      cellSize: numberRow('Cell size', 'cellSize', { min: 8, max: 512, clamp: (v) => clampCellSize(v, grid().cellSize) }),
      offsetX: numberRow('Offset X', 'offsetX'),
      offsetY: numberRow('Offset Y', 'offsetY'),
      feetPerCell: numberRow('Feet per cell', 'feetPerCell', { min: 1, clamp: (v) => (Number.isFinite(v) && v > 0 ? v : 5) }),
      visible: checkboxRow('Show grid', 'visible'),
      snap: checkboxRow('Snap to grid', 'snap'),
    };
    this._settingsPanel = panel;
    return panel;
  }

  _toggleSettings(force) {
    const show = force ?? this._settingsPanel.hidden;
    this._settingsPanel.hidden = !show;
    this._settingsBtn.setAttribute('aria-expanded', String(show));
    if (show) this._syncSettingsInputs();
  }

  _syncSettingsInputs() {
    const grid = getExt(this.store.doc).grid;
    const i = this._settingsInputs;
    i.cellSize.value = grid.cellSize;
    i.offsetX.value = grid.offsetX;
    i.offsetY.value = grid.offsetY;
    i.feetPerCell.value = grid.feetPerCell;
    i.visible.checked = grid.visible;
    i.snap.checked = grid.snap;
  }

  _applyGrid() {
    updateGrid(this.refs, getExt(this.store.doc).grid);
    this._save();
  }

  // ---- tools wiring ----------------------------------------------------------

  _setTool(id) {
    this.tool = id;
    this.svg.setAttribute('data-tool', id);
    for (const [tid, btn] of this._toolButtons) btn.setAttribute('aria-pressed', String(tid === id));
  }

  _wireTools() {
    this.tools = attachTools({
      svg: this.svg,
      root: this.root,
      refs: this.refs,
      getDoc: () => this.store.doc,
      getGrid: () => getExt(this.store.doc).grid,
      getViewport: () => getExt(this.store.doc).viewport,
      setViewport: (vp) => {
        getExt(this.store.doc).viewport = vp;
        applyViewport(this.refs, vp);
      },
      commit: () => this._commit(),
      save: () => this._save(),
      getTool: () => this.tool,
      getColor: () => this.color,
      setStatus: (text) => this._setStatus(text),
      placeToken: (entry, wx, wy) => this._placeToken(entry, wx, wy),
      onPlacingChange: (entry) => {
        if (!entry && this._placingBtn) {
          this._placingBtn.setAttribute('aria-pressed', 'false');
          this._placingBtn = null;
        }
        if (entry && this._placingBtn) this._placingBtn.setAttribute('aria-pressed', 'true');
        this.svg.setAttribute('data-mode', entry ? 'placing' : 'idle');
      },
      onNodeClick: (id, x, y) => {
        // the card is for combatants; clicks on strokes/images just deselect
        if (nodeKind(getNode(this.store.doc, id)) === 'token') this._openCard(id, x, y);
        else this._closeCard();
      },
    });
    this._setTool(this.tool);
  }

  _placeToken(entry, wx, wy) {
    const grid = getExt(this.store.doc).grid;
    if (entry.poolId) {
      // Reserve entry: move the existing combatant node onto the map instead
      // of creating a new one (it already has stats, size, name, initiative).
      const node = this.store.doc.nodes.find((n) => n.id === entry.poolId);
      const span = node?.width || grid.cellSize;
      let x = wx - span / 2;
      let y = wy - span / 2;
      if (grid.snap) ({ x, y } = snapTokenOrigin(x, y, span, grid));
      placeCombatant(this.store.doc, entry.poolId, x, y);
      this._commit();
      return;
    }
    // creature size → footprint in grid cells (large 2×2, huge 3×3, ...)
    const size = grid.cellSize * cellsForSize(entry.size);
    let x = wx - size / 2;
    let y = wy - size / 2;
    if (grid.snap) ({ x, y } = snapTokenOrigin(x, y, size, grid));
    // Name duplicates like add-to-battle does: the first Wolf on the map is
    // "Wolf", the next gets a random adjective ("Reckless Wolf"). baseName is
    // kept so the next drop can tell they are the same type.
    const { displayName, adjective } = instanceName(this.store.doc, entry.name, entry.kind, {
      adjectives: getAdjectives(),
    });
    const token = makeToken({
      x,
      y,
      size,
      url: entry.image,
      name: displayName,
      source: entry.source,
      tokenKind: entry.kind,
      hp: entry.hp,
      hpMax: entry.hp,
      ac: entry.ac,
      initMod: entry.initMod,
    });
    token[EXT].baseName = entry.name;
    if (adjective) token[EXT].adjective = adjective;
    addNode(this.store.doc, token);
    this._commit();
  }

  // ---- doc plumbing ----------------------------------------------------------

  _syncFromDoc() {
    const ext = getExt(this.store.doc);
    updateGrid(this.refs, ext.grid);
    applyViewport(this.refs, ext.viewport);
    render(this.refs, this.store.doc);
    this._syncSettingsInputs();
  }

  _commit() {
    this.store.commit(); // rendering happens in _onStoreEvent
  }

  _save() {
    this.store.save();
  }

  // React to changes regardless of who made them — this overlay, the
  // initiative tracker, or another tab (full: the doc object was replaced).
  _onStoreEvent(e) {
    if (e.type === 'save-result') {
      this._reportSave(e.ok);
    } else if (e.full) {
      this._syncFromDoc();
      this._rebuildPool();
      this._closeCard(); // the doc was replaced wholesale — the node ref is gone
    } else {
      render(this.refs, this.store.doc);
      this._rebuildPool();
      this._refreshCard();
    }
  }

  _setStatus(text) {
    this._status.classList.remove('warn');
    this._status.textContent = text;
  }

  _reportSave(ok) {
    if (!ok) {
      this._status.classList.add('warn');
      this._status.textContent = 'Autosave failed (storage full or unavailable) - use Export to keep this map';
    } else if (this._status.classList.contains('warn')) {
      this._setStatus('');
    }
  }

  // ---- persistence actions ---------------------------------------------------

  _export() {
    const blob = new Blob([serialize(this.store.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'battle-map.canvas';
    this.root.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async _import(file) {
    try {
      const res = validateCanvas(JSON.parse(await file.text()));
      if (!res.ok) {
        this._setStatus(`Import failed: ${res.error}`);
        return;
      }
      this.store.setDoc(res.doc); // notifies full: re-syncs this overlay too
      this._setStatus('Map imported');
    } catch {
      this._setStatus('Import failed: not a JSON Canvas file');
    }
  }

  _clear() {
    if (!window.confirm('Clear the battle mat? Tokens, drawings and images will be removed.')) return;
    const ext = getExt(this.store.doc);
    const next = emptyDoc();
    // keep the grid/viewport the user has dialed in; only the content clears
    next[EXT] = ext;
    this.store.setDoc(next);
  }

  _buildFileInputs(rootEl) {
    this._imageInput = el('input');
    this._imageInput.type = 'file';
    this._imageInput.accept = 'image/*';
    this._imageInput.hidden = true;
    this._imageInput.addEventListener('change', () => {
      const file = this._imageInput.files[0];
      if (file) this._attachImageFile(file);
      this._imageInput.value = '';
    });

    this._importInput = el('input');
    this._importInput.type = 'file';
    this._importInput.accept = '.canvas,application/json';
    this._importInput.hidden = true;
    this._importInput.addEventListener('change', () => {
      const file = this._importInput.files[0];
      if (file) this._import(file);
      this._importInput.value = '';
    });
    rootEl.append(this._imageInput, this._importInput);
  }

  _wireImageDrop() {
    this.svg.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.svg.addEventListener('drop', (e) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      const r = this.svg.getBoundingClientRect();
      const vp = getExt(this.store.doc).viewport;
      const wx = (e.clientX - r.left) / vp.zoom + vp.x;
      const wy = (e.clientY - r.top) / vp.zoom + vp.y;
      this._attachImageFile(file, { x: wx, y: wy });
    });
  }

  // Read an image file, downscale to MAX_IMAGE_DIM if needed (data URIs live
  // in localStorage, where a full-size photo would blow the quota), and add
  // it centered on `at` (world coords) or the current viewport center.
  _attachImageFile(file, at) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        let url = reader.result;
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
        if (scale < 1) {
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          url = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85);
        }
        let center = at;
        if (!center) {
          const r = this.svg.getBoundingClientRect();
          const vp = getExt(this.store.doc).viewport;
          center = { x: vp.x + r.width / 2 / vp.zoom, y: vp.y + r.height / 2 / vp.zoom };
        }
        addNode(this.store.doc, makeImage({ x: center.x - width / 2, y: center.y - height / 2, width, height, url }));
        this._commit();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---- keyboard ----------------------------------------------------------------

  _onKeydown(e) {
    // The dice overlay can be stacked above this screen (its own top-layer
    // popover with its own document-level Escape/Tab handling and focus
    // trap). While focus is inside it, key events retarget to its host — not
    // ours — so leave those keys to it instead of double-handling (an Escape
    // meant for the dice would otherwise close this screen too).
    if (
      e.target !== this.host &&
      e.target !== document.body &&
      e.target !== document.documentElement &&
      !this.host.contains(e.target)
    ) {
      return;
    }
    if (e.key === 'Escape') {
      // cancel the in-flight interaction first; close only from a quiet state
      if (this.tools.cancelActive()) {
        e.stopPropagation();
        return;
      }
      if (this._card) {
        this._closeCard();
        e.stopPropagation();
        return;
      }
      if (!this._settingsPanel.hidden) {
        this._toggleSettings(false);
        this._settingsBtn.focus();
        e.stopPropagation();
        return;
      }
      this.close();
      e.stopPropagation();
    } else if (e.key === 'Tab') {
      this._trapFocus(e);
    }
  }

  // Cycle focus among the overlay's interactive elements (buttons and inputs
  // both — the settings panel has number inputs and checkboxes).
  _trapFocus(e) {
    const focusables = [...this.root.querySelectorAll('button, input:not([hidden])')].filter(
      (n) => !n.disabled && n.getClientRects().length > 0,
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.root.activeElement;
    if (e.shiftKey && active === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    } else if (!active) {
      first.focus();
      e.preventDefault();
    }
  }
}

let sharedOverlay = null;

export function getOverlay() {
  if (!sharedOverlay) sharedOverlay = new BattleMatOverlay();
  return sharedOverlay;
}

export function openBattleMat(opts) {
  getOverlay().open(opts);
}
