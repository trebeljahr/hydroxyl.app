/**
 * Scheme annotations: the things drawn BETWEEN and ON structures — curly
 * arrows, reaction arrows (forward, equilibrium, retrosynthetic, resonance),
 * plus signs, stoichiometric coefficients, brackets, a transition state's
 * partial bonds and delta labels, and free text.
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
 * and the client's does. Nothing in this module draws: `annotation/` resolves
 * the anchors to a panel's geometry and draws them, on these types.
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
import type { RenderScene, ScenePrimitive } from "../scene/types.js";

export type SchemeAnnotationId = string;

/** The id a document's counter value `n` names. */
export function schemeAnnotationId(n: number): SchemeAnnotationId {
  return `ann_${n}`;
}

/**
 * Every annotation kind, listed once. The document codec builds its enum from
 * this list, and `KindListIsTotal` below makes one more kind a compile error
 * here rather than a saved sketch the codec cannot open — the `either` bug.
 * `retrosynthesisArrow`, `resonanceArrow`, `partialBond`, `partialCharge` and
 * `coefficient` arrived additively on v2 with the reaction-arrows task
 * (decision 201).
 */
export const SCHEME_ANNOTATION_KINDS = [
  "curlyArrow",
  "reactionArrow",
  "retrosynthesisArrow",
  "resonanceArrow",
  "plus",
  "bracket",
  "text",
  "partialBond",
  "partialCharge",
  "coefficient",
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
 * Where they go: an atom, a bond, a lone pair on a named atom, or the new bond
 * `[end, atom]` between two atoms not yet bonded, drawn to their midpoint
 * (decision 166). Never "nothing": a departing pair always lands on some atom,
 * and a sink with no source mirror would leave the reversed arrow undefined
 * for heterolysis.
 */
export type CurlyArrowSink = ElectronSink;

// The lists the document codec builds its enums from, checked in both
// directions against chem-core's unions: a fourth source kind added there is
// a compile error here rather than an arrow the codec cannot open.
export const CURLY_ARROW_SOURCE_KINDS = ["lonePair", "bond", "radical"] as const;
export const CURLY_ARROW_SINK_KINDS = ["atom", "bond", "lonePair", "newBond"] as const;

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

// ---------------------------------------------------------------------------
// Reaction conditions (decision 193, spelled out by decision 202)
// ---------------------------------------------------------------------------

/**
 * The five kinds of condition item, listed once for the codec. A reagent sits
 * ABOVE a single-step arrow; everything else sits below it.
 */
export const REACTION_CONDITION_KINDS = ["reagent", "solvent", "temperature", "time", "text"] as const;
export type ReactionConditionKind = (typeof REACTION_CONDITION_KINDS)[number];

/** Degrees Celsius or kelvin. Printed `−78 °C`, `298 K`. */
export const TEMPERATURE_UNITS = ["C", "K"] as const;
export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

/**
 * Absolute zero in each unit: the codec refuses a temperature below it,
 * because no reaction runs there and a figure printing one is a typo.
 */
export const ABSOLUTE_ZERO: Readonly<Record<TemperatureUnit, number>> = Object.freeze({ C: -273.15, K: 0 });

/** Printed `45 s`, `30 min`, `2 h`, `3 d`. A time is positive. */
export const TIME_UNITS = ["s", "min", "h", "d"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

/**
 * One condition. Temperature and time are NUMBERS with a unit, so a figure
 * never prints a hyphen for a minus sign or drops a degree sign; a reagent or
 * a solvent is set as a formula (`NaBH4` with its 4 subscripted); free text is
 * printed exactly as the author typed it (decision 193).
 */
export type ReactionCondition =
  | { readonly kind: "reagent"; readonly text: string }
  | { readonly kind: "solvent"; readonly text: string }
  | { readonly kind: "temperature"; readonly value: number; readonly unit: TemperatureUnit }
  | { readonly kind: "time"; readonly value: number; readonly unit: TimeUnit }
  | { readonly kind: "text"; readonly text: string };

type ConditionKindsAreTotal = ReactionCondition["kind"] extends ReactionConditionKind
  ? ReactionConditionKind extends ReactionCondition["kind"]
    ? true
    : never
  : never;
const CONDITION_KINDS_ARE_TOTAL: ConditionKindsAreTotal = true;
void CONDITION_KINDS_ARE_TOTAL;

/** One step's items, in the order they are printed; never empty. */
export type ReactionConditionStep = readonly ReactionCondition[];

/**
 * An arrow's conditions: one or more steps, each one or more items. `numbered`
 * prefixes each step `(i)`, `(ii)` — asked for, never inferred, because a
 * two-step sequence and a one-pot mixture differ in exactly that.
 */
export interface ReactionConditions {
  readonly steps: readonly ReactionConditionStep[];
  readonly numbered: boolean;
}

/** Which half of an unequal equilibrium arrow is favoured, and so drawn longer. */
export const EQUILIBRIUM_BIASES = ["forward", "reverse"] as const;
export type EquilibriumBias = (typeof EQUILIBRIUM_BIASES)[number];

/**
 * An equilibrium: two half-headed shafts, one each way. With a `bias` the
 * favoured half is drawn longer (decision 194, after the IUPAC 2008
 * graphical-representation recommendations); without one they are equal.
 */
export interface EquilibriumArrow {
  readonly bias?: EquilibriumBias;
}

/**
 * A reaction arrow between species (decision 103): material flows FROM the
 * `from` species TO the `to` species. `from` and `to` hold ONE atom per
 * species, resolved through `species(mol)`; never empty.
 *
 * `equilibrium` makes it a pair of half-headed shafts (decision 194), and
 * `conditions` are printed above and below it (decision 193). A retrosynthetic
 * arrow and a resonance arrow are NOT variants of this: they are kinds of
 * their own (decision 201), so nothing that reads a reaction step can meet one
 * by accident.
 */
export interface ReactionArrowAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "reactionArrow";
  readonly from: readonly AtomId[];
  readonly to: readonly AtomId[];
  /** The scheme line the arrow is drawn on, from 0, when its species sit on
   *  different lines. Omitted — never `undefined` — for a one-line scheme. */
  readonly row?: number;
  readonly equilibrium?: EquilibriumArrow;
  readonly conditions?: ReactionConditions;
}

/**
 * The retrosynthetic arrow, the open double-shafted one (decision 201). It
 * points AGAINST material flow: from the `target` to the `precursors` it is
 * made from. Its own kind with its own field names, so a reader of reaction
 * steps cannot run a synthesis backwards by mistaking it for a forward arrow;
 * `materialFlow` is the one reading that turns it round.
 */
export interface RetrosynthesisArrowAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "retrosynthesisArrow";
  readonly target: readonly AtomId[];
  readonly precursors: readonly AtomId[];
  readonly row?: number;
  /** A disconnection note (`C–C`, `FGI`), laid out like a reaction's conditions. */
  readonly conditions?: ReactionConditions;
}

/**
 * The resonance arrow, a straight DOUBLE-HEADED arrow between two drawings of
 * ONE compound (decision 201). Not a reaction: an export that treated it as
 * one would claim two species where there is one. One atom names each form.
 */
export interface ResonanceArrowAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "resonanceArrow";
  readonly between: readonly [AtomId, AtomId];
}

/** The scheme `+` between two species, one atom naming each. */
export interface PlusAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "plus";
  readonly between: readonly [AtomId, AtomId];
}

/**
 * Square brackets around one or more species — a resonance set, a
 * transition state — one atom naming each; never empty.
 *
 * `charge` is the net charge printed as a superscript outside the closing
 * bracket, top right (decision 194); a non-zero integer. `transitionState`
 * adds the double dagger there (decision 204).
 */
export interface BracketAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "bracket";
  readonly species: readonly AtomId[];
  readonly charge?: number;
  readonly transitionState?: true;
}

/** Free text at an absolute position, in chem-core model units, y-up. */
export interface TextAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "text";
  readonly text: string;
  /** Where the text is CENTRED: horizontally, and on its cap band (decision 204). */
  readonly at: Vec2;
}

/**
 * A transition state's partial bond, drawn DASHED between two atoms
 * (decision 201). An annotation, not a bond order: chem-core's valence knows
 * nothing of it, so the fragments a transition state is drawn from are
 * ordinarily left unbonded where the partial bond runs.
 */
export interface PartialBondAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "partialBond";
  readonly atoms: readonly [AtomId, AtomId];
}

export const PARTIAL_CHARGE_SIGNS = ["+", "-"] as const;
export type PartialChargeSign = (typeof PARTIAL_CHARGE_SIGNS)[number];

/**
 * delta+ or delta− on an atom (decision 205): placed through the shared label
 * pass, like a descriptor, and printed with a real minus. At most one per atom.
 */
export interface PartialChargeAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "partialCharge";
  readonly atomId: AtomId;
  readonly sign: PartialChargeSign;
}

/**
 * The stoichiometric coefficient printed before a species: the 2 of
 * `2 H2 + O2 -> 2 H2O`. A positive number; one atom names the species.
 */
export interface CoefficientAnnotation {
  readonly id: SchemeAnnotationId;
  readonly kind: "coefficient";
  readonly species: AtomId;
  readonly value: number;
}

export type SchemeAnnotation =
  | CurlyArrowAnnotation
  | ReactionArrowAnnotation
  | RetrosynthesisArrowAnnotation
  | ResonanceArrowAnnotation
  | PlusAnnotation
  | BracketAnnotation
  | TextAnnotation
  | PartialBondAnnotation
  | PartialChargeAnnotation
  | CoefficientAnnotation;

type KindListIsTotal = SchemeAnnotation["kind"] extends SchemeAnnotationKind
  ? SchemeAnnotationKind extends SchemeAnnotation["kind"]
    ? true
    : never
  : never;
const KIND_LIST_IS_TOTAL: KindListIsTotal = true;
void KIND_LIST_IS_TOTAL;

/**
 * A retrosynthetic or a resonance arrow is not a forward reaction arrow, and
 * the compiler says so: neither is assignable to `ReactionArrowAnnotation`,
 * so no function typed to take a reaction step can be handed one.
 */
type NotAReactionStep<T> = T extends ReactionArrowAnnotation ? never : true;
const RETRO_IS_NOT_A_STEP: NotAReactionStep<RetrosynthesisArrowAnnotation> = true;
const RESONANCE_IS_NOT_A_STEP: NotAReactionStep<ResonanceArrowAnnotation> = true;
void RETRO_IS_NOT_A_STEP;
void RESONANCE_IS_NOT_A_STEP;

/**
 * A drawn curly arrow IS an electron move, plus its id and shape: a list of
 * them goes straight into chem-core's `applyArrows`, `reverseArrows` and
 * `mechanismIssues` with no adapter (decision 149). The guard fails the build
 * the day a field of either side stops lining up.
 */
type CurlyArrowIsAnElectronMove = CurlyArrowAnnotation extends ElectronMove ? true : never;
const CURLY_ARROW_IS_AN_ELECTRON_MOVE: CurlyArrowIsAnElectronMove = true;
void CURLY_ARROW_IS_AN_ELECTRON_MOVE;

/** What an arrow says about material, read by `materialFlow`. */
export interface MaterialFlow {
  /** One atom per species consumed. */
  readonly reactants: readonly AtomId[];
  /** One atom per species made. */
  readonly products: readonly AtomId[];
  /** An equilibrium runs both ways. */
  readonly reversible: boolean;
}

/**
 * The species an arrow consumes and makes, or `undefined` when it says nothing
 * of the kind.
 *
 * THE ONE READING an exporter or a stoichiometry pass should use (decision
 * 201). A forward arrow and an equilibrium read `from -> to` (an equilibrium
 * is `reversible`); a retrosynthetic arrow is turned round, `precursors ->
 * target`, because it points against the flow; a resonance arrow, a plus, a
 * bracket and the rest read `undefined` — a resonance pair is one compound,
 * not a reaction.
 */
export function materialFlow(annotation: SchemeAnnotation): MaterialFlow | undefined {
  switch (annotation.kind) {
    case "reactionArrow":
      return {
        reactants: annotation.from,
        products: annotation.to,
        reversible: annotation.equilibrium !== undefined,
      };
    case "retrosynthesisArrow":
      return { reactants: annotation.precursors, products: annotation.target, reversible: false };
    case "resonanceArrow":
    case "curlyArrow":
    case "plus":
    case "bracket":
    case "text":
    case "partialBond":
    case "partialCharge":
    case "coefficient":
      return undefined;
    default: {
      const unreachable: never = annotation;
      return unreachable;
    }
  }
}

/** An equilibrium as a caller hands it over: `bias` may be an explicit undefined. */
export interface EquilibriumArrowInput {
  readonly bias?: EquilibriumBias | undefined;
}

/**
 * An annotation as a caller or a parser hands it over: every optional key
 * widened to admit an explicit `undefined`, the way chem-core's `AtomInit`
 * does, since that is how a maybe-value is naturally threaded.
 */
export type SchemeAnnotationInput =
  | CurlyArrowAnnotation
  | PlusAnnotation
  | TextAnnotation
  | ResonanceArrowAnnotation
  | PartialBondAnnotation
  | PartialChargeAnnotation
  | CoefficientAnnotation
  | (Omit<ReactionArrowAnnotation, "row" | "equilibrium" | "conditions"> & {
      readonly row?: number | undefined;
      readonly equilibrium?: EquilibriumArrowInput | undefined;
      readonly conditions?: ReactionConditions | undefined;
    })
  | (Omit<RetrosynthesisArrowAnnotation, "row" | "conditions"> & {
      readonly row?: number | undefined;
      readonly conditions?: ReactionConditions | undefined;
    })
  | (Omit<BracketAnnotation, "charge" | "transitionState"> & {
      readonly charge?: number | undefined;
      readonly transitionState?: true | undefined;
    });

type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];

/** Every optional key of every annotation: each one the assembler handles. */
type AssembledOptionals = "row" | "equilibrium" | "conditions" | "charge" | "transitionState";

/**
 * Compile-time guard: the optional keys of the annotations are exactly the
 * ones the assembler below handles. One more added to a variant is then a
 * type error here rather than a key that is written as `undefined` on the
 * first decode and breaks every round-trip `toEqual`.
 */
type AssemblerCoversOptionals = {
  [K in SchemeAnnotationKind]: OptionalKeys<Extract<SchemeAnnotation, { kind: K }>>;
}[SchemeAnnotationKind] extends AssembledOptionals
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
  switch (sink.kind) {
    case "bond":
      return { kind: "bond", bondId: sink.bondId };
    case "newBond":
      return { kind: "newBond", atomIds: [sink.atomIds[0], sink.atomIds[1]] };
    default:
      return { kind: sink.kind, atomId: sink.atomId };
  }
}

function copyCondition(item: ReactionCondition): ReactionCondition {
  switch (item.kind) {
    case "temperature":
      return { kind: "temperature", value: item.value, unit: item.unit };
    case "time":
      return { kind: "time", value: item.value, unit: item.unit };
    case "reagent":
    case "solvent":
    case "text":
      return { kind: item.kind, text: item.text };
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

function copyConditions(conditions: ReactionConditions): ReactionConditions {
  return {
    steps: conditions.steps.map((step) => step.map(copyCondition)),
    numbered: conditions.numbered,
  };
}

function copyEquilibrium(equilibrium: EquilibriumArrowInput): EquilibriumArrow {
  return equilibrium.bias === undefined ? {} : { bias: equilibrium.bias };
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
      if (input.equilibrium !== undefined) arrow.equilibrium = copyEquilibrium(input.equilibrium);
      if (input.conditions !== undefined) arrow.conditions = copyConditions(input.conditions);
      return arrow;
    }
    case "retrosynthesisArrow": {
      const arrow: {
        -readonly [K in keyof RetrosynthesisArrowAnnotation]: RetrosynthesisArrowAnnotation[K];
      } = {
        id: input.id,
        kind: "retrosynthesisArrow",
        target: [...input.target],
        precursors: [...input.precursors],
      };
      if (input.row !== undefined) arrow.row = input.row;
      if (input.conditions !== undefined) arrow.conditions = copyConditions(input.conditions);
      return arrow;
    }
    case "resonanceArrow":
      return { id: input.id, kind: "resonanceArrow", between: [input.between[0], input.between[1]] };
    case "plus":
      return { id: input.id, kind: "plus", between: [input.between[0], input.between[1]] };
    case "bracket": {
      const bracket: { -readonly [K in keyof BracketAnnotation]: BracketAnnotation[K] } = {
        id: input.id,
        kind: "bracket",
        species: [...input.species],
      };
      if (input.charge !== undefined) bracket.charge = input.charge;
      if (input.transitionState !== undefined) bracket.transitionState = input.transitionState;
      return bracket;
    }
    case "text":
      return { id: input.id, kind: "text", text: input.text, at: { x: input.at.x, y: input.at.y } };
    case "partialBond":
      return { id: input.id, kind: "partialBond", atoms: [input.atoms[0], input.atoms[1]] };
    case "partialCharge":
      return { id: input.id, kind: "partialCharge", atomId: input.atomId, sign: input.sign };
    case "coefficient":
      return { id: input.id, kind: "coefficient", species: input.species, value: input.value };
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
    case "retrosynthesisArrow":
      return [...annotation.target, ...annotation.precursors];
    case "resonanceArrow":
    case "plus":
      return annotation.between;
    case "bracket":
      return annotation.species;
    case "coefficient":
      return [annotation.species];
    // These name ATOMS, not species: an arrow's electrons, a partial bond's
    // two ends and a delta's atom are dropped with their atom, not re-pointed.
    case "curlyArrow":
    case "partialBond":
    case "partialCharge":
    case "text":
      return [];
    default: {
      const unreachable: never = annotation;
      return unreachable;
    }
  }
}

/** What one end of a curly arrow names: a new bond names BOTH its atoms. */
function endpointAnchors(end: CurlyArrowSource | CurlyArrowSink): readonly SchemeAnchor[] {
  switch (end.kind) {
    case "bond":
      return [{ kind: "bond", bondId: end.bondId }];
    case "newBond":
      return end.atomIds.map((atomId) => ({ kind: "atom", atomId }));
    default:
      return [{ kind: "atom", atomId: end.atomId }];
  }
}

export function schemeAnnotationAnchors(annotation: SchemeAnnotation): readonly SchemeAnchor[] {
  switch (annotation.kind) {
    case "curlyArrow":
      return [...endpointAnchors(annotation.source), ...endpointAnchors(annotation.sink)];
    case "text":
      return [{ kind: "frame" }];
    case "partialBond":
      return annotation.atoms.map((atomId) => ({ kind: "atom", atomId }));
    case "partialCharge":
      return [{ kind: "atom", atomId: annotation.atomId }];
    case "reactionArrow":
    case "retrosynthesisArrow":
    case "resonanceArrow":
    case "plus":
    case "bracket":
    case "coefficient":
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
  return anchorPlacementOf(
    scene.primitives,
    mol,
    options.drawsModelFrame ?? isStructural(scene.representation),
  );
}

/**
 * `sceneAnchorPlacement` over a primitive list rather than a finished scene:
 * what `buildScene`'s own annotation layer asks of the primitives it has
 * emitted so far, so the arrows it then draws obey the same rule a caller
 * reading the finished scene would apply.
 */
export function anchorPlacementOf(
  primitives: readonly ScenePrimitive[],
  mol: Molecule,
  drawsModelFrame: boolean,
): SchemeAnchorPlacement {
  const atoms = new Set<AtomId>();
  const bonds = new Set<BondId>();
  for (const primitive of primitives) {
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
      case "projected":
        // A node standing for ONE atom draws it (a condensed CH3, or a
        // synthetic H, whose one atom is its centre). A condensed group of
        // several draws none of them anywhere an arrow could point: the O of
        // a Fischer's "CH2OH" is a letter in a word, not a place.
        if (source.atomIds.length === 1) atoms.add(source.atomIds[0]!);
        break;
      case "annotation":
        // Another annotation places nothing an annotation could anchor to.
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
    drawsModelFrame,
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
 *   - a curly arrow whose source or sink atom or bond is gone (either atom
 *     of a new-bond sink) is dropped — an arrow from electrons that no
 *     longer exist states nothing;
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
        // Every atom and bond it names, both atoms of a new-bond sink included.
        const ok = schemeAnnotationAnchors(annotation).every((anchor) =>
          anchor.kind === "atom"
            ? hasAtom(anchor.atomId)
            : anchor.kind === "bond"
              ? hasBond(anchor.bondId)
              : true,
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
      case "retrosynthesisArrow": {
        const target = repointAll(annotation.target);
        const precursors = repointAll(annotation.precursors);
        if (target === undefined || precursors === undefined) return undefined;
        if (target === annotation.target && precursors === annotation.precursors) return annotation;
        return assembleSchemeAnnotation({ ...annotation, target, precursors });
      }
      case "resonanceArrow": {
        const between = repointAll(annotation.between);
        if (between === undefined) return undefined;
        if (between === annotation.between) return annotation;
        return assembleSchemeAnnotation({
          id: annotation.id,
          kind: "resonanceArrow",
          between: [between[0]!, between[1]!],
        });
      }
      case "coefficient": {
        const species = repoint(annotation.species);
        if (species === undefined) return undefined;
        if (species === annotation.species) return annotation;
        return assembleSchemeAnnotation({ ...annotation, species });
      }
      case "partialBond":
        return annotation.atoms.every(hasAtom) ? annotation : undefined;
      case "partialCharge":
        return hasAtom(annotation.atomId) ? annotation : undefined;
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
        return assembleSchemeAnnotation({ ...annotation, species: refs });
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
