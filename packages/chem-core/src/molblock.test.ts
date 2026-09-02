import { describe, expect, it } from "vitest";

import { benzene, MoleculeBuilder, buildMolecule } from "./builders.js";
import { elementCounts, molecularFormula, netCharge } from "./formula.js";
import { hasAromaticFlags } from "./aromatic.js";
import { requireAtom, requireBond, bonds as bondList, atoms as atomList } from "./molecule.js";
import { MOLFILE_BOND_LENGTH, MolblockLabelError, writeMolblock } from "./molblock-write.js";
import { MolblockParseError, readMolblock } from "./molblock-read.js";
import type { Molecule } from "./types.js";
import { flipBond } from "./ops.js";
import { flipAtoms, verticalMirror } from "./transform.js";
import { bondOrderSum } from "./valence.js";
import { vec } from "./vec.js";

// ---------------------------------------------------------------------------
// Real molecules, not synthetic graphs. A failure in one of these reads as a
// chemistry error ("acetate lost its charge") rather than a graph error.
// ---------------------------------------------------------------------------

/** CH3-CH2-OH */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const o = b.atom("O", vec(1.73, 0));
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** CH3-CO-O(-) */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", vec(0, 0));
    const carbonyl = b.atom("C", vec(0.87, 0.5));
    const doubleO = b.atom("O", vec(0.87, 1.5));
    const anionO = b.atom("O", vec(1.73, 0), { charge: -1 });
    b.bond(methyl, carbonyl, 1);
    b.bond(carbonyl, doubleO, 2);
    b.bond(carbonyl, anionO, 1);
  });
}

/** (CH3)2SO2 — the hypervalent-sulfur case the valence list exists for. */
function dimethylSulfone(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 0));
    const o1 = b.atom("O", vec(0, 1));
    const o2 = b.atom("O", vec(0, -1));
    const c1 = b.atom("C", vec(-1, 0));
    const c2 = b.atom("C", vec(1, 0));
    b.bond(s, o1, 2);
    b.bond(s, o2, 2);
    b.bond(s, c1, 1);
    b.bond(s, c2, 1);
  });
}

/** Pyrrole in Kekule form. The N-H is what hydrogen assertions exist for. */
function pyrrole(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", vec(0, 1));
    const c2 = b.atom("C", vec(0.95, 0.31));
    const c3 = b.atom("C", vec(0.59, -0.81));
    const c4 = b.atom("C", vec(-0.59, -0.81));
    const c5 = b.atom("C", vec(-0.95, 0.31));
    b.bond(n, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, n, 1);
  });
}

/**
 * Bromochlorofluoromethane, a genuine stereocentre, with the wedge drawn from
 * the carbon out to the bromine.
 *
 * The bromine is added FIRST on purpose, so the wedge runs from a higher row
 * number to a lower one. A writer that emitted `to` before `from` would
 * produce a file that still parses, still draws, and describes the opposite
 * enantiomer.
 */
function bromochlorofluoromethane(): Molecule {
  const builder = new MoleculeBuilder();
  const br = builder.atom("Br", vec(0, 1));
  const c = builder.atom("C", vec(0, 0));
  const f = builder.atom("F", vec(-0.87, -0.5));
  const cl = builder.atom("Cl", vec(0.87, -0.5));
  builder.bond(c, br, 1, "wedge");
  builder.bond(c, f, 1);
  builder.bond(c, cl, 1);
  return builder.build();
}

function roundTrip(mol: Molecule): Molecule {
  return readMolblock(writeMolblock(mol)).molecule;
}

function molblock(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

/** Benzene with every ring bond written as V2000 type 4 (aromatic). */
const AROMATIC_BENZENE = molblock(
  "benzene",
  "  chemcore          2D",
  "",
  "  6  6  0  0  0  0  0  0  0  0999 V2000",
  "    0.0000    1.5000    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "    1.2990    0.7500    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "    1.2990   -0.7500    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "    0.0000   -1.5000    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "   -1.2990   -0.7500    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "   -1.2990    0.7500    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
  "  1  2  4  0  0  0  0",
  "  2  3  4  0  0  0  0",
  "  3  4  4  0  0  0  0",
  "  4  5  4  0  0  0  0",
  "  5  6  4  0  0  0  0",
  "  6  1  4  0  0  0  0",
  "M  END",
);

describe("writeMolblock", () => {
  it("puts a fixed program line and no timestamp in the header", () => {
    const text = writeMolblock(ethanol(), { title: "ethanol" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("ethanol");
    expect(lines[1]).toBe("  chemcore          2D");
    expect(lines[1]).not.toMatch(/\d{4}/);
  });

  it("is byte-identical across two calls on the same molecule", () => {
    const mol = acetate();
    expect(writeMolblock(mol)).toBe(writeMolblock(mol));
  });

  it("ends with M  END and a trailing newline", () => {
    const text = writeMolblock(benzene());
    expect(text.endsWith("M  END\n")).toBe(true);
  });

  it("writes coordinates scaled but never flipped in y", () => {
    // Molfile coordinates are y-up, exactly like the model's. Only the SVG
    // renderer flips, and it flips at the renderer.
    const mol = buildMolecule((b) => {
      b.atom("C", vec(2, 3));
    });
    const atomLine = writeMolblock(mol).split("\n")[4] ?? "";
    expect(atomLine.slice(0, 10)).toBe("    3.0000");
    expect(atomLine.slice(10, 20)).toBe("    4.5000");
    expect(atomLine.slice(20, 30)).toBe("    0.0000");
    expect(MOLFILE_BOND_LENGTH).toBe(1.5);
  });

  it("honours a coordinateScale override", () => {
    const mol = buildMolecule((b) => {
      b.atom("C", vec(2, 0));
    });
    const atomLine = writeMolblock(mol, { coordinateScale: 1 }).split("\n")[4] ?? "";
    expect(atomLine.slice(0, 10)).toBe("    2.0000");
  });

  it("asserts the implicit hydrogen count as hhh = count + 1", () => {
    const lines = writeMolblock(ethanol()).split("\n");
    // Row 1 is the methyl carbon (3 H), row 3 the hydroxyl oxygen (1 H).
    expect((lines[4] ?? "").slice(42, 45)).toBe("  4");
    expect((lines[6] ?? "").slice(42, 45)).toBe("  2");
  });

  it("emits from before to, so a wedge keeps its narrow end", () => {
    const lines = writeMolblock(bromochlorofluoromethane()).split("\n");
    // Carbon is row 2, bromine row 1: from-first means "  2  1", not "  1  2".
    expect(lines[8]).toBe("  2  1  1  1  0  0  0");
  });

  it("refuses to export a display label, naming the atom", () => {
    const mol = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const r = b.atom("C", vec(1, 0), { label: "Ph" });
      b.bond(c, r, 1);
    });
    const labelled = mol.atomIds[1] ?? "";
    let caught: unknown;
    try {
      writeMolblock(mol);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MolblockLabelError);
    const error = caught as MolblockLabelError;
    expect(error.atomIds).toEqual([labelled]);
    expect(error.message).toContain(labelled);
    expect(error.message).toContain("Ph");
  });

  it("sets the chiral flag only when a wedge or hash is present", () => {
    const flat = writeMolblock(ethanol()).split("\n")[3] ?? "";
    const chiral = writeMolblock(bromochlorofluoromethane()).split("\n")[3] ?? "";
    expect(flat.slice(12, 15)).toBe("  0");
    expect(chiral.slice(12, 15)).toBe("  1");
  });
});

describe("write -> read round trip", () => {
  const cases: [string, () => Molecule][] = [
    ["benzene", () => benzene()],
    ["ethanol", ethanol],
    ["acetate", acetate],
    ["dimethyl sulfone", dimethylSulfone],
    ["pyrrole", pyrrole],
    ["bromochlorofluoromethane", bromochlorofluoromethane],
  ];

  for (const [name, make] of cases) {
    it(`preserves the formula and charge of ${name}`, () => {
      const original = make();
      const restored = roundTrip(original);
      expect(elementCounts(restored)).toEqual(elementCounts(original));
      expect(netCharge(restored)).toBe(netCharge(original));
      expect(restored.atomIds).toHaveLength(original.atomIds.length);
      expect(restored.bondIds).toHaveLength(original.bondIds.length);
    });
  }

  it("keeps a wedge's narrow end on the same atom", () => {
    const restored = roundTrip(bromochlorofluoromethane());
    const wedge = bondList(restored).find((bond) => bond.stereo === "wedge");
    expect(wedge).toBeDefined();
    // Asserted on the ELEMENTS at each end, not on row indices: the whole
    // failure mode is a file whose rows are in a different order than the
    // stereochemistry it means.
    expect(requireAtom(restored, wedge?.from ?? "").element).toBe("C");
    expect(requireAtom(restored, wedge?.to ?? "").element).toBe("Br");
  });

  it("restores coordinates in model units", () => {
    const restored = roundTrip(ethanol());
    const first = requireAtom(restored, restored.atomIds[0] ?? "");
    const second = requireAtom(restored, restored.atomIds[1] ?? "");
    expect(first.pos.x).toBeCloseTo(0, 3);
    expect(first.pos.y).toBeCloseTo(0, 3);
    expect(second.pos.x).toBeCloseTo(0.87, 3);
    expect(second.pos.y).toBeCloseTo(0.5, 3);
  });

  it("round-trips charges beyond the legacy column's range through M  CHG", () => {
    // Ti(4+) is the kind of counterion an SDF really carries, and +4 is
    // exactly what the legacy ccc column (which stops at +-3) cannot say.
    const mol = buildMolecule((b) => {
      b.atom("Ti", vec(0, 0), { charge: 4 });
    });
    const text = writeMolblock(mol);
    expect(text).toContain("M  CHG  1   1   4");
    // ...and the legacy column must be zero, because an M CHG line supersedes
    // it wholesale; a nonzero leftover there is how charges get doubled.
    expect((text.split("\n")[4] ?? "").slice(36, 39)).toBe("  0");

    const restored = readMolblock(text).molecule;
    expect(netCharge(restored)).toBe(4);
  });

  it("round-trips a -2 charge, an isotope and a radical", () => {
    const mol = buildMolecule((b) => {
      b.atom("O", vec(0, 0), { charge: -2 });
      b.atom("C", vec(1, 0), { isotope: 13 });
      b.atom("O", vec(2, 0), { radicalElectrons: 1 });
    });
    const text = writeMolblock(mol);
    expect(text).toContain("M  CHG");
    expect(text).toContain("M  ISO  1   2  13");
    // One unpaired electron is a doublet, spin multiplicity 2.
    expect(text).toContain("M  RAD  1   3   2");

    const restored = readMolblock(text).molecule;
    const restoredAtoms = atomList(restored);
    expect(restoredAtoms[0]?.charge).toBe(-2);
    expect(restoredAtoms[1]?.isotope).toBe(13);
    expect(restoredAtoms[2]?.radicalElectrons).toBe(1);
    expect(netCharge(restored)).toBe(-2);
  });

  it("round-trips every bond stereo, including either", () => {
    const mol = buildMolecule((b) => {
      const a = b.atom("C", vec(0, 0));
      const c = b.atom("C", vec(1, 0));
      const d = b.atom("C", vec(2, 0));
      const e = b.atom("C", vec(3, 0));
      const f = b.atom("C", vec(4, 0));
      b.bond(a, c, 1, "wedge");
      b.bond(c, d, 1, "hash");
      b.bond(d, e, 1, "wavy");
      b.bond(e, f, 2, "either");
    });
    const restored = roundTrip(mol);
    expect(bondList(restored).map((bond) => bond.stereo)).toEqual([
      "wedge",
      "hash",
      "wavy",
      "either",
    ]);
  });

  it("carries the title and comment", () => {
    const result = readMolblock(
      writeMolblock(ethanol(), { title: "ethanol", comment: "from the test" }),
    );
    expect(result.title).toBe("ethanol");
    expect(result.comment).toBe("from the test");
    expect(result.warnings).toEqual([]);
  });
});

describe("hydrogen assertions", () => {
  it("leaves explicitHydrogenCount unset when the file agrees with valence", () => {
    const restored = roundTrip(ethanol());
    for (const atom of atomList(restored)) {
      // The KEY must be absent, not merely undefined: `Object.hasOwn` is how
      // the rest of the package asks whether a count is pinned, and a pin
      // freezes the atom so later edits stop adjusting its hydrogens.
      expect(Object.hasOwn(atom, "explicitHydrogenCount")).toBe(false);
    }
  });

  it("leaves pyrrole's nitrogen unpinned but still bearing its hydrogen", () => {
    const restored = roundTrip(pyrrole());
    const nitrogen = atomList(restored).find((atom) => atom.element === "N");
    expect(nitrogen).toBeDefined();
    expect(Object.hasOwn(nitrogen ?? {}, "explicitHydrogenCount")).toBe(false);
    expect(elementCounts(restored)).toEqual({ C: 4, H: 5, N: 1 });
  });

  it("pins the count only where the file disagrees with valence", () => {
    // A carbon with three drawn bonds normally carries one hydrogen; this file
    // asserts none, which is a carbon radical/carbanion drawn without a marker
    // and cannot be recovered from valence alone.
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  4  3  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  1  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "   -0.7500    1.3000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "   -0.7500   -1.3000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  1  3  1  0  0  0  0",
      "  1  4  1  0  0  0  0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    const atomsRead = atomList(molecule);
    expect(atomsRead[0]?.explicitHydrogenCount).toBe(0);
    for (const atom of atomsRead.slice(1)) {
      expect(Object.hasOwn(atom, "explicitHydrogenCount")).toBe(false);
    }
    expect(elementCounts(molecule)).toEqual({ C: 4, H: 9 });
  });

  it("falls back to the vvv valence field when hhh is unspecified", () => {
    // hhh = 0 ("not specified") and vvv = 4: RDKit's way of pinning a
    // tetravalent carbon. One bond is drawn, so three hydrogens are asserted.
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  4  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 O   0  0  0  0  0 15  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    // vvv = 15 means "valence zero", so the oxygen is an alkoxide-like O with
    // no hydrogens at all rather than the one valence would derive.
    expect(elementCounts(molecule)).toEqual({ C: 1, H: 3, O: 1 });
    expect(atomList(molecule)[1]?.explicitHydrogenCount).toBe(0);
  });
});

describe("aromatic bond type 4", () => {
  it("imports kekulised, with no aromatic flags left", () => {
    const { molecule, warnings } = readMolblock(AROMATIC_BENZENE);
    expect(warnings).toEqual([]);
    for (const bond of bondList(molecule)) expect(bond.aromatic).toBe(false);
    for (const atom of atomList(molecule)) expect(atom.aromatic).toBe(false);
    for (const atomId of molecule.atomIds) {
      // Integral at every ring atom is the point: a half-integer sum means an
      // aromatic flag survived and valence is being computed at 1.5 per bond.
      expect(Number.isInteger(bondOrderSum(molecule, atomId))).toBe(true);
    }
    expect(bondList(molecule).filter((b) => b.order === 2)).toHaveLength(3);
    expect(elementCounts(molecule)).toEqual({ C: 6, H: 6 });
  });

  it("gives thiophene the right formula despite the flagged-valence defect", () => {
    // An aromatic bond weighs 1.5 in valence.ts, which makes a flagged
    // thiophene sulfur sum to 3 and invent a hydrogen (C4H5S). Kekulising on
    // import is what keeps the imported molecule out of that state.
    const text = molblock(
      "thiophene",
      "  chemcore          2D",
      "",
      "  5  5  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    1.5000    0.0000 S   0  0  0  1  0  0  0  0  0  0  0  0",
      "    1.4265    1.0365    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    1.4265   -0.4635    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    0.0000   -0.9270    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "   -1.4265   -0.4635    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "  1  2  4  0  0  0  0",
      "  2  3  4  0  0  0  0",
      "  3  4  4  0  0  0  0",
      "  4  5  4  0  0  0  0",
      "  5  1  4  0  0  0  0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    expect(elementCounts(molecule)).toEqual({ C: 4, H: 4, S: 1 });
    for (const bond of bondList(molecule)) expect(bond.aromatic).toBe(false);
  });

  it("kekulises aromatic pyrrole using the file's N-H assertion", () => {
    const text = molblock(
      "pyrrole",
      "  chemcore          2D",
      "",
      "  5  5  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    1.5000    0.0000 N   0  0  0  2  0  0  0  0  0  0  0  0",
      "    1.4265    1.0365    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    1.4265   -0.4635    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    0.0000   -0.9270    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "   -1.4265   -0.4635    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "  1  2  4  0  0  0  0",
      "  2  3  4  0  0  0  0",
      "  3  4  4  0  0  0  0",
      "  4  5  4  0  0  0  0",
      "  5  1  4  0  0  0  0",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(warnings).toEqual([]);
    expect(elementCounts(molecule)).toEqual({ C: 4, H: 5, N: 1 });
  });

  it("writes type 4 for a bond the model has flagged aromatic", () => {
    const { molecule } = readMolblock(AROMATIC_BENZENE);
    // Re-flag one bond by hand to prove the writer honours the flag.
    const bondId = molecule.bondIds[0] ?? "";
    const flagged: Molecule = {
      ...molecule,
      bonds: {
        ...molecule.bonds,
        [bondId]: { ...requireBond(molecule, bondId), aromatic: true },
      },
    };
    expect(writeMolblock(flagged).split("\n")[10]).toBe("  1  2  4  0  0  0  0");
  });
});

describe("the `either` bond stereo", () => {
  // These guard the BondStereo member that the codec added. They live here
  // rather than in transform.test.ts because they exist for this feature: a
  // future edit that folds `either` back into `wavy`, or that treats it as an
  // out-of-plane direction, breaks the molfile mapping first.

  it("reads V2000 stereo code 3 as either and writes it back as 3", () => {
    // 2-butene with the geometry of the central double bond undetermined —
    // the crossed double bond, which is code 3 and only ever appears on a
    // double bond.
    const text = molblock(
      "2-butene, geometry undetermined",
      "  chemcore          2D",
      "",
      "  4  3  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "    1.2990    0.7500    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    2.5981    0.0000    0.0000 C   0  0  0  2  0  0  0  0  0  0  0  0",
      "    3.8971    0.7500    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  2  3  2  3  0  0  0",
      "  3  4  1  0  0  0  0",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(warnings).toEqual([]);
    const middle = bondList(molecule)[1];
    expect(middle?.order).toBe(2);
    expect(middle?.stereo).toBe("either");
    expect(elementCounts(molecule)).toEqual({ C: 4, H: 8 });
    expect(writeMolblock(molecule).split("\n")[9]).toBe("  2  3  2  3  0  0  0");
  });

  it("survives a mirror unchanged, unlike wedge and hash", () => {
    // A mirror image is the opposite enantiomer, so wedge and hash exchange.
    // `either` and `wavy` state that the configuration is UNDETERMINED, and an
    // undetermined configuration has no handedness to reverse.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", vec(0, 0));
      const c = b.atom("C", vec(1, 0));
      const d = b.atom("C", vec(2, 0));
      const e = b.atom("C", vec(3, 0));
      const f = b.atom("C", vec(4, 0));
      b.bond(a, c, 1, "wedge");
      b.bond(c, d, 1, "hash");
      b.bond(d, e, 1, "wavy");
      b.bond(e, f, 2, "either");
    });
    const flipped = flipAtoms(mol, [...mol.atomIds], verticalMirror(vec(0, 0)));
    expect(bondList(flipped).map((bond) => bond.stereo)).toEqual([
      "hash",
      "wedge",
      "wavy",
      "either",
    ]);
  });

  it("is untouched by flipBond, which inverts a wedge geometrically", () => {
    // Reversing the endpoints already inverts a wedge, because the narrow end
    // is defined as sitting at `from`. There is nothing for it to do to a bond
    // whose configuration was never stated.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", vec(0, 0));
      const c = b.atom("C", vec(1, 0));
      b.bond(a, c, 2, "either");
    });
    const bondId = mol.bondIds[0] ?? "";
    const flipped = flipBond(mol, bondId);
    expect(requireBond(flipped, bondId).stereo).toBe("either");
    expect(requireBond(flipped, bondId).from).toBe(mol.atomIds[1]);
  });
});

describe("reader tolerance", () => {
  const BASE_BODY = [
    "  3  2  0  0  0  0  0  0  0  0999 V2000",
    "    0.0000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
    "    1.5000    0.0000    0.0000 C   0  0  0  3  0  0  0  0  0  0  0  0",
    "    3.0000    0.0000    0.0000 O   0  0  0  2  0  0  0  0  0  0  0  0",
  ];

  function withBonds(bondCount: number, ...bondLines: string[]): string {
    const counts = `  3${String(bondCount).padStart(3, " ")}  0  0  0  0  0  0  0  0999 V2000`;
    return molblock(
      "ethanol",
      "  chemcore          2D",
      "",
      counts,
      ...BASE_BODY.slice(1),
      ...bondLines,
      "M  END",
    );
  }

  it("warns and skips a duplicate bond row instead of throwing", () => {
    const result = readMolblock(
      withBonds(3, "  1  2  1  0  0  0  0", "  2  3  1  0  0  0  0", "  2  1  1  0  0  0  0"),
    );
    expect(result.molecule.bondIds).toHaveLength(2);
    expect(result.warnings.map((w) => w.kind)).toEqual(["duplicate-bond"]);
    expect(elementCounts(result.molecule)).toEqual({ C: 2, H: 6, O: 1 });
  });

  it("warns and skips a self bond", () => {
    const result = readMolblock(
      withBonds(3, "  1  2  1  0  0  0  0", "  2  3  1  0  0  0  0", "  2  2  1  0  0  0  0"),
    );
    expect(result.molecule.bondIds).toHaveLength(2);
    expect(result.warnings.map((w) => w.kind)).toEqual(["self-bond"]);
  });

  it("warns and skips an out-of-range bond index", () => {
    const result = readMolblock(
      withBonds(3, "  1  2  1  0  0  0  0", "  2  3  1  0  0  0  0", "  2  9  1  0  0  0  0"),
    );
    expect(result.molecule.bondIds).toHaveLength(2);
    const warning = result.warnings[0];
    expect(warning?.kind).toBe("bad-bond-endpoint");
    expect(warning?.message).toContain("9");
  });

  it("warns and skips an unknown element symbol, dropping its bonds", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 R#  0  0  0  0  0  0  0  0  0  0  0  0",
      "    3.0000    0.0000    0.0000 O   0  0  0  2  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  2  3  1  0  0  0  0",
      "M  END",
    );
    const result = readMolblock(text);
    expect(result.molecule.atomIds).toHaveLength(2);
    expect(result.molecule.bondIds).toHaveLength(0);
    expect(result.warnings.map((w) => w.kind)).toEqual([
      "unknown-element",
      "bad-bond-endpoint",
      "bad-bond-endpoint",
    ]);
  });

  it("warns on a garbage numeric field and reads the row anyway", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
      "     bogus    0.0000    0.0000 O   0  0  0  2  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    );
    const result = readMolblock(text);
    expect(result.warnings.map((w) => w.kind)).toEqual(["bad-numeric-field"]);
    expect(elementCounts(result.molecule)).toEqual({ C: 1, H: 4, O: 1 });
  });

  it("warns on an unsupported query bond type and reads it as single", () => {
    const result = readMolblock(
      withBonds(2, "  1  2  1  0  0  0  0", "  2  3  6  0  0  0  0"),
    );
    expect(result.warnings.map((w) => w.kind)).toEqual(["unsupported-bond-type"]);
    expect(bondList(result.molecule)[1]?.order).toBe(1);
  });

  it("parses CRLF line endings", () => {
    const text = writeMolblock(ethanol()).replace(/\n/g, "\r\n");
    const result = readMolblock(text);
    expect(result.warnings).toEqual([]);
    expect(elementCounts(result.molecule)).toEqual({ C: 2, H: 6, O: 1 });
  });

  it("tolerates truncated lines, a missing M  END and leading blank lines", () => {
    const text = molblock(
      "",
      "",
      "",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  4",
      "    1.5000    0.0000    0.0000 O   0  0  0  2",
      "  1  2  1",
    );
    const result = readMolblock(text);
    expect(result.warnings).toEqual([]);
    expect(elementCounts(result.molecule)).toEqual({ C: 1, H: 4, O: 1 });
  });

  it("warns when the file ends inside the atom block", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  3  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  4  0  0  0  0  0  0  0  0",
    );
    const result = readMolblock(text);
    expect(result.warnings.map((w) => w.kind)).toEqual(["truncated-block"]);
    expect(result.molecule.atomIds).toHaveLength(1);
  });

  it("ignores unknown M property lines", () => {
    const text = writeMolblock(ethanol()).replace("M  END", "M  STY  1   1 DAT\nM  END");
    const result = readMolblock(text);
    expect(result.warnings).toEqual([]);
    expect(elementCounts(result.molecule)).toEqual({ C: 2, H: 6, O: 1 });
  });

  it("lets M  CHG supersede a stale legacy charge column", () => {
    // ccc = 3 says "+1"; the M CHG line says the molecule is neutral. The spec
    // makes the property line win wholesale, which is the only rule that keeps
    // a file written by a modern program from being read twice over.
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  1  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 N   0  3  0  4  0  0  0  0  0  0  0  0",
      "M  CHG  0",
      "M  END",
    );
    expect(netCharge(readMolblock(text).molecule)).toBe(0);
  });

  it("reads the legacy charge column when no M  CHG line exists", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  1  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 N   0  3  0  5  0  0  0  0  0  0  0  0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    expect(netCharge(molecule)).toBe(1);
    expect(elementCounts(molecule)).toEqual({ H: 4, N: 1 });
  });

  it("reads the legacy doublet-radical code and the legacy mass difference", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  2  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  4  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 C   1  0  0  0  0  0  0  0  0  0  0  0",
      "M  END",
    );
    const restored = atomList(readMolblock(text).molecule);
    expect(restored[0]?.radicalElectrons).toBe(1);
    expect(restored[0]?.charge).toBe(0);
    // dd is RELATIVE: carbon's 12 plus one.
    expect(restored[1]?.isotope).toBe(13);
  });

  it("warns when a property line names an atom that does not exist", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  1  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "M  CHG  1   7  -1",
      "M  END",
    );
    const result = readMolblock(text);
    expect(result.warnings.map((w) => w.kind)).toEqual(["property-index-out-of-range"]);
    expect(netCharge(result.molecule)).toBe(0);
  });

  it("does not resolve a row index through the prototype chain", () => {
    // The row -> id mapping is an ARRAY, so a bond row can never name
    // "constructor" or "__proto__"; a numeric index out of range is simply out
    // of range. Guard against a future refactor to a plain object.
    const result = readMolblock(
      withBonds(1, "  1  0  1  0  0  0  0"),
    );
    expect(result.molecule.bondIds).toHaveLength(0);
    expect(result.warnings.map((w) => w.kind)).toEqual(["bad-bond-endpoint"]);
  });

  it("stops at an SDF record separator", () => {
    const text = `${writeMolblock(ethanol())}$$$$\nM  CHG  1   1  -1\n`;
    expect(netCharge(readMolblock(text).molecule)).toBe(0);
  });

  it("throws MolblockParseError on text that is not a molblock", () => {
    expect(() => readMolblock("hello")).toThrow(MolblockParseError);
    expect(() => readMolblock("one\ntwo\nthree\nnot a counts line\n")).toThrow(
      MolblockParseError,
    );
  });

  it("throws MolblockParseError on V3000 rather than reading it as empty", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  0  0  0  0  0  0  0  0  0  0999 V3000",
      "M  V30 BEGIN CTAB",
      "M  END",
    );
    expect(() => readMolblock(text)).toThrow(MolblockParseError);
  });
});


/**
 * A five- or six-membered all-type-4 ring with the hhh column left at 0 —
 * "not specified", which is the shape a real aromatic-form record from Marvin
 * or ChemDraw has. Every aromatic test above hands the reader an hhh column
 * that pre-solves the kekulisation; this one does not, which is the case the
 * N-H heterocycles actually fail on.
 */
function aromaticRing(title: string, elements: readonly string[]): string {
  const n = elements.length;
  const lines = [
    title,
    "  Mrv1810 04122318072D",
    "",
    `${String(n).padStart(3)}${String(n).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
  ];
  elements.forEach((element, i) => {
    const angle = (2 * Math.PI * i) / n;
    const x = (1.5 * Math.cos(angle)).toFixed(4).padStart(10);
    const y = (1.5 * Math.sin(angle)).toFixed(4).padStart(10);
    lines.push(`${x}${y}    0.0000 ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  for (let i = 0; i < n; i++) {
    lines.push(
      `${String(i + 1).padStart(3)}${String(((i + 1) % n) + 1).padStart(3)}  4  0  0  0  0`,
    );
  }
  lines.push("M  END");
  return molblock(...lines);
}

/** Kekule thiophene, then flagged aromatic the way perception leaves it. */
function flaggedAromatic(mol: Molecule): Molecule {
  const atoms = { ...mol.atoms };
  for (const id of mol.atomIds) atoms[id] = { ...requireAtom(mol, id), aromatic: true };
  const bonds = { ...mol.bonds };
  for (const id of mol.bondIds) {
    bonds[id] = { ...requireBond(mol, id), order: 1, aromatic: true };
  }
  return { ...mol, atoms, bonds };
}

/** C4H4S in Kekule form: S1-C2=C3-C4=C5-S1. */
function thiophene(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 1));
    const c2 = b.atom("C", vec(0.95, 0.31));
    const c3 = b.atom("C", vec(0.59, -0.81));
    const c4 = b.atom("C", vec(-0.59, -0.81));
    const c5 = b.atom("C", vec(-0.95, 0.31));
    b.bond(s, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, s, 1);
  });
}

describe("fixed-column integrity", () => {
  const atomLines = (text: string): string[] => {
    const rows = text.split("\n");
    const count = Number.parseInt(rows[3]?.slice(0, 3) ?? "0", 10);
    return rows.slice(4, 4 + count);
  };

  it("keeps every atom line 69 characters at extreme coordinates", () => {
    // `padStart` cannot truncate, so an eleven-character coordinate used to
    // shift every later column: the symbol landed in the mass-difference
    // field and this package's own reader dropped the atom.
    const far = buildMolecule((b) => {
      b.atom("C", vec(0, 0));
      b.atom("N", vec(-7000, 3.25));
      b.atom("O", vec(80000, -80000));
    });
    const text = writeMolblock(far);
    for (const line of atomLines(text)) expect(line).toHaveLength(69);
    const { molecule, warnings } = readMolblock(text);
    expect(warnings).toEqual([]);
    expect(elementCounts(molecule)).toEqual(elementCounts(far));
  });

  it("trades decimals for integer digits rather than overflowing the field", () => {
    // A coordinate that wide has no meaningful fraction left, and the columns
    // still have to abut exactly where a fixed-column reader slices them.
    const text = writeMolblock(buildMolecule((b) => b.atom("C", vec(3, -4))), {
      coordinateScale: 1e5,
    });
    const line = atomLines(text)[0] ?? "";
    expect(line.slice(0, 10)).toBe("300000.000");
    expect(line.slice(10, 20)).toBe("-400000.00");
    expect(line).toHaveLength(69);
  });

  it("refuses a coordinate ten columns cannot hold at all", () => {
    const absurd = buildMolecule((b) => b.atom("C", vec(1e30, 0)));
    expect(() => writeMolblock(absurd)).toThrow(/coordinate field/);
  });
});

describe("hydrogen counts past what hhh can hold", () => {
  it("states them in the vvv valence field instead of clamping to H4", () => {
    // Clamping silently deleted two hydrogens from the exported molecule. The
    // reader already inverts vvv, because that is what RDKit writes.
    const pinned = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { explicitHydrogenCount: 6 });
    });
    const line = writeMolblock(pinned).split("\n")[4] ?? "";
    expect(line.slice(42, 45)).toBe("  0");
    expect(line.slice(48, 51)).toBe("  6");
    expect(elementCounts(roundTrip(pinned))).toEqual({ C: 1, H: 6 });
  });

  it("refuses a count that neither hhh nor vvv can express", () => {
    const absurd = buildMolecule((b) => {
      b.atom("C", vec(0, 0), { explicitHydrogenCount: 40 });
    });
    expect(() => writeMolblock(absurd)).toThrow(/valence field/);
  });
});

describe("property lines say only what will be read back", () => {
  it("writes no M  CHG or M  RAD for a value that truncates to zero", () => {
    // `charge` is typed `number`; 0.5 passed a `!== 0` guard and then wrote as
    // 0, producing an M  CHG line that per the spec zeroes every legacy ccc
    // column and says nothing in exchange.
    const odd = buildMolecule((b) => {
      b.atom("N", vec(0, 0), { charge: 0.5 });
      b.atom("C", vec(1, 0), { radicalElectrons: 0.5 });
    });
    const text = writeMolblock(odd);
    expect(text).not.toContain("M  CHG");
    expect(text).not.toContain("M  RAD");
  });

  it("writes no M  ISO for a mass number of zero", () => {
    const zero = buildMolecule((b) => b.atom("C", vec(0, 0), { isotope: 0 }));
    expect(writeMolblock(zero)).not.toContain("M  ISO");
  });

  it("reads M  ISO 0 as natural abundance, not as a nuclide of mass zero", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  1  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  5  0  0  0  0  0  0  0  0",
      "M  ISO  1   1   0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    const atom = requireAtom(molecule, molecule.atomIds[0] ?? "");
    expect(Object.hasOwn(atom, "isotope")).toBe(false);
  });
});

describe("aromatic records that do not assert their hydrogens", () => {
  it("kekulises pyrrole with no hhh column, giving it its N-H", () => {
    const { molecule, warnings } = readMolblock(aromaticRing("pyrrole", ["N", "C", "C", "C", "C"]));
    expect(warnings).toEqual([]);
    expect(hasAromaticFlags(molecule)).toBe(false);
    expect(molecularFormula(molecule)).toBe("C4H5N");
  });

  it("kekulises imidazole with no hhh column, pinning exactly one N-H", () => {
    // A molfile in aromatic form cannot say which nitrogen is the 1H one, so
    // either tautomer is a correct reading; what is not correct is the old
    // behaviour, which left the ring flagged and reported C3H3N2.
    const { molecule, warnings } = readMolblock(
      aromaticRing("imidazole", ["N", "C", "N", "C", "C"]),
    );
    expect(warnings).toEqual([]);
    expect(hasAromaticFlags(molecule)).toBe(false);
    expect(molecularFormula(molecule)).toBe("C3H4N2");
  });

  it("still reads the rings that never needed the retry", () => {
    for (const [name, elements, formula] of [
      ["benzene", ["C", "C", "C", "C", "C", "C"], "C6H6"],
      ["pyridine", ["N", "C", "C", "C", "C", "C"], "C5H5N"],
      ["furan", ["O", "C", "C", "C", "C"], "C4H4O"],
      ["thiophene", ["S", "C", "C", "C", "C"], "C4H4S"],
    ] as const) {
      const { molecule, warnings } = readMolblock(aromaticRing(name, elements));
      expect(warnings).toEqual([]);
      expect(hasAromaticFlags(molecule)).toBe(false);
      expect(molecularFormula(molecule)).toBe(formula);
    }
  });

  it("resolves the fused N-H heterocycles too", () => {
    // Indole, purine and benzimidazole: one N-H each, in a component spanning
    // two rings, so the candidate has to be picked by ring size rather than by
    // ring identity.
    const fused = (elements: readonly string[], bonds: readonly (readonly [number, number])[]): string => {
      const lines = [
        "fused",
        "  Mrv1810 04122318072D",
        "",
        `${String(elements.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
      ];
      elements.forEach((element, i) => {
        const angle = (2 * Math.PI * i) / elements.length;
        lines.push(
          `${(3 * Math.cos(angle)).toFixed(4).padStart(10)}` +
            `${(3 * Math.sin(angle)).toFixed(4).padStart(10)}` +
            `    0.0000 ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
        );
      });
      for (const [a, b] of bonds) {
        lines.push(`${String(a).padStart(3)}${String(b).padStart(3)}  4  0  0  0  0`);
      }
      lines.push("M  END");
      return molblock(...lines);
    };

    const indole = fused(
      ["N", "C", "C", "C", "C", "C", "C", "C", "C"],
      [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 4], [9, 1]],
    );
    const purine = fused(
      ["N", "C", "N", "C", "C", "C", "N", "C", "N"],
      [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1], [4, 9], [9, 8], [8, 7], [7, 5]],
    );
    for (const [text, formula] of [
      [indole, "C8H7N"],
      [purine, "C5H4N4"],
    ] as const) {
      const { molecule, warnings } = readMolblock(text);
      expect(warnings).toEqual([]);
      expect(hasAromaticFlags(molecule)).toBe(false);
      expect(molecularFormula(molecule)).toBe(formula);
    }
  });

  it("resolves every ring in a record holding many of them", () => {
    // The retry works per aromatic COMPONENT, not per molecule. Pinning one
    // candidate at a time across the whole structure would need one pass per
    // ring, so a record like this resolved none of them within any sane budget.
    const rings = 40;
    const lines = [
      "many pyrroles",
      "  Mrv1810 04122318072D",
      "",
      `${String(rings * 5).padStart(3)}${String(rings * 5).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ];
    for (let i = 0; i < rings * 5; i++) {
      const element = i % 5 === 0 ? "N" : "C";
      lines.push(
        `    0.0000    0.0000    0.0000 ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
      );
    }
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < 5; i++) {
        const a = r * 5 + i + 1;
        const b = r * 5 + ((i + 1) % 5) + 1;
        lines.push(`${String(a).padStart(3)}${String(b).padStart(3)}  4  0  0  0  0`);
      }
    }
    lines.push("M  END");
    const { molecule, warnings } = readMolblock(molblock(...lines));
    expect(warnings).toEqual([]);
    expect(hasAromaticFlags(molecule)).toBe(false);
    expect(elementCounts(molecule)).toEqual({ C: rings * 4, H: rings * 5, N: rings });
  });

  it("does not invent a hydrogen on a nitrogen the file already spoke for", () => {
    // N-methylpyrrole: the nitrogen has three connections, so it is not a
    // candidate for the retry's hydrogen and the ring resolves on its own.
    const text = molblock(
      "N-methylpyrrole",
      "  Mrv1810 04122318072D",
      "",
      "  6  6  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    1.5000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.4265    1.0365    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.4265   -0.4635    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000   -0.9270    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "   -1.4265   -0.4635    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    3.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  4  0  0  0  0",
      "  2  3  4  0  0  0  0",
      "  3  4  4  0  0  0  0",
      "  4  5  4  0  0  0  0",
      "  5  1  4  0  0  0  0",
      "  1  6  1  0  0  0  0",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(warnings).toEqual([]);
    expect(molecularFormula(molecule)).toBe("C5H7N");
  });
});

describe("round-tripping a model that carries aromatic flags", () => {
  it("does not invent a hydrogen pin on thiophene's sulfur", () => {
    // The writer used to derive hhh from the flagged molecule, where an
    // aromatic bond weighs 1.5 and the sulfur is credited with a hydrogen it
    // does not have. The reader then kekulised, correctly derived zero, saw
    // the file disagree, and PINNED the phantom hydrogen — turning a transient
    // valence bug into a stored one. hhh now comes from a kekulised view.
    const flagged = flaggedAromatic(thiophene());
    const { molecule, warnings } = readMolblock(writeMolblock(flagged));
    expect(warnings).toEqual([]);
    expect(elementCounts(molecule)).toEqual(elementCounts(thiophene()));
    for (const atom of atomList(molecule)) {
      expect(Object.hasOwn(atom, "explicitHydrogenCount")).toBe(false);
    }
  });

  it("still writes bond type 4, so the aromatic form survives the trip", () => {
    const text = writeMolblock(flaggedAromatic(thiophene()));
    expect(text.split("\n")[9]).toBe("  1  2  4  0  0  0  0");
  });

  it("keeps benzene's formula through the same path", () => {
    const flagged = flaggedAromatic(benzene());
    expect(elementCounts(roundTrip(flagged))).toEqual({ C: 6, H: 6 });
  });
});

describe("a counts line that disagrees with the body", () => {
  it("warns instead of silently dropping the surplus atom rows", () => {
    // A counts line whose atom field overflowed to `1000` reads as 100 atoms
    // and 0 bonds; the remaining 900 rows used to land in the property scan,
    // which ignores anything not starting with "M  ", so ninety per cent of
    // the structure disappeared with an empty warnings array.
    const rows = ["", "  chemcore          2D", "", "1000  0  0  0  0  0  0  0  0  0999 V2000"];
    for (let i = 0; i < 1000; i++) {
      rows.push("    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0");
    }
    rows.push("M  END");
    const { molecule, warnings } = readMolblock(molblock(...rows));
    expect(molecule.atomIds).toHaveLength(100);
    expect(warnings).toEqual([
      expect.objectContaining({ kind: "surplus-block", expected: 100, found: 1000 }),
    ]);
  });

  it("keeps the bond block aligned when the atom block runs long", () => {
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    3.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(molecule.bondIds).toHaveLength(1);
    expect(warnings.map((w) => w.kind)).toEqual(["surplus-block"]);
  });

  it("recovers the bonds and charges when the atom block runs short", () => {
    // Reading on at the offset the counts line implies used to consume the
    // bond row as an atom and then `M  CHG` as a bond, losing both and
    // reporting nine warnings that all described symptoms.
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  CHG  1   1   1",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(molecule.atomIds).toHaveLength(2);
    expect(molecule.bondIds).toHaveLength(1);
    expect(netCharge(molecule)).toBe(1);
    expect(warnings.map((w) => w.kind)).toEqual(["truncated-block", "truncated-block"]);
  });
});

describe("isotopes and dimensionality", () => {
  it("resolves the dd mass difference against the most abundant isotope", () => {
    // Rounding the standard atomic weight instead gives 80 for bromine, so
    // dd = 2 read 81-Br as 82-Br, a nuclide that does not exist. Selenium,
    // nickel, copper and zinc go the same way.
    const text = molblock(
      "",
      "  chemcore          2D",
      "",
      "  1  0  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 Br  2  0  0  0  0  0  0  0  0  0  0  0",
      "M  END",
    );
    const { molecule } = readMolblock(text);
    expect(requireAtom(molecule, molecule.atomIds[0] ?? "").isotope).toBe(81);
  });

  it("warns that a 3D record was flattened", () => {
    // PubChem's default SDF download is the 3D conformer, so this is the
    // likeliest file to be dragged in; the atoms arrive projected onto one
    // another with correct connectivity, which looks like a bad layout.
    const text = molblock(
      "2519",
      "  -OEChem-01012300003D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    1.2000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    0.0000   -1.2000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    );
    const { molecule, warnings } = readMolblock(text);
    expect(elementCounts(molecule)).toEqual({ C: 1, H: 4, O: 1 });
    expect(warnings).toEqual([
      expect.objectContaining({ kind: "three-dimensional", rows: [1, 2] }),
    ]);
  });

  it("says nothing about a flat record", () => {
    expect(readMolblock(writeMolblock(ethanol())).warnings).toEqual([]);
  });
});

describe("what the format cannot carry", () => {
  it("drops doubleBondSide, which V2000 has no field for", () => {
    // Pinned as a decision, not left as a surprise: unlike `label`, which
    // refuses to export because it changes WHICH molecule the file describes,
    // this changes only which side a double bond's second line is drawn on.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", vec(0, 0));
      const c = b.atom("C", vec(1, 0));
      b.bond(a, c, 2);
    });
    const bondId = mol.bondIds[0] ?? "";
    const sided: Molecule = {
      ...mol,
      bonds: { ...mol.bonds, [bondId]: { ...requireBond(mol, bondId), doubleBondSide: "left" } },
    };
    const back = roundTrip(sided);
    expect(requireBond(back, back.bondIds[0] ?? "").doubleBondSide).toBe("auto");
  });
});
