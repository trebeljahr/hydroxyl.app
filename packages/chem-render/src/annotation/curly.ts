/**
 * A curly arrow, laid out in one panel and drawn as two primitives.
 *
 * The pipeline, all in scene px:
 *
 *   1. RESOLVE both ends against the panel's injected geometry (anchor.ts).
 *      An end the panel does not place resolves to nothing, and so does the
 *      arrow: it is not drawn in that panel, by rule rather than by flag.
 *   2. BUILD the curve on the NOMINAL chord from the stored bulge and skew
 *      (curve.ts). The nominal ends do not depend on the preset, so the curve
 *      is the same shape at every preset and every zoom.
 *   3. CUT each end where the curve leaves its clearance — a label, a bare
 *      vertex's dot, the band beside a sink bond — exactly, by de Casteljau,
 *      so what is drawn is a piece of the curve and not a new curve.
 *   4. HEAD at the cut end, pointing along the secant from one head-length
 *      back, and the SHAFT stopped at the head's notch so the join is hidden.
 *
 * TWO PRIMITIVES, never one. The shaft is a stroked `path` with no fill — the
 * serialiser and the canvas both emit `fill="none"` for it, and a path that
 * forgot would render as a black blob — and the head is a filled `polygon`
 * with no stroke. One primitive could not stroke one part and fill the other.
 *
 * SOURCED TO THE ANNOTATION. Both primitives carry `{kind: "annotation",
 * annotationId}`, never `decoration`: decoration is what hit-testing ignores,
 * and an arrow filed there could not be selected or deleted. Ids are
 * `annotation:ann_7:shaft` and `annotation:ann_7:head`, derived from the
 * stored id and never from an iteration counter.
 *
 * REPORTED, NEVER NUDGED. What the drawn arrow crosses — another atom's label,
 * a bond it is not anchored to — is listed in `findings`, and the arrow is
 * drawn where its record says regardless. Auto-routing an arrow around a
 * label on every render would make the export diverge from what the author
 * saw. The one place geometry is allowed to choose is CREATION:
 * `defaultCurlyArrowShape` tries a short list of bulges and stores the first
 * that clears, and after that the stored shape is only ever reported on.
 */

import type { AtomId, BondId } from "@starter/chem-core";

import type { AnnotationBondSegment, AnnotationSegment } from "../label/annotations.js";
import type { LabelObstacle } from "../label/placement.js";
import type { PathPrimitive, PolygonPrimitive, ScenePoint } from "../scene/types.js";
import type {
  CurlyArrowAnnotation,
  CurlyArrowElectrons,
  CurlyArrowSink,
  CurlyArrowSource,
  SchemeAnnotationId,
} from "../scheme/annotation.js";
import { pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";
import { resolveCurlyArrowEnds, insideClearance } from "./anchor.js";
import type { EndClearance, ResolvedEnd, SchemeAnchorGeometry } from "./anchor.js";
import { arrowhead, arrowheadLengths, CURLY_ARROWHEAD } from "./arrowhead.js";
import type { Arrowhead } from "./arrowhead.js";
import {
  chordFrameCurve,
  CURLY_ARROW_CURVE,
  curvePathData,
  curvePoint,
  flattenCurve,
  subCurve,
} from "./curve.js";
import type { CubicCurve } from "./curve.js";

export const CURLY_ARROW_LAYOUT = Object.freeze({
  /**
   * The chord drawn when both ends resolve to ONE point — an arrow from a
   * lone pair to its own atom, say, which chem-core reports as an arrow at
   * itself but a user can still draw. In bond lengths, centred on the point,
   * along the anchor bond if there is one and else across the page. A fixed
   * rule, so the degenerate case draws the same bytes every time.
   */
  fallbackChordBonds: 0.5,
  /** Steps a trim search walks in t before it bisects. */
  trimSamples: 128,
  trimBisections: 40,
  /** Straight pieces a drawn shaft is checked in for the crowding report. */
  reportSegments: 32,
  /**
   * cos 25°. An arrow leaving or reaching an atom within 25 degrees of one of
   * that atom's bonds runs along the bond, and a bond an arrow starts or ends
   * on is run along the same way. 25 degrees is where a head's own barbs
   * (half-angle 14°, from `CURLY_ARROWHEAD`) plus a line width stop touching
   * the bond at the head's back; nearer than that, head and bond read as one
   * mark — the carbonyl arrow landing down its own C=O.
   */
  alongBondCos: 0.906307787036650,
});

/** The bulge magnitudes `defaultCurlyArrowShape` tries, in order. */
export const CURLY_ARROW_DEFAULT_BULGES: readonly number[] = Object.freeze([
  0.35, 0.5, 0.25, 0.7, 1,
]);

/** What a laid-out arrow noticed about itself. Reported; nothing is moved. */
export type CurlyArrowFinding =
  /** Both ends are one point; drawn on `fallbackChordBonds` instead. */
  | { readonly kind: "degenerate-chord" }
  /** The ends' clear space left no room for a shaft; only the head is drawn. */
  | { readonly kind: "no-shaft" }
  /** The drawn arrow crosses the clear space of an atom it is not anchored to. */
  | { readonly kind: "crosses-label"; readonly atomId: AtomId }
  /**
   * The drawn arrow crosses a bond it is not anchored to, or passes closer to
   * one than half the double-bond gap.
   */
  | { readonly kind: "crosses-bond"; readonly bondId: BondId }
  /**
   * The arrow leaves or reaches an atom along one of its bonds, or leaves or
   * reaches a bond along that bond: head or tail and bond read as one mark.
   */
  | { readonly kind: "along-bond"; readonly bondId: BondId };

export interface CurlyArrowLayout {
  readonly annotationId: SchemeAnnotationId;
  readonly electrons: CurlyArrowElectrons;
  /**
   * The whole curve on the nominal chord, before either end was cut: what the
   * stored bulge and skew describe. Its apex (t = 1/2) is where a reshape
   * handle belongs.
   */
  readonly curve: CubicCurve;
  /** The drawn shaft, a piece of `curve`; undefined when nothing is left of it. */
  readonly shaft: CubicCurve | undefined;
  readonly head: Arrowhead;
  readonly findings: readonly CurlyArrowFinding[];
}

/** What the crowding report checks a drawn arrow against. */
export interface CurlyArrowObstacles {
  /** Each labelled atom's clear space; a derived hydrogen's under its host. */
  readonly labels: readonly { readonly atomId: AtomId; readonly obstacles: readonly LabelObstacle[] }[];
  /** Each drawn bond as one segment, `a` at its `from` atom. */
  readonly bonds: readonly CurlyArrowBondObstacle[];
}

/**
 * A drawn bond: its axis (`a` at the `from` atom, trimmed as drawn), which the
 * along-bond test reads a direction off, and every stroke it actually drew —
 * both lines of a double bond, a wedge's outline — which the crossing test
 * reads, because the axis of a centred C=O is not itself inked.
 */
export interface CurlyArrowBondObstacle extends AnnotationBondSegment {
  readonly from: AtomId;
  readonly to: AtomId;
  readonly lines: readonly AnnotationSegment[];
}

type CurlyArrowShape = Pick<
  CurlyArrowAnnotation,
  "id" | "electrons" | "source" | "sink" | "bulge" | "skew"
>;

/**
 * The arrow laid out in the panel `geometry` describes, or undefined when the
 * panel does not place one of its ends. `obstacles`, when given, fills the
 * crowding findings; without it only the geometric findings are reported.
 */
export function layoutCurlyArrow(
  arrow: CurlyArrowShape,
  geometry: SchemeAnchorGeometry,
  style: RenderStyle,
  obstacles?: CurlyArrowObstacles,
): CurlyArrowLayout | undefined {
  const ends = resolveCurlyArrowEnds(arrow, geometry, style);
  if (ends === undefined) return undefined;
  const findings: CurlyArrowFinding[] = [];

  let curve = chordFrameCurve(ends.tail.point, ends.head.point, arrow.bulge, arrow.skew);
  if (curve === undefined) {
    findings.push({ kind: "degenerate-chord" });
    curve = fallbackCurve(ends.tail, ends.head, arrow, style);
  }

  const t0 = trimFrom(curve, ends.tail.clearance, "tail");
  const t1 = trimFrom(curve, ends.head.clearance, "head");
  const tip = curvePoint(curve, t1);
  const { length, notch } = arrowheadLengths(style.bondLineWidthPx, CURLY_ARROWHEAD);

  const behind = parameterAtDistance(curve, t1, tip, length);
  const direction =
    unitBetween(behind === undefined ? curve.p0 : curvePoint(curve, behind), tip) ??
    unitBetween(curve.p0, curve.p3) ??
    // `fallbackCurve` guarantees a chord, so this is never reached; it keeps
    // the type total without a non-null assertion.
    { x: 1, y: 0 };
  const head = arrowhead(
    tip,
    direction,
    style.bondLineWidthPx,
    CURLY_ARROWHEAD,
    arrow.electrons === "pair" ? "full" : "half",
    // A fishhook's one barb goes on the OUTSIDE of the bend — page-left of
    // travel for a curve bowing left. On the inside it would lie across the
    // shaft of any tightly curled arrow.
    arrow.bulge < 0 ? "right" : "left",
  );

  const shaftEnd = parameterAtDistance(curve, t1, tip, notch);
  const shaft =
    shaftEnd !== undefined && shaftEnd > t0 ? subCurve(curve, t0, shaftEnd) : undefined;
  if (shaft === undefined) findings.push({ kind: "no-shaft" });

  if (obstacles !== undefined) {
    findings.push(...crowding(curve, t0, shaft, head, ends.tail, ends.head, obstacles, style));
  }

  return { annotationId: arrow.id, electrons: arrow.electrons, curve, shaft, head, findings };
}

/**
 * The two primitives a laid-out arrow draws, shaft first so the head paints
 * over the join. A shaft with nothing left of it is not emitted: a zero-length
 * path with a butt cap is invisible, and with any other cap it is a dot, which
 * is the radical notation.
 */
export function curlyArrowPrimitives(
  layout: CurlyArrowLayout,
  style: RenderStyle,
): (PathPrimitive | PolygonPrimitive)[] {
  const source = { kind: "annotation", annotationId: layout.annotationId } as const;
  const out: (PathPrimitive | PolygonPrimitive)[] = [];
  if (layout.shaft !== undefined) {
    const id = curlyArrowPrimitiveId(layout.annotationId, "shaft");
    out.push({
      id,
      source,
      type: "path",
      d: curvePathData(layout.shaft, style.coordinatePrecision, id),
      // No fill, deliberately: an open curve filled closes itself into a blob.
      stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
    });
  }
  out.push({
    id: curlyArrowPrimitiveId(layout.annotationId, "head"),
    source,
    type: "polygon",
    points: layout.head.points,
    fill: { color: style.colors.bond },
  });
  return out;
}

/** `annotation:ann_7:head` — from the stored id, never a counter. */
export function curlyArrowPrimitiveId(
  annotationId: SchemeAnnotationId,
  part: "shaft" | "head",
): string {
  return `annotation:${annotationId}:${part}`;
}

/** An arrow as the drawing gesture has it: ends chosen, shape not yet. */
export interface CurlyArrowDraft {
  readonly electrons: CurlyArrowElectrons;
  readonly source: CurlyArrowSource;
  readonly sink: CurlyArrowSink;
}

export interface CurlyArrowDefaultShape {
  readonly bulge: number;
  readonly skew: number;
  /** False when no candidate cleared; the one with the fewest findings is returned. */
  readonly clear: boolean;
}

/**
 * The shape a NEW arrow is stored with: the first of a short list of bulges
 * whose drawn arrow crosses nothing, trying first the side of the chord with
 * fewer bonds on it — the outside of the structure, where a hand-drawn curly
 * arrow goes. Undefined when the panel does not place both ends.
 *
 * THE ONE PLACE geometry chooses an arrow's shape, and it chooses once. Under
 * "collisions report and never nudge" choosing among candidates at creation is
 * allowed — nothing that was drawn moves — and re-choosing on a later render
 * is not: a drag that brings an atom across a stored arrow is reported by
 * `layoutCurlyArrow`, and the arrow stays where its record says.
 */
export function defaultCurlyArrowShape(
  draft: CurlyArrowDraft,
  geometry: SchemeAnchorGeometry,
  style: RenderStyle,
  obstacles: CurlyArrowObstacles,
): CurlyArrowDefaultShape | undefined {
  const ends = resolveCurlyArrowEnds(draft, geometry, style);
  if (ends === undefined) return undefined;
  const side = preferredSide(ends.tail.point, ends.head.point, obstacles);

  let best: { shape: CurlyArrowDefaultShape; count: number } | undefined;
  for (const magnitude of CURLY_ARROW_DEFAULT_BULGES) {
    for (const bulge of [side * magnitude, -side * magnitude]) {
      const layout = layoutCurlyArrow(
        { id: "draft", ...draft, bulge, skew: 0 },
        geometry,
        style,
        obstacles,
      );
      if (layout === undefined) return undefined;
      // A coincident chord draws on the fallback whatever the bulge is, so it
      // does not count against a candidate.
      const count = layout.findings.filter((f) => f.kind !== "degenerate-chord").length;
      if (count === 0) return { bulge, skew: 0, clear: true };
      if (best === undefined || count < best.count) {
        best = { shape: { bulge, skew: 0, clear: false }, count };
      }
    }
  }
  return best?.shape;
}

/** +1 (bow left) unless more bonds sit left of the chord than right of it. */
function preferredSide(tail: ScenePoint, head: ScenePoint, obstacles: CurlyArrowObstacles): 1 | -1 {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  let left = 0;
  let right = 0;
  for (const bond of obstacles.bonds) {
    const mx = (bond.a.x + bond.b.x) / 2 - tail.x;
    const my = (bond.a.y + bond.b.y) / 2 - tail.y;
    // Page-left of tail-to-head in y-down px is the NEGATIVE cross product:
    // the same `leftNormal` sense curve.ts bows a positive bulge towards.
    const cross = dx * my - dy * mx;
    if (cross < 0) left += 1;
    else if (cross > 0) right += 1;
  }
  return left > right ? -1 : 1;
}

function fallbackCurve(
  tail: ResolvedEnd,
  head: ResolvedEnd,
  arrow: CurlyArrowShape,
  style: RenderStyle,
): CubicCurve {
  const axis = tail.axis ?? head.axis ?? { x: 1, y: 0 };
  const half = (CURLY_ARROW_LAYOUT.fallbackChordBonds * pxPerModelUnit(style)) / 2;
  const at = tail.point;
  const from = { x: at.x - axis.x * half, y: at.y - axis.y * half };
  const to = { x: at.x + axis.x * half, y: at.y + axis.y * half };
  // A positive length by construction, so the curve always exists.
  return chordFrameCurve(from, to, arrow.bulge, arrow.skew)!;
}

/**
 * The parameter where the curve leaves `clearance`, walking in from the given
 * end: 0 (or 1) when that end is already clear, the far end when the whole
 * curve is inside. A march in t then a bisection, so a clearance that is a
 * union of shapes is left for good at its FIRST exit rather than wherever a
 * root-finder happens to land.
 */
function trimFrom(curve: CubicCurve, clearance: EndClearance, end: "tail" | "head"): number {
  if (clearance.kind === "none") return end === "tail" ? 0 : 1;
  const at = (s: number): number => (end === "tail" ? s : 1 - s);
  const inside = (s: number): boolean => insideClearance(clearance, curvePoint(curve, at(s)));
  if (!inside(0)) return at(0);
  const { trimSamples, trimBisections } = CURLY_ARROW_LAYOUT;
  let inner = 0;
  for (let i = 1; i <= trimSamples; i++) {
    const s = i / trimSamples;
    if (!inside(s)) {
      let outer = s;
      for (let k = 0; k < trimBisections; k++) {
        const mid = (inner + outer) / 2;
        if (inside(mid)) inner = mid;
        else outer = mid;
      }
      return at(outer);
    }
    inner = s;
  }
  return at(1);
}

/**
 * The parameter below `from` at which the curve is `distance` from `tip`,
 * searching back towards the tail; undefined when the curve never gets that
 * far from the tip before it ends.
 */
function parameterAtDistance(
  curve: CubicCurve,
  from: number,
  tip: ScenePoint,
  distance: number,
): number | undefined {
  const target = distance * distance;
  const far = (t: number): boolean => squaredDistance(curvePoint(curve, t), tip) >= target;
  const { trimSamples, trimBisections } = CURLY_ARROW_LAYOUT;
  let near = from;
  for (let i = 1; i <= trimSamples; i++) {
    const t = from * (1 - i / trimSamples);
    if (far(t)) {
      let outer = t;
      for (let k = 0; k < trimBisections; k++) {
        const mid = (near + outer) / 2;
        if (far(mid)) outer = mid;
        else near = mid;
      }
      return outer;
    }
    near = t;
  }
  return undefined;
}

function squaredDistance(a: ScenePoint, b: ScenePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function unitBetween(from: ScenePoint, to: ScenePoint): ScenePoint | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < CURLY_ARROW_CURVE.coincidentEpsilonPx) return undefined;
  return { x: dx / length, y: dy / length };
}

// ---------------------------------------------------------------------------
// The crowding report
// ---------------------------------------------------------------------------

interface Segment {
  readonly a: ScenePoint;
  readonly b: ScenePoint;
}

function crowding(
  curve: CubicCurve,
  t0: number,
  shaft: CubicCurve | undefined,
  head: Arrowhead,
  tail: ResolvedEnd,
  headEnd: ResolvedEnd,
  obstacles: CurlyArrowObstacles,
  style: RenderStyle,
): CurlyArrowFinding[] {
  const segments: Segment[] = [];
  if (shaft !== undefined) {
    const points = flattenCurve(shaft, CURLY_ARROW_LAYOUT.reportSegments);
    for (let i = 0; i + 1 < points.length; i++) segments.push({ a: points[i]!, b: points[i + 1]! });
  }
  head.points.forEach((point, index) => {
    segments.push({ a: point, b: head.points[(index + 1) % head.points.length]! });
  });

  const ownAtoms = new Set<AtomId>();
  if (tail.atomId !== undefined) ownAtoms.add(tail.atomId);
  if (headEnd.atomId !== undefined) ownAtoms.add(headEnd.atomId);
  const ownBonds = new Set<BondId>();
  if (tail.bondId !== undefined) ownBonds.add(tail.bondId);
  if (headEnd.bondId !== undefined) ownBonds.add(headEnd.bondId);

  const findings: CurlyArrowFinding[] = [];
  const crossedLabels = new Set<AtomId>();
  for (const label of obstacles.labels) {
    if (ownAtoms.has(label.atomId) || crossedLabels.has(label.atomId)) continue;
    const hit = label.obstacles.some((obstacle) =>
      segments.some((segment) => segmentMeetsObstacle(segment, obstacle)),
    );
    if (hit) {
      crossedLabels.add(label.atomId);
      findings.push({ kind: "crosses-label", atomId: label.atomId });
    }
  }

  // The directions the arrow leaves its tail and reaches its head, each
  // pointing AWAY from the end it belongs to.
  const departure = unitBetween(curvePoint(curve, t0), curvePoint(curve, Math.min(1, t0 + 1e-3)));
  const arrival: ScenePoint = { x: -head.direction.x, y: -head.direction.y };
  const along = (direction: ScenePoint | undefined, bond: CurlyArrowBondObstacle, atomId?: AtomId): boolean => {
    if (direction === undefined) return false;
    const axis = unitBetween(bond.a, bond.b);
    if (axis === undefined) return false;
    const cos = direction.x * axis.x + direction.y * axis.y;
    // From an atom a bond leaves in ONE direction; along a bond either way.
    if (atomId === undefined) return Math.abs(cos) > CURLY_ARROW_LAYOUT.alongBondCos;
    return (atomId === bond.from ? cos : -cos) > CURLY_ARROW_LAYOUT.alongBondCos;
  };
  const graze = style.doubleBondGapPx / 2;

  for (const bond of obstacles.bonds) {
    const runsAlong =
      (bond.bondId === tail.bondId && along(departure, bond)) ||
      (bond.bondId === headEnd.bondId && along(arrival, bond)) ||
      (!ownBonds.has(bond.bondId) &&
        ((tail.atomId !== undefined && isEndOf(bond, tail.atomId) && along(departure, bond, tail.atomId)) ||
          (headEnd.atomId !== undefined && isEndOf(bond, headEnd.atomId) && along(arrival, bond, headEnd.atomId))));
    if (runsAlong) {
      findings.push({ kind: "along-bond", bondId: bond.bondId });
      continue;
    }
    if (ownBonds.has(bond.bondId)) continue;
    // A bond meeting the arrow's own atom converges on it by construction, so
    // only a real crossing counts there; any other bond may not be grazed.
    const incident = [...ownAtoms].some((atomId) => isEndOf(bond, atomId));
    const hit = bond.lines.some((line) => {
      const reach = graze + (line.halfWidth ?? 0);
      return segments.some(
        (segment) =>
          segmentsCross(segment, line) ||
          (!incident && squaredSegmentDistance(segment, line) < reach * reach),
      );
    });
    if (hit) findings.push({ kind: "crosses-bond", bondId: bond.bondId });
  }
  return findings;
}

function isEndOf(bond: CurlyArrowBondObstacle, atomId: AtomId): boolean {
  return bond.from === atomId || bond.to === atomId;
}

function squaredSegmentDistance(s: Segment, t: Segment): number {
  if (segmentsCross(s, t)) return 0;
  return Math.min(
    squaredDistanceToSegment(s.a, t),
    squaredDistanceToSegment(s.b, t),
    squaredDistanceToSegment(t.a, s),
    squaredDistanceToSegment(t.b, s),
  );
}

function segmentMeetsObstacle(segment: Segment, obstacle: LabelObstacle): boolean {
  if (obstacle.kind === "disc") {
    return squaredDistanceToSegment(obstacle.centre, segment) < obstacle.radius * obstacle.radius;
  }
  // Liang-Barsky: clip the segment's parameter range to the box's two slabs.
  const { box } = obstacle;
  let enter = 0;
  let leave = 1;
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > leave) return false;
      if (r > enter) enter = r;
    } else {
      if (r < enter) return false;
      if (r < leave) leave = r;
    }
    return true;
  };
  return (
    clip(-dx, segment.a.x - box.minX) &&
    clip(dx, box.maxX - segment.a.x) &&
    clip(-dy, segment.a.y - box.minY) &&
    clip(dy, box.maxY - segment.a.y) &&
    enter < leave
  );
}

function squaredDistanceToSegment(p: ScenePoint, segment: Segment): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - segment.a.x) * dx + (p.y - segment.a.y) * dy) / squared));
  return squaredDistance(p, { x: segment.a.x + dx * t, y: segment.a.y + dy * t });
}

/** A proper crossing: each segment's ends strictly on opposite sides of the other. */
function segmentsCross(s: Segment, t: Segment): boolean {
  const side = (a: ScenePoint, b: ScenePoint, p: ScenePoint): number =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d1 = side(t.a, t.b, s.a);
  const d2 = side(t.a, t.b, s.b);
  const d3 = side(s.a, s.b, t.a);
  const d4 = side(s.a, s.b, t.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
