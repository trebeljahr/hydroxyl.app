/**
 * Decision 225's two commands: contract real atoms to an abbreviation, and
 * expand one back. Each is ONE molecule edit, so one undo step.
 *
 * Kept out of `registry.ts` for `stereo-groups.ts`'s reason: the registry
 * stays a table and the behaviour lives beside its test. Every chemistry
 * question — what may be contracted, which label it gets, where the label
 * sits — is chem-core's (`canCollapseAbbreviation`,
 * `suggestAbbreviationLabel`, `abbreviationCandidateAt`). This file picks the
 * atoms from the selection, asks for a label only when chem-core has none,
 * and reports what it did.
 *
 * WHICH ATOMS. Several selected atoms are taken as they are: that is the
 * "select it and contract it" gesture, and it must be exactly one bond out.
 * A single selected atom — what a right-click on an atom leaves — means the
 * stamped group around it, found by `abbreviationCandidateAt`, so a
 * right-click anywhere on a Boc offers "Collapse to Boc".
 */

import {
  abbreviationAt,
  abbreviationCandidateAt,
  abbreviationsOf,
  canCollapseAbbreviation,
  collapseAbbreviation,
  expandAbbreviation,
  suggestAbbreviationLabel,
} from "@starter/chem-core";
import type { Abbreviation, AtomId, Molecule } from "@starter/chem-core";

import type { EditorState, EditorStore } from "@/state";

export const COLLAPSE_ABBREVIATION_TITLE = "Collapse to abbreviation";
export const EXPAND_ABBREVIATION_TITLE = "Expand abbreviation";

export const COLLAPSE_ABBREVIATION_KEYWORDS: readonly string[] = [
  "abbreviation",
  "contract",
  "superatom",
  "label",
  "Boc",
  "OTBS",
  "Ph",
  "group",
];
export const EXPAND_ABBREVIATION_KEYWORDS: readonly string[] = [
  "abbreviation",
  "expand",
  "superatom",
  "label",
  "group",
];

export const NOTHING_TO_EXPAND_REASON = "None of the selected atoms is in an abbreviation.";

/** What a collapse would do: which atoms, and the label if chem-core has one. */
export interface CollapsePlan {
  readonly atomIds: readonly AtomId[];
  readonly label: string | undefined;
}

/** The atoms and label a collapse of the current selection would use, or the
 *  reason it cannot. */
export function collapsePlan(state: EditorState): CollapsePlan | { readonly reason: string } {
  const mol = state.document.molecule;
  const selected = state.selection.atomIds;
  if (selected.length === 0) return { reason: "Select the atoms to contract first." };
  if (selected.length === 1) {
    const candidate = abbreviationCandidateAt(mol, selected[0]!);
    if (candidate === undefined) {
      return {
        reason:
          "No known group is attached here. Select the substituent's atoms to contract them under a label of your own.",
      };
    }
    if (isOnlyGroup(mol, candidate.atomIds)) return { reason: "This is already contracted." };
    return { atomIds: candidate.atomIds, label: candidate.label };
  }
  const check = canCollapseAbbreviation(mol, selected);
  if (!check.ok) return { reason: check.reason };
  if (isOnlyGroup(mol, selected)) return { reason: "This is already contracted." };
  return { atomIds: selected, label: suggestAbbreviationLabel(mol, selected) };
}

/** True when `atomIds` is exactly one stored abbreviation's atoms. */
function isOnlyGroup(mol: Molecule, atomIds: readonly AtomId[]): boolean {
  const group = abbreviationAt(mol, atomIds[0]!);
  return (
    group !== undefined &&
    group.atomIds.length === new Set(atomIds).size &&
    atomIds.every((id) => group.atomIds.includes(id))
  );
}

export function canCollapse(state: EditorState): boolean {
  return "atomIds" in collapsePlan(state);
}

export function collapseDisabledReason(state: EditorState): string | undefined {
  const plan = collapsePlan(state);
  return "reason" in plan ? plan.reason : undefined;
}

/** "Collapse to Boc" when the label is known, the generic title otherwise. */
export function collapseMenuLabel(state: EditorState): string {
  const plan = collapsePlan(state);
  return "atomIds" in plan && plan.label !== undefined
    ? `Collapse to ${plan.label}`
    : `${COLLAPSE_ABBREVIATION_TITLE}…`;
}

/** The groups the selection touches, in stored order. */
function touchedGroups(state: EditorState): readonly Abbreviation[] {
  const selected = new Set(state.selection.atomIds);
  return abbreviationsOf(state.document.molecule).filter((abbr) =>
    abbr.atomIds.some((id) => selected.has(id)),
  );
}

export function canExpand(state: EditorState): boolean {
  return touchedGroups(state).length > 0;
}

/**
 * `askLabel` is injected so a test can answer it; the editor passes
 * `window.prompt`. Returning `null` or a blank string cancels with no edit.
 */
export function collapseSelection(
  store: EditorStore,
  askLabel: (atomCount: number) => string | null = defaultAskLabel,
): void {
  const state = store.getState();
  const plan = collapsePlan(state);
  if ("reason" in plan) {
    state.setStatusMessage(plan.reason);
    return;
  }
  const label = plan.label ?? askLabel(plan.atomIds.length)?.trim();
  if (label === undefined || label === "") return;
  const next = collapseAbbreviation(state.document.molecule, plan.atomIds, label);
  state.applyMoleculeEdit(`Collapse to ${label}`, () => next);
  // The selection follows the label, so a second right-click offers Expand.
  store.getState().selectAtoms(plan.atomIds);
  store.getState().setStatusMessage(`${plan.atomIds.length} atoms drawn as ${label}`);
}

export function expandSelection(store: EditorStore): void {
  const state = store.getState();
  const groups = touchedGroups(state);
  if (groups.length === 0) {
    state.setStatusMessage(NOTHING_TO_EXPAND_REASON);
    return;
  }
  let next = state.document.molecule;
  for (const group of groups) next = expandAbbreviation(next, group.atomIds[0]!);
  const labels = groups.map((group) => group.label).join(", ");
  state.applyMoleculeEdit(`Expand ${labels}`, () => next);
  store.getState().setStatusMessage(`Expanded ${labels}`);
}

function defaultAskLabel(atomCount: number): string | null {
  if (typeof window === "undefined" || typeof window.prompt !== "function") return null;
  return window.prompt(`Label for these ${atomCount} atoms (for example Boc, OTBS, Ph)`, "");
}
