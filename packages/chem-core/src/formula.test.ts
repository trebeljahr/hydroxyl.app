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

/** Aspirin, C9H8O4: acetylsalicylic acid, ring drawn Kekulé. */
function aspirin() {
  return buildMolecule((b) => {
    const ring = Array.from({ length: 6 }, () => b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
    const acid = b.atom("C");
    b.bond(ring[0]!, acid, 1);
    b.bond(acid, b.atom("O"), 2);
    b.bond(acid, b.atom("O"), 1);
    const ester = b.atom("O");
    b.bond(ring[1]!, ester, 1);
    const acyl = b.atom("C");
    b.bond(ester, acyl, 1);
    b.bond(acyl, b.atom("O"), 2);
    b.bond(acyl, b.atom("C"), 1);
  });
}

/**
 * N-Acetylphenylalanine ethyl ester, C13H17NO3 — the formula of the ACS
 * Guide's own example line, so the expected numbers are the Guide's.
 */
function acetylPhenylalanineEthylEster() {
  return buildMolecule((b) => {
    const ring = Array.from({ length: 6 }, () => b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
    const benzylic = b.atom("C");
    b.bond(ring[0]!, benzylic, 1);
    const alpha = b.atom("C");
    b.bond(benzylic, alpha, 1);
    const n = b.atom("N");
    b.bond(alpha, n, 1);
    const amide = b.atom("C");
    b.bond(n, amide, 1);
    b.bond(amide, b.atom("O"), 2);
    b.bond(amide, b.atom("C"), 1);
    const carbonyl = b.atom("C");
    b.bond(alpha, carbonyl, 1);
    b.bond(carbonyl, b.atom("O"), 2);
    const ether = b.atom("O");
    b.bond(carbonyl, ether, 1);
    const ch2 = b.atom("C");
    b.bond(ether, ch2, 1);
    b.bond(ch2, b.atom("C"), 1);
  });
}

/** Dimethyl sulfoxide, C2H6OS. */
function dmso() {
  return buildMolecule((b) => {
    const s = b.atom("S");
    b.bond(s, b.atom("O"), 2);
    b.bond(s, b.atom("C"), 1);
    b.bond(s, b.atom("C"), 1);
  });
}

describe("elementalComposition", () => {
  it("gives aspirin's mass percentages from standard atomic weights", () => {
    const pct = F.elementalComposition(aspirin());
    expect(pct["C"]).toBeCloseTo(60.002, 3);
    expect(pct["H"]).toBeCloseTo(4.476, 3);
    expect(pct["O"]).toBeCloseTo(35.522, 3);
  });

  it("sums to 100 and lists only the elements present", () => {
    const pct = F.elementalComposition(dmso());
    expect(Object.keys(pct).sort()).toEqual(["C", "H", "O", "S"]);
    expect(Object.values(pct).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it("counts a labelled carbon at its nuclide's mass, as molecularWeight does", () => {
    const labelled = methanol(13);
    const carbon = (F.elementalComposition(labelled)["C"] ?? 0) / 100;
    expect(carbon * F.molecularWeight(labelled)).toBeCloseTo(nuclideMass("C", 13)!, 6);
    expect(F.elementalComposition(labelled)["C"]).toBeGreaterThan(
      F.elementalComposition(methanol())["C"]!,
    );
  });

  it("is empty for an empty structure", () => {
    expect(F.elementalComposition(emptyMolecule())).toEqual({});
  });
});

describe("elementalAnalysisLine", () => {
  it("reproduces the ACS Guide's own example line for C13H17NO3", () => {
    const line = F.elementalAnalysisLine(acetylPhenylalanineEthylEster());
    expect(line).toEqual({
      ok: true,
      text: "Anal. Calcd for C13H17NO3: C, 66.36; H, 7.28; N, 5.95.",
      html: "Anal. Calcd for C<sub>13</sub>H<sub>17</sub>NO<sub>3</sub>: C, 66.36; H, 7.28; N, 5.95.",
    });
  });

  it("writes aspirin's line with two decimals, trailing zeros kept, and no oxygen", () => {
    const line = F.elementalAnalysisLine(aspirin());
    expect(line.ok && line.text).toBe("Anal. Calcd for C9H8O4: C, 60.00; H, 4.48.");
  });

  it("lists sulfur after nitrogen's slot for a sulfoxide", () => {
    const line = F.elementalAnalysisLine(dmso());
    expect(line.ok && line.text).toBe("Anal. Calcd for C2H6OS: C, 30.75; H, 7.74; S, 41.03.");
  });

  it("refuses an empty drawing", () => {
    expect(F.elementalAnalysisLine(emptyMolecule()).ok).toBe(false);
  });

  it("refuses a charged species — an analysed sample is neutral", () => {
    const line = F.elementalAnalysisLine(acetate());
    expect(line.ok).toBe(false);
    expect(!line.ok && line.reason).toContain("net charge of -1");
  });

  it("refuses two compounds drawn side by side", () => {
    const scheme = buildMolecule((b) => {
      const c1 = b.atom("C");
      b.bond(c1, b.atom("O"), 1);
      b.atom("C", { x: 5, y: 0 });
    });
    const line = F.elementalAnalysisLine(scheme);
    expect(line.ok).toBe(false);
    expect(!line.ok && line.reason).toContain("more than one compound");
  });

  it("refuses a structure with none of C, H, N, S", () => {
    expect(F.elementalAnalysisLine(singleAtom("Ne")).ok).toBe(false);
  });

  it("refuses a label with no nuclide mass on record rather than approximating", () => {
    const line = F.elementalAnalysisLine(methanol(99));
    expect(line.ok).toBe(false);
    expect(!line.ok && line.reason).toContain("nuclide");
  });
});
