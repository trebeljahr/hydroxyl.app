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

import { benzene } from "@starter/chem-core";
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
