/**
 * Valence and implicit hydrogens.
 *
 * Hydrogens are IMPLICIT. They are derived from valence at query time, not
 * stored as atoms in the graph. The old model created a real Atom node per
 * hydrogen, which meant every traversal, layout pass and export had to filter
 * them back out, and adding a bond meant deleting hydrogens first and
 * recreating them after.
 *
 * The charge and radical handling mirrors RDKit's `calculateImplicitValence`,
 * carbon special case included. Matching it is deliberate: RDKit is the
 * import/export oracle, and a different rule here would show up as hydrogens
 * appearing or vanishing across a SMILES round-trip.
 */

import { requireElement } from "./elements.js";
import { bondsAt, requireAtom } from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";

/** An aromatic bond contributes 1.5, so a benzene carbon totals 3. */
const AROMATIC_BOND_ORDER = 1.5;

/**
 * Sum of the orders of the bonds actually drawn at this atom. Excludes
 * implicit hydrogens and radical electrons.
 */
export function bondOrderSum(mol: Molecule, atomId: AtomId): number {
  let sum = 0;
  for (const bond of bondsAt(mol, atomId)) {
    sum += bond.aromatic ? AROMATIC_BOND_ORDER : bond.order;
  }
  // Aromatic rings give half-integers that should land on a whole number once
  // the whole ring is accounted for; rounding absorbs float error.
  return Math.round(sum * 2) / 2;
}

/**
 * True when the element sits to the left of carbon in the periodic table, so
 * a positive charge *increases* rather than decreases its bonding capacity.
 */
function isEarlyAtom(group: number): boolean {
  // Outer electrons for main-group elements; d-block is handled by having no
  // default valences at all, so it never reaches this.
  const outerElectrons = group <= 2 ? group : group - 10;
  return outerElectrons < 4;
}

/**
 * The charge adjustment applied to a default valence.
 *
 * Ammonium N+ can take four bonds (3 + 1); alkoxide O- takes one (2 - 1).
 * Electropositive elements invert, and carbon inverts for positive charge
 * only — without that special case a carbocation would be assigned five
 * bonds instead of three.
 */
function chargeAdjustment(symbol: string, group: number, charge: number): number {
  if (charge === 0) return 0;
  let adjusted = charge;
  if (isEarlyAtom(group)) adjusted = -adjusted;
  if (symbol === "C" && adjusted > 0) adjusted = -adjusted;
  return adjusted;
}

/**
 * Number of hydrogens drawn on this atom.
 *
 * Returns `explicitHydrogenCount` verbatim when the atom pins it. That escape
 * hatch is required for cases valence alone cannot resolve — pyrrole's N-H is
 * the classic one, since both pyrrole and pyridine nitrogens see a bond-order
 * sum of 3 from their two aromatic ring bonds.
 */
export function implicitHydrogenCount(mol: Molecule, atomId: AtomId): number {
  const atom = requireAtom(mol, atomId);
  if (atom.explicitHydrogenCount !== undefined) return atom.explicitHydrogenCount;

  const element = requireElement(atom.element);
  if (element.valences.length === 0) return 0;

  const used = bondOrderSum(mol, atomId) + atom.radicalElectrons;
  const adjustment = chargeAdjustment(element.symbol, element.group, atom.charge);

  for (const valence of element.valences) {
    const target = valence + adjustment;
    if (used <= target) return Math.max(0, Math.round(target - used));
  }
  // Over-valent: nothing left to fill. `valenceIssues` reports it separately.
  return 0;
}

/** Bond orders drawn, plus radical electrons. */
export function explicitValence(mol: Molecule, atomId: AtomId): number {
  return bondOrderSum(mol, atomId) + requireAtom(mol, atomId).radicalElectrons;
}

/** Everything: drawn bonds, radicals, and implicit hydrogens. */
export function totalValence(mol: Molecule, atomId: AtomId): number {
  return explicitValence(mol, atomId) + implicitHydrogenCount(mol, atomId);
}

/**
 * Every default valence this element offers, charge adjustment applied, in the
 * element table's ascending order. Empty for a metal, which carries none.
 *
 * The LIST, not just its last entry, is what a caller reasoning about a
 * multi-valence element needs. Sulfur allows 2, 4 and 6 and picks whichever
 * one its bonding actually reaches: divalent in a thiol, hexavalent in a
 * sulfone. Collapsing that to `maxValence` and measuring room against 6 makes
 * a two-connected sulfur look like it has four bonds' worth of capacity going
 * spare, which is true of a sulfone and nonsense for a thiophene.
 */
export function chargeAdjustedValences(mol: Molecule, atomId: AtomId): number[] {
  const atom = requireAtom(mol, atomId);
  const element = requireElement(atom.element);
  const adjustment = chargeAdjustment(element.symbol, element.group, atom.charge);
  return element.valences.map((valence) => valence + adjustment);
}

/** The highest valence this atom could reach, charge included. */
export function maxValence(mol: Molecule, atomId: AtomId): number {
  const atom = requireAtom(mol, atomId);
  const element = requireElement(atom.element);
  if (element.valences.length === 0) return Infinity;
  const highest = element.valences[element.valences.length - 1]!;
  return highest + chargeAdjustment(element.symbol, element.group, atom.charge);
}

/**
 * How many more bond-order units this atom could take before it passes its
 * highest default valence. Infinite for metals, which carry no default
 * valence and so are never treated as saturated.
 *
 * A QUERY, NOT A GATE. Nothing in the editor is allowed to refuse an edit on
 * the strength of this number. Drawing a bond from a saturated atom is a
 * normal thing to do halfway through sketching a mechanism, and over-valence
 * is REPORTED — once, by `valenceIssues`, as a badge — never prevented. See
 * the note on `valenceIssues` for why.
 *
 * What it is actually for: status readouts ("2 free"), and template placement,
 * where the number of open positions decides how a ring or group is oriented
 * when it is dropped onto an existing atom.
 *
 * `sprout.ts` therefore does not import this function, and that omission is
 * deliberate rather than an oversight: a second saturation rule living in the
 * drawing tool would be a competing policy, and the two would disagree the
 * first time one of them learned about hypervalent sulfur and the other did
 * not.
 */
export function freeValence(mol: Molecule, atomId: AtomId): number {
  const max = maxValence(mol, atomId);
  if (max === Infinity) return Infinity;
  return Math.max(0, max - explicitValence(mol, atomId));
}

/**
 * Whether a bond of this order would still fit under the atom's highest
 * default valence.
 *
 * Reads like a permission check and is not one. Despite the name, no caller
 * may use it to decline an edit: sprouting a bond is never blocked by
 * valence, and the only place an over-valent atom surfaces is
 * `valenceIssues`. Treat it as `freeValence(...) >= order` phrased for a
 * status badge, or as the predicate that picks which atom of a template is a
 * plausible attachment point.
 */
export function canAcceptBond(mol: Molecule, atomId: AtomId, order = 1): boolean {
  return freeValence(mol, atomId) >= order;
}

export function isOverValent(mol: Molecule, atomId: AtomId): boolean {
  const max = maxValence(mol, atomId);
  return max !== Infinity && explicitValence(mol, atomId) > max;
}

export interface ValenceIssue {
  readonly atomId: AtomId;
  readonly severity: "error" | "warning";
  readonly message: string;
}

/**
 * Structural problems worth surfacing in the status bar.
 *
 * Reported rather than prevented: a chemist sketching an intermediate should
 * be able to draw something briefly wrong without the editor fighting them.
 */
export function valenceIssues(mol: Molecule): ValenceIssue[] {
  const issues: ValenceIssue[] = [];
  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    if (isOverValent(mol, atomId)) {
      issues.push({
        atomId,
        severity: "error",
        message:
          `${atom.element} has ${explicitValence(mol, atomId)} bonds but allows ` +
          `at most ${maxValence(mol, atomId)}`,
      });
    }
    if (atom.explicitHydrogenCount !== undefined && atom.explicitHydrogenCount < 0) {
      issues.push({
        atomId,
        severity: "error",
        message: `${atom.element} has a negative hydrogen count`,
      });
    }
  }
  return issues;
}
