/**
 * What the user currently has selected.
 *
 * IDS ONLY, never atom or bond objects. A selection outlives the structure it
 * was made against — it is snapshotted into every undo entry and compared
 * across edits — and captured objects would go stale the moment an atom moved
 * or changed element, leaving an undo step holding a picture of a molecule
 * that no longer exists. Ids are never reused (see the `nextId` note in
 * types.ts), so a stale id resolves to nothing rather than to the wrong atom.
 *
 * CANONICAL BY CONSTRUCTION. `selection()` dedupes and sorts, so two
 * selections built from the same ids in different orders are deep-equal.
 * That is what lets the undo stack compare selections structurally instead of
 * every call site having to sort first, and it is why every function here
 * returns a value built through `selection()` rather than a hand-assembled
 * object literal.
 *
 * A BOND IS IMPLICITLY SELECTED WHEN BOTH ENDPOINTS ARE. The marquee only
 * ever yields atoms (`atomsInRect` has no bond geometry to hit-test), yet
 * dragging a box round half a ring must move, delete and copy the bonds
 * inside it. `expandToBonds` applies that rule, and it is the only function
 * that adds bonds nobody asked for: every other entry point either preserves
 * the bond set or shrinks it.
 *
 * THE CONVERSE DOES NOT HOLD: a selected bond need not have its endpoints
 * selected. That is not a corrupt state, it is what clicking a single bond
 * gives you — the gesture `hit.ts` is built around, since "click a bond to
 * promote it to a double" acts on the bond alone. `growSelection` seeds from
 * such bonds by way of their endpoints for exactly that reason. So no
 * function here throws a bond away merely because an endpoint is unselected;
 * only `normalizeSelection` discards ids at all, and only ones the molecule
 * itself no longer has.
 */

import {
  getAtom,
  getBond,
  neighborIds,
  reachableFrom,
  requireBond,
} from "./molecule.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { bounds, type Vec2 } from "./vec.js";

export interface Selection {
  /** Canonical: deduped and sorted by `compareIds`. */
  readonly atomIds: readonly AtomId[];
  /** Canonical: deduped and sorted by `compareIds`. */
  readonly bondIds: readonly BondId[];
}

/** Shared so the common empty case allocates nothing. */
const NO_IDS: readonly never[] = Object.freeze([]);

/**
 * Splits an id into a non-digit prefix and a trailing integer: `a10` is
 * ("a", 10). Ids that do not have that shape — an importer may hand us
 * anything — parse as a whole-string prefix with no number.
 */
const NUMERIC_TAIL = /^(\D*)(\d+)$/;

/**
 * Order ids the way a human reads them: `a9` before `a10`.
 *
 * Plain lexicographic sorting would put "a10" before "a9", which is perfectly
 * consistent and therefore preserves the equality guarantee — but it makes
 * every debug dump and every hand-written test expectation read wrong, and a
 * reviewer checking a selection by eye should not have to think about ASCII.
 *
 * The comparator must be a TOTAL order, not merely sensible, or `Array.sort`
 * is free to leave two equal-as-sets inputs in different orders and the
 * "same ids compare equal" contract quietly breaks. So: prefix first, then
 * numberless ids ahead of numbered ones within the same prefix, then the
 * integer numerically, then the whole string to break remaining ties (`a01`
 * and `a1` share a prefix and a number but are different ids).
 */
function compareIds(a: string, b: string): number {
  const ma = NUMERIC_TAIL.exec(a);
  const mb = NUMERIC_TAIL.exec(b);
  const prefixA = ma ? ma[1]! : a;
  const prefixB = mb ? mb[1]! : b;
  if (prefixA !== prefixB) return prefixA < prefixB ? -1 : 1;
  if (ma && !mb) return 1;
  if (!ma && mb) return -1;
  if (ma && mb) {
    const numA = Number(ma[2]!);
    const numB = Number(mb[2]!);
    if (numA !== numB) return numA - numB;
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function canonicalIds<T extends string>(ids: readonly T[]): readonly T[] {
  if (ids.length === 0) return NO_IDS;
  const unique = [...new Set(ids)];
  unique.sort(compareIds);
  return Object.freeze(unique);
}

/**
 * The one constructor. Everything else in this module funnels through it, so
 * canonical form is an invariant of the type rather than a convention.
 */
export function selection(
  atomIds: readonly AtomId[] = NO_IDS,
  bondIds: readonly BondId[] = NO_IDS,
): Selection {
  return Object.freeze({
    atomIds: canonicalIds(atomIds),
    bondIds: canonicalIds(bondIds),
  });
}

export const EMPTY_SELECTION: Selection = selection();

export function isEmptySelection(s: Selection): boolean {
  return s.atomIds.length === 0 && s.bondIds.length === 0;
}

/** Atoms plus bonds — what the status bar means by "7 selected". */
export function selectionSize(s: Selection): number {
  return s.atomIds.length + s.bondIds.length;
}

export function isAtomSelected(s: Selection, id: AtomId): boolean {
  return s.atomIds.includes(id);
}

export function isBondSelected(s: Selection, id: BondId): boolean {
  return s.bondIds.includes(id);
}

/**
 * Set equality. Cheap precisely because both sides are canonical: a positional
 * walk is enough, no sets and no sorting at compare time.
 */
export function selectionsEqual(a: Selection, b: Selection): boolean {
  if (a === b) return true;
  if (a.atomIds.length !== b.atomIds.length) return false;
  if (a.bondIds.length !== b.bondIds.length) return false;
  for (let i = 0; i < a.atomIds.length; i++) {
    if (a.atomIds[i] !== b.atomIds[i]) return false;
  }
  for (let i = 0; i < a.bondIds.length; i++) {
    if (a.bondIds[i] !== b.bondIds[i]) return false;
  }
  return true;
}

/**
 * Add every bond whose BOTH endpoints are selected.
 *
 * The bare implicit-bond rule, with no geometry and no id validation: this is
 * what turns an atom-only marquee result into something delete, drag and copy
 * can act on. Additive — a bond already in `s` stays, even if its endpoints
 * are not both selected, because the user may have clicked that bond directly
 * and only `normalizeSelection` is entitled to throw ids away.
 */
export function expandToBonds(mol: Molecule, s: Selection): Selection {
  const selectedAtoms = new Set(s.atomIds);
  const bondIds: BondId[] = [...s.bondIds];
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    if (selectedAtoms.has(bond.from) && selectedAtoms.has(bond.to)) {
      bondIds.push(bondId);
    }
  }
  return selection(s.atomIds, bondIds);
}

/**
 * Canonical form against a molecule: drop the ids the molecule no longer has,
 * and nothing else.
 *
 * Run this after any edit that removed atoms. Deleting an atom takes its
 * incident bonds with it (see `removeAtoms` in ops.ts), so a selection held
 * across that edit points at both a missing atom and missing bonds; leaving
 * them in place would make `selectionSize` lie and the next operation throw
 * on a lookup.
 *
 * PURELY SUBTRACTIVE, DELIBERATELY. An earlier version finished with
 * `expandToBonds`, which quietly undid the user's own edits to the selection:
 * `subtractSelection` exists so shift-dragging over a bond removes exactly
 * that bond while keeping its atoms, and re-deriving implicit bonds here put
 * it straight back the next time any unrelated edit was normalised. Normalise
 * is garbage collection, not inference — it may only ever shrink a selection.
 * Callers that want the implicit-bond rule applied say so by calling
 * `expandToBonds`, which is the marquee path and is explicit about it.
 */
export function normalizeSelection(mol: Molecule, s: Selection): Selection {
  const liveAtoms = s.atomIds.filter((id) => getAtom(mol, id) !== undefined);
  const liveBonds = s.bondIds.filter((id) => getBond(mol, id) !== undefined);
  return selection(liveAtoms, liveBonds);
}

export function selectAll(mol: Molecule): Selection {
  return selection(mol.atomIds, mol.bondIds);
}

/**
 * The whole connected fragment containing `atomId` — what a double-click on an
 * atom selects.
 *
 * Traversal is `reachableFrom` in molecule.ts, not a second breadth-first
 * search written here: that one is iterative on purpose (a long polymer chain
 * blows the stack otherwise) and shares the memoised adjacency index.
 *
 * An id the molecule does not have yields the empty selection rather than
 * throwing. Selections routinely outlive the atoms they name, and a click
 * landing on an atom an undo just removed is a UI race, not a bug worth
 * crashing the editor over.
 */
export function selectFragment(mol: Molecule, atomId: AtomId): Selection {
  if (getAtom(mol, atomId) === undefined) return EMPTY_SELECTION;
  return expandToBonds(mol, selection(reachableFrom(mol, atomId)));
}

/**
 * Everything that is not currently selected.
 *
 * Inverts the ATOMS and re-derives the bonds, rather than inverting the bond
 * set literally. Inverting a fully selected benzene literally would hand back
 * all six ring bonds and none of their atoms — "everything that is not
 * selected" reported as the very structure the user had selected. Deriving
 * the bonds from the inverted atoms is the only reading of inversion that
 * answers that question sensibly.
 *
 * The bond-without-its-endpoints shape it thereby avoids is legal elsewhere
 * (see the header — it is a clicked bond); it just is not something an
 * inversion should invent.
 */
export function invertSelection(mol: Molecule, s: Selection): Selection {
  const selectedAtoms = new Set(s.atomIds);
  const inverted = mol.atomIds.filter((id) => !selectedAtoms.has(id));
  return expandToBonds(mol, selection(inverted));
}

/**
 * One bond shell outwards: every selected atom keeps its neighbours company.
 *
 * The endpoints of an explicitly selected bond count as selected atoms for
 * this purpose, so growing is monotone — a selection can never lose an atom
 * by being grown.
 */
export function growSelection(mol: Molecule, s: Selection): Selection {
  const seed = new Set(s.atomIds);
  for (const bondId of s.bondIds) {
    const bond = getBond(mol, bondId);
    if (!bond) continue;
    seed.add(bond.from);
    seed.add(bond.to);
  }
  const grown = new Set(seed);
  for (const atomId of seed) {
    for (const neighbor of neighborIds(mol, atomId)) grown.add(neighbor);
  }
  return expandToBonds(mol, selection([...grown]));
}

/**
 * Drop the boundary: any selected atom with a neighbour OUTSIDE the selection
 * goes, and the bonds are re-derived from what survives.
 *
 * The exact inverse shape of grow, and like grow it is defined on atoms only.
 * Note that a closed ring has no boundary — every atom of a fully selected
 * benzene has both its neighbours inside the selection — so shrinking one is
 * a no-op. Shrink erodes an edge; it does not count down to nothing.
 */
export function shrinkSelection(mol: Molecule, s: Selection): Selection {
  const selectedAtoms = new Set(s.atomIds);
  const interior = s.atomIds.filter(
    (id) =>
      // The existence check has to come first. `neighborIds` answers `[]` for
      // an id the molecule does not have, and `[].every(...)` is vacuously
      // true — so without this a stale id would be promoted to "interior" and
      // outlive the real boundary atoms that were correctly dropped around
      // it. A genuinely isolated atom also has no neighbours and does survive,
      // which is right: it has no boundary to erode.
      getAtom(mol, id) !== undefined &&
      neighborIds(mol, id).every((neighbor) => selectedAtoms.has(neighbor)),
  );
  return expandToBonds(mol, selection(interior));
}

export function unionSelections(a: Selection, b: Selection): Selection {
  return selection([...a.atomIds, ...b.atomIds], [...a.bondIds, ...b.bondIds]);
}

/**
 * Everything in `a` that is not in `b`. Bonds are subtracted literally rather
 * than re-derived: shift-dragging over a bond is how a user removes exactly
 * that bond from a selection while keeping its atoms, and that removal now
 * survives a later `normalizeSelection`.
 *
 * The mirror case is deliberate too: subtracting an ATOM leaves the bonds
 * that touched it selected, with an endpoint that no longer is. Per the
 * header that is a legal selection — the same shape a clicked bond has — and
 * both of the operations it feeds stay well defined: deleting removes those
 * bonds and keeps both atoms, dragging moves the selected atoms and lets the
 * bonds follow their endpoints. Re-deriving here instead would make shift-
 * dragging an atom out silently delete bonds from the selection that the
 * user never touched.
 */
export function subtractSelection(a: Selection, b: Selection): Selection {
  const dropAtoms = new Set(b.atomIds);
  const dropBonds = new Set(b.bondIds);
  return selection(
    a.atomIds.filter((id) => !dropAtoms.has(id)),
    a.bondIds.filter((id) => !dropBonds.has(id)),
  );
}

/** Shift-click on an atom. Bonds are left exactly as they were. */
export function toggleAtom(s: Selection, id: AtomId): Selection {
  const atomIds = isAtomSelected(s, id)
    ? s.atomIds.filter((existing) => existing !== id)
    : [...s.atomIds, id];
  return selection(atomIds, s.bondIds);
}

/** Shift-click on a bond. Atoms are left exactly as they were. */
export function toggleBond(s: Selection, id: BondId): Selection {
  const bondIds = isBondSelected(s, id)
    ? s.bondIds.filter((existing) => existing !== id)
    : [...s.bondIds, id];
  return selection(s.atomIds, bondIds);
}

/**
 * Bounding box of the selected ATOMS, in bond-length units — the frame the
 * transform handles are drawn on.
 *
 * Bonds contribute nothing of their own: a bond's extent is its endpoints',
 * so for every selection the transform handles are actually drawn on — one
 * built by marquee, fragment, grow or select-all — the atoms already give the
 * exact box. A bond-only selection (a single clicked bond) therefore boxes to
 * zero rather than to that bond; it has no handles to drag, and inventing a
 * box for it would put a transform frame around something the transform tools
 * do not operate on. Ids the molecule no longer has are
 * skipped, so a stale selection gives a smaller box rather than a throw, and
 * an empty selection falls through to the zero box `bounds([])` already
 * returns — deliberately not special-cased into something like a NaN box,
 * since callers already handle the degenerate zero-size case for a
 * single-atom selection.
 */
export function selectionBounds(
  mol: Molecule,
  s: Selection,
): { min: Vec2; max: Vec2; width: number; height: number } {
  const points: Vec2[] = [];
  for (const id of s.atomIds) {
    const atom = getAtom(mol, id);
    if (atom) points.push(atom.pos);
  }
  return bounds(points);
}
