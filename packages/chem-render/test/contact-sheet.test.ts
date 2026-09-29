/**
 * Regenerates the contact sheet as part of the ordinary test run.
 *
 * Deliberately a test rather than a script: a review aid that has to be
 * remembered is a review aid that goes stale, and a stale sheet is worse than
 * none — it shows a picture that is no longer what the code produces, which is
 * precisely the mistake the goldens already invite.
 *
 * The assertions are shallow on purpose. Correctness of the rendering is the
 * goldens' job; this file only proves the page was written, is self-contained,
 * and covers the full matrix.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { FIXTURES, MECHANISM_FIXTURES } from "../src/fixtures.js";
import { VIEW_KINDS } from "../src/representation.js";

import {
  ANNOTATED_SECTION_NAME,
  contactSheetPath,
  MECHANISM_SECTION_PREFIX,
  contactSheetUrl,
  writeContactSheet,
} from "./contact-sheet.js";

const path = writeContactSheet();
const html = readFileSync(path, "utf8");

afterAll(() => {
  // Printed at the end of the run so it is one click away in any terminal
  // that linkifies file URLs.
  //
  // `process.stdout.write` rather than `console.log`: vitest's default
  // reporter captures console output and only replays it for failing tests,
  // so a `console.log` here would be swallowed on exactly the green run where
  // someone wants the link.
  process.stdout.write(`\ncontact sheet: ${contactSheetUrl()}\n`);
});

describe("contact sheet", () => {
  it("is written where it says it is", () => {
    expect(path).toBe(contactSheetPath());
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(1000);
  });

  it("covers every fixture in every representation in both presets", () => {
    for (const fixture of FIXTURES) {
      expect(html).toContain(`<h2>${fixture.name}</h2>`);
    }
    for (const kind of VIEW_KINDS) {
      // One row per kind per fixture, plus two extra `skeletal` rows for the
      // display FLAGS — the aromatic circle and the stereo descriptors. A flag
      // is not a kind and would be invisible on the sheet otherwise, which is
      // where a circle at the wrong radius or a descriptor sitting on a bond
      // would go unnoticed forever.
      //
      // The fused-ring annotation section adds two more skeletal rows of its
      // own: the bare steroid, and the steroid with descriptors and locants.
      // Each mechanism section adds a skeletal row and a Lewis row.
      const rows = html.split(`class="kind">${kind}`).length - 1;
      expect(rows, kind).toBe(
        FIXTURES.length * (kind === "skeletal" ? 3 : 1) +
          (kind === "skeletal" ? 2 : 0) +
          (kind === "skeletal" || kind === "lewis" ? MECHANISM_FIXTURES.length : 0),
      );
    }
    expect(html).toContain("<em>kekule alternation</em>");
    expect(html).toContain("<em>stereo descriptors</em>");
    const cells = html.split('class="cell"').length - 1;
    expect(cells).toBe(
      FIXTURES.length * (VIEW_KINDS.length + 2) * 2 + 2 * 2 + MECHANISM_FIXTURES.length * 2 * 2,
    );
  });

  it("carries the fused-ring annotation section, locants drawn", () => {
    expect(html).toContain(`<h2>${ANNOTATED_SECTION_NAME}</h2>`);
    expect(html).toContain("<em>stereo descriptors + locants</em>");
    expect(html).toMatch(/id="atom:a\d+:locant"/);
  });

  it("carries a section per mechanism, its curly arrows drawn as shaft and head", () => {
    for (const fixture of MECHANISM_FIXTURES) {
      expect(html).toContain(`<h2>${MECHANISM_SECTION_PREFIX}${fixture.name}</h2>`);
      for (const arrow of fixture.annotations) {
        expect(html).toContain(`id="annotation:${arrow.id}:shaft"`);
        expect(html).toContain(`id="annotation:${arrow.id}:head"`);
      }
    }
    expect(html).toContain("<em>curly arrows from the drawn lone pairs</em>");
  });

  it("embeds the SVG rather than linking it", () => {
    // It has to be legible opened straight off the filesystem, on a machine
    // with no dev server and no network. An <img src="..."> or a CDN
    // stylesheet would break exactly when someone needs the sheet most.
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).not.toContain("<?xml");
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("says why a cell is empty rather than leaving it empty", () => {
    // Benzene has no condensed formula, and a panel that silently exported a
    // blank cell for it is exactly what `representationAvailability` exists
    // to prevent. The sheet is where that gets seen.
    expect(html).toContain("A ring has no condensed formula");
    expect(html).toContain(">unavailable<");
  });

  it("labels each cell with what it is showing", () => {
    expect(html).toContain("primitives");
    expect(html).toMatch(/\d+(\.\d+)? &times; \d+(\.\d+)? px/);
    expect(html).toContain(">publication<");
    expect(html).toContain(">screen<");
  });
});
