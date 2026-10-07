import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildMolecule,
  elementCounts,
  implicitHydrogenCount,
  requireBond,
  setBondBold,
  setBondDative,
  vec,
} from "@starter/chem-core";
import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import type { JSMolLike, RDKitModuleLike } from "./ops";
import { molblockToMolecule, molblockVersionFor, moleculeToMolblock } from "./translate";

/**
 * Dative bonds across the real wasm (decision 226), both directions.
 *
 * THE ORACLE IS `get_json`: RDKit's commonchem dump gives each bond's type as
 * `bo` (17 is DATIVE) and each atom's implicit hydrogens as `impHs`, which is
 * what RDKit UNDERSTOOD rather than how it formats a file. A SMILES assertion
 * would prove nothing — the hydrogens are where a wrong valence rule shows.
 *
 * THE COMPLEX IS CISPLATIN, NOT AMMONIA-BORANE. RDKit gives a dative bond's
 * acceptor one valence and boron allows only 3, so `[NH3]->[BH3]` is refused
 * outright and a drawn N->B reads as NH3 + BH2 (measured, and pinned below).
 * Platinum carries no default valence, so cis-[PtCl2(NH3)2] is a real complex
 * both sides read without a pin.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
}, 60_000);

type JsonMol = JSMolLike & { get_json(): string; get_v3Kmolblock(): string };

interface RdkitView {
  readonly atoms: { z: number; impHs?: number }[];
  readonly bonds: { bo?: number; atoms: [number, number] }[];
}

const RDKIT_DATIVE = 17;

function rdkitView(text: string): RdkitView {
  const mol = RDKit.get_mol(text, JSON.stringify({ removeHs: false })) as JsonMol | null;
  if (mol === null) throw new Error("RDKit refused the text");
  try {
    const json = JSON.parse(mol.get_json()) as { molecules: RdkitView[] };
    return json.molecules[0]!;
  } finally {
    mol.delete();
  }
}

function rdkitV3000(smiles: string): string {
  const mol = RDKit.get_mol(smiles) as JsonMol | null;
  if (mol === null) throw new Error(`RDKit refused ${smiles}`);
  try {
    mol.set_new_coords();
    return mol.get_v3Kmolblock();
  } finally {
    mol.delete();
  }
}

function cisplatin(): { molecule: Molecule; datives: BondId[]; ammines: AtomId[] } {
  const datives: BondId[] = [];
  const ammines: AtomId[] = [];
  let molecule = buildMolecule((m) => {
    const pt = m.atom("Pt", vec(0, 0));
    m.bond(m.atom("Cl", vec(-1, 0)), pt);
    m.bond(m.atom("Cl", vec(0, -1)), pt);
    for (const pos of [vec(1, 0), vec(0, 1)]) {
      const n = m.atom("N", pos);
      ammines.push(n);
      datives.push(m.bond(n, pt));
    }
  });
  for (const id of datives) molecule = setBondDative(molecule, id, true);
  return { molecule, datives, ammines };
}

describe("RDKit reads this app's dative bonds", () => {
  it("writes cisplatin as V3000 and RDKit reads two DATIVE bonds, ammine first", () => {
    const { molecule } = cisplatin();
    expect(molblockVersionFor(molecule)).toBe("V3000");
    const written = moleculeToMolblock(molecule, "cisplatin");
    if (!written.ok) throw new Error(written.error.message);

    const view = rdkitView(written.value);
    const dative = view.bonds.filter((bond) => bond.bo === RDKIT_DATIVE);
    expect(dative).toHaveLength(2);
    for (const bond of dative) {
      expect(view.atoms[bond.atoms[0]]?.z).toBe(7);
      expect(view.atoms[bond.atoms[1]]?.z).toBe(78);
    }
    // Both ammines keep three hydrogens on RDKit's side too.
    const nitrogens = view.atoms.filter((atom) => atom.z === 7);
    expect(nitrogens.map((atom) => atom.impHs ?? 0)).toEqual([3, 3]);
  });

  it("writes a bold bond as a plain one: display only", () => {
    const { molecule } = cisplatin();
    const first = molecule.bondIds[0]!;
    const bold = setBondBold(molecule, first, true);
    const a = moleculeToMolblock(molecule);
    const b = moleculeToMolblock(bold);
    if (!a.ok || !b.ok) throw new Error("export refused");
    expect(b.value).toBe(a.value);
  });
});

describe("this app reads RDKit's dative bonds", () => {
  it("round-trips cisplatin through RDKit with the donors and hydrogens intact", () => {
    const { molecule } = cisplatin();
    const written = moleculeToMolblock(molecule);
    if (!written.ok) throw new Error(written.error.message);
    const mol = RDKit.get_mol(written.value) as JsonMol | null;
    if (mol === null) throw new Error("RDKit refused our file");
    const back = (() => {
      try {
        return molblockToMolecule(mol.get_v3Kmolblock());
      } finally {
        mol.delete();
      }
    })();
    if (!back.ok) throw new Error(back.error.message);
    const result = back.value.molecule;

    expect(elementCounts(result)).toEqual(elementCounts(molecule));
    const dative = result.bondIds.map((id) => requireBond(result, id)).filter((bond) => bond.dative);
    expect(dative).toHaveLength(2);
    for (const bond of dative) {
      expect(result.atoms[bond.from]?.element).toBe("N");
      expect(implicitHydrogenCount(result, bond.from)).toBe(3);
    }
  });

  it("reads RDKit's own N->B as NH3 + BH2, the hydrogens RDKit itself derives", () => {
    const text = rdkitV3000("N->B");
    expect(text).toMatch(/M {2}V30 1 9 \d \d/);
    const view = rdkitView(text);
    const back = molblockToMolecule(text);
    if (!back.ok) throw new Error(back.error.message);
    const result = back.value.molecule;
    for (const [index, atomId] of result.atomIds.entries()) {
      expect(implicitHydrogenCount(result, atomId)).toBe(view.atoms[index]?.impHs ?? 0);
    }
    expect(elementCounts(result)).toEqual({ B: 1, H: 5, N: 1 });
  });

  it("agrees with RDKit that H3N->BH3 is not drawable without a charge", () => {
    expect(RDKit.get_mol("[NH3]->[BH3]")).toBeNull();
  });
});
