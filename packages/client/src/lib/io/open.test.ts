import { describe, expect, it, vi } from "vitest";

import { elementCounts, medianBondLength } from "@starter/chem-core";
import { createDocument, encodeDocument } from "@starter/shared";

import { INCHI_UNSUPPORTED, openText, THREE_D_NOTE, type RdkitImportBridge } from "./open";
import {
  BENZENE_INCHI,
  BENZENE_MOLBLOCK,
  SHORT_BOND_ETHANE_MOLBLOCK,
  SURPLUS_BLOCK_MOLBLOCK,
  THREE_RECORD_SDF,
} from "./fixtures";

/** A bridge that records whether anything asked for it. The RDKit import in
 *  `open.ts` is dynamic, so "a molfile does not start the worker" is provable
 *  here rather than only in a browser. */
function countingBridge(): { load: () => Promise<RdkitImportBridge>; calls: number } {
  const state = { load: async () => bridge, calls: 0 };
  const bridge: RdkitImportBridge = {
    fromSmiles: vi.fn(),
  };
  const load = async (): Promise<RdkitImportBridge> => {
    state.calls++;
    return Promise.resolve(bridge);
  };
  state.load = load;
  return state as { load: () => Promise<RdkitImportBridge>; calls: number };
}

describe("importing a molfile", () => {
  it("reads it with no RDKit anywhere near it", async () => {
    const rdkit = countingBridge();
    const result = await openText(BENZENE_MOLBLOCK, {
      name: "whatever.txt",
      loadRdkit: rdkit.load,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents).toHaveLength(1);
    expect(elementCounts(result.value.documents[0]!.molecule)).toEqual({ C: 6, H: 6 });
    // THE POINT OF THE TEST. Dropping a structure the client can read itself
    // must not fetch 6.9 MB of wasm.
    expect(rdkit.calls).toBe(0);
  });

  it("takes the title from the record, not from the filename", async () => {
    const result = await openText(BENZENE_MOLBLOCK, { name: "download (3).mol" });
    expect(result.ok && result.value.documents[0]?.metadata.title).toBe("Benzene");
  });

  it("falls back to the filename when the record has no title", async () => {
    const untitled = BENZENE_MOLBLOCK.replace(/^Benzene\n/, "\n");
    const result = await openText(untitled, { name: "my-arene.mol" });
    expect(result.ok && result.value.documents[0]?.metadata.title).toBe("my-arene");
  });

  it("surfaces a lossy read verbatim instead of importing part of a structure", async () => {
    // `surplus-block` is classified LOSSY by @/lib/rdkit/translate, so this is
    // a REFUSAL rather than a banner — the guard exists because a counts field
    // overflowing past 999 silently drops most of a structure. What this test
    // pins is that the reason reaches the caller rather than being flattened.
    const result = await openText(SURPLUS_BLOCK_MOLBLOCK);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/without dropping part of it/i);
  });
});

describe("an import drawn at another tool's bond length", () => {
  it("is scaled so its median bond is one standard bond", async () => {
    const result = await openText(SHORT_BOND_ETHANE_MOLBLOCK, { name: "ethane.mol" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const molecule = result.value.documents[0]!.molecule;
    expect(medianBondLength(molecule)).toBeCloseTo(1, 12);
    expect(elementCounts(molecule)).toEqual({ C: 2, H: 6 });
  });

  it("leaves a file already at the standard bond exactly as written", async () => {
    const result = await openText(BENZENE_MOLBLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const molecule = result.value.documents[0]!.molecule;
    const first = molecule.atoms[molecule.atomIds[0]!]!;
    // 0 / -1.5 in the file, divided by the shared 1.5 — no rescale on top.
    expect(first.pos).toEqual({ x: 0, y: -1 });
  });
});

describe("importing an SDF", () => {
  it("makes N documents, not N fragments on one canvas (decision 7)", async () => {
    const rdkit = countingBridge();
    const result = await openText(THREE_RECORD_SDF, {
      name: "catalogue.sdf",
      loadRdkit: rdkit.load,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents).toHaveLength(3);
    expect(result.value.documents.map((doc) => doc.metadata.title)).toEqual([
      "Benzene",
      "Ethanol",
      "Water-ish",
    ]);
    // Three separate molecules, each whole: a merge would show as one
    // document with eleven atoms.
    expect(result.value.documents.map((doc) => doc.molecule.atomIds.length)).toEqual([
      6, 3, 2,
    ]);
    expect(rdkit.calls).toBe(0);
  });

  it("gives every document its own id, so they do not overwrite each other", async () => {
    const result = await openText(THREE_RECORD_SDF, { name: "catalogue.sdf" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = new Set(result.value.documents.map((doc) => doc.id));
    expect(ids.size).toBe(3);
  });

  it("keeps the good records when one of them cannot be read", async () => {
    const withBadRecord = `${THREE_RECORD_SDF}not a molblock at all\n$$$$\n`;
    const result = await openText(withBadRecord, { name: "catalogue.sdf" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents).toHaveLength(3);
    expect(result.value.warnings.join(" ")).toMatch(/1 of 4 records/);
  });
});

describe("importing a native sketch", () => {
  it("round-trips a document through its own JSON", async () => {
    const doc = createDocument({ title: "Saved sketch", now: "2024-01-01T00:00:00.000Z" });
    const result = await openText(JSON.stringify(encodeDocument(doc)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents[0]).toEqual(doc);
  });

  it("refuses a document from a newer schema rather than truncating it", async () => {
    const result = await openText('{"schemaVersion":99,"id":"doc_1"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/newer version/i);
  });

  it("names what is wrong with a malformed sketch", async () => {
    const result = await openText('{"schemaVersion":1,"id":"doc_1"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/could not be read/i);
  });
});

describe("importing a SMILES", () => {
  it("is the one path that reaches for RDKit", async () => {
    const bridge: RdkitImportBridge = {
      fromSmiles: vi.fn(async () =>
        Promise.resolve({
          ok: true as const,
          value: { molecule: createDocument().molecule, title: "" },
          report: {
            severity: "clean" as const,
            coordinates: "generated" as const,
            warnings: [],
            notes: [],
            diffs: [],
            verification: "not-applicable" as const,
          },
        }),
      ),
    };
    let loads = 0;
    const result = await openText("c1ccccc1", {
      loadRdkit: async () => {
        loads++;
        return Promise.resolve(bridge);
      },
    });
    expect(loads).toBe(1);
    expect(bridge.fromSmiles).toHaveBeenCalledWith("c1ccccc1");
    expect(result.ok).toBe(true);
  });
});

describe("importing an InChI", () => {
  it("refuses by name rather than mislabelling it a bad SMILES", async () => {
    // The bundled RDKit build has no InChI reader — `get_mol` dispatches the
    // string as a SMILES and fails. `inchi.node.test.ts` pins the measurement.
    const rdkit = countingBridge();
    const result = await openText(BENZENE_INCHI, { loadRdkit: rdkit.load });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(INCHI_UNSUPPORTED);
    expect(rdkit.calls).toBe(0);
  });
});

describe("importing something else entirely", () => {
  it("says so instead of half-reading it", async () => {
    const result = await openText("Dear editor, please find attached\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/does not look like/i);
  });
});

describe("a flattened 3D conformer", () => {
  it("imports, and says the layout is worth regenerating", async () => {
    // PubChem's default SDF download trips this on every file: nonzero z
    // coordinates, which the 2D model drops.
    const threeD = BENZENE_MOLBLOCK.replace(
      "    0.0000   -1.5000    0.0000 C",
      "    0.0000   -1.5000    0.9000 C",
    );
    const result = await openText(threeD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsLayout).toBe(true);
    expect(result.value.warnings).toContain(THREE_D_NOTE);
  });
});
