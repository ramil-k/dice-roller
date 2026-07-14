// Initiative / turn logic shared by the tracker (and, later, the mat).
// Combatants are the token nodes of the shared JSON Canvas document; their
// initiative lives in the node's x-battleMat extension, the round counter
// and active combatant in the document-level extension (getExt().combat).
// Turn order is always computed from initiatives — deleting a token on the
// mat drops it from the tracker automatically, with no order list to repair.
//
// DOM-free; covered by test/battle-mat-combat.test.js.

import { EXT, getExt, nodeKind, getNode, addNode, removeNode, makeToken, cellsForSize } from './canvas-doc.js';

export function combatants(doc) {
  return doc.nodes.filter((n) => nodeKind(n) === 'token');
}

// The base name of a combatant is its display name with the instance
// adjective (if any) stripped back off, so "Reckless Wolf" and "Wolf" count
// as the same type. We store the base name explicitly so this never has to
// guess; older tokens without it fall back to the full name.
export function baseNameOf(node) {
  return node[EXT]?.baseName ?? node[EXT]?.name ?? '';
}

// How many combatants of a given type (base name + kind) are already in the
// encounter — drives the <add-to-battle> instance badge and the naming below.
export function countOfType(doc, baseName, kind = 'player') {
  return combatants(doc).filter(
    (n) => baseNameOf(n) === baseName && (n[EXT].tokenKind ?? 'player') === kind,
  ).length;
}

// Add one combatant to the encounter as a token node, and return it. The
// first instance of a type keeps the plain name; the second and later ones
// get a random unused adjective ("Reckless Wolf"), falling back to a numeric
// suffix once the adjective list (or the absence of one) runs dry. New tokens
// are stacked near the top-left of the map with a small per-instance offset so
// the DM can fan them out; combat stats and size ride along.
//
// `rand` is injectable for deterministic tests (defaults to Math.random).
export function addCombatant(
  doc,
  { name = 'Token', kind = 'player', image, size, hp, ac, initMod } = {},
  { adjectives = [], cellSize = 64, rand = Math.random } = {},
) {
  const baseName = name;
  const tokenKind = kind === 'monster' ? 'monster' : 'player';
  const siblings = combatants(doc).filter(
    (n) => baseNameOf(n) === baseName && (n[EXT].tokenKind ?? 'player') === tokenKind,
  );

  let displayName = baseName;
  let adjective = null;
  if (siblings.length) {
    const used = new Set(siblings.map((n) => n[EXT].adjective).filter(Boolean));
    const free = adjectives.filter((a) => !used.has(a));
    if (free.length) {
      adjective = free[Math.floor(rand() * free.length)];
      displayName = `${adjective} ${baseName}`;
    } else {
      displayName = `${baseName} ${siblings.length + 1}`;
    }
  }

  const span = cellSize * cellsForSize(size);
  // stack new arrivals down-right from the corner, one grid step per existing
  // token, wrapping so a big encounter doesn't march off the bottom
  const n = combatants(doc).length;
  const perRow = 8;
  const x = cellSize + (n % perRow) * cellSize;
  const y = cellSize + Math.floor(n / perRow) * cellSize;

  const token = makeToken({
    x,
    y,
    size: span,
    url: image,
    name: displayName,
    source: 'roster',
    tokenKind,
    hp: hp == null ? undefined : Number(hp),
    hpMax: hp == null ? undefined : Number(hp),
    ac: ac == null ? undefined : Number(ac),
    initMod: initMod == null ? undefined : Number(initMod),
  });
  // remember what we need to keep instance naming stable across later adds
  token[EXT].baseName = baseName;
  if (adjective) token[EXT].adjective = adjective;
  addNode(doc, token);
  return token;
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

// Remove a combatant token entirely (from the tracker and the map). If it was
// the active combatant, clear the turn pointer so it doesn't dangle — nextTurn
// then resumes from the top of the order.
export function removeCombatant(doc, id) {
  const combat = getExt(doc).combat;
  if (combat.activeNodeId === id) combat.activeNodeId = null;
  return removeNode(doc, id);
}
