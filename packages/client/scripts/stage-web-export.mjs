/**
 * Finishes the web export (decision 257): puts this release's service worker
 * and the Worker's header rules into `out/`. Runs after every `next build`
 * and `build-service-worker.mjs`, and does nothing unless
 * NEXT_FILE_EXPORT=web.
 *
 * The worker has to be copied because of the order of the build. `next
 * build` copies `public/` into `out/` before build-service-worker.mjs writes
 * this release's `public/sw.js`, so until this runs `out/` holds the previous
 * build's worker, or none. A stale worker precaches the previous release's
 * chunk list, and its install fails on the first chunk this upload does not
 * carry.
 *
 * `_headers` lives in `cloudflare/` rather than `public/` so the standalone
 * server and the native export never ship it as a file.
 */

import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(client, "out");

if (process.env.NEXT_FILE_EXPORT === "web") {
  if (!existsSync(out)) throw new Error(`${out} is missing; run the web export first`);
  copyFileSync(path.join(client, "public", "sw.js"), path.join(out, "sw.js"));
  copyFileSync(path.join(client, "cloudflare", "_headers"), path.join(out, "_headers"));
  console.log("web export: out/sw.js and out/_headers staged");
}
