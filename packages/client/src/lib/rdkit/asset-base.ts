/**
 * Where `public/rdkit/` is being served from, in every build mode.
 *
 * The hard part — deriving the deployment root from a script tag the browser
 * has already resolved — now lives in `@/lib/deployment`, because the recents
 * grid needs the same answer to link at the editor. This module is the wasm's
 * name for it, kept so the bridge reads as owning its own asset base and so
 * `asset-base.test.ts` keeps pinning the behaviour the worker depends on: a
 * bad base 404s the worker script, and a 404 on a worker produces an error
 * event whose `.message` is the empty string.
 *
 * DEPENDS ON A FLAT EXPORT, and cannot fix it from here: under
 * `assetPrefix:"./"` Next writes the same relative `./_next/…` into NESTED
 * pages too, so a document served from `/editor/` would resolve its own
 * chunks to `/editor/_next/…`, never hydrate, and make this function compute
 * an equally dead `/editor/rdkit/`. `next.config.ts` therefore drops
 * `trailingSlash` in export mode so every page is written at the export root
 * — `out/editor.html`, not `out/editor/index.html` — and
 * `scripts/check-export.mjs` fails the build if a nested page ever reappears.
 */

import { deploymentRoot } from "@/lib/deployment";

export function rdkitAssetBase(): string {
  return `${deploymentRoot()}rdkit/`;
}
