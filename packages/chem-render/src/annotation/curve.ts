/**
 * A curly arrow's curve: the chord frame a document stores, turned into one
 * cubic Bézier in scene px.
 *
 * THE STORED SHAPE IS FRAME-RELATIVE (the architectural ruling). A curly
 * arrow keeps no control points. It keeps a signed `bulge` — the apex's offset
 * perpendicular to the chord from tail to head — and a `skew` — the apex's
 * position along it — both as fractions of the chord. The curve is rebuilt
 * from wherever the two ends are NOW, so dragging an atom carries the arrow
 * with it and keeps its character, and the same record draws the same curve
 * translated, rotated or scaled. Absolute control points are the single most
 * common complaint about arrow tools that store them: drag one atom and the
 * arrow detaches.
 *
 * ALL OF THE MATHS IS IN SCENE PX, y-down. The two ends arrive already through
 * `modelToPx`; bulge and skew are ratios of the chord, so they scale with it
 * and nothing here multiplies by a bond length or converts a model-unit
 * control point. Scaling model-unit control points locally would be a second
 * owner of the model-to-px scale.
 *
 * THE Y-FLIP TRAP. "Positive bulge bows to the LEFT of tail-to-head, y-up" is
 * a statement about the page: walking from tail to head, the apex is on your
 * left hand. In y-up model space the left of a direction u is (-u.y, u.x); in
 * the y-down scene the SAME page direction is (u.y, -u.x) — `leftNormal` in
 * bond/geometry.ts, which a manual `doubleBondSide` already uses for the same
 * reason. Take the textbook (-u.y, u.x) here and every arrow renders mirrored:
 * the drawing still looks like a mechanism, and it is backwards. The test on
 * the carbonyl-addition fixture in test/curly-arrows.test.ts reads the apex
 * back through `pxToModel` and pins the side.
 *
 * THE CURVE. With skew 0 it is exactly the standard one-cubic approximation of
 * the circular arc through tail, apex and head: the end tangents are the arc's
 * and the curve passes through the apex at t = 1/2. Written without a single
 * trigonometric call. With D the apex offset from the chord midpoint M,
 *
 *   c1 = tail + λ (M − tail) + 4/3 D,   c2 = head + λ (M − head) + 4/3 D,
 *   λ  = 2 (1 − 4 bulge²) / 3
 *
 * B(1/2) = M + D for EVERY λ, so the curve always passes through the apex the
 * reshape handle sits on; λ only sets the end tangents. For an arc of apex
 * height h = bulge·L the end tangent makes tan θ = 4 bulge / (1 − 4 bulge²)
 * with the chord, and λ above is the value that reproduces it. At bulge ½ the
 * arc is a semicircle and λ is 0 (the handles stand straight up off the
 * chord); past ½ λ goes negative and the handles lean back, as a reflex arc's
 * tangents do. A shallow arrow therefore leaves its tail at a shallow angle
 * rather than rising square off the chord, which is how a hand-drawn curly
 * arrow looks and how ChemDraw's arcs look. Skew slides both handles along the
 * chord by the same 4/3 of the apex's slide.
 */

import { leftNormal } from "../bond/geometry.js";
import type { ScenePoint } from "../scene/types.js";
import { CURLY_ARROW_MAX_SKEW } from "../scheme/annotation.js";
import { formatNumber } from "../svg/serialize.js";

/** One cubic Bézier, scene px. */
export interface CubicCurve {
  readonly p0: ScenePoint;
  readonly c1: ScenePoint;
  readonly c2: ScenePoint;
  readonly p3: ScenePoint;
}

export const CURLY_ARROW_CURVE = Object.freeze({
  /**
   * The largest |bulge| drawn. A stored value past it draws as if it were
   * this, keeping its sign.
   *
   * At 1 the apex stands a full chord off the chord and the arc sweeps about
   * 254 degrees, which one cubic still follows closely; much past it a single
   * cubic stops looking like an arc at all. The document keeps whatever was
   * stored — this bounds the picture, not the record.
   */
  maxBulge: 1,
  /** Below this, two scene points are the same point and give no chord. */
  coincidentEpsilonPx: 1e-6,
});

function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > limit ? limit : value < -limit ? -limit : value;
}

function lerp(a: ScenePoint, b: ScenePoint, t: number): ScenePoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The curve for a chord from `tail` to `head`, or undefined when the two ends
 * coincide and there is no chord to measure a bulge against.
 */
export function chordFrameCurve(
  tail: ScenePoint,
  head: ScenePoint,
  bulge: number,
  skew: number,
): CubicCurve | undefined {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < CURLY_ARROW_CURVE.coincidentEpsilonPx) return undefined;

  const b = clamp(bulge, CURLY_ARROW_CURVE.maxBulge);
  const s = clamp(skew, CURLY_ARROW_MAX_SKEW);
  const unit: ScenePoint = { x: dx / length, y: dy / length };
  // Page-left of the chord: see the header on why it is not (-u.y, u.x).
  const left = leftNormal(unit);
  const mid = lerp(tail, head, 0.5);
  // The apex's offset from the chord midpoint, both components in px.
  const along = s * length;
  const across = b * length;
  const offset: ScenePoint = {
    x: unit.x * along + left.x * across,
    y: unit.y * along + left.y * across,
  };
  const lambda = (2 * (1 - 4 * b * b)) / 3;
  const handle = (end: ScenePoint): ScenePoint => ({
    x: end.x + lambda * (mid.x - end.x) + (4 / 3) * offset.x,
    y: end.y + lambda * (mid.y - end.y) + (4 / 3) * offset.y,
  });
  return { p0: tail, c1: handle(tail), c2: handle(head), p3: head };
}

/**
 * The stored shape that puts the apex at `apex` over the chord from `tail` to
 * `head` — the inverse of `chordFrameCurve`, for a reshape handle dragged on
 * the apex. Undefined for coincident ends. Not clamped: the caller decides
 * what it lets the user store.
 */
export function chordFrameOf(
  tail: ScenePoint,
  head: ScenePoint,
  apex: ScenePoint,
): { readonly bulge: number; readonly skew: number } | undefined {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const squared = dx * dx + dy * dy;
  if (squared < CURLY_ARROW_CURVE.coincidentEpsilonPx ** 2) return undefined;
  const length = Math.sqrt(squared);
  const unit: ScenePoint = { x: dx / length, y: dy / length };
  const left = leftNormal(unit);
  const mid = lerp(tail, head, 0.5);
  const ox = apex.x - mid.x;
  const oy = apex.y - mid.y;
  return {
    bulge: (ox * left.x + oy * left.y) / length,
    skew: (ox * unit.x + oy * unit.y) / length,
  };
}

/** The point at parameter `t`. */
export function curvePoint(curve: CubicCurve, t: number): ScenePoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.p0.x + b * curve.c1.x + c * curve.c2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.c1.y + c * curve.c2.y + d * curve.p3.y,
  };
}

/** The apex a stored shape describes: the curve at t = 1/2, by construction. */
export function curveApex(curve: CubicCurve): ScenePoint {
  return curvePoint(curve, 0.5);
}

/**
 * The piece of `curve` between parameters `t0` and `t1`, as a cubic of its
 * own — exact, by de Casteljau, so a trimmed arrow is the SAME curve with its
 * ends cut off rather than a new curve through three points of the old one.
 */
export function subCurve(curve: CubicCurve, t0: number, t1: number): CubicCurve {
  const [before] = splitCurve(curve, t1);
  if (t1 <= 0) return { p0: curve.p0, c1: curve.p0, c2: curve.p0, p3: curve.p0 };
  const [, after] = splitCurve(before, t0 / t1);
  return after;
}

function splitCurve(curve: CubicCurve, t: number): readonly [CubicCurve, CubicCurve] {
  const ab = lerp(curve.p0, curve.c1, t);
  const bc = lerp(curve.c1, curve.c2, t);
  const cd = lerp(curve.c2, curve.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const split = lerp(abc, bcd, t);
  return [
    { p0: curve.p0, c1: ab, c2: abc, p3: split },
    { p0: split, c1: bcd, c2: cd, p3: curve.p3 },
  ];
}

/** `segments + 1` points evenly spaced in t, ends included. */
export function flattenCurve(curve: CubicCurve, segments: number): ScenePoint[] {
  const points: ScenePoint[] = [];
  for (let i = 0; i <= segments; i++) points.push(curvePoint(curve, i / segments));
  return points;
}

/**
 * `M x y C x y x y x y` at the style's precision. A PathPrimitive's `d` is
 * passed through verbatim by every consumer, so whoever builds it owes it the
 * scene's one formatter — the canvas and the exported file must agree to the
 * last digit.
 */
export function curvePathData(curve: CubicCurve, precision: number, context: string): string {
  const n = (value: number): string => formatNumber(value, precision, context);
  const p = (point: ScenePoint): string => `${n(point.x)} ${n(point.y)}`;
  return `M${p(curve.p0)} C${p(curve.c1)} ${p(curve.c2)} ${p(curve.p3)}`;
}
