/**
 * The projection harness's pictures (decision 190): one golden SVG per built
 * row of chem-core's matrix, and the one page that shows them all.
 *
 * PIXELS ONLY. Whether a layout states the right configuration is asserted
 * in chem-core's test/harness, in other files, so a hexagon-aspect tweak here
 * reads as a picture change and never as a stereochemistry regression; and a
 * stereochemistry regression there fails there, whatever the pictures do.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  descriptorCaption,
  goldenName,
  projectionSheetPath,
  projectionSheetUrl,
  projectionSvg,
  readMatrix,
  writeProjectionSheet,
} from "./projection-sheet.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "__golden__", "projection");

const path = writeProjectionSheet();
const html = readFileSync(path, "utf8");
const BUILT = readMatrix().rows.filter((row) => row.status === "built");

afterAll(() => {
  process.stdout.write(`\nprojection contact sheet: ${projectionSheetUrl()}\n`);
});

describe("the projection contact sheet", () => {
  it("is one page with a cell for every built row of the matrix, captioned with its descriptors", () => {
    expect(path).toBe(projectionSheetPath());
    expect(BUILT.length).toBeGreaterThan(120);
    expect(html.split('class="cell"').length - 1).toBe(BUILT.length);
    for (const row of BUILT) expect(html).toContain(descriptorCaption(row));
    // Every template built today appears, and the steroid panel prints alpha/beta.
    for (const template of ["planar/wedgeDash", "planar/mills", "planar/steroid", "chain/fischer"]) {
      expect(html).toContain(`<span class="template">${template}</span>`);
    }
    expect(html).toMatch(/id="atom:a\d+:alphaBeta"/);
    expect(html).toMatch(/id="atom:a\d+:descriptor"/);
  });

  it("lists what is owed and what is refused under each fixture instead of leaving it out", () => {
    expect(html).toContain("<code>sightedBond/newman</code> owed: template not built yet");
    expect(html).toContain("<code>ring/haworth</code> owed: template not built yet");
    expect(html).toContain("<code>planar/mills</code> refused: bridged-ring-system");
  });

  it("is self-contained", () => {
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).not.toContain("<?xml");
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

describe("projection goldens", () => {
  for (const row of BUILT) {
    it(`${row.fixture} as ${row.template}`, async () => {
      const file = join(GOLDEN_DIR, goldenName(row));
      try {
        await expect(projectionSvg(row)).toMatchFileSnapshot(file);
      } catch (error) {
        if (error instanceof Error) {
          error.message = [error.message, "", `Golden: ${file}`, `Look at the picture before accepting this diff: ${projectionSheetUrl()}`].join("\n");
        }
        throw error;
      }
    });
  }
});
