import { elementCounts, netCharge } from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import { glycineMolecule } from "@/components/landing/example-document";

import { formReading, formsDiff, hydroxylOxygenOf, nitrogenOf, PUBCHEM_GLYCINE } from "./glycine-zwitterion";

const neutral = formReading("neutral");
const zwitterion = formReading("zwitterion");

describe("the two forms of glycine", () => {
  it("share one sum formula, one exact mass and one net charge", () => {
    expect(neutral.formula).toBe("C2H5NO2");
    expect(zwitterion.formula).toBe(neutral.formula);
    expect(zwitterion.formulaUnicode).toBe("C₂H₅NO₂");
    expect(neutral.exactMass).toBe("75.0320");
    expect(zwitterion.exactMass).toBe(neutral.exactMass);
    expect(zwitterion.molecularWeight).toBe(neutral.molecularWeight);
    expect(neutral.netCharge).toBe(0);
    expect(zwitterion.netCharge).toBe(0);
    expect(zwitterion.bondOrders).toEqual(neutral.bondOrders);
  });

  it("move one hydrogen from the oxygen to the nitrogen, through the charges alone", () => {
    // Hydrogens are implicit: nothing in glycineMolecule places one. The two
    // charges are the whole difference, and chem-core derives the rest.
    expect(neutral.nitrogen).toEqual({ charge: 0, hydrogens: 2, lonePairs: 1 });
    expect(zwitterion.nitrogen).toEqual({ charge: 1, hydrogens: 3, lonePairs: 0 });
    expect(neutral.hydroxylOxygen).toEqual({ charge: 0, hydrogens: 1, lonePairs: 2 });
    expect(zwitterion.hydroxylOxygen).toEqual({ charge: -1, hydrogens: 0, lonePairs: 3 });
  });

  it("find the nitrogen and the hydroxyl oxygen by chemistry, not by position", () => {
    const mol = glycineMolecule("neutral");
    expect(mol.atoms[nitrogenOf(mol)]?.element).toBe("N");
    expect(mol.atoms[hydroxylOxygenOf(mol)]?.element).toBe("O");
  });
});

describe("the fidelity harness's comparison", () => {
  it("cannot tell the forms apart by element counts and net charge", () => {
    const a = glycineMolecule("neutral");
    const b = glycineMolecule("zwitterion");
    expect(elementCounts(a)).toEqual(elementCounts(b));
    expect(netCharge(a)).toBe(netCharge(b));
  });

  it("tells them apart by their formal charges, and by nothing else", () => {
    expect(formsDiff()).toEqual([{ kind: "formal-charges", before: [], after: [-1, 1] }]);
  });
});

describe("the PubChem records the guide cites", () => {
  const records = [PUBCHEM_GLYCINE.neutral, PUBCHEM_GLYCINE.zwitterion] as const;

  it("are two different compound records on pubchem.ncbi.nlm.nih.gov", () => {
    expect(records.map((r) => r.cid)).toEqual([750, 5257127]);
    for (const r of records) {
      expect(r.url).toBe(`https://pubchem.ncbi.nlm.nih.gov/compound/${r.cid}`);
    }
    expect(PUBCHEM_GLYCINE.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("agree with chem-core on the formula and both masses", () => {
    for (const [record, form] of [
      [PUBCHEM_GLYCINE.neutral, neutral],
      [PUBCHEM_GLYCINE.zwitterion, zwitterion],
    ] as const) {
      expect(form.formula).toBe(record.molecularFormula);
      expect(Number(form.exactMass)).toBeCloseTo(Number(record.monoisotopicMass), 4);
      expect(form.molecularWeight).toBe(record.molecularWeight);
    }
  });

  it("list one InChIKey for both, which is why the page cannot use it to tell them apart", () => {
    expect(PUBCHEM_GLYCINE.zwitterion.inchiKey).toBe(PUBCHEM_GLYCINE.neutral.inchiKey);
  });
});

describe("the figures", () => {
  it("export both forms, with no element id shared between the two inline SVGs", () => {
    const ids = (svg: string): string[] => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(neutral.figure.svg).toContain("<svg");
    const shared = ids(neutral.figure.svg).filter((id) => ids(zwitterion.figure.svg).includes(id));
    expect(shared).toEqual([]);
  });
});
