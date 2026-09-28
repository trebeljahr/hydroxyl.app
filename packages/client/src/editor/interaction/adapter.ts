"use client";

/**
 * The thin React adapter between the canvas's pointer events and the pure
 * editing machine.
 *
 * It does exactly three things, and deliberately no more: it turns a canvas
 * point into a resolved `PointerSample`, it hands facts to `reduce`, and it
 * performs the commands that come back. Every decision about what a gesture
 * MEANS is on the other side of that boundary, where it can be tested without
 * a browser.
 *
 * FOUR SHAPES HERE ARE LOAD-BEARING AND EASY TO UNDO BY ACCIDENT.
 *
 * 1. EVERY HANDLER HAS AN EMPTY DEPENDENCY LIST and reads the world through
 *    `editorStore.getState()` and the pick-context ref. The gesture hook
 *    refreshes its own `handlersRef` in a PASSIVE effect, which is scheduled
 *    after paint — so a handler closing over a changing value can be one frame
 *    stale, and one frame stale during a drag means picking against last
 *    frame's zoom. Keeping the closures empty makes the handler object stable
 *    for the life of the mount and the staleness window impossible.
 *
 * 2. THE MACHINE'S STATE LIVES IN A REF, and only the small slice of it the
 *    overlay draws is mirrored into React state. The authoritative state must
 *    be readable synchronously by the next pointer event, which a `useState`
 *    value is not; and re-rendering on every frame for the parts nothing
 *    displays would pay React's price for nothing. The mirror is compared
 *    before it is set, so a drag that changes no overlay geometry causes no
 *    render of its own.
 *
 * 3. HIT-TESTING RUNS AGAINST THE GESTURE'S BASE MOLECULE, not the live one.
 *    The machine commits on every pointer-move, so mid-drag the live molecule
 *    already contains the gesture's own work and a pick against it answers
 *    "the thing in your hand" — which makes every merge and ring-closure
 *    target underneath unreachable, silently. See `gestureBase` in machine.ts
 *    and `hit-resolution.test.ts`, which drives this path for real.
 *
 * 4. EVERY COMMAND BATCH GOES THROUGH `performBatch`, which unwinds the store
 *    if a chem-core refusal throws out of an `edit`. A transaction opened and
 *    never closed kills undo for the rest of the session with nothing in the
 *    console.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";

import { canvasPointToModel, pickAt } from "@/canvas/pick";
import type { PickContext } from "@/canvas/pick";
import { rotateHandleGeometry, ROTATE_HANDLE_GRAB_PX } from "@/canvas/handles";
import type { CanvasGestureHandlers, CanvasPointerModifiers } from "@/canvas/useCanvasGestures";
import { editorStore, toScreen } from "@/state";
import type { Selection } from "@/state";

import type {
  InteractionCommand,
  InteractionContext,
  InteractionState,
  PointerFact,
  PointerHit,
  PointerSample,
  TargetMark,
} from "./facts";
import { IDLE } from "./facts";
import { gestureBase, movingAtomIds, reduce } from "./machine";

/**
 * What the overlay needs to know about a gesture in flight, in MODEL units.
 *
 * Model units rather than scene px because the overlay converts with
 * `modelToPx`, which is the only sanctioned route across that boundary; an
 * adapter that pre-converted would be a second site that knows the scale and
 * the y-flip.
 */
export interface InteractionOverlayState {
  /** The bond being drawn: from the source atom to wherever it currently ends. */
  readonly ghost: { readonly from: Vec2; readonly to: Vec2 } | null;
  /** The atom a ring closure or a merge would land on, and whether it is refused. */
  readonly target: TargetMark | null;
  /** The marquee's two corners, unnormalised — the overlay normalises in px. */
  readonly marquee: { readonly a: Vec2; readonly b: Vec2 } | null;
  /** The centroid a rotation is turning about. */
  readonly pivot: Vec2 | null;
  /**
   * How far the rotation in flight has turned, radians, anticlockwise in
   * MODEL space; 0 when nothing is turning. The handle rides its orbit by this
   * much, so it stays with the pointer that is dragging it instead of sitting
   * still above a structure that spins underneath it.
   */
  readonly angle: number;
  /** The pointer is resting on the rotate handle: preview the rotation. */
  readonly handleHovered: boolean;
}

export const NO_INTERACTION_OVERLAY: InteractionOverlayState = Object.freeze({
  ghost: null,
  target: null,
  marquee: null,
  pivot: null,
  angle: 0,
  handleHovered: false,
});

export interface CanvasInteraction {
  /**
   * The chemistry-facing half of the gesture hook's handler bag. The context
   * menu is not part of it: opening a menu edits nothing, and the canvas that
   * owns the menu handles the request itself.
   */
  readonly handlers: Omit<
    CanvasGestureHandlers,
    "onZoom" | "onPan" | "onResize" | "onContextMenu"
  >;
  readonly overlay: InteractionOverlayState;
}

// ---------------------------------------------------------------------------
// Overlay projection
// ---------------------------------------------------------------------------

function ghostOf(
  state: InteractionState,
): { readonly from: Vec2; readonly to: Vec2 } | null {
  if (state.kind !== "drawingBond") return null;
  const origin = Object.hasOwn(state.base.atoms, state.from)
    ? state.base.atoms[state.from]
    : undefined;
  if (origin === undefined) return null;
  return { from: origin.pos, to: state.target.pos };
}

function projectOverlay(state: InteractionState): InteractionOverlayState {
  switch (state.kind) {
    case "drawingBond": {
      const ghost = ghostOf(state);
      const target =
        state.target.kind === "ring-closure"
          ? { atomId: state.target.atomId, refused: state.target.refused }
          : null;
      return { ...NO_INTERACTION_OVERLAY, ghost, target };
    }
    case "movingSelection":
      return { ...NO_INTERACTION_OVERLAY, target: state.merge };
    case "marquee":
      return {
        ...NO_INTERACTION_OVERLAY,
        marquee: { a: state.origin, b: state.point },
      };
    case "rotating":
      return { ...NO_INTERACTION_OVERLAY, pivot: state.pivot, angle: state.angle };
    // Held through the press too, until the drag threshold is crossed: the
    // pointer has not left the handle, and dropping the preview and the grab
    // cursor for those few pixels reads as the handle refusing the press.
    case "hovering":
    case "pendingDrag": {
      const onHandle =
        state.kind === "hovering" ? state.handle : state.origin.hit.kind === "handle";
      return onHandle
        ? { ...NO_INTERACTION_OVERLAY, handleHovered: true }
        : NO_INTERACTION_OVERLAY;
    }
    default:
      return NO_INTERACTION_OVERLAY;
  }
}

function sameVec(a: Vec2 | null, b: Vec2 | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

function overlaysEqual(
  a: InteractionOverlayState,
  b: InteractionOverlayState,
): boolean {
  if (a === b) return true;
  const ghostSame =
    a.ghost === null || b.ghost === null
      ? a.ghost === b.ghost
      : sameVec(a.ghost.from, b.ghost.from) && sameVec(a.ghost.to, b.ghost.to);
  const targetSame =
    a.target === null || b.target === null
      ? a.target === b.target
      : a.target.atomId === b.target.atomId && a.target.refused === b.target.refused;
  const marqueeSame =
    a.marquee === null || b.marquee === null
      ? a.marquee === b.marquee
      : sameVec(a.marquee.a, b.marquee.a) && sameVec(a.marquee.b, b.marquee.b);
  return (
    ghostSame &&
    targetSame &&
    marqueeSame &&
    sameVec(a.pivot, b.pivot) &&
    a.angle === b.angle &&
    a.handleHovered === b.handleHovered
  );
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * The ONLY place a command becomes a store write.
 *
 * `edit` goes through `applyMoleculeEdit`, which computes the molecule outside
 * the immer recipe and assigns it wholesale — the invariant chem-guard exists
 * to protect. Nothing here reaches into `draft.document.molecule`, and nothing
 * here calls chem-core: the reducer already built the closure.
 */
function perform(command: InteractionCommand): void {
  const store = editorStore.getState();
  switch (command.kind) {
    case "beginTransaction":
      store.beginTransaction(command.label);
      return;
    case "edit":
      store.applyMoleculeEdit(command.label, command.edit);
      return;
    case "commitTransaction":
      store.commitTransaction();
      return;
    case "abortTransaction":
      store.abortTransaction();
      return;
    case "setSelection":
      store.setSelection(command.selection);
      return;
    case "setHover":
      store.setHoveredAtom(command.atomId);
      store.setHoveredBond(command.bondId);
      return;
    case "status":
      store.setStatusMessage(command.message);
      return;
  }
}

/**
 * Perform a batch of commands, rolling the store back if one throws. Answers
 * whether the batch completed.
 *
 * THE ONE FAILURE THIS DESIGN CANNOT SURVIVE IS A LEAKED TRANSACTION, and this
 * is where it would leak. An `edit` closure calls chem-core, and chem-core
 * throws on geometry it cannot honour — `fuseRingOnBond` across a zero-length
 * bond is the reachable example, and `applyMoleculeEdit` rethrows by design.
 * Without this catch the throw escapes the pointer handler with
 * `beginTransaction` already performed and its commit unreachable, so the store
 * stays inside a transaction FOR THE REST OF THE SESSION: undo and redo go
 * dead, silently, and every later edit records against a stale base. The
 * reducer's own stale-transaction net cannot recover it either, because the
 * click paths have already returned the machine to `idle` and
 * `gestureBase(idle)` is null.
 *
 * `abortTransaction` unwinds every nesting level and is a no-op when nothing is
 * in flight, which is exactly what a failed gesture wants. The failure is then
 * REPORTED rather than rethrown: it has already been made safe, and a throw out
 * of a pointer handler would only take the canvas down with it. chem-core's
 * refusals are written for a person — "Bond b3 has zero length; a ring cannot
 * be fused across it" — so the message is worth showing verbatim.
 */
export function performBatch(commands: readonly InteractionCommand[]): boolean {
  try {
    for (const command of commands) perform(command);
    return true;
  } catch (error) {
    const store = editorStore.getState();
    store.abortTransaction();
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "That edit could not be applied";
    store.setStatusMessage(message);
    reportGestureFailure(message, error);
    return false;
  }
}

/**
 * The same failure, over and over, is ONE thing worth knowing — and a batch
 * runs per pointer event.
 *
 * A gesture that chem-core refuses refuses it on every frame of the drag: keep
 * dragging a ring across a zero-length bond and the unconditional
 * `console.error` this replaces produced one entry, one stack and one uncaught
 * error report per frame, for as long as the button was held. In the browser
 * that is a console nobody can read, which is reason enough on its own.
 *
 * A SECOND REASON IS SUSPECTED AND UNMEASURED, and is recorded as suspicion.
 * `next dev` resolves reported errors back to original source through the
 * bundler, so a pointer-rate error stream may be a memory cost in the DEV
 * process — the shape the crash report in manual notes 3 describes. Nobody has
 * run `next dev` under a profiler to confirm that, so it is not the
 * justification for this code; it is a hypothesis this code happens to be
 * robust against.
 *
 * REPEATS ARE COUNTED, NOT DISCARDED. Logging occurrences 1, 2, 4, 8, 16 … of
 * an unchanged message bounds a burst of n at floor(log2 n) + 1 lines while
 * still saying how bad it got, and a different message always logs
 * immediately. Nothing is lost for the person drawing either way: the status
 * bar shows the refusal in full, every time, which is where the message was
 * always meant to be read.
 *
 * A RUN IS A BURST, NOT A LIFETIME, and the distinction is the whole of
 * `FAILURE_BURST_MS`. Counting every occurrence of a message since the tab
 * opened sounds equivalent and is not: the counter would still read 40 after
 * an hour of successful work, so the next single refusal is occurrence 41,
 * which is not a power of two, and the console says NOTHING about the one
 * refusal that is actually news. The same counter also made the text lie —
 * "(2 times in a row)" for two failures a minute apart.
 *
 * WHAT THE WINDOW DOES NOT DO IS BOUND A LONG GESTURE, and an earlier draft of
 * this comment claimed it did. A refused drag refuses every frame, so
 * consecutive occurrences are milliseconds apart and never cross the window: a
 * gesture held for ten seconds at 60 fps is ONE burst of ~600 occurrences,
 * logged at 1, 2, 4 … 512, i.e. ten lines — not ten bursts of six. The bound
 * is logarithmic in the pointer rate, not set by the clock. The window's job
 * is the other one: it decides where a burst ENDS, so the count describes one
 * gesture rather than the session, and the next refusal after the hand stops
 * is occurrence 1 and logs at once. `transaction-safety.test.ts` pins both the
 * long-burst figure and the reset.
 */
/** How long after the last occurrence an identical message still belongs to
 *  the same burst. A refused drag refuses every pointer frame, i.e. every few
 *  milliseconds; a second of quiet means the hand stopped. */
const FAILURE_BURST_MS = 1000;

let lastFailure: string | null = null;
/** When `lastFailure` was last seen, as `Date.now()`. */
let lastFailureAt = 0;
/** How many times in a row — within one burst — `lastFailure` has been seen,
 *  counting from 1. */
let failureRun = 0;

function reportGestureFailure(message: string, error: unknown): void {
  const now = Date.now();
  const sameBurst = message === lastFailure && now - lastFailureAt < FAILURE_BURST_MS;
  failureRun = sameBurst ? failureRun + 1 : 1;
  lastFailure = message;
  lastFailureAt = now;
  // Powers of two only: `n & (n - 1)` is zero exactly then. Sixty identical
  // refusals — a one-second drag — become six lines, at occurrences 1, 2, 4,
  // 8, 16 and 32.
  if ((failureRun & (failureRun - 1)) !== 0) return;
  console.error(
    failureRun === 1
      ? "Editing gesture failed and was rolled back"
      : `Editing gesture failed and was rolled back (${failureRun} times in a row)`,
    error,
  );
}

/** Forget the suppression state. For tests, which assert on call counts and
 *  would otherwise inherit the previous test's run. */
export function resetGestureFailureLog(): void {
  lastFailure = null;
  lastFailureAt = 0;
  failureRun = 0;
}

function currentContext(): InteractionContext {
  const state = editorStore.getState();
  return {
    molecule: state.document.molecule,
    tool: state.tool,
    toolOptions: state.toolOptions,
    selection: state.selection,
  };
}

// ---------------------------------------------------------------------------
// Hit resolution
// ---------------------------------------------------------------------------

/**
 * What is under a canvas point, with the rotate handle beating the chemistry.
 *
 * The handle has to win: it is drawn beside the selection and will routinely
 * overlap a bond, and an affordance you cannot grab because the thing behind
 * it answers first is worse than no affordance. It is measured against the
 * LIVE index and viewport — the same `rotateHandleGeometry` call the overlay
 * draws from — and in SCREEN px, because the handle is a screen-sized control.
 *
 * The chemistry pick runs against `pickMolecule`, which is the gesture's base
 * while one is in flight and the live molecule otherwise — see `gestureBase`.
 * The two molecules are the same object whenever nothing is being dragged.
 */
function resolveHit(
  ctx: PickContext,
  pickMolecule: Molecule,
  canvasPoint: Vec2,
  movingIds: readonly AtomId[],
): PointerHit {
  const handle = rotateHandleGeometry(ctx.index, movingIds, ctx.viewport);
  if (handle !== undefined) {
    const at = toScreen(ctx.viewport, handle.handle);
    const reach = Math.hypot(canvasPoint.x - at.x, canvasPoint.y - at.y);
    if (reach <= ROTATE_HANDLE_GRAB_PX) return { kind: "handle" };
  }

  // Same context, different molecule. The index and the viewport are the live
  // ones: `labelRadius` is keyed on atom ids, which the base and the live
  // molecule share for every atom the base has, and the coordinate chain does
  // not depend on the molecule at all.
  const pickCtx: PickContext =
    pickMolecule === ctx.molecule ? ctx : { ...ctx, molecule: pickMolecule };
  const hit = pickAt(pickCtx, canvasPoint);
  if (hit.kind === "atom") return { kind: "atom", atomId: hit.atomId };
  if (hit.kind === "bond") return { kind: "bond", bondId: hit.bondId };
  return { kind: "none" };
}

/**
 * A canvas point plus everything the reducer needs to know about it.
 *
 * Exported so a test can drive the REAL hit resolution — a scene built by
 * `buildDocumentScene`, an index by `createSceneIndex`, a pick by `pickAt` —
 * against a store mid-gesture, with no DOM. That path is where the
 * merge-on-drop regression lived: every synthetic-fact test named its target
 * atom directly and so could never see it.
 */
export function resolveSample(
  ctx: PickContext,
  state: InteractionState,
  selection: Selection,
  canvasPoint: Vec2,
  modifiers: CanvasPointerModifiers,
): PointerSample {
  const movingIds = movingAtomIds(ctx.molecule, selection);
  return {
    point: canvasPointToModel(ctx, canvasPoint),
    hit: resolveHit(ctx, gestureBase(state) ?? ctx.molecule, canvasPoint, movingIds),
    modifiers: { shift: modifiers.shift, alt: modifiers.alt },
  };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useCanvasInteraction(
  pickContextRef: RefObject<PickContext>,
): CanvasInteraction {
  const stateRef = useRef<InteractionState>(IDLE);
  const [overlay, setOverlay] = useState<InteractionOverlayState>(
    NO_INTERACTION_OVERLAY,
  );
  const overlayRef = useRef<InteractionOverlayState>(NO_INTERACTION_OVERLAY);

  const sampleAt = useCallback(
    (canvasPoint: Vec2, modifiers: CanvasPointerModifiers): PointerSample =>
      resolveSample(
        pickContextRef.current,
        // The state BEFORE this fact is reduced, which is the one whose base
        // the store currently holds the edits of.
        stateRef.current,
        editorStore.getState().selection,
        canvasPoint,
        modifiers,
      ),
    [pickContextRef],
  );

  const dispatch = useCallback((fact: PointerFact): void => {
    const { state, commands } = reduce(stateRef.current, fact, currentContext());
    stateRef.current = state;
    // A batch that failed took the store's transaction with it, so the machine
    // must not keep a gesture whose base the store no longer holds: back to
    // idle, and the next pointer event starts clean.
    if (!performBatch(commands)) stateRef.current = IDLE;

    const next = projectOverlay(stateRef.current);
    if (overlaysEqual(next, overlayRef.current)) return;
    overlayRef.current = next;
    setOverlay(next);
  }, []);

  const onHover = useCallback<CanvasGestureHandlers["onHover"]>(
    (canvasPoint) => {
      dispatch({ kind: "hover", sample: sampleAt(canvasPoint, NO_KEYS) });
    },
    [dispatch, sampleAt],
  );

  const onHoverEnd = useCallback<CanvasGestureHandlers["onHoverEnd"]>(() => {
    dispatch({ kind: "hoverEnd" });
  }, [dispatch]);

  const onPress = useCallback<CanvasGestureHandlers["onPress"]>(
    (canvasPoint, modifiers) => {
      dispatch({ kind: "press", sample: sampleAt(canvasPoint, modifiers) });
    },
    [dispatch, sampleAt],
  );

  const onSelect = useCallback<CanvasGestureHandlers["onSelect"]>(
    (canvasPoint, modifiers) => {
      dispatch({ kind: "click", sample: sampleAt(canvasPoint, modifiers) });
    },
    [dispatch, sampleAt],
  );

  const onDragStart = useCallback<CanvasGestureHandlers["onDragStart"]>(
    (originPoint, canvasPoint, modifiers) => {
      // The origin is sampled HERE, from the pointerdown position, and kept —
      // not re-derived on later frames. Re-picking it every frame would let
      // the anchor drift onto a neighbouring bond as the structure moves under
      // the drag it is itself producing.
      dispatch({
        kind: "dragStart",
        origin: sampleAt(originPoint, modifiers),
        sample: sampleAt(canvasPoint, modifiers),
      });
    },
    [dispatch, sampleAt],
  );

  const onDragMove = useCallback<CanvasGestureHandlers["onDragMove"]>(
    (canvasPoint, modifiers) => {
      dispatch({ kind: "dragMove", sample: sampleAt(canvasPoint, modifiers) });
    },
    [dispatch, sampleAt],
  );

  const onDragEnd = useCallback<CanvasGestureHandlers["onDragEnd"]>(
    (canvasPoint, modifiers) => {
      dispatch({ kind: "dragEnd", sample: sampleAt(canvasPoint, modifiers) });
    },
    [dispatch, sampleAt],
  );

  const onDragCancel = useCallback<CanvasGestureHandlers["onDragCancel"]>(() => {
    dispatch({ kind: "cancel" });
  }, [dispatch]);

  const onPanStart = useCallback<CanvasGestureHandlers["onPanStart"]>(() => {
    dispatch({ kind: "panStart" });
  }, [dispatch]);

  const onPanEnd = useCallback<CanvasGestureHandlers["onPanEnd"]>(() => {
    dispatch({ kind: "panEnd" });
  }, [dispatch]);

  const handlers = useMemo(
    () => ({
      onHover,
      onHoverEnd,
      onPress,
      onSelect,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel,
      onPanStart,
      onPanEnd,
    }),
    [
      onHover,
      onHoverEnd,
      onPress,
      onSelect,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel,
      onPanStart,
      onPanEnd,
    ],
  );

  return { handlers, overlay };
}

/** Hover carries no modifiers: nothing about it is modified. */
const NO_KEYS: CanvasPointerModifiers = Object.freeze({
  shift: false,
  alt: false,
});
