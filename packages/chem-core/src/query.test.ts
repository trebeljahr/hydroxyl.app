import { describe, expect, it } from "vitest";

import { benzene, buildMolecule } from "./builders.js";
import { chemistryIssues } from "./issues.js";
import {
  canComputeExactMass,
  canComputeMolecularWeight,
  elementCounts,
  exactMass,
  GenericStructureError,
  massSummary,
  molecularFormula,
  molecularWeight,
} from "./formula.js";
import { readMolblock } from "./molblock-read.js";
import { MolblockLabelError, writeMolblock } from "./molblock-write.js";
import { requireAtom, requireBond } from "./molecule.js";
import { makeRGroup, setAtomQuery, setBondOrder, setBondQuery, setElement } from "./ops.js";
import {
  atomQueryLabel,
  isGenericStructure,
  nextRGroupIndex,
  normalizeAtomQuery,
  parseAtomQuery,
} from "./query.js";
import { QUERY_ELEMENT } from "./elements.js";
import type { AtomId, AtomQuery, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import { vec } from "./vec.js";

/**
 * A real Markush core: a phenyl ring carrying R1 at C1 and a halogen list
 * X = Cl, Br, I para to it — a 4-halophenyl R-group scaffold as a patent
 * claim draws it.
 */
function halophenylMarkush(): { mol: Molecule; r1: AtomId; x: AtomId; ring: AtomId[] } {
  let r1 = "";
  let x = "";
  const ring: AtomId[] = [];
  const mol = buildMolecule((b) => {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      ring.push(b.atom("C", vec(Math.cos(angle), Math.sin(angle))));
    }
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
    r1 = b.atom(QUERY_ELEMENT, vec(0, 2), { query: { kind: "rgroup", index: 1 } });
    x = b.atom(QUERY_ELEMENT, vec(0, -2), {
      query: { kind: "list", elements: ["Cl", "Br", "I"], negated: false },
    });
    b.bond(ring[0]!, r1);
    b.bond(ring[3]!, x);
  });
  return { mol, r1, x, ring };
}

function queries(mol: Molecule): (AtomQuery | undefined)[] {
  return mol.atomIds.map((id) => requireAtom(mol, id).query);
}

describe("query atoms in the model (decision 238)", () => {
  it("holds a query atom as the placeholder element, never as a real one", () => {
    const { mol, r1 } = halophenylMarkush();
    expect(requireAtom(mol, r1).element).toBe(QUERY_ELEMENT);
    expect(implicitHydrogenCount(mol, r1)).toBe(0);
    expect(isGenericStructure(mol)).toBe(true);
    expect(isGenericStructure(benzene())).toBe(false);
  });

  it("gives the ring carbons the hydrogens a 1,4-disubstituted benzene has", () => {
    const { mol, ring } = halophenylMarkush();
    expect(ring.map((id) => implicitHydrogenCount(mol, id))).toEqual([0, 1, 1, 0, 1, 1]);
    expect(elementCounts(mol)).toEqual({ C: 6, H: 4 });
  });

  it("writes the formula as the drawn atoms, then the placeholders", () => {
    const { mol } = halophenylMarkush();
    expect(molecularFormula(mol)).toBe("C6H4R1[Cl,Br,I]");
  });

  it("refuses a mass for a generic structure and says why", () => {
    const { mol } = halophenylMarkush();
    expect(() => exactMass(mol)).toThrow(GenericStructureError);
    expect(() => molecularWeight(mol)).toThrow(GenericStructureError);
    expect(canComputeExactMass(mol)).toBe(false);
    expect(canComputeMolecularWeight(mol)).toBe(false);
    const summary = massSummary(mol);
    expect(summary.generic).toBe(true);
    expect(summary.exactMass).toBeUndefined();
    expect(summary.molecularWeight).toBeUndefined();
  });

  it("refuses a mass when only a bond is a query", () => {
    const mol = benzene();
    const generic = setBondQuery(mol, mol.bondIds[0]!, "single-or-aromatic");
    expect(() => exactMass(generic)).toThrow(GenericStructureError);
    expect(massSummary(generic).generic).toBe(true);
  });

  it("raises no chemistry issue for a well-drawn Markush core", () => {
    expect(chemistryIssues(halophenylMarkush().mol)).toEqual([]);
  });

  it("labels each kind compactly", () => {
    expect(atomQueryLabel({ kind: "rgroup" })).toBe("R");
    expect(atomQueryLabel({ kind: "rgroup", index: 2 })).toBe("R2");
    expect(atomQueryLabel({ kind: "any", symbol: "A" })).toBe("A");
    expect(atomQueryLabel({ kind: "list", elements: ["Cl", "Br", "I"], negated: false })).toBe(
      "[Cl,Br,I]",
    );
    expect(atomQueryLabel({ kind: "list", elements: ["N", "O"], negated: true })).toBe("![N,O]");
    expect(atomQueryLabel({ kind: "generic", label: "Ar" })).toBe("Ar");
  });

  it("refuses an element list that names a non-element, and dedupes the rest", () => {
    expect(normalizeAtomQuery({ kind: "list", elements: ["Cl", "R1"], negated: false })).toBeInstanceOf(
      Error,
    );
    expect(normalizeAtomQuery({ kind: "list", elements: ["Cl", "Br", "Cl"], negated: false })).toEqual({
      kind: "list",
      elements: ["Cl", "Br"],
      negated: false,
    });
    expect(normalizeAtomQuery({ kind: "rgroup", index: 0 })).toBeInstanceOf(Error);
  });

  it("numbers the next R-group one past the highest drawn", () => {
    const { mol } = halophenylMarkush();
    expect(nextRGroupIndex(mol)).toBe(2);
    expect(nextRGroupIndex(benzene())).toBe(1);
  });

  it("turns an atom into a query and back, dropping what only an element carries", () => {
    const mol = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { isotope: 13, explicitHydrogenCount: 3 });
    });
    const id = mol.atomIds[0]!;
    const r = setAtomQuery(mol, id, { kind: "rgroup", index: 1 });
    expect(requireAtom(r, id)).toMatchObject({ element: QUERY_ELEMENT, query: { kind: "rgroup", index: 1 } });
    expect(requireAtom(r, id).isotope).toBeUndefined();
    expect(requireAtom(r, id).explicitHydrogenCount).toBeUndefined();
    // Setting the same query again is a no-op, by value.
    expect(setAtomQuery(r, id, { kind: "rgroup", index: 1 })).toBe(r);
    // Choosing a real element makes it that element and forgets the query.
    const n = setElement(r, id, "N");
    expect(requireAtom(n, id).element).toBe("N");
    expect(requireAtom(n, id).query).toBeUndefined();
  });

  it("stores a query bond at its lowest order and clears it on an explicit order", () => {
    const mol = benzene();
    const bondId = mol.bondIds[0]!;
    const da = setBondQuery(mol, bondId, "double-or-aromatic");
    expect(requireBond(da, bondId)).toMatchObject({ order: 2, query: "double-or-aromatic" });
    const any = setBondQuery(mol, bondId, "any");
    expect(requireBond(any, bondId)).toMatchObject({ order: 1, query: "any" });
    expect(requireBond(setBondOrder(any, bondId, 1), bondId).query).toBeUndefined();
  });

  it("says a query bond was counted at its lowest order when an atom is over-valent", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C");
      for (let i = 0; i < 4; i++) b.atom("C", vec(Math.cos(i), Math.sin(i)));
      const extra = b.atom("O", vec(2, 2));
      for (let i = 2; i <= 5; i++) b.bond(c, `a${i}`);
      b.bond(c, extra);
    });
    const generic = setBondQuery(mol, mol.bondIds[4]!, "any");
    const issue = chemistryIssues(generic).find((i) => i.kind === "over-valent");
    expect(issue?.message).toContain("query bonds counted at their lowest order");
  });
});

describe("query features through the molfile codec (decision 238)", () => {
  it("writes R#, M  RGP and M  ALS for the Markush core and reads them back", () => {
    const { mol } = halophenylMarkush();
    const text = writeMolblock(mol);
    expect(text).toContain(" R#  0");
    expect(text).toContain("M  RGP  1   7   1");
    expect(text).toContain("M  ALS   8  3 F Cl  Br  I   ");
    const back = readMolblock(text);
    expect(back.warnings).toEqual([]);
    expect(queries(back.molecule)).toEqual(queries(mol));
    expect(molecularFormula(back.molecule)).toBe("C6H4R1[Cl,Br,I]");
  });

  it("round-trips the Markush core through V3000", () => {
    const { mol } = halophenylMarkush();
    const text = writeMolblock(mol, { version: "V3000" });
    expect(text).toContain("R# ");
    expect(text).toContain("RGROUPS=(1 1)");
    expect(text).toContain("[Cl,Br,I]");
    const back = readMolblock(text);
    expect(back.warnings).toEqual([]);
    expect(queries(back.molecule)).toEqual(queries(mol));
  });

  it("round-trips a NOT-list, an any atom, a bare R and an MDL generic in both generations", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C");
      const atoms: AtomQuery[] = [
        { kind: "list", elements: ["N", "O"], negated: true },
        { kind: "any", symbol: "A" },
        { kind: "rgroup" },
        { kind: "generic", label: "X" },
      ];
      atoms.forEach((query, i) => {
        b.bond(c, b.atom(QUERY_ELEMENT, vec(Math.cos(i), Math.sin(i)), { query }));
      });
    });
    for (const version of ["V2000", "V3000"] as const) {
      const back = readMolblock(writeMolblock(mol, { version }));
      expect(back.warnings, version).toEqual([]);
      expect(queries(back.molecule), version).toEqual(queries(mol));
    }
  });

  it("writes a non-MDL generic label as * with an alias in V2000 and refuses V3000", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C");
      b.bond(c, b.atom(QUERY_ELEMENT, vec(1, 0), { query: { kind: "generic", label: "Ar" } }));
    });
    const text = writeMolblock(mol);
    expect(text).toContain("A    2\nAr\n");
    expect(queries(readMolblock(text).molecule)).toEqual(queries(mol));
    expect(() => writeMolblock(mol, { version: "V3000" })).toThrow(MolblockLabelError);
  });

  it("writes query bonds as types 5-8 and reads them back", () => {
    const mol = buildMolecule((b) => {
      const ids = [0, 1, 2, 3, 4].map((i) => b.atom("C", vec(i, 0)));
      for (let i = 0; i < 4; i++) b.bond(ids[i]!, ids[i + 1]!);
    });
    const kinds = ["any", "single-or-double", "single-or-aromatic", "double-or-aromatic"] as const;
    let generic = mol;
    kinds.forEach((query, i) => {
      generic = setBondQuery(generic, generic.bondIds[i]!, query);
    });
    const text = writeMolblock(generic);
    expect(text).toContain("  1  2  8  0");
    expect(text).toContain("  2  3  5  0");
    expect(text).toContain("  3  4  6  0");
    expect(text).toContain("  4  5  7  0");
    for (const version of ["V2000", "V3000"] as const) {
      const back = readMolblock(writeMolblock(generic, { version })).molecule;
      expect(back.bondIds.map((id) => requireBond(back, id).query), version).toEqual([...kinds]);
      expect(back.bondIds.map((id) => requireBond(back, id).order), version).toEqual([1, 1, 1, 2]);
    }
  });

  it("reads RDKit's own V2000 spelling of the Markush core, alias line and all", () => {
    // Verbatim from the pinned RDKit's get_molblock(), including the `V` lines
    // it adds for R-group and dummy atoms, which carry nothing for the model.
    const text = [
      "",
      "     RDKit          2D",
      "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.0000    0.0000    0.0000 R#  0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    1.0000    0.0000 L   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0",
      "  1  3  5  0",
      "M  RGP  1   2   1",
      "V    2 *",
      "M  ALS   3  3 F Cl  Br  I   ",
      "M  END",
    ].join("\n");
    const back = readMolblock(text);
    expect(back.warnings).toEqual([]);
    expect(queries(back.molecule)).toEqual([
      undefined,
      { kind: "rgroup", index: 1 },
      { kind: "list", elements: ["Cl", "Br", "I"], negated: false },
    ]);
    expect(requireBond(back.molecule, back.molecule.bondIds[1]!).query).toBe("single-or-double");
  });
});

describe("typed query labels (decision 238)", () => {
  it("parses every label atomQueryLabel writes back into the same query", () => {
    const samples: AtomQuery[] = [
      { kind: "rgroup" },
      { kind: "rgroup", index: 12 },
      { kind: "any", symbol: "A" },
      { kind: "any", symbol: "*" },
      { kind: "list", elements: ["Cl", "Br", "I"], negated: false },
      { kind: "list", elements: ["N", "O"], negated: true },
      { kind: "generic", label: "Ar" },
    ];
    for (const query of samples) expect(parseAtomQuery(atomQueryLabel(query))).toEqual(query);
    expect(parseAtomQuery("NOT [N, O]")).toEqual({ kind: "list", elements: ["N", "O"], negated: true });
    expect(parseAtomQuery("[Cl,Xx]")).toBeInstanceOf(Error);
    expect(parseAtomQuery("  ")).toBeInstanceOf(Error);
  });

  it("numbers R-groups in click order and never renumbers one", () => {
    const mol = benzene();
    const [a, b] = mol.atomIds;
    const once = makeRGroup(mol, a!);
    const twice = makeRGroup(once, b!);
    expect(requireAtom(twice, a!).query).toEqual({ kind: "rgroup", index: 1 });
    expect(requireAtom(twice, b!).query).toEqual({ kind: "rgroup", index: 2 });
    expect(makeRGroup(twice, a!)).toBe(twice);
  });
});
