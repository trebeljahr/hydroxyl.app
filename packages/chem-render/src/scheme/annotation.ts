/**
 * Scheme annotations: the things drawn BETWEEN and ON structures — curly
 * arrows, reaction arrows, plus signs, brackets and free text.
 *
 * NOT the label layer's annotations. `label/annotations.ts` places DERIVED
 * marks (a descriptor, a locant) that the renderer computes and nobody stores.
 * These are STORED: the document holds them beside its one molecule, the user
 * drew each one, and every type here is `Scheme`-prefixed so the two families
 * cannot be confused in an import.
 *
 * WHY THIS PACKAGE. The document (shared) persists them and the renderer will
 * draw them, and shared already imports chem-render, so the type has to live
 * here or lower — decision 10's direction, the one the display flags took.
 * chem-core is lower but ruled out: it has no business knowing what an arrow
 * is, which is also why chem-core's `Selection` does not grow annotation ids
 * and the client's does. Nothing in this module draws; the render layer that
 * resolves anchors to geometry is a later task and builds on these types.
 *
 * THE MODEL (decisions 102-104 and the architectural rulings behind them):
 *
 *   - Geometry is referenced, not copied. A curly arrow names its electron
 *     source and sink by atom and bond id; a reaction arrow, a plus sign and a
 *     bracket name SPECIES by one atom each, resolved through chem-core's
 *     `species(mol)`. The only absolute position is a text label's, in chem-core
 *     MODEL UNITS, y-up — never scene px, because `RenderStyle` is the sole
 *     owner of the model-to-px scale and the y-flip.
 *   - A reaction arrow's from/to species are STORED, chosen by hit-testing at
 *     draw time (decision 103). It stores no shaft: tail and head are placed
 *     between the species at render time, so dragging a species carries its
 *     arrow and a close neighbour can never capture it. `row` says which line
 *     of a wrapped scheme the arrow is drawn on.
 *   - A curly arrow's shape is FRAME-RELATIVE: a signed `bulge` (apex offset
 *     perpendicular to the chord) and a `skew` (apex position along it), both
 *     as fractions of the chord, so the curve survives translation, rotation
 *     and uniform scale. Vocabulary fixed by the architectural ruling:
 *     `electrons: "pair"` is the DOUBLE-BARBED two-electron arrow, `"single"`
 *     the SINGLE-BARBED fishhook. The resonance arrow is a straight
 *     double-headed arrow, not a curly one.
 *   - VISIBILITY FALLS OUT OF ANCHORING: an annotation shows in a panel iff
 *     every one of its anchors resolves to geometry in that panel's scene.
 *     A sum-formula panel places no atoms, so it carries no arrow and needs no
 *     flag to say so. A text label anchors to the MODEL FRAME, which only a
 *     panel drawing the molecule at its own coordinates places.
 *   - Deleting what an annotation points at prunes it in the same undo entry,
 *     never leaves it dangling: a dangling reference is a document the codec
 *     would have to start accepting. The one repair is decision 103's: a
 *     species reference whose atom went but whose species survived is
 *     re-pointed to that species' lowest surviving atom.
 *
 * Ids are `ann_<n>`, minted from the document's own monotonic counter — never
 * the molecule's `nextId`, whose suffix rule belongs to atoms and bonds, and
 * never a clock or a random number, which would churn every golden.
 */

import {
  compareIds,
  speciesOf,
  type AtomId,
  type BondId,
  type ElectronCount,
  type ElectronMove,
  type ElectronSink,
  type ElectronSource,
  type Molecule,
  type Vec2,
} from "@starter/chem-core";

import { isStructural } from "../representation.js";
import type { RenderScene } from "../scene/types.js";

export type SchemeAnnotationId = string;

/** The id a document's counter value `n` names. */
export function schemeAnnotationId(n: number): SchemeAnnotationId {
  return `ann_${n}`;
}

/**
 * Every annotation kind, listed once. The document codec builds its enum from
 * this list, and `KindListIsTotal` below makes a sixth kind a compile error
 * here rather than a saved sketch the codec cannot open — the `either` bug.
 */
export const SCHEME_ANNOTATION_KINDS = [
  "curlyArrow",
  "reactionArrow",
  "plus",
  "bracket",
  "text",
] as const;
export type SchemeAnnotationKind = (typeof SCHEME_ANNOTATION_KINDS)[number];

/*
 * ONE ELECTRON VOCABULARY, chem-core's (decision 149). A curly arrow's
 * `electrons`, `source` and `sink` ARE chem-core's `ElectronCount`,
 * `ElectronSource` and `ElectronSink`: the electron-movement topology that
 * `applyArrows` applies. The names below are aliases, not copies, so the two
 * cannot drift, and `CurlyArrowIsAnElectronMove` further down makes a drawn
 * arrow pass straight into `applyArrows`. What stays here is the drawing: the
 * record's id, its bulge and skew, anchoring, visibility and pruning.
 */

/** `pair`: double-barbed, two electrons. `single`: single-barbed fishhook. */
export const CURLY_ARROW_ELECTRONS = ["pair", "single"] as const;
export type CurlyArrowElectrons = ElectronCount;

/**
 * Where a curly arrow's electrons come from: a lone pair on an atom, a bond,
 * or a radical's electron on an atom. Never a bare atom — an arrow starts at
 * electrons, not at a nucleus.
 */
export type CurlyArrowSource = ElectronSource;

/**
 * Where they go: an atom, a bond, or a lone pair on a named atom. Never
 * "nothing": a departing pair always lands on some atom, and a sink with no
 * source mirror would leave the reversed arrow undefined for heterolysis.
 */
export type CurlyArrowSink = ElectronSink;

// The lists the document codec builds its enums from, checked in both
// directions against chem-core's unions: a fourth source kind added there is
// a compile error here rather than an arrow the codec cannot open.
export const CURLY_ARROW_SOURCE_KINDS = ["lonePair", "bond", "radical"] as const;
export const CURLY_ARROW_SINK_KINDS = ["atom", "bond", "lonePair"] as const;

type ElectronsListIsTotal = CurlyArrowElectrons extends (typeof CURLY_ARROW_ELECTRONS)[number]
  ? (typeof CURLY_ARROW_ELECTRONS)[number] extends CurlyArrowElectrons
    ? true
    : never
  : never;
const ELECTRONS_LIST_IS_TOTAL: ElectronsListIsTotal = true;
void ELECTRONS_LIST_IS_TOTAL;

type SourceKindsAreTotal =
  CurlyArrowSource["kind"] extends (typeof CURLY_ARROW_SOURCE_KINDS)[number]
    ? (typeof CURLY_ARROW_SOURCE_KINDS)[number] extends CurlyArrowSource["kind"]
      ? true
      : never
    : never;
type SinkKindsAreTotal =
  CurlyArrowSink["kind"] extends (typeof CURLY_ARROW_SINK_KINDS)[number]
    ? (typeof CURLY_ARROW_SINK_KINDS)[number] extends CurlyArrowSink["kind"]
      ? true
      : never
    : never;
const SOURCE_KINDS_ARE_TOTAL: SourceKindsAreTotal = true;
const SINK_KINDS_ARE_TOTAL: SinkKindsAreTotal = true;
void SOURCE_KINDS_ARE_TOTAL;
void SINK_KINDS_ARE_TOTAL;

/** The apex may sit anywhere over the chord, and no further. */
export const CURLY_ARROW_MAX_SKEW = 0.5;

export interface CurlyArrowAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "curlyArrow";
  readonly electrons: CurlyArrowElectrons;
  readonly source: CurlyArrowSource;
  readonly sink: CurlyArrowSink;
  /** Signed apex offset perpendicular to the chord, as a fraction of it.
   *  Positive bows to the LEFT of the tail-to-head direction, y-up. */
  readonly bulge: number;
  /** Apex position along the chord as a signed fraction of it: 0 over the
   *  midpoint, positive toward the head. Within ±`CURLY_ARROW_MAX_SKEW`. */
  readonly skew: number;
}

/**
 * A reaction arrow between species (decision 103). `from` and `to` hold ONE
 * atom per species, resolved through `species(mol)`; never empty.
 */
export interface ReactionArrowAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "reactionArrow";
  readonly from: readonly AtomId[];
  readonly to: readonly AtomId[];
  /** The scheme line the arrow is drawn on, from 0, when its species sit on
   *  different lines. Omitted — never `undefined` — for a one-line scheme. */
  readonly row?: number;
}

/** The scheme `+` between two species, one atom naming each. */
export interface PlusAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "plus";
  readonly between: readonly [AtomId, AtomId];
}

/** Square brackets around one or more species — a resonance set, a
 *  transition state — one atom naming each; never empty. */
export interface BracketAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "bracket";
  readonly species: readonly AtomId[];
}

/** Free text at an absolute position, in chem-core model units, y-up. */
export interface TextAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "text";
  readonly text: string;
  readonly at: Vec2;
}

export type SchemeAnnotation =
  | CurlyArrowAnnotation
  | ReactionArrowAnnotation
  | PlusAnnotation
  | BracketAnnotation
  | TextAnnotation;

type KindListIsTotal = SchemeAnnotation["kind"] extends SchemeAnnotationKind
  ? SchemeAnnotationKind extends SchemeAnnotation["kind"]
    ? true
    : never
  : never;
const KIND_LIST_IS_TOTAL: KindListIsTotal = true;
void KIND_LIST_IS_TOTAL;

/**
 * A drawn curly arrow IS an electron move, plus its id and shape: a list of
 * them goes straight into chem-core's `applyArrows`, `reverseArrows` and
 * `mechanismIssues` with no adapter (decision 149). The guard fails the build
 * the day a field of either side stops lining up.
 */
type CurlyArrowIsAnElectronMove = CurlyArrowAnnotation extends ElectronMove ? true : never;
const CURLY_ARROW_IS_AN_ELECTRON_MOVE: CurlyArrowIsAnElectronMove = true;
void CURLY_ARROW_IS_AN_ELECTRON_MOVE;

/**
 * An annotation as a caller or a parser hands it over: the one optional key
 * widened to admit an explicit `undefined`, the way chem-core's `AtomInit`
 * does, since that is how a maybe-value is naturally threaded.
 */
export type SchemeAnnotationInput =
  | CurlyArrowAnnotation
  | PlusAnnotation
  | BracketAnnotation
  | TextAnnotation
  | (Omit<ReactionArrowAnnotation, "row"> & { readonly row?: number | undefined });

type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];

/**
 * Compile-time guard: `row` is the only optional key of any annotation, and
 * the assembler below handles it. A second one added to a variant is then a
 * type error here rather than a key that is written as `undefined` on the
 * first decode and breaks every round-trip `toEqual`.
 */
type AssemblerCoversOptionals = {
  [K in SchemeAnnotationKind]: OptionalKeys<Extract<SchemeAnnotation, { kind: K }>>;
}[SchemeAnnotationKind] extends "row"
  ? true
  : never;
const ASSEMBLER_COVERS_OPTIONALS: AssemblerCoversOptionals = true;
void ASSEMBLER_COVERS_OPTIONALS;

function copySource(source: CurlyArrowSource): CurlyArrowSource {
  return source.kind === "bond"
    ? { kind: "bond", bondId: source.bondId }
    : { kind: source.kind, atomId: source.atomId };
}

function copySink(sink: CurlyArrowSink): CurlyArrowSink {
  return sink.kind === "bond"
    ? { kind: "bond", bondId: sink.bondId }
    : { kind: sink.kind, atomId: sink.atomId };
}

/**
 * The one place an annotation record is born, for the reason `makeAtom` is the
 * only place an atom is: built KEY BY KEY, never spread, so a parsed object's
 * present-but-`undefined` key cannot reach the document, and every array and
 * point is a fresh copy the caller cannot mutate afterwards.
 */
export function assembleSchemeAnnotation(input: SchemeAnnotationInput): SchemeAnnotation {
  switch (input.kind) {
    case "curlyArrow":
      return {
        id: input.id,
        kind: "curlyArrow",
        electrons: input.electrons,
        source: copySource(input.source),
        sink: copySink(input.sink),
        bulge: input.bulge,
        skew: input.skew,
      };
    case "reactionArrow": {
      const arrow: { -readonly [K in keyof ReactionArrowAnnotation]: ReactionArrowAnnotation[K] } =
        {
          id: input.id,
          kind: "reactionArrow",
          from: [...input.from],
          to: [...input.to],
        };
      if (input.row !== undefined) arrow.row = input.row;
      return arrow;
    }
    case "plus":
      return { id: input.id, kind: "plus", between: [input.between[0], input.between[1]] };
    case "bracket":
      return { id: input.id, kind: "bracket", species: [...input.species] };
    case "text":
      return { id: input.id, kind: "text", text: input.text, at: { x: input.at.x, y: input.at.y } };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------------------
// Anchors and visibility
// ---------------------------------------------------------------------------

/**
 * What an annotation needs a panel to have placed before it can be drawn
 * there. `frame` is the molecule's own model-unit coordinate frame, which a
 * free text label is positioned in.
 */
export type SchemeAnchor =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "frame" };

/** Atom ids an annotation names as SPECIES, in stored order. */
export function schemeSpeciesRefs(annotation: SchemeAnnotation): readonly AtomId[] {
  switch (annotation.kind) {
    case "reactionArrow":
      return [...annotation.from, ...annotation.to];
    case "plus":
      return annotation.between;
    case "bracket":
      return annotation.species;
    case "curlyArrow":
    case "text":
      return [];
    default: {
      const unreachable: never = annotation;
      return unreachable;
    }
  }
}

function endpointAnchor(end: CurlyArrowSource | CurlyArrowSink): SchemeAnchor {
  return end.kind === "bond"
    ? { kind: "bond", bondId: end.bondId }
    : { kind: "atom", atomId: end.atomId };
}

export function schemeAnnotationAnchors(annotation: SchemeAnnotation): readonly SchemeAnchor[] {
  switch (annotation.kind) {
    case "curlyArrow":
      return [endpointAnchor(annotation.source), endpointAnchor(annotation.sink)];
    case "text":
      return [{ kind: "frame" }];
    case "reactionArrow":
    case "plus":
    case "bracket":
      return schemeSpeciesRefs(annotation).map((atomId) => ({ kind: "atom", atomId }));
    default: {
      const unreachable: never = annotation;
      return unreachable;
    }
  }
}

/** What one panel has placed: the question visibility asks of it. */
export interface SchemeAnchorPlacement {
  hasAtom(atomId: AtomId): boolean;
  hasBond(bondId: BondId): boolean;
  /** True when the panel draws the molecule at its own model coordinates. */
  readonly drawsModelFrame: boolean;
}

/** True iff EVERY anchor of `annotation` resolves in `placement`. */
export function schemeAnnotationResolves(
  annotation: SchemeAnnotation,
  placement: SchemeAnchorPlacement,
): boolean {
  return schemeAnnotationAnchors(annotation).every((anchor) => {
    switch (anchor.kind) {
      case "atom":
        return placement.hasAtom(anchor.atomId);
      case "bond":
        return placement.hasBond(anchor.bondId);
      case "frame":
        return placement.drawsModelFrame;
      default: {
        const unreachable: never = anchor;
        return unreachable;
      }
    }
  });
}

/**
 * What a built scene places, read off its primitives' sources.
 *
 * An atom counts as placed when the scene draws it OR draws a bond ending at
 * it: a skeletal carbon is a vertex with no primitive of its own, and an arrow
 * aimed at it must still show. `drawsModelFrame` defaults to "the view is
 * structural", which is true of every panel today; a panel that re-projects
 * the molecule (a Newman, a Fischer) does not draw the model frame and must
 * say so, which is the one line that keeps a free label off it.
 */
export function sceneAnchorPlacement(
  scene: RenderScene,
  mol: Molecule,
  options: { readonly drawsModelFrame?: boolean | undefined } = {},
): SchemeAnchorPlacement {
  const atoms = new Set<AtomId>();
  const bonds = new Set<BondId>();
  for (const primitive of scene.primitives) {
    const source = primitive.source;
    switch (source.kind) {
      case "atom":
        atoms.add(source.atomId);
        break;
      case "bond": {
        bonds.add(source.bondId);
        const bond = Object.hasOwn(mol.bonds, source.bondId) ? mol.bonds[source.bondId] : undefined;
        if (bond !== undefined) {
          atoms.add(bond.from);
          atoms.add(bond.to);
        }
        break;
      }
      case "ring":
        for (const atomId of source.atomIds) atoms.add(atomId);
        break;
      case "hydrogen":
        atoms.add(source.hostAtomId);
        break;
      case "decoration":
        break;
      default: {
        const unreachable: never = source;
        void unreachable;
      }
    }
  }
  return {
    hasAtom: (atomId) => atoms.has(atomId),
    hasBond: (bondId) => bonds.has(bondId),
    drawsModelFrame: options.drawsModelFrame ?? isStructural(scene.representation),
  };
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/**
 * The annotations that survive a molecule edit from `before` to `after`.
 *
 * Called in the SAME undo entry as the edit, so undoing a delete brings the
 * atoms and the arrows back together. The rules:
 *
 *   - a curly arrow whose source or sink atom or bond is gone is dropped —
 *     an arrow from electrons that no longer exist states nothing;
 *   - a species reference whose atom is gone but whose species (in `before`)
 *     still has atoms is RE-POINTED to the lowest surviving one by
 *     `compareIds` (decision 103), so deleting the atom an arrow happened to
 *     be anchored by does not delete the arrow;
 *   - an annotation any of whose species is gone entirely is dropped;
 *   - text is anchored to the frame, which no molecule edit removes.
 *
 * `Object.hasOwn` throughout: an id of "constructor" must not find a record
 * up Object.prototype. Returns `annotations` itself when nothing changed, so a
 * caller can use identity to tell.
 */
export function pruneSchemeAnnotations(
  annotations: readonly SchemeAnnotation[],
  before: Molecule,
  after: Molecule,
): readonly SchemeAnnotation[] {
  if (before === after || annotations.length === 0) return annotations;
  const hasAtom = (atomId: AtomId): boolean => Object.hasOwn(after.atoms, atomId);
  const hasBond = (bondId: BondId): boolean => Object.hasOwn(after.bonds, bondId);

  /** The surviving atom a species reference now names, or `undefined`. */
  const repoint = (atomId: AtomId): AtomId | undefined => {
    if (hasAtom(atomId)) return atomId;
    const was = speciesOf(before, atomId);
    if (was === undefined) return undefined;
    let best: AtomId | undefined;
    for (const candidate of was.atomIds) {
      if (!hasAtom(candidate)) continue;
      if (best === undefined || compareIds(candidate, best) < 0) best = candidate;
    }
    return best;
  };

  /** Every ref re-pointed, or `undefined` when one species is gone. The input
   *  array itself when nothing moved. */
  const repointAll = (refs: readonly AtomId[]): readonly AtomId[] | undefined => {
    let moved = false;
    const out: AtomId[] = [];
    for (const ref of refs) {
      const image = repoint(ref);
      if (image === undefined) return undefined;
      if (image !== ref) moved = true;
      out.push(image);
    }
    return moved ? out : refs;
  };

  let changed = false;
  const kept: SchemeAnnotation[] = [];
  for (const annotation of annotations) {
    const next = pruneOne(annotation);
    if (next !== annotation) changed = true;
    if (next !== undefined) kept.push(next);
  }
  return changed ? kept : annotations;

  function pruneOne(annotation: SchemeAnnotation): SchemeAnnotation | undefined {
    switch (annotation.kind) {
      case "curlyArrow": {
        const ok = [annotation.source, annotation.sink].every((end) =>
          end.kind === "bond" ? hasBond(end.bondId) : hasAtom(end.atomId),
        );
        return ok ? annotation : undefined;
      }
      case "reactionArrow": {
        const from = repointAll(annotation.from);
        const to = repointAll(annotation.to);
        if (from === undefined || to === undefined) return undefined;
        if (from === annotation.from && to === annotation.to) return annotation;
        return assembleSchemeAnnotation({ ...annotation, from, to });
      }
      case "plus": {
        const between = repointAll(annotation.between);
        if (between === undefined) return undefined;
        if (between === annotation.between) return annotation;
        return assembleSchemeAnnotation({
          id: annotation.id,
          kind: "plus",
          between: [between[0]!, between[1]!],
        });
      }
      case "bracket": {
        const refs = repointAll(annotation.species);
        if (refs === undefined) return undefined;
        if (refs === annotation.species) return annotation;
        return assembleSchemeAnnotation({ id: annotation.id, kind: "bracket", species: refs });
      }
      case "text":
        return annotation;
      default: {
        const unreachable: never = annotation;
        return unreachable;
      }
    }
  }
}
