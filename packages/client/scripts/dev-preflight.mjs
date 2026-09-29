/**
 * Before `next dev`: make an out-of-memory crash leave evidence behind.
 *
 * THE CRASH IN MANUAL NOTES 3 left none. The dev server died with "JavaScript
 * heap out of memory" at ~2 GB, 203 s after starting, and the stack at the
 * moment of death only shows the allocation that tipped it over, not what was
 * holding the other 2 GB. Re-measured on 2026-09-29 (Node 24.14.1 and 26.8.1,
 * a forced collection before every sample), nothing reproduced the climb: the
 * retained heap stayed under 100 MB with 446,000 files of cloned worktrees
 * inside the Turbopack root, with ~290,000 file events churning through them,
 * across 45 hot updates, and with a hydration error forwarded on every load.
 * So the watch scope is NOT the driver it was taken for (decision 93), and the
 * cause is still unknown.
 *
 * Hence two things here, neither of which hides a leak:
 *
 * - `dev` runs Node with `--heapsnapshot-near-heap-limit=1`, so the next time
 *   the heap fills, V8 writes a snapshot into `.next/heap-snapshots/` first.
 *   Loaded in Chrome DevTools › Memory, its retainers name the culprit. This
 *   script creates that directory, because Node does not.
 * - It says so when NODE_OPTIONS caps the heap below Next's own default.
 *   `next dev` gives its server half of physical memory unless NODE_OPTIONS
 *   already sets `--max-old-space-size`, and a shell-wide 2048 is why the
 *   crash came at 2 GB rather than at 12 GB. Raising it is deliberately NOT
 *   done here: nothing measured plateaus between the two, and a bigger heap
 *   would only make an unexplained climb take longer to crash.
 */

import { mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(here, "..");

/** Relative to `packages/client`, as the `dev` script passes it to Node. */
export const SNAPSHOT_DIR = path.join(".next", "heap-snapshots");

/**
 * The heap `next dev` will give its server, and whether NODE_OPTIONS lowered
 * it. Mirrors `next/dist/cli/next-dev.js`: an explicit `--max-old-space-size`
 * (either spelling) wins, otherwise half of physical memory, in MB.
 *
 * @param {{ nodeOptions: string | undefined, totalMemBytes: number }} input
 * @returns {{ capMb: number, nextDefaultMb: number, lowered: boolean }}
 */
export function heapBudget({ nodeOptions, totalMemBytes }) {
  const nextDefaultMb = Math.floor(Math.floor(totalMemBytes / 1024 / 1024) * 0.5);
  const matches = [...(nodeOptions ?? "").matchAll(/--max[-_]old[-_]space[-_]size[= ](\d+)/g)];
  const last = matches.at(-1);
  if (last === undefined) return { capMb: nextDefaultMb, nextDefaultMb, lowered: false };
  const capMb = Number(last[1]);
  return { capMb, nextDefaultMb, lowered: capMb < nextDefaultMb };
}

/**
 * The lines to print. Empty when there is nothing worth saying, so a default
 * setup starts as quietly as before.
 *
 * @param {{ capMb: number, nextDefaultMb: number, lowered: boolean }} budget
 * @param {{ count: number, bytes: number }} snapshots  left by earlier runs
 * @returns {string[]}
 */
export function preflightNotices(budget, snapshots) {
  const where = `packages/client/${SNAPSHOT_DIR}/`;
  const notices = [];
  if (budget.lowered) {
    notices.push(
      `dev: NODE_OPTIONS limits the dev server to a ${budget.capMb} MB heap ` +
        `(Next.js would use ${budget.nextDefaultMb} MB on this machine). ` +
        `If it runs out, a heap snapshot is written to ${where} first.`,
    );
  }
  if (snapshots.count > 0) {
    const gb = (snapshots.bytes / 1024 ** 3).toFixed(1);
    notices.push(
      `dev: ${snapshots.count} heap snapshot(s) are in ${where} (${gb} GB), ` +
        `written when a dev server neared its heap limit. Load one in Chrome ` +
        `DevTools › Memory to see what filled the heap, then delete them.`,
    );
  }
  return notices;
}

function existingSnapshots(dir) {
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".heapsnapshot")) continue;
    count += 1;
    bytes += statSync(path.join(dir, name)).size;
  }
  return { count, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(clientRoot, SNAPSHOT_DIR);
  mkdirSync(dir, { recursive: true });
  const budget = heapBudget({
    nodeOptions: process.env.NODE_OPTIONS,
    totalMemBytes: os.totalmem(),
  });
  for (const line of preflightNotices(budget, existingSnapshots(dir))) console.warn(line);
}
