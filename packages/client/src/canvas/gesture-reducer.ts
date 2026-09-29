/**
 * The canvas's gesture model as a pure reducer: raw pointer and wheel input in,
 * a new state and a list of effects out. No DOM, no React, no store.
 *
 * `useCanvasGestures` is the thin shell that feeds this reducer browser events
 * and runs the effects it returns. Every decision about what a pointer MEANS
 * lives here instead, so the whole mapping can be tested with synthetic input
 * in a plain node process. The hook used to hold these decisions in refs, and
 * the one real bug it had was one no test could reach: a second finger landing
 * mid-drag overwrote the first finger's press, so the drag it had opened never
 * received its end or its cancel, and the store transaction it held stayed
 * open.
 *
 * ── THE MAPPING (decision 106) ───────────────────────────────────────────────
 *
 * The rule is: ONE finger or the primary button does what the active tool
 * does, and navigating never needs the tool rail. Every device therefore has a
 * way to pan and zoom that leaves the left drag free for the marquee.
 *
 *   Mouse, pen   left drag on empty canvas     tool gesture (marquee with Select)
 *                middle drag                   pan
 *                Space + left drag             pan (spring-loaded; release = back)
 *                wheel                         pan (Shift + wheel = horizontal)
 *                Ctrl/Cmd + wheel              zoom about the cursor
 *   Trackpad     two-finger scroll             pan (the browser sends a wheel)
 *                pinch                         zoom about the pinch (ctrl + wheel)
 *   Touch        one finger                    tool gesture, tap = click
 *                two fingers                   pan and pinch-zoom together; the
 *                                              second finger CANCELS a tool
 *                                              gesture the first had started
 *   Any          Pan tool (G)                  a primary drag pans
 *
 * ── AND THE CONTEXT MENU ──────────────────────────────────────────────────────
 *
 *   Mouse        right-click, macOS ctrl-click the canvas context menu
 *   Touch, pen   hold still for LONG_PRESS_MS    the same menu; the release
 *                                                afterwards clicks nothing
 *   Keyboard     context-menu key, Shift+F10   the same menu, on the focused atom
 *
 * The browser's own menu never opens on the canvas. A request mid-drag or
 * mid-pan opens nothing: a menu about a structure still moving under it would
 * describe the wrong thing.
 *
 * Wheel = pan and Ctrl/Cmd + wheel = zoom is what Figma, tldraw, Excalidraw
 * and Ketcher do, and it is the only mapping under which a trackpad can pan at
 * all without a modifier: the browser cannot tell a trackpad scroll from a
 * mouse wheel, so "wheel zooms" makes two-finger scrolling zoom. The cost is
 * that a mouse user now holds Ctrl/Cmd to zoom, which the same four tools
 * already taught them.
 *
 * ── EFFECTS, NOT CALLBACKS ───────────────────────────────────────────────────
 *
 * The reducer returns effects in the order they must run. Order matters in one
 * place above all: when a second finger turns a drag into a pinch, `dragCancel`
 * comes before `panStart`, because the interaction machine treats `panStart` as
 * "the pointer is no longer yours" and would otherwise drop the drag's open
 * transaction without aborting it.
 */

import type { Vec2 } from "@starter/chem-core";

/**
 * How far a MOUSE or PEN may travel between down and up and still count as a
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
 * The same threshold for a FINGER, in canvas px.
 *
 * A fingertip is a blob several millimetres across whose centroid wanders as
 * it presses, so a deliberate tap routinely travels more than 4px. At the mouse
 * threshold a tap on an atom became a zero-length marquee and cleared the
 * selection instead of making one. 8 is Android's default touch slop in dp.
 */
export const TOUCH_CLICK_SLOP_PX = 8;

/**
 * Wheel-delta-to-zoom rate for Ctrl/Cmd + wheel and trackpad pinch, in
 * inverse px. The factor is `exp(-delta * rate)`.
 *
 * Exponential, so zooming back by the same distance undoes the zoom exactly
 * and a notch feels the same at every scale. 0.01 because Chromium reports a
 * pinch as ctrl + wheel with a deltaY of about -100·ln(scale): at this rate the
 * drawing grows exactly as fast as the fingers spread.
 */
export const WHEEL_ZOOM_RATE = 0.01;

/**
 * Per-event cap on the zoom delta, in px, applied BEFORE the exponential.
 *
 * A mouse notch is 100px or more, which at the pinch rate would be ×2.7 per
 * notch. Capping at 20 gives a notch ×1.22 — about 3.5 notches per doubling,
 * the step the editor had before this rate changed — while leaving a pinch,
 * whose per-frame deltas sit well under 20, tracking the fingers 1:1. It also
 * stops one free-spinning flick from jumping several octaves in a frame.
 */
export const WHEEL_ZOOM_DELTA_CAP_PX = 20;

/**
 * `deltaMode` normalisation. A wheel event may quote its delta in pixels (0),
 * lines (1) or pages (2), depending on the browser, the OS and the device —
 * Firefox on a mouse still reports lines. These are the conventional px
 * equivalents; they only have to be roughly right.
 */
export const LINE_DELTA_PX = 16;
export const PAGE_DELTA_PX = 100;

/**
 * Two touch points closer than this cannot give a meaningful span ratio.
 * Fingers never get this close; the guard is for a synthetic or degenerate
 * input that would otherwise divide by zero or zoom by a wild ratio.
 */
const MIN_PINCH_SPAN_PX = 1;

/**
 * How long a finger or pen must be held, inside its click slop, before the
 * press becomes a context-menu request instead of a click.
 *
 * 500 ms is the long-press threshold iOS and Android both ship with, so a
 * finger trained on either lands on the same beat. Radix's own ContextMenu
 * waits 700 ms and gives up on ANY pointermove — and under `touch-action:
 * none` a resting finger reports a move for every pixel of tremor, so a hold
 * there fails more often than it opens. Holding it to the click slop instead
 * makes "a press that did not move" mean one thing for the tap and the hold.
 */
export const LONG_PRESS_MS = 500;

/**
 * How a context menu was asked for. The point means something for the first
 * two; a KEYBOARD request carries whatever coordinates the browser invented,
 * so its consumer places the menu itself.
 */
export type ContextMenuSource = "pointer" | "touch" | "keyboard";

/**
 * Which of the three a native `contextmenu` event is.
 *
 * `pointerType` tells them apart where the browser says: Chromium dispatches
 * `contextmenu` as a PointerEvent, with "" for the keyboard. Where it does not
 * (a bare MouseEvent), a keyboard request is the one with no right button and
 * no ctrl — a right-click reports button 2 and a macOS ctrl-click ctrlKey.
 */
export function contextMenuSource(event: {
  readonly pointerType: string | undefined;
  readonly button: number;
  readonly ctrlKey: boolean;
}): ContextMenuSource {
  if (event.pointerType === "touch" || event.pointerType === "pen") return "touch";
  if (event.pointerType === "") return "keyboard";
  if (event.pointerType === undefined && event.button !== 2 && !event.ctrlKey) {
    return "keyboard";
  }
  return "pointer";
}

export interface CanvasPointerModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
}

/** One pointer event, reduced to the fields the model reads. */
export interface GesturePointer {
  readonly pointerId: number;
  /** "mouse", "pen" or "touch". Anything else is treated like a mouse. */
  readonly pointerType: string;
  /** The button that changed, for down and up. */
  readonly button: number;
  /** Every button held, for move — 0 means a hovering pointer. */
  readonly buttons: number;
  /** Canvas-local px. */
  readonly point: Vec2;
  readonly modifiers: CanvasPointerModifiers;
}

export type GestureInput =
  | {
      readonly kind: "down";
      readonly pointer: GesturePointer;
      /** Space is held: a primary press pans. */
      readonly spaceHeld: boolean;
      /** The Pan tool is active: a primary press pans. */
      readonly panTool: boolean;
    }
  | { readonly kind: "move"; readonly pointer: GesturePointer }
  | { readonly kind: "up"; readonly pointer: GesturePointer }
  /** `pointercancel`: the browser took the pointer away. */
  | { readonly kind: "cancel"; readonly pointerId: number }
  /**
   * `lostpointercapture`. Separate from `cancel` because it also fires after
   * every NORMAL release, for a pointer this model has already let go of, and
   * that one must be a silent no-op — clearing hover there would wipe the
   * highlight after every click.
   */
  | { readonly kind: "lostCapture"; readonly pointerId: number }
  /** Escape, a lost window focus, a hidden tab, an unmount: end everything. */
  | { readonly kind: "abort" }
  | { readonly kind: "leave" }
  /** The timer an `armLongPress` asked for has run out. */
  | { readonly kind: "longPress"; readonly pointerId: number }
  /** A native `contextmenu` event on the canvas. */
  | { readonly kind: "contextMenu"; readonly point: Vec2; readonly source: ContextMenuSource };

export type GestureEffect =
  | { readonly kind: "capture"; readonly pointerId: number }
  | { readonly kind: "release"; readonly pointerId: number }
  /** Cancel the browser's default for the event being reduced. */
  | { readonly kind: "preventDefault" }
  | { readonly kind: "hover"; readonly point: Vec2 }
  | { readonly kind: "hoverEnd" }
  | {
      readonly kind: "press";
      readonly point: Vec2;
      readonly modifiers: CanvasPointerModifiers;
    }
  | {
      readonly kind: "select";
      readonly point: Vec2;
      readonly modifiers: CanvasPointerModifiers;
    }
  | {
      readonly kind: "dragStart";
      readonly origin: Vec2;
      readonly point: Vec2;
      readonly modifiers: CanvasPointerModifiers;
    }
  | {
      readonly kind: "dragMove";
      readonly point: Vec2;
      readonly modifiers: CanvasPointerModifiers;
    }
  | {
      readonly kind: "dragEnd";
      readonly point: Vec2;
      readonly modifiers: CanvasPointerModifiers;
    }
  | { readonly kind: "dragCancel" }
  | { readonly kind: "panStart" }
  /** Already negated: pass it straight to the store's `panBy`. */
  | { readonly kind: "pan"; readonly delta: Vec2 }
  | { readonly kind: "zoom"; readonly anchor: Vec2; readonly factor: number }
  | { readonly kind: "panEnd" }
  /**
   * Start a `LONG_PRESS_MS` timer that reports back as a `longPress` input.
   * The reducer re-checks the press when it does, so a timer that outlives
   * its press is harmless.
   */
  | { readonly kind: "armLongPress"; readonly pointerId: number }
  | { readonly kind: "contextMenu"; readonly point: Vec2; readonly source: ContextMenuSource };

interface Contact {
  readonly pointerId: number;
  readonly point: Vec2;
}

/**
 * At most one gesture at a time, and the state says which.
 *
 * `press` is a primary press that may become a click or a tool drag. `moved`
 * is latched: a drag that wanders back to its origin was still a drag. It is
 * separate from `dragging` because a cancelled drag clears `dragging` (no more
 * move or end callbacks) but leaves `moved` set, so the release that follows
 * is not a click either.
 *
 * `pan` and `pinch` share one `panStart`/`panEnd` bracket. A touch pan becomes
 * a pinch when a second finger lands, and a pinch falls back to a one-finger
 * pan when a finger lifts, without closing and reopening the bracket.
 *
 * `held` is a press a long-press has turned into a context-menu request. The
 * finger is still down and still captured; everything it does until it lifts
 * is ignored, so its release neither clicks nor ends a drag.
 */
export type GestureState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "press";
      readonly pointerId: number;
      readonly touch: boolean;
      readonly origin: Vec2;
      /** Latest position of this pointer — where a pinch would start from. */
      readonly last: Vec2;
      readonly moved: boolean;
      readonly dragging: boolean;
    }
  | {
      readonly kind: "pan";
      readonly pointerId: number;
      readonly touch: boolean;
      readonly last: Vec2;
    }
  | { readonly kind: "pinch"; readonly a: Contact; readonly b: Contact }
  | { readonly kind: "held"; readonly pointerId: number };

export const GESTURE_IDLE: GestureState = Object.freeze({ kind: "idle" });

export interface GestureResult {
  readonly state: GestureState;
  readonly effects: readonly GestureEffect[];
}

const NO_EFFECTS: readonly GestureEffect[] = Object.freeze([]);

/** Whether the view is being dragged — for `cursor: grabbing`. */
export function isPanningState(state: GestureState): boolean {
  return state.kind === "pan" || state.kind === "pinch";
}

/**
 * Whether a finger currently owns the gesture. Safari's own pinch events are
 * ignored while this holds, so an iPad pinch is not applied twice.
 */
export function isTouchGesture(state: GestureState): boolean {
  if (state.kind === "pinch" || state.kind === "held") return true;
  if (state.kind === "press" || state.kind === "pan") return state.touch;
  return false;
}

function isTouch(pointer: GesturePointer): boolean {
  return pointer.pointerType === "touch";
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function span(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function reduceGesture(
  state: GestureState,
  input: GestureInput,
): GestureResult {
  switch (input.kind) {
    case "down":
      return onDown(state, input.pointer, input.spaceHeld, input.panTool);
    case "move":
      return onMove(state, input.pointer);
    case "up":
      return onUp(state, input.pointer);
    case "cancel": {
      const ended = endPointer(state, input.pointerId);
      // A cancelled pointer's hover answer is stale whether or not it owned
      // the gesture: the browser has taken it away mid-sweep.
      return { state: ended.state, effects: [...ended.effects, { kind: "hoverEnd" }] };
    }
    case "lostCapture":
      return endPointer(state, input.pointerId);
    case "abort":
      return abort(state);
    case "leave":
      // Deliberately does NOT end a gesture: capture keeps a drag alive
      // outside the element, which is the reason for capturing it.
      return { state, effects: [{ kind: "hoverEnd" }] };
    case "longPress":
      return onLongPress(state, input.pointerId);
    case "contextMenu":
      return onContextMenu(state, input.point, input.source);
  }
}

/**
 * The hold timer ran out. Only a press that is still this pointer's, and has
 * not travelled past its slop, becomes a menu; anything else — a tap already
 * lifted, a drag, a second finger's pinch — ignores a timer it outlived.
 */
function onLongPress(state: GestureState, pointerId: number): GestureResult {
  if (state.kind !== "press" || state.pointerId !== pointerId || state.moved) {
    return { state, effects: NO_EFFECTS };
  }
  return {
    // Still captured: the release has to reach `held` to be swallowed.
    state: { kind: "held", pointerId },
    effects: [
      { kind: "hoverEnd" },
      { kind: "contextMenu", point: state.origin, source: "touch" },
    ],
  };
}

/**
 * A native `contextmenu`. Its default — the browser's own menu — is ALWAYS
 * cancelled on the canvas; whether ours opens depends on what is in flight.
 */
function onContextMenu(
  state: GestureState,
  point: Vec2,
  source: ContextMenuSource,
): GestureResult {
  const suppressOnly: GestureResult = { state, effects: [{ kind: "preventDefault" }] };
  switch (state.kind) {
    case "held":
      // Android fires its own contextmenu for the same hold, a beat after the
      // timer. The menu is already open; a second request would re-aim it
      // under a finger that may have slid onto the neighbouring bond.
      return suppressOnly;
    case "pan":
    case "pinch":
      return suppressOnly;
    case "press": {
      if (state.moved) return suppressOnly;
      // A press that has not moved: a macOS ctrl-click (a LEFT press, then
      // this), or Android's own long-press arriving before our timer. End the
      // press first, so its release clicks nothing.
      const ended = abort(state);
      return {
        state: ended.state,
        effects: [
          { kind: "preventDefault" },
          ...ended.effects,
          { kind: "hoverEnd" },
          { kind: "contextMenu", point, source },
        ],
      };
    }
    case "idle":
      return {
        state,
        effects: [
          { kind: "preventDefault" },
          { kind: "hoverEnd" },
          { kind: "contextMenu", point, source },
        ],
      };
  }
}

/**
 * Ends whatever is in flight. THE ONE PATH EVERY ABNORMAL EXIT GOES THROUGH:
 * a drag that opened a store transaction and never closes it kills undo for
 * the rest of the session, silently.
 */
function abort(state: GestureState): GestureResult {
  switch (state.kind) {
    case "idle":
      return { state, effects: NO_EFFECTS };
    case "press":
      return {
        state: GESTURE_IDLE,
        effects: [
          { kind: "release", pointerId: state.pointerId },
          ...(state.dragging ? [{ kind: "dragCancel" } as const] : []),
        ],
      };
    case "pan":
      return {
        state: GESTURE_IDLE,
        effects: [
          { kind: "release", pointerId: state.pointerId },
          { kind: "panEnd" },
        ],
      };
    case "pinch":
      return {
        state: GESTURE_IDLE,
        effects: [
          { kind: "release", pointerId: state.a.pointerId },
          { kind: "release", pointerId: state.b.pointerId },
          { kind: "panEnd" },
        ],
      };
    case "held":
      return {
        state: GESTURE_IDLE,
        effects: [{ kind: "release", pointerId: state.pointerId }],
      };
  }
}

function onDown(
  state: GestureState,
  pointer: GesturePointer,
  spaceHeld: boolean,
  panTool: boolean,
): GestureResult {
  if (isTouch(pointer)) {
    // A SECOND FINGER. It turns whatever one finger was doing into a pinch.
    if (state.kind === "press" && state.touch) {
      return {
        state: {
          kind: "pinch",
          a: { pointerId: state.pointerId, point: state.last },
          b: { pointerId: pointer.pointerId, point: pointer.point },
        },
        effects: [
          // FIRST, before panStart: see the header.
          ...(state.dragging ? [{ kind: "dragCancel" } as const] : []),
          { kind: "capture", pointerId: pointer.pointerId },
          { kind: "hoverEnd" },
          { kind: "panStart" },
        ],
      };
    }
    if (state.kind === "pan" && state.touch) {
      return {
        state: {
          kind: "pinch",
          a: { pointerId: state.pointerId, point: state.last },
          b: { pointerId: pointer.pointerId, point: pointer.point },
        },
        // The bracket is already open.
        effects: [{ kind: "capture", pointerId: pointer.pointerId }],
      };
    }
    // A third finger, or a palm landing while a mouse or pen owns the
    // gesture: ignored. Its later moves and release are ignored with it,
    // because no state names its id.
    if (state.kind !== "idle") return { state, effects: NO_EFFECTS };
    return start(pointer, spaceHeld, panTool);
  }

  // A mouse or pen press while something is still in flight. Normally
  // impossible — a mouse fires one pointerdown per gesture — but it happens
  // when a release was lost outside the window, and when a pen lands while a
  // finger still holds a gesture. Either way the stale gesture is ended
  // properly, never overwritten.
  const ended = abort(state);
  const started = start(pointer, spaceHeld, panTool);
  return {
    state: started.state,
    effects: [...ended.effects, ...started.effects],
  };
}

function start(
  pointer: GesturePointer,
  spaceHeld: boolean,
  panTool: boolean,
): GestureResult {
  const touch = isTouch(pointer);
  // Middle drag, or a primary drag with space held or the Pan tool active.
  // Two modifier bindings because the middle button is the one that works with
  // no keyboard and space is the one that works on a trackpad.
  const wantsPan =
    pointer.button === 1 || (pointer.button === 0 && (spaceHeld || panTool));
  if (wantsPan) {
    return {
      state: {
        kind: "pan",
        pointerId: pointer.pointerId,
        touch,
        last: pointer.point,
      },
      effects: [
        // Suppresses the middle-click autoscroll widget on platforms that
        // have one; without it the browser starts its own scroll on top.
        { kind: "preventDefault" },
        { kind: "capture", pointerId: pointer.pointerId },
        // The hover answer is stale the moment the view starts moving.
        { kind: "hoverEnd" },
        { kind: "panStart" },
      ],
    };
  }

  // Primary only. A right press belongs to the context menu, and tracking it
  // would fire a select on its release.
  if (pointer.button !== 0) return { state: GESTURE_IDLE, effects: NO_EFFECTS };

  return {
    state: {
      kind: "press",
      pointerId: pointer.pointerId,
      touch,
      origin: pointer.point,
      last: pointer.point,
      moved: false,
      dragging: false,
    },
    effects: [
      // CAPTURE AT POINTERDOWN, not at the threshold. By the time a fast
      // flick has travelled its few pixels it may be outside the element,
      // and the drag would then lose its release with a transaction open.
      { kind: "capture", pointerId: pointer.pointerId },
      { kind: "press", point: pointer.point, modifiers: pointer.modifiers },
      // A finger and a pen have no right button: holding still is how they
      // ask for the context menu. A mouse never arms the timer.
      ...(pointer.pointerType === "touch" || pointer.pointerType === "pen"
        ? [{ kind: "armLongPress", pointerId: pointer.pointerId } as const]
        : []),
    ],
  };
}

function onMove(state: GestureState, pointer: GesturePointer): GestureResult {
  const point = pointer.point;

  if (state.kind === "pan" && state.pointerId === pointer.pointerId) {
    /**
     * A PAN WHOSE RELEASE NEVER ARRIVED ENDS HERE. A capture can fail, and a
     * release lost outside the window is why `onDown` ends stale gestures at
     * all. Without this the view would keep following a mouse with no button
     * down until the next press. `buttons: 0` on a move is the browser saying
     * the button is already up. Not for touch: a contact reports buttons 1
     * for as long as it is on the glass, and its lift always arrives.
     */
    if (!state.touch && pointer.buttons === 0) {
      const ended = abort(state);
      return { state: ended.state, effects: [...ended.effects, { kind: "hover", point }] };
    }
    /**
     * THE SIGN. The drawing follows the pointer, so the VIEWPORT moves the
     * other way, and `panBy` moves the viewport by its argument. Per-move
     * deltas, because `panBy` is incremental.
     */
    const delta = { x: -(point.x - state.last.x), y: -(point.y - state.last.y) };
    const next: GestureState = { ...state, last: point };
    if (delta.x === 0 && delta.y === 0) return { state: next, effects: NO_EFFECTS };
    return { state: next, effects: [{ kind: "pan", delta }] };
  }

  if (
    state.kind === "pinch" &&
    (state.a.pointerId === pointer.pointerId || state.b.pointerId === pointer.pointerId)
  ) {
    return pinchMove(state, pointer);
  }

  if (state.kind === "press" && state.pointerId === pointer.pointerId) {
    const tracked: GestureState = { ...state, last: point };
    if (!state.moved) {
      const slop = state.touch ? TOUCH_CLICK_SLOP_PX : CLICK_SLOP_PX;
      const travelled = span(state.origin, point);
      if (travelled > slop) {
        return {
          state: { ...tracked, moved: true, dragging: true },
          effects: [
            {
              kind: "dragStart",
              // The DOWN point, not this sample's: a gesture anchors on what
              // was under the button, and a few pixels later the hit test
              // would sometimes answer with the neighbouring bond.
              origin: state.origin,
              point,
              modifiers: pointer.modifiers,
            },
          ],
        };
      }
      return { state: tracked, effects: NO_EFFECTS };
    }
    if (state.dragging) {
      return {
        state: tracked,
        effects: [{ kind: "dragMove", point, modifiers: pointer.modifiers }],
      };
    }
    return { state: tracked, effects: NO_EFFECTS };
  }

  // Hover is a question about a pointer that is just sitting there. With a
  // button down the user is mid-gesture and the answer is irrelevant.
  if (pointer.buttons === 0) {
    return { state, effects: [{ kind: "hover", point }] };
  }
  return { state, effects: NO_EFFECTS };
}

/**
 * One finger of a pinch moved. The centroid's travel pans, the span's ratio
 * zooms about the new centroid, and both go out in that order.
 *
 * Why that order solves the gesture exactly: the pan moves the scene point
 * that sat under the OLD centroid to the NEW centroid, and `zoomAt` then
 * scales while pinning whatever is under its anchor. So the point between the
 * fingers stays between the fingers, which is what a pinch has to feel like.
 */
function pinchMove(
  state: Extract<GestureState, { kind: "pinch" }>,
  pointer: GesturePointer,
): GestureResult {
  const movedA = state.a.pointerId === pointer.pointerId;
  const a: Contact = movedA ? { pointerId: state.a.pointerId, point: pointer.point } : state.a;
  const b: Contact = movedA ? state.b : { pointerId: state.b.pointerId, point: pointer.point };

  const before = midpoint(state.a.point, state.b.point);
  const after = midpoint(a.point, b.point);
  const spanBefore = span(state.a.point, state.b.point);
  const spanAfter = span(a.point, b.point);

  const effects: GestureEffect[] = [];
  const delta = { x: -(after.x - before.x), y: -(after.y - before.y) };
  if (delta.x !== 0 || delta.y !== 0) effects.push({ kind: "pan", delta });
  if (spanBefore >= MIN_PINCH_SPAN_PX && spanAfter >= MIN_PINCH_SPAN_PX) {
    const factor = spanAfter / spanBefore;
    if (factor !== 1) effects.push({ kind: "zoom", anchor: after, factor });
  }
  return { state: { kind: "pinch", a, b }, effects };
}

function onUp(state: GestureState, pointer: GesturePointer): GestureResult {
  if (state.kind === "held" && state.pointerId === pointer.pointerId) {
    // The finger that opened the menu lifts. Nothing else: not a click on the
    // atom under it, which with the element tool held would retype it.
    return { state: GESTURE_IDLE, effects: [{ kind: "release", pointerId: state.pointerId }] };
  }
  if (state.kind === "press" && state.pointerId === pointer.pointerId) {
    // A non-primary release during a primary drag (a chorded second button)
    // is not the end of the gesture. Fingers only ever report button 0.
    if (!state.touch && pointer.button !== 0) return { state, effects: NO_EFFECTS };

    const effects: GestureEffect[] = [{ kind: "release", pointerId: state.pointerId }];
    if (state.dragging) {
      effects.push({ kind: "dragEnd", point: pointer.point, modifiers: pointer.modifiers });
    } else if (!state.moved) {
      // On release rather than on press so a drag can still change its mind,
      // and so the slop test has something to measure.
      effects.push({ kind: "select", point: pointer.point, modifiers: pointer.modifiers });
    }
    // moved && !dragging: a drag that was cancelled. Not a click either.
    return { state: GESTURE_IDLE, effects };
  }
  return endPointer(state, pointer.pointerId);
}

/**
 * A pointer that owned (part of) the gesture is gone, without a click: the
 * release of a pan or pinch finger, a pointercancel, a revoked capture.
 */
function endPointer(state: GestureState, pointerId: number): GestureResult {
  switch (state.kind) {
    case "idle":
      return { state, effects: NO_EFFECTS };
    case "press":
      if (state.pointerId !== pointerId) return { state, effects: NO_EFFECTS };
      return abort(state);
    case "pan":
    case "held":
      if (state.pointerId !== pointerId) return { state, effects: NO_EFFECTS };
      return abort(state);
    case "pinch": {
      const remaining =
        state.a.pointerId === pointerId
          ? state.b
          : state.b.pointerId === pointerId
            ? state.a
            : null;
      if (remaining === null) return { state, effects: NO_EFFECTS };
      // One finger left: it keeps panning, inside the same bracket, until it
      // lifts too. Dropping to idle instead would let that finger's release
      // fire a click on whatever it happened to end over.
      return {
        state: {
          kind: "pan",
          pointerId: remaining.pointerId,
          touch: true,
          last: remaining.point,
        },
        effects: [{ kind: "release", pointerId }],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** Canvas-local px. */
  readonly point: Vec2;
}

export type WheelIntent =
  | { readonly kind: "pan"; readonly delta: Vec2 }
  | { readonly kind: "zoom"; readonly anchor: Vec2; readonly factor: number };

function deltaUnit(deltaMode: number): number {
  return deltaMode === 1 ? LINE_DELTA_PX : deltaMode === 2 ? PAGE_DELTA_PX : 1;
}

/**
 * What one wheel event means, or null for a no-op.
 *
 * Ctrl OR Cmd zooms. A trackpad pinch arrives as ctrl + wheel in every
 * browser that reports it through the wheel; Cmd is what Figma accepts on a
 * Mac, and treating the two alike means nobody has to know which one this
 * editor picked.
 *
 * Everything else pans, in the direction the content would scroll: a wheel
 * turned toward you (deltaY > 0) moves the view down the drawing. Shift turns a
 * vertical-only wheel horizontal, which macOS already does for the user and
 * Windows and Linux leave to the page.
 */
export function wheelIntent(input: WheelInput): WheelIntent | null {
  const unit = deltaUnit(input.deltaMode);
  const dx = input.deltaX * unit;
  const dy = input.deltaY * unit;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

  if (input.ctrlKey || input.metaKey) {
    if (dy === 0) return null;
    const capped = Math.max(-WHEEL_ZOOM_DELTA_CAP_PX, Math.min(WHEEL_ZOOM_DELTA_CAP_PX, dy));
    // Negated so a wheel turned away from you, or fingers spreading, zooms in.
    const factor = Math.exp(-capped * WHEEL_ZOOM_RATE);
    return { kind: "zoom", anchor: input.point, factor };
  }

  const horizontal = input.shiftKey && dx === 0;
  const delta = horizontal ? { x: dy, y: 0 } : { x: dx, y: dy };
  if (delta.x === 0 && delta.y === 0) return null;
  return { kind: "pan", delta };
}

/**
 * Safari reports a trackpad pinch as its own `gesturechange` events carrying a
 * CUMULATIVE scale since `gesturestart`, not as ctrl + wheel. This is the
 * incremental factor between two of them, or 1 for anything unusable.
 */
export function gestureZoomStep(previousScale: number, scale: number): number {
  if (!Number.isFinite(previousScale) || !Number.isFinite(scale)) return 1;
  if (previousScale <= 0 || scale <= 0) return 1;
  return scale / previousScale;
}
