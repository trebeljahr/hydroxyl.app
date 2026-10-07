/**
 * Bundles `src/sw/service-worker.ts` into `public/sw.js`, with the list of
 * files to precache baked in — decision 239. Runs after every `next build`.
 *
 * AFTER the build because the list is `.next/static/` itself: every hashed
 * chunk, stylesheet and font this release serves, about 2 MB. Baking it into
 * the script also makes the script's bytes change with every release, which
 * is what tells a browser there is a new worker to install.
 *
 * `public/` is copied into the image after `pnpm run build` (Dockerfile) and
 * read by `next start` at request time, so writing there after the build is
 * in time for both.
 *
 * NOT IN THE STATIC EXPORT. A `file://` page or a shell's custom protocol
 * cannot register a worker, and `@/lib/service-worker` never tries. Export
 * mode instead removes the `sw.js` a previous web build left in `public/`,
 * from both `public/` and `out/`, so the export carries no dead worker.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(clientRoot, "public", "sw.js");

/** Every file below `dir`, as `/_next/static/…` URL paths. */
export function precacheList(dir, prefix = "/_next/static/") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...precacheList(full, `${prefix}${entry.name}/`));
    else if (entry.isFile()) found.push(`${prefix}${entry.name}`);
  }
  return found.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NEXT_FILE_EXPORT === "1") {
    rmSync(target, { force: true });
    rmSync(path.join(clientRoot, "out", "sw.js"), { force: true });
  } else {
    const staticDir = path.join(clientRoot, ".next", "static");
    if (!existsSync(staticDir)) throw new Error(`${staticDir} is missing; run next build first`);
    const precache = precacheList(staticDir);
    if (precache.length === 0) throw new Error(`${staticDir} is empty; nothing to precache`);
    // Imported here, not at the top: `precacheList` is unit-tested under
    // jsdom, whose TextEncoder fails esbuild's startup invariant check.
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [path.join(clientRoot, "src", "sw", "service-worker.ts")],
      outfile: target,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      legalComments: "none",
      logLevel: "warning",
      define: { __PRECACHE__: JSON.stringify(precache) },
    });
    console.log(`service worker: public/sw.js precaches ${precache.length} files`);
  }
}
