/**
 * The selection slice.
 *
 * NOTHING HERE RECORDS AN UNDO ENTRY. Clicking around a structure is not an
 * edit, and a history full of "select atom / select nothing / select atom"
 * would bury the last real change under a dozen presses of Ctrl+Z. The
 * selection is still part of `UndoableState`, because an EDIT has to restore
 * the selection it started from — it is carried by the entries that document
 * edits push, never by an entry of its own.
 *
 * A NO-OP RETURNS THE CURRENT SELECTION BY REFERENCE. That is load-bearing,
 * not an optimisation: the history compares `UndoableState` field by field
 * with `===`, so a "select the same three atoms again" that minted a fresh
 * array would look like a state change and turn a no-op edit into an undo
 * step.
 */

import type { AtomId, BondId, Molecule } from "@starter/chem-core";
import { castDraft } from "immer";
import type {
  EditorSliceCreator,
  Selection,
  SelectionPatch,
  SelectionSlice,
} from "../types";

export const EMPTY_SELECTION: Selection = Object.freeze({
  atomIds: Object.freeze([]),
  bondIds: Object.freeze([]),
});

/** Order-preserving de-duplication. A rubber band that sweeps an atom twice,
 *  or a shift-click on something already selected, must not list it twice —
 *  `translateAtoms` would then move it twice as far. */
function unique<T>(ids: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sameIds<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** The single constructor: returns `current` unchanged when the result would
 *  be equal, so reference identity means "nothing happened". */
function nextSelection(
  current: Selection,
  atomIds: readonly AtomId[],
  bondIds: readonly BondId[],
): Selection {
  const atoms = unique(atomIds);
  const bonds = unique(bondIds);
  if (sameIds(current.atomIds, atoms) && sameIds(current.bondIds, bonds)) {
    return current;
  }
  return { atomIds: atoms, bondIds: bonds };
}

/**
 * Drops ids the molecule no longer contains.
 *
 * Called by the document slice after every molecule edit, INSIDE the same
 * history entry as the edit, so that undoing a deletion restores the atoms
 * and the selection together. A selection holding a deleted id is not merely
 * stale: `setAtomPositions` throws on an unknown id, so the next drag over
 * that selection would take the editor down.
 */
export function pruneSelection(
  selection: Selection,
  molecule: Molecule,
): Selection {
  // `Object.hasOwn`, not `in`: `molecule.atoms` is a plain object, so `in`
  // walks Object.prototype and an atom id of "constructor" or "toString"
  // would survive every prune that should have dropped it. Ids come from
  // documents (a dropped .mol, localStorage), which are untrusted input.
  const atomIds = selection.atomIds.filter((id) =>
    Object.hasOwn(molecule.atoms, id),
  );
  const bondIds = selection.bondIds.filter((id) =>
    Object.hasOwn(molecule.bonds, id),
  );
  if (
    atomIds.length === selection.atomIds.length &&
    bondIds.length === selection.bondIds.length
  ) {
    return selection;
  }
  return { atomIds, bondIds };
}

export function createSelectionSlice(): EditorSliceCreator<SelectionSlice> {
  return (set, get) => {
    const apply = (
      atomIds: readonly AtomId[],
      bondIds: readonly BondId[],
    ): void => {
      const current = get().selection;
      const next = nextSelection(current, atomIds, bondIds);
      if (next === current) return;
      // Computed outside the recipe and assigned wholesale, like every other
      // value in this store — see slices/document.ts for the full reason.
      set((draft) => {
        draft.selection = castDraft(next);
      });
    };

    return {
      selection: EMPTY_SELECTION,

      setSelection(selection) {
        apply(selection.atomIds, selection.bondIds);
      },

      selectAtoms(ids) {
        // Replaces rather than extends: this is the plain-click path, and a
        // click on an atom means "just this one".
        apply(ids, []);
      },

      selectBonds(ids) {
        apply([], ids);
      },

      addToSelection(patch: SelectionPatch) {
        const current = get().selection;
        apply(
          patch.atomIds ? [...current.atomIds, ...patch.atomIds] : current.atomIds,
          patch.bondIds ? [...current.bondIds, ...patch.bondIds] : current.bondIds,
        );
      },

      toggleAtom(id) {
        const current = get().selection;
        // Bonds are left alone: ctrl-clicking an atom in a mixed selection
        // must not silently drop the bonds the user also picked.
        apply(
          current.atomIds.includes(id)
            ? current.atomIds.filter((other) => other !== id)
            : [...current.atomIds, id],
          current.bondIds,
        );
      },

      toggleBond(id) {
        const current = get().selection;
        apply(
          current.atomIds,
          current.bondIds.includes(id)
            ? current.bondIds.filter((other) => other !== id)
            : [...current.bondIds, id],
        );
      },

      clearSelection() {
        apply([], []);
      },

      selectAll() {
        const molecule = get().document.molecule;
        // The id lists, not `Object.keys`: they carry insertion order, which
        // is what every consumer of a selection expects to see.
        apply(molecule.atomIds, molecule.bondIds);
      },

      isAtomSelected(id) {
        // Linear, and deliberately so: a selection is a handful of ids next to
        // a molecule of hundreds, and a Set would have to be rebuilt on every
        // selection change to answer the same question no faster.
        return get().selection.atomIds.includes(id);
      },

      isBondSelected(id) {
        return get().selection.bondIds.includes(id);
      },
    };
  };
}
