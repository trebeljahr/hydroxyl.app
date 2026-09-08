import { describe, expect, it } from "vitest";

import {
  countSdfRecords,
  needsRdkit,
  sniffFormat,
  splitSdfRecords,
} from "./sniff";
import {
  BENZENE_INCHI,
  BENZENE_MOLBLOCK,
  ETHANOL_MOLBLOCK,
  THREE_RECORD_SDF,
} from "./fixtures";

describe("content sniffing", () => {
  it("recognises a molblock by its counts line and M  END, not by an extension", () => {
    expect(sniffFormat(BENZENE_MOLBLOCK)).toEqual({ kind: "molblock" });
  });

  it("recognises a molblock pasted with leading blank lines", () => {
    // How text pasted out of a web form arrives, and what chem-core's own
    // `findRecordStart` allows for.
    expect(sniffFormat(`\n\n${BENZENE_MOLBLOCK}`)).toEqual({ kind: "molblock" });
  });

  it("refuses to call a bare line of digits a molblock", () => {
    // chem-core's `parseCounts` accepts `999` on its own, which is why the
    // sniffer demands `M  END` as well.
    expect(sniffFormat("a\nb\nc\n999\nd").kind).not.toBe("molblock");
  });

  it("refuses to call a file with M  END and no counts line a molblock", () => {
    expect(sniffFormat("some prose\nM  END\n").kind).not.toBe("molblock");
  });

  it("calls a multi-record file an SDF and counts its records", () => {
    expect(sniffFormat(THREE_RECORD_SDF)).toEqual({ kind: "sdf", records: 3 });
    expect(countSdfRecords(THREE_RECORD_SDF)).toBe(3);
  });

  it("splits an SDF into records that are themselves readable molblocks", () => {
    const records = splitSdfRecords(THREE_RECORD_SDF);
    expect(records).toHaveLength(3);
    for (const record of records) expect(sniffFormat(record).kind).toBe("molblock");
  });

  it("calls a single molblock ending in $$$$ an SDF of one record", () => {
    expect(sniffFormat(`${BENZENE_MOLBLOCK}$$$$\n`)).toEqual({ kind: "sdf", records: 1 });
  });

  it("recognises a native sketch by parsing it, not by its brace", () => {
    expect(sniffFormat('{"schemaVersion":1,"id":"doc_1"}')).toEqual({ kind: "json" });
    expect(sniffFormat("{not json at all").kind).not.toBe("json");
  });

  it("recognises an InChI by its mandated prefix", () => {
    expect(sniffFormat(BENZENE_INCHI)).toEqual({ kind: "inchi" });
  });

  describe("the SMILES residue", () => {
    // SQUARE BRACKETS ARE ORDINARY SMILES. Read the rule as "short and
    // bracket-free" and every charged and every isotopically-labelled
    // structure is refused, which is most of what anyone pastes.
    it.each([
      "c1ccccc1",
      "CCO",
      "C",
      "[O-]",
      "[nH]1cccc1",
      "C[N+](=O)[O-]",
      "[13CH4]",
      "CC(=O)[O-].[Na+]",
      "N[C@@H](C)C(=O)O",
    ])("accepts %s", (smiles) => {
      expect(sniffFormat(smiles)).toEqual({ kind: "smiles" });
    });

    it("rejects prose, markup and an empty string", () => {
      for (const text of ["hello there", "<svg></svg>", "", "   "]) {
        expect(sniffFormat(text).kind, text).toBe("unknown");
      }
    });
  });

  it("says which formats need the wasm, and molfiles are not among them", () => {
    expect(needsRdkit(sniffFormat(BENZENE_MOLBLOCK))).toBe(false);
    expect(needsRdkit(sniffFormat(THREE_RECORD_SDF))).toBe(false);
    expect(needsRdkit(sniffFormat('{"schemaVersion":1}'))).toBe(false);
    expect(needsRdkit(sniffFormat("c1ccccc1"))).toBe(true);
    expect(needsRdkit(sniffFormat(BENZENE_INCHI))).toBe(true);
  });

  it("does not confuse two structures for one another", () => {
    expect(sniffFormat(ETHANOL_MOLBLOCK).kind).toBe("molblock");
  });
});
