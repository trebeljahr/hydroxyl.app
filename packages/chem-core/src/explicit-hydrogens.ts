/**
 * Drawing every implicit hydrogen on a set of atoms, and folding drawn ones
 * back into the count: the editor's "Add explicit H" and "Remove explicit H"
 * (decision 242).
 *
 * THE STORED DEFAULT DOES NOT MOVE. Hydrogens stay implicit unless the author
 * asks for them, and a drawn protium is read exactly like an implicit one by
 * every consumer (`isProtiumAtom`), so both directions change the drawing and
 * nothing the chemistry reports: the formula, the mass and every stereo
 * descriptor are the same before and after. That is the whole contract, and
 * each half refuses an atom rather than break it.
 *
 * ADDING keeps decision 152's two guarantees for every hydrogen it draws: the
 * count is conserved exactly, and a specified centre goes through
 * `promoteImplicitHydrogen`, so it keeps its configuration or is refused.
 * Every other atom's hydrogens go on the explicit-H view's fan. An atom
 * carrying a display label ("Ph", "Boc", "R") is skipped — a hydrogen bonded
 * to an abbreviation draws a structure the label says is not there.
 *
 * REMOVING folds only what `isProtiumAtom` calls interchangeable with an
 * implicit hydrogen: natural isotope, uncharged, no radical, one bond. A
 * deuterium label, a hydride, a bridging hydrogen and H2 stay drawn, because
 * folding them would change the chemistry rather than the drawing. The heavy
 * neighbour's count goes up by exactly the number folded — a pinned count is
 * raised, a derived one is pinned only when valence would derive a different
 * number, the mirror of what promotion does.
 *
 * A fold that would change a descriptor is REFUSED, not repaired. Taking away
 * the wedged hydrogen of a stereocentre leaves three plain bonds and no
 * configuration. The double bonds at the atom are checked the same way.
 * Moving the wedge to another bond is a choice between drawings that read the
 * same, and choosing one behind the author's back is what decision 152 refuses
 * on the promotion side too. So the neighbour's hydrogens stay and the result
 * names it.
 */

import { assembleMolecule } from "./builders.js";
import {
  bondsAt,
  cloneAtomWith,
  makeAtom,
  otherEnd,
  requireAtom,
  requireBond,
} from "./molecule.js";
import { removeAtoms, updateAtom } from "./ops.js";
import { promoteImplicitHydrogen } from "./promote-hydrogen.js";
import { DEFAULT_BOND_LENGTH, hydrogenFan } from "./sprout.js";
import { cipDescriptor, doubleBondDescriptor, type StereoDescriptor } from "./stereo.js";
import { stereoConfig, stereoTopology } from "./stereo-config.js";
import { medianBondLength } from "./transform.js";
import type { Atom, AtomId, Bond, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount, isProtiumAtom } from "./valence.js";
import { add, fromPolar } from "./vec.js";

export interface ExplicitHydrogensResult {
  /** The new molecule, or the input itself when nothing changed. */
  readonly molecule: Molecule;
  /** Hydrogen atoms drawn (add) or folded away (remove), in order. */
  readonly hydrogenIds: readonly AtomId[];
  /** Atoms left alone because the edit would have changed a configuration. */
  readonly refused: readonly AtomId[];
  /** Remove only: foldable hydrogens left drawn because the caller kept them. */
  readonly kept: readonly AtomId[];
}

export interface RemoveExplicitHydrogensOptions {
  /**
   * Hydrogens never to fold. The editor passes the ones an annotation names
   * — a curly arrow to the proton being transferred, a partial charge on it —
   * since folding would delete the annotation along with the atom. chem-core
   * never learns what an arrow is, so the caller says which atoms are taken.
   */
  readonly keep?: ReadonlySet<AtomId>;
}

/** True when "add" would draw at least one hydrogen on `atomIds`, or refuse one. */
export function hasHydrogensToDraw(mol: Molecule, atomIds: readonly AtomId[]): boolean {
  return atomIds.some((atomId) => canDrawOn(mol, atomId));
}

/**
 * True when "remove" has at least one drawn protium on `atomIds` to consider.
 * Kept and refused ones count: the command still has something to say about
 * them, which a greyed-out row could not.
 */
export function hasHydrogensToFold(mol: Molecule, atomIds: readonly AtomId[]): boolean {
  return foldable(mol, atomIds).size > 0;
}

/** Not a hydrogen, not an abbreviation, and has an implicit hydrogen. */
function canDrawOn(mol: Molecule, atomId: AtomId): boolean {
  if (!Object.hasOwn(mol.atoms, atomId)) return false;
  const atom = requireAtom(mol, atomId);
  return atom.element !== "H" && atom.label === undefined && implicitHydrogenCount(mol, atomId) > 0;
}

/**
 * Every drawn protium `atomIds` reach, mapped to the heavy atom it would fold
 * into: a selected hydrogen itself, and every one on a selected heavy atom.
 */
function foldable(mol: Molecule, atomIds: readonly AtomId[]): Map<AtomId, AtomId> {
  const out = new Map<AtomId, AtomId>();
  const consider = (hId: AtomId, heavyId: AtomId) => {
    if (!isProtiumAtom(mol, hId)) return;
    // H2: neither end is the heavy atom the count could move onto.
    if (requireAtom(mol, heavyId).element === "H") return;
    out.set(hId, heavyId);
  };
  for (const atomId of atomIds) {
    if (!Object.hasOwn(mol.atoms, atomId)) continue;
    const atom = requireAtom(mol, atomId);
    if (atom.element === "H") {
      const [bond] = bondsAt(mol, atomId);
      if (bond !== undefined) consider(atomId, otherEnd(bond, atomId));
      continue;
    }
    for (const bond of bondsAt(mol, atomId)) consider(otherEnd(bond, atomId), atomId);
  }
  return out;
}

/**
 * `mol` with every implicit hydrogen on `atomIds` drawn as a real atom.
 * Ids not in the molecule, hydrogens and labelled atoms are skipped.
 *
 * LINEAR, NOT ONE PROMOTION PER HYDROGEN. Promoting one at a time copies the
 * molecule and perceives stereo afresh for every hydrogen, and drawing all of
 * a 300-carbon chain's took eight seconds that way. Only a specified
 * stereocentre needs promotion's search for a position that keeps its
 * configuration, and drawing a protium never makes another atom one, so the
 * centres are perceived once, up front, and everything else is placed on
 * `hydrogenFan` — the fan the explicit-H view already draws them on — and
 * assembled in one pass.
 */
export function addExplicitHydrogens(
  mol: Molecule,
  atomIds: readonly AtomId[],
): ExplicitHydrogensResult {
  const targets = [...new Set(atomIds)].filter((atomId) => canDrawOn(mol, atomId));
  if (targets.length === 0) return { molecule: mol, hydrogenIds: [], refused: [], kept: [] };

  const specified = new Set(
    stereoConfig(mol)
      .centres.filter((c) => c.reading.kind === "specified" && c.implicitHydrogen)
      .map((c) => c.atomId),
  );
  const bondLength = medianBondLength(mol) ?? DEFAULT_BOND_LENGTH;

  const atoms: Record<AtomId, Atom> = { ...mol.atoms };
  const bonds: Record<BondId, Bond> = { ...mol.bonds };
  const newAtomIds: AtomId[] = [];
  const newBondIds: BondId[] = [];
  let nextId = mol.nextId;
  const hydrogenIds: AtomId[] = [];
  const fanned: AtomId[] = [];
  for (const atomId of targets) {
    if (specified.has(atomId)) continue;
    const atom = requireAtom(mol, atomId);
    const count = implicitHydrogenCount(mol, atomId);
    for (const sector of hydrogenFan(mol, atomId, count)) {
      // Atom first, then bond, from the one counter: the ids `addAtom` and
      // `addBond` would have minted in the same order.
      const hId = `a${nextId++}`;
      const bondId = `b${nextId++}`;
      atoms[hId] = makeAtom(hId, {
        element: "H",
        pos: add(atom.pos, fromPolar(sector.angle, bondLength)),
      });
      bonds[bondId] = {
        id: bondId,
        from: atomId,
        to: hId,
        order: 1,
        stereo: "none",
        doubleBondSide: "auto",
        aromatic: false,
      };
      newAtomIds.push(hId);
      newBondIds.push(bondId);
      hydrogenIds.push(hId);
    }
    if (atom.explicitHydrogenCount !== undefined) {
      atoms[atomId] = cloneAtomWith(atom, { explicitHydrogenCount: 0 });
    } else {
      fanned.push(atomId);
    }
  }
  let next = assembleMolecule({
    atoms,
    bonds,
    atomIds: [...mol.atomIds, ...newAtomIds],
    bondIds: [...mol.bondIds, ...newBondIds],
    nextId,
    stereoGroups: mol.stereoGroups,
    speciesJoins: mol.speciesJoins,
  });
  // The bonds moved an atom onto a different valence; pin rather than let a
  // hydrogen appear. Rare enough that one copy each is fine.
  for (const atomId of fanned) {
    if (implicitHydrogenCount(next, atomId) !== 0) {
      next = updateAtom(next, atomId, { explicitHydrogenCount: 0 });
    }
  }

  const refused: AtomId[] = [];
  for (const atomId of targets) {
    if (!specified.has(atomId)) continue;
    // A specified centre carries one implicit hydrogen at most: two would be
    // two identical ligands.
    const promoted = promoteImplicitHydrogen(next, atomId);
    if (promoted.ok) {
      next = promoted.molecule;
      hydrogenIds.push(promoted.hydrogenId);
    } else if (promoted.reason === "configuration-not-kept") {
      refused.push(atomId);
    }
  }
  return { molecule: next, hydrogenIds, refused, kept: [] };
}

/**
 * `mol` with the drawn protium on `atomIds` folded into the implicit count.
 * A selected hydrogen folds into its neighbour; a selected heavy atom folds
 * every drawn protium on it.
 */
export function removeExplicitHydrogens(
  mol: Molecule,
  atomIds: readonly AtomId[],
  options: RemoveExplicitHydrogensOptions = {},
): ExplicitHydrogensResult {
  // Hydrogen -> the atom it folds into.
  const parent = new Map<AtomId, AtomId>();
  const kept = new Set<AtomId>();
  for (const [hId, heavyId] of foldable(mol, atomIds)) {
    if (options.keep?.has(hId) === true) kept.add(hId);
    else parent.set(hId, heavyId);
  }

  // Fold, check every heavy atom touched, and drop the ones whose
  // configuration moved. Each round removes at least one parent, so it ends.
  const refused: AtomId[] = [];
  for (;;) {
    const next = fold(mol, parent);
    const broken = changedConfigurations(mol, next, new Set(parent.values()));
    if (broken.length === 0) {
      return { molecule: next, hydrogenIds: [...parent.keys()], refused, kept: [...kept] };
    }
    const dropping = new Set(broken);
    refused.push(...broken);
    for (const [hId, heavyId] of [...parent]) {
      if (dropping.has(heavyId)) parent.delete(hId);
    }
  }
}

function fold(mol: Molecule, parent: ReadonlyMap<AtomId, AtomId>): Molecule {
  if (parent.size === 0) return mol;
  const folded = new Map<AtomId, number>();
  for (const heavyId of parent.values()) folded.set(heavyId, (folded.get(heavyId) ?? 0) + 1);

  const removed = removeAtoms(mol, [...parent.keys()]);
  // Every count settled against `removed`, then written in one copy: an
  // `updateAtom` per atom would copy the molecule once for each.
  const atoms: Record<AtomId, Atom> = { ...removed.atoms };
  for (const [heavyId, k] of folded) {
    const atom = requireAtom(mol, heavyId);
    if (atom.explicitHydrogenCount !== undefined) {
      atoms[heavyId] = cloneAtomWith(atom, {
        explicitHydrogenCount: atom.explicitHydrogenCount + k,
      });
      continue;
    }
    const total = implicitHydrogenCount(mol, heavyId) + k;
    // The bonds removed moved the atom onto a different valence; pin rather
    // than let a hydrogen appear or vanish.
    if (implicitHydrogenCount(removed, heavyId) !== total) {
      atoms[heavyId] = cloneAtomWith(atom, { explicitHydrogenCount: total });
    }
  }
  return { ...removed, atoms };
}

/**
 * The atoms among `touched` whose own descriptor, or that of a double bond at
 * them, reads differently in `after`. A folded hydrogen is a ligand of its
 * neighbour and a substituent of that neighbour's double bonds, and of
 * nothing else, so these are the only units a fold can reach.
 *
 * Only stereo UNITS are read. Asking every touched atom for a descriptor ran
 * a CIP ranking on each, which made folding a 300-carbon chain's hydrogens
 * take over a second; the topology is one memoised pass, and folding protium
 * cannot make a unit, because CIP already reads drawn protium as implicit.
 *
 * When a double bond's descriptor moves, BOTH ends are reported, since either
 * end's fold may be the one that did it.
 */
function changedConfigurations(
  before: Molecule,
  after: Molecule,
  touched: ReadonlySet<AtomId>,
): AtomId[] {
  const topology = stereoTopology(before);
  const broken = new Set<AtomId>();
  for (const { atomId } of topology.centres) {
    if (!touched.has(atomId)) continue;
    if (!sameDescriptor(cipDescriptor(before, atomId), cipDescriptor(after, atomId))) {
      broken.add(atomId);
    }
  }
  for (const { bondId } of topology.doubleBonds) {
    const bond = requireBond(before, bondId);
    if (!touched.has(bond.from) && !touched.has(bond.to)) continue;
    if (
      !sameDescriptor(doubleBondDescriptor(before, bondId), doubleBondDescriptor(after, bondId))
    ) {
      broken.add(bond.from);
      broken.add(bond.to);
    }
  }
  // Only atoms that actually lost a hydrogen can be held back.
  return [...broken].filter((id) => touched.has(id));
}

/** Same statement. An undetermined reading is one statement whatever its reason. */
function sameDescriptor(a: StereoDescriptor | undefined, b: StereoDescriptor | undefined): boolean {
  return a?.kind === b?.kind;
}
