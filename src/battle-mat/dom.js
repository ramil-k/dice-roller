// Tiny DOM helpers, local copies of `el` (roll-dice.js) and `svgEl` (svg.js).
// Deliberately duplicated rather than imported: pulling anything from those
// modules into this directory would drag the whole dice component into the
// lazily-loaded battle-mat chunk (or force an eager shared chunk), defeating
// the load-on-open design.

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}
