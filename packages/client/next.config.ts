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
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared", "@starter/chem-core"],
};

export default nextConfig;
