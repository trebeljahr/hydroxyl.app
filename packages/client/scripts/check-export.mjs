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
 *   4. The social card rides the same `public/` copy: `out/` holds a 1200×630
 *      PNG, and the two landing pages point `og:image` and `twitter:image`
 *      at it on that domain (decision 138). `e2e/social-metadata.spec.ts`
 *      checks the standalone side.
 *   5. Guides (decisions 243–245). The index is `guides.html`, each guide
 *      `guides-<slug>.html`. A guide page is released exactly when it carries
 *      no `noindex` robots tag, and the sitemap lists exactly the released
 *      ones, plus the index once any is. Every guide page points `og:image`
 *      at its own 1200×630 card, `social-cards/<slug>.png`. Read from the
 *      exported pages rather than from `guides.ts`, so the check holds the
 *      files to each other and needs no TypeScript.
 *   6. No analytics (decisions 136 and 170). No file in `out/` carries the
 *      pageview script, and when the build was given Plausible settings — CI
 *      passes some on purpose, so this is not vacuous — none names their
 *      host either. `e2e/analytics.spec.ts` checks the standalone side.
 *
 * A route below the root, such as `/guides/journal-figure-size`, reaches the
 * root through `flatten-export.mjs` (decision 137), which `build` runs after
 * `next build`. Its flat page is checked for by name, so a build that skipped
 * the move fails on the missing page as well as on the nested one.
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

for (const page of [
  "index.html",
  "editor.html",
  "about.html",
  "guides.html",
  "guides-journal-figure-size.html",
  "guides-glycine-zwitterion.html",
]) {
  try {
    statSync(path.join(out, page));
  } catch {
    problems.push(`out/${page} is missing from the static export`);
  }
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

/** True when the page asks crawlers to stay away: an unreleased guide, or
 *  the guides index while no guide is released (decision 243). */
function isNoindex(html) {
  return /<meta name="robots" content="[^"]*noindex/.test(html);
}

// The guide pages the export holds, and which of them are released.
const outRoot = readdirSync(out);
const guidePages = outRoot.filter((f) => /^guides-.+\.html$/.test(f)).sort();
const releasedGuidePages = guidePages.filter((f) => {
  const html = readOut(f);
  return html !== null && !isNoindex(html);
});
const guidesIndex = readOut("guides.html");
if (guidesIndex !== null && isNoindex(guidesIndex) !== (releasedGuidePages.length === 0)) {
  problems.push(
    `out/guides.html is ${isNoindex(guidesIndex) ? "noindex" : "indexable"} while ` +
      `${releasedGuidePages.length} guide(s) are released; it should be indexable exactly when one is`,
  );
}

const sitemap = readOut("sitemap.xml");
if (sitemap !== null) {
  const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const guideEntries =
    releasedGuidePages.length === 0 ? [] : ["guides.html", ...releasedGuidePages];
  const expected = [site, `${site}about.html`, ...guideEntries.map((f) => `${site}${f}`)];
  // The guides' order is the index's (newest first), which only guides.ts
  // knows; the set is what the pages decide.
  const sorted = (urls) => [...urls.slice(0, 2), ...urls.slice(2).sort()];
  if (JSON.stringify(sorted(listed)) !== JSON.stringify(sorted(expected))) {
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

const card = (() => {
  try {
    return readFileSync(path.join(out, "social-card.png"));
  } catch {
    return null;
  }
})();
if (card === null) {
  problems.push("out/social-card.png is missing; see scripts/build-social-card.mjs");
} else {
  // The PNG signature, then IHDR: width and height are the first two fields.
  const isPng = card.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const size = isPng ? `${card.readUInt32BE(16)}×${card.readUInt32BE(20)}` : "not a PNG";
  if (size !== "1200×630") problems.push(`out/social-card.png is ${size}, not 1200×630`);
}

const cardUrl = `${site}social-card.png`;
for (const page of ["index.html", "about.html"]) {
  const html = readOut(page);
  if (html === null) continue;
  for (const key of ['property="og:image"', 'name="twitter:image"']) {
    const content = new RegExp(`<meta ${key} content="([^"]*)"`).exec(html)?.[1];
    if (content !== cardUrl) {
      problems.push(`out/${page}: ${key} is ${content ?? "missing"}, expected ${cardUrl}`);
    }
  }
}

// One card per guide, named by its slug, released or not (decision 245).
for (const page of guidePages) {
  const slug = page.slice("guides-".length, -".html".length);
  const cardFile = `social-cards/${slug}.png`;
  try {
    const png = readFileSync(path.join(out, cardFile));
    const isPng = png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const size = isPng ? `${png.readUInt32BE(16)}×${png.readUInt32BE(20)}` : "not a PNG";
    if (size !== "1200×630") problems.push(`out/${cardFile} is ${size}, not 1200×630`);
  } catch {
    problems.push(`out/${cardFile} is missing; see scripts/build-social-card.mjs`);
  }
  const html = readOut(page);
  if (html === null) continue;
  for (const key of ['property="og:image"', 'name="twitter:image"']) {
    const content = new RegExp(`<meta ${key} content="([^"]*)"`).exec(html)?.[1];
    if (content !== `${site}${cardFile}`) {
      problems.push(`out/${page}: ${key} is ${content ?? "missing"}, expected ${site}${cardFile}`);
    }
  }
}

const robots = readOut("robots.txt");
if (robots !== null) {
  for (const line of ["Disallow: /editor", `Sitemap: ${site}sitemap.xml`]) {
    if (!robots.split("\n").includes(line)) problems.push(`out/robots.txt has no "${line}" line`);
  }
}

// Every file, not only the HTML: the RSC payloads (`*.txt`) and the chunks
// under `_next/` would carry the script too if a client component rendered it.
// The id is `PAGEVIEW_SCRIPT_ID` in src/lib/analytics.ts.
function allFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });
}
const plausibleUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL?.trim();
const analyticsMarkers = ["plausible-pageview"];
if (plausibleUrl) analyticsMarkers.push(new URL(plausibleUrl).host);
for (const file of allFiles(out)) {
  if (/\.(wasm|png)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const marker of analyticsMarkers.filter((m) => text.includes(m))) {
    problems.push(`out/${path.relative(out, file)} contains "${marker}"; the export sends no analytics`);
  }
}

if (problems.length > 0) {
  console.error(`static export check failed:\n\n${problems.join("\n\n")}\n`);
  process.exit(1);
}
console.log(
  "static export: every page at the root, the guides flattened, RDKit assets and notice present, " +
    `sitemap.xml, robots.txt and the social cards name ${site}, ` +
    `${releasedGuidePages.length} of ${guidePages.length} guides released, and no analytics ` +
    (plausibleUrl ? `(built with Plausible settings for ${new URL(plausibleUrl).host})` : "(built without Plausible settings)"),
);
