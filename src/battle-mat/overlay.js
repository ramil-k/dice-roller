// The battle-mat overlay: a full-viewport top-layer surface hosting the map
// svg, the token pool, the toolbar and the grid settings. Mirrors the
// DiceOverlay architecture in roll-dice.js — a detached host element with its
// own shadow root, promoted into the top layer via the Popover API where
// available, with a fixed-position + max-z-index fallback elsewhere.
//
// One shared instance exists at a time (getOverlay()); <battle-mat> triggers
// call openBattleMat() from a dynamic import so none of this loads until the
// first open.

import { el, svgEl } from './dom.js';
import { ICONS } from './icons.js';
import {
  emptyDoc,
  getExt,
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
import { CATEGORIES, iconUrl } from './registry.js';
import { buildScene, render, applyViewport, updateGrid } from './view.js';
import { attachTools } from './tools.js';

const MAX_IMAGE_DIM = 2048; // attached images are downscaled to fit (quota)

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

  .mat-root { position: absolute; inset: 0; background: var(--bm-bg); animation: bm-fade 0.15s ease; }
  @keyframes bm-fade { from { opacity: 0; } }

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

  /* --- token pool ---------------------------------------------------------- */
  .pool {
    position: absolute;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(46rem, calc(100vw - 8rem));
    background: var(--bm-surface);
    border: 1px solid var(--bm-edge);
    border-radius: 0.8rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
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
  .pool .tab:focus-visible, .avatar:focus-visible, .toolbar button:focus-visible,
  .swatch:focus-visible, .close:focus-visible, .settings :focus-visible {
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

  /* --- toolbar ------------------------------------------------------------- */
  .toolbar {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    background: var(--bm-surface);
    border: 1px solid var(--bm-edge);
    border-radius: 0.8rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    padding: 0.4rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
  }
  .toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: none;
    border-radius: 0.55rem;
    background: transparent;
    color: var(--bm-muted);
    cursor: pointer;
  }
  .toolbar button:hover { color: var(--bm-fg); background: rgb(from var(--bm-fg) r g b / 0.08); }
  .toolbar button[aria-pressed="true"], .toolbar button[aria-expanded="true"] {
    color: var(--bm-bg);
    background: var(--bm-accent);
  }
  .toolbar .icon { width: 1.35rem; height: 1.35rem; }
  .toolbar .divider { height: 1px; margin: 0.25rem 0.3rem; background: var(--bm-edge); }
  .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; padding: 0.15rem 0.45rem; }
  /* .toolbar button sets 2.5rem sizing; swatches need their own (specificity) */
  .toolbar button.swatch {
    width: 0.95rem;
    height: 0.95rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
  }
  .toolbar button.swatch[aria-pressed="true"] { border-color: var(--bm-fg); }

  /* --- settings panel ------------------------------------------------------ */
  /* the display:grid below would defeat the hidden attribute without this */
  .settings[hidden] { display: none; }
  .settings {
    position: absolute;
    left: 4.25rem;
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
  .close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border: 1px solid var(--bm-edge);
    border-radius: 50%;
    background: var(--bm-surface);
    color: var(--bm-muted);
    cursor: pointer;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }
  .close:hover { color: var(--bm-fg); }
  .close .icon { width: 1.3rem; height: 1.3rem; }
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

  open({ opener, roster = [], storageKey = DEFAULT_KEY } = {}) {
    this.opener = opener ?? null;
    this.roster = roster;
    this.storageKey = storageKey;
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
    this._toolButtons.get('select').focus();
  }

  close() {
    this.tools?.detach();
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
  }

  // ---- shell ---------------------------------------------------------------

  _buildShell() {
    for (const child of Array.from(this.root.children)) {
      if (child.tagName !== 'STYLE') child.remove();
    }

    const rootEl = el('div', 'mat-root');
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', 'Battle map');

    this.svg = svgEl('svg', { class: 'mat' });
    this.refs = buildScene(this.svg);
    rootEl.appendChild(this.svg);

    this._status = el('div', 'status');
    this._status.setAttribute('aria-live', 'polite');

    rootEl.append(this._buildToolbar(), this._buildSettings(), this._buildPool(), this._status, this._buildClose());
    this._buildFileInputs(rootEl);
    this.root.appendChild(rootEl);
    this._rootEl = rootEl;

    this._wireTools();
    this._wireImageDrop();
  }

  _buildClose() {
    const btn = el('button', 'close');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close battle mat');
    btn.innerHTML = ICONS.close;
    btn.addEventListener('click', () => this.close());
    return btn;
  }

  _buildToolbar() {
    const bar = el('div', 'toolbar');
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
    action('download', 'Export map file', () => this._export());
    action('upload', 'Import map file', () => this._importInput.click());
    action('trash', 'Clear the map', () => this._clear());
    return bar;
  }

  // ---- token pool ----------------------------------------------------------

  // Tabs: page-provided `roster` Party / Foes first, then the built-in
  // registry categories. (Content pages add combatants straight to the
  // encounter via <add-to-battle>; this pool is for ad-hoc extra tokens.)
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
      for (const btn of tabs.children) btn.setAttribute('aria-selected', String(btn.dataset.tab === id));
      const tab = data.find((t) => t.id === id);
      avatars.replaceChildren();
      for (const tokenEntry of tab.entries) {
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
    if (data.length) select(data[0].id);
    return pool;
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
    });
    this._setTool(this.tool);
  }

  _placeToken(entry, wx, wy) {
    const grid = getExt(this.store.doc).grid;
    // creature size → footprint in grid cells (large 2×2, huge 3×3, ...)
    const size = grid.cellSize * cellsForSize(entry.size);
    let x = wx - size / 2;
    let y = wy - size / 2;
    if (grid.snap) ({ x, y } = snapTokenOrigin(x, y, size, grid));
    addNode(
      this.store.doc,
      makeToken({
        x,
        y,
        size,
        url: entry.image,
        name: entry.name,
        source: entry.source,
        tokenKind: entry.kind,
        hp: entry.hp,
        hpMax: entry.hp,
        ac: entry.ac,
        initMod: entry.initMod,
      }),
    );
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
    } else {
      render(this.refs, this.store.doc);
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
    if (e.key === 'Escape') {
      // cancel the in-flight interaction first; close only from a quiet state
      if (this.tools.cancelActive()) {
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
