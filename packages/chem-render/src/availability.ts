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

import {
  atomsWithUncountableLonePairs,
  canCondense,
  isKnownElement,
  lonePairCount,
  project,
  stereoConfig,
} from "@starter/chem-core";
import type {
  AtomId,
  LonePairReason,
  Molecule,
  ProjectedLayout,
  ProjectionUnavailableReason,
  ProjectionView,
  StereoConfig,
} from "@starter/chem-core";

import { labelOverride } from "./label/visibility.js";
import { isTextViewKind, VIEW_KINDS } from "./representation.js";
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
  /**
   * Lewis only, and a DIFFERENT failure from the one above: the element's
   * valences are known perfectly well, and the atom has more bonds than they
   * allow, so the electron budget the count subtracts from is already
   * negative. chem-core distinguishes the two as `LonePairReason`, and
   * collapsing them here printed "C has no default valences" over a carbon —
   * a sentence that is simply false, in the cell of a published figure.
   */
  | "over-valent"
  /** Condensed only: there is no linear spelling of a ring. */
  | "cyclic"
  /**
   * Text views only: an atom is drawn as an abbreviation — "Ph", "Boc", "R'" —
   * and a formula cannot say what it stands for.
   *
   * The graph under a "Ph" is whatever the author actually drew, usually a
   * bare carbon, so the formula is not merely incomplete: benzyl alcohol drawn
   * as Ph–CH2–OH condenses to "CH3CH2OH" and sums to "C2H6O", which is
   * ethanol. A cell that confidently states the wrong molecule is worse than
   * the empty one this whole module exists to prevent. The STRUCTURAL views
   * are unaffected — they draw the abbreviation, which is exactly what the
   * author asked for.
   */
  | "abbreviated-label";

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
    // Both arms of chem-core's `LonePairReason`, kept apart. The element-level
    // failure is reported first: an atom whose element has no valences at all
    // cannot also be over-valent, and a molecule holding one of each is
    // better described by the more fundamental of the two.
    const uncountable = byLonePairReason(mol);
    const noData = uncountable.get("no-valence-data") ?? [];
    if (noData.length > 0) {
      return {
        available: false,
        reason: "no-lone-pair-data",
        message: `${describe(mol, noData, "has")} no default valences, so their lone pairs cannot be counted.`,
        atomIds: noData,
      };
    }
    const overValent = uncountable.get("over-subscribed") ?? [];
    if (overValent.length > 0) {
      return {
        available: false,
        reason: "over-valent",
        message: `${describe(mol, overValent, "has")} more bonds than its valence allows, so the lone pairs cannot be counted.`,
        atomIds: overValent,
      };
    }
  }

  if (isTextViewKind(kind)) {
    const abbreviated = atomsDrawnAsAbbreviations(mol);
    if (abbreviated.length > 0) {
      return {
        available: false,
        reason: "abbreviated-label",
        message: labelRefusal(mol, abbreviated),
        atomIds: abbreviated,
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

/**
 * A panel with a projection (decision 128) can be drawn, needs a choice, or
 * cannot be drawn — the three-valued answer `representationAvailability`
 * extends to. `needsChoice` is not a failure: three rings and a ring view
 * that names none of them is a question for the chemist, with the
 * candidates to offer, never an empty cell.
 */
export type ProjectedViewAvailability =
  | { readonly status: "available"; readonly layout: ProjectedLayout }
  | {
      readonly status: "needsChoice";
      readonly message: string;
      /** Complete ring atom-id sets, ready to store as the frame's ring. */
      readonly candidates: readonly (readonly AtomId[])[];
    }
  | {
      readonly status: "unavailable";
      readonly reason: UnavailableReason | ProjectionUnavailableReason | "text-view";
      readonly message: string;
      readonly atomIds: readonly AtomId[];
    };

/**
 * Whether `kind` can be drawn in `view` for `mol`, and the layout to draw it
 * with when it can (hand it to `buildScene` as `options.layout`).
 *
 * The representation's own verdict comes first, for the reason the checks
 * above run most-general first: a molecule with an "R" on it is not "a Fischer
 * cannot be drawn", it is a structure nothing can be computed for. A text view
 * has no coordinates to project. `config` defaults to the configuration the
 * drawing states.
 */
export function projectedViewAvailability(
  mol: Molecule,
  kind: ViewKind,
  view: ProjectionView,
  config?: StereoConfig,
): ProjectedViewAvailability {
  const base = representationAvailability(mol, kind);
  if (!base.available) {
    return { status: "unavailable", reason: base.reason, message: base.message, atomIds: base.atomIds };
  }
  if (isTextViewKind(kind)) {
    return {
      status: "unavailable",
      reason: "text-view",
      message: "A formula has no drawing to project; choose a structural view.",
      atomIds: [],
    };
  }
  const result = project(mol, config ?? stereoConfig(mol), view);
  switch (result.kind) {
    case "available":
      return { status: "available", layout: result.layout };
    case "needsChoice":
      return {
        status: "needsChoice",
        message: `${result.candidates.length} rings fit this view; choose the one to draw.`,
        candidates: result.candidates,
      };
    case "unavailable":
      return {
        status: "unavailable",
        reason: result.reason,
        message: PROJECTION_MESSAGES[result.reason](mol, result.atomIds),
        atomIds: result.atomIds,
      };
  }
}

/**
 * One sentence per projection refusal, ready for the cell. A TOTAL mapping, so
 * a reason chem-core adds is a compile error here rather than a blank cell.
 */
const PROJECTION_MESSAGES: Readonly<
  Record<ProjectionUnavailableReason, (mol: Molecule, atomIds: readonly AtomId[]) => string>
> = {
  "empty-molecule": () => "Nothing has been drawn yet.",
  "unknown-element": (mol, ids) =>
    `${describe(mol, ids, "is")} not in the periodic table, so the configuration cannot be derived.`,
  "missing-atom": () => "This view names an atom that has since been deleted; choose again.",
  "missing-bond": () => "This view names a bond that has since been deleted; choose again.",
  "repeated-atom": () => "The backbone lists an atom twice.",
  "not-a-path": () => "The backbone atoms are not bonded one after another.",
  "backbone-too-short": () => "A backbone needs at least three atoms.",
  "backbone-in-ring": () => "The backbone runs through a ring, which a vertical chain cannot draw.",
  "too-many-substituents": () => "A backbone atom has more than the two arms a cross offers.",
  "substituent-too-large": () => "A substituent contains a ring, which cannot be written as a label.",
  "no-ring": () => "There is no ring to draw in this view.",
  "not-a-ring": () => "The chosen atoms are not one ring of this structure.",
  "ring-size": () => "This view draws five- and six-membered rings only.",
  "not-bonded": () => "The two atoms of the sighted bond are not bonded.",
  "invalid-parameter": () => "A view angle is not a number.",
  "config-mismatch": () => "The configuration belongs to a different structure.",
  "id-conflict": () => "An atom id in this file clashes with a drawn label's id.",
  "template-not-built": () => "This projection is not available yet.",
};

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

/**
 * The atoms whose lone pairs cannot be counted, split by chem-core's reason.
 *
 * `atomsWithUncountableLonePairs` answers "which", `lonePairCount` answers
 * "why", and this asks the second of the first's answers rather than walking
 * the molecule twice — so the two can never disagree about which atoms are in
 * the report.
 */
function byLonePairReason(mol: Molecule): Map<LonePairReason, AtomId[]> {
  const out = new Map<LonePairReason, AtomId[]>();
  for (const atomId of atomsWithUncountableLonePairs(mol)) {
    const result = lonePairCount(mol, atomId);
    // Narrowing, not a default: `atomsWithUncountableLonePairs` returns
    // exactly the atoms whose count came back `unknown`.
    if (result.kind !== "unknown") continue;
    const bucket = out.get(result.reason);
    if (bucket === undefined) out.set(result.reason, [atomId]);
    else bucket.push(atomId);
  }
  return out;
}

/**
 * Atoms carrying a display override.
 *
 * Through `labelOverride`, which is this package's single source of truth for
 * "is there an override" — a label of one space is not one, and a second test
 * here would be a second answer.
 */
function atomsDrawnAsAbbreviations(mol: Molecule): AtomId[] {
  const out: AtomId[] = [];
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (atom === undefined) continue;
    if (labelOverride(atom) !== undefined) out.push(atomId);
  }
  return out;
}

/**
 * "Ph is drawn as an abbreviation, so a formula cannot state what it stands
 * for." / "Ph, Boc are drawn as abbreviations, so … what they stand for."
 *
 * The abbreviations THEMSELVES, not their elements, because "C is drawn as an
 * abbreviation" tells a reader nothing about which atom to look at.
 *
 * The WHOLE sentence, unlike `describe` below, which returns a subject the
 * caller completes. The trailing clause has to agree in number with the
 * subject — one "Ph" takes "what it stands for", two take "what they stand
 * for" — and a fixed clause bolted on at the call site printed "Ph … what they
 * stand for" into the cell of a figure, which is the register this whole
 * module exists to keep out of one.
 */
function labelRefusal(mol: Molecule, atomIds: readonly AtomId[]): string {
  const labels = [
    ...new Set(
      atomIds.flatMap((id) => {
        const atom = mol.atoms[id];
        const label = atom === undefined ? undefined : labelOverride(atom);
        return label === undefined ? [] : [label];
      }),
    ),
  ];
  const tail = "so a formula cannot state what";
  if (labels.length === 1) {
    return `${labels[0]} is drawn as an abbreviation, ${tail} it stands for.`;
  }
  // Named while there are few enough to read, counted past that — the same
  // rule `describe` follows, for the same reason.
  const subject =
    labels.length > 1 && labels.length <= 3
      ? labels.join(", ")
      : `${atomIds.length} atoms`;
  return `${subject} are drawn as abbreviations, ${tail} they stand for.`;
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
