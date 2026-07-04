// Pure dice logic: parsing and rolling. No DOM — safe to import in Node/Vitest.
//
// Supported formula syntax (standard RPG notation):
//   NdM            e.g. 2d6          roll N dice with M sides
//   dM             e.g. d20          implicit count of 1
//   +K / -K        e.g. 2d6+3        flat modifiers
//   multiple terms e.g. 1d8+1d6+2
//   keep/drop      khX klX dhX dlX   e.g. 4d6kh3 (keep 3 highest),
//                                         2d20kl1 (disadvantage)

// A single term: an optional sign, then either `NdM(keep)` or a flat number.
//   group 1: sign            (+ | - | '')
//   group 2: count           (digits | '')       — dice term only
//   group 3: sides           (digits)            — dice term only
//   group 4: keep/drop spec  (kh3 | kl1 | ...)   — dice term only
//   group 5: flat modifier   (digits)            — modifier term only
const TERM_RE = /([+-]?)\s*(?:(\d*)d(\d+)((?:k[hl]|d[hl])\d+)?|(\d+))/gi;

const MAX_COUNT = 100; // guard against absurd dice pools
const MAX_SIDES = 1000;

// Parse a formula string into a structured, immutable-ish description.
// Throws Error with a human-readable message on invalid input.
export function parseFormula(input) {
  const str = (input ?? '').trim();
  if (!str) throw new Error('Empty formula');

  // Reject any character that isn't part of the grammar early, so garbage
  // like "2d6; drop table" fails loudly instead of parsing partially.
  if (!/^[\s\d+\-dkhl]+$/i.test(str)) {
    throw new Error('Formula contains unsupported characters');
  }

  const terms = [];
  let match;
  let consumed = 0;
  TERM_RE.lastIndex = 0;
  while ((match = TERM_RE.exec(str)) !== null) {
    // Ensure the matches are contiguous (no unparsed gaps).
    const gap = str.slice(consumed, match.index).trim();
    if (gap) throw new Error(`Unexpected "${gap}" in formula`);
    consumed = TERM_RE.lastIndex;

    const sign = match[1] === '-' ? -1 : 1;

    if (match[3] !== undefined) {
      // Dice term.
      const count = match[2] === '' ? 1 : parseInt(match[2], 10);
      const sides = parseInt(match[3], 10);
      if (count < 1 || count > MAX_COUNT) {
        throw new Error(`Dice count must be 1–${MAX_COUNT}`);
      }
      if (sides < 2 || sides > MAX_SIDES) {
        throw new Error(`Dice sides must be 2–${MAX_SIDES}`);
      }
      let keep = null;
      if (match[4]) {
        const mode = match[4].slice(0, 2).toLowerCase(); // kh|kl|dh|dl
        const n = parseInt(match[4].slice(2), 10);
        if (n < 1 || n > count) {
          throw new Error(`keep/drop count must be 1–${count}`);
        }
        keep = { mode, n };
      }
      terms.push({ type: 'dice', sign, count, sides, keep });
    } else {
      // Flat modifier term.
      terms.push({ type: 'mod', sign, value: parseInt(match[5], 10) });
    }
  }

  if (str.slice(consumed).trim()) {
    throw new Error(`Unexpected "${str.slice(consumed).trim()}" in formula`);
  }
  if (!terms.length) throw new Error('No dice or modifiers found');
  if (!terms.some((t) => t.type === 'dice')) {
    throw new Error('Formula must contain at least one die');
  }

  return {
    terms,
    toString() {
      return terms
        .map((t, i) => {
          // Leading term shows a bare '-' only when negative; later terms get
          // a spaced operator so it reads "2d6 + 3", not "2d6 +3".
          const op = i === 0 ? (t.sign < 0 ? '-' : '') : t.sign < 0 ? '- ' : '+ ';
          const body =
            t.type === 'mod'
              ? String(t.value)
              : `${t.count}d${t.sides}${t.keep ? `${t.keep.mode}${t.keep.n}` : ''}`;
          return `${op}${body}`;
        })
        .join(' ');
    },
  };
}

// Turn a builder pool (an array of die sizes) plus a flat modifier into the
// same shape parseFormula() produces, so the <roll-any-dice> builder can reuse
// roll() and the whole render pipeline unchanged. Same-sided dice are grouped
// into one term, in first-seen order. Returns null if the pool has no dice
// (matching parseFormula's rule that a roll must contain at least one die).
export function poolToParsed(pool, mod = 0) {
  if (!pool.length) return null;

  const counts = new Map(); // sides -> count, insertion-ordered
  for (const sides of pool) counts.set(sides, (counts.get(sides) ?? 0) + 1);

  const terms = [];
  for (const [sides, count] of counts) {
    terms.push({ type: 'dice', sign: 1, count, sides, keep: null });
  }
  if (mod !== 0) {
    terms.push({ type: 'mod', sign: mod < 0 ? -1 : 1, value: Math.abs(mod) });
  }

  return {
    terms,
    toString() {
      return terms
        .map((t, i) => {
          const op = i === 0 ? (t.sign < 0 ? '-' : '') : t.sign < 0 ? '- ' : '+ ';
          const body = t.type === 'mod' ? String(t.value) : `${t.count}d${t.sides}`;
          return `${op}${body}`;
        })
        .join(' ');
    },
  };
}

// Fair integer in [1, sides] using crypto when available. Rejection-samples
// to avoid modulo bias.
export function rollDie(sides) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const max = Math.floor(0xffffffff / sides) * sides;
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= max);
    return (x % sides) + 1;
  }
  return Math.floor(Math.random() * sides) + 1;
}

// Roll a parsed formula. Returns:
//   { total, formula, terms: [ ... ] }
// where each dice term carries per-die rolls with a `kept` flag so the UI and
// the dice render from the same data.
export function roll(parsed) {
  let total = 0;
  const resultTerms = parsed.terms.map((t) => {
    if (t.type === 'mod') {
      total += t.sign * t.value;
      return { type: 'mod', sign: t.sign, value: t.value };
    }

    const rolls = Array.from({ length: t.count }, () => ({
      value: rollDie(t.sides),
      sides: t.sides,
      kept: true,
    }));

    if (t.keep) applyKeepDrop(rolls, t.keep);

    const subtotal = rolls
      .filter((r) => r.kept)
      .reduce((sum, r) => sum + r.value, 0);
    total += t.sign * subtotal;

    return {
      type: 'dice',
      sign: t.sign,
      count: t.count,
      sides: t.sides,
      keep: t.keep,
      rolls,
      subtotal,
    };
  });

  return { total, formula: parsed.toString(), terms: resultTerms };
}

// Mark the dropped dice by mutating `kept`. Ties are broken by original order,
// which doesn't affect the sum.
function applyKeepDrop(rolls, keep) {
  const order = rolls
    .map((r, i) => ({ i, value: r.value }))
    .sort((a, b) => a.value - b.value); // ascending

  let dropIndices;
  if (keep.mode === 'kh') dropIndices = order.slice(0, rolls.length - keep.n);
  else if (keep.mode === 'kl') dropIndices = order.slice(keep.n);
  else if (keep.mode === 'dh') dropIndices = order.slice(rolls.length - keep.n);
  else /* dl */ dropIndices = order.slice(0, keep.n);

  for (const { i } of dropIndices) rolls[i].kept = false;
}
