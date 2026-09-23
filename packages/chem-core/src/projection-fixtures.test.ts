/**
 * THE FIXTURE GUARD. Every projection the editor grows (Fischer, Haworth,
 * chair, Newman) is checked by one oracle: the CIP descriptors survive the
 * round trip. That oracle is only worth something if every stereocentre of
 * the reference set resolves to a letter, so a descriptor that silently turns
 * `undetermined` would make every projection assertion pass vacuously. This
 * file pins that it does not.
 *
 * THE MOLBLOCKS in test/fixtures/projection were generated ONCE from SMILES by
 * RDKit (`get_mol`, `set_new_coords`, `get_molblock`) and are checked in. Line
 * 1 of each names the compound with the generation date and RDKit version,
 * line 3 is the SMILES, and manifest.json lists all three.
 *
 * THE LETTERS below are literals. Each equals what RDKit 2025.03.4
 * `get_stereo_tags` gives for the fixture's SMILES (the atom index in a key is
 * the molblock row, a1 = row 1), and the textbook names agree:
 *   D-glucose, open chain   (2R,3S,4R,5R): a3, a5, a7, a9
 *   L-cysteine              (R), and L-alanine (S), at a2
 *   L-isoleucine            (2S,3S)
 *   5alpha-androstane       PubChem CID 94144 (5R,8S,9S,10S,13S,14S)
 *   ribaric acid            (2R,3r,4S): C3 is PSEUDOASYMMETRIC, lowercase
 *   (1S)-(1-2H1)ethanol     resolved by rule 2 (mass number) alone
 * packages/client/src/lib/rdkit/stereo-centres.node.test.ts re-derives the
 * same letters from RDKit live, so a drift on either side shows up there.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bondBetween } from "./molecule.js";
import { readMolblock } from "./molblock-read.js";
import { updateAtom } from "./ops.js";
import {
  cipDescriptor,
  doubleBondDescriptor,
  stereocenterAtoms,
  stereogenicBonds,
} from "./stereo.js";
import { descriptorFromConfig, stereoConfig } from "./stereo-config.js";
import type { Molecule } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "projection");

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(FIXTURES, file), "utf8")).molecule;
}

type Letter = "R" | "S" | "r" | "s";

interface Expected {
  readonly centres: Readonly<Record<string, Letter>>;
  readonly doubleBonds?: Readonly<Record<string, "E" | "Z">>;
}

const PROJECTION_EXPECTED: Readonly<Record<string, Expected>> = {
  "r-glyceraldehyde.mol": { centres: { a3: "R" } },
  "s-glyceraldehyde.mol": { centres: { a3: "S" } },
  "d-glucose-open.mol": { centres: { a3: "R", a5: "S", a7: "R", a9: "R" } },
  "l-glucose-open.mol": { centres: { a3: "S", a5: "R", a7: "S", a9: "S" } },
  "alpha-d-glucopyranose.mol": { centres: { a3: "R", a5: "S", a7: "R", a9: "S", a11: "S" } },
  "beta-d-glucopyranose.mol": { centres: { a3: "R", a5: "R", a7: "R", a9: "S", a11: "S" } },
  "alpha-d-mannopyranose.mol": { centres: { a3: "R", a5: "S", a7: "S", a9: "S", a11: "S" } },
  "d-galactose-open.mol": { centres: { a3: "R", a5: "S", a7: "S", a9: "R" } },
  "d-fructose-open.mol": { centres: { a5: "S", a7: "R", a9: "R" } },
  "d-ribose-open.mol": { centres: { a3: "R", a5: "R", a7: "R" } },
  "2-deoxy-d-ribose-open.mol": { centres: { a4: "S", a6: "R" } },
  "adenosine.mol": { centres: { a11: "R", a13: "R", a16: "S", a18: "R" } },
  "alpha-l-fucopyranose.mol": { centres: { a2: "S", a4: "R", a6: "S", a8: "R", a10: "S" } },
  "cis-2-butene.mol": { centres: {}, doubleBonds: { "a2=a3": "Z" } },
  "trans-2-butene.mol": { centres: {}, doubleBonds: { "a2=a3": "E" } },
  "rr-tartaric-acid.mol": { centres: { a4: "R", a6: "R" } },
  "meso-tartaric-acid.mol": { centres: { a4: "R", a6: "S" } },
  "ribaric-acid.mol": { centres: { a4: "R", a6: "r", a8: "S" } },
  "pentane-2r3s-diol.mol": { centres: { a2: "R", a4: "S" } },
  "cis-1-2-dimethylcyclohexane.mol": { centres: { a2: "S", a7: "R" } },
  "trans-1-2-dimethylcyclohexane.mol": { centres: { a2: "S", a7: "S" } },
  "rr-2-3-dibromobutane.mol": { centres: { a2: "R", a4: "R" } },
  "meso-2-3-dibromobutane.mol": { centres: { a2: "R", a4: "S" } },
  "5alpha-androstane.mol": { centres: { a2: "S", a6: "S", a7: "S", a10: "R", a15: "S", a16: "S" } },
  "chd-ethanol.mol": { centres: { a2: "S" } },
  "methyl-p-tolyl-sulfoxide.mol": { centres: { a2: "R" } },
  "l-cysteine.mol": { centres: { a2: "R" } },
  "l-alanine.mol": { centres: { a2: "S" } },
  "l-isoleucine.mol": { centres: { a3: "S", a5: "S" } },
};

function kind(descriptor: { readonly kind: string; readonly reason?: string } | undefined): string {
  if (descriptor === undefined) return "none";
  return descriptor.kind === "undetermined" ? `undetermined:${descriptor.reason}` : descriptor.kind;
}

describe("projection fixture guard", () => {
  it("covers exactly the manifest", () => {
    const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as {
      fixtures: { file: string }[];
    };
    expect(manifest.fixtures.map((f) => f.file).sort()).toEqual(Object.keys(PROJECTION_EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(PROJECTION_EXPECTED)) {
    it(`resolves every stereo unit of ${file} to a letter`, () => {
      const mol = load(file);
      const config = stereoConfig(mol);

      // Exactly the pinned centres: none dropped, none invented.
      expect(stereocenterAtoms(mol)).toEqual(Object.keys(expected.centres));
      expect(config.centres.map((c) => c.atomId)).toEqual(Object.keys(expected.centres));

      for (const [atomId, letter] of Object.entries(expected.centres)) {
        expect(kind(cipDescriptor(mol, atomId)), `${file} ${atomId} from the drawing`).toBe(letter);
        const centre = config.centres.find((c) => c.atomId === atomId)!;
        expect(kind(descriptorFromConfig(mol, centre, config)), `${file} ${atomId} from the config`).toBe(
          letter,
        );
      }

      const bonds = expected.doubleBonds ?? {};
      const bondIds = Object.keys(bonds).map((key) => {
        const [a, b] = key.split("=") as [string, string];
        return bondBetween(mol, a, b)!.id;
      });
      expect(stereogenicBonds(mol)).toEqual(bondIds);
      Object.values(bonds).forEach((letter, i) => {
        expect(kind(doubleBondDescriptor(mol, bondIds[i]!))).toBe(letter);
      });
      expect(config.unrepresentable).toEqual([]);
    });
  }

  it("resolves CH3–CHD–OH by the isotope alone", () => {
    const mol = load("chd-ethanol.mol");
    expect(mol.atoms["a3"]).toMatchObject({ element: "H", isotope: 2 });
    // Remove the label and the two hydrogens are one ligand: no centre at all.
    const protium = updateAtom(mol, "a3", { isotope: undefined });
    expect(stereocenterAtoms(protium)).toEqual([]);
  });

  it("letters ribaric acid's C3 lowercase, never the plausible uppercase", () => {
    const mol = load("ribaric-acid.mol");
    expect(cipDescriptor(mol, "a6")).toEqual({ kind: "r" });
  });
});
