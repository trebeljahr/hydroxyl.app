/**
 * "Add explicit H" and "Remove explicit H": the drawing changes, the
 * chemistry does not. Every assertion is on the formula, the implicit counts
 * or a descriptor — what a chemist would check — rather than on graph shape.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { benzene, buildMolecule } from "./builders.js";
import {
  addExplicitHydrogens,
  hasHydrogensToDraw,
  hasHydrogensToFold,
  removeExplicitHydrogens,
} from "./explicit-hydrogens.js";
import { elementCounts } from "./formula.js";
import { readMolblock } from "./molblock-read.js";
import { bondBetween } from "./molecule.js";
import { setBondStereo } from "./ops.js";
import { promoteImplicitHydrogen } from "./promote-hydrogen.js";
import { cipDescriptor, doubleBondDescriptor } from "./stereo.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "projection",
);

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

function ethanol(): { mol: Molecule; ch3: AtomId; ch2: AtomId; o: AtomId } {
  let ch3 = "";
  let ch2 = "";
  let o = "";
  const mol = buildMolecule((b) => {
    ch3 = b.atom("C", { x: 0, y: 0 });
    ch2 = b.atom("C", { x: 0.87, y: 0.5 });
    b.bond(ch3, ch2);
    o = b.atom("O", { x: 1.73, y: 0 });
    b.bond(ch2, o);
  });
  return { mol, ch3, ch2, o };
}

const implied = (m: Molecule) => m.atomIds.reduce((n, id) => n + implicitHydrogenCount(m, id), 0);
const drawnH = (m: Molecule) => m.atomIds.filter((id) => m.atoms[id]!.element === "H").length;

describe("addExplicitHydrogens", () => {
  it("draws every hydrogen of ethanol and keeps C2H6O", () => {
    const { mol, ch3, ch2, o } = ethanol();
    const result = addExplicitHydrogens(mol, [ch3, ch2, o]);
    expect(result.hydrogenIds).toHaveLength(6);
    expect(result.refused).toEqual([]);
    expect(implied(result.molecule)).toBe(0);
    expect(drawnH(result.molecule)).toBe(6);
    expect(elementCounts(result.molecule)).toEqual(elementCounts(mol));
  });

  it("touches only the selected atoms", () => {
    const { mol, ch3, ch2, o } = ethanol();
    const result = addExplicitHydrogens(mol, [o]);
    expect(result.hydrogenIds).toHaveLength(1);
    expect(implicitHydrogenCount(result.molecule, ch3)).toBe(3);
    expect(implicitHydrogenCount(result.molecule, ch2)).toBe(2);
  });

  it("returns the input itself when nothing has an implicit hydrogen", () => {
    const { mol } = ethanol();
    const full = addExplicitHydrogens(mol, mol.atomIds).molecule;
    const again = addExplicitHydrogens(full, full.atomIds);
    expect(again.molecule).toBe(full);
    expect(again.hydrogenIds).toEqual([]);
  });

  it("skips a labelled abbreviation and ids that are not in the molecule", () => {
    let ph = "";
    const mol = buildMolecule((b) => {
      ph = b.atom("C", { x: 0, y: 0 }, { label: "Ph" });
      b.bond(ph, b.atom("O", { x: 1, y: 0 }));
    });
    const result = addExplicitHydrogens(mol, [ph, "a99", "constructor"]);
    expect(result.molecule).toBe(mol);
  });

  it("keeps (R)-glyceraldehyde (R) at its centre", () => {
    const mol = load("r-glyceraldehyde.mol");
    const result = addExplicitHydrogens(mol, mol.atomIds);
    expect(result.refused).toEqual([]);
    expect(cipDescriptor(result.molecule, "a3")?.kind).toBe("R");
    expect(elementCounts(result.molecule)).toEqual(elementCounts(mol));
  });
});

describe("removeExplicitHydrogens", () => {
  it("is the inverse of adding: ethanol goes back to six implicit hydrogens", () => {
    const { mol } = ethanol();
    const drawn = addExplicitHydrogens(mol, mol.atomIds).molecule;
    const result = removeExplicitHydrogens(drawn, drawn.atomIds);
    expect(result.hydrogenIds).toHaveLength(6);
    expect(drawnH(result.molecule)).toBe(0);
    expect(implied(result.molecule)).toBe(6);
    expect(elementCounts(result.molecule)).toEqual(elementCounts(mol));
    // No pin was needed either way, so the atoms read exactly as before.
    for (const id of mol.atomIds) {
      expect(result.molecule.atoms[id]).toEqual(mol.atoms[id]);
    }
  });

  it("folds a selected hydrogen into its neighbour, and only that one", () => {
    const { mol, ch3, o } = ethanol();
    const drawn = addExplicitHydrogens(mol, [ch3, o]);
    const oh = drawn.hydrogenIds[drawn.hydrogenIds.length - 1]!;
    const result = removeExplicitHydrogens(drawn.molecule, [oh]);
    expect(result.hydrogenIds).toEqual([oh]);
    expect(implicitHydrogenCount(result.molecule, o)).toBe(1);
    expect(implicitHydrogenCount(result.molecule, ch3)).toBe(0);
    expect(drawnH(result.molecule)).toBe(3);
  });

  it("raises a pinned count rather than unpinning it", () => {
    let n = "";
    const mol = buildMolecule((b) => {
      n = b.atom("N", { x: 0, y: 0 }, { explicitHydrogenCount: 1 });
      b.bond(n, b.atom("C", { x: 1, y: 0 }));
    });
    const promoted = promoteImplicitHydrogen(mol, n);
    if (!promoted.ok) throw new Error(promoted.reason);
    const result = removeExplicitHydrogens(promoted.molecule, [n]);
    expect(result.molecule.atoms[n]!.explicitHydrogenCount).toBe(1);
  });

  it("leaves deuterium, a charged hydrogen and H2 drawn: folding them changes the chemistry", () => {
    let c = "";
    const mol = buildMolecule((b) => {
      c = b.atom("C", { x: 0, y: 0 });
      b.bond(c, b.atom("H", { x: 1, y: 0 }, { isotope: 2 }));
      const h1 = b.atom("H", { x: 3, y: 0 });
      b.bond(h1, b.atom("H", { x: 4, y: 0 }));
      b.atom("H", { x: 5, y: 0 }, { charge: 1 });
    });
    const result = removeExplicitHydrogens(mol, mol.atomIds);
    expect(result.molecule).toBe(mol);
    expect(result.hydrogenIds).toEqual([]);
  });

  it("keeps benzene C6H6 through a round trip, aromatic snap and all", () => {
    const mol = benzene();
    const drawn = addExplicitHydrogens(mol, mol.atomIds).molecule;
    expect(drawnH(drawn)).toBe(6);
    const back = removeExplicitHydrogens(drawn, drawn.atomIds).molecule;
    expect(elementCounts(back)).toEqual(elementCounts(mol));
    expect(drawnH(back)).toBe(0);
  });

  it("keeps a stereocentre whose configuration the heavy atoms state", () => {
    const mol = load("r-glyceraldehyde.mol");
    const drawn = addExplicitHydrogens(mol, ["a3"]).molecule;
    const result = removeExplicitHydrogens(drawn, drawn.atomIds);
    expect(result.refused).toEqual([]);
    expect(cipDescriptor(result.molecule, "a3")?.kind).toBe("R");
  });

  it("refuses to fold the wedged hydrogen that is a centre's only statement", () => {
    // Butan-2-ol with three plain heavy bonds and the configuration carried
    // by a wedge to its drawn hydrogen alone.
    let c2 = "";
    let h = "";
    const mol = buildMolecule((b) => {
      c2 = b.atom("C", { x: 0, y: 0 });
      b.bond(c2, b.atom("O", { x: 0, y: 1 }));
      b.bond(c2, b.atom("C", { x: -0.87, y: -0.5 }));
      const c3 = b.atom("C", { x: 0.87, y: -0.5 });
      b.bond(c2, c3);
      b.bond(c3, b.atom("C", { x: 1.73, y: 0 }));
      h = b.atom("H", { x: 0.5, y: 0.3 });
      b.bond(c2, h, 1, "wedge");
    });
    const before = cipDescriptor(mol, c2)?.kind;
    expect(before === "R" || before === "S").toBe(true);

    const result = removeExplicitHydrogens(mol, [h]);
    expect(result.molecule).toBe(mol);
    expect(result.refused).toEqual([c2]);
    // The plain one stays foldable once it is not the statement.
    const plain = setBondStereo(mol, bondBetween(mol, c2, h)!.id, "none");
    expect(removeExplicitHydrogens(plain, [h]).hydrogenIds).toEqual([h]);
  });

  it("keeps (E)-but-2-ene (E) when a drawn vinyl hydrogen folds", () => {
    let c2 = "";
    let c3 = "";
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", { x: -0.87, y: -0.5 });
      c2 = b.atom("C", { x: 0, y: 0 });
      c3 = b.atom("C", { x: 1, y: 0 });
      const c4 = b.atom("C", { x: 1.87, y: 0.5 });
      b.bond(c1, c2);
      b.bond(c2, c3, 2);
      b.bond(c3, c4);
      b.bond(c2, b.atom("H", { x: -0.5, y: 0.87 }));
    });
    const bond = bondBetween(mol, c2, c3)!.id;
    expect(doubleBondDescriptor(mol, bond)?.kind).toBe("E");
    const result = removeExplicitHydrogens(mol, [c2]);
    expect(result.hydrogenIds).toHaveLength(1);
    expect(doubleBondDescriptor(result.molecule, bond)?.kind).toBe("E");
    expect(implicitHydrogenCount(result.molecule, c2)).toBe(1);
  });

  it("leaves a hydrogen the caller keeps, and says so", () => {
    const { mol, o } = ethanol();
    const drawn = addExplicitHydrogens(mol, [o]);
    const oh = drawn.hydrogenIds[0]!;
    const result = removeExplicitHydrogens(drawn.molecule, [o], { keep: new Set([oh]) });
    expect(result.molecule).toBe(drawn.molecule);
    expect(result.kept).toEqual([oh]);
  });
});

describe("hasHydrogensToDraw / hasHydrogensToFold", () => {
  it("agree with what the two edits would do", () => {
    const { mol, o } = ethanol();
    expect(hasHydrogensToDraw(mol, [o])).toBe(true);
    expect(hasHydrogensToFold(mol, mol.atomIds)).toBe(false);
    const drawn = addExplicitHydrogens(mol, mol.atomIds).molecule;
    expect(hasHydrogensToDraw(drawn, drawn.atomIds)).toBe(false);
    expect(hasHydrogensToFold(drawn, [o])).toBe(true);
    expect(hasHydrogensToDraw(mol, [])).toBe(false);
  });
});
