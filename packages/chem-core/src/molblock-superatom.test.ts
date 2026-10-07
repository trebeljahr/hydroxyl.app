import { describe, expect, it } from "vitest";

import { abbreviationsOf, collapseAbbreviation } from "./abbreviations.js";
import { benzene, linearChain } from "./builders.js";
import { molecularFormula } from "./formula.js";
import { attachGroupToAtom } from "./groups.js";
import { readMolblock } from "./molblock-read.js";
import { MolblockLabelError, writeMolblock } from "./molblock-write.js";
import { setLabel } from "./ops.js";
import type { AtomId, Molecule } from "./types.js";

/**
 * Superatom S-groups (decision 225): a contracted abbreviation goes out as a
 * `SUP` group over its real atoms and comes back contracted. The V2000 lines
 * below are byte-for-byte what RDKit 2025.03 writes for the same group
 * (measured); `superatom-fidelity.node.test.ts` in the client re-proves it
 * against the wasm.
 */

/** N-methyl Boc carbamate, CNC(=O)OC(C)(C)C, with Boc contracted. Rows: the
 *  chain C1 N2, then the stamp's seven atoms 3..9; the bond joining them is
 *  row 8, after the stamp's own six. */
function bocMethylamine(): { mol: Molecule; boc: readonly AtomId[] } {
  const chain = linearChain(1);
  const amine = attachGroupToAtom(chain, chain.atomIds[0]!, "NH2");
  const boc = attachGroupToAtom(amine.molecule, amine.atomIds[0]!, "Boc");
  return { mol: collapseAbbreviation(boc.molecule, boc.atomIds, "Boc"), boc: boc.atomIds };
}

function propertyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("M  ") && !line.startsWith("M  V30"));
}

describe("writing a superatom", () => {
  it("writes V2000 STY, SAL, SBL, SMT and SAP in RDKit's widths", () => {
    const { mol } = bocMethylamine();
    expect(propertyLines(writeMolblock(mol))).toEqual([
      "M  STY  1   1 SUP",
      "M  SAL   1  7   3   4   5   6   7   8   9",
      "M  SBL   1  1   8",
      "M  SMT   1 Boc",
      "M  SAP   1  1   3   2  1",
      "M  END",
    ]);
  });

  it("writes a V3000 SGROUP block and counts it", () => {
    const { mol } = bocMethylamine();
    const text = writeMolblock(mol, { version: "V3000" });
    expect(text).toContain("M  V30 COUNTS 9 8 1 0 0");
    expect(text).toContain(
      "M  V30 BEGIN SGROUP\nM  V30 1 SUP 0 ATOMS=(7 3 4 5 6 7 8 9) XBONDS=(1 8) LABEL=Boc SAP=(3 3 2 1)\nM  V30 END SGROUP",
    );
  });

  it("splits SAL past fifteen atoms and folds subscripts to ASCII", () => {
    const ring = benzene();
    const ts = attachGroupToAtom(ring, ring.atomIds[0]!, "Ts");
    const ester = attachGroupToAtom(ts.molecule, ring.atomIds[3]!, "CO2Me");
    const mol = collapseAbbreviation(ester.molecule, ester.atomIds, "CO₂Me");
    const lines = propertyLines(writeMolblock(mol));
    expect(lines).toContain("M  SMT   1 CO2Me");

    const chain = linearChain(18);
    const long = collapseAbbreviation(chain, chain.atomIds.slice(1), "C17");
    const sal = propertyLines(writeMolblock(long)).filter((line) => line.startsWith("M  SAL"));
    expect(sal).toHaveLength(2);
    expect(sal[0]).toMatch(/^M {2}SAL {3}1 15/);
    expect(sal[1]).toMatch(/^M {2}SAL {3}1 {2}2/);
  });

  it("writes nothing for a group that is not contracted right now (decision 240)", () => {
    const { mol, boc } = bocMethylamine();
    const ringed = { ...mol, abbreviations: [{ label: "Boc", atomIds: boc.slice(1) }] };
    expect(propertyLines(writeMolblock(ringed))).toEqual(["M  END"]);
  });

  it("still refuses a cosmetic label with no atoms behind it (decision 8, narrowed)", () => {
    const mol = setLabel(linearChain(2), linearChain(2).atomIds[0]!, "Ph");
    expect(() => writeMolblock(mol)).toThrow(MolblockLabelError);
  });
});

describe("reading a superatom", () => {
  it("round-trips V2000 and V3000 with the label on the same atoms", () => {
    const { mol } = bocMethylamine();
    for (const version of ["V2000", "V3000"] as const) {
      const read = readMolblock(writeMolblock(mol, { version }));
      expect(read.warnings).toEqual([]);
      expect(molecularFormula(read.molecule)).toBe("C6H13NO2");
      expect(abbreviationsOf(read.molecule)).toEqual([
        { label: "Boc", atomIds: read.molecule.atomIds.slice(2) },
      ]);
    }
  });

  it("sets the digits of a label back as subscripts", () => {
    const ring = benzene();
    const ester = attachGroupToAtom(ring, ring.atomIds[0]!, "CO2Me");
    const mol = collapseAbbreviation(ester.molecule, ester.atomIds, "CO₂Me");
    expect(abbreviationsOf(readMolblock(writeMolblock(mol)).molecule)[0]?.label).toBe("CO₂Me");
  });

  it("drops an expanded SUP without a word: the file says draw the atoms", () => {
    const { mol } = bocMethylamine();
    const v2 = writeMolblock(mol).replace("M  END", "M  SDS EXP  1   1\nM  END");
    expect(abbreviationsOf(readMolblock(v2).molecule)).toEqual([]);
    expect(readMolblock(v2).warnings).toEqual([]);
    const v3 = writeMolblock(mol, { version: "V3000" }).replace("LABEL=Boc", "LABEL=Boc ESTATE=E");
    expect(abbreviationsOf(readMolblock(v3).molecule)).toEqual([]);
  });

  it("reads a quoted V3000 label", () => {
    const { mol } = bocMethylamine();
    const v3 = writeMolblock(mol, { version: "V3000" }).replace("LABEL=Boc", 'LABEL="t Boc"');
    expect(abbreviationsOf(readMolblock(v3).molecule)[0]?.label).toBe("t Boc");
  });

  it("keeps the atoms and warns when a SUP names an atom the file lacks", () => {
    const { mol } = bocMethylamine();
    const text = writeMolblock(mol).replace("M  SAL   1  7   3", "M  SAL   1  7  99");
    const read = readMolblock(text);
    expect(read.warnings.map((w) => w.kind)).toEqual(["dropped-superatom"]);
    expect(abbreviationsOf(read.molecule)).toEqual([]);
    expect(molecularFormula(read.molecule)).toBe("C6H13NO2");
  });

  it("reports a non-SUP V3000 S-group and reads the rest", () => {
    const { mol } = bocMethylamine();
    const text = writeMolblock(mol, { version: "V3000" }).replace(
      "M  V30 END SGROUP",
      'M  V30 2 DAT 0 ATOMS=(1 1) FIELDNAME=note\nM  V30 END SGROUP',
    );
    const read = readMolblock(text);
    expect(read.warnings.map((w) => w.kind)).toEqual(["unsupported-sgroup"]);
    expect(abbreviationsOf(read.molecule)).toHaveLength(1);
  });
});
