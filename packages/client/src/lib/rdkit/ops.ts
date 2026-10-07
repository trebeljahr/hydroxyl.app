/**
 * Every RDKit call in the project, and the only place a JSMol exists.
 *
 * THE MODULE IS INJECTED, never imported. That is what makes this file
 * testable: the fidelity harness hands it a real RDKit initialised in plain
 * node, and the lifetime tests hand it a fake whose `get_mol` returns a stub
 * that counts its own deletions. Neither needs a Worker, a DOM or a fetch.
 *
 * Text in, text out. No chem-core type crosses into this file and no JSMol
 * crosses out of it.
 */

import type { ChemIoErrorKind } from "./types";

/**
 * The slice of `RDKitModule` this bridge uses.
 *
 * Declared structurally rather than imported from `@rdkit/rdkit` for two
 * reasons. The shipped `index.d.ts` is wrong in the places that matter —
 * `has_coords()` is typed `boolean` but returns 0/2/3, `get_pickle` is
 * declared and not bound, `set_log_capture` and `convert_to_kekule_form` are
 * missing — and, more importantly, a type-only import would still put the
 * name `@rdkit/rdkit` in this module's graph, which is the thing the "no
 * RDKit at module scope" rule is about.
 */
export interface RDKitModuleLike {
  get_mol(input: string, detailsJson?: string): JSMolLike | null;
  get_inchikey_for_inchi(inchi: string): string;
  version(): string;
  set_log_capture?(logName: string): RDKitLogLike | null;
}

export interface JSMolLike {
  get_smiles(): string;
  get_inchi(options?: string): string;
  get_molblock(detailsJson?: string): string;
  /** 0 = no conformer, 2 = 2D, 3 = 3D. NOT a boolean, whatever the .d.ts says. */
  has_coords(): number;
  /** A JSON object of RDKit's descriptor set, keyed by RDKit's own names. */
  get_descriptors(): string;
  /** Mutates: always overwrites any existing conformer. */
  set_new_coords(useCoordGen?: boolean): boolean;
  delete(): void;
}

export interface RDKitLogLike {
  get_buffer(): string;
  clear_buffer(): void;
  delete(): void;
}

export type OpResult<T> =
  | { readonly ok: true; readonly value: T; readonly notes: readonly string[] }
  | {
      readonly ok: false;
      readonly kind: ChemIoErrorKind;
      readonly message: string;
      readonly notes: readonly string[];
    };

/**
 * `useMolBlockWedging` keeps the wedges the input molblock drew.
 *
 * Only correct while the coordinates are the input's. After a re-layout the
 * old wedge sits on a bond that has moved, so RDKit's own re-derivation from
 * the perceived chirality is the honest answer — verified: after
 * `set_new_coords` the wedge moves to a different bond, and forcing the old
 * one back would depict the other enantiomer.
 */
const KEEP_WEDGING = '{"useMolBlockWedging":true}';

/** `has_coords()` codes: 0 no conformer, 2 a 2D one, 3 a 3D one. */
export const NO_COORDS = 0;
export const TWO_D = 2;
export const THREE_D = 3;

// ---------------------------------------------------------------------------
// JSMol lifetime
// ---------------------------------------------------------------------------

let created = 0;
let deleted = 0;

/**
 * How many JSMols this process has created and deleted.
 *
 * A test hook, and the only way to prove the `finally` below actually runs:
 * emscripten installs a `FinalizationRegistry` safety net, so a leak does not
 * show up as a crash, it shows up as a wasm heap that grows until the tab
 * dies. `created === deleted` after a suite is the invariant.
 */
export function molLifecycleCounts(): { created: number; deleted: number } {
  return { created, deleted };
}

export function resetMolLifecycleCounts(): void {
  created = 0;
  deleted = 0;
}

/**
 * Parse `text`, run `body`, and delete the JSMol no matter how `body` exits.
 *
 * `get_mol` returns NULL on bad input rather than throwing — verified for
 * `'C1CC'` and for pure garbage — so the null check is the malformed-input
 * path and the catch is for everything else. The catch is not decoration:
 * `get_smiles` on an unkekulizable molecule throws a raw NUMBER (an emscripten
 * heap pointer), which `instanceof Error` does not match and which would
 * otherwise escape the worker as an unhandled rejection.
 *
 * The empty-string guard is load-bearing: `get_mol("")` returns a perfectly
 * valid ZERO-ATOM molecule, so an empty paste would otherwise succeed.
 */
export function withMol<T>(
  rdkit: RDKitModuleLike,
  text: string,
  body: (mol: JSMolLike) => T,
  options: { readonly detailsJson?: string; readonly log?: RDKitLogLike | null } = {},
): OpResult<T> {
  const log = options.log ?? null;
  log?.clear_buffer();

  if (text.trim() === "") {
    return { ok: false, kind: "empty-input", message: "There is nothing to read.", notes: [] };
  }

  let mol: JSMolLike | null;
  try {
    mol = options.detailsJson === undefined
      ? rdkit.get_mol(text)
      : rdkit.get_mol(text, options.detailsJson);
  } catch (error) {
    return { ok: false, kind: "rdkit-failed", message: describeThrow(error), notes: readLog(log) };
  }

  if (mol === null) {
    const notes = readLog(log);
    // RDKit reports a refused-after-reading molecule ("Explicit valence for
    // atom # 0 N, 4, is greater than permitted", "Can't kekulize mol") through
    // the same null return as an unreadable one. The log is the only thing
    // that separates "your text is not a structure" from "your structure is
    // not chemically legal", and the UI wants to say different things.
    const sanitize = notes.some(
      (n) => /valence/i.test(n) || /kekulize/i.test(n) || /sanitiz/i.test(n),
    );
    return {
      ok: false,
      kind: sanitize ? "sanitize-failed" : "parse-failed",
      message:
        notes.length > 0
          ? notes.join(" ")
          : "RDKit could not read that as a chemical structure.",
      notes,
    };
  }

  created++;
  try {
    return { ok: true, value: body(mol), notes: readLog(log) };
  } catch (error) {
    return { ok: false, kind: "rdkit-failed", message: describeThrow(error), notes: readLog(log) };
  } finally {
    mol.delete();
    deleted++;
  }
}

function describeThrow(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "number") {
    return `RDKit aborted internally (exception code ${error}); this build exports no exception message.`;
  }
  return String(error);
}

/**
 * The log buffer, split into lines with RDKit's `[HH:MM:SS] ` prefix removed.
 *
 * Not a substitute for diffing the molecule: sanitization's silent rewrites
 * are not logged at all. Measured — `CN(=O)=O` comes back charge-separated
 * as `C[N+](=O)[O-]` with an EMPTY buffer.
 */
function readLog(log: RDKitLogLike | null): string[] {
  if (!log) return [];
  const buffer = log.get_buffer();
  log.clear_buffer();
  return buffer
    .split("\n")
    .map((line) => line.replace(/^\[\d\d:\d\d:\d\d\]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Operations. Every one takes text and returns text.
// ---------------------------------------------------------------------------

export interface NormalizedMolblock {
  readonly molblock: string;
  /** `has_coords()` on the parsed molecule, BEFORE anything was written. */
  readonly hadCoords: number;
  /** Whether this call computed a new layout. */
  readonly coordsGenerated: boolean;
}

/**
 * Read `text` and hand back RDKit's own molblock for it.
 *
 * `layout` decides the coordinate contract:
 *   `"preserve"`  keep the source's 2D layout; compute one only when there
 *                 is no conformer at all (`has_coords() === 0`) or the
 *                 conformer is 3D (`3`). A 3D conformer is not a drawing:
 *                 flattened to the xy plane its atoms overlap, and PubChem's
 *                 default SDF download is 3D, which makes it the likeliest
 *                 file a chemist drags in.
 *   `"generate"`  always re-lay-out.
 *
 * WHY `has_coords()` AND NOT THE TEXT. `get_molblock()` silently INVENTS a 2D
 * conformer when the molecule has none, so the returned coordinate block is
 * fully populated either way and cannot tell you whether the source had a
 * layout. Verified: benzene parsed from SMILES reports `has_coords() === 0`
 * and still emits a perfect hexagon.
 *
 * The default `get_molblock()` is already KEKULE (RDKit's `kekulize` flag
 * defaults true), which is the storage form, so nothing here overrides it.
 */
export function normalizeMolblock(
  rdkit: RDKitModuleLike,
  text: string,
  layout: "preserve" | "generate",
  log?: RDKitLogLike | null,
): OpResult<NormalizedMolblock> {
  return withMol(
    rdkit,
    text,
    (mol) => {
      const hadCoords = mol.has_coords();
      const generate = layout === "generate" || hadCoords !== TWO_D;
      if (generate) mol.set_new_coords(true);
      return {
        molblock: generate ? mol.get_molblock() : mol.get_molblock(KEEP_WEDGING),
        hadCoords,
        coordsGenerated: generate,
      };
    },
    { log: log ?? null },
  );
}

export interface SmilesAndMolblock extends NormalizedMolblock {
  readonly smiles: string;
}

/** Canonical SMILES plus the sanitized molblock, so the caller can diff. */
export function smilesAndMolblock(
  rdkit: RDKitModuleLike,
  text: string,
  layout: "preserve" | "generate",
  log?: RDKitLogLike | null,
): OpResult<SmilesAndMolblock> {
  return withMol(
    rdkit,
    text,
    (mol) => {
      const hadCoords = mol.has_coords();
      const generate = layout === "generate" || hadCoords !== TWO_D;
      if (generate) mol.set_new_coords(true);
      return {
        smiles: mol.get_smiles(),
        molblock: generate ? mol.get_molblock() : mol.get_molblock(KEEP_WEDGING),
        hadCoords,
        coordsGenerated: generate,
      };
    },
    { log: log ?? null },
  );
}

export interface InchiAndMolblock extends NormalizedMolblock {
  readonly inchi: string;
  readonly inchiKey: string;
}

/**
 * InChI, its key, and the sanitized molblock.
 *
 * `get_inchikey_for_inchi` signals failure by returning the EMPTY STRING, not
 * by throwing, so an empty key is checked rather than assumed. The InChI
 * library's own return code and aux info are created and discarded inside the
 * C++ binding, so there is no richer signal available.
 */
export function inchiAndMolblock(
  rdkit: RDKitModuleLike,
  text: string,
  log?: RDKitLogLike | null,
): OpResult<InchiAndMolblock> {
  return withMol(
    rdkit,
    text,
    (mol) => {
      const hadCoords = mol.has_coords();
      const inchi = mol.get_inchi();
      return {
        inchi,
        inchiKey: inchi === "" ? "" : rdkit.get_inchikey_for_inchi(inchi),
        molblock: mol.get_molblock(KEEP_WEDGING),
        hadCoords,
        coordsGenerated: false,
      };
    },
    { log: log ?? null },
  );
}

/**
 * The four descriptors the properties popover shows (decision 235), by the
 * names RDKit's `get_descriptors` uses.
 *
 * `tpsa` is Ertl's topological polar surface area with RDKit's default of N
 * and O only — no S or P contributions — which is the published method and
 * the number most papers quote. `CrippenClogP` is Wildman and Crippen's
 * atom-contribution estimate: a CALCULATED logP, labelled as such in the UI,
 * never a measured one. The donor and acceptor counts are the `lipinski*`
 * pair (every N/O, and every N/O carrying a hydrogen), because those are the
 * counts the rule of five is stated in; RDKit's `NumHBD`/`NumHBA` use a
 * stricter SMARTS definition and give benzoic acid one acceptor, not two.
 */
export interface Descriptors {
  readonly tpsa: number;
  readonly clogp: number;
  readonly hbd: number;
  readonly hba: number;
}

export interface DescriptorsAndMolblock extends NormalizedMolblock {
  readonly descriptors: Descriptors;
}

function requireNumber(table: Record<string, unknown>, key: string): number {
  const value = table[key];
  // A renamed key in a later RDKit must fail loudly here, not render as NaN.
  if (typeof value !== "number") throw new Error(`RDKit's descriptors carry no "${key}".`);
  return value;
}

/** The descriptors, plus the sanitized molblock so the caller can diff. */
export function descriptorsAndMolblock(
  rdkit: RDKitModuleLike,
  text: string,
  log?: RDKitLogLike | null,
): OpResult<DescriptorsAndMolblock> {
  return withMol(
    rdkit,
    text,
    (mol) => {
      const table = JSON.parse(mol.get_descriptors()) as Record<string, unknown>;
      return {
        descriptors: {
          tpsa: requireNumber(table, "tpsa"),
          clogp: requireNumber(table, "CrippenClogP"),
          hbd: requireNumber(table, "lipinskiHBD"),
          hba: requireNumber(table, "lipinskiHBA"),
        },
        molblock: mol.get_molblock(KEEP_WEDGING),
        hadCoords: mol.has_coords(),
        coordsGenerated: false,
      };
    },
    { log: log ?? null },
  );
}
