/**
 * Golden SVG files: the committed, reviewable output of the whole pipeline.
 *
 * A golden is a diff you have to read on purpose. Change a coordinate, a
 * rounding rule or an attribute order and the change shows up as bytes in a
 * pull request rather than as nothing at all.
 *
 * Its known failure mode is that nobody looks at the picture. The bytes match,
 * the test is green, and the double bond has been on the wrong side since
 * whoever last blessed the snapshot. So every assertion here points at the
 * contact sheet, which is regenerated in `beforeAll` below and shows the same
 * fixtures rendered — if you are about to accept one of these diffs, the
 * rendered result is already on disk and one click away.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { acetate, FIXTURES } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { RENDER_STYLES } from "../src/style.js";
import type { RenderStyleName } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";
import { contactSheetUrl, writeContactSheet } from "./contact-sheet.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "__golden__");
const PRESETS: readonly RenderStyleName[] = Object.freeze([
  "publication",
  "screen",
]);

beforeAll(() => {
  // Refreshed here as well as by its own test, so the URL in a failure
  // message below never points at a sheet from a previous run. The write is
  // atomic and the content deterministic, so two workers doing it is fine.
  writeContactSheet();
});

/**
 * `toMatchFileSnapshot`, with the contact sheet stapled to the failure.
 *
 * The original error is rethrown rather than replaced: vitest attaches the
 * actual and expected strings to it and renders the diff from them, and a
 * freshly constructed Error would throw all of that away in exchange for a
 * URL.
 */
async function expectMatchesGolden(svg: string, file: string): Promise<void> {
  try {
    await expect(svg).toMatchFileSnapshot(join(GOLDEN_DIR, file));
  } catch (error) {
    if (error instanceof Error) {
      error.message = [
        error.message,
        "",
        `Golden: ${join(GOLDEN_DIR, file)}`,
        `Look at the picture before accepting this diff: ${contactSheetUrl()}`,
      ].join("\n");
    }
    throw error;
  }
}

describe("golden SVG", () => {
  for (const fixture of FIXTURES) {
    for (const preset of PRESETS) {
      it(`renders ${fixture.name} skeletal in the ${preset} style`, async () => {
        const svg = serializeScene(
          buildScene(
            fixture.molecule,
            RENDER_STYLES[preset],
            representation("skeletal"),
          ),
        );
        await expectMatchesGolden(svg, `${fixture.name}-skeletal-${preset}.svg`);
      });
    }
  }

  it("renders acetate's sum formula with its charge superscript", async () => {
    // The only golden covering a glyph run, and the only one where a charge
    // and a subscript share a text element — the two shifts have to cancel to
    // the right baseline, which is a thing to see rather than to reason about.
    const svg = serializeScene(
      buildScene(
        acetate(),
        RENDER_STYLES.publication,
        representation("sumFormula"),
      ),
    );
    await expectMatchesGolden(svg, "acetate-sumFormula-publication.svg");
  });
});
