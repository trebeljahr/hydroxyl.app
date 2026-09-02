/**
 * Sprouting: growing a new bond off an atom.
 *
 * This is the editor's primary drawing gesture. Click an atom and a bond
 * appears in a sensible direction; press and drag and the bond follows the
 * pointer at a fixed length and a snapped angle, and if it lands on an atom
 * that is already there the gesture becomes a ring closure. Everything below
 * is geometry and reporting — the structural edits are molecule.ts's
 * `addAtom`/`addBond`, and the merge behind a ring closure is ops.ts's
 * `mergeAtoms`.
 *
 * Three rules here are load-bearing, and each is a decision rather than an
 * accident of the implementation.
 *
 * VALENCE NEVER BLOCKS A SPROUT, which is why this file does not import
 * valence.ts at all — not even to warn. `valenceIssues` already states the
 * policy: over-valence is "reported rather than prevented", because a chemist
 * sketching an intermediate should be able to draw something briefly wrong
 * without the editor fighting them. A saturated carbon therefore sprouts a
 * fifth bond quite happily and the badge appears afterwards. Consulting
 * `canAcceptBond` here would install a second, contradictory policy in the one
 * code path the user touches most, and the two would disagree the moment
 * either one's charge or metal handling changed. There is no import to keep in
 * step if there is no import.
 *
 * ANGLE SNAPPING IS RELATIVE TO THE BONDS ALREADY AT THE ATOM, not to absolute
 * multiples of 30 degrees about the page. A fragment that has been rotated to
 * sit at 17 degrees — because that is how it packs into an ACS-style figure —
 * must keep sprouting at 17 + 30k degrees, so it stays internally clean rather
 * than growing a bond that is square with the page and crooked with everything
 * it is attached to. The delta from a reference bond is what gets snapped, and
 * the reference is added back: `snapAngle(pointer - reference, step) +
 * reference`. The reference is the first incident bond in `bondsAt` order,
 * which is bond insertion order and therefore stable for the life of the
 * molecule. An atom with no bonds has nothing to be relative to, so it falls
 * back to reference 0, i.e. the absolute lattice.
 *
 * A RING CLOSURE REPORTS THE EXISTING ATOM'S POSITION, NOT THE SNAPPED POINT.
 * The merge that follows is target-wins — `mergeAtoms` keeps the target's id
 * and position precisely so the structure does not jump under the cursor — and
 * a preview drawn to the snapped point would promise a picture the commit then
 * fails to deliver. `alreadyBonded` is carried on the result for the same
 * reason: merging two atoms that are already bonded would collapse that bond
 * into a self-bond, so `mergeAtoms` refuses it, and the UI needs to know while
 * the pointer is still moving so it can refuse the gesture rather than snap
 * back at the end of it.
 */

import type { ElementSymbol } from "./elements.js";
import {
  addAtom,
  addBond,
  areBonded,
  bondsAt,
  otherEnd,
  requireAtom,
} from "./molecule.js";
import type { AtomId, BondId, BondOrder, Molecule } from "./types.js";
import {
  add,
  angleOf,
  cross,
  DEG,
  distanceSq,
  fromPolar,
  lengthSq,
  normalize,
  normalizeAngle,
  normalizeAnglePositive,
  ORIGIN,
  snapAngle,
  sub,
  vec,
  type Vec2,
} from "./vec.js";

/** One standard bond, in the abstract units the whole model uses. */
export const DEFAULT_BOND_LENGTH = 1;

/** 30 degrees: the increment that lands on the 60/120 degree vertices of a hexagon. */
export const DEFAULT_ANGLE_STEP = 30 * DEG;

/** How close the snapped endpoint must land to an existing atom to close a ring, bond-length units. */
export const DEFAULT_MERGE_RADIUS = 0.4;

/**
 * The angle a bond makes with its neighbour at an sp3 or sp2 centre. Chains
 * are drawn at 120 degrees whatever the real hybridisation, because the
 * zig-zag is a drawing convention, not a measurement.
 */
const SUBSTITUENT_TURN = 120 * DEG;

/** Carbon, the element a bare drawing gesture means unless told otherwise. */
const DEFAULT_ELEMENT: ElementSymbol = "C";

/**
 * Below this the cross product is noise rather than a side. Directions here
 * are unit vectors, so a substituent genuinely off the axis contributes of
 * order 0.5; anything nine orders of magnitude smaller than that is a
 * collinear substituent whose sign is whatever the last rounding said.
 */
const SIDE_EPSILON = 1e-9;

export interface SproutOptions {
  readonly bondLength?: number;
  readonly angleStep?: number;
  readonly mergeRadius?: number;
}

/** Where a sprout ends up: at a fresh atom, or on one that is already there. */
export type SproutTarget =
  | { readonly kind: "new-atom"; readonly pos: Vec2; readonly angle: number }
  | {
      readonly kind: "ring-closure";
      readonly atomId: AtomId;
      readonly pos: Vec2;
      readonly angle: number;
      readonly alreadyBonded: boolean;
    };

export interface SproutResult {
  readonly molecule: Molecule;
  /** The far end: newly minted, or the existing ring-closure partner. */
  readonly atomId: AtomId;
  readonly bondId: BondId;
  readonly createdAtom: boolean;
}

// ---------------------------------------------------------------------------
// Local geometry
// ---------------------------------------------------------------------------

/**
 * Offsets from `atomId` to each bonded neighbour, in bond insertion order.
 *
 * Exported for templates.ts, which asks `largestGapBisector` the same "where
 * is there room" question over these directions plus the ring interiors the
 * atom sits on. Two copies of the traversal would be two things to keep in
 * step with `bondsAt`'s ordering guarantee.
 */
export function bondDirections(mol: Molecule, atomId: AtomId): Vec2[] {
  const origin = requireAtom(mol, atomId).pos;
  return bondsAt(mol, atomId).map((bond) =>
    sub(requireAtom(mol, otherEnd(bond, atomId)).pos, origin),
  );
}

/**
 * The angle every snap on this atom is measured from: the first incident bond
 * in `bondsAt` order. Insertion order makes the choice deterministic — the
 * same drag on the same molecule always snaps to the same lattice — and an
 * unbonded atom has no local frame at all, so it gets the absolute one.
 */
function referenceAngle(mol: Molecule, atomId: AtomId): number {
  const first = bondDirections(mol, atomId)[0];
  return first === undefined ? 0 : angleOf(first);
}

/**
 * Which way to turn off a terminal atom's only bond.
 *
 * Both +120 and -120 degrees are chemically identical; the choice is what
 * makes a chain zig-zag instead of coiling into a spiral. The new bond goes on
 * the far side of the atom->neighbour axis from whatever else is hanging off
 * that neighbour, which is the anti/trans arrangement a chemist draws by hand.
 *
 * The other substituents are averaged as UNIT directions. Averaging raw
 * offsets would let one long bond outvote two short ones and pick the side by
 * bond length, which has nothing to do with the question being asked.
 */
function terminalSproutAngle(mol: Molecule, atomId: AtomId, axis: Vec2): number {
  const base = angleOf(axis);
  const neighborBond = bondsAt(mol, atomId)[0];
  if (!neighborBond) return base + SUBSTITUENT_TURN;
  const neighborId = otherEnd(neighborBond, atomId);
  const neighborPos = requireAtom(mol, neighborId).pos;

  let sum: Vec2 = ORIGIN;
  let count = 0;
  let first: Vec2 | undefined;
  for (const bond of bondsAt(mol, neighborId)) {
    const otherId = otherEnd(bond, neighborId);
    if (otherId === atomId) continue;
    const direction = normalize(sub(requireAtom(mol, otherId).pos, neighborPos));
    if (first === undefined) first = direction;
    sum = add(sum, direction);
    count++;
  }

  // A lone two-atom molecule has no zig-zag to continue. Turn counter-clockwise
  // by convention so the result is at least reproducible.
  if (count === 0 || first === undefined) return base + SUBSTITUENT_TURN;

  // Positive cross product means the substituents lie counter-clockwise of the
  // axis, so the new bond turns clockwise to end up opposite them.
  const side = cross(axis, vec(sum.x / count, sum.y / count));
  if (Math.abs(side) > SIDE_EPSILON) {
    return side > 0 ? base - SUBSTITUENT_TURN : base + SUBSTITUENT_TURN;
  }

  // The average cancelled: the neighbour's other substituents sit symmetrically
  // about the axis, so it has no side to be on. That is not an exotic input —
  // it is exactly what a `sprout` onto a chain produces, because the sprout
  // lands at the free vertex, which is symmetric about the chain axis by
  // construction. "Draw a chain, add a methyl, extend the chain" therefore hits
  // it every time, and turning counter-clockwise regardless would repeat the
  // previous turn and bend the backbone 60 degrees at the branch.
  //
  // So lean off the FIRST of those substituents instead. `bondsAt` order is
  // bond insertion order — the same stability tiebreak `referenceAngle` uses —
  // and for a chain drawn one bond at a time it is the backbone the user is
  // extending, which is the phase the zig-zag has to continue.
  const firstSide = cross(axis, first);
  return firstSide > SIDE_EPSILON ? base - SUBSTITUENT_TURN : base + SUBSTITUENT_TURN;
}

/**
 * The bisector of the widest wedge of empty space around the atom.
 *
 * For a trigonal centre whose two bonds are 120 degrees apart this is exactly
 * the free vertex, so the general rule already covers the case a drawing tool
 * cares about most, and it degrades sensibly for the crowded centres it does
 * not: the new bond simply goes wherever there is most room.
 *
 * Ties — a linear allene or alkyne centre presents two gaps of exactly 180
 * degrees — are broken by taking the first gap in sorted-angle order, so a
 * repeated gesture on the same structure keeps producing the same drawing.
 *
 * The directions are whatever the caller counts as occupied. Bonds are all a
 * sprout knows about; templates.ts adds the ring interiors the atom sits on,
 * because a tie broken by angle order alone can hand a ring template the wedge
 * that is the existing ring's inside.
 */
export function largestGapBisector(directions: readonly Vec2[]): number {
  const angles = directions
    .map((d) => normalizeAnglePositive(angleOf(d)))
    .sort((a, b) => a - b);
  const first = angles[0];
  if (first === undefined) return 0;

  let bestStart = first;
  let bestGap = -Infinity;
  for (let i = 0; i < angles.length; i++) {
    const start = angles[i]!;
    // The last gap wraps past 2PI back to the first bond.
    const end = i + 1 < angles.length ? angles[i + 1]! : first + 2 * Math.PI;
    const gap = end - start;
    // Strictly greater, so the earliest of several equal gaps wins.
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = start;
    }
  }
  return normalizeAngle(bestStart + bestGap / 2);
}

/** Nearest atom to `point` within `radius`, ignoring `excludeId`. */
function nearestAtomWithin(
  mol: Molecule,
  point: Vec2,
  radius: number,
  excludeId: AtomId,
): AtomId | undefined {
  const limit = radius * radius;
  let bestId: AtomId | undefined;
  let bestDistanceSq = Infinity;
  for (const id of mol.atomIds) {
    if (id === excludeId) continue;
    const d = distanceSq(point, requireAtom(mol, id).pos);
    // Strictly closer, so ties fall to the earlier atom in insertion order.
    if (d <= limit && d < bestDistanceSq) {
      bestDistanceSq = d;
      bestId = id;
    }
  }
  return bestId;
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

/**
 * Direction, in radians, for a click-without-drag sprout.
 *
 * Three cases, in order of how much geometry there is to respect: an isolated
 * atom has none and grows along +x; a terminal atom continues its chain's
 * zig-zag; anything else fills its widest gap.
 */
export function defaultSproutAngle(mol: Molecule, atomId: AtomId): number {
  const directions = bondDirections(mol, atomId);
  const only = directions[0];
  if (only === undefined) return 0;
  if (directions.length === 1) {
    return normalizeAngle(terminalSproutAngle(mol, atomId, only));
  }
  return largestGapBisector(directions);
}

/** Where that new atom goes. */
export function defaultSproutPosition(
  mol: Molecule,
  atomId: AtomId,
  options?: SproutOptions,
): Vec2 {
  const origin = requireAtom(mol, atomId).pos;
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;
  return add(origin, fromPolar(defaultSproutAngle(mol, atomId), bondLength));
}

/**
 * Live drag: snap the pointer to a fixed bond length at a snapped angle, then
 * see what is there.
 *
 * The length is fixed rather than taken from the pointer because a drawing
 * tool's job is to produce a figure with one bond length in it; the drag
 * chooses a direction, not a distance. An `angleStep` of 0 or less means "no
 * snapping" — that is `snapAngle`'s own contract, relied on here rather than
 * re-tested.
 *
 * A pointer that has not moved off the atom has no direction to offer, so it
 * answers with the click direction: the first frame of a press-and-hold then
 * previews exactly what letting go would draw, instead of flicking to +x.
 */
export function sproutDrag(
  mol: Molecule,
  atomId: AtomId,
  pointer: Vec2,
  options?: SproutOptions,
): SproutTarget {
  const origin = requireAtom(mol, atomId).pos;
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;
  const angleStep = options?.angleStep ?? DEFAULT_ANGLE_STEP;
  const mergeRadius = options?.mergeRadius ?? DEFAULT_MERGE_RADIUS;

  const delta = sub(pointer, origin);
  const reference = referenceAngle(mol, atomId);
  const angle =
    lengthSq(delta) === 0
      ? defaultSproutAngle(mol, atomId)
      : normalizeAngle(
          snapAngle(angleOf(delta) - reference, angleStep) + reference,
        );
  const pos = add(origin, fromPolar(angle, bondLength));

  const hitId = nearestAtomWithin(mol, pos, mergeRadius, atomId);
  if (hitId !== undefined) {
    return {
      kind: "ring-closure",
      atomId: hitId,
      // The existing atom's own position, not `pos`: see the header note on
      // target-wins merging. `angle` stays the direction the gesture snapped
      // to, which is what the pointer layer reasons about; anything drawn to
      // the atom should be drawn to `pos`.
      pos: requireAtom(mol, hitId).pos,
      angle,
      alreadyBonded: areBonded(mol, atomId, hitId),
    };
  }
  return { kind: "new-atom", pos, angle };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface SproutBondOptions {
  readonly element?: ElementSymbol;
  readonly order?: BondOrder;
}

function growNewAtom(
  mol: Molecule,
  atomId: AtomId,
  pos: Vec2,
  options?: SproutBondOptions,
): SproutResult {
  const grown = addAtom(mol, {
    element: options?.element ?? DEFAULT_ELEMENT,
    pos,
  });
  const bonded = addBond(grown.molecule, {
    // `from` is the atom sprouted FROM, so a wedge applied to this bond later
    // has its narrow end at the existing structure — the way a substituent
    // coming out of the page is drawn.
    from: atomId,
    to: grown.id,
    order: options?.order ?? 1,
  });
  return {
    molecule: bonded.molecule,
    atomId: grown.id,
    bondId: bonded.id,
    createdAtom: true,
  };
}

/** Click without dragging: grow a bond in the default direction. */
export function sprout(
  mol: Molecule,
  atomId: AtomId,
  options?: SproutOptions & SproutBondOptions,
): SproutResult {
  return growNewAtom(
    mol,
    atomId,
    defaultSproutPosition(mol, atomId, options),
    options,
  );
}

/**
 * Commit a drag target.
 *
 * THROWS on a ring closure whose `alreadyBonded` flag is set. The UI is
 * expected to have consulted that flag on the drag frame and refused the
 * gesture already; reaching here means it did not. `addBond` throws on a
 * duplicate for the same reason, and says so: a duplicate bond is a
 * programming error, not a user-recoverable state, and returning a quiet
 * no-op instead would leave the caller believing it had drawn something.
 */
export function sproutTo(
  mol: Molecule,
  atomId: AtomId,
  target: SproutTarget,
  options?: SproutBondOptions,
): SproutResult {
  if (target.kind === "new-atom") {
    return growNewAtom(mol, atomId, target.pos, options);
  }
  if (target.alreadyBonded) {
    throw new Error(
      `Atoms ${atomId} and ${target.atomId} are already bonded; the gesture ` +
        `should have been refused while alreadyBonded was set`,
    );
  }
  const bonded = addBond(mol, {
    from: atomId,
    to: target.atomId,
    order: options?.order ?? 1,
  });
  // No atom is minted and the existing one keeps its element and charge: the
  // ring closure joins what is already drawn, and `options.element` describes
  // an atom that is not being created. Honouring it here would silently
  // retype an atom the user only pointed at.
  return {
    molecule: bonded.molecule,
    atomId: target.atomId,
    bondId: bonded.id,
    createdAtom: false,
  };
}
