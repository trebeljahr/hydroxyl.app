/**
 * THE MOLBLOCK ORACLE: project -> rebuild -> writeMolblock -> readMolblock ->
 * read, for every built row, with configuration carried in the V2000 atom
 * parity column (decision 207); and the records the client's RDKit tier
 * reads, committed as goldens (decision 208).
 *
 * It is proved NOT VACUOUS twice: a Fischer's file carries no wedge at all,
 * so what reads back is the parity column or nothing; and flipping one
 * centre's parity in the text makes the oracle report that centre.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stereoConfig } from "../../src/stereo-config.js";
import { HARNESS_FIXTURES, fixtureName, loadFixture } from "./fixtures.js";
import { isLetter, matrixRows, rowName, type Row } from "./law.js";
import { expectedLetters, oracleRecords, oracleText, parityAtRow, readOracleText } from "./oracle.js";

type Built = Extract<Row, { status: "built" }>;
const BUILT = matrixRows().filter((row): row is Built => row.status === "built");
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "__golden__", "oracle");

/** `text` with the atom-block row's `sss` column set to `value`. */
function withParity(text: string, row: number, value: number): string {
  const lines = text.split("\n");
  const line = lines[3 + row]!;
  lines[3 + row] = `${line.slice(0, 39)}${String(value).padStart(3, " ")}${line.slice(42)}`;
  return lines.join("\n");
}

describe("the molblock oracle carries configuration through a file", () => {
  for (const row of BUILT) {
    it(`${rowName(row)}: the file states what the layout states, in the parity column`, () => {
      const mol = loadFixture(row.fixture);
      const expected = expectedLetters(mol, row.layout);
      for (const letter of Object.values(expected)) expect(isLetter(letter)).toBe(true);
      const { rebuilt, text } = oracleText(mol, row.layout);
      const read = readOracleText(text, rebuilt, row.layout);
      // A lone-pair centre (the sulfoxide's S) is written 0, as RDKit writes
      // it: the column numbers four ATOMS (decision 207). Its wedge carries it.
      const lonePair = new Set(stereoConfig(mol).centres.filter((c) => c.lonePair).map((c) => c.atomId));
      expect(read.fromParity).toEqual(
        Object.fromEntries(
          Object.entries(expected).map(([id, letter]) => [id, lonePair.has(id) ? "undetermined:unspecified" : letter]),
        ),
      );
      if (lonePair.size > 0) expect(row.layout.convention.kind, "a lone-pair centre needs a wedge to travel").toBe("wedgeHash");
      if (row.layout.convention.kind === "wedgeHash") {
        // A planar file carries it twice, and the two agree.
        expect(read.fromWedges).toEqual(expected);
      } else {
        // A Fischer's file has no wedge: every covered centre is stated by
        // the parity column or by nothing.
        for (const letter of Object.values(read.fromWedges)) expect(isLetter(letter)).toBe(false);
      }
    });
  }

  const MARK_FREE = BUILT.filter((row) => row.layout.convention.kind !== "wedgeHash" && row.layout.coverage.centres.length > 0);

  it("has mark-free rows to be vacuous about, and they are the Fischers", () => {
    expect(MARK_FREE.length).toBeGreaterThanOrEqual(22);
    expect(new Set(MARK_FREE.map((row) => row.key))).toEqual(new Set(["chain/fischer"]));
  });

  for (const row of MARK_FREE) {
    it(`${rowName(row)}: flipping one centre's parity in the file is caught at that centre`, () => {
      const mol = loadFixture(row.fixture);
      const expected = expectedLetters(mol, row.layout);
      const { rebuilt, text } = oracleText(mol, row.layout);
      const rowOf = new Map(rebuilt.molecule.atomIds.map((id, i) => [id, i + 1]));
      for (const centre of row.layout.coverage.centres) {
        const at = rowOf.get(centre)!;
        const written = parityAtRow(text, at);
        expect([1, 2], centre).toContain(written);
        const mutated = readOracleText(withParity(text, at, written === 1 ? 2 : 1), rebuilt, row.layout);
        expect(mutated.fromParity[centre], centre).not.toBe(expected[centre]);
        expect(isLetter(mutated.fromParity[centre]!), centre).toBe(true);
        // Zeroing it states nothing, which is caught as well.
        const erased = readOracleText(withParity(text, at, 0), rebuilt, row.layout);
        expect(isLetter(erased.fromParity[centre]!), centre).toBe(false);
      }
    });
  }
});

describe("the RDKit tier's records (read by packages/client/src/lib/rdkit/projection-oracle.node.test.ts)", () => {
  const byTemplate = new Map<string, string[]>();
  for (const row of BUILT) {
    const records = oracleRecords(row, loadFixture(row.fixture));
    byTemplate.set(row.key, [...(byTemplate.get(row.key) ?? []), ...records]);
  }

  for (const [key, records] of byTemplate) {
    it(`${key}: the committed records are exactly what chem-core writes today`, async () => {
      await expect(records.join("")).toMatchFileSnapshot(join(GOLDEN, `${key.replace("/", "-")}.sdf`));
    });
  }

  it("has a record for every centre of every sugar and steroid, on at least one built template", () => {
    for (const fixture of HARNESS_FIXTURES.filter((f) => f.family === "sugar" || f.family === "steroid")) {
      const centres = stereoConfig(loadFixture(fixture)).centres.map((c) => c.atomId);
      const planar = BUILT.find((row) => row.fixture === fixture && row.key === "planar/wedgeDash");
      expect(planar, fixtureName(fixture)).toBeDefined();
      expect(planar!.layout.coverage.centres, fixtureName(fixture)).toEqual(centres);
    }
  });
});
