/**
 * The vocabulary the editing state machine speaks: pointer FACTS in, editor
 * COMMANDS out, with an explicit STATE in between.
 *
 * WHY A SEPARATE VOCABULARY AT ALL, rather than letting the canvas call the
 * store directly the way the read-only version does.
 *
 * jsdom has no layout. `getBoundingClientRect` returns zeros there, so a drag
 * driven through a rendered component in a unit test proves nothing about the
 * geometry it is supposedly testing — every point is the origin and every
 * gesture degenerates. A Playwright spec has real layout but is far too coarse
 * to enumerate the cases a drag actually has (retarget onto an atom and back
 * off it again, a refused ring closure, an Escape between two frames). So the
 * decisions live in a pure reducer over synthetic facts, which needs neither.
 *
 * THREE RULES THAT MAKE THAT SEPARATION REAL, and which anything added here
 * has to keep:
 *
 * 1. EVERY GEOMETRIC VALUE IN A FACT IS IN MODEL UNITS. The adapter converts
 *    canvas px once, with `canvasPointToModel`, and the reducer never sees a
 *    pixel, a viewport or a zoom. That is also why facts carry POINTS and
 *    never DELTAS: a delta has to be converted by a different rule from a
 *    point (see the note on `pxToModel` in chem-render's style.ts), and a
 *    design with no vector delta in it cannot get that rule wrong. The reducer
 *    subtracts two model points when it wants a displacement.
 *
 * 2. THE HIT IS RESOLVED BY THE ADAPTER, not by the reducer. Picking needs the
 *    measured label radius of every atom, which is a property of the rendered
 *    scene rather than of the molecule — so it belongs on the far side of the
 *    boundary. The reducer receives the answer.
 *
 * 3. COMMANDS ARE DATA. The reducer returns a list of things to do and does
 *    none of them, so a test can assert "sixty move facts produced exactly one
 *    beginTransaction and one commitTransaction" without a store, and the
 *    single-undo-entry guarantee is checkable as a count rather than inferred
 *    from history internals.
 */

import type { AtomId, BondId, BondOrder, Molecule, Vec2 } from "@starter/chem-core";

import type { MoleculeEdit, Selection, ToolId, ToolOptions } from "@/state";

/**
 * Modifier keys, sampled PER EVENT rather than once at the start of a gesture.
 *
 * Shift constrains and extends; Alt selects the spiro variant of a ring drop
 * and the rotate variant of a selection drag. Both are routinely pressed
 * AFTER the button goes down — you start dragging, then decide you wanted it
 * constrained — so a gesture that latched them at pointerdown would ignore
 * half the times they are used.
 */
export interface GestureModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
}

export const NO_MODIFIERS: GestureModifiers = Object.freeze({
  shift: false,
  alt: false,
});

/**
 * What the pointer is over.
 *
 * `handle` is the one entry that is not a model entity: it is the rotation
 * grab handle the overlay draws beside a selection. It is resolved in SCREEN
 * space by the adapter, before the chemistry pick runs, because it is a fixed
 * size on screen rather than a fixed size in the drawing — and it must win,
 * or a handle that happens to sit over a bond would be unusable.
 */
export type PointerHit =
  | { readonly kind: "none" }
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "handle" };

export const NO_POINTER_HIT: PointerHit = Object.freeze({ kind: "none" });

/** One pointer position, already resolved. MODEL units — see rule 1. */
export interface PointerSample {
  readonly point: Vec2;
  readonly hit: PointerHit;
  readonly modifiers: GestureModifiers;
}

/**
 * Everything the reducer needs to know about the world that is not the
 * pointer. Passed per fact rather than held in the state, because all of it
 * can change underneath a gesture — an edit lands, a tool is switched by a
 * shortcut, the selection is replaced — and a stale copy would silently drive
 * the next frame against a molecule that no longer exists.
 */
export interface InteractionContext {
  readonly molecule: Molecule;
  readonly tool: ToolId;
  readonly toolOptions: ToolOptions;
  readonly selection: Selection;
}

/**
 * A pointer fact.
 *
 * `press` and `click` are distinct on purpose and are NOT two names for the
 * same thing: `press` is pointerdown (which may still become a drag), `click`
 * is a pointerup that travelled less than the slop threshold. The gestures
 * that are clicks — sprout in the default direction, drop a ring template —
 * therefore arrive as `click` and never have to guess whether the drag they
 * are in is over.
 *
 * `dragStart` carries BOTH endpoints: `origin` is the sample taken at
 * pointerdown, not at the threshold crossing. A gesture anchors on what was
 * under the button, and by the time the pointer has travelled its four pixels
 * the hit test would sometimes answer with the neighbouring bond instead.
 *
 * `cancel` covers pointercancel, Escape, a lost capture, a hidden tab and
 * unmount. It is never followed by a `dragEnd`.
 */
export type PointerFact =
  | { readonly kind: "hover"; readonly sample: PointerSample }
  | { readonly kind: "hoverEnd" }
  | { readonly kind: "press"; readonly sample: PointerSample }
  | {
      readonly kind: "dragStart";
      readonly origin: PointerSample;
      readonly sample: PointerSample;
    }
  | { readonly kind: "dragMove"; readonly sample: PointerSample }
  | { readonly kind: "dragEnd"; readonly sample: PointerSample }
  | { readonly kind: "cancel" }
  | { readonly kind: "click"; readonly sample: PointerSample }
  | { readonly kind: "panStart" }
  | { readonly kind: "panEnd" };

/**
 * What the adapter must do, as data.
 *
 * `edit` carries a molecule -> molecule function, which is exactly what
 * `applyMoleculeEdit` takes, so every write still goes down the store's one
 * guarded path and `chem-guard` still polices it. The reducer never calls
 * chem-core through the store; it builds the closure and hands it over.
 */
export type InteractionCommand =
  | { readonly kind: "beginTransaction"; readonly label: string }
  | { readonly kind: "edit"; readonly label: string; readonly edit: MoleculeEdit }
  | { readonly kind: "commitTransaction" }
  | { readonly kind: "abortTransaction" }
  | { readonly kind: "setSelection"; readonly selection: Selection }
  | {
      readonly kind: "setHover";
      readonly atomId: AtomId | null;
      readonly bondId: BondId | null;
    }
  | { readonly kind: "status"; readonly message: string | null };

export const NO_COMMANDS: readonly InteractionCommand[] = Object.freeze([]);

/**
 * A ring-closure or merge target the overlay should mark, and whether the
 * gesture will accept it.
 *
 * `refused` is decision 2 made visible: merging or bonding two atoms that are
 * already bonded is refused rather than silently collapsed, and the user has
 * to be able to see the refusal while the pointer is still down, not discover
 * it when nothing happens on release.
 */
export interface TargetMark {
  readonly atomId: AtomId;
  readonly refused: boolean;
}

/**
 * The machine's states.
 *
 * Each committing state carries `base`: THE MOLECULE AS IT WAS WHEN THE
 * GESTURE STARTED. Every frame's edit is computed from `base`, never from the
 * molecule the previous frame produced, and that single decision removes the
 * whole family of accumulation bugs that a per-pointer-move commit invites —
 * sixty frames of `sproutTo` building a sixty-atom chain, a cumulative
 * translate applied sixty times, `nextId` inflating while the pointer wobbles
 * over a merge target. Rebuilt from the base, frame N is a pure function of
 * the pointer and is idempotent: the minted atom gets the same id every time
 * (`addAtom` reads `base.nextId`), a repeated frame changes nothing, and
 * retargeting between a new atom and a ring closure needs no clean-up pass.
 *
 * The cost is one O(atoms) record copy per frame instead of an O(1) one, which
 * at figure scale is tens of microseconds — see the measured budget in
 * machine.perf.test.ts.
 */
export type InteractionState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "hovering";
      readonly atomId: AtomId | null;
      readonly bondId: BondId | null;
    }
  /** Button down, threshold not yet crossed. Nothing is committed here. */
  | { readonly kind: "pendingDrag"; readonly origin: PointerSample }
  | {
      readonly kind: "drawingBond";
      readonly label: string;
      readonly base: Molecule;
      readonly from: AtomId;
      readonly bondLength: number;
      /** Latched at drag start, so switching the bond tool mid-drag does not
       *  retype a bond the user is still positioning. */
      readonly order: BondOrder;
      /** Where the far end currently is, and what is there. */
      readonly target: DrawTarget;
    }
  | {
      readonly kind: "movingSelection";
      readonly label: string;
      readonly base: Molecule;
      readonly atomIds: readonly AtomId[];
      readonly origin: Vec2;
      readonly delta: Vec2;
      /** Set only when a single atom is being dragged onto another. */
      readonly merge: TargetMark | null;
    }
  | {
      readonly kind: "marquee";
      readonly origin: Vec2;
      readonly point: Vec2;
      readonly additive: boolean;
      /** What was selected before the sweep, for the additive case. */
      readonly baseSelection: Selection;
    }
  | {
      readonly kind: "rotating";
      readonly label: string;
      readonly base: Molecule;
      readonly atomIds: readonly AtomId[];
      readonly pivot: Vec2;
      /** Bearing from the pivot to the pointer at drag start. */
      readonly reference: number;
      /** The rotation applied so far, after snapping. */
      readonly angle: number;
    }
  | { readonly kind: "panning" };

/** Where a bond being drawn currently ends. */
export type DrawTarget =
  | { readonly kind: "new-atom"; readonly pos: Vec2; readonly angle: number }
  | {
      readonly kind: "ring-closure";
      readonly atomId: AtomId;
      readonly pos: Vec2;
      readonly angle: number;
      readonly refused: boolean;
    };

export const IDLE: InteractionState = Object.freeze({ kind: "idle" });

export interface InteractionResult {
  readonly state: InteractionState;
  readonly commands: readonly InteractionCommand[];
}
