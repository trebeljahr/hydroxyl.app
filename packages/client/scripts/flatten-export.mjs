/**
 * Moves every page the static export wrote below `out/` to `out/` itself,
 * under its path joined with hyphens (decision 137).
 *
 * `assetPrefix: "./"` makes every asset URL relative to the DOCUMENT, so a
 * page only runs at the depth its prefix was written for, which is the export
 * root. Next writes `/guides/journal-figure-size` to
 * `out/guides/journal-figure-size.html`, where `./_next/…` resolves into
 * `out/guides/_next/`: a directory with no assets, so the stylesheet and every
 * chunk 404. Moved to `out/guides-journal-figure-size.html`, the same bytes
 * sit where they were written to sit. See the trailingSlash comment in
 * next.config.ts for the one-level case, and check-export.mjs for the rule
 * this keeps.
 *
 * Only the `.html` moves. The flight data Next leaves beside it is what
 * `next/link` would fetch on a client-side navigation, and this app links
 * with plain anchors (see `@/lib/deployment`), so nothing asks for it.
 *
 * The web build keeps the nested URL. This runs after every `next build` and
 * does nothing unless NEXT_FILE_EXPORT=1.
 */

import { existsSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `guides/journal-figure-size.html` → `guides-journal-figure-size.html`. */
export function flatName(relativePath) {
  return relativePath.split(/[\\/]/).join("-");
}

/** Every `.html` below the root, as paths relative to it. `_next/` is Next's
 *  own asset tree and holds no documents. */
function nestedPages(root, dir = root) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "_next") found.push(...nestedPages(root, full));
    } else if (entry.name.endsWith(".html") && dir !== root) {
      found.push(path.relative(root, full));
    }
  }
  return found;
}

/**
 * Moves the pages and returns what moved, as `[from, to]` pairs. Throws
 * without moving anything if a flat name is already taken: `/guides-x` and
 * `/guides/x` would both claim `guides-x.html`, and overwriting one of them
 * would ship a page that silently shows the other.
 */
export function flattenExport(root) {
  const moves = nestedPages(root).map((from) => [from, flatName(from)]);
  const taken = moves.filter(
    ([, to], i) => existsSync(path.join(root, to)) || moves.findIndex(([, t]) => t === to) !== i,
  );
  if (taken.length > 0) {
    throw new Error(
      `flatten-export: these pages would overwrite another page at the export root:\n  ` +
        taken.map(([from, to]) => `${from} → ${to}`).join("\n  "),
    );
  }
  for (const [from, to] of moves) renameSync(path.join(root, from), path.join(root, to));
  return moves;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NEXT_FILE_EXPORT === "1") {
    const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
    for (const [from, to] of flattenExport(out)) console.log(`static export: ${from} → ${to}`);
  }
}
