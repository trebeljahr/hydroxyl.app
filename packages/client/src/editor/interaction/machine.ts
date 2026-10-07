/**
 * The editing state machine: a pure reducer from (state, fact, context) to a
 * new state and a list of commands.
 *
 * NOTHING IN THIS FILE TOUCHES REACT, THE DOM, THE STORE OR A PIXEL. It calls
 * chem-core, which is itself pure, and it returns commands rather than
 * performing them. That is what makes every gesture in the editor testable
 * with synthetic facts in a plain node process — see the header of facts.ts
 * for why that matters more here than it usually would.
 *
 * ── THE GESTURE MAP ────────────────────────────────────────────────────────
 *
 * With the SELECT tool, which is what the editor opens holding:
 *
 *   drag from an UNSELECTED atom      draw a bond at a snapped angle
 *   drag onto an existing atom        close a ring instead of duplicating it
 *   drag from a SELECTED atom or bond move the selection
 *   drag from an unselected bond      move that bond's two atoms
 *   drag from empty space             marquee (shift extends)
 *   alt-drag from empty space         lasso (shift extends; decision 231)
 *   drag the rotate handle, or        rotate the selection about its centroid
 *     alt-drag inside the selection     (two atoms or more)
 *   click                            select / extend / clear
 *
 * The split between "drag from an atom draws" and "drag a selection moves" is
 * not arbitrary: it is what the two acceptance criteria say in their own
 * words, and it is what makes the editor drawable before a tool rail exists.
 * Selecting an atom first is the explicit act that turns a drag from drawing
 * into moving, which is also how you say "and bring these five with it".
 *
 * With the BOND tool a drag from any atom draws, selected or not; with the
 * RING tool a click drops a template — over a bond it fuses, over an atom it
 * attaches, alt over an atom makes it spiro, over empty canvas it places a
 * free ring. That mapping is the one chem-core's templates note left open and
 * it is what ChemDraw does.
 *
 * ── VALENCE IS NEVER A PERMISSION CHECK ────────────────────────────────────
 *
 * `canAcceptBond` and `freeValence` appear nowhere below, deliberately.
 * Sprouting and template placement are never blocked by valence; drawing
 * something briefly over-valent is a normal step in sketching an intermediate,
 * and it surfaces as a badge from `valenceIssues()` rather than as a refused
 * gesture. Two things ARE refused, and both are structural impossibilities
 * rather than chemical opinions: bonding a pair of atoms that are already
 * bonded, and merging them.
 *
 * ── WHY EVERY FRAME REBUILDS FROM THE BASE ─────────────────────────────────
 *
 * See the note on `InteractionState` in facts.ts. Short version: a per-move
 * commit that composed forward would sprout a new atom on every frame.
 */

import {
  areBonded,
  atomsCentroid,
  atomsInPolygon,
  atomsInRect,
  closeOverAbbreviations,
  expandToBonds,
  isDegenerateBond,
  isFusionBond,
  rectFromCorners,
  selection as coreSelection,
  sproutDrag,
  templateRing,
  DEFAULT_ANGLE_STEP,
  DEFAULT_BOND_LENGTH,
  DEFAULT_MERGE_RADIUS,
  FUNCTIONAL_GROUPS,
  RING_TEMPLATES,
} from "@starter/chem-core";
import type {
  AtomId,
  BondId,
  Molecule,
  RingTemplate,
  SproutTarget,
  Vec2,
} from "@starter/chem-core";

// Mutating chem-core calls go through the guarded facade, not through
// chem-core directly. Every one of them ends up inside an `edit` closure the
// document slice runs, and the facade is the tripwire that catches an immer
// draft reaching chem-core — see the header of chem-guard.ts. The pure
// QUERIES above (`sproutDrag`, `atomsInRect`, `areBonded`, ...) need no guard
// because they mint nothing and return no molecule.
import { guardedOps } from "@/state/chem-guard";
import { elementForNewAtom, isRGroupEntry } from "../rgroup-entry";
import type { Selection } from "@/state";

import type {
  DrawnBond,
  DrawTarget,
  InteractionCommand,
  InteractionContext,
  InteractionResult,
  InteractionState,
  PointerFact,
  PointerSample,
  TargetMark,
} from "./facts";
import { IDLE, NO_COMMANDS } from "./facts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * How far a rotation snaps, while shift is held, in radians.
 *
 * 15 degrees rather than the 30 a bond snaps to: a rotation is applied to a
 * whole fragment whose internal geometry is already on the 30-degree lattice,
 * so the useful steps are the ones BETWEEN lattice positions as well as on
 * them — turning a substituent to the half-step is how a crowded drawing is
 * untangled.
 */
export const ROTATE_SNAP = (15 * Math.PI) / 180;

/**
 * Merge radius as a FRACTION of the drawing's own bond length.
 *
 * chem-core quotes `DEFAULT_MERGE_RADIUS` as 0.4 and takes it in absolute
 * model units, which is the same number only while the document is drawn at a
 * unit bond length. Scaling it here keeps ring closure equally easy to hit in
 * a document whose coordinates arrived from a molfile in Angstroms.
 */
const MERGE_RADIUS_FRACTION = DEFAULT_MERGE_RADIUS / DEFAULT_BOND_LENGTH;

const LABEL_DRAW_BOND = "Draw bond";
const LABEL_MOVE = "Move selection";
const LABEL_ROTATE = "Rotate selection";
const LABEL_MERGE = "Merge atoms";
const LABEL_RING = "Add ring";
const LABEL_CHAIN = "Add chain";
const LABEL_GROUP = "Add functional group";
const LABEL_ERASE = "Erase";
const LABEL_CHARGE = "Change charge";
const LABEL_SET_ELEMENT = "Set element";
const LABEL_ADD_ATOM = "Add atom";
const LABEL_SET_BOND = "Set bond type";

const MESSAGE_ALREADY_BONDED = "These atoms are already bonded";
const MESSAGE_FUSED_BOTH_SIDES = "That bond already has a ring on each side";
const MESSAGE_ZERO_LENGTH_BOND = "That bond has zero length; move its atoms apart first";

/**
 * Why a ring cannot be fused onto `bondId`, or undefined when it can.
 *
 * ONE answer for the two surfaces that fuse: the ring tool's click below and
 * the context menu's "Fuse ring" commands. Both are pre-checks rather than a
 * catch, because `fuseRingOnBond` THROWS on either condition, and a refusal
 * that names the reason is better than a rolled-back edit.
 *
 * `isFusionBond` covers a bond that already carries a ring on each side.
 * `isDegenerateBond` covers the other geometric impossibility: two coincident
 * atoms have no perpendicular bisector to place a ring across. A drawing
 * reaches that through an import with duplicate coordinates, or by a fragment
 * drag that parked one of its atoms on a neighbour.
 */
export function ringFuseRefusal(mol: Molecule, bondId: BondId): string | undefined {
  if (isFusionBond(mol, bondId)) return MESSAGE_FUSED_BOTH_SIDES;
  if (isDegenerateBond(mol, bondId)) return MESSAGE_ZERO_LENGTH_BOND;
  return undefined;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * The bond length this drawing is drawn at, in model units.
 *
 * chem-core's geometry defaults — the sprout length, the merge radius, every
 * ring template — all assume 1. A molecule that arrived from a molfile is in
 * Angstroms, so a sprouted bond would come out a third the length of the ones
 * beside it and an attached ring would not match the ring it was attached to.
 * Nothing throws; it just looks wrong, which is why it is derived rather than
 * assumed.
 *
 * The MEDIAN rather than the mean: one degenerate bond (two atoms left
 * coincident by an import) would drag a mean towards zero and take every
 * subsequent gesture's scale with it, while the median shrugs it off.
 */
export function documentBondLength(mol: Molecule): number {
  const lengths: number[] = [];
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined) continue;
    const from = mol.atoms[bond.from];
    const to = mol.atoms[bond.to];
    if (from === undefined || to === undefined) continue;
    const d = Math.hypot(to.pos.x - from.pos.x, to.pos.y - from.pos.y);
    if (Number.isFinite(d) && d > 0) lengths.push(d);
  }
  if (lengths.length === 0) return DEFAULT_BOND_LENGTH;
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1] ?? DEFAULT_BOND_LENGTH;
}

function sproutOptions(bondLength: number): {
  bondLength: number;
  angleStep: number;
  mergeRadius: number;
} {
  return {
    bondLength,
    angleStep: DEFAULT_ANGLE_STEP,
    mergeRadius: bondLength * MERGE_RADIUS_FRACTION,
  };
}

function sameVec(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function sameTarget(a: DrawTarget, b: DrawTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "ring-closure" && b.kind === "ring-closure") {
    return a.atomId === b.atomId && a.refused === b.refused;
  }
  return sameVec(a.pos, b.pos);
}

function sameMark(a: TargetMark | null, b: TargetMark | null): boolean {
  if (a === null || b === null) return a === b;
  return a.atomId === b.atomId && a.refused === b.refused;
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

const EMPTY_ATOMS: readonly AtomId[] = Object.freeze([]);
const EMPTY_BONDS: readonly BondId[] = Object.freeze([]);
const EMPTY_ANNOTATIONS: readonly string[] = Object.freeze([]);

/** The pointer machine picks atoms and bonds only; annotation picking
 *  arrives with the arrow tools, inside this same machine. */
function sel(atomIds: readonly AtomId[], bondIds: readonly BondId[]): Selection {
  return { atomIds, bondIds, annotationIds: EMPTY_ANNOTATIONS };
}

function selectionHasAtom(s: Selection, id: AtomId): boolean {
  return s.atomIds.includes(id);
}

function selectionHasBond(s: Selection, id: BondId): boolean {
  return s.bondIds.includes(id);
}

/**
 * Every atom a drag over `s` has to move: the selected atoms, plus the
 * endpoints of any selected bond.
 *
 * The endpoints matter because `subtractSelection` deliberately leaves a bond
 * selected whose atoms are not, and because clicking a bond selects the bond
 * alone — dragging it then has to take the two atoms it is drawn between, or
 * the "move" would move nothing at all.
 *
 * Ids the molecule does not have are dropped here rather than downstream:
 * `setAtomPositions` THROWS on an unknown id (unlike the transforms, which
 * skip), and a selection can legitimately name a retired atom for the render
 * between an undo and its own restore.
 */
export function movingAtomIds(mol: Molecule, s: Selection): readonly AtomId[] {
  const ids: AtomId[] = [];
  const seen = new Set<AtomId>();
  const take = (id: AtomId): void => {
    if (seen.has(id)) return;
    if (!Object.hasOwn(mol.atoms, id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const id of s.atomIds) take(id);
  for (const id of s.bondIds) {
    const bond = Object.hasOwn(mol.bonds, id) ? mol.bonds[id] : undefined;
    if (bond === undefined) continue;
    take(bond.from);
    take(bond.to);
  }
  return ids;
}

/** Union of two store selections, order-preserving, first occurrence wins. */
function unionSelection(a: Selection, b: Selection): Selection {
  const atomIds = [...a.atomIds];
  for (const id of b.atomIds) if (!atomIds.includes(id)) atomIds.push(id);
  const bondIds = [...a.bondIds];
  for (const id of b.bondIds) if (!bondIds.includes(id)) bondIds.push(id);
  return sel(atomIds, bondIds);
}

function selectionsMatch(a: Selection, b: Selection): boolean {
  return (
    a.atomIds.length === b.atomIds.length &&
    a.bondIds.length === b.bondIds.length &&
    a.atomIds.every((id, i) => id === b.atomIds[i]) &&
    a.bondIds.every((id, i) => id === b.bondIds[i])
  );
}

// ---------------------------------------------------------------------------
// Draw-target resolution
// ---------------------------------------------------------------------------

/**
 * Where the bond being drawn should end, given where the pointer is.
 *
 * Two sources of a ring-closure answer, and the second is not redundant.
 * `sproutDrag` looks for a merge partner within the merge radius OF THE
 * SNAPPED ENDPOINT, which is exactly right while every atom sits on the
 * 30-degree lattice — and unreachable the moment one does not. An imported
 * structure, a fragment the user rotated, an atom left over from an earlier
 * merge: the chemist drags the cursor squarely onto it, `sproutDrag` answers
 * "new atom", and the result is two atoms a fraction of a bond apart that draw
 * as one blob and export as two. So a direct hit on an atom under the POINTER
 * wins over the lattice answer.
 */
export function resolveDrawTarget(
  base: Molecule,
  from: AtomId,
  sample: PointerSample,
  bondLength: number,
): DrawTarget {
  const hit = sample.hit;
  const origin = Object.hasOwn(base.atoms, from) ? base.atoms[from] : undefined;
  if (origin !== undefined && hit.kind === "atom" && hit.atomId !== from) {
    const atom = Object.hasOwn(base.atoms, hit.atomId)
      ? base.atoms[hit.atomId]
      : undefined;
    if (atom !== undefined) {
      return {
        kind: "ring-closure",
        atomId: hit.atomId,
        pos: atom.pos,
        angle: Math.atan2(
          atom.pos.y - origin.pos.y,
          atom.pos.x - origin.pos.x,
        ),
        refused: areBonded(base, from, hit.atomId),
      };
    }
  }

  const target = sproutDrag(base, from, sample.point, sproutOptions(bondLength));
  if (target.kind === "new-atom") {
    return { kind: "new-atom", pos: target.pos, angle: target.angle };
  }
  return {
    kind: "ring-closure",
    atomId: target.atomId,
    pos: target.pos,
    angle: target.angle,
    refused: target.alreadyBonded,
  };
}

/** The chem-core value `sproutTo` wants, rebuilt from a resolved target. */
function toSproutTarget(target: DrawTarget): SproutTarget {
  if (target.kind === "new-atom") {
    return { kind: "new-atom", pos: target.pos, angle: target.angle };
  }
  return {
    kind: "ring-closure",
    atomId: target.atomId,
    pos: target.pos,
    angle: target.angle,
    // Never true here: a refused target never reaches `sproutTo`, which
    // throws on the flag precisely so that a UI which ignored it is caught.
    alreadyBonded: false,
  };
}

/**
 * The commands one frame of a bond drag produces.
 *
 * A refused target still emits an edit — back to the base — rather than
 * nothing. The pointer may have been over a legal target on the previous
 * frame, in which case the molecule currently holds a bond the user is being
 * told they cannot have, and leaving it there would let the status bar's
 * formula disagree with the refusal message right next to it.
 */
function drawFrame(
  base: Molecule,
  from: AtomId,
  target: DrawTarget,
  bond: DrawnBond,
): readonly InteractionCommand[] {
  if (target.kind === "ring-closure" && target.refused) {
    return [
      { kind: "edit", label: LABEL_DRAW_BOND, edit: () => base },
      { kind: "status", message: MESSAGE_ALREADY_BONDED },
    ];
  }
  const sproutTarget = toSproutTarget(target);
  return [
    {
      kind: "edit",
      label: LABEL_DRAW_BOND,
      edit: () => {
        // `element` is passed only for a NEW atom: a ring closure bonds two
        // atoms that already exist and re-typing one of them is not what the
        // gesture said.
        const grown = guardedOps.sproutTo(base, from, sproutTarget, {
          order: bond.order,
          ...(sproutTarget.kind === "new-atom"
            ? { element: elementForNewAtom(bond.element) }
            : {}),
        });
        // Decision 238: with "R" armed the new end is the next R-group.
        const drawn =
          isRGroupEntry(bond.element) && grown.createdAtom
            ? guardedOps.makeRGroup(grown.molecule, grown.atomId)
            : grown.molecule;
        // STEREO IS CHAINED RATHER THAN PASSED. chem-core's
        // `SproutBondOptions` is `{ element?, order? }` and has no stereo
        // member; widening it would put a drawing-tool concern into the
        // model, whereas the SproutResult already names the bond that was
        // minted. `sproutTo` reuses no bond, so this never re-types an
        // existing one — the narrow end lands at `from`, which is the atom
        // the drag started from, exactly as types.ts specifies.
        if (bond.stereo === "none") return drawn;
        return guardedOps.setBondStereo(drawn, grown.bondId, bond.stereo);
      },
    },
    { kind: "status", message: null },
  ];
}

function moveFrame(
  base: Molecule,
  atomIds: readonly AtomId[],
  delta: Vec2,
): readonly InteractionCommand[] {
  // ABSOLUTE positions from the base, not a relative nudge from the current
  // molecule. A relative translate re-applies the whole displacement on every
  // frame (the molecule already carries the previous one) and accumulates
  // float error over a long drag; this is idempotent and exact.
  const updates: [AtomId, Vec2][] = atomIds.map((id) => {
    const pos = base.atoms[id]!.pos;
    return [id, { x: pos.x + delta.x, y: pos.y + delta.y }];
  });
  return [
    {
      kind: "edit",
      label: LABEL_MOVE,
      edit: () => guardedOps.setAtomPositions(base, updates),
    },
  ];
}

function rotateFrame(
  base: Molecule,
  atomIds: readonly AtomId[],
  pivot: Vec2,
  angle: number,
): readonly InteractionCommand[] {
  return [
    {
      kind: "edit",
      label: LABEL_ROTATE,
      // Snapping is applied by the reducer, not passed on: the state has to
      // hold the angle that was actually applied so the overlay can report it
      // and so the next frame can tell whether anything changed.
      edit: () => guardedOps.rotateAtoms(base, atomIds, pivot, angle),
    },
  ];
}

function snapTo(angle: number, step: number): number {
  if (step <= 0) return angle;
  return Math.round(angle / step) * step;
}

// ---------------------------------------------------------------------------
// Ring templates
// ---------------------------------------------------------------------------

/**
 * Free placement of a ring on empty canvas.
 *
 * chem-core's three template entry points all need an existing atom or bond to
 * hang off, so this is the one ring gesture that goes through `templateRing`
 * and `insertFragment` instead.
 *
 * DRIVEN OFF THE RESOLVED TEMPLATE, NOT OFF `size === 6`. The size test was
 * the other half of the ring-template gap: it made a free 6-ring ALWAYS
 * benzene and cyclohexane unreachable, while the fuse/attach/spiro paths
 * passed `{ size }` and so made cyclohexane and never benzene. Same option,
 * opposite failures; both now read the one resolved template.
 */
function freeRing(
  mol: Molecule,
  centre: Vec2,
  template: RingTemplate,
  bondLength: number,
): Molecule {
  return guardedOps.insertFragment(mol, templateRing(template, bondLength, centre)).molecule;
}

function ringClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const mol = ctx.molecule;
  const template = RING_TEMPLATES[ctx.toolOptions.ringTemplate];
  const bondLength = documentBondLength(mol);
  const options = { bondLength };
  const hit = sample.hit;

  if (hit.kind === "bond") {
    // Pre-checked rather than caught: `fuseRingOnBond` throws on a bond that
    // already carries a ring on each side or has zero length, and a throw out
    // of a pointer handler aborts the transaction AND propagates, taking the
    // canvas down. The adapter would catch it, but a refusal that names the
    // reason is a better answer than a rolled-back gesture with a stack trace
    // behind it. See `ringFuseRefusal`.
    const refusal = ringFuseRefusal(mol, hit.bondId);
    if (refusal !== undefined) {
      return [{ kind: "status", message: refusal }];
    }
    return [
      {
        kind: "edit",
        label: LABEL_RING,
        edit: (m) =>
          guardedOps.fuseRingOnBond(m, hit.bondId, template, options).molecule,
      },
      { kind: "status", message: null },
    ];
  }

  if (hit.kind === "atom") {
    const atomId = hit.atomId;
    const place = sample.modifiers.alt
      ? guardedOps.spiroRingAtAtom
      : guardedOps.attachRingToAtom;
    return [
      {
        kind: "edit",
        label: LABEL_RING,
        edit: (m) => place(m, atomId, template, options).molecule,
      },
      { kind: "status", message: null },
    ];
  }

  return [
    {
      kind: "edit",
      label: LABEL_RING,
      edit: (m) => freeRing(m, sample.point, template, bondLength),
    },
    { kind: "status", message: null },
  ];
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

function result(
  state: InteractionState,
  commands: readonly InteractionCommand[] = NO_COMMANDS,
): InteractionResult {
  return { state, commands };
}

export function reduce(
  state: InteractionState,
  fact: PointerFact,
  ctx: InteractionContext,
): InteractionResult {
  switch (fact.kind) {
    case "hover":
      return onHover(state, fact.sample);
    case "hoverEnd":
      return onHoverEnd(state);
    case "press":
      return onPress(state, fact.sample);
    case "dragStart":
      return onDragStart(state, fact.origin, fact.sample, ctx);
    case "dragMove":
      return onDragMove(state, fact.sample, ctx);
    case "dragEnd":
      return onDragEnd(state, fact.sample, ctx);
    case "cancel":
      return onCancel(state);
    case "click":
      return onClick(state, fact.sample, ctx);
    case "panStart":
      return result({ kind: "panning" }, [
        { kind: "setHover", atomId: null, bondId: null },
      ]);
    case "panEnd":
      // GUARDED, not unconditional. A stray `panEnd` delivered while a
      // `drawingBond`, `movingSelection` or `rotating` holds an OPEN store
      // transaction would drop it with no `abortTransaction`, and the `cancel`
      // that followed would land on idle and emit nothing either — undo dead
      // for the rest of the session. The gesture reducer brackets every pan
      // (decision 106); this is the net under it, and it is cheap.
      if (state.kind !== "panning") return result(state);
      return result(IDLE);
  }
}

/**
 * Hover is suppressed outright while a gesture is in flight.
 *
 * Not merely ignored for tidiness: mid-drag the question "what would I click"
 * has no answer, and writing a hover halo onto the merge target the drag is
 * already highlighting draws two different marks on the same atom that mean
 * two different things.
 */
function onHover(state: InteractionState, sample: PointerSample): InteractionResult {
  if (state.kind !== "idle" && state.kind !== "hovering") return result(state);

  const atomId = sample.hit.kind === "atom" ? sample.hit.atomId : null;
  const bondId = sample.hit.kind === "bond" ? sample.hit.bondId : null;
  const handle = sample.hit.kind === "handle";
  const idsChanged =
    state.kind !== "hovering" || state.atomId !== atomId || state.bondId !== bondId;
  if (!idsChanged && state.handle === handle) return result(state);
  // Onto or off the handle alone writes nothing: the store's hover ids did
  // not change, and the handle flag is canvas-local — it reaches the overlay
  // through the state, not through the store.
  return result(
    { kind: "hovering", atomId, bondId, handle },
    idsChanged ? [{ kind: "setHover", atomId, bondId }] : NO_COMMANDS,
  );
}

function onHoverEnd(state: InteractionState): InteractionResult {
  if (state.kind !== "hovering") return result(state);
  return result(IDLE, [{ kind: "setHover", atomId: null, bondId: null }]);
}

/**
 * Pointerdown COMMITS NOTHING and selects nothing.
 *
 * Both halves are deliberate. Selecting on press would mean a drag that turns
 * out to be a marquee has already replaced the selection it is about to
 * compute, and a gesture the user cancels with Escape would still have moved
 * the selection. Opening a transaction on press would leave one open for every
 * click that never becomes a drag.
 */
function onPress(state: InteractionState, sample: PointerSample): InteractionResult {
  if (state.kind === "panning") return result(state);
  return result({ kind: "pendingDrag", origin: sample }, [
    { kind: "setHover", atomId: null, bondId: null },
  ]);
}

/**
 * A drag begins.
 *
 * THE FIRST TWO GUARDS EXIST TO CLOSE THE ONE FAILURE MODE THIS DESIGN CANNOT
 * SURVIVE: a transaction that is opened and never closed. Nothing throws when
 * that happens — undo and redo simply go dead, every later edit is recorded
 * under a stale base, and the next Escape rolls back to whenever the leak was.
 * The gesture hook already guarantees one gesture at a time, so neither guard
 * should ever fire; they are here because "should never happen" is not a thing
 * a silent, session-long corruption is worth betting on.
 */
function onDragStart(
  state: InteractionState,
  origin: PointerSample,
  sample: PointerSample,
  incoming: InteractionContext,
): InteractionResult {
  // A pan owns the pointer. Panning is not an edit and must not become one.
  if (state.kind === "panning") return result(state);

  // The stale gesture's own base, because `abortTransaction` will roll the
  // store back to it and the reducer cannot see that happen — building the new
  // gesture on the molecule the abandoned one had reached would re-apply its
  // half-finished edit as part of the next entry.
  const abandoned = gestureBase(state);
  const ctx: InteractionContext =
    abandoned === null ? incoming : { ...incoming, molecule: abandoned };
  const stale: readonly InteractionCommand[] =
    abandoned === null ? NO_COMMANDS : [{ kind: "abortTransaction" }];

  const mol = ctx.molecule;
  const hit = origin.hit;

  // The rotate handle, and the alt-drag shortcut for it, both need something
  // to rotate — and ONE atom is not something: it is its own centroid, so a
  // rotation about it is the identity. With fewer than two they fall through
  // to the other rules, which makes alt-drag on a lone selected atom a move,
  // and matches `rotateHandleGeometry`, which offers no handle there either.
  const rotatable = movingAtomIds(mol, ctx.selection);
  const wantsRotate =
    hit.kind === "handle" ||
    (sample.modifiers.alt &&
      hit.kind === "atom" &&
      selectionHasAtom(ctx.selection, hit.atomId));
  if (wantsRotate && rotatable.length > 1) {
    const pivot = atomsCentroid(mol, rotatable);
    return result(
      {
        kind: "rotating",
        label: LABEL_ROTATE,
        base: mol,
        atomIds: rotatable,
        pivot,
        reference: Math.atan2(origin.point.y - pivot.y, origin.point.x - pivot.x),
        angle: 0,
      },
      [...stale, { kind: "beginTransaction", label: LABEL_ROTATE }],
    );
  }

  if (hit.kind === "atom") {
    // The tools that draw when dragged off an atom. `element` is here because
    // dragging from a carbon with nitrogen selected is how a chemist adds an
    // amine — the tool names what the new atom is, not what the old one
    // becomes. The eraser, charge, chain and group tools deliberately are not:
    // all four are click gestures, and a drag with one of them held falls
    // through to move/marquee.
    const drawingTool = ctx.tool === "bond" || ctx.tool === "element";
    const drawing = drawingTool || !selectionHasAtom(ctx.selection, hit.atomId);
    const started = drawing
      ? startDrawing(mol, hit.atomId, sample, drawnBond(ctx.toolOptions))
      : startMoving(mol, ctx.selection, origin.point, sample, ctx);
    return result(started.state, [...stale, ...started.commands]);
  }

  if (hit.kind === "bond") {
    const bond = Object.hasOwn(mol.bonds, hit.bondId) ? mol.bonds[hit.bondId] : undefined;
    if (bond === undefined) {
      const swept = marqueeFrom(origin.point, sample, ctx);
      return result(swept.state, [...stale, ...swept.commands]);
    }
    // An unselected bond drags as itself. Selecting it first is what makes the
    // move visible while it happens and what leaves the user holding the thing
    // they just moved.
    const moving = selectionHasBond(ctx.selection, hit.bondId)
      ? ctx.selection
      : sel(EMPTY_ATOMS, [hit.bondId]);
    const select: readonly InteractionCommand[] =
      moving === ctx.selection ? [] : [{ kind: "setSelection", selection: moving }];
    const started = startMoving(mol, moving, origin.point, sample, ctx);
    return result(started.state, [...stale, ...select, ...started.commands]);
  }

  // Empty canvas. Alt turns the sweep into a lasso; a plain drag stays the
  // marquee, which decision 106 gives the primary drag (decision 231).
  const swept = origin.modifiers.alt || sample.modifiers.alt
    ? lassoFrom(origin.point, sample, ctx)
    : marqueeFrom(origin.point, sample, ctx);
  return result(swept.state, [...stale, ...swept.commands]);
}

/**
 * The molecule a committing gesture is rebuilding every frame FROM, or null
 * when no gesture is in flight.
 *
 * Two callers, and the second is why this is exported.
 *
 * `onDragStart` uses it to unwind a transaction an abandoned gesture left
 * open: `abortTransaction` will roll the store back to this molecule and the
 * reducer cannot see that happen.
 *
 * THE ADAPTER HIT-TESTS AGAINST IT. Because this machine commits on every
 * pointer-move, the live molecule mid-gesture already contains the gesture's
 * own work — the dragged atom sitting under the pointer, the atom the bond
 * being drawn just minted. Resolving a hit against that answers "what is under
 * the pointer" with "the thing in your hand", so the merge target underneath
 * is never seen: an accurately aimed drop finishes as a plain move and leaves
 * two unbonded atoms on identical coordinates — one blob on screen, two atoms
 * in the export — and the already-bonded refusal never fires either. Picking
 * against the base subtracts exactly this gesture's own displacement and
 * nothing else, because nothing but this gesture has moved anything since it
 * started.
 */
export function gestureBase(state: InteractionState): Molecule | null {
  switch (state.kind) {
    case "drawingBond":
    case "movingSelection":
    case "rotating":
      return state.base;
    default:
      return null;
  }
}

/** The three tool options a sprout honours, read once at drag start. */
function drawnBond(options: InteractionContext["toolOptions"]): DrawnBond {
  return {
    order: options.bondOrder,
    stereo: options.bondStereo,
    element: options.element,
  };
}

function startDrawing(
  mol: Molecule,
  from: AtomId,
  sample: PointerSample,
  bond: DrawnBond,
): InteractionResult {
  const bondLength = documentBondLength(mol);
  const target = resolveDrawTarget(mol, from, sample, bondLength);
  return result(
    {
      kind: "drawingBond",
      label: LABEL_DRAW_BOND,
      base: mol,
      from,
      bondLength,
      bond,
      target,
    },
    [
      { kind: "beginTransaction", label: LABEL_DRAW_BOND },
      ...drawFrame(mol, from, target, bond),
    ],
  );
}

function startMoving(
  mol: Molecule,
  selection: Selection,
  origin: Vec2,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  const atomIds = movingAtomIds(mol, selection);
  // A selection whose ids the molecule no longer has (an undo landed between
  // the press and the threshold crossing) has nothing to move. Falling back to
  // a marquee is better than opening a transaction that can only be empty.
  if (atomIds.length === 0) return marqueeFrom(origin, sample, ctx);
  const delta = { x: sample.point.x - origin.x, y: sample.point.y - origin.y };
  const merge = mergeMark(mol, atomIds, sample);
  return result(
    {
      kind: "movingSelection",
      label: LABEL_MOVE,
      base: mol,
      atomIds,
      origin,
      delta,
      merge,
    },
    [
      { kind: "beginTransaction", label: LABEL_MOVE },
      ...moveFrame(mol, atomIds, delta),
      ...mergeStatus(merge),
    ],
  );
}

function marqueeFrom(
  origin: Vec2,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  const state: InteractionState = {
    kind: "marquee",
    origin,
    point: sample.point,
    additive: sample.modifiers.shift,
    baseSelection: ctx.selection,
  };
  return result(state, marqueeCommands(state, ctx));
}

/**
 * Lasso points closer together than this, in bond lengths, are dropped. A
 * pointer reports a point per frame, so a slow sweep would otherwise grow a
 * path of thousands of near-duplicates that every later frame tests every atom
 * against; at a twentieth of a bond the path is still far finer than any gap
 * between two atoms it has to pass between.
 */
const LASSO_STEP_BONDS = 0.05;

function lassoFrom(
  origin: Vec2,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  const step = LASSO_STEP_BONDS * documentBondLength(ctx.molecule);
  const state: Extract<InteractionState, { kind: "lasso" }> = {
    kind: "lasso",
    path: extendPath([origin], sample.point, step),
    step,
    additive: sample.modifiers.shift,
    baseSelection: ctx.selection,
  };
  return result(state, sweepCommands(state, atomsInPolygon(ctx.molecule, state.path), ctx));
}

/** `path` with `point` appended, unless it is within `step` of the last one. */
function extendPath(path: readonly Vec2[], point: Vec2, step: number): readonly Vec2[] {
  const last = path[path.length - 1];
  if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < step) {
    return path;
  }
  return [...path, point];
}

/**
 * The merge candidate under the pointer, if this drag can merge at all.
 *
 * Only a SINGLE dragged atom can merge. Dropping a whole fragment onto one
 * atom has no defensible answer — which of the moving atoms is the one being
 * merged? — and answering "the nearest" would silently reshape a structure the
 * user was only repositioning.
 */
function mergeMark(
  mol: Molecule,
  atomIds: readonly AtomId[],
  sample: PointerSample,
): TargetMark | null {
  if (atomIds.length !== 1) return null;
  const dragged = atomIds[0]!;
  const hit = sample.hit;
  if (hit.kind !== "atom" || hit.atomId === dragged) return null;
  if (!Object.hasOwn(mol.atoms, hit.atomId)) return null;
  return { atomId: hit.atomId, refused: areBonded(mol, dragged, hit.atomId) };
}

function mergeStatus(merge: TargetMark | null): readonly InteractionCommand[] {
  if (merge === null) return [{ kind: "status", message: null }];
  return [
    {
      kind: "status",
      message: merge.refused ? MESSAGE_ALREADY_BONDED : null,
    },
  ];
}

function marqueeCommands(
  state: Extract<InteractionState, { kind: "marquee" }>,
  ctx: InteractionContext,
): readonly InteractionCommand[] {
  const rect = rectFromCorners(state.origin, state.point);
  return sweepCommands(state, atomsInRect(ctx.molecule, rect), ctx);
}

/** The selection a marquee or a lasso sweeping `atomIds` stands for. */
function sweepCommands(
  state: { readonly additive: boolean; readonly baseSelection: Selection },
  atomIds: readonly AtomId[],
  ctx: InteractionContext,
): readonly InteractionCommand[] {
  // `expandToBonds` explicitly, because `normalizeSelection` is purely
  // subtractive and will never derive the enclosed bonds back. A marquee that
  // skipped it looks right — the atoms highlight — and then deletes or copies
  // a structure with no bonds in it.
  const swept = expandToBonds(ctx.molecule, coreSelection(atomIds));
  const next = state.additive
    ? unionSelection(state.baseSelection, sel(swept.atomIds, swept.bondIds))
    : sel(swept.atomIds, swept.bondIds);
  if (selectionsMatch(next, ctx.selection)) return NO_COMMANDS;
  return [{ kind: "setSelection", selection: next }];
}

function onDragMove(
  state: InteractionState,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  switch (state.kind) {
    case "drawingBond": {
      const target = resolveDrawTarget(state.base, state.from, sample, state.bondLength);
      if (sameTarget(target, state.target)) return result(state);
      return result(
        { ...state, target },
        drawFrame(state.base, state.from, target, state.bond),
      );
    }
    case "movingSelection": {
      const delta = {
        x: sample.point.x - state.origin.x,
        y: sample.point.y - state.origin.y,
      };
      const merge = mergeMark(state.base, state.atomIds, sample);
      const moved = !sameVec(delta, state.delta);
      const retargeted = !sameMark(merge, state.merge);
      if (!moved && !retargeted) return result(state);
      const commands: InteractionCommand[] = [];
      if (moved) commands.push(...moveFrame(state.base, state.atomIds, delta));
      if (retargeted) commands.push(...mergeStatus(merge));
      return result({ ...state, delta, merge }, commands);
    }
    case "marquee": {
      const next = { ...state, point: sample.point };
      return result(next, marqueeCommands(next, ctx));
    }
    case "lasso": {
      const path = extendPath(state.path, sample.point, state.step);
      if (path === state.path) return result(state);
      const next = { ...state, path };
      return result(next, sweepCommands(next, atomsInPolygon(ctx.molecule, path), ctx));
    }
    case "rotating": {
      const bearing = Math.atan2(
        sample.point.y - state.pivot.y,
        sample.point.x - state.pivot.x,
      );
      const angle = snapTo(
        bearing - state.reference,
        sample.modifiers.shift ? ROTATE_SNAP : 0,
      );
      if (angle === state.angle) return result(state);
      return result(
        { ...state, angle },
        rotateFrame(state.base, state.atomIds, state.pivot, angle),
      );
    }
    default:
      return result(state);
  }
}

function onDragEnd(
  state: InteractionState,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  // A pan is ended by `panEnd` and by nothing else. The default arm below
  // would drop the machine to idle while the gesture reducer still believes it
  // is panning, and the next frame of a Space-drag over an atom would reach
  // the editing branches.
  if (state.kind === "panning") return result(state);

  // The final sample can differ from the last move — a pointerup carries its
  // own coordinates — so every state resolves it before closing.
  const settled = onDragMove(state, sample, ctx);

  switch (settled.state.kind) {
    case "drawingBond": {
      const target = settled.state.target;
      // A refusal that only lasted while the button was down tells the user
      // nothing: they let go, the message vanishes, and the bond they thought
      // they drew is simply absent. So the message OUTLIVES the gesture here,
      // and the next successful one clears it.
      const refused = target.kind === "ring-closure" && target.refused;
      return result(IDLE, [
        ...settled.commands,
        { kind: "commitTransaction" },
        {
          kind: "status",
          message: refused ? MESSAGE_ALREADY_BONDED : null,
        },
      ]);
    }

    case "rotating":
      return result(IDLE, [
        ...settled.commands,
        { kind: "commitTransaction" },
        { kind: "status", message: null },
      ]);

    case "movingSelection": {
      const moving = settled.state;
      const merge = moving.merge;
      if (merge === null) {
        return result(IDLE, [
          ...settled.commands,
          { kind: "commitTransaction" },
          { kind: "status", message: null },
        ]);
      }
      if (merge.refused) {
        // Decision 2: refuse the gesture rather than collapse a real bond.
        // Aborting rather than merely skipping the merge puts the atom back
        // where it started, so the refusal is visible instead of leaving a
        // structure subtly displaced.
        return result(IDLE, [
          { kind: "abortTransaction" },
          { kind: "status", message: MESSAGE_ALREADY_BONDED },
        ]);
      }
      return result(IDLE, [...settled.commands, ...commitMerge(moving, merge)]);
    }

    case "marquee":
    case "lasso":
      // Selection changes record no history entry of their own, so a marquee
      // never opened a transaction and has nothing to close.
      return result(IDLE, settled.commands);

    default:
      return result(IDLE, settled.commands);
  }
}

/**
 * The merge, and the selection repair it forces.
 *
 * `applyMoleculeEdit` prunes the selection inside the same history entry, so
 * the dragged id disappears from it — but nothing puts the SURVIVOR in its
 * place, and the user would be left holding an empty selection after a gesture
 * that visibly kept an atom on screen. The survivor keeps the TARGET's id and
 * position (decision 1) and the dragged atom's chemical identity, which is why
 * the argument order below is load-bearing: swapping it still merges, still
 * leaves one atom on screen, and gives it the wrong element.
 */
function commitMerge(
  moving: Extract<InteractionState, { kind: "movingSelection" }>,
  merge: TargetMark,
): readonly InteractionCommand[] {
  const dragged = moving.atomIds[0]!;
  return [
    {
      kind: "edit",
      label: LABEL_MERGE,
      edit: (m) => {
        const result = guardedOps.mergeAtoms(m, merge.atomId, dragged);
        // A failure here means the world changed under the gesture (an undo
        // landed, the atom went away). Returning the molecule unchanged makes
        // that a no-op rather than a throw out of a pointer handler.
        return result.ok ? result.molecule : m;
      },
    },
    { kind: "setSelection", selection: sel([merge.atomId], EMPTY_BONDS) },
    { kind: "commitTransaction" },
    { kind: "status", message: null },
  ];
}

/**
 * Escape, pointercancel, a lost capture, a hidden tab, unmount.
 *
 * `abortTransaction` restores the transaction's base snapshot VERBATIM — the
 * same Molecule instance, not an equal one — so the acceptance criterion
 * "leaves the molecule byte-identical" holds by reference identity. It unwinds
 * every nesting level by design, which is what makes it the right call here
 * and the wrong one inside a nested edit.
 */
function onCancel(state: InteractionState): InteractionResult {
  switch (state.kind) {
    case "drawingBond":
    case "movingSelection":
    case "rotating":
      return result(IDLE, [
        { kind: "abortTransaction" },
        { kind: "status", message: null },
      ]);
    case "marquee":
    case "lasso":
      return result(IDLE, [
        { kind: "setSelection", selection: state.baseSelection },
        { kind: "status", message: null },
      ]);
    default:
      return result(IDLE);
  }
}

/**
 * One click, one undo entry.
 *
 * `transact` cannot span a drag, but a click is synchronous, and the
 * begin/commit pair around a single edit is what makes the entry read "Add
 * ring" rather than whatever the edit itself was labelled.
 */
function clickTransaction(
  label: string,
  commands: readonly InteractionCommand[],
): InteractionResult {
  return result(IDLE, [
    { kind: "beginTransaction", label },
    ...commands,
    { kind: "commitTransaction" },
  ]);
}

/**
 * The eraser: click what you want gone.
 *
 * Removing an ATOM takes its bonds with it (chem-core's `removeAtoms` does),
 * which is what a chemist means by rubbing out a substituent. Removing a BOND
 * leaves both atoms — a C-C that becomes two methyls is a real intermediate
 * step, and deleting the atoms too would erase structure the user never
 * pointed at.
 */
function eraseClick(sample: PointerSample): readonly InteractionCommand[] {
  const hit = sample.hit;
  if (hit.kind === "atom") {
    return [
      {
        kind: "edit",
        label: LABEL_ERASE,
        // A contracted label is its atoms (decision 225): rubbing out "Boc"
        // takes all seven, not the one the label sits on.
        edit: (m) => guardedOps.removeAtoms(m, closeOverAbbreviations(m, [hit.atomId])),
      },
      // The erased atom cannot stay selected; `applyMoleculeEdit` prunes it,
      // but the bonds it took with it are pruned in the same pass and the
      // simplest honest answer is an empty selection.
      { kind: "setSelection", selection: sel(EMPTY_ATOMS, EMPTY_BONDS) },
      { kind: "status", message: null },
    ];
  }
  if (hit.kind === "bond") {
    return [
      {
        kind: "edit",
        label: LABEL_ERASE,
        edit: (m) => guardedOps.removeBonds(m, [hit.bondId]),
      },
      { kind: "setSelection", selection: sel(EMPTY_ATOMS, EMPTY_BONDS) },
      { kind: "status", message: null },
    ];
  }
  return NO_COMMANDS;
}

/**
 * The charge tool: one click is one unit, alt reverses the sign.
 *
 * Never clamped. A charge of +7 is chemical nonsense, and `valenceIssues`
 * already says so — refusing the keystroke instead would stop the user
 * passing THROUGH a wrong value on the way to the right one, which is how a
 * counter is used.
 */
function chargeClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const hit = sample.hit;
  if (hit.kind !== "atom") return NO_COMMANDS;
  const atom = Object.hasOwn(ctx.molecule.atoms, hit.atomId)
    ? ctx.molecule.atoms[hit.atomId]
    : undefined;
  if (atom === undefined) return NO_COMMANDS;
  const delta = sample.modifiers.alt
    ? -ctx.toolOptions.chargeDelta
    : ctx.toolOptions.chargeDelta;
  const next = atom.charge + delta;
  return [
    {
      kind: "edit",
      label: LABEL_CHARGE,
      edit: (m) => guardedOps.setCharge(m, hit.atomId, next),
    },
    { kind: "status", message: null },
  ];
}

/**
 * The element tool: retype an atom, or drop a lone one on empty canvas.
 *
 * The free-atom case is the only way to start a drawing that does not begin
 * with a carbon, and it is what makes an empty document reachable by anything
 * other than the ring tool.
 */
function elementClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const element = ctx.toolOptions.element;
  const hit = sample.hit;
  // Decision 238: "R" makes the clicked or placed atom the next R-group.
  const rgroup = isRGroupEntry(element);
  if (hit.kind === "atom") {
    return [
      {
        kind: "edit",
        label: LABEL_SET_ELEMENT,
        edit: (m) =>
          rgroup
            ? guardedOps.makeRGroup(m, hit.atomId)
            : guardedOps.setElement(m, hit.atomId, element),
      },
      { kind: "status", message: null },
    ];
  }
  if (hit.kind === "bond") return NO_COMMANDS;
  const pos = sample.point;
  return [
    {
      kind: "edit",
      label: LABEL_ADD_ATOM,
      edit: (m) => {
        const added = guardedOps.addAtom(m, { element: elementForNewAtom(element), pos });
        return rgroup ? guardedOps.makeRGroup(added.molecule, added.id) : added.molecule;
      },
    },
    { kind: "status", message: null },
  ];
}

/**
 * The chain tool: append `chainLength` atoms of zig-zag off the clicked atom,
 * or start a fresh chain where the canvas is empty.
 *
 * `appendChain` returns the molecule BY REFERENCE for a count of zero, so a
 * zero-length setting is a genuine no-op and records nothing.
 */
function chainClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const mol = ctx.molecule;
  const count = ctx.toolOptions.chainLength;
  const element = elementForNewAtom(ctx.toolOptions.element);
  const bondLength = documentBondLength(mol);
  const hit = sample.hit;
  if (hit.kind === "atom") {
    return [
      {
        kind: "edit",
        label: LABEL_CHAIN,
        edit: (m) =>
          guardedOps.appendChain(m, hit.atomId, count, { bondLength, element })
            .molecule,
      },
      { kind: "status", message: null },
    ];
  }
  if (hit.kind === "bond") return NO_COMMANDS;
  // A chain of n atoms drawn on empty canvas: one seed plus n-1 appended, so
  // the count the user set is the number of atoms they get.
  const pos = sample.point;
  return [
    {
      kind: "edit",
      label: LABEL_CHAIN,
      edit: (m) => {
        const seeded = guardedOps.addAtom(m, { element, pos });
        return guardedOps.appendChain(seeded.molecule, seeded.id, count - 1, {
          bondLength,
          element,
        }).molecule;
      },
    },
    { kind: "status", message: null },
  ];
}

/**
 * The functional-group tool: stamp the armed group onto the clicked atom
 * through a new single bond.
 *
 * AN ATOM OR NOTHING. A group is a substituent and needs something to
 * substitute. Dropped on empty canvas, "COOH" would have to mean formic acid
 * and "NO₂" the nitro tautomer of nitrous acid — the drawing taken literally,
 * and never what was meant — so a miss says what the tool wants instead of
 * guessing. A bond is refused the same way: there is no bond-shaped version
 * of a substituent, and the ring tool already owns "click a bond".
 */
function groupClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const name = ctx.toolOptions.functionalGroup;
  const hit = sample.hit;
  if (hit.kind !== "atom") {
    return [
      {
        kind: "status",
        message: `Click an atom to attach ${FUNCTIONAL_GROUPS[name].label}`,
      },
    ];
  }
  const atomId = hit.atomId;
  const bondLength = documentBondLength(ctx.molecule);
  return [
    {
      kind: "edit",
      label: LABEL_GROUP,
      edit: (m) =>
        guardedOps.attachGroupToAtom(m, atomId, name, { bondLength }).molecule,
    },
    { kind: "status", message: null },
  ];
}

/**
 * Clicking an EXISTING bond with the bond tool SETS it to the tool's current
 * order and stereo. It does not cycle.
 *
 * The backlog left this open. Setting wins because the tool already carries an
 * explicit order — you pressed 2, or picked the double-bond button — and a
 * cycle would ignore the number you just chose: a click on a double bond with
 * the double-bond tool held would make it a triple. Cycling is still reachable
 * from the command registry (`bond.cycle-order`) for the keyboard user who
 * wants it, so nothing is lost.
 */
function bondClickOnBond(
  ctx: InteractionContext,
  bondId: BondId,
): readonly InteractionCommand[] {
  const order = ctx.toolOptions.bondOrder;
  const stereo = ctx.toolOptions.bondStereo;
  return [
    {
      kind: "edit",
      label: LABEL_SET_BOND,
      edit: (m) =>
        guardedOps.setBondStereo(guardedOps.setBondOrder(m, bondId, order), bondId, stereo),
    },
    { kind: "setSelection", selection: sel(EMPTY_ATOMS, [bondId]) },
    { kind: "status", message: null },
  ];
}

function onClick(
  state: InteractionState,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  if (state.kind === "panning") return result(state);

  // THE ROTATE HANDLE SWALLOWS THE CLICK. Only `onDragStart` knows what a
  // "handle" hit is; a press and release under the slop — a hand that grabs
  // the handle and does not quite move — would fall through to the switch,
  // where "handle" is neither an atom nor a bond and reads as empty canvas:
  // select clears the selection the handle is drawn for, the element tool adds
  // an atom at the handle and the ring tool drops a ring there. The handle
  // stays up whichever tool is active (decision 105 gates it on the selection
  // alone), and `resolveHit` answers "handle" before it consults the scene, so
  // this is the only place that can refuse it.
  if (sample.hit.kind === "handle") return result(IDLE);

  switch (ctx.tool) {
    case "ring":
      return clickTransaction(LABEL_RING, ringClick(ctx, sample));
    case "chain":
      return clickTransaction(LABEL_CHAIN, chainClick(ctx, sample));
    case "group":
      return clickTransaction(LABEL_GROUP, groupClick(ctx, sample));
    case "eraser":
      return clickTransaction(LABEL_ERASE, eraseClick(sample));
    case "charge":
      return clickTransaction(LABEL_CHARGE, chargeClick(ctx, sample));
    case "element":
      return clickTransaction(LABEL_SET_ELEMENT, elementClick(ctx, sample));
    case "bond": {
      if (sample.hit.kind === "atom") {
        const atomId = sample.hit.atomId;
        const bondLength = documentBondLength(ctx.molecule);
        const bond = drawnBond(ctx.toolOptions);
        return clickTransaction(LABEL_DRAW_BOND, [
          {
            kind: "edit",
            label: LABEL_DRAW_BOND,
            edit: (m) => {
              const grown = guardedOps.sprout(m, atomId, {
                bondLength,
                order: bond.order,
                element: elementForNewAtom(bond.element),
              });
              const drawn =
                isRGroupEntry(bond.element) && grown.createdAtom
                  ? guardedOps.makeRGroup(grown.molecule, grown.atomId)
                  : grown.molecule;
              if (bond.stereo === "none") return drawn;
              return guardedOps.setBondStereo(
                drawn,
                grown.bondId,
                bond.stereo,
              );
            },
          },
          { kind: "status", message: null },
        ]);
      }
      if (sample.hit.kind === "bond") {
        return clickTransaction(
          LABEL_SET_BOND,
          bondClickOnBond(ctx, sample.hit.bondId),
        );
      }
      break;
    }
    case "select":
    case "pan":
      break;
  }

  return result(IDLE, selectCommands(sample, ctx));
}

function selectCommands(
  sample: PointerSample,
  ctx: InteractionContext,
): readonly InteractionCommand[] {
  const current = ctx.selection;
  const shift = sample.modifiers.shift;
  const hit = sample.hit;

  if (hit.kind === "atom") {
    const id = hit.atomId;
    const next = shift
      ? sel(
          selectionHasAtom(current, id)
            ? current.atomIds.filter((other) => other !== id)
            : [...current.atomIds, id],
          current.bondIds,
        )
      : sel([id], EMPTY_BONDS);
    return [{ kind: "setSelection", selection: next }];
  }

  if (hit.kind === "bond") {
    const id = hit.bondId;
    const next = shift
      ? sel(
          current.atomIds,
          selectionHasBond(current, id)
            ? current.bondIds.filter((other) => other !== id)
            : [...current.bondIds, id],
        )
      : sel(EMPTY_ATOMS, [id]);
    return [{ kind: "setSelection", selection: next }];
  }

  // Shift-click on empty space does NOTHING. A shift-click means "add to what
  // I already picked", and a multi-select is assembled by aiming at small
  // targets — missing one by two pixels must not discard the four already
  // collected. Only an unmodified click on background ends a selection.
  if (shift) return NO_COMMANDS;
  return [{ kind: "setSelection", selection: sel(EMPTY_ATOMS, EMPTY_BONDS) }];
}
