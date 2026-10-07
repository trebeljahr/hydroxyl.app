/**
 * The precache list `build-service-worker.mjs` bakes into `public/sw.js`
 * (decision 239), against a scratch tree rather than a real build.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { precacheList } from "../scripts/build-service-worker.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("precacheList", () => {
  it("lists every file under .next/static as the URL path Next serves it at", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sw-precache-"));
    roots.push(root);
    mkdirSync(path.join(root, "chunks"), { recursive: true });
    mkdirSync(path.join(root, "BUILD_ID_x"), { recursive: true });
    writeFileSync(path.join(root, "chunks", "b.js"), "");
    writeFileSync(path.join(root, "chunks", "a.css"), "");
    writeFileSync(path.join(root, "BUILD_ID_x", "_buildManifest.js"), "");
    expect(precacheList(root)).toEqual([
      "/_next/static/BUILD_ID_x/_buildManifest.js",
      "/_next/static/chunks/a.css",
      "/_next/static/chunks/b.js",
    ]);
  });
});
