import { describe, expect, it } from "vitest";

import { hasAromaticFlags, isAromaticAtom } from "./aromatic.js";
import {
  dictionaryEntriesWithFormula,
  dictionaryEntryById,
  dictionaryMolecule,
  findDictionaryEntryByName,
  normalizeStructureName,
  parseSumFormula,
  searchDictionary,
  STRUCTURE_DICTIONARY,
  type DictionaryEntry,
} from "./dictionary.js";
import { molecularFormula, netCharge } from "./formula.js";
import * as M from "./molecule.js";
import { cipDescriptor, stereocenterAtoms } from "./stereo.js";
import { medianBondLength } from "./transform.js";
import { implicitHydrogenCount, valenceIssues } from "./valence.js";

function entry(id: string): DictionaryEntry {
  const found = dictionaryEntryById(id);
  if (found === undefined) throw new Error(`no dictionary entry ${id}`);
  return found;
}

function formulaOf(id: string): string {
  return molecularFormula(dictionaryMolecule(entry(id)));
}

/** CIP descriptors of every stereocentre, in the molblock's atom order. */
function descriptors(id: string): string[] {
  const mol = dictionaryMolecule(entry(id));
  return stereocenterAtoms(mol).map((atomId) => cipDescriptor(mol, atomId)?.kind ?? "none");
}

// ---------------------------------------------------------------------------
// The data itself
// ---------------------------------------------------------------------------

describe("the checked-in dictionary", () => {
  it("reads every molblock cleanly into a neutral, Kekule, correctly valent 2D structure", () => {
    for (const e of STRUCTURE_DICTIONARY) {
      const mol = dictionaryMolecule(e);
      expect(mol.atomIds.length, e.id).toBeGreaterThan(0);
      expect(valenceIssues(mol), e.id).toEqual([]);
      expect(netCharge(mol), e.id).toBe(0);
      // Aromaticity is perceived, never stored — the storage invariant every
      // other import path enforces.
      expect(hasAromaticFlags(mol), e.id).toBe(false);
      // At the standard bond, so an inserted structure matches what is drawn.
      if (mol.bondIds.length > 0) expect(medianBondLength(mol), e.id).toBeCloseTo(1, 3);
    }
  });

  it("has unique ids, and no name or synonym that points at two entries", () => {
    const ids = STRUCTURE_DICTIONARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const owner = new Map<string, string>();
    for (const e of STRUCTURE_DICTIONARY) {
      for (const spelling of [e.name, ...e.synonyms]) {
        const key = normalizeStructureName(spelling);
        const previous = owner.get(key);
        expect(previous === undefined || previous === e.id, `${spelling}: ${previous} and ${e.id}`).toBe(true);
        owner.set(key, e.id);
      }
    }
  });

  it("carries the real formulas of the compounds it names", () => {
    expect(formulaOf("water")).toBe("H2O");
    expect(formulaOf("ethanol")).toBe("C2H6O");
    expect(formulaOf("benzene")).toBe("C6H6");
    expect(formulaOf("caffeine")).toBe("C8H10N4O2");
    expect(formulaOf("aspirin")).toBe("C9H8O4");
    expect(formulaOf("paracetamol")).toBe("C8H9NO2");
    expect(formulaOf("dmso")).toBe("C2H6OS");
    expect(formulaOf("beta-d-glucopyranose")).toBe("C6H12O6");
    expect(formulaOf("beta-d-ribofuranose")).toBe("C5H10O5");
    expect(formulaOf("2-deoxy-beta-d-ribofuranose")).toBe("C5H10O4");
    expect(formulaOf("sucrose")).toBe("C12H22O11");
    expect(formulaOf("cholesterol")).toBe("C27H46O");
    expect(formulaOf("guanine")).toBe("C5H5N5O");
  });

  it("has all twenty proteinogenic amino acids, un-ionised", () => {
    const expected: Readonly<Record<string, string>> = {
      glycine: "C2H5NO2",
      "l-alanine": "C3H7NO2",
      "l-valine": "C5H11NO2",
      "l-leucine": "C6H13NO2",
      "l-isoleucine": "C6H13NO2",
      "l-proline": "C5H9NO2",
      "l-phenylalanine": "C9H11NO2",
      "l-tryptophan": "C11H12N2O2",
      "l-methionine": "C5H11NO2S",
      "l-serine": "C3H7NO3",
      "l-threonine": "C4H9NO3",
      "l-cysteine": "C3H7NO2S",
      "l-tyrosine": "C9H11NO3",
      "l-asparagine": "C4H8N2O3",
      "l-glutamine": "C5H10N2O3",
      "l-aspartic-acid": "C4H7NO4",
      "l-glutamic-acid": "C5H9NO4",
      "l-lysine": "C6H14N2O2",
      "l-arginine": "C6H14N4O2",
      "l-histidine": "C6H9N3O2",
    };
    const listed = STRUCTURE_DICTIONARY.filter((e) => e.category === "amino-acid").map((e) => e.id);
    expect([...listed].sort()).toEqual(Object.keys(expected).sort());
    for (const [id, formula] of Object.entries(expected)) expect(formulaOf(id), id).toBe(formula);
  });

  it("keeps hydrogens implicit: glycine's nitrogen carries two and its alpha carbon two", () => {
    const mol = dictionaryMolecule(entry("glycine"));
    const nitrogen = mol.atomIds.find((id) => M.requireAtom(mol, id).element === "N")!;
    expect(implicitHydrogenCount(mol, nitrogen)).toBe(2);
    const alpha = M.neighborIds(mol, nitrogen)[0]!;
    expect(implicitHydrogenCount(mol, alpha)).toBe(2);
  });

  it("states every amino acid's configuration: L is S, except cysteine, which is R", () => {
    for (const e of STRUCTURE_DICTIONARY.filter((x) => x.category === "amino-acid")) {
      const cip = descriptors(e.id);
      if (e.id === "glycine") expect(cip).toEqual([]);
      else if (e.id === "l-cysteine") expect(cip).toEqual(["R"]);
      else if (e.id === "l-threonine") expect(cip).toEqual(["R", "S"]);
      else if (e.id === "l-isoleucine") expect(cip).toEqual(["S", "S"]);
      else expect(cip, e.id).toEqual(["S"]);
    }
  });

  it("draws the sugars as the anomers their names say", () => {
    // Atom order is the SMILES order the generator was given: C5, C4, C3, C2,
    // C1 for the pyranoses. β-D-glucopyranose is (2R,3R,4S,5S,6R) as an
    // oxane, α differs only at the anomeric carbon, and galactose and mannose
    // are glucose's C4 and C2 epimers.
    expect(descriptors("beta-d-glucopyranose")).toEqual(["R", "S", "S", "R", "R"]);
    expect(descriptors("alpha-d-glucopyranose")).toEqual(["R", "S", "S", "R", "S"]);
    expect(descriptors("beta-d-galactopyranose")).toEqual(["R", "R", "S", "R", "R"]);
    expect(descriptors("beta-d-mannopyranose")).toEqual(["R", "S", "S", "S", "R"]);
    expect(descriptors("beta-d-ribofuranose")).toEqual(["R", "S", "R", "R"]);
  });

  it("leaves ibuprofen's centre unset, as the racemate it is sold as", () => {
    const mol = dictionaryMolecule(entry("ibuprofen"));
    expect(stereocenterAtoms(mol)).toHaveLength(1);
    for (const atomId of stereocenterAtoms(mol)) {
      expect(cipDescriptor(mol, atomId)?.kind).toBe("undetermined");
    }
  });

  it("stores caffeine's rings Kekule and perceives them aromatic", () => {
    const mol = dictionaryMolecule(entry("caffeine"));
    expect(mol.atomIds.some((id) => isAromaticAtom(mol, id))).toBe(true);
  });

  it("returns the same molecule instance for the same entry", () => {
    const e = entry("caffeine");
    expect(dictionaryMolecule(e)).toBe(dictionaryMolecule(e));
  });
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe("looking a structure up by name", () => {
  it("folds case, spacing, hyphens and Greek letters into one key", () => {
    expect(normalizeStructureName("β-D-Glucose")).toBe("betadglucose");
    expect(normalizeStructureName("beta d glucose")).toBe("betadglucose");
    // Digits stay: these are different compounds.
    expect(normalizeStructureName("1,4-dioxane")).not.toBe(normalizeStructureName("1,3-dioxane"));
  });

  it("resolves a bare sugar name to the anomer its entry declares", () => {
    expect(findDictionaryEntryByName("glucose")?.id).toBe("beta-d-glucopyranose");
    expect(findDictionaryEntryByName("Beta-D-Glucose")?.id).toBe("beta-d-glucopyranose");
    expect(findDictionaryEntryByName("α-D-glucose")?.id).toBe("alpha-d-glucopyranose");
    expect(findDictionaryEntryByName("fructose")?.id).toBe("beta-d-fructofuranose");
  });

  it("resolves abbreviations a bench chemist types", () => {
    expect(findDictionaryEntryByName("DMSO")?.id).toBe("dmso");
    expect(findDictionaryEntryByName("thf")?.id).toBe("thf");
    expect(findDictionaryEntryByName("Ala")?.id).toBe("l-alanine");
    expect(findDictionaryEntryByName("EtOAc")?.id).toBe("ethyl-acetate");
    expect(findDictionaryEntryByName("acetaminophen")?.id).toBe("paracetamol");
  });

  it("never completes a half-typed name", () => {
    expect(findDictionaryEntryByName("gluc")).toBeUndefined();
    expect(findDictionaryEntryByName("")).toBeUndefined();
    expect(findDictionaryEntryByName("ibuprofen sodium")).toBeUndefined();
  });

  it("suggests entries as the name is typed, the entry's own name first", () => {
    const suggestions = searchDictionary("gluc").map((m) => m.entry.id);
    expect(suggestions[0]).toBe("beta-d-glucopyranose");
    expect(suggestions).toContain("alpha-d-glucopyranose");
    expect(suggestions).toContain("aldehydo-d-glucose");
  });

  it("ranks an exact synonym above a longer name that merely starts the same", () => {
    const suggestions = searchDictionary("met");
    expect(suggestions[0]?.entry.id).toBe("l-methionine");
    expect(suggestions[0]?.kind).toBe("exact");
    expect(suggestions.map((m) => m.entry.id)).toContain("methanol");
  });

  it("offers nothing for one character, unless it is an exact name", () => {
    expect(searchDictionary("c")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sum formulas
// ---------------------------------------------------------------------------

describe("a sum formula", () => {
  it("parses in any order, with subscripts and repeated symbols adding up", () => {
    expect(parseSumFormula("C6H12O6")).toEqual({ C: 6, H: 12, O: 6 });
    expect(parseSumFormula("C₆H₁₂O₆")).toEqual({ C: 6, H: 12, O: 6 });
    expect(parseSumFormula("H2O")).toEqual({ H: 2, O: 1 });
    expect(parseSumFormula("CH3COOH")).toEqual({ C: 2, H: 4, O: 2 });
    expect(parseSumFormula("NaCl")).toEqual({ Na: 1, Cl: 1 });
  });

  it("is case-sensitive the way chemistry is", () => {
    expect(parseSumFormula("Co")).toEqual({ Co: 1 });
    expect(parseSumFormula("CO")).toEqual({ C: 1, O: 1 });
  });

  it("refuses text that is not a formula", () => {
    for (const text of ["glucose", "c1ccccc1", "Ph", "DMSO", "C0", "", "C6H12O6+"]) {
      expect(parseSumFormula(text), text).toBeUndefined();
    }
  });

  it("names every hexose in the list for C6H12O6, never just one", () => {
    const ids = dictionaryEntriesWithFormula(parseSumFormula("C6H12O6")!).map((e) => e.id);
    expect([...ids].sort()).toEqual(
      [
        "aldehydo-d-glucose",
        "alpha-d-glucopyranose",
        "beta-d-fructofuranose",
        "beta-d-galactopyranose",
        "beta-d-glucopyranose",
        "beta-d-mannopyranose",
        "keto-d-fructose",
      ].sort(),
    );
  });

  it("finds a unique match when the list holds only one compound of that composition", () => {
    expect(dictionaryEntriesWithFormula(parseSumFormula("C8H10N4O2")!).map((e) => e.id)).toEqual(["caffeine"]);
    expect(dictionaryEntriesWithFormula(parseSumFormula("H2O")!).map((e) => e.id)).toEqual(["water"]);
    expect(dictionaryEntriesWithFormula(parseSumFormula("CH3COOH")!).map((e) => e.id)).toEqual(["acetic-acid"]);
  });

  it("matches nothing when no listed compound has that composition", () => {
    // Dimethyl ether and ethanol are both C2H6O; only ethanol is listed, so
    // this is ethanol — but CO (carbon monoxide) is not listed at all.
    expect(dictionaryEntriesWithFormula(parseSumFormula("C2H6O")!).map((e) => e.id)).toEqual(["ethanol"]);
    expect(dictionaryEntriesWithFormula(parseSumFormula("CO")!)).toEqual([]);
  });
});
