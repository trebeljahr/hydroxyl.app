import { describe, expect, it } from "vitest";

import { MAX_FRAGMENT_LENGTH, structureFromHash } from "./fragment";

describe("structureFromHash", () => {
  it("asks for nothing without a key=value fragment", () => {
    expect(structureFromHash("")).toEqual({ kind: "none" });
    expect(structureFromHash("#")).toEqual({ kind: "none" });
    // An anchor, not a request.
    expect(structureFromHash("#panel-2")).toEqual({ kind: "none" });
    expect(structureFromHash("#=CCO")).toEqual({ kind: "none" });
  });

  it("reads an encoded SMILES", () => {
    expect(structureFromHash(`#smiles=${encodeURIComponent("CC(=O)O")}`)).toEqual({
      kind: "structure",
      format: "smiles",
      text: "CC(=O)O",
    });
  });

  it("keeps a literal + as a charge, not a space", () => {
    // URLSearchParams would hand RDKit `[NH4 ]`.
    const read = structureFromHash("#smiles=[NH4+].[Cl-]");
    expect(read).toEqual({ kind: "structure", format: "smiles", text: "[NH4+].[Cl-]" });
  });

  it("reads an encoded molfile with its newlines and spacing intact", () => {
    const molfile = "Ethanol\n  sketch\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\nM  END\n";
    const read = structureFromHash(`#molfile=${encodeURIComponent(molfile)}`);
    expect(read).toEqual({ kind: "structure", format: "molfile", text: molfile });
  });

  it("refuses an unknown key, naming it", () => {
    const read = structureFromHash("#inchi=InChI%3D1S%2FCH4%2Fh1H4");
    expect(read.kind).toBe("refused");
    if (read.kind !== "refused") return;
    expect(read.message).toContain("“inchi”");
  });

  it("refuses broken percent-encoding and an empty value", () => {
    expect(structureFromHash("#smiles=%E0%A4%A").kind).toBe("refused");
    expect(structureFromHash("#smiles=").kind).toBe("refused");
    expect(structureFromHash("#molfile=%20%0A").kind).toBe("refused");
  });

  it("refuses a fragment over the limit before decoding it", () => {
    const body = `smiles=${"C".repeat(MAX_FRAGMENT_LENGTH)}`;
    const read = structureFromHash(`#${body}`);
    expect(read.kind).toBe("refused");
    if (read.kind !== "refused") return;
    expect(read.message).toContain("100,000");
    // One character under the limit still reads.
    const fits = `smiles=${"C".repeat(MAX_FRAGMENT_LENGTH - "smiles=".length)}`;
    expect(structureFromHash(`#${fits}`).kind).toBe("structure");
  });
});
