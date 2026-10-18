/**
 * Writes `out/releases.json`, the list `ReleaseLifetime` reads, from the
 * `out/release-assets.json` that carry-static.mjs just wrote (decision 257).
 *
 *   node scripts/write-releases.mjs [out-dir]
 *
 * The list names exactly the commits whose hashed files this upload holds:
 * this build first, then each one carried. The carry manifest can name one
 * commit twice — a seed built on a laptop and CI's build of the same commit
 * differ in some chunk bytes, so both are carried — and may mark such a build
 * `<sha>-local`. A tab only knows its commit, so the list holds each commit
 * once. A tab whose release is missing
 * from it has lost its chunks, so `ReleaseLifetime` saves its sketch and
 * reloads. The shape is the one shared-assets.cjs served from the Coolify
 * release volume (schema 2), so a tab opened there reads this one unchanged.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A release id is a full commit SHA, optionally with a suffix naming the
// build (`<sha>-local`).
const RELEASE_ID = /^([a-f0-9]{40})(?:-[0-9A-Za-z._]+)?$/;
// ReleaseLifetime refuses a longer list as malformed (`shouldReload`).
const MAX_RELEASES = 6;

/** The schema-2 list for a carry manifest; throws on anything unexpected. */
export function releasesFromManifest(manifest) {
  if (manifest?.schema !== 1 || !Array.isArray(manifest.releases)) {
    throw new Error("release-assets.json is not a schema 1 carry manifest");
  }
  const commits = manifest.releases.map((release) => {
    const id = release?.sha;
    const commit = typeof id === "string" ? RELEASE_ID.exec(id)?.[1] : undefined;
    if (commit === undefined) {
      throw new Error(`release-assets.json names ${String(id)}, not a full commit SHA`);
    }
    return commit;
  });
  const releases = [...new Set(commits)];
  if (releases.length === 0 || releases.length > MAX_RELEASES) {
    throw new Error(`release-assets.json lists ${releases.length} commits (1–${MAX_RELEASES})`);
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
