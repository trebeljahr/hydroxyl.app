/**
 * Fragment surgery: cutting a piece of a structure out as a standalone
 * molecule, and pasting a standalone molecule into another one.
 *
 * This is the layer copy/paste, duplicate (ctrl-D) and the ring/functional-
 * group templates all sit on. A template is nothing more than a small
 * molecule built ahead of time and inserted into the drawing, so the same
 * remapping code serves both.
 *
 * The hard part is ids. A fragment carries ids from wherever it came from,
 * and those will collide with the target's the moment you paste it into the
 * molecule it was cut from. So insertion mints every pasted id from the
 * TARGET's monotonic counter — nothing is ever reused, and a stale reference
 * in an undo entry can never resolve to a pasted atom.
 *
 * COST MODEL. Both directions are a single linear pass that ends in one new
 * Molecule literal. Looping over `addAtom`/`addBond` would be quadratic; see
 * the cost note at the top of molecule.ts.
 */

import {
  cloneAtomWith,
  emptyMolecule,
  requireAtom,
  requireBond,
} from "./molecule.js";
import type { Atom, AtomId, Bond, BondId, Molecule } from "./types.js";
import { assembleMolecule } from "./builders.js";
import {
  graftStereoGroups,
  remappedStereoGroups,
  stereoGroupsOf,
} from "./stereo-groups.js";
import { add as addVec, type Vec2 } from "./vec.js";

export interface ExtractedFragment {
  readonly molecule: Molecule;
  /** source id -> fragment id */
  readonly atomIdMap: ReadonlyMap<AtomId, AtomId>;
  readonly bondIdMap: ReadonlyMap<BondId, BondId>;
}

export interface InsertedFragment {
  readonly molecule: Molecule;
  /** fragment id -> id in target */
  readonly atomIdMap: ReadonlyMap<AtomId, AtomId>;
  readonly bondIdMap: ReadonlyMap<BondId, BondId>;
  /** New ids, in fragment insertion order. */
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
}

/**
 * Copy an atom under a new id and position.
 *
 * Delegates to `cloneAtomWith` rather than listing the fields again. Copying
 * is where a forgotten field is most expensive: a hand-rolled copy that does
 * not know about, say, a stereo parity added to `Atom` later would compile,
 * pass every existing test, and quietly return an achiral paste of a
 * stereocentre. One copy routine, one place to teach.
 */
function copyAtom(source: Atom, id: AtomId, pos: Vec2): Atom {
  return cloneAtomWith(source, { id, pos });
}

function copyBond(source: Bond, id: BondId, from: AtomId, to: AtomId): Bond {
  return {
    id,
    from,
    to,
    order: source.order,
    stereo: source.stereo,
    doubleBondSide: source.doubleBondSide,
    aromatic: source.aromatic,
  };
}

/**
 * Cut the given atoms out as a standalone molecule.
 *
 * The result is a molecule in its own right, not a view: ids are minted from
 * a fresh counter starting at 1, so the fragment is indistinguishable from
 * one that was drawn from scratch and can be serialised, rendered or pasted
 * anywhere.
 *
 * A bond is carried over only when BOTH endpoints are in the selection. A
 * bond with one endpoint outside would be a dangling reference, which the
 * flat id-based graph has no way to represent. Capping the cut with a
 * hydrogen would be the chemically interesting alternative — but that is a
 * chemistry decision (which end keeps the hydrogen? what about a double
 * bond?) that this module deliberately does not make on the user's behalf.
 *
 * Insertion order is inherited from the SOURCE, not from the caller's `ids`
 * array: `ids` is a set in disguise and typically arrives in click order,
 * while molfile round-trips and stereo parity depend on the drawing order.
 *
 * Positions are copied verbatim — extraction never re-centres. The caller
 * decides framing, because a copy that silently moved the structure would
 * shift the user's drawing out from under them on paste-in-place.
 */
export function extractFragment(
  mol: Molecule,
  ids: readonly AtomId[],
): ExtractedFragment {
  const wanted = new Set<AtomId>();
  for (const id of ids) {
    // Deduplicates, and drops ids that are not in this molecule at all —
    // a selection can outlive the atoms it referred to.
    if (id in mol.atoms) wanted.add(id);
  }

  const atomIdMap = new Map<AtomId, AtomId>();
  const bondIdMap = new Map<BondId, BondId>();
  if (wanted.size === 0) {
    return { molecule: emptyMolecule(), atomIdMap, bondIdMap };
  }

  const atoms: Record<AtomId, Atom> = {};
  const bonds: Record<BondId, Bond> = {};
  const atomIds: AtomId[] = [];
  const bondIds: BondId[] = [];
  let nextId = 1;

  for (const sourceId of mol.atomIds) {
    if (!wanted.has(sourceId)) continue;
    const atom = requireAtom(mol, sourceId);
    const id = `a${nextId++}`;
    atomIdMap.set(sourceId, id);
    atomIds.push(id);
    atoms[id] = copyAtom(atom, id, atom.pos);
  }

  for (const sourceId of mol.bondIds) {
    const bond = requireBond(mol, sourceId);
    const from = atomIdMap.get(bond.from);
    const to = atomIdMap.get(bond.to);
    if (from === undefined || to === undefined) continue;
    const id = `b${nextId++}`;
    bondIdMap.set(sourceId, id);
    bondIds.push(id);
    bonds[id] = copyBond(bond, id, from, to);
  }

  return {
    // Groups are REMAPPED THROUGH `atomIdMap`, which restricts and renumbers in
    // one step: the map covers exactly the extracted atoms, so a group's
    // centres outside the selection have no image and are dropped, and a group
    // that loses all of them disappears. Carrying the source ids across is what
    // T3 warns about — a fragment whose group names `a7` when the fragment's
    // atoms are `a1`..`a3` is a clipboard entry that cannot be pasted and a
    // document that cannot be saved.
    //
    // The kind and stored index SURVIVE. Copying half a racemate still copies
    // the statement "these centres invert together"; it is `insertFragment`'s
    // job to renumber it against whatever the paste target already holds.
    molecule: assembleMolecule({
      atoms,
      bonds,
      atomIds,
      bondIds,
      nextId,
      stereoGroups: remappedStereoGroups(stereoGroupsOf(mol), atomIdMap),
    }),
    atomIdMap,
    bondIdMap,
  };
}

/**
 * Paste a standalone molecule into `target`.
 *
 * Every fragment id is remapped through the target's `nextId`, so a pasted
 * id can collide neither with one the target already holds nor with one it
 * will mint later. Atoms are allocated first, in `fragment.atomIds` order,
 * then bonds in `fragment.bondIds` order, all from the one shared counter —
 * deterministic, and the fragment's own insertion order survives at the end
 * of the target's arrays.
 *
 * The pasted atoms are NOT bonded to anything in the target: the result is
 * legitimately disconnected. Joining a paste to the existing structure is the
 * caller's job (`mergeAtoms` in ops.ts, or a template's own attachment rule),
 * because only the pointer layer knows which atom the user dropped it on.
 *
 * `options.offset` translates every pasted atom, for the paste-at-cursor
 * gesture. Omitting it — or passing `undefined`, which is how a caller holding
 * a maybe-position writes it under `exactOptionalPropertyTypes` — pastes in
 * place.
 */
export function insertFragment(
  target: Molecule,
  fragment: Molecule,
  options?: { readonly offset?: Vec2 | undefined },
): InsertedFragment {
  const atomIdMap = new Map<AtomId, AtomId>();
  const bondIdMap = new Map<BondId, BondId>();
  if (fragment.atomIds.length === 0) {
    // Referential identity matters here: an empty paste must not invalidate
    // memoised renders or look like an edit to undo.
    return {
      molecule: target,
      atomIdMap,
      bondIdMap,
      atomIds: [],
      bondIds: [],
    };
  }

  const offset = options?.offset;
  const atoms: Record<AtomId, Atom> = { ...target.atoms };
  const bonds: Record<BondId, Bond> = { ...target.bonds };
  const atomIds: AtomId[] = [...target.atomIds];
  const bondIds: BondId[] = [...target.bondIds];
  const newAtomIds: AtomId[] = [];
  const newBondIds: BondId[] = [];
  let nextId = target.nextId;

  for (const sourceId of fragment.atomIds) {
    const atom = requireAtom(fragment, sourceId);
    const id = `a${nextId++}`;
    atomIdMap.set(sourceId, id);
    atomIds.push(id);
    newAtomIds.push(id);
    atoms[id] = copyAtom(atom, id, offset ? addVec(atom.pos, offset) : atom.pos);
  }

  for (const sourceId of fragment.bondIds) {
    const bond = requireBond(fragment, sourceId);
    const from = atomIdMap.get(bond.from);
    const to = atomIdMap.get(bond.to);
    if (from === undefined || to === undefined) {
      // Not a user-recoverable state: the fragment's own bond points at an
      // atom the fragment does not contain, so it was never standalone.
      throw new Error(
        `Corrupt fragment: bond ${bond.id} references atom ` +
          `${from === undefined ? bond.from : bond.to}, which is not in the fragment`,
      );
    }
    const id = `b${nextId++}`;
    bondIdMap.set(sourceId, id);
    bondIds.push(id);
    newBondIds.push(id);
    bonds[id] = copyBond(bond, id, from, to);
  }

  return {
    // The fragment's groups are grafted onto the target's: remapped through the
    // fresh ids, AND/OR indices pushed past the target's so the two numberings
    // stay separate statements, the single `abs` collection unioned. See
    // `graftStereoGroups` for why renumbering rather than merging is the right
    // reading of a paste.
    molecule: assembleMolecule({
      atoms,
      bonds,
      atomIds,
      bondIds,
      nextId,
      stereoGroups: graftStereoGroups(
        stereoGroupsOf(target),
        stereoGroupsOf(fragment),
        atomIdMap,
      ),
    }),
    atomIdMap,
    bondIdMap,
    atomIds: newAtomIds,
    bondIds: newBondIds,
  };
}

/**
 * Copy the given atoms and paste the copy back into the same molecule — the
 * ctrl-D gesture.
 *
 * There is no default offset: a duplicate lands exactly on top of the
 * original unless the caller says otherwise. Picking a "nice" nudge is a UI
 * decision (it depends on zoom, on bond length, on whether the user is
 * dragging), so the UI owns it rather than a magic constant buried here.
 *
 * The returned id maps are keyed by ids of the SOURCE molecule, not of the
 * intermediate fragment, so a caller can move the selection onto the copies.
 */
export function duplicateFragment(
  mol: Molecule,
  ids: readonly AtomId[],
  options?: { readonly offset?: Vec2 | undefined },
): InsertedFragment {
  const extracted = extractFragment(mol, ids);
  const inserted = insertFragment(mol, extracted.molecule, options);

  const atomIdMap = new Map<AtomId, AtomId>();
  for (const [sourceId, fragmentId] of extracted.atomIdMap) {
    const pasted = inserted.atomIdMap.get(fragmentId);
    if (pasted !== undefined) atomIdMap.set(sourceId, pasted);
  }
  const bondIdMap = new Map<BondId, BondId>();
  for (const [sourceId, fragmentId] of extracted.bondIdMap) {
    const pasted = inserted.bondIdMap.get(fragmentId);
    if (pasted !== undefined) bondIdMap.set(sourceId, pasted);
  }

  return {
    molecule: inserted.molecule,
    atomIdMap,
    bondIdMap,
    atomIds: inserted.atomIds,
    bondIds: inserted.bondIds,
  };
}
