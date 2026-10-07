import { describe, expect, it } from "vitest";
import { benzene, buildMolecule } from "./builders.js";
import { elementCounts, exactMass, massSummary, netCharge } from "./formula.js";
import {
  duplicateFragment,
  extractFragment,
  extractSelectedPart,
  insertFragment,
} from "./fragment.js";
import * as M from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { distance, vec, type Vec2 } from "./vec.js";

// Real molecules, so a regression reads as a chemistry error rather than a
// graph error. The geometry is only roughly right; nothing here depends on it
// beyond the offset test.

function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const o = b.atom("O", vec(1.73, 0));
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

/** Acetate: the carboxylate oxygen carries the -1. */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", vec(0, 0));
    const carboxyl = b.atom("C", vec(0.87, 0.5));
    const carbonyl = b.atom("O", vec(0.87, 1.5));
    const anion = b.atom("O", vec(1.73, 0), { charge: -1 });
    b.bond(methyl, carboxyl);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, anion);
  });
}

/** Ethyl methyl sulfone: a real sulfone, with a C-C bond to cut through. */
function ethylMethylSulfone(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 0));
    const o1 = b.atom("O", vec(-0.5, 0.87));
    const o2 = b.atom("O", vec(0.5, -0.87));
    const methyl = b.atom("C", vec(-1, 0));
    const alpha = b.atom("C", vec(1, 0));
    const beta = b.atom("C", vec(1.87, 0.5));
    b.bond(s, o1, 2);
    b.bond(s, o2, 2);
    b.bond(s, methyl);
    b.bond(s, alpha);
    b.bond(alpha, beta);
  });
}

function elementsOf(mol: Molecule): string[] {
  return M.atoms(mol).map((a) => a.element);
}

function allIds(mol: Molecule): string[] {
  return [...mol.atomIds, ...mol.bondIds];
}

function posOf(mol: Molecule, id: AtomId): Vec2 {
  return M.requireAtom(mol, id).pos;
}

/** Deep snapshot. Molecules are JSON-safe by construction: optional atom
 *  fields are omitted rather than set to undefined. */
function snapshot(mol: Molecule): Molecule {
  return JSON.parse(JSON.stringify(mol)) as Molecule;
}

describe("extractFragment", () => {
  it("extracts a whole benzene unchanged", () => {
    const mol = benzene();
    const { molecule: fragment } = extractFragment(mol, mol.atomIds);
    expect(M.atomCount(fragment)).toBe(6);
    expect(M.bondCount(fragment)).toBe(6);
    expect(M.ringCount(fragment)).toBe(1);
    expect(elementCounts(fragment)).toEqual(elementCounts(mol));
  });

  it("keeps the bonds between three contiguous ring carbons and cuts the rest", () => {
    const mol = benzene();
    const [c1, c2, c3] = mol.atomIds as [AtomId, AtomId, AtomId];
    const { molecule: fragment } = extractFragment(mol, [c1, c2, c3]);
    // Two of the three ring bonds have both endpoints inside; the bond that
    // would close the ring has one endpoint outside, so it is cut.
    expect(M.atomCount(fragment)).toBe(3);
    expect(M.bondCount(fragment)).toBe(2);
    expect(M.ringCount(fragment)).toBe(0);
  });

  it("cuts every bond when the ring carbons alternate", () => {
    const mol = benzene();
    const ids = [mol.atomIds[0]!, mol.atomIds[2]!, mol.atomIds[4]!];
    const { molecule: fragment } = extractFragment(mol, ids);
    expect(M.atomCount(fragment)).toBe(3);
    expect(M.bondCount(fragment)).toBe(0);
    expect(M.connectedComponents(fragment)).toHaveLength(3);
  });

  it("uses source insertion order, not the caller's id order", () => {
    const mol = ethanol();
    const shuffled = [...mol.atomIds].reverse();
    const { molecule: fragment } = extractFragment(mol, shuffled);
    expect(elementsOf(fragment)).toEqual(["C", "C", "O"]);
    expect(elementsOf(mol)).toEqual(["C", "C", "O"]);
  });

  it("deduplicates ids and ignores ids that are not in the molecule", () => {
    const mol = ethanol();
    const first = mol.atomIds[0]!;
    const { molecule: fragment } = extractFragment(mol, [
      first,
      first,
      "a999",
      mol.atomIds[1]!,
    ]);
    expect(M.atomCount(fragment)).toBe(2);
    expect(M.bondCount(fragment)).toBe(1);
  });

  it("mints fresh ids from a fresh counter, so the fragment is standalone", () => {
    const mol = benzene();
    const [c1, c2, c3] = mol.atomIds as [AtomId, AtomId, AtomId];
    const { molecule: fragment, atomIdMap, bondIdMap } = extractFragment(mol, [
      c1,
      c2,
      c3,
    ]);
    expect(fragment.atomIds).toEqual(["a1", "a2", "a3"]);
    expect(fragment.bondIds).toEqual(["b4", "b5"]);
    expect(fragment.nextId).toBe(6);
    expect(atomIdMap.get(c1)).toBe("a1");
    expect(atomIdMap.size).toBe(3);
    // Keyed by SOURCE id, valued by fragment id — the direction matters, and a
    // map built the other way round is still the right size.
    expect(bondIdMap.size).toBe(2);
    expect(bondIdMap.get(mol.bondIds[0]!)).toBe("b4");
    const carried = M.requireBond(fragment, bondIdMap.get(mol.bondIds[0]!)!);
    expect(carried.from).toBe(atomIdMap.get(c1));
    expect(carried.to).toBe(atomIdMap.get(c2));
    expect(c3).toBeDefined();
  });

  it("copies optional atom fields and omits the ones the source omits", () => {
    const mol = buildMolecule((b) => {
      const labelled = b.atom("C", vec(0, 0), { isotope: 13, label: "Me" });
      const plain = b.atom("O", vec(1, 0));
      b.bond(labelled, plain);
    });
    const { molecule: fragment } = extractFragment(mol, mol.atomIds);
    const [carbon, oxygen] = M.atoms(fragment) as [
      (typeof fragment.atoms)[string],
      (typeof fragment.atoms)[string],
    ];

    expect(carbon.isotope).toBe(13);
    expect(carbon.label).toBe("Me");

    expect("isotope" in oxygen).toBe(false);
    expect("label" in oxygen).toBe(false);
    expect("explicitHydrogenCount" in oxygen).toBe(false);
    expect(oxygen).toEqual({
      id: "a2",
      element: "O",
      pos: vec(1, 0),
      charge: 0,
      radicalElectrons: 0,
      aromatic: false,
    });
  });

  it("copies positions verbatim rather than re-centring", () => {
    const mol = benzene(1, vec(10, -4));
    const { molecule: fragment } = extractFragment(mol, mol.atomIds);
    expect(M.positions(fragment)).toEqual(M.positions(mol));
  });

  it("yields an empty molecule for an empty selection", () => {
    const mol = benzene();
    const result = extractFragment(mol, []);
    expect(result.molecule).toEqual(M.emptyMolecule());
    expect(result.atomIdMap.size).toBe(0);
    expect(result.bondIdMap.size).toBe(0);
  });
});

describe("extractSelectedPart", () => {
  /** Toluene: benzene with a methyl on the first ring atom. */
  function toluene(): { mol: Molecule; ring: AtomId[]; methyl: AtomId } {
    const ring = benzene();
    const ringIds = [...ring.atomIds];
    const methyl = buildMolecule((b) => {
      b.atom("C", vec(0, 2));
    });
    const inserted = insertFragment(ring, methyl);
    const methylId = inserted.atomIds[0]!;
    const mol = M.addBond(inserted.molecule, { from: ringIds[0]!, to: methylId, order: 1 }).molecule;
    return { mol, ring: ringIds, methyl: methylId };
  }

  it("keeps the hydrogens a cut atom carries in the drawing: phenyl, not benzene", () => {
    const { mol, ring } = toluene();
    const part = extractSelectedPart(mol, ring);
    expect(massSummary(part).formula).toBe("C6H5");
    // The cut is a substituent, and its mass is C6H5's, not C6H6's.
    expect(exactMass(part)).toBeCloseTo(6 * 12 + 5 * 1.00782503207, 6);
  });

  it("measures the selection and the rest so they add up to the whole", () => {
    const { mol, ring, methyl } = toluene();
    const phenyl = exactMass(extractSelectedPart(mol, ring));
    const methylPart = extractSelectedPart(mol, [methyl]);
    expect(massSummary(methylPart).formula).toBe("CH3");
    expect(phenyl + exactMass(methylPart)).toBeCloseTo(exactMass(mol), 9);
  });

  it("measures a whole species exactly as the species on its own", () => {
    const mol = ethanol();
    const whole = massSummary(extractSelectedPart(mol, mol.atomIds));
    expect(whole).toEqual(massSummary(mol));
  });

  it("carries the charge of the selected atoms only", () => {
    const mol = acetate();
    const [, carboxyl, carbonyl, anion] = mol.atomIds;
    const part = extractSelectedPart(mol, [carboxyl!, carbonyl!, anion!]);
    // The carboxylate of acetate: no hydrogen on the cut carbon, the charge kept.
    expect(massSummary(part).formula).toBe("[CO2]-");
    expect(netCharge(part)).toBe(-1);
  });

  it("returns an empty molecule for a selection of no atoms", () => {
    expect(extractSelectedPart(ethanol(), []).atomIds).toEqual([]);
  });
});

describe("insertFragment", () => {
  it("pastes ethanol into benzene as a second component", () => {
    const target = benzene();
    const fragment = ethanol();
    const { molecule } = insertFragment(target, fragment);

    expect(M.atomCount(molecule)).toBe(9);
    expect(M.bondCount(molecule)).toBe(8);
    expect(M.connectedComponents(molecule)).toHaveLength(2);

    const ids = allIds(molecule);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of target.atomIds) {
      expect(molecule.atoms[id]).toBe(target.atoms[id]);
    }
    for (const id of target.bondIds) {
      expect(molecule.bonds[id]).toBe(target.bonds[id]);
    }
  });

  it("remaps ids that collide with the target's", () => {
    const target = benzene();
    const fragment = ethanol();
    // The collision is real, not hypothetical: both were built from a fresh
    // counter, so they both start at a1.
    const shared = fragment.atomIds.filter((id) => id in target.atoms);
    expect(shared.length).toBeGreaterThan(0);

    const { molecule, atomIds } = insertFragment(target, fragment);
    for (const id of shared) {
      expect(molecule.atoms[id]).toBe(target.atoms[id]);
      expect(M.requireAtom(molecule, id).element).toBe("C");
    }
    for (const id of atomIds) {
      expect(id in target.atoms).toBe(false);
    }
    expect(M.requireAtom(molecule, atomIds[2]!).element).toBe("O");
  });

  it("appends the fragment in its own insertion order", () => {
    const target = benzene();
    const fragment = ethanol();
    const { molecule, atomIds, bondIds } = insertFragment(target, fragment);

    expect(molecule.atomIds.slice(0, 6)).toEqual(target.atomIds);
    expect(molecule.atomIds.slice(6)).toEqual(atomIds);
    expect(molecule.bondIds.slice(6)).toEqual(bondIds);
    expect(atomIds.map((id) => M.requireAtom(molecule, id).element)).toEqual([
      "C",
      "C",
      "O",
    ]);
  });

  it("advances nextId by exactly the fragment's atoms plus bonds", () => {
    const target = benzene();
    const fragment = ethanol();
    const { molecule } = insertFragment(target, fragment);
    expect(molecule.nextId).toBe(
      target.nextId + fragment.atomIds.length + fragment.bondIds.length,
    );
    expect(molecule.nextId).toBeGreaterThan(target.nextId);

    const again = insertFragment(molecule, fragment).molecule;
    expect(again.nextId).toBeGreaterThan(molecule.nextId);
    expect(new Set(allIds(again)).size).toBe(allIds(again).length);
  });

  it("rewrites bond endpoints through the atom map", () => {
    const target = benzene();
    const fragment = ethanol();
    const { molecule, atomIds, bondIds } = insertFragment(target, fragment);
    const first = M.requireBond(molecule, bondIds[0]!);
    expect([first.from, first.to]).toEqual([atomIds[0], atomIds[1]]);
    expect(M.neighborIds(molecule, atomIds[1]!)).toEqual([
      atomIds[0],
      atomIds[2],
    ]);
  });

  it("maps every fragment bond id to the bond actually pasted", () => {
    // The map is how a caller selects the paste or undoes it by bond id, so an
    // empty or mis-keyed map is a silent failure: the molecule looks right and
    // every follow-up gesture does nothing.
    const target = benzene();
    const fragment = ethanol();
    const { molecule, atomIdMap, bondIdMap, atomIds, bondIds } = insertFragment(
      target,
      fragment,
    );

    expect(bondIdMap.size).toBe(fragment.bondIds.length);
    fragment.bondIds.forEach((sourceId, index) => {
      const pastedId = bondIdMap.get(sourceId);
      expect(pastedId).toBe(bondIds[index]);
      const source = M.requireBond(fragment, sourceId);
      const pasted = M.requireBond(molecule, pastedId!);
      expect(pasted.from).toBe(atomIdMap.get(source.from));
      expect(pasted.to).toBe(atomIdMap.get(source.to));
      expect(pasted.order).toBe(source.order);
      expect(atomIds).toContain(pasted.from);
    });
  });

  it("translates every pasted atom by the offset and leaves bond lengths alone", () => {
    const target = benzene();
    const fragment = ethanol();
    const offset = vec(4, -2.5);
    const { molecule, atomIds } = insertFragment(target, fragment, { offset });

    fragment.atomIds.forEach((sourceId, index) => {
      const before = posOf(fragment, sourceId);
      const after = posOf(molecule, atomIds[index]!);
      expect(after).toEqual(vec(before.x + offset.x, before.y + offset.y));
    });

    const beforeLength = distance(
      posOf(fragment, fragment.atomIds[0]!),
      posOf(fragment, fragment.atomIds[1]!),
    );
    const afterLength = distance(
      posOf(molecule, atomIds[0]!),
      posOf(molecule, atomIds[1]!),
    );
    expect(afterLength).toBeCloseTo(beforeLength, 12);
  });

  it("pastes in place when no offset is given", () => {
    const target = benzene();
    const fragment = ethanol();
    const { molecule, atomIds } = insertFragment(target, fragment);
    fragment.atomIds.forEach((sourceId, index) => {
      expect(posOf(molecule, atomIds[index]!)).toEqual(posOf(fragment, sourceId));
    });
  });

  it("returns the target itself for an empty fragment", () => {
    const target = benzene();
    const result = insertFragment(target, M.emptyMolecule());
    expect(result.molecule).toBe(target);
    expect(result.atomIds).toEqual([]);
    expect(result.bondIds).toEqual([]);
  });

  it("throws on a fragment whose bond points outside it", () => {
    const fragment = ethanol();
    const corrupt: Molecule = {
      ...fragment,
      bonds: {
        ...fragment.bonds,
        [fragment.bondIds[0]!]: {
          ...M.requireBond(fragment, fragment.bondIds[0]!),
          to: "a999",
        },
      },
    };
    expect(() => insertFragment(benzene(), corrupt)).toThrow(/Corrupt fragment/);
  });
});

describe("round trips", () => {
  it("carries every optional atom field through a cut and a paste", () => {
    // Guards the copy itself, not any one field: every optional key is
    // optional, so a copy routine that forgets one still compiles and still
    // passes every other test in this file. 13-C, a pinned N-H count, a
    // display label and a radical, all on atoms that would otherwise look
    // ordinary.
    const decorated = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0), {
        isotope: 13,
        label: "Me",
        charge: 1,
        radicalElectrons: 1,
        aromatic: true,
      });
      const n = b.atom("N", vec(1, 0), { explicitHydrogenCount: 1 });
      b.bond(c, n, 2, "wedge");
    });

    const { molecule: fragment, atomIdMap } = extractFragment(
      decorated,
      decorated.atomIds,
    );
    for (const sourceId of decorated.atomIds) {
      expect(M.requireAtom(fragment, atomIdMap.get(sourceId)!)).toEqual({
        ...M.requireAtom(decorated, sourceId),
        id: atomIdMap.get(sourceId),
      });
    }

    const pasted = insertFragment(M.emptyMolecule(), fragment);
    fragment.atomIds.forEach((fragmentId, index) => {
      expect(M.requireAtom(pasted.molecule, pasted.atomIds[index]!)).toEqual({
        ...M.requireAtom(fragment, fragmentId),
        id: pasted.atomIds[index],
      });
    });
    const bond = M.requireBond(pasted.molecule, pasted.bondIds[0]!);
    expect(bond.order).toBe(2);
    expect(bond.stereo).toBe("wedge");
  });


  it("carries a sulfone's composition from one molecule to another", () => {
    const source = ethylMethylSulfone();
    // Everything but the terminal methyl of the ethyl group, so the paste
    // travels across a cut C-C bond.
    const selection = source.atomIds.slice(0, 5);
    const { molecule: fragment } = extractFragment(source, selection);
    expect(M.atomCount(fragment)).toBe(5);
    expect(M.bondCount(fragment)).toBe(4);

    const target = benzene();
    const { molecule } = insertFragment(target, fragment);
    const counts = elementCounts(molecule);
    const fragmentCounts = elementCounts(fragment);
    const targetCounts = elementCounts(target);
    for (const symbol of new Set([
      ...Object.keys(fragmentCounts),
      ...Object.keys(targetCounts),
    ])) {
      expect(counts[symbol]).toBe(
        (fragmentCounts[symbol] ?? 0) + (targetCounts[symbol] ?? 0),
      );
    }
    expect(counts["S"]).toBe(1);
  });

  it("carries acetate's charge across a cut and a paste", () => {
    const source = acetate();
    const { molecule: fragment } = extractFragment(source, source.atomIds);
    expect(netCharge(fragment)).toBe(-1);

    const target = benzene();
    const { molecule } = insertFragment(target, fragment);
    expect(netCharge(molecule)).toBe(netCharge(target) - 1);
    expect(elementCounts(molecule)["O"]).toBe(2);
  });
});

describe("duplicateFragment", () => {
  it("gives two independent rings", () => {
    const mol = benzene();
    const { molecule, atomIds, bondIds, atomIdMap, bondIdMap } =
      duplicateFragment(mol, mol.atomIds);

    expect(M.atomCount(molecule)).toBe(12);
    expect(M.bondCount(molecule)).toBe(12);
    expect(M.ringCount(molecule)).toBe(2);
    expect(M.connectedComponents(molecule)).toHaveLength(2);

    const ids = allIds(molecule);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of atomIds) expect(mol.atomIds).not.toContain(id);

    // The maps are keyed by source ids, so a selection can follow the copy.
    expect(atomIdMap.get(mol.atomIds[0]!)).toBe(atomIds[0]);
    expect(atomIdMap.size).toBe(6);
    expect(bondIdMap.size).toBe(6);
    mol.bondIds.forEach((sourceId, index) => {
      expect(bondIdMap.get(sourceId)).toBe(bondIds[index]);
    });
  });

  it("duplicates in place unless the caller nudges it", () => {
    const mol = benzene();
    const inPlace = duplicateFragment(mol, mol.atomIds);
    expect(posOf(inPlace.molecule, inPlace.atomIds[0]!)).toEqual(
      posOf(mol, mol.atomIds[0]!),
    );

    const nudged = duplicateFragment(mol, mol.atomIds, { offset: vec(2, 0) });
    const before = posOf(mol, mol.atomIds[0]!);
    expect(posOf(nudged.molecule, nudged.atomIds[0]!)).toEqual(
      vec(before.x + 2, before.y),
    );
  });

  it("duplicates a partial selection, cutting the bonds that leave it", () => {
    const mol = ethylMethylSulfone();
    const { molecule, atomIds, bondIds } = duplicateFragment(
      mol,
      mol.atomIds.slice(0, 3),
    );
    expect(atomIds).toHaveLength(3);
    expect(bondIds).toHaveLength(2);
    expect(M.atomCount(molecule)).toBe(9);
    expect(M.connectedComponents(molecule)).toHaveLength(2);
  });

  it("returns the molecule unchanged for an empty selection", () => {
    const mol = benzene();
    expect(duplicateFragment(mol, []).molecule).toBe(mol);
  });
});

describe("purity", () => {
  it("never mutates the source or the fragment", () => {
    const source = ethylMethylSulfone();
    const target = benzene();
    const sourceSnapshot = snapshot(source);
    const targetSnapshot = snapshot(target);

    const { molecule: fragment } = extractFragment(source, source.atomIds);
    const fragmentSnapshot = snapshot(fragment);

    insertFragment(target, fragment, { offset: vec(3, 3) });
    duplicateFragment(source, source.atomIds.slice(0, 2));

    expect(source).toEqual(sourceSnapshot);
    expect(target).toEqual(targetSnapshot);
    expect(fragment).toEqual(fragmentSnapshot);
  });
});
