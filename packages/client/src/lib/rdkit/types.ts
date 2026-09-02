/**
 * The chem-io boundary's vocabulary: what an operation can return, and what
 * it reports about what RDKit changed on the way.
 *
 * NOTHING HERE IMPORTS RDKIT, not even a type. That is the point of the
 * module: the app can describe an import failure without the wasm having
 * loaded, and `grep -r "@rdkit/rdkit" src` stays confined to the two files
 * that genuinely need it.
 *
 * EVERY OPERATION RETURNS A RESULT RATHER THAN THROWING. A pasted SMILES with
 * a typo, a half-drawn structure whose nitrogen is momentarily pentavalent, a
 * molfile truncated by a bad download — these are normal conditions in a
 * drawing program, not exceptions. Making them exceptions pushes a try/catch
 * into every call site and makes the one genuinely exceptional case (the
 * worker died) indistinguishable from the ordinary ones.
 */

import type { AtomId, ElementSymbol, MolblockWarning, Molecule } from "@starter/chem-core";

/**
 * Why an operation could not produce an answer.
 *
 * Split by what the UI would DO about it, not by where in the stack it arose:
 * `parse-failed` is "your input is wrong", `labelled-atoms` is "expand these
 * abbreviations first", `worker-unavailable` is "something is broken, this is
 * not your fault".
 */
export type ChemIoErrorKind =
  /** Empty or whitespace-only input. RDKit answers an empty string with a
   *  valid zero-atom molecule, which is never what a paste meant. */
  | "empty-input"
  /** RDKit could not read the text at all: a bad SMILES, a broken molfile. */
  | "parse-failed"
  /** RDKit read it and then refused it — an over-valent atom, an
   *  unkekulizable ring. Common mid-sketch, so it is a result, not a crash. */
  | "sanitize-failed"
  /** RDKit threw. Emscripten throws raw heap pointers as numbers, so the
   *  message here may be a code rather than prose. */
  | "rdkit-failed"
  /** The molecule carries cosmetic labels ("Ph", "Boc") and cannot be written
   *  without lying about what it is. Carries `atomIds` (decision 8). */
  | "labelled-atoms"
  /** Past what V2000's three-column counts fields can express. */
  | "too-large"
  /** A coordinate or valence that no molfile field can hold. */
  | "unrepresentable"
  /** The text parsed, but atoms or bonds were dropped doing it. */
  | "lossy-import"
  /** No Worker, or the wasm never loaded. */
  | "worker-unavailable"
  /** The worker accepted the request and never answered. */
  | "timeout";

export interface ChemIoError {
  readonly kind: ChemIoErrorKind;
  readonly message: string;
  /** Set for `labelled-atoms`: the atoms the UI must ask the user about. */
  readonly atomIds?: readonly AtomId[];
  /** Set for `lossy-import`: what the reader dropped and where. */
  readonly warnings?: readonly MolblockWarning[];
  /** Whatever RDKit logged while failing, timestamps stripped. */
  readonly notes?: readonly string[];
}

/**
 * What RDKit did to the molecule that the caller did not ask for.
 *
 * Sanitization silently kekulizes, moves hydrogens around, can invent a
 * charge separation and can drop stereo, and none of that is logged — a
 * measured example: `CN(=O)=O` comes back as `C[N+](=O)[O-]` with an
 * empty log buffer. So the log is one channel among several and never the
 * primary one; the diffs are computed by comparing the model before and
 * after with chem-core's own queries.
 */
export interface ChangeReport {
  /**
   * `clean` nothing changed · `info` something worth mentioning · `changed`
   * the molecule differs · `lossy` atoms or bonds were dropped.
   */
  readonly severity: "clean" | "info" | "changed" | "lossy";
  /** What happened to the layout. See `fromMolblock`'s contract. */
  readonly coordinates: CoordinateOutcome;
  /** chem-core's own reader warnings, STRUCTURED — never flattened to
   *  strings, because each one carries the row or atom ids a UI points at. */
  readonly warnings: readonly MolblockWarning[];
  /** RDKit log lines, timestamps stripped. Failures and a few warnings only. */
  readonly notes: readonly string[];
  readonly diffs: readonly MoleculeDiff[];
}

/**
 * `preserved` the source's coordinates came through untouched ·
 * `generated` the source had none and a layout was computed ·
 * `regenerated` the source had some and they were replaced on request ·
 * `not-applicable` the operation produced no molecule.
 */
export type CoordinateOutcome = "preserved" | "generated" | "regenerated" | "not-applicable";

/**
 * One difference between the molecule that went in and the one that came
 * back.
 *
 * Deliberately more than `elementCounts` and `netCharge`. Those two are
 * necessary but demonstrably insufficient: dimethyl sulfone and its
 * charge-separated form share both, as do glycine's neutral and zwitterionic
 * forms, 2-pyridone and 2-hydroxypyridine, a wedged stereocentre and a flat
 * one, and a 13-C label and its absence. Every comparison below is
 * order-insensitive, because RDKit does not promise to preserve atom order
 * through a SMILES round trip.
 */
export type MoleculeDiff =
  | { readonly kind: "element-counts"; readonly before: ElementCounts; readonly after: ElementCounts }
  | { readonly kind: "net-charge"; readonly before: number; readonly after: number }
  /** Sorted multiset of nonzero formal charges. The only thing separating a
   *  sulfone from its charge-separated twin. */
  | { readonly kind: "formal-charges"; readonly before: readonly number[]; readonly after: readonly number[] }
  /** Sorted multiset of bond orders. Catches tautomer swaps. */
  | { readonly kind: "bond-orders"; readonly before: readonly number[]; readonly after: readonly number[] }
  | { readonly kind: "stereo"; readonly before: StereoCounts; readonly after: StereoCounts }
  | { readonly kind: "atom-count"; readonly before: number; readonly after: number }
  | { readonly kind: "bond-count"; readonly before: number; readonly after: number }
  | { readonly kind: "isotopes"; readonly before: readonly number[]; readonly after: readonly number[] }
  | { readonly kind: "radicals"; readonly before: number; readonly after: number }
  /** The storage form was violated: aromatic flags survived into the model. */
  | { readonly kind: "aromatic-flags-survived"; readonly atomIds: readonly AtomId[] }
  /** Largest per-atom coordinate move, in MODEL units. Nonzero without a
   *  `regenerated`/`generated` outcome means the layout drifted. */
  | { readonly kind: "coordinates-moved"; readonly maxDelta: number };

export type ElementCounts = Readonly<Partial<Record<ElementSymbol, number>>>;
export type StereoCounts = Readonly<Record<string, number>>;

export type ChemIoResult<T> =
  | { readonly ok: true; readonly value: T; readonly report: ChangeReport }
  | { readonly ok: false; readonly error: ChemIoError };

/** What an import hands back: a molecule plus whatever the file's title was. */
export interface ImportedStructure {
  readonly molecule: Molecule;
  readonly title: string;
}

/** InChI travels with its key; deriving one without the other is never useful. */
export interface InchiResult {
  readonly inchi: string;
  readonly inchiKey: string;
}

/**
 * `canonicalize` returns RDKit's canonical SMILES AND the sanitized molecule,
 * with the drawing intact.
 *
 * Deliberately not "round-trip through SMILES": SMILES carries neither
 * coordinates nor wedges, so that definition would silently flatten the
 * user's layout while `elementCounts` and `netCharge` both stayed identical.
 */
export interface CanonicalResult {
  readonly smiles: string;
  readonly molecule: Molecule;
}

export function ok<T>(value: T, report: ChangeReport): ChemIoResult<T> {
  return { ok: true, value, report };
}

export function fail<T>(error: ChemIoError): ChemIoResult<T> {
  return { ok: false, error };
}

/** A report for an operation that changed nothing worth mentioning. */
export const CLEAN_REPORT: ChangeReport = {
  severity: "clean",
  coordinates: "not-applicable",
  warnings: [],
  notes: [],
  diffs: [],
};
