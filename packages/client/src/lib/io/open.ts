/**
 * Text -> documents. The import path for a drop, a paste and a file picker.
 *
 * ── THE NATIVE FORMATS NEVER TOUCH THE WORKER ──────────────────────────────
 *
 * JSON, MOL and SDF are all read by code that is already in the bundle:
 * @starter/shared's codec for the first and chem-core's V2000 reader (through
 * `@/lib/rdkit/translate`, which despite its directory imports no RDKit — its
 * own header says so) for the other two. Only SMILES reaches RDKit, and it
 * reaches it through a DYNAMIC import so that dropping a molfile does not
 * fetch 6.9 MB of wasm. `e2e/rdkit.spec.ts` is built on exactly that promise
 * and `cleanup.ts` already establishes the pattern.
 *
 * Note the import is from `@/lib/rdkit/translate` and not from the `@/lib/rdkit`
 * barrel: the barrel re-exports `client.ts`, which would put the worker
 * plumbing in whatever chunk this module lands in.
 *
 * ── DECISION 7: AN SDF BECOMES N DOCUMENTS ─────────────────────────────────
 *
 * Not N fragments on one canvas. A vendor catalogue of forty compounds is
 * forty structures, and merging them into one molecule would produce a
 * "molecule" that is not a compound and cannot be exported as one. chem-core's
 * reader stops at the first `$$$$` deliberately, so the split is `sniff.ts`'s
 * and the loop is here.
 *
 * A record that fails to read does NOT sink the file. Losing 49 good
 * structures because the 50th is V3000 is a worse outcome than importing 49
 * and saying so.
 *
 * ── TWO WARNINGS ARE SURFACED RATHER THAN SWALLOWED ────────────────────────
 *
 * `three-dimensional` — which PubChem's default SDF download trips on every
 * file — comes back as a successful import with the z coordinate dropped, and
 * a flattened conformer usually looks like a tangle. It is reported with the
 * offer to re-lay-out, which is `structure.clean-up`.
 *
 * `surplus-block` is NOT a caveat on this path, and the brief's framing of it
 * as one does not match the code: `@/lib/rdkit/translate` classifies it as
 * LOSSY, so `molblockToMolecule` REFUSES the import outright rather than
 * returning it with a banner. That guard is deliberate — a counts field
 * overflowing past 999 silently drops 90% of a structure — so it is left
 * standing and its message is surfaced verbatim instead of being flattened to
 * "could not read file".
 *
 * ── IMPORTS ARE SCALED TO THE STANDARD BOND ────────────────────────────────
 *
 * See `documentFromStructure`: a structure drawn at another tool's bond length
 * arrives with a median bond of one model unit, so it prints at the house
 * bond length like anything drawn here.
 *
 * ── AND WHY InChI ONLY GETS AS FAR AS A NAMED REFUSAL ──────────────────────
 *
 * See `INCHI_UNSUPPORTED` below. Measured against the shipped wasm.
 */

import { normalizeBondLength } from "@starter/chem-core";
import { createDocument, safeDecodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { molblockToMolecule } from "@/lib/rdkit/translate";
import type { ChemIoResult, ImportedStructure } from "@/lib/rdkit/types";
import { migrateStored, newerBuildMessage } from "@/persistence/migrate";

import { isLibraryFile, libraryFailureNote, readLibrary } from "./library";
import { sniffFormat, splitSdfRecords, type SniffedFormat } from "./sniff";

/**
 * THIS BUILD OF RDKit CANNOT READ AN InChI, and that is a measurement rather
 * than a caution.
 *
 * MinimalLib exports `get_mol`, `get_qmol`, `get_mol_copy`,
 * `get_mol_from_uint8array` and `get_inchikey_for_inchi` — the last of which
 * goes InChI -> key, not InChI -> molecule. Handing `get_mol` an InChI string
 * returns null and logs `SMILES Parse Error: Failed parsing SMILES
 * 'InChI=1S/C6H6/...'`: it is dispatched as a SMILES, not sniffed. Verified
 * against `@rdkit/rdkit` 2025.3.4-1.0.0 for benzene, ethanol and thiophene,
 * with and without options. `inchi.node.test.ts` pins it, so a future build
 * that gains the reader fails that test rather than silently staying dark.
 *
 * The alternative — passing the string to `fromSmiles` and letting it fail —
 * would report "Failed parsing SMILES" for a string that plainly says InChI,
 * which is the kind of error message that costs someone an afternoon.
 */
export const INCHI_UNSUPPORTED =
  "This editor cannot read an InChI: the bundled RDKit build converts a structure " +
  "TO an InChI but not back. Paste a SMILES or open a molfile instead.";

export interface OpenedDocuments {
  readonly documents: readonly SketchDocument[];
  readonly format: SniffedFormat;
  /** Worth showing the user; not failures. */
  readonly warnings: readonly string[];
  /** At least one structure arrived as a flattened 3D conformer, so offering
   *  "Clean up structure" is the right next move. */
  readonly needsLayout: boolean;
}

export type OpenResult =
  | { readonly ok: true; readonly value: OpenedDocuments }
  | { readonly ok: false; readonly message: string };

/** Just the piece of `@/lib/rdkit` this module uses, so a test can supply it
 *  and prove that the native formats never ask for it. */
export interface RdkitImportBridge {
  fromSmiles(smiles: string): Promise<ChemIoResult<ImportedStructure>>;
}

export type LoadRdkit = () => Promise<RdkitImportBridge>;

export interface OpenTextOptions {
  /** The dropped file's name, used only for a fallback title. */
  readonly name?: string | undefined;
  /** Injectable clock, so a test can assert on `createdAt`. */
  readonly now?: string | undefined;
  /** Defaults to a dynamic import of the bridge. A test that passes a
   *  counting stub is how "a molfile does not start the worker" is proven
   *  without a browser. */
  readonly loadRdkit?: LoadRdkit | undefined;
}

const loadRdkitBridge: LoadRdkit = () => import("@/lib/rdkit");

/** A title from the file's own name, extension stripped. */
function titleFromName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const base = name.replace(/\.[^./\\]+$/, "").trim();
  return base === "" ? undefined : base;
}

function hasThreeDimensionalWarning(result: ChemIoResult<ImportedStructure>): boolean {
  return (
    result.ok && result.report.warnings.some((warning) => warning.kind === "three-dimensional")
  );
}

function documentFromStructure(
  structure: ImportedStructure,
  fallbackTitle: string | undefined,
  now: string | undefined,
): SketchDocument {
  // The record's own title wins over the filename: an SDF's records are named
  // individually and a file called `results.sdf` names none of them.
  const title = structure.title.trim() !== "" ? structure.title.trim() : fallbackTitle;
  // ONE MODEL UNIT IS ONE STANDARD BOND, and a file from another tool need
  // not agree. The reader divides by a fixed 1.5 (RDKit's and most toolkits'
  // bond length), but molfiles in the wild are drawn at 0.825, 1.54 and more.
  // Left alone, such a structure draws off-scale on the canvas, sprouts new
  // bonds at a different length from its own, and prints bonds that are not
  // the house length while the export dialog reports that they are (decision
  // 20 fixes the printed length of ONE MODEL UNIT). So every imported
  // structure is scaled to a unit median bond here, the one funnel every
  // format passes through. A file already at the standard bond is returned
  // untouched.
  return createDocument({ molecule: normalizeBondLength(structure.molecule), title, now });
}

function openJson(text: string, now: string | undefined): OpenResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: `That file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // A whole-library backup is JSON too, and reads into N documents the way an
  // SDF does: dropped on the editor, the first opens and the rest are saved.
  if (isLibraryFile(parsed)) return openLibrary(parsed);
  // Through the migration ladder, exactly as a stored row is: a document
  // exported by an older build is the same problem as one read out of
  // IndexedDB, and solving it twice is how the two answers drift.
  const migrated = migrateStored(parsed);
  if (!migrated.ok) return { ok: false, message: migrated.message };
  const decoded = safeDecodeDocument(migrated.value);
  if (!decoded.ok) {
    const newer = newerBuildMessage(decoded.error, "That sketch file");
    if (newer !== undefined) return { ok: false, message: newer };
    const issues = decoded.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
      .join("; ");
    return { ok: false, message: `That sketch file could not be read — ${issues}` };
  }
  void now;
  return {
    ok: true,
    value: {
      documents: [decoded.document],
      format: { kind: "json" },
      warnings: [],
      needsLayout: false,
    },
  };
}

function openLibrary(parsed: unknown): OpenResult {
  const read = readLibrary(parsed);
  if (!read.ok) return { ok: false, message: read.message };
  const note = libraryFailureNote(read.failures, read.entries);
  return {
    ok: true,
    value: {
      documents: read.documents,
      format: { kind: "json" },
      warnings: note === null ? [] : [note],
      needsLayout: false,
    },
  };
}

function openMolblock(
  text: string,
  options: OpenTextOptions,
  format: SniffedFormat,
): OpenResult {
  const read = molblockToMolecule(text);
  if (!read.ok) {
    // VERBATIM. `lossy-import` names which part of the structure would have
    // been dropped, and `parse-failed` names the line; flattening either to
    // "could not read" throws away the only actionable half.
    return { ok: false, message: read.error.message };
  }
  const needsLayout = hasThreeDimensionalWarning(read);
  return {
    ok: true,
    value: {
      documents: [documentFromStructure(read.value, titleFromName(options.name), options.now)],
      format,
      warnings: needsLayout ? [THREE_D_NOTE] : [],
      needsLayout,
    },
  };
}

export const THREE_D_NOTE =
  "This file carries 3D coordinates; they have been flattened. Use “Clean up structure” " +
  "to generate a 2D layout.";

function openSdf(text: string, options: OpenTextOptions): OpenResult {
  const records = splitSdfRecords(text);
  if (records.length === 0) {
    return { ok: false, message: "That SDF file contains no records." };
  }
  const fallback = titleFromName(options.name);
  const documents: SketchDocument[] = [];
  const failures: string[] = [];
  let needsLayout = false;

  records.forEach((record, index) => {
    const read = molblockToMolecule(record);
    if (!read.ok) {
      failures.push(`record ${String(index + 1)}: ${read.error.message}`);
      return;
    }
    if (hasThreeDimensionalWarning(read)) needsLayout = true;
    const numbered =
      fallback === undefined
        ? undefined
        : records.length === 1
          ? fallback
          : `${fallback} (${String(index + 1)} of ${String(records.length)})`;
    documents.push(documentFromStructure(read.value, numbered, options.now));
  });

  if (documents.length === 0) {
    return { ok: false, message: `No record in that SDF could be read — ${failures[0] ?? ""}` };
  }

  const warnings: string[] = [];
  if (needsLayout) warnings.push(THREE_D_NOTE);
  if (failures.length > 0) {
    warnings.push(
      `${String(failures.length)} of ${String(records.length)} records could not be read — ${failures[0] ?? ""}`,
    );
  }
  return {
    ok: true,
    value: { documents, format: { kind: "sdf", records: records.length }, warnings, needsLayout },
  };
}

async function openSmiles(text: string, options: OpenTextOptions): Promise<OpenResult> {
  const load = options.loadRdkit ?? loadRdkitBridge;
  let bridge: RdkitImportBridge;
  try {
    bridge = await load();
  } catch (error) {
    return {
      ok: false,
      message: `The structure reader could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const read = await bridge.fromSmiles(text.trim());
  if (!read.ok) return { ok: false, message: read.error.message };
  return {
    ok: true,
    value: {
      documents: [documentFromStructure(read.value, titleFromName(options.name), options.now)],
      format: { kind: "smiles" },
      warnings: [],
      // A SMILES has no coordinates at all, so RDKit generated them; there is
      // nothing left to clean up.
      needsLayout: false,
    },
  };
}

/**
 * Read whatever this is into documents.
 *
 * Never throws: a bad drop is an ordinary outcome to report, the same way a
 * bad SMILES is in `@/lib/rdkit`.
 */
export async function openText(
  text: string,
  options: OpenTextOptions = {},
): Promise<OpenResult> {
  const format = sniffFormat(text);
  switch (format.kind) {
    case "json":
      return openJson(text, options.now);
    case "sdf":
      return openSdf(text, options);
    case "molblock":
      return openMolblock(text, options, format);
    case "inchi":
      return { ok: false, message: INCHI_UNSUPPORTED };
    case "smiles":
      return openSmiles(text, options);
    case "unknown":
      return {
        ok: false,
        message:
          "That does not look like a sketch, a molfile, an SDF or a SMILES. " +
          "Nothing was imported.",
      };
  }
}
