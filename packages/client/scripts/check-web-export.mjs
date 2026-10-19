/**
 * The web export's SHAPE and the Workers Free limits, checked before an
 * upload (decision 257).
 *
 *   node scripts/check-web-export.mjs [--release <sha>]
 *
 * check-export.mjs holds the native export to its own rules (flat pages, a
 * relative prefix). The web export is the opposite on both counts, and a mix
 * of the two is exactly what would build cleanly and then serve a dead page,
 * so this checks:
 *
 *   1. Pages are nested under `trailingSlash: true` (`editor/index.html`, not
 *      `editor.html`), no page carries the native `./_next/` prefix, and
 *      every `/_next/static/` file a page names is in the upload.
 *   2. The files the hosted app needs at run time are there: the service
 *      worker, RDKit's three files and its notice, the conformer worker, the
 *      404 page, `_headers`.
 *   3. Every sitemap entry is a page in the export.
 *   4. The limits of one Worker version on Workers Free: 20,000 files,
 *      25 MiB per file, 100 `_headers` rules, 2,100 `_redirects` rules.
 *      Counted after the chunk carry, so carried files count too.
 *   5. `wrangler.jsonc` stays assets-only. A `main` script, `run_worker_first`
 *      or `cache` turns free asset requests into billed ones, and a `routes`
 *      key would make every upload rewrite the routes made by hand.
 *   6. With `--release`, the identity files name that commit: `version.json`,
 *      the head of `releases.json` and of `release-assets.json`, and the
 *      `build-sha` meta tag of the landing page. Every file the carry
 *      manifest lists is in the upload, at its listed size.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(client, "..", "..");
const out = path.join(client, "out");

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_HEADER_RULES = 100;
const MAX_REDIRECT_RULES = 2_100;
// Read by Wrangler, never uploaded as assets.
const CONFIG_FILES = new Set(["_headers", "_redirects"]);

const releaseFlag = process.argv.indexOf("--release");
const release = releaseFlag === -1 ? null : process.argv[releaseFlag + 1];
if (release !== null && !/^[a-f0-9]{40}$/.test(release ?? "")) {
  throw new Error("--release needs a full lowercase commit SHA");
}

const problems = [];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
    else problems.push(`${path.relative(out, full)} is neither a file nor a directory`);
  }
  return found;
}

if (!existsSync(out)) throw new Error(`${out} is missing; run NEXT_FILE_EXPORT=web pnpm run build`);
const files = walk(out);
const rel = (file) => path.relative(out, file).split(path.sep).join("/");

// 1. Nested pages, root-absolute assets.
for (const page of [
  "index.html",
  "404.html",
  "editor/index.html",
  "about/index.html",
  "privacy/index.html",
  "imprint/index.html",
  "guides/index.html",
  "guides/journal-figure-size/index.html",
]) {
  if (!existsSync(path.join(out, page))) problems.push(`out/${page} is missing`);
}
for (const flat of ["editor.html", "guides-journal-figure-size.html"]) {
  if (existsSync(path.join(out, flat))) {
    problems.push(`out/${flat} is the native export's flat page; this build ran flatten-export`);
  }
}
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(file, "utf8");
  if (html.includes('"./_next/')) {
    problems.push(`out/${rel(file)} uses the native ./_next/ prefix, which breaks below the root`);
  }
  // Every asset a page names must be in the upload: a missing entry chunk
  // passes every other check here and serves a page that never hydrates.
  const named = [...html.matchAll(/"(\/_next\/static\/[^"?#\\]+)/g)].map((m) => m[1]);
  if (named.length === 0) problems.push(`out/${rel(file)} loads nothing from /_next/static/`);
  for (const asset of new Set(named)) {
    if (!existsSync(path.join(out, asset))) {
      problems.push(`out/${rel(file)} names ${asset}, which is not in the upload`);
    }
  }
}

// 2. Run-time files outside Next's own tree.
for (const asset of [
  "sw.js",
  "_headers",
  "rdkit/RDKit_minimal.wasm",
  "rdkit/RDKit_minimal.js",
  "rdkit/rdkit.worker.js",
  "rdkit/THIRD-PARTY-NOTICES.txt",
  "conformer/conformer.worker.js",
  "sitemap.xml",
  "robots.txt",
]) {
  const full = path.join(out, asset);
  if (!existsSync(full)) problems.push(`out/${asset} is missing`);
  else if (statSync(full).size === 0) problems.push(`out/${asset} is empty`);
}
if (existsSync(path.join(out, "sw.js")) && existsSync(path.join(client, "public", "sw.js"))) {
  const staged = readFileSync(path.join(out, "sw.js"));
  if (!staged.equals(readFileSync(path.join(client, "public", "sw.js")))) {
    problems.push("out/sw.js is not this build's worker; stage-web-export.mjs did not run");
  }
}

// 3. The sitemap names pages that exist.
if (existsSync(path.join(out, "sitemap.xml"))) {
  const { domain } = JSON.parse(readFileSync(path.join(repo, ".hatchkit.json"), "utf8"));
  const site = `https://${domain}/`;
  for (const [, url] of readFileSync(path.join(out, "sitemap.xml"), "utf8").matchAll(
    /<loc>([^<]*)<\/loc>/g,
  )) {
    if (!url.startsWith(site)) {
      problems.push(`sitemap.xml lists ${url}, outside ${site}`);
      continue;
    }
    const rest = url.slice(site.length);
    const page = rest === "" || rest.endsWith("/") ? `${rest}index.html` : rest;
    if (!existsSync(path.join(out, page))) problems.push(`sitemap.xml lists ${url}; no out/${page}`);
  }
}

// 4. Workers Free limits.
const assets = files.filter((f) => !CONFIG_FILES.has(rel(f)));
if (assets.length > MAX_FILES) problems.push(`${assets.length} files (limit ${MAX_FILES})`);
let largest = { name: "", size: 0 };
for (const file of assets) {
  const { size } = statSync(file);
  if (size > largest.size) largest = { name: rel(file), size };
  if (size > MAX_FILE_BYTES) problems.push(`out/${rel(file)} is ${size} bytes (limit 25 MiB)`);
}
/** Rule count of a `_headers` or `_redirects` file: its non-comment lines that
 *  start a rule. A `_headers` rule starts with a path; its headers are
 *  indented. Every `_redirects` line is a rule. */
function ruleCount(name) {
  const file = path.join(out, name);
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .filter((line) => name === "_redirects" || !/^\s/.test(line)).length;
}
const headerRules = ruleCount("_headers");
const redirectRules = ruleCount("_redirects");
if (headerRules > MAX_HEADER_RULES) problems.push(`_headers has ${headerRules} rules (limit 100)`);
if (redirectRules > MAX_REDIRECT_RULES) {
  problems.push(`_redirects has ${redirectRules} rules (limit 2,100)`);
}

// 5. wrangler.jsonc stays assets-only.
const wranglerPath = path.join(repo, "wrangler.jsonc");
if (!existsSync(wranglerPath)) problems.push("wrangler.jsonc is missing at the repository root");
else {
  // Whole-line `//` comments only; a URL inside a string must survive.
  const wrangler = JSON.parse(
    readFileSync(wranglerPath, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n"),
  );
  for (const key of ["main", "routes", "route", "cache", "site"]) {
    if (key in wrangler) problems.push(`wrangler.jsonc must not set "${key}"`);
  }
  if (wrangler.workers_dev !== false) problems.push('wrangler.jsonc must set "workers_dev": false');
  if (wrangler.assets?.run_worker_first !== undefined) {
    problems.push('wrangler.jsonc must not set "assets.run_worker_first"');
  }
  if (path.resolve(repo, wrangler.assets?.directory ?? "") !== out) {
    problems.push(`wrangler.jsonc assets.directory must be ${path.relative(repo, out)}`);
  }
}

// 6. Release identity.
if (release !== null) {
  const readJson = (name) => {
    try {
      return JSON.parse(readFileSync(path.join(out, name), "utf8"));
    } catch {
      problems.push(`out/${name} is missing or not JSON`);
      return null;
    }
  };
  if (readJson("version.json")?.commit !== release) {
    problems.push(`out/version.json does not name ${release}`);
  }
  const list = readJson("releases.json");
  if (list?.schema !== 2 || list.head !== release || list.releases?.[0] !== release) {
    problems.push(`out/releases.json does not start with ${release}`);
  }
  const manifest = readJson("release-assets.json");
  if (manifest?.releases?.[0]?.sha !== release) {
    problems.push(`out/release-assets.json does not start with ${release}`);
  }
  // releases.json holds each commit once; the manifest may hold two builds of
  // one commit (`<sha>` and `<sha>-local`).
  const manifestCommits = [...new Set((manifest?.releases ?? []).map((r) => String(r.sha).slice(0, 40)))];
  if (JSON.stringify(manifestCommits) !== JSON.stringify(list?.releases)) {
    problems.push("out/releases.json and out/release-assets.json name different commits");
  }
  for (const entry of manifest?.releases ?? []) {
    for (const file of entry.files ?? []) {
      const full = path.join(out, file.path);
      if (!existsSync(full)) problems.push(`release ${entry.sha} lists ${file.path}, not in out/`);
      else if (statSync(full).size !== file.size) {
        problems.push(`${file.path} is not the size release ${entry.sha} lists`);
      }
    }
  }
  const meta = /<meta name="build-sha" content="([^"]*)"/.exec(
    readFileSync(path.join(out, "index.html"), "utf8"),
  )?.[1];
  if (meta !== release) problems.push(`out/index.html build-sha is ${meta ?? "missing"}`);
}

if (problems.length > 0) {
  console.error(`check-web-export: ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `check-web-export: ${assets.length} files, largest out/${largest.name} ` +
    `(${(largest.size / 1024 / 1024).toFixed(2)} MiB), ${headerRules} _headers rules, ` +
    `${redirectRules} _redirects rules` +
    (release === null ? "" : `, release ${release}`),
);
