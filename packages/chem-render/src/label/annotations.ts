/**
 * Where every small annotation goes: stereo descriptors, alpha/beta labels,
 * locants and torsion labels — ONE pass, ONE search.
 *
 * An annotation is the opposite of an atom label. The label has to sit ON its
 * atom and the bonds get out of its way; an annotation has to find the space
 * nothing else wanted. It claims no clear space of its own, is never trimmed
 * against, never displaces a bond and never moves an atom. "Report, never
 * nudge" is about the author's ATOM coordinates: choosing among candidate
 * offsets for an annotation is exactly what this file does, and moving the
 * atom to make room is exactly what it never does.
 *
 * WHY ONE PASS. Before this file the descriptor pass placed `(R)` and `(S)` on
 * its own. A locant pass written beside it would have been a second search
 * that could not see the first's results, so two annotations on the same atom
 * would each have found "the" free slot and drawn on top of each other. Every
 * annotation kind goes through `placeAnnotations`, and each placed box is an
 * obstacle for every annotation placed after it.
 *
 * WHO GETS A CONTESTED SLOT is decision 17, a fixed priority table:
 * descriptor > alphaBeta > locant > torsion. The requests are SORTED by that
 * table before anything is placed, so the higher-priority annotation claims
 * its slot first and the loser takes its next candidate — whatever order the
 * caller listed them in. Within one kind, ties break by source id in
 * chem-core's `compareIds` order (`a9` before `a10`), never by iteration
 * order. Descriptors already ship in committed goldens; putting them first
 * means switching locants on can never move one.
 *
 * THE SEARCH IS A FIXED LADDER, NOT AN OPTIMISATION. A fixed list of
 * candidates — eight compass directions at a few coarse radii, then sixteen
 * directions stepping out finely from the atom (`candidateOrigins` says why
 * both) — and the first candidate that clears everything wins. The caller's
 * preferred direction only RANKS the directions; it is never itself a
 * candidate. That matters twice over:
 *
 *   - a placed annotation's origin is `anchor + direction * radius`, built
 *     from literals and style numbers, so a preferred direction that differs
 *     in its last bit (it is a normalised sum of neighbour directions, whose
 *     low bits depend on the order they were added in) cannot move a glyph;
 *   - `freeDirection` on a substituted ring atom points where the substituent
 *     bond and its revealed hydrogen already are. A single-candidate placement
 *     along it collides on essentially every atom of a steroid; a SET of
 *     candidates checked against the obstacles does not.
 *
 * A CANDIDATE IS CLEAR ONLY IF IT READS AS ITS OWN ATOM'S (decision 35): the
 * centre of its measured INK box (decision 57) must lie strictly nearer its
 * own anchor — the atom centre, or
 * for a bond annotation the bond segment — than any other atom centre. Room
 * alone is not enough. The outer rungs of the ladder reach far enough to sit
 * beside a NEIGHBOUR, and a clear "(S)" or "17" there is read as the
 * neighbour's: a correct number on the wrong atom, which no overlap check
 * can see.
 *
 * A request that never clears is still placed and REPORTED in
 * `AnnotationLayout.unplaced`, with `clear: false`. A figure missing one
 * letter with no explanation is worse than a crowded one, and the crowding is
 * visible; the report is how a caller says so. Which candidate it takes is
 * still a choice among candidates: the LEAST WRONG one, by `compareFallbacks`
 * (decision 45) — off every annotation already placed wherever any candidate
 * is, then reading as its own atom's, then the least glyph ink overprinted
 * (decision 55), then the fewest line hits, then ladder order. An unclear annotation reads as another
 * atom's only when not one candidate reads as its own (two atoms on one spot).
 *
 * "Another atom" means a REAL atom of the molecule (decision 46): the hydrogens
 * the explicitH and Lewis views derive and draw are obstacles to avoid, never
 * atoms an annotation could be misread as belonging to.
 *
 * THE ORIGIN HANDED BACK IS ON THE ALPHABETIC BASELINE (decision 53). The
 * ladder works in run CENTRES — a candidate is the point the measured box is
 * centred on — and each placement's origin is that centre dropped by the
 * measurer's own `baselineYPx`, because a `TextRunPrimitive` has no baseline
 * mode. The box used for clearance, and fed back as an obstacle, is exactly
 * the measured box either way: `textRunRect` of the baseline origin adds the
 * same offset in the same order.
 *
 * INPUTS ARE SCENE PX WITH Y ALREADY FLIPPED (y-down), as everywhere in this
 * layer. A direction taken from model space (y-up) and not flipped mirrors
 * every annotation vertically while every horizontal fixture still looks
 * perfect; the tests carry a vertically asymmetric fixture for exactly that.
 * No `Math.atan2`, no `Math.hypot`: the directions are literals, built from
 * `Math.SQRT1_2` and `Math.sqrt` of exact constants (correctly rounded), the only
 * length taken is `Math.sqrt(x*x + y*y)`, and proximity compares SQUARED
 * distances.
 */

import { compareIds } from "@starter/chem-core";
import type { AtomId, BondId } from "@starter/chem-core";

import type { ScenePoint, TextSpan } from "../scene/types.js";
import type { RenderStyle } from "../style.js";
import {
  measurerFor,
  measureTextRun,
  textRunInkRect,
  textRunRect,
} from "../text/measurer.js";
import type { TextRunBox } from "../text/measurer.js";
import { freeDirection } from "./placement.js";
import type { LabelBox, LabelObstacle } from "./placement.js";

export type AnnotationKind = "descriptor" | "alphaBeta" | "locant" | "torsion";

/**
 * Decision 17: the index IS the priority, highest first.
 *
 * `as const satisfies` catches a kind removed from the union; the `IsTotal`
 * guard below catches one added to it without a row here — which would
 * otherwise sort at index -1, AHEAD of the descriptors.
 */
export const ANNOTATION_PRIORITY = [
  "descriptor",
  "alphaBeta",
  "locant",
  "torsion",
] as const satisfies readonly AnnotationKind[];

type AnnotationPriorityIsTotal =
  AnnotationKind extends (typeof ANNOTATION_PRIORITY)[number] ? true : never;
const ANNOTATION_PRIORITY_IS_TOTAL: AnnotationPriorityIsTotal = true;
void ANNOTATION_PRIORITY_IS_TOTAL;

export const ANNOTATION_PLACEMENT = Object.freeze({
  /**
   * The first radius tried, as a multiple of the annotation's own cap height.
   *
   * Measured from the anchor to the CENTRE of the annotation's box, so it has
   * to clear roughly half the box before it clears anything else. 1.4 puts a
   * two-glyph run just outside a bare vertex and just outside a one-letter
   * atom label; the ladder handles everything wider.
   */
  firstRadiusCapHeights: 1.4,
  /** How much further out each rung of the ladder reaches. */
  radiusStepCapHeights: 0.55,
  /** Rungs of the coarse ladder. The close ladder stops at the last one. */
  radiusSteps: 5,
  /**
   * The close ladder's step, as a multiple of the annotation's cap height:
   * between 1 and 2 px at the shipped presets. Fine enough to find the gap
   * between two bonds at a vertex whose clear room is only a few pixels deep;
   * see `candidateOrigins`.
   */
  closeStepCapHeights: 0.2,
  /** Extra clear space demanded around the annotation's measured box, px. */
  clearancePx: 1,
  /**
   * Resolution at which two compass directions count as EQUALLY close to the
   * preferred one: closeness is compared as `Math.round(dot * quantum)`.
   *
   * Without it, a preferred direction exactly between two compass points —
   * the apex of a symmetric zig-zag, a fused-ring atom — ranks them by which
   * way a 1-ulp error in the preferred vector happens to fall, and that error
   * depends on the order neighbour directions were summed in. Quantised, a
   * genuine tie falls to the fixed `COMPASS` order instead. A billionth of a
   * cosine is far below any angle a drawing distinguishes.
   */
  directionQuantum: 1e9,
});

export type AnnotationSource =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId };

export interface AnnotationRequest {
  readonly kind: AnnotationKind;
  readonly source: AnnotationSource;
  readonly text: string;
  /** Scene px, y-down: an atom centre, or a bond's midpoint. */
  readonly anchor: ScenePoint;
  /**
   * Scene px, y-down; need not be unit length. RANKS the compass directions
   * and is never itself a candidate — see the module header.
   */
  readonly preferred: ScenePoint;
  /**
   * For a bond annotation, the bond as drawn: proximity (decision 35) is
   * measured to this segment rather than to `anchor`. An annotation beside
   * the middle of a long bond is the bond's even when the midpoint is further
   * from it than one of the bond's own atoms is.
   */
  readonly anchorSegment?: AnnotationSegment;
}

/** A drawn segment an annotation must not lie across. */
export interface AnnotationSegment {
  readonly a: ScenePoint;
  readonly b: ScenePoint;
  /**
   * Half the stroke width, px: how far the segment's ink reaches either side
   * of it. Omitted, the segment is a hairline. Without it a style with a
   * heavier line than the presets reports a glyph clear while the glyph sits
   * on the stroke's edge.
   */
  readonly halfWidth?: number;
}

/** An atom centre, for decision 35's proximity test. */
export interface AnnotationAtomCentre {
  readonly atomId: AtomId;
  /** Scene px, y-down. */
  readonly centre: ScenePoint;
}

/**
 * A stroked circle OUTLINE — an aromatic ring's inscribed circle.
 *
 * Not a disc: the inside of a ring is empty page, and a locant just inside
 * the ring beside its own vertex is a legitimate place for one.
 */
export interface AnnotationCircle {
  readonly centre: ScenePoint;
  readonly radius: number;
  /** Half the stroke width, px. */
  readonly halfWidth: number;
}

/** Things an annotation must not touch. */
export interface AnnotationObstacleSet {
  /** Label glyphs, electron dots, bare-vertex dots. */
  readonly obstacles: readonly LabelObstacle[];
  /** Everything a bond or a hydrogen stem drew, as segments. */
  readonly segments: readonly AnnotationSegment[];
  readonly circles?: readonly AnnotationCircle[];
  /**
   * The INK box of every glyph and dot the drawing set, UNPADDED, one entry
   * per glyph: what a fallback's glyph hit is measured against (decision 55).
   *
   * Kept apart from `obstacles`, which are clearance boxes — padded cap-band
   * boxes plus each run's full line band, so one glyph is several records
   * there. Those decide whether a candidate is CLEAR; this decides how badly
   * an unclear one prints over text. Omitted, no fallback counts a glyph hit.
   */
  readonly glyphInk?: readonly LabelBox[];
}

export interface AnnotationContext extends AnnotationObstacleSet {
  readonly style: RenderStyle;
  /**
   * Every atom centre in the drawing. A candidate is clear only if its centre
   * is nearer its own anchor than any of these other than its own atom
   * (decision 35). Omitted, nothing is tested — which is right only for a
   * synthetic context with no atoms in it.
   */
  readonly atomCentres?: readonly AnnotationAtomCentre[];
  /**
   * Boxes of annotations placed earlier. Obstacles like any other; kept apart
   * from `obstacles` only so an annotation that cannot be placed clear avoids
   * printing over another annotation before it gives up. `placeAnnotations`
   * fills it.
   */
  readonly placed?: readonly LabelBox[];
}

export interface AnnotationPlacement {
  /** See `annotationId`. */
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly source: AnnotationSource;
  readonly text: string;
  /**
   * Origin for a middle-anchored run, ON ITS ALPHABETIC BASELINE (decision
   * 53): the run centre the ladder chose, dropped by the measurer's
   * `baselineYPx`. Emit it as the run's `y` with no `dominant-baseline`.
   */
  readonly origin: ScenePoint;
  readonly fontSizePx: number;
  /** The measured box plus clearance: what later annotations must avoid. */
  readonly box: LabelBox;
  /**
   * The run's measured INK box, unpadded: the union of its glyphs' outlines.
   * Its centre is where the reader sees the annotation, and proximity is
   * judged there (decision 57); its overlap with glyph ink ranks fallbacks
   * (decision 55).
   */
  readonly inkBox: LabelBox;
  /**
   * False when no candidate was both free of every obstacle and nearer its own
   * anchor than any other atom, and one was taken anyway. Every such placement
   * is also in `AnnotationLayout.unplaced`.
   */
  readonly clear: boolean;
}

/** An annotation that could not be placed clear, and where it went instead. */
export interface UnplacedAnnotation {
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly source: AnnotationSource;
  readonly text: string;
  readonly box: LabelBox;
}

export interface AnnotationLayout {
  /** In placement order — priority, then source id. Emission follows it. */
  readonly placements: readonly AnnotationPlacement[];
  /** The placements that are NOT clear, in the same order. */
  readonly unplaced: readonly UnplacedAnnotation[];
}

export const EMPTY_ANNOTATION_LAYOUT: AnnotationLayout = Object.freeze({
  placements: Object.freeze([]),
  unplaced: Object.freeze([]),
});

/**
 * `atom:a2:descriptor`, `atom:a2:locant`, `atom:a2:alphaBeta`,
 * `bond:b3:torsion`.
 *
 * Derived from the kind and the source, never from a counter, so one
 * annotation keeps its id across an edit elsewhere in the molecule. The
 * descriptor spelling is the one the committed goldens already carry.
 */
export function annotationId(kind: AnnotationKind, source: AnnotationSource): string {
  return source.kind === "atom"
    ? `atom:${source.atomId}:${kind}`
    : `bond:${source.bondId}:${kind}`;
}

/**
 * Size of an annotation's run, px.
 *
 * Every kind shares the descriptor's scale today: all four are small print
 * set beside a structure, and a figure mixing three annotation sizes reads as
 * three different claims. One function, so a kind that needs its own size
 * gets it here and nowhere else.
 */
export function annotationFontSizePx(kind: AnnotationKind, style: RenderStyle): number {
  void kind;
  return style.fontSizePx * style.stereoDescriptorScale;
}

function sourceId(source: AnnotationSource): string {
  return source.kind === "atom" ? source.atomId : source.bondId;
}

/**
 * The placement order: decision 17's priority table, then source id by
 * `compareIds`, then source kind, then text.
 *
 * A TOTAL order over everything that distinguishes two requests, so the
 * sorted list — and with it every placement — does not depend on the order
 * the requests arrived in.
 */
export function compareAnnotationRequests(
  a: AnnotationRequest,
  b: AnnotationRequest,
): number {
  const priority =
    ANNOTATION_PRIORITY.indexOf(a.kind) - ANNOTATION_PRIORITY.indexOf(b.kind);
  if (priority !== 0) return priority;
  const byId = compareIds(sourceId(a.source), sourceId(b.source));
  if (byId !== 0) return byId;
  if (a.source.kind !== b.source.kind) return a.source.kind === "atom" ? -1 : 1;
  if (a.text === b.text) return 0;
  return a.text < b.text ? -1 : 1;
}

/**
 * Places every request, highest priority first, each placed box an obstacle
 * for every later one.
 *
 * THROWS on two requests that would share an id (one kind, one source). That
 * is a caller bug with no deterministic answer — which of two is "the" locant
 * of `a3`? — not crowding to report.
 */
export function placeAnnotations(
  requests: readonly AnnotationRequest[],
  context: AnnotationContext,
): AnnotationLayout {
  if (requests.length === 0) return EMPTY_ANNOTATION_LAYOUT;
  const sorted = [...requests].sort(compareAnnotationRequests);

  const placedBoxes: LabelBox[] = [...(context.placed ?? [])];
  const local: AnnotationContext = { ...context, placed: placedBoxes };
  const placements: AnnotationPlacement[] = [];
  const unplaced: UnplacedAnnotation[] = [];
  const seen = new Set<string>();

  for (const request of sorted) {
    const id = annotationId(request.kind, request.source);
    if (seen.has(id)) throw new Error(`Two annotation requests share the id ${id}`);
    seen.add(id);

    const placed = placeAnnotation(request, local);
    // Every annotation blocks the next one, the unclear ones included: an
    // overlap already reported must not be compounded by a second.
    placedBoxes.push(placed.box);
    placements.push(placed);
    if (!placed.clear) {
      unplaced.push({
        id: placed.id,
        kind: placed.kind,
        source: placed.source,
        text: placed.text,
        box: placed.box,
      });
    }
  }

  return { placements, unplaced };
}

/**
 * `freeDirection`, with the neighbour centres sorted by position first.
 *
 * `freeDirection` sums neighbour directions in the order given, and a float
 * sum's low bits depend on that order: the same three neighbours in two orders
 * can differ in the last bit. A scene builder's neighbour order is bond
 * insertion order, so without the sort the same drawing built two ways would
 * hand the ladder two preferred directions. `directionQuantum` already keeps a
 * last-bit difference from reordering the compass; this keeps the input itself
 * bit-identical, so neither guard is relied on alone.
 */
export function canonicalFreeDirection(
  centre: ScenePoint,
  neighbourCentres: readonly ScenePoint[],
): ScenePoint {
  const sorted = [...neighbourCentres].sort((p, q) => {
    if (p.x !== q.x) return p.x < q.x ? -1 : 1;
    if (p.y !== q.y) return p.y < q.y ? -1 : 1;
    return 0;
  });
  return freeDirection(centre, sorted);
}

const SQRT_HALF = Math.SQRT1_2;

/**
 * The eight directions, in the order they are preferred when the requested one
 * is not available.
 *
 * North first for the same reason the radical-dot cluster prefers it: it is
 * where an annotation is conventionally written and the direction least likely
 * to meet the 30-degree bonds a skeletal drawing is made of. The list is only
 * a TIE-BREAK order — candidates are sorted by how close they lie to the
 * caller's preferred direction, and this order decides between two that are
 * equally close.
 */
const COMPASS: readonly ScenePoint[] = Object.freeze([
  { x: 0, y: -1 },
  { x: SQRT_HALF, y: -SQRT_HALF },
  { x: 1, y: 0 },
  { x: SQRT_HALF, y: SQRT_HALF },
  { x: 0, y: 1 },
  { x: -SQRT_HALF, y: SQRT_HALF },
  { x: -1, y: 0 },
  { x: -SQRT_HALF, y: -SQRT_HALF },
]);

// cos and sin of 22.5°, from the half-angle identities: `Math.sqrt` is
// correctly rounded, so these are the same bits on every engine.
const COS_22_5 = Math.sqrt(2 + Math.SQRT2) / 2;
const SIN_22_5 = Math.sqrt(2 - Math.SQRT2) / 2;

/**
 * The close ladder's sixteen directions, clockwise from north (y-down). Twice
 * as many as `COMPASS` because the close ladder looks for the gap between two
 * bonds, and at a four-bond ring junction that gap is a narrow wedge whose
 * middle usually falls between two of eight compass points.
 */
const COMPASS_CLOSE: readonly ScenePoint[] = Object.freeze([
  { x: 0, y: -1 },
  { x: SIN_22_5, y: -COS_22_5 },
  { x: SQRT_HALF, y: -SQRT_HALF },
  { x: COS_22_5, y: -SIN_22_5 },
  { x: 1, y: 0 },
  { x: COS_22_5, y: SIN_22_5 },
  { x: SQRT_HALF, y: SQRT_HALF },
  { x: SIN_22_5, y: COS_22_5 },
  { x: 0, y: 1 },
  { x: -SIN_22_5, y: COS_22_5 },
  { x: -SQRT_HALF, y: SQRT_HALF },
  { x: -COS_22_5, y: SIN_22_5 },
  { x: -1, y: 0 },
  { x: -COS_22_5, y: -SIN_22_5 },
  { x: -SQRT_HALF, y: -SQRT_HALF },
  { x: -SIN_22_5, y: -COS_22_5 },
]);

/**
 * The ladder for ONE annotation against a fixed set of obstacles.
 *
 * Always returns a placement; `clear` says whether it found room.
 * `placeAnnotations` is the entry point that orders several and makes each an
 * obstacle for the next.
 */
export function placeAnnotation(
  request: AnnotationRequest,
  context: AnnotationContext,
): AnnotationPlacement {
  const { style } = context;
  const id = annotationId(request.kind, request.source);
  const fontSizePx = annotationFontSizePx(request.kind, style);
  const spans: readonly TextSpan[] = [{ text: request.text }];
  const measurer = measurerFor(style);
  // Measured CENTRED: every candidate below is the point the box is centred
  // on. `baselineYPx` converts it to the baseline origin a run is drawn at.
  const measured = measureTextRun(
    spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: "middle",
      baseline: "middle",
    },
    measurer,
  );
  // The ink box relative to the run centre, measured once. A run with no ink
  // at all (whitespace) falls back to its measured box, which contains it.
  const inkOffset: LabelBox =
    textRunInkRect(measured, ZERO, measurer, style.fontFamily) ?? textRunRect(measured, ZERO);

  const step = measured.capHeightPx * ANNOTATION_PLACEMENT.radiusStepCapHeights;
  const first = measured.capHeightPx * ANNOTATION_PLACEMENT.firstRadiusCapHeights;
  // Half the run's own width, so a wide annotation starts further out than a
  // narrow one instead of overlapping the thing it annotates.
  const reach = first + measured.advanceWidthPx / 2;

  const placed = context.placed ?? NO_BOXES;
  const atomCentres = context.atomCentres ?? NO_ATOMS;
  const circles = context.circles ?? NO_CIRCLES;
  const glyphInk = context.glyphInk ?? NO_BOXES;
  const at = (centre: ScenePoint): AnnotationPlacement => ({
    id,
    kind: request.kind,
    source: request.source,
    text: request.text,
    origin: onBaseline(centre, measured),
    fontSizePx,
    box: pad(textRunRect(measured, centre), ANNOTATION_PLACEMENT.clearancePx),
    inkBox: {
      minX: centre.x + inkOffset.minX,
      minY: centre.y + inkOffset.minY,
      maxX: centre.x + inkOffset.maxX,
      maxY: centre.y + inkOffset.maxY,
    },
    clear: true,
  });
  const centres = candidateOrigins(request, measured, reach, step);

  // Cheapest test first: proximity touches a few dozen points, the obstacle
  // test every glyph and line in the drawing.
  for (const centre of centres) {
    const candidate = at(centre);
    if (!readsAsOwn(boxCentre(candidate.inkBox), request, atomCentres)) continue;
    if (placed.some((box) => boxesOverlap(candidate.box, box))) continue;
    if (isClear(candidate.box, context.obstacles, context.segments, circles)) return candidate;
  }

  // Nothing is clear. Still placed (never dropped), at the LEAST WRONG
  // candidate — see `compareFallbacks` for what that means and why.
  let best: { readonly placement: AnnotationPlacement; readonly score: FallbackScore } | undefined;
  for (const centre of centres) {
    const placement = at(centre);
    // Counting hits walks every obstacle; a candidate already in a worse
    // class than the best so far cannot win on hits, so it is not counted.
    if (best !== undefined) {
      const rough = fallbackScore(placement, request, context, placed, atomCentres, circles, glyphInk);
      if (fallbackClass(rough) > fallbackClass(best.score)) continue;
    }
    const score = fallbackScore(placement, request, context, placed, atomCentres, circles, glyphInk, {
      countHits: true,
    });
    if (best === undefined || compareFallbacks(score, best.score) < 0) {
      best = { placement, score };
    }
  }
  // `best` is never undefined while the ladder is non-empty; spelled out
  // rather than asserted so the type stays honest.
  return { ...(best?.placement ?? at(request.anchor)), clear: false };
}

const ZERO: ScenePoint = Object.freeze({ x: 0, y: 0 });

/**
 * The alphabetic-baseline origin of a run measured as centred on `centre`
 * (decision 53).
 *
 * The run keeps exactly the box it was measured into: `textRunRect` of the
 * baseline origin, measured with `baseline: "alphabetic"`, adds the same
 * offset in the same order, so an annotation's obstacle box and the viewBox
 * cut around it are the measured box to the bit.
 */
function onBaseline(centre: ScenePoint, box: TextRunBox): ScenePoint {
  return { x: centre.x, y: centre.y + box.baselineYPx };
}

/**
 * Every candidate CENTRE for one request, in the order they are tried.
 *
 * TWO LADDERS, THE COARSE ONE FIRST.
 *
 * 1. The original ladder: eight compass directions at `radiusSteps` rungs
 *    starting a cap-height-and-a-bit plus half the run's width out. It is kept
 *    FIRST and unchanged, so every annotation it already placed clear — every
 *    descriptor in a committed golden — stays byte-identical.
 *
 * 2. The close ladder: sixteen directions, from the radius at which the box
 *    just stops covering its anchor, outward in `closeStepCapHeights` steps up
 *    to the coarse ladder's last rung, nearest step first. The coarse ladder's
 *    first rung sits a fixed number of cap heights out whatever the bond
 *    length. With a label font large against the bond (the ACS 1996 setting:
 *    a 16.7 px font on a 24 px bond) that rung lands on the NEIGHBOURING
 *    vertex, where decision 35 rightly refuses it, and every later rung is
 *    further out still. The room that reads as the atom's own is the few
 *    pixels between its bonds, and only a fine ladder that starts at the atom
 *    finds it. Nearest step first, because of two clear slots the one closer to
 *    its own atom is the one less likely to be read as another atom's.
 *
 * Every origin is `anchor + direction * radius`, the directions literals and
 * the radii built from style numbers and measured metrics, so the list is the
 * same bits for the same drawing however the molecule was built.
 */
function candidateOrigins(
  request: AnnotationRequest,
  measured: TextRunBox,
  reach: number,
  step: number,
): ScenePoint[] {
  const origins: ScenePoint[] = [];
  const along = (direction: ScenePoint, radius: number): ScenePoint => ({
    x: request.anchor.x + direction.x * radius,
    y: request.anchor.y + direction.y * radius,
  });

  const coarse = orderedDirections(request.preferred, COMPASS);
  for (let rung = 0; rung < ANNOTATION_PLACEMENT.radiusSteps; rung++) {
    const radius = reach + rung * step;
    for (const direction of coarse) origins.push(along(direction, radius));
  }

  const outermost = reach + (ANNOTATION_PLACEMENT.radiusSteps - 1) * step;
  const closeStep = measured.capHeightPx * ANNOTATION_PLACEMENT.closeStepCapHeights;
  if (!(closeStep > 0)) return origins;
  // Half the padded box: the radius along a direction at which the box's edge
  // reaches the anchor. Anything nearer covers the atom it annotates.
  const padding = 2 * ANNOTATION_PLACEMENT.clearancePx;
  const halfWidth = (measured.advanceWidthPx + padding) / 2;
  const halfHeight = (measured.ascentPx + measured.descentPx + padding) / 2;
  const close = orderedDirections(request.preferred, COMPASS_CLOSE).map((direction) => {
    const ax = direction.x < 0 ? -direction.x : direction.x;
    const ay = direction.y < 0 ? -direction.y : direction.y;
    const byX = ax > 0 ? halfWidth / ax : Number.POSITIVE_INFINITY;
    const byY = ay > 0 ? halfHeight / ay : Number.POSITIVE_INFINITY;
    return { direction, start: byX < byY ? byX : byY };
  });
  for (let k = 0; ; k++) {
    let any = false;
    for (const { direction, start } of close) {
      const radius = start + k * closeStep;
      if (radius > outermost) continue;
      any = true;
      origins.push(along(direction, radius));
    }
    if (!any) break;
  }
  return origins;
}

/** What makes an unclear candidate more or less wrong; see `compareFallbacks`. */
interface FallbackScore {
  /** Prints over an annotation already placed. */
  readonly overprints: boolean;
  /** Squared distance to its own anchor: the atom centre, or the bond segment. */
  readonly own: number;
  /** Squared distance to the nearest OTHER atom centre; +Infinity if none. */
  readonly nearestOther: number;
  /**
   * Glyph ink overprinted, px²: the overlap AREA of the annotation's ink box
   * with every glyph's and dot's ink box, unpadded, each glyph once
   * (decision 55). Area rather than a count, so a real overprint always
   * ranks worse than a near-miss that only reaches a label's clearance.
   */
  readonly glyphHits: number;
  /** Segments and circle outlines the box meets: text across a line. */
  readonly lineHits: number;
}

function fallbackScore(
  placement: AnnotationPlacement,
  request: AnnotationRequest,
  context: AnnotationContext,
  placed: readonly LabelBox[],
  atomCentres: readonly AnnotationAtomCentre[],
  circles: readonly AnnotationCircle[],
  glyphInk: readonly LabelBox[],
  { countHits }: { readonly countHits: boolean } = { countHits: false },
): FallbackScore {
  const { box, inkBox } = placement;
  // Proximity from the INK centre (decision 57), as in the clear search.
  const centre = boxCentre(inkBox);
  const ownAtomId = request.source.kind === "atom" ? request.source.atomId : undefined;
  let nearestOther = Number.POSITIVE_INFINITY;
  for (const atom of atomCentres) {
    if (atom.atomId === ownAtomId) continue;
    const d = squaredDistance(centre, atom.centre);
    if (d < nearestOther) nearestOther = d;
  }
  let glyphHits = 0;
  let lineHits = 0;
  if (countHits) {
    for (const glyph of glyphInk) glyphHits += overlapArea(inkBox, glyph);
    for (const segment of context.segments) if (boxMeetsInkedSegment(box, segment)) lineHits++;
    for (const circle of circles) if (boxMeetsCircleOutline(box, circle)) lineHits++;
  }
  return {
    overprints: placed.some((other) => boxesOverlap(box, other)),
    own: ownDistance(centre, request),
    nearestOther,
    glyphHits,
    lineHits,
  };
}

/** Rules 1 and 2 of `compareFallbacks` as one number, lower less wrong. */
function fallbackClass(score: FallbackScore): number {
  return (score.overprints ? 2 : 0) + (score.own < score.nearestOther ? 0 : 1);
}

/**
 * The order among candidates when NONE is clear (decision 45). Negative: `a`
 * is less wrong. Exactly these keys, in exactly this order, and nothing else:
 *
 * 1. NOT OVER AN ANNOTATION ALREADY PLACED. The annotation already there was
 *    placed clear, or was itself the least wrong; printing on it makes TWO
 *    unreadable, one of which did nothing wrong.
 * 2. READS AS ITS OWN ATOM'S (decision 35, heavy atoms only per decision 46).
 *    A number beside the wrong atom is a false statement; a number across a
 *    bond line is visibly crowded.
 * 3. LEAST GLYPH INK OVERPRINTED (decision 55): "(S)" over "OH" is
 *    unreadable. Measured as ink-on-ink area, so a candidate that only reaches
 *    a label's clearance padding beats one that prints on the glyph.
 * 4. FEWEST LINE HITS: "(S)" across a bond line is crowded but legible.
 * 5. Ladder order, which the caller keeps by replacing only on "less wrong".
 *
 * An earlier version broke a hit tie by how CLEARLY a candidate was its own
 * (the own-to-nearest-other distance ratio). The ruling has no such key, and
 * a geometric tiebreak on floats is what decision 36 declined elsewhere.
 */
function compareFallbacks(a: FallbackScore, b: FallbackScore): number {
  return (
    fallbackClass(a) - fallbackClass(b) ||
    a.glyphHits - b.glyphHits ||
    a.lineHits - b.lineHits
  );
}

const NO_CIRCLES: readonly AnnotationCircle[] = Object.freeze([]);
const NO_ATOMS: readonly AnnotationAtomCentre[] = Object.freeze([]);
const NO_BOXES: readonly LabelBox[] = Object.freeze([]);

/**
 * Decision 35: is `centre` — the annotation's INK-box centre (decision 57) —
 * STRICTLY nearer the request's own anchor than every other atom centre?
 *
 * Strict, so a tie — a slot exactly between two atoms, or past the end of a
 * bond where its atom is as near as the bond is — reads as ambiguous and is
 * not taken. Squared distances throughout: no square root, so no rounding
 * between two comparisons of the same pair.
 */
function readsAsOwn(
  centre: ScenePoint,
  request: AnnotationRequest,
  atomCentres: readonly AnnotationAtomCentre[],
): boolean {
  if (atomCentres.length === 0) return true;
  const own = ownDistance(centre, request);
  const ownAtomId = request.source.kind === "atom" ? request.source.atomId : undefined;
  for (const atom of atomCentres) {
    if (atom.atomId === ownAtomId) continue;
    if (!(own < squaredDistance(centre, atom.centre))) return false;
  }
  return true;
}

function boxCentre(box: LabelBox): ScenePoint {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Squared distance to the request's own anchor: its segment if it has one. */
function ownDistance(centre: ScenePoint, request: AnnotationRequest): number {
  return request.anchorSegment === undefined
    ? squaredDistance(centre, request.anchor)
    : squaredDistanceToSegment(centre, request.anchorSegment);
}

function squaredDistance(p: ScenePoint, q: ScenePoint): number {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return dx * dx + dy * dy;
}

function squaredDistanceToSegment(p: ScenePoint, segment: AnnotationSegment): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return squaredDistance(p, segment.a);
  const t = ((p.x - segment.a.x) * dx + (p.y - segment.a.y) * dy) / lengthSquared;
  const clamped = clamp(t, 0, 1);
  return squaredDistance(p, { x: segment.a.x + dx * clamped, y: segment.a.y + dy * clamped });
}

/**
 * The compass directions sorted by how close they lie to `preferred`, ties
 * going to whichever comes first in `COMPASS`.
 *
 * Closeness is the dot product, which for unit vectors is the cosine of the
 * angle — no inverse trig, and monotone in exactly the right direction. It is
 * compared QUANTISED (`directionQuantum`) and the sort is stable, so the
 * `COMPASS` order is the tie-break and no last-bit float difference decides
 * between two equally close candidates.
 */
function orderedDirections(
  preferred: ScenePoint,
  compass: readonly ScenePoint[],
): readonly ScenePoint[] {
  const length = Math.sqrt(preferred.x * preferred.x + preferred.y * preferred.y);
  if (!(length > 0)) return compass;
  const unit: ScenePoint = { x: preferred.x / length, y: preferred.y / length };
  const quantum = ANNOTATION_PLACEMENT.directionQuantum;
  const closeness = (d: ScenePoint): number =>
    Math.round((d.x * unit.x + d.y * unit.y) * quantum);
  return [...compass].sort((a, b) => closeness(b) - closeness(a));
}

function pad(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  padding: number,
): LabelBox {
  return {
    minX: rect.minX - padding,
    minY: rect.minY - padding,
    maxX: rect.maxX + padding,
    maxY: rect.maxY + padding,
  };
}

function isClear(
  box: LabelBox,
  obstacles: readonly LabelObstacle[],
  segments: readonly AnnotationSegment[],
  circles: readonly AnnotationCircle[],
): boolean {
  for (const obstacle of obstacles) {
    if (boxMeetsObstacle(box, obstacle)) return false;
  }
  for (const segment of segments) {
    if (boxMeetsInkedSegment(box, segment)) return false;
  }
  for (const circle of circles) {
    if (boxMeetsCircleOutline(box, circle)) return false;
  }
  return true;
}

/**
 * The box against the segment grown by the stroke's half width: the box meets
 * the ink, not the hairline down its middle.
 */
function boxMeetsInkedSegment(box: LabelBox, segment: AnnotationSegment): boolean {
  const inked =
    segment.halfWidth === undefined || segment.halfWidth === 0 ? box : pad(box, segment.halfWidth);
  return boxMeetsSegment(inked, segment.a, segment.b);
}

function boxMeetsObstacle(box: LabelBox, obstacle: LabelObstacle): boolean {
  if (obstacle.kind === "rect") return boxesOverlap(box, obstacle.box);
  // Closest point on the box to the disc's centre, which is the exact
  // box-versus-circle test and cheaper than it looks.
  const x = clamp(obstacle.centre.x, box.minX, box.maxX);
  const y = clamp(obstacle.centre.y, box.minY, box.maxY);
  const dx = obstacle.centre.x - x;
  const dy = obstacle.centre.y - y;
  return dx * dx + dy * dy < obstacle.radius * obstacle.radius;
}

/** The area two boxes share, px²; 0 when they only touch or are apart. */
function overlapArea(a: LabelBox, b: LabelBox): number {
  const w = (a.maxX < b.maxX ? a.maxX : b.maxX) - (a.minX > b.minX ? a.minX : b.minX);
  if (!(w > 0)) return 0;
  const h = (a.maxY < b.maxY ? a.maxY : b.maxY) - (a.minY > b.minY ? a.minY : b.minY);
  if (!(h > 0)) return 0;
  return w * h;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Does the box touch the stroke: its nearest point inside the outer edge AND
 * its farthest corner outside the inner edge. A box wholly inside the ring and
 * clear of the stroke is clear.
 */
function boxMeetsCircleOutline(box: LabelBox, circle: AnnotationCircle): boolean {
  const { centre } = circle;
  const nearX = clamp(centre.x, box.minX, box.maxX) - centre.x;
  const nearY = clamp(centre.y, box.minY, box.maxY) - centre.y;
  const outer = circle.radius + circle.halfWidth;
  if (nearX * nearX + nearY * nearY > outer * outer) return false;
  const farX = Math.max(centre.x - box.minX, box.maxX - centre.x);
  const farY = Math.max(centre.y - box.minY, box.maxY - centre.y);
  const inner = circle.radius - circle.halfWidth;
  return inner <= 0 || farX * farX + farY * farY >= inner * inner;
}

/**
 * Does the segment meet the box: the Liang-Barsky slab clip, plus the
 * both-endpoints-inside case the slab test alone would still catch.
 *
 * Exact rather than the sampled approximation `detectCollisions` uses. That
 * one ranks a warning list and only has to be roughly proportional; this one
 * decides where a glyph goes, and a sample that fell between two bond lines
 * would put the annotation on top of one.
 */
function boxMeetsSegment(box: LabelBox, a: ScenePoint, b: ScenePoint): boolean {
  let entry = 0;
  let exit = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > exit) return false;
      if (r > entry) entry = r;
    } else {
      if (r < entry) return false;
      if (r < exit) exit = r;
    }
    return true;
  };

  if (!clip(-dx, a.x - box.minX)) return false;
  if (!clip(dx, box.maxX - a.x)) return false;
  if (!clip(-dy, a.y - box.minY)) return false;
  if (!clip(dy, box.maxY - a.y)) return false;
  return entry <= exit;
}
