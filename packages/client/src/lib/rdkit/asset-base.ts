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

/**
 * The files the worker needs, versioned by content.
 *
 * They keep fixed names in `public/rdkit/`, so the URL alone cannot tell one
 * release's worker from the next. The service worker serves them cache-first
 * (decision 239), and a cached worker from an older release would then speak
 * an older message protocol to newer client code. `next.config.ts` hashes the
 * staged files into `NEXT_PUBLIC_RDKIT_ASSET_VERSION`; the worker repeats its
 * own query on the glue and the wasm, so all three move together.
 *
 * Unset outside a Next build (Vitest), where the bare names are what exists.
 */
export function rdkitAssetUrl(name: RdkitAsset): string {
  const version = process.env.NEXT_PUBLIC_RDKIT_ASSET_VERSION;
  const query = version === undefined || version === "" ? "" : `?v=${version}`;
  return `${rdkitAssetBase()}${name}${query}`;
}

export type RdkitAsset = "rdkit.worker.js" | "RDKit_minimal.js" | "RDKit_minimal.wasm";

/** Everything SMILES import needs offline, for the service worker to fetch
 *  ahead of the first import. */
export function rdkitOfflineAssetUrls(): string[] {
  return (["rdkit.worker.js", "RDKit_minimal.js", "RDKit_minimal.wasm"] as const).map(rdkitAssetUrl);
}
