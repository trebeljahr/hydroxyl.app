/**
 * Bundle the server into dist/server.js with esbuild.
 *
 * WHY A BUNDLE, NOT tsc. The server reuses the editor's own export and
 * import code — `@/lib/export/figure`, `@/lib/rdkit/ops`, `@/lib/rdkit/translate`,
 * `@/lib/io/fragment` — which live in the client package and resolve through
 * its `@/` alias, which only a bundler understands (decision 246). The
 * workspace packages are bundled in too, so the output depends on nothing
 * private and can be published as one file once there is a licence.
 *
 * External: the MCP SDK and zod (ordinary npm dependencies), and RDKit and
 * resvg, whose wasm is found beside their own JavaScript at run time.
 *
 * Arimo is copied beside the bundle as a file: resvg needs its bytes, and
 * chem-render deliberately exports no path into `text/generated/`.
 */

import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src", "main.ts")],
  outfile: path.join(dist, "server.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  alias: { "@": path.join(root, "..", "client", "src") },
  external: ["@modelcontextprotocol/sdk", "zod", "@rdkit/rdkit", "@resvg/resvg-wasm"],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
await chmod(path.join(dist, "server.js"), 0o755);

await copyFile(
  path.join(root, "..", "chem-render", "assets", "arimo-latin-400-normal.woff"),
  path.join(dist, "arimo.woff"),
);
console.log("Built packages/mcp/dist/server.js");
