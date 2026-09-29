/**
 * The four stereo marks, as geometry on the page.
 *
 * A solid WEDGE with its apex at the narrow end, a HASH ladder of evenly
 * spaced bars widening the same way, a WAVY line of fixed period, and the
 * CROSSED double bond that says "geometry never determined".
 *
 * NARROW END AT `axis.a`, ALWAYS. chem-core fixes the convention as narrow end
 * at `bond.from` (see types.ts), and `scene/build.ts` calls `bondAxis(from,
 * to, ...)` in that order, so `axis.a` IS the `from` atom. Nothing here reads
 * a bond, an atom id or any id list: turning the bond round is `flipBond`'s
 * job, and the depiction inverts because `axis.a` moved. That is the whole of
 * "flipBond inverts the depiction" — there is no second rule to keep in step.
 * The one exception is a style's, not a bond's: a house style that draws a
 * hashed wedge wide at the stereocentre (decision 177) hands the ladder
 * `reversedAxis(axis)`, and nothing else changes.
 *
 * EVERY MARK IS BUILT ON THE ALREADY-TRIMMED `BondAxis`, so it inherits the
 * label clearance the plain line gets for free. The wedge's wide end is the
 * one place that is only approximately true: it spreads perpendicular to the
 * axis by half its width, which the ray-exit trim never measured. At the wide
 * end of a wedge there is a substituent, not usually a wide label, and the
 * alternative — a second trimming pass over a triangle — buys a fraction of a
 * pixel for a great deal of machinery.
 *
 * INPUTS ARE SCENE PX WITH Y ALREADY FLIPPED, as in geometry.ts and
 * placement.ts. This file imports neither `modelToPx` nor `Vec2`, negates no
 * coordinate (only direction vectors), and calls no `Math.atan2`, `Math.hypot`
 * — OR `Math.sin`. The last one is not pedantry: ECMAScript leaves all three
 * implementation-approximated, these bytes get committed and diffed, and the
 * wavy bond is precisely the place a naive implementation reaches for a sine.
 * It is built instead from cubic Bezier half-waves with rational control
 * offsets, which is multiplication only.
 *
 * PATH NUMBERS ARE FORMATTED HERE. `d` is passed through verbatim by both the
 * serialiser and the React canvas — "whoever builds a path owes it the style's
 * precision" — so a raw JS float would put seventeen digits into a committed
 * golden and differ across engines. Hence the one import from `../svg/`, which
 * is a formatter and not a backend: nothing in svg/ imports bond/, so this is
 * a leaf dependency rather than a cycle.
 */

import type { ScenePoint } from "../scene/types.js";
import { formatNumber } from "../svg/serialize.js";
import type { BondAxis } from "./geometry.js";
import { leftNormal, offsetSegment } from "./geometry.js";

export const STEREO_MARKS = Object.freeze({
  /**
   * The half-width of the FIRST hash bar, as a fraction of the last one's.
   *
   * Not zero. A ladder whose first rung is a point looks like it starts a bar
   * later than it does, and at publication scale that bar is under a pixel
   * wide and vanishes into the antialiasing. A visible short bar reads as the
   * narrow end; an invisible one reads as a missing bar.
   */
  hashNarrowFraction: 0.2,
  /**
   * Bezier control offset for a wavy half-wave, as a fraction of the
   * amplitude, with the controls at a third and two thirds along.
   *
   * 4/3 puts the curve's own extreme at almost exactly the amplitude: a cubic
   * with both controls at height h peaks at 3h/4, so asking for 4/3 of the
   * amplitude arrives at the amplitude. Written as a literal ratio rather than
   * derived, because the derivation is the comment and the number is what has
   * to be reproducible.
   */
  wavyControlRatio: 4 / 3,
  /** Amplitude of a wavy bond as a fraction of its period. */
  wavyAmplitudeRatio: 0.28,
});

/** `point` displaced by `distance` along the unit `direction`. */
function shift(point: ScenePoint, direction: ScenePoint, distance: number): ScenePoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

/**
 * The solid wedge: a triangle from the narrow end at `axis.a` to a base of
 * `widthPx` centred on `axis.b`.
 *
 * Three points and no stroke. A stroked triangle grows by half a line width on
 * every side, so the apex — which is the whole statement, "this substituent
 * leaves from HERE" — would come out blunt.
 */
export function wedgePoints(axis: BondAxis, widthPx: number): readonly ScenePoint[] {
  const normal = leftNormal(axis.unit);
  const half = widthPx / 2;
  return [axis.a, shift(axis.b, normal, half), shift(axis.b, normal, -half)];
}

/**
 * `axis` end for end: `a` and `b` exchanged, the direction negated, and the
 * untrimmed ends swapped with it, so a mark built on it has its narrow end at
 * the old `b`. The hashed-wedge convention switch (decision 177) is this and
 * nothing else; negating a direction vector is not a y-flip.
 */
export function reversedAxis(axis: BondAxis): BondAxis {
  return {
    a: axis.b,
    b: axis.a,
    unit: { x: 0 - axis.unit.x, y: 0 - axis.unit.y },
    length: axis.length,
    untrimmed: {
      from: axis.untrimmed.to,
      to: axis.untrimmed.from,
      placementFrom: axis.untrimmed.placementTo,
      placementTo: axis.untrimmed.placementFrom,
    },
  };
}

/** One bar of a hash ladder, as its two endpoints. */
export interface HashBar {
  readonly a: ScenePoint;
  readonly b: ScenePoint;
}

/**
 * The bars of a hashed wedge: evenly spaced along the axis, widening from the
 * narrow end at `axis.a` to `widthPx` at `axis.b`.
 *
 * The bar COUNT is rounded from the axis length so the last bar lands exactly
 * on `axis.b`, which is what makes the ladder read as a wedge with a definite
 * end rather than as a line of tally marks that stopped early. The spacing is
 * then uniform by construction: `length / (count - 1)`.
 */
export function hashBars(
  axis: BondAxis,
  widthPx: number,
  periodPx: number,
): readonly HashBar[] {
  const normal = leftNormal(axis.unit);
  const spans = periodPx > 0 ? Math.round(axis.length / periodPx) : 1;
  // Two bars is the floor: one bar is a line across the bond, which is the
  // notation for something else entirely.
  const count = Math.max(2, spans + 1);
  const half = widthPx / 2;
  const narrow = STEREO_MARKS.hashNarrowFraction;

  const bars: HashBar[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const barHalf = half * (narrow + (1 - narrow) * t);
    const centre = shift(axis.a, axis.unit, axis.length * t);
    bars.push({
      a: shift(centre, normal, barHalf),
      b: shift(centre, normal, -barHalf),
    });
  }
  return bars;
}

/**
 * The whole hash ladder as ONE path, never as a bar-per-`line` primitive.
 *
 * Loose lines would poison two passes at once. `detectCollisions` tests every
 * `line` of a bond against every label's obstacle union and uses the FIRST one
 * as the bond's representative segment for the bond-crossing scan, so bar
 * zero — a stub a couple of px long — would stand in for the whole bond. And
 * the editor's `bondSegment` takes the first line too, so a selection halo
 * would come out the size of one rung.
 */
export function hashPathData(
  axis: BondAxis,
  widthPx: number,
  periodPx: number,
  precision: number,
  context: string,
): string {
  const parts: string[] = [];
  for (const bar of hashBars(axis, widthPx, periodPx)) {
    parts.push(
      `M${n(bar.a.x, precision, context)} ${n(bar.a.y, precision, context)}`,
      `L${n(bar.b.x, precision, context)} ${n(bar.b.y, precision, context)}`,
    );
  }
  return parts.join(" ");
}

/**
 * A wavy bond: a chain of cubic half-waves along the axis, alternating side.
 *
 * The PERIOD is the style's, not the bond's: the half-wave count is rounded
 * from the axis length so the wave starts and ends on the axis rather than
 * being cut off mid-swing, which means the drawn period is within half a
 * half-wave of the nominal one and is identical for any two bonds of the same
 * length. A wave that ran off the end of the bond, or one whose period
 * stretched with the bond, would both read as a different mark at a different
 * scale — and the mark has to mean exactly one thing.
 *
 * No `Math.sin`: each half-wave is one cubic with its two control points a
 * third and two thirds along, offset perpendicular by
 * `wavyControlRatio * amplitude`. See the module header for why.
 */
export function wavyPathData(
  axis: BondAxis,
  periodPx: number,
  precision: number,
  context: string,
): string {
  const normal = leftNormal(axis.unit);
  const halfPeriod = periodPx / 2;
  const halves = halfPeriod > 0 ? Math.round(axis.length / halfPeriod) : 2;
  // Two half-waves is one full period, the least that reads as "wavy" rather
  // than as a bent line.
  const count = Math.max(2, halves);
  const span = axis.length / count;
  const amplitude = periodPx * STEREO_MARKS.wavyAmplitudeRatio;
  const control = amplitude * STEREO_MARKS.wavyControlRatio;

  const at = (distance: number, offset: number): ScenePoint =>
    shift(shift(axis.a, axis.unit, distance), normal, offset);

  const parts: string[] = [
    `M${n(axis.a.x, precision, context)} ${n(axis.a.y, precision, context)}`,
  ];
  for (let i = 0; i < count; i++) {
    // Alternating sides is what makes it a wave rather than a row of bumps.
    const side = i % 2 === 0 ? 1 : -1;
    const start = axis.length * (i / count);
    const c1 = at(start + span / 3, side * control);
    const c2 = at(start + (2 * span) / 3, side * control);
    const end = at(start + span, 0);
    parts.push(
      `C${n(c1.x, precision, context)} ${n(c1.y, precision, context)}` +
        ` ${n(c2.x, precision, context)} ${n(c2.y, precision, context)}` +
        ` ${n(end.x, precision, context)} ${n(end.y, precision, context)}`,
    );
  }
  return parts.join(" ");
}

/** The two segments of a crossed double bond. */
export interface CrossedDouble {
  readonly first: { readonly a: ScenePoint; readonly b: ScenePoint };
  readonly second: { readonly a: ScenePoint; readonly b: ScenePoint };
}

/**
 * The crossed double bond, V2000 stereo code 3: cis/trans deliberately
 * unstated.
 *
 * Built from the two parallel copies a CENTRED double bond would draw, with
 * their far endpoints exchanged. Going through `offsetSegment` rather than
 * displacing the trimmed axis is the same rule the double-bond pass follows:
 * a copy shifted perpendicular off the face of a clear box re-enters it, and
 * the crossed pair is exactly where that would show — the two lines converge
 * on the atom centres, which is where the glyphs are.
 *
 * Undefined when either copy trimmed away to nothing, which is the same
 * "drew nothing" outcome `detectCollisions` reports for any other bond.
 */
export function crossedDouble(
  axis: BondAxis,
  gapPx: number,
  minimumLengthPx: number,
): CrossedDouble | undefined {
  const normal = leftNormal(axis.unit);
  const plus = offsetSegment(axis, normal, gapPx / 2, 0, 0, minimumLengthPx);
  const minus = offsetSegment(axis, normal, -gapPx / 2, 0, 0, minimumLengthPx);
  if (plus === undefined || minus === undefined) return undefined;
  return {
    first: { a: plus.a, b: minus.b },
    second: { a: minus.a, b: plus.b },
  };
}

function n(value: number, precision: number, context: string): string {
  return formatNumber(value, precision, context);
}
