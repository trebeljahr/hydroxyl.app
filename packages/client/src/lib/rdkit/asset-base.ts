/**
 * Where `public/rdkit/` is being served from, in every build mode.
 *
 * Three shapes have to work and they disagree about what a URL means:
 *
 *   dev / `output:"standalone"` — Next emits `<script src="/_next/static/…">`
 *     and serves `public/` at the site root, so the answer is `/rdkit/`.
 *
 *   `output:"export"` with `assetPrefix:"./"` — Next emits
 *     `<script src="./_next/static/…">`. `public/` is copied to `out/`
 *     UNPREFIXED, and the app may be opened from any directory (an Electron
 *     custom protocol, a Capacitor server, a subdirectory on a static host).
 *     The answer has to be relative to wherever the document actually is.
 *
 * The document's own script tags are the only thing that knows the
 * difference, because the browser has ALREADY resolved whatever Next wrote
 * into an absolute `HTMLScriptElement.src`. Slicing the prefix back off it
 * gives the deployment root in every case. `document.baseURI` alone does not:
 * it would be right for the export and wrong for a standalone deployment
 * whose page happens to sit at `/editor/`.
 *
 * KNOWN LIMIT, and not this module's to fix: under `assetPrefix:"./"` Next
 * writes the same relative `./_next/…` into NESTED pages too, so a document
 * served from `/editor/` resolves its own chunks to `/editor/_next/…` and
 * never hydrates. Where that is broken, this function is wrong in exactly the
 * same way and for the same reason.
 */

const ASSET_MARKER = "/_next/static/";

export function rdkitAssetBase(): string {
  if (typeof document === "undefined") return "/rdkit/";
  const script = document.querySelector<HTMLScriptElement>(`script[src*="${ASSET_MARKER}"]`);
  const src = script?.src;
  const marker = src ? src.indexOf(ASSET_MARKER) : -1;
  const root = marker >= 0 && src ? src.slice(0, marker + 1) : new URL(".", document.baseURI).href;
  return `${root}rdkit/`;
}
