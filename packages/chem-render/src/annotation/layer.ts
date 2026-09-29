/**
 * The scheme annotation layer of one scene: the stored annotations a document
 * holds, resolved against what THIS panel drew and emitted on top of it.
 *
 * `buildScene` runs it last, over the primitives it has already emitted, and
 * hands it the panel's own geometry — atom centres, label placements, bond
 * segments, all in scene px and all from the layout when the panel is a
 * projection. Nothing here reads a model coordinate, which is what makes
 * re-projection a no-op for arrows.
 *
 * Only curly arrows are drawn so far. Reaction arrows, plus signs, brackets
 * and text are the reaction-arrows task's; until it lands they are skipped
 * here, neither drawn nor reported.
 */

import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import type { AtomLabelPlacement } from "../label/placement.js";
import type { ScenePoint, ScenePrimitive } from "../scene/types.js";
import { anchorPlacementOf, schemeAnnotationResolves } from "../scheme/annotation.js";
import type {
  SchemeAnchorPlacement,
  SchemeAnnotation,
  SchemeAnnotationId,
} from "../scheme/annotation.js";
import type { RenderStyle } from "../style.js";
import type { SchemeAnchorGeometry } from "./anchor.js";
import { curlyArrowPrimitives, layoutCurlyArrow } from "./curly.js";
import type { CurlyArrowBondObstacle, CurlyArrowLayout, CurlyArrowObstacles } from "./curly.js";

/** What a scene's annotation layer drew, and what it could not. */
export interface SchemeAnnotationLayout {
  /** Every curly arrow the panel drew, in document order, with its findings. */
  readonly curlyArrows: readonly CurlyArrowLayout[];
  /**
   * Curly arrows with an end this panel does not place — a text panel, a
   * projection that folds the atom into a condensed word. Absent by rule, not
   * by fault; listed so a caller can say so.
   */
  readonly unresolved: readonly SchemeAnnotationId[];
}

export const EMPTY_SCHEME_ANNOTATION_LAYOUT: SchemeAnnotationLayout = Object.freeze({
  curlyArrows: Object.freeze([]),
  unresolved: Object.freeze([]),
});

/**
 * The layout of a panel that places no atom at all — a text view: every curly
 * arrow is unresolved there, by the same rule as anywhere else.
 */
export function unplacedSchemeAnnotations(
  annotations: readonly SchemeAnnotation[] | undefined,
): SchemeAnnotationLayout {
  const unresolved = (annotations ?? []).flatMap((a) => (a.kind === "curlyArrow" ? [a.id] : []));
  return unresolved.length === 0 ? EMPTY_SCHEME_ANNOTATION_LAYOUT : { curlyArrows: [], unresolved };
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
 * Lays out and emits every stored curly arrow that resolves in this panel,
 * in document order, appending its primitives to `primitives`.
 */
export function drawSchemeAnnotations(
  primitives: ScenePrimitive[],
  annotations: readonly SchemeAnnotation[],
  context: SchemeAnnotationContext,
  style: RenderStyle,
): SchemeAnnotationLayout {
  const curlyArrows: CurlyArrowLayout[] = [];
  const unresolved: SchemeAnnotationId[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "curlyArrow") continue;
    // A reflection keeps the apex's place along the chord and swaps its side
    // (decision 196), so a mirrored panel draws the bulge negated.
    const drawn = context.mirrored ? { ...annotation, bulge: -annotation.bulge } : annotation;
    const layout = schemeAnnotationResolves(annotation, context.placement)
      ? layoutCurlyArrow(drawn, context.geometry, style, context.obstacles)
      : undefined;
    if (layout === undefined) {
      unresolved.push(annotation.id);
      continue;
    }
    curlyArrows.push(layout);
    primitives.push(...curlyArrowPrimitives(layout, style));
  }
  return { curlyArrows, unresolved };
}
