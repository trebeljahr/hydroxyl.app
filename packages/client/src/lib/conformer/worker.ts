/**
 * The conformer worker: OpenChemLib and its force-field tables, bundled by
 * esbuild into `public/conformer/conformer.worker.js` by
 * `scripts/copy-conformer.mjs`, for the same reasons the RDKit worker is (see
 * that script's header): no Turbopack, a classic worker, typechecked source.
 *
 * Its own worker rather than a fourth op on RDKit's. OpenChemLib is 1.1 MB
 * of script with 0.2 MB of tables, and only the 3D view needs it; inside the
 * RDKit worker every SMILES paste would pay for it.
 *
 * Synchronous per request, so a long minimisation cannot be interrupted from
 * inside. The client handles a stale request by terminating this worker and
 * starting a fresh one (see `client.ts`), which is why nothing here keeps
 * state worth losing.
 */

import * as OCL from "openchemlib";
// Resolved by the staging script's esbuild plugin to the force-field slice of
// OpenChemLib's resources.json; see `FORCE_FIELD_RESOURCE_PREFIX`.
import resources from "virtual:openchemlib-forcefield";

import { embedConformer } from "./embed";
import type { ConformerRequest, ConformerResponse, ConformerResult } from "./protocol";

declare const self: {
  onmessage: ((event: { data: ConformerRequest }) => void) | null;
  postMessage(message: ConformerResponse): void;
};

let registered = false;

self.onmessage = (event) => {
  const { id, molblock } = event.data;
  let result: ConformerResult;
  try {
    if (!registered) {
      OCL.Resources.register(resources);
      registered = true;
    }
    result = embedConformer(OCL, molblock);
  } catch (error) {
    result = {
      ok: false,
      reason: "worker",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage({ id, result });
};
