import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isExport = process.env.NEXT_FILE_EXPORT === "1";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this Next walks up looking for a
  // lockfile and, when dev runs from a git worktree under the main
  // checkout, picks the parent repo and resolves node_modules there.
  //
  // THE ROOT IS ALSO THE WATCH SCOPE, which is worth knowing before blaming
  // the app for a `pnpm dev` that eats memory. Counted in the main checkout on
  // 2026-09-27, and a snapshot rather than a constant — the figure tracks how
  // many agent worktrees happen to be live, and was ~1% higher a day later:
  // 134,002 files under this root, of which 98,954 — 74% — live in
  // `.claude/worktrees/`, i.e. sibling checkouts of this same repo, each with
  // its own node_modules and .next. Nothing under `packages/` changed during
  // a 15-minute sample; 1,177 files under `.claude/` did, because other agent
  // sessions were building there. A dev server started from the MAIN checkout
  // therefore watches, and reacts to, work that has nothing to do with it; one
  // started from inside a worktree does not, because the root is then that
  // worktree. There is no Turbopack ignore list to narrow this with, so the
  // remedy is where the worktrees live rather than anything in this file.
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
  // WHICH BUILD THIS IS, readable from client code.
  //
  // The recents grid has to link at the editor, and the two builds disagree
  // about what that URL is: a route in dev and standalone, a flat
  // `editor.html` beside the current document in the export. Sniffing the
  // answer off a script tag at runtime works but cannot answer during the
  // prerender, so the emitted HTML would carry the wrong href until hydration
  // — and in the export "/editor" is a file that does not exist. `env` is
  // substituted at build time, so the very first byte of HTML is right.
  env: { NEXT_PUBLIC_FILE_EXPORT: isExport ? "1" : "0" },
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared", "@starter/chem-core", "@starter/chem-render"],
};

export default nextConfig;
