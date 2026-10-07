/**
 * A transition state's own marks: the dashed PARTIAL BOND between two atoms,
 * and the δ+/δ− beside an atom (decisions 201, 205 and 214). The dotted
 * HYDROGEN BOND (decision 226) is laid out here too: the same segment
 * between two atoms, with dots for dashes.
 *
 * A partial bond is an annotation, not a bond order: chem-core's valence
 * knows nothing of it, so a transition state is drawn as fragments with no
 * bonds between them (their hydrogen counts pinned), and the dashes are what
 * say where the bonds are forming and breaking. It is drawn like a bond —
 * between the two atoms as THIS panel places them, trimmed at their labels by
 * the bond pass's own `bondAxis` — but dashed, and it is an obstacle for the
 * label pass so a δ does not print on it.
 *
 * The δ itself is placed by the ONE label placement pass (decision 205), not
 * here: `scene/build.ts` turns each stored partial charge into a request of
 * kind `partialCharge`, and this module reads the pass's placement back into
 * the scheme report. What it prints goes through the Greek hook (decision
 * 192): until Greek is vendored its δ is measured at `.notdef` and reported.
 *
 * Scene px, y-down.
 */

import { bondBetween } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import { bondAxis } from "../bond/geometry.js";
import type { AnnotationLayout, AnnotationPlacement, AnnotationSegment } from "../label/annotations.js";
import type { AtomLabelPlacement } from "../label/placement.js";
import type { LinePrimitive, ScenePoint } from "../scene/types.js";
import type {
  HydrogenBondAnnotation,
  PartialBondAnnotation,
  PartialChargeAnnotation,
  PartialChargeSign,
} from "../scheme/annotation.js";
import { pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";
import type { Measurer } from "../text/measurer.js";
import { greek, unmeasuredCodePoints } from "../text/typography.js";
import { MINUS_SIGN } from "./conditions.js";
import { annotationSource, primitivesBox, SCHEME_LAYOUT, schemeMarkPrimitiveId } from "./scheme-mark.js";
import type { SchemeMarkFinding, SchemeMarkLayout } from "./scheme-mark.js";

/** `δ+` or `δ−`: the delta through the Greek hook, a real minus (decision 214). */
export function partialChargeText(sign: PartialChargeSign): string {
  return `${greek("delta")}${sign === "+" ? "+" : MINUS_SIGN}`;
}

/** What a partial bond is drawn between: this panel's centres and labels. */
export interface PartialBondSite {
  readonly centres: ReadonlyMap<AtomId, ScenePoint>;
  readonly placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>;
}

/**
 * The partial bond's drawn segment, trimmed at both labels exactly as a bond
 * between the two atoms would be; undefined when either atom is not drawn, or
 * nothing is left between their labels.
 */
export function partialBondSegment(
  atoms: readonly [AtomId, AtomId],
  site: PartialBondSite,
  style: RenderStyle,
): AnnotationSegment | undefined {
  const from = site.centres.get(atoms[0]);
  const to = site.centres.get(atoms[1]);
  if (from === undefined || to === undefined) return undefined;
  const axis = bondAxis(from, to, site.placements.get(atoms[0]), site.placements.get(atoms[1]), style.bondLineWidthPx);
  return axis === undefined ? undefined : { a: axis.a, b: axis.b, halfWidth: style.bondLineWidthPx / 2 };
}

export interface PartialBondLayout extends SchemeMarkLayout {
  readonly atoms: readonly [AtomId, AtomId];
  /** The drawn segment, or undefined when the trim left nothing (`no-shaft`). */
  readonly segment?: AnnotationSegment;
}

/** The partial bond laid out; the caller has checked that both atoms are placed. */
export function layoutPartialBond(
  annotation: PartialBondAnnotation,
  source: Molecule,
  site: PartialBondSite,
  style: RenderStyle,
): PartialBondLayout {
  const bond = pxPerModelUnit(style);
  const [dash, gap] = SCHEME_LAYOUT.partialBondDashBonds;
  return layoutBetweenAtoms(annotation, source, site, style, "partial-bond", [dash * bond, gap * bond]);
}

/**
 * A hydrogen bond laid out (decision 226): the partial bond's segment, dotted.
 * Dots one line width long at `hydrogenBondDotPitchBonds`, butt-capped so a
 * rasteriser draws exactly what the SVG says.
 */
export function layoutHydrogenBond(
  annotation: HydrogenBondAnnotation,
  source: Molecule,
  site: PartialBondSite,
  style: RenderStyle,
): PartialBondLayout {
  const dot = style.bondLineWidthPx;
  const pitch = Math.max(SCHEME_LAYOUT.hydrogenBondDotPitchBonds * pxPerModelUnit(style), 2 * dot);
  return layoutBetweenAtoms(annotation, source, site, style, "hydrogen-bond", [dot, pitch - dot]);
}

function layoutBetweenAtoms(
  annotation: PartialBondAnnotation | HydrogenBondAnnotation,
  source: Molecule,
  site: PartialBondSite,
  style: RenderStyle,
  part: string,
  dash: readonly number[],
): PartialBondLayout {
  const findings: SchemeMarkFinding[] = [];
  if (bondBetween(source, annotation.atoms[0], annotation.atoms[1]) !== undefined) {
    findings.push({ kind: "on-drawn-bond" });
  }
  const segment = partialBondSegment(annotation.atoms, site, style);
  if (segment === undefined) {
    findings.push({ kind: "no-shaft" });
    const centre = site.centres.get(annotation.atoms[0]) ?? { x: 0, y: 0 };
    return {
      annotationId: annotation.id,
      primitives: [],
      box: { minX: centre.x, minY: centre.y, maxX: centre.x, maxY: centre.y },
      findings,
      atoms: annotation.atoms,
    };
  }
  const line: LinePrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, part),
    source: annotationSource(annotation.id),
    type: "line",
    a: segment.a,
    b: segment.b,
    stroke: { color: style.colors.bond, width: style.bondLineWidthPx, dash },
  };
  const primitives = [line];
  return {
    annotationId: annotation.id,
    primitives,
    box: primitivesBox(primitives, style),
    findings,
    atoms: annotation.atoms,
    segment,
  };
}

export interface PartialChargeLayout {
  readonly annotationId: string;
  readonly atomId: AtomId;
  readonly sign: PartialChargeSign;
  readonly text: string;
  /**
   * The label pass's placement of it (decision 205), or undefined when it was
   * not placed at all: a second partial charge on one atom.
   */
  readonly placement?: AnnotationPlacement;
  /** True when the scene draws it: placed, and not dropped for printing on text. */
  readonly drawn: boolean;
  readonly findings: readonly SchemeMarkFinding[];
}

/**
 * What became of a stored partial charge, read off the label pass. `first`
 * is false for a second partial charge on an atom, which the pass never saw.
 */
export function partialChargeLayout(
  annotation: PartialChargeAnnotation,
  labels: AnnotationLayout,
  first: boolean,
  measurer: Measurer,
  style: RenderStyle,
): PartialChargeLayout {
  const text = partialChargeText(annotation.sign);
  const findings: SchemeMarkFinding[] = [];
  const placement = first
    ? labels.placements.find(
        (p) => p.kind === "partialCharge" && p.source.kind === "atom" && p.source.atomId === annotation.atomId,
      )
    : undefined;
  if (!first) findings.push({ kind: "duplicate-partial-charge" });
  if (placement !== undefined && !placement.clear) {
    findings.push(placement.drawn ? { kind: "crowded" } : { kind: "prints-on-text" });
  }
  const codePoints = unmeasuredCodePoints(text, measurer, style.fontFamily, style.fontWeight);
  if (codePoints.length > 0) findings.push({ kind: "unmeasured-glyphs", codePoints });
  return {
    annotationId: annotation.id,
    atomId: annotation.atomId,
    sign: annotation.sign,
    text,
    ...(placement === undefined ? {} : { placement }),
    drawn: placement?.drawn ?? false,
    findings,
  };
}
