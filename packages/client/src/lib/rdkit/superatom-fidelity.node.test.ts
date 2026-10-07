import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import {
  abbreviationCandidateAt,
  abbreviationsOf,
  cipDescriptor,
  collapseAbbreviation,
  elementCounts,
  exactMass,
  stereocenterAtoms,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import type { JSMolLike, RDKitModuleLike } from "./ops";
import { moleculeToMolblock, molblockToMolecule } from "./translate";

/**
 * Contracted abbreviations through the real wasm (decision 225).
 *
 * A contracted Boc or OTBS is a `SUP` S-group over its real atoms. These two
 * structures go chem-core -> this app's molblock -> RDKit -> RDKit's own
 * molblock -> chem-core, and must come back with the same formula, the same
 * monoisotopic mass, the same configuration at every stereocentre and the
 * same label on the same atoms.
 *
 * NEVER A SMILES ASSERTION (see fidelity.node.test.ts): RDKit drops S-groups
 * from SMILES entirely, so a string comparison could not even see the label.
 * The oracle on RDKit's side is `get_json`'s `substanceGroups`, which is what
 * RDKit understood; on ours, chem-core's own queries.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
}, 60_000);

type FullMol = JSMolLike & { get_json(): string; get_descriptors(): string };

interface RdkitSgroup {
  readonly properties: { readonly TYPE: string; readonly LABEL?: string };
  readonly atoms: readonly number[];
}

function rdkit(text: string): FullMol {
  const mol = RDKit.get_mol(text, JSON.stringify({ removeHs: false })) as FullMol | null;
  if (mol === null) throw new Error("RDKit refused the text");
  return mol;
}

/** chem-core's reading of RDKit's 2D molfile for a SMILES. */
function fromSmiles(smiles: string): Molecule {
  const mol = rdkit(smiles);
  try {
    mol.set_new_coords();
    const read = molblockToMolecule(mol.get_molblock());
    if (!read.ok) throw new Error(read.error.message);
    return read.value.molecule;
  } finally {
    mol.delete();
  }
}

/** Contract the group chem-core recognises around the first atom offering `label`. */
function contract(mol: Molecule, label: string): Molecule {
  for (const atomId of mol.atomIds) {
    const candidate = abbreviationCandidateAt(mol, atomId);
    if (candidate?.label === label) return collapseAbbreviation(mol, candidate.atomIds, label);
  }
  throw new Error(`no ${label} found`);
}

/** CIP letters by atom ROW, so two molecules with different ids compare. */
function configuration(mol: Molecule): Record<number, string> {
  const out: Record<number, string> = {};
  for (const atomId of stereocenterAtoms(mol)) {
    out[mol.atomIds.indexOf(atomId) + 1] = String(cipDescriptor(mol, atomId));
  }
  return out;
}

/** Each abbreviation as its label and atom ROWS. */
function labelsByRow(mol: Molecule): { label: string; rows: number[] }[] {
  const rowOf = (id: AtomId): number => mol.atomIds.indexOf(id) + 1;
  return abbreviationsOf(mol).map((abbr) => ({
    label: abbr.label,
    rows: abbr.atomIds.map(rowOf).sort((a, b) => a - b),
  }));
}

function roundTrip(mol: Molecule): { readonly back: Molecule; readonly ours: string; readonly rdkitJson: string; readonly exactmw: number } {
  const written = moleculeToMolblock(mol);
  if (!written.ok) throw new Error(written.error.message);
  const parsed = rdkit(written.value);
  try {
    const read = molblockToMolecule(parsed.get_molblock());
    if (!read.ok) throw new Error(read.error.message);
    return {
      back: read.value.molecule,
      ours: written.value,
      rdkitJson: parsed.get_json(),
      exactmw: (JSON.parse(parsed.get_descriptors()) as { exactmw: number }).exactmw,
    };
  } finally {
    parsed.delete();
  }
}

const CASES = [
  {
    name: "a Boc-protected amine: Boc-L-alanine methyl ester",
    smiles: "C[C@H](NC(=O)OC(C)(C)C)C(=O)OC",
    label: "Boc",
    atoms: 7,
  },
  {
    name: "an OTBS ether: (R)-1-phenylethyl TBS ether",
    smiles: "C[C@@H](O[Si](C)(C)C(C)(C)C)c1ccccc1",
    label: "OTBS",
    atoms: 8,
  },
] as const;

describe("contracted abbreviations survive a round trip through RDKit", () => {
  for (const c of CASES) {
    it(`${c.name} keeps formula, mass, stereo and its label`, () => {
      const drawn = contract(fromSmiles(c.smiles), c.label);
      expect(stereocenterAtoms(drawn)).toHaveLength(1);
      const { back, rdkitJson, exactmw } = roundTrip(drawn);

      // RDKit understood the S-group: a SUP with this label over these atoms.
      const groups = (JSON.parse(rdkitJson) as { molecules: { substanceGroups?: RdkitSgroup[] }[] })
        .molecules[0]?.substanceGroups ?? [];
      expect(groups.map((g) => ({ type: g.properties.TYPE, label: g.properties.LABEL, n: g.atoms.length }))).toEqual([
        { type: "SUP", label: c.label, n: c.atoms },
      ]);

      // RDKit's chemistry is the drawing's: the label hid no atom from it.
      expect(exactmw).toBeCloseTo(exactMass(drawn), 4);

      // And chem-core reads RDKit's own rewrite back to the same compound.
      expect(elementCounts(back)).toEqual(elementCounts(drawn));
      expect(exactMass(back)).toBeCloseTo(exactMass(drawn), 6);
      expect(configuration(back)).toEqual(configuration(drawn));
      expect(Object.values(configuration(back))).not.toContain("undefined");
      expect(labelsByRow(back)).toEqual(labelsByRow(drawn));
    });
  }
});
