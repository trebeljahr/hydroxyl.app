import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isExport = process.env.NEXT_FILE_EXPORT === "1";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this Next walks up looking for a
  // lockfile and, when dev runs from a git worktree under the main
  // checkout, picks the parent repo and resolves node_modules there.
  turbopack: { root: path.join(process.cwd(), "..", "..") },
  ...(isDev
    ? {}
    : isExport
      ? {
          // Static export for desktop (Electron) + mobile (Capacitor) shells.
          output: "export" as const,
          assetPrefix: "./",
        }
      : {
          // Standalone build for the web image (the root ./Dockerfile).
          // Trace from the monorepo root so the standalone tree is
          // re-rooted there — server.js lands at
          // packages/client/server.js. The workspace deps
          // (@starter/chem-core, @starter/shared) are inlined by
          // transpilePackages below rather than traced into node_modules.
          // process.cwd() is `<repo>/packages/client` during `next build`.
          output: "standalone" as const,
          outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
        }),
  // TRUE EVERYWHERE EXCEPT THE EXPORT, and the exception is load-bearing.
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
  trailingSlash: !isExport,
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared", "@starter/chem-core", "@starter/chem-render"],
};

export default nextConfig;
