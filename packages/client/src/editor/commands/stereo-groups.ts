/**
 * Decision 89's four selection commands: mark the selected stereocentres
 * racemic (AND), relative (OR) or absolute (ABS), and clear their group.
 *
 * Kept out of `registry.ts` for the reason `cleanup.ts`, `figure.ts` and
 * `file.ts` are kept out of it — the registry stays a table of entries and the
 * behaviour lives beside its own test. Nothing here touches the DOM, storage or
 * RDKit, so this module (unlike those three) is importable by a plain-node test
 * as well.
 *
 * WHAT A COMMAND DECIDES AND WHAT IT DOES NOT. Which atoms are stereocentres,
 * what a group's number is, whether the figure ends up reading `rac-`: all
 * three are chem-core's answers (`stereocenterAtoms`, `nextStereoGroupIndex`,
 * `stereoGroupCoverage`). This file intersects a set, writes the statement
 * through the store so it is one undo step, and says in a sentence what it did.
 * Deciding any of those three here would be a second definition of a chemistry
 * question — the mistake the per-centre tag and the `rac-` prefix both avoid by
 * asking chem-core rather than formatting for themselves.
 *
 * A GROUP IS A STATEMENT ABOUT CENTRES, so the commands act on the
 * STEREOCENTRES among the selection and ignore the rest of it. Selecting the
 * whole molecule and marking it racemic is therefore the ordinary gesture: it
 * means every centre, not every atom. `stereocenterAtoms` is the set,
 * deliberately the same one decision 40's coverage query uses — it includes a
 * centre whose descriptor is undetermined, so a racemate drawn with no wedges
 * at all can still be marked. (Decision 95's limit rides on that: such a mark is
 * stored and written correctly, and an RDKit-based reader will drop it.)
 *
 * CLEARING IS ALLOWED WHERE MARKING IS NOT. An imported file may put a
 * collection on atoms this build does not perceive as stereogenic (chem-core
 * reports that as `unresolved`), and an edit can flatten a centre that was
 * grouped. If clearing were gated on perception alone, such a group would be
 * unremovable from the editor — the same trap decision 56 fixed for a display
 * flag no control could switch off. So "Clear" is enabled when the selection
 * holds a stereocentre OR an atom that is in a group.
 *
 * DECISION 96 SETTLES THAT WIDTH AND PAYS FOR IT IN THE STATUS LINE. Clear stays
 * wide, and the message names how many collections went and on which atoms,
 * because a rubber band over a whole structure removes collections the author
 * was not thinking about. One undo puts them back; a confirmation dialog was
 * rejected, because this editor does not put a modal in front of an undoable
 * edit.
 *
 * A WEDGELESS GROUP IS A DIFFERENT MATTER, and not this file's (decision 95): a
 * centre may be marked with no wedge on it, the mark is stored and written
 * correctly, and it is an RDKit-based reader downstream that drops it. The export
 * dialog says so, from `wedgelessStereoGroupNotice`.
 */

import {
  nextStereoGroupIndex,
  prunedStereoGroups,
  stereoGroupAt,
  stereoGroupCoverage,
  stereoGroupTag,
  stereoGroupsOf,
  stereocenterAtoms,
} from "@starter/chem-core";
import type { AtomId, Molecule, StereoGroup, StereoGroupKind } from "@starter/chem-core";

import { guardedOps } from "@/state/chem-guard";
import type { EditorState, EditorStore } from "@/state";

/**
 * Titles, palette keywords and the verb each command reports with.
 *
 * A total `Record` over `StereoGroupKind`, so a fourth kind is a compile error
 * here rather than a kind with no way to create it. The keywords carry the
 * words a chemist searches for rather than the ones MDL uses: "racemic" and
 * "rac" find the AND command, "relative" and "rel" the OR one, and "enhanced
 * stereo" — the name of the whole feature in every other program — finds all
 * four.
 */
export const STEREO_GROUP_COMMANDS: Record<
  StereoGroupKind,
  { readonly title: string; readonly keywords: readonly string[]; readonly label: string }
> = {
  and: {
    title: "Mark selection as racemic",
    keywords: ["stereo", "group", "racemic", "racemate", "rac", "and", "enhanced", "epimer"],
    label: "Mark racemic",
  },
  or: {
    title: "Mark selection as relative",
    keywords: ["stereo", "group", "relative", "rel", "or", "enhanced", "unknown", "either"],
    label: "Mark relative",
  },
  abs: {
    title: "Mark selection as absolute",
    keywords: ["stereo", "group", "absolute", "abs", "known", "single", "enantiomer", "enhanced"],
    label: "Mark absolute",
  },
};

export const CLEAR_STEREO_GROUP_TITLE = "Clear stereo group";
export const CLEAR_STEREO_GROUP_KEYWORDS: readonly string[] = [
  "stereo",
  "group",
  "clear",
  "remove",
  "unset",
  "racemic",
  "absolute",
  "enhanced",
];

/**
 * Why marking is off: no stereocentre is selected.
 *
 * Decision 37's rule — a command that is disabled for a reason the canvas does
 * not show says the reason — and the reason here is genuinely invisible, since
 * "this atom is a stereocentre" is a perception rather than something drawn.
 */
export const NO_STEREOCENTER_REASON =
  "Nothing selected is a stereocentre. A stereo group says how the configuration " +
  "at a centre is known, so there has to be a centre to say it about.";

export const NOTHING_TO_CLEAR_REASON =
  "None of the selected atoms is a stereocentre or in a stereo group.";

/**
 * What "Clear" reports when it ran and found nothing to remove.
 *
 * NOT `NOTHING_TO_CLEAR_REASON`, which is the DISABLED reason and says the
 * selection holds neither a centre nor a group. The command is enabled on
 * either, so the ordinary way to reach this line is a selected stereocentre
 * that was never grouped — and telling that user "none of the selected atoms
 * is a stereocentre" would be a sentence the canvas visibly contradicts.
 */
export const NOTHING_WAS_GROUPED_MESSAGE =
  "No selected atom was in a stereo group, so there was nothing to clear.";

/** The stereocentres among the selection, as chem-core perceives them. */
export function selectedStereocenters(state: EditorState): readonly AtomId[] {
  const mol = state.document.molecule;
  const ids = state.selection.atomIds;
  if (ids.length === 0) return [];
  const centres = new Set<AtomId>(stereocenterAtoms(mol));
  return ids.filter((id) => centres.has(id));
}

/** Selected atoms that a group already names, stereocentre or not. */
function selectedGrouped(state: EditorState): readonly AtomId[] {
  const mol = state.document.molecule;
  if (stereoGroupsOf(mol).length === 0) return [];
  return state.selection.atomIds.filter((id) => stereoGroupAt(mol, id) !== undefined);
}

/**
 * What "Clear" reports, decision 96: how many COLLECTIONS it touched, which
 * ones, and which atoms.
 *
 * The count is of collections and not of atoms because that is what the command
 * costs: staying wide is necessary (an imported collection on atoms this build
 * does not perceive as stereogenic has to stay removable — the decision 56
 * trap), and the price is that a rubber band over a whole structure clears
 * collections the author was not thinking about. Naming them is what makes that
 * visible; one undo puts them back, which is why a confirmation dialog was
 * rejected.
 *
 * The tags are the spelling the figure prints (`and1`, `or1`, `abs`) and the
 * atoms are in selection order, so the sentence can be matched against the
 * drawing without translating. Named atoms rather than a count alone: "2
 * collections" says nothing about WHICH part of a large selection lost them.
 */
function clearedMessage(mol: Molecule, cleared: readonly AtomId[]): string {
  const tags: string[] = [];
  for (const atomId of cleared) {
    const group = stereoGroupAt(mol, atomId);
    if (group === undefined) continue;
    const tag = stereoGroupTag(group);
    if (!tags.includes(tag)) tags.push(tag);
  }
  const groupNoun = tags.length === 1 ? "stereo group" : "stereo groups";
  const atomNoun = cleared.length === 1 ? "atom" : "atoms";
  return (
    `Cleared ${tags.length} ${groupNoun} (${tags.join(", ")}) ` +
    `from ${cleared.length} ${atomNoun}: ${cleared.join(", ")}`
  );
}

export function canMarkStereoGroup(state: EditorState): boolean {
  return selectedStereocenters(state).length > 0;
}

export function canClearStereoGroup(state: EditorState): boolean {
  return canMarkStereoGroup(state) || selectedGrouped(state).length > 0;
}

/** Value equality over two canonical group lists. Both come out of
 *  `withStereoGroups`, which sorts and deduplicates, so a field-by-field
 *  comparison is exact — and it is what lets an edit that changes nothing
 *  return the molecule it was given, so no undo step is recorded for it. */
function sameGroups(a: readonly StereoGroup[], b: readonly StereoGroup[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((group, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      group.kind === other.kind &&
      group.index === other.index &&
      group.atomIds.length === other.atomIds.length &&
      group.atomIds.every((id, j) => id === other.atomIds[j])
    );
  });
}

/** `mol`, or the original when the statement is already exactly this one. */
function withGroups(mol: Molecule, groups: readonly StereoGroup[]): Molecule {
  const next = guardedOps.withStereoGroups(mol, groups);
  return sameGroups(stereoGroupsOf(next), stereoGroupsOf(mol)) ? mol : next;
}

/**
 * Put `centres` in a group of `kind`, taking them out of whatever group they
 * were in.
 *
 * REUSING AN EXISTING GROUP'S NUMBER when it already holds exactly these
 * centres is what keeps the command idempotent. `nextStereoGroupIndex` is
 * max-plus-one, so marking the same selection racemic twice would otherwise
 * make `&1` into `&2` — a different statement in the written file, and an undo
 * step showing no visible change.
 *
 * The index is taken from the molecule BEFORE the old memberships are pruned:
 * pruning can empty a group, and max-plus-one over the smaller list would hand
 * the new group a number the file had just used for something else.
 */
function markedGroups(
  mol: Molecule,
  kind: StereoGroupKind,
  centres: readonly AtomId[],
): readonly StereoGroup[] {
  const moving = new Set<AtomId>(centres);
  const existing = stereoGroupsOf(mol).find(
    (group) =>
      group.kind === kind &&
      group.atomIds.length === moving.size &&
      group.atomIds.every((id) => moving.has(id)),
  );
  const index = existing?.index ?? nextStereoGroupIndex(mol, kind);
  const kept = prunedStereoGroups(stereoGroupsOf(mol), (id) => !moving.has(id));
  return [...kept, { kind, index, atomIds: [...centres] }];
}

/**
 * The sentence the status bar shows. It names the tag the figure will print
 * (`and1`, `or1`, `abs`) so the two cannot be read as different things, and
 * adds chem-core's own prefix when the whole molecule now reads `rac-` or
 * `rel-` — decision 88's label is the visible consequence of the edit, so the
 * line that reports the edit is where it belongs.
 */
function markMessage(
  mol: Molecule,
  kind: StereoGroupKind,
  centres: readonly AtomId[],
): string {
  const group = stereoGroupAt(mol, centres[0] as AtomId);
  const tag = group === undefined ? kind : stereoGroupTag(group);
  const noun = centres.length === 1 ? "stereocentre" : "stereocentres";
  const coverage = stereoGroupCoverage(mol);
  const suffix =
    coverage.kind === "whole" ? `; the figure now reads ${coverage.prefix}` : "";
  return `${centres.length} ${noun} in stereo group ${tag}${suffix}`;
}

export function markStereoGroup(store: EditorStore, kind: StereoGroupKind): void {
  const state = store.getState();
  const centres = selectedStereocenters(state);
  if (centres.length === 0) {
    state.setStatusMessage(NO_STEREOCENTER_REASON);
    return;
  }
  const mol = state.document.molecule;
  const next = withGroups(mol, markedGroups(mol, kind, centres));
  if (next === mol) {
    state.setStatusMessage(markMessage(mol, kind, centres));
    return;
  }
  // Built outside the closure and returned from it, the way `edit.paste` does:
  // the message has to read the molecule the edit produced, and running the
  // construction inside the recipe would mean building it twice.
  state.applyMoleculeEdit(STEREO_GROUP_COMMANDS[kind].label, () => next);
  state.setStatusMessage(markMessage(next, kind, centres));
}

export function clearStereoGroup(store: EditorStore): void {
  const state = store.getState();
  const mol = state.document.molecule;
  // Every selected atom, not only the perceived centres: see the header.
  const dropping = new Set<AtomId>(state.selection.atomIds);
  if (dropping.size === 0) {
    state.setStatusMessage(NOTHING_TO_CLEAR_REASON);
    return;
  }
  const cleared = selectedGrouped(state);
  const next = withGroups(
    mol,
    prunedStereoGroups(stereoGroupsOf(mol), (id) => !dropping.has(id)),
  );
  if (next === mol) {
    state.setStatusMessage(NOTHING_WAS_GROUPED_MESSAGE);
    return;
  }
  // Built from the molecule BEFORE the edit: the tags exist only there, since the
  // whole point of the edit is that they are gone afterwards.
  const message = clearedMessage(mol, cleared);
  state.applyMoleculeEdit(CLEAR_STEREO_GROUP_TITLE, () => next);
  state.setStatusMessage(message);
}
