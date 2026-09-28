/**
 * The sketch document — what gets saved, loaded, dropped onto the canvas and
 * pushed onto the undo stack.
 *
 * A document holds exactly ONE `Molecule`. Disconnected fragments are that
 * molecule's separate structures, not separate documents; the panels are
 * alternative REPRESENTATIONS of the same molecule (skeletal, Kekule, sum
 * formula, ...), which is the whole point of the product: draw once, show it
 * every way a figure needs.
 *
 * A REACTION SCHEME IS STILL ONE MOLECULE. Its species are the molecule's
 * connected components, joined where `Molecule.speciesJoins` says several
 * are one compound (decision 102; chem-core's species.ts carries the costs and
 * the two outs). What is drawn between and on them — curly arrows, reaction
 * arrows, plus signs, brackets, free text — is `annotations`, a sibling of the
 * molecule typed in chem-render and positioned only by reference to atoms,
 * bonds and species, or in chem-core model units.
 *
 * Two rules govern everything below.
 *
 * 1. NO KEY IS EVER PRESENT WITH THE VALUE `undefined`. Not in a decoded
 *    document, not in an encoded one. `{ isotope: undefined }` and `{}` are
 *    different objects to `toEqual`, to `Object.keys`, to `JSON.stringify`
 *    and to React's referential comparisons, so letting the two forms mix
 *    means a molecule stops comparing equal to itself across a save/load
 *    round trip, and an undo entry that should be a no-op is not. Every
 *    optional field is therefore assembled by hand — atoms through
 *    chem-core's `makeAtom`, panels and metadata through the local
 *    assemblers — and never by spreading a parsed object.
 *
 * 2. INPUT IS UNTRUSTED. A document arrives from localStorage, a dropped
 *    file, or a URL someone pasted. The zod schemas therefore validate
 *    structural integrity (dangling bond endpoints, id lists that disagree
 *    with the records they index, a `nextId` that would hand out an id
 *    already in use) and report it as zod issues, so a caller sees one
 *    `ZodError` listing every problem rather than a `TypeError` thrown from
 *    deep inside a traversal three frames later.
 */

import {
  makeAtom,
  emptyMolecule,
  withSpeciesJoins,
  type Atom,
  type AtomId,
  type Bond,
  type BondId,
  type BondOrder,
  type BondStereo,
  type DoubleBondSide,
  type Molecule,
  type StereoGroup,
  type StereoGroupKind,
} from "@starter/chem-core";
import {
  CURLY_ARROW_ELECTRONS,
  CURLY_ARROW_MAX_SKEW,
  CURLY_ARROW_SINK_KINDS,
  CURLY_ARROW_SOURCE_KINDS,
  DISPLAY_FLAG_KEYS,
  SCHEME_ANNOTATION_KINDS,
  VIEW_KINDS,
  assembleSchemeAnnotation,
  defaultFlagsFor,
  schemeAnnotationId,
  type DisplayFlagKey,
  type DisplayFlags,
  type SchemeAnnotation,
  type SchemeAnnotationId,
  type SchemeAnnotationInput,
  type ViewKind,
} from "@starter/chem-render";
import { z } from "zod";

/**
 * Bumped when the on-disk shape changes incompatibly. A document carrying a
 * higher number is rejected rather than half-understood — silently dropping
 * fields we do not know about is how a save turns into data loss.
 *
 * 2 IS THE SCHEME MODEL, and the ONLY bump the projection and mechanism plan
 * makes: `annotations` and `nextAnnotationId` arrived with it. A v1 document
 * is upgraded by `DOCUMENT_UPGRADES[1]` before it meets the schema, which
 * accepts exactly this version and nothing older — an unmigrated v1 value is
 * refused by name rather than decoded short of two fields.
 *
 * UNKNOWN KEYS ARE REFUSED, NOT STRIPPED (decision 110, closing 38). Every
 * object in the schema is strict. Before v2 the codec stripped a key it did
 * not know, so a tab on an older build that opened a newer document dropped
 * the newer field and autosave wrote the loss back — measured for a display
 * flag, and for a whole enhanced-stereo collection, which re-saved a racemate
 * as one enantiomer. Additive optional keys on v2 (`Panel.view` is the next
 * one planned) would repeat that for every future feature. A strict decode
 * turns it into "written by a newer version of the editor", which loses
 * nothing. The only key accepted without being understood is a RETIRED one,
 * listed by name: `showAtomIndices`.
 */
export const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** `publication` is ACS-like (thin bonds, serif labels); `screen` is the editor. */
export type StylePresetId = "publication" | "screen";

/**
 * THE VIEW KINDS AND THE DISPLAY FLAGS ARE CHEM-RENDER'S, IMPORTED (decision
 * 10).
 *
 * They used to be declared here as well, and the two declarations had already
 * drifted: the document knew four flags and the renderer eight, so a chemist
 * who turned on `showImplicitHydrogens`, `showCharges`, `showStereoBonds` or
 * `showAtomIndices` (since renamed `showLocants`) could not SAVE it. The flag
 * set belongs where the drawing happens — a flag exists the moment a render
 * pass can honour it — and the codec's job is to persist whatever that set
 * currently is, not to hold an opinion about it.
 *
 * The aliases are kept because the document's vocabulary reads better in a
 * file format ("this panel's representation and its display") and because
 * every existing caller names them this way. They are the same types, not
 * copies: `RepresentationDisplay` IS `DisplayFlags`, so there is nothing left
 * to drift.
 */
export type RepresentationKind = ViewKind;

/**
 * Orthogonal display switches. They only mean anything for the four
 * structural 2D views (`skeletal`, `kekule`, `explicitH`, `lewis`) — there is
 * nowhere to draw a lone pair on a sum formula — but they are stored for
 * every panel so that flipping a panel's kind back and forth does not lose
 * the settings the chemist had chosen.
 */
export type RepresentationDisplay = DisplayFlags;

export { DISPLAY_FLAG_KEYS, VIEW_KINDS };
export type { DisplayFlagKey };

/**
 * Assembles a full flag set, KEY BY KEY, from a possibly-partial one.
 *
 * Driven by `DISPLAY_FLAG_KEYS` rather than written out, so a flag added to
 * chem-render becomes persistable here with no edit at all — which is the
 * whole point of decision 10. A key the input does not carry (an older saved
 * document, written before that flag existed) falls back to the kind's own
 * default rather than to `false`: a document saved before `showCharges` was
 * persistable never meant "hide the charges".
 *
 * `??`, not `||`: `false` is a legitimate stored value and must survive.
 */
export function assembleDisplay(
  kind: RepresentationKind,
  // Optionals widened to admit an explicit `undefined`, as `PanelInit` does:
  // under `exactOptionalPropertyTypes` a bare `Partial` rejects the parsed
  // zod object, whose absent keys arrive as present-and-undefined.
  partial: { readonly [K in DisplayFlagKey]?: boolean | undefined } | undefined,
): RepresentationDisplay {
  const base = defaultFlagsFor(kind);
  const display = {} as { -readonly [K in DisplayFlagKey]: boolean };
  for (const key of DISPLAY_FLAG_KEYS) display[key] = partial?.[key] ?? base[key];
  return display;
}

export interface Representation {
  readonly kind: RepresentationKind;
  readonly display: RepresentationDisplay;
}

export type PanelId = string;

export interface Panel {
  readonly id: PanelId;
  readonly representation: Representation;
  /** Figure caption. The key is OMITTED when there is none, never `undefined`. */
  readonly caption?: string;
}

export interface DocumentMetadata {
  readonly title: string;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601. */
  readonly modifiedAt: string;
  readonly author?: string;
  readonly notes?: string;
}

/**
 * How the panels are laid out when they are exported as one figure.
 *
 * FIGURE-LEVEL, not per panel and not on the molecule (decision 12 keeps view
 * state off the molecule). The key is OMITTED when the document has never set
 * a layout, and the renderer then picks a default from the panel count; that
 * is what lets this land without a schema version bump — a document written
 * before the field existed decodes to exactly what it always meant.
 */
export interface FigureLayout {
  /** Panels per row, at least 1. */
  readonly columns: number;
}

/** Upper bound on `FigureLayout.columns`. A wider grid is not a figure. */
export const MAX_FIGURE_COLUMNS = 12;

export interface SketchDocument {
  readonly schemaVersion: number;
  readonly id: string;
  readonly molecule: Molecule;
  /**
   * What is drawn between and on the species (see chem-render's
   * scheme/annotation.ts). Always present, `[]` when there is none — the
   * document-level list is not an optional statement the way a molecule's
   * stereo groups are, and a required key is one fewer spelling.
   *
   * Part of the document, so it rides in every undo snapshot with the
   * molecule; `UndoableState` does not and must not grow a field for it.
   */
  readonly annotations: readonly SchemeAnnotation[];
  /**
   * The annotation id counter: the next annotation is `ann_<nextAnnotationId>`.
   * Monotonic and never reused, for the reason `Molecule.nextId` is — a stale
   * id held by a selection or a gesture in flight must never resolve to a
   * different arrow. Separate from the molecule's counter because that one's
   * suffix rule belongs to atoms and bonds (decision 111).
   */
  readonly nextAnnotationId: number;
  readonly stylePreset: StylePresetId;
  readonly panels: readonly Panel[];
  /** Omitted, never `undefined`, when no layout has been chosen. */
  readonly figure?: FigureLayout;
  readonly metadata: DocumentMetadata;
}

// ---------------------------------------------------------------------------
// Assemblers
//
// The only places a `Panel` or a `DocumentMetadata` record is born, for the
// same reason `makeAtom` is the only place an `Atom` is born: an optional key
// has to be omitted rather than assigned `undefined`, and since every one of
// them is optional, TypeScript cannot flag a hand-rolled copy that forgets a
// field — it just compiles, and the field vanishes.
// ---------------------------------------------------------------------------

/** Optionals widened to admit an explicit `undefined` meaning "no such key",
 *  the way `AtomInit` does in chem-core: under `exactOptionalPropertyTypes` a
 *  bare `caption?: string` rejects `{ caption: hasCaption ? text : undefined }`,
 *  which is how a caller threading a maybe-value naturally writes it. */
export interface PanelInit {
  readonly representation: Representation;
  readonly caption?: string | undefined;
}

function assemblePanel(id: PanelId, init: PanelInit): Panel {
  const panel: { -readonly [K in keyof Panel]: Panel[K] } = {
    id,
    representation: {
      kind: init.representation.kind,
      display: assembleDisplay(
        init.representation.kind,
        init.representation.display,
      ),
    },
  };
  if (init.caption !== undefined) panel.caption = init.caption;
  return panel;
}

export interface DocumentMetadataInit {
  readonly title: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly author?: string | undefined;
  readonly notes?: string | undefined;
}

function assembleMetadata(init: DocumentMetadataInit): DocumentMetadata {
  const metadata: { -readonly [K in keyof DocumentMetadata]: DocumentMetadata[K] } =
    {
      title: init.title,
      createdAt: init.createdAt,
      modifiedAt: init.modifiedAt,
    };
  if (init.author !== undefined) metadata.author = init.author;
  if (init.notes !== undefined) metadata.notes = init.notes;
  return metadata;
}

/**
 * Compile-time guard: every optional key of `Panel` / `DocumentMetadata` must
 * appear in the corresponding init type. Adding one to the interface without
 * teaching the assembler about it is then a type error here, rather than a
 * field that quietly disappears from every decoded document.
 */
type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];
type AssemblersAreComplete = OptionalKeys<Panel> extends keyof PanelInit
  ? OptionalKeys<DocumentMetadata> extends keyof DocumentMetadataInit
    ? true
    : never
  : never;
const ASSEMBLERS_ARE_COMPLETE: AssemblersAreComplete = true;
void ASSEMBLERS_ARE_COMPLETE;

// ---------------------------------------------------------------------------
// Defaults and factories
// ---------------------------------------------------------------------------

/**
 * The display flags a panel of this kind opens with.
 *
 * THE DEFAULTS COME FROM CHEM-RENDER (decision 10), through
 * `defaultFlagsFor`. They used to be restated here — "carbon labels only for
 * explicitH, lone pairs only for lewis" — and the restatement disagreed with
 * the renderer's own table on two kinds, so the same view looked different
 * depending on whether it reached the canvas through a saved document or
 * through `representation(kind)` in a test. A drawing convention is part of
 * the drawing vocabulary; the codec's job is to store the answer, not to have
 * one.
 *
 * The preset still gets a say, through `AROMATIC_CIRCLES_BY_PRESET` below.
 */
export function defaultRepresentation(
  kind: RepresentationKind,
  preset: StylePresetId = "screen",
): Representation {
  const base = defaultFlagsFor(kind);
  const seed = AROMATIC_CIRCLES_BY_PRESET[preset];
  return {
    kind,
    display: assembleDisplay(
      kind,
      seed === "kind" ? base : { ...base, aromaticCircles: seed },
    ),
  };
}

/**
 * Where the circle-versus-Kekule choice gets its INITIAL value, when the
 * preset has an opinion at all.
 *
 * The choice itself is per panel — `RepresentationDisplay.aromaticCircles` —
 * because a figure has to be able to say "this one draws the circle", which a
 * preset-wide setting cannot express. The preset only seeds it, and a saved
 * document keeps whatever it stored.
 *
 * BOTH SHIPPED PRESETS NOW DEFER TO THE VIEW KIND (`"kind"`), which after
 * decision 11 is what actually distinguishes skeletal from Kekulé: with
 * Kekulé's carbon labels gone, the circle is the only thing left that tells
 * the two views apart, so a preset-wide "circles off" would collapse them
 * back into the same picture. The table survives because it is still the
 * declared home of a house style that prints one or the other regardless of
 * view — a third preset adds a row here with a plain boolean and changes
 * nothing else.
 */
const AROMATIC_CIRCLES_BY_PRESET: Readonly<
  Record<StylePresetId, boolean | "kind">
> = Object.freeze({
  publication: "kind",
  screen: "kind",
});

/**
 * The panels a fresh document opens with: the structure you draw into, and
 * the formula that tells you at a glance whether it is the compound you meant.
 */
export const DEFAULT_PANELS: readonly Panel[] = defaultPanelsFor("screen");

/**
 * The opening panels seeded from a style preset.
 *
 * `DEFAULT_PANELS` is the "screen" case, kept as a named constant because
 * plenty of code and several tests compare against it by value. A document
 * created under another preset gets its own set, so the preset's
 * circle-versus-Kekule convention actually reaches the panels rather than
 * being applied to a constant that was frozen before the preset was chosen.
 */
export function defaultPanelsFor(preset: StylePresetId): readonly Panel[] {
  return Object.freeze([
    assemblePanel("panel-skeletal", {
      representation: defaultRepresentation("skeletal", preset),
    }),
    assemblePanel("panel-sum-formula", {
      representation: defaultRepresentation("sumFormula", preset),
    }),
  ]);
}

/**
 * Monotonic within the process, and mixed with randomness so two tabs editing
 * the same file do not mint the same id.
 *
 * Deliberately not `crypto.randomUUID()`: this package compiles against
 * `lib: ES2022` with no DOM types, and `crypto` is absent from a non-secure
 * browser context. These ids identify a document or a panel in a file — they
 * are not security tokens, so a collision-unlikely string is enough.
 */
let idCounter = 0;
function generateId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${random}`;
}

/** A new panel with a fresh unique id. Panel ids only need to be unique
 *  within one document, but a generated one keeps a second `skeletal` panel
 *  from colliding with `DEFAULT_PANELS`. */
export function createPanel(
  kind: RepresentationKind,
  caption?: string,
  preset: StylePresetId = "screen",
): Panel {
  return assemblePanel(generateId("panel"), {
    representation: defaultRepresentation(kind, preset),
    caption,
  });
}

export interface CreateDocumentInit {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly molecule?: Molecule | undefined;
  /** With their ids already chosen — the injectable path a fixture takes, so
   *  a document holding an arrow is byte-stable across runs. */
  readonly annotations?: readonly SchemeAnnotationInput[] | undefined;
  /** Defaults to one past the highest `ann_<n>` among `annotations`. */
  readonly nextAnnotationId?: number | undefined;
  readonly stylePreset?: StylePresetId | undefined;
  readonly panels?: readonly Panel[] | undefined;
  readonly figure?: FigureLayout | undefined;
  /** Injectable ISO-8601 "now", so tests are deterministic and an importer
   *  can stamp a document with the file's own timestamp. */
  readonly now?: string | undefined;
}

export function createDocument(init: CreateDocumentInit = {}): SketchDocument {
  const now = init.now ?? new Date().toISOString();
  const stylePreset = init.stylePreset ?? "screen";
  const molecule = init.molecule ?? emptyMolecule();
  const annotations = (init.annotations ?? []).map(assembleSchemeAnnotation);
  for (const annotation of annotations) requireAnchorsIn(molecule, annotation);
  const doc: SketchDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: init.id ?? generateId("doc"),
    molecule,
    annotations,
    nextAnnotationId:
      init.nextAnnotationId ??
      annotations.reduce((next, a) => Math.max(next, (idSuffix(a.id) ?? 0) + 1), 1),
    stylePreset,
    // Seeded from the preset, so a display default the preset owns — the
    // aromatic circle — reaches the panels a document opens with.
    panels:
      init.panels ??
      (stylePreset === "screen" ? DEFAULT_PANELS : defaultPanelsFor(stylePreset)),
    metadata: assembleMetadata({
      title: init.title ?? "Untitled",
      createdAt: now,
      modifiedAt: now,
    }),
  };
  // Assigned only when present, so a document with no layout has no key.
  return init.figure === undefined ? doc : withFigureLayout(doc, init.figure);
}

/**
 * `doc` with its figure layout replaced, or removed with `null`. The one
 * place a `figure` key is written, so it is never `undefined`-valued and the
 * column count is always a whole number in range.
 */
export function withFigureLayout(
  doc: SketchDocument,
  layout: FigureLayout | null,
): SketchDocument {
  const { figure: _previous, ...rest } = doc;
  void _previous;
  if (layout === null) return rest;
  const columns = Math.max(1, Math.min(MAX_FIGURE_COLUMNS, Math.floor(layout.columns)));
  if (!Number.isFinite(columns)) return rest;
  return { ...rest, figure: { columns } };
}

/** An annotation as a caller adds one: everything but the id, which the
 *  document's counter mints. */
export type SchemeAnnotationDraft = SchemeAnnotationInput extends infer T
  ? T extends unknown
    ? Omit<T, "id">
    : never
  : never;

/**
 * Throws unless every atom and bond `annotation` names is in `molecule`.
 *
 * A programming error at this end — the codec reports the same condition in a
 * FILE as a listed issue, because a file is untrusted and a caller is not.
 * `Object.hasOwn`, never an index read: "constructor" is not an atom.
 */
function requireAnchorsIn(molecule: Molecule, annotation: SchemeAnnotation): void {
  const missing = danglingReferences(molecule, annotation);
  if (missing.length > 0) {
    throw new Error(
      `Annotation ${annotation.id} names ${missing.join(", ")}, which the molecule ` +
        `does not hold. A dangling annotation is a document that cannot be saved.`,
    );
  }
}

/** Ids `annotation` names that `molecule` does not hold. */
function danglingReferences(molecule: Molecule, annotation: SchemeAnnotation): string[] {
  const missing: string[] = [];
  const atom = (id: string): void => {
    if (!Object.hasOwn(molecule.atoms, id)) missing.push(id);
  };
  const bond = (id: string): void => {
    if (!Object.hasOwn(molecule.bonds, id)) missing.push(id);
  };
  switch (annotation.kind) {
    case "curlyArrow":
      for (const end of [annotation.source, annotation.sink]) {
        if (end.kind === "bond") bond(end.bondId);
        else atom(end.atomId);
      }
      break;
    case "reactionArrow":
      for (const id of [...annotation.from, ...annotation.to]) atom(id);
      break;
    case "plus":
      for (const id of annotation.between) atom(id);
      break;
    case "bracket":
      for (const id of annotation.species) atom(id);
      break;
    case "text":
      break;
    default: {
      const unreachable: never = annotation;
      void unreachable;
    }
  }
  return missing;
}

/**
 * `doc` with one more annotation, its id minted from the document's counter.
 *
 * The one place an id is minted, so ids stay monotonic and never reused, and
 * a fixture that adds arrows in a fixed order gets the same ids every run.
 *
 * @throws if the draft names an atom or bond the molecule does not hold.
 */
export function addSchemeAnnotation(
  doc: SketchDocument,
  draft: SchemeAnnotationDraft,
): { readonly document: SketchDocument; readonly id: SchemeAnnotationId } {
  const id = schemeAnnotationId(doc.nextAnnotationId);
  const annotation = assembleSchemeAnnotation({ ...draft, id } as SchemeAnnotationInput);
  requireAnchorsIn(doc.molecule, annotation);
  return {
    document: {
      ...doc,
      annotations: [...doc.annotations, annotation],
      nextAnnotationId: doc.nextAnnotationId + 1,
    },
    id,
  };
}

/**
 * Stamp a document as modified. Spreading `metadata` is safe precisely
 * because nothing in this module ever stores an `undefined`-valued key — a
 * spread copies own keys, so absent optionals stay absent.
 */
export function touchDocument(
  doc: SketchDocument,
  now: string = new Date().toISOString(),
): SketchDocument {
  return { ...doc, metadata: { ...doc.metadata, modifiedAt: now } };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// `z.number()` in zod 4 already rejects NaN and Infinity, so a coordinate that
// survives this is safe to hand to layout maths.
// EVERY OBJECT BELOW IS STRICT (decision 110): a key this build does not know
// fails the decode instead of being stripped, so a newer build's field cannot
// be lost by an older tab re-saving the document. See `SCHEMA_VERSION`.
const vec2Schema = z.strictObject({ x: z.number(), y: z.number() });

const nonEmptyString = z.string().min(1);

/**
 * ISO-8601 instant. Checked with a regex AND `Date.parse`, because the regex
 * alone accepts `2024-02-31T00:00:00Z` — a date that does not exist.
 */
const isoTimestampSchema = nonEmptyString.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value)),
  { message: "expected an ISO-8601 timestamp" },
);

const atomSchema = z.strictObject({
  id: nonEmptyString,
  // Element symbols are validated by chem-core's periodic table, not here:
  // the document format has to survive a placeholder like "R" or an element
  // this build's table has not heard of, and refusing to load the file is a
  // harsher failure than showing an unknown symbol.
  element: nonEmptyString,
  pos: vec2Schema,
  charge: z.number().int(),
  radicalElectrons: z.number().int().min(0),
  aromatic: z.boolean(),
  // A mass number, so at least the proton count of the element.
  isotope: z.number().int().positive().optional(),
  explicitHydrogenCount: z.number().int().min(0).optional(),
  // Decision 4's per-atom lone-pair override. Persisted because it is the one
  // thing about a Lewis structure the model cannot re-derive: a sulfone's
  // sulfur reads zero pairs expanded-octet and two charge-separated, and a
  // chemist who pinned the second meant it.
  lonePairs: z.number().int().min(0).optional(),
  label: z.string().optional(),
});

/**
 * Every `BondStereo` member, listed once and checked against the union.
 *
 * The list used to be inlined in `bondSchema` and drifted the moment chem-core
 * gained `either` (the crossed double bond, which the molblock reader produces
 * from V2000 stereo code 3): `encodeBond` returns a `JsonObject`, so writing
 * the new member was not a type error, and `SchemasCoverModel` below checks
 * that the schema mentions every KEY of `Bond`, not every member of a union.
 * The result encoded silently and then failed to decode — one imported bond
 * made the whole sketch unopenable.
 *
 * `satisfies` catches a member removed from the union; `StereoListIsTotal`
 * catches one added to it. Between them the next member is a compile error
 * here rather than a runtime rejection in the user's saved file.
 */
export const BOND_STEREO_VALUES = [
  "none",
  "wedge",
  "hash",
  "wavy",
  "either",
] as const satisfies readonly BondStereo[];

type StereoListIsTotal =
  BondStereo extends (typeof BOND_STEREO_VALUES)[number] ? true : never;
const STEREO_LIST_IS_TOTAL: StereoListIsTotal = true;
void STEREO_LIST_IS_TOTAL;

/**
 * The other two bond value unions, given the same two-way guard and the same
 * export.
 *
 * EXPORTED because a UI that offers a Select over them needs the list, and a
 * hand-written literal array in a component is exactly the drift the rule
 * above exists to prevent — the `either` bug was a hardcoded `z.enum` that had
 * fallen behind the model, and a third copy in a properties panel is the same
 * mistake one layer up. There is now ONE list per union, checked in both
 * directions, and every consumer reads it.
 */
export const BOND_ORDER_VALUES = [1, 2, 3] as const satisfies readonly BondOrder[];

type OrderListIsTotal =
  BondOrder extends (typeof BOND_ORDER_VALUES)[number] ? true : never;
const ORDER_LIST_IS_TOTAL: OrderListIsTotal = true;
void ORDER_LIST_IS_TOTAL;

export const DOUBLE_BOND_SIDE_VALUES = [
  "auto",
  "left",
  "right",
  "centered",
] as const satisfies readonly DoubleBondSide[];

type SideListIsTotal =
  DoubleBondSide extends (typeof DOUBLE_BOND_SIDE_VALUES)[number] ? true : never;
const SIDE_LIST_IS_TOTAL: SideListIsTotal = true;
void SIDE_LIST_IS_TOTAL;

/**
 * Enhanced-stereochemistry kinds, with the same two-way guard as the bond value
 * unions above and for the same reason.
 *
 * This is the FIRST widening of `Molecule` itself since `BondStereo` gained
 * `either`, and that widening is the reason the guards exist: the model grew a
 * member, this file's `z.enum` did not, and a sketch holding one imported bond
 * encoded fine and then failed to decode — the whole document lost. So the
 * chem-core type, this list, the schema, the encoder, the decoder and a
 * round-trip test are one change, never two.
 */
export const STEREO_GROUP_KIND_VALUES = [
  "abs",
  "and",
  "or",
] as const satisfies readonly StereoGroupKind[];

type StereoGroupKindListIsTotal =
  StereoGroupKind extends (typeof STEREO_GROUP_KIND_VALUES)[number] ? true : never;
const STEREO_GROUP_KIND_LIST_IS_TOTAL: StereoGroupKindListIsTotal = true;
void STEREO_GROUP_KIND_LIST_IS_TOTAL;

const stereoGroupSchema = z.strictObject({
  kind: z.enum(STEREO_GROUP_KIND_VALUES),
  /** Stored, never derived from array position (decision 92): the number a
   *  V3000 file states and a figure tag prints. */
  index: z.number().int().positive(),
  atomIds: z.array(nonEmptyString),
});

/**
 * One species join (decision 102). The invariants `withSpeciesJoins` keeps on
 * every write are re-checked by `checkSpeciesJoins`, because a file is
 * untrusted: at least two atoms, each one real, no atom in two joins.
 */
const speciesJoinSchema = z.strictObject({
  atomIds: z.array(nonEmptyString),
});

const bondSchema = z.strictObject({
  id: nonEmptyString,
  from: nonEmptyString,
  to: nonEmptyString,
  order: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  stereo: z.enum(BOND_STEREO_VALUES),
  doubleBondSide: z.enum(DOUBLE_BOND_SIDE_VALUES),
  aromatic: z.boolean(),
});

/**
 * Compile-time guard: the schemas must mention every field of `Atom`/`Bond`.
 * A field added to chem-core's types and forgotten here would otherwise be
 * dropped on every save, which no test of a hand-written fixture would catch.
 */
type SchemasCoverModel = keyof Atom extends keyof z.infer<typeof atomSchema>
  ? keyof Bond extends keyof z.infer<typeof bondSchema>
    ? true
    : never
  : never;
const SCHEMAS_COVER_MODEL: SchemasCoverModel = true;
void SCHEMAS_COVER_MODEL;

const moleculeShapeSchema = z.strictObject({
  atoms: z.record(z.string(), atomSchema),
  bonds: z.record(z.string(), bondSchema),
  atomIds: z.array(nonEmptyString),
  bondIds: z.array(nonEmptyString),
  nextId: z.number().int().positive(),
  /**
   * OPTIONAL AND ADDITIVE, so `SCHEMA_VERSION` stays 1. A document saved before
   * the field existed simply has no key and still decodes; a required field
   * would have made the whole saved corpus unopenable, and a version bump would
   * have made every document this build writes unopenable by the other build,
   * because `sketchDocumentSchema` validates the version with
   * `.max(SCHEMA_VERSION)`.
   *
   * Absent is also MEANINGFUL, not merely tolerated: it says nothing was ever
   * asserted about configuration, which is different from an explicit `abs`
   * group (decision 91).
   *
   * THE BACKWARD DIRECTION IS A KNOWN GAP, and a heavier one than the display
   * keys named beside `SCHEMA_VERSION`. Measured: a build whose
   * `moleculeShapeSchema` has no `stereoGroups` key strips the field, decodes
   * `ok: true`, and re-saves the document as a single enantiomer — no error, no
   * warning, and no version gate can refuse it, because the version deliberately
   * did NOT move (O1). Losing a display flag is cosmetic; losing an AND
   * collection changes which compound the file names, and the loss happens in
   * the OLD build, which cannot be taught anything now. Stated here rather than
   * repaired: the repair is the v2 bump's unknown-key handling, and bumping the
   * version to buy it would make every document this build writes unopenable by
   * the build that is already deployed — a certain loss traded for a
   * conditional one.
   */
  stereoGroups: z.array(stereoGroupSchema).optional(),
  /**
   * Components that are one species (decision 102). Optional and omitted when
   * nothing is joined, like `stereoGroups`, for the same two-spellings reason.
   * No backward gap this time: it arrived with v2, and a v1 build refuses a v2
   * document outright rather than stripping the key.
   */
  speciesJoins: z.array(speciesJoinSchema).optional(),
});

type MoleculeShape = z.infer<typeof moleculeShapeSchema>;

/**
 * The same guard for `Molecule`, in BOTH directions (decision 24).
 *
 * The atom and bond guard above runs one way only — it catches a model field the
 * schema forgot, which is the `either` bug. `Molecule` gets both, because the
 * reverse is now reachable too: a schema key that is no longer a model field
 * would be validated on every decode, dropped by `rebuildMolecule`, and never
 * written again, so a document would fail to open over a field that means
 * nothing. Neither direction has a runtime cost; both are type errors at the
 * line below.
 *
 * Declared here rather than beside `moleculeShapeSchema` only because it has to
 * follow the inferred shape type.
 */
type MoleculeSchemaCoversModel = keyof Molecule extends keyof MoleculeShape
  ? true
  : never;
type MoleculeSchemaIsExact = keyof MoleculeShape extends keyof Molecule
  ? true
  : never;
const MOLECULE_SCHEMA_COVERS_MODEL: MoleculeSchemaCoversModel = true;
const MOLECULE_SCHEMA_IS_EXACT: MoleculeSchemaIsExact = true;
void MOLECULE_SCHEMA_COVERS_MODEL;
void MOLECULE_SCHEMA_IS_EXACT;

/** The counter suffix of a generated id (`a12` -> 12). Foreign ids that carry
 *  no trailing digits cannot collide with a generated one, so they impose no
 *  constraint on `nextId`. */
function idSuffix(id: string): number | undefined {
  const match = /(\d+)$/.exec(id);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Checks that an id list and the record it indexes describe the same set,
 * in the same multiplicity. Both directions matter: an id listed twice makes
 * `atoms(mol)` return the same atom twice, and a record key missing from the
 * list is an atom that exists but is invisible to every traversal.
 */
function checkIdList(
  ids: readonly string[],
  records: Readonly<Record<string, { readonly id: string }>>,
  listPath: string,
  recordPath: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate id ${id} in ${listPath}`,
        path: [listPath, index],
      });
      return;
    }
    seen.add(id);
    // Own-property test, never a plain index read: `records` is a plain object
    // built by zod, so `records["toString"]` resolves up Object.prototype and
    // an id naming a prototype member would pass a `records[id]` existence
    // check while owning no record at all. See `checkMoleculeIntegrity`.
    const record = Object.hasOwn(records, id) ? records[id] : undefined;
    if (!record) {
      ctx.addIssue({
        code: "custom",
        message: `${listPath} references ${id}, which is missing from ${recordPath}`,
        path: [listPath, index],
      });
      return;
    }
    if (record.id !== id) {
      // The record key is authoritative; a disagreeing inner id would make
      // `mol.atoms[a.id] !== a` and break every lookup written the obvious way.
      ctx.addIssue({
        code: "custom",
        message: `${recordPath}.${id} carries the id ${record.id}`,
        path: [recordPath, id, "id"],
      });
    }
  });
  for (const key of Object.keys(records)) {
    if (seen.has(key)) continue;
    ctx.addIssue({
      code: "custom",
      message: `${recordPath}.${key} is missing from ${listPath}`,
      path: [recordPath, key],
    });
  }
}

function checkMoleculeIntegrity(mol: MoleculeShape, ctx: z.RefinementCtx): void {
  checkIdList(mol.atomIds, mol.atoms, "atomIds", "atoms", ctx);
  checkIdList(mol.bondIds, mol.bonds, "bondIds", "bonds", ctx);

  // Bonds between the same pair of atoms are rejected because chem-core's
  // `addBond` and `MoleculeBuilder.bond` both throw on them: a molecule the
  // editor could never have produced must not enter through a file either.
  const bondedPairs = new Set<string>();
  for (const bondId of mol.bondIds) {
    const bond = Object.hasOwn(mol.bonds, bondId) ? mol.bonds[bondId] : undefined;
    if (!bond) continue; // already reported by checkIdList
    if (bond.from === bond.to) {
      ctx.addIssue({
        code: "custom",
        message: `bond ${bondId} joins atom ${bond.from} to itself`,
        path: ["bonds", bondId],
      });
      continue;
    }
    for (const end of ["from", "to"] as const) {
      // `Object.hasOwn`, NOT `!mol.atoms[bond[end]]`. A plain index read walks
      // Object.prototype, so a bond ending at "toString" or "constructor"
      // would look like it pointed at an existing atom and the document would
      // decode with a dangling endpoint. Downstream that is not a clean "no
      // such atom" either: chem-core's `requireAtom` index-reads too and would
      // hand back `Object.prototype.toString`, so the failure arrives as
      // `atom.pos is undefined` somewhere far from the dropped file.
      if (!Object.hasOwn(mol.atoms, bond[end])) {
        ctx.addIssue({
          code: "custom",
          message: `bond ${bondId} ends at ${bond[end]}, which is not an atom`,
          path: ["bonds", bondId, end],
        });
      }
    }
    const pair =
      bond.from < bond.to
        ? `${bond.from}\u0000${bond.to}`
        : `${bond.to}\u0000${bond.from}`;
    if (bondedPairs.has(pair)) {
      ctx.addIssue({
        code: "custom",
        message: `atoms ${bond.from} and ${bond.to} are bonded more than once`,
        path: ["bonds", bondId],
      });
    }
    bondedPairs.add(pair);
  }

  // Ids are never reused, so the counter must already be past every id in the
  // file. A too-small `nextId` would mint an id that an undo entry still
  // points at, and the stale reference would silently resolve to a different
  // atom — the exact bug the monotonic counter exists to prevent.
  for (const id of [...mol.atomIds, ...mol.bondIds]) {
    const suffix = idSuffix(id);
    if (suffix !== undefined && suffix >= mol.nextId) {
      ctx.addIssue({
        code: "custom",
        message: `nextId ${mol.nextId} would reuse the id ${id}`,
        path: ["nextId"],
      });
    }
  }

  checkStereoGroups(mol, ctx);
  checkSpeciesJoins(mol, ctx);
}

/**
 * The species-join invariants, reported as issues. `[]` is rejected for the
 * reason `checkStereoGroups` rejects it; a one-atom join joins nothing; an
 * atom in two joins is a second spelling of one larger join. The canonical
 * ORDER is not checked — `rebuildMolecule` restores it, and a file written by
 * hand in another order still says the same thing.
 */
function checkSpeciesJoins(mol: MoleculeShape, ctx: z.RefinementCtx): void {
  const joins = mol.speciesJoins;
  if (joins === undefined) return;
  if (joins.length === 0) {
    ctx.addIssue({
      code: "custom",
      message:
        "speciesJoins is present but empty; a molecule with no joined species " +
        "omits the key entirely",
      path: ["speciesJoins"],
    });
    return;
  }
  const owner = new Map<string, number>();
  joins.forEach((join, position) => {
    if (new Set(join.atomIds).size < 2) {
      ctx.addIssue({
        code: "custom",
        message: `species join ${position} names fewer than two atoms, so it joins nothing`,
        path: ["speciesJoins", position, "atomIds"],
      });
    }
    join.atomIds.forEach((atomId, slot) => {
      if (!Object.hasOwn(mol.atoms, atomId)) {
        ctx.addIssue({
          code: "custom",
          message: `species join ${position} names ${atomId}, which is not an atom`,
          path: ["speciesJoins", position, "atomIds", slot],
        });
        return;
      }
      const held = owner.get(atomId);
      if (held !== undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            held === position
              ? `species join ${position} names atom ${atomId} twice`
              : `atom ${atomId} is in species joins ${held} and ${position}; ` +
                `overlapping joins are one join`,
          path: ["speciesJoins", position, "atomIds", slot],
        });
        return;
      }
      owner.set(atomId, position);
    });
  });
}

/**
 * The five things a stereo-group list has to satisfy to mean anything.
 *
 * Every one of them is a document that decodes into a molecule the editor could
 * not have produced, and every one fails LATER and further away than here — a
 * group naming an atom that does not exist survives every render and then
 * crashes a molfile export; an atom in two groups gives a figure a per-centre
 * tag with two values and the renderer picks whichever it meets first.
 *
 * `withStereoGroups` in chem-core enforces the same invariants on every write.
 * That is deliberate duplication, not redundancy: this side guards a file, which
 * is untrusted and must fail with a listed reason, while that side guards a
 * caller, which is a programming error and throws.
 */
function checkStereoGroups(mol: MoleculeShape, ctx: z.RefinementCtx): void {
  const groups = mol.stereoGroups;
  if (groups === undefined) return;

  // An EMPTY ARRAY is rejected rather than silently normalised. The model omits
  // the key when there is nothing to say, so `[]` is a second spelling of the
  // same statement, and two spellings mean `toEqual` and `JSON.stringify`
  // disagree about two molecules that are identical.
  if (groups.length === 0) {
    ctx.addIssue({
      code: "custom",
      message:
        "stereoGroups is present but empty; a molecule that says nothing about " +
        "configuration omits the key entirely",
      path: ["stereoGroups"],
    });
    return;
  }

  const owner = new Map<string, number>();
  const seenKeys = new Map<string, number>();

  groups.forEach((group, position) => {
    if (group.atomIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `stereo group ${position} is empty`,
        path: ["stereoGroups", position, "atomIds"],
      });
    }

    // Indices are PER KIND, so `and` 1 and `or` 1 are different groups and only
    // a repeat within one kind is a conflict. The separator is an escape rather
    // than a literal control byte, for the grep reason spelled out in
    // chem-core's molblock reader.
    const key = `${group.kind}\u0000${group.index}`;
    const first = seenKeys.get(key);
    if (first !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          `two ${group.kind} stereo groups both carry index ${group.index} ` +
          `(positions ${first} and ${position}); the index is what a V3000 file ` +
          `states and what a figure tag prints, so it must be unique per kind`,
        path: ["stereoGroups", position, "index"],
      });
    } else {
      seenKeys.set(key, position);
    }

    // There is exactly one absolute collection per structure, because V3000
    // writes it as `MDLV30/STEABS` with no number at all while numbering
    // `STERACn` and `STERELn`. A numbered abs group could not be written back.
    if (group.kind === "abs" && group.index !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          `an abs stereo group carries index ${group.index}; there is only one ` +
          `absolute collection per structure (V3000 writes it unnumbered), so ` +
          `its index is always 1`,
        path: ["stereoGroups", position, "index"],
      });
    }

    group.atomIds.forEach((atomId, slot) => {
      // `Object.hasOwn`, never a plain index read: `mol.atoms["toString"]`
      // resolves up Object.prototype, so a group naming a prototype member
      // would pass an existence check and own no atom at all.
      if (!Object.hasOwn(mol.atoms, atomId)) {
        ctx.addIssue({
          code: "custom",
          message: `stereo group ${position} names ${atomId}, which is not an atom`,
          path: ["stereoGroups", position, "atomIds", slot],
        });
        return;
      }
      const held = owner.get(atomId);
      if (held !== undefined && held !== position) {
        ctx.addIssue({
          code: "custom",
          message:
            `atom ${atomId} is in stereo groups ${held} and ${position}; an atom ` +
            `belongs to at most one ABS/AND/OR collection`,
          path: ["stereoGroups", position, "atomIds", slot],
        });
        return;
      }
      if (held === position) {
        ctx.addIssue({
          code: "custom",
          message: `stereo group ${position} names atom ${atomId} twice`,
          path: ["stereoGroups", position, "atomIds", slot],
        });
        return;
      }
      owner.set(atomId, position);
    });
  });
}

/**
 * Rebuilds the molecule field by field. Never a spread of the parsed value:
 * zod keeps an explicitly-passed `{ isotope: undefined }` as an own key, and
 * `makeAtom` is the one place that knows to drop it.
 *
 * `atomIds` / `bondIds` are copied in order, and `nextId` verbatim — molfile
 * round-trips and stereo parity both read off insertion order, so a decode
 * that re-derived it from `Object.keys` would reorder a structure the moment
 * a JSON parser felt like it.
 */
function rebuildMolecule(mol: MoleculeShape): Molecule {
  const atoms: Record<AtomId, Atom> = {};
  for (const id of mol.atomIds) {
    // Non-null assertions are sound: `checkMoleculeIntegrity` has already
    // rejected the input if an id has no record, and zod skips the transform
    // once an issue is raised.
    const parsed = mol.atoms[id]!;
    atoms[id] = makeAtom(id, {
      element: parsed.element,
      pos: { x: parsed.pos.x, y: parsed.pos.y },
      charge: parsed.charge,
      radicalElectrons: parsed.radicalElectrons,
      aromatic: parsed.aromatic,
      isotope: parsed.isotope,
      explicitHydrogenCount: parsed.explicitHydrogenCount,
      lonePairs: parsed.lonePairs,
      label: parsed.label,
    });
  }
  const bonds: Record<BondId, Bond> = {};
  for (const id of mol.bondIds) {
    const parsed = mol.bonds[id]!;
    bonds[id] = {
      id,
      from: parsed.from,
      to: parsed.to,
      order: parsed.order,
      stereo: parsed.stereo,
      doubleBondSide: parsed.doubleBondSide,
      aromatic: parsed.aromatic,
    };
  }
  const rebuilt: {
    -readonly [K in keyof Molecule]: Molecule[K];
  } = {
    atoms,
    bonds,
    atomIds: [...mol.atomIds],
    bondIds: [...mol.bondIds],
    nextId: mol.nextId,
  };
  // The key is WRITTEN ONLY WHEN THE FILE CARRIED ONE, not set to `[]` or to
  // `undefined`. `exactOptionalPropertyTypes` makes the difference visible in
  // the type, and `Object.hasOwn` is how the rest of the package asks whether a
  // molecule says anything about grouping — the same distinction `cloneAtomWith`
  // maintains for a pinned hydrogen count.
  //
  // `checkStereoGroups` has already rejected a present-but-empty array, so a
  // surviving list is non-empty and every id in it names an atom.
  if (mol.stereoGroups !== undefined) {
    rebuilt.stereoGroups = mol.stereoGroups.map((group) => ({
      kind: group.kind,
      index: group.index,
      atomIds: [...group.atomIds],
    }));
  }
  // Through chem-core's writer rather than copied, so a join list decodes in
  // the canonical order every in-memory molecule has and a hand-ordered file
  // compares `toEqual` to the molecule it describes. `checkSpeciesJoins` has
  // already rejected everything the writer would throw on.
  return mol.speciesJoins === undefined
    ? rebuilt
    : withSpeciesJoins(rebuilt, mol.speciesJoins);
}

export const moleculeSchema = moleculeShapeSchema
  .superRefine(checkMoleculeIntegrity)
  .transform(rebuildMolecule);

/**
 * The display object, GENERATED from chem-render's key list rather than
 * written out (decision 10).
 *
 * EVERY FLAG IS OPTIONAL, and that is a compatibility requirement, not
 * laxity. A document saved before a flag existed cannot carry it, and a
 * required field would make every such file fail to decode — the whole saved
 * corpus lost the moment the renderer grows a toggle. The transform fills a
 * missing key from the kind's default, so an old four-flag document decodes
 * to a full eight-flag panel that means what it always meant.
 *
 * The cast is what buys typed inference from a computed shape; the shape
 * itself comes from `DISPLAY_FLAG_KEYS`, which is checked against
 * `DisplayFlags` in both directions over in chem-render, so it cannot be
 * short a key.
 */
const displayShape = Object.fromEntries(
  DISPLAY_FLAG_KEYS.map((key) => [key, z.boolean().optional()]),
) as { [K in DisplayFlagKey]: z.ZodOptional<z.ZodBoolean> };

/**
 * Display keys a v1 document may carry that no longer name a flag.
 *
 * `showAtomIndices` was persisted from decision 10 until decision 18 renamed
 * it `showLocants`. Documents saved in between carry it, so it is ACCEPTED —
 * and still validated as a boolean, exactly as it was — and then DROPPED:
 * `assembleDisplay` reads only `DISPLAY_FLAG_KEYS`, so it never reaches the
 * decoded panel or the next save.
 *
 * Listed explicitly rather than left to zod's default of stripping unknown
 * keys, which is a library default this file should not be resting a
 * compatibility promise on.
 *
 * Its value is deliberately NOT copied into `showLocants`. It meant "show
 * each atom's position in `atomIds`", and an atomIds position is not a
 * chemical locant; a document that had it on must not open claiming its
 * structure is numbered.
 */
const LEGACY_DISPLAY_KEYS = ["showAtomIndices"] as const;

const legacyDisplayShape = Object.fromEntries(
  LEGACY_DISPLAY_KEYS.map((key) => [key, z.boolean().optional()]),
) as { [K in (typeof LEGACY_DISPLAY_KEYS)[number]]: z.ZodOptional<z.ZodBoolean> };

export const representationSchema = z
  .strictObject({
    kind: z.enum(VIEW_KINDS),
    display: z.strictObject({ ...legacyDisplayShape, ...displayShape }),
  })
  .transform(
    (value): Representation => ({
      kind: value.kind,
      // Key by key, through the shared assembler: a spread of the parsed
      // object would copy keys that are present holding `undefined`, which is
      // rule 1 of this file.
      display: assembleDisplay(value.kind, value.display),
    }),
  );

export const panelSchema = z
  .strictObject({
    id: nonEmptyString,
    representation: representationSchema,
    caption: z.string().optional(),
  })
  .transform((value): Panel =>
    assemblePanel(value.id, {
      representation: value.representation,
      caption: value.caption,
    }),
  );

export const documentMetadataSchema = z
  .strictObject({
    title: z.string(),
    createdAt: isoTimestampSchema,
    modifiedAt: isoTimestampSchema,
    author: z.string().optional(),
    notes: z.string().optional(),
  })
  .transform((value): DocumentMetadata =>
    assembleMetadata({
      title: value.title,
      createdAt: value.createdAt,
      modifiedAt: value.modifiedAt,
      author: value.author,
      notes: value.notes,
    }),
  );

/**
 * The annotation schemas, their enums built from chem-render's lists so a new
 * kind or endpoint kind cannot be saved by one side and refused by the other.
 * Anchors are checked against the molecule in the document's `superRefine`,
 * because an annotation schema cannot see the molecule beside it.
 */
const curlySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal(CURLY_ARROW_SOURCE_KINDS[0]), atomId: nonEmptyString }),
  z.strictObject({ kind: z.literal(CURLY_ARROW_SOURCE_KINDS[1]), bondId: nonEmptyString }),
  z.strictObject({ kind: z.literal(CURLY_ARROW_SOURCE_KINDS[2]), atomId: nonEmptyString }),
]);
const curlySinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal(CURLY_ARROW_SINK_KINDS[0]), atomId: nonEmptyString }),
  z.strictObject({ kind: z.literal(CURLY_ARROW_SINK_KINDS[1]), bondId: nonEmptyString }),
  z.strictObject({ kind: z.literal(CURLY_ARROW_SINK_KINDS[2]), atomId: nonEmptyString }),
]);

const annotationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("curlyArrow"),
    electrons: z.enum(CURLY_ARROW_ELECTRONS),
    source: curlySourceSchema,
    sink: curlySinkSchema,
    bulge: z.number(),
    skew: z.number().min(-CURLY_ARROW_MAX_SKEW).max(CURLY_ARROW_MAX_SKEW),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("reactionArrow"),
    from: z.array(nonEmptyString).min(1),
    to: z.array(nonEmptyString).min(1),
    row: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("plus"),
    between: z.tuple([nonEmptyString, nonEmptyString]),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("bracket"),
    species: z.array(nonEmptyString).min(1),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("text"),
    text: z.string().min(1),
    at: vec2Schema,
  }),
]);

/** A new kind in chem-render's list with no arm above is a compile error. */
type AnnotationSchemaIsTotal = (typeof SCHEME_ANNOTATION_KINDS)[number] extends z.infer<
  typeof annotationSchema
>["kind"]
  ? true
  : never;
const ANNOTATION_SCHEMA_IS_TOTAL: AnnotationSchemaIsTotal = true;
void ANNOTATION_SCHEMA_IS_TOTAL;

export const sketchDocumentSchema = z
  .strictObject({
    // EXACTLY this version. A newer one is rejected outright; an older one
    // has to be walked up `DOCUMENT_UPGRADES` first, and one that was not is
    // refused here by name rather than decoded short of the fields its
    // upgrade adds.
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: nonEmptyString,
    molecule: moleculeSchema,
    annotations: z.array(annotationSchema),
    nextAnnotationId: z.number().int().positive(),
    stylePreset: z.enum(["publication", "screen"]),
    panels: z.array(panelSchema),
    // Optional and additive: a file from before the field existed has no key,
    // and still decodes at SCHEMA_VERSION 1. See `FigureLayout`.
    figure: z
      .strictObject({ columns: z.number().int().min(1).max(MAX_FIGURE_COLUMNS) })
      .optional(),
    metadata: documentMetadataSchema,
  })
  .superRefine((doc, ctx) => {
    // Panel ids address panels in the layout and in every UI selector; two
    // panels sharing one id makes "close this panel" ambiguous.
    const seen = new Set<PanelId>();
    doc.panels.forEach((panel, index) => {
      if (seen.has(panel.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate panel id ${panel.id}`,
          path: ["panels", index, "id"],
        });
      }
      seen.add(panel.id);
    });

    // Annotation ids are unique and below the counter, for the reason atom
    // ids are below `nextId`; and every atom and bond an annotation names is
    // in the molecule. A dangling annotation is REFUSED, never kept: an edit
    // prunes it in the same undo entry, so a file holding one was not written
    // by this editor, and accepting it would make every consumer handle a
    // reference that resolves to nothing.
    const annotationIds = new Set<string>();
    doc.annotations.forEach((parsed, index) => {
      if (annotationIds.has(parsed.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate annotation id ${parsed.id}`,
          path: ["annotations", index, "id"],
        });
      }
      annotationIds.add(parsed.id);
      const suffix = idSuffix(parsed.id);
      if (suffix !== undefined && suffix >= doc.nextAnnotationId) {
        ctx.addIssue({
          code: "custom",
          message: `nextAnnotationId ${doc.nextAnnotationId} would reuse the id ${parsed.id}`,
          path: ["nextAnnotationId"],
        });
      }
      const missing = danglingReferences(doc.molecule, assembleSchemeAnnotation(parsed));
      for (const id of missing) {
        ctx.addIssue({
          code: "custom",
          message: `annotation ${parsed.id} names ${id}, which is not in the molecule`,
          path: ["annotations", index],
        });
      }
    });
  })
  .transform((doc): SketchDocument => {
    // Rebuilt key by key rather than spread: a spread would carry a `figure`
    // key holding `undefined` whenever the parser saw one, which is rule 1 of
    // this file, and it would keep the parser's own object identity. Each
    // annotation goes through chem-render's assembler for the same reason —
    // an absent `row` arrives from zod as a present key holding `undefined`.
    const base: SketchDocument = {
      schemaVersion: doc.schemaVersion,
      id: doc.id,
      molecule: doc.molecule,
      annotations: doc.annotations.map(assembleSchemeAnnotation),
      nextAnnotationId: doc.nextAnnotationId,
      stylePreset: doc.stylePreset,
      panels: doc.panels,
      metadata: doc.metadata,
    };
    return doc.figure === undefined ? base : withFigureLayout(base, doc.figure);
  });

/** Compile-time guard that the schema really produces a `SketchDocument`;
 *  `decodeDocument`'s annotated return type would otherwise be a lie the
 *  moment a transform stopped narrowing. */
type SchemaProducesDocument = z.infer<
  typeof sketchDocumentSchema
> extends SketchDocument
  ? true
  : never;
const SCHEMA_PRODUCES_DOCUMENT: SchemaProducesDocument = true;
void SCHEMA_PRODUCES_DOCUMENT;

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/**
 * The optional keys of an `Atom`, listed once so the encoder can copy them in
 * a loop. The mapped type below fails to compile if chem-core grows another
 * one, which is the only warning we would ever get: every optional field is,
 * by definition, absent from some valid atom, so a fixture-based test can
 * miss it forever.
 */
const OPTIONAL_ATOM_KEYS = [
  "isotope",
  "explicitHydrogenCount",
  "lonePairs",
  "label",
] as const;
type EncoderCoversOptionalAtomKeys = OptionalKeys<Atom> extends
  (typeof OPTIONAL_ATOM_KEYS)[number]
  ? true
  : never;
const ENCODER_COVERS_OPTIONAL_ATOM_KEYS: EncoderCoversOptionalAtomKeys = true;
void ENCODER_COVERS_OPTIONAL_ATOM_KEYS;

type JsonObject = Record<string, unknown>;

function encodeAtom(atom: Atom): JsonObject {
  const encoded: JsonObject = {
    id: atom.id,
    element: atom.element,
    pos: { x: atom.pos.x, y: atom.pos.y },
    charge: atom.charge,
    radicalElectrons: atom.radicalElectrons,
    aromatic: atom.aromatic,
  };
  // Omitted, not written as `undefined`: `JSON.stringify` would drop the key
  // anyway, so emitting it here only makes the pre-stringify value differ
  // from the post-parse one, and deep-equality assertions in tests fail for a
  // reason that has nothing to do with chemistry.
  for (const key of OPTIONAL_ATOM_KEYS) {
    const value = atom[key];
    if (value !== undefined) encoded[key] = value;
  }
  return encoded;
}

function encodeBond(bond: Bond): JsonObject {
  return {
    id: bond.id,
    from: bond.from,
    to: bond.to,
    order: bond.order,
    stereo: bond.stereo,
    doubleBondSide: bond.doubleBondSide,
    aromatic: bond.aromatic,
  };
}

function encodeMolecule(mol: Molecule): JsonObject {
  const atoms: JsonObject = {};
  // Written in `atomIds` order so the JSON reads in drawing order too; the
  // authoritative order is still the id list, which is copied verbatim.
  for (const id of mol.atomIds) {
    const atom = mol.atoms[id];
    if (atom) atoms[id] = encodeAtom(atom);
  }
  const bonds: JsonObject = {};
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id];
    if (bond) bonds[id] = encodeBond(bond);
  }
  const encoded: JsonObject = {
    atoms,
    bonds,
    atomIds: [...mol.atomIds],
    bondIds: [...mol.bondIds],
    nextId: mol.nextId,
  };
  // Omitted when absent, exactly as `encodeAtom` omits an unset optional: a
  // `stereoGroups: undefined` key survives `structuredClone`, so a molecule that
  // says nothing about grouping would encode differently before and after a save
  // and every round-trip equality assertion would fail for a reason with nothing
  // to do with chemistry.
  if (mol.stereoGroups !== undefined) {
    encoded.stereoGroups = mol.stereoGroups.map((group) => ({
      kind: group.kind,
      index: group.index,
      atomIds: [...group.atomIds],
    }));
  }
  if (mol.speciesJoins !== undefined) {
    encoded.speciesJoins = mol.speciesJoins.map((join) => ({ atomIds: [...join.atomIds] }));
  }
  return encoded;
}

/** Key by key through the assembler, so an encoded annotation is a fresh
 *  JSON-safe value with no `undefined`-valued key. */
function encodeAnnotation(annotation: SchemeAnnotation): JsonObject {
  return { ...assembleSchemeAnnotation(annotation) } as JsonObject;
}

function encodePanel(panel: Panel): JsonObject {
  const encoded: JsonObject = {
    id: panel.id,
    representation: {
      kind: panel.representation.kind,
      display: { ...panel.representation.display },
    },
  };
  if (panel.caption !== undefined) encoded.caption = panel.caption;
  return encoded;
}

function encodeMetadata(metadata: DocumentMetadata): JsonObject {
  const encoded: JsonObject = {
    title: metadata.title,
    createdAt: metadata.createdAt,
    modifiedAt: metadata.modifiedAt,
  };
  if (metadata.author !== undefined) encoded.author = metadata.author;
  if (metadata.notes !== undefined) encoded.notes = metadata.notes;
  return encoded;
}

/** A JSON-safe plain value: no class instances, no `undefined`-valued keys,
 *  nothing that `structuredClone` or `JSON.stringify` would alter. */
export function encodeDocument(doc: SketchDocument): unknown {
  const encoded: JsonObject = {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    molecule: encodeMolecule(doc.molecule),
    annotations: doc.annotations.map(encodeAnnotation),
    nextAnnotationId: doc.nextAnnotationId,
    stylePreset: doc.stylePreset,
    panels: doc.panels.map(encodePanel),
  };
  if (doc.figure !== undefined) encoded.figure = { columns: doc.figure.columns };
  encoded.metadata = encodeMetadata(doc.metadata);
  return encoded;
}

/**
 * `DOCUMENT_UPGRADES[n]` turns a raw version-`n` value into a raw version-`n+1`
 * one, bumping its `schemaVersion`. Walked by the client's `migrateStored`
 * BEFORE the schema, one step at a time; kept here because the steps are
 * knowledge of this file's shape.
 *
 * 1 -> 2 (the scheme model) adds an empty annotation list and its counter.
 * Nothing else changed shape, so a v1 document is otherwise already a valid
 * v2 one — v1 decoding STRIPPED unknown keys where v2 refuses them, and this
 * build is the newest v1 there was, so every key a v1 file can carry is one
 * it knows (the retired `showAtomIndices` is accepted by name).
 */
export const DOCUMENT_UPGRADES: Readonly<Record<number, (value: unknown) => unknown>> = {
  1: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    return { ...value, schemaVersion: 2, annotations: [], nextAnnotationId: 1 };
  },
};

/**
 * True when a failed decode failed because the input carries keys this build
 * does not know — the signature of a document written by a newer build, which
 * the caller should say in those words rather than calling the file corrupt.
 */
export function isFromNewerBuild(error: z.ZodError): boolean {
  return error.issues.some((issue) => issue.code === "unrecognized_keys");
}

/** Throws a `ZodError` listing every problem with the input. */
export function decodeDocument(value: unknown): SketchDocument {
  return sketchDocumentSchema.parse(value);
}

export type DecodeResult =
  | { readonly ok: true; readonly document: SketchDocument }
  | { readonly ok: false; readonly error: z.ZodError };

/** The non-throwing decode, for anything driven by a user action — a dropped
 *  file or a paste — where a bad document is an expected outcome to report,
 *  not an exception to crash on. */
export function safeDecodeDocument(value: unknown): DecodeResult {
  const result = sketchDocumentSchema.safeParse(value);
  return result.success
    ? { ok: true, document: result.data }
    : { ok: false, error: result.error };
}
