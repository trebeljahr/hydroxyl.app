"use client";

/**
 * All of the canvas's browser-event plumbing, and none of its meaning.
 *
 * This hook knows nothing about chemistry, nothing about the store and nothing
 * about the scene. It feeds raw pointer, wheel, key and resize events to the
 * pure gesture reducer in `./gesture-reducer.ts` and turns the effects it
 * returns into semantic callbacks — hover, select, drag, zoom, pan, resize.
 * WHAT a pointer means (which device pans, which zooms, what a second finger
 * does) is decided there and tested there; this file only listens and applies.
 *
 * EVERY DEVICE CAN NAVIGATE WITHOUT LEAVING THE CANVAS. The full mapping is in
 * the reducer's header; in short, a primary drag always belongs to the active
 * tool (so the marquee stays on a plain drag over empty space), and panning
 * and zooming live on inputs that never collide with it: the wheel and
 * two-finger scroll, Ctrl/Cmd + wheel and pinch, Space or the middle button,
 * and two fingers on a touch screen. The context menu is the reducer's too: a
 * right-click, a held finger or pen, or the keyboard's menu key.
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
 *    store's `panBy`. The reducer does the negation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import type { Vec2 } from "@starter/chem-core";
import type { ViewportSize } from "@/state";

import {
  GESTURE_IDLE,
  LONG_PRESS_MS,
  contextMenuSource,
  gestureZoomStep,
  isPanningState,
  isTouchGesture,
  reduceGesture,
  wheelIntent,
  type CanvasPointerModifiers,
  type ContextMenuSource,
  type GestureEffect,
  type GestureInput,
  type GesturePointer,
  type GestureState,
} from "./gesture-reducer";

export {
  CLICK_SLOP_PX,
  LONG_PRESS_MS,
  TOUCH_CLICK_SLOP_PX,
  type CanvasPointerModifiers,
  type ContextMenuSource,
} from "./gesture-reducer";

/**
 * THE DRAG TRIPLE IS SEPARATE FROM `onHover`, NOT A WIDENING OF IT.
 *
 * Hover is hard-suppressed while any button is down, and that suppression is
 * right: hover answers "what would I click", which is a question about a
 * pointer that is just sitting there. A drag frame asks a different question
 * — "what would I merge into" — and writes a different highlight.
 *
 * `onDragStart` fires ONCE, at the instant the pointer crosses the click
 * slop, and carries the DOWN point as `origin` rather than that sample's.
 *
 * `onDragCancel` covers pointercancel, Escape, a revoked capture, a hidden tab,
 * unmount and a second finger landing, and is NEVER followed by `onDragEnd`.
 * Every one of those paths has to be covered, because a gesture that opens a
 * store transaction and never closes it silently kills undo for the rest of
 * the session.
 */
export interface CanvasGestureHandlers {
  readonly onHover: (canvasPoint: Vec2) => void;
  readonly onHoverEnd: () => void;
  /** Primary press, before it is known whether this is a click or a drag. */
  readonly onPress: (
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onSelect: (
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onDragStart: (
    origin: Vec2,
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onDragMove: (
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onDragEnd: (
    canvasPoint: Vec2,
    modifiers: CanvasPointerModifiers,
  ) => void;
  readonly onDragCancel: () => void;
  readonly onZoom: (canvasAnchor: Vec2, factor: number) => void;
  /** Already negated: pass it straight to the store's `panBy`. */
  readonly onPan: (deltaScreen: Vec2) => void;
  readonly onPanStart: () => void;
  readonly onPanEnd: () => void;
  readonly onResize: (size: ViewportSize) => void;
  /**
   * A right-click, a long-press, or the keyboard's context-menu key. Whatever
   * press was in flight has already been ended — no click follows it and no
   * drag commits — so the consumer only has to open a menu.
   */
  readonly onContextMenu: (canvasPoint: Vec2, source: ContextMenuSource) => void;
}

/**
 * The one piece of editor state this hook is allowed to know about.
 *
 * `panTool` is a MODE, not a gesture: with the pan tool held, a primary drag
 * pans instead of drawing. It arrives as a prop rather than being read from
 * the store because this file's whole contract is that it knows nothing about
 * the store, the scene or chemistry.
 */
export interface CanvasGestureOptions {
  readonly panTool?: boolean | undefined;
}

export interface CanvasGestures {
  /** True only while a pan or pinch is in progress — for `cursor: grabbing`. */
  readonly isPanning: boolean;
  readonly rootHandlers: {
    readonly onPointerDown: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerMove: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerUp: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerCancel: React.PointerEventHandler<SVGSVGElement>;
    readonly onPointerLeave: React.PointerEventHandler<SVGSVGElement>;
    readonly onContextMenu: React.MouseEventHandler<SVGSVGElement>;
  };
}

/**
 * Safari's trackpad pinch. Not in TypeScript's DOM lib, because it is not a
 * standard — only the fields read here are declared.
 */
interface SafariGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Canvas-local px from a pointer/wheel event.
 *
 * The rect is measured per event rather than cached because the canvas can
 * move under the user without any event this hook sees — a side panel opens,
 * the window scrolls, a layout settles — and a stale rect offsets every pick
 * by a constant nobody thinks to look for.
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

function readPointer(
  svg: SVGSVGElement,
  event: React.PointerEvent<SVGSVGElement>,
): GesturePointer {
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    point: toCanvasPoint(svg, event),
    // Sampled PER EVENT: shift-to-constrain and the alt/spiro variant are
    // routinely pressed after the button goes down.
    modifiers: { shift: event.shiftKey, alt: event.altKey },
  };
}

/**
 * Elements that already mean something by "space".
 *
 * Space is the pan modifier, so it gets `preventDefault()` to stop the page
 * scrolling — but not when the user is typing into a field, and not when a
 * button has focus, where space is the activation key. Swallowing it there
 * would make the canvas chrome unreachable from the keyboard, which is a worse
 * bug than a page that scrolls behind the canvas.
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
  options: CanvasGestureOptions = {},
): CanvasGestures {
  /**
   * THE LATEST-REF PATTERN, and why it is not premature.
   *
   * The consumer's callbacks close over store state, so they are new functions
   * on every render — and the canvas re-renders on every hover change. If the
   * native wheel and key listeners depended on them, every one of those
   * renders would tear down and re-add a non-passive wheel listener, which is
   * one of the few DOM calls that makes the browser recompute whether it can
   * scroll on the compositor thread. Keeping the callbacks in a ref lets the
   * listeners attach exactly once per mount.
   */
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Read through a ref for the same reason: the pointerdown path must see the
  // current tool from a callback with an empty dependency list. Refreshed in
  // an effect, never during render; a tool change is a click, so the one
  // frame of lag cannot be observed.
  const panToolRef = useRef(options.panTool === true);
  useEffect(() => {
    panToolRef.current = options.panTool === true;
  });

  const stateRef = useRef<GestureState>(GESTURE_IDLE);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /**
   * What a hold timer calls when it runs out. A ref, filled once `dispatch`
   * exists, because the timer is armed from INSIDE `dispatch` and a callback
   * cannot name itself in its own initialiser.
   */
  const longPressFiredRef = useRef<(pointerId: number) => void>(() => undefined);
  const spaceRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panningRef = useRef(false);

  /**
   * Reduce one input and run its effects, in order. `event` is the DOM event
   * being reduced, for the one effect that needs it (`preventDefault`).
   *
   * `svg` is passed in rather than read from the ref where it matters: an
   * unmount cleanup runs after React has cleared the ref, and the releases it
   * owes must still reach the element.
   */
  const dispatch = useCallback(
    (
      input: GestureInput,
      event?: { preventDefault(): void },
      svg: SVGSVGElement | null = svgRef.current,
    ): void => {
      const { state, effects } = reduceGesture(stateRef.current, input);
      stateRef.current = state;
      // A hold timer belongs to one press and dies with it. The reducer would
      // ignore a stale one anyway; clearing it keeps an unmounted canvas from
      // being called back at all.
      if (state.kind !== "press" && longPressRef.current !== undefined) {
        clearTimeout(longPressRef.current);
        longPressRef.current = undefined;
      }
      const h = handlersRef.current;
      for (const effect of effects) {
        if (effect.kind === "armLongPress") {
          if (longPressRef.current !== undefined) clearTimeout(longPressRef.current);
          const pointerId = effect.pointerId;
          longPressRef.current = setTimeout(() => {
            longPressRef.current = undefined;
            longPressFiredRef.current(pointerId);
          }, LONG_PRESS_MS);
          continue;
        }
        applyEffect(effect, h, svg, event);
      }
      const panning = isPanningState(state);
      if (panning !== panningRef.current) {
        panningRef.current = panning;
        setIsPanning(panning);
      }
    },
    [svgRef],
  );
  useEffect(() => {
    longPressFiredRef.current = (pointerId) => {
      dispatch({ kind: "longPress", pointerId });
    };
  }, [dispatch]);

  /**
   * SPACE AS THE PAN MODIFIER, tracked on `window` rather than on the canvas
   * so it works before the canvas has focus — the user's hand is on the mouse,
   * not on the element.
   *
   * The blur and visibilitychange resets are not defensive noise: a key held
   * while the window loses focus never delivers its keyup, so alt-tabbing away
   * mid-hold would leave the canvas permanently convinced space is down. The
   * same events end any gesture in flight, which will never get its pointerup
   * either.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      if (consumesSpace(event.target)) return;
      // Suppressed on EVERY keydown, repeats included: each repeat carries its
      // own default action — scrolling the page.
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
      dispatch({ kind: "abort" });
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
  }, [dispatch]);

  /**
   * ESCAPE CANCELS THE GESTURE IN FLIGHT, and claims the key ONLY then.
   *
   * On `window` because the key has to work whatever has focus. The early
   * return when nothing is in flight is the important half: `ToolSlice.escape()`
   * — tool back to select, element buffer cleared — belongs to the editor
   * shell, and swallowing Escape unconditionally would make it unreachable.
   * Two Escapes therefore mean two things in sequence: cancel this drag, then
   * put the tool down.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (stateRef.current.kind === "idle") return;
      dispatch({ kind: "abort" });
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dispatch]);

  /**
   * A capture the browser took back. `lostpointercapture` arrives as neither
   * a pointerup nor a pointercancel — the element was moved in the DOM, or the
   * browser decided the gesture was over — so without this the drag would
   * stop receiving events with a transaction still open. It also fires after
   * every ordinary release, which the reducer treats as a no-op.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onLost = (event: Event): void => {
      dispatch({ kind: "lostCapture", pointerId: (event as PointerEvent).pointerId }, undefined, svg);
    };
    svg.addEventListener("lostpointercapture", onLost);
    return () => {
      svg.removeEventListener("lostpointercapture", onLost);
    };
  }, [dispatch, svgRef]);

  /**
   * WHEEL AND TRACKPAD, ATTACHED NATIVELY AND NON-PASSIVE. DO NOT REPLACE THIS
   * WITH React's `onWheel` PROP.
   *
   * React registers `wheel` once at the root as a PASSIVE listener, so
   * `preventDefault()` inside `onWheel` does nothing at all — no error, just a
   * page that scrolls, or on a trackpad pinch a whole page that zooms, out
   * from under the user. The only way to get a cancellable wheel event is to
   * add it to the element with `{ passive: false }`.
   *
   * The zoom anchor is the cursor. `zoomAt` in the store solves for the pan
   * exactly, including when the zoom clamp truncates the factor.
   *
   * The `gesture*` listeners are Safari's trackpad pinch, which Safari does
   * not report as ctrl + wheel. Cancelled unconditionally for the same reason
   * as the wheel: left alone, Safari zooms the whole page.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent): void => {
      // Unconditional, and before any early return: the page must not scroll
      // even on the events we decide are no-ops.
      event.preventDefault();
      const intent = wheelIntent({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        point: toCanvasPoint(svg, event),
      });
      if (intent === null) return;
      if (intent.kind === "zoom") {
        handlersRef.current.onZoom(intent.anchor, intent.factor);
      } else {
        // The same clear a grab-style pan does at its start: the hover answer
        // is stale the moment the view moves. It matters more here, because a
        // wheel moves no cursor and no pointermove follows to correct it — the
        // halo would stay on an atom that slid away from under the pointer.
        // A zoom needs no clear: it pins whatever is under the cursor.
        handlersRef.current.onHoverEnd();
        handlersRef.current.onPan(intent.delta);
      }
    };

    let gestureScale = 1;
    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      const factor = gestureZoomStep(gestureScale, gesture.scale);
      gestureScale = gesture.scale;
      // On an iPad the same pinch also arrives as two touch pointers, which
      // the reducer already turns into pan and zoom. Applying both would
      // zoom at twice the speed of the fingers.
      if (isTouchGesture(stateRef.current)) return;
      if (factor === 1) return;
      handlersRef.current.onZoom(toCanvasPoint(svg, gesture), factor);
    };
    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("gesturestart", onGestureStart, { passive: false });
    svg.addEventListener("gesturechange", onGestureChange, { passive: false });
    svg.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
      svg.removeEventListener("gestureend", onGestureEnd);
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

    // Seed immediately. Without it a jsdom test — or any environment with no
    // ResizeObserver — leaves the store on its 800x600 placeholder forever,
    // and `zoomToFit` frames the document against a viewport that does not
    // exist.
    //
    // BORDER box, and so is the observer below, and so is `toCanvasPoint`. One
    // box everywhere is the invariant that matters: pointer coordinates are
    // measured from the rect's origin, so a viewport sized from the CONTENT box
    // would offset every pick by the padding. The canvas is therefore required
    // to carry no padding and no border.
    const rect = svg.getBoundingClientRect();
    // A zero measurement means "not laid out yet", not "zero pixels wide".
    if (rect.width > 0 && rect.height > 0) {
      report({ width: rect.width, height: rect.height });
    }

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Read off the element rather than the entry so there is exactly one
        // measurement in this file and no way for the two to disagree.
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

  /**
   * Ends a gesture still in progress when the canvas unmounts. Cancelling the
   * DRAG matters more than releasing the capture: a Fast Refresh in the middle
   * of a drag would otherwise leave the store holding an open transaction
   * that nothing will ever close.
   */
  useEffect(() => {
    const svg = svgRef.current;
    return () => {
      dispatch({ kind: "abort" }, undefined, svg);
    };
  }, [dispatch, svgRef]);

  const onPointerDown = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      dispatch(
        {
          kind: "down",
          pointer: readPointer(svg, event),
          spaceHeld: spaceRef.current,
          panTool: panToolRef.current,
        },
        event,
        svg,
      );
    },
    [dispatch, svgRef],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      dispatch({ kind: "move", pointer: readPointer(svg, event) }, event, svg);
    },
    [dispatch, svgRef],
  );

  const onPointerUp = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      dispatch({ kind: "up", pointer: readPointer(svg, event) }, event, svg);
    },
    [dispatch, svgRef],
  );

  const onPointerCancel = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      dispatch({ kind: "cancel", pointerId: event.pointerId }, event);
    },
    [dispatch],
  );

  const onPointerLeave = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      dispatch({ kind: "leave" }, event);
    },
    [dispatch],
  );

  /**
   * The browser's `contextmenu`, from a right-click, a macOS ctrl-click, the
   * keyboard's menu key or Android's own long-press. The reducer decides; its
   * first effect is always the `preventDefault` that keeps the browser's menu
   * shut.
   */
  const onContextMenu = useCallback<React.MouseEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      const native = event.nativeEvent as MouseEvent & { readonly pointerType?: string };
      dispatch(
        {
          kind: "contextMenu",
          point: toCanvasPoint(svg, event),
          source: contextMenuSource({
            pointerType: native.pointerType,
            button: event.button,
            ctrlKey: event.ctrlKey,
          }),
        },
        event,
        svg,
      );
    },
    [dispatch, svgRef],
  );

  const rootHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onContextMenu,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onContextMenu],
  );

  return { isPanning, rootHandlers };
}

function applyEffect(
  effect: GestureEffect,
  h: CanvasGestureHandlers,
  svg: SVGSVGElement | null,
  event: { preventDefault(): void } | undefined,
): void {
  switch (effect.kind) {
    case "capture":
      if (svg) capturePointer(svg, effect.pointerId);
      return;
    case "release":
      if (svg) releasePointer(svg, effect.pointerId);
      return;
    case "preventDefault":
      event?.preventDefault();
      return;
    case "hover":
      h.onHover(effect.point);
      return;
    case "hoverEnd":
      h.onHoverEnd();
      return;
    case "press":
      h.onPress(effect.point, effect.modifiers);
      return;
    case "select":
      h.onSelect(effect.point, effect.modifiers);
      return;
    case "dragStart":
      h.onDragStart(effect.origin, effect.point, effect.modifiers);
      return;
    case "dragMove":
      h.onDragMove(effect.point, effect.modifiers);
      return;
    case "dragEnd":
      h.onDragEnd(effect.point, effect.modifiers);
      return;
    case "dragCancel":
      h.onDragCancel();
      return;
    case "panStart":
      h.onPanStart();
      return;
    case "pan":
      h.onPan(effect.delta);
      return;
    case "zoom":
      h.onZoom(effect.anchor, effect.factor);
      return;
    case "panEnd":
      h.onPanEnd();
      return;
    case "contextMenu":
      h.onContextMenu(effect.point, effect.source);
      return;
    case "armLongPress":
      // Run by `dispatch`, which owns the timer.
      return;
  }
}
