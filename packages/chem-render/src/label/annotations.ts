/**
 * Where every small annotation goes: stereo descriptors, enhanced-stereo group
 * tags, the rac-/rel- prefix, a transition state's delta+/delta- labels,
 * alpha/beta labels, locants and torsion labels — ONE pass, ONE search.
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
 * descriptor > stereoGroup > stereoPrefix > partialCharge > alphaBeta >
 * locant > torsion. The
 * requests are SORTED by that
 * table before anything is placed, so the higher-priority annotation claims
 * its slot first and the loser takes its next candidate — whatever order the
 * caller listed them in.
 *
 * THE THREE STEREO KINDS SIT IN ONE BAND, which is what decisions 40 and 88
 * mean by "at descriptor priority": all three outrank every other kind, and
 * inside the band the letter wins. An `(R)` displaced by the `and1` beside it
 * would be the wrong trade — the letter is the configuration and the tag is
 * which collection states it — and two kinds sharing one table index would
 * leave the choice between them to `compareAnnotationRequests`'s text
 * tiebreak, which is to say to the alphabet. The band order is therefore
 * explicit. Within one kind, ties break by source id in
 * chem-core's `compareIds` order (`a9` before `a10`), never by iteration
 * order. Descriptors already ship in committed goldens; putting them first
 * means switching locants on can never move one.
 *
 * THE SEARCH IS A FIXED LADDER, NOT AN OPTIMISATION. A fixed list of
 * candidates — sixteen directions stepping outward from just under half a
 * bond out (decision 67), then eight compass directions at a few coarser
 * radii (`candidateOrigins` says why both) — and the first candidate that
 * clears everything wins. The caller's
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
 * centre of its measured INK box (decision 57) must lie at most
 * `ownDistanceRatio` of the way (decision 63) to the nearest other heavy atom
 * from its own anchor — the atom centre, or
 * for a bond annotation the bond segment — than any other atom centre.
 *
 * "OWN" HAS THREE CASES, and decision 88 added the third. An atom
 * annotation's own is its atom; a bond annotation's own is the drawn bond
 * segment, and its two end atoms never compete (decision 68); the rac-/rel-
 * prefix's own is THE WHOLE STRUCTURE — `anchorBox`, the drawing's ink
 * bounding box — and no atom competes with it, because there is only one
 * structure on the page for it to be read as belonging to. Proximity
 * therefore never refuses a prefix slot; the obstacles still do, which is what
 * keeps it off the ink it is set above. Room
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
 * is, then reading as its own atom's, then, among those, one that will be
 * drawn rather than dropped (decision 188), then the least glyph ink
 * overprinted (decision 55), then the fewest line hits, then ladder order. An
 * unclear annotation reads as another atom's only when not one candidate
 * reads as its own (two atoms on one spot).
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
import { pxPerModelUnit } from "../style.js";
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

export type AnnotationKind =
  | "descriptor"
  /** Decision 40's per-centre enhanced-stereo tag: `abs`, `and1`, `or1`. */
  | "stereoGroup"
  /** Decision 88's `rac-` / `rel-`, above the whole structure's ink. */
  | "stereoPrefix"
  /**
   * A STORED delta+ or delta- on a transition-state atom (decision 205): the
   * one kind here the author drew rather than the renderer derived. Below the
   * stereo band, so it can never move a configuration statement; above every
   * derived kind, because the author asked for it.
   */
  | "partialCharge"
  | "alphaBeta"
  | "locant"
  | "torsion";

/**
 * Decision 17: the index IS the priority, highest first.
 *
 * `as const satisfies` catches a kind removed from the union; the `IsTotal`
 * guard below catches one added to it without a row here — which would
 * otherwise sort at index -1, AHEAD of the descriptors.
 */
export const ANNOTATION_PRIORITY = [
  "descriptor",
  // The stereo band, below the letter and above everything else: see the
  // module header for why the three do not share one index.
  "stereoGroup",
  "stereoPrefix",
  // Decision 205: after the stereo band, before alpha/beta.
  "partialCharge",
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
   * Where the NEAR ladder starts, as a fraction of a bond (decision 67).
   *
   * The search begins here, in the gaps between the atom's own bonds, and
   * steps outward. Beginning at the coarse ladder's first rung instead — a
   * label cap height and a bit, which on the Publication bond is already
   * further from the atom than its neighbours are — left decision 63's margin
   * unsatisfiable: a slot that far out is about as near the next atom as its
   * own, so at 8 pt NO descriptor on butan-2-ol or the steroid was clear.
   * 0.45 of a bond is 10.8 px at Publication and 19.8 px at Screen: outside a
   * one- or two-letter label, inside the ring the atom belongs to, and at
   * most 0.45/0.55 of the way to the nearest neighbour, which clears the
   * margin with room to spare.
   */
  nearStartBondFraction: 0.45,
  /**
   * The first radius of the COARSE ladder, as a multiple of the ATOM LABEL's
   * cap height at the style (decision 59), plus half the annotation's own
   * width.
   *
   * Every radius of both ladders is sized from the label, never from the
   * annotation: the room around an atom is set by its label and its bonds,
   * and a search that shrank with the annotation would stop short of room
   * that is there — a smaller run would report MORE, not fewer. Measured from
   * the anchor to the CENTRE of the annotation's box. 1.4 puts a two-glyph
   * run just outside a bare vertex and just outside a one-letter atom label;
   * the ladder handles everything wider.
   */
  firstRadiusCapHeights: 1.4,
  /** How much further out each rung of the ladder reaches, in label cap heights. */
  radiusStepCapHeights: 0.55,
  /** Rungs of the coarse ladder. The close ladder stops at the last one. */
  radiusSteps: 5,
  /**
   * The near ladder's step, as a multiple of the atom label's cap height
   * (decision 59): between 2 and 3 px at the shipped presets. Fine enough to find the gap
   * between two bonds at a vertex whose clear room is only a few pixels deep;
   * see `candidateOrigins`.
   */
  closeStepCapHeights: 0.2,
  /** Extra clear space demanded around the annotation's measured box, px. */
  clearancePx: 1,
  /**
   * Decision 63: how near another heavy atom a slot may be and still read as
   * its own atom's, as a fraction of its distance to its own anchor.
   *
   * A strict inequality (what decision 35 was implemented as) passes a slot
   * that is 0.01 px nearer its own atom than a neighbour — the steroid's C10
   * (S) sat in the middle of ring A and "read as its own" by a hair. A
   * reader has no such precision: the annotation has to be VISIBLY nearer,
   * and 0.85 is the margin ruled for it.
   */
  ownDistanceRatio: 0.85,
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
  | { readonly kind: "bond"; readonly bondId: BondId }
  /**
   * The whole drawing, for decision 88's prefix. It belongs to no atom and no
   * bond: a `rac-` above a structure is a statement about every centre in it
   * at once, and filing it under the topmost atom would make that atom's pick
   * target swell to enclose it — the same trap the phantom hydrogen's own
   * `SceneSource` arm exists to avoid.
   */
  | { readonly kind: "structure" };

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
   * For a bond annotation, the bond as drawn: proximity (decisions 35 and 68)
   * is measured to this segment rather than to `anchor`. An annotation beside
   * the middle of a long bond is the bond's even when the midpoint is further
   * from it than one of the bond's own atoms is.
   */
  readonly anchorSegment?: AnnotationSegment;
  /**
   * The atoms at the ends of the annotated bond (decision 68). They are never
   * competitors: an "(E)" beside its own double bond is nearest that bond's
   * own carbons by construction, and counting them as rivals is what pushed
   * every E/Z descriptor off the space above its bond.
   */
  readonly ownAtomIds?: readonly AtomId[];
  /**
   * For a STRUCTURE annotation, the drawing's own ink bounding box
   * (`structureInkBounds`): proximity (decision 88's third own case) is
   * measured to this rectangle rather than to `anchor`.
   *
   * Optional for the same reason `ownAtomIds` is — the field follows the
   * source kind and the precedent is decision 68's — and a structure request
   * that omits it is judged from its anchor point, which is the top of that
   * very box. It is never set on an atom or bond request; if it were, it would
   * take precedence over `anchorSegment`.
   */
  readonly anchorBox?: LabelBox;
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
 * A bond as drawn, for decision 68: a BOND annotation competes against the
 * other BONDS as well as the atoms, because "(Z)" beside a double bond is
 * read as that bond's, and the thing that takes it away is another bond.
 */
export interface AnnotationBondSegment {
  readonly bondId: BondId;
  readonly a: ScenePoint;
  readonly b: ScenePoint;
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
   * The INK box of every label glyph and electron dot the drawing set,
   * UNPADDED, one entry per glyph: what a fallback's glyph hit is measured
   * against (decision 55), and what a reported annotation must not print on
   * to be drawn at all (decisions 58 and 64). Filled shapes — a solid wedge
   * above all — are ink like a glyph (decision 65); a hashed wedge and every
   * plain line stay lines. Decision 65 is tested through this list (the
   * wedge's slices are in it, a hash's are not) and through a sweep that no
   * drawn annotation comes within the clearance of any filled shape, rather
   * than through one fixture that drops because of a wedge: no fixture does
   * any more, and contriving one would test the ranking, not the rule. Bare-vertex dots are not in it
   * (decision 61; they stay in `obstacles`): they
   * mark where bond lines meet, and an annotation crossing them is crowded
   * the way one crossing a line is, not text printed on text.
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
   * Every bond as drawn. Only a BOND annotation is judged against these
   * (decision 68), and never against its own; omitted, only atoms compete.
   */
  readonly bondSegments?: readonly AnnotationBondSegment[];
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
  /**
   * False for a REPORTED placement whose ink would print on a glyph's ink, or
   * within the clearance of it (decisions 58 and 64): it is not drawn, and it
   * blocks nothing. Always true for a clear one, and for a reported one that
   * only crosses bond lines.
   */
  readonly drawn: boolean;
}

/** Why an annotation is in `AnnotationLayout.unplaced`. */
export type UnplacedReason =
  /** No clear slot; drawn at the least wrong one (decision 45). */
  | "crowded"
  /**
   * No clear slot, and the least wrong one lands on text or within the
   * clearance of it: not drawn (decisions 58 and 64).
   */
  | "printsOnText";

/** An annotation that could not be placed clear, and where it went instead. */
export interface UnplacedAnnotation {
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly source: AnnotationSource;
  readonly text: string;
  readonly box: LabelBox;
  /** True when it is left out of the drawing (decision 58). */
  readonly dropped: boolean;
  readonly reason: UnplacedReason;
}

export interface AnnotationLayout {
  /**
   * In placement order — priority, then source id. Emission follows it, and
   * skips the ones with `drawn: false`.
   */
  readonly placements: readonly AnnotationPlacement[];
  /** The placements that are NOT clear, in the same order. */
  readonly unplaced: readonly UnplacedAnnotation[];
}

export const EMPTY_ANNOTATION_LAYOUT: AnnotationLayout = Object.freeze({
  placements: Object.freeze([]),
  unplaced: Object.freeze([]),
});

/**
 * `atom:a2:descriptor`, `atom:a2:locant`, `atom:a2:stereoGroup`,
 * `bond:b3:torsion`, `structure:stereoPrefix`.
 *
 * Derived from the kind and the source, never from a counter, so one
 * annotation keeps its id across an edit elsewhere in the molecule. The
 * descriptor spelling is the one the committed goldens already carry.
 *
 * The structure's id carries no middle field because there is nothing to name:
 * one drawing, one prefix. `structure:` rather than a bare `stereoPrefix`
 * keeps every annotation id three-part-or-two-part on the same `source:kind`
 * shape, which is what `figure.ts` matches on with `endsWith(":" + kind)`.
 */
export function annotationId(kind: AnnotationKind, source: AnnotationSource): string {
  switch (source.kind) {
    case "atom":
      return `atom:${source.atomId}:${kind}`;
    case "bond":
      return `bond:${source.bondId}:${kind}`;
    case "structure":
      return `structure:${kind}`;
  }
}

/** A filled disc of ink: a bare-vertex dot (decision 61). */
export interface AnnotationDisc {
  readonly centre: ScenePoint;
  readonly radius: number;
}

/**
 * The drawing's own ink, for decision 88's anchor box — EVERY field unpadded.
 *
 * Deliberately not `AnnotationContext`, although the caller has one: the
 * `obstacles` list is clearance boxes, and a label's disc there is already
 * grown by `labelPaddingPx`, so an ink box unioned out of it would sit a
 * padding wider than the ink on every side and the prefix would float. The
 * caller hands over the measured ink instead, which is the same set the
 * proximity and drop rules are judged on (decisions 55, 57 and 64).
 */
export interface StructureInk {
  /** Measured glyph, electron-dot and filled-shape ink (decision 65). */
  readonly glyphInk?: readonly LabelBox[];
  /** Every stroked line as drawn, inked at its own half width. */
  readonly segments?: readonly AnnotationSegment[];
  /** Aromatic circles, at their outer edge. */
  readonly circles?: readonly AnnotationCircle[];
  /**
   * Filled dots that are NOT in `glyphInk`: the bare-vertex dot, which decision
   * 61 keeps out of the ink set for the drop rule but which is ink a figure's
   * prefix has to clear all the same.
   */
  readonly dots?: readonly AnnotationDisc[];
}

/**
 * The bounding box of everything the STRUCTURE drew, or undefined when it drew
 * nothing measurable.
 *
 * Decision 88's anchor. Annotations are not in it, deliberately: the box is
 * what the prefix is a statement ABOUT, and growing it to include the tags and
 * letters already placed would move the prefix every time one of them found a
 * different slot. Their boxes are obstacles instead, through `context.placed`,
 * so the prefix still steps around them.
 */
export function structureInkBounds(ink: StructureInk): LabelBox | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };
  for (const box of ink.glyphInk ?? NO_BOXES) add(box.minX, box.minY, box.maxX, box.maxY);
  for (const segment of ink.segments ?? NO_SEGMENTS) {
    const half = segment.halfWidth ?? 0;
    const { a, b } = segment;
    add(
      (a.x < b.x ? a.x : b.x) - half,
      (a.y < b.y ? a.y : b.y) - half,
      (a.x > b.x ? a.x : b.x) + half,
      (a.y > b.y ? a.y : b.y) + half,
    );
  }
  for (const circle of ink.circles ?? NO_CIRCLES) {
    const reach = circle.radius + circle.halfWidth;
    add(
      circle.centre.x - reach,
      circle.centre.y - reach,
      circle.centre.x + reach,
      circle.centre.y + reach,
    );
  }
  for (const dot of ink.dots ?? NO_DISCS) {
    add(
      dot.centre.x - dot.radius,
      dot.centre.y - dot.radius,
      dot.centre.x + dot.radius,
      dot.centre.y + dot.radius,
    );
  }
  if (!(minX <= maxX && minY <= maxY)) return undefined;
  return { minX, minY, maxX, maxY };
}

/**
 * Decision 88's request: the `rac-` / `rel-` prefix, above the structure's ink.
 *
 * ABOVE AND OFFSET, through the one ladder rather than a second rule. The
 * anchor sits on the TOP EDGE of the ink box, at its horizontal middle, and the
 * preferred direction is north — so the near ladder's first rung, which starts
 * `nearStartBondFraction` of a bond from the anchor or at the radius where the
 * run's own box stops covering it, whichever is further, is exactly the offset
 * from the ink. Nothing here knows a font size or a bond length; the ladder
 * owns both, which is what keeps the prefix's offset the same measure as every
 * other annotation's.
 *
 * A structure request and only a structure request carries `anchorBox`, so the
 * prefix is judged against the whole drawing (decision 88's third own case).
 */
export function structurePrefixRequest(text: string, ink: LabelBox): AnnotationRequest {
  return {
    kind: "stereoPrefix",
    source: { kind: "structure" },
    text,
    anchor: { x: (ink.minX + ink.maxX) / 2, y: ink.minY },
    preferred: { x: 0, y: -1 },
    anchorBox: ink,
  };
}

/**
 * Size of an annotation's run, px.
 *
 * ONE EXCEPTION, and it is the whole reason this function takes a kind: the
 * per-centre `stereoGroup` tag is set at `stereoGroupTagScale` (decision 123),
 * smaller than everything else. Every other kind shares the descriptor's scale,
 * because they are all small print set beside a structure and a figure mixing
 * annotation sizes reads as annotations making different kinds of claim.
 *
 * The tag earned the exception by being the one kind that is drawn beside an
 * annotation of HIGHER priority on the SAME atom — it loses every contested slot
 * to its centre's own `(R)`/`(S)` — so at Publication it was placed in what was
 * left over and, measured, almost never drawn. `style.ts` records the
 * measurement. The two scales still come from one place, here, so a third size
 * cannot appear anywhere else.
 */
export function annotationFontSizePx(kind: AnnotationKind, style: RenderStyle): number {
  if (kind === "stereoGroup") return style.fontSizePx * style.stereoGroupTagScale;
  return style.fontSizePx * style.stereoDescriptorScale;
}

/**
 * The id the same-kind tiebreak sorts on. The structure has none — there is
 * only ever one of it — and the empty string is what `compareIds` orders it
 * by, which is stable and puts it first among anything of its own kind.
 */
function sourceId(source: AnnotationSource): string {
  switch (source.kind) {
    case "atom":
      return source.atomId;
    case "bond":
      return source.bondId;
    case "structure":
      return "";
  }
}

/**
 * The placement order: decision 17's priority table, then source id by
 * `compareIds`, then source kind, then text.
 *
 * A TOTAL order over everything that distinguishes two requests, so the
 * sorted list — and with it every placement — does not depend on the order
 * the requests arrived in.
 */
/**
 * A total, fixed order over the source kinds, for the tiebreak below.
 *
 * A `Record` rather than a conditional, so a fourth source kind is a compile
 * error here instead of a silent tie that makes the sort depend on arrival
 * order. Atom first is the order the pass already had.
 */
const SOURCE_KIND_RANK: Record<AnnotationSource["kind"], number> = {
  atom: 0,
  bond: 1,
  structure: 2,
};

export function compareAnnotationRequests(
  a: AnnotationRequest,
  b: AnnotationRequest,
): number {
  const priority =
    ANNOTATION_PRIORITY.indexOf(a.kind) - ANNOTATION_PRIORITY.indexOf(b.kind);
  if (priority !== 0) return priority;
  const byId = compareIds(sourceId(a.source), sourceId(b.source));
  if (byId !== 0) return byId;
  if (a.source.kind !== b.source.kind) {
    return SOURCE_KIND_RANK[a.source.kind] - SOURCE_KIND_RANK[b.source.kind];
  }
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
  const glyphInk = context.glyphInk ?? NO_BOXES;
  const local: AnnotationContext = { ...context, placed: placedBoxes };
  const placements: AnnotationPlacement[] = [];
  const unplaced: UnplacedAnnotation[] = [];
  const seen = new Set<string>();

  for (const request of sorted) {
    const id = annotationId(request.kind, request.source);
    if (seen.has(id)) throw new Error(`Two annotation requests share the id ${id}`);
    seen.add(id);

    const found = placeAnnotation(request, local);
    // Decision 58, with decision 64's clearance: a reported annotation whose
    // ink lands on a glyph's ink, or within `clearancePx` of it, is not drawn
    // — "(S)" over "OH" makes both unreadable, and "13" a half pixel from a
    // "C" reads as 13-C. The report says what is missing. One that only
    // crosses a bond line is crowded but legible, and still drawn.
    const dropped = !found.clear && printsOnText(found.inkBox, glyphInk);
    const placed: AnnotationPlacement = dropped ? { ...found, drawn: false } : found;
    // Every DRAWN annotation blocks the next one, the unclear ones included:
    // an overlap already reported must not be compounded by a second. A
    // dropped one is not on the page, so it blocks nothing.
    if (placed.drawn) placedBoxes.push(placed.box);
    placements.push(placed);
    if (!placed.clear) {
      unplaced.push({
        id: placed.id,
        kind: placed.kind,
        source: placed.source,
        text: placed.text,
        box: placed.box,
        dropped,
        reason: dropped ? "printsOnText" : "crowded",
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
      fontWeight: style.fontWeight,
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
    textRunInkRect(measured, ZERO, measurer, style.fontFamily, style.fontWeight) ?? textRunRect(measured, ZERO);

  // Decision 59: every radius from the ATOM LABEL's cap height at this style,
  // so shrinking the annotation cannot shrink the search.
  const labelCapPx = measurer.verticalMetrics({
    family: style.fontFamily,
    weight: style.fontWeight,
    sizePx: style.fontSizePx,
  }).capHeightPx;
  const step = labelCapPx * ANNOTATION_PLACEMENT.radiusStepCapHeights;
  const first = labelCapPx * ANNOTATION_PLACEMENT.firstRadiusCapHeights;
  const nearStep = labelCapPx * ANNOTATION_PLACEMENT.closeStepCapHeights;
  // Decision 67: the near ladder starts a fraction of a BOND out, through
  // `pxPerModelUnit` — the one sanctioned way to ask how long a bond is in px.
  const nearStart = pxPerModelUnit(style) * ANNOTATION_PLACEMENT.nearStartBondFraction;
  // Half the run's own width, so a wide annotation starts further out than a
  // narrow one instead of overlapping the thing it annotates.
  const reach = first + measured.advanceWidthPx / 2;

  const placed = context.placed ?? NO_BOXES;
  const atomCentres = context.atomCentres ?? NO_ATOMS;
  const circles = context.circles ?? NO_CIRCLES;
  const glyphInk = context.glyphInk ?? NO_BOXES;
  const bondSegments = context.bondSegments ?? NO_BONDS;
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
    drawn: true,
  });
  const centres = candidateOrigins(request, measured, reach, step, nearStart, nearStep);

  // Cheapest test first: proximity touches a few dozen points, the obstacle
  // test every glyph and line in the drawing.
  for (const centre of centres) {
    const candidate = at(centre);
    if (!readsAsOwn(boxCentre(candidate.inkBox), request, atomCentres, bondSegments)) continue;
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
      const rough = fallbackScore(placement, request, context, placed, atomCentres, circles, glyphInk, bondSegments);
      if (fallbackClass(rough) > fallbackClass(best.score)) continue;
    }
    const score = fallbackScore(placement, request, context, placed, atomCentres, circles, glyphInk, bondSegments, {
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
 * NEAR FIRST, THEN OUTWARD (decision 67).
 *
 * 1. The near ladder: sixteen directions, starting `nearStartBondFraction` of
 *    a bond from the anchor — or at the radius where the box stops covering
 *    the anchor, whichever is further — and stepping out in
 *    `closeStepCapHeights` label cap heights, nearest step first, up to the
 *    coarse ladder's last rung. The room that reads as the atom's OWN is the
 *    space between its own bonds, and only a ladder that starts there finds
 *    it. Sixteen rather than eight directions because at a four-bond ring
 *    junction that gap is a narrow wedge whose middle usually falls between
 *    two of eight compass points.
 *
 * 2. The coarse ladder: eight compass directions at `radiusSteps` rungs from
 *    a label cap height and a bit plus half the run's width out. It used to
 *    run first, and that was the bug decision 67 fixes: its first rung sits a
 *    fixed number of cap heights from the anchor whatever the bond length —
 *    about 27 px on Publication's 24 px bond — so a slot on it is roughly as
 *    far from the next atom as from its own, and decision 63's margin refuses
 *    every one of them. Kept as the outer fallback.
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
  nearStart: number,
  nearStep: number,
): ScenePoint[] {
  const origins: ScenePoint[] = [];
  const along = (direction: ScenePoint, radius: number): ScenePoint => ({
    x: request.anchor.x + direction.x * radius,
    y: request.anchor.y + direction.y * radius,
  });
  const outermost = reach + (ANNOTATION_PLACEMENT.radiusSteps - 1) * step;

  // THE NEAR LADDER, FIRST (decision 67). Sixteen directions, from
  // `nearStart` outward in `nearStep` steps, nearest step first.
  if (nearStep > 0) {
    // Half the padded box: the radius along a direction at which the box's
    // edge reaches the anchor. Nearer than that it covers its own atom, so
    // `nearStart` is held to at least this even on a short bond.
    const padding = 2 * ANNOTATION_PLACEMENT.clearancePx;
    const halfWidth = (measured.advanceWidthPx + padding) / 2;
    const halfHeight = (measured.ascentPx + measured.descentPx + padding) / 2;
    const near = orderedDirections(request.preferred, COMPASS_CLOSE).map((direction) => {
      const ax = direction.x < 0 ? -direction.x : direction.x;
      const ay = direction.y < 0 ? -direction.y : direction.y;
      const byX = ax > 0 ? halfWidth / ax : Number.POSITIVE_INFINITY;
      const byY = ay > 0 ? halfHeight / ay : Number.POSITIVE_INFINITY;
      const clears = byX < byY ? byX : byY;
      return { direction, start: clears > nearStart ? clears : nearStart };
    });
    for (let k = 0; ; k++) {
      let any = false;
      for (const { direction, start } of near) {
        const radius = start + k * nearStep;
        if (radius > outermost) continue;
        any = true;
        origins.push(along(direction, radius));
      }
      if (!any) break;
    }
  }

  // THE COARSE LADDER, AFTER IT: eight directions at `radiusSteps` rungs from
  // a label cap height and a bit plus half the run's width out. Its rungs are
  // inside the near ladder's range, so it mostly repeats candidates already
  // tried — but not on a direction the near ladder's sixteen do not share,
  // and it is what an annotation with no room near its atom falls back to.
  const coarse = orderedDirections(request.preferred, COMPASS);
  for (let rung = 0; rung < ANNOTATION_PLACEMENT.radiusSteps; rung++) {
    const radius = reach + rung * step;
    for (const direction of coarse) origins.push(along(direction, radius));
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
   * Would `placeAnnotations` drop it: is its ink within the clearance of any
   * glyph's ink (decisions 58 and 64)? The same test, so the slot the
   * fallback prefers is never one the drop then throws away (decision 188).
   */
  readonly printsOnText: boolean;
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
  bondSegments: readonly AnnotationBondSegment[],
  { countHits }: { readonly countHits: boolean } = { countHits: false },
): FallbackScore {
  const { box, inkBox } = placement;
  // Proximity from the INK centre (decision 57), as in the clear search.
  const centre = boxCentre(inkBox);
  let nearestOther = Number.POSITIVE_INFINITY;
  for (const atom of atomCentres) {
    if (isOwnAtom(request, atom.atomId)) continue;
    const d = squaredDistance(centre, atom.centre);
    if (d < nearestOther) nearestOther = d;
  }
  // Decision 68, as in the clear search: other bonds compete for a bond
  // annotation, its own never does.
  if (request.source.kind === "bond") {
    for (const bond of bondSegments) {
      if (bond.bondId === request.source.bondId) continue;
      const d = squaredDistanceToSegment(centre, bond);
      if (d < nearestOther) nearestOther = d;
    }
  }
  let onText = false;
  let glyphHits = 0;
  let lineHits = 0;
  if (countHits) {
    onText = printsOnText(inkBox, glyphInk);
    for (const glyph of glyphInk) glyphHits += overlapArea(inkBox, glyph);
    for (const segment of context.segments) if (boxMeetsInkedSegment(box, segment)) lineHits++;
    for (const circle of circles) if (boxMeetsCircleOutline(box, circle)) lineHits++;
  }
  return {
    overprints: placed.some((other) => boxesOverlap(box, other)),
    own: ownDistance(centre, request),
    nearestOther,
    printsOnText: onText,
    glyphHits,
    lineHits,
  };
}

/** Rules 1 and 2 of `compareFallbacks` as one number, lower less wrong. */
function fallbackClass(score: FallbackScore): number {
  // The same margin the clear search applies (decision 63), so a fallback
  // cannot count as "reads as its own" on a tie the search refused.
  return (score.overprints ? 2 : 0) + (readsAsOwnAt(score.own, score.nearestOther) ? 0 : 1);
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
 * 3. WOULD BE DRAWN, among candidates that pass rules 1 and 2 (decision
 *    188): not within the clearance of any glyph's ink, which is exactly
 *    what `placeAnnotations` drops (decisions 58 and 64). Ranked on ink AREA
 *    alone, a slot 0.8 px from a "C" overlaps nothing, beats a slot that
 *    only crosses a bond on line hits, and is then dropped: the fallback
 *    chose the one candidate the drop refuses, and the steroid's Lewis
 *    C17 (S) went missing that way.
 *    ONLY THERE, because drawing is a gain only for a candidate that reads as
 *    its own and prints over no annotation. Past rule 1 or 2 the drawing IS
 *    the wrong — a number beside the wrong atom, or on another annotation —
 *    and reaching for a drawable slot puts it on the page. Measured with the
 *    key applied in every class, over the set decision 35's independent
 *    test walks, 20 placements (9 at Publication) that had been dropped were
 *    drawn beside another atom instead: the steroid's "13" beside its OH,
 *    both of unmergedDropOverlap's locants. Scoped, 1 is.
 * 4. LEAST GLYPH INK OVERPRINTED (decision 55): "(S)" over "OH" is
 *    unreadable. Measured as ink-on-ink area, so a candidate that only reaches
 *    a label's clearance padding beats one that prints on the glyph.
 * 5. FEWEST LINE HITS: "(S)" across a bond line is crowded but legible.
 * 6. Ladder order, which the caller keeps by replacing only on "less wrong".
 *
 * An earlier version broke a hit tie by how CLEARLY a candidate was its own
 * (the own-to-nearest-other distance ratio). The ruling has no such key, and
 * a geometric tiebreak on floats is what decision 36 declined elsewhere.
 */
function compareFallbacks(a: FallbackScore, b: FallbackScore): number {
  const byClass = fallbackClass(a) - fallbackClass(b);
  if (byClass !== 0) return byClass;
  // Equal classes, so testing `a` alone says which class both are in.
  const byDrop = fallbackClass(a) === 0 ? Number(a.printsOnText) - Number(b.printsOnText) : 0;
  return byDrop || a.glyphHits - b.glyphHits || a.lineHits - b.lineHits;
}

const NO_CIRCLES: readonly AnnotationCircle[] = Object.freeze([]);
const NO_SEGMENTS: readonly AnnotationSegment[] = Object.freeze([]);
const NO_DISCS: readonly AnnotationDisc[] = Object.freeze([]);
const NO_ATOMS: readonly AnnotationAtomCentre[] = Object.freeze([]);
const NO_BOXES: readonly LabelBox[] = Object.freeze([]);
const NO_BONDS: readonly AnnotationBondSegment[] = Object.freeze([]);

/**
 * Decision 35, with decision 63's margin: is `centre` — the annotation's
 * INK-box centre (decision 57) — at most `ownDistanceRatio` times as far from
 * every other atom centre as it is from the request's own anchor?
 *
 * A margin rather than a strict inequality, so a near-tie — a slot between
 * two atoms, or past the end of a bond where its atom is as near as the bond
 * is — reads as ambiguous and is not taken. Squared distances throughout: no
 * square root, so no rounding between two comparisons of the same pair, and
 * the ratio is squared once as a module constant.
 */
function readsAsOwn(
  centre: ScenePoint,
  request: AnnotationRequest,
  atomCentres: readonly AnnotationAtomCentre[],
  bondSegments: readonly AnnotationBondSegment[],
): boolean {
  const own = ownDistance(centre, request);
  for (const atom of atomCentres) {
    if (isOwnAtom(request, atom.atomId)) continue;
    if (!readsAsOwnAt(own, squaredDistance(centre, atom.centre))) return false;
  }
  // Decision 68: the other BONDS compete for a bond annotation too.
  if (request.source.kind !== "bond") return true;
  for (const bond of bondSegments) {
    if (bond.bondId === request.source.bondId) continue;
    if (!readsAsOwnAt(own, squaredDistanceToSegment(centre, bond))) return false;
  }
  return true;
}

/**
 * Is `atomId` the annotation's own — the atom it names, either end of the bond
 * it names (decision 68), or any atom at all when the annotation is the whole
 * STRUCTURE's (decision 88)?
 *
 * The structure case makes the proximity test vacuous for the prefix, and that
 * is the ruling rather than a shortcut: `rac-` set above a drawing cannot be
 * misread as belonging to a different structure, because there is no other
 * structure in the panel. What keeps it off the ink is the obstacle test.
 */
function isOwnAtom(request: AnnotationRequest, atomId: AtomId): boolean {
  switch (request.source.kind) {
    case "atom":
      return request.source.atomId === atomId;
    case "bond":
      return request.ownAtomIds?.includes(atomId) ?? false;
    case "structure":
      return true;
  }
}

/** Decision 63, on SQUARED distances: own <= (0.85 × other)². */
const OWN_DISTANCE_RATIO_SQUARED =
  ANNOTATION_PLACEMENT.ownDistanceRatio * ANNOTATION_PLACEMENT.ownDistanceRatio;

function readsAsOwnAt(ownSquared: number, otherSquared: number): boolean {
  return ownSquared <= OWN_DISTANCE_RATIO_SQUARED * otherSquared;
}

function boxCentre(box: LabelBox): ScenePoint {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/**
 * Squared distance to the request's own anchor: its ink box if it has one
 * (decision 88), else its segment (decision 68), else the anchor point.
 */
function ownDistance(centre: ScenePoint, request: AnnotationRequest): number {
  if (request.anchorBox !== undefined) return squaredDistanceToBox(centre, request.anchorBox);
  return request.anchorSegment === undefined
    ? squaredDistance(centre, request.anchor)
    : squaredDistanceToSegment(centre, request.anchorSegment);
}

/** Squared distance from a point to a rectangle; zero inside it. */
function squaredDistanceToBox(p: ScenePoint, box: LabelBox): number {
  const dx = p.x < box.minX ? box.minX - p.x : p.x > box.maxX ? p.x - box.maxX : 0;
  const dy = p.y < box.minY ? box.minY - p.y : p.y > box.maxY ? p.y - box.maxY : 0;
  return dx * dx + dy * dy;
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

/**
 * Decision 64: does the ink come within the clearance of a glyph's ink — on
 * it, or nearer than `clearancePx` (decision 58 dropped only on an overlap)?
 *
 * Zero overlap is not enough to read: a "13" half a pixel from a "C" is read
 * as 13-C, and an "H" that near a "3" as a formula. The annotation's own ink
 * box is grown by the same clearance every placed box already demands.
 */
function printsOnText(inkBox: LabelBox, glyphInk: readonly LabelBox[]): boolean {
  const near = pad(inkBox, ANNOTATION_PLACEMENT.clearancePx);
  for (const glyph of glyphInk) if (overlapArea(near, glyph) > 0) return true;
  return false;
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
