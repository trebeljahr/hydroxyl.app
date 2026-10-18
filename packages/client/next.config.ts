import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
/**
 * Every production build is a static export; two flavours differ in where it
 * runs (decision 257).
 *
 * `NEXT_FILE_EXPORT=1` is the NATIVE flavour, for the Electron and Capacitor
 * shells: relative asset prefix, flat pages (see `trailingSlash` below).
 *
 * Anything else is the WEB flavour, the hosted site: the files a Cloudflare
 * Worker serves at the site root. Root-absolute `/_next/…`, nested pages under
 * `trailingSlash: true`, the service worker and `ReleaseLifetime` on. The
 * native prefix would be wrong here — a page one directory down resolves
 * `./_next/` into a directory with no assets. (`NEXT_FILE_EXPORT=web` still
 * names it explicitly; the release workflow passes it.)
 *
 * There is no server build any more. The standalone output the Coolify image
 * ran retired with that app on 2026-10-18.
 */
const isNativeExport = process.env.NEXT_FILE_EXPORT === "1";

/**
 * The public URL this app is published at, from the domain Hatchkit deploys
 * it to (decision 122). `sitemap.xml`, `robots.txt` and `metadataBase` all
 * need an absolute URL and there is no request to take one from in a static
 * export, so it is baked in at build time like `NEXT_PUBLIC_FILE_EXPORT`.
 *
 * Throws rather than falling back. A sitemap that names the wrong host is
 * worse than a failed build, because nothing downstream would notice.
 * process.cwd() is `<repo>/packages/client` here, as for `turbopack.root`.
 */
function siteUrlFromHatchkit(): string {
  const manifest = path.join(process.cwd(), "..", "..", ".hatchkit.json");
  const { domain } = JSON.parse(readFileSync(manifest, "utf8")) as { domain?: unknown };
  if (typeof domain !== "string" || !/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error(`${manifest} has no usable "domain"; sitemap.xml and robots.txt need one`);
  }
  return `https://${domain}/`;
}

/**
 * A content hash of files a staging script wrote into `public/<dir>/`,
 * appended to their URLs as `?v=` (`rdkitAssetUrl`, `conformerWorkerUrl`).
 *
 * Their names never change between releases, and the service worker serves
 * them cache-first (decisions 239 and 253), so the URL has to change when the
 * bytes do or a cached worker outlives the client code it talks to. Every
 * script that runs `next` stages the files first; empty when they are absent,
 * which only happens to tooling that loads this config without building.
 */
function stagedAssetVersion(dir: string, names: readonly string[]): string {
  const root = path.join(process.cwd(), "public", dir);
  if (!names.every((name) => existsSync(path.join(root, name)))) return "";
  const hash = createHash("sha256");
  for (const name of names) hash.update(readFileSync(path.join(root, name)));
  return hash.digest("hex").slice(0, 16);
}

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this Next walks up looking for a
  // lockfile and, when dev runs from a git worktree under the main
  // checkout, picks the parent repo and resolves node_modules there.
  //
  // THE ROOT IS ALSO THE WATCH SCOPE, and at the main checkout that scope is
  // mostly other agents' worktrees: 469,000 files on 2026-09-29, 434,000 of
  // them (92%) under `.claude/worktrees/`. It was blamed for the 2 GB
  // `pnpm dev` crash in manual notes 3, and measurement clears it: with
  // 446,000 files of cloned worktrees inside the root and ~290,000 file events
  // churning through them, the server's retained heap stayed flat under
  // 100 MB on Node 24 and 26 alike. The count is a snapshot, not a constant —
  // it tracks how many agent sessions are live. Turbopack has no ignore list
  // to narrow it with (checked up to 16.4.0-canary.51); see
  // `test/turbopack-root.test.ts` for why the root cannot move, and
  // `scripts/dev-preflight.mjs` for what the crash left behind and what `dev`
  // now does about the next one.
  turbopack: { root: path.join(process.cwd(), "..", "..") },
  ...(isDev
    ? {}
    : isNativeExport
      ? {
          // Static export for desktop (Electron) + mobile (Capacitor) shells.
          output: "export" as const,
          assetPrefix: "./",
        }
      : {
          // Static export for the hosted site (decision 257). No prefix:
          // a real origin resolves `/_next/…` from every page depth.
          output: "export" as const,
        }),
  // TRUE EVERYWHERE EXCEPT THE NATIVE EXPORT, and the exception is
  // load-bearing.
  //
  // `assetPrefix: "./"` above makes every emitted asset URL relative to the
  // DOCUMENT, which is what lets the export run from a subdirectory, an
  // Electron custom protocol or a Capacitor bundle. The cost is that the
  // document's own depth decides where `./_next/…` lands. With
  // `trailingSlash: true` the editor is written to `out/editor/index.html`,
  // whose `./_next/…` resolves to `/editor/_next/…` — verified in a browser:
  // every chunk 404s, the page never hydrates, and `rdkitAssetBase()`
  // computes an equally dead `/editor/rdkit/`. Since `/editor` is the only
  // page a chemist imports a structure from, the export was passing CI while
  // being runtime-dead.
  //
  // `trailingSlash: false` emits `out/editor.html` instead, which sits at the
  // export root's own depth, so the relative prefix is correct again. Static
  // hosts serve it for `/editor` by extension fallback, and a shell loads it
  // as `editor.html`. This holds for one level of nesting, which is what the
  // route table has; a route at `/a/b` would need the prefix problem solved
  // properly instead.
  //
  // The web export keeps `true`: it has no prefix to get wrong, and the
  // Worker's `auto-trailing-slash` serves `out/editor/index.html` at
  // `/editor/` and redirects `/editor` there, so public URLs, the sitemap and
  // the service worker's precached `/editor/` stay what they always were.
  trailingSlash: !isNativeExport,
  // WHICH BUILD THIS IS, readable from client code.
  //
  // The recents grid has to link at the editor, and the two builds disagree
  // about what that URL is: a route in dev and on the hosted site, a flat
  // `editor.html` beside the current document in the native export. Sniffing the
  // answer off a script tag at runtime works but cannot answer during the
  // prerender, so the emitted HTML would carry the wrong href until hydration
  // — and in the native export "/editor" is a file that does not exist. `env` is
  // substituted at build time, so the very first byte of HTML is right.
  //
  // "1" means the native shells only. The web export answers "0": it is
  // served from a real origin, where `/editor` is a route.
  env: {
    NEXT_PUBLIC_FILE_EXPORT: isNativeExport ? "1" : "0",
    NEXT_PUBLIC_SITE_URL: siteUrlFromHatchkit(),
    NEXT_PUBLIC_RDKIT_ASSET_VERSION: stagedAssetVersion("rdkit", [
      "rdkit.worker.js",
      "RDKit_minimal.js",
      "RDKit_minimal.wasm",
    ]),
    NEXT_PUBLIC_CONFORMER_ASSET_VERSION: stagedAssetVersion("conformer", ["conformer.worker.js"]),
  },
  // No `headers()`: an export has no server to send them. The hosted site's
  // header rules are `cloudflare/_headers`, which the Worker applies.
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared", "@starter/chem-core", "@starter/chem-render"],
};

export default nextConfig;
