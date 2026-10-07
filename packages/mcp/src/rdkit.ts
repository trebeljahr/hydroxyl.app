/**
 * RDKit in plain node, for the MCP server.
 *
 * The client runs RDKit in a Worker; here there is no browser, so the wasm is
 * loaded directly — the way the client's `*.node.test.ts` fidelity harness
 * already does. Everything after loading goes through the client's own
 * `ops.ts` (every RDKit call in the project) and `translate.ts` (the only
 * molblock translation layer), so a structure read by this server is read
 * exactly as one pasted into the editor.
 *
 * Loaded lazily and once: `editor_link` and a molfile-only `describe` never
 * need it, and initialising the 6.9 MB wasm costs about a second.
 */

import { createRequire } from "node:module";

import type { RDKitLogLike, RDKitModuleLike } from "@/lib/rdkit/ops";

export interface RdkitRuntime {
  readonly rdkit: RDKitModuleLike;
  /**
   * ONE log handle for the life of the process: `set_log_capture` takes an
   * exclusive lock inside the wasm instance, so a second call returns null.
   * Same rule as the worker's.
   */
  readonly log: RDKitLogLike | null;
}

let runtime: Promise<RdkitRuntime> | undefined;

export function loadRdkit(): Promise<RdkitRuntime> {
  runtime ??= (async () => {
    const require = createRequire(import.meta.url);
    const init = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
    const rdkit = await init();
    const log = rdkit.set_log_capture?.("rdApp.*") ?? null;
    return { rdkit, log };
  })();
  return runtime;
}
