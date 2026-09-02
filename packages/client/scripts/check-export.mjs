/**
 * The static export's SHAPE, checked after `NEXT_FILE_EXPORT=1 next build`.
 *
 * "It built" was the only thing CI asserted, and it is not the same claim as
 * "it runs". Measured before this script existed: `out/editor/index.html`
 * built fine and was runtime-dead — under `assetPrefix: "./"` its
 * `./_next/static/…` resolved against `/editor/`, so every chunk 404'd, the
 * page never hydrated, and the RDKit asset base computed from those same
 * script tags pointed at a directory that does not exist. Nothing in a build
 * log says any of that.
 *
 * So the two invariants that make the export runnable are asserted directly:
 *
 *   1. Every HTML document sits at the export ROOT. A relative asset prefix
 *      is only correct at the depth it was written for, and one nested page
 *      is enough to take the app down at exactly the route people use.
 *   2. The RDKit assets and the third-party notice are in `out/rdkit/`, since
 *      the export copies `public/` verbatim and nothing else would notice if
 *      that stopped being true.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // `_next/` is Next's own asset tree; it holds no documents.
    if (entry.isDirectory()) {
      if (entry.name !== "_next") found.push(...htmlFiles(full));
    } else if (entry.name.endsWith(".html")) {
      found.push(full);
    }
  }
  return found;
}

const problems = [];

const nested = htmlFiles(out).filter((file) => path.dirname(file) !== out);
if (nested.length > 0) {
  problems.push(
    `These exported pages are not at the export root, so their relative ` +
      `./_next/ asset prefix resolves into a directory that has no assets:\n  ` +
      nested.map((f) => path.relative(out, f)).join("\n  ") +
      `\nSee the trailingSlash comment in next.config.ts.`,
  );
}

for (const asset of [
  "rdkit/RDKit_minimal.wasm",
  "rdkit/RDKit_minimal.js",
  "rdkit/rdkit.worker.js",
  "rdkit/THIRD-PARTY-NOTICES.txt",
]) {
  try {
    if (statSync(path.join(out, asset)).size === 0) problems.push(`out/${asset} is empty`);
  } catch {
    problems.push(`out/${asset} is missing from the static export`);
  }
}

if (problems.length > 0) {
  console.error(`static export check failed:\n\n${problems.join("\n\n")}\n`);
  process.exit(1);
}
console.log("static export: every page at the root, RDKit assets and notice present");
