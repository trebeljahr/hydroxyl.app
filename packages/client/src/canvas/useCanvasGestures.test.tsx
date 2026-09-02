/**
 * The gesture hook, driven through a host component.
 *
 * The canvas's other tests reach the hook only through `EditorCanvas`, which
 * means the branches that matter most here are never taken: jsdom dispatches
 * no real wheel events through React, and `EditorCanvas` cannot see a device
 * that reports scroll in lines rather than pixels. Those branches are exactly
 * the ones with a failure mode nobody would attribute to this file — a
 * Firefox mouse zooming sixteen times too slowly, or a canvas stuck in pan
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
    onSelect: vi.fn<CanvasGestureHandlers["onSelect"]>(),
    onZoom: vi.fn<CanvasGestureHandlers["onZoom"]>(),
    onPan: vi.fn<CanvasGestureHandlers["onPan"]>(),
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
  init: { deltaY: number; deltaMode?: number; clientX?: number; clientY?: number },
): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY: init.deltaY,
    deltaMode: init.deltaMode ?? 0,
    clientX: init.clientX ?? 400,
    clientY: init.clientY ?? 300,
    bubbles: true,
    cancelable: true,
  });
  svg.dispatchEvent(event);
  return event;
}

function pointer(
  svg: SVGSVGElement,
  type: string,
  init: { x: number; y: number; button?: number; buttons?: number },
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
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  // `act` because starting a pan sets `isPanning`; without it React warns on
  // every drag test and the warning drowns out a real one.
  act(() => {
    svg.dispatchEvent(event);
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

describe("useCanvasGestures — wheel", () => {
  it("cancels the page scroll on every wheel event", () => {
    const { svg } = mount(handlers);
    // Non-passive, or the browser ignores the preventDefault and the page
    // scrolls out from under the user while they zoom. React's onWheel prop
    // is registered passively at the root, which is why this listener is
    // attached by hand.
    expect(wheel(svg, { deltaY: -100 }).defaultPrevented).toBe(true);
    // Including the ones the hook decides are no-ops.
    expect(wheel(svg, { deltaY: 0 }).defaultPrevented).toBe(true);
  });

  it("zooms in when the wheel scrolls away and out when it scrolls back", () => {
    const { svg } = mount(handlers);

    wheel(svg, { deltaY: -100 });
    const zoomIn = handlers.onZoom.mock.calls[0]?.[1] as number;
    expect(zoomIn).toBeGreaterThan(1);

    wheel(svg, { deltaY: 100 });
    const zoomOut = handlers.onZoom.mock.calls[1]?.[1] as number;
    expect(zoomOut).toBeLessThan(1);

    // Exponential in scroll distance, so scrolling back exactly undoes it.
    // A linear rate would not have this property and a user would drift.
    expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
  });

  it("reads a line-mode delta as 16px, so a Firefox mouse zooms like a trackpad", () => {
    const { svg } = mount(handlers);

    // deltaMode 1 is DOM_DELTA_LINE. Three lines must mean the same thing as
    // 48 pixels; without the normalisation it would mean three pixels and the
    // wheel would feel dead on every device that reports lines.
    wheel(svg, { deltaY: -3, deltaMode: 1 });
    wheel(svg, { deltaY: -48, deltaMode: 0 });

    const [lines, pixels] = handlers.onZoom.mock.calls.map((c) => c[1] as number);
    expect(lines).toBeCloseTo(pixels as number, 12);
  });

  it("reads a page-mode delta as 100px", () => {
    const { svg } = mount(handlers);

    wheel(svg, { deltaY: -2, deltaMode: 2 });
    wheel(svg, { deltaY: -200, deltaMode: 0 });

    const [pages, pixels] = handlers.onZoom.mock.calls.map((c) => c[1] as number);
    expect(pages).toBeCloseTo(pixels as number, 12);
  });

  it("clamps one violent flick rather than jumping several octaves", () => {
    const { svg } = mount(handlers);

    wheel(svg, { deltaY: -10000 });
    const factor = handlers.onZoom.mock.calls[0]?.[1] as number;
    // Unclamped, exp(10000 * 0.002) is about 5e8: one flick of a free-spinning
    // wheel would take the canvas straight to MAX_ZOOM with nothing on screen.
    expect(factor).toBeLessThanOrEqual(4);

    wheel(svg, { deltaY: 10000 });
    expect(handlers.onZoom.mock.calls[1]?.[1] as number).toBeGreaterThanOrEqual(
      1 / 4,
    );
  });

  it("anchors the zoom at the cursor, in canvas-local coordinates", () => {
    const { svg } = mount(handlers);
    wheel(svg, { deltaY: -100, clientX: 123, clientY: 45 });

    // The element's origin is (0,0) here, so client and canvas coordinates
    // coincide; the point is that the ANCHOR is passed through at all — the
    // store's zoomAt solves for the pan that pins it, and a hook that passed
    // the centre instead would zoom about the middle and slide the structure.
    expect(handlers.onZoom).toHaveBeenCalledWith({ x: 123, y: 45 }, expect.any(Number));
  });

  it("stops listening once unmounted", () => {
    const { svg, unmount } = mount(handlers);
    // A real unmount, not an emptied body: clearing innerHTML detaches the
    // node without running React's cleanup, so the listener would still be on
    // it and this test would pass for the wrong reason. A non-passive wheel
    // listener left attached to a detached node keeps the subtree alive.
    unmount();
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    expect(handlers.onZoom).not.toHaveBeenCalled();
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
      { shift: false },
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
