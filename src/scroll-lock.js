// Page scroll lock for full-screen overlays (the battle screen with the map
// shown, the dice builder/result overlay). overflow: hidden on <html> keeps
// the scroll position (unlike position: fixed on <body>), and
// scrollbar-gutter: stable keeps the page from shifting sideways when the
// scrollbar goes away. Only inline styles are touched and the previous inline
// values are restored, so the host page's own stylesheet stays in charge.
// Owners are counted: two overlays open at once release the lock only when
// both are gone, and locking twice with the same owner is a no-op.

const owners = new Set();
let saved = null;

export function lockScroll(owner) {
  if (typeof document === 'undefined' || owners.has(owner)) return;
  owners.add(owner);
  if (owners.size > 1) return;
  const style = document.documentElement.style;
  saved = { overflow: style.overflow, scrollbarGutter: style.scrollbarGutter };
  style.overflow = 'hidden';
  style.scrollbarGutter = 'stable';
}

export function unlockScroll(owner) {
  if (!owners.delete(owner) || owners.size > 0) return;
  const style = document.documentElement.style;
  style.overflow = saved.overflow;
  style.scrollbarGutter = saved.scrollbarGutter;
  saved = null;
}
