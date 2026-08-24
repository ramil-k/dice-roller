// Resize-handle geometry for the battle mat: pure box math, DOM-free, covered
// by test/battle-mat-resize.test.js. The eight handles are named by compass
// point; dragging one moves the edge(s) it sits on while the opposite
// edge/corner stays anchored.

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const isCorner = (handle) => handle.length === 2;

// New box for `handle` dragged to the world point `point`, starting from the
// original `box`. Sizes never drop below `minSize` (the pointer crossing the
// anchored side just pins the box at the minimum instead of flipping it).
// With `keepAspect` both dimensions scale together, by whichever axis the
// pointer pulled further, from the anchored corner (or edge).
export function resizeBox(box, handle, point, { keepAspect = false, minSize = 8 } = {}) {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  if (west) left = Math.min(point.x, right - minSize);
  if (east) right = Math.max(point.x, left + minSize);
  if (north) top = Math.min(point.y, bottom - minSize);
  if (south) bottom = Math.max(point.y, top + minSize);

  let width = right - left;
  let height = bottom - top;

  if (keepAspect && box.width > 0 && box.height > 0) {
    const horizontal = west || east;
    const vertical = north || south;
    let scale;
    if (horizontal && vertical) scale = Math.max(width / box.width, height / box.height);
    else if (horizontal) scale = width / box.width;
    else scale = height / box.height;
    scale = Math.max(scale, minSize / Math.min(box.width, box.height));
    width = box.width * scale;
    height = box.height * scale;
    // grow from the anchored side; an edge handle keeps the other axis centered
    left = west ? right - width : horizontal ? left : box.x + (box.width - width) / 2;
    top = north ? bottom - height : vertical ? top : box.y + (box.height - height) / 2;
  }

  return { x: left, y: top, width, height };
}
