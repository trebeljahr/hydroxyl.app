/**
 * The RDKit worker.
 *
 * COMPILED TO `public/rdkit/rdkit.worker.js` by `scripts/copy-rdkit.mjs`, and
 * loaded from there as a CLASSIC worker at a runtime-computed URL. It is
 * deliberately NOT `new Worker(new URL("./worker.ts", import.meta.url))`:
 * Turbopack rewrites that into `new URL(CHUNK_BASE_PATH + path,
 * location.origin)`, and in the static export `CHUNK_BASE_PATH` is the
 * literal `"./_next/"` — resolving a relative path against an ORIGIN throws
 * away any subpath the app is served under. The worker 404s and the `onerror`
 * event's `.message` is the empty string, so there is nothing to grep for.
 * Measured on a Next 16.2.6 export served at `/app/`. The same rewrite also
 * silently strips `{type:"module"}`, so a module worker is not available
 * there either.
 *
 * Loading from `public/` sidesteps all of it, and gets the wasm right for
 * free: emscripten sets `_scriptName = self.location.href` in a worker and
 * derives `scriptDirectory` from it, so with the glue and the wasm sitting
 * beside this file, the default lookup is already correct in dev, in the
 * standalone build, in the export at the root and in the export at a subpath.
 *
 * NOTHING RDKIT AT MODULE SCOPE. `importScripts` runs inside `ensureRDKit`,
 * on the first request, so a session that never imports or exports a
 * structure never fetches 6.9 MB of wasm.
 */

import {
  descriptorsAndMolblock,
  inchiAndMolblock,
  normalizeMolblock,
  smilesAndMolblock,
} from "./ops";
import type { OpResult, RDKitLogLike, RDKitModuleLike } from "./ops";
import type { WorkerPayload, WorkerRequest, WorkerResponse } from "./protocol";

declare function importScripts(...urls: string[]): void;
declare const self: {
  location: { href: string; search: string };
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage(message: unknown): void;
  initRDKitModule?: (options?: {
    locateFile?: (path: string, prefix: string) => string;
  }) => Promise<RDKitModuleLike>;
};

/** Absolute, and correct at any subpath: the worker's own directory. */
const BASE = new URL(".", self.location.href).href;

/** The `?v=<content hash>` this worker was loaded with (`rdkitAssetUrl`),
 *  repeated on the glue and the wasm so a cache keyed by URL can never pair
 *  this worker with another release's wasm. */
const VERSION = self.location.search;

interface Runtime {
  readonly rdkit: RDKitModuleLike;
  /**
   * ONE log handle for the life of the worker.
   *
   * `set_log_capture` takes a global EXCLUSIVE lock inside the wasm instance:
   * while a handle is held, a second call returns null, and only `.delete()`
   * releases it. Acquiring per-operation means one missed release costs every
   * later diagnostic in the session.
   */
  readonly log: RDKitLogLike | null;
}

let runtime: Promise<Runtime> | undefined;

function ensureRDKit(): Promise<Runtime> {
  runtime ??= (async () => {
    importScripts(`${BASE}RDKit_minimal.js${VERSION}`);
    const init = self.initRDKitModule;
    if (!init) throw new Error("RDKit_minimal.js loaded but defined no initRDKitModule");
    // `locateFile` is redundant with emscripten's own default here, and kept
    // because the default is derived from a global the glue sets during load:
    // stating it makes the wasm's location a property of this file.
    const rdkit = await init({ locateFile: (path) => `${BASE}${path}${VERSION}` });
    const log = rdkit.set_log_capture?.("rdApp.*") ?? null;
    self.postMessage({ id: 0, ready: true, version: rdkit.version() });
    return { rdkit, log };
  })();
  return runtime;
}

function run(runtimeValue: Runtime, request: WorkerRequest): OpResult<WorkerPayload> {
  const { rdkit, log } = runtimeValue;
  switch (request.op) {
    case "normalize":
      return normalizeMolblock(rdkit, request.text, request.layout, log);
    case "smiles":
      return smilesAndMolblock(rdkit, request.text, request.layout, log);
    case "inchi":
      return inchiAndMolblock(rdkit, request.text, log);
    case "descriptors":
      return descriptorsAndMolblock(rdkit, request.text, log);
  }
}

self.onmessage = (event) => {
  const request = event.data;
  void (async () => {
    let result: OpResult<WorkerPayload>;
    try {
      result = run(await ensureRDKit(), request);
    } catch (error) {
      // Reaching here means the wasm never came up. Reported as a result like
      // everything else: the boundary's contract is that it does not throw,
      // and an unhandled rejection in a worker is invisible to the page.
      result = {
        ok: false,
        kind: "worker-unavailable",
        message: error instanceof Error ? error.message : String(error),
        notes: [],
      };
    }
    const response: WorkerResponse = { id: request.id, result };
    self.postMessage(response);
  })();
};
