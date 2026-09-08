/**
 * Which views this molecule can actually be drawn in, and why not.
 *
 * A PANEL MUST NEVER SILENTLY EXPORT AN EMPTY CELL. A figure is several
 * representations of one molecule side by side, and the failures are not all
 * the same failure: a ring has no condensed spelling, a metal has no lone-pair
 * count, an "R" placeholder has no valence at all and makes every structural
 * view throw. Each of those is a sentence a caller can print in the cell. A
 * blank is not.
 *
 * Shaped on `StereoDescriptor`'s undetermined arm in chem-core — a discriminated
 * result carrying a named reason — because that is already this project's
 * answer to "I will not guess". It is the same call `exactMass()` makes.
 *
 * TOTAL AND NON-THROWING, which is most of the value. `composeAtomLabel`
 * reaches `implicitHydrogenCount`, which reaches `requireElement`, which
 * THROWS on a symbol the periodic table has not heard of — and the document
 * codec deliberately admits one, because a saved file has to survive a
 * placeholder. So a document with an "R" in it crashes every structural view
 * and both text views today, and this function is the thing that can be
 * called first and safely.
 */

import { atomsWithUncountableLonePairs, canCondense, isKnownElement } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import { VIEW_KINDS } from "./representation.js";
import type { ViewKind } from "./representation.js";

export type UnavailableReason =
  /** Nothing has been drawn yet. Every view is empty, not just this one. */
  | "empty-molecule"
  /**
   * An atom whose element symbol is not in chem-core's table — an "R", an "X",
   * a group abbreviation typed into the element field. Valence, hydrogens and
   * therefore every label are undefined for it.
   */
  | "unknown-element"
  /** Lewis only: an element with no default valences has no honest count. */
  | "no-lone-pair-data"
  /** Condensed only: there is no linear spelling of a ring. */
  | "cyclic";

export type ViewAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: UnavailableReason;
      /** One sentence, ready to print in the cell the view would have filled. */
      readonly message: string;
      /** The atoms responsible, where the reason has any. Empty otherwise. */
      readonly atomIds: readonly AtomId[];
    };

/**
 * Whether `kind` can be produced for `mol`.
 *
 * The checks run most-general first, so a molecule that fails for a reason
 * every view shares reports THAT rather than the view-specific one it would
 * also have failed for. A benzene with an "R" on it is not "cyclic, so no
 * condensed formula" — it is a structure with an atom nothing can be computed
 * for, and fixing the ring would not help.
 */
export function representationAvailability(
  mol: Molecule,
  kind: ViewKind,
): ViewAvailability {
  if (mol.atomIds.length === 0) {
    return {
      available: false,
      reason: "empty-molecule",
      message: "Nothing has been drawn yet.",
      atomIds: [],
    };
  }

  const unknown = atomsWithUnknownElements(mol);
  if (unknown.length > 0) {
    return {
      available: false,
      reason: "unknown-element",
      message: `${describe(mol, unknown, "is")} not in the periodic table, so hydrogens and lone pairs cannot be derived.`,
      atomIds: unknown,
    };
  }

  if (kind === "lewis") {
    const uncountable = atomsWithUncountableLonePairs(mol);
    if (uncountable.length > 0) {
      return {
        available: false,
        reason: "no-lone-pair-data",
        message: `${describe(mol, uncountable, "has")} no default valences, so their lone pairs cannot be counted.`,
        atomIds: uncountable,
      };
    }
  }

  if (kind === "condensed" && !canCondense(mol)) {
    return {
      available: false,
      reason: "cyclic",
      message: "A ring has no condensed formula; use the sum formula instead.",
      atomIds: [],
    };
  }

  return AVAILABLE;
}

/** Every view, with its verdict — what a panel picker and the contact sheet
 *  both want, and cheaper than calling the above six times from a loop that
 *  has to know the list. */
export function availabilityByKind(
  mol: Molecule,
): ReadonlyMap<ViewKind, ViewAvailability> {
  const out = new Map<ViewKind, ViewAvailability>();
  for (const kind of VIEW_KINDS) {
    out.set(kind, representationAvailability(mol, kind));
  }
  return out;
}

const AVAILABLE: ViewAvailability = Object.freeze({ available: true });

/**
 * Atoms whose element symbol the table does not know.
 *
 * `isKnownElement` rather than a try/catch around `requireElement`: catching
 * an exception to answer a question is how a real bug elsewhere in the
 * traversal gets swallowed as "unknown element".
 */
function atomsWithUnknownElements(mol: Molecule): AtomId[] {
  const out: AtomId[] = [];
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (atom === undefined) continue;
    if (!isKnownElement(atom.element)) out.push(atomId);
  }
  return out;
}

/** "Fe has" / "R, X are" / "7 atoms have" — the subject of the messages
 *  above. Named symbols while there are few enough to read, a count past
 *  that, because a message listing thirty symbols is a message nobody reads. */
function describe(
  mol: Molecule,
  atomIds: readonly AtomId[],
  verb: "is" | "has",
): string {
  const plural = verb === "is" ? "are" : "have";
  const symbols = [
    ...new Set(atomIds.map((id) => mol.atoms[id]?.element ?? "?")),
  ];
  if (symbols.length === 0) return `no atoms ${plural}`;
  if (symbols.length <= 3) {
    return `${symbols.join(", ")} ${symbols.length === 1 ? verb : plural}`;
  }
  return `${atomIds.length} atoms ${plural}`;
}
