import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain } from "./builders.js";
import { molecularFormula, netCharge } from "./formula.js";
import * as M from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import {
  cycleBondOrder,
  flipBond,
  mergeAtoms,
  removeAtom,
  removeAtoms,
  removeBond,
  removeBonds,
  setAtomPosition,
  setAtomPositions,
  setBondOrder,
  setBondStereo,
  setCharge,
  setDoubleBondSide,
  setElement,
  setExplicitHydrogenCount,
  setIsotope,
  setLabel,
  updateAtom,
  updateBond,
} from "./ops.js";
import { implicitHydrogenCount } from "./valence.js";
import { vec } from "./vec.js";

/** Ethanol, CH3-CH2-OH. */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const o = b.atom("O", vec(1.73, 0));
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** Acetate, CH3-COO-. Atom order: methyl C, carboxyl C, carbonyl O, anionic O. */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", vec(0, 0));
    const carboxyl = b.atom("C", vec(0.87, 0.5));
    const carbonyl = b.atom("O", vec(0.87, 1.5));
    const anion = b.atom("O", vec(1.73, 0), { charge: -1 });
    b.bond(methyl, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, anion, 1);
  });
}

/** Dimethyl sulfone, CH3-SO2-CH3 — a hexavalent sulfur, not a typo. */
function dimethylSulfone(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 0));
    const c1 = b.atom("C", vec(-1, -0.5));
    const c2 = b.atom("C", vec(1, -0.5));
    const o1 = b.atom("O", vec(-0.5, 1));
    const o2 = b.atom("O", vec(0.5, 1));
    b.bond(s, c1, 1);
    b.bond(s, c2, 1);
    b.bond(s, o1, 2);
    b.bond(s, o2, 2);
  });
}

function snapshot(mol: Molecule): string {
  return JSON.stringify(mol);
}

describe("removeAtom / removeAtoms", () => {
  it("cascades to every incident bond, splitting a chain in two", () => {
    const chain = linearChain(5);
    const middle = chain.atomIds[2]!;
    const cut = removeAtom(chain, middle);

    expect(M.atomCount(cut)).toBe(4);
    expect(M.bondCount(cut)).toBe(2);
    expect(M.connectedComponents(cut)).toHaveLength(2);
    for (const bond of M.bonds(cut)) {
      expect(bond.from).not.toBe(middle);
      expect(bond.to).not.toBe(middle);
    }
  });

  it("prunes both id arrays, not just the records", () => {
    const chain = linearChain(5);
    const middle = chain.atomIds[2]!;
    const cut = removeAtom(chain, middle);

    expect(cut.atomIds).not.toContain(middle);
    expect(Object.keys(cut.atoms).sort()).toEqual([...cut.atomIds].sort());
    expect(Object.keys(cut.bonds).sort()).toEqual([...cut.bondIds].sort());
  });

  it("never reuses the id of a deleted atom", () => {
    const base = linearChain(3);
    const added = M.addAtom(base, { element: "O" });
    const pruned = removeAtom(added.molecule, added.id);

    // nextId must not walk backwards when the newest atom is deleted.
    expect(pruned.nextId).toBe(added.molecule.nextId);
    const again = M.addAtom(pruned, { element: "O" });
    expect(again.id).not.toBe(added.id);
    expect(M.getAtom(again.molecule, added.id)).toBeUndefined();
  });

  it("removes several atoms in one call exactly as one at a time would", () => {
    const ring = benzene();
    const [c1, , c3, , c5] = ring.atomIds as AtomId[];
    const bulk = removeAtoms(ring, [c1!, c3!, c5!]);
    const oneAtATime = removeAtom(removeAtom(removeAtom(ring, c1!), c3!), c5!);

    expect(bulk).toEqual(oneAtATime);
    // Every benzene bond joins an odd carbon to an even one, so deleting the
    // three alternating carbons leaves three bare atoms.
    expect(M.atomCount(bulk)).toBe(3);
    expect(bulk.bondIds).toEqual([]);
    expect(bulk.bonds).toEqual({});
  });

  it("turns a sulfone into a sulfoxide when one oxygen goes", () => {
    const sulfone = dimethylSulfone();
    expect(molecularFormula(sulfone)).toBe("C2H6O2S");
    const oxygen = sulfone.atomIds[3]!;
    const sulfoxide = removeAtom(sulfone, oxygen);
    expect(molecularFormula(sulfoxide)).toBe("C2H6OS");
  });

  it("is idempotent and returns the same object for a no-op", () => {
    const ring = benzene();
    expect(removeAtom(ring, "a999")).toBe(ring);
    expect(removeAtoms(ring, [])).toBe(ring);
    expect(removeAtoms(ring, ["a999", "b1"])).toBe(ring);

    const once = removeAtom(ring, ring.atomIds[0]!);
    expect(removeAtom(once, ring.atomIds[0]!)).toBe(once);
  });

  it("deletes a big selection in one pass, so a long chain stays fast", () => {
    // Cost, not correctness: a fold over removeAtom would be O(k * n) — the
    // same quadratic shape that made a 20k-atom chain take four minutes to
    // build. Deleting every tenth carbon of a 20k polymer is one linear pass,
    // milliseconds; the fold does not finish inside vitest's default timeout,
    // so this fails by timing out rather than by assertion.
    const chain = linearChain(20000);
    const doomed = chain.atomIds.filter((_, index) => index % 10 === 0);
    const cut = removeAtoms(chain, doomed);
    expect(M.atomCount(cut)).toBe(18000);
    // Each deleted interior carbon takes its two bonds with it.
    expect(M.bondCount(cut)).toBe(19999 - (2 * 1999 + 1));
  });
});

describe("removeBond / removeBonds", () => {
  it("opens a ring without losing atoms", () => {
    const ring = benzene();
    expect(M.ringCount(ring)).toBe(1);
    const opened = removeBond(ring, ring.bondIds[0]!);

    expect(M.atomCount(opened)).toBe(6);
    expect(M.bondCount(opened)).toBe(5);
    expect(M.connectedComponents(opened)).toHaveLength(1);
    expect(M.ringCount(opened)).toBe(0);
  });

  it("removes several bonds in one call, keeping insertion order", () => {
    const ring = benzene();
    const [b1, , b3] = ring.bondIds as string[];
    const cut = removeBonds(ring, [b1!, b3!]);
    expect(cut.bondIds).toEqual(ring.bondIds.filter((id) => id !== b1 && id !== b3));
    expect(cut.atomIds).toEqual(ring.atomIds);
  });

  it("is idempotent and returns the same object for a no-op", () => {
    const ring = benzene();
    expect(removeBond(ring, "b999")).toBe(ring);
    expect(removeBonds(ring, [])).toBe(ring);
  });

  it("cuts a big bond selection in one pass", () => {
    // Same cost contract as removeAtoms: one linear pass, not a fold.
    const chain = linearChain(20000);
    const doomed = chain.bondIds.filter((_, index) => index % 10 === 0);
    const cut = removeBonds(chain, doomed);
    expect(M.atomCount(cut)).toBe(20000);
    expect(M.bondCount(cut)).toBe(19999 - doomed.length);
  });
});

describe("updateAtom patch semantics", () => {
  it("deletes an optional key when the patch carries an explicit undefined", () => {
    const plain = ethanol();
    const labelled = setIsotope(plain, plain.atomIds[0]!, 13);
    expect(M.requireAtom(labelled, plain.atomIds[0]!).isotope).toBe(13);

    const cleared = updateAtom(labelled, plain.atomIds[0]!, { isotope: undefined });
    const atom = M.requireAtom(cleared, plain.atomIds[0]!);
    expect("isotope" in atom).toBe(false);
    expect(atom).toEqual(M.requireAtom(plain, plain.atomIds[0]!));
    expect(cleared.atoms).toEqual(plain.atoms);
  });

  it("leaves a field alone when the key is absent from the patch", () => {
    const labelled = setIsotope(ethanol(), "a1", 13);
    const untouched = updateAtom(labelled, "a1", {});
    expect(untouched).toBe(labelled);
    expect(M.requireAtom(untouched, "a1").isotope).toBe(13);
  });

  it("round-trips a label to no label key at all", () => {
    const plain = ethanol();
    const named = setLabel(plain, "a3", "Ph");
    expect(M.requireAtom(named, "a3").label).toBe("Ph");

    const cleared = setLabel(named, "a3", undefined);
    expect("label" in M.requireAtom(cleared, "a3")).toBe(false);
    expect(cleared.atoms).toEqual(plain.atoms);
  });

  it("round-trips an explicit hydrogen count, pyrrole's N-H case", () => {
    const mol = ethanol();
    const pinned = setExplicitHydrogenCount(mol, "a3", 0);
    expect(implicitHydrogenCount(pinned, "a3")).toBe(0);
    const released = setExplicitHydrogenCount(pinned, "a3", undefined);
    expect("explicitHydrogenCount" in M.requireAtom(released, "a3")).toBe(false);
    expect(implicitHydrogenCount(released, "a3")).toBe(1);
  });

  it("returns the same molecule when nothing changes", () => {
    const mol = ethanol();
    expect(updateAtom(mol, "a1", { element: "C" })).toBe(mol);
    expect(setAtomPosition(mol, "a1", vec(0, 0))).toBe(mol);
    expect(setCharge(mol, "a1", 0)).toBe(mol);
  });

  it("throws on an unknown id, unlike removal", () => {
    const mol = ethanol();
    expect(() => updateAtom(mol, "a999", { charge: 1 })).toThrow(/No such atom/);
    expect(removeAtom(mol, "a999")).toBe(mol);
  });

  it("makes methane a methyl radical when radicalElectrons is patched", () => {
    // valence.ts counts an unpaired electron against the carbon's four bonds,
    // so the fourth hydrogen has to go.
    const methane = buildMolecule((b) => b.atom("C", vec(0, 0)));
    expect(implicitHydrogenCount(methane, "a1")).toBe(4);

    const radical = updateAtom(methane, "a1", { radicalElectrons: 1 });
    expect(M.requireAtom(radical, "a1").radicalElectrons).toBe(1);
    expect(implicitHydrogenCount(radical, "a1")).toBe(3);

    const carbene = updateAtom(radical, "a1", { radicalElectrons: 2 });
    expect(implicitHydrogenCount(carbene, "a1")).toBe(2);
  });

  it("writes the aromatic flag that perception owns", () => {
    // Perception is the only thing that should set this, and updateAtom /
    // updateBond are the only paths it has to write through.
    const ring = benzene();
    const flaggedAtom = updateAtom(ring, ring.atomIds[0]!, { aromatic: true });
    expect(M.requireAtom(flaggedAtom, ring.atomIds[0]!).aromatic).toBe(true);

    let delocalised = ring;
    for (const bondId of ring.bondIds) {
      delocalised = updateBond(delocalised, bondId, { order: 1, aromatic: true });
    }
    for (const bond of M.bonds(delocalised)) {
      expect(bond.aromatic).toBe(true);
      expect(bond.order).toBe(1);
    }
    // Six aromatic bonds contribute 1.5 each, so every carbon still sees a
    // bond-order sum of 3 and keeps exactly one hydrogen. Had the flag been
    // dropped the ring would read as cyclohexane, C6H12.
    expect(molecularFormula(delocalised)).toBe("C6H6");
  });
});

describe("chemistry of the named setters", () => {
  it("protonating acetate's carboxylate oxygen changes charge and its hydrogens", () => {
    const anion = acetate();
    const anionicOxygen = anion.atomIds[3]!;
    expect(netCharge(anion)).toBe(-1);
    expect(implicitHydrogenCount(anion, anionicOxygen)).toBe(0);
    expect(molecularFormula(anion)).toBe("[C2H3O2]-");

    const acid = setCharge(anion, anionicOxygen, 0);
    expect(netCharge(acid)).toBe(0);
    expect(implicitHydrogenCount(acid, anionicOxygen)).toBe(1);
    expect(molecularFormula(acid)).toBe("C2H4O2");
  });

  it("swapping ethanol's oxygen for sulfur gives ethanethiol", () => {
    const thiol = setElement(ethanol(), "a3", "S");
    expect(molecularFormula(thiol)).toBe("C2H6S");
    expect(implicitHydrogenCount(thiol, "a3")).toBe(1);
  });

  it("oxidising ethanol's C-O to C=O removes hydrogens on both ends", () => {
    const alcohol = ethanol();
    expect(implicitHydrogenCount(alcohol, "a2")).toBe(2);
    expect(implicitHydrogenCount(alcohol, "a3")).toBe(1);

    const aldehyde = setBondOrder(alcohol, "b5", 2);
    expect(implicitHydrogenCount(aldehyde, "a2")).toBe(1);
    expect(implicitHydrogenCount(aldehyde, "a3")).toBe(0);
    expect(molecularFormula(aldehyde)).toBe("C2H4O");
  });

  it("stores stereo and double-bond side without touching anything else", () => {
    const mol = ethanol();
    const wedged = setBondStereo(mol, "b4", "wedge");
    expect(M.requireBond(wedged, "b4").stereo).toBe("wedge");
    expect(wedged.atoms).toBe(mol.atoms);

    const sided = setDoubleBondSide(wedged, "b4", "left");
    expect(M.requireBond(sided, "b4").doubleBondSide).toBe("left");
    expect(M.requireBond(sided, "b4").stereo).toBe("wedge");
  });
});

describe("cycleBondOrder", () => {
  it("returns benzene to itself after three clicks", () => {
    const ring = benzene();
    const bondId = ring.bondIds[0]!;
    const once = cycleBondOrder(ring, bondId);
    const twice = cycleBondOrder(once, bondId);
    const thrice = cycleBondOrder(twice, bondId);

    expect(M.requireBond(once, bondId).order).toBe(2);
    expect(M.requireBond(twice, bondId).order).toBe(3);
    expect(thrice.bonds).toEqual(ring.bonds);
    expect(thrice.atoms).toEqual(ring.atoms);
  });

  it("wraps a triple bond back to single", () => {
    const nitrile = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const n = b.atom("N", vec(1, 0));
      b.bond(c, n, 3);
    });
    expect(M.requireBond(cycleBondOrder(nitrile, "b3"), "b3").order).toBe(1);
  });

  it("leaves the aromatic flag to aromaticity perception", () => {
    const ring = benzene();
    const flagged: Molecule = {
      ...ring,
      bonds: {
        ...ring.bonds,
        [ring.bondIds[0]!]: { ...M.requireBond(ring, ring.bondIds[0]!), aromatic: true },
      },
    };
    const cycled = cycleBondOrder(flagged, ring.bondIds[0]!);
    expect(M.requireBond(cycled, ring.bondIds[0]!).aromatic).toBe(true);
  });
});

describe("flipBond", () => {
  it("swaps the endpoints, leaves the stereo string alone, and is an involution", () => {
    const wedged = setBondStereo(ethanol(), "b4", "wedge");
    const original = M.requireBond(wedged, "b4");

    const flipped = flipBond(wedged, "b4");
    const bond = M.requireBond(flipped, "b4");
    expect(bond.from).toBe(original.to);
    expect(bond.to).toBe(original.from);
    // The wedge is inverted geometrically — the narrow end moved — so the
    // annotation itself must not change.
    expect(bond.stereo).toBe("wedge");

    expect(M.requireBond(flipBond(flipped, "b4"), "b4")).toEqual(original);
  });

  it("does not disturb the rest of the molecule", () => {
    const mol = benzene();
    const flipped = flipBond(mol, mol.bondIds[0]!);
    expect(flipped.atoms).toBe(mol.atoms);
    expect(flipped.bondIds).toEqual(mol.bondIds);
    expect(M.ringCount(flipped)).toBe(1);
  });
});

describe("updateBond endpoint guards", () => {
  it("rejects a self-bond and a duplicate", () => {
    const chain = linearChain(3);
    const [a1, a2, a3] = chain.atomIds as AtomId[];
    const firstBond = chain.bondIds[0]!;
    expect(() => updateBond(chain, firstBond, { to: a1! })).toThrow(/itself/);
    expect(() => updateBond(chain, chain.bondIds[1]!, { from: a1!, to: a2! })).toThrow(
      /already bonded/,
    );
    expect(() => updateBond(chain, firstBond, { to: "a999" })).toThrow(/No such atom/);
    expect(a3).toBeDefined();
  });
});

describe("setAtomPositions", () => {
  it("moves the listed atoms and leaves the rest identical by reference", () => {
    const ring = benzene();
    const [a1, a2] = ring.atomIds as AtomId[];
    const moved = setAtomPositions(ring, [
      [a1!, vec(10, 10)],
      [a2!, vec(11, 10)],
    ]);

    expect(M.requireAtom(moved, a1!).pos).toEqual({ x: 10, y: 10 });
    expect(M.requireAtom(moved, a2!).pos).toEqual({ x: 11, y: 10 });
    for (const id of ring.atomIds.slice(2)) {
      expect(M.requireAtom(moved, id)).toBe(M.requireAtom(ring, id));
    }
    expect(moved.bonds).toBe(ring.bonds);
    expect(moved.nextId).toBe(ring.nextId);
  });

  it("moves a single atom and leaves its neighbours identical by reference", () => {
    const mol = ethanol();
    const moved = setAtomPosition(mol, "a3", vec(3, 4));
    expect(M.requireAtom(moved, "a3").pos).toEqual({ x: 3, y: 4 });
    expect(M.requireAtom(moved, "a1")).toBe(M.requireAtom(mol, "a1"));
    expect(M.requireAtom(moved, "a2")).toBe(M.requireAtom(mol, "a2"));
    expect(moved.bonds).toBe(mol.bonds);
  });

  it("throws on an id that is gone, unlike the transforms in transform.ts", () => {
    // Deliberate, and documented at setAtomPositions: an explicit
    // atom/position pair is a statement about a specific atom, so dropping one
    // would tear the fragment apart along whichever ids went stale. A drag
    // over a possibly-stale SELECTION belongs in translateAtoms, which skips.
    const ring = benzene();
    expect(() =>
      setAtomPositions(ring, [
        [ring.atomIds[0]!, vec(5, 5)],
        ["a999", vec(6, 6)],
      ]),
    ).toThrow(/No such atom/);
  });

  it("returns the same molecule when every position is already correct", () => {
    const ring = benzene();
    const noop = setAtomPositions(
      ring,
      ring.atomIds.map((id) => [id, M.requireAtom(ring, id).pos] as const),
    );
    expect(noop).toBe(ring);
    expect(setAtomPositions(ring, [])).toBe(ring);
  });
});

describe("mergeAtoms", () => {
  it("closes a chain into cyclohexane", () => {
    // Seven atoms, six bonds: fusing the two termini leaves the six-membered
    // ring with six bonds.
    const chain = linearChain(7);
    const head = chain.atomIds[0]!;
    const tail = chain.atomIds[6]!;

    const result = mergeAtoms(chain, head, tail);
    if (!result.ok) throw new Error(`expected a merge, got ${result.reason}`);

    const ring = result.molecule;
    expect(M.atomCount(ring)).toBe(6);
    expect(M.bondCount(ring)).toBe(6);
    expect(M.ringCount(ring)).toBe(1);
    expect(molecularFormula(ring)).toBe("C6H12");
    for (const bond of M.bonds(ring)) expect(bond.from).not.toBe(bond.to);
    expect(M.getAtom(ring, tail)).toBeUndefined();
    expect(result.survivingId).toBe(head);
    expect(result.removedAtomId).toBe(tail);
    expect(result.removedBondIds).toEqual([]);
    expect(ring.nextId).toBe(chain.nextId);
  });

  it("collapses a duplicated bond, keeping the existing id at the higher order", () => {
    // C1-C2=C3: merging C3 onto C1 rewires C2=C3 onto C2-C1, which already
    // exists, so the two must fuse into one double bond.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const c3 = b.atom("C", vec(2, 0));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 2);
    });
    const [c1, c2, c3] = mol.atomIds as AtomId[];
    const keptId = mol.bondIds[0]!;
    const discardedId = mol.bondIds[1]!;

    const result = mergeAtoms(mol, c1!, c3!);
    if (!result.ok) throw new Error(`expected a merge, got ${result.reason}`);

    const fused = result.molecule;
    expect(M.atomCount(fused)).toBe(2);
    expect(M.bondCount(fused)).toBe(1);
    expect(fused.bondIds).toEqual([keptId]);
    expect(result.removedBondIds).toEqual([discardedId]);
    const bond = M.requireBond(fused, keptId);
    expect(bond.order).toBe(2);
    expect([bond.from, bond.to].sort()).toEqual([c1!, c2!].sort());
    expect(molecularFormula(fused)).toBe("C2H4");
  });

  it("keeps the target's higher order when the dragged bond is the weaker one", () => {
    // The mirror of the test above, and the direction that a "take the dragged
    // bond's order" bug survives: a geminal diol collapsing back to a
    // carbonyl. The C=O already at the target must NOT be demoted to C-O by
    // the C-OH being dropped onto it — that would re-derive two hydrogens and
    // silently turn formaldehyde into methanol.
    const hydrate = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const carbonyl = b.atom("O", vec(0, 1));
      const hydroxyl = b.atom("O", vec(1, 0));
      b.bond(c, carbonyl, 2);
      b.bond(c, hydroxyl, 1);
    });
    const [, carbonyl, hydroxyl] = hydrate.atomIds as AtomId[];
    const keptId = hydrate.bondIds[0]!;
    const discardedId = hydrate.bondIds[1]!;

    const result = mergeAtoms(hydrate, carbonyl!, hydroxyl!);
    if (!result.ok) throw new Error(`expected a merge, got ${result.reason}`);

    const fused = result.molecule;
    expect(fused.bondIds).toEqual([keptId]);
    expect(result.removedBondIds).toEqual([discardedId]);
    expect(M.requireBond(fused, keptId).order).toBe(2);
    expect(molecularFormula(fused)).toBe("CH2O");
  });

  it("carries every optional field of the dragged atom onto the survivor", () => {
    // Guards the copy itself rather than any one field: a hand-rolled survivor
    // that forgets an optional key compiles and passes every other test here,
    // because every one of them is optional.
    const mol = buildMolecule((b) => {
      b.atom("C", vec(0, 0));
      b.atom("N", vec(5, 5), {
        charge: 1,
        radicalElectrons: 1,
        aromatic: true,
        isotope: 15,
        explicitHydrogenCount: 2,
        label: "Nu",
      });
    });
    const [target, dragged] = mol.atomIds as AtomId[];
    const result = mergeAtoms(mol, target!, dragged!);
    if (!result.ok) throw new Error("expected a merge");

    expect(M.requireAtom(result.molecule, target!)).toEqual({
      ...M.requireAtom(mol, dragged!),
      id: target,
      pos: { x: 0, y: 0 },
    });
  });

  it("drops the discarded bond's stereo rather than inheriting it", () => {
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      const c3 = b.atom("C", vec(2, 0));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 1, "wedge");
    });
    const result = mergeAtoms(mol, mol.atomIds[0]!, mol.atomIds[2]!);
    if (!result.ok) throw new Error("expected a merge");
    expect(M.requireBond(result.molecule, mol.bondIds[0]!).stereo).toBe("none");
  });

  it("gives the dragged atom's identity to the target's id and position", () => {
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      b.bond(c1, c2, 1);
      b.atom("N", vec(5, 5), { charge: 1, isotope: 15, label: "Nu" });
    });
    const [, target, nitrogen] = mol.atomIds as AtomId[];

    const result = mergeAtoms(mol, target!, nitrogen!);
    if (!result.ok) throw new Error("expected a merge");

    const survivor = M.requireAtom(result.molecule, target!);
    expect(survivor.id).toBe(target);
    expect(survivor.element).toBe("N");
    expect(survivor.charge).toBe(1);
    expect(survivor.isotope).toBe(15);
    expect(survivor.label).toBe("Nu");
    // The target does not move, so the structure does not jump under the drag.
    expect(survivor.pos).toEqual({ x: 1, y: 0 });
    expect(M.atomCount(result.molecule)).toBe(2);
  });

  it("deletes optional keys the dragged atom does not carry", () => {
    const mol = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { isotope: 13, label: "Me" });
      b.atom("N", vec(5, 5));
    });
    const result = mergeAtoms(mol, mol.atomIds[0]!, mol.atomIds[1]!);
    if (!result.ok) throw new Error("expected a merge");
    const survivor = M.requireAtom(result.molecule, mol.atomIds[0]!);
    expect("isotope" in survivor).toBe(false);
    expect("label" in survivor).toBe(false);
  });

  it("refuses bonded neighbours, a self-merge and a missing atom", () => {
    const chain = linearChain(2);
    const [a1, a2] = chain.atomIds as AtomId[];

    const bonded = mergeAtoms(chain, a1!, a2!);
    expect(bonded.ok).toBe(false);
    if (bonded.ok) throw new Error("unreachable");
    expect(bonded.reason).toBe("already-bonded");

    const self = mergeAtoms(chain, a1!, a1!);
    if (self.ok) throw new Error("unreachable");
    expect(self.reason).toBe("same-atom");

    const missing = mergeAtoms(chain, a1!, "a999");
    if (missing.ok) throw new Error("unreachable");
    expect(missing.reason).toBe("no-such-atom");

    const missingTarget = mergeAtoms(chain, "a999", a1!);
    if (missingTarget.ok) throw new Error("unreachable");
    expect(missingTarget.reason).toBe("no-such-atom");

    // A refusal carries no molecule, so the caller keeps the one it had.
    expect(M.bondCount(chain)).toBe(1);
  });
});

describe("purity", () => {
  it("leaves the input molecule untouched after every operation", () => {
    const mol = acetate();
    const before = snapshot(mol);
    const sulfone = dimethylSulfone();
    const sulfoneBefore = snapshot(sulfone);

    removeAtom(mol, mol.atomIds[0]!);
    removeAtoms(mol, mol.atomIds);
    removeBond(mol, mol.bondIds[0]!);
    removeBonds(mol, mol.bondIds);
    updateAtom(mol, mol.atomIds[0]!, { element: "N", isotope: 15 });
    updateBond(mol, mol.bondIds[0]!, { order: 3 });
    setCharge(mol, mol.atomIds[3]!, 0);
    setLabel(mol, mol.atomIds[0]!, "Me");
    setAtomPositions(mol, [[mol.atomIds[0]!, vec(9, 9)]]);
    cycleBondOrder(mol, mol.bondIds[1]!);
    flipBond(mol, mol.bondIds[0]!);
    mergeAtoms(sulfone, sulfone.atomIds[3]!, sulfone.atomIds[4]!);

    expect(snapshot(mol)).toBe(before);
    expect(M.atomCount(mol)).toBe(4);
    expect(M.bondCount(mol)).toBe(3);
    expect(snapshot(sulfone)).toBe(sulfoneBefore);
  });
});
