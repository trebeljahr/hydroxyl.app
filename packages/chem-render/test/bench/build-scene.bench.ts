/**
 * How long it takes to turn a molecule into a scene.
 *
 * Run with `pnpm --filter @starter/chem-render run bench`. Deliberately NOT
 * part of `pnpm test`: a benchmark on shared CI hardware measures the noise of
 * the neighbours, and a suite that fails for that reason gets muted, taking
 * the real assertions with it.
 *
 * What this is watching for is a build pass that quietly stops being linear.
 * The small fixtures cannot show that — three atoms are fast whatever you do
 * to them — so the number that matters is the 300-heavy-atom one, reported on
 * its own below. chem-core learned this the hard way: assembling a structure
 * through `addAtom`/`addBond` in a loop is O(n^2), and a 20k-atom chain took
 * over four minutes before `MoleculeBuilder` existed. The equivalent mistake
 * here would be a bounds or id pass that rescans the primitive list per
 * primitive.
 *
 * The molecules are built once, outside the measured callbacks. Otherwise this
 * would be a benchmark of chem-core's builder with a renderer attached.
 */

import { bench, describe } from "vitest";

import { FIXTURES, heavyChain } from "../../src/fixtures.js";
import { representation } from "../../src/representation.js";
import { buildScene } from "../../src/scene/build.js";
import { PUBLICATION_STYLE, SCREEN_STYLE } from "../../src/style.js";
import { serializeScene } from "../../src/svg/serialize.js";

const SKELETAL = representation("skeletal");
const SUM_FORMULA = representation("sumFormula");

const HEAVY_ATOMS = 300;
const CHAIN = heavyChain(HEAVY_ATOMS);

describe("buildScene, small fixtures", () => {
  for (const fixture of FIXTURES) {
    const atoms = fixture.molecule.atomIds.length;
    bench(`${fixture.name} (${atoms} atoms, skeletal)`, () => {
      buildScene(fixture.molecule, PUBLICATION_STYLE, SKELETAL);
    });
  }
});

describe(`buildScene, ${HEAVY_ATOMS} heavy atoms`, () => {
  // Its own block so the reporter prints it as a separate group rather than
  // averaging it in with three-atom structures it has nothing in common with.
  bench(`heavyChain(${HEAVY_ATOMS}) skeletal`, () => {
    buildScene(CHAIN, SCREEN_STYLE, SKELETAL);
  });

  bench(`heavyChain(${HEAVY_ATOMS}) sumFormula`, () => {
    // The text path runs the whole molecule through valence and formula, so
    // it scales with atom count for entirely different reasons.
    buildScene(CHAIN, SCREEN_STYLE, SUM_FORMULA);
  });

  bench(`heavyChain(${HEAVY_ATOMS}) build + serialize`, () => {
    // The end-to-end number an export actually pays.
    serializeScene(buildScene(CHAIN, PUBLICATION_STYLE, SKELETAL));
  });
});
