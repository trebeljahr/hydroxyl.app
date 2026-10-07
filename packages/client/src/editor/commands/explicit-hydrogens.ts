/**
 * "Add explicit H" and "Remove explicit H" on the selection (decision 242).
 *
 * Kept out of `registry.ts` for the reason `stereo-groups.ts` is: the registry
 * stays a table of entries and the behaviour lives beside its own test.
 *
 * WHAT IS DECIDED WHERE. Which hydrogens may be drawn or folded, where a drawn
 * one goes, and whether a configuration survives are chem-core's answers
 * (`addExplicitHydrogens`, `removeExplicitHydrogens`). This file passes the
 * selection in, writes the result through the store so it is one undo step,
 * and says in a sentence what happened — including what it left alone and
 * why, because both commands refuse rather than change the chemistry.
 *
 * THE STORED DEFAULT STAYS IMPLICIT. Nothing here turns hydrogens on for a
 * whole document or for new atoms; the commands draw or fold the hydrogens of
 * the atoms the author selected, once. "Show hydrogens" is the display flag
 * that labels every implicit count without touching the model.
 *
 * AN ANNOTATED HYDROGEN STAYS DRAWN. A curly arrow to the proton a base takes,
 * or a δ+ on it, names the hydrogen's atom id; `applyMoleculeEdit` prunes an
 * annotation whose anchor went, so folding that hydrogen would delete the
 * arrow too. The document's annotations are the editor's to know about, not
 * chem-core's, so this file collects the atoms they name and passes them in as
 * `keep`.
 */

import {
  addExplicitHydrogens,
  hasHydrogensToDraw,
  hasHydrogensToFold,
  removeExplicitHydrogens,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { schemeAnnotationAnchors } from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import type { EditorState, EditorStore } from "@/state";

export const ADD_EXPLICIT_H_TITLE = "Add explicit hydrogens";
export const REMOVE_EXPLICIT_H_TITLE = "Remove explicit hydrogens";

/** History labels: shorter, since the undo menu prints them after "Undo". */
export const ADD_EXPLICIT_H_LABEL = "Add explicit H";
export const REMOVE_EXPLICIT_H_LABEL = "Remove explicit H";

export const ADD_EXPLICIT_H_KEYWORDS: readonly string[] = [
  "hydrogen",
  "explicit",
  "add",
  "draw",
  "show",
  "h",
  "protonate",
  "expand",
];
export const REMOVE_EXPLICIT_H_KEYWORDS: readonly string[] = [
  "hydrogen",
  "explicit",
  "remove",
  "strip",
  "hide",
  "implicit",
  "h",
  "collapse",
  "fold",
];

export const NO_IMPLICIT_H_REASON =
  "No selected atom has an implicit hydrogen to draw. Hydrogens, labelled " +
  "abbreviations and atoms with a full valence have none.";
export const NO_EXPLICIT_H_REASON =
  "No drawn hydrogen is selected or bonded to a selected atom. Deuterium, " +
  "charged hydrogens and H2 stay drawn, since folding them would change the formula.";

/** Atoms the document's annotations name, a bond anchor's two ends included. */
function annotatedAtoms(document: SketchDocument): ReadonlySet<AtomId> {
  const out = new Set<AtomId>();
  const mol = document.molecule;
  for (const annotation of document.annotations) {
    for (const anchor of schemeAnnotationAnchors(annotation)) {
      if (anchor.kind === "atom") {
        out.add(anchor.atomId);
      } else if (anchor.kind === "bond" && Object.hasOwn(mol.bonds, anchor.bondId)) {
        const bond = mol.bonds[anchor.bondId]!;
        out.add(bond.from);
        out.add(bond.to);
      }
    }
  }
  return out;
}

function planAdd(state: EditorState) {
  return addExplicitHydrogens(state.document.molecule, state.selection.atomIds);
}

function planRemove(state: EditorState) {
  return removeExplicitHydrogens(state.document.molecule, state.selection.atomIds, {
    keep: annotatedAtoms(state.document),
  });
}

/*
 * The enabled checks ask chem-core's own predicates rather than running the
 * edit: the palette and the context menu evaluate them on every open, and a
 * fold re-perceives stereo on a molecule nothing has memoised yet. They share
 * the edits' filters, so they cannot disagree about what is there; a row that
 * is enabled and then refuses everything says why in the status line.
 */

export function canAddExplicitHydrogens(state: EditorState): boolean {
  return hasHydrogensToDraw(state.document.molecule, state.selection.atomIds);
}

export function canRemoveExplicitHydrogens(state: EditorState): boolean {
  return hasHydrogensToFold(state.document.molecule, state.selection.atomIds);
}

function hydrogens(n: number): string {
  return `${String(n)} hydrogen${n === 1 ? "" : "s"}`;
}

function atoms(ids: readonly AtomId[]): string {
  return `${ids.length === 1 ? "atom" : "atoms"} ${ids.join(", ")}`;
}

/** Every clause that applies, so nothing the command declined goes unsaid. */
function message(done: string | undefined, notes: readonly string[]): string {
  return [done, ...notes].filter((part) => part !== undefined).join(". ");
}

export function addExplicitHydrogensToSelection(store: EditorStore): void {
  const state = store.getState();
  if (state.selection.atomIds.length === 0) {
    state.setStatusMessage(NO_IMPLICIT_H_REASON);
    return;
  }
  const plan = planAdd(state);
  const notes =
    plan.refused.length > 0
      ? [
          `Left ${atoms(plan.refused)} alone: no position for the hydrogen keeps ` +
            `the configuration drawn there`,
        ]
      : [];
  if (plan.hydrogenIds.length === 0) {
    state.setStatusMessage(message(undefined, notes.length > 0 ? notes : [NO_IMPLICIT_H_REASON]));
    return;
  }
  commit(store, ADD_EXPLICIT_H_LABEL, plan.molecule);
  // The new hydrogens join the selection, so "Remove explicit H" straight
  // after puts the drawing back without reselecting anything.
  store.getState().addToSelection({ atomIds: plan.hydrogenIds });
  store.getState().setStatusMessage(message(`Drew ${hydrogens(plan.hydrogenIds.length)}`, notes));
}

export function removeExplicitHydrogensFromSelection(store: EditorStore): void {
  const state = store.getState();
  if (state.selection.atomIds.length === 0) {
    state.setStatusMessage(NO_EXPLICIT_H_REASON);
    return;
  }
  const plan = planRemove(state);
  const notes: string[] = [];
  if (plan.refused.length > 0) {
    notes.push(
      `Kept the hydrogens on ${atoms(plan.refused)}: folding them would lose the ` +
        `configuration drawn there`,
    );
  }
  if (plan.kept.length > 0) {
    notes.push(`Kept ${hydrogens(plan.kept.length)} that an arrow or annotation points at`);
  }
  if (plan.hydrogenIds.length === 0) {
    state.setStatusMessage(message(undefined, notes.length > 0 ? notes : [NO_EXPLICIT_H_REASON]));
    return;
  }
  commit(store, REMOVE_EXPLICIT_H_LABEL, plan.molecule);
  store
    .getState()
    .setStatusMessage(
      message(`Folded ${hydrogens(plan.hydrogenIds.length)} into the implicit count`, notes),
    );
}

/** Built outside the recipe and returned from it, as `markStereoGroup` does. */
function commit(store: EditorStore, label: string, molecule: Molecule): void {
  store.getState().applyMoleculeEdit(label, () => molecule);
}
