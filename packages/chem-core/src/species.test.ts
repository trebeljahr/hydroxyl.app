import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { molecularFormula } from "./formula.js";
import { duplicateFragment, extractFragment, insertFragment } from "./fragment.js";
import { readMolblock } from "./molblock-read.js";
import { connectedComponents, emptyMolecule, ringCount } from "./molecule.js";
import { mergeAtoms, removeAtoms, removeBonds } from "./ops.js";
import {
  SpeciesJoinError,
  joinSpecies,
  separateSpecies,
  species,
  speciesComputationCount,
  speciesIndexOf,
  speciesJoinsOf,
  speciesOf,
  withSpeciesJoins,
} from "./species.js";
import { translateAtoms } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

/** Ethyl acetate, then sodium chloride drawn beside it as two ions — the
 *  case decision 102 names: three components, two reagents. */
function esterAndSalt(): { mol: Molecule; na: AtomId; cl: AtomId; carbonylO: AtomId } {
  let na = "";
  let cl = "";
  let carbonylO = "";
  const mol = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 1, y: 0 });
    carbonylO = b.atom("O", { x: 1, y: 1 });
    const o = b.atom("O", { x: 2, y: 0 });
    const c3 = b.atom("C", { x: 3, y: 0 });
    const c4 = b.atom("C", { x: 4, y: 0 });
    b.bond(c1, c2);
    b.bond(c2, carbonylO, 2);
    b.bond(c2, o);
    b.bond(o, c3);
    b.bond(c3, c4);
    na = b.atom("Na", { x: 7, y: 0 }, { charge: 1 });
    cl = b.atom("Cl", { x: 8, y: 0 }, { charge: -1 });
  });
  return { mol, na, cl, carbonylO };
}

function formulaOf(mol: Molecule, atomIds: readonly AtomId[]): string {
  return molecularFormula(extractFragment(mol, atomIds).molecule);
}

describe("species", () => {
  it("is a connected component when nothing is joined", () => {
    const { mol, na, cl } = esterAndSalt();
    expect(species(mol)).toHaveLength(3);
    expect(species(mol).map((s) => s.atomIds)).toEqual(connectedComponents(mol));
    expect(speciesIndexOf(mol, na)).not.toBe(speciesIndexOf(mol, cl));
    expect(mol).not.toHaveProperty("speciesJoins");
  });

  it("counts sodium chloride beside an ester as two species once the ions are joined", () => {
    const { mol, na, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [cl, na]);
    const list = species(joined);
    expect(connectedComponents(joined)).toHaveLength(3);
    expect(list).toHaveLength(2);
    expect(formulaOf(joined, list[0]!.atomIds)).toBe("C4H8O2");
    expect(list[1]!.atomIds).toEqual([na, cl]);
    expect(speciesOf(joined, na)).toBe(speciesOf(joined, cl));
    expect(speciesJoinsOf(joined)).toEqual([{ atomIds: [na, cl].sort() }]);
  });

  it("lists species in the insertion order of their first atom", () => {
    // Joining the ester to the chloride makes the ester's species the one that
    // absorbs it, so it stays first and the sodium keeps its own place.
    const { mol, na, cl, carbonylO } = esterAndSalt();
    const joined = joinSpecies(mol, [cl, carbonylO]);
    expect(species(joined).map((s) => s.atomIds.includes(cl))).toEqual([true, false]);
    expect(species(joined)[1]!.atomIds).toEqual([na]);
  });

  it("stores one atom per species touched, and treats one species as no join at all", () => {
    const { mol, na, cl, carbonylO } = esterAndSalt();
    const ester = speciesOf(mol, carbonylO)!.atomIds;
    // The whole ester selected alongside the chloride: two species touched,
    // two atoms stored.
    const joined = joinSpecies(mol, [...ester, cl]);
    expect(speciesJoinsOf(joined)).toHaveLength(1);
    expect(speciesJoinsOf(joined)[0]!.atomIds).toHaveLength(2);
    // The ester alone is one species; joining it to itself is not an edit.
    expect(joinSpecies(mol, ester)).toBe(mol);
    expect(joinSpecies(joined, [na, cl, carbonylO])).not.toBe(joined);
  });

  it("keeps the join list canonical: sorted, overlapping joins unioned, singletons dropped", () => {
    const { mol, na, cl, carbonylO } = esterAndSalt();
    const a = withSpeciesJoins(mol, [{ atomIds: [cl, na] }, { atomIds: [na, carbonylO] }]);
    const b = withSpeciesJoins(mol, [{ atomIds: [carbonylO, na, cl] }]);
    expect(a).toEqual(b);
    expect(speciesJoinsOf(a)).toHaveLength(1);
    expect(species(a)).toHaveLength(1);
    expect(withSpeciesJoins(mol, [{ atomIds: [na] }])).toBe(mol);
    // Clearing omits the key rather than storing [].
    const cleared = withSpeciesJoins(a, []);
    expect(cleared).not.toHaveProperty("speciesJoins");
    expect(cleared).toEqual(mol);
    // Re-stating the same joins returns the same instance: not an undo step.
    expect(withSpeciesJoins(b, [{ atomIds: [na, cl, carbonylO] }])).toBe(b);
  });

  it("refuses a join naming a missing atom, prototype members included", () => {
    const { mol, na } = esterAndSalt();
    expect(() => withSpeciesJoins(mol, [{ atomIds: [na, "constructor"] }])).toThrow(
      SpeciesJoinError,
    );
    expect(() => joinSpecies(mol, [na, "toString"])).toThrow(SpeciesJoinError);
    expect(speciesOf(mol, "constructor")).toBeUndefined();
    expect(speciesIndexOf(mol, "toString")).toBeUndefined();
  });

  it("separates a joined salt back into its ions", () => {
    const { mol, na, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [na, cl]);
    const separated = separateSpecies(joined, cl);
    expect(separated).toEqual(mol);
    expect(species(separated)).toHaveLength(3);
    expect(separateSpecies(mol, na)).toBe(mol);
  });
});

describe("species joins across edits", () => {
  it("prunes a join with the atoms it names, and drops one left naming a single atom", () => {
    const { mol, na, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [na, cl]);
    const withoutChloride = removeAtoms(joined, [cl]);
    expect(withoutChloride).not.toHaveProperty("speciesJoins");
    expect(species(withoutChloride)).toHaveLength(2);
  });

  it("keeps a salt one species when its joined atom is merged onto another atom", () => {
    // A second sodium drawn by mistake, and the joined one dragged onto it:
    // the dragged id disappears, and the join follows the survivor.
    const { mol, na, cl } = esterAndSalt();
    const withStray = insertFragment(
      joinSpecies(mol, [na, cl]),
      buildMolecule((b) => {
        b.atom("Na", { x: 9, y: 0 }, { charge: 1 });
      }),
    );
    const stray = withStray.atomIds[0]!;
    const merged = mergeAtoms(withStray.molecule, stray, na);
    if (!merged.ok) throw new Error(merged.message);
    expect(speciesJoinsOf(merged.molecule)).toEqual([{ atomIds: [cl, stray].sort() }]);
    expect(species(merged.molecule)).toHaveLength(2);
  });

  it("copies a join only with both of its ions, and duplicates a salt as a second salt", () => {
    const { mol, na, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [na, cl]);
    const both = extractFragment(joined, [na, cl]).molecule;
    expect(species(both)).toHaveLength(1);
    expect(extractFragment(joined, [na]).molecule).not.toHaveProperty("speciesJoins");

    const doubled = duplicateFragment(joined, [na, cl], { offset: { x: 0, y: -2 } });
    expect(species(doubled.molecule)).toHaveLength(3);
    const [newNa, newCl] = doubled.atomIds;
    expect(speciesOf(doubled.molecule, newNa!)).toBe(speciesOf(doubled.molecule, newCl!));
    expect(speciesOf(doubled.molecule, newNa!)).not.toBe(speciesOf(doubled.molecule, na));
  });

  it("keeps a join in force when a bond edit splits the joined component", () => {
    // Joined to the ester through its carbonyl O; cutting the ester's C-O
    // single bond leaves the chloride with the acyl half that holds that O,
    // not with the ethoxy half.
    const { mol, carbonylO, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [carbonylO, cl]);
    expect(species(joined)).toHaveLength(2);
    expect(speciesOf(joined, cl)!.atomIds).toHaveLength(7);
    const cut = removeBonds(joined, [joined.bondIds[2]!]);
    expect(connectedComponents(cut)).toHaveLength(4);
    expect(species(cut)).toHaveLength(3);
    expect(speciesOf(cut, cl)!.atomIds).toHaveLength(4);
    expect(speciesOf(cut, cl)).toBe(speciesOf(cut, carbonylO));
  });
});

describe("species memoisation", () => {
  it("computes once per molecule instance, and not again for a position-only edit", () => {
    const { mol, na, cl } = esterAndSalt();
    const joined = joinSpecies(mol, [na, cl]);
    const before = speciesComputationCount();
    species(joined);
    species(joined);
    speciesOf(joined, na);
    expect(speciesComputationCount() - before).toBe(1);

    // A drag: forty translated instances, one topology.
    let dragged = joined;
    for (let frame = 0; frame < 40; frame++) {
      dragged = translateAtoms(dragged, [na, cl], { x: 0.01, y: 0 });
      expect(species(dragged)).toBe(species(joined));
    }
    expect(speciesComputationCount() - before).toBe(1);

    // A topology edit is a new answer.
    species(removeAtoms(joined, [na]));
    expect(speciesComputationCount() - before).toBe(2);
  });

  it("answers an empty molecule with no species", () => {
    expect(species(emptyMolecule())).toEqual([]);
  });
});

describe("the mutarotation figure", () => {
  it("holds the open chain and both anomers of D-glucose as three species in one molecule", () => {
    // Decision 104: cyclising edits in place, so the figure is built by
    // duplicating the chain and cyclising the copies. Whatever builds it, the
    // scheme model has to hold the result as three species of one molecule —
    // the sugar work depends on this answer.
    const chain = load("d-glucose-open.mol");
    const alpha = load("alpha-d-glucopyranose.mol");
    const beta = load("beta-d-glucopyranose.mol");
    let figure = chain;
    const alphaIds = insertFragment(figure, alpha, { offset: { x: 6, y: 0 } });
    figure = alphaIds.molecule;
    const betaIds = insertFragment(figure, beta, { offset: { x: 12, y: 0 } });
    figure = betaIds.molecule;

    const list = species(figure);
    expect(list).toHaveLength(3);
    expect(list.map((s) => formulaOf(figure, s.atomIds))).toEqual([
      "C6H12O6",
      "C6H12O6",
      "C6H12O6",
    ]);
    // Same formula, different compounds: the chain has no ring, each anomer one.
    expect(list.map((s) => ringCount(extractFragment(figure, s.atomIds).molecule))).toEqual([
      0, 1, 1,
    ]);
    expect(speciesOf(figure, alphaIds.atomIds[0]!)).toBe(list[1]);
    expect(speciesOf(figure, betaIds.atomIds[0]!)).toBe(list[2]);
    expect(figure).not.toHaveProperty("speciesJoins");
  });
});
