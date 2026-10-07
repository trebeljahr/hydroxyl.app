/**
 * What every non-curly scheme mark shares: its stated lengths, its findings,
 * what it sees of the panel, and how its primitives are named and measured.
 *
 * A scheme mark — a straight arrow, a plus, a coefficient, a bracket, a
 * transition state's partial bond, a free label — is laid out per panel
 * against what THAT panel drew (species-box.ts), reported on, and never
 * allowed to move a species: "report, never nudge" is inherited verbatim
 * (the architectural ruling). A mark that does not fit is drawn where its
 * rule puts it and says so in `findings`.
 *
 * LENGTHS ARE STATED, NOT TUNED. Every length is in bond lengths (through
 * `pxPerModelUnit`, never `bondLengthPx`) or in ems of the label size, so a
 * preset with a longer bond gets a proportionally longer arrow, and nothing
 * here holds a px constant a preset could disagree with.
 *
 * Scene px, y-down, like everything the layer sees.
 */

import type { AtomId, Molecule } from "@starter/chem-core";

import { sceneBounds } from "../scene/bounds.js";
import type { SceneBounds, ScenePrimitive, SceneSource } from "../scene/types.js";
import type { SchemeAnnotationId } from "../scheme/annotation.js";
import { withStyle } from "../style.js";
import type { RenderStyle } from "../style.js";
import type { Measurer } from "../text/measurer.js";
import type { SchemeBox, SpeciesBoxes } from "./species-box.js";

/** The stated lengths of decisions 203 and 204, and of the partial bond. */
export const SCHEME_LAYOUT = Object.freeze({
  /** The shortest a reaction arrow is drawn, in bond lengths (decision 203). */
  minArrowBonds: 2,
  /** Kept clear between a species' ink and an arrow's tail or tip, bond lengths. */
  speciesClearanceBonds: 0.3,
  /** How far the shaft runs past its widest line of conditions, each end, em. */
  conditionsPadEm: 0.5,
  /** From the shaft to the nearest line of conditions, em. */
  conditionsGapEm: 0.3,
  /**
   * From the outermost reach of the heads to the nearest line of conditions,
   * em (decision 218): the label pass's 1 px ink clearance (decision 64) as a
   * scheme length. The shaft gap is the larger at Publication; at Screen the
   * heads, sized in its 2 px line width, reach past it.
   */
  conditionsHeadClearanceEm: 0.1,
  /** Baseline to baseline of stacked conditions lines, em. */
  conditionsLineEm: 1.2,
  /** A vertical arrow's widest conditions line before it wraps, bond lengths. */
  verticalWrapBonds: 4,
  /** A biased equilibrium's unfavoured half, as a fraction of the favoured one. */
  equilibriumMinorFraction: 0.6,
  /** Half of one arm of the scheme plus, bond lengths: the whole sign is 0.4 wide (decision 204). */
  plusHalfArmBonds: 0.2,
  /** A bracket's clearance around what it encloses, bond lengths (decision 204). */
  bracketPadBonds: 0.25,
  /** The length of a bracket's top and bottom serifs, bond lengths (decision 204). */
  bracketSerifBonds: 0.2,
  /** From a closing bracket to its superscript, and between dagger and charge, em of the superscript. */
  superscriptGapEm: 0.12,
  /** Half the width of the double dagger's crossbars, as a fraction of its stem. */
  daggerCrossbarHalfWidth: 0.3,
  /** Where the dagger's two crossbars cross its stem, from the top, as fractions of it. */
  daggerCrossbars: Object.freeze([0.28, 0.72] as const),
  /** From a coefficient's last glyph to its species' ink, em (decision 204). */
  coefficientGapEm: 0.25,
  /** A partial bond's dash and gap, bond lengths. */
  partialBondDashBonds: Object.freeze([0.1, 0.075] as const),
  /**
   * A hydrogen bond's dot pitch, bond lengths (decision 226): the dots are
   * one line width long, so the line reads as dotted, not as a partial
   * bond's dashes.
   */
  hydrogenBondDotPitchBonds: 0.08,
});

/** What a laid-out scheme mark noticed. Reported; nothing is moved. */
export type SchemeMarkFinding =
  /** The two sides' boxes overlap on both axes: there is no gap to draw in. */
  | { readonly kind: "overlapping-species" }
  /** The mark is longer than the room between its species, and reaches into their ink. */
  | { readonly kind: "crowds-species" }
  /** One species is on both sides of an arrow, or both ends of a plus. */
  | { readonly kind: "same-species"; readonly atomId: AtomId }
  /** Text the vendored font has no glyph for, measured at `.notdef` (decision 206). */
  | { readonly kind: "unmeasured-glyphs"; readonly codePoints: readonly number[] }
  /** Resonance forms with different formulas: a hydrogen was lost in the redrawing. */
  | { readonly kind: "resonance-formula-differs" }
  /** Resonance forms with different net charges. */
  | { readonly kind: "resonance-charge-differs" }
  /**
   * A bracket's stored charge that what it encloses does not carry (decision
   * 204): for a resonance set, one form's net charge; for a transition state
   * whose fragments carry formal charges, their sum (decision 212).
   */
  | { readonly kind: "charge-mismatch"; readonly atomId: AtomId; readonly netCharge: number }
  /** A partial or hydrogen bond drawn over a bond the molecule already has. */
  | { readonly kind: "on-drawn-bond" }
  /** A partial bond with nothing left to draw: its atoms coincide, or their labels meet. */
  | { readonly kind: "no-shaft" }
  /** A second coefficient for a species that already has one: not drawn. */
  | { readonly kind: "duplicate-coefficient" }
  /** A second partial charge on an atom that already has one: not placed (decision 205). */
  | { readonly kind: "duplicate-partial-charge" }
  /** The label pass found no clear slot and drew it at the least wrong one. */
  | { readonly kind: "crowded" }
  /** The label pass found no slot off every glyph: listed, not drawn (decisions 58, 64). */
  | { readonly kind: "prints-on-text" };

/** What a mark between or around species needs of the panel. */
export interface SchemeMarkSite {
  readonly source: Molecule;
  readonly boxes: SpeciesBoxes;
  readonly style: RenderStyle;
  readonly measurer: Measurer;
}

/** What every laid-out mark reports. */
export interface SchemeMarkLayout {
  readonly annotationId: SchemeAnnotationId;
  /** Everything the mark draws, in draw order. */
  readonly primitives: readonly ScenePrimitive[];
  /** The ink of `primitives`, px: what the viewBox and an enclosing bracket see. */
  readonly box: SchemeBox;
  readonly findings: readonly SchemeMarkFinding[];
}

/** `annotation:ann_3:shaft` — derived from the stored id and the part, never a counter. */
export function schemeMarkPrimitiveId(annotationId: SchemeAnnotationId, part: string): string {
  return `annotation:${annotationId}:${part}`;
}

/** The scene source every primitive of a stored annotation carries. */
export function annotationSource(annotationId: SchemeAnnotationId): SceneSource {
  return { kind: "annotation", annotationId };
}

/**
 * The ink box of some primitives, measured exactly as the viewBox is: the
 * same `sceneBounds`, with no margin. A mark's box and the figure's bounds
 * then cannot disagree about where its ink is.
 */
export function primitivesBox(primitives: readonly ScenePrimitive[], style: RenderStyle): SchemeBox {
  const bounds: SceneBounds = sceneBounds(primitives, withStyle(style, { marginPx: 0 }));
  return { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
}
