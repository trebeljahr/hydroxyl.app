"use client";

/**
 * All of the canvas's browser-event plumbing, and none of its meaning.
 *
 * This hook knows nothing about chemistry, nothing about the store and nothing
 * about the scene. It turns raw pointer, wheel, key and resize events into six
 * semantic callbacks — hover, hover-end, select, zoom, pan, resize — and stops
 * there. That separation is the point: the editing FSM that comes next reuses
 * the same gestures with different callbacks, so anything it would have to
 * fight (a store write, a hit test, a tool mode) must not appear below.
 *
 * DESKTOP-PRIMARY, DELIBERATELY. PointerEvents throughout, so a pen works and
 * a touch drag pans for free, but there is no bespoke touch gesture set: no
 * two-finger pinch handler, no long-press. The audience is someone preparing a
 * figure at a desk. (A trackpad pinch still zooms, because browsers deliver it
 * as ctrl+wheel and the wheel handler below neither knows nor cares.)
 *
 * THREE CONVENTIONS THAT ARE EASY TO BREAK AND HARD TO DIAGNOSE:
 *
 * 1. Every point handed to a callback is canvas-local px — measured from the
 *    <svg>'s own top-left via `getBoundingClientRect()` AT EVENT TIME. That is
 *    exactly the space `toScreen`/`toModel` work in, because the viewport's
 *    `size` IS this element's size. No other space is ever produced here.
 *
 * 2. The wheel listener is attached natively, non-passive. React's `onWheel`
 *    cannot do this job — see the comment on the effect.
 *
 * 3. `onPan` receives the delta ALREADY NEGATED, ready to hand straight to the
 *    store's `panBy`. See the comment at the pan branch of `onPointerMove`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import type { Vec2 } from "@starter/chem-core";
import type { ViewportSize } from "@/state";

/**
 * How far the pointer may travel between down and up and still count as a
 * click, in canvas px.
 *
 * Without this every pan that happens to end over empty space also reads as a
 * click on empty space, and empty space clears the selection — so the user
 * selects an atom, nudges the view, and watches the selection evaporate for no
 * reason they can see. 4px is below the wobble of a deliberate click and well
 * under any drag anyone means as a drag.
 */
export const CLICK_SLOP_PX = 4;

/**
 * Wheel-delta-to-zoom rate, in inverse px.
 *
 * The factor is `exp(-delta * k)`, i.e. zoom is exponential in scroll distance.
 * That buys two properties worth having: scrolling back by the same distance
 * undoes the zoom exactly (exp(a)·exp(-a) = 1, no drift after a hundred
 * events), and a notch feels the same at every scale, which is what "zoom"
 * means perceptually.
 *
 * At k = 0.002 a 100px mouse notch gives ×1.22 — about 3.5 notches per
 * doubling — and a trackpad's few-px-per-frame deltas glide instead of
 * stepping.
 */
const WHEEL_ZOOM_RATE = 0.002;

/**
 * Per-event clamp on the resulting factor.
 *
 * Some mice report a whole page of delta per notch and some trackpads emit one
 * enormous event at the end of a flick; either can jump several octaves in a
 * single frame and leave the user staring at one bond or at nothing. Two
 * octaves per event is the most that can still be undone by one scroll back.
 */
const MAX_WHEEL_FACTOR = 4;

/**
 * `deltaMode` normalisation. A wheel event may quote its delta in pixels (0),
 * lines (1) or pages (2), and which one you get depends on the browser, the OS
 * and the device — Firefox on a mouse still reports lines. These are the
 * conventional px equivalents; they only have to be roughly right, since the
 * result is fed through an exponential and clamped.
 */
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 100;

export interface CanvasPointerModifiers {
  readonly shift: boolean;
}

export interface CanvasGestureHandlers {
  readonly onHover: (canvasPoint: Vec2) => void;
  readonly onHoverEnd: () => void;
  readonly onSelect: (
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onZoom: (canvasAnchor: Vec2, factor: number) => void;
  /** Already negated: pass it straight to the store's `panBy`. */
  readonly onPan: (deltaScreen: Vec2) => void;
  readonly onResize: (size: ViewportSize) => void;
}

export interface CanvasGestures {
  /** True only while a pan drag is actually in progress — for `cursor: grabbing`. */
  readonly isPanning: boolean;
  readonly rootHandlers: {
    readonly onPointerDown: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerMove: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerUp: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerCancel: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerLeave: React.PointerEventHandler<SVGSVGElement>;
  };
}

interface PanDrag {
  readonly pointerId: number;
  /** Previous pointer position, canvas-local px. Deltas are per-move. */
  last: Vec2;
}

interface PressTrack {
  readonly pointerId: number;
  readonly origin: Vec2;
  /**
   * Latched, not recomputed at pointerup: a drag that wanders out and comes
   * back to where it started was still a drag, and must not fire a select.
   */
  moved: boolean;
}

/**
 * Canvas-local px from a pointer/wheel event.
 *
 * The rect is measured per event rather than cached because the canvas can
 * move under the user without any event this hook sees — a side panel opens,
 * the window scrolls, a layout settles — and a stale rect offsets every pick
 * by a constant nobody thinks to look for. `getBoundingClientRect` is cheap
 * enough at pointer rates; it is not cheap enough at wheel-storm rates either,
 * but correctness wins and profiling has never put it anywhere near the top.
 *
 * This assumes the element carries no CSS transform of its own. If one is ever
 * added, the rect is the TRANSFORMED box and these coordinates stop matching
 * the viewport's size — pan and zoom belong in the viewport model, not in CSS.
 */
function toCanvasPoint(
  svg: SVGSVGElement,
  event: { readonly clientX: number; readonly clientY: number },
): Vec2 {
  const rect = svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Elements that already mean something by "space" or by a typed character.
 *
 * Space is the pan modifier, so it gets `preventDefault()` to stop the page
 * scrolling — but not when the user is typing into a field, and not when a
 * button has focus, where space is the activation key. Swallowing it there
 * would make the canvas chrome (Fit, Reset, and whatever the editing tasks add
 * beside them) unreachable from the keyboard, which is a worse bug than a page
 * that scrolls behind the canvas.
 */
function consumesSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, button, a, [role='button']") !== null;
}

/** `setPointerCapture` throws if the pointer went away between events (a
 *  device unplugged, a tab switch mid-drag). Losing capture is survivable;
 *  throwing out of an event handler is not. */
function capturePointer(svg: SVGSVGElement, pointerId: number): void {
  try {
    svg.setPointerCapture(pointerId);
  } catch {
    // Ignored: the drag simply stops tracking outside the element.
  }
}

function releasePointer(svg: SVGSVGElement, pointerId: number): void {
  try {
    if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
  } catch {
    // Ignored: capture is already gone, which is the state we wanted.
  }
}

export function useCanvasGestures(
  svgRef: React.RefObject<SVGSVGElement | null>,
  handlers: CanvasGestureHandlers,
): CanvasGestures {
  /**
   * THE LATEST-REF PATTERN, and why it is not premature.
   *
   * The consumer's callbacks close over store state, so they are new functions
   * on every render — and the canvas re-renders on every hover change, which
   * during a slow pointer sweep is every frame. If the native wheel and key
   * listeners depended on them, every one of those renders would tear down and
   * re-add a non-passive wheel listener, and adding a non-passive listener is
   * one of the few DOM calls that makes the browser recompute whether it can
   * scroll on the compositor thread. Keeping the callbacks in a ref that an
   * effect refreshes lets the listeners attach exactly once per mount.
   */
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const panRef = useRef<PanDrag | null>(null);
  const pressRef = useRef<PressTrack | null>(null);
  const spaceRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const endPan = useCallback((svg: SVGSVGElement | null): void => {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    if (svg) releasePointer(svg, pan.pointerId);
    setIsPanning(false);
  }, []);

  /**
   * SPACE AS THE PAN MODIFIER, tracked on `window` rather than on the canvas
   * so it works before the canvas has focus — the user's hand is on the mouse,
   * not on the element.
   *
   * The blur and visibilitychange resets are not defensive noise: a key held
   * while the window loses focus never delivers its keyup, so alt-tabbing away
   * mid-hold would leave the canvas permanently convinced space is down, and
   * every left click from then on would pan instead of select. There is no way
   * for the user to clear that except reloading, because the fix requires a
   * keyup that will never arrive.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      if (consumesSpace(event.target)) return;
      // Suppressed on EVERY keydown, repeats included. Auto-repeat tells us
      // nothing new about the STATE, but each repeat carries its own default
      // action — scrolling the page — so returning before this line would let
      // ~30 scrolls a second through for as long as the pan modifier is held.
      event.preventDefault();
      if (event.repeat) return;
      spaceRef.current = true;
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      spaceRef.current = false;
    };

    const clear = (): void => {
      spaceRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  /**
   * WHEEL ZOOM, ATTACHED NATIVELY AND NON-PASSIVE. DO NOT REPLACE THIS WITH
   * React's `onWheel` PROP.
   *
   * React registers `wheel` once at the root container as a PASSIVE listener,
   * so `preventDefault()` inside an `onWheel` handler does nothing at all — no
   * error, no warning, just a page that scrolls out from under the user while
   * they zoom. The only way to get a cancellable wheel event is to add it to
   * the element yourself with `{ passive: false }`, which is what this effect
   * does. It looks like plumbing that could be simplified away. It cannot.
   *
   * The zoom anchor is the cursor. This hook does NOT try to correct the pan to
   * keep the anchor pinned — `zoomAt` in the store solves for the pan exactly,
   * including when the zoom clamp truncates the requested factor, which a
   * delta-nudge here could not do without drifting at the limits.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent): void => {
      // Unconditional, and before any early return: the page must not scroll
      // even on the events we decide are no-ops.
      event.preventDefault();

      const unit =
        event.deltaMode === 1
          ? LINE_DELTA_PX
          : event.deltaMode === 2
            ? PAGE_DELTA_PX
            : 1;
      const delta = event.deltaY * unit;
      if (!Number.isFinite(delta) || delta === 0) return;

      // Negated so that scrolling up (deltaY < 0, "away from you") zooms in,
      // matching every map and every drawing tool.
      const raw = Math.exp(-delta * WHEEL_ZOOM_RATE);
      const factor = Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, raw));
      if (factor === 1) return;

      handlersRef.current.onZoom(toCanvasPoint(svg, event), factor);
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
    };
  }, [svgRef]);

  /**
   * SIZE. The store's viewport size must be this element's size, in the same
   * CSS px `getBoundingClientRect` reports, or every screen-space calculation
   * downstream is centred on the wrong point.
   *
   * `ResizeObserver` is feature-detected rather than assumed: jsdom does not
   * always provide it, and a missing global would throw at effect time and take
   * the whole canvas down instead of degrading to a fixed size.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const report = (size: ViewportSize): void => {
      handlersRef.current.onResize(size);
    };

    // Seed immediately. In a real browser the observer's first callback lands
    // on the same frame and makes this redundant, but without it a jsdom test
    // — or any environment with no ResizeObserver — leaves the store on its
    // 800x600 placeholder forever, and `zoomToFit` frames the document against
    // a viewport that does not exist.
    //
    // BORDER box, and so is the observer below, and so is `toCanvasPoint`. One
    // box everywhere is the invariant that matters: pointer coordinates are
    // measured from the rect's origin, so a viewport sized from the CONTENT box
    // while points are measured from the BORDER box would offset every pick by
    // the padding, with nothing near the cause to point at. The canvas is
    // therefore required to carry no padding and no border — the same
    // requirement `toCanvasPoint` already states about CSS transforms.
    const rect = svg.getBoundingClientRect();
    // A zero measurement means "not laid out yet", not "zero pixels wide". The
    // 800x600 placeholder is a better answer than a degenerate viewport, so
    // leave it standing and wait for the observer.
    if (rect.width > 0 && rect.height > 0) {
      report({ width: rect.width, height: rect.height });
    }

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // The BORDER box, matching the seed above and `toCanvasPoint`. Read off
        // the element rather than the entry so there is exactly one measurement
        // in this file and no way for the two to disagree.
        const rect = entry.target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        report({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, [svgRef]);

  /** Releases capture for a drag still in progress when the canvas unmounts. */
  useEffect(() => {
    const svg = svgRef.current;
    return () => {
      endPan(svg);
    };
  }, [endPan, svgRef]);

  const onPointerDown = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      const point = toCanvasPoint(svg, event);

      // Middle drag, or space-held left drag. Two bindings because the middle
      // button is the one that works with no keyboard and space is the one
      // that works on a trackpad with no middle button.
      const wantsPan =
        event.button === 1 || (event.button === 0 && spaceRef.current);

      if (wantsPan) {
        // Suppresses the middle-click autoscroll widget on platforms that have
        // one; without it the browser starts its own scroll gesture on top of
        // ours.
        event.preventDefault();
        capturePointer(svg, event.pointerId);
        panRef.current = { pointerId: event.pointerId, last: point };
        pressRef.current = null;
        setIsPanning(true);
        // The hover answer is stale the moment the view starts moving.
        handlersRef.current.onHoverEnd();
        return;
      }

      // Left button only. A right-press is the context menu's business, and
      // tracking it here would fire a select on its release.
      if (event.button !== 0) return;
      pressRef.current = { pointerId: event.pointerId, origin: point, moved: false };
    },
    [svgRef],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      const point = toCanvasPoint(svg, event);

      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        /**
         * THE SIGN. The pointer moved by (point - last); the DRAWING must
         * follow the pointer, so the VIEWPORT moves the other way, and
         * `panBy` moves the viewport by its argument. Hence the negation, and
         * hence it happens here: viewport.ts states outright that this
         * negation belongs to the gesture, so that the affine map underneath
         * has no sign convention of its own to remember.
         *
         * Concretely: drag right (dx > 0) -> pan.x decreases -> `toScreen`
         * yields a larger x -> the structure moves right, under the cursor.
         *
         * Per-move deltas, not since-drag-start: `panBy` is incremental, and
         * a cumulative delta would apply the whole drag again on every event.
         */
        const delta = { x: -(point.x - pan.last.x), y: -(point.y - pan.last.y) };
        pan.last = point;
        if (delta.x !== 0 || delta.y !== 0) handlersRef.current.onPan(delta);
        return;
      }

      const press = pressRef.current;
      if (press && press.pointerId === event.pointerId && !press.moved) {
        const dx = point.x - press.origin.x;
        const dy = point.y - press.origin.y;
        if (Math.hypot(dx, dy) > CLICK_SLOP_PX) press.moved = true;
      }

      // Hover is a question about what is under the cursor when the cursor is
      // just sitting there. With a button down the user is mid-gesture and the
      // answer is either irrelevant or about to change.
      if (event.buttons === 0) handlersRef.current.onHover(point);
    },
    [svgRef],
  );

  const onPointerUp = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        endPan(svg);
        pressRef.current = null;
        return;
      }

      const press = pressRef.current;
      pressRef.current = null;
      if (!svg || !press || press.pointerId !== event.pointerId) return;
      if (event.button !== 0) return;
      if (press.moved) return;

      // On pointerup rather than pointerdown so that a drag can still change
      // its mind, and so the slop test above has something to measure.
      handlersRef.current.onSelect(toCanvasPoint(svg, event), {
        shift: event.shiftKey,
      });
    },
    [endPan, svgRef],
  );

  const onPointerCancel = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) endPan(svg);
      pressRef.current = null;
      handlersRef.current.onHoverEnd();
    },
    [endPan, svgRef],
  );

  const onPointerLeave = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    () => {
      // Deliberately does NOT end a pan: capture keeps the drag alive outside
      // the element, which is the whole reason for capturing it. Only the
      // hover highlight goes, and during a pan there is none to go.
      handlersRef.current.onHoverEnd();
    },
    [],
  );

  const rootHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave],
  );

  return { isPanning, rootHandlers };
}
