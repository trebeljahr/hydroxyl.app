/**
 * Straight arrows between species — forward, equilibrium, retrosynthetic,
 * resonance — with their conditions, and the scheme plus sign.
 *
 * ALWAYS DRAWN GEOMETRY (decision 191), never a font glyph: a shaft is a
 * line, a head a polygon (or, for the retrosynthetic arrow, an open stroked
 * chevron). The shaft stretches to the conditions text; the head keeps one
 * size, sized in line widths through the one arrowhead module the curly arrow
 * uses (decision 173), with ChemDraw's straight-arrow proportions.
 *
 * WHERE AN ARROW GOES (decision 203). A reaction arrow stores its species,
 * not its shaft (decision 103). Here, per panel, each side's species boxes
 * (species-box.ts) are united, the arrow runs along whichever axis separates
 * the two boxes by more, on the mean of their centre lines, CENTRED in the
 * gap, and is as long as its text needs and at least `minArrowBonds`. The
 * conditions wrap to the room the species leave, which does not depend on the
 * arrow — so the wrap is not circular. Nothing moves a species: an arrow
 * longer than the room is drawn anyway and REPORTED (`crowds-species`), as is
 * a pair of boxes with no gap at all (`overlapping-species`).
 *
 * `row` does not move anything yet: composing a wrapped scheme is the export
 * task's layout rule.
 *
 * All scene px, y-down. Lengths in bond lengths go through `pxPerModelUnit`;
 * nothing here names `bondLengthPx`.
 */

import { speciesRelationIssues } from "@starter/chem-core";
import type { AtomId } from "@starter/chem-core";

import { leftNormal } from "../bond/geometry.js";
import type {
  LinePrimitive,
  PathPrimitive,
  PolygonPrimitive,
  PolylinePrimitive,
  ScenePoint,
  ScenePrimitive,
  TextRunPrimitive,
  TextSpan,
} from "../scene/types.js";
import type {
  PlusAnnotation,
  ReactionArrowAnnotation,
  ReactionConditions,
  ResonanceArrowAnnotation,
  RetrosynthesisArrowAnnotation,
  SchemeAnnotationId,
} from "../scheme/annotation.js";
import { formatNumber } from "../svg/emit.js";
import { pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";
import { EM_CAP_HEIGHT } from "../text/metrics.js";
import { measureTextRun } from "../text/measurer.js";
import { unmeasuredCodePoints } from "../text/typography.js";
import { arrowhead, arrowheadLengths } from "./arrowhead.js";
import type { ArrowheadProportions } from "./arrowhead.js";
import { conditionsText, EMPTY_CONDITIONS_TEXT } from "./conditions.js";
import type { ConditionsText } from "./conditions.js";
import { annotationSource, primitivesBox, SCHEME_LAYOUT, schemeMarkPrimitiveId } from "./scheme-mark.js";
import type { SchemeMarkFinding, SchemeMarkLayout, SchemeMarkSite } from "./scheme-mark.js";
import { boxCentre } from "./species-box.js";
import type { SchemeBox } from "./species-box.js";

/**
 * ChemDraw's straight-arrow head, `HeadSize` 1000, `ArrowheadCenterSize` 875,
 * `ArrowheadWidth` 250, in hundredths of the line width: 10, 8.75 and 2.5 line
 * widths (decision 203), beside the curly arrow's 8/7/2 (decision 173). At
 * Publication's 1 px line a 10 px head, 6 pt printed, 5 px across.
 */
export const STRAIGHT_ARROWHEAD: ArrowheadProportions = Object.freeze({
  length: 10,
  notch: 8.75,
  halfWidth: 2.5,
});

export type StraightArrowKind = "forward" | "equilibrium" | "retrosynthesis" | "resonance";

/** One placed line of conditions text. */
export interface ConditionsLineLayout {
  readonly side: "above" | "below";
  readonly spans: readonly TextSpan[];
  /** On the alphabetic baseline (decision 53). */
  readonly origin: ScenePoint;
  readonly anchor: "start" | "middle" | "end";
  readonly fontSizePx: number;
  /** The line's measured advance: what it is centred on and what the bounds see. */
  readonly advanceWidthPx: number;
}

export interface StraightArrowLayout extends SchemeMarkLayout {
  readonly arrow: StraightArrowKind;
  readonly axis: "horizontal" | "vertical";
  /** Where the arrow starts and ends on the scheme line, px. The heads end AT these. */
  readonly tail: ScenePoint;
  readonly tip: ScenePoint;
  readonly lengthPx: number;
  /** The room between the two sides' boxes, less the clearance each side; may be negative. */
  readonly roomPx: number;
  readonly conditions: readonly ConditionsLineLayout[];
}

/** The line a mark between two boxes sits on. */
interface SchemeLine {
  readonly axis: "horizontal" | "vertical";
  /** Unit, from the first box towards the second. */
  readonly direction: ScenePoint;
  /** The middle of the gap, on the line. */
  readonly middle: ScenePoint;
  /** The gap between the boxes along the axis (negative when they overlap on it). */
  readonly gapPx: number;
  /** False when the boxes overlap on both axes. */
  readonly separated: boolean;
}

function schemeLine(first: SchemeBox, second: SchemeBox): SchemeLine {
  const a = boxCentre(first);
  const b = boxCentre(second);
  const rightward = b.x >= a.x;
  const downward = b.y >= a.y;
  const gapX = rightward ? second.minX - first.maxX : first.minX - second.maxX;
  const gapY = downward ? second.minY - first.maxY : first.minY - second.maxY;
  const separated = gapX > 0 || gapY > 0;
  // The axis that separates the two boxes by more; horizontal on a tie. With
  // no gap either way, the axis of the larger centre offset.
  const horizontal = separated ? gapX >= gapY : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horizontal) {
    const fromEdge = rightward ? first.maxX : first.minX;
    const toEdge = rightward ? second.minX : second.maxX;
    return {
      axis: "horizontal",
      direction: { x: rightward ? 1 : -1, y: 0 },
      middle: { x: (fromEdge + toEdge) / 2, y: (a.y + b.y) / 2 },
      gapPx: gapX,
      separated,
    };
  }
  const fromEdge = downward ? first.maxY : first.minY;
  const toEdge = downward ? second.minY : second.maxY;
  return {
    axis: "vertical",
    direction: { x: 0, y: downward ? 1 : -1 },
    middle: { x: (a.x + b.x) / 2, y: (fromEdge + toEdge) / 2 },
    gapPx: gapY,
    separated,
  };
}

function along(point: ScenePoint, direction: ScenePoint, distance: number): ScenePoint {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function sameSpeciesFinding(
  site: SchemeMarkSite,
  first: readonly AtomId[],
  second: readonly AtomId[],
): SchemeMarkFinding | undefined {
  const left = new Set(first.map((atomId) => site.boxes.speciesIndex(atomId)));
  const shared = second.find((atomId) => {
    const index = site.boxes.speciesIndex(atomId);
    return index !== undefined && left.has(index);
  });
  return shared === undefined ? undefined : { kind: "same-species", atomId: shared };
}

type StraightArrowAnnotation =
  | ReactionArrowAnnotation
  | RetrosynthesisArrowAnnotation
  | ResonanceArrowAnnotation;

/** Tail side, head side, and the arrow drawn: a retro arrow runs target to precursors. */
function straightArrowEnds(annotation: StraightArrowAnnotation): {
  readonly first: readonly AtomId[];
  readonly second: readonly AtomId[];
  readonly arrow: StraightArrowKind;
  readonly conditions: ReactionConditions | undefined;
} {
  switch (annotation.kind) {
    case "reactionArrow":
      return {
        first: annotation.from,
        second: annotation.to,
        arrow: annotation.equilibrium === undefined ? "forward" : "equilibrium",
        conditions: annotation.conditions,
      };
    case "retrosynthesisArrow":
      return {
        first: annotation.target,
        second: annotation.precursors,
        arrow: "retrosynthesis",
        conditions: annotation.conditions,
      };
    case "resonanceArrow":
      return { first: [annotation.between[0]], second: [annotation.between[1]], arrow: "resonance", conditions: undefined };
    default: {
      const unreachable: never = annotation;
      return unreachable;
    }
  }
}

/**
 * How far the outermost shaft stands off the scheme line: conditions are set
 * that far further out, so they clear an equilibrium's upper half and a retro
 * arrow's upper line as they clear a single shaft.
 */
function shaftHalfSpan(arrow: StraightArrowKind, style: RenderStyle): number {
  return arrow === "equilibrium" || arrow === "retrosynthesis" ? style.doubleBondGapPx / 2 : 0;
}

/**
 * The arrow laid out in the panel, or undefined when the panel draws none of
 * its species on one side.
 */
export function layoutStraightArrow(
  annotation: StraightArrowAnnotation,
  site: SchemeMarkSite,
): StraightArrowLayout | undefined {
  const { style, measurer } = site;
  const ends = straightArrowEnds(annotation);
  const firstBox = site.boxes.unionOf(ends.first);
  const secondBox = site.boxes.unionOf(ends.second);
  if (firstBox === undefined || secondBox === undefined) return undefined;

  const findings: SchemeMarkFinding[] = [];
  const same = sameSpeciesFinding(site, ends.first, ends.second);
  if (same !== undefined) findings.push(same);
  const line = schemeLine(firstBox, secondBox);
  if (!line.separated) findings.push({ kind: "overlapping-species" });

  const bond = pxPerModelUnit(style);
  const fontSizePx = style.fontSizePx;
  const pad = SCHEME_LAYOUT.conditionsPadEm * fontSizePx;
  const minimum = SCHEME_LAYOUT.minArrowBonds * bond;
  const room = line.gapPx - 2 * SCHEME_LAYOUT.speciesClearanceBonds * bond;
  const runOptions = {
    fontFamily: style.fontFamily,
    fontSizePx,
    subscriptScale: style.subscriptScale,
    anchor: "middle" as const,
    baseline: "alphabetic" as const,
  };
  const measure = (spans: readonly TextSpan[]): number => measureTextRun(spans, runOptions, measurer).advanceWidthPx;

  const wrapWidth =
    line.axis === "horizontal"
      ? Math.max(minimum, room) - 2 * pad
      : SCHEME_LAYOUT.verticalWrapBonds * bond;
  const text: ConditionsText =
    ends.conditions === undefined ? EMPTY_CONDITIONS_TEXT : conditionsText(ends.conditions, wrapWidth, measure);
  const lineHeight = SCHEME_LAYOUT.conditionsLineEm * fontSizePx;
  const capHeight = EM_CAP_HEIGHT * fontSizePx;
  const widest = Math.max(0, ...[...text.above, ...text.below].map(measure));
  const columnHeight = (count: number): number => (count === 0 ? 0 : (count - 1) * lineHeight + capHeight);
  const natural =
    line.axis === "horizontal"
      ? widest + 2 * pad
      : Math.max(columnHeight(text.above.length), columnHeight(text.below.length)) + 2 * pad;
  const length = Math.max(minimum, natural);
  if (line.separated && length > room + 1e-9) findings.push({ kind: "crowds-species" });

  const tail = along(line.middle, line.direction, -length / 2);
  const tip = along(line.middle, line.direction, length / 2);

  // The conditions, around the shaft's middle.
  const offset = shaftHalfSpan(ends.arrow, style) + SCHEME_LAYOUT.conditionsGapEm * fontSizePx;
  const conditions: ConditionsLineLayout[] = [];
  const place = (spans: readonly TextSpan[], side: "above" | "below", origin: ScenePoint, anchor: ConditionsLineLayout["anchor"]): void => {
    conditions.push({ side, spans, origin, anchor, fontSizePx, advanceWidthPx: measure(spans) });
  };
  const { x: mx, y: my } = line.middle;
  if (line.axis === "horizontal") {
    // Above: the lowest line's ink bottom a gap above the shaft; below: the
    // first line's cap band top a gap below it. Stacked a line height apart.
    let baseline = my - offset;
    for (let i = text.above.length - 1; i >= 0; i--) {
      const spans = text.above[i]!;
      const descent = measureTextRun(spans, runOptions, measurer).descentPx;
      baseline = i === text.above.length - 1 ? baseline - descent : baseline - lineHeight;
      place(spans, "above", { x: mx, y: baseline }, "middle");
    }
    conditions.reverse();
    text.below.forEach((spans, i) => {
      place(spans, "below", { x: mx, y: my + offset + capHeight + i * lineHeight }, "middle");
    });
  } else {
    // A vertical arrow: reagents to its right, the rest to its left, each
    // column centred on the shaft's middle by its cap bands.
    const column = (lines: readonly (readonly TextSpan[])[], side: "above" | "below"): void => {
      const top = my - ((lines.length - 1) * lineHeight) / 2 + capHeight / 2;
      lines.forEach((spans, i) => {
        const x = side === "above" ? mx + offset : mx - offset;
        place(spans, side, { x, y: top + i * lineHeight }, side === "above" ? "start" : "end");
      });
    };
    column(text.above, "above");
    column(text.below, "below");
  }

  const codePoints = unmeasuredCodePoints(
    conditions.map((c) => c.spans.map((span) => span.text).join("")).join(""),
    measurer,
    style.fontFamily,
  );
  if (codePoints.length > 0) findings.push({ kind: "unmeasured-glyphs", codePoints });

  if (ends.arrow === "resonance") {
    for (const issue of speciesRelationIssues(site.source, "resonance", ends.first, ends.second)) {
      if (issue.kind === "resonance-formula-differs" || issue.kind === "resonance-charge-differs") {
        findings.push({ kind: issue.kind });
      }
    }
  }

  // Each side's lines numbered from its top, so a line keeps its id when the
  // other side gains one.
  const sideIndex = { above: 0, below: 0 };
  const primitives = [
    ...arrowPrimitives(annotation, ends.arrow, tail, tip, line.direction, length, style),
    ...conditions.map((c): TextRunPrimitive => ({
      id: schemeMarkPrimitiveId(annotation.id, `conditions-${c.side}-${String(sideIndex[c.side]++)}`),
      source: annotationSource(annotation.id),
      type: "textRun",
      origin: c.origin,
      spans: c.spans,
      fontFamily: style.fontFamily,
      fontSizePx: c.fontSizePx,
      fill: { color: style.colors.label },
      anchor: c.anchor,
    })),
  ];
  return {
    annotationId: annotation.id,
    arrow: ends.arrow,
    axis: line.axis,
    tail,
    tip,
    lengthPx: length,
    roomPx: room,
    conditions,
    primitives,
    box: primitivesBox(primitives, style),
    findings,
  };
}

function lineBetween(id: string, annotationId: SchemeAnnotationId, a: ScenePoint, b: ScenePoint, style: RenderStyle): LinePrimitive {
  return {
    id,
    source: annotationSource(annotationId),
    type: "line",
    a,
    b,
    stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
  };
}

function filledHead(id: string, annotationId: SchemeAnnotationId, points: readonly ScenePoint[], style: RenderStyle): PolygonPrimitive {
  return { id, source: annotationSource(annotationId), type: "polygon", points, fill: { color: style.colors.bond } };
}

/** Shafts and heads, in draw order: every shaft before the head that covers its end. */
function arrowPrimitives(
  annotation: StraightArrowAnnotation,
  arrow: StraightArrowKind,
  tail: ScenePoint,
  tip: ScenePoint,
  direction: ScenePoint,
  length: number,
  style: RenderStyle,
): ScenePrimitive[] {
  const id = annotation.id;
  const width = style.bondLineWidthPx;
  const left = leftNormal(direction);
  const backwards = { x: -direction.x, y: -direction.y };
  switch (arrow) {
    case "forward": {
      const head = arrowhead(tip, direction, width, STRAIGHT_ARROWHEAD, "full");
      return [
        lineBetween(schemeMarkPrimitiveId(id, "shaft"), id, tail, head.notch, style),
        filledHead(schemeMarkPrimitiveId(id, "head"), id, head.points, style),
      ];
    }
    case "resonance": {
      const head = arrowhead(tip, direction, width, STRAIGHT_ARROWHEAD, "full");
      const back = arrowhead(tail, backwards, width, STRAIGHT_ARROWHEAD, "full");
      return [
        lineBetween(schemeMarkPrimitiveId(id, "shaft"), id, back.notch, head.notch, style),
        filledHead(schemeMarkPrimitiveId(id, "head"), id, head.points, style),
        filledHead(schemeMarkPrimitiveId(id, "tail-head"), id, back.points, style),
      ];
    }
    case "equilibrium": {
      // Two half-headed shafts the double-bond gap apart, the forward one on
      // the LEFT of travel (above a left-to-right arrow), each barb on the
      // outside: page-left of its own travel, which for the reverse half is
      // the other side. Decision 194's bias shortens the unfavoured half,
      // centred on the favoured one.
      const half = style.doubleBondGapPx / 2;
      const bias = annotation.kind === "reactionArrow" ? annotation.equilibrium?.bias : undefined;
      const minor = SCHEME_LAYOUT.equilibriumMinorFraction;
      const forwardLength = bias === "reverse" ? length * minor : length;
      const reverseLength = bias === "forward" ? length * minor : length;
      const middle = { x: (tail.x + tip.x) / 2, y: (tail.y + tip.y) / 2 };
      const forwardMiddle = along(middle, left, half);
      const reverseMiddle = along(middle, left, -half);
      const forwardTip = along(forwardMiddle, direction, forwardLength / 2);
      const forwardTail = along(forwardMiddle, direction, -forwardLength / 2);
      const reverseTip = along(reverseMiddle, direction, -reverseLength / 2);
      const reverseTail = along(reverseMiddle, direction, reverseLength / 2);
      const forwardHead = arrowhead(forwardTip, direction, width, STRAIGHT_ARROWHEAD, "half", "left");
      const reverseHead = arrowhead(reverseTip, backwards, width, STRAIGHT_ARROWHEAD, "half", "left");
      return [
        lineBetween(schemeMarkPrimitiveId(id, "forward-shaft"), id, forwardTail, forwardHead.notch, style),
        filledHead(schemeMarkPrimitiveId(id, "forward-head"), id, forwardHead.points, style),
        lineBetween(schemeMarkPrimitiveId(id, "reverse-shaft"), id, reverseTail, reverseHead.notch, style),
        filledHead(schemeMarkPrimitiveId(id, "reverse-head"), id, reverseHead.points, style),
      ];
    }
    case "retrosynthesis": {
      // Two shafts the double-bond gap apart, closed by an open chevron whose
      // arms run at 45 degrees: each shaft ends where it meets its arm, at its
      // own offset back from the tip. Stroked, never filled — an open head is
      // what tells this arrow from a forward one at a glance.
      const half = style.doubleBondGapPx / 2;
      const reach = half + arrowheadLengths(width, STRAIGHT_ARROWHEAD).halfWidth;
      const leftBarb = along(along(tip, direction, -reach), left, reach);
      const rightBarb = along(along(tip, direction, -reach), left, -reach);
      const stop = along(tip, direction, -half);
      const chevron: PolylinePrimitive = {
        id: schemeMarkPrimitiveId(id, "head"),
        source: annotationSource(id),
        type: "polyline",
        points: [leftBarb, tip, rightBarb],
        stroke: { color: style.colors.bond, width },
      };
      return [
        lineBetween(schemeMarkPrimitiveId(id, "shaft-left"), id, along(tail, left, half), along(stop, left, half), style),
        lineBetween(schemeMarkPrimitiveId(id, "shaft-right"), id, along(tail, left, -half), along(stop, left, -half), style),
        chevron,
      ];
    }
    default: {
      const unreachable: never = arrow;
      return unreachable;
    }
  }
}

export interface PlusLayout extends SchemeMarkLayout {
  readonly centre: ScenePoint;
  /** Half of one arm, px. */
  readonly halfArmPx: number;
}

/**
 * The scheme plus: two strokes centred in the gap between its species, on
 * the mean of their centre lines (decision 204). Geometry, so it inherits no
 * font size — neither the label's nor `subscriptScale` — and a formal charge
 * cannot inherit its size either.
 */
export function layoutPlus(annotation: PlusAnnotation, site: SchemeMarkSite): PlusLayout | undefined {
  const { style } = site;
  const first = site.boxes.boxOf(annotation.between[0]);
  const second = site.boxes.boxOf(annotation.between[1]);
  if (first === undefined || second === undefined) return undefined;
  const findings: SchemeMarkFinding[] = [];
  const same = sameSpeciesFinding(site, [annotation.between[0]], [annotation.between[1]]);
  if (same !== undefined) findings.push(same);
  const line = schemeLine(first, second);
  if (!line.separated) findings.push({ kind: "overlapping-species" });
  const bond = pxPerModelUnit(style);
  const halfArm = SCHEME_LAYOUT.plusHalfArmBonds * bond;
  const room = line.gapPx - 2 * SCHEME_LAYOUT.speciesClearanceBonds * bond;
  if (line.separated && 2 * halfArm > room + 1e-9) findings.push({ kind: "crowds-species" });
  const { x, y } = line.middle;
  const f = (n: number): string => formatNumber(n, style.coordinatePrecision, `annotation:${annotation.id}:plus`);
  // M/L pairs only: the bounds pass reads a path's numbers as x,y pairs, and
  // an H or V command would pair them wrongly (scene/bounds.ts).
  const path: PathPrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, "plus"),
    source: annotationSource(annotation.id),
    type: "path",
    d: `M${f(x - halfArm)} ${f(y)} L${f(x + halfArm)} ${f(y)} M${f(x)} ${f(y - halfArm)} L${f(x)} ${f(y + halfArm)}`,
    stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
  };
  const primitives = [path];
  return {
    annotationId: annotation.id,
    centre: { x, y },
    halfArmPx: halfArm,
    primitives,
    box: primitivesBox(primitives, style),
    findings,
  };
}
