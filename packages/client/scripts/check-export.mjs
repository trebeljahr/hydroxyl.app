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
 *   3. `sitemap.xml` and `robots.txt` are emitted, name the domain in
 *      `.hatchkit.json`, and every sitemap entry is a file the export really
 *      contains (decision 122). `e2e/seo.spec.ts` checks the standalone side.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(client, "out");

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

// Read independently of next.config.ts, so a wrong derivation there cannot
// also be the expectation here.
const { domain } = JSON.parse(readFileSync(path.join(client, "..", "..", ".hatchkit.json"), "utf8"));
const site = `https://${domain}/`;

function readOut(name) {
  try {
    return readFileSync(path.join(out, name), "utf8");
  } catch {
    problems.push(`out/${name} is missing from the static export`);
    return null;
  }
}

const sitemap = readOut("sitemap.xml");
if (sitemap !== null) {
  const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const expected = [site, `${site}about.html`];
  if (JSON.stringify(listed) !== JSON.stringify(expected)) {
    problems.push(
      `out/sitemap.xml lists\n  ${listed.join("\n  ")}\nbut should list\n  ${expected.join("\n  ")}`,
    );
  }
  // A directory is not enough: the export writes `out/about/` for the RSC
  // payloads, so `about/` would pass an existence check with no page in it.
  for (const url of listed.filter((u) => u.startsWith(site))) {
    const rest = url.slice(site.length);
    const file = rest === "" || rest.endsWith("/") ? `${rest}index.html` : rest;
    const full = path.join(out, file);
    if (!existsSync(full) || !statSync(full).isFile()) {
      problems.push(`out/sitemap.xml lists ${url}, but the export has no ${file}`);
    }
  }
}

const robots = readOut("robots.txt");
if (robots !== null) {
  for (const line of ["Disallow: /editor", `Sitemap: ${site}sitemap.xml`]) {
    if (!robots.split("\n").includes(line)) problems.push(`out/robots.txt has no "${line}" line`);
  }
}

if (problems.length > 0) {
  console.error(`static export check failed:\n\n${problems.join("\n\n")}\n`);
  process.exit(1);
}
console.log(
  "static export: every page at the root, RDKit assets and notice present, " +
    `sitemap.xml and robots.txt name ${site}`,
);
