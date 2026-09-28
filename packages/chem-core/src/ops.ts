/**
 * Edits to an existing molecule.
 *
 * molecule.ts builds structures up and answers questions about them. This is
 * the layer that changes one that already exists — delete, patch, move, merge
 * — and it is what the editor's tools and the undo stack are written against,
 * so that a command reads as chemistry ("set this oxygen to -1", "close the
 * ring") rather than as record surgery.
 *
 * Three conventions run through the whole file.
 *
 * DELETION IS IDEMPOTENT; UPDATING IS NOT. Removing an id that is not there is
 * a no-op, because an undo entry, a stale selection or a second click on a
 * delete button will legitimately hand us ids that are already gone. Updating
 * an id that is not there throws, because there is no atom to write the patch
 * onto and silently dropping the edit would lose user intent. The asymmetry is
 * deliberate, not an oversight.
 *
 * A NO-OP RETURNS THE INPUT OBJECT. The primary consumer is a React tree doing
 * referential-equality checks; a structurally identical but freshly allocated
 * molecule would repaint the whole canvas for nothing.
 *
 * IDS ARE NEVER REUSED, INCLUDING AFTER A DELETE. Nothing here touches
 * `nextId` — not removal, not merging. A retired id stays retired so an undo
 * entry holding it can never resolve to a different atom later.
 *
 * COST MODEL. The bulk entry points (`removeAtoms`, `removeBonds`,
 * `setAtomPositions`, `mergeAtoms`) each do one linear pass and allocate one
 * new molecule. They are never folds over the singular version: like
 * `addAtom`/`addBond`, every one of these is O(n), so looping would be
 * quadratic. The singular functions delegate to the bulk ones, not the
 * reverse.
 */

import type { ElementSymbol } from "./elements.js";
import {
  atomsEqual,
  bondBetween,
  cloneAtomWith,
  otherEnd,
  requireAtom,
  requireBond,
  adjacency,
} from "./molecule.js";
import type {
  Atom,
  AtomId,
  Bond,
  BondId,
  BondOrder,
  BondStereo,
  DoubleBondSide,
  Molecule,
} from "./types.js";
import { assembleMolecule } from "./builders.js";
import { prunedStereoGroups, stereoGroupsOf } from "./stereo-groups.js";
import { prunedSpeciesJoins, renamedSpeciesJoins, speciesJoinsOf } from "./species.js";
import type { Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/**
 * Removes atoms and every bond incident on them, in one pass.
 *
 * The cascade is not optional: a bond whose endpoint no longer exists would
 * break every traversal, the adjacency index and molfile export alike, so
 * there is no "keep the bond" variant to offer.
 *
 * Ids that are not present are ignored — see the idempotence note at the top.
 */
export function removeAtoms(mol: Molecule, ids: readonly AtomId[]): Molecule {
  const doomed = new Set<AtomId>();
  for (const id of ids) {
    if (id in mol.atoms) doomed.add(id);
  }
  if (doomed.size === 0) return mol;

  const atoms: Record<AtomId, Atom> = {};
  const atomIds: AtomId[] = [];
  for (const id of mol.atomIds) {
    if (doomed.has(id)) continue;
    atoms[id] = requireAtom(mol, id);
    atomIds.push(id);
  }

  const bonds: Record<BondId, Bond> = {};
  const bondIds: BondId[] = [];
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    if (doomed.has(bond.from) || doomed.has(bond.to)) continue;
    bonds[bondId] = bond;
    bondIds.push(bondId);
  }

  // nextId is carried over untouched: deleting the newest atom must not free
  // its id for the next one.
  //
  // Stereo groups are PRUNED, not carried. A group naming a deleted atom is a
  // dangling reference exactly like a bond naming one, and it fails later and
  // further away: the document schema rejects it on save, so the user loses the
  // file rather than the group. A group that empties out disappears, because an
  // empty group is a second spelling of "nothing was said" (see the field
  // comment on `Molecule.stereoGroups`). The stored kind and index of a group
  // that merely SHRANK are untouched — it is still `&1`, and renumbering it
  // here would change what an unrelated group's written label says.
  return assembleMolecule({
    atoms,
    bonds,
    atomIds,
    bondIds,
    nextId: mol.nextId,
    stereoGroups: prunedStereoGroups(stereoGroupsOf(mol), (id) => !doomed.has(id)),
    // Species joins are pruned the same way and for the same reason; a join
    // left naming a single atom joins nothing and goes (decision 102).
    speciesJoins: prunedSpeciesJoins(speciesJoinsOf(mol), (id) => !doomed.has(id)),
  });
}

export function removeAtom(mol: Molecule, id: AtomId): Molecule {
  return removeAtoms(mol, [id]);
}

/**
 * Removes bonds only. Both endpoints survive — that is how a ring is opened
 * and how two fragments are separated without losing their atoms.
 */
export function removeBonds(mol: Molecule, ids: readonly BondId[]): Molecule {
  const doomed = new Set<BondId>();
  for (const id of ids) {
    if (id in mol.bonds) doomed.add(id);
  }
  if (doomed.size === 0) return mol;

  const bonds: Record<BondId, Bond> = {};
  const bondIds: BondId[] = [];
  for (const bondId of mol.bondIds) {
    if (doomed.has(bondId)) continue;
    bonds[bondId] = requireBond(mol, bondId);
    bondIds.push(bondId);
  }
  return { ...mol, bonds, bondIds };
}

export function removeBond(mol: Molecule, id: BondId): Molecule {
  return removeBonds(mol, [id]);
}

// ---------------------------------------------------------------------------
// Patching
//
// A key absent from a patch leaves the field alone. A key present with the
// value `undefined` on an OPTIONAL field deletes it, so the result is
// deep-equal to an atom that never carried it — `exactOptionalPropertyTypes`
// forbids storing undefined, and the assembly point in molecule.ts omits
// rather than assigns for the same reason. Telling those two cases apart
// therefore needs `Object.hasOwn`, never `patch.x !== undefined`; that is
// exactly `cloneAtomWith`'s contract, which is why the patch functions
// delegate to it instead of spreading.
// ---------------------------------------------------------------------------

export type AtomPatch = {
  readonly element?: ElementSymbol;
  readonly pos?: Vec2;
  readonly charge?: number;
  readonly radicalElectrons?: number;
  readonly aromatic?: boolean;
  readonly isotope?: number | undefined;
  readonly explicitHydrogenCount?: number | undefined;
  readonly lonePairs?: number | undefined;
  readonly label?: string | undefined;
};

export type BondPatch = {
  readonly from?: AtomId;
  readonly to?: AtomId;
  readonly order?: BondOrder;
  readonly stereo?: BondStereo;
  readonly doubleBondSide?: DoubleBondSide;
  readonly aromatic?: boolean;
};

/**
 * Applies a patch to one atom.
 *
 * Throws on an unknown id: unlike removal, there is no benign reading of
 * "change the element of an atom that is not there".
 *
 * The copy itself goes through `cloneAtomWith`, which owns the omit-don't-
 * assign rule for optional keys, so a field added to `Atom` later is carried
 * across here without this function having to learn about it.
 */
export function updateAtom(mol: Molecule, id: AtomId, patch: AtomPatch): Molecule {
  const atom = requireAtom(mol, id);
  const next = cloneAtomWith(atom, patch);
  if (atomsEqual(next, atom)) return mol;
  return { ...mol, atoms: { ...mol.atoms, [id]: next } };
}

/**
 * Applies a patch to one bond.
 *
 * Re-pointing an endpoint goes through the same guards as `addBond`: a bond
 * cannot join an atom to itself, and two atoms cannot be bonded twice. The
 * duplicate check ignores this bond's own id, so swapping `from` and `to`
 * (which necessarily "collides" with itself) is allowed.
 */
export function updateBond(mol: Molecule, id: BondId, patch: BondPatch): Molecule {
  const bond = requireBond(mol, id);

  const from = patch.from ?? bond.from;
  const to = patch.to ?? bond.to;
  const order = patch.order ?? bond.order;
  const stereo = patch.stereo ?? bond.stereo;
  const doubleBondSide = patch.doubleBondSide ?? bond.doubleBondSide;
  const aromatic = patch.aromatic ?? bond.aromatic;

  if (from !== bond.from || to !== bond.to) {
    if (from === to) throw new Error(`Cannot bond atom ${from} to itself`);
    requireAtom(mol, from);
    requireAtom(mol, to);
    const clash = bondBetween(mol, from, to);
    if (clash && clash.id !== id) {
      throw new Error(
        `Atoms ${from} and ${to} are already bonded (${clash.id})`,
      );
    }
  }

  const unchanged =
    from === bond.from &&
    to === bond.to &&
    order === bond.order &&
    stereo === bond.stereo &&
    doubleBondSide === bond.doubleBondSide &&
    aromatic === bond.aromatic;
  if (unchanged) return mol;

  const next: Bond = { id: bond.id, from, to, order, stereo, doubleBondSide, aromatic };
  return { ...mol, bonds: { ...mol.bonds, [id]: next } };
}

// ---------------------------------------------------------------------------
// Named setters
//
// Thin wrappers over the two patch functions. They exist so command and undo
// code reads as an intention rather than as a record update, and so the
// "pass undefined to clear" contract is visible in the signature.
// ---------------------------------------------------------------------------

export function setElement(
  mol: Molecule,
  id: AtomId,
  element: ElementSymbol,
): Molecule {
  return updateAtom(mol, id, { element });
}

export function setCharge(mol: Molecule, id: AtomId, charge: number): Molecule {
  return updateAtom(mol, id, { charge });
}

/** `undefined` clears the label back to natural isotopic abundance. */
export function setIsotope(
  mol: Molecule,
  id: AtomId,
  isotope: number | undefined,
): Molecule {
  return updateAtom(mol, id, { isotope });
}

/** `undefined` removes the display label, so the element symbol is drawn. */
export function setLabel(
  mol: Molecule,
  id: AtomId,
  label: string | undefined,
): Molecule {
  return updateAtom(mol, id, { label });
}

/** `undefined` hands the hydrogen count back to valence.ts to derive. */
export function setExplicitHydrogenCount(
  mol: Molecule,
  id: AtomId,
  count: number | undefined,
): Molecule {
  return updateAtom(mol, id, { explicitHydrogenCount: count });
}

/**
 * Pins the lone-pair count a Lewis structure draws, or `undefined` to hand it
 * back to `lonePairCount` to derive (decision 4).
 *
 * The pin is for the readings no rule can choose between — a sulfone's sulfur
 * is zero pairs expanded-octet and two charge-separated, and a resonance form
 * means one of them. It changes nothing about valence, formula or mass.
 */
export function setLonePairs(
  mol: Molecule,
  id: AtomId,
  pairs: number | undefined,
): Molecule {
  return updateAtom(mol, id, { lonePairs: pairs });
}

export function setBondOrder(
  mol: Molecule,
  id: BondId,
  order: BondOrder,
): Molecule {
  return updateBond(mol, id, { order });
}

const NEXT_ORDER: Record<BondOrder, BondOrder> = { 1: 2, 2: 3, 3: 1 };

/**
 * Single -> double -> triple -> single. This is the click-a-bond gesture, so
 * it wraps rather than saturating.
 *
 * On an aromatic bond it cycles the underlying Kekule order and leaves
 * `aromatic` alone. Clearing the flag here would be wrong twice over: the flag
 * is owned by aromaticity perception, and a user nudging one ring bond's
 * Kekule form has not said anything about whether the ring is aromatic.
 */
export function cycleBondOrder(mol: Molecule, id: BondId): Molecule {
  return setBondOrder(mol, id, NEXT_ORDER[requireBond(mol, id).order]);
}

export function setBondStereo(
  mol: Molecule,
  id: BondId,
  stereo: BondStereo,
): Molecule {
  return updateBond(mol, id, { stereo });
}

export function setDoubleBondSide(
  mol: Molecule,
  id: BondId,
  side: DoubleBondSide,
): Molecule {
  return updateBond(mol, id, { doubleBondSide: side });
}

/**
 * Swaps `from` and `to`.
 *
 * The stereo string is deliberately untouched. Per the convention in types.ts
 * a wedge's narrow end sits at `from`, so reversing the endpoints already
 * inverts the wedge geometrically: what pointed up out of the page now points
 * down. A reader expecting "wedge" to become "hash" here is reading the
 * annotation as absolute when it is relative to the bond's direction.
 *
 * `doubleBondSide` is left alone for a different reason. Reversing the
 * endpoints does invert which physical side `left` names, so a chemist who
 * pinned the inner line will see it move. That is the point of the gesture:
 * "flip" on a double bond is how the side gets changed by hand, and quietly
 * compensating would make the button do nothing. Contrast `flipAtoms` in
 * transform.ts, which mirrors coordinates: there the user asked for a mirror
 * image, not for a change of annotation, so both the stereo string and the
 * side have to be swapped to keep the picture saying what it said.
 */
export function flipBond(mol: Molecule, id: BondId): Molecule {
  const bond = requireBond(mol, id);
  return updateBond(mol, id, { from: bond.to, to: bond.from });
}

/**
 * Inverts the configuration drawn at `atomId`: every wedge whose narrow end
 * sits on this atom becomes a hash, and every hash a wedge. R becomes S.
 *
 * ONLY THE BONDS THAT START HERE. By the convention in types.ts a wedge makes
 * its claim about the atom at its narrow end, `from`. A wedge that merely
 * ARRIVES at this atom from a neighbour is a statement about the neighbour's
 * centre, and swapping it would invert a stereocentre nobody pointed at.
 * Exchanging wedge and hash on every bond out of one centre negates the depth
 * of each of its drawn ligands — a reflection through the page, restricted to
 * that centre — which is an inversion of it and of nothing else.
 *
 * Contrast `flipAtoms` in transform.ts, which mirrors the positions AND swaps
 * the marks, and therefore PRESERVES configuration; and `flipBond`, which
 * moves the narrow end to the other atom and so moves the claim rather than
 * inverting it.
 *
 * `wavy` and `either` say the configuration is unknown or mixed. They have no
 * opposite and are left alone. An atom with no wedge or hash of its own has
 * no configuration on the page to invert, and the INPUT molecule comes back —
 * callers read that identity as "nothing to invert here", which is how the
 * editor decides whether to offer the command at all.
 *
 * Throws on an unknown id, like every other update in this file.
 */
export function invertStereocentre(mol: Molecule, atomId: AtomId): Molecule {
  requireAtom(mol, atomId);
  let bonds: Record<BondId, Bond> | undefined;
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    if (bond.from !== atomId) continue;
    if (bond.stereo !== "wedge" && bond.stereo !== "hash") continue;
    bonds ??= { ...mol.bonds };
    bonds[bondId] = { ...bond, stereo: bond.stereo === "wedge" ? "hash" : "wedge" };
  }
  return bonds === undefined ? mol : { ...mol, bonds };
}

export function setAtomPosition(mol: Molecule, id: AtomId, pos: Vec2): Molecule {
  return updateAtom(mol, id, { pos });
}

/**
 * Moves several atoms at once.
 *
 * This is the drag path and runs on every pointer-move frame, so it copies the
 * atoms record exactly once and touches only the atoms that actually moved —
 * O(atoms + moved), not O(atoms * moved). Positions that are already correct
 * are skipped, so a drag that has not crossed a pixel returns the input
 * molecule and costs the renderer nothing.
 *
 * AN UNKNOWN ID THROWS, like every other update here, and unlike the transforms
 * in transform.ts, which skip ids they cannot resolve. The two are not
 * inconsistent: those take a SELECTION, a set of ids the user gestured at,
 * which legitimately outlives the atoms it named when an undo lands mid-drag;
 * this takes explicit atom/position PAIRS, each one a statement that this atom
 * belongs at this point, and dropping one silently would leave the caller with
 * a fragment torn apart along the ids that went missing. A drag over a
 * selection that may be stale therefore belongs in `translateAtoms`, not here.
 */
export function setAtomPositions(
  mol: Molecule,
  updates: Iterable<readonly [AtomId, Vec2]>,
): Molecule {
  let atoms: Record<AtomId, Atom> | undefined;
  for (const [id, pos] of updates) {
    const atom = requireAtom(mol, id);
    if (atom.pos.x === pos.x && atom.pos.y === pos.y) continue;
    atoms ??= { ...mol.atoms };
    atoms[id] = { ...atom, pos };
  }
  if (!atoms) return mol;
  return { ...mol, atoms };
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

export type MergeFailureReason = "no-such-atom" | "same-atom" | "already-bonded";

export type MergeAtomsResult =
  | {
      readonly ok: true;
      readonly molecule: Molecule;
      readonly survivingId: AtomId;
      readonly removedAtomId: AtomId;
      readonly removedBondIds: readonly BondId[];
    }
  | {
      readonly ok: false;
      readonly reason: MergeFailureReason;
      readonly message: string;
    };

function mergeFailure(
  reason: MergeFailureReason,
  message: string,
): MergeAtomsResult {
  return { ok: false, reason, message };
}

/**
 * Drops the dragged atom onto the target atom, fusing them into one — the
 * gesture that closes a ring or joins two fragments.
 *
 * FAILURE IS A RESULT, NOT A THROW. The pointer layer calls this speculatively
 * on every drag frame to decide whether to highlight the atom under the
 * cursor, so it has to be total and cheap when the answer is no.
 *
 * The decisions below are conventions, not accidents:
 *
 * - The SURVIVOR KEEPS THE TARGET'S ID AND POSITION. Bonds elsewhere in the
 *   molecule, held selections and undo entries all keep pointing at something
 *   real, and the structure does not visibly jump under the cursor.
 *
 * - THE DRAGGED ATOM'S CHEMICAL IDENTITY WINS: element, charge, isotope,
 *   radical electrons, label, explicit hydrogen count and the aromatic flag
 *   all come from the atom being dragged, and optional keys it does not carry
 *   are deleted rather than inherited. You dragged an N onto a C because you
 *   want an N there; ChemDraw and MarvinSketch agree.
 *
 * - A REWIRED BOND THAT DUPLICATES ONE AT THE TARGET COLLAPSES INTO IT. The
 *   existing bond keeps its id and its slot in `bondIds`, and its order is
 *   raised to the higher of the two, so dropping a C=O onto a C-O leaves a
 *   double bond rather than two parallel bonds. The discarded bond's stereo is
 *   dropped, not merged: a wedge describes the geometry of a narrow end at a
 *   specific atom, and that atom no longer exists.
 *
 * - ALREADY-BONDED ATOMS ARE REFUSED. Merging them would turn the bond between
 *   them into a self-bond, which the model cannot express; silently deleting a
 *   bond the user drew is worse than making the gesture snap back.
 *
 * No ids are minted, only retired, so `nextId` is unchanged.
 */
export function mergeAtoms(
  mol: Molecule,
  targetId: AtomId,
  draggedId: AtomId,
): MergeAtomsResult {
  if (targetId === draggedId) {
    return mergeFailure("same-atom", `Cannot merge atom ${targetId} into itself`);
  }
  const target = mol.atoms[targetId];
  const dragged = mol.atoms[draggedId];
  if (!target || !dragged) {
    return mergeFailure(
      "no-such-atom",
      `No such atom: ${target ? draggedId : targetId}`,
    );
  }
  if (bondBetween(mol, targetId, draggedId)) {
    return mergeFailure(
      "already-bonded",
      `Atoms ${targetId} and ${draggedId} are bonded; merging them would ` +
        `collapse that bond into a self-bond`,
    );
  }

  const adj = adjacency(mol);

  // What the target is already bonded to, so a rewired bond can be recognised
  // as a duplicate in O(1) instead of rescanning the bond list per neighbour.
  const targetBondByNeighbor = new Map<AtomId, BondId>();
  for (const bondId of adj.bondsAt[targetId] ?? []) {
    const bond = requireBond(mol, bondId);
    targetBondByNeighbor.set(otherEnd(bond, targetId), bondId);
  }

  const rewired = new Map<BondId, Bond>();
  const raisedOrders = new Map<BondId, BondOrder>();
  const removedBondIds: BondId[] = [];
  for (const bondId of adj.bondsAt[draggedId] ?? []) {
    const bond = requireBond(mol, bondId);
    const neighbor = otherEnd(bond, draggedId);
    const existingId = targetBondByNeighbor.get(neighbor);
    if (existingId !== undefined) {
      const existing = requireBond(mol, existingId);
      const order = (bond.order > existing.order ? bond.order : existing.order);
      if (order !== existing.order) raisedOrders.set(existingId, order);
      removedBondIds.push(bondId);
      continue;
    }
    rewired.set(
      bondId,
      bond.from === draggedId
        ? { ...bond, from: targetId }
        : { ...bond, to: targetId },
    );
  }

  // Copied from the DRAGGED atom, so every field it carries — including any
  // added to `Atom` later — comes across, and the ones it lacks stay absent.
  // Only the id and the position are the target's.
  const survivor = cloneAtomWith(dragged, { id: targetId, pos: target.pos });

  const atoms: Record<AtomId, Atom> = {};
  const atomIds: AtomId[] = [];
  for (const id of mol.atomIds) {
    if (id === draggedId) continue;
    atoms[id] = id === targetId ? survivor : requireAtom(mol, id);
    atomIds.push(id);
  }

  const bonds: Record<BondId, Bond> = {};
  const bondIds: BondId[] = [];
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    const replacement = rewired.get(bondId);
    if (replacement) {
      bonds[bondId] = replacement;
      bondIds.push(bondId);
      continue;
    }
    if (bond.from === draggedId || bond.to === draggedId) continue;
    const raised = raisedOrders.get(bondId);
    bonds[bondId] = raised === undefined ? bond : { ...bond, order: raised };
    bondIds.push(bondId);
  }

  return {
    ok: true,
    // The survivor keeps the TARGET's stereo group membership and the dragged
    // atom's id is simply DROPPED from every group. Not transferred: merging
    // destroys the ligand set at that position — the two atoms' bonds are
    // rewired onto one centre — so a transferred ABS/AND/OR statement would
    // describe a stereocentre that no longer exists. The survivor keeps the
    // target's id and position (decision 1), and this is the same choice one
    // field further on.
    molecule: assembleMolecule({
      atoms,
      bonds,
      atomIds,
      bondIds,
      nextId: mol.nextId,
      stereoGroups: prunedStereoGroups(stereoGroupsOf(mol), (id) => id !== draggedId),
      // Species joins are the opposite choice, deliberately: the dragged id is
      // RENAMED to the survivor's rather than dropped. A group describes the
      // ligand set at a centre, which merging destroys; a join says which
      // pieces are one compound, which merging only makes more true — the two
      // atoms are now one. Dropping it would silently split a salt whose only
      // joined atom was the one the user dragged.
      speciesJoins: renamedSpeciesJoins(speciesJoinsOf(mol), draggedId, targetId),
    }),
    survivingId: targetId,
    removedAtomId: draggedId,
    removedBondIds,
  };
}
