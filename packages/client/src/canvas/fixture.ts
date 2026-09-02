/**
 * The document the editor opens with until there is a real one to open.
 *
 * WHY BENZENE, and not an empty document or a synthetic three-atom graph:
 *
 * - It is the molecule the whole geometry model is calibrated against.
 *   chem-core builds it from `carbocycle` at a unit bond length, so every
 *   coordinate in the scene is a round number of bond lengths from the origin
 *   and anything wrong with the model-to-px scale or the y-flip shows up as a
 *   ring that is visibly not a regular hexagon.
 * - Six atoms and six bonds makes the expected node count trivially checkable:
 *   an e2e assertion can say "exactly 6 elements with a data-atom-id" without
 *   first parsing the molecule.
 * - It is a REAL molecule, so a regression reads as a chemistry error rather
 *   than a graph error — the house rule for chem-core fixtures, and it applies
 *   just as well to what the canvas draws.
 *
 * `screen` rather than `publication` because this is the editing surface: the
 * screen preset's 44px bond exists so a line is a comfortable mouse target,
 * not merely legible at figure size.
 *
 * Note that benzene arrives as an explicit Kekule ring — alternating single
 * and double bonds — so a structural view draws NINE lines for six bonds, the
 * inner line of each double bond included, and both lines of one bond carry
 * the same `data-bond-id`. Anything in the canvas counting elements to count
 * bonds is counting the wrong thing.
 */

import { benzene, buildMolecule } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

/**
 * `now` is injectable so a test can be deterministic, mirroring
 * `createDocument`: the metadata timestamps are the only thing in a fresh
 * document that changes between runs, and a snapshot of one is worthless
 * otherwise.
 */
export function fixtureDocument(now?: string): SketchDocument {
  return createDocument({
    molecule: benzene(),
    title: "Benzene",
    stylePreset: "screen",
    now,
  });
}

/**
 * The default number of heavy atoms in the stress fixture: the size the
 * performance budget is quoted at.
 */
export const STRESS_HEAVY_ATOMS = 300;

/**
 * A fused polycyclic ladder, for measuring rather than for looking at.
 *
 * A LADDER OF FUSED SIX-RINGS, NOT A CHAIN. A chain is the easy case for
 * everything downstream: ring perception finds nothing, adjacency is two
 * entries per atom, and the scene has no crossings. A fused ladder is what a
 * steroid-scale drawing looks like to the code that has to keep up with it.
 *
 * Built through `MoleculeBuilder` because `addAtom`/`addBond` are O(n) per call
 * by design, so a 300-atom loop through them is quadratic.
 *
 * It lives here, beside the benzene fixture, rather than inside the performance
 * test, because the 60fps criterion is about the REAL browser and the only way
 * to measure that is to get this structure onto the actual canvas — see
 * `documentFromSearch` in app/editor/page.tsx.
 */
export function stressMolecule(heavyAtoms: number = STRESS_HEAVY_ATOMS): Molecule {
  const rungs = Math.max(2, Math.floor(heavyAtoms / 2));
  return buildMolecule((b) => {
    const top: AtomId[] = [];
    const bottom: AtomId[] = [];
    for (let i = 0; i < rungs; i += 1) {
      top.push(b.atom("C", { x: i * 0.866, y: i % 2 === 0 ? 0.5 : 0 }));
      bottom.push(b.atom("C", { x: i * 0.866, y: (i % 2 === 0 ? 0.5 : 0) - 1 }));
    }
    for (let i = 1; i < rungs; i += 1) {
      b.bond(top[i - 1]!, top[i]!, 1);
      b.bond(bottom[i - 1]!, bottom[i]!, 1);
    }
    // Every other rung, so the result is a fused ladder rather than a
    // succession of four-rings.
    for (let i = 0; i < rungs; i += 2) b.bond(top[i]!, bottom[i]!, 1);
  });
}

/** The stress molecule as a document, ready for `openDocument`. */
export function stressDocument(
  heavyAtoms: number = STRESS_HEAVY_ATOMS,
  now?: string,
): SketchDocument {
  return createDocument({
    molecule: stressMolecule(heavyAtoms),
    title: `Stress ${heavyAtoms}`,
    stylePreset: "screen",
    now,
  });
}
