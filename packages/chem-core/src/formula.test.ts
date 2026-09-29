import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain, singleAtom } from "./builders.js";
import { COMMON_ORGANIC_ELEMENTS, labellingIsotopes } from "./elements.js";
import * as F from "./formula.js";
import { emptyMolecule } from "./molecule.js";
import { nuclideMass } from "./nuclides.js";
import { setIsotope } from "./ops.js";

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

/** Methanol, CH3OH, with the carbon optionally labelled. */
function methanol(carbonIsotope?: number) {
  return buildMolecule((b) => {
    const c = b.atom("C", undefined, carbonIsotope === undefined ? {} : { isotope: carbonIsotope });
    b.bond(c, b.atom("O"), 1);
  });
}

/** Chloroform, with its hydrogen drawn so it can carry a label: CDCl3 at 2. */
function chloroform(hydrogenIsotope?: number, chlorineIsotope?: number) {
  return buildMolecule((b) => {
    const c = b.atom("C");
    b.bond(
      c,
      b.atom("H", undefined, hydrogenIsotope === undefined ? {} : { isotope: hydrogenIsotope }),
      1,
    );
    for (let i = 0; i < 3; i++) {
      b.bond(
        c,
        b.atom("Cl", undefined, chlorineIsotope === undefined ? {} : { isotope: chlorineIsotope }),
        1,
      );
    }
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

describe("isotope labels", () => {
  // Expected exact masses are sums of AME2020 nuclide masses and agree with
  // RDKit's ExactMolWt to the digits shown; the client's
  // nuclide-masses.node.test.ts makes that comparison against the real wasm.

  it("weighs a labelled carbon as carbon-13: [13C]methanol", () => {
    expect(F.exactMass(methanol(13))).toBeCloseTo(33.0296, 4);
    expect(F.molecularWeight(methanol(13))).toBeCloseTo(33.034, 3);
    // One neutron's worth heavier than the unlabelled compound, not equal to it.
    expect(F.exactMass(methanol(13)) - F.exactMass(methanol())).toBeCloseTo(1.00335, 5);
  });

  it("weighs [1-13C]benzene at 79.0503, not benzene's 78.0470", () => {
    const plain = benzene();
    const labelled = setIsotope(plain, plain.atomIds[0]!, 13);
    expect(F.exactMass(labelled)).toBeCloseTo(79.0503, 4);
    expect(F.molecularWeight(labelled)).toBeCloseTo(79.106, 3);
    expect(F.massSummary(labelled).exactMass).toBeCloseTo(79.0503, 4);
  });

  it("weighs a drawn deuterium as deuterium: CDCl3", () => {
    expect(F.exactMass(chloroform(2))).toBeCloseTo(118.9207, 4);
    // The 120.38 on the bottle: the labelled position holds its nuclide mass
    // in the average weight too. RDKit's MolWt does the same and reads 120.384,
    // the difference being its 35.453 for chlorine against IUPAC's 35.45.
    expect(F.molecularWeight(chloroform(2))).toBeCloseTo(120.375, 3);
    // The formula is per element, so the label does not show there.
    expect(F.molecularFormula(chloroform(2))).toBe("CHCl3");
  });

  it("leaves unlabelled structures where they were", () => {
    expect(F.exactMass(benzene())).toBeCloseTo(78.047, 3);
    expect(F.molecularWeight(benzene())).toBeCloseTo(78.114, 3);
    expect(F.exactMass(methanol())).toBeCloseTo(32.0262, 4);
    expect(F.molecularWeight(methanol())).toBeCloseTo(32.042, 3);
    expect(F.exactMass(chloroform())).toBeCloseTo(117.9144, 4);
    expect(F.molecularWeight(chloroform())).toBeCloseTo(119.369, 3);
  });

  it("never moves the exact mass for a label naming the most abundant isotope", () => {
    // Exactly equal, not close: 12C, 1H and 35Cl are read from the element
    // table's own monoisotopic column.
    expect(F.exactMass(methanol(12))).toBe(F.exactMass(methanol()));
    expect(F.exactMass(chloroform(1, 35))).toBe(F.exactMass(chloroform()));
  });

  it("holds a labelled position at its nuclide mass in the average weight", () => {
    // A 12C label is a statement that this carbon is 12C, not natural carbon.
    expect(F.molecularWeight(singleAtom("C"))).toBeCloseTo(16.043, 3);
    const labelled = buildMolecule((b) => void b.atom("C", undefined, { isotope: 12 }));
    expect(F.molecularWeight(labelled)).toBeCloseTo(16.032, 3);
  });

  it("refuses a label whose nuclide mass is not on record, in both masses", () => {
    // 64Cu is a real PET nuclide, but it is not in the nuclide table. Falling
    // back to copper's 62.9296 would be the plausible wrong number.
    const copper64 = buildMolecule((b) => void b.atom("Cu", undefined, { isotope: 64 }));
    expect(F.canComputeExactMass(copper64)).toBe(false);
    expect(F.canComputeMolecularWeight(copper64)).toBe(false);
    expect(() => F.exactMass(copper64)).toThrow(F.MissingIsotopeDataError);
    expect(() => F.molecularWeight(copper64)).toThrow(/64Cu/);
    let caught: unknown;
    try {
      F.exactMass(copper64);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ symbol: "Cu", massNumber: 64 });
    const summary = F.massSummary(copper64);
    expect(summary.exactMass).toBeUndefined();
    expect(summary.molecularWeight).toBeUndefined();
    expect(summary.formula).toBe("Cu");

    // Unlabelled copper is still fine.
    const copper = singleAtom("Cu");
    expect(F.canComputeExactMass(copper)).toBe(true);
    expect(F.exactMass(copper)).toBeCloseTo(62.9296, 4);
  });

  it("refuses an unoffered label on an organic element too", () => {
    const carbon15 = buildMolecule((b) => void b.atom("C", undefined, { isotope: 15 }));
    expect(() => F.exactMass(carbon15)).toThrow(F.MissingIsotopeDataError);
    expect(F.massSummary(carbon15).molecularWeight).toBeUndefined();
  });

  it("has a mass for every label the editor offers, each beside its mass number", () => {
    const missing: string[] = [];
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      for (const a of labellingIsotopes(symbol)) {
        const mass = nuclideMass(symbol, a);
        // Every nuclide mass lies within about 0.1 u of its mass number, so a
        // row filed under the wrong mass number cannot pass this.
        if (mass === undefined || Math.abs(mass - a) > 0.11) {
          missing.push(`${String(a)}${symbol}: ${String(mass)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
