import { describe, expect, it, vi } from "vitest";

import { benzene, elementCounts, medianBondLength, molecularFormula } from "@starter/chem-core";
import * as dictionary from "@starter/chem-core/dictionary";
import { createDocument, encodeDocument } from "@starter/shared";

import type { ChemIoResult, ImportedStructure } from "@/lib/rdkit/types";

import {
  interpretInsertText,
  looksLikeSmiles,
  resolveInsertCandidate,
  type InsertCandidate,
} from "./insert";
import { BENZENE_INCHI, BENZENE_MOLBLOCK, THREE_RECORD_SDF } from "./fixtures";
import { INCHI_UNSUPPORTED, type RdkitImportBridge } from "./open";

function read(text: string) {
  return interpretInsertText(text, dictionary);
}

function ids(candidates: readonly InsertCandidate[]): string[] {
  return candidates.map((c) => (c.kind === "entry" ? `${c.via}:${c.entry.id}` : c.kind));
}

/** A bridge that counts how often it is loaded, answering every SMILES with
 *  benzene — enough to prove WHICH readings reach RDKit at all. */
function countingBridge(): { readonly load: () => Promise<RdkitImportBridge>; readonly calls: () => number } {
  let calls = 0;
  const bridge: RdkitImportBridge = {
    fromSmiles: vi.fn(
      async (): Promise<ChemIoResult<ImportedStructure>> =>
        ({
          ok: true,
          value: { molecule: benzene(1.5), title: "" },
          report: { warnings: [] },
        }) as unknown as ChemIoResult<ImportedStructure>,
    ),
  };
  return {
    load: async () => {
      calls++;
      return bridge;
    },
    calls: () => calls,
  };
}

describe("looksLikeSmiles", () => {
  it("accepts the organic subset outside brackets and anything inside them", () => {
    for (const text of ["CCO", "c1ccccc1", "CC(=O)Oc1ccccc1C(=O)O", "[Na+].[Cl-]", "c1cc[nH]c1", "[13CH4]", "ClCCl", "CO"]) {
      expect(looksLikeSmiles(text), text).toBe(true);
    }
  });

  it("rejects names, abbreviations and formulas with a bare H", () => {
    for (const text of ["glucose", "caffeine", "Ph", "DMSO", "NEt3", "C2H6O", "diethyl ether", "2-methylpropan-1-ol"]) {
      expect(looksLikeSmiles(text), text).toBe(false);
    }
  });
});

describe("reading the insert box", () => {
  it("offers nothing and says nothing for an empty box", () => {
    expect(read("   ")).toEqual({ candidates: [], notice: null, refusal: null });
  });

  it("resolves a bare sugar name to the anomer the dictionary declares, and lists the other forms after it", () => {
    const { candidates, refusal } = read("glucose");
    expect(refusal).toBeNull();
    expect(ids(candidates)[0]).toBe("name:beta-d-glucopyranose");
    expect(ids(candidates)).toContain("suggestion:alpha-d-glucopyranose");
    expect(ids(candidates)).toContain("suggestion:aldehydo-d-glucose");
    // "glucose" is not SMILES-shaped, so no SMILES reading is offered for it.
    expect(ids(candidates)).not.toContain("smiles");
  });

  it("offers every listed hexose for C6H12O6 and says why it will not pick one", () => {
    const { candidates, notice } = read("C6H12O6");
    expect(candidates).toHaveLength(7);
    expect(candidates.every((c) => c.kind === "entry" && c.via === "formula")).toBe(true);
    expect(notice).toContain("C₆H₁₂O₆ matches 7 compounds in the built-in list");
    expect(notice).toContain("does not name one structure");
  });

  it("reads a formula with a single listed match, and still says it was read as a formula", () => {
    const { candidates, notice } = read("C2H6O");
    expect(ids(candidates)).toEqual(["formula:ethanol"]);
    expect(notice).toContain("matches one compound");
  });

  it("refuses a formula nothing in the list has, and names the rule", () => {
    const { candidates, notice, refusal } = read("C4H10");
    expect(candidates).toEqual([]);
    expect(notice).toContain("No compound in the built-in list has the formula C₄H₁₀");
    // The notice already says why; the generic refusal would repeat it.
    expect(refusal).toBeNull();
  });

  it("puts the SMILES reading first for SMILES, with no name suggestions under it", () => {
    // "CO" is methanol as a SMILES; "alcohol" and "glucose" contain c-o but
    // are not what was meant.
    expect(ids(read("CO").candidates)).toEqual(["smiles"]);
    expect(ids(read("CC(=O)Oc1ccccc1C(=O)O").candidates)).toEqual(["smiles"]);
  });

  it("keeps an exact name ahead of everything", () => {
    expect(ids(read("DMSO").candidates)[0]).toBe("name:dmso");
    expect(ids(read("Ala").candidates)[0]).toBe("name:l-alanine");
  });

  it("refuses a name outside the list without pretending to look it up", () => {
    const { candidates, refusal } = read("2-methylpropan-1-ol");
    expect(candidates).toEqual([]);
    expect(refusal).toContain("is not a name in the built-in list");
    expect(refusal).toContain("cannot be looked up");
  });

  it("reads a molfile as a molfile and offers nothing else", () => {
    expect(ids(read(BENZENE_MOLBLOCK).candidates)).toEqual(["molblock"]);
  });

  it("sends a multi-record SDF, a saved sketch and an InChI elsewhere", () => {
    expect(read(THREE_RECORD_SDF).refusal).toContain("That SDF holds 3 structures");
    const sketch = JSON.stringify(encodeDocument(createDocument({ title: "x" })));
    expect(read(sketch).refusal).toContain("That is a saved sketch");
    expect(read(BENZENE_INCHI).refusal).toBe(INCHI_UNSUPPORTED);
  });
});

describe("resolving the chosen reading", () => {
  it("reads a dictionary entry with no RDKit anywhere near it", async () => {
    const rdkit = countingBridge();
    const [first] = read("caffeine").candidates;
    const result = await resolveInsertCandidate("caffeine", first!, dictionary, { loadRdkit: rdkit.load });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(molecularFormula(result.value.molecule)).toBe("C8H10N4O2");
    expect(result.value.title).toBe("caffeine");
    expect(rdkit.calls()).toBe(0);
  });

  it("reads a pasted molfile with chem-core's reader, at the standard bond", async () => {
    const rdkit = countingBridge();
    const result = await resolveInsertCandidate(BENZENE_MOLBLOCK, { kind: "molblock" }, dictionary, {
      loadRdkit: rdkit.load,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(elementCounts(result.value.molecule)).toEqual({ C: 6, H: 6 });
    expect(medianBondLength(result.value.molecule)).toBeCloseTo(1, 3);
    expect(result.value.title).toBe("Benzene");
    expect(rdkit.calls()).toBe(0);
  });

  it("hands a SMILES to RDKit and normalises what comes back", async () => {
    const rdkit = countingBridge();
    const result = await resolveInsertCandidate(" c1ccccc1 ", { kind: "smiles" }, dictionary, {
      loadRdkit: rdkit.load,
    });
    expect(rdkit.calls()).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(medianBondLength(result.value.molecule)).toBeCloseTo(1, 3);
    expect(result.value.title).toBe("c1ccccc1");
  });

  it("reports a reader that could not be loaded instead of throwing", async () => {
    const result = await resolveInsertCandidate("CCO", { kind: "smiles" }, dictionary, {
      loadRdkit: () => Promise.reject(new Error("offline")),
    });
    expect(result).toEqual({ ok: false, message: "The structure reader could not be loaded: offline" });
  });
});
