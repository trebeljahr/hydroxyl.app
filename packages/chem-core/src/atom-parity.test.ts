/**
 * The V2000 atom parity column (decision 207), on the RDKit reference set.
 *
 * The literal digits below are the CTfile rule applied by hand AND what
 * RDKit 2025.03.4's own writer puts in the column for the same centre (it
 * writes the column for 3D blocks; the client's projection harness re-checks
 * it on every Fischer it lifts). (R)-glyceraldehyde's C2 has neighbours C1
 * (row 2), O (row 4) and C3 (row 5) plus its implicit H: the order is
 * CHO, OH, CH2OH, H, an odd permutation of CIP priority, so the (R) centre
 * reads counter-clockwise, 2. (1S)-(1-2H1)ethanol's order is CH3, OH, ²H, H
 * (a hydrogen atom goes after the heavy ones whatever its row), which RDKit
 * writes as 1.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stereoConfigFromAtomParities } from "./atom-parity.js";
import { readMolblock } from "./molblock-read.js";
import { writeMolblock } from "./molblock-write.js";
import { setBondStereo } from "./ops.js";
import { descriptorFromConfig, stereoConfig, type StereoConfig } from "./stereo-config.js";
import type { AtomId, Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

/** The `sss` column of every atom line, by row. */
function parityColumn(molblock: string): string[] {
  const lines = molblock.split("\n");
  const atoms = Number.parseInt(lines[3]!.slice(0, 3), 10);
  return lines.slice(4, 4 + atoms).map((line) => line.slice(39, 42).trim());
}

function letters(mol: Molecule, config: StereoConfig): Record<AtomId, string> {
  const out: Record<AtomId, string> = {};
  for (const centre of config.centres) {
    const d = descriptorFromConfig(mol, centre, config);
    out[centre.atomId] = d === undefined ? "none" : d.kind === "undetermined" ? `undetermined:${d.reason}` : d.kind;
  }
  return out;
}

/** The drawing with every wedge and hash removed: nothing left to carry configuration. */
function unmarked(mol: Molecule): Molecule {
  let out = mol;
  for (const id of mol.bondIds) if (mol.bonds[id]!.stereo !== "none") out = setBondStereo(out, id, "none");
  return out;
}

describe("the V2000 atom parity column (decision 207)", () => {
  it("writes 0 everywhere unless asked, so every existing file is byte-for-byte unchanged", () => {
    const mol = load("r-glyceraldehyde.mol");
    expect(parityColumn(writeMolblock(mol))).toEqual(["0", "0", "0", "0", "0", "0"]);
  });

  it("writes (R)-glyceraldehyde's C2 as 2 and (S) as 1, as RDKit's writer does", () => {
    const r = load("r-glyceraldehyde.mol");
    const s = load("s-glyceraldehyde.mol");
    expect(parityColumn(writeMolblock(r, { atomParity: stereoConfig(r) }))).toEqual(["0", "0", "2", "0", "0", "0"]);
    expect(parityColumn(writeMolblock(s, { atomParity: stereoConfig(s) }))).toEqual(["0", "0", "1", "0", "0", "0"]);
  });

  it("counts a deuterium atom after the heavy neighbours and before the implicit hydrogen", () => {
    const mol = load("chd-ethanol.mol");
    expect(mol.atoms["a3"]).toMatchObject({ element: "H", isotope: 2 });
    expect(parityColumn(writeMolblock(mol, { atomParity: stereoConfig(mol) }))).toEqual(["0", "1", "0", "0"]);
  });

  it("writes 0 for a sulfoxide's sulfur, whose fourth ligand is a lone pair, as RDKit does", () => {
    const mol = load("methyl-p-tolyl-sulfoxide.mol");
    const config = stereoConfig(mol);
    expect(config.centres.map((c) => [c.atomId, c.lonePair])).toEqual([["a2", true]]);
    expect(parityColumn(writeMolblock(mol, { atomParity: config })).every((digit) => digit === "0")).toBe(true);
    const read = readMolblock(writeMolblock(unmarked(mol), { atomParity: config }));
    expect(stereoConfigFromAtomParities(read.molecule, read.atomParities).centres[0]!.reading).toEqual({
      kind: "undetermined",
      reason: "unspecified",
    });
  });

  it("carries every centre of the reference set through a file with NO wedges, and nothing else does", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".mol")).sort();
    let carried = 0;
    for (const file of files) {
      const mol = load(file);
      const config = stereoConfig(mol);
      const before = letters(mol, config);
      const bare = unmarked(mol);
      const read = readMolblock(writeMolblock(bare, { atomParity: config }));
      // The wedges are gone, so the drawing alone states no centre...
      for (const centre of stereoConfig(read.molecule).centres) {
        expect(centre.reading.kind, `${file} ${centre.atomId} from the bare drawing`).toBe("undetermined");
      }
      // ...and the parity column states every one the molfile can hold.
      const fromParity = stereoConfigFromAtomParities(read.molecule, read.atomParities);
      const after = letters(read.molecule, fromParity);
      for (const centre of config.centres) {
        if (centre.lonePair) {
          expect(after[centre.atomId], `${file} ${centre.atomId}`).toBe("undetermined:unspecified");
          continue;
        }
        expect(before[centre.atomId], `${file} ${centre.atomId}`).toMatch(/^[RSrs]$/);
        expect(after[centre.atomId], `${file} ${centre.atomId}`).toBe(before[centre.atomId]);
        carried++;
      }
    }
    // 75 centres in the set, one of them the sulfoxide's lone-pair sulfur.
    expect(carried).toBe(74);
  });

  it("reads the other enantiomer when one digit is flipped: the column is not decoration", () => {
    const mol = load("d-glucose-open.mol");
    const text = writeMolblock(unmarked(mol), { atomParity: stereoConfig(mol) });
    const lines = text.split("\n");
    // Row 5 is C3, (S) in D-glucose.
    const row = 4 + 4;
    expect(lines[row]!.slice(39, 42)).toMatch(/^ {2}[12]$/);
    lines[row] = `${lines[row]!.slice(0, 39)}  ${lines[row]!.slice(41, 42) === "1" ? "2" : "1"}${lines[row]!.slice(42)}`;
    const read = readMolblock(lines.join("\n"));
    const flipped = letters(read.molecule, stereoConfigFromAtomParities(read.molecule, read.atomParities));
    expect(flipped).toEqual({ a3: "R", a5: "R", a7: "R", a9: "R" });
  });

  it("writes a wavy centre as 3, either, and reads 3 back as a mixture", () => {
    const mol = load("r-glyceraldehyde.mol");
    const wedge = mol.bondIds.find((id) => mol.bonds[id]!.stereo !== "none")!;
    const wavy = setBondStereo(mol, wedge, "wavy");
    const text = writeMolblock(wavy, { atomParity: stereoConfig(wavy) });
    expect(parityColumn(text)[2]).toBe("3");
    const read = readMolblock(text);
    expect(read.atomParities).toEqual({ a3: 3 });
    expect(stereoConfigFromAtomParities(read.molecule, read.atomParities).centres[0]!.reading).toEqual({
      kind: "mixture",
      of: "epimers",
    });
  });

  it("never lets the column override the wedges the molecule is read from", () => {
    const r = load("r-glyceraldehyde.mol");
    const s = load("s-glyceraldehyde.mol");
    // (R)'s drawing with (S)'s parity: the file contradicts itself, and the
    // molecule still says what its wedge says.
    const read = readMolblock(writeMolblock(r, { atomParity: stereoConfig(s) }));
    expect(letters(read.molecule, stereoConfig(read.molecule))).toEqual({ a3: "R" });
    expect(letters(read.molecule, stereoConfigFromAtomParities(read.molecule, read.atomParities))).toEqual({ a3: "S" });
  });

  it("refuses a V3000 request rather than drop the column, and a configuration of another molecule", () => {
    const mol = load("r-glyceraldehyde.mol");
    expect(() => writeMolblock(mol, { atomParity: stereoConfig(mol), version: "V3000" })).toThrow(/V2000 sss column only/);
    // Glyceraldehyde's centre is a3; in the deuterated ethanol a3 is the ²H.
    const other = load("r-glyceraldehyde.mol");
    expect(() => writeMolblock(load("chd-ethanol.mol"), { atomParity: stereoConfig(other) })).toThrow(
      /not a configuration of this molecule/,
    );
  });

  it("reads a digit outside 0-3 as none, with the unreadable-field warning", () => {
    const mol = load("r-glyceraldehyde.mol");
    const lines = writeMolblock(mol, { atomParity: stereoConfig(mol) }).split("\n");
    lines[6] = `${lines[6]!.slice(0, 39)}  7${lines[6]!.slice(42)}`;
    const read = readMolblock(lines.join("\n"));
    expect(read.atomParities).toEqual({});
    expect(read.warnings).toEqual([
      expect.objectContaining({ kind: "bad-numeric-field", field: "stereo parity", text: "7", line: 7 }),
    ]);
  });
});
