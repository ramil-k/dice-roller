// Initiative tracker panel — the lazily-loaded half of <initiative-tracker>.
// Renders the combatant list from the shared encounter store (the same JSON
// Canvas document <battle-mat> edits) and writes initiative/turn state back
// through it, so the mat and the tracker stay in sync in both directions,
// including across tabs.
//
// Per row: kind-colored dot, name, editable HP (with /max hint), editable AC,
// editable initiative, and — when the page has the <roll-dice> component
// loaded — a compact 1d20±mod roll chip that fills the initiative in.
// Combat stats live on the token nodes (combat.js), so they ride along with
// map exports and cross-tab sync for free.

import { el } from './dom.js';
import { EXT, getExt, resolveColor } from './canvas-doc.js';
import { getStore, DEFAULT_KEY } from './store.js';
import {
  turnOrder,
  getInitiative,
  setInitiative,
  getHp,
  getHpMax,
  setHp,
  getAc,
  setAc,
  getInitMod,
  nextTurn,
  resetCombat,
  removeCombatant,
  renameCombatant,
} from './combat.js';

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
    gap: 0.45em;
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
  .trk-list li.active input.name { font-weight: 700; }

  .trk-list input {
    flex: 0 0 auto;
    width: 2.7rem;
    font: inherit;
    text-align: center;
    color: var(--bm-trk-fg);
    background: color-mix(in srgb, var(--bm-trk-fg) 7%, transparent);
    border: 1px solid var(--bm-trk-edge);
    border-radius: 0.4rem;
    padding: 0.15rem 0.25rem;
  }
  /* the name field reads as plain text (transparent chrome, left-aligned, wide)
     and only reveals its edit affordance on hover/focus */
  .trk-list input.name {
    flex: 1 1 12rem;
    min-width: 6rem;
    width: auto;
    text-align: left;
    text-overflow: ellipsis;
    background: transparent;
    border-color: transparent;
  }
  .trk-list input.name:hover { background: color-mix(in srgb, var(--bm-trk-fg) 7%, transparent); }
  .trk-list input.name:focus {
    background: color-mix(in srgb, var(--bm-trk-fg) 7%, transparent);
    border-color: var(--bm-trk-edge);
  }
  .trk-list input::placeholder { color: color-mix(in srgb, var(--bm-trk-muted) 65%, transparent); font-size: 0.85em; }
  .trk-list input:focus-visible { outline: 2px solid var(--bm-trk-accent); outline-offset: 1px; }

  .hp-wrap { display: inline-flex; align-items: baseline; gap: 0.15em; flex: 0 0 auto; }
  .hp-max { color: var(--bm-trk-muted); font-size: 0.8em; font-variant-numeric: tabular-nums; }

  .init-wrap { display: inline-flex; align-items: center; gap: 0.25em; flex: 0 0 auto; }
  .init-wrap roll-dice { font-size: 0.78rem; }
  roll-dice:not(:defined) { display: none; }

  .trk-remove {
    flex: 0 0 auto;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border: none;
    border-radius: 0.3rem;
    background: transparent;
    color: var(--bm-trk-muted);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
  }
  .trk-remove:hover { color: var(--bm-trk-accent); background: color-mix(in srgb, var(--bm-trk-accent) 14%, transparent); }
  .trk-remove:focus-visible { outline: 2px solid var(--bm-trk-accent); outline-offset: 1px; }

  .trk-empty { padding: 0.9rem; color: var(--bm-trk-muted); }
`;

const KIND_COLOR = { player: '#4a9e6f', monster: '#cf5a5a' };

export const DEFAULT_LABELS = {
  title: 'Initiative',
  round: 'Round',
  next: 'Next',
  reset: 'Reset',
  empty: 'No tokens on the battle mat yet.',
  name: 'Name',
  hp: 'HP',
  ac: 'AC',
  init: 'Init',
  remove: 'Remove from battle',
};

// Build the tracker UI inside `container` (the widget's panel element, in the
// host element's shadow root). Returns { dispose } — unsubscribes and empties
// the container. `labels` overrides DEFAULT_LABELS (localization).
export function buildTracker(container, { storageKey = DEFAULT_KEY, labels = {} } = {}) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const store = getStore(storageKey);
  const root = container.getRootNode();
  if (!root.querySelector('style[data-trk]')) {
    const style = document.createElement('style');
    style.dataset.trk = '';
    style.textContent = PANEL_CSS;
    root.appendChild(style);
  }

  const head = el('div', 'trk-head');
  head.appendChild(el('span', null, L.title));
  const round = el('span', 'round');
  const nextBtn = el('button', 'next', L.next);
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', L.next);
  nextBtn.addEventListener('click', () => {
    nextTurn(store.doc);
    store.commit();
  });
  const resetBtn = el('button', null, L.reset);
  resetBtn.type = 'button';
  resetBtn.setAttribute('aria-label', L.reset);
  resetBtn.addEventListener('click', () => {
    resetCombat(store.doc);
    store.commit();
  });
  head.append(round, nextBtn, resetBtn);

  const list = el('ol', 'trk-list');
  list.setAttribute('aria-label', L.title);
  const empty = el('div', 'trk-empty', L.empty);
  container.append(head, list, empty);

  const FIELD_SET = { init: setInitiative, hp: setHp, ac: setAc };

  function render() {
    const doc = store.doc;
    const combat = getExt(doc).combat;
    round.textContent = `${L.round} ${combat.round}`;

    // Rebuilding the list destroys the focused input, throwing focus out of
    // the panel mid data entry (type a value, Tab to the next field — the
    // commit re-sorts and rebuilds). Remember which combatant's input had
    // focus and restore it onto the rebuilt row.
    const focusedId = root.activeElement?.dataset?.nodeId ?? null;
    const focusedField = root.activeElement?.dataset?.field ?? null;

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

      // editable name — a text input styled to read as plain text until focused
      const name = el('input', 'name');
      name.type = 'text';
      name.value = node[EXT].name || '';
      name.dataset.nodeId = node.id;
      name.dataset.field = 'name';
      name.setAttribute('aria-label', `${L.name}: ${node[EXT].name || 'token'}`);
      name.title = node[EXT].name || '';
      name.addEventListener('change', () => {
        renameCombatant(store.doc, node.id, name.value);
        store.commit();
        setTimeout(render, 0);
      });

      const input = (field, value, label) => {
        const inp = el('input');
        inp.type = 'number';
        inp.dataset.nodeId = node.id;
        inp.dataset.field = field;
        inp.placeholder = label;
        inp.setAttribute('aria-label', `${label}: ${node[EXT].name || 'token'}`);
        inp.value = value ?? '';
        inp.addEventListener('change', () => {
          FIELD_SET[field](store.doc, node.id, inp.value);
          store.commit();
          // The subscriber skips renders while a row input is focused (this
          // one still has focus while `change` fires), so re-sort explicitly —
          // but only after the browser finishes moving focus: a synchronous
          // rebuild here would destroy the input a Tab press is about to land
          // on, throwing focus out of the panel. Deferred, render() sees the
          // real destination and restores focus onto the rebuilt row.
          setTimeout(render, 0);
        });
        return inp;
      };

      const hpWrap = el('span', 'hp-wrap');
      hpWrap.appendChild(input('hp', getHp(node), L.hp));
      const max = getHpMax(node);
      if (max !== null) hpWrap.appendChild(el('span', 'hp-max', `/${max}`));

      const initWrap = el('span', 'init-wrap');
      // the roll chip only materializes when the page loaded <roll-dice>;
      // an undefined element is display:none'd by the panel CSS either way
      const mod = getInitMod(node);
      const chip = document.createElement('roll-dice');
      chip.setAttribute('compact', '');
      chip.textContent = mod ? `1d20${mod > 0 ? '+' : ''}${mod}` : '1d20';
      chip.addEventListener('roll', (e) => {
        setInitiative(store.doc, node.id, e.detail.total);
        store.commit();
        setTimeout(render, 0);
      });
      initWrap.append(chip, input('init', getInitiative(node), L.init));

      const remove = el('button', 'trk-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${L.remove}: ${node[EXT].name || 'token'}`);
      remove.title = L.remove;
      remove.addEventListener('click', () => {
        removeCombatant(store.doc, node.id);
        store.commit();
        render();
      });

      row.append(dot, name, hpWrap, input('ac', getAc(node), L.ac), initWrap, remove);
      list.appendChild(row);
    }
    if (focusedId !== null && focusedField !== null) {
      const inp = list.querySelector(
        `input[data-node-id="${CSS.escape(focusedId)}"][data-field="${CSS.escape(focusedField)}"]`,
      );
      // select(), matching what tabbing into an input does natively
      inp?.focus();
      inp?.select();
    }
  }

  // Any change — this panel, the mat, another tab — redraws the list, except
  // while a row input has focus (a mid-typing mat autosave in another
  // component must not eat the keystrokes; inputs commit on change).
  // Deferred, because our own commits arrive mid focus transition (Tab fires
  // `change` while focus is between elements, so the guard reads null): a
  // synchronous rebuild would remove the focused input without a blur and
  // strand both focus and the in-flight Tab on <body>. One timeout later the
  // transition is done and the guard sees the true active element.
  const unsubscribe = store.subscribe((e) => {
    if (e.type !== 'change') return;
    setTimeout(() => {
      if (root.activeElement?.dataset?.field) return;
      render();
    }, 0);
  });
  render();

  return {
    dispose() {
      unsubscribe();
      container.replaceChildren();
    },
  };
}
