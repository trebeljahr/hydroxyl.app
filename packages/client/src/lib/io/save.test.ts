import { describe, expect, it } from "vitest";

import { benzene, buildMolecule, setLabel } from "@starter/chem-core";
import { createDocument, decodeDocument } from "@starter/shared";

import { fileBaseName, serializeForExport } from "./save";

const NOW = "2024-01-01T00:00:00.000Z";

describe("exporting a native sketch", () => {
  it("round-trips through its own JSON", () => {
    const doc = createDocument({ title: "Benzene", molecule: benzene(), now: NOW });
    const result = serializeForExport(doc, "sketch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeDocument(JSON.parse(result.text))).toEqual(doc);
    expect(result.filename).toBe("Benzene.hydroxyl.json");
  });
});

describe("exporting a molfile", () => {
  it("writes a V2000 record RDKit will read as C6H6", () => {
    const doc = createDocument({ title: "Benzene", molecule: benzene(), now: NOW });
    const result = serializeForExport(doc, "mol");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("V2000");
    expect(result.text).toContain("M  END");
    // `hydrogenAssertion: "valence"`, not the CTfile `hhh` QUERY field — a
    // file written with the default arrives at RDKit as a query molecule with
    // no hydrogens, silently, with an empty log. The wrapper in
    // @/lib/rdkit/translate is what enforces it, and using it rather than
    // `writeMolblock` directly is the point.
    expect(result.text).toMatch(/^ {2}6 {2}6/m);
    expect(result.filename).toBe("Benzene.mol");
  });

  it("REFUSES an atom carrying a cosmetic label, naming it (decision 8)", () => {
    // A `Ph` written as a bare methyl is a wrong structure in someone's paper.
    // `writeMolblock` throws `MolblockLabelError` and the wrapper turns it into
    // a `labelled-atoms` failure; this asserts the message survives instead of
    // being flattened to "export failed".
    const labelled = setLabel(
      buildMolecule((b) => {
        const a = b.atom("C", { x: 0, y: 0 });
        const c = b.atom("C", { x: 1.5, y: 0 });
        b.bond(a, c);
      }),
      "a1",
      "Ph",
    );
    const doc = createDocument({ title: "Labelled", molecule: labelled, now: NOW });
    const result = serializeForExport(doc, "mol");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/label/i);
  });
});

describe("the filename", () => {
  it("strips characters a filesystem refuses, and never produces an empty name", () => {
    expect(fileBaseName(createDocument({ title: "a/b:c*d?", now: NOW }))).toBe("a-b-c-d");
    expect(fileBaseName(createDocument({ title: "   ", now: NOW }))).toBe("sketch");
  });
});
