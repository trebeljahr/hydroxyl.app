import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, carbocycle, linearChain } from "./builders.js";
import * as M from "./molecule.js";
import { vec } from "./vec.js";

describe("construction", () => {
  it("starts empty", () => {
    const mol = M.emptyMolecule();
    expect(M.isEmpty(mol)).toBe(true);
    expect(M.atomCount(mol)).toBe(0);
    expect(M.bondCount(mol)).toBe(0);
  });

  it("never mutates the input molecule", () => {
    const before = M.emptyMolecule();
    const { molecule: after } = M.addAtom(before, { element: "C" });
    expect(M.atomCount(before)).toBe(0);
    expect(M.atomCount(after)).toBe(1);
  });

  it("keeps insertion order", () => {
    const mol = buildMolecule((b) => {
      b.atom("C");
      b.atom("N");
      b.atom("O");
    });
    expect(M.atoms(mol).map((a) => a.element)).toEqual(["C", "N", "O"]);
  });

  it("never reuses ids after a delete-free rebuild", () => {
    const a = M.addAtom(M.emptyMolecule(), { element: "C" });
    const b = M.addAtom(a.molecule, { element: "C" });
    const bond = M.addBond(b.molecule, { from: a.id, to: b.id });
    const c = M.addAtom(bond.molecule, { element: "O" });
    expect(new Set([a.id, b.id, bond.id, c.id]).size).toBe(4);
  });

  it("applies defaults", () => {
    const mol = buildMolecule((b) => b.atom("C"));
    const atom = M.atoms(mol)[0]!;
    expect(atom.charge).toBe(0);
    expect(atom.radicalElectrons).toBe(0);
    expect(atom.aromatic).toBe(false);
    expect(atom.isotope).toBeUndefined();
    expect("isotope" in atom).toBe(false);
  });
});

describe("addBond guards", () => {
  it("rejects a self-bond", () => {
    const mol = buildMolecule((b) => b.atom("C"));
    const id = mol.atomIds[0]!;
    expect(() => M.addBond(mol, { from: id, to: id })).toThrow(/itself/);
  });

  it("rejects a missing endpoint", () => {
    const mol = buildMolecule((b) => b.atom("C"));
    expect(() => M.addBond(mol, { from: mol.atomIds[0]!, to: "nope" })).toThrow(
      /No such atom/,
    );
  });

  it("rejects a duplicate bond", () => {
    const mol = linearChain(2);
    const [a, b] = mol.atomIds as [string, string];
    expect(() => M.addBond(mol, { from: b, to: a })).toThrow(/already bonded/);
  });
});

describe("adjacency", () => {
  it("is symmetric", () => {
    const mol = linearChain(3);
    const [a, b, c] = mol.atomIds as [string, string, string];
    expect(M.neighborIds(mol, a)).toEqual([b]);
    expect([...M.neighborIds(mol, b)].sort()).toEqual([a, c].sort());
    expect(M.neighborIds(mol, c)).toEqual([b]);
  });

  it("reports degree ignoring bond order", () => {
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C");
      const o = b.atom("O");
      b.bond(c1, o, 2);
    });
    expect(M.degree(mol, mol.atomIds[0]!)).toBe(1);
  });

  it("finds a bond in either direction", () => {
    const mol = linearChain(2);
    const [a, b] = mol.atomIds as [string, string];
    expect(M.bondBetween(mol, a, b)?.id).toBe(mol.bondIds[0]);
    expect(M.bondBetween(mol, b, a)?.id).toBe(mol.bondIds[0]);
    expect(M.areBonded(mol, a, b)).toBe(true);
  });

  it("returns the same cached index for the same molecule", () => {
    const mol = linearChain(4);
    expect(M.adjacency(mol)).toBe(M.adjacency(mol));
  });

  it("recomputes for a derived molecule", () => {
    const mol = linearChain(2);
    const grown = M.addAtom(mol, { element: "O" }).molecule;
    expect(M.adjacency(grown)).not.toBe(M.adjacency(mol));
    expect(Object.keys(M.adjacency(grown).neighbors)).toHaveLength(3);
  });
});

describe("otherEnd", () => {
  it("returns the opposite endpoint", () => {
    const mol = linearChain(2);
    const bond = M.bonds(mol)[0]!;
    expect(M.otherEnd(bond, bond.from)).toBe(bond.to);
    expect(M.otherEnd(bond, bond.to)).toBe(bond.from);
  });

  it("throws for an unrelated atom", () => {
    const mol = linearChain(3);
    const bond = M.bonds(mol)[0]!;
    const stranger = mol.atomIds[2]!;
    expect(() => M.otherEnd(bond, stranger)).toThrow(/not an endpoint/);
  });
});

describe("traversal", () => {
  it("walks a chain breadth-first from the start", () => {
    const mol = linearChain(4);
    expect(M.reachableFrom(mol, mol.atomIds[0]!)).toEqual([...mol.atomIds]);
  });

  it("does not recurse, so long chains are safe", () => {
    // The old recursive buildTree overflowed the stack well below this.
    const mol = linearChain(20000);
    expect(M.reachableFrom(mol, mol.atomIds[0]!)).toHaveLength(20000);
  });

  it("separates disconnected fragments", () => {
    const mol = buildMolecule((b) => {
      const a1 = b.atom("C");
      const a2 = b.atom("C");
      b.bond(a1, a2);
      b.atom("Na");
    });
    const components = M.connectedComponents(mol);
    expect(components).toHaveLength(2);
    expect(components[0]).toHaveLength(2);
    expect(components[1]).toHaveLength(1);
    expect(M.isConnected(mol)).toBe(false);
  });

  it("treats an empty molecule as connected", () => {
    expect(M.isConnected(M.emptyMolecule())).toBe(true);
  });
});

describe("ringCount", () => {
  it("is zero for an acyclic chain", () => {
    expect(M.ringCount(linearChain(6))).toBe(0);
  });

  it("is one for a single ring", () => {
    expect(M.ringCount(carbocycle(6))).toBe(1);
    expect(M.ringCount(benzene())).toBe(1);
  });

  it("counts fused rings independently", () => {
    // Two rings sharing one bond: naphthalene's skeleton, 10 atoms 11 bonds.
    const mol = buildMolecule((b) => {
      const ids = Array.from({ length: 10 }, () => b.atom("C"));
      for (let i = 0; i < 9; i++) b.bond(ids[i]!, ids[i + 1]!);
      b.bond(ids[9]!, ids[0]!);
      b.bond(ids[0]!, ids[5]!);
    });
    expect(M.ringCount(mol)).toBe(2);
  });

  it("is zero for an empty molecule", () => {
    expect(M.ringCount(M.emptyMolecule())).toBe(0);
  });
});

describe("builders", () => {
  it("draws a chain as a zig-zag, not a straight line", () => {
    const mol = linearChain(3);
    const [a, b, c] = M.atoms(mol).map((atom) => atom.pos);
    expect(b!.y).toBeGreaterThan(a!.y);
    expect(c!.y).toBeCloseTo(a!.y, 10);
    expect(c!.x).toBeGreaterThan(b!.x);
  });

  it("makes ring edges exactly one bond length", () => {
    for (const size of [3, 5, 6, 7]) {
      const ring = carbocycle(size, "C", 1);
      for (const bond of M.bonds(ring)) {
        const from = M.requireAtom(ring, bond.from).pos;
        const to = M.requireAtom(ring, bond.to).pos;
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(1, 10);
      }
    }
  });

  it("rejects a ring smaller than 3", () => {
    expect(() => carbocycle(2)).toThrow(/at least 3/);
  });

  it("gives benzene alternating orders", () => {
    expect(M.bonds(benzene()).map((b) => b.order)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it("places a single atom where asked", () => {
    const mol = buildMolecule((b) => b.atom("O", vec(3, 4)));
    expect(M.atoms(mol)[0]!.pos).toEqual({ x: 3, y: 4 });
  });
});
