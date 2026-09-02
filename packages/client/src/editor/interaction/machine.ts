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
 *   drag the rotate handle, or        rotate the selection about its centroid
 *     alt-drag inside the selection
 *   click                             select / extend / clear
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
  atomsInRect,
  benzene as buildBenzene,
  carbocycle,
  expandToBonds,
  isFusionBond,
  rectFromCorners,
  selection as coreSelection,
  sproutDrag,
  DEFAULT_ANGLE_STEP,
  DEFAULT_BOND_LENGTH,
  DEFAULT_MERGE_RADIUS,
} from "@starter/chem-core";
import type {
  AtomId,
  BondId,
  BondOrder,
  Molecule,
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
import type { Selection } from "@/state";

import type {
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

const MESSAGE_ALREADY_BONDED = "These atoms are already bonded";
const MESSAGE_FUSED_BOTH_SIDES = "That bond already has a ring on each side";

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

function sel(atomIds: readonly AtomId[], bondIds: readonly BondId[]): Selection {
  return { atomIds, bondIds };
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
  order: BondOrder,
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
      edit: () => guardedOps.sproutTo(base, from, sproutTarget, { order }).molecule,
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
 * hang off, so this is the one ring gesture that goes through the builders and
 * `insertFragment` instead. `RING_TEMPLATES` holds no hetero ring today, so
 * nothing is lost by `carbocycle` being unable to express one; when one is
 * added this is the call site that has to grow.
 */
function freeRing(
  mol: Molecule,
  centre: Vec2,
  size: number,
  bondLength: number,
): Molecule {
  const ring =
    size === 6
      ? buildBenzene(bondLength, centre)
      : carbocycle(size, "C", bondLength, centre);
  return guardedOps.insertFragment(mol, ring).molecule;
}

function ringClick(
  ctx: InteractionContext,
  sample: PointerSample,
): readonly InteractionCommand[] {
  const mol = ctx.molecule;
  const size = ctx.toolOptions.ringSize;
  const bondLength = documentBondLength(mol);
  const options = { bondLength };
  const hit = sample.hit;

  if (hit.kind === "bond") {
    // Pre-checked rather than caught: `fuseRingOnBond` throws on a bond that
    // already carries a ring on each side, and a throw out of a pointer
    // handler aborts the transaction AND propagates, taking the canvas down.
    if (isFusionBond(mol, hit.bondId)) {
      return [{ kind: "status", message: MESSAGE_FUSED_BOTH_SIDES }];
    }
    return [
      {
        kind: "edit",
        label: LABEL_RING,
        edit: (m) =>
          guardedOps.fuseRingOnBond(m, hit.bondId, { size }, options).molecule,
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
        edit: (m) => place(m, atomId, { size }, options).molecule,
      },
      { kind: "status", message: null },
    ];
  }

  return [
    {
      kind: "edit",
      label: LABEL_RING,
      edit: (m) => freeRing(m, sample.point, size, bondLength),
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
  if (state.kind === "hovering" && state.atomId === atomId && state.bondId === bondId) {
    return result(state);
  }
  return result({ kind: "hovering", atomId, bondId }, [
    { kind: "setHover", atomId, bondId },
  ]);
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
  const abandoned = committingBase(state);
  const ctx: InteractionContext =
    abandoned === null ? incoming : { ...incoming, molecule: abandoned };
  const stale: readonly InteractionCommand[] =
    abandoned === null ? NO_COMMANDS : [{ kind: "abortTransaction" }];

  const mol = ctx.molecule;
  const hit = origin.hit;

  // The rotate handle, and the alt-drag shortcut for it, both need something
  // to rotate. With nothing selected they fall through to the other rules.
  const rotatable = movingAtomIds(mol, ctx.selection);
  const wantsRotate =
    hit.kind === "handle" ||
    (sample.modifiers.alt &&
      hit.kind === "atom" &&
      selectionHasAtom(ctx.selection, hit.atomId));
  if (wantsRotate && rotatable.length > 0) {
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
    const drawing =
      ctx.tool === "bond" || !selectionHasAtom(ctx.selection, hit.atomId);
    const started = drawing
      ? startDrawing(mol, hit.atomId, sample, ctx.toolOptions.bondOrder)
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

  const swept = marqueeFrom(origin.point, sample, ctx);
  return result(swept.state, [...stale, ...swept.commands]);
}

/** The base of a transaction a previous gesture left open, or null. */
function committingBase(state: InteractionState): Molecule | null {
  switch (state.kind) {
    case "drawingBond":
    case "movingSelection":
    case "rotating":
      return state.base;
    default:
      return null;
  }
}

function startDrawing(
  mol: Molecule,
  from: AtomId,
  sample: PointerSample,
  order: BondOrder,
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
      order,
      target,
    },
    [
      { kind: "beginTransaction", label: LABEL_DRAW_BOND },
      ...drawFrame(mol, from, target, order),
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
  const atomIds = atomsInRect(ctx.molecule, rect);
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
        drawFrame(state.base, state.from, target, state.order),
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
      return result(IDLE, [
        { kind: "setSelection", selection: state.baseSelection },
        { kind: "status", message: null },
      ]);
    default:
      return result(IDLE);
  }
}

function onClick(
  state: InteractionState,
  sample: PointerSample,
  ctx: InteractionContext,
): InteractionResult {
  if (state.kind === "panning") return result(state);

  if (ctx.tool === "ring") {
    const commands = ringClick(ctx, sample);
    // One click, one entry: `transact` cannot span a drag, but a click is
    // synchronous and the begin/commit pair around a single edit is what makes
    // the label read "Add ring" rather than the edit's own.
    return result(IDLE, [
      { kind: "beginTransaction", label: LABEL_RING },
      ...commands,
      { kind: "commitTransaction" },
    ]);
  }

  if (ctx.tool === "bond" && sample.hit.kind === "atom") {
    const atomId = sample.hit.atomId;
    const bondLength = documentBondLength(ctx.molecule);
    const order = ctx.toolOptions.bondOrder;
    return result(IDLE, [
      { kind: "beginTransaction", label: LABEL_DRAW_BOND },
      {
        kind: "edit",
        label: LABEL_DRAW_BOND,
        edit: (m) => guardedOps.sprout(m, atomId, { bondLength, order }).molecule,
      },
      { kind: "commitTransaction" },
      { kind: "status", message: null },
    ]);
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
