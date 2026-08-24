// Diagnostic logging for the battle mat. Deliberately noisy: every path that
// can replace the document, move the viewport or flip an image lock reports
// what it saw and who called it, so a "my viewport jumped and the lock came
// off" moment can be traced back through the console. On by default;
// `localStorage['battle-mat-debug'] = 'off'` silences it.

const EXT = 'x-battleMat';
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

// Browser only (no localStorage = Node/tests = silent).
const enabled = () => {
  try {
    const ls = globalThis.localStorage;
    return Boolean(ls) && ls.getItem('battle-mat-debug') !== 'off';
  } catch {
    return false;
  }
};

const stamp = () => `+${(((typeof performance !== 'undefined' ? performance.now() : 0) - t0) / 1000).toFixed(3)}s`;

export function dlog(tag, msg, data) {
  if (!enabled()) return;
  const line = `[bm ${stamp()} ${tag}] ${msg}`;
  if (data === undefined) console.log(line);
  else console.log(line, data);
}

// The few stack frames above the logging call, so a log line says where a
// setDoc / viewport change came from (frames of this module are dropped).
export function caller(depth = 4) {
  const lines = (new Error().stack ?? '').split('\n').map((l) => l.trim());
  return lines
    .filter((l) => l !== 'Error' && !l.includes('debug.js'))
    .slice(1, 1 + depth)
    .map((l) => l.replace(/^at /, '').replace(/\?[^:)]*/, ''))
    .join(' <- ');
}

const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

export const vpOf = (doc) => {
  const v = doc?.[EXT]?.viewport;
  return v ? `x=${r(v.x)} y=${r(v.y)} zoom=${r(v.zoom)}` : '(none)';
};

export const lockedOf = (doc) =>
  (doc?.nodes ?? []).filter((n) => n?.[EXT]?.locked === true).map((n) => n.id.slice(0, 8));

export const docSummary = (doc) => ({
  nodes: doc?.nodes?.length ?? 0,
  images: (doc?.nodes ?? []).filter((n) => n?.[EXT]?.kind === 'image').length,
  locked: lockedOf(doc),
  viewport: vpOf(doc),
  round: doc?.[EXT]?.combat?.round,
});
