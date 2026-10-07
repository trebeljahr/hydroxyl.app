import { chemistryIssues, molecularFormula } from "@starter/chem-core";
import { dictionaryEntryById, dictionaryMolecule } from "@starter/chem-core/dictionary";
import { describe, expect, it } from "vitest";

import { IUPAC_DRAWING, PUBCHEM_ISOLEUCINE, skeletalFormulaNumbers } from "./skeletal-formula";
import {
  L_ISOLEUCINE_DICTIONARY_ID,
  L_ISOLEUCINE_MOLBLOCK,
  fiveBondCarbonMolecule,
  isoleucineMolecule,
  skeletalFormulaDocument,
} from "./skeletal-formula-examples";

const numbers = skeletalFormulaNumbers();

describe("the guide's molecule (decision 247)", () => {
  it("is the insert box's L-isoleucine, byte for byte", () => {
    // The copy exists so /editor does not load the dictionary. If the
    // generated entry changes, re-copy it: a reader who types "isoleucine"
    // must get the drawing the guide shows.
    const entry = dictionaryEntryById(L_ISOLEUCINE_DICTIONARY_ID)!;
    expect(L_ISOLEUCINE_MOLBLOCK).toBe(entry.molblock);
    expect(isoleucineMolecule()).toEqual(dictionaryMolecule(entry));
  });

  it("is the compound PubChem's record names", () => {
    const entry = dictionaryEntryById(L_ISOLEUCINE_DICTIONARY_ID)!;
    expect(entry.inchiKey).toBe(PUBCHEM_ISOLEUCINE.inchiKey);
    expect(numbers.formula).toBe(PUBCHEM_ISOLEUCINE.formula);
    expect(numbers.formulaUnicode).toBe("C₆H₁₃NO₂");
  });

  it("draws skeletal with locants beside explicit H, two to a row", () => {
    const doc = skeletalFormulaDocument();
    expect(doc.panels.map((p) => [p.representation.kind, p.representation.display.showLocants])).toEqual([
      ["skeletal", true],
      ["explicitH", false],
    ]);
    expect(doc.figure?.columns).toBe(2);
    expect(numbers.figure.svg.startsWith("<svg")).toBe(true);
    expect(numbers.figure.svg).toContain(">5<");
  });
});

describe("the carbon count", () => {
  it("finds a carbon of every kind, C1 up and the branch methyl last", () => {
    expect(numbers.carbons.map((c) => [c.name, c.bondsDrawn, c.hydrogens])).toEqual([
      ["C1", 4, 0],
      ["C2", 3, 1],
      ["C3", 3, 1],
      ["C4", 2, 2],
      ["C5", 1, 3],
      ["the methyl on C3", 1, 3],
    ]);
    expect(numbers.carbons[0]?.hasDoubleBond).toBe(true);
  });

  it("gives every carbon four bonds, drawn or hydrogen", () => {
    for (const c of numbers.carbons) expect(c.bondsDrawn + c.hydrogens, c.name).toBe(4);
  });

  it("counts the line ends a newcomer misses", () => {
    expect(numbers.carbonCount).toBe(6);
    expect(numbers.lineEndCount).toBe(2);
    expect(numbers.carbons.filter((c) => c.lineEnd).map((c) => c.name)).toEqual([
      "C5",
      "the methyl on C3",
    ]);
  });

  it("adds the hydrogens up to the formula", () => {
    expect(numbers.hydrogensOnCarbon).toBe(10);
    expect(numbers.hydrogensOnNitrogen).toBe(2);
    expect(numbers.hydrogensOnOxygen).toBe(1);
    expect(numbers.hydrogenCount).toBe(
      numbers.hydrogensOnCarbon + numbers.hydrogensOnNitrogen + numbers.hydrogensOnOxygen,
    );
    expect(numbers.formula).toContain(`H${numbers.hydrogenCount}`);
  });
});

describe("the five-bond mistake", () => {
  it("adds one carbon at C1 and nothing else", () => {
    const mol = fiveBondCarbonMolecule();
    expect(molecularFormula(mol)).not.toBe(numbers.formula);
    expect(mol.atomIds).toHaveLength(isoleucineMolecule().atomIds.length + 1);
  });

  it("is chem-core's only issue on it, with the label the canvas prints", () => {
    const issues = chemistryIssues(fiveBondCarbonMolecule()).filter((i) => i.severity === "error");
    expect(issues.map((i) => i.kind)).toEqual(["over-valent"]);
    expect(numbers.fiveBondLabel).toBe("C has 5 bonds; max 4");
  });

  it("leaves the guide's own molecule clean", () => {
    expect(chemistryIssues(isoleucineMolecule()).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("the IUPAC source", () => {
  it("quotes one short sentence and links each section by its own anchor", () => {
    expect(IUPAC_DRAWING.quote.split(/\s+/).length).toBeLessThan(15);
    for (const { id, anchor } of Object.values(IUPAC_DRAWING.sections)) {
      expect(anchor).toBe(`#${id.replace(/[-.]/g, "")}`);
    }
  });
});
