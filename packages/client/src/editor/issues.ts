/**
 * The issues the editor shows, and the two things a user does with one:
 * go to it, and fix it.
 *
 * TWO SOURCES, ONE LIST. chem-core's issues are derived from the molecule and
 * cached in `./derived`. A toolkit refusal — RDKit declining a "Clean up" over
 * an atom — cannot be derived and is held in `ui.refusal` until the molecule
 * changes. Both carry the same located shape, so the overlay, the status-bar
 * count and the issue list render them the same way and none of them has to
 * know which kind it is holding.
 *
 * No chemistry here. Which fixes exist and what they do is chem-core's
 * `issueFixes` / `applyIssueFix`; this module only routes a click into the
 * store as one undoable edit.
 */

import { getAtom, issueFixes } from "@starter/chem-core";
import type { AtomId, BondId, ChemistryIssue, IssueFix, Molecule } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";

import { buildCanvasScene } from "@/canvas/scene-bridge";
import { guardedOps } from "@/state/chem-guard";
import type { EditorStore, ToolkitRefusal } from "@/state";

import { moleculeIssues } from "./derived";

/** A toolkit's refusal of one atom, in the shape chem-core's issues have. */
export interface RefusalIssue {
  readonly kind: "toolkit-refusal";
  readonly severity: "error";
  readonly atomId: AtomId;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  readonly message: string;
  readonly label: string;
}

export type EditorIssue = ChemistryIssue | RefusalIssue;

/**
 * One issue per atom the refusal names and the molecule still has.
 *
 * Per atom rather than one for the lot, so each gets its own halo and its
 * own row to click. The toolkit's sentence is kept verbatim in the message —
 * it may be the only statement of what is wrong, when chem-core's valence
 * table accepts what RDKit's does not.
 */
export function refusalIssues(
  mol: Molecule,
  refusal: ToolkitRefusal | null,
): readonly RefusalIssue[] {
  if (refusal === null) return [];
  const issues: RefusalIssue[] = [];
  for (const atomId of refusal.atomIds) {
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;
    issues.push({
      kind: "toolkit-refusal",
      severity: "error",
      atomId,
      atomIds: [atomId],
      bondIds: [],
      message: `${refusal.source} stopped at this ${atom.element}: ${refusal.message}`,
      label: `${refusal.source} stopped here`,
    });
  }
  return issues;
}

/** chem-core's issues first, then the refusal's. */
export function editorIssues(
  mol: Molecule,
  refusal: ToolkitRefusal | null,
): readonly EditorIssue[] {
  const own = moleculeIssues(mol);
  if (refusal === null) return own;
  return [...own, ...refusalIssues(mol, refusal)];
}

/** The one-click fixes for an issue; a refusal has none of its own. */
export function fixesFor(mol: Molecule, issue: EditorIssue): readonly IssueFix[] {
  if (issue.kind === "toolkit-refusal") return [];
  return issueFixes(mol, issue);
}

/**
 * "C · atom 3" — which atom a list row is about.
 *
 * The element because a skeletal carbon is an unlabelled corner, and the
 * document position because it is the one thing that tells two identical
 * atoms apart; it is the same ordinal the canvas announces to a screen reader.
 */
export function issueAtomName(mol: Molecule, atomId: AtomId): string {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return atomId;
  return `${atom.element} · atom ${String(mol.atomIds.indexOf(atomId) + 1)}`;
}

/**
 * Select the atom an issue is anchored on and bring it to the middle of the
 * view. Does nothing for an atom the molecule no longer has.
 *
 * The centre comes from the CANVAS SCENE's style, the same one the overlay
 * draws the halo with, so the atom lands where the halo is rather than where
 * a different preset would have put it.
 */
export function locateIssue(store: EditorStore, issue: EditorIssue): void {
  const state = store.getState();
  const atom = getAtom(state.document.molecule, issue.atomId);
  if (atom === undefined) return;
  const style = buildCanvasScene(state.document, state.ui.activePanelId).style;
  // Selected, not keyboard-focused: the dashed focus ring on top of the
  // selection halo and the issue ring is one ring too many to read.
  state.selectAtoms([issue.atomId]);
  state.centreOn(modelToPx(style, atom.pos));
}

/**
 * Apply a fix as ONE undoable edit named after it, and keep the atom it was
 * about selected so the result is visible where the problem was.
 */
export function applyFix(store: EditorStore, issue: EditorIssue, fix: IssueFix): void {
  const state = store.getState();
  const before = state.document.molecule;
  // Re-derived against the molecule as it is NOW. The list was rendered
  // against a molecule that may since have changed under it, and applying a
  // fix computed for another molecule would edit atoms by stale id.
  // Matched on kind and title, which together name one fix of one issue.
  const current = fixesFor(before, issue).find(
    (candidate) => candidate.kind === fix.kind && candidate.title === fix.title,
  );
  if (current === undefined) {
    state.setStatusMessage("That fix no longer applies — the structure has changed");
    return;
  }
  const name = issueAtomName(before, issue.atomId);
  state.applyMoleculeEdit(current.title, (mol) => guardedOps.applyIssueFix(mol, current));
  const after = store.getState();
  if (getAtom(after.document.molecule, issue.atomId) !== undefined) {
    after.selectAtoms([issue.atomId]);
  }
  after.setStatusMessage(`${current.title} (${name}). Undo puts it back.`);
}
