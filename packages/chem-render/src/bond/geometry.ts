/**
 * A bond, as lines on the page.
 *
 * Two jobs, both entirely inside scene px:
 *
 *   TRIMMING. A bond ends at an atom's position, but a labelled atom has
 *   glyphs sitting on that position, and a line ruled straight through the "O"
 *   of a hydroxyl is the single most obvious sign that a drawing was made by a
 *   graph library. The clear space is measured once, by `atomLabelPlacement`,
 *   and queried here through `trimDistance` — the exact ray-exit test against
 *   the obstacle UNION, not against `clearBox`. The union matters: the
 *   bounding box of an "O" with a superscript charge is mostly empty air, and
 *   a bond arriving from below would stop as though the charge were in its way.
 *
 *   THE SECOND AND THIRD LINES. Where they sit relative to the axis, how far
 *   short of the vertices the leaning one stops, and — the part that is easy
 *   to get wrong — their OWN trimming. A parallel copy is not the trimmed axis
 *   translated sideways; see `offsetSegment`.
 *
 * `style.labelPaddingPx` IS NOT APPLIED HERE. placement.ts applies it to every
 * span rect and every dot disc, once, and says so on `spanBox`: a trimmer that
 * pads again doubles it and every bond in the figure comes out visibly short.
 *
 * INPUTS ARE SCENE PX WITH Y ALREADY FLIPPED, like placement.ts, and for the
 * same reason. This file imports neither `modelToPx` nor `Vec2`, negates no
 * coordinate (only direction vectors), and calls neither `Math.atan2` nor
 * `Math.hypot`.
 */

import type { AtomLabelPlacement } from "../label/placement.js";
import { trimDistance } from "../label/placement.js";
import type { ScenePoint } from "../scene/types.js";

export const BOND_GEOMETRY = Object.freeze({
  /** Below this, two scene points are the same point and give no direction. */
  coincidentEpsilonPx: 1e-6,
  /**
   * How far the inner line of a leaning double bond may be pulled back at one
   * end, as a fraction of the drawn length.
   *
   * The inset is exact for a well-drawn vertex (see `insetForVertex`), but it
   * grows without bound as a neighbour bond approaches collinear with this
   * one, and a hand-dragged atom can get there. Past this the inner line would
   * be shorter than the gap it sits at, which reads as a dash rather than a
   * bond.
   */
  maxInsetFraction: 0.4,
  /**
   * Below this |cross| two unit directions are collinear and the vertex has no
   * well-defined half-angle to inset by.
   */
  collinearEpsilon: 1e-6,
});

/** A bond's drawn axis: trimmed endpoints plus the direction they lie on. */
export interface BondAxis {
  /** Trimmed start, clear of `from`'s label. */
  readonly a: ScenePoint;
  /** Trimmed end, clear of `to`'s label. */
  readonly b: ScenePoint;
  /** Unit, `from` toward `to`. Untouched by trimming. */
  readonly unit: ScenePoint;
  /** Length of the DRAWN segment, `a` to `b`. */
  readonly length: number;
  /**
   * The two ATOM CENTRES and their labels, kept so that a parallel copy can
   * repeat the trim from its own origin rather than inherit the axis's.
   *
   * Carried on the axis rather than passed alongside it because the two are
   * only ever correct together: an offset copy trimmed against a different
   * bond's labels is nonsense, and the type should not let it be spelled.
   */
  readonly untrimmed: BondEnds;
}

/** The untrimmed geometry an offset copy needs to trim itself. */
export interface BondEnds {
  readonly from: ScenePoint;
  readonly to: ScenePoint;
  readonly placementFrom: AtomLabelPlacement | undefined;
  readonly placementTo: AtomLabelPlacement | undefined;
}

/**
 * The drawn axis of the bond from `from` to `to`, or undefined when there is
 * nothing left to draw.
 *
 * Undefined has two causes and both are deliberate:
 *
 *   COINCIDENT ATOMS, after a template drop that did not merge. There is no
 *   direction, and every subsequent division produces NaN — which survives
 *   silently all the way to `formatNumber`, where it throws with a message
 *   pointing nowhere near the cause.
 *
 *   THE LABELS MEET. When the two clear boxes overlap along the axis the
 *   trimmed end lands before the trimmed start. The alternatives are worse: a
 *   minimum stub fabricates geometry the author did not draw, which is the
 *   never-nudge rule broken in spirit and a picture that lies; a zero-length
 *   line contributes its point to the bounds and, with a round cap, paints a
 *   dot, which is the radical notation. Drawing nothing makes the crowding
 *   visible and hands the case to `detectCollisions`, which reports it as
 *   `bond-swallowed-by-labels`.
 *
 * `placementFrom`/`placementTo` are `undefined` for a bare vertex, where there
 * is no label and therefore nothing to trim to.
 */
export function bondAxis(
  from: ScenePoint,
  to: ScenePoint,
  placementFrom: AtomLabelPlacement | undefined,
  placementTo: AtomLabelPlacement | undefined,
  minimumLengthPx: number,
): BondAxis | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const centreToCentre = Math.sqrt(dx * dx + dy * dy);
  if (centreToCentre < BOND_GEOMETRY.coincidentEpsilonPx) return undefined;

  const unit: ScenePoint = { x: dx / centreToCentre, y: dy / centreToCentre };
  // The direction into `to`'s label is the exact negation of the one out of
  // `from`'s, rather than a second normalisation from the other end: two
  // roundings of the same quantity are not guaranteed to be antiparallel.
  const back: ScenePoint = { x: -unit.x, y: -unit.y };

  const trimFrom = placementFrom === undefined ? 0 : trimDistance(placementFrom, unit);
  const trimTo = placementTo === undefined ? 0 : trimDistance(placementTo, back);

  const length = centreToCentre - trimFrom - trimTo;
  if (length < minimumLengthPx) return undefined;

  return {
    a: { x: from.x + unit.x * trimFrom, y: from.y + unit.y * trimFrom },
    b: { x: to.x + back.x * trimTo, y: to.y + back.y * trimTo },
    unit,
    length,
    untrimmed: { from, to, placementFrom, placementTo },
  };
}

/**
 * The unit normal 90 degrees counter-clockwise of `unit` AS SEEN ON THE PAGE.
 *
 * y is already flipped here, so the textbook `(-y, x)` would point the other
 * way: walking east on the page, left is visually up, which is scene −y. This
 * is the same handedness chem-core's `left`/`right` name in its y-up space,
 * and it has to be, or a manual `doubleBondSide` would render mirrored.
 */
export function leftNormal(unit: ScenePoint): ScenePoint {
  return { x: unit.y, y: -unit.x };
}

/** `point` offset by `distance` along `direction`. */
function shift(point: ScenePoint, direction: ScenePoint, distance: number): ScenePoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

/**
 * A parallel copy of the bond, `offset` px along `normal`, TRIMMED IN ITS OWN
 * RIGHT — or undefined when nothing is left of it.
 *
 * The obvious implementation, translating the already-trimmed axis sideways,
 * is wrong and the error is one-sided: it always pushes the copy back TOWARD
 * the label. The axis stops exactly on the face of the clear box it exits, and
 * a perpendicular shift off a face re-enters the box whenever the bond is not
 * axis-aligned — up to `offset` px deep at 45 degrees. That is the whole of the
 * `label-over-own-bond` report the collision pass used to fire on any rotated
 * carbonyl. So the copy starts at the offset ATOM CENTRE and runs its own
 * ray-exit against the same obstacle union.
 *
 * With `offset` 0 this reproduces `axis.a`/`axis.b` exactly, and for a bond
 * between two bare vertices it reproduces the plain translation, which is why
 * skeletal benzene is untouched by any of this.
 *
 * `insetStart`/`insetEnd` are applied ON TOP of the trim, both measured inward
 * from the same vertex: the trim clears the label and the inset clears the
 * neighbouring bond, and a vertex can need both.
 */
export function offsetSegment(
  axis: BondAxis,
  normal: ScenePoint,
  offset: number,
  insetStart = 0,
  insetEnd = 0,
  minimumLengthPx = 0,
): { readonly a: ScenePoint; readonly b: ScenePoint } | undefined {
  const { from, to, placementFrom, placementTo } = axis.untrimmed;
  const back: ScenePoint = { x: -axis.unit.x, y: -axis.unit.y };

  const start = shift(from, normal, offset);
  const end = shift(to, normal, offset);

  const trimStart =
    placementFrom === undefined ? 0 : trimDistance(placementFrom, axis.unit, start);
  const trimEnd =
    placementTo === undefined ? 0 : trimDistance(placementTo, back, end);

  const a = shift(start, axis.unit, trimStart + insetStart);
  const b = shift(end, back, trimEnd + insetEnd);

  // Signed along the axis, so a copy whose two ends crossed over comes out
  // negative rather than as a short line pointing backwards.
  const length = (b.x - a.x) * axis.unit.x + (b.y - a.y) * axis.unit.y;
  if (length < minimumLengthPx) return undefined;

  return { a, b };
}

/**
 * How far back from a vertex a line offset by `offset` must stop so that it
 * meets the equally offset copy of the neighbour bond leaving at `neighbour`.
 *
 *   inset = offset / tan(theta / 2),  theta = the angle at the vertex
 *
 * written as `offset * (1 + cos theta) / sin theta` so it is dot and cross
 * products and one division — no `Math.tan`, no `Math.atan2`. For benzene's
 * 120-degree vertex it is `offset * 0.5774`, which reproduces the inset
 * hexagon exactly: the three inner lines of a Kekule benzene come out visibly
 * shorter than the ring edges, with a clean gap at every vertex, which is how
 * the ring is drawn.
 *
 * Clipping against the neighbour bond's OWN line instead is the tempting
 * version and it is wrong in the visible direction — it makes the inner line
 * LONGER than the ring edge, because the ring is convex and the neighbour
 * edge slopes away.
 *
 * `bondDirection` and `neighbourDirection` are unit vectors pointing AWAY from
 * the shared vertex.
 */
export function insetForVertex(
  bondDirection: ScenePoint,
  neighbourDirection: ScenePoint,
  offset: number,
): number {
  const cross =
    bondDirection.x * neighbourDirection.y - bondDirection.y * neighbourDirection.x;
  if (Math.abs(cross) < BOND_GEOMETRY.collinearEpsilon) return 0;
  const dot =
    bondDirection.x * neighbourDirection.x + bondDirection.y * neighbourDirection.y;
  // `cross` carries the turn's handedness; the inset is a length either way,
  // and the caller has already decided which side the line sits on.
  return (offset * (1 + dot)) / Math.abs(cross);
}
