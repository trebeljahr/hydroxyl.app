/**
 * The dev preflight's two statements: what heap `next dev` will get, and that
 * snapshots from an earlier near-limit run are waiting to be read.
 *
 * The rule under test is Next's, not ours — `next/dist/cli/next-dev.js` gives
 * its server half of physical memory unless NODE_OPTIONS already names a
 * `--max-old-space-size`. It is pinned here because the crash in manual notes
 * 3 came at exactly the 2048 MB a shell-wide NODE_OPTIONS set, and a preflight
 * that misread the cap would send the next investigation the wrong way.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SNAPSHOT_DIR, heapBudget, preflightNotices } from "../scripts/dev-preflight.mjs";

const GB = 1024 ** 3;
const NONE = { count: 0, bytes: 0 };

describe("the heap next dev will get", () => {
  it("is half of physical memory when NODE_OPTIONS says nothing", () => {
    expect(heapBudget({ nodeOptions: undefined, totalMemBytes: 24 * GB })).toEqual({
      capMb: 12288,
      nextDefaultMb: 12288,
      lowered: false,
    });
  });

  it("is the NODE_OPTIONS cap when one is set, and says it is lower", () => {
    const budget = heapBudget({
      nodeOptions: "--max-old-space-size=2048",
      totalMemBytes: 24 * GB,
    });
    expect(budget).toEqual({ capMb: 2048, nextDefaultMb: 12288, lowered: true });
  });

  it("reads the underscore spelling and lets the last flag win, as Node does", () => {
    const budget = heapBudget({
      nodeOptions: "--max_old_space_size=1024 --inspect --max-old-space-size=4096",
      totalMemBytes: 24 * GB,
    });
    expect(budget.capMb).toBe(4096);
  });

  it("does not call a cap above the default a lowering", () => {
    const budget = heapBudget({
      nodeOptions: "--max-old-space-size=16384",
      totalMemBytes: 24 * GB,
    });
    expect(budget.lowered).toBe(false);
  });
});

describe("what the preflight prints", () => {
  it("prints nothing for an uncapped setup with no snapshots", () => {
    const budget = heapBudget({ nodeOptions: "", totalMemBytes: 24 * GB });
    expect(preflightNotices(budget, NONE)).toEqual([]);
  });

  it("names the cap, Next's default and where a snapshot will land", () => {
    const budget = heapBudget({
      nodeOptions: "--max-old-space-size=2048",
      totalMemBytes: 24 * GB,
    });
    const [line, ...rest] = preflightNotices(budget, NONE);
    expect(rest).toEqual([]);
    expect(line).toContain("2048 MB");
    expect(line).toContain("12288 MB");
    expect(line).toContain(`packages/client/${SNAPSHOT_DIR}/`);
  });

  it("points at snapshots left by an earlier run", () => {
    const budget = heapBudget({ nodeOptions: "", totalMemBytes: 24 * GB });
    const [line] = preflightNotices(budget, { count: 2, bytes: 3.2 * GB });
    expect(line).toContain("2 heap snapshot(s)");
    expect(line).toContain("3.2 GB");
  });
});

describe("the dev script", () => {
  const pkg = JSON.parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
      "utf8",
    ),
  ) as { scripts: Record<string, string> };

  it("runs the preflight before the server", () => {
    expect(pkg.scripts.dev).toMatch(/^node scripts\/dev-preflight\.mjs && /);
  });

  it("arms the snapshot into the directory the preflight creates", () => {
    // Appended to the caller's NODE_OPTIONS, not replacing it: a cap or an
    // --inspect the caller set must still reach `next dev`.
    expect(pkg.scripts.dev).toContain(
      `NODE_OPTIONS="$NODE_OPTIONS --heapsnapshot-near-heap-limit=1 --diagnostic-dir=${SNAPSHOT_DIR}"`,
    );
  });
});
