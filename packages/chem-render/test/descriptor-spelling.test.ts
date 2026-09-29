/**
 * A descriptor on the figure is spelled by chem-core's `descriptorText`, and
 * only its LETTER passes through the italic hook (decision 192).
 *
 * The canvas used to re-type chem-core's `(${kind})` so that it could route
 * the letter through `italic()`, which printed the same bytes today and would
 * have kept printing them the day chem-core spelled a descriptor differently.
 * Here chem-core's spelling is swapped for one it does not use, and the
 * figure must follow it: a regression reads as the figure and chem-core's
 * text surfaces disagreeing about what (R)-butan-2-ol is called.
 */

import { describe, expect, it, vi } from "vitest";

import { cipDescriptor, doubleBondDescriptor } from "@starter/chem-core";

import { butan2olWedged, trans2Butene } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { TextRunPrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE } from "../src/style.js";

vi.mock("@starter/chem-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@starter/chem-core")>();
  return {
    ...actual,
    // A spelling chem-core does not use: square brackets and a star.
    descriptorText: (descriptor: Parameters<typeof actual.descriptorText>[0]) => {
      const text = actual.descriptorText(descriptor);
      return text === undefined ? undefined : `[${text.slice(1, -1)}]*`;
    },
  };
});

function descriptorRuns(mol: Parameters<typeof buildScene>[0]): string[] {
  const scene = buildScene(mol, PUBLICATION_STYLE, representation("skeletal", { showStereoDescriptors: true }));
  return scene.primitives
    .filter((p): p is TextRunPrimitive => p.type === "textRun" && p.id.endsWith(":descriptor"))
    .map((run) => run.spans.map((span) => span.text).join(""));
}

describe("a descriptor prints as chem-core spells it", () => {
  it("takes (R)-butan-2-ol's wrapper from chem-core, the letter through the italic hook", () => {
    const butanol = butan2olWedged();
    // Letters first, or the assertion below holds of a figure with none.
    expect(butanol.atomIds.map((id) => cipDescriptor(butanol, id)?.kind)).toContain("R");
    expect(descriptorRuns(butanol)).toEqual(["[R]*"]);
  });

  it("takes (E)-but-2-ene's too", () => {
    const butene = trans2Butene();
    expect(butene.bondIds.map((id) => doubleBondDescriptor(butene, id)?.kind)).toContain("E");
    expect(descriptorRuns(butene)).toEqual(["[E]*"]);
  });
});
