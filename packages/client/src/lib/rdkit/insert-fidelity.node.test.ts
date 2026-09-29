import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  benzene,
  cipDescriptor,
  emptyMolecule,
  implicitHydrogenCount,
  requireAtom,
  stereocenterAtoms,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { STRUCTURE_DICTIONARY, dictionaryMolecule } from "@starter/chem-core/dictionary";
import { createDocument } from "@starter/shared";

import { insertStructure } from "@/editor/commands/insert";
import { createEditorStore } from "@/state";

import { normalizeMolblock, type RDKitLogLike, type RDKitModuleLike } from "./ops";
import { molblockToMolecule } from "./translate";

/**
 * The insert box against real RDKit: does what goes in come out with the same
 * hydrogens, and does every dictionary molblock still mean its SMILES?
 *
 * WHY PER-ATOM HYDROGENS AND NOT A FORMULA. Hydrogens are implicit in
 * chem-core — derived from valence at query time — so the failure this guards
 * against is a charged or bracketed atom whose valence reads differently on the
 * two sides: pyrrole's [nH], an ammonium, a nitro group. A formula would catch
 * a lost hydrogen but not one that moved from one atom to its neighbour. RDKit's
 * JSON gives each atom's total hydrogen count in SMILES order, the molblock
 * keeps that order, and chem-core's reader keeps it again, so the two can be
 * compared atom by atom.
 *
 * WHY THROUGH `insertStructure`. The SMILES leg is exactly `fromSmiles`'s
 * (`normalizeMolblock` then `molblockToMolecule`) without the Worker, which is
 * a transport shell, and the molecule then goes through the same insertion the
 * box commits — rescale, `insertFragment` beside a drawn benzene, selection.
 * An atom copied without its hydrogen assertion would drop a hydrogen right
 * there, after every other check had passed.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;
let log: RDKitLogLike | null = null;

/** RDKit's `get_json` and `get_stereo_tags`, which `RDKitModuleLike` leaves
 *  out because the app never calls them. */
interface JsonMol {
  get_json(): string;
  get_stereo_tags(): string;
  get_inchi(): string;
  is_valid(): boolean;
  delete(): void;
}

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
}, 60_000);

afterAll(() => {
  log?.delete();
});

function rdkitMol(text: string): JsonMol {
  const mol = (RDKit as unknown as { get_mol(text: string): JsonMol | null }).get_mol(text);
  if (mol === null || !mol.is_valid()) throw new Error(`RDKit could not read ${text}`);
  return mol;
}

/** Each atom's total hydrogen count, in RDKit's atom order. */
function rdkitHydrogens(text: string): number[] {
  const mol = rdkitMol(text);
  try {
    const json = JSON.parse(mol.get_json()) as {
      atomDefaults?: { impHs?: number };
      molecules: { atoms: { impHs?: number }[] }[];
    };
    const fallback = json.atomDefaults?.impHs ?? 0;
    return json.molecules[0]!.atoms.map((atom) => atom.impHs ?? fallback);
  } finally {
    mol.delete();
  }
}

function chemCoreHydrogens(mol: Molecule, ids: readonly AtomId[] = mol.atomIds): number[] {
  return ids.map((id) => implicitHydrogenCount(mol, id));
}

/** A SMILES through the same two steps `fromSmiles` takes, minus the Worker. */
function viaSmiles(smiles: string): Molecule {
  const normalized = normalizeMolblock(RDKit, smiles, "preserve", log);
  if (!normalized.ok) throw new Error(`RDKit refused ${smiles}`);
  const read = molblockToMolecule(normalized.value.molblock);
  if (!read.ok) throw new Error(`chem-core refused RDKit's molblock for ${smiles}: ${read.error.message}`);
  return read.value.molecule;
}

/** Real molecules whose hydrogens are easy to get wrong. */
const SMILES: readonly (readonly [string, string])[] = [
  ["pyrrole", "c1cc[nH]c1"],
  ["imidazole", "c1c[nH]cn1"],
  ["pyridinium", "c1cc[nH+]cc1"],
  ["pyridine N-oxide", "[O-][n+]1ccccc1"],
  ["ammonium", "[NH4+]"],
  ["acetate", "CC(=O)[O-]"],
  ["glycine zwitterion", "[NH3+]CC(=O)[O-]"],
  ["nitromethane", "C[N+](=O)[O-]"],
  ["13C-methane", "[13CH4]"],
  ["dimethyl sulfoxide", "CS(C)=O"],
  ["dimethyl sulfone", "CS(C)(=O)=O"],
  ["trimethylsulfonium", "C[S+](C)C"],
  ["phosphoric acid", "OP(=O)(O)O"],
  ["borane", "B"],
  ["caffeine", "Cn1cnc2c1c(=O)n(C)c(=O)n2C"],
  ["L-histidine", "c1c(nc[nH]1)C[C@@H](C(=O)O)N"],
  ["guanine", "Nc1nc2[nH]cnc2c(=O)[nH]1"],
];

describe("a SMILES inserted through the box keeps every atom's hydrogens", () => {
  for (const [name, smiles] of SMILES) {
    it(`${name} (${smiles})`, () => {
      const expected = rdkitHydrogens(smiles);
      const read = viaSmiles(smiles);
      expect(chemCoreHydrogens(read), "after the reader").toEqual(expected);

      // And after the insertion itself, beside something already drawn.
      const store = createEditorStore({
        document: createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
        viewportSize: { width: 800, height: 600 },
        now: () => "2024-01-01T00:00:00.000Z",
      });
      insertStructure(store, read, smiles);
      const { document, selection } = store.getState();
      expect(chemCoreHydrogens(document.molecule, selection.atomIds), "after the insert").toEqual(expected);
    });
  }

  it("into an empty sketch as well", () => {
    const store = createEditorStore({
      document: createDocument({ molecule: emptyMolecule(), now: "2024-01-01T00:00:00.000Z" }),
      viewportSize: { width: 800, height: 600 },
      now: () => "2024-01-01T00:00:00.000Z",
    });
    insertStructure(store, viaSmiles("c1cc[nH]c1"), "pyrrole");
    expect(chemCoreHydrogens(store.getState().document.molecule)).toEqual(rdkitHydrogens("c1cc[nH]c1"));
  });
});

describe("every dictionary molblock still means its SMILES", () => {
  it("has the same InChIKey as its SMILES, stereo read off the wedges", () => {
    for (const entry of STRUCTURE_DICTIONARY) {
      const mol = rdkitMol(entry.molblock);
      try {
        const key = RDKit.get_inchikey_for_inchi(mol.get_inchi());
        expect(key, entry.id).toBe(entry.inchiKey);
      } finally {
        mol.delete();
      }
    }
  });

  it("gives every atom the hydrogens RDKit gives it", () => {
    for (const entry of STRUCTURE_DICTIONARY) {
      expect(chemCoreHydrogens(dictionaryMolecule(entry)), entry.id).toEqual(rdkitHydrogens(entry.molblock));
    }
  });

  it("agrees with RDKit on every CIP descriptor", () => {
    for (const entry of STRUCTURE_DICTIONARY) {
      const mol = rdkitMol(entry.molblock);
      let rdkit: string[];
      try {
        const tags = JSON.parse(mol.get_stereo_tags()) as { CIP_atoms: [number, string][] };
        // RDKit tags an unassigned centre "(?)" — ibuprofen's, on purpose —
        // where chem-core says `undetermined`; neither is a descriptor.
        rdkit = tags.CIP_atoms.sort((a, b) => a[0] - b[0])
          .map(([index, label]) => `${index}:${label.replace(/[()]/g, "")}`)
          .filter((tag) => !tag.endsWith("?"));
      } finally {
        mol.delete();
      }
      const core = dictionaryMolecule(entry);
      const assigned = stereocenterAtoms(core).flatMap((atomId) => {
        const kind = cipDescriptor(core, atomId)?.kind;
        if (kind !== "R" && kind !== "S" && kind !== "r" && kind !== "s") return [];
        return [`${core.atomIds.indexOf(atomId)}:${kind}`];
      });
      expect(assigned, entry.id).toEqual(rdkit);
      // Read as chem-core atoms, not just indices: the order held.
      for (const tag of rdkit) {
        const index = Number(tag.split(":")[0]);
        expect(requireAtom(core, core.atomIds[index]!).element, `${entry.id} ${tag}`).toBe("C");
      }
    }
  });
});
