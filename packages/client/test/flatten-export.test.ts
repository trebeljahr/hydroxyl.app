/**
 * The export's post-build move (decision 137): a page Next writes below `out/`
 * ends up at `out/` itself, because under `assetPrefix: "./"` that is the
 * only depth its `./_next/` URLs resolve at. Run against a scratch tree, not
 * a real export, so the rules are visible without a ten-second build.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { flatName, flattenExport } from "../scripts/flatten-export.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function exportTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "flatten-export-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  return root;
}

describe("flatName", () => {
  it("joins the page's path with hyphens", () => {
    expect(flatName("guides/journal-figure-size.html")).toBe("guides-journal-figure-size.html");
    expect(flatName(path.join("a", "b", "c.html"))).toBe("a-b-c.html");
  });
});

describe("flattenExport", () => {
  it("moves a nested page to the root with its bytes unchanged", () => {
    const root = exportTree({
      "index.html": "home",
      "about.html": "about",
      "guides/journal-figure-size.html": '<link href="./_next/static/a.css">',
      "guides/journal-figure-size.txt": "flight data",
    });
    expect(flattenExport(root)).toEqual([
      [path.join("guides", "journal-figure-size.html"), "guides-journal-figure-size.html"],
    ]);
    expect(readFileSync(path.join(root, "guides-journal-figure-size.html"), "utf8")).toBe(
      '<link href="./_next/static/a.css">',
    );
    expect(existsSync(path.join(root, "guides", "journal-figure-size.html"))).toBe(false);
    // Only documents move; nothing on the page asks for the flight data.
    expect(existsSync(path.join(root, "guides", "journal-figure-size.txt"))).toBe(true);
  });

  it("leaves root pages and Next's own asset tree alone", () => {
    const root = exportTree({
      "index.html": "home",
      "_next/static/chunks/x.html": "not a page",
    });
    expect(flattenExport(root)).toEqual([]);
    expect(existsSync(path.join(root, "_next", "static", "chunks", "x.html"))).toBe(true);
  });

  it("refuses, and moves nothing, when a flat name is already a page", () => {
    // `/guides-x` and `/guides/x` would both claim guides-x.html.
    const root = exportTree({
      "guides-x.html": "the flat route",
      "guides/x.html": "the nested route",
      "guides/y.html": "an innocent bystander",
    });
    expect(() => flattenExport(root)).toThrow(/guides.x\.html → guides-x\.html/);
    expect(readFileSync(path.join(root, "guides-x.html"), "utf8")).toBe("the flat route");
    expect(existsSync(path.join(root, "guides", "y.html"))).toBe(true);
    expect(existsSync(path.join(root, "guides-y.html"))).toBe(false);
  });
});
