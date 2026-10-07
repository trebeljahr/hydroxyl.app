import { describe, expect, it } from "vitest";

import { isAromaticAtom } from "./aromatic.js";
import { benzene, linearChain } from "./builders.js";
import { molecularFormula, netCharge } from "./formula.js";
import {
  attachGroupToAtom,
  FUNCTIONAL_GROUP_NAMES,
  FUNCTIONAL_GROUPS,
  groupFragment,
  groupLocalPositions,
  isFunctionalGroupName,
  type FunctionalGroupName,
} from "./groups.js";
import * as M from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount, valenceIssues } from "./valence.js";
import { cross, distance, sub } from "./vec.js";

const EPS = 1e-9;

function firstAtom(mol: Molecule): AtomId {
  return mol.atomIds[0]!;
}

/** Stamp `name` on benzene's first carbon. */
function onBenzene(name: FunctionalGroupName, bondLength = 1) {
  const ring = benzene(bondLength);
  return attachGroupToAtom(ring, firstAtom(ring), name, { bondLength });
}

/** Aniline, built by the gesture itself: NH2 stamped on benzene. */
function aniline(): { readonly mol: Molecule; readonly nitrogen: AtomId } {
  const stamped = onBenzene("NH2");
  return { mol: stamped.molecule, nitrogen: stamped.atomIds[0]! };
}

function charges(mol: Molecule): number[] {
  return mol.atomIds.map((id) => M.requireAtom(mol, id).charge).filter((c) => c !== 0).sort();
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

describe("the functional-group table", () => {
  it("lays every group out on unit bonds, with every ring closing on one", () => {
    for (const name of FUNCTIONAL_GROUP_NAMES) {
      const spec = FUNCTIONAL_GROUPS[name];
      const local = groupLocalPositions(spec);
      for (const [i, j] of spec.closures) {
        expect(distance(local[i]!, local[j]!), `${name} closure ${i}-${j}`).toBeCloseTo(1, 9);
      }
      // No two atoms of a group on top of each other, and none on the
      // anchor, which sits one bond back along -x.
      const anchor = { x: -1, y: 0 };
      local.forEach((p, i) => {
        expect(distance(p, anchor), `${name} atom ${i} vs anchor`).toBeGreaterThan(0.99);
        local.forEach((q, j) => {
          if (j <= i) return;
          expect(distance(p, q), `${name} atoms ${i} and ${j}`).toBeGreaterThan(0.99);
        });
      });
    }
  });

  it("builds each fragment as a standalone molecule with its attachment atom first", () => {
    for (const name of FUNCTIONAL_GROUP_NAMES) {
      const fragment = groupFragment(name);
      const spec = FUNCTIONAL_GROUPS[name];
      expect(fragment.atomIds).toHaveLength(spec.atoms.length);
      expect(M.requireAtom(fragment, firstAtom(fragment)).element).toBe(spec.atoms[0]!.element);
      expect(M.requireAtom(fragment, firstAtom(fragment)).pos).toEqual({ x: 0, y: 0 });
      for (const bondId of fragment.bondIds) {
        const bond = M.requireBond(fragment, bondId);
        const a = M.requireAtom(fragment, bond.from).pos;
        const b = M.requireAtom(fragment, bond.to).pos;
        expect(distance(a, b), `${name} ${bondId}`).toBeCloseTo(1, 9);
      }
    }
  });

  it("recognises its own names and nothing else", () => {
    expect(isFunctionalGroupName("COOH")).toBe(true);
    expect(isFunctionalGroupName("Boc")).toBe(true);
    expect(isFunctionalGroupName("toString")).toBe(false);
    expect(isFunctionalGroupName("cooh")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real molecules
// ---------------------------------------------------------------------------

/**
 * Each group stamped on benzene, and the compound that makes. A wrong bond
 * order, a missing atom or a stray charge changes the formula, and the name
 * says which chemistry went wrong.
 */
const ON_BENZENE: Readonly<Record<Exclude<FunctionalGroupName, "Boc" | "Cbz">, readonly [string, string]>> = {
  OH: ["phenol", "C6H6O"],
  OMe: ["anisole", "C7H8O"],
  OAc: ["phenyl acetate", "C8H8O2"],
  SH: ["thiophenol", "C6H6S"],
  NH2: ["aniline", "C6H7N"],
  NMe2: ["N,N-dimethylaniline", "C8H11N"],
  NHAc: ["acetanilide", "C8H9NO"],
  NO2: ["nitrobenzene", "C6H5NO2"],
  CN: ["benzonitrile", "C7H5N"],
  N3: ["phenyl azide", "C6H5N3"],
  CHO: ["benzaldehyde", "C7H6O"],
  Ac: ["acetophenone", "C8H8O"],
  COOH: ["benzoic acid", "C7H6O2"],
  CO2Me: ["methyl benzoate", "C8H8O2"],
  CONH2: ["benzamide", "C7H7NO"],
  COCl: ["benzoyl chloride", "C7H5ClO"],
  SO3H: ["benzenesulfonic acid", "C6H6O3S"],
  Ms: ["methyl phenyl sulfone", "C7H8O2S"],
  Ts: ["phenyl p-tolyl sulfone", "C13H12O2S"],
  Me: ["toluene", "C7H8"],
  Et: ["ethylbenzene", "C8H10"],
  iPr: ["cumene", "C9H12"],
  tBu: ["tert-butylbenzene", "C10H14"],
  CF3: ["benzotrifluoride", "C7H5F3"],
  vinyl: ["styrene", "C8H8"],
  ethynyl: ["phenylacetylene", "C8H6"],
  Ph: ["biphenyl", "C12H10"],
  Bn: ["diphenylmethane", "C13H12"],
  TMS: ["trimethylsilylbenzene", "C9H14Si"],
  TBS: ["tert-butyldimethylphenylsilane", "C12H20Si"],
};

describe("attachGroupToAtom on benzene", () => {
  for (const [name, [compound, formula]] of Object.entries(ON_BENZENE)) {
    it(`makes ${compound} from ${name}`, () => {
      const { molecule } = onBenzene(name as FunctionalGroupName);
      expect(molecularFormula(molecule)).toBe(formula);
      expect(netCharge(molecule)).toBe(0);
      // Nothing over- or under-valent: the group's own bonds and charges are
      // a closed-shell substituent once it is joined to a carbon.
      expect(valenceIssues(molecule)).toEqual([]);
      // The ring the group was stamped on is still the arene it was.
      expect(isAromaticAtom(molecule, firstAtom(molecule))).toBe(true);
    });
  }

  it("covers every group in the table between this list and the N-protecting groups", () => {
    const tested = new Set([...Object.keys(ON_BENZENE), "Boc", "Cbz"]);
    expect([...FUNCTIONAL_GROUP_NAMES].sort()).toEqual([...tested].sort());
  });

  it("keeps hydrogens implicit: phenol's OH is one oxygen carrying one hydrogen", () => {
    const { molecule, atomIds } = onBenzene("OH");
    expect(atomIds).toHaveLength(1);
    expect(implicitHydrogenCount(molecule, atomIds[0]!)).toBe(1);
    // And the ring carbon it replaced a hydrogen on has none left.
    expect(implicitHydrogenCount(molecule, firstAtom(molecule))).toBe(0);
  });

  it("gives aniline's nitrogen two hydrogens and benzaldehyde's carbonyl carbon one", () => {
    const amine = onBenzene("NH2");
    expect(implicitHydrogenCount(amine.molecule, amine.atomIds[0]!)).toBe(2);
    const aldehyde = onBenzene("CHO");
    expect(implicitHydrogenCount(aldehyde.molecule, aldehyde.atomIds[0]!)).toBe(1);
  });

  it("stores nitro charge-separated, the form RDKit sanitises it to", () => {
    const { molecule } = onBenzene("NO2");
    expect(charges(molecule)).toEqual([-1, 1]);
  });

  it("stores azide as N=N+=N−", () => {
    const { molecule } = onBenzene("N3");
    expect(charges(molecule)).toEqual([-1, 1]);
    const [, central, terminal] = onBenzene("N3").atomIds;
    expect(M.requireAtom(molecule, central!).charge).toBe(1);
    expect(M.requireAtom(molecule, terminal!).charge).toBe(-1);
  });

  it("reports the linking bond first, joined to the clicked atom", () => {
    const ring = benzene();
    const { molecule, atomIds, bondIds } = attachGroupToAtom(ring, firstAtom(ring), "COOH");
    const link = M.requireBond(molecule, bondIds[0]!);
    expect([link.from, link.to].sort()).toEqual([firstAtom(ring), atomIds[0]!].sort());
    expect(link.order).toBe(1);
    // Three atoms and three bonds minted: link, C=O, C–O.
    expect(atomIds).toHaveLength(3);
    expect(bondIds).toHaveLength(3);
  });

  it("points the group away from the ring, at the drawing's own bond length", () => {
    const bondLength = 1.54;
    const ring = benzene(bondLength);
    const { molecule, atomIds } = attachGroupToAtom(ring, firstAtom(ring), "tBu", { bondLength });
    const centre = { x: 0, y: 0 };
    const anchor = M.requireAtom(molecule, firstAtom(molecule)).pos;
    for (const id of atomIds) {
      const pos = M.requireAtom(molecule, id).pos;
      // Every group atom is further from the ring centre than the ring is.
      expect(distance(pos, centre)).toBeGreaterThan(distance(anchor, centre) + EPS);
    }
    for (const bondId of molecule.bondIds) {
      const bond = M.requireBond(molecule, bondId);
      const d = distance(M.requireAtom(molecule, bond.from).pos, M.requireAtom(molecule, bond.to).pos);
      expect(d).toBeCloseTo(bondLength, 9);
    }
  });

  it("leaves the input molecule untouched", () => {
    const ring = benzene();
    const before = JSON.stringify(ring);
    attachGroupToAtom(ring, firstAtom(ring), "Boc");
    expect(JSON.stringify(ring)).toBe(before);
  });

  it("never reuses an id", () => {
    const ring = benzene();
    const { molecule, atomIds, bondIds } = attachGroupToAtom(ring, firstAtom(ring), "Ph");
    for (const id of [...atomIds, ...bondIds]) {
      expect(ring.atomIds).not.toContain(id);
      expect(ring.bondIds).not.toContain(id);
    }
    expect(molecule.nextId).toBeGreaterThan(ring.nextId);
  });
});

describe("protecting groups on aniline's nitrogen", () => {
  it("Boc makes tert-butyl phenylcarbamate", () => {
    const { mol, nitrogen } = aniline();
    const { molecule } = attachGroupToAtom(mol, nitrogen, "Boc");
    expect(molecularFormula(molecule)).toBe("C11H15NO2");
    expect(valenceIssues(molecule)).toEqual([]);
    // The carbamate NH keeps exactly one hydrogen.
    expect(implicitHydrogenCount(molecule, nitrogen)).toBe(1);
  });

  it("Cbz makes benzyl phenylcarbamate", () => {
    const { mol, nitrogen } = aniline();
    const { molecule } = attachGroupToAtom(mol, nitrogen, "Cbz");
    expect(molecularFormula(molecule)).toBe("C14H13NO2");
    expect(valenceIssues(molecule)).toEqual([]);
    expect(implicitHydrogenCount(molecule, nitrogen)).toBe(1);
  });

  it("Boc then Boc on the same nitrogen is the di-Boc amine, with no hydrogen left", () => {
    const { mol, nitrogen } = aniline();
    const once = attachGroupToAtom(mol, nitrogen, "Boc").molecule;
    const twice = attachGroupToAtom(once, nitrogen, "Boc").molecule;
    expect(molecularFormula(twice)).toBe("C16H23NO4");
    expect(implicitHydrogenCount(twice, nitrogen)).toBe(0);
  });
});

describe("which way an asymmetric group bends", () => {
  it("continues a chain's zig-zag: an ethyl on butane's end carbon makes a zig-zag hexane", () => {
    const chain = linearChain(4);
    const end = chain.atomIds[3]!;
    const { molecule, atomIds } = attachGroupToAtom(chain, end, "Et");
    expect(molecularFormula(molecule)).toBe("C6H14");
    const path = [...chain.atomIds, ...atomIds].map((id) => M.requireAtom(molecule, id).pos);
    // A zig-zag turns alternately left and right at every carbon.
    const turns: number[] = [];
    for (let i = 1; i < path.length - 1; i++) {
      turns.push(Math.sign(cross(sub(path[i]!, path[i - 1]!), sub(path[i + 1]!, path[i]!))));
    }
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i], `turn at carbon ${i + 1}`).toBe(-turns[i - 1]!);
    }
  });

  it("bends a carbonyl away from a neighbour rather than into it", () => {
    // Propanal's CHO on ethane: the C=O should sit anti to the far methyl,
    // the extended conformation drawn in every textbook.
    const chain = linearChain(2);
    const end = chain.atomIds[1]!;
    const { molecule, atomIds } = attachGroupToAtom(chain, end, "CHO");
    const methyl = M.requireAtom(molecule, chain.atomIds[0]!).pos;
    const oxygen = M.requireAtom(molecule, atomIds[1]!).pos;
    // On unit bonds at 120°, the 1,4 distance is 2 for the syn (U-shaped)
    // placement and √7 ≈ 2.65 for the anti one.
    expect(distance(methyl, oxygen)).toBeCloseTo(Math.sqrt(7), 9);
  });

  it("gives the same answer on a symmetric ring carbon every time", () => {
    const a = onBenzene("CHO").molecule;
    const b = onBenzene("CHO").molecule;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
