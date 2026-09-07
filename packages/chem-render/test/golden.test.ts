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

import { benzene, setBondStereo } from "@starter/chem-core";

import {
  acetate,
  butan2olWedged,
  cis2Butene,
  FIXTURES,
  naphthalene,
  trans2Butene,
  wedgeOnNonStereocentre,
} from "../src/fixtures.js";
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

  // The circle is a display FLAG, not a view kind, so the loop above never
  // reaches it. Two rings and one, because naphthalene's two circles have to
  // come out the same size and symmetric about the bond they share — which is
  // what an apothem-derived radius buys and a hand-picked one does not.
  for (const [name, molecule] of [
    ["benzene", benzene()],
    ["naphthalene", naphthalene()],
  ] as const) {
    it(`renders ${name} with aromatic circles instead of the alternation`, async () => {
      const svg = serializeScene(
        buildScene(
          molecule,
          RENDER_STYLES.publication,
          representation("skeletal", { aromaticCircles: true }),
        ),
      );
      await expectMatchesGolden(svg, `${name}-aromaticCircles-publication.svg`);
    });
  }

  // The stereo marks and the descriptors are FLAGS too, and the skeletal loop
  // above draws the marks but never the letters. Four molecules, because the
  // four things that can go wrong are different things: an apex at the wrong
  // end of a wedge, a Z read as an E, an E read as a Z, and a descriptor
  // printed beside a centre that has none.
  for (const [name, molecule] of [
    ["butan2olWedged", butan2olWedged()],
    ["cis2Butene", cis2Butene()],
    ["trans2Butene", trans2Butene()],
    ["wedgeOnNonStereocentre", wedgeOnNonStereocentre()],
  ] as const) {
    it(`renders ${name} with its stereo descriptors`, async () => {
      const svg = serializeScene(
        buildScene(
          molecule,
          RENDER_STYLES.publication,
          representation("skeletal", { showStereoDescriptors: true }),
        ),
      );
      await expectMatchesGolden(svg, `${name}-descriptors-publication.svg`);
    });
  }

  // Hash and wavy never appear in the skeletal loop either: no fixture stores
  // them, because a fixture that did would be a second copy of butan-2-ol
  // differing in one enum. Derived here instead, from the wedged fixture, so
  // the three marks are provably the same bond drawn three ways.
  for (const stereo of ["hash", "wavy"] as const) {
    it(`draws butan-2-ol's C2-O bond as a ${stereo}`, async () => {
      const svg = serializeScene(
        buildScene(
          setBondStereo(butan2olWedged(), "b7", stereo),
          RENDER_STYLES.publication,
          representation("skeletal"),
        ),
      );
      await expectMatchesGolden(svg, `butan2ol-${stereo}-publication.svg`);
    });
  }

  it("draws an either double bond as the crossed pair", async () => {
    // V2000 stereo code 3. The crossed pair is the only depiction that says
    // "this geometry was never determined"; a plain double bond drawn from the
    // same coordinates would assert the Z the atoms happen to sit at.
    const svg = serializeScene(
      buildScene(
        setBondStereo(cis2Butene(), "b3", "either"),
        RENDER_STYLES.publication,
        representation("skeletal"),
      ),
    );
    await expectMatchesGolden(svg, "cis2Butene-either-publication.svg");
  });

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
