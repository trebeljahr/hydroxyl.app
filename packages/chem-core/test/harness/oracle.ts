/**
 * The SECOND oracle: project -> rebuild -> writeMolblock -> readMolblock ->
 * read, carrying configuration in the V2000 atom-parity column (decision
 * 207), and the records the THIRD oracle, RDKit, reads (decision 208).
 *
 * WHY PARITY. The codec carries stereochemistry as wedge and hash bond codes,
 * and a Fischer has none: a Fischer written as a plain molblock states
 * nothing, and an oracle that round-trips it "passes" by comparing nothing
 * with nothing. So the rebuilt layout is read under the layout's OWN
 * convention and that configuration is written into the parity column; the
 * file read back states it only there. `oracle.test.ts` flips one parity and
 * watches the oracle fail, which is what makes it an oracle.
 *
 * THE RDKit RECORDS are committed (`__golden__/oracle/<kind>-<template>.sdf`)
 * and read by the client's node test, so RDKit checks exactly the text
 * chem-core wrote and the golden fails the moment that text changes. RDKit
 * reads no atom parity from a 2D block but does read chirality from 3D, so:
 *
 *   planar   one record per row: the rebuilt 2D drawing with its marks.
 *            RDKit's letters must equal the model's, every one of them and
 *            no others, so a row that states nothing (butane, the allene)
 *            asserts that RDKit finds nothing either.
 *   other    one record per covered centre, the layout lifted into 3D from
 *            its own depth enum: the centre at z 0, the far atom of each
 *            `front` bond at +b/2, of each `back` bond at -b/2, everything
 *            else flat. Only that centre's letter is compared (not at all
 *            for a pseudoasymmetric one, whose letter rests on centres the
 *            lift does not state), and RDKit's own parity for it must equal
 *            the one chem-core wrote — the independent check on decision
 *            207's rule.
 */

import { stereoConfigFromAtomParities } from "../../src/atom-parity.js";
import { readMolblock } from "../../src/molblock-read.js";
import { MOLFILE_BOND_LENGTH, writeMolblock } from "../../src/molblock-write.js";
import type { ProjectedLayout } from "../../src/projection/types.js";
import { readConfig, stereoConfig, type StereoConfig } from "../../src/stereo-config.js";
import type { AtomId, Molecule } from "../../src/types.js";
import { fixtureName } from "./fixtures.js";
import { doubleBondLetters, letters, pick, rowName, type Row } from "./law.js";
import { moleculeFromLayout, type RebuiltLayout } from "./rebuild.js";

export type BuiltRow = Extract<Row, { status: "built" }>;

/** What the rebuilt layout states under the layout's own convention, over the rebuilt molecule's ids. */
export function rebuiltConfig(rebuilt: RebuiltLayout, layout: ProjectedLayout): StereoConfig {
  const read = readConfig({ mol: rebuilt.molecule }, layout.convention, {
    centres: layout.coverage.centres,
    doubleBonds: layout.coverage.doubleBonds,
  });
  if (read.kind !== "read") throw new Error(`the rebuilt layout was refused: ${read.reason} at ${read.atomIds.join(", ")}`);
  return read.config;
}

export interface OracleText {
  readonly rebuilt: RebuiltLayout;
  /** The molblock, parity column written from what the layout states. */
  readonly text: string;
}

export function oracleText(mol: Molecule, layout: ProjectedLayout, title?: string): OracleText {
  const rebuilt = moleculeFromLayout(mol, layout);
  const text = writeMolblock(rebuilt.molecule, { atomParity: rebuiltConfig(rebuilt, layout), title });
  return { rebuilt, text };
}

export interface OracleReading {
  /** The covered centres' letters, from the parity column alone, by SOURCE atom id. */
  readonly fromParity: Readonly<Record<AtomId, string>>;
  /** The same centres, from the wedges the file carries, by source atom id. */
  readonly fromWedges: Readonly<Record<AtomId, string>>;
}

/**
 * `text` read back with chem-core's reader and its configuration taken from
 * the parity column, mapped to the source molecule's ids by atom-block row.
 */
export function readOracleText(text: string, rebuilt: RebuiltLayout, layout: ProjectedLayout): OracleReading {
  const read = readMolblock(text);
  const back = read.molecule;
  const sourceOf = new Map<AtomId, AtomId>();
  back.atomIds.forEach((id, i) => sourceOf.set(id, rebuilt.molecule.atomIds[i]!));
  const toSource = (record: Readonly<Record<AtomId, string>>): Record<AtomId, string> =>
    Object.fromEntries(Object.entries(record).map(([id, letter]) => [sourceOf.get(id) ?? id, letter]));
  return {
    fromParity: pick(toSource(letters(back, stereoConfigFromAtomParities(back, read.atomParities))), layout.coverage.centres),
    fromWedges: pick(toSource(letters(back, stereoConfig(back))), layout.coverage.centres),
  };
}

/** The model's letters on the layout's coverage: what every oracle must return. */
export function expectedLetters(mol: Molecule, layout: ProjectedLayout): Record<AtomId, string> {
  return pick(letters(mol, stereoConfig(mol)), layout.coverage.centres);
}

// ---------------------------------------------------------------------------
// The records RDKit reads
// ---------------------------------------------------------------------------

/** The header's dimension code, and one atom row's z, rewritten in place. */
function lifted(text: string, zByRow: ReadonlyMap<number, number>): string {
  const lines = text.split("\n");
  lines[1] = lines[1]!.replace(/2D\s*$/, "3D");
  const atomCount = Number(lines[3]!.slice(0, 3));
  for (let row = 1; row <= atomCount; row++) {
    const z = zByRow.get(row);
    if (z === undefined) continue;
    const line = lines[3 + row]!;
    lines[3 + row] = `${line.slice(0, 20)}${z.toFixed(4).padStart(10, " ")}${line.slice(30)}`;
  }
  return lines.join("\n");
}

/** The V2000 `sss` column of an atom row, 1-based. */
export function parityAtRow(text: string, row: number): number {
  const line = text.split("\n")[3 + row]!;
  return Number(line.slice(39, 42));
}

function dataItems(items: Readonly<Record<string, string>>): string {
  return Object.entries(items)
    .map(([name, value]) => `>  <${name}>\n${value}\n`)
    .join("\n");
}

/**
 * The SDF records for one built row. `text` ends in "M  END"; each record is
 * that block, its data items, and the "$$$$" delimiter.
 */
export function oracleRecords(row: BuiltRow, mol: Molecule): readonly string[] {
  const layout = row.layout;
  const { rebuilt, text } = oracleText(mol, layout, `${fixtureName(row.fixture)} as ${row.key}`);
  const rowOf = new Map(rebuilt.molecule.atomIds.map((id, i) => [id, i + 1]));
  const expected = expectedLetters(mol, layout);
  const record = (block: string, items: Record<string, string>) =>
    `${block.replace(/\n$/, "")}\n${dataItems({ fixture: fixtureName(row.fixture), template: row.key, ...items })}\n$$$$\n`;

  if (layout.convention.kind === "wedgeHash") {
    const bonds = doubleBondLetters(mol, stereoConfig(mol));
    const expectedBonds: Record<string, string> = {};
    for (const bondId of layout.coverage.doubleBonds) {
      const bond = mol.bonds[bondId]!;
      const key = [rowOf.get(bond.from)!, rowOf.get(bond.to)!].sort((a, b) => a - b).join("-");
      expectedBonds[key] = bonds[bondId]!;
    }
    const byRow = Object.fromEntries(Object.entries(expected).map(([id, letter]) => [String(rowOf.get(id)!), letter]));
    return [
      record(text, {
        record: "planar",
        expected: JSON.stringify(byRow),
        "expected-bonds": JSON.stringify(expectedBonds),
      }),
    ];
  }

  // Every other convention: one 3D lift per covered centre, from the depth enum.
  const zStep = 0.5 * layout.bondLength * MOLFILE_BOND_LENGTH;
  return layout.coverage.centres.map((centre) => {
    const node = layout.drawnAs[centre]!;
    const zByRow = new Map<number, number>();
    for (const line of layout.bonds) {
      if (line.from !== node && line.to !== node) continue;
      const far = line.from === node ? line.to : line.from;
      const depth = layout.depth[line.id];
      if (depth === "inPlane" || depth === undefined) continue;
      const atom = rebuilt.atomOfNode.get(far);
      if (atom === undefined) throw new Error(`${rowName(row)}: no rebuilt atom for ${far}`);
      zByRow.set(rowOf.get(atom)!, depth === "front" ? zStep : -zStep);
    }
    const centreRow = rowOf.get(centre)!;
    const letter = expected[centre]!;
    // A pseudoasymmetric letter (ribaric acid's C3 "r") is decided by its
    // branches' configurations, and a lift states only this one centre: the
    // lift puts a neighbouring centre off the page by accident, and RDKit
    // reads a configuration into it. So its record is checked on the parity
    // RDKit writes, which is this centre's alone, and carries the letter
    // under its own name for a reader, not as an expectation.
    const pseudoasymmetric = letter === "r" || letter === "s";
    return record(lifted(text, zByRow), {
      record: `lift ${centre}`,
      expected: JSON.stringify(pseudoasymmetric ? {} : { [String(centreRow)]: letter }),
      ...(pseudoasymmetric ? { pseudoasymmetric: JSON.stringify({ [String(centreRow)]: letter }) } : {}),
      parity: JSON.stringify({ [String(centreRow)]: parityAtRow(text, centreRow) }),
    });
  });
}
