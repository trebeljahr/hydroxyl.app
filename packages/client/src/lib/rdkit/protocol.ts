/**
 * The worker wire format.
 *
 * Text in, text out, in both directions. Everything here must survive
 * `structuredClone`, which rules out an `Error`, a `Molecule` and anything
 * carrying a function — one more reason the chem-core translation happens on
 * the main thread and only molblocks cross.
 */

import type { InchiAndMolblock, NormalizedMolblock, OpResult, SmilesAndMolblock } from "./ops.js";

/**
 * The three things RDKit is actually asked to do. Every public operation is
 * one of these plus a chem-core conversion on one side or the other, which is
 * why there is no `toSmiles` op here — `toSmiles` is `moleculeToMolblock`
 * followed by `smiles`.
 */
export type WorkerOp = "normalize" | "smiles" | "inchi";

export interface WorkerRequest {
  readonly id: number;
  readonly op: WorkerOp;
  /** A molblock or a SMILES; RDKit's `get_mol` sniffs which from `M  END`. */
  readonly text: string;
  /** See `normalizeMolblock`. Ignored by `inchi`. */
  readonly layout: "preserve" | "generate";
}

export type WorkerPayload = NormalizedMolblock | SmilesAndMolblock | InchiAndMolblock;

export interface WorkerResponse {
  readonly id: number;
  readonly result: OpResult<WorkerPayload>;
}

/** Sent once, unprompted, when the wasm is up — purely for diagnostics. */
export interface WorkerReady {
  readonly id: 0;
  readonly ready: true;
  readonly version: string;
}

export type WorkerMessage = WorkerResponse | WorkerReady;

export function isReady(message: WorkerMessage): message is WorkerReady {
  return (message as WorkerReady).ready === true;
}
