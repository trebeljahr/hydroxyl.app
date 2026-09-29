/**
 * The brand a test-only molecule carries, so a document can refuse it
 * (decision 210).
 *
 * The projection harness rebuilds a Molecule out of a projected layout, so a
 * layout can go through the molblock writer and RDKit like any drawing. The
 * architectural ruling forbids a view to mint a molecule, because a derived
 * Molecule looks exactly like the document's own and something would
 * eventually save one. So the builder lives in the TEST TREE, never in this
 * package's published surface, and brands everything it returns with this
 * symbol; shared's document assembler and encoder refuse a branded molecule.
 *
 * `Symbol.for`, not `Symbol()`: a test run can hold two copies of this
 * package (the source a harness imports beside the built dist a consumer
 * imports), and a registered symbol is the same symbol in both. The brand is
 * a non-enumerable own property, so it never reaches JSON, and every edit in
 * this package returns a fresh object, so an edited copy is not branded.
 */

import type { Molecule } from "./types.js";

export const TEST_ONLY_MOLECULE: unique symbol = Symbol.for("@starter/chem-core/test-only-molecule");

/** A molecule rebuilt from a projection layout by the harness: never a document's. */
export type TestOnlyMolecule = Molecule & { readonly [TEST_ONLY_MOLECULE]: true };

/** Whether `value` carries the test-only brand. */
export function isTestOnlyMolecule(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.hasOwn(value, TEST_ONLY_MOLECULE);
}
