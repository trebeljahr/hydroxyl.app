import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain, singleAtom } from "./builders.js";
import * as F from "./formula.js";
import { emptyMolecule } from "./molecule.js";

/** Ethanol, CH3CH2OH. */
function ethanol() {
  return buildMolecule((b) => {
    const c1 = b.atom("C");
    const c2 = b.atom("C");
    const o = b.atom("O");
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** Acetate, CH3COO-. */
function acetate() {
  return buildMolecule((b) => {
    const c1 = b.atom("C");
    const c2 = b.atom("C");
    const o1 = b.atom("O");
    const o2 = b.atom("O", undefined, { charge: -1 });
    b.bond(c1, c2, 1);
    b.bond(c2, o1, 2);
    b.bond(c2, o2, 1);
  });
}

describe("molecularFormula", () => {
  it("folds implicit hydrogens in", () => {
    expect(F.molecularFormula(singleAtom("C"))).toBe("CH4");
    expect(F.molecularFormula(linearChain(2))).toBe("C2H6");
    expect(F.molecularFormula(linearChain(3))).toBe("C3H8");
    expect(F.molecularFormula(benzene())).toBe("C6H6");
    expect(F.molecularFormula(ethanol())).toBe("C2H6O");
  });

  it("uses Hill order: carbon, hydrogen, then alphabetical", () => {
    // Cysteine-ish fragment exercising C, H, N, O, S ordering.
    const mol = buildMolecule((b) => {
      const c = b.atom("C");
      b.bond(c, b.atom("S"), 1);
      b.bond(c, b.atom("N"), 1);
      b.bond(c, b.atom("O"), 1);
    });
    // C(3 bonds)=1H, N(1)=2H, O(1)=1H, S(1)=1H -> 5 hydrogens.
    expect(F.molecularFormula(mol)).toBe("CH5NOS");
  });

  it("is independent of the order atoms were drawn in", () => {
    // The old traversal-order formula produced "OCC" or "CCO" depending on
    // which atom you started from.
    const forwards = buildMolecule((b) => {
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      const o = b.atom("O");
      b.bond(c1, c2, 1);
      b.bond(c2, o, 1);
    });
    const backwards = buildMolecule((b) => {
      const o = b.atom("O");
      const c2 = b.atom("C");
      const c1 = b.atom("C");
      b.bond(o, c2, 1);
      b.bond(c2, c1, 1);
    });
    expect(F.molecularFormula(forwards)).toBe(F.molecularFormula(backwards));
  });

  it("puts hydrogen in alphabetical position when there is no carbon", () => {
    const water = singleAtom("O");
    expect(F.molecularFormula(water)).toBe("H2O");
    const ammonia = singleAtom("N");
    expect(F.molecularFormula(ammonia)).toBe("H3N");
    const sulfuricAcid = buildMolecule((b) => {
      const s = b.atom("S");
      b.bond(s, b.atom("O"), 2);
      b.bond(s, b.atom("O"), 2);
      b.bond(s, b.atom("O"), 1);
      b.bond(s, b.atom("O"), 1);
    });
    expect(F.molecularFormula(sulfuricAcid)).toBe("H2O4S");
  });

  it("omits a count of one", () => {
    expect(F.molecularFormula(ethanol())).not.toMatch(/O1/);
  });

  it("is empty for an empty molecule", () => {
    expect(F.molecularFormula(emptyMolecule())).toBe("");
  });
});

describe("charge", () => {
  it("appends a sign", () => {
    expect(F.molecularFormula(acetate())).toBe("[C2H3O2]-");
    expect(F.netCharge(acetate())).toBe(-1);
  });

  it("appends a magnitude above one", () => {
    const dication = buildMolecule((b) => b.atom("Ca", undefined, { charge: 2 }));
    expect(F.molecularFormula(dication)).toBe("[Ca]2+");
    expect(F.netCharge(dication)).toBe(2);
  });

  it("brackets so a trailing count cannot merge into the charge", () => {
    // Unbracketed this is "Mg22+", which reads equally well as 22 magnesiums
    // with charge + as two with charge 2+.
    const mol = buildMolecule((b) => {
      b.atom("Mg", undefined, { charge: 1, explicitHydrogenCount: 0 });
      b.atom("Mg", undefined, { charge: 1, explicitHydrogenCount: 0 });
    });
    expect(F.molecularFormula(mol)).toBe("[Mg2]2+");
  });

  it("cancels opposite charges", () => {
    const zwitterion = buildMolecule((b) => {
      b.atom("N", undefined, { charge: 1 });
      b.atom("O", undefined, { charge: -1 });
    });
    expect(F.netCharge(zwitterion)).toBe(0);
    expect(F.molecularFormula(zwitterion)).not.toMatch(/[+-]/);
  });
});

describe("formulaParts", () => {
  it("separates symbols, counts and charge for the renderer", () => {
    expect(F.formulaParts(acetate())).toEqual([
      { kind: "symbol", text: "C" },
      { kind: "count", text: "2" },
      { kind: "symbol", text: "H" },
      { kind: "count", text: "3" },
      { kind: "symbol", text: "O" },
      { kind: "count", text: "2" },
      { kind: "charge", text: "-" },
    ]);
  });
});

describe("molecularFormulaUnicode", () => {
  it("uses real subscripts and superscripts", () => {
    expect(F.molecularFormulaUnicode(benzene())).toBe("C₆H₆");
    expect(F.molecularFormulaUnicode(acetate())).toBe("C₂H₃O₂⁻");
  });
});

describe("molecularWeight", () => {
  it("matches published values", () => {
    expect(F.molecularWeight(singleAtom("C"))).toBeCloseTo(16.043, 2);
    expect(F.molecularWeight(benzene())).toBeCloseTo(78.114, 2);
    expect(F.molecularWeight(ethanol())).toBeCloseTo(46.069, 2);
  });

  it("is zero for an empty molecule", () => {
    expect(F.molecularWeight(emptyMolecule())).toBe(0);
  });
});

describe("exactMass", () => {
  it("matches published monoisotopic values", () => {
    expect(F.exactMass(benzene())).toBeCloseTo(78.0470, 3);
    expect(F.exactMass(ethanol())).toBeCloseTo(46.0419, 3);
    expect(F.exactMass(singleAtom("C"))).toBeCloseTo(16.0313, 3);
  });

  it("refuses to guess rather than substituting the average weight", () => {
    // Scandium has no monoisotopic mass on record in the table.
    const mol = singleAtom("Sc");
    expect(F.canComputeExactMass(mol)).toBe(false);
    expect(() => F.exactMass(mol)).toThrow(F.MissingIsotopeDataError);
    expect(() => F.exactMass(mol)).toThrow(/Sc/);
  });

  it("is available for ordinary organic structures", () => {
    expect(F.canComputeExactMass(ethanol())).toBe(true);
  });
});

describe("massSummary", () => {
  it("bundles what the identifiers panel needs", () => {
    const summary = F.massSummary(ethanol());
    expect(summary.formula).toBe("C2H6O");
    expect(summary.formulaUnicode).toBe("C₂H₆O");
    expect(summary.molecularWeight).toBeCloseTo(46.069, 2);
    expect(summary.exactMass).toBeCloseTo(46.0419, 3);
    expect(summary.netCharge).toBe(0);
    expect(summary.heavyAtomCount).toBe(3);
  });

  it("leaves exactMass undefined rather than throwing", () => {
    expect(F.massSummary(singleAtom("Sc")).exactMass).toBeUndefined();
  });
});
