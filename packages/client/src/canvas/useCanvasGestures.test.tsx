/**
 * The gesture hook, driven through a host component.
 *
 * The canvas's other tests reach the hook only through `EditorCanvas`, which
 * means the branches that matter most here are never taken: jsdom dispatches
 * no real wheel events through React, and `EditorCanvas` cannot see a device
 * that reports scroll in lines rather than pixels. Those branches are exactly
 * the ones with a failure mode nobody would attribute to this file — a
 * Firefox mouse panning sixteen times too slowly, or a canvas stuck in pan
 * mode after the user alt-tabbed away mid-drag.
 *
 * Everything below drives the DOM the way a browser does: native `wheel` on
 * the element (the listener is attached imperatively and non-passively, so
 * React's synthetic system never sees it), and real `window` key events.
 */

import { act, render } from "@testing-library/react";
import { useRef } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  useCanvasGestures,
  CLICK_SLOP_PX,
  type CanvasGestureHandlers,
} from "./useCanvasGestures";

/**
 * One spy per callback, so a test can assert which gesture was recognised.
 *
 * Each `vi.fn` is given the handler's own signature rather than left bare: an
 * untyped mock is not assignable to `CanvasGestureHandlers`, and typing it
 * here also means a call recorded with the wrong argument shape is a compile
 * error instead of an assertion that quietly reads `undefined`.
 */
type HandlerSpies = {
  [K in keyof CanvasGestureHandlers]: Mock<CanvasGestureHandlers[K]>;
};

function makeHandlers(): HandlerSpies {
  return {
    onHover: vi.fn<CanvasGestureHandlers["onHover"]>(),
    onHoverEnd: vi.fn<CanvasGestureHandlers["onHoverEnd"]>(),
    onPress: vi.fn<CanvasGestureHandlers["onPress"]>(),
    onSelect: vi.fn<CanvasGestureHandlers["onSelect"]>(),
    onDragStart: vi.fn<CanvasGestureHandlers["onDragStart"]>(),
    onDragMove: vi.fn<CanvasGestureHandlers["onDragMove"]>(),
    onDragEnd: vi.fn<CanvasGestureHandlers["onDragEnd"]>(),
    onDragCancel: vi.fn<CanvasGestureHandlers["onDragCancel"]>(),
    onZoom: vi.fn<CanvasGestureHandlers["onZoom"]>(),
    onPan: vi.fn<CanvasGestureHandlers["onPan"]>(),
    onPanStart: vi.fn<CanvasGestureHandlers["onPanStart"]>(),
    onPanEnd: vi.fn<CanvasGestureHandlers["onPanEnd"]>(),
    onResize: vi.fn<CanvasGestureHandlers["onResize"]>(),
  };
}

function Host({ handlers }: { handlers: CanvasGestureHandlers }): ReactElement {
  const ref = useRef<SVGSVGElement | null>(null);
  const { rootHandlers } = useCanvasGestures(ref, handlers);
  return <svg data-canvas-root="true" ref={ref} {...rootHandlers} />;
}

function mount(handlers: CanvasGestureHandlers): {
  svg: SVGSVGElement;
  unmount: () => void;
} {
  // Stubbed on the PROTOTYPE and before the render, because the hook measures
  // the element in a mount effect: patching the instance afterwards would
  // arrive too late to be seen by the seed this file is here to test. jsdom
  // lays nothing out, so every real rect is zero.
  SVGSVGElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;

  const view = render(<Host handlers={handlers} />);
  const svg = document.querySelector('[data-canvas-root="true"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error("no canvas root");
  return { svg, unmount: view.unmount };
}

/** A real, cancelable native wheel event, as a browser delivers it. */
function wheel(
  svg: SVGSVGElement,
  init: {
    deltaY: number;
    deltaX?: number;
    deltaMode?: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY,
    deltaMode: init.deltaMode ?? 0,
    clientX: init.clientX ?? 400,
    clientY: init.clientY ?? 300,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  svg.dispatchEvent(event);
  return event;
}

function pointer(
  svg: SVGSVGElement,
  type: string,
  init: {
    x: number;
    y: number;
    button?: number;
    buttons?: number;
    pointerId?: number;
    pointerType?: "mouse" | "pen" | "touch";
  },
): void {
  const event = new MouseEvent(type, {
    clientX: init.x,
    clientY: init.y,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
    bubbles: true,
    cancelable: true,
  });
  // jsdom has no PointerEvent constructor in every version; React reads these
  // two fields off the native event and nothing else here needs the rest.
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse" });
  // `act` because starting a pan sets `isPanning`; without it React warns on
  // every drag test and the warning drowns out a real one.
  act(() => {
    svg.dispatchEvent(event);
  });
}

/** A finger, as a touch screen reports one. */
function finger(
  svg: SVGSVGElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  x: number,
  y: number,
): void {
  pointer(svg, type, {
    x,
    y,
    pointerId,
    pointerType: "touch",
    button: type === "pointermove" ? -1 : 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
  });
}

function key(type: "keydown" | "keyup", init: { repeat?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    code: "Space",
    repeat: init.repeat ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

let handlers: HandlerSpies;

beforeEach(() => {
  handlers = makeHandlers();
  // Every test starts with space up. A leaked keydown from a previous test
  // would turn the next left-drag into a pan and read as a hook bug.
  key("keyup");
});

describe("useCanvasGestures — wheel and trackpad", () => {
  it("cancels the page scroll on every wheel event", () => {
    const { svg } = mount(handlers);
    // Non-passive, or the browser ignores the preventDefault and the page
    // scrolls — or on a pinch, zooms — out from under the user. React's
    // onWheel prop is registered passively at the root, which is why this
    // listener is attached by hand.
    expect(wheel(svg, { deltaY: -100 }).defaultPrevented).toBe(true);
    expect(wheel(svg, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    // Including the ones the hook decides are no-ops.
    expect(wheel(svg, { deltaY: 0 }).defaultPrevented).toBe(true);
  });

  it("pans on a plain wheel, which is how a trackpad's two-finger scroll arrives", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaX: 12, deltaY: 30 });

    // The browser cannot tell a trackpad scroll from a mouse wheel. When the
    // wheel zoomed, two fingers on a trackpad zoomed too, and a laptop had no
    // way to pan at all without holding a key.
    expect(handlers.onPan).toHaveBeenCalledWith({ x: 12, y: 30 });
    expect(handlers.onZoom).not.toHaveBeenCalled();
  });

  it("turns Shift + a vertical wheel into a horizontal pan", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaY: 100, shiftKey: true });
    expect(handlers.onPan).toHaveBeenCalledWith({ x: 100, y: 0 });
  });

  it("zooms on Ctrl + wheel, which is also how a trackpad pinch arrives", () => {
    const { svg } = mount(handlers);

    wheel(svg, { deltaY: -100, ctrlKey: true });
    const zoomIn = handlers.onZoom.mock.calls[0]?.[1] as number;
    expect(zoomIn).toBeGreaterThan(1);

    wheel(svg, { deltaY: 100, ctrlKey: true });
    const zoomOut = handlers.onZoom.mock.calls[1]?.[1] as number;
    expect(zoomOut).toBeLessThan(1);

    // Exponential in scroll distance, so scrolling back exactly undoes it.
    expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
    expect(handlers.onPan).not.toHaveBeenCalled();
  });

  it("zooms on Cmd + wheel as well, so nobody has to know which one this editor picked", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaY: -100, metaKey: true });
    expect(handlers.onZoom).toHaveBeenCalledTimes(1);
    expect(handlers.onPan).not.toHaveBeenCalled();
  });

  it("reads a line-mode delta as 16px, so a Firefox mouse pans like a trackpad", () => {
    const { svg } = mount(handlers);

    // deltaMode 1 is DOM_DELTA_LINE. Three lines must mean 48 pixels; without
    // the normalisation it would mean three and the wheel would feel dead.
    wheel(svg, { deltaY: 3, deltaMode: 1 });
    expect(handlers.onPan).toHaveBeenCalledWith({ x: 0, y: 48 });
  });

  it("reads a page-mode delta as 100px", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaY: 2, deltaMode: 2 });
    expect(handlers.onPan).toHaveBeenCalledWith({ x: 0, y: 200 });
  });

  it("caps one violent zoom flick rather than jumping several octaves", () => {
    const { svg } = mount(handlers);

    wheel(svg, { deltaY: -10000, ctrlKey: true });
    const factor = handlers.onZoom.mock.calls[0]?.[1] as number;
    // Uncapped, exp(10000 * 0.01) is 2.7e43: one flick of a free-spinning
    // wheel would take the canvas straight to MAX_ZOOM with nothing on screen.
    expect(factor).toBeLessThanOrEqual(1.25);
  });

  it("anchors the zoom at the cursor, in canvas-local coordinates", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaY: -100, clientX: 123, clientY: 45, ctrlKey: true });

    // The store's zoomAt solves for the pan that pins the anchor; a hook that
    // passed the centre instead would slide the structure out from under the
    // cursor.
    expect(handlers.onZoom).toHaveBeenCalledWith({ x: 123, y: 45 }, expect.any(Number));
  });

  it("zooms on Safari's own pinch events, and cancels them", () => {
    const { svg } = mount(handlers);
    // Safari reports a trackpad pinch as gesture events carrying a CUMULATIVE
    // scale, not as ctrl + wheel. Left uncancelled, it zooms the whole page.
    const gesture = (type: string, scale: number): Event => {
      const event = new UIEvent(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 200, clientY: 100 });
      svg.dispatchEvent(event);
      return event;
    };
    expect(gesture("gesturestart", 1).defaultPrevented).toBe(true);
    expect(gesture("gesturechange", 1.5).defaultPrevented).toBe(true);
    gesture("gesturechange", 1.8);
    expect(gesture("gestureend", 1.8).defaultPrevented).toBe(true);

    const factors = handlers.onZoom.mock.calls.map((c) => c[1] as number);
    expect(factors).toHaveLength(2);
    // Incremental steps whose product is the gesture's total scale.
    expect(factors[0]).toBeCloseTo(1.5, 10);
    expect((factors[0] as number) * (factors[1] as number)).toBeCloseTo(1.8, 10);
    expect(handlers.onZoom).toHaveBeenCalledWith({ x: 200, y: 100 }, expect.any(Number));
  });

  it("stops listening once unmounted", () => {
    const { svg, unmount } = mount(handlers);
    // A real unmount, not an emptied body: clearing innerHTML detaches the
    // node without running React's cleanup, so the listener would still be on
    // it and this test would pass for the wrong reason.
    unmount();
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    svg.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true }),
    );
    expect(handlers.onZoom).not.toHaveBeenCalled();
    expect(handlers.onPan).not.toHaveBeenCalled();
  });
});

describe("useCanvasGestures — touch", () => {
  it("lets one finger do what the tool does, and a tap select", () => {
    const { svg } = mount(handlers);
    finger(svg, "pointerdown", 7, 100, 100);
    // A fingertip wobbles more than a mouse. 6px is inside the touch slop.
    finger(svg, "pointermove", 7, 106, 100);
    finger(svg, "pointerup", 7, 106, 100);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    expect(handlers.onPanStart).not.toHaveBeenCalled();
  });

  it("pans and pinch-zooms with two fingers, and never selects on the way out", () => {
    const { svg } = mount(handlers);
    finger(svg, "pointerdown", 7, 100, 100);
    finger(svg, "pointerdown", 8, 200, 100);
    expect(handlers.onPanStart).toHaveBeenCalledTimes(1);

    // Spread symmetrically: the centroid stays put and the span doubles.
    finger(svg, "pointermove", 7, 50, 100);
    finger(svg, "pointermove", 8, 250, 100);
    const factors = handlers.onZoom.mock.calls.map((c) => c[1] as number);
    expect(factors.reduce((a, b) => a * b, 1)).toBeCloseTo(2, 10);

    finger(svg, "pointerup", 7, 50, 100);
    finger(svg, "pointerup", 8, 250, 100);
    expect(handlers.onPanEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onDragStart).not.toHaveBeenCalled();
  });

  it("cancels a marquee the first finger had started when a second one lands", () => {
    // The drag may hold an open store transaction. The second finger used to
    // overwrite the first finger's press, and that transaction was never
    // closed: undo went dead for the rest of the session.
    const { svg } = mount(handlers);
    finger(svg, "pointerdown", 7, 100, 100);
    finger(svg, "pointermove", 7, 140, 100);
    expect(handlers.onDragStart).toHaveBeenCalledTimes(1);

    finger(svg, "pointerdown", 8, 300, 300);
    expect(handlers.onDragCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onPanStart).toHaveBeenCalledTimes(1);
    // Cancel strictly before the pan starts: see the reducer's header.
    expect(handlers.onDragCancel.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.onPanStart.mock.invocationCallOrder[0] as number,
    );

    finger(svg, "pointerup", 7, 140, 100);
    finger(svg, "pointerup", 8, 300, 300);
    expect(handlers.onDragEnd).not.toHaveBeenCalled();
    expect(handlers.onPanEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores Safari's pinch events while fingers already drive the pinch", () => {
    const { svg } = mount(handlers);
    finger(svg, "pointerdown", 7, 100, 100);
    finger(svg, "pointerdown", 8, 200, 100);
    const event = new UIEvent("gesturechange", { bubbles: true, cancelable: true });
    Object.assign(event, { scale: 3, clientX: 150, clientY: 100 });
    svg.dispatchEvent(event);
    // An iPad reports the same pinch both ways; applying both would zoom at
    // twice the speed of the fingers.
    expect(handlers.onZoom).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("useCanvasGestures — the space modifier", () => {
  it("suppresses the page scroll on a repeat, not only on the first keydown", () => {
    mount(handlers);

    expect(key("keydown").defaultPrevented).toBe(true);
    // Auto-repeat fires at ~30Hz while held. Each repeat carries its own
    // default action, so skipping preventDefault on repeats scrolls the page
    // for as long as the user holds the pan modifier.
    expect(key("keydown", { repeat: true }).defaultPrevented).toBe(true);
  });

  it("turns a left drag into a pan while held", () => {
    const { svg } = mount(handlers);
    key("keydown");

    pointer(svg, "pointerdown", { x: 100, y: 100, button: 0, buttons: 1 });
    pointer(svg, "pointermove", { x: 130, y: 90, buttons: 1 });

    // Negated: the drawing follows the pointer, so the viewport moves the
    // other way. Dragging right must move the structure right.
    expect(handlers.onPan).toHaveBeenCalledWith({ x: -30, y: 10 });
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("clears the held state on blur, so alt-tabbing does not strand the canvas", () => {
    const { svg } = mount(handlers);
    key("keydown");

    // The keyup never arrives when the window loses focus mid-hold. Without
    // this reset the canvas is permanently convinced space is down and every
    // click pans instead of selecting, with no way out but a reload.
    window.dispatchEvent(new Event("blur"));

    pointer(svg, "pointerdown", { x: 100, y: 100, button: 0, buttons: 1 });
    pointer(svg, "pointerup", { x: 100, y: 100, button: 0 });

    expect(handlers.onPan).not.toHaveBeenCalled();
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("clears the held state when the tab is hidden", () => {
    const { svg } = mount(handlers);
    key("keydown");
    document.dispatchEvent(new Event("visibilitychange"));

    pointer(svg, "pointerdown", { x: 10, y: 10, button: 0, buttons: 1 });
    pointer(svg, "pointerup", { x: 10, y: 10, button: 0 });

    expect(handlers.onPan).not.toHaveBeenCalled();
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores space typed into a text field", () => {
    mount(handlers);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = new KeyboardEvent("keydown", {
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    // Swallowing the space bar in a caption field would be a maddening bug.
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });
});

describe("useCanvasGestures — click versus drag", () => {
  it("selects on a press that did not move", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 200, y: 150, button: 0, buttons: 1 });
    pointer(svg, "pointerup", { x: 200, y: 150, button: 0 });

    expect(handlers.onSelect).toHaveBeenCalledWith(
      { x: 200, y: 150 },
      { shift: false, alt: false },
    );
  });

  it("does not select after a drag past the slop threshold", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 200, y: 150, button: 0, buttons: 1 });
    pointer(svg, "pointermove", { x: 200 + CLICK_SLOP_PX + 6, y: 150, buttons: 1 });
    pointer(svg, "pointerup", { x: 200 + CLICK_SLOP_PX + 6, y: 150, button: 0 });

    // Without the threshold, every pan that happens to end over empty space
    // also clears the selection.
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("still selects through a hand tremor inside the slop", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 200, y: 150, button: 0, buttons: 1 });
    pointer(svg, "pointermove", { x: 201, y: 151, buttons: 1 });
    pointer(svg, "pointerup", { x: 201, y: 151, button: 0 });

    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("pans on a middle-button drag with no modifier", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 1, buttons: 4 });
    pointer(svg, "pointermove", { x: 110, y: 120, buttons: 4 });
    pointer(svg, "pointerup", { x: 110, y: 120, button: 1 });

    expect(handlers.onPan).toHaveBeenCalledWith({ x: -10, y: -20 });
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("reports pan deltas per move, not cumulatively", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 1, buttons: 4 });
    pointer(svg, "pointermove", { x: 110, y: 100, buttons: 4 });
    pointer(svg, "pointermove", { x: 120, y: 100, buttons: 4 });

    // `panBy` is incremental. A delta measured from the drag origin would
    // apply the whole drag again on every event and the canvas would race off.
    //
    // Compared componentwise rather than with `toEqual` on the objects: the
    // unchanged axis is `-(100 - 100)`, i.e. NEGATIVE zero, and `toEqual`
    // separates -0 from 0. It is numerically equal and harmless downstream —
    // the same signed-zero that `modelToPx` produces at the origin — so the
    // assertion should not be the place that cares.
    const deltas = handlers.onPan.mock.calls.map((c) => c[0] as { x: number; y: number });
    expect(deltas).toHaveLength(2);
    for (const delta of deltas) {
      expect(delta.x).toBe(-10);
      expect(delta.y === 0).toBe(true);
    }
  });

  it("ignores a right-press entirely", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 50, y: 50, button: 2, buttons: 2 });
    pointer(svg, "pointerup", { x: 50, y: 50, button: 2 });

    // A right-press belongs to the context menu; tracking it would fire a
    // select on its release.
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onPan).not.toHaveBeenCalled();
  });
});

describe("useCanvasGestures — hover", () => {
  it("reports a hover only while no button is down", () => {
    const { svg } = mount(handlers);

    pointer(svg, "pointermove", { x: 40, y: 60, buttons: 0 });
    expect(handlers.onHover).toHaveBeenCalledWith({ x: 40, y: 60 });

    handlers.onHover.mockClear();
    pointer(svg, "pointerdown", { x: 40, y: 60, button: 0, buttons: 1 });
    pointer(svg, "pointermove", { x: 45, y: 60, buttons: 1 });
    // Mid-gesture the answer is either irrelevant or about to change.
    expect(handlers.onHover).not.toHaveBeenCalled();
  });

  it("ends the hover when the pointer leaves", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointermove", { x: 40, y: 60, buttons: 0 });
    // React synthesises onPointerLeave from the native `pointerout`; a
    // dispatched `pointerleave` reaches no React handler at all, which is why
    // this drives the event the browser actually sends.
    pointer(svg, "pointerout", { x: -5, y: 60, buttons: 0 });

    expect(handlers.onHoverEnd).toHaveBeenCalled();
  });
});

describe("useCanvasGestures — size", () => {
  it("seeds the measured size on mount rather than leaving the placeholder", () => {
    mount(handlers);
    // The store's viewport starts at an 800x600 placeholder, and `zoomToFit`
    // runs against whatever is there. `mount` stubs the rect to 800x600, so
    // the assertion is that a measurement happened at all.
    expect(handlers.onResize).toHaveBeenCalledWith({ width: 800, height: 600 });
  });
});

/**
 * The drag surface, which is what turns a read-only canvas into a drawable one.
 *
 * The cases that matter are the abnormal exits. A drag that opens a store
 * transaction and never closes it kills undo for the rest of the session, with
 * nothing thrown and nothing logged — so every route out of a gesture
 * (pointerup, pointercancel, Escape, a lost capture, a window that lost focus,
 * an unmount) has to produce exactly one of `onDragEnd` or `onDragCancel`.
 */
describe("useCanvasGestures — dragging", () => {
  const FAR = CLICK_SLOP_PX + 20;

  function startDrag(svg: SVGSVGElement): void {
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 0, buttons: 1 });
    pointer(svg, "pointermove", { x: 100 + FAR, y: 100, buttons: 1 });
  }

  it("fires the drag triple once each, anchored on the DOWN point", () => {
    const { svg } = mount(handlers);
    startDrag(svg);

    expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
    // The origin is where the button went down, not where the threshold was
    // crossed: four pixels later the hit test would sometimes answer with the
    // neighbouring bond instead of the atom the user aimed at.
    expect(handlers.onDragStart).toHaveBeenCalledWith(
      { x: 100, y: 100 },
      { x: 100 + FAR, y: 100 },
      { shift: false, alt: false },
    );

    pointer(svg, "pointermove", { x: 100 + FAR, y: 140, buttons: 1 });
    expect(handlers.onDragMove).toHaveBeenCalledTimes(1);
    expect(handlers.onDragStart).toHaveBeenCalledTimes(1);

    pointer(svg, "pointerup", { x: 100 + FAR, y: 140, button: 0 });
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onDragCancel).not.toHaveBeenCalled();
    // A gesture is a click or a drag, never both.
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("reports a press before it knows whether this is a click or a drag", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 0, buttons: 1 });
    expect(handlers.onPress).toHaveBeenCalledWith(
      { x: 100, y: 100 },
      { shift: false, alt: false },
    );
    expect(handlers.onDragStart).not.toHaveBeenCalled();
  });

  it("takes pointer capture at pointerdown, not at the threshold", () => {
    // By the time a fast flick has travelled its four pixels it may already be
    // outside the element, and `setPointerCapture` on a pointer whose events
    // you no longer receive never happens — the drag then loses its pointerup
    // and leaves the transaction open.
    const captured: number[] = [];
    SVGSVGElement.prototype.setPointerCapture = function (id: number) {
      captured.push(id);
    };
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 0, buttons: 1 });
    expect(captured).toEqual([1]);
  });

  it("cancels on Escape, and the pointerup that follows commits nothing", () => {
    const { svg } = mount(handlers);
    startDrag(svg);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(handlers.onDragCancel).toHaveBeenCalledTimes(1);

    pointer(svg, "pointerup", { x: 100 + FAR, y: 100, button: 0 });
    expect(handlers.onDragEnd).not.toHaveBeenCalled();
    // And still not a click: cancelling a drag does not turn it back into one.
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("leaves Escape alone when no gesture is in flight", () => {
    // `ToolSlice.escape()` — tool back to select, palette closed — belongs to
    // the editor shell. Swallowing Escape unconditionally would make it
    // unreachable, and the canvas has no business claiming a key it is not
    // using.
    mount(handlers);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(handlers.onDragCancel).not.toHaveBeenCalled();
  });

  it("cancels a drag the window lost focus during", () => {
    // A tab switch mid-drag delivers no pointerup, ever. Without this the
    // transaction stays open for the rest of the session.
    const { svg } = mount(handlers);
    startDrag(svg);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(handlers.onDragCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a drag still in flight when the canvas unmounts", () => {
    const { svg, unmount } = mount(handlers);
    startDrag(svg);
    act(() => {
      unmount();
    });
    expect(handlers.onDragCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on pointercancel", () => {
    const { svg } = mount(handlers);
    startDrag(svg);
    pointer(svg, "pointercancel", { x: 100 + FAR, y: 100 });
    expect(handlers.onDragCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onDragEnd).not.toHaveBeenCalled();
  });

  it("brackets a pan with panStart and panEnd", () => {
    const { svg } = mount(handlers);
    pointer(svg, "pointerdown", { x: 100, y: 100, button: 1, buttons: 4 });
    expect(handlers.onPanStart).toHaveBeenCalledTimes(1);
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    pointer(svg, "pointermove", { x: 150, y: 100, buttons: 4 });
    pointer(svg, "pointerup", { x: 150, y: 100, button: 1 });
    expect(handlers.onPanEnd).toHaveBeenCalledTimes(1);
  });
});
