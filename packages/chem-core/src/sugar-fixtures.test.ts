/**
 * THE SUGAR FIXTURE GUARD, the same kind of guard projection-fixtures.test.ts
 * is for the projection set. sugar.test.ts asserts alpha/beta, D/L and
 * numbering on these molecules; those assertions mean something only if every
 * stereocentre of every fixture resolves to a letter first, since an
 * undetermined centre reads "no answer" through every one of them.
 *
 * THE MOLBLOCKS in test/fixtures/sugar were generated ONCE by RDKit
 * 2025.03.4 from PubChem's isomeric SMILES (`get_mol`, `set_new_coords`,
 * `get_molblock`); line 1 names the compound, line 3 is the SMILES, and
 * manifest.json gives each one's PubChem CID.
 *
 * THE LETTERS below are literals: RDKit's `get_stereo_tags` for each
 * molblock (the atom index in a key is the molblock row), and each set
 * agrees with PubChem's IUPAC name for the CID, e.g. beta-D-galactofuranose
 * (2R,3R,4R,5S)-5-[(1R)-1,2-dihydroxyethyl]oxolane-2,3,4-triol and
 * alpha-D-glucofuranose (2S,3R,4R,5R)-…-[(1R)-…]. The client's
 * stereo-centres.node.test.ts re-derives them from RDKit live.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readMolblock } from "./molblock-read.js";
import { cipDescriptor, stereocenterAtoms } from "./stereo.js";
import type { Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "sugar");

function loadSugarFixture(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

const SUGAR_EXPECTED: Readonly<Record<string, Readonly<Record<string, "R" | "S">>>> = {
  "alpha-d-glucofuranose.mol": { a2: "R", a3: "R", a4: "R", a5: "R", a6: "S" },
  "beta-d-galactofuranose.mol": { a2: "R", a3: "S", a4: "R", a5: "R", a6: "R" },
  "alpha-d-galactofuranose.mol": { a2: "R", a3: "S", a4: "R", a5: "R", a6: "S" },
  "l-glycero-alpha-d-manno-heptopyranose.mol": { a2: "S", a3: "R", a4: "S", a5: "S", a6: "S", a7: "S" },
  "2-deoxyadenosine.mol": { a2: "S", a3: "R", a5: "R" },
  "methyl-alpha-d-glucopyranoside.mol": { a3: "S", a4: "R", a5: "S", a6: "S", a7: "R" },
  "methyl-beta-d-glucopyranoside.mol": { a3: "R", a4: "R", a5: "S", a6: "S", a7: "R" },
  "n-acetyl-beta-neuraminic-acid.mol": { a5: "R", a6: "S", a8: "S", a10: "R", a11: "R", a12: "R" },
  "dihydroxyacetone.mol": {},
  "lamivudine.mol": { a2: "S", a4: "R" },
};

describe("sugar fixture guard", () => {
  it("covers exactly the manifest", () => {
    const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as {
      fixtures: { file: string }[];
    };
    expect(manifest.fixtures.map((f) => f.file).sort()).toEqual(Object.keys(SUGAR_EXPECTED).sort());
  });

  for (const [file, letters] of Object.entries(SUGAR_EXPECTED)) {
    it(`resolves every stereocentre of ${file} to RDKit's letter`, () => {
      const mol = loadSugarFixture(file);
      expect(stereocenterAtoms(mol)).toEqual(Object.keys(letters));
      for (const [atomId, letter] of Object.entries(letters)) {
        expect(cipDescriptor(mol, atomId), `${file} ${atomId}`).toEqual({ kind: letter });
      }
    });
  }
});
