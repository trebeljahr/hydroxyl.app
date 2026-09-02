/**
 * Which side of a double bond the second line sits on.
 *
 * `types.ts` in chem-core defers `DoubleBondSide: "auto"` to the renderer, and
 * this is where that deferral is honoured. The answer is a POINT IN MODEL
 * SPACE that the inner line leans toward, never a handedness and never a
 * pixel:
 *
 *   MODEL SPACE, NO `RenderStyle`. The contact sheet draws every fixture at
 *   both presets, and a decision taken in px could put the inner line on
 *   different sides at 24 px and at 44 px for the same molecule. Taking no
 *   style at all makes that unrepresentable, and leaves the verdict a pure
 *   function of the `Molecule` — memoisable, and comparable across two
 *   constructions of the same structure.
 *
 *   A POINT, NOT `"left"`/`"right"`. `left`/`right` are relative to the bond's
 *   own direction (transform.ts says so, and `flipAtoms` mirrors the value for
 *   exactly that reason), so a handedness returned from here would move when
 *   `flipBond` swapped `from` and `to` — and `from`/`to` are an artefact of how
 *   the molecule happened to be built. `scene/build.ts` pushes the point
 *   through `modelToPx` alongside the two endpoints and differences the
 *   converted points, which is provably neither a second scale nor a second
 *   flip.
 *
 * STABILITY IS THE WHOLE POINT, so every comparison below is either an integer
 * or a sign test on a quantity of about half a ring radius. Nothing sorts
 * floats, nothing reads a ring INDEX, a `bondIds` position or an atom id:
 *
 *   - `rings(mol)` is a SET whose array order comes from insertion order.
 *     rings.test.ts sorts before comparing on purpose. Two constructions of
 *     naphthalene disagree about which ring is index 0.
 *   - `Ring.atomIds[0]` and the walk direction are canonical per molecule
 *     instance and construction-dependent across instances.
 *   - Comparing the two ring centroids' perpendicular DISTANCES on a fusion
 *     bond is a float comparison of two numbers that agree to ~1e-16 in
 *     memory and differ by ~0.001 px after a molblock round trip, because
 *     `writeMolblock` rounds coordinates to four decimals. Same figure, two
 *     file formats, two drawings.
 *
 * So the fusion case is decided by a TOPOLOGICAL key — (aromatic?, ring size)
 * — and equality on that key means the two sides are genuinely
 * interchangeable, for which centred is the only mirror-equivariant answer.
 *
 * NO `Math.atan2`, NO `Math.hypot`: both are implementation-approximated and
 * these bytes get committed and diffed. See the header of label/placement.ts.
 */

import {
  getAtom,
  isAromaticRing,
  neighborIds,
  ringAt,
  ringCentroid,
  ringsAtBond,
} from "@starter/chem-core";
import type { AtomId, BondId, Molecule, Vec2 } from "@starter/chem-core";

/**
 * Where the second line leans.
 *
 * `toward.point` is a MODEL-space position — a ring centroid, a substituent
 * mean, or a unit step off the bond midpoint for a manual `left`/`right`. Only
 * its side of the bond axis is read, never its distance.
 */
export type DoubleBondResolution =
  | { readonly kind: "centered" }
  | { readonly kind: "toward"; readonly point: Vec2 };

const CENTERED: DoubleBondResolution = Object.freeze({ kind: "centered" });

export const DOUBLE_BOND_RESOLUTION = Object.freeze({
  /**
   * Below this the two atoms are the same point and the bond has no axis.
   * Matches `LABEL_PLACEMENT.coincidentEpsilonPx` in spirit; the units here
   * are model bond lengths, not px.
   */
  coincidentEpsilon: 1e-9,
  /**
   * A neighbour whose perpendicular offset is under this fraction of the bond
   * length counts for NEITHER side.
   *
   * An allene's far carbon sits exactly on the axis and the sign of its offset
   * is float noise, so without this every R2C=C=CR2 picks a side at random.
   * This is a BUCKET ASSIGNMENT, not a sort comparator — bucketing by a
   * threshold stays transitive, where an epsilon inside a comparator would
   * make the sort non-total and permutation-dependent.
   */
  onAxisFraction: 0.05,
});

/**
 * The second line's lean for `bondId`, or `centered`.
 *
 * Total: a missing bond, a missing atom, an order other than 2 and a
 * zero-length bond all answer `centered` rather than throwing. A scene is a
 * view of a possibly-mid-edit molecule.
 */
export function resolveDoubleBondSide(
  mol: Molecule,
  bondId: BondId,
): DoubleBondResolution {
  const bond = mol.bonds[bondId];
  if (bond === undefined || bond.order !== 2) return CENTERED;

  const from = getAtom(mol, bond.from);
  const to = getAtom(mol, bond.to);
  if (from === undefined || to === undefined) return CENTERED;

  const axis: Vec2 = { x: to.pos.x - from.pos.x, y: to.pos.y - from.pos.y };
  const lengthSquared = axis.x * axis.x + axis.y * axis.y;
  if (lengthSquared < DOUBLE_BOND_RESOLUTION.coincidentEpsilon) return CENTERED;
  const mid: Vec2 = {
    x: (from.pos.x + to.pos.x) / 2,
    y: (from.pos.y + to.pos.y) / 2,
  };

  switch (bond.doubleBondSide) {
    case "centered":
      return CENTERED;
    // `left` is 90 degrees counter-clockwise of `from`->`to` in chem-core's
    // y-up space, which is what the reader of a molfile means by it. The step
    // is a whole bond length so the point stays well clear of the axis for the
    // sign test that reads it back.
    case "left":
      return { kind: "toward", point: { x: mid.x - axis.y, y: mid.y + axis.x } };
    case "right":
      return { kind: "toward", point: { x: mid.x + axis.y, y: mid.y - axis.x } };
    case "auto":
      break;
  }

  return resolveAuto(mol, bondId, bond.from, bond.to, axis, mid, lengthSquared);
}

function resolveAuto(
  mol: Molecule,
  bondId: BondId,
  fromId: AtomId,
  toId: AtomId,
  axis: Vec2,
  mid: Vec2,
  lengthSquared: number,
): DoubleBondResolution {
  const byRing = resolveFromRings(mol, bondId, axis, mid, lengthSquared);
  if (byRing !== undefined) return byRing;
  return resolveFromSubstituents(mol, fromId, toId, axis, mid, lengthSquared);
}

/** How far off the bond axis `p` sits, as a fraction of the bond length. */
function offsetFraction(
  axis: Vec2,
  mid: Vec2,
  lengthSquared: number,
  p: Vec2,
): number {
  // cross(axis, p - mid) is |axis| times the perpendicular distance, so
  // dividing by |axis|^2 gives that distance in bond lengths without a sqrt.
  return (axis.x * (p.y - mid.y) - axis.y * (p.x - mid.x)) / lengthSquared;
}

interface RingCandidate {
  readonly centroid: Vec2;
  /** Lower wins. Aromatic before non-aromatic, then smaller ring first. */
  readonly key: readonly [number, number];
}

/**
 * Ring membership, the first and strongest rule.
 *
 * Keyed on the BOND's membership, never on whether its atoms happen to sit in
 * a ring: a cyclohexanone's exocyclic C=O has a ring atom at one end and must
 * still draw centred, and `isRingAtom` here is the bug that draws it leaning
 * into the ring.
 *
 * Returns undefined when the bond is in no ring at all, or when every
 * containing ring's centroid sits on the axis (a degenerate drawing), so the
 * substituent rule gets its turn.
 */
function resolveFromRings(
  mol: Molecule,
  bondId: BondId,
  axis: Vec2,
  mid: Vec2,
  lengthSquared: number,
): DoubleBondResolution | undefined {
  const ringIndices = ringsAtBond(mol, bondId);
  if (ringIndices.length === 0) return undefined;

  let positive: RingCandidate[] = [];
  let negative: RingCandidate[] = [];

  for (const ringIndex of ringIndices) {
    const centroid = ringCentroid(mol, ringIndex);
    const fraction = offsetFraction(axis, mid, lengthSquared, centroid);
    if (Math.abs(fraction) < DOUBLE_BOND_RESOLUTION.onAxisFraction) continue;
    const candidate: RingCandidate = {
      centroid,
      key: [
        isAromaticRing(mol, ringIndex) ? 0 : 1,
        ringAt(mol, ringIndex).size,
      ],
    };
    const bucket = fraction > 0 ? positive : negative;
    bucket.push(candidate);
  }

  positive = bestOf(positive);
  negative = bestOf(negative);
  if (positive.length === 0 && negative.length === 0) return undefined;
  if (positive.length === 0) return { kind: "toward", point: meanOf(negative) };
  if (negative.length === 0) return { kind: "toward", point: meanOf(positive) };

  // A fusion bond pulled both ways. The keys are integers, so this comparison
  // cannot flip between two constructions of the same molecule or across a
  // molblock round trip — which is exactly what a distance comparison does.
  const comparison = compareKeys(positive[0]!.key, negative[0]!.key);
  if (comparison === 0) return CENTERED;
  return {
    kind: "toward",
    point: meanOf(comparison < 0 ? positive : negative),
  };
}

/** The candidates sharing the lowest key. Order-free: a filter, not a sort. */
function bestOf(candidates: readonly RingCandidate[]): RingCandidate[] {
  let best: readonly [number, number] | undefined;
  for (const candidate of candidates) {
    if (best === undefined || compareKeys(candidate.key, best) < 0) {
      best = candidate.key;
    }
  }
  if (best === undefined) return [];
  const winner = best;
  return candidates.filter((c) => compareKeys(c.key, winner) === 0);
}

function compareKeys(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

function meanOf(candidates: readonly RingCandidate[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const candidate of candidates) {
    x += candidate.centroid.x;
    y += candidate.centroid.y;
  }
  return { x: x / candidates.length, y: y / candidates.length };
}

/**
 * Substituent count, the fallback for an acyclic double bond.
 *
 * A TERMINAL END DRAWS CENTRED, and that clause carries most of the chemistry
 * here. A carbonyl is the case: acetate's C=O, a ketone, an amide — the oxygen
 * has no substituents of its own, there is no enclosed region for an inner
 * line to sit in, and a C=O with its second line pushed to one side reads as a
 * drawing error. The same falls out for a terminal alkene and for a sulfone's
 * two S=O.
 *
 * Otherwise the side with strictly MORE substituents wins, and the inner line
 * leans toward their mean position — the cis pocket of a cis-alkene, which is
 * where a chemist draws it.
 *
 * EQUAL COUNTS, ZERO INCLUDED, DRAW CENTRED, and that is the deterministic
 * tiebreak rather than a step before one. An arbitrary last-resort side (the
 * east-pointing normal, the lower atom id, the first ring in the membership
 * list) would buy nothing and would cost mirror-equivariance: reflect the
 * figure and "always prefer east" re-picks east, putting the inner line on the
 * wrong physical side of the mirrored drawing. It would also contradict this
 * task's own acceptance criterion that a chain C=C draws centred.
 */
function resolveFromSubstituents(
  mol: Molecule,
  fromId: AtomId,
  toId: AtomId,
  axis: Vec2,
  mid: Vec2,
  lengthSquared: number,
): DoubleBondResolution {
  const nearFrom = neighborIds(mol, fromId).filter((id) => id !== toId);
  const nearTo = neighborIds(mol, toId).filter((id) => id !== fromId);
  if (nearFrom.length === 0 || nearTo.length === 0) return CENTERED;

  const positive: Vec2[] = [];
  const negative: Vec2[] = [];
  for (const neighbourId of [...nearFrom, ...nearTo]) {
    const neighbour = getAtom(mol, neighbourId);
    if (neighbour === undefined) continue;
    const fraction = offsetFraction(axis, mid, lengthSquared, neighbour.pos);
    if (Math.abs(fraction) < DOUBLE_BOND_RESOLUTION.onAxisFraction) continue;
    (fraction > 0 ? positive : negative).push(neighbour.pos);
  }

  if (positive.length === negative.length) return CENTERED;
  const winner = positive.length > negative.length ? positive : negative;
  let x = 0;
  let y = 0;
  for (const p of winner) {
    x += p.x;
    y += p.y;
  }
  return { kind: "toward", point: { x: x / winner.length, y: y / winner.length } };
}
