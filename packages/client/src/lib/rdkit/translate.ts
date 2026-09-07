/**
 * The ONLY translation layer between the model and RDKit: chem-core's pure
 * V2000 codec, wrapped so the caller gets a result instead of an exception.
 *
 * RDKit never sees a chem-core type and chem-core never sees a JSMol. Text is
 * the whole interface. That is what lets this file — and the fidelity harness
 * built on it — run with no wasm, no Worker and no DOM.
 *
 * Nothing here imports RDKit, directly or as a type.
 */

import {
  elementCounts,
  hasAromaticFlags,
  kekulizeWithReport,
  MolblockLabelError,
  MolblockParseError,
  MOLFILE_BOND_LENGTH,
  netCharge,
  readMolblock,
  requireAtom,
  requireBond,
  writeMolblock,
  type AtomId,
  type Molecule,
  type MolblockWarning,
} from "@starter/chem-core";

import {
  CLEAN_REPORT,
  fail,
  ok,
  type ChangeReport,
  type ChemIoResult,
  type CoordinateOutcome,
  type ElementCounts,
  type ImportedStructure,
  type MoleculeDiff,
  type StereoCounts,
  type Verification,
} from "./types";

/**
 * One constant for BOTH directions.
 *
 * The writer multiplies model coordinates by it and the reader divides. Set
 * it on one side only and every imported structure comes back 2.25x or 0.44x
 * its true size — with identical `elementCounts`, identical `netCharge`,
 * identical atom and bond counts and no warnings. Nothing in the fidelity
 * assertions can see it, which is exactly why it is named once here.
 */
export const COORDINATE_SCALE = MOLFILE_BOND_LENGTH;

/**
 * V2000 counts fields are three characters wide. Checked here so the caller
 * gets a typed `too-large` rather than having to pattern-match a message.
 */
const MAX_V2000_COUNT = 999;

/**
 * Warnings that mean the molecule is NOT the file: atoms or bonds actually
 * disappeared. An import carrying one of these is a failure, not a caveat —
 * a dummy atom or an R-group silently vanishing is how a scaffold becomes a
 * different compound.
 */
const LOSSY_WARNINGS: ReadonlySet<MolblockWarning["kind"]> = new Set([
  "unknown-element",
  "bad-bond-endpoint",
  "self-bond",
  "duplicate-bond",
  "truncated-block",
  "surplus-block",
  "property-index-out-of-range",
]);

/**
 * Warnings that mean the molecule is kept but reads differently from the
 * file. Worth a banner, not a refusal.
 */
const CHANGED_WARNINGS: ReadonlySet<MolblockWarning["kind"]> = new Set([
  "unkekulized",
  "unsupported-bond-type",
  "unsupported-bond-stereo",
  "three-dimensional",
]);

/** A bad x or y defaults the coordinate to 0, stacking an atom on the origin. */
function isLossy(warning: MolblockWarning): boolean {
  if (warning.kind === "bad-numeric-field") return warning.field === "x" || warning.field === "y";
  return LOSSY_WARNINGS.has(warning.kind);
}

export function classifyWarnings(warnings: readonly MolblockWarning[]): ChangeReport["severity"] {
  if (warnings.some(isLossy)) return "lossy";
  if (warnings.some((w) => CHANGED_WARNINGS.has(w.kind))) return "changed";
  return warnings.length > 0 ? "info" : "clean";
}

const SEVERITY_ORDER = { clean: 0, info: 1, changed: 2, lossy: 3 } as const;

export function worstSeverity(
  ...severities: readonly ChangeReport["severity"][]
): ChangeReport["severity"] {
  return severities.reduce((a, b) => (SEVERITY_ORDER[b] > SEVERITY_ORDER[a] ? b : a), "clean");
}

/**
 * Model -> molblock, ready to hand to RDKit.
 *
 * Three things happen here that a naive `writeMolblock` call would miss.
 *
 * KEKULE FIRST, AND ENFORCED. Aromatic flags would go out as V2000 bond type
 * 4, and a type-4 record is a request that the reader kekulize it — which
 * RDKit refuses outright for a pyrrole whose N-H is not stated, returning
 * null. Kekulising here means exactly one representation crosses the
 * boundary, per the storage decision. `kekulizeWithReport` returns the
 * molecule BY REFERENCE when it carries no flags, so this is free on the
 * common path.
 *
 * Kekulisation CAN FAIL, though — a component with no perfect matching is
 * returned untouched, flags intact — and a failure that is not checked is not
 * an enforcement. Measured: a flagged all-single-bond five-carbon ring comes
 * back from `kekulize` unchanged, writes five type-4 bond rows, and RDKit
 * answers "Can't kekulize mol". So the result is checked and the operation
 * REFUSES, with the offending atom ids, rather than emitting a bond type the
 * storage form does not have.
 *
 * `hydrogenAssertion: "valence"`. The default `hhh` field is a QUERY field
 * per the CTfile spec and RDKit treats it as one: a nonzero hhh makes the
 * atom a query atom and sets NO hydrogen count, so benzene arrives as C6 and
 * ethanol as C2O, silently, with an empty log buffer. See
 * `HydrogenAssertion` in chem-core for the measurement.
 */
export function moleculeToMolblock(mol: Molecule, title = ""): ChemIoResult<string> {
  if (mol.atomIds.length > MAX_V2000_COUNT || mol.bondIds.length > MAX_V2000_COUNT) {
    return fail({
      kind: "too-large",
      message:
        `A V2000 molblock cannot express ${mol.atomIds.length} atoms / ` +
        `${mol.bondIds.length} bonds; the counts fields are three characters wide.`,
    });
  }
  const kekulised = kekulizeWithReport(mol);
  if (kekulised.unkekulizedAtomIds.length > 0 || hasAromaticFlags(kekulised.molecule)) {
    return fail({
      kind: "unkekulizable",
      message:
        "This structure carries aromatic flags that no Kekule structure resolves, " +
        "so it cannot be written without emitting bond type 4 — which is not the " +
        "storage form and which RDKit refuses to read back.",
      atomIds:
        kekulised.unkekulizedAtomIds.length > 0
          ? kekulised.unkekulizedAtomIds
          : aromaticFlaggedAtomIds(kekulised.molecule),
    });
  }
  try {
    const text = writeMolblock(kekulised.molecule, {
      title,
      coordinateScale: COORDINATE_SCALE,
      hydrogenAssertion: "valence",
    });
    return ok(text, CLEAN_REPORT);
  } catch (error) {
    if (error instanceof MolblockLabelError) {
      // Decision 8: never caught and ignored. The UI needs the ids so it can
      // offer to expand or strip the abbreviations.
      return fail({ kind: "labelled-atoms", message: error.message, atomIds: error.atomIds });
    }
    return fail({ kind: "unrepresentable", message: describeError(error) });
  }
}

/**
 * Molblock -> model, with the reader's warnings triaged.
 *
 * `readMolblock` already kekulises internally (hydrogen pins, then
 * `kekulizeWithReport`, then pins re-derived against the kekulised
 * structure), so a separate `kekulize()` call afterwards is a verified
 * no-op. What is NOT redundant is the assertion below: if aromatic flags
 * survived, the storage form has been violated and the molecule genuinely
 * differs from its Kekule reading — a five-carbon flagged ring reads as C5H5
 * where the Kekule structure is C5H6.
 */
export function molblockToMolecule(text: string): ChemIoResult<ImportedStructure> {
  let read;
  try {
    read = readMolblock(text, { coordinateScale: COORDINATE_SCALE });
  } catch (error) {
    if (error instanceof MolblockParseError) {
      return fail({ kind: "parse-failed", message: error.message });
    }
    return fail({ kind: "parse-failed", message: describeError(error) });
  }

  const severity = classifyWarnings(read.warnings);
  if (severity === "lossy") {
    return fail({
      kind: "lossy-import",
      message:
        `The structure could not be read without dropping part of it: ` +
        read.warnings.filter(isLossy).map((w) => w.message).join("; "),
      warnings: read.warnings,
    });
  }

  // A flag that survived the reader's own kekulisation is not a caveat, it is
  // a storage-form violation: the model would then hold a perception it is
  // not allowed to hold, and a five-carbon flagged ring derives C5H5 where
  // its Kekule reading is C5H6 — genuinely a different molecule. Returning it
  // with a diff attached still returns it; refusing is what actually holds
  // the contract.
  const flagged = aromaticFlaggedAtomIds(read.molecule);
  if (flagged.length > 0) {
    return fail({
      kind: "unkekulizable",
      message:
        "The structure contains an aromatic system that could not be given a Kekule " +
        "structure, and Kekule is the only form this editor stores.",
      atomIds: flagged,
      warnings: read.warnings,
    });
  }

  return ok(
    { molecule: read.molecule, title: read.title },
    {
      severity,
      coordinates: "not-applicable",
      warnings: read.warnings,
      notes: [],
      diffs: [],
      verification: "not-applicable",
    },
  );
}

/**
 * Whether the structure carries a layout worth preserving.
 *
 * There is no "has coordinates" bit in the model, and there cannot be: every
 * atom has a position. The observable condition is that they are not all the
 * same point — which is what a molecule parsed from a conformer-less molblock
 * looks like, every atom stacked on the origin. A single atom is
 * unfalsifiable, so it counts as having a layout and is never re-laid-out.
 */
export function hasMeaningfulCoordinates(mol: Molecule): boolean {
  if (mol.atomIds.length <= 1) return true;
  const first = requireAtom(mol, mol.atomIds[0] as AtomId).pos;
  return mol.atomIds.some((id) => {
    const p = requireAtom(mol, id).pos;
    return p.x !== first.x || p.y !== first.y;
  });
}

/**
 * Atoms touched by a surviving aromatic FLAG — their own, or one on a bond
 * they carry.
 *
 * A flag is an importer's perception, never storage; `kekulize` is what turns
 * it into bond orders. One surviving is not cosmetic: a five-carbon
 * all-flagged ring derives C5H5 where its Kekule reading is C6-shaped C5H6,
 * so the molecule genuinely differs. Bond flags are included because a
 * molecule can carry them with every atom unflagged, and that case is exactly
 * as wrong.
 */
function aromaticFlaggedAtomIds(mol: Molecule): AtomId[] {
  if (!hasAromaticFlags(mol)) return [];
  const ids = new Set<AtomId>();
  for (const id of mol.atomIds) if (requireAtom(mol, id).aromatic) ids.add(id);
  for (const id of mol.bondIds) {
    const bond = requireBond(mol, id);
    if (bond.aromatic) {
      ids.add(bond.from);
      ids.add(bond.to);
    }
  }
  // Back in the molecule's own atom order, so the ids read the way the file
  // and the UI list them.
  return mol.atomIds.filter((id) => ids.has(id));
}

/** Sorted multiset of nonzero formal charges. */
function formalCharges(mol: Molecule): number[] {
  return mol.atomIds
    .map((id) => requireAtom(mol, id).charge)
    .filter((c) => c !== 0)
    .sort((a, b) => a - b);
}

function bondOrders(mol: Molecule): number[] {
  return mol.bondIds.map((id) => requireBond(mol, id).order).sort((a, b) => a - b);
}

function stereoCounts(mol: Molecule): StereoCounts {
  const counts: Record<string, number> = {};
  for (const id of mol.bondIds) {
    const s = requireBond(mol, id).stereo;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

function isotopes(mol: Molecule): number[] {
  return mol.atomIds
    .map((id) => requireAtom(mol, id).isotope ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

function radicals(mol: Molecule): number {
  return mol.atomIds.reduce((n, id) => n + requireAtom(mol, id).radicalElectrons, 0);
}

/**
 * Largest per-atom coordinate move between two molecules of the same size, in
 * MODEL units, comparing by POSITION IN `atomIds`.
 *
 * Returns `Infinity` when the sizes differ, which is a change in its own
 * right and is reported separately. Row order is the right key here because
 * the molblock path preserves it; a SMILES round trip does not, and the
 * caller does not ask for a coordinate diff across one.
 */
export function maxCoordinateDelta(before: Molecule, after: Molecule): number {
  if (before.atomIds.length !== after.atomIds.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < before.atomIds.length; i++) {
    const a = requireAtom(before, before.atomIds[i] as AtomId).pos;
    const b = requireAtom(after, after.atomIds[i] as AtomId).pos;
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return worst;
}

function sameCounts(a: ElementCounts, b: ElementCounts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a as Record<string, number>)[key] !== (b as Record<string, number>)[key]) return false;
  }
  return true;
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameRecord(a: StereoCounts, b: StereoCounts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

/**
 * Everything that changed between two readings of the same structure.
 *
 * `elementCounts` and `netCharge` alone would miss most of this. Measured,
 * with identical counts AND identical net charge on both sides: dimethyl
 * sulfone vs its charge-separated form, glycine neutral vs zwitterion,
 * 2-pyridone vs 2-hydroxypyridine, methane-with-implicit-H vs
 * methane-with-four-real-H-atoms, 13-C methane vs 12-C, and a wedged
 * stereocentre vs a flat one.
 */
export function diffMolecules(before: Molecule, after: Molecule): MoleculeDiff[] {
  const diffs: MoleculeDiff[] = [];

  const beforeCounts = elementCounts(before);
  const afterCounts = elementCounts(after);
  if (!sameCounts(beforeCounts, afterCounts)) {
    diffs.push({ kind: "element-counts", before: beforeCounts, after: afterCounts });
  }
  if (netCharge(before) !== netCharge(after)) {
    diffs.push({ kind: "net-charge", before: netCharge(before), after: netCharge(after) });
  }
  const bc = formalCharges(before);
  const ac = formalCharges(after);
  if (!sameList(bc, ac)) diffs.push({ kind: "formal-charges", before: bc, after: ac });

  const bo = bondOrders(before);
  const ao = bondOrders(after);
  if (!sameList(bo, ao)) diffs.push({ kind: "bond-orders", before: bo, after: ao });

  const bs = stereoCounts(before);
  const as_ = stereoCounts(after);
  if (!sameRecord(bs, as_)) diffs.push({ kind: "stereo", before: bs, after: as_ });

  if (before.atomIds.length !== after.atomIds.length) {
    diffs.push({
      kind: "atom-count",
      before: before.atomIds.length,
      after: after.atomIds.length,
    });
  }
  if (before.bondIds.length !== after.bondIds.length) {
    diffs.push({
      kind: "bond-count",
      before: before.bondIds.length,
      after: after.bondIds.length,
    });
  }

  const bi = isotopes(before);
  const ai = isotopes(after);
  if (!sameList(bi, ai)) diffs.push({ kind: "isotopes", before: bi, after: ai });

  if (radicals(before) !== radicals(after)) {
    diffs.push({ kind: "radicals", before: radicals(before), after: radicals(after) });
  }

  const flagged = aromaticFlaggedAtomIds(after);
  if (flagged.length > 0) diffs.push({ kind: "aromatic-flags-survived", atomIds: flagged });

  return diffs;
}

/**
 * The whole coordinate field is quantised to four decimals in FILE units, so
 * a model -> file -> model trip moves an atom by at most half a unit in the
 * last place divided by the scale. Anything under this is rounding; anything
 * over it is a re-layout.
 */
export const COORDINATE_TOLERANCE = 1e-4;

/**
 * `verification` is REQUIRED, and deliberately not inferred from whether
 * `before` and `after` happen to be present.
 *
 * Inferring it is the bug this parameter exists to prevent: a re-read that
 * failed and an operation that never had a "before" both arrive here as
 * `undefined`, and collapsing them makes an unchecked result read exactly
 * like a verified-clean one. Only the caller knows which it was.
 */
export function buildReport(
  before: Molecule | undefined,
  after: Molecule | undefined,
  options: {
    readonly coordinates: CoordinateOutcome;
    readonly verification: Verification;
    readonly warnings?: readonly MolblockWarning[];
    readonly notes?: readonly string[];
  },
): ChangeReport {
  const warnings = options.warnings ?? [];
  const notes = options.notes ?? [];
  const diffs = before && after ? diffMolecules(before, after) : [];

  if (before && after && options.coordinates === "preserved") {
    const delta = maxCoordinateDelta(before, after);
    if (delta > COORDINATE_TOLERANCE) diffs.push({ kind: "coordinates-moved", maxDelta: delta });
  }

  const severity = worstSeverity(
    classifyWarnings(warnings),
    diffs.length > 0 ? "changed" : "clean",
    notes.length > 0 ? "info" : "clean",
    options.coordinates === "generated" || options.coordinates === "regenerated" ? "info" : "clean",
    // Never `clean`: an unverified result is not a result that says nothing
    // changed, and a banner-less UI would present it as one.
    options.verification === "unavailable" ? "info" : "clean",
  );
  return {
    severity,
    coordinates: options.coordinates,
    warnings,
    notes,
    diffs,
    verification: options.verification,
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  // Emscripten throws C++ exceptions as raw heap POINTERS — a number, with no
  // message obtainable, because this build exports no getExceptionMessage.
  if (typeof error === "number") return `RDKit aborted internally (exception code ${error})`;
  return String(error);
}
