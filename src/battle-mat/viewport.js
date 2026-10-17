// Pan/zoom math for the battle-mat viewport. The viewport is
// `{ x, y, zoom }` where (x, y) is the world point sitting at the screen
// origin (top-left of the svg) and zoom is world→screen scale, so:
//   screen = (world - viewport.xy) * zoom
// All functions are pure and return new viewport objects.
//
// DOM-free; covered by test/battle-mat-viewport.test.js.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export function clampZoom(z) {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function screenToWorld(vp, sx, sy) {
  return { x: sx / vp.zoom + vp.x, y: sy / vp.zoom + vp.y };
}

export function worldToScreen(vp, wx, wy) {
  return { x: (wx - vp.x) * vp.zoom, y: (wy - vp.y) * vp.zoom };
}

// Pan by a screen-space delta (the pointer's movement): dragging content
// right (positive dx) means the viewport origin moves left in world space.
export function panBy(vp, dx, dy) {
  return { x: vp.x - dx / vp.zoom, y: vp.y - dy / vp.zoom, zoom: vp.zoom };
}

// Zoom by `factor` keeping the world point under screen (sx, sy) stationary —
// the wheel-zoom anchor. Solving screen = (world - x') * zoom' for x':
export function zoomAt(vp, factor, sx, sy) {
  const zoom = clampZoom(vp.zoom * factor);
  const w = screenToWorld(vp, sx, sy);
  return { x: w.x - sx / zoom, y: w.y - sy / zoom, zoom };
}

// "Show everything": the viewport that fits world-space `bounds`
// ({ minX, minY, maxX, maxY }) into a `width`×`height` screen with `padding`
// px on every side, centred. Zoom is capped at `maxZoom` so a lone token is
// not blown up to fill the screen; a zero-size box (a single point) just
// centres at `maxZoom`.
export function fitBounds(bounds, width, height, { padding = 48, maxZoom = 1 } = {}) {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const room = (size) => Math.max(size - 2 * padding, 1);
  const fit = Math.min(bw > 0 ? room(width) / bw : Infinity, bh > 0 ? room(height) / bh : Infinity);
  const zoom = clampZoom(Math.min(fit, maxZoom));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - width / 2 / zoom, y: cy - height / 2 / zoom, zoom };
}

// Two-finger pinch: `a1`/`a2` are the previous screen positions of the two
// pointers, `b1`/`b2` the current ones. Scales by the change in pointer
// distance and keeps the world point under the (moving) midpoint pinned, so
// pinching also pans.
export function pinchUpdate(vp, a1, a2, b1, b2) {
  const distA = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  const distB = Math.hypot(b2.x - b1.x, b2.y - b1.y);
  const factor = distA > 0 ? distB / distA : 1;
  const zoom = clampZoom(vp.zoom * factor);
  const midA = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const midB = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
  const w = screenToWorld(vp, midA.x, midA.y);
  return { x: w.x - midB.x / zoom, y: w.y - midB.y / zoom, zoom };
}
