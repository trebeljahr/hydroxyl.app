/**
 * The scheme annotation layer of one scene: the stored annotations a document
 * holds, resolved against what THIS panel drew and emitted on top of it.
 *
 * `buildScene` runs it last, over the primitives it has already emitted, and
 * hands it the panel's own geometry — atom centres, label placements, bond
 * segments, all in scene px and all from the layout when the panel is a
 * projection. Nothing here reads a model coordinate, which is what makes
 * re-projection a no-op for arrows. (The one exception is a free label, whose
 * stored position IS a model coordinate: it anchors to the model frame, and a
 * panel that does not draw that frame does not place it.)
 *
 * EVERY KIND IS DRAWN, in a fixed order (decision 213):
 *
 *   1. partial bonds, the dashed lines of a transition state (under
 *      everything else a scheme adds);
 *   2. coefficients, each widening its species' box so what comes next keeps
 *      clear of it;
 *   3. plus signs and straight arrows — forward, equilibrium, retrosynthetic,
 *      resonance — whose species all lie inside one bracket: the resonance
 *      arrow between two forms, the plus inside a salt's bracket;
 *   4. brackets, smallest first, each around its species and every mark
 *      drawn among them alone, with the charge and the double dagger outside;
 *      each bracket's box then joins the box of every species inside it;
 *   5. the other plus signs and straight arrows, with their conditions, which
 *      therefore stop at a bracket rather than at the ink inside it: the arrow
 *      into a transition state ends before its "[", not on its oxygen;
 *   6. free text;
 *   7. curly arrows, LAST, on top of everything, in document order.
 *
 * Within each step, document order.
 *
 * A transition state's delta labels are the one kind drawn elsewhere: the
 * label placement pass places them with the descriptors (decision 205), and
 * this layer reads its placements back into the report.
 *
 * VISIBILITY IS ONE RULE for every kind: an annotation is drawn in a panel iff
 * every anchor resolves there (`schemeAnnotationResolves`), and one that does
 * not is listed in `unresolved`, in document order. A text view places no
 * atom, so everything is unresolved there, by the same rule.
 */

import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import type { AnnotationLayout } from "../label/annotations.js";
import type { AtomLabelPlacement } from "../label/placement.js";
import type { ScenePoint, ScenePrimitive } from "../scene/types.js";
import { anchorPlacementOf, schemeAnnotationResolves } from "../scheme/annotation.js";
import type {
  BracketAnnotation,
  SchemeAnchorPlacement,
  SchemeAnnotation,
  SchemeAnnotationId,
} from "../scheme/annotation.js";
import type { RenderStyle } from "../style.js";
import { measurerFor } from "../text/measurer.js";
import type { SchemeAnchorGeometry } from "./anchor.js";
import { layoutBracket } from "./bracket.js";
import type { BracketLayout } from "./bracket.js";
import { curlyArrowPrimitives, layoutCurlyArrow } from "./curly.js";
import type { CurlyArrowBondObstacle, CurlyArrowLayout, CurlyArrowObstacles } from "./curly.js";
import { layoutPlus, layoutStraightArrow } from "./reaction.js";
import type { PlusLayout, StraightArrowLayout } from "./reaction.js";
import type { SchemeMarkSite } from "./scheme-mark.js";
import { layoutCoefficient, layoutSchemeText } from "./scheme-text.js";
import type { CoefficientLayout, SchemeTextLayout } from "./scheme-text.js";
import { SpeciesBoxes } from "./species-box.js";
import type { AtomInk, SchemeBox } from "./species-box.js";
import { layoutHydrogenBond, layoutPartialBond, partialChargeLayout } from "./transition-state.js";
import type { PartialBondLayout, PartialChargeLayout } from "./transition-state.js";

/** What a scene's annotation layer drew, and what it could not. */
export interface SchemeAnnotationLayout {
  /** Every curly arrow the panel drew, in document order, with its findings. */
  readonly curlyArrows: readonly CurlyArrowLayout[];
  /** Forward, equilibrium, retrosynthetic and resonance arrows, in document order. */
  readonly straightArrows: readonly StraightArrowLayout[];
  readonly plusSigns: readonly PlusLayout[];
  /** Drawn and undrawn (a second one on a species is reported, not drawn). */
  readonly coefficients: readonly CoefficientLayout[];
  /** In the order they were laid out: smallest first. */
  readonly brackets: readonly BracketLayout[];
  readonly partialBonds: readonly PartialBondLayout[];
  /** Dotted, laid out exactly as a partial bond is (decision 226). */
  readonly hydrogenBonds: readonly PartialBondLayout[];
  /** What the label pass made of each stored delta (decision 205). */
  readonly partialCharges: readonly PartialChargeLayout[];
  readonly texts: readonly SchemeTextLayout[];
  /**
   * Annotations with an anchor this panel does not place — a text panel, a
   * projection that folds the atom into a condensed word, a free label on a
   * projection. Absent by rule, not by fault; listed, in document order, so a
   * caller can say so.
   */
  readonly unresolved: readonly SchemeAnnotationId[];
}

export const EMPTY_SCHEME_ANNOTATION_LAYOUT: SchemeAnnotationLayout = Object.freeze({
  curlyArrows: Object.freeze([]),
  straightArrows: Object.freeze([]),
  plusSigns: Object.freeze([]),
  coefficients: Object.freeze([]),
  brackets: Object.freeze([]),
  partialBonds: Object.freeze([]),
  hydrogenBonds: Object.freeze([]),
  partialCharges: Object.freeze([]),
  texts: Object.freeze([]),
  unresolved: Object.freeze([]),
});

/**
 * The layout of a panel that places no atom at all — a text view: every
 * annotation is unresolved there, by the same rule as anywhere else.
 */
export function unplacedSchemeAnnotations(
  annotations: readonly SchemeAnnotation[] | undefined,
): SchemeAnnotationLayout {
  const unresolved = (annotations ?? []).map((a) => a.id);
  return unresolved.length === 0 ? EMPTY_SCHEME_ANNOTATION_LAYOUT : { ...EMPTY_SCHEME_ANNOTATION_LAYOUT, unresolved };
}

/** What the scene build knows about the panel it drew, in scene px. */
export interface SchemeLayerSite {
  /** The molecule the scene's bonds were drawn from — a projection's geometry copy. */
  readonly geometry: Molecule;
  /** Where each placed atom is drawn. */
  readonly centres: ReadonlyMap<AtomId, ScenePoint>;
  /** Each atom's label; undefined for a bare vertex. */
  readonly placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>;
  /**
   * The clear space of each derived hydrogen's "H", filed under its HOST: an
   * arrow from an oxygen's lone pair past its own hydrogen is not crowding
   * another atom.
   */
  readonly hydrogenLabels: readonly {
    readonly atomId: AtomId;
    readonly obstacles: AtomLabelPlacement["obstacles"];
  }[];
  /** Each drawn bond as one segment, `a` at its `from` atom. */
  readonly bonds: readonly CurlyArrowBondObstacle[];
}

/** An arrow's view of one panel, and what it may not cross there. */
export interface SchemeAnnotationContext {
  readonly placement: SchemeAnchorPlacement;
  readonly geometry: SchemeAnchorGeometry;
  readonly obstacles: CurlyArrowObstacles;
  /**
   * True when the panel draws the molecule mirrored (decision 196): stored
   * bulges are drawn negated here, and a shape chosen on this panel must be
   * negated before it is stored.
   */
  readonly mirrored: boolean;
}

/**
 * What the marks BETWEEN species need of the panel beyond an arrow's anchor
 * context: the source molecule (whose species they name), the drawn site
 * (whose ink the species boxes are measured from), and the label pass's
 * report (the descriptors, locants and deltas drawn beside atoms, which a
 * species' box includes, decision 203).
 */
export interface SchemeMarkPanel {
  readonly source: Molecule;
  readonly site: SchemeLayerSite;
  readonly labels: AnnotationLayout;
}

/**
 * The injected geometry and the obstacles, for the primitives drawn so far.
 *
 * `positionOf` and `bondEnds` answer ONLY for what `placement` says the panel
 * placed, so an arrow resolves exactly when `schemeAnnotationResolves` says it
 * does: one rule, asked two ways, cannot give two answers.
 */
export function schemeAnnotationContext(
  primitives: readonly ScenePrimitive[],
  source: Molecule,
  site: SchemeLayerSite,
  drawsModelFrame: boolean,
  mirrored = false,
): SchemeAnnotationContext {
  const placement = anchorPlacementOf(primitives, source, drawsModelFrame);
  const bondOf = (bondId: BondId) =>
    Object.hasOwn(site.geometry.bonds, bondId) ? site.geometry.bonds[bondId] : undefined;
  const geometry: SchemeAnchorGeometry = {
    positionOf: (atomId) => (placement.hasAtom(atomId) ? site.centres.get(atomId) : undefined),
    bondEnds: (bondId) => {
      if (!placement.hasBond(bondId)) return undefined;
      const bond = bondOf(bondId);
      if (bond === undefined) return undefined;
      const from = site.centres.get(bond.from);
      const to = site.centres.get(bond.to);
      return from === undefined || to === undefined ? undefined : { from, to };
    },
    labelOf: (atomId) => site.placements.get(atomId),
  };
  const labels: { atomId: AtomId; obstacles: AtomLabelPlacement["obstacles"] }[] = [];
  for (const [atomId, label] of site.placements) {
    if (label !== undefined) labels.push({ atomId, obstacles: label.obstacles });
  }
  labels.push(...site.hydrogenLabels);
  return { placement, geometry, obstacles: { labels, bonds: site.bonds }, mirrored };
}

/**
 * The ink the label pass drew beside each atom — descriptors, locants,
 * deltas; a bond's (E)/(Z) filed under the bond's first atom — for the
 * species boxes (decision 203). Dropped placements drew nothing and are left
 * out; the structure's rac-/rel- prefix belongs to no one atom and is too.
 */
function labelInkOf(labels: AnnotationLayout, geometry: Molecule): AtomInk[] {
  const out: AtomInk[] = [];
  for (const placed of labels.placements) {
    if (!placed.drawn) continue;
    const source = placed.source;
    if (source.kind === "atom") out.push({ atomId: source.atomId, box: placed.inkBox });
    else if (source.kind === "bond" && Object.hasOwn(geometry.bonds, source.bondId)) {
      out.push({ atomId: geometry.bonds[source.bondId]!.from, box: placed.inkBox });
    }
  }
  return out;
}

/** The atoms a plus sign or a straight arrow names, or undefined for any other kind. */
function straightMarkEnds(annotation: SchemeAnnotation): readonly AtomId[] | undefined {
  switch (annotation.kind) {
    case "plus":
    case "resonanceArrow":
      return annotation.between;
    case "reactionArrow":
      return [...annotation.from, ...annotation.to];
    case "retrosynthesisArrow":
      return [...annotation.target, ...annotation.precursors];
    default:
      return undefined;
  }
}

/** A laid-out mark between species, and the species it touches. */
interface EnclosableMark {
  readonly species: ReadonlySet<number>;
  readonly box: SchemeBox;
}

/**
 * Lays out and emits every stored annotation that resolves in this panel, in
 * decision 213's order, appending the primitives to `primitives`.
 */
export function drawSchemeAnnotations(
  primitives: ScenePrimitive[],
  annotations: readonly SchemeAnnotation[],
  context: SchemeAnnotationContext,
  style: RenderStyle,
  panel: SchemeMarkPanel,
): SchemeAnnotationLayout {
  const unresolvedIds = new Set<SchemeAnnotationId>();
  const resolves = (annotation: SchemeAnnotation): boolean => {
    const ok = schemeAnnotationResolves(annotation, context.placement);
    if (!ok) unresolvedIds.add(annotation.id);
    return ok;
  };
  const measurer = measurerFor(style);
  const boxes = new SpeciesBoxes(panel.source, panel.site, style, labelInkOf(panel.labels, panel.site.geometry));
  const site: SchemeMarkSite = { source: panel.source, boxes, style, measurer };
  const speciesSet = (atomIds: readonly AtomId[]): Set<number> => {
    const out = new Set<number>();
    for (const atomId of atomIds) {
      const index = boxes.speciesIndex(atomId);
      if (index !== undefined) out.add(index);
    }
    return out;
  };
  const enclosable: EnclosableMark[] = [];

  // 1. Partial bonds.
  const partialBonds: PartialBondLayout[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "partialBond" || !resolves(annotation)) continue;
    const layout = layoutPartialBond(annotation, panel.source, panel.site, style);
    partialBonds.push(layout);
    primitives.push(...layout.primitives);
    if (layout.primitives.length > 0) enclosable.push({ species: speciesSet(annotation.atoms), box: layout.box });
  }

  // 1b. Hydrogen bonds, the same way (decision 226).
  const hydrogenBonds: PartialBondLayout[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "hydrogenBond" || !resolves(annotation)) continue;
    const layout = layoutHydrogenBond(annotation, panel.source, panel.site, style);
    hydrogenBonds.push(layout);
    primitives.push(...layout.primitives);
    if (layout.primitives.length > 0) enclosable.push({ species: speciesSet(annotation.atoms), box: layout.box });
  }

  // 2. Coefficients: one per species, the first in document order.
  const coefficients: CoefficientLayout[] = [];
  const coefficientFor = new Set<number>();
  for (const annotation of annotations) {
    if (annotation.kind !== "coefficient" || !resolves(annotation)) continue;
    const index = boxes.speciesIndex(annotation.species);
    const layout = layoutCoefficient(annotation, site);
    if (layout === undefined || index === undefined) {
      unresolvedIds.add(annotation.id);
      continue;
    }
    if (coefficientFor.has(index)) {
      coefficients.push({ ...layout, primitives: [], findings: [...layout.findings, { kind: "duplicate-coefficient" }] });
      continue;
    }
    coefficientFor.add(index);
    coefficients.push(layout);
    primitives.push(...layout.primitives);
    boxes.extend(annotation.species, layout.box);
  }

  // Which plus signs and straight arrows lie inside a bracket: those are laid
  // out before the brackets, the rest after (steps 3 and 5).
  const bracketSets = annotations.flatMap((a) =>
    a.kind === "bracket" && schemeAnnotationResolves(a, context.placement) ? [speciesSet(a.species)] : [],
  );
  const marksBetween = annotations.flatMap((annotation) => {
    const ends = straightMarkEnds(annotation);
    return ends === undefined ? [] : [{ annotation, species: speciesSet(ends) }];
  });
  const isInside = (species: ReadonlySet<number>, container: ReadonlySet<number>): boolean =>
    species.size > 0 && [...species].every((index) => container.has(index));
  const internal = (species: ReadonlySet<number>): boolean => bracketSets.some((set) => isInside(species, set));

  const plusSigns: PlusLayout[] = [];
  const straightArrows: StraightArrowLayout[] = [];
  const drawBetween = (annotation: SchemeAnnotation, species: ReadonlySet<number>): void => {
    if (!resolves(annotation)) return;
    let layout: PlusLayout | StraightArrowLayout | undefined;
    if (annotation.kind === "plus") {
      layout = layoutPlus(annotation, site);
      if (layout !== undefined) plusSigns.push(layout);
    } else if (
      annotation.kind === "reactionArrow" ||
      annotation.kind === "retrosynthesisArrow" ||
      annotation.kind === "resonanceArrow"
    ) {
      layout = layoutStraightArrow(annotation, site);
      if (layout !== undefined) straightArrows.push(layout);
    }
    if (layout === undefined) {
      unresolvedIds.add(annotation.id);
      return;
    }
    primitives.push(...layout.primitives);
    enclosable.push({ species, box: layout.box });
  };

  // 3. Plus signs and straight arrows inside a bracket.
  for (const { annotation, species } of marksBetween) {
    if (internal(species)) drawBetween(annotation, species);
  }

  // 4. Brackets, smallest first, so a larger one can enclose a smaller.
  const brackets: BracketLayout[] = [];
  const stored = annotations.filter((a): a is BracketAnnotation => a.kind === "bracket");
  const bySize = stored
    .map((annotation, order) => ({ annotation, order, species: speciesSet(annotation.species) }))
    .sort((a, b) => a.species.size - b.species.size || a.order - b.order);
  for (const { annotation, species } of bySize) {
    if (!resolves(annotation)) continue;
    const layout = layoutBracket(
      annotation,
      site,
      enclosable.filter((mark) => isInside(mark.species, species)).map((mark) => mark.box),
    );
    if (layout === undefined) {
      unresolvedIds.add(annotation.id);
      continue;
    }
    brackets.push(layout);
    primitives.push(...layout.primitives);
    enclosable.push({ species, box: layout.box });
    // What reaches this bracket from outside stops at it (step 5).
    for (const atomId of annotation.species) boxes.extend(atomId, layout.box);
  }

  // 5. The other plus signs and straight arrows.
  for (const { annotation, species } of marksBetween) {
    if (!internal(species)) drawBetween(annotation, species);
  }

  // 6. Free text.
  const texts: SchemeTextLayout[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "text" || !resolves(annotation)) continue;
    const layout = layoutSchemeText(annotation, style, measurer);
    texts.push(layout);
    primitives.push(...layout.primitives);
  }

  // The deltas, drawn by the label pass: reported here, in document order.
  const partialCharges: PartialChargeLayout[] = [];
  const deltaOn = new Set<AtomId>();
  for (const annotation of annotations) {
    if (annotation.kind !== "partialCharge" || !resolves(annotation)) continue;
    const first = !deltaOn.has(annotation.atomId);
    deltaOn.add(annotation.atomId);
    partialCharges.push(partialChargeLayout(annotation, panel.labels, first, measurer, style));
  }

  // 7. Curly arrows, last, on top of everything.
  const curlyArrows: CurlyArrowLayout[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "curlyArrow") continue;
    // A reflection keeps the apex's place along the chord and swaps its side
    // (decision 196), so a mirrored panel draws the bulge negated.
    const drawn = context.mirrored ? { ...annotation, bulge: -annotation.bulge } : annotation;
    const layout = resolves(annotation)
      ? layoutCurlyArrow(drawn, context.geometry, style, context.obstacles)
      : undefined;
    if (layout === undefined) {
      unresolvedIds.add(annotation.id);
      continue;
    }
    curlyArrows.push(layout);
    primitives.push(...curlyArrowPrimitives(layout, style));
  }

  // Reported in document order, whichever step drew them.
  const order = new Map(annotations.map((a, index) => [a.id, index]));
  const byDocument = (a: { annotationId: SchemeAnnotationId }, b: { annotationId: SchemeAnnotationId }): number =>
    (order.get(a.annotationId) ?? 0) - (order.get(b.annotationId) ?? 0);
  straightArrows.sort(byDocument);
  plusSigns.sort(byDocument);

  return {
    curlyArrows,
    straightArrows,
    plusSigns,
    coefficients,
    brackets,
    partialBonds,
    hydrogenBonds,
    partialCharges,
    texts,
    unresolved: annotations.filter((a) => unresolvedIds.has(a.id)).map((a) => a.id),
  };
}
