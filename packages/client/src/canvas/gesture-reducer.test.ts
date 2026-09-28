/**
 * The gesture reducer, driven with synthetic input and no DOM.
 *
 * Every device's mapping is pinned here (decision 106): what a mouse, a pen, a
 * trackpad and a finger each do on the canvas, and above all that navigating
 * never takes the primary drag away from the marquee. The last block states
 * the invariants that make a gesture safe to open a store transaction in —
 * every drag ends or cancels exactly once, every pan bracket closes exactly
 * once, nothing is selected by a gesture that dragged — and checks them over a
 * few thousand random event sequences.
 */

import { describe, expect, it } from "vitest";

import type { Vec2 } from "@starter/chem-core";
import { createViewport, panBy, toModel, toScreen, zoomAt } from "@/state/viewport";
import type { Viewport } from "@/state/viewport";

import {
  CLICK_SLOP_PX,
  GESTURE_IDLE,
  LONG_PRESS_MS,
  TOUCH_CLICK_SLOP_PX,
  contextMenuSource,
  WHEEL_ZOOM_DELTA_CAP_PX,
  WHEEL_ZOOM_RATE,
  gestureZoomStep,
  isPanningState,
  reduceGesture,
  wheelIntent,
  type GestureEffect,
  type GestureInput,
  type GesturePointer,
  type GestureState,
} from "./gesture-reducer";

const NO_MODS = { shift: false, alt: false } as const;

type PointerType = "mouse" | "pen" | "touch";

function ptr(
  pointerId: number,
  pointerType: PointerType,
  x: number,
  y: number,
  over: Partial<Pick<GesturePointer, "button" | "buttons" | "modifiers">> = {},
): GesturePointer {
  return {
    pointerId,
    pointerType,
    button: over.button ?? 0,
    buttons: over.buttons ?? 1,
    point: { x, y },
    modifiers: over.modifiers ?? NO_MODS,
  };
}

const down = (
  p: GesturePointer,
  opts: { space?: boolean; panTool?: boolean } = {},
): GestureInput => ({
  kind: "down",
  pointer: p,
  spaceHeld: opts.space ?? false,
  panTool: opts.panTool ?? false,
});
const move = (p: GesturePointer): GestureInput => ({ kind: "move", pointer: p });
const up = (p: GesturePointer): GestureInput => ({ kind: "up", pointer: { ...p, buttons: 0 } });

/** Mouse helpers: primary button unless told otherwise. */
const mouse = (x: number, y: number, button = 0): GesturePointer =>
  ptr(1, "mouse", x, y, { button, buttons: button === 1 ? 4 : 1 });
/** Finger helpers: `id` distinguishes fingers. */
const touch = (id: number, x: number, y: number): GesturePointer => ptr(id, "touch", x, y);

function run(
  inputs: readonly GestureInput[],
  from: GestureState = GESTURE_IDLE,
): { state: GestureState; effects: GestureEffect[] } {
  let state = from;
  const effects: GestureEffect[] = [];
  for (const input of inputs) {
    const result = reduceGesture(state, input);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

/** The semantic effects only — capture and timer bookkeeping are asserted
 *  separately. */
function kinds(effects: readonly GestureEffect[]): string[] {
  return effects
    .map((e) => e.kind)
    .filter(
      (k) =>
        k !== "capture" && k !== "release" && k !== "preventDefault" && k !== "armLongPress",
    );
}

function only<K extends GestureEffect["kind"]>(
  effects: readonly GestureEffect[],
  kind: K,
): Extract<GestureEffect, { kind: K }>[] {
  return effects.filter((e): e is Extract<GestureEffect, { kind: K }> => e.kind === kind);
}

/** Apply pan and zoom effects to a real viewport, as the store would. */
function applyView(vp: Viewport, effects: readonly GestureEffect[]): Viewport {
  let next = vp;
  for (const effect of effects) {
    if (effect.kind === "pan") next = panBy(next, effect.delta);
    if (effect.kind === "zoom") next = zoomAt(next, effect.anchor, effect.factor);
  }
  return next;
}

describe("gesture reducer — mouse and pen", () => {
  it("reads a press that did not move as a click", () => {
    const { state, effects } = run([down(mouse(100, 100)), up(mouse(100, 100))]);
    expect(kinds(effects)).toEqual(["press", "select"]);
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("still clicks through a tremor inside the slop, and drags once past it", () => {
    const inside = run([
      down(mouse(100, 100)),
      move(mouse(100 + CLICK_SLOP_PX, 100)),
      up(mouse(100 + CLICK_SLOP_PX, 100)),
    ]);
    expect(kinds(inside.effects)).toEqual(["press", "select"]);

    const past = run([down(mouse(100, 100)), move(mouse(100 + CLICK_SLOP_PX + 1, 100))]);
    expect(kinds(past.effects)).toEqual(["press", "dragStart"]);
  });

  it("anchors the drag on the DOWN point and ends it once, never as a click", () => {
    const { effects } = run([
      down(mouse(100, 100)),
      move(mouse(130, 100)),
      move(mouse(130, 140)),
      up(mouse(130, 140)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragMove", "dragEnd"]);
    const [start] = only(effects, "dragStart");
    expect(start?.origin).toEqual({ x: 100, y: 100 });
    expect(start?.point).toEqual({ x: 130, y: 100 });
  });

  it("keeps a drag that wanders back to its origin a drag", () => {
    const { effects } = run([
      down(mouse(100, 100)),
      move(mouse(130, 100)),
      move(mouse(100, 100)),
      up(mouse(100, 100)),
    ]);
    expect(kinds(effects)).not.toContain("select");
    expect(kinds(effects)).toContain("dragEnd");
  });

  it("pans on a middle drag, per move, with the sign negated, and stops autoscroll", () => {
    const { effects } = run([
      down(mouse(100, 100, 1)),
      move(mouse(110, 120, 1)),
      move(mouse(115, 120, 1)),
      up(mouse(115, 120, 1)),
    ]);
    expect(effects[0]).toEqual({ kind: "preventDefault" });
    expect(kinds(effects)).toEqual(["hoverEnd", "panStart", "pan", "pan", "panEnd"]);
    // The drawing follows the pointer, so the VIEWPORT moves the other way.
    const deltas = only(effects, "pan").map((e) => e.delta);
    expect(deltas[0]).toEqual({ x: -10, y: -20 });
    expect(deltas[1]?.x).toBe(-5);
    expect(deltas[1]?.y === 0).toBe(true);
  });

  it("pans on a primary drag while Space is held or the Pan tool is active", () => {
    for (const opts of [{ space: true }, { panTool: true }]) {
      const { effects } = run([
        down(mouse(100, 100), opts),
        move(mouse(130, 90)),
        up(mouse(130, 90)),
      ]);
      expect(kinds(effects)).toEqual(["hoverEnd", "panStart", "pan", "panEnd"]);
      expect(only(effects, "pan")[0]?.delta).toEqual({ x: -30, y: 10 });
    }
  });

  it("leaves a right press to the context menu", () => {
    const { effects } = run([
      down(ptr(1, "mouse", 50, 50, { button: 2, buttons: 2 })),
      up(ptr(1, "mouse", 50, 50, { button: 2 })),
    ]);
    expect(effects).toEqual([]);
  });

  it("does not end a primary drag on a chorded non-primary release", () => {
    const { state, effects } = run([
      down(mouse(100, 100)),
      move(mouse(130, 100)),
      up(ptr(1, "mouse", 130, 100, { button: 2 })),
    ]);
    expect(kinds(effects)).not.toContain("dragEnd");
    expect(state.kind).toBe("press");
  });

  it("ends a stale drag properly when a new press arrives, never overwrites it", () => {
    // A release lost outside the window, or a pen landing while a finger holds
    // a drag. The stale drag's transaction must be cancelled, not orphaned.
    const { effects } = run([
      down(touch(7, 100, 100)),
      move(touch(7, 140, 100)),
      down(ptr(2, "pen", 300, 300)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragCancel", "press"]);
    expect(effects).toContainEqual({ kind: "release", pointerId: 7 });
  });

  it("reports hover only for a pointer with no button down", () => {
    expect(kinds(run([move(ptr(1, "mouse", 5, 5, { buttons: 0 }))]).effects)).toEqual([
      "hover",
    ]);
    expect(run([move(ptr(1, "mouse", 5, 5, { buttons: 1 }))]).effects).toEqual([]);
  });
});

describe("gesture reducer — touch", () => {
  it("gives a fingertip a wider slop than a mouse", () => {
    const wobble = TOUCH_CLICK_SLOP_PX - 1;
    expect(wobble).toBeGreaterThan(CLICK_SLOP_PX);

    const tap = run([
      down(touch(7, 100, 100)),
      move(touch(7, 100 + wobble, 100)),
      up(touch(7, 100 + wobble, 100)),
    ]);
    expect(kinds(tap.effects)).toEqual(["press", "select"]);

    // The same travel with a mouse is a drag, which on empty canvas is a
    // zero-size marquee that clears the selection instead of making one.
    const click = run([down(mouse(100, 100)), move(mouse(100 + wobble, 100))]);
    expect(kinds(click.effects)).toContain("dragStart");
  });

  it("lets one finger drag do what the tool does — the marquee, with Select", () => {
    const { effects } = run([
      down(touch(7, 100, 100)),
      move(touch(7, 160, 140)),
      up(touch(7, 160, 140)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragEnd"]);
  });

  it("turns a pending tap into a pinch when a second finger lands, and never selects", () => {
    const { state, effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      up(touch(7, 100, 100)),
      up(touch(8, 200, 100)),
    ]);
    expect(kinds(effects)).toEqual(["press", "hoverEnd", "panStart", "panEnd"]);
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("cancels a drag the first finger had started BEFORE the pan starts", () => {
    // The interaction machine treats panStart as "the pointer is no longer
    // yours": a drag still open at that moment would lose its transaction
    // without an abort.
    const { effects } = run([
      down(touch(7, 100, 100)),
      move(touch(7, 140, 100)),
      down(touch(8, 300, 300)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragCancel", "hoverEnd", "panStart"]);
  });

  it("zooms by the ratio of finger spans, about the centroid", () => {
    const { effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      move(touch(8, 300, 100)),
    ]);
    const zoom = only(effects, "zoom");
    expect(zoom).toHaveLength(1);
    expect(zoom[0]?.factor).toBeCloseTo(2, 12);
    expect(zoom[0]?.anchor).toEqual({ x: 200, y: 100 });
  });

  it("pans by the centroid's travel, negated, when one finger slides", () => {
    // One finger moving and the other still: the span changes too, so check
    // the pan half on its own through a move that keeps the span.
    const { effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      move(touch(8, 200, 60)),
    ]);
    const delta = only(effects, "pan")[0]?.delta;
    // Componentwise: the still axis is -(150 - 150), a NEGATIVE zero, which
    // `toEqual` would separate from 0 although nothing downstream can.
    expect(delta?.x === 0).toBe(true);
    expect(delta?.y).toBe(20);
  });

  it("nets out to a pure pan when both fingers travel together", () => {
    // A browser delivers the two fingers' moves one at a time, so the span
    // wobbles between them and a zoom goes out and comes back. What must hold
    // is the net result: no zoom, and the drawing moved with the fingers.
    let vp = createViewport({ width: 800, height: 600 });
    const start = toModel(vp, { x: 150, y: 100 });
    const { effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      move(touch(7, 130, 140)),
      move(touch(8, 230, 140)),
    ]);
    const net = only(effects, "zoom").reduce((acc, e) => acc * e.factor, 1);
    expect(net).toBeCloseTo(1, 12);
    vp = applyView(vp, effects);
    expect(vp.zoom).toBeCloseTo(1, 12);
    const end = toScreen(vp, start);
    expect(end.x).toBeCloseTo(180, 6);
    expect(end.y).toBeCloseTo(140, 6);
  });

  it("keeps the drawing under the fingers through a pinch that also travels", () => {
    // Stated in the space the user sees, through the real viewport maths: the
    // scene point that started midway between the fingers ends midway between
    // them, and one that started under a finger is still under it.
    let vp = createViewport({ width: 800, height: 600 });
    vp = zoomAt(vp, { x: 400, y: 300 }, 1.7);
    const a0: Vec2 = { x: 300, y: 250 };
    const b0: Vec2 = { x: 420, y: 330 };
    const underA = toModel(vp, a0);
    const between = toModel(vp, { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 });

    const a1: Vec2 = { x: 200, y: 180 };
    const b1: Vec2 = { x: 560, y: 420 };
    const { effects } = run([
      down(touch(7, a0.x, a0.y)),
      down(touch(8, b0.x, b0.y)),
      move(touch(7, a1.x, a1.y)),
      move(touch(8, b1.x, b1.y)),
    ]);
    vp = applyView(vp, effects);

    const mid = toScreen(vp, between);
    expect(mid.x).toBeCloseTo((a1.x + b1.x) / 2, 6);
    expect(mid.y).toBeCloseTo((a1.y + b1.y) / 2, 6);
    const fingerA = toScreen(vp, underA);
    expect(fingerA.x).toBeCloseTo(a1.x, 6);
    expect(fingerA.y).toBeCloseTo(a1.y, 6);
  });

  it("keeps panning with the finger that stays, in the same bracket, and never clicks", () => {
    const { state, effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      up(touch(7, 100, 100)),
      move(touch(8, 230, 110)),
      up(touch(8, 230, 110)),
    ]);
    expect(kinds(effects)).toEqual(["press", "hoverEnd", "panStart", "pan", "panEnd"]);
    expect(only(effects, "pan")[0]?.delta).toEqual({ x: -30, y: -10 });
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("pinches again when a finger re-lands during that one-finger pan", () => {
    const { effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      up(touch(7, 100, 100)),
      down(touch(9, 100, 100)),
      move(touch(9, 0, 100)),
    ]);
    expect(only(effects, "panStart")).toHaveLength(1);
    expect(only(effects, "zoom")[0]?.factor).toBeCloseTo(2, 12);
  });

  it("ignores a third finger", () => {
    const { state, effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      down(touch(9, 150, 200)),
      move(touch(9, 400, 400)),
      up(touch(9, 400, 400)),
    ]);
    expect(kinds(effects)).toEqual(["press", "hoverEnd", "panStart"]);
    expect(state.kind).toBe("pinch");
  });

  it("ignores a palm resting on the screen while a mouse or pen draws", () => {
    const { effects } = run([
      down(ptr(2, "pen", 100, 100)),
      down(touch(7, 400, 400)),
      move(touch(7, 450, 400)),
      up(touch(7, 450, 400)),
      move(ptr(2, "pen", 140, 100)),
      up(ptr(2, "pen", 140, 100)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragEnd"]);
  });

  it("pans with one finger under the Pan tool, and pinches with two", () => {
    const { effects } = run([
      down(touch(7, 100, 100), { panTool: true }),
      move(touch(7, 110, 100)),
      down(touch(8, 210, 100), { panTool: true }),
      move(touch(8, 310, 100)),
      up(touch(7, 110, 100)),
      up(touch(8, 310, 100)),
    ]);
    expect(only(effects, "panStart")).toHaveLength(1);
    expect(only(effects, "panEnd")).toHaveLength(1);
    expect(only(effects, "zoom")[0]?.factor).toBeCloseTo(2, 12);
  });

  it("closes the bracket exactly once when the browser cancels both fingers", () => {
    const { state, effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      { kind: "cancel", pointerId: 7 },
      { kind: "cancel", pointerId: 8 },
    ]);
    expect(only(effects, "panEnd")).toHaveLength(1);
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("treats a lost capture after an ordinary release as nothing at all", () => {
    // It fires after EVERY release. Clearing hover there would wipe the
    // highlight after every click.
    const after = run([down(mouse(10, 10)), up(mouse(10, 10))]);
    const { effects } = run([{ kind: "lostCapture", pointerId: 1 }], after.state);
    expect(effects).toEqual([]);
  });
});

describe("gesture reducer — abort", () => {
  it("does nothing when nothing is in flight", () => {
    expect(run([{ kind: "abort" }]).effects).toEqual([]);
  });

  it("cancels a drag and releases its capture", () => {
    const { state, effects } = run([
      down(mouse(100, 100)),
      move(mouse(140, 100)),
      { kind: "abort" },
      up(mouse(140, 100)),
    ]);
    expect(kinds(effects)).toEqual(["press", "dragStart", "dragCancel"]);
    expect(effects).toContainEqual({ kind: "release", pointerId: 1 });
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("releases both fingers of a pinch and closes its bracket", () => {
    const { effects } = run([
      down(touch(7, 100, 100)),
      down(touch(8, 200, 100)),
      { kind: "abort" },
    ]);
    expect(only(effects, "release").map((e) => e.pointerId).sort()).toEqual([7, 8]);
    expect(only(effects, "panEnd")).toHaveLength(1);
  });
});

/**
 * A small deterministic PRNG, so a failing sequence reproduces from its seed.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("gesture reducer — invariants under arbitrary input", () => {
  // 3000 seeds of 40 steps each: seconds of work by design, so the default
  // 5 s timeout is a flake on a machine running anything else.
  it("opens and closes every drag and every pan bracket exactly once", { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const rand = lcg(seed);
      const pick = <T,>(items: readonly T[]): T =>
        items[Math.floor(rand() * items.length)] as T;
      // A pointer keeps its device for the whole sequence, as it does in a
      // browser.
      const types: Record<number, PointerType> = {
        1: pick(["mouse", "pen", "touch"] as const),
        2: "touch",
        3: pick(["pen", "touch"] as const),
      };
      const point = (): { x: number; y: number } => ({
        x: Math.round(rand() * 400),
        y: Math.round(rand() * 400),
      });

      let state: GestureState = GESTURE_IDLE;
      let dragOpen = false;
      let panOpen = false;
      // Set by a context menu, cleared by the next press: the gesture that
      // asked for a menu must not also click.
      let menuSincePress = false;
      const captured = new Set<number>();
      const trace: string[] = [];

      const step = (input: GestureInput): void => {
        const result = reduceGesture(state, input);
        state = result.state;
        // Joined once per STEP, not once per effect: the per-effect join was
        // quadratic in the trace and, with the expects, took this test past
        // the default timeout on a loaded machine. A failure still names the
        // whole sequence up to and including the step that broke.
        for (const effect of result.effects) trace.push(effect.kind);
        const where = `seed ${String(seed)}: ${trace.join(" ")}`;
        for (const effect of result.effects) {
          switch (effect.kind) {
            case "capture":
              captured.add(effect.pointerId);
              break;
            case "release":
              captured.delete(effect.pointerId);
              break;
            case "dragStart":
              expect(dragOpen, where).toBe(false);
              expect(panOpen, where).toBe(false);
              dragOpen = true;
              break;
            case "dragMove":
              expect(dragOpen, where).toBe(true);
              break;
            case "dragEnd":
            case "dragCancel":
              expect(dragOpen, where).toBe(true);
              dragOpen = false;
              break;
            case "select":
              expect(dragOpen, where).toBe(false);
              expect(panOpen, where).toBe(false);
              expect(menuSincePress, where).toBe(false);
              break;
            case "press":
              menuSincePress = false;
              break;
            case "contextMenu":
              // Never over a structure that is still moving.
              expect(dragOpen, where).toBe(false);
              expect(panOpen, where).toBe(false);
              menuSincePress = true;
              break;
            case "panStart":
              // A drag still open here would lose its transaction.
              expect(dragOpen, where).toBe(false);
              expect(panOpen, where).toBe(false);
              panOpen = true;
              break;
            case "pan":
            case "panEnd":
              if (effect.kind === "panEnd") {
                expect(panOpen, where).toBe(true);
                panOpen = false;
              }
              break;
            default:
              break;
          }
        }
        expect(isPanningState(state)).toBe(panOpen);
      };

      for (let i = 0; i < 40; i++) {
        const id = pick([1, 2, 3]);
        const type = types[id] as PointerType;
        const at = point();
        const roll = rand();
        const p = ptr(id, type, at.x, at.y, {
          button: type === "touch" ? 0 : pick([0, 0, 0, 1, 2]),
        });
        if (roll < 0.28) step(down(p, { space: rand() < 0.1, panTool: rand() < 0.1 }));
        else if (roll < 0.62) step(move(p));
        else if (roll < 0.8) step(up(p));
        else if (roll < 0.85) step({ kind: "cancel", pointerId: id });
        else if (roll < 0.88) step({ kind: "lostCapture", pointerId: id });
        // The hold timer can fire for any pointer at any moment — including
        // one whose press is long gone — and so can a native contextmenu.
        else if (roll < 0.93) step({ kind: "longPress", pointerId: id });
        else if (roll < 0.98)
          step({
            kind: "contextMenu",
            point: at,
            source: type === "mouse" ? "pointer" : "touch",
          });
        else step({ kind: "abort" });
      }
      step({ kind: "abort" });

      const where = `seed ${String(seed)}: ${trace.join(" ")}`;
      expect(state, where).toEqual(GESTURE_IDLE);
      expect(dragOpen, where).toBe(false);
      expect(panOpen, where).toBe(false);
      // Every pointer the canvas captured, it let go of.
      expect([...captured], where).toEqual([]);
    }
  });
});

describe("wheelIntent", () => {
  const at = { x: 120, y: 80 };
  const base = {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    point: at,
  };

  it("pans on a plain wheel, in the direction the content scrolls", () => {
    expect(wheelIntent({ ...base, deltaX: -7, deltaY: 25 })).toEqual({
      kind: "pan",
      delta: { x: -7, y: 25 },
    });
  });

  it("turns Shift + a vertical-only wheel horizontal, and leaves a real deltaX alone", () => {
    expect(wheelIntent({ ...base, deltaY: 100, shiftKey: true })).toEqual({
      kind: "pan",
      delta: { x: 100, y: 0 },
    });
    // macOS has already converted it; converting again would lose it.
    expect(wheelIntent({ ...base, deltaX: 100, shiftKey: true })).toEqual({
      kind: "pan",
      delta: { x: 100, y: 0 },
    });
  });

  it("normalises line and page deltas to px", () => {
    expect(wheelIntent({ ...base, deltaY: 3, deltaMode: 1 })).toEqual({
      kind: "pan",
      delta: { x: 0, y: 48 },
    });
    expect(wheelIntent({ ...base, deltaX: 1, deltaMode: 2 })).toEqual({
      kind: "pan",
      delta: { x: 100, y: 0 },
    });
  });

  it("zooms about the cursor with Ctrl or Cmd held", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const intent = wheelIntent({ ...base, ...mod, deltaY: -10 });
      expect(intent?.kind).toBe("zoom");
      if (intent?.kind !== "zoom") return;
      expect(intent.anchor).toEqual(at);
      expect(intent.factor).toBeGreaterThan(1);
    }
  });

  it("tracks a Chromium pinch 1:1 with the fingers", () => {
    // Chromium reports a pinch step of scale s as ctrl + wheel with
    // deltaY = -100 ln(s).
    for (const s of [1.01, 1.05, 0.93]) {
      const intent = wheelIntent({ ...base, ctrlKey: true, deltaY: -100 * Math.log(s) });
      expect(intent?.kind === "zoom" ? intent.factor : NaN).toBeCloseTo(s, 12);
    }
  });

  it("gives a mouse notch the capped step, and undoes it exactly in reverse", () => {
    const zoomIn = wheelIntent({ ...base, ctrlKey: true, deltaY: -120 });
    const zoomOut = wheelIntent({ ...base, ctrlKey: true, deltaY: 120 });
    const fin = zoomIn?.kind === "zoom" ? zoomIn.factor : NaN;
    const fout = zoomOut?.kind === "zoom" ? zoomOut.factor : NaN;
    expect(fin).toBeCloseTo(Math.exp(WHEEL_ZOOM_DELTA_CAP_PX * WHEEL_ZOOM_RATE), 12);
    expect(fin).toBeCloseTo(1.2214, 3);
    expect(fin * fout).toBeCloseTo(1, 12);
  });

  it("reads nothing into an empty or broken event", () => {
    expect(wheelIntent(base)).toBeNull();
    expect(wheelIntent({ ...base, ctrlKey: true, deltaX: 30 })).toBeNull();
    expect(wheelIntent({ ...base, deltaY: Number.NaN })).toBeNull();
    expect(wheelIntent({ ...base, deltaY: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("gestureZoomStep", () => {
  it("turns Safari's cumulative scale into per-event factors", () => {
    expect(gestureZoomStep(1, 1.5)).toBeCloseTo(1.5, 12);
    expect(gestureZoomStep(1.5, 1.2)).toBeCloseTo(0.8, 12);
  });

  it("answers 1 for anything it cannot use", () => {
    expect(gestureZoomStep(0, 2)).toBe(1);
    expect(gestureZoomStep(1, 0)).toBe(1);
    expect(gestureZoomStep(1, Number.NaN)).toBe(1);
  });
});

describe("gesture reducer — the context menu", () => {
  const at = { x: 50, y: 60 };

  it("arms the hold timer for a finger and a pen, never for a mouse", () => {
    expect(only(run([down(touch(4, 10, 10))]).effects, "armLongPress")).toEqual([
      { kind: "armLongPress", pointerId: 4 },
    ]);
    expect(only(run([down(ptr(5, "pen", 10, 10))]).effects, "armLongPress")).toHaveLength(1);
    expect(only(run([down(mouse(10, 10))]).effects, "armLongPress")).toEqual([]);
  });

  it("opens the menu at the DOWN point when the hold runs out, and the lift clicks nothing", () => {
    const f = touch(4, 100, 100);
    const held = run([down(f), move(touch(4, 103, 101)), { kind: "longPress", pointerId: 4 }]);
    expect(held.state).toEqual({ kind: "held", pointerId: 4 });
    expect(only(held.effects, "contextMenu")).toEqual([
      { kind: "contextMenu", point: { x: 100, y: 100 }, source: "touch" },
    ]);
    // The tremor stayed inside the finger's slop, so no drag either.
    expect(kinds(held.effects)).not.toContain("dragStart");

    const lifted = run([move(touch(4, 104, 102)), up(touch(4, 104, 102))], held.state);
    expect(kinds(lifted.effects)).toEqual([]);
    expect(lifted.effects).toContainEqual({ kind: "release", pointerId: 4 });
    expect(lifted.state).toEqual(GESTURE_IDLE);
  });

  it("ignores a hold timer its press outlived", () => {
    const f = touch(4, 100, 100);
    // Lifted as a tap first.
    const tapped = run([down(f), up(f), { kind: "longPress", pointerId: 4 }]);
    expect(kinds(tapped.effects)).toEqual(["press", "select"]);
    // Travelled past the slop: a drag, not a hold.
    const dragged = run([
      down(f),
      move(touch(4, 100 + TOUCH_CLICK_SLOP_PX * 3, 100)),
      { kind: "longPress", pointerId: 4 },
    ]);
    expect(kinds(dragged.effects)).toEqual(["press", "dragStart"]);
    // A second finger made it a pinch.
    const pinched = run([down(f), down(touch(5, 200, 200)), { kind: "longPress", pointerId: 4 }]);
    expect(only(pinched.effects, "contextMenu")).toEqual([]);
    expect(pinched.state.kind).toBe("pinch");
  });

  it("ignores a second finger while the menu's finger is held, and a pen ends the hold cleanly", () => {
    const held = run([down(touch(4, 100, 100)), { kind: "longPress", pointerId: 4 }]).state;
    expect(run([down(touch(5, 10, 10))], held)).toEqual({ state: held, effects: [] });
    const pen = run([down(ptr(6, "pen", 10, 10))], held);
    expect(pen.effects[0]).toEqual({ kind: "release", pointerId: 4 });
    expect(pen.state.kind).toBe("press");
  });

  it("opens on a right-click, and always keeps the browser's own menu shut", () => {
    const { state, effects } = run([{ kind: "contextMenu", point: at, source: "pointer" }]);
    expect(effects[0]).toEqual({ kind: "preventDefault" });
    expect(only(effects, "contextMenu")).toEqual([{ kind: "contextMenu", point: at, source: "pointer" }]);
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("ends a macOS ctrl-click's press, so its release selects nothing", () => {
    const m = mouse(50, 60);
    const { effects, state } = run([
      down(m),
      { kind: "contextMenu", point: at, source: "pointer" },
      up(m),
    ]);
    expect(kinds(effects)).toEqual(["press", "hoverEnd", "contextMenu"]);
    expect(state).toEqual(GESTURE_IDLE);
  });

  it("opens nothing mid-drag, mid-pan or mid-pinch, but still suppresses the browser's", () => {
    const menu: GestureInput = { kind: "contextMenu", point: at, source: "pointer" };
    const dragging = run([down(mouse(0, 0)), move(mouse(40, 0))]).state;
    const panning = run([down(mouse(0, 0, 1))]).state;
    const pinching = run([down(touch(4, 0, 0)), down(touch(5, 50, 50))]).state;
    for (const from of [dragging, panning, pinching]) {
      const result = run([menu], from);
      expect(result.effects, from.kind).toEqual([{ kind: "preventDefault" }]);
      expect(result.state, from.kind).toBe(from);
    }
  });

  it("swallows Android's own contextmenu for a hold that already opened the menu", () => {
    const held = run([down(touch(4, 100, 100)), { kind: "longPress", pointerId: 4 }]).state;
    const again = run([{ kind: "contextMenu", point: { x: 103, y: 100 }, source: "touch" }], held);
    expect(again.effects).toEqual([{ kind: "preventDefault" }]);
    expect(again.state).toBe(held);
  });

  it("holds a finger for the platforms' own 500 ms", () => {
    expect(LONG_PRESS_MS).toBe(500);
  });
});

describe("contextMenuSource", () => {
  it("reads Chromium's pointerType where it is given", () => {
    expect(contextMenuSource({ pointerType: "mouse", button: 2, ctrlKey: false })).toBe("pointer");
    expect(contextMenuSource({ pointerType: "touch", button: 0, ctrlKey: false })).toBe("touch");
    expect(contextMenuSource({ pointerType: "pen", button: 0, ctrlKey: false })).toBe("touch");
    expect(contextMenuSource({ pointerType: "", button: 0, ctrlKey: false })).toBe("keyboard");
  });

  it("falls back on the button and ctrl for a bare MouseEvent", () => {
    expect(contextMenuSource({ pointerType: undefined, button: 2, ctrlKey: false })).toBe("pointer");
    // macOS ctrl-click reports the LEFT button.
    expect(contextMenuSource({ pointerType: undefined, button: 0, ctrlKey: true })).toBe("pointer");
    expect(contextMenuSource({ pointerType: undefined, button: 0, ctrlKey: false })).toBe("keyboard");
  });
});
