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
  type Atom,
  type AtomId,
  type Bond,
  type BondId,
  type Molecule,
} from "@starter/chem-core";
import { z } from "zod";

/**
 * Bumped when the on-disk shape changes incompatibly. A document carrying a
 * higher number is rejected rather than half-understood — silently dropping
 * fields we do not know about is how a save turns into data loss.
 */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** `publication` is ACS-like (thin bonds, serif labels); `screen` is the editor. */
export type StylePresetId = "publication" | "screen";

export type RepresentationKind =
  | "skeletal"
  | "kekule"
  | "explicitH"
  | "lewis"
  | "condensed"
  | "sumFormula";

/**
 * Orthogonal display switches. They only mean anything for the four
 * structural 2D views (`skeletal`, `kekule`, `explicitH`, `lewis`) — there is
 * nowhere to draw a lone pair on a sum formula — but they are stored for
 * every panel so that flipping a panel's kind back and forth does not lose
 * the settings the chemist had chosen.
 */
export interface RepresentationDisplay {
  readonly showCarbonLabels: boolean;
  readonly aromaticCircles: boolean;
  readonly showLonePairs: boolean;
  readonly showStereoDescriptors: boolean;
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

export interface SketchDocument {
  readonly schemaVersion: number;
  readonly id: string;
  readonly molecule: Molecule;
  readonly stylePreset: StylePresetId;
  readonly panels: readonly Panel[];
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
      display: { ...init.representation.display },
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
 * Display defaults per representation kind, each one a drawing convention
 * rather than a taste call:
 *
 * - Carbon labels are shown only for `explicitH`, because a fully explicit
 *   structure spells out every C and H; hiding carbons is the definition of a
 *   skeletal drawing.
 * - Lone pairs are shown only for `lewis`, because a Lewis structure without
 *   them is just a Kekule structure.
 * - Aromatic circles default off even on `skeletal`: chem-core builds benzene
 *   as an explicit Kekule ring, and drawing a circle over alternating double
 *   bonds would state the delocalisation twice.
 * - Stereo descriptors (R/S, E/Z) default off — they are an annotation the
 *   chemist opts into per figure, and a wrong one is worse than none.
 */
export function defaultRepresentation(kind: RepresentationKind): Representation {
  return {
    kind,
    display: {
      showCarbonLabels: kind === "explicitH",
      aromaticCircles: false,
      showLonePairs: kind === "lewis",
      showStereoDescriptors: false,
    },
  };
}

/**
 * The panels a fresh document opens with: the structure you draw into, and
 * the formula that tells you at a glance whether it is the compound you meant.
 */
export const DEFAULT_PANELS: readonly Panel[] = Object.freeze([
  assemblePanel("panel-skeletal", {
    representation: defaultRepresentation("skeletal"),
  }),
  assemblePanel("panel-sum-formula", {
    representation: defaultRepresentation("sumFormula"),
  }),
]);

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
export function createPanel(kind: RepresentationKind, caption?: string): Panel {
  return assemblePanel(generateId("panel"), {
    representation: defaultRepresentation(kind),
    caption,
  });
}

export interface CreateDocumentInit {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly molecule?: Molecule | undefined;
  readonly stylePreset?: StylePresetId | undefined;
  readonly panels?: readonly Panel[] | undefined;
  /** Injectable ISO-8601 "now", so tests are deterministic and an importer
   *  can stamp a document with the file's own timestamp. */
  readonly now?: string | undefined;
}

export function createDocument(init: CreateDocumentInit = {}): SketchDocument {
  const now = init.now ?? new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: init.id ?? generateId("doc"),
    molecule: init.molecule ?? emptyMolecule(),
    stylePreset: init.stylePreset ?? "screen",
    panels: init.panels ?? DEFAULT_PANELS,
    metadata: assembleMetadata({
      title: init.title ?? "Untitled",
      createdAt: now,
      modifiedAt: now,
    }),
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
const vec2Schema = z.object({ x: z.number(), y: z.number() });

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

const atomSchema = z.object({
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
  label: z.string().optional(),
});

const bondSchema = z.object({
  id: nonEmptyString,
  from: nonEmptyString,
  to: nonEmptyString,
  order: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  stereo: z.enum(["none", "wedge", "hash", "wavy"]),
  doubleBondSide: z.enum(["auto", "left", "right", "centered"]),
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

const moleculeShapeSchema = z.object({
  atoms: z.record(z.string(), atomSchema),
  bonds: z.record(z.string(), bondSchema),
  atomIds: z.array(nonEmptyString),
  bondIds: z.array(nonEmptyString),
  nextId: z.number().int().positive(),
});

type MoleculeShape = z.infer<typeof moleculeShapeSchema>;

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
        ? `${bond.from} ${bond.to}`
        : `${bond.to} ${bond.from}`;
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
  return {
    atoms,
    bonds,
    atomIds: [...mol.atomIds],
    bondIds: [...mol.bondIds],
    nextId: mol.nextId,
  };
}

export const moleculeSchema = moleculeShapeSchema
  .superRefine(checkMoleculeIntegrity)
  .transform(rebuildMolecule);

export const representationSchema = z
  .object({
    kind: z.enum([
      "skeletal",
      "kekule",
      "explicitH",
      "lewis",
      "condensed",
      "sumFormula",
    ]),
    display: z.object({
      showCarbonLabels: z.boolean(),
      aromaticCircles: z.boolean(),
      showLonePairs: z.boolean(),
      showStereoDescriptors: z.boolean(),
    }),
  })
  .transform(
    (value): Representation => ({
      kind: value.kind,
      display: {
        showCarbonLabels: value.display.showCarbonLabels,
        aromaticCircles: value.display.aromaticCircles,
        showLonePairs: value.display.showLonePairs,
        showStereoDescriptors: value.display.showStereoDescriptors,
      },
    }),
  );

export const panelSchema = z
  .object({
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
  .object({
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

export const sketchDocumentSchema = z
  .object({
    // A document from a future build is rejected outright; when
    // SCHEMA_VERSION moves past 1, an upgrade step for the older numbers
    // goes here rather than a wider bound.
    schemaVersion: z.number().int().positive().max(SCHEMA_VERSION),
    id: nonEmptyString,
    molecule: moleculeSchema,
    stylePreset: z.enum(["publication", "screen"]),
    panels: z.array(panelSchema),
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
  return {
    atoms,
    bonds,
    atomIds: [...mol.atomIds],
    bondIds: [...mol.bondIds],
    nextId: mol.nextId,
  };
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
  return {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    molecule: encodeMolecule(doc.molecule),
    stylePreset: doc.stylePreset,
    panels: doc.panels.map(encodePanel),
    metadata: encodeMetadata(doc.metadata),
  };
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
