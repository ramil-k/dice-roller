// Scene rendering for the battle mat. The svg holds one `world` group that
// carries the whole viewport transform; inside it, layers stack in paint
// order: grid, attached images, drawings, tokens, live preview, ruler.
//
// Every document node renders as `<g data-id="..." transform="translate(x y)">`
// with its content drawn at the local origin, so dragging a node only touches
// that one transform (`moveNodeEl`) — full `render()` runs only on structural
// commits (add/remove/import), which is cheap at battle-map scale anyway.

import { svgEl } from './dom.js';
import { EXT, nodeKind, resolveColor } from './canvas-doc.js';

// The "infinite" grid: a pattern-filled rect this large covers any plausible
// pan range without the cost of real geometry.
const GRID_EXTENT = 500000;

export function buildScene(svg) {
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', {
    id: 'bm-grid',
    patternUnits: 'userSpaceOnUse',
    width: 64,
    height: 64,
  });
  const patternPath = svgEl('path', { class: 'grid-line', fill: 'none' });
  pattern.appendChild(patternPath);
  defs.appendChild(pattern);

  const world = svgEl('g', { class: 'world' });
  const gridRect = svgEl('rect', {
    class: 'grid-rect',
    x: -GRID_EXTENT,
    y: -GRID_EXTENT,
    width: GRID_EXTENT * 2,
    height: GRID_EXTENT * 2,
    fill: 'url(#bm-grid)',
  });
  const images = svgEl('g', { class: 'layer-images' });
  const drawings = svgEl('g', { class: 'layer-drawings' });
  const tokens = svgEl('g', { class: 'layer-tokens' });
  const preview = svgEl('g', { class: 'layer-preview' });
  const ruler = svgEl('g', { class: 'layer-ruler' });
  ruler.setAttribute('display', 'none');

  world.append(gridRect, images, drawings, tokens, preview, ruler);
  svg.append(defs, world);

  return { svg, world, pattern, patternPath, gridRect, images, drawings, tokens, preview, ruler };
}

export function applyViewport(refs, vp) {
  // translate happens first, then scale: screen = (world - vp.xy) * zoom
  refs.world.setAttribute('transform', `scale(${vp.zoom}) translate(${-vp.x} ${-vp.y})`);
}

export function updateGrid(refs, grid) {
  const s = grid.cellSize;
  refs.pattern.setAttribute('width', s);
  refs.pattern.setAttribute('height', s);
  refs.pattern.setAttribute('x', grid.offsetX);
  refs.pattern.setAttribute('y', grid.offsetY);
  // one cell's top and left edge; tiling draws the full lattice
  refs.patternPath.setAttribute('d', `M ${s} 0 L 0 0 0 ${s}`);
  refs.gridRect.setAttribute('display', grid.visible ? 'inline' : 'none');
}

function renderToken(node) {
  const size = node.width;
  const ext = node[EXT];
  const ring = svgEl('circle', {
    class: `token-ring token-${ext.tokenKind ?? 'player'}`,
    cx: size / 2,
    cy: size / 2,
    r: size / 2,
  });
  // inline style, not a presentation attribute: the token-ring class sets a
  // default stroke in CSS, which would win over setAttribute('stroke', ...)
  if (node.color) ring.style.stroke = resolveColor(node.color);
  const img = svgEl('image', {
    x: size * 0.08,
    y: size * 0.08,
    width: size * 0.84,
    height: size * 0.84,
    href: node.url,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const title = svgEl('title');
  title.textContent = ext.name || 'Token';
  return [ring, img, title];
}

function renderStroke(node) {
  const ext = node[EXT];
  const color = resolveColor(node.color);
  const attrs = {
    fill: 'none',
    stroke: color,
    'stroke-width': ext.strokeWidth ?? 3,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  switch (ext.shape) {
    case 'line': {
      const [a = [0, 0], b = [node.width, node.height]] = ext.points ?? [];
      return [svgEl('line', { ...attrs, x1: a[0], y1: a[1], x2: b[0], y2: b[1] })];
    }
    case 'rect':
      return [svgEl('rect', { ...attrs, x: 0, y: 0, width: node.width, height: node.height })];
    case 'ellipse':
      return [
        svgEl('ellipse', {
          ...attrs,
          cx: node.width / 2,
          cy: node.height / 2,
          rx: node.width / 2,
          ry: node.height / 2,
        }),
      ];
    default:
      return [svgEl('path', { ...attrs, d: pathFrom(ext.points ?? []) })];
  }
}

export function pathFrom(points) {
  if (!points.length) return '';
  return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')}`;
}

// Foreign JSON Canvas nodes (imported from other tools) render as labeled
// dashed boxes so the user sees them and can pan around them; they are kept
// in the document untouched.
function renderForeign(node) {
  const box = svgEl('rect', {
    class: 'foreign-box',
    x: 0,
    y: 0,
    width: node.width,
    height: node.height,
    rx: 4,
  });
  const label = svgEl('text', { class: 'foreign-label', x: 8, y: 20 });
  label.textContent = String(node.text ?? node.label ?? node.url ?? node.file ?? node.type ?? 'node').slice(0, 60);
  return [box, label];
}

export function render(refs, doc) {
  refs.images.replaceChildren();
  refs.drawings.replaceChildren();
  refs.tokens.replaceChildren();

  for (const node of doc.nodes) {
    const g = svgEl('g', { 'data-id': node.id, transform: `translate(${node.x} ${node.y})` });
    const kind = nodeKind(node);
    if (kind === 'token') {
      g.classList.add('token');
      g.append(...renderToken(node));
      refs.tokens.appendChild(g);
    } else if (kind === 'image') {
      g.append(
        svgEl('image', {
          x: 0,
          y: 0,
          width: node.width,
          height: node.height,
          href: node.url,
          preserveAspectRatio: 'none',
        }),
      );
      refs.images.appendChild(g);
    } else if (kind === 'stroke') {
      g.append(...renderStroke(node));
      refs.drawings.appendChild(g);
    } else {
      g.append(...renderForeign(node));
      refs.drawings.appendChild(g);
    }
  }
}

// Cheap per-frame position update while dragging; render() re-syncs on commit.
export function moveNodeEl(refs, id, x, y) {
  const g = refs.world.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (g) g.setAttribute('transform', `translate(${x} ${y})`);
}

// Ruler overlay: a line with end ticks and a floating label. The label's
// font size is divided by the zoom so it stays readable at any scale (the
// ruler group lives inside the world transform).
export function showRuler(refs, x1, y1, x2, y2, label, zoom) {
  refs.ruler.replaceChildren(
    svgEl('line', { class: 'ruler-line', x1, y1, x2, y2 }),
    svgEl('circle', { class: 'ruler-end', cx: x1, cy: y1, r: 3 / zoom }),
    svgEl('circle', { class: 'ruler-end', cx: x2, cy: y2, r: 3 / zoom }),
  );
  const text = svgEl('text', {
    class: 'ruler-label',
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2 - 10 / zoom,
    'font-size': 14 / zoom,
    'text-anchor': 'middle',
  });
  text.textContent = label;
  refs.ruler.appendChild(text);
  refs.ruler.setAttribute('display', 'inline');
  const line = refs.ruler.querySelector('.ruler-line');
  line.setAttribute('stroke-width', 2 / zoom);
  line.setAttribute('stroke-dasharray', `${6 / zoom} ${4 / zoom}`);
}

export function hideRuler(refs) {
  refs.ruler.setAttribute('display', 'none');
  refs.ruler.replaceChildren();
}
