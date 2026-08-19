// Pointer-interaction state machine for the battle mat. One controller owns
// every pointer/wheel/key event on the map svg and dispatches on the active
// tool. Modes: idle, panning, pinching, draggingNode, drawing, erasing,
// measuring, placing (armed from the token pool), plus pool drags that start
// on avatar buttons outside the svg.
//
// The `ctx` contract (built by overlay.js):
//   svg, root (shadow root, for elementFromPoint), refs (view.buildScene)
//   getDoc(), getGrid(), getViewport(), setViewport(vp)
//   commit()        — structure changed: re-render + autosave
//   save()          — geometry-only change (viewport): autosave, no re-render
//   getTool(), getColor(), setStatus(text)
//   placeToken(entry, wx, wy)      — create a pool token at a world point
//   onPlacingChange(entry | null)  — pool/cursor UI feedback
//   onNodeClick?(id, clientX, clientY) — select-tool click (no movement) on a
//                                        node; the overlay opens its card

import { screenToWorld, panBy, zoomAt, pinchUpdate } from './viewport.js';
import { snapTokenOrigin, measure, formatMeasure } from './grid.js';
import { getNode, moveNode, removeNode, makeStroke, addNode, nodeKind } from './canvas-doc.js';
import { pathFrom, moveNodeEl, showRuler, hideRuler } from './view.js';
import { svgEl, el } from './dom.js';

const DRAW_TOOLS = ['pen', 'line', 'rect', 'ellipse'];
const CLICK_SLOP = 5; // px of pointer travel that still counts as a click
const PEN_STEP = 2; // min world-px between recorded pen points

export function attachTools(ctx) {
  let mode = 'idle';
  let drag = null; // mode-specific scratch state
  let placingEntry = null;
  let spaceHeld = false;
  let rulerTimer = null;
  const pointers = new Map(); // pointerId -> last svg-local position

  const svgPoint = (e) => {
    const r = ctx.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const worldPoint = (e) => {
    const sp = svgPoint(e);
    return screenToWorld(ctx.getViewport(), sp.x, sp.y);
  };

  const setMode = (m) => {
    mode = m;
    ctx.svg.setAttribute('data-mode', m);
  };

  const setPlacing = (entry) => {
    placingEntry = entry;
    if (entry) setMode('placing');
    else if (mode === 'placing') setMode('idle');
    ctx.onPlacingChange(entry);
  };

  // ---- drawing preview -----------------------------------------------------

  const previewAttrs = () => ({
    fill: 'none',
    stroke: ctx.getColor(),
    'stroke-width': 3,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });

  function startDrawing(shape, wp) {
    const elByShape = {
      pen: () => svgEl('path', { ...previewAttrs(), d: `M ${wp.x} ${wp.y}` }),
      line: () => svgEl('line', { ...previewAttrs(), x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }),
      rect: () => svgEl('rect', { ...previewAttrs(), x: wp.x, y: wp.y, width: 0, height: 0 }),
      ellipse: () => svgEl('ellipse', { ...previewAttrs(), cx: wp.x, cy: wp.y, rx: 0, ry: 0 }),
    };
    const preview = elByShape[shape]();
    ctx.refs.preview.appendChild(preview);
    drag = { shape, anchor: wp, points: [[wp.x, wp.y]], last: wp, preview };
    setMode('drawing');
  }

  function updateDrawing(wp) {
    const { shape, anchor, preview } = drag;
    if (shape === 'pen') {
      if (Math.hypot(wp.x - drag.last.x, wp.y - drag.last.y) < PEN_STEP) return;
      drag.points.push([wp.x, wp.y]);
      drag.last = wp;
      preview.setAttribute('d', pathFrom(drag.points));
      return;
    }
    drag.last = wp;
    if (shape === 'line') {
      preview.setAttribute('x2', wp.x);
      preview.setAttribute('y2', wp.y);
    } else if (shape === 'rect') {
      preview.setAttribute('x', Math.min(anchor.x, wp.x));
      preview.setAttribute('y', Math.min(anchor.y, wp.y));
      preview.setAttribute('width', Math.abs(wp.x - anchor.x));
      preview.setAttribute('height', Math.abs(wp.y - anchor.y));
    } else if (shape === 'ellipse') {
      preview.setAttribute('cx', (anchor.x + wp.x) / 2);
      preview.setAttribute('cy', (anchor.y + wp.y) / 2);
      preview.setAttribute('rx', Math.abs(wp.x - anchor.x) / 2);
      preview.setAttribute('ry', Math.abs(wp.y - anchor.y) / 2);
    }
  }

  function finishDrawing(commit) {
    const { shape, anchor, points, last, preview } = drag;
    preview.remove();
    if (commit) {
      const strokePoints = shape === 'pen' ? points : [[anchor.x, anchor.y], [last.x, last.y]];
      const span = Math.hypot(last.x - anchor.x, last.y - anchor.y);
      const isReal = shape === 'pen' ? points.length > 1 : span >= 2;
      if (isReal) {
        addNode(ctx.getDoc(), makeStroke({ shape, points: strokePoints, color: ctx.getColor() }));
        ctx.commit();
      }
    }
    drag = null;
    setMode('idle');
  }

  // ---- erase ---------------------------------------------------------------

  // Pointer capture retargets events to the svg, so `e.target` goes stale
  // during an erase drag; hit-test through the shadow root instead.
  function eraseAt(e) {
    const hit = ctx.root.elementFromPoint(e.clientX, e.clientY);
    const g = hit?.closest?.('[data-id]');
    if (!g || !ctx.refs.world.contains(g)) return;
    if (removeNode(ctx.getDoc(), g.getAttribute('data-id'))) ctx.commit();
  }

  // ---- pointer handlers ----------------------------------------------------

  function onPointerDown(e) {
    const sp = svgPoint(e);
    pointers.set(e.pointerId, sp);

    // Two touch pointers anywhere on the map = pinch, whatever the tool.
    if (pointers.size === 2 && e.pointerType === 'touch') {
      abortActive();
      setMode('pinching');
      drag = null;
      ctx.svg.setPointerCapture(e.pointerId);
      return;
    }
    if (mode !== 'idle' && mode !== 'placing') return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    ctx.svg.setPointerCapture(e.pointerId);

    // keyed off placingEntry, not mode: a space-pan can interrupt placing
    // without disarming it
    if (placingEntry && e.button === 0 && !spaceHeld) {
      const wp = worldPoint(e);
      ctx.placeToken(placingEntry, wp.x, wp.y);
      setPlacing(null);
      return;
    }

    const startPan = () => {
      drag = { last: sp };
      setMode('panning');
    };

    if (e.button === 1 || spaceHeld) return startPan();

    const tool = ctx.getTool();
    if (tool === 'pan') return startPan();

    if (tool === 'select') {
      const g = e.target.closest?.('[data-id]');
      const node = g && getNode(ctx.getDoc(), g.getAttribute('data-id'));
      if (node) {
        const wp = worldPoint(e);
        drag = { id: node.id, dx: wp.x - node.x, dy: wp.y - node.y, pos: null, start: sp, moved: false };
        setMode('draggingNode');
      } else {
        startPan();
      }
      return;
    }

    if (DRAW_TOOLS.includes(tool)) return startDrawing(tool, worldPoint(e));

    if (tool === 'eraser') {
      setMode('erasing');
      eraseAt(e);
      return;
    }

    if (tool === 'ruler') {
      clearTimeout(rulerTimer);
      const wp = worldPoint(e);
      drag = { ax: wp.x, ay: wp.y };
      setMode('measuring');
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const sp = svgPoint(e);

    if (mode === 'pinching') {
      const prev = [...pointers.values()];
      pointers.set(e.pointerId, sp);
      const cur = [...pointers.values()];
      if (prev.length >= 2) {
        ctx.setViewport(pinchUpdate(ctx.getViewport(), prev[0], prev[1], cur[0], cur[1]));
      }
      return;
    }
    pointers.set(e.pointerId, sp);

    if (mode === 'panning') {
      ctx.setViewport(panBy(ctx.getViewport(), sp.x - drag.last.x, sp.y - drag.last.y));
      drag.last = sp;
    } else if (mode === 'draggingNode') {
      // Under CLICK_SLOP px of screen travel this is still a click (pointer
      // jitter must not turn it into a micro-drag that eats the token card
      // and nudges the node); the real drag starts once past the slop.
      if (!drag.moved && Math.hypot(sp.x - drag.start.x, sp.y - drag.start.y) < CLICK_SLOP) return;
      drag.moved = true;
      const node = getNode(ctx.getDoc(), drag.id);
      if (!node) return;
      const wp = worldPoint(e);
      let x = wp.x - drag.dx;
      let y = wp.y - drag.dy;
      const grid = ctx.getGrid();
      if (grid.snap && nodeKind(node) === 'token') {
        ({ x, y } = snapTokenOrigin(x, y, node.width, grid));
      }
      drag.pos = { x, y };
      moveNodeEl(ctx.refs, drag.id, x, y);
    } else if (mode === 'drawing') {
      updateDrawing(worldPoint(e));
    } else if (mode === 'erasing') {
      eraseAt(e);
    } else if (mode === 'measuring') {
      const wp = worldPoint(e);
      const label = formatMeasure(measure(drag.ax, drag.ay, wp.x, wp.y, ctx.getGrid()));
      showRuler(ctx.refs, drag.ax, drag.ay, wp.x, wp.y, label, ctx.getViewport().zoom);
      ctx.setStatus(label);
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);

    if (mode === 'pinching') {
      if (pointers.size < 2) {
        setMode('idle');
        ctx.save();
      }
      return;
    }
    if (mode === 'panning') {
      setMode('idle');
      drag = null;
      ctx.save();
    } else if (mode === 'draggingNode') {
      if (drag.pos) {
        moveNode(ctx.getDoc(), drag.id, drag.pos.x, drag.pos.y);
        ctx.commit();
      } else {
        // never moved: a plain click on the node, not a drag
        ctx.onNodeClick?.(drag.id, e.clientX, e.clientY);
      }
      drag = null;
      setMode('idle');
    } else if (mode === 'drawing') {
      finishDrawing(true);
    } else if (mode === 'erasing') {
      setMode('idle');
    } else if (mode === 'measuring') {
      drag = null;
      setMode('idle');
      // leave the measurement on screen just long enough to read it
      rulerTimer = setTimeout(() => {
        hideRuler(ctx.refs);
        ctx.setStatus('');
      }, 800);
    }
  }

  // Abort whatever is in flight without committing (pointercancel, Escape).
  function abortActive() {
    if (mode === 'drawing') {
      finishDrawing(false);
    } else if (mode === 'draggingNode') {
      const node = getNode(ctx.getDoc(), drag.id);
      if (node) moveNodeEl(ctx.refs, node.id, node.x, node.y);
      drag = null;
      setMode('idle');
    } else if (mode === 'measuring') {
      hideRuler(ctx.refs);
      ctx.setStatus('');
      drag = null;
      setMode('idle');
    } else if (mode === 'panning' || mode === 'erasing') {
      drag = null;
      setMode('idle');
    }
  }

  function onPointerCancel(e) {
    pointers.delete(e.pointerId);
    if (mode !== 'pinching' || pointers.size < 2) abortActive();
    if (mode === 'pinching') setMode('idle');
  }

  function onWheel(e) {
    e.preventDefault();
    const sp = svgPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    ctx.setViewport(zoomAt(ctx.getViewport(), factor, sp.x, sp.y));
    ctx.save();
  }

  // Space temporarily turns any primary drag into a pan (held, not toggled).
  // Shift shows every token's name plate while held (data-labels-shift; the
  // tools bar has a click toggle for the same thing on touch devices).
  function onKeyDown(e) {
    const tag = e.composedPath()[0]?.tagName;
    if (e.key === 'Shift' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      ctx.svg.setAttribute('data-labels-shift', '');
    }
    if (e.code !== 'Space') return;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
    spaceHeld = true;
    ctx.svg.setAttribute('data-space', '');
    e.preventDefault();
  }
  function onKeyUp(e) {
    if (e.key === 'Shift') ctx.svg.removeAttribute('data-labels-shift');
    if (e.code !== 'Space') return;
    spaceHeld = false;
    ctx.svg.removeAttribute('data-space');
  }

  // ---- pool drags (start on avatar buttons, land on the map) ---------------

  // Drag an avatar out of the pool onto the map. Under CLICK_SLOP px of
  // travel it is a click instead, which arms click-to-place — the touch and
  // keyboard friendly path (keyboard "clicks" arrive via the overlay's click
  // handler with event.detail === 0 and call armPlacement directly).
  function startPoolDrag(entry, e) {
    const btn = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    btn.setPointerCapture(e.pointerId);

    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >= CLICK_SLOP) {
        ghost = el('div', 'pool-ghost');
        const img = el('img');
        img.src = entry.image;
        img.alt = '';
        // photos clip to the circle like their pool avatar (registry glyphs fit inside)
        if (entry.source !== 'registry' && !entry.art) img.classList.add('photo');
        ghost.appendChild(img);
        ctx.root.querySelector('.mat-root').appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const finish = (ev) => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', finish);
      btn.removeEventListener('pointercancel', cancel);
      if (!ghost) return; // a plain click: the button's click handler arms placement
      ghost.remove();
      const r = ctx.svg.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
        const wp = screenToWorld(ctx.getViewport(), ev.clientX - r.left, ev.clientY - r.top);
        ctx.placeToken(entry, wp.x, wp.y);
      }
      // flag the drag so the click that follows it does not arm placement
      // (the overlay's click handler checks and clears this)
      btn.dataset.dragged = '1';
    };
    const cancel = () => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', finish);
      btn.removeEventListener('pointercancel', cancel);
      if (ghost) ghost.remove();
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', cancel);
  }

  // ---- wiring ---------------------------------------------------------------

  ctx.svg.addEventListener('pointerdown', onPointerDown);
  ctx.svg.addEventListener('pointermove', onPointerMove);
  ctx.svg.addEventListener('pointerup', onPointerUp);
  ctx.svg.addEventListener('pointercancel', onPointerCancel);
  ctx.svg.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  setMode('idle');

  return {
    startPoolDrag,
    armPlacement(entry) {
      setPlacing(entry);
    },
    // Escape hook: cancel the in-flight interaction if any; report whether
    // something was cancelled so the overlay knows not to close yet.
    cancelActive() {
      if (placingEntry) {
        setPlacing(null);
        return true;
      }
      if (mode !== 'idle') {
        abortActive();
        return true;
      }
      return false;
    },
    detach() {
      clearTimeout(rulerTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
