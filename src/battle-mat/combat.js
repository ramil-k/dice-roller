// Initiative / turn logic shared by the tracker (and, later, the mat).
// Combatants are the token nodes of the shared JSON Canvas document; their
// initiative lives in the node's x-battleMat extension, the round counter
// and active combatant in the document-level extension (getExt().combat).
// Turn order is always computed from initiatives — deleting a token on the
// mat drops it from the tracker automatically, with no order list to repair.
//
// DOM-free; covered by test/battle-mat-combat.test.js.

import { EXT, getExt, nodeKind, getNode } from './canvas-doc.js';

export function combatants(doc) {
  return doc.nodes.filter((n) => nodeKind(n) === 'token');
}

// Numeric combat fields live on the token's extension; a cleared input ('')
// must clear the field, not become Number('') === 0.
function getField(node, prop) {
  const v = node[EXT]?.[prop];
  return Number.isFinite(v) ? v : null;
}

function setField(doc, id, prop, value) {
  const node = getNode(doc, id);
  if (!node || nodeKind(node) !== 'token') return false;
  const v = value === '' || value === null || value === undefined ? NaN : Number(value);
  if (Number.isFinite(v)) node[EXT][prop] = v;
  else delete node[EXT][prop];
  return true;
}

export function getInitiative(node) {
  return getField(node, 'initiative');
}

export function setInitiative(doc, id, value) {
  return setField(doc, id, 'initiative', value);
}

export function getHp(node) {
  return getField(node, 'hp');
}

export function getHpMax(node) {
  return getField(node, 'hpMax');
}

export function setHp(doc, id, value) {
  return setField(doc, id, 'hp', value);
}

export function getAc(node) {
  return getField(node, 'ac');
}

export function setAc(doc, id, value) {
  return setField(doc, id, 'ac', value);
}

export function getInitMod(node) {
  return getField(node, 'initMod');
}

// Turn order: initiative descending; combatants without an initiative sink to
// the bottom. Ties break by name, then id, so the order is stable across
// renders and tabs.
export function turnOrder(doc) {
  return [...combatants(doc)].sort((a, b) => {
    const ia = getInitiative(a);
    const ib = getInitiative(b);
    if (ia !== ib) {
      if (ia === null) return 1;
      if (ib === null) return -1;
      return ib - ia;
    }
    const na = a[EXT].name ?? '';
    const nb = b[EXT].name ?? '';
    return na.localeCompare(nb) || a.id.localeCompare(b.id);
  });
}

// Advance to the next combatant; wrapping past the end starts a new round.
// With no active combatant (fresh doc, or the active token was deleted) the
// turn goes to the top of the order without touching the round.
export function nextTurn(doc) {
  const order = turnOrder(doc);
  if (!order.length) return null;
  const combat = getExt(doc).combat;
  const idx = order.findIndex((n) => n.id === combat.activeNodeId);
  if (idx === -1) {
    combat.activeNodeId = order[0].id;
  } else if (idx === order.length - 1) {
    combat.activeNodeId = order[0].id;
    combat.round += 1;
  } else {
    combat.activeNodeId = order[idx + 1].id;
  }
  return getNode(doc, combat.activeNodeId);
}

// Back to round 1 with nobody active (initiatives are kept — reset the
// encounter's progress, not its rolls).
export function resetCombat(doc) {
  const combat = getExt(doc).combat;
  combat.round = 1;
  combat.activeNodeId = null;
}
