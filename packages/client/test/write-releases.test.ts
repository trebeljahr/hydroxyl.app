/**
 * The list `ReleaseLifetime` reads on the hosted site (decision 257) is
 * derived from the chunk carry's manifest, so a tab reloads exactly when its
 * release's chunks left the upload. Held against `shouldReload` itself, so the
 * two ends of the contract cannot drift apart.
 */

import { describe, expect, it } from "vitest";

import { shouldReload } from "@/components/ReleaseLifetime";

import { releasesFromManifest } from "../scripts/write-releases.mjs";

const NEW = "a".repeat(40);
const OLD = "b".repeat(40);
const GONE = "c".repeat(40);

const manifest = (...shas: string[]) => ({
  schema: 1,
  releases: shas.map((sha) => ({ sha, files: [] })),
});

describe("releasesFromManifest", () => {
  it("lists this build first, then each carried release", () => {
    expect(releasesFromManifest(manifest(NEW, OLD))).toEqual({
      schema: 2,
      head: NEW,
      window: [NEW, OLD],
      releases: [NEW, OLD],
    });
  });

  it("keeps a carried tab open and reloads one whose chunks were dropped", () => {
    const list = releasesFromManifest(manifest(NEW, OLD));
    expect(shouldReload(OLD, list)).toBe(false);
    expect(shouldReload(NEW, list)).toBe(false);
    expect(shouldReload(GONE, list)).toBe(true);
  });

  it("refuses what ReleaseLifetime would read as malformed", () => {
    expect(() => releasesFromManifest({ schema: 2, releases: [] })).toThrow(/schema 1/);
    expect(() => releasesFromManifest(manifest())).toThrow(/0 releases/);
    expect(() => releasesFromManifest(manifest(...Array.from({ length: 7 }, (_, i) => String(i).repeat(40))))).toThrow(
      /7 releases/,
    );
    expect(() => releasesFromManifest(manifest("abc1234"))).toThrow(/full commit SHA/);
    expect(() => releasesFromManifest(manifest(NEW, NEW))).toThrow(/twice/);
  });
});
