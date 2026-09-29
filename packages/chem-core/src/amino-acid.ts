/**
 * Alpha-amino acids: which carbon is C1, which chain is the parent, and D/L.
 *
 * A SEPARATE ENTRY POINT FROM THE SUGARS (decision 132). The two share one
 * thing, the Fischer-convention parity read in fischer-side.ts, and nothing
 * else: a sugar's D/L is read at its HIGHEST-numbered stereocentre, an amino
 * acid's at its ALPHA carbon. Threonine and isoleucine are why that matters:
 * both have a second centre at C3, and reading L-threonine the sugar way, at
 * C3, calls it D. Neither reading ever goes through R/S. L-cysteine is (R)
 * because sulfur outranks the carboxyl carbon, so "S means L" passes nineteen
 * of the proteinogenic amino acids and fails the twentieth.
 *
 * PERCEPTION. An alpha carbon is a non-aromatic sp3 carbon with exactly one
 * singly bonded nitrogen and exactly one CARBOXYL-TYPE carbon: a carbon with
 * one double bond to oxygen and one single bond to O or N, which covers the
 * acid, the carboxylate, an ester and the amide of a peptide. A carbon with two
 * such neighbours (aminomalonic acid) has no single C1 and is not reported.
 *
 * NUMBERING, per the amino-acid recommendations (3AA-1): the carboxyl carbon
 * is C1, the alpha carbon C2, and the parent chain continues through the
 * longest run of acyclic carbons from the alpha carbon (carbon-chain.ts). So
 * isoleucine is numbered through its ethyl branch (C4, C5), its methyl gets
 * no number, and threonine runs C1 to C4 through its methyl, not its oxygen.
 * Where two branches tie, the numbering stops (valine stops at C3, leucine at
 * C4) rather than choosing a methyl by atom id (decision 142). Ring atoms end
 * the chain: phenylalanine is C1 to C3 and proline C1 to C2.
 *
 * D/L: the alpha carbon with the carboxyl carbon UP and the next chain carbon
 * DOWN; the nitrogen on the right is D. Glycine's alpha carbon is not a
 * stereocentre and is refused as achiral rather than given either letter.
 */

import { chainCarbonNeighbours, extendChain } from "./carbon-chain.js";
import {
  fischerSide,
  type DLConfiguration,
} from "./fischer-side.js";
import { bondsAt, getAtom, otherEnd } from "./molecule.js";
import { cipTopologyFingerprint } from "./cip.js";
import { LruCache } from "./rings.js";
import { compareIds } from "./selection.js";
import type { StereoConfig } from "./stereo-config.js";
import { stereoConfig, stereoTopology } from "./stereo-config.js";
import type { AtomId, Molecule } from "./types.js";

export interface AlphaAminoAcid {
  readonly alphaCarbon: AtomId;
  /** C1: the carboxyl, carboxylate, ester or amide carbon. */
  readonly carboxylCarbon: AtomId;
  readonly nitrogen: AtomId;
  /**
   * The numbered parent chain in locant order: `backbone[i]` is C(i + 1), so
   * `backbone[0]` is the carboxyl carbon and `backbone[1]` the alpha carbon.
   */
  readonly backbone: readonly AtomId[];
  /** Where the parent chain stopped because two branches tied. */
  readonly tiedAt?: AtomId;
}

/** A carbon with one C=O and one single bond to O or N: acid, salt, ester, amide. */
function isCarboxylType(mol: Molecule, atomId: AtomId): boolean {
  const atom = getAtom(mol, atomId);
  if (atom === undefined || atom.element !== "C" || atom.aromatic) return false;
  let carbonylO = 0;
  let singleHetero = 0;
  for (const bond of bondsAt(mol, atomId)) {
    const other = getAtom(mol, otherEnd(bond, atomId));
    if (other === undefined || bond.aromatic) return false;
    if (bond.order === 2 && other.element === "O") carbonylO++;
    else if (bond.order === 1 && (other.element === "O" || other.element === "N")) singleHetero++;
    else if (bond.order !== 1) return false;
  }
  return carbonylO === 1 && singleHetero === 1;
}

function perceive(mol: Molecule): readonly AlphaAminoAcid[] {
  const out: AlphaAminoAcid[] = [];
  for (const id of mol.atomIds) {
    const atom = mol.atoms[id]!;
    if (atom.element !== "C" || atom.aromatic) continue;
    const bonds = bondsAt(mol, id);
    if (bonds.some((bond) => bond.order !== 1 || bond.aromatic)) continue;
    const nitrogens: AtomId[] = [];
    const carboxyls: AtomId[] = [];
    for (const bond of bonds) {
      const other = otherEnd(bond, id);
      const element = mol.atoms[other]?.element;
      if (element === "N") nitrogens.push(other);
      else if (element === "C" && isCarboxylType(mol, other)) carboxyls.push(other);
    }
    if (nitrogens.length !== 1 || carboxyls.length !== 1) continue;
    const carboxyl = carboxyls[0]!;
    const side = chainCarbonNeighbours(mol, id).filter((other) => other !== carboxyl);
    const chain = extendChain(mol, id, side, new Set([carboxyl]));
    out.push(
      Object.freeze({
        alphaCarbon: id,
        carboxylCarbon: carboxyl,
        nitrogen: nitrogens[0]!,
        backbone: Object.freeze([carboxyl, id, ...chain.path]),
        ...(chain.tiedAt === undefined ? {} : { tiedAt: chain.tiedAt }),
      }),
    );
  }
  out.sort((a, b) => compareIds(a.alphaCarbon, b.alphaCarbon));
  return Object.freeze(out);
}

const BY_INSTANCE = new WeakMap<Molecule, readonly AlphaAminoAcid[]>();
const BY_TOPOLOGY = new LruCache<readonly AlphaAminoAcid[]>(32);

/**
 * Every alpha-amino acid unit in `mol`, by alpha carbon in `compareIds`
 * order. Topology only, so a drag reuses the answer.
 */
export function alphaAminoAcids(mol: Molecule): readonly AlphaAminoAcid[] {
  const hit = BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = BY_TOPOLOGY.get(key);
  if (shared) {
    BY_INSTANCE.set(mol, shared);
    return shared;
  }
  const built = perceive(mol);
  BY_TOPOLOGY.set(key, built);
  BY_INSTANCE.set(mol, built);
  return built;
}

/** The alpha carbon's one carbon neighbour besides C1, if it has exactly one. */
function sideChainCarbon(mol: Molecule, unit: AlphaAminoAcid): AtomId | undefined {
  const carbons = bondsAt(mol, unit.alphaCarbon)
    .map((bond) => otherEnd(bond, unit.alphaCarbon))
    .filter((id) => id !== unit.carboxylCarbon && mol.atoms[id]?.element === "C");
  return carbons.length === 1 ? carbons[0] : undefined;
}

/**
 * D or L for one amino acid: the alpha carbon with the carboxyl carbon up and
 * the side chain down, and the nitrogen's side (decision 132). Never derived
 * from R/S.
 */
export function aminoAcidSeries(
  mol: Molecule,
  unit: AlphaAminoAcid,
  config?: StereoConfig,
): DLConfiguration {
  const atomId = unit.alphaCarbon;
  const isCentre = stereoTopology(mol).centres.some((c) => c.atomId === atomId);
  if (!isCentre) return { kind: "notApplicable", reason: "achiral-alpha-carbon" };
  // The side chain's first carbon. Usually C3 of the parent chain, but a ring
  // ends the chain without ending the side chain: proline's C-beta is a ring
  // carbon, and it is still what points down.
  const down = unit.backbone[2] ?? sideChainCarbon(mol, unit);
  if (down === undefined) return { kind: "undetermined", reason: "tied-chain", atomId };
  const side = fischerSide(
    mol,
    atomId,
    { up: unit.carboxylCarbon, down, side: unit.nitrogen },
    config ?? stereoConfig(mol),
  );
  switch (side.kind) {
    case "right":
      return { kind: "D", atomId };
    case "left":
      return { kind: "L", atomId };
    case "mixture":
      return { kind: "mixture", atomId };
    case "undetermined":
      return { kind: "undetermined", reason: side.reason, atomId };
  }
}
