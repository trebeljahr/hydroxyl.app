/**
 * The one tetrahedral parity function: a 2D drawing lifted into pseudo-3D,
 * and the sign of one signed volume.
 *
 * WHY ONE MODULE (decision 28). stereo.ts's `chiralityFrom` and stereo-config's
 * readers both turn a drawing into a sign. Two private copies of that
 * arithmetic already disagreed once, about where an undrawn hydrogen goes, and
 * a disagreement between two readers of one drawing is a confident wrong
 * letter in one of them. So both call this module, and it imports neither.
 *
 * THE FRAME is chem-core's: x right, y UP, z toward the viewer. The volume is
 * `(p0 − p3) · [(p1 − p3) × (p2 − p3)]` over the ligands in the order given.
 * With ligands in CIP priority order, a negative volume is R.
 *
 * THE LIFT. Each drawn ligand sits at its RAW in-plane offset from the centre
 * (decision 29: foreshortening is how a drawing shows depth, so a short bond
 * keeps its vote), with z of `sign(depth) × PSEUDO_3D_DEPTH`. The depth
 * magnitude is one global constant (decision 16). The volume is linear in it,
 * so only its sign could ever matter, and it is never taken from the page.
 *
 * THE IMPLICIT LIGAND (an undrawn hydrogen, or a phantom lone pair) has no
 * position, so the lift supplies one. Its z is opposite the drawn marks: a
 * wedge to one neighbour puts it behind the page. Its in-plane position
 * depends on how the drawn bonds are spread (decision 28):
 *
 *   SURROUNDED  no angular gap between neighbouring drawn bonds exceeds a
 *               half-turn, as in the textbook CHBrClF. The implicit ligand
 *               sits at the centre in x and y. This is what stereo.ts always
 *               did, so no letter on a surrounded centre changes. An exact T
 *               (two drawn bonds opposite each other, a gap of exactly 180°)
 *               counts as surrounded: the fan placement would put the
 *               implicit ligand in one plane with a wedge drawn across the T.
 *   FAN         one gap exceeds a half-turn, so the drawn bonds sit strictly
 *               inside a half-plane, as at a bridgehead of a fused or bridged
 *               drawing (tropane, 1-azabicyclo[3.2.1]octane). The implicit
 *               ligand sits opposite the in-plane resultant, at minus the sum
 *               of the drawn offsets,
 *               which is where the fourth bond of a real tetrahedron projects.
 *               Putting it at the centre instead read Br 0° wedge / Cl +75° /
 *               F −75° as S where the geometry and RDKit give R, and read a
 *               regular-hexagon bridgehead as having no volume at all.
 *
 * THE AMBIGUITY GUARD (decision 29). A sign is reported only when both hold:
 *
 *   - the volume clears `RELATIVE_VOLUME_FLOOR` after dividing by the depth
 *     constant and the product of the two longest drawn bond lengths, so the
 *     test is scale-free: a drawing in ångström and the same drawing in bond
 *     lengths agree; and
 *   - the same lift built from UNIT directions gives the same sign. Where raw
 *     and unit readings disagree, the answer depends on how long a line
 *     happened to be drawn, which is not a claim a chemist made.
 *
 * Otherwise the result is `ambiguous`. The floor refuses an X drawing (wedge
 * 135°, hash 315°, plain 225° and 45°) within about three degrees either side
 * of the exact X, where the sign flips. Ordinary hand drawings sit far above
 * it: the textbook CHBrClF scores 3.46.
 */

import type { Vec2 } from "./vec.js";

/**
 * The one depth magnitude every lift uses (decision 16). Any nonzero value
 * gives the same sign; it is a named constant so no reader picks its own.
 */
export const PSEUDO_3D_DEPTH = 1;

/**
 * Below this, a volume divided by `PSEUDO_3D_DEPTH` and the two longest drawn
 * bond lengths is too small to carry a sign. Dimensionless. At 0.1 the X
 * drawing refuses within ±2.9°, and about one random hand-plausible CH centre
 * in two hundred (three bonds at least 50° apart, lengths 0.7 to 1.4, one
 * wedge) refuses.
 */
export const RELATIVE_VOLUME_FLOOR = 0.1;

/**
 * Sign of the signed volume over ligands in a stated order. With the ligands
 * in CIP priority order, −1 is R.
 */
export type TetrahedralParity = 1 | -1;

/**
 * One ligand handed to the lift.
 *
 *   `drawn`     `offset` is the raw vector from the centre to the neighbour's
 *               drawn position; `depth` is positive toward the viewer,
 *               negative away, 0 in the page. Only its sign is read.
 *   `implicit`  an undrawn hydrogen or a phantom lone pair.
 */
export type LiftLigand =
  | { readonly kind: "drawn"; readonly offset: Vec2; readonly depth: number }
  | { readonly kind: "implicit" };

/**
 * What a lift yields.
 *
 *   `specified`  a sign both readings agree on, clear of the floor.
 *   `flat`       no drawn ligand has any depth: nothing was claimed.
 *   `ambiguous`  a claim was made but does not survive: marks that cancel
 *                around an implicit ligand, two implicit ligands, a zero-length
 *                bond, a volume under the floor, or raw and unit readings of
 *                opposite sign.
 */
export type LiftOutcome =
  | { readonly kind: "specified"; readonly parity: TetrahedralParity }
  | { readonly kind: "flat" }
  | { readonly kind: "ambiguous" };

/** A point in the lifted frame, relative to the centre. */
export interface LiftedPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const FLAT: LiftOutcome = Object.freeze({ kind: "flat" });
const AMBIGUOUS: LiftOutcome = Object.freeze({ kind: "ambiguous" });
const PLUS: LiftOutcome = Object.freeze({ kind: "specified", parity: 1 });
const MINUS: LiftOutcome = Object.freeze({ kind: "specified", parity: -1 });

/**
 * True when the directions sit strictly inside a half-plane: the widest
 * angular gap between neighbouring directions exceeds a half-turn. The
 * tolerance keeps float noise at an exact T on the surrounded side.
 */
function insideHalfPlane(directions: readonly Vec2[]): boolean {
  const angles = directions.map((d) => Math.atan2(d.y, d.x)).sort((a, b) => a - b);
  let widest = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    widest = Math.max(widest, next - angles[i]!);
  }
  return widest > Math.PI + 1e-9;
}

function signedVolume(points: readonly LiftedPoint[]): number {
  const [p0, p1, p2, p3] = points as [LiftedPoint, LiftedPoint, LiftedPoint, LiftedPoint];
  const ax = p0.x - p3.x;
  const ay = p0.y - p3.y;
  const az = p0.z - p3.z;
  const bx = p1.x - p3.x;
  const by = p1.y - p3.y;
  const bz = p1.z - p3.z;
  const cx = p2.x - p3.x;
  const cy = p2.y - p3.y;
  const cz = p2.z - p3.z;
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

/**
 * The sign of the volume over four already-lifted points, or undefined when
 * the volume divided by `scale` is under `RELATIVE_VOLUME_FLOOR`. Readers that
 * build their points from a convention rather than from a drawing (Fischer,
 * Haworth) use unit in-plane directions and pass `PSEUDO_3D_DEPTH`.
 */
export function pointsParity(
  points: readonly LiftedPoint[],
  scale: number,
): TetrahedralParity | undefined {
  if (points.length !== 4 || !(scale > 0) || !Number.isFinite(scale)) return undefined;
  const volume = signedVolume(points) / scale;
  if (!Number.isFinite(volume) || Math.abs(volume) < RELATIVE_VOLUME_FLOOR) return undefined;
  return volume > 0 ? 1 : -1;
}

/**
 * Lifts four ligands, in the order given, and reads their parity under the
 * rules in the module header.
 */
export function liftParity(ligands: readonly LiftLigand[]): LiftOutcome {
  if (ligands.length !== 4) return AMBIGUOUS;
  const drawn: { readonly offset: Vec2; readonly z: number; readonly length: number }[] = [];
  let implicit = 0;
  let depthSum = 0;
  let marked = 0;
  for (const ligand of ligands) {
    if (ligand.kind === "implicit") {
      implicit++;
      continue;
    }
    const length = Math.hypot(ligand.offset.x, ligand.offset.y);
    if (!(length > 0) || !Number.isFinite(length)) return AMBIGUOUS;
    const z = Number.isFinite(ligand.depth) ? Math.sign(ligand.depth) : 0;
    drawn.push({ offset: ligand.offset, z, length });
    depthSum += z;
    if (z !== 0) marked++;
  }
  if (marked === 0) return FLAT;
  if (implicit > 1) return AMBIGUOUS;
  // The implicit ligand goes opposite the marks. Marks that cancel leave it no
  // side, and a picture that contradicts itself is not merely silent.
  if (implicit === 1 && depthSum === 0) return AMBIGUOUS;

  const lengths = drawn.map((d) => d.length).sort((a, b) => b - a);
  const rawScale = PSEUDO_3D_DEPTH * lengths[0]! * (lengths[1] ?? lengths[0]!);
  const fan = implicit === 1 && insideHalfPlane(drawn.map((d) => d.offset));

  let agreed: TetrahedralParity | undefined;
  for (const unit of [false, true]) {
    const offsets = drawn.map((d) =>
      unit ? { x: d.offset.x / d.length, y: d.offset.y / d.length } : d.offset,
    );
    let implicitAt: Vec2 = { x: 0, y: 0 };
    if (fan) {
      const sx = offsets.reduce((s, o) => s + o.x, 0);
      const sy = offsets.reduce((s, o) => s + o.y, 0);
      // Directions strictly inside a half-plane cannot cancel; the check only
      // guards against float overflow turning the resultant into noise.
      const longest = unit ? 1 : lengths[0]!;
      if (!(Math.hypot(sx, sy) > 1e-9 * longest)) return AMBIGUOUS;
      implicitAt = { x: -sx, y: -sy };
    }
    const points: LiftedPoint[] = [];
    let k = 0;
    for (const ligand of ligands) {
      if (ligand.kind === "implicit") {
        points.push({ x: implicitAt.x, y: implicitAt.y, z: -Math.sign(depthSum) * PSEUDO_3D_DEPTH });
      } else {
        const offset = offsets[k]!;
        points.push({ x: offset.x, y: offset.y, z: drawn[k]!.z * PSEUDO_3D_DEPTH });
        k++;
      }
    }
    const parity = pointsParity(points, unit ? PSEUDO_3D_DEPTH : rawScale);
    if (parity === undefined) return AMBIGUOUS;
    if (agreed !== undefined && agreed !== parity) return AMBIGUOUS;
    agreed = parity;
  }
  return agreed === 1 ? PLUS : MINUS;
}
