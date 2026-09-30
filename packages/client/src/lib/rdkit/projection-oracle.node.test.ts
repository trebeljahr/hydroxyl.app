import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { JSMolLike, RDKitModuleLike } from "./ops";

/**
 * THE PROJECTION HARNESS'S THIRD TIER: RDKit reads what chem-core wrote
 * (decisions 189, 208).
 *
 * chem-core never runs RDKit, so its harness commits the records it wants
 * checked, `packages/chem-core/test/harness/__golden__/oracle/*.sdf`, and
 * its own golden fails the moment one byte of them changes. This file hands
 * each record to RDKit and asks for the letters. It is the only tier that
 * catches a MIRROR error independently: chem-core's reader and writer share
 * one sign convention, and a slip in it would read back perfectly while
 * stating the enantiomer.
 *
 *   planar       the rebuilt 2D drawing with its marks, written with
 *                `hydrogenAssertion: "valence"`. RDKit's letters must be the
 *                record's, every one and no others: a row with nothing to
 *                state (butane, the allene, a wedge on a non-stereocentre)
 *                has RDKit find nothing either.
 *   lift <atom>  a Fischer lifted into 3D from its own depth enum. RDKit reads
 *                no parity from a 2D block but reads chirality from 3D, so
 *                the lifted centre's letter is compared, and the parity RDKit
 *                writes for it must equal the one chem-core wrote: the
 *                independent check on decision 207's atom-parity rule.
 *
 * REQUIRED for every sugar and steroid fixture of the matrix. Skipped only
 * when @rdkit/rdkit cannot be resolved at all, and never in CI, which runs
 * with CI set and fails here instead.
 */

const require = createRequire(import.meta.url);

const HARNESS = join(import.meta.dirname, "..", "..", "..", "..", "chem-core", "test", "harness", "__golden__");

const RDKIT_AVAILABLE = (() => {
  try {
    require.resolve("@rdkit/rdkit");
    return true;
  } catch {
    return false;
  }
})();

if (!RDKIT_AVAILABLE && process.env["CI"] !== undefined) {
  throw new Error("@rdkit/rdkit is not installed: the projection harness's RDKit tier is required in CI");
}

type TaggedMol = JSMolLike & { get_stereo_tags(): string };

interface OracleRecord {
  readonly molblock: string;
  readonly fixture: string;
  readonly template: string;
  readonly record: string;
  readonly expected: Readonly<Record<string, string>>;
  readonly expectedBonds: Readonly<Record<string, string>>;
  readonly parity: Readonly<Record<string, number>>;
  readonly pseudoasymmetric: Readonly<Record<string, string>>;
}

function parseSdf(text: string): OracleRecord[] {
  return text
    .split("$$$$\n")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const end = chunk.indexOf("M  END") + "M  END".length;
      const items: Record<string, string> = {};
      for (const match of chunk.slice(end).matchAll(/>\s+<([^>]+)>\n([^\n]*)\n/g)) items[match[1]!] = match[2]!;
      return {
        molblock: `${chunk.slice(0, end)}\n`,
        fixture: items["fixture"]!,
        template: items["template"]!,
        record: items["record"]!,
        expected: JSON.parse(items["expected"] ?? "{}") as Record<string, string>,
        expectedBonds: JSON.parse(items["expected-bonds"] ?? "{}") as Record<string, string>,
        parity: JSON.parse(items["parity"] ?? "{}") as Record<string, number>,
        pseudoasymmetric: JSON.parse(items["pseudoasymmetric"] ?? "{}") as Record<string, string>,
      };
    });
}

function records(): OracleRecord[] {
  const dir = join(HARNESS, "oracle");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sdf"))
    .sort()
    .flatMap((f) => parseSdf(readFileSync(join(dir, f), "utf8")));
}

let RDKit: RDKitModuleLike;

interface RdkitReading {
  /** Letter by 1-based atom row; RDKit's "?" (no letter) is left out. */
  readonly atoms: Record<string, string>;
  readonly bonds: Record<string, string>;
  /** RDKit's own V2000 atom block, for the parity column it writes. */
  readonly molblock: string;
}

function readWithRdkit(molblock: string): RdkitReading {
  // removeHs false: a revealed hydrogen or a Fischer's H arm stays the atom
  // at the row the record names.
  const mol = RDKit.get_mol(molblock, JSON.stringify({ removeHs: false })) as TaggedMol | null;
  if (mol === null) throw new Error("RDKit refused the record");
  try {
    const tags = JSON.parse(mol.get_stereo_tags()) as {
      CIP_atoms: [number, string][];
      CIP_bonds: [number, number, string][];
    };
    const atoms: Record<string, string> = {};
    for (const [index, label] of tags.CIP_atoms) {
      const letter = label.replace(/[()]/g, "");
      if (letter !== "?") atoms[String(index + 1)] = letter;
    }
    const bonds: Record<string, string> = {};
    for (const [a, b, label] of tags.CIP_bonds) {
      const letter = label.replace(/[()]/g, "");
      if (letter !== "?") bonds[[a + 1, b + 1].sort((p, q) => p - q).join("-")] = letter;
    }
    return { atoms, bonds, molblock: mol.get_molblock() };
  } finally {
    mol.delete();
  }
}

function parityAtRow(molblock: string, row: number): number {
  return Number(molblock.split("\n")[3 + row]!.slice(39, 42));
}

describe.skipIf(!RDKIT_AVAILABLE)("the projection harness's records, read by RDKit", () => {
  beforeAll(async () => {
    const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
    RDKit = await initRDKitModule();
  }, 60_000);

  it("finds records for every built template the harness wrote", () => {
    const templates = new Set(records().map((r) => r.template));
    expect([...templates].sort()).toEqual(["chain/fischer", "planar/mills", "planar/steroid", "planar/wedgeDash"]);
  });

  it("gives every planar record exactly its letters, and nothing where the record states nothing", () => {
    for (const record of records().filter((r) => r.record === "planar")) {
      const read = readWithRdkit(record.molblock);
      const name = `${record.fixture} as ${record.template}`;
      expect(read.atoms, name).toEqual(record.expected);
      expect(read.bonds, name).toEqual(record.expectedBonds);
    }
  });

  it("gives every lifted Fischer centre its letter, and writes the parity chem-core wrote for it", () => {
    const lifts = records().filter((r) => r.record.startsWith("lift "));
    expect(lifts.length).toBeGreaterThan(40);
    let pseudoasymmetric = 0;
    for (const record of lifts) {
      const read = readWithRdkit(record.molblock);
      const name = `${record.fixture} ${record.record}`;
      const [row, written] = Object.entries(record.parity)[0]!;
      expect([1, 2], name).toContain(written);
      const letter = record.expected[row];
      // A pseudoasymmetric centre's letter rests on its branches, which a
      // one-centre lift does not state: its record is checked on parity alone.
      if (letter === undefined) {
        expect(record.pseudoasymmetric[row], name).toMatch(/^[rs]$/);
        pseudoasymmetric++;
      } else {
        expect(read.atoms[row], name).toBe(letter);
      }
      expect(parityAtRow(read.molblock, Number(row)), `${name}: RDKit's parity`).toBe(written);
    }
    // Ribaric acid's C3, and nothing else.
    expect(pseudoasymmetric).toBe(1);
  });

  it("is required for every sugar and steroid fixture of the matrix: each has its every centre checked here", () => {
    const matrix = JSON.parse(readFileSync(join(HARNESS, "matrix.json"), "utf8")) as {
      fixtures: { fixture: string; family: string; letters: Record<string, string> }[];
    };
    const required = matrix.fixtures.filter((f) => f.family === "sugar" || f.family === "steroid");
    expect(required.length).toBeGreaterThanOrEqual(24);
    const all = records();
    for (const fixture of required) {
      const planar = all.find((r) => r.fixture === fixture.fixture && r.template === "planar/wedgeDash");
      expect(planar, fixture.fixture).toBeDefined();
      // Source atoms keep their rows in the rebuilt drawing (a1 = row 1).
      const byRow = Object.fromEntries(Object.entries(fixture.letters).map(([id, l]) => [id.slice(1), l]));
      expect(planar!.expected, fixture.fixture).toEqual(byRow);
      expect(Object.keys(planar!.expected).length, fixture.fixture).toBeGreaterThan(0);
    }
  });

  it("would catch a mirror error: the enantiomer's record reads the other letters", () => {
    // Reflect one steroid record's x coordinates, marks kept: the mirror image.
    const record = records().find((r) => r.fixture === "steroid/cholesterol.mol" && r.template === "planar/steroid")!;
    const lines = record.molblock.split("\n");
    const atomCount = Number(lines[3]!.slice(0, 3));
    for (let row = 1; row <= atomCount; row++) {
      const line = lines[3 + row]!;
      const x = Number(line.slice(0, 10));
      lines[3 + row] = `${(-x).toFixed(4).padStart(10, " ")}${line.slice(10)}`;
    }
    const mirrored = readWithRdkit(lines.join("\n"));
    const swap = (l: string) => (l === "R" ? "S" : l === "S" ? "R" : l);
    expect(mirrored.atoms).toEqual(Object.fromEntries(Object.entries(record.expected).map(([row, l]) => [row, swap(l)])));
    expect(mirrored.atoms).not.toEqual(record.expected);
  });

  it("reads the committed records, not a stale copy", () => {
    expect(existsSync(join(HARNESS, "oracle", "chain-fischer.sdf"))).toBe(true);
    expect(RDKit.version()).toBe("2025.03.4");
  });
});
