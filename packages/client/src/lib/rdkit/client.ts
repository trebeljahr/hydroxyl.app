/**
 * The chem-io boundary. Seven async operations, every one returning a
 * discriminated result.
 *
 * Async because each crosses a Worker. Never-throwing because a bad pasted
 * SMILES, a half-drawn pentavalent nitrogen and a truncated download are
 * normal conditions in a drawing program — see `types.ts`.
 *
 * The chem-core conversions happen HERE, on the main thread, so only text
 * crosses the boundary: RDKit never sees a chem-core type and chem-core never
 * sees a JSMol. It also keeps the worker small enough to be worth compiling
 * separately, and keeps `Molecule`'s structural sharing out of
 * `structuredClone`.
 */

import type { Molecule } from "@starter/chem-core";

import { rdkitAssetBase } from "./asset-base";
import type { InchiAndMolblock, OpResult, SmilesAndMolblock } from "./ops";
import { NO_COORDS } from "./ops";
import { isReady, type WorkerMessage, type WorkerPayload, type WorkerRequest } from "./protocol";
import {
  buildReport,
  describeError,
  hasMeaningfulCoordinates,
  moleculeToMolblock,
  molblockToMolecule,
} from "./translate";
import {
  fail,
  ok,
  type CanonicalResult,
  type ChemIoError,
  type ChemIoResult,
  type CoordinateOutcome,
  type ImportedStructure,
  type InchiResult,
  type Verification,
} from "./types";

/**
 * How long an operation waits before giving up on the worker.
 *
 * Generous because the first call pays for a 6.9 MB wasm fetch and its
 * compile. A timeout is not optional: an emscripten module whose wasm cannot
 * be fetched leaves its init promise PENDING rather than rejecting, so
 * without this a mis-served asset presents as a hang with no error anywhere.
 */
const TIMEOUT_MS = 45_000;

interface Pending {
  readonly resolve: (result: OpResult<WorkerPayload>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | undefined;
/**
 * Set when the worker failed to start, and STICKY until `disposeRdkitWorker`.
 *
 * Without the stickiness every later call would re-attempt a script that is
 * not there, so a mis-deployed asset would cost a 404 per operation for the
 * life of the page instead of one.
 */
let workerBroken: string | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(message: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, kind: "worker-unavailable", message, notes: [] });
    pending.delete(id);
  }
  worker = undefined;
}

function ensureWorker(): Worker | undefined {
  if (worker) return worker;
  if (workerBroken !== undefined) return undefined;
  if (typeof Worker === "undefined") return undefined;
  // A string URL, deliberately. `new Worker(new URL("./worker.ts",
  // import.meta.url))` would hand the path to Turbopack, which resolves the
  // emitted chunk against `location.origin` and drops any subpath in the
  // static export — a 404 whose error event carries an empty message. See the
  // header of worker.ts.
  const url = `${rdkitAssetBase()}rdkit.worker.js`;
  let created: Worker;
  try {
    created = new Worker(url);
  } catch (error) {
    // `new Worker` throws SYNCHRONOUSLY — it does not fire `onerror` — when
    // the script URL is not same-origin. Every `file://` document counts:
    // its origin is the string "null", so a script beside it is cross-origin
    // and the constructor raises SecurityError. That is precisely the shell
    // the static export exists for (an Electron or Capacitor build before a
    // custom protocol is wired), where the page otherwise loads and hydrates
    // perfectly, so an escaping exception here would break the boundary's
    // never-throws contract in the one place it is least expected.
    workerBroken = `The RDKit worker at ${url} could not be started: ${describeError(error)}`;
    return undefined;
  }
  created.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (isReady(message)) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    entry.resolve(message.result);
  };
  created.onerror = () => {
    // The event's `.message` is empty for a 404 on the worker script itself,
    // so there is nothing useful to forward — say where it looked instead.
    workerBroken = `The RDKit worker at ${url} could not be started.`;
    failAll(workerBroken);
  };
  worker = created;
  return created;
}

function call(request: Omit<WorkerRequest, "id">): Promise<OpResult<WorkerPayload>> {
  const target = ensureWorker();
  if (!target) {
    return Promise.resolve({
      ok: false,
      kind: "worker-unavailable",
      message:
        workerBroken ??
        "Web Workers are not available in this environment, so RDKit cannot be reached.",
      notes: [],
    });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        ok: false,
        kind: "timeout",
        message: `RDKit did not answer within ${TIMEOUT_MS / 1000} s.`,
        notes: [],
      });
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    target.postMessage({ ...request, id } satisfies WorkerRequest);
  });
}

/** Tears the worker down. For tests, and for a page that is going away. */
export function disposeRdkitWorker(): void {
  worker?.terminate();
  failAll("The RDKit worker was disposed.");
  workerBroken = undefined;
}

/**
 * Whether `mol` should be handed to RDKit with its own layout or with a fresh
 * one.
 *
 * A structure whose atoms all sit on one point — a fragment pasted before
 * layout, a freshly decoded document — gives RDKit nothing to perceive
 * stereochemistry from, so it silently drops every wedge and every double-bond
 * geometry. Laying it out first costs a few milliseconds and is the difference
 * between an export that carries the configuration and one that does not.
 */
function layoutFor(mol: Molecule): "preserve" | "generate" {
  return hasMeaningfulCoordinates(mol) ? "preserve" : "generate";
}

function opError(result: Extract<OpResult<WorkerPayload>, { ok: false }>): ChemIoError {
  return { kind: result.kind, message: result.message, notes: result.notes };
}

/**
 * `generated` means there was nothing to keep; `regenerated` means there was
 * and it was replaced (an explicit re-layout, or a 3D conformer that is not a
 * drawing). The UI says different things about the two: one is expected, the
 * other threw away work someone may have done by hand.
 */
function coordinateOutcome(
  hadCoords: number,
  generated: boolean,
  sourceHadLayout: boolean,
): CoordinateOutcome {
  if (!generated) return "preserved";
  // `hadCoords` alone is not enough. RDKit answers `has_coords() === 2` for a
  // conformer whose every atom sits at 0,0,0 — measured — and chem-core's own
  // `writeMolblock` of a molecule built at the origin produces exactly that
  // file. Nothing was thrown away there, so it is `generated`, not
  // `regenerated`.
  return hadCoords === NO_COORDS || !sourceHadLayout ? "generated" : "regenerated";
}

/**
 * How a re-read of RDKit's output turned out, as something the report can
 * state rather than something an empty `diffs` implies.
 */
function verificationOf(ok: boolean): Verification {
  return ok ? "verified" : "unavailable";
}

/**
 * The note that goes with an `unavailable` verification.
 *
 * Without it the caller is told only that nothing is known; with it they are
 * told why, which for the common case is "RDKit answered in V3000 and the
 * codec here is V2000-only".
 */
function unverifiedNote(message: string): string {
  return `RDKit's output could not be read back for checking, so this report does not say what changed: ${message}`;
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/** Canonical SMILES for `mol`. */
export async function toSmiles(mol: Molecule, title = ""): Promise<ChemIoResult<string>> {
  const written = moleculeToMolblock(mol, title);
  if (!written.ok) return written;
  const result = await call({ op: "smiles", text: written.value, layout: layoutFor(mol) });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as SmilesAndMolblock;
  // Diff against RDKit's own reading of what we sent, not against the SMILES:
  // RDKit canonicalises the right and the wrong answer to the same string.
  const round = molblockToMolecule(payload.molblock);
  return ok(
    payload.smiles,
    buildReport(mol, round.ok ? round.value.molecule : undefined, {
      coordinates: "not-applicable",
      verification: verificationOf(round.ok),
      warnings: round.ok ? round.report.warnings : [],
      notes: round.ok ? result.notes : [...result.notes, unverifiedNote(round.error.message)],
    }),
  );
}

/**
 * Read a SMILES.
 *
 * `layout: "preserve"` is not a contradiction here: a SMILES carries no
 * conformer, so the preserve path finds `has_coords() === 0` and computes one
 * anyway. The report says `generated`, and it is the report — not the
 * argument — that the caller should read.
 */
export async function fromSmiles(smiles: string): Promise<ChemIoResult<ImportedStructure>> {
  const result = await call({ op: "normalize", text: smiles, layout: "preserve" });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as WorkerPayload;
  const read = molblockToMolecule(payload.molblock);
  if (!read.ok) return read;
  // No "before" to diff against — a SMILES is the input, not a molecule — so
  // the report carries the reader's warnings and RDKit's own log and nothing
  // else. The storage-form check is not lost by that: `molblockToMolecule`
  // now REFUSES a reading whose aromatic flags survived, so reaching here at
  // all means the molecule is Kekule.
  return ok(
    read.value,
    buildReport(undefined, undefined, {
      coordinates: coordinateOutcome(payload.hadCoords, payload.coordsGenerated, false),
      // Not `unavailable`: the input was a STRING, so there was never a
      // molecule to diff against. Nothing went unchecked here.
      verification: "not-applicable",
      warnings: read.report.warnings,
      notes: result.notes,
    }),
  );
}

/** InChI and its key. An empty key means the InChI layer refused the input. */
export async function toInchi(mol: Molecule, title = ""): Promise<ChemIoResult<InchiResult>> {
  const written = moleculeToMolblock(mol, title);
  if (!written.ok) return written;
  const result = await call({ op: "inchi", text: written.value, layout: layoutFor(mol) });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as InchiAndMolblock;
  if (payload.inchi === "") {
    return fail({
      kind: "rdkit-failed",
      message: "RDKit produced no InChI for this structure.",
      notes: result.notes,
    });
  }
  const round = molblockToMolecule(payload.molblock);
  return ok(
    { inchi: payload.inchi, inchiKey: payload.inchiKey },
    buildReport(mol, round.ok ? round.value.molecule : undefined, {
      coordinates: "not-applicable",
      verification: verificationOf(round.ok),
      warnings: round.ok ? round.report.warnings : [],
      notes: round.ok ? result.notes : [...result.notes, unverifiedNote(round.error.message)],
    }),
  );
}

/**
 * `mol` as a molblock, normalised by RDKit.
 *
 * Deliberately routed through RDKit rather than returning chem-core's own
 * text: the point of this operation is that the file another program opens
 * has been through the same sanitiser they will run it through.
 */
export async function toMolblock(mol: Molecule, title = ""): Promise<ChemIoResult<string>> {
  const written = moleculeToMolblock(mol, title);
  if (!written.ok) return written;
  const hadLayout = hasMeaningfulCoordinates(mol);
  const result = await call({ op: "normalize", text: written.value, layout: layoutFor(mol) });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as WorkerPayload;
  const round = molblockToMolecule(payload.molblock);
  return ok(
    payload.molblock,
    buildReport(mol, round.ok ? round.value.molecule : undefined, {
      coordinates: coordinateOutcome(payload.hadCoords, payload.coordsGenerated, hadLayout),
      verification: verificationOf(round.ok),
      warnings: round.ok ? round.report.warnings : [],
      notes: round.ok ? result.notes : [...result.notes, unverifiedNote(round.error.message)],
    }),
  );
}

/**
 * Read a molblock or SDF record.
 *
 * COORDINATES ARE PRESERVED when the file carries a 2D layout — a chemist who
 * drew a structure somewhere else expects to see the drawing they made, not a
 * re-layout of it. A file with no conformer gets one computed, and so does a
 * 3D file, whose flat projection would stack atoms on top of each other.
 */
export async function fromMolblock(text: string): Promise<ChemIoResult<ImportedStructure>> {
  // Read the FILE with chem-core FIRST. It is two things at once: the
  // baseline the report diffs against, and the only thing that can tell an
  // all-zero conformer from a real layout — RDKit cannot, it answers
  // `has_coords() === 2` for a file whose every atom sits at 0,0,0, so
  // "preserve" would import the structure stacked on the origin and call it
  // preserved. A conformer that carries no layout is a conformer that is
  // absent for our purposes, and the contract says absent means generate.
  const source = molblockToMolecule(text);
  const before = source.ok ? source.value.molecule : undefined;
  const sourceHadLayout = before === undefined || hasMeaningfulCoordinates(before);

  const result = await call({
    op: "normalize",
    text,
    layout: sourceHadLayout ? "preserve" : "generate",
  });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as WorkerPayload;
  const read = molblockToMolecule(payload.molblock);
  if (!read.ok) return read;
  return ok(
    read.value,
    buildReport(before, before ? read.value.molecule : undefined, {
      coordinates: coordinateOutcome(payload.hadCoords, payload.coordsGenerated, sourceHadLayout),
      // A file chem-core refuses — a V3000 block, say — is still a legitimate
      // RDKit import, but it leaves nothing to diff against, and that is a
      // different statement from "nothing changed". Measured: RDKit
      // charge-separates the nitro group in a V3000 `CN(=O)=O` and the old
      // report called it clean.
      verification: verificationOf(source.ok),
      warnings: [...read.report.warnings, ...(source.ok ? source.report.warnings : [])],
      notes: source.ok ? result.notes : [...result.notes, unverifiedNote(source.error.message)],
    }),
  );
}

/** Re-lay-out `mol` in 2D with CoordGen, discarding the current positions. */
export async function generate2DCoords(mol: Molecule): Promise<ChemIoResult<Molecule>> {
  const written = moleculeToMolblock(mol);
  if (!written.ok) return written;
  const result = await call({ op: "normalize", text: written.value, layout: "generate" });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as WorkerPayload;
  const read = molblockToMolecule(payload.molblock);
  if (!read.ok) return read;
  return ok(
    read.value.molecule,
    buildReport(mol, read.value.molecule, {
      coordinates: coordinateOutcome(
        payload.hadCoords,
        payload.coordsGenerated,
        hasMeaningfulCoordinates(mol),
      ),
      verification: "verified",
      warnings: read.report.warnings,
      notes: result.notes,
    }),
  );
}

/**
 * RDKit's canonical SMILES for `mol`, together with the sanitized molecule.
 *
 * The molecule comes back WITH ITS DRAWING: this is not a round trip through
 * SMILES. That definition was considered and rejected — SMILES carries
 * neither coordinates nor wedges, so it would silently flatten the user's
 * layout and invert nothing that `elementCounts` or `netCharge` could see.
 */
export async function canonicalize(
  mol: Molecule,
  title = "",
): Promise<ChemIoResult<CanonicalResult>> {
  const written = moleculeToMolblock(mol, title);
  if (!written.ok) return written;
  const result = await call({ op: "smiles", text: written.value, layout: layoutFor(mol) });
  if (!result.ok) return fail(opError(result));
  const payload = result.value as SmilesAndMolblock;
  const read = molblockToMolecule(payload.molblock);
  if (!read.ok) return read;
  return ok(
    { smiles: payload.smiles, molecule: read.value.molecule },
    buildReport(mol, read.value.molecule, {
      coordinates: coordinateOutcome(
        payload.hadCoords,
        payload.coordsGenerated,
        hasMeaningfulCoordinates(mol),
      ),
      verification: "verified",
      warnings: read.report.warnings,
      notes: result.notes,
    }),
  );
}
