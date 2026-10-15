/**
 * Writes `out/releases.json`, the list `ReleaseLifetime` reads, from the
 * `out/release-assets.json` that carry-static.mjs just wrote (decision 257).
 *
 *   node scripts/write-releases.mjs [out-dir]
 *
 * The list names exactly the releases whose hashed files this upload holds:
 * this build first, then each one carried. A tab whose release is missing
 * from it has lost its chunks, so `ReleaseLifetime` saves its sketch and
 * reloads. The shape is the one shared-assets.cjs served from the Coolify
 * release volume (schema 2), so a tab opened there reads this one unchanged.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = /^[a-f0-9]{40}$/;
// ReleaseLifetime refuses a longer list as malformed (`shouldReload`).
const MAX_RELEASES = 6;

/** The schema-2 list for a carry manifest; throws on anything unexpected. */
export function releasesFromManifest(manifest) {
  if (manifest?.schema !== 1 || !Array.isArray(manifest.releases)) {
    throw new Error("release-assets.json is not a schema 1 carry manifest");
  }
  const releases = manifest.releases.map((release) => release?.sha);
  if (releases.length === 0 || releases.length > MAX_RELEASES) {
    throw new Error(`release-assets.json lists ${releases.length} releases (1–${MAX_RELEASES})`);
  }
  for (const sha of releases) {
    if (typeof sha !== "string" || !COMMIT.test(sha)) {
      throw new Error(`release-assets.json names ${String(sha)}, not a full commit SHA`);
    }
  }
  if (new Set(releases).size !== releases.length) {
    throw new Error("release-assets.json names one release twice");
  }
  return { schema: 2, head: releases[0], window: releases, releases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out =
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
  const manifest = JSON.parse(readFileSync(path.join(out, "release-assets.json"), "utf8"));
  const list = releasesFromManifest(manifest);
  writeFileSync(path.join(out, "releases.json"), `${JSON.stringify(list)}\n`);
  console.log(`releases.json: ${list.releases.join(", ")}`);
}
