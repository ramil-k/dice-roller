// Initiative tracker panel — the lazily-loaded half of <initiative-tracker>.
// Renders the combatant list from the shared encounter store (the same JSON
// Canvas document <battle-mat> edits) and writes initiative/turn state back
// through it, so the mat and the tracker stay in sync in both directions,
// including across tabs.

import { el } from './dom.js';
import { EXT, getExt, resolveColor } from './canvas-doc.js';
import { getStore, DEFAULT_KEY } from './store.js';
import { turnOrder, getInitiative, setInitiative, nextTurn, resetCombat } from './combat.js';

const PANEL_CSS = `
  .trk-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid color-mix(in srgb, var(--bm-trk-edge) 55%, transparent);
    font-weight: 700;
  }
  .trk-head .round {
    margin-left: auto;
    color: var(--bm-trk-muted);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .trk-head button {
    font: inherit;
    font-weight: 600;
    font-size: 0.8em;
    padding: 0.25em 0.7em;
    border: 1px solid var(--bm-trk-edge);
    border-radius: 0.45em;
    background: transparent;
    color: var(--bm-trk-muted);
    cursor: pointer;
  }
  .trk-head button:hover { color: var(--bm-trk-fg); background: color-mix(in srgb, var(--bm-trk-fg) 10%, transparent); }
  .trk-head button:focus-visible { outline: 2px solid var(--bm-trk-accent); outline-offset: 2px; }
  .trk-head .next { color: var(--bm-trk-fg); border-color: var(--bm-trk-accent); }

  .trk-list {
    margin: 0;
    padding: 0.35rem 0;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .trk-list li {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.3rem 0.8rem;
  }
  .trk-list li.active {
    background: color-mix(in srgb, var(--bm-trk-accent) 14%, transparent);
    box-shadow: inset 3px 0 0 var(--bm-trk-accent);
  }
  .trk-list .dot {
    flex: 0 0 auto;
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
  }
  .trk-list .name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trk-list li.active .name { font-weight: 700; }
  .trk-list .init {
    flex: 0 0 auto;
    width: 3.2rem;
    font: inherit;
    text-align: center;
    color: var(--bm-trk-fg);
    background: color-mix(in srgb, var(--bm-trk-fg) 7%, transparent);
    border: 1px solid var(--bm-trk-edge);
    border-radius: 0.4rem;
    padding: 0.15rem 0.25rem;
  }
  .trk-list .init:focus-visible { outline: 2px solid var(--bm-trk-accent); outline-offset: 1px; }
  .trk-empty { padding: 0.9rem; color: var(--bm-trk-muted); }
`;

const KIND_COLOR = { player: '#4a9e6f', monster: '#cf5a5a' };

// Build the tracker UI inside `container` (the widget's panel element, in the
// host element's shadow root). Returns { dispose } — unsubscribes and empties
// the container.
export function buildTracker(container, { storageKey = DEFAULT_KEY } = {}) {
  const store = getStore(storageKey);
  const root = container.getRootNode();
  if (!root.querySelector('style[data-trk]')) {
    const style = document.createElement('style');
    style.dataset.trk = '';
    style.textContent = PANEL_CSS;
    root.appendChild(style);
  }

  const head = el('div', 'trk-head');
  head.appendChild(el('span', null, 'Initiative'));
  const round = el('span', 'round');
  const nextBtn = el('button', 'next', 'Next');
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next turn');
  nextBtn.addEventListener('click', () => {
    nextTurn(store.doc);
    store.commit();
  });
  const resetBtn = el('button', null, 'Reset');
  resetBtn.type = 'button';
  resetBtn.setAttribute('aria-label', 'Reset combat to round one');
  resetBtn.addEventListener('click', () => {
    resetCombat(store.doc);
    store.commit();
  });
  head.append(round, nextBtn, resetBtn);

  const list = el('ol', 'trk-list');
  list.setAttribute('aria-label', 'Turn order');
  const empty = el('div', 'trk-empty', 'No tokens on the battle mat yet.');
  container.append(head, list, empty);

  function render() {
    const doc = store.doc;
    const combat = getExt(doc).combat;
    round.textContent = `Round ${combat.round}`;

    const order = turnOrder(doc);
    empty.hidden = order.length > 0;
    list.replaceChildren();
    for (const node of order) {
      const row = el('li');
      row.classList.toggle('active', node.id === combat.activeNodeId);
      const dot = el('span', 'dot');
      dot.style.background = node.color
        ? resolveColor(node.color)
        : KIND_COLOR[node[EXT].tokenKind] ?? KIND_COLOR.player;
      const name = el('span', 'name', node[EXT].name || 'Token');
      const init = el('input', 'init');
      init.type = 'number';
      init.setAttribute('aria-label', `Initiative for ${node[EXT].name || 'token'}`);
      init.value = getInitiative(node) ?? '';
      init.addEventListener('change', () => {
        setInitiative(store.doc, node.id, init.value);
        store.commit();
        // the subscriber skips renders while an init input is focused (Enter
        // keeps focus), so re-sort explicitly after committing our own edit
        render();
      });
      row.append(dot, name, init);
      list.appendChild(row);
    }
  }

  // Any change — this panel, the mat, another tab — redraws the list, except
  // while an initiative input has focus (a mid-typing mat autosave in another
  // component must not eat the keystrokes; the input commits on change).
  const unsubscribe = store.subscribe((e) => {
    if (e.type !== 'change') return;
    if (root.activeElement?.classList?.contains('init')) return;
    render();
  });
  render();

  return {
    dispose() {
      unsubscribe();
      container.replaceChildren();
    },
  };
}
