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
 * TWO SHAPES HERE ARE LOAD-BEARING AND EASY TO UNDO BY ACCIDENT.
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
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { AtomId, Vec2 } from "@starter/chem-core";

import { canvasPointToModel, pickAt } from "@/canvas/pick";
import type { PickContext } from "@/canvas/pick";
import { rotateHandlePoint, ROTATE_HANDLE_GRAB_PX } from "@/canvas/handles";
import type { CanvasGestureHandlers, CanvasPointerModifiers } from "@/canvas/useCanvasGestures";
import { editorStore, toModel } from "@/state";

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
import { movingAtomIds, reduce } from "./machine";

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
}

export const NO_INTERACTION_OVERLAY: InteractionOverlayState = Object.freeze({
  ghost: null,
  target: null,
  marquee: null,
  pivot: null,
});

export interface CanvasInteraction {
  /** The chemistry-facing half of the gesture hook's handler bag. */
  readonly handlers: Omit<CanvasGestureHandlers, "onZoom" | "onPan" | "onResize">;
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
      return { ghost, target, marquee: null, pivot: null };
    }
    case "movingSelection":
      return {
        ghost: null,
        target: state.merge,
        marquee: null,
        pivot: null,
      };
    case "marquee":
      return {
        ghost: null,
        target: null,
        marquee: { a: state.origin, b: state.point },
        pivot: null,
      };
    case "rotating":
      return { ghost: null, target: null, marquee: null, pivot: state.pivot };
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
  return ghostSame && targetSame && marqueeSame && sameVec(a.pivot, b.pivot);
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
 * it answers first is worse than no affordance.
 */
function resolveHit(
  ctx: PickContext,
  canvasPoint: Vec2,
  movingIds: readonly AtomId[],
): PointerHit {
  const handle = rotateHandlePoint(ctx.index, movingIds);
  if (handle !== undefined) {
    const scenePoint = toModel(ctx.viewport, canvasPoint);
    const reach = Math.hypot(scenePoint.x - handle.x, scenePoint.y - handle.y);
    if (reach <= ROTATE_HANDLE_GRAB_PX) return { kind: "handle" };
  }

  const hit = pickAt(ctx, canvasPoint);
  if (hit.kind === "atom") return { kind: "atom", atomId: hit.atomId };
  if (hit.kind === "bond") return { kind: "bond", bondId: hit.bondId };
  return { kind: "none" };
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
    (canvasPoint: Vec2, modifiers: CanvasPointerModifiers): PointerSample => {
      const ctx = pickContextRef.current;
      const store = editorStore.getState();
      const movingIds = movingAtomIds(store.document.molecule, store.selection);
      return {
        point: canvasPointToModel(ctx, canvasPoint),
        hit: resolveHit(ctx, canvasPoint, movingIds),
        modifiers: { shift: modifiers.shift, alt: modifiers.alt },
      };
    },
    [pickContextRef],
  );

  const dispatch = useCallback((fact: PointerFact): void => {
    const { state, commands } = reduce(stateRef.current, fact, currentContext());
    stateRef.current = state;
    for (const command of commands) perform(command);

    const next = projectOverlay(state);
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
