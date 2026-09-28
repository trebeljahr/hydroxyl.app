/**
 * Every chemistry issue in one list, and the one-click fixes for them.
 *
 * WHY A MODULE OF ITS OWN. The two families cannot live together: stereo.ts
 * needs `implicitHydrogenCount` to count substituents, so folding its check
 * into `valenceIssues` would make valence.ts import a module that imports
 * valence.ts. The client used to compose them itself, which put the list —
 * and, once fixes existed, the chemistry of fixing — outside this package.
 * This module imports both and nothing imports it.
 *
 * A FIX IS OFFERED, NEVER APPLIED. Over-valence is reported rather than
 * prevented (see `valenceIssues`), and a reported problem is repaired only
 * when the author clicks. What this module adds is the knowledge of which
 * click is OBVIOUS, and it is strict about that word:
 *
 *   - Every fix is proved by applying it: an offer is made only when the
 *     resulting molecule no longer carries the issue at that atom. A fix that
 *     half-repairs an atom is a second problem with a button on it.
 *   - A charge is offered only when the charged atom lands EXACTLY on one of
 *     its valences, so no hydrogen appears as a side effect. A neutral
 *     nitrogen with four bonds becomes an ammonium, never an NH.
 *   - A bond is lowered only when exactly one multiple bond at the atom can
 *     absorb the surplus. With two candidates the choice is the author's, and
 *     guessing would move a double bond they drew on purpose.
 *
 * Nothing here decides which fix is RIGHT. A methylamine nitrogen pinned to
 * three hydrogens is either a methylammonium missing its charge or a stale
 * pin, and both are offered, charge first.
 */

import { requireElement } from "./elements.js";
import { bondsAt, getAtom, getBond, neighborIds, requireAtom, requireBond } from "./molecule.js";
import {
  flipBond,
  setBondStereo,
  setExplicitHydrogenCount,
  updateAtom,
  updateBond,
} from "./ops.js";
import { structuralIssues, type StructuralIssue, type StructuralIssueKind } from "./stereo.js";
import type { AtomId, BondId, BondOrder, Molecule } from "./types.js";
import {
  chargeAdjustedValences,
  isOverValent,
  maxValence,
  statedValence,
  valenceIssues,
  type ValenceIssue,
  type ValenceIssueKind,
} from "./valence.js";

export type ChemistryIssueKind = ValenceIssueKind | StructuralIssueKind;

/** Either family. Both carry `kind`, `atomId`, `atomIds`, `bondIds`,
 *  `severity`, `message` and `label`, which is all a consumer reads. */
export type ChemistryIssue = ValenceIssue | StructuralIssue;

/** Valence problems first, then drawing problems, each in document order. */
export function chemistryIssues(mol: Molecule): readonly ChemistryIssue[] {
  return [...valenceIssues(mol), ...structuralIssues(mol)];
}

/**
 * One click's worth of repair. `title` is the button text, written here
 * because the wording is chemistry: "Make it N⁺" names a species.
 */
export type IssueFix =
  | {
      readonly kind: "set-charge";
      readonly title: string;
      readonly atomId: AtomId;
      readonly charge: number;
    }
  | {
      /** X=Y becomes X⁺–Y⁻: a pentavalent nitro nitrogen, an azide drawn N=N#N. */
      readonly kind: "charge-separate";
      readonly title: string;
      readonly atomId: AtomId;
      readonly bondId: BondId;
      readonly partnerId: AtomId;
    }
  | {
      readonly kind: "lower-bond-order";
      readonly title: string;
      readonly bondId: BondId;
      readonly order: BondOrder;
    }
  | {
      readonly kind: "remove-radical";
      readonly title: string;
      readonly atomId: AtomId;
      readonly radicalElectrons: number;
    }
  | {
      /** Unpin the hydrogen count and let valence derive it. */
      readonly kind: "derive-hydrogens";
      readonly title: string;
      readonly atomId: AtomId;
    }
  | { readonly kind: "remove-wedge"; readonly title: string; readonly bondId: BondId }
  | { readonly kind: "reverse-wedge"; readonly title: string; readonly bondId: BondId };

/** Applies a fix. Throws on an id the molecule does not have, as ops do. */
export function applyIssueFix(mol: Molecule, fix: IssueFix): Molecule {
  switch (fix.kind) {
    case "set-charge":
      return updateAtom(mol, fix.atomId, { charge: fix.charge });
    case "charge-separate": {
      const bond = requireBond(mol, fix.bondId);
      const lowered = updateBond(mol, fix.bondId, {
        order: (bond.order - 1) as BondOrder,
        stereo: "none",
      });
      const centre = requireAtom(lowered, fix.atomId);
      const partner = requireAtom(lowered, fix.partnerId);
      return updateAtom(
        updateAtom(lowered, fix.atomId, { charge: centre.charge + 1 }),
        fix.partnerId,
        { charge: partner.charge - 1 },
      );
    }
    case "lower-bond-order": {
      const bond = requireBond(mol, fix.bondId);
      // `either` is a DOUBLE-bond mark; left on a single bond it would claim
      // nothing and still be written to the file.
      return updateBond(mol, fix.bondId, {
        order: fix.order,
        ...(bond.stereo === "either" && fix.order === 1 ? { stereo: "none" as const } : {}),
      });
    }
    case "remove-radical":
      return updateAtom(mol, fix.atomId, { radicalElectrons: fix.radicalElectrons });
    case "derive-hydrogens":
      return setExplicitHydrogenCount(mol, fix.atomId, undefined);
    case "remove-wedge":
      return setBondStereo(mol, fix.bondId, "none");
    case "reverse-wedge":
      // `from` is the narrow end, so swapping the endpoints IS the reversal.
      return flipBond(mol, fix.bondId);
  }
}

/**
 * The obvious one-click fixes for `issue`, most likely first, or none.
 *
 * Empty for an issue whose ids the molecule no longer has — a list rendered
 * against one molecule and clicked against the next — rather than throwing.
 */
export function issueFixes(mol: Molecule, issue: ChemistryIssue): readonly IssueFix[] {
  if (getAtom(mol, issue.atomId) === undefined) return [];
  switch (issue.kind) {
    case "over-valent":
      return overValenceFixes(mol, issue.atomId);
    case "negative-hydrogens":
      return [
        { kind: "derive-hydrogens", title: "Unpin the hydrogen count", atomId: issue.atomId },
      ];
    case "wedge-on-non-stereocenter":
    case "wedge-drawn-backwards":
      return wedgeFixes(mol, issue);
    case "unrepresentable-stereo":
      // Sound chemistry this build cannot express. There is nothing to fix.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Over-valence
// ---------------------------------------------------------------------------

function overValenceFixes(mol: Molecule, atomId: AtomId): IssueFix[] {
  if (!isOverValent(mol, atomId)) return [];
  const atom = requireAtom(mol, atomId);
  const candidates: IssueFix[] = [];

  // Charge separation first: it keeps the net charge where the author put it,
  // which a bare "make it N⁺" does not.
  const separation = chargeSeparation(mol, atomId);
  if (separation !== undefined) candidates.push(separation);

  if (atom.charge === 0 && isPBlock(atom.element)) {
    for (const charge of [1, -1]) {
      candidates.push({
        kind: "set-charge",
        title: `Make it ${chargedSymbol(atom.element, charge)}`,
        atomId,
        charge,
      });
    }
  }

  if ((atom.explicitHydrogenCount ?? 0) > 0) {
    candidates.push({ kind: "derive-hydrogens", title: "Unpin the hydrogen count", atomId });
  }

  const excess = statedValence(mol, atomId) - maxValence(mol, atomId);
  if (atom.radicalElectrons > 0) {
    const remaining = Math.max(0, atom.radicalElectrons - excess);
    candidates.push({
      kind: "remove-radical",
      title: remaining === 0 ? "Remove the unpaired electrons" : "Remove an unpaired electron",
      atomId,
      radicalElectrons: remaining,
    });
  }

  const lowerable = bondsAt(mol, atomId).filter(
    (bond) => !bond.aromatic && bond.order > 1 && bond.order - excess >= 1,
  );
  // Exactly one, or the choice is the author's. See the header.
  const only = lowerable.length === 1 ? lowerable[0] : undefined;
  if (only !== undefined) {
    const order = (only.order - excess) as BondOrder;
    const other = requireAtom(mol, only.from === atomId ? only.to : only.from);
    candidates.push({
      kind: "lower-bond-order",
      title:
        `Make the ${atom.element}${BOND_SYMBOL[only.order]}${other.element} bond ` +
        ORDER_WORD[order],
      bondId: only.id,
      order,
    });
  }

  return candidates.filter((fix) => resolves(mol, fix, atomId));
}

/**
 * X=Y to X⁺–Y⁻ on a TERMINAL Y, or nothing.
 *
 * Terminal because that is the drawing this repairs — the nitro oxygen, the
 * azide's end nitrogen — and because moving a charge onto an atom with other
 * bonds is a rearrangement, not a repair. Only from a neutral X, and no
 * arithmetic on the surplus up front: the nitro nitrogen is TWO over a
 * neutral nitrogen's 3 and lands on N⁺'s 4, because the charge moves the
 * ceiling as the bond order comes down. Applying the fix and asking is the
 * only test that cannot get that wrong.
 */
function chargeSeparation(mol: Molecule, atomId: AtomId): IssueFix | undefined {
  const atom = requireAtom(mol, atomId);
  if (atom.charge !== 0 || !isPBlock(atom.element)) return undefined;
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.aromatic || bond.order < 2) continue;
    const partnerId = bond.from === atomId ? bond.to : bond.from;
    const partner = requireAtom(mol, partnerId);
    if (partner.charge !== 0 || !isPBlock(partner.element)) continue;
    if (neighborIds(mol, partnerId).length !== 1) continue;
    const fix: IssueFix = {
      kind: "charge-separate",
      title:
        `Draw it as ${chargedSymbol(atom.element, 1)}` +
        `${BOND_SYMBOL[(bond.order - 1) as BondOrder]}${chargedSymbol(partner.element, -1)}`,
      atomId,
      bondId: bond.id,
      partnerId,
    };
    // The partner has to come out exact too: an O⁻ that gained a hydrogen
    // would be a hydroxide.
    const next = applyIssueFix(mol, fix);
    if (resolves(mol, fix, atomId) && landsExactly(next, partnerId)) return fix;
  }
  return undefined;
}

/** The fix clears the over-valence at `atomId` and adds no hydrogen there. */
function resolves(mol: Molecule, fix: IssueFix, atomId: AtomId): boolean {
  const next = applyIssueFix(mol, fix);
  if (isOverValent(next, atomId)) return false;
  // Unpinning and lowering a bond are ALLOWED to change the hydrogen count:
  // handing the count back to valence is the point of the first, and a C=C
  // made single gains its hydrogens as it should. A charge or a lost radical
  // is not, which is what "lands exactly" means.
  if (fix.kind === "derive-hydrogens" || fix.kind === "lower-bond-order") return true;
  return landsExactly(next, atomId);
}

/**
 * The atom's stated valence is one of its charge-adjusted valences.
 *
 * For an unpinned atom that is "derives no hydrogen": an atom below its
 * valence is filled up with them, which is the side effect ruled out. For a
 * pinned one the stated count is part of the sum, so the whole statement has
 * to be a valence the charged element has.
 */
function landsExactly(mol: Molecule, atomId: AtomId): boolean {
  if (isOverValent(mol, atomId)) return false;
  return chargeAdjustedValences(mol, atomId).includes(statedValence(mol, atomId));
}

/**
 * Groups 13 to 17: the elements for which a formal charge is a normal way to
 * account for one bond too many. Hydrogen, the alkali and alkaline-earth
 * metals and the d-block are left out — "make it H⁻" is not an obvious fix
 * for a hydrogen drawn with two bonds.
 */
function isPBlock(symbol: string): boolean {
  const element = requireElement(symbol);
  return element.valences.length > 0 && element.group >= 13 && element.group <= 17;
}

const BOND_SYMBOL: Readonly<Record<BondOrder, string>> = { 1: "–", 2: "=", 3: "≡" };
const ORDER_WORD: Readonly<Record<BondOrder, string>> = {
  1: "single",
  2: "double",
  3: "triple",
};

/** "N⁺", "O⁻". Only ±1 is ever offered, so only those glyphs are needed. */
function chargedSymbol(symbol: string, charge: number): string {
  return `${symbol}${charge > 0 ? "⁺" : "⁻"}`;
}

// ---------------------------------------------------------------------------
// Wedges
// ---------------------------------------------------------------------------

function wedgeFixes(mol: Molecule, issue: ChemistryIssue): IssueFix[] {
  const bondId = "bondId" in issue ? issue.bondId : undefined;
  if (bondId === undefined) return [];
  const bond = getBond(mol, bondId);
  if (bond === undefined) return [];
  const mark = bond.stereo === "hash" ? "hash" : "wedge";
  const remove: IssueFix = { kind: "remove-wedge", title: `Remove the ${mark}`, bondId };
  if (issue.kind !== "wedge-drawn-backwards") return [remove];
  return [
    { kind: "reverse-wedge", title: `Point the ${mark} at the stereocentre`, bondId },
    remove,
  ];
}
