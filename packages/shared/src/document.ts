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
  PROJECTION_TEMPLATES,
  SKELETON_NAMES,
  sharedSkeletonAtoms,
  canonicalProjectionView,
  isTestOnlyMolecule,
  makeAtom,
  emptyMolecule,
  normalizeAtomQuery,
  withSpeciesJoins,
  withBondFlags,
  type Atom,
  type AtomId,
  type AtomQuery,
  type Bond,
  type BondId,
  type BondOrder,
  type BondQuery,
  type BondStereo,
  type ChainParams,
  type DoubleBondSide,
  type Molecule,
  type ProjectionView,
  type RingConformer,
  type RingParams,
  type StereoGroup,
  type StereoGroupKind,
} from "@starter/chem-core";
import {
  ABSOLUTE_ZERO,
  CURLY_ARROW_ELECTRONS,
  CURLY_ARROW_MAX_SKEW,
  CURLY_ARROW_SINK_KINDS,
  CURLY_ARROW_SOURCE_KINDS,
  DISPLAY_FLAG_KEYS,
  EQUILIBRIUM_BIASES,
  PARTIAL_CHARGE_SIGNS,
  REACTION_CONDITION_KINDS,
  SCHEME_ANNOTATION_KINDS,
  TEMPERATURE_UNITS,
  TIME_UNITS,
  VIEW_KINDS,
  assembleSchemeAnnotation,
  defaultFlagsFor,
  schemeAnnotationId,
  styleOverrideIssues,
  type DisplayFlagKey,
  type FigureStyleOverrides,
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
 * as one enantiomer. Additive optional keys on v2 would repeat that for every
 * future feature. A strict decode turns it into "written by a newer version
 * of the editor", which loses nothing. The only key accepted without being
 * understood is a RETIRED one, listed by name: `showAtomIndices`.
 *
 * `Panel.view` (a projection, decision 128) arrived as such a key on v2, with
 * no second bump: a v2 document without it still decodes to exactly what it
 * meant, and a build that predates it refuses a panel carrying one.
 */
export const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * `publication` is the ACS 1996 setting; `nature` is the Nature Portfolio
 * structure guide (decision 234); `screen` is the editor.
 */
export type StylePresetId = "publication" | "nature" | "screen";

/**
 * The preset a document CREATED here opens in: blank, the editor's startup
 * document, and a structure imported from a molfile, SDF or SMILES
 * (decision 135, which reverses decision 50's "new documents still open in
 * Screen").
 *
 * Publication, because the export defaults to Publication (decision 50) and
 * the Publication canvas is the exported figure at the zoom you work at
 * (decision 107). Opening in Screen meant editing one picture and exporting
 * another. A document that already HAS a preset keeps it: a saved one, a
 * `.hydroxyl.json` file, and a copy, which `copyOf` hands its source's.
 * This is only the answer when nobody has chosen.
 */
export const NEW_DOCUMENT_PRESET: StylePresetId = "publication";

/** Every preset id, in the order the file schema lists them. */
export const STYLE_PRESET_IDS: readonly StylePresetId[] = Object.freeze([
  "publication",
  "nature",
  "screen",
]);

/**
 * A document's edits to its figure style (decisions 223 and 237), kept PER
 * PRESET: the Publication edits and the Screen edits are separate sets, each
 * over its own preset, in print units (chem-render's `FigureStyleParams`).
 *
 * Per preset because the top-bar switch is a view toggle people flip while
 * editing (decision 107); one shared set would either be lost on every flip
 * or turn Screen into a copy of Publication. A preset with no edits has no
 * key, and a document with none has no `styleOverrides` key at all.
 */
export type DocumentStyleOverrides = Readonly<
  Partial<Record<StylePresetId, Readonly<FigureStyleOverrides>>>
>;

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
  /**
   * The projection this panel draws the molecule in, when it draws one: a
   * Fischer, a Haworth, a Newman (decision 128). OMITTED for the plain
   * drawing, never `undefined`.
   *
   * AN AXIS ORTHOGONAL TO `representation.kind`, so a Fischer can be drawn
   * skeletal or with explicit hydrogens, and a view survives a kind change the
   * way the display flags do. It is chem-core's `ProjectionView` exactly
   * (decision 162): `kind` plus `template` name the projection, `frame` the
   * chemistry it looks at (a backbone, a ring atom-id SET, a sighted bond),
   * `params` the view knobs, conformation included. Decision 12 puts a torsion
   * or a chair flip HERE, on the panel, and never on the molecule; so two
   * panels of one molecule may show two rotamers (decision 160: no shared,
   * named conformations in v1).
   *
   * STORED CANONICAL. `assembleProjectionView` writes angles in [0, 360) and a
   * ring's atoms as a sorted set, so 370 and 10 are one panel by value and two
   * spellings of one picture never differ in a file or in the undo history.
   *
   * IT MAY NAME ATOMS THE MOLECULE NO LONGER HOLDS. A view is a question about
   * the molecule, not a part of it: deleting a backbone atom makes the panel
   * `unavailable: missing-atom` with a sentence, and it is never rewritten to
   * point at something else. See `prunePanelViews` for the one thing an edit
   * does prune (decision 175).
   */
  readonly view?: ProjectionView;
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
  /**
   * The figure-style edits, per preset (decision 237). The canvas and every
   * export draw `stylePreset` with its entry applied, so what is edited is
   * what is exported (decision 107). Omitted when nothing is edited;
   * `withStyleOverrides` is the one writer.
   */
  readonly styleOverrides?: DocumentStyleOverrides;
  readonly panels: readonly Panel[];
  /** Omitted, never `undefined`, when no layout has been chosen. */
  readonly figure?: FigureLayout;
  /**
   * Locants the user typed, keyed on atom id: the EXPLICIT half of the
   * document's numbering (decisions 18 and 142). chem-core's `atomNumbering`
   * reads it first and derives the rest from the sugar and amino-acid rules,
   * so one atom carries the same number in every panel of a figure. An empty
   * string hides a derived locant.
   *
   * On the document, not the molecule and not a panel: a locant is a label a
   * figure puts on an atom, and one map per document is what keeps the panels
   * of one figure in agreement. Pruned in the same undo entry as the edit that
   * deletes its atom, so no saved document names an atom it does not hold.
   * The key is OMITTED when there are none, never present holding `{}`;
   * `withLocants` is the one writer.
   */
  readonly locants?: Readonly<Record<AtomId, string>>;
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
  readonly view?: ProjectionView | undefined;
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
  if (init.view !== undefined) panel.view = assembleProjectionView(init.view);
  return panel;
}

/**
 * Whether two plain JSON values are the same value: key order ignored, and a
 * key holding `undefined` NOT the same as an absent one, which is the
 * difference the assemblers exist to erase.
 */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * A caller's panels in their stored spelling, through `assemblePanel`: a view
 * turned 370 is stored as 10, and a `caption: undefined` leaves no key. So a
 * document built from them equals its own save/load round trip.
 *
 * A panel already in that spelling comes back ITSELF, and the list comes
 * back itself when every panel does, so `copyOf` still shares its source's
 * panels and a cache keyed on a panel object still hits.
 */
function assembledPanels(panels: readonly Panel[]): readonly Panel[] {
  let changed = false;
  const next = panels.map((panel) => {
    const assembled = assemblePanel(panel.id, panel);
    if (sameJsonValue(assembled, panel)) return panel;
    changed = true;
    return assembled;
  });
  return changed ? next : panels;
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
  preset: StylePresetId = NEW_DOCUMENT_PRESET,
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
 * PUBLICATION AND SCREEN DEFER TO THE VIEW KIND (`"kind"`), which after
 * decision 11 is what actually distinguishes skeletal from Kekulé: with
 * Kekulé's carbon labels gone, the circle is the only thing left that tells
 * the two views apart, so a preset-wide "circles off" would collapse them
 * back into the same picture. The table survives because it is still the
 * declared home of a house style that prints one or the other regardless of
 * view — a third preset adds a row here with a plain boolean and changes
 * nothing else. Nature (decision 234) is that preset.
 */
const AROMATIC_CIRCLES_BY_PRESET: Readonly<
  Record<StylePresetId, boolean | "kind">
> = Object.freeze({
  publication: "kind",
  // Decision 234: the Nature Portfolio guide asks for "discrete bonds ...
  // rather than rings", so a panel created under Nature starts Kekule.
  nature: false,
  screen: "kind",
});

/**
 * The panels a fresh document opens with: the structure you draw into, and
 * the formula that tells you at a glance whether it is the compound you meant.
 */
export const DEFAULT_PANELS: readonly Panel[] = defaultPanelsFor(NEW_DOCUMENT_PRESET);

/**
 * The opening panels seeded from a style preset.
 *
 * `DEFAULT_PANELS` is the `NEW_DOCUMENT_PRESET` case, kept as a named
 * constant because plenty of code and several tests compare against it by
 * value. A document created under another preset gets its own set, so the
 * preset's circle-versus-Kekule convention actually reaches the panels rather
 * than being applied to a constant that was frozen before the preset was
 * chosen.
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
  preset: StylePresetId = NEW_DOCUMENT_PRESET,
): Panel {
  return assemblePanel(generateId("panel"), {
    representation: defaultRepresentation(kind, preset),
    caption,
  });
}

export interface CreateDocumentInit {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  /** Nothing in the editor writes these; a document carries them in from a
   *  file, and a copy of that document has to keep them. */
  readonly author?: string | undefined;
  readonly notes?: string | undefined;
  readonly molecule?: Molecule | undefined;
  /** With their ids already chosen — the injectable path a fixture takes, so
   *  a document holding an arrow is byte-stable across runs. */
  readonly annotations?: readonly SchemeAnnotationInput[] | undefined;
  /** Defaults to one past the highest `ann_<n>` among `annotations`. */
  readonly nextAnnotationId?: number | undefined;
  readonly stylePreset?: StylePresetId | undefined;
  /** Carried by a copy; nothing else creates a document with edits. */
  readonly styleOverrides?: DocumentStyleOverrides | undefined;
  /** Stored as `assemblePanel` would write them (a view canonical, no key
   *  holding `undefined`); a panel already in that form is kept by reference. */
  readonly panels?: readonly Panel[] | undefined;
  readonly figure?: FigureLayout | undefined;
  /** Explicit locants, keyed on atoms of `molecule`. */
  readonly locants?: Readonly<Record<AtomId, string>> | undefined;
  /** Injectable ISO-8601 "now", so tests are deterministic and an importer
   *  can stamp a document with the file's own timestamp. */
  readonly now?: string | undefined;
}

/**
 * Thrown when a molecule the projection harness rebuilt out of a layout is
 * about to become a document or a file (decision 210). A view must never
 * mint a molecule (decision 12): a derived one is indistinguishable from the
 * document's own, and saving it would store a picture as the chemistry.
 */
export class TestOnlyMoleculeError extends Error {
  constructor(where: string) {
    super(
      `${where} was handed a test-only molecule rebuilt from a projection layout. ` +
        `A projection is a view of the document's molecule, never a molecule of its own.`,
    );
    this.name = "TestOnlyMoleculeError";
  }
}

export function createDocument(init: CreateDocumentInit = {}): SketchDocument {
  const now = init.now ?? new Date().toISOString();
  const stylePreset = init.stylePreset ?? NEW_DOCUMENT_PRESET;
  const molecule = init.molecule ?? emptyMolecule();
  if (isTestOnlyMolecule(molecule)) throw new TestOnlyMoleculeError("createDocument");
  const annotations = (init.annotations ?? []).map(assembleSchemeAnnotation);
  const nextAnnotationId =
    init.nextAnnotationId ??
    annotations.reduce((next, a) => Math.max(next, (idSuffix(a.id) ?? 0) + 1), 1);
  requireReopens(molecule, annotations, nextAnnotationId);
  const doc: SketchDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: init.id ?? generateId("doc"),
    molecule,
    annotations,
    nextAnnotationId,
    stylePreset,
    // Seeded from the preset, so a display default the preset owns — the
    // aromatic circle — reaches the panels a document opens with.
    panels:
      init.panels === undefined
        ? stylePreset === NEW_DOCUMENT_PRESET
          ? DEFAULT_PANELS
          : defaultPanelsFor(stylePreset)
        : assembledPanels(init.panels),
    metadata: assembleMetadata({
      title: init.title ?? "Untitled",
      createdAt: now,
      modifiedAt: now,
      author: init.author,
      notes: init.notes,
    }),
  };
  // Assigned only when present, so a document with no layout has no key.
  const laid = init.figure === undefined ? doc : withFigureLayout(doc, init.figure);
  const numbered = init.locants === undefined ? laid : withLocants(laid, init.locants);
  return init.styleOverrides === undefined
    ? numbered
    : withAllStyleOverrides(numbered, init.styleOverrides);
}

/**
 * `doc` with one preset's style edits replaced, or removed with `null`. The
 * one place a `styleOverrides` entry is written: undefined-valued keys are
 * dropped, an empty set removes the preset's entry, and no entries removes
 * the key. Returns `doc` itself when nothing changes, so a no-op is not an
 * undo step. Throws on a value chem-render's `styleOverrideIssues` refuses.
 */
export function withStyleOverrides(
  doc: SketchDocument,
  preset: StylePresetId,
  overrides: FigureStyleOverrides | null,
): SketchDocument {
  const cleaned =
    overrides === null
      ? {}
      : Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  const issues = styleOverrideIssues(cleaned);
  if (issues.length > 0) {
    throw new Error(`Invalid figure style: ${issues.map((i) => i.message).join("; ")}.`);
  }
  const current = doc.styleOverrides?.[preset];
  if (sameOverrides(current, cleaned)) return doc;
  const entries = STYLE_PRESET_IDS.flatMap((id) => {
    // The untouched presets keep their set BY REFERENCE: the client memoises
    // a resolved style on that object, and an edit to Screen must not make
    // the Publication style a new object.
    const value = id === preset ? Object.freeze({ ...cleaned }) : doc.styleOverrides?.[id];
    return value === undefined || Object.keys(value).length === 0 ? [] : [[id, value] as const];
  });
  const { styleOverrides: _previous, ...rest } = doc;
  void _previous;
  if (entries.length === 0) return rest;
  return { ...rest, styleOverrides: Object.freeze(Object.fromEntries(entries)) };
}

function withAllStyleOverrides(
  doc: SketchDocument,
  overrides: DocumentStyleOverrides,
): SketchDocument {
  return STYLE_PRESET_IDS.reduce(
    (next, id) => withStyleOverrides(next, id, overrides[id] ?? null),
    doc,
  );
}

function sameOverrides(
  a: Readonly<FigureStyleOverrides> | undefined,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const left: Readonly<Record<string, unknown>> = a ?? {};
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && left[k] === b[k])
  );
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

/** The longest locant a document stores: "C-18", "4a", "1′" are a few characters. */
export const MAX_LOCANT_LENGTH = 32;

/**
 * `doc` with its explicit locants replaced, or removed with `null`. The one
 * place a `locants` key is written: entries follow the molecule's `atomIds`
 * order, so two equal maps encode byte-identically, and an empty map leaves
 * no key.
 *
 * @throws if a key is not an atom of `doc.molecule` or a value is not a
 * string of at most `MAX_LOCANT_LENGTH` characters: a caller holding a stale
 * id has a bug, and the codec reports the same thing in a file as an issue.
 */
export function withLocants(
  doc: SketchDocument,
  locants: Readonly<Record<AtomId, string>> | null,
): SketchDocument {
  const { locants: _previous, ...rest } = doc;
  void _previous;
  if (locants === null) return rest;
  for (const key of Object.keys(locants)) {
    if (!Object.hasOwn(doc.molecule.atoms, key)) {
      throw new Error(`A locant names ${key}, which the molecule does not hold.`);
    }
    const value = locants[key];
    if (typeof value !== "string" || value.length > MAX_LOCANT_LENGTH) {
      throw new Error(
        `The locant for ${key} is not a string of at most ${MAX_LOCANT_LENGTH} characters.`,
      );
    }
  }
  // Object.fromEntries defines own properties, so no key can reach a setter
  // on Object.prototype the way `record["__proto__"] = x` would.
  const entries = doc.molecule.atomIds
    .filter((id) => Object.hasOwn(locants, id))
    .map((id) => [id, locants[id]!] as const);
  if (entries.length === 0) return rest;
  return { ...rest, locants: Object.freeze(Object.fromEntries(entries)) };
}

/**
 * `doc` with one atom's explicit locant set, or cleared with `undefined`.
 * `""` is a value, not a clear: it hides the locant the rules would derive.
 * Returns `doc` itself when nothing changes, so a no-op is not an undo step.
 */
export function setAtomLocant(
  doc: SketchDocument,
  atomId: AtomId,
  locant: string | undefined,
): SketchDocument {
  const current = doc.locants ?? {};
  if (locant === undefined) {
    if (!Object.hasOwn(current, atomId)) return doc;
    return withLocants(
      doc,
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== atomId)),
    );
  }
  if (Object.hasOwn(current, atomId) && current[atomId] === locant) return doc;
  return withLocants(doc, Object.fromEntries([...Object.entries(current), [atomId, locant]]));
}

/**
 * `locants` without the atoms `molecule` no longer holds: the SAME object
 * when nothing went, `undefined` when nothing is left. Run in the undo entry
 * of the edit that deleted the atoms, like the annotation pruning beside it.
 */
export function pruneLocants(
  locants: Readonly<Record<AtomId, string>> | undefined,
  molecule: Molecule,
): Readonly<Record<AtomId, string>> | undefined {
  if (locants === undefined) return undefined;
  const kept = Object.entries(locants).filter(([id]) => Object.hasOwn(molecule.atoms, id));
  if (kept.length === Object.keys(locants).length) return locants;
  return kept.length === 0 ? undefined : Object.freeze(Object.fromEntries(kept));
}

// ---------------------------------------------------------------------------
// Projection views (decisions 128, 162)
// ---------------------------------------------------------------------------

/**
 * `view` in its one stored spelling: chem-core's canonical view — angles in
 * [0, 360), a ring's atoms and an overlay's bonds as sets sorted by
 * `compareIds`, a fixed key order, no key holding `undefined` — so two views
 * that draw the same picture are deep-equal and encode byte for byte alike.
 *
 * chem-core's `canonicalProjectionView` IS the assembler, not a copy of it:
 * it is also what the engine keys its layouts on, and a second canonical form
 * here could disagree with it about which two views are one. It builds every
 * object key by key, so a key a caller's object carries beyond the type is
 * dropped rather than saved into a file the strict codec would then refuse.
 * The flip side: a field added to one of chem-core's params types survives a
 * save only once `canonicalProjectionView` copies it AND the schema below
 * reads it. The guard beside the schema catches the second at compile time.
 * The first compiles, because a view missing an optional key is still a
 * `ProjectionView`; panel-view.test.ts catches it by walking the schema's
 * own shape, building a view that holds every key the schema declares, and
 * asserting this function keeps each one. A new key is covered the moment
 * the schema reads it, with no fixture to remember.
 *
 * @throws for an angle that is not a finite number: a caller holding one has
 * a bug, and the codec reports the same thing in a file as an issue.
 */
export function assembleProjectionView(view: ProjectionView): ProjectionView {
  const canonical = canonicalProjectionView(view);
  if (canonical.kind === "unavailable") {
    throw new Error(`A ${view.kind} view carries an angle that is not a finite number.`);
  }
  return canonical;
}

/**
 * Whether `a` and `b` draw the same picture: equal once canonical, so a
 * torsion of 370 equals one of 10 and a ring named in another order is the
 * same ring. The canonical form's key order is fixed, which is what lets its
 * JSON be compared.
 */
export function projectionViewsEqual(a: ProjectionView, b: ProjectionView): boolean {
  if (a === b) return true;
  return (
    JSON.stringify(assembleProjectionView(a)) === JSON.stringify(assembleProjectionView(b))
  );
}

/**
 * `panel` drawing `view`, or the plain drawing again with `null`. The one
 * place a `view` key is written outside the assembler (decision 176).
 *
 * Returns `panel` ITSELF when the view it already stores draws the same
 * picture, so re-choosing the chair a panel shows is not an undo step
 * (decision 159): the history's no-op test is reference identity.
 *
 * THAT IS ONE CALL AGAINST THE PANEL AS IT IS NOW, NOT A WHOLE GESTURE. In a
 * transaction each pointer frame is compared with the frame before it, and
 * the store commits a transaction by document identity. So a torsion drag
 * that ends at the angle it began from still commits ONE entry, with no net
 * change, as an atom dragged back to its pixel does (history.ts). The gesture
 * decides that: it aborts, rather than commits, when
 * `projectionViewsEqual(base, final)`.
 *
 * A spread of `panel` is safe for the reason `touchDocument`'s spread is:
 * nothing in this module stores an `undefined`-valued key, so absent
 * optionals stay absent.
 */
export function panelWithView(panel: Panel, view: ProjectionView | null): Panel {
  if (view === null) {
    if (panel.view === undefined) return panel;
    const { view: _previous, ...rest } = panel;
    void _previous;
    return rest;
  }
  const next = assembleProjectionView(view);
  if (panel.view !== undefined && projectionViewsEqual(panel.view, next)) return panel;
  return { ...panel, view: next };
}

/**
 * `panels` after an edit that may have deleted atoms or bonds: the SAME array
 * when no view had anything to prune, and every untouched panel by reference.
 * Run in the undo entry of the edit, beside the annotation and locant
 * pruning, so undo brings the bonds and the panel back together.
 *
 * ONLY A SET OF INDEPENDENT MEMBERS IS PRUNED (decision 175): the overlay's
 * `bondIds`, where each bond carries its own label and a deleted bond simply
 * stops being labelled. A view's IDENTITY references are never rewritten.
 * A backbone that lost an atom is not a shorter backbone — that is another
 * Fischer, drawn without asking — and a ring set that lost members resolves
 * as a PART of a ring, so pruning it would silently retarget the panel to a
 * neighbouring ring, the exact failure the atom-id set exists to prevent. So
 * a deleted backbone, ring or sighted-bond atom stays named, the panel
 * resolves `unavailable: missing-atom` with a sentence saying to choose
 * again, and undo restores it. A sighted bond's deleted REFERENCE atom stays
 * too: the frame falls back to the lowest-id substituent and REPORTS the
 * fallback, which pruning would turn into a silent "omitted".
 */
export function prunePanelViews(
  panels: readonly Panel[],
  molecule: Molecule,
): readonly Panel[] {
  let changed = false;
  const next = panels.map((panel) => {
    const view = panel.view;
    if (view?.kind !== "annotationOverlay") return panel;
    const kept = view.frame.bondIds.filter((id) => Object.hasOwn(molecule.bonds, id));
    if (kept.length === view.frame.bondIds.length) return panel;
    changed = true;
    return panelWithView(panel, { ...view, frame: { bondIds: kept } });
  });
  return changed ? next : panels;
}

/** An annotation as a caller adds one: everything but the id, which the
 *  document's counter mints. */
export type SchemeAnnotationDraft = SchemeAnnotationInput extends infer T
  ? T extends unknown
    ? Omit<T, "id">
    : never
  : never;

/** A reason the codec refuses a document's annotations, and where it files it. */
interface AnnotationListIssue {
  /** The annotation it is filed against, by index. */
  readonly index: number;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * What the codec refuses about a document's annotations TAKEN TOGETHER, in
 * its own words: a duplicate id, a counter that would reuse one, a reference
 * to an atom or bond the molecule does not hold, and a second partial charge
 * on one atom (decision 201). The one statement of these rules: the decode's
 * `superRefine` files each as an issue, and the writers throw on them
 * (`requireReopens`), so the two cannot drift apart.
 *
 * A DANGLING annotation is refused, never kept: an edit prunes it in the same
 * undo entry, so a file holding one was not written by this editor, and
 * accepting it would make every consumer handle a reference that resolves to
 * nothing. `Object.hasOwn`, never an index read: "constructor" is not an atom.
 */
function annotationListIssues(
  molecule: Molecule,
  annotations: readonly SchemeAnnotation[],
  nextAnnotationId: number,
): AnnotationListIssue[] {
  const issues: AnnotationListIssue[] = [];
  const annotationIds = new Set<string>();
  // Decision 201: one partial charge per atom. A second is two statements
  // about one atom's polarisation that the label pass could only draw one
  // of, so the file is refused rather than half drawn.
  const partialChargeAt = new Map<string, string>();
  annotations.forEach((annotation, index) => {
    if (annotation.kind === "partialCharge") {
      const first = partialChargeAt.get(annotation.atomId);
      if (first !== undefined) {
        issues.push({
          index,
          path: ["annotations", index, "atomId"],
          message: `annotations ${first} and ${annotation.id} both put a partial charge on ${annotation.atomId}`,
        });
      } else {
        partialChargeAt.set(annotation.atomId, annotation.id);
      }
    }
    if (annotationIds.has(annotation.id)) {
      issues.push({ index, path: ["annotations", index, "id"], message: `duplicate annotation id ${annotation.id}` });
    }
    annotationIds.add(annotation.id);
    const suffix = idSuffix(annotation.id);
    if (suffix !== undefined && suffix >= nextAnnotationId) {
      issues.push({
        index,
        path: ["nextAnnotationId"],
        message: `nextAnnotationId ${nextAnnotationId} would reuse the id ${annotation.id}`,
      });
    }
    for (const id of danglingReferences(molecule, annotation)) {
      issues.push({
        index,
        path: ["annotations", index],
        message: `annotation ${annotation.id} names ${id}, which is not in the molecule`,
      });
    }
  });
  return issues;
}

/**
 * Throws unless the codec would decode `annotations` beside `molecule` and
 * `nextAnnotationId`: each record against its schema arm, then the list's
 * rules above. `withLocants`'s rule — a writer refuses what the decode
 * refuses — so a document built here cannot save (journal, IndexedDB, a
 * `.json`) and then fail to reopen. A programming error at this end: the
 * codec reports the same thing in a FILE as a listed issue, because a file is
 * untrusted and a caller is not. `only` limits it to the one record a caller
 * just added to a list that already reopens.
 */
function requireReopens(
  molecule: Molecule,
  annotations: readonly SchemeAnnotation[],
  nextAnnotationId: number,
  only?: number,
): void {
  annotations.forEach((annotation, index) => {
    if (only !== undefined && index !== only) return;
    const parsed = annotationSchema.safeParse(annotation);
    if (!parsed.success) {
      const reasons = parsed.error.issues.map((issue) =>
        issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
      );
      throw new Error(`Annotation ${annotation.id} would not reopen: ${reasons.join("; ")}.`);
    }
  });
  const issue = annotationListIssues(molecule, annotations, nextAnnotationId).find(
    (candidate) => only === undefined || candidate.index === only,
  );
  if (issue !== undefined) {
    throw new Error(`The document would not reopen: ${issue.message}.`);
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
        else if (end.kind === "newBond") end.atomIds.forEach(atom);
        else atom(end.atomId);
      }
      break;
    case "reactionArrow":
      for (const id of [...annotation.from, ...annotation.to]) atom(id);
      break;
    case "retrosynthesisArrow":
      for (const id of [...annotation.target, ...annotation.precursors]) atom(id);
      break;
    case "resonanceArrow":
    case "plus":
      for (const id of annotation.between) atom(id);
      break;
    case "bracket":
      for (const id of annotation.species) atom(id);
      break;
    case "partialBond":
    case "hydrogenBond":
      for (const id of annotation.atoms) atom(id);
      break;
    case "partialCharge":
      atom(annotation.atomId);
      break;
    case "coefficient":
      atom(annotation.species);
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
 * @throws on anything the codec would refuse to reopen: a draft naming an
 * atom or bond the molecule does not hold, one its schema arm refuses (a
 * bracket charge of 0, a temperature below absolute zero, an empty step), or
 * a second partial charge on an atom that has one.
 */
export function addSchemeAnnotation(
  doc: SketchDocument,
  draft: SchemeAnnotationDraft,
): { readonly document: SketchDocument; readonly id: SchemeAnnotationId } {
  const id = schemeAnnotationId(doc.nextAnnotationId);
  const annotation = assembleSchemeAnnotation({ ...draft, id } as SchemeAnnotationInput);
  const annotations = [...doc.annotations, annotation];
  const nextAnnotationId = doc.nextAnnotationId + 1;
  requireReopens(doc.molecule, annotations, nextAnnotationId, annotations.length - 1);
  return { document: { ...doc, annotations, nextAnnotationId }, id };
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

const atomQuerySchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("rgroup"), index: z.number().int().positive().optional() }),
    z.strictObject({ kind: z.literal("any"), symbol: z.enum(["A", "*"]) }),
    z.strictObject({
      kind: z.literal("list"),
      elements: z.array(nonEmptyString).min(1),
      negated: z.boolean(),
    }),
    z.strictObject({ kind: z.literal("generic"), label: nonEmptyString }),
  ])
  .refine((query) => !(normalizeAtomQuery(query) instanceof Error), {
    message: "not a valid query atom",
  });

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
  // Decision 238: a query or generic atom. Shapes here, chemistry in
  // chem-core — an element list naming a non-element is refused by the same
  // `normalizeAtomQuery` every edit goes through, so a file cannot hold a
  // query the editor could not have made.
  query: atomQuerySchema.optional(),
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

/** Decision 238's query bonds, with the same two-way guard. */
export const BOND_QUERY_SCHEMA_VALUES = [
  "any",
  "single-or-double",
  "single-or-aromatic",
  "double-or-aromatic",
] as const satisfies readonly BondQuery[];

type BondQueryListIsTotal =
  BondQuery extends (typeof BOND_QUERY_SCHEMA_VALUES)[number] ? true : never;
const BOND_QUERY_LIST_IS_TOTAL: BondQueryListIsTotal = true;
void BOND_QUERY_LIST_IS_TOTAL;

const bondSchema = z.strictObject({
  id: nonEmptyString,
  from: nonEmptyString,
  to: nonEmptyString,
  order: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  stereo: z.enum(BOND_STEREO_VALUES),
  doubleBondSide: z.enum(DOUBLE_BOND_SIDE_VALUES),
  aromatic: z.boolean(),
  /**
   * OPTIONAL AND ADDITIVE (decision 226), like `stereoGroups`: written only
   * when true, so a document saved before the fields existed still decodes
   * and a plain bond encodes byte-for-byte as it always did. `true` only —
   * `false` is the absent key, never a second spelling of it.
   */
  dative: z.literal(true).optional(),
  bold: z.literal(true).optional(),
  query: z.enum(BOND_QUERY_SCHEMA_VALUES).optional(),
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
    // `updateBond` refuses a dative double bond, so a file may not carry one.
    if (bond.dative === true && (bond.order !== 1 || bond.aromatic)) {
      ctx.addIssue({
        code: "custom",
        message: `bond ${bondId} is dative, which is a single non-aromatic bond`,
        path: ["bonds", bondId, "dative"],
      });
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
/** The schema's refine has already proved the query normalises. */
function normalizedQuery(query: AtomQuery): AtomQuery {
  const normalized = normalizeAtomQuery(query);
  if (normalized instanceof Error) throw normalized;
  return normalized;
}

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
      query: parsed.query === undefined ? undefined : normalizedQuery(parsed.query),
    });
  }
  const bonds: Record<BondId, Bond> = {};
  for (const id of mol.bondIds) {
    const parsed = mol.bonds[id]!;
    bonds[id] = withBondFlags(
      {
        id,
        from: parsed.from,
        to: parsed.to,
        order: parsed.order,
        stereo: parsed.stereo,
        doubleBondSide: parsed.doubleBondSide,
        aromatic: parsed.aromatic,
        ...(parsed.query === undefined ? {} : { query: parsed.query }),
      },
      { dative: parsed.dative === true, bold: parsed.bold === true },
    );
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

/**
 * The projection value unions chem-core declares as types only, each listed
 * once with the two-way guard the bond unions above carry, for the same
 * reason: a member added to the model and not to the codec encodes fine and
 * then fails to decode, and one panel is enough to lose the document.
 *
 * The frame kinds and the templates need no list here. The schema reads
 * chem-core's `PROJECTION_TEMPLATES` directly, which lists every decision-13
 * template built or not, so a template is a value a panel may store from the
 * moment chem-core lists it.
 */
export const CHAIN_TOP_VALUES = ["first", "last"] as const satisfies readonly ChainParams["top"][];

type ChainTopListIsTotal =
  ChainParams["top"] extends (typeof CHAIN_TOP_VALUES)[number] ? true : never;
const CHAIN_TOP_LIST_IS_TOTAL: ChainTopListIsTotal = true;
void CHAIN_TOP_LIST_IS_TOTAL;

export const RING_FACE_VALUES = ["front", "back"] as const satisfies readonly RingParams["face"][];

type RingFaceListIsTotal =
  RingParams["face"] extends (typeof RING_FACE_VALUES)[number] ? true : never;
const RING_FACE_LIST_IS_TOTAL: RingFaceListIsTotal = true;
void RING_FACE_LIST_IS_TOTAL;

/**
 * The puckered forms a ring panel may pin (decision 154). Only the chair
 * today; a boat, a half-chair and a twist-boat each pin more than one atom,
 * so they arrive with the chair template as new ARMS of the conformer union,
 * and the guard below then fails until this list and the schema grow them.
 */
export const RING_CONFORMER_FORMS = ["chair"] as const satisfies readonly RingConformer["form"][];

type RingConformerListIsTotal =
  RingConformer["form"] extends (typeof RING_CONFORMER_FORMS)[number] ? true : never;
const RING_CONFORMER_LIST_IS_TOTAL: RingConformerListIsTotal = true;
void RING_CONFORMER_LIST_IS_TOTAL;

/**
 * An id SET. Order is not significant — the transform stores it sorted — but
 * an id named twice is a second spelling of a smaller set, refused the way a
 * species join naming an atom twice is. A number, the shape a ring INDEX into
 * `rings(mol)` would have, is refused by the element type: indices renumber
 * on any topology edit, and a panel keyed on one would silently show another
 * ring.
 */
function idSetSchema(what: string) {
  return z.array(nonEmptyString).superRefine((ids, ctx) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `${what} ${id} is named twice; the ${what}s of a view are a set`,
          path: [index],
        });
      }
      seen.add(id);
    });
  });
}

/**
 * A planar panel's accepted skeletons (decisions 195, 220): never empty, and
 * no atom in two cores. Whether two cores share a SPECIES needs the molecule
 * and an edit can bring it about, so that is left to the engine.
 */
const acceptedSkeletonsSchema = z
  .array(z.strictObject({ name: z.enum(SKELETON_NAMES), core: z.array(nonEmptyString) }))
  .min(1)
  .superRefine((skeletons, ctx) => {
    for (const id of sharedSkeletonAtoms(skeletons)) {
      ctx.addIssue({ code: "custom", message: `atom ${id} is in two accepted skeleton cores` });
    }
  });

/**
 * The stored view, arm by arm, as chem-core types it (decision 162).
 *
 * ATOM IDS ARE NOT CHECKED AGAINST THE MOLECULE (decision 175), unlike an
 * annotation's or a locant's. A view is a question about the molecule — "the
 * Fischer of this backbone" — and a stale one is an honest state the panel
 * reports (`unavailable: missing-atom`, "choose again") rather than a corrupt
 * file: the engine resolves every id with `Object.hasOwn` before any
 * traversal, so even "constructor" is only a missing atom. Unknown keys ARE
 * refused (decision 110), at every depth, and so is anything no edit can
 * produce: a number where an id goes, an id twice in a set, a template of
 * another frame kind.
 *
 * Angles are any finite number here (`z.number` refuses NaN and Infinity) and
 * are canonicalised by the transform, so a hand-written 370 opens as 10.
 */
const projectionViewShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("planar"),
    template: z.enum(PROJECTION_TEMPLATES.planar),
    frame: z.strictObject({}),
    params: z.strictObject({
      rotationDeg: z.number(),
      mirror: z.boolean(),
      // The skeletons the user accepted for the panel (decision 163), at most
      // one core per species (decision 195). Each `core` is ORDERED, one atom
      // per locant, so it is never a set and never sorted; only the list is
      // put in its stored order by the transform (decision 220). A core that
      // no longer fits, or two cores an edit has put in one species, is the
      // engine's `skeleton-mismatch`, not a corrupt file (decision 175); an
      // empty list and an atom named by two cores are second spellings no
      // edit produces, and are refused. The retired single `skeleton` key is
      // refused as unknown: it shipped behind no UI, so no file holds it.
      skeletons: acceptedSkeletonsSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("chain"),
    template: z.enum(PROJECTION_TEMPLATES.chain),
    // ORDERED, first atom first; not a set. A repeated atom is the engine's
    // `repeated-atom`, reported on the panel like any other bad backbone.
    frame: z.strictObject({ backbone: z.array(nonEmptyString) }),
    params: z.strictObject({ top: z.enum(CHAIN_TOP_VALUES) }),
  }),
  z.strictObject({
    kind: z.literal("ring"),
    template: z.enum(PROJECTION_TEMPLATES.ring),
    frame: z.strictObject({
      ringAtomIds: idSetSchema("ring atom"),
      referenceAtomId: nonEmptyString.optional(),
    }),
    params: z.strictObject({
      face: z.enum(RING_FACE_VALUES),
      conformer: z
        .discriminatedUnion("form", [
          z.strictObject({ form: z.literal(RING_CONFORMER_FORMS[0]), frontAtomId: nonEmptyString }),
        ])
        .optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("sightedBond"),
    template: z.enum(PROJECTION_TEMPLATES.sightedBond),
    frame: z.strictObject({
      front: nonEmptyString,
      back: nonEmptyString,
      frontReference: nonEmptyString.optional(),
      backReference: nonEmptyString.optional(),
    }),
    // The dihedral (chemistry) and the roll of the whole picture (cosmetic)
    // are two fields, so "straighten the figure" never rewrites a torsion.
    params: z.strictObject({ torsionDeg: z.number(), rollDeg: z.number() }),
  }),
  z.strictObject({
    kind: z.literal("annotationOverlay"),
    template: z.enum(PROJECTION_TEMPLATES.annotationOverlay),
    frame: z.strictObject({ bondIds: idSetSchema("overlay bond") }),
    params: z.strictObject({}),
  }),
]);

/**
 * THE SCHEMA MIRRORS CHEM-CORE'S `ProjectionView` EXACTLY, checked in both
 * directions at compile time (decision 176). Compared after `Plain` strips `readonly` and
 * the `undefined` zod adds to an optional key, the two types must be
 * IDENTICAL, arm by arm and key by key, optional keys included: a frame kind,
 * a template, a params field or a conformer form that one side has and the
 * other lacks is a type error at the line below, never a panel that saves and
 * then refuses to open. Mutual assignability would not do: it lets an extra
 * OPTIONAL key through in either direction, and optional keys are exactly how
 * this type grows (the steroid acceptance of decision 163 was the first).
 *
 * An object with no keys at all is written `{}` whichever side it came from:
 * zod types an empty strict object as `Record<string, never>` and chem-core
 * writes `Readonly<Record<never, never>>`, and both admit exactly `{}`.
 */
type Plain<T> = T extends readonly (infer E)[]
  ? Plain<E>[]
  : T extends object
    ? [T] extends [Record<string, never>]
      ? {}
      : { -readonly [K in keyof T]: Plain<Exclude<T[K], undefined>> }
    : T;
type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ViewSchemaMirrorsModel =
  Identical<Plain<z.output<typeof projectionViewShapeSchema>>, Plain<ProjectionView>> extends true
    ? true
    : never;
const VIEW_SCHEMA_MIRRORS_MODEL: ViewSchemaMirrorsModel = true;
void VIEW_SCHEMA_MIRRORS_MODEL;

/**
 * The decoded view: canonical, through the same assembler every caller's
 * view goes through. The cast is sound by the guard above; the one thing zod
 * adds, a present optional key holding `undefined`, is what
 * `canonicalProjectionView` omits.
 */
export const projectionViewSchema = projectionViewShapeSchema.transform(
  (value): ProjectionView => assembleProjectionView(value as ProjectionView),
);

export const panelSchema = z
  .strictObject({
    id: nonEmptyString,
    representation: representationSchema,
    caption: z.string().optional(),
    // Optional and additive on v2 (the epic's one-migration ruling): a panel
    // drawing the plain structure has no key.
    view: projectionViewSchema.optional(),
  })
  .transform((value): Panel =>
    assemblePanel(value.id, {
      representation: value.representation,
      caption: value.caption,
      view: value.view,
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
  // Decision 166, additive on v2: `[end, atom]`, the end where the electrons
  // start first. Both are checked against the molecule like any anchor; an
  // end the source does not hold is chem-core's to report, not a bad file.
  z.strictObject({
    kind: z.literal(CURLY_ARROW_SINK_KINDS[3]),
    atomIds: z.tuple([nonEmptyString, nonEmptyString]),
  }),
]);

/**
 * A reaction's conditions (decisions 193 and 202). A temperature is a number
 * no colder than absolute zero in its unit; a time is positive; the three
 * text kinds hold what the author typed, never empty. Steps are never empty,
 * and neither is the list of them: "no conditions" is written by omission.
 * Each is refused as damage, not as a newer build's file (decision 215): only
 * an unknown KIND or key is that, since the enums of units and biases are not
 * ruled to grow and calling a hand edit "newer" would hide it.
 */
const conditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal(REACTION_CONDITION_KINDS[0]), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal(REACTION_CONDITION_KINDS[1]), text: z.string().min(1) }),
  z
    .strictObject({
      kind: z.literal(REACTION_CONDITION_KINDS[2]),
      value: z.number().finite(),
      unit: z.enum(TEMPERATURE_UNITS),
    })
    .refine((item) => item.value >= ABSOLUTE_ZERO[item.unit], "a temperature below absolute zero"),
  z.strictObject({
    kind: z.literal(REACTION_CONDITION_KINDS[3]),
    value: z.number().positive().finite(),
    unit: z.enum(TIME_UNITS),
  }),
  z.strictObject({ kind: z.literal(REACTION_CONDITION_KINDS[4]), text: z.string().min(1) }),
]);

const conditionsSchema = z.strictObject({
  steps: z.array(z.array(conditionSchema).min(1)).min(1),
  numbered: z.boolean(),
});

const equilibriumSchema = z.strictObject({ bias: z.enum(EQUILIBRIUM_BIASES).optional() });

/** A condition kind in chem-render's list with no arm above, or the reverse,
 *  is a compile error. */
type ConditionArmsAreTotal = [z.infer<typeof conditionSchema>["kind"]] extends [
  (typeof REACTION_CONDITION_KINDS)[number],
]
  ? [(typeof REACTION_CONDITION_KINDS)[number]] extends [z.infer<typeof conditionSchema>["kind"]]
    ? true
    : never
  : never;
const CONDITION_ARMS_ARE_TOTAL: ConditionArmsAreTotal = true;
void CONDITION_ARMS_ARE_TOTAL;

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
    // Decisions 193 and 194, additive on v2.
    equilibrium: equilibriumSchema.optional(),
    conditions: conditionsSchema.optional(),
  }),
  // Decision 201: the retro and resonance arrows are KINDS of their own, so
  // no reader of reaction steps can meet one as a forward arrow.
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("retrosynthesisArrow"),
    target: z.array(nonEmptyString).min(1),
    precursors: z.array(nonEmptyString).min(1),
    row: z.number().int().min(0).optional(),
    conditions: conditionsSchema.optional(),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("resonanceArrow"),
    between: z.tuple([nonEmptyString, nonEmptyString]),
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
    // Decision 194: a net charge, never zero — "no charge" is written by
    // omitting the key, one spelling per statement.
    charge: z
      .number()
      .int()
      .refine((charge) => charge !== 0, "a bracket's charge of 0 is written by omitting it")
      .optional(),
    transitionState: z.literal(true).optional(),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("text"),
    text: z.string().min(1),
    at: vec2Schema,
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("partialBond"),
    atoms: z
      .tuple([nonEmptyString, nonEmptyString])
      .refine(([a, b]) => a !== b, "a partial bond runs between two different atoms"),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("partialCharge"),
    atomId: nonEmptyString,
    sign: z.enum(PARTIAL_CHARGE_SIGNS),
  }),
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("coefficient"),
    species: nonEmptyString,
    value: z.number().positive().finite(),
  }),
  // Decision 226: additive on v2, like the reaction-arrow kinds.
  z.strictObject({
    id: nonEmptyString,
    kind: z.literal("hydrogenBond"),
    atoms: z
      .tuple([nonEmptyString, nonEmptyString])
      .refine(([a, b]) => a !== b, "a hydrogen bond runs between two different atoms"),
  }),
]);

/** A curly-arrow endpoint kind in chem-render's lists with no arm here, or an
 *  arm naming a kind the lists do not hold, is a compile error. */
type ArmsMatch<Arms, Kinds> = [Arms] extends [Kinds] ? ([Kinds] extends [Arms] ? true : never) : never;
const SOURCE_ARMS_ARE_TOTAL: ArmsMatch<
  z.infer<typeof curlySourceSchema>["kind"],
  (typeof CURLY_ARROW_SOURCE_KINDS)[number]
> = true;
const SINK_ARMS_ARE_TOTAL: ArmsMatch<
  z.infer<typeof curlySinkSchema>["kind"],
  (typeof CURLY_ARROW_SINK_KINDS)[number]
> = true;
void SOURCE_ARMS_ARE_TOTAL;
void SINK_ARMS_ARE_TOTAL;

/** A new kind in chem-render's list with no arm above is a compile error. */
type AnnotationSchemaIsTotal = (typeof SCHEME_ANNOTATION_KINDS)[number] extends z.infer<
  typeof annotationSchema
>["kind"]
  ? true
  : never;
const ANNOTATION_SCHEMA_IS_TOTAL: AnnotationSchemaIsTotal = true;
void ANNOTATION_SCHEMA_IS_TOTAL;

/**
 * The explicit-locant map. A `"__proto__"` key is REFUSED here, on the raw
 * value, because `z.record` builds its output by assignment and assigning
 * `"__proto__"` sets a prototype instead of a key: the entry would vanish,
 * and `{"a1": "1", "__proto__": "x"}` would decode clean with one locant
 * silently dropped (decision 110: refuse, never strip). JSON.parse makes it
 * an own key, which is how a hand-edited file carries one.
 */
const locantsSchema = z.preprocess(
  (value, ctx) => {
    if (typeof value === "object" && value !== null && Object.hasOwn(value, "__proto__")) {
      ctx.addIssue({
        code: "custom",
        message: "a locant names __proto__, which is not in the molecule",
        path: ["__proto__"],
        input: value,
      });
    }
    return value;
  },
  z.record(nonEmptyString, z.string().max(MAX_LOCANT_LENGTH)),
);

/**
 * One preset's style edits. Values are checked by chem-render's
 * `styleOverrideIssues`, the rule `withStyleOverrides` applies, so a file and
 * an edit cannot disagree; an out-of-range value is refused, not clamped
 * (decision 110). An empty set is refused as a second spelling of "no edits".
 */
const presetStyleOverridesSchema = z
  .record(z.string(), z.union([z.number(), z.string()]))
  .superRefine((value, ctx) => {
    if (Object.hasOwn(value, "__proto__")) {
      ctx.addIssue({ code: "custom", message: "__proto__ is not a style value", path: ["__proto__"] });
    }
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", message: "an empty style edit is written by omitting the key" });
    }
    for (const issue of styleOverrideIssues(value)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [issue.key] });
    }
  });

const styleOverridesSchema = z
  .strictObject({
    publication: presetStyleOverridesSchema.optional(),
    nature: presetStyleOverridesSchema.optional(),
    screen: presetStyleOverridesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", message: "no style edits is written by omitting the key" });
    }
  });

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
    stylePreset: z.enum(["publication", "nature", "screen"]),
    // Optional and additive on v2, like `figure` (decision 237).
    styleOverrides: styleOverridesSchema.optional(),
    panels: z.array(panelSchema),
    // Optional and additive: a file from before the field existed has no key,
    // and still decodes at SCHEMA_VERSION 1. See `FigureLayout`.
    figure: z
      .strictObject({ columns: z.number().int().min(1).max(MAX_FIGURE_COLUMNS) })
      .optional(),
    // Optional and additive on v2, like `figure`: a document with no explicit
    // locant has no key. Keys are checked against the molecule below.
    locants: locantsSchema.optional(),
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
    // ids are below `nextId`; every atom and bond an annotation names is in
    // the molecule; one partial charge per atom. The same rules the writers
    // throw on (`annotationListIssues`).
    const assembled = doc.annotations.map(assembleSchemeAnnotation);
    for (const issue of annotationListIssues(doc.molecule, assembled, doc.nextAnnotationId)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    }

    // A locant for an atom that is not there is a dangling reference, refused
    // like an annotation's; an edit prunes it in the same undo entry. An empty
    // map is a second spelling of "no locants", which is written by omission.
    if (doc.locants !== undefined) {
      const keys = Object.keys(doc.locants);
      if (keys.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "an empty locant map is written by omitting the key",
          path: ["locants"],
        });
      }
      for (const key of keys) {
        if (!Object.hasOwn(doc.molecule.atoms, key)) {
          ctx.addIssue({
            code: "custom",
            message: `a locant names ${key}, which is not in the molecule`,
            path: ["locants", key],
          });
        }
      }
    }
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
    const laid = doc.figure === undefined ? base : withFigureLayout(base, doc.figure);
    const numbered = doc.locants === undefined ? laid : withLocants(laid, doc.locants);
    return doc.styleOverrides === undefined
      ? numbered
      : withAllStyleOverrides(numbered, doc.styleOverrides as DocumentStyleOverrides);
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

/** And that it reads every key a `SketchDocument` has: a field added to the
 *  interface and not to the strict schema would make every document that
 *  carries it unopenable (decision 110). */
type DocumentSchemaCoversModel = keyof SketchDocument extends keyof z.input<
  typeof sketchDocumentSchema
>
  ? true
  : never;
const DOCUMENT_SCHEMA_COVERS_MODEL: DocumentSchemaCoversModel = true;
void DOCUMENT_SCHEMA_COVERS_MODEL;

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
  "query",
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
    ...(bond.dative ? { dative: true } : {}),
    ...(bond.bold ? { bold: true } : {}),
    ...(bond.query === undefined ? {} : { query: bond.query }),
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
  // A fresh canonical value, key by key: the stored view already is one, and
  // re-assembling costs nothing and shares no object with the live document.
  if (panel.view !== undefined) encoded.view = assembleProjectionView(panel.view);
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
  if (isTestOnlyMolecule(doc.molecule)) throw new TestOnlyMoleculeError("encodeDocument");
  const encoded: JsonObject = {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    molecule: encodeMolecule(doc.molecule),
    annotations: doc.annotations.map(encodeAnnotation),
    nextAnnotationId: doc.nextAnnotationId,
    stylePreset: doc.stylePreset,
  };
  if (doc.styleOverrides !== undefined) {
    encoded.styleOverrides = Object.fromEntries(
      Object.entries(doc.styleOverrides).map(([id, set]) => [id, { ...set }]),
    );
  }
  encoded.panels = doc.panels.map(encodePanel);
  if (doc.figure !== undefined) encoded.figure = { columns: doc.figure.columns };
  if (doc.locants !== undefined) encoded.locants = Object.fromEntries(Object.entries(doc.locants));
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
 *
 * Or a RING CONFORMER FORM it does not know. The conformer union is the one
 * value union a ruling names as growing on v2 (decision 154: a boat, a
 * half-chair and a twist-boat arrive as new arms, each pinning more atoms),
 * and a new arm is refused on its discriminator, before any key is looked
 * at, so the file shows no unknown key. This has to be known by the build
 * that MEETS such a file, which is every build before the chair task, so it
 * lives here now rather than arriving with the forms.
 *
 * Or a CURLY-ARROW SOURCE OR SINK KIND it does not know, for the same
 * reason: the endpoint unions grow on v2 (decision 166 added `newBond`,
 * decision 199 made this build the one that says so about the NEXT kind),
 * and a new arm is refused on its discriminator with no unknown key in
 * sight. A build before 199 calls a `newBond` file damaged; that cannot be
 * mended from here.
 *
 * Or an ANNOTATION KIND or a CONDITION KIND it does not know (decision 201),
 * by the same argument: both unions grew on v2 with the reaction-arrows task
 * and will grow again. A build before it calls a file holding a retro arrow
 * or a partial bond damaged; that too cannot be mended from here.
 *
 * `some`, not `every`: a newer build's file routinely carries several new
 * things at once, a new key beside a new annotation sink kind, and the
 * second must not turn the first's "newer version" into "corrupt". The cost
 * is that a hand-damaged file that ALSO holds an unknown key (a ring frame
 * `{ringIndex: 0}`, missing `ringAtomIds`) is called newer; telling that
 * apart would need the parsed input, not the issue list. The same goes for a
 * discriminator: zod reports a missing or non-string `form` or `kind`
 * exactly as it reports an unknown one.
 */
export function isFromNewerBuild(error: z.ZodError): boolean {
  return error.issues.some(
    (issue) =>
      issue.code === "unrecognized_keys" ||
      isUnknownRingConformerForm(issue) ||
      isUnknownCurlyArrowEndKind(issue) ||
      isUnknownAnnotationKind(issue) ||
      isUnknownConditionKind(issue),
  );
}

/** The issue zod raises when no annotation arm has the file's `kind`:
 *  `annotations.<n>.kind`. The annotation union grows on v2 (decision 201
 *  added five kinds), so the NEXT kind is a newer build's, not damage. */
function isUnknownAnnotationKind(issue: z.core.$ZodIssue): boolean {
  if (issue.code !== "invalid_union" || issue.discriminator !== "kind") return false;
  const path = issue.path;
  return path.length === 3 && path[0] === "annotations" && path[2] === "kind";
}

/** The issue zod raises when no condition arm has the file's `kind`:
 *  `annotations.<n>.conditions.steps.<s>.<i>.kind` (decision 201). */
function isUnknownConditionKind(issue: z.core.$ZodIssue): boolean {
  if (issue.code !== "invalid_union" || issue.discriminator !== "kind") return false;
  const path = issue.path;
  return (
    path.length === 7 &&
    path[0] === "annotations" &&
    path[2] === "conditions" &&
    path[3] === "steps" &&
    path[6] === "kind"
  );
}

/** The issue zod raises when no arm of the view's conformer union has the
 *  file's `form`: `panels.<n>.view.params.conformer.form`. */
function isUnknownRingConformerForm(issue: z.core.$ZodIssue): boolean {
  if (issue.code !== "invalid_union" || issue.discriminator !== "form") return false;
  const path = issue.path;
  const tail = ["view", "params", "conformer", "form"];
  return (
    path.length === tail.length + 2 &&
    path[0] === "panels" &&
    tail.every((key, index) => path[index + 2] === key)
  );
}

/** The issue zod raises when no arm of a curly arrow's source or sink union
 *  has the file's `kind`: `annotations.<n>.source.kind` or `.sink.kind`. */
function isUnknownCurlyArrowEndKind(issue: z.core.$ZodIssue): boolean {
  if (issue.code !== "invalid_union" || issue.discriminator !== "kind") return false;
  const path = issue.path;
  return (
    path.length === 4 &&
    path[0] === "annotations" &&
    (path[2] === "source" || path[2] === "sink") &&
    path[3] === "kind"
  );
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
