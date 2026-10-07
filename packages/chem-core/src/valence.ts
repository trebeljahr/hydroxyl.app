/**
 * Valence and implicit hydrogens.
 *
 * Hydrogens are IMPLICIT. They are derived from valence at query time, not
 * stored as atoms in the graph. The old model created a real Atom node per
 * hydrogen, which meant every traversal, layout pass and export had to filter
 * them back out, and adding a bond meant deleting hydrogens first and
 * recreating them after.
 *
 * The charge and radical handling mirrors RDKit's `calculateImplicitValence`
 * as of 2024.09 — a charged atom reads as its isoelectronic element, see
 * `chargedValences` — and the resolution of aromatic half-integers follows
 * its `calcExplicitValence` (bar the final integer rounding, which is
 * deliberately not ported). Matching them is deliberate: RDKit is the
 * import/export oracle, and a different rule here would show up as hydrogens
 * appearing or vanishing across a SMILES round-trip.
 *
 * TWO NUMBERS, NOT ONE. `bondOrderSum` is what is drawn, aromatic bonds still
 * weighing 1.5; `explicitValence` is the valence that implies, with those
 * halves resolved against the element's valence list. Everything that answers
 * a chemistry question — hydrogens, free valence, over-valence — goes through
 * the second. See `resolveAromaticValence` for why collapsing them would be
 * wrong, and for the thiophene formula it used to get wrong.
 */

import { elementByZ, requireElement } from "./elements.js";
import { bondsAt, degree, getAtom, requireAtom } from "./molecule.js";
import type { AtomId, Bond, BondId, Molecule } from "./types.js";

/** An aromatic bond contributes 1.5, so a benzene carbon totals 3. */
const AROMATIC_BOND_ORDER = 1.5;

/**
 * The largest amount an aromatic-flagged bond can inflate a bond-order sum
 * over the Kekule structure it stands for: half an order per bond, and an
 * aromatic atom has at most three ring bonds. Past this, a sum that overshoots
 * the valence list is a genuinely over-connected atom rather than perception
 * noise. See `resolveAromaticValence`.
 */
const MAX_AROMATIC_SLACK = 1.5;

/**
 * Sum of the orders of the bonds actually drawn at this atom. Excludes
 * implicit hydrogens and radical electrons.
 *
 * RAW, and deliberately so: an aromatic-flagged bond still weighs 1.5 here,
 * exactly as RDKit's `Bond::getValenceContrib` does, so a flagged thiophene
 * sulfur reads 3 and a half-Kekulised ring leaves a visible half-integer
 * behind. Resolving those halves against the element's valence list is a
 * separate step — see `explicitValence` — because the two numbers answer
 * different questions: this one is "what is drawn", that one is "what valence
 * does the atom therefore carry". Collapsing them would also blind the
 * Kekulisation tests, which use a half-integer sum as the signal that a ring
 * was only partly assigned.
 */
export function bondOrderSum(mol: Molecule, atomId: AtomId): number {
  let sum = 0;
  for (const bond of bondsAt(mol, atomId)) {
    sum += bond.aromatic ? AROMATIC_BOND_ORDER : valenceContribution(bond, atomId);
  }
  // Aromatic rings give half-integers that should land on a whole number once
  // the whole ring is accounted for; rounding absorbs float error.
  return Math.round(sum * 2) / 2;
}

/**
 * What one non-aromatic bond adds to the valence of the atom at `atomId`.
 *
 * Its order, except a dative bond's DONOR end, which gets 0 (decision 226):
 * the pair it shares was the donor's own lone pair, so the donor keeps the
 * hydrogens it had — ammonia in H3N->BH3 is still NH3. The acceptor end
 * counts 1. That is RDKit's `Bond::getValenceContrib` for DATIVE exactly, and
 * the asymmetry has a visible consequence worth knowing: boron's only valence
 * is 3, so a drawn N->B leaves the boron BH2, as RDKit reads `N->B`.
 */
export function valenceContribution(bond: Bond, atomId: AtomId): number {
  if (bond.dative && bond.from === atomId) return 0;
  return bond.order;
}

/**
 * Whether this atom carries perception an importer brought in, mirroring
 * RDKit's `isAromaticAtom`: its own flag, or any flagged bond at it. A bond
 * flag alone is enough because a molblock's bond block is where aromaticity
 * arrives, and an importer that set only the bonds must still get the same
 * hydrogens.
 *
 * Nothing in the Kekule storage form matches, so every adjustment keyed off
 * this predicate is inert on a molecule the editor produced.
 */
function hasAromaticPerception(mol: Molecule, atomId: AtomId): boolean {
  const atom = requireAtom(mol, atomId);
  if (atom.aromatic) return true;
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.aromatic) return true;
  }
  return false;
}

/**
 * How many electrons this element brings to its outer shell, or undefined
 * where the question has no honest answer.
 *
 * DOMAIN: main-group elements only, and the guard is the valence list rather
 * than the group number. Every element in the table that carries a default
 * valence is in group 1, 2 or 13-18, so `group - 10` is its outer-electron
 * count and `group` is its own for the first two columns. Outside that the
 * arithmetic is nonsense — group 3 would read -7, and the f-block, which the
 * table records as group 0, would read -10 — so an element with no default
 * valences gets `undefined` instead of a plausible wrong number. A caller
 * that wants to count lone pairs on a transition metal has to say what it
 * means by that; this function refuses to invent it, in the same spirit as
 * `exactMass()`.
 *
 * HELIUM IS THE ONE EXCEPTION THE GROUP RULE GETS WRONG. It sits in group 18
 * because it is inert, not because it has eight outer electrons: its only
 * shell closes at two. The noble gases carry RDKit's `[0]` valence, so they
 * reach this arithmetic, and without the exception a lone helium would be
 * drawn with four lone pairs instead of one.
 *
 * Lifted out of the private helper below so `lewis.ts` can count lone pairs
 * from it rather than re-deriving the same expression: two copies of the
 * group-to-electron rule would be two places to get the d-block wrong.
 */
export function outerElectronCount(symbol: string): number | undefined {
  const element = requireElement(symbol);
  if (element.valences.length === 0) return undefined;
  if (element.z === 2) return 2;
  const group = element.group;
  return group <= 2 ? group : group - 10;
}

/**
 * Whether a negative charge on this atom is read on its OWN valence list,
 * shifted, rather than on the isoelectronic element's. RDKit's
 * `canBeHypervalent`, verbatim.
 *
 * Phosphorus, sulfur, arsenic and selenium have hypervalent forms, and the
 * element a negative charge makes them isoelectronic with may not: S- is
 * chlorine's electron count, and chlorine's `[1]` would call SF5- over-valent.
 * So once the charge carries one of them past its own row's chalcogen —
 * beyond sulfur for P and S, beyond selenium for As and Se: S⁻, P²⁻, Se⁻,
 * As²⁻ — RDKit keeps the atom's own list and counts the charge against the
 * bonds instead, which is the old additive rule for these four. P⁻ stops at
 * sulfur, whose `[2, 4, 6]` already covers PF6-.
 */
function canBeHypervalent(z: number, effectiveZ: number): boolean {
  return (
    (effectiveZ > 16 && (z === 15 || z === 16)) ||
    (effectiveZ > 34 && (z === 33 || z === 34))
  );
}

/** No hydrogens, and over-valent at any bond count. See `atomValences`. */
const UNREASONABLE_CHARGE: readonly number[] = Object.freeze([-1]);

/** No hydrogens, no bonds: a bare proton. See `chargedValences`. */
const NO_ELECTRONS: readonly number[] = Object.freeze([0]);

/**
 * The valences a charged atom may take, ascending: hydrogens fill it up to
 * the first entry its bonding reaches, and past the last it is over-valent.
 *
 * THE RULE IS RDKIT'S, from `calculateImplicitValence` in
 * Code/GraphMol/Atom.cpp, as rewritten for 2024.09: a charged atom reads as
 * the element with the same electron count, atomic number minus charge, and
 * takes that element's valence list whole. N+ is carbon's `[4]` (ammonium),
 * O+ is nitrogen's `[3]` (hydronium), C+ is boron's `[3]` and C- nitrogen's
 * `[3]`, B- is carbon's `[4]` (tetrafluoroborate), P- is sulfur's `[2, 4, 6]`
 * (hexafluorophosphate), Si+ is aluminium's `[3]` (a silylium ion) and Cl+
 * is sulfur's `[2, 4, 6]` (a chloronium ion).
 *
 * THE RULE IT REPLACED added the charge to every default valence, inverted
 * it for atoms left of carbon, and inverted it again for a carbocation. At a
 * charge of one that agreed with the new rule on boron, carbon, nitrogen and
 * oxygen, which is why the organic cases never noticed, and it disagreed
 * almost everywhere else: it gave SiH5+ where RDKit gives SiH3+, capped Cl+
 * at two bonds where RDKit allows it sulfur's four and six, and left an S+
 * with six bonds unreported while RDKit refused it. Each of those surfaced
 * as hydrogens gained or lost across a round trip, or as an export failing on
 * a drawing the editor called clean. There is no carbon, nitrogen or boron
 * special case any more: the isoelectronic reading gets all of them right on
 * its own.
 *
 * WHAT RDKIT STILL SPECIAL-CASES, and this ports:
 *
 *   - Phosphorus, sulfur, arsenic and selenium keep their own list under a
 *     large enough negative charge. See `canBeHypervalent`.
 *   - A BARE hydrogen — no bonds, radicals or pinned hydrogens. H+ and H-
 *     take no hydrogens, and any larger charge on one is refused outright as
 *     unreasonable. That one depends on the drawing, not the charge — the
 *     same H²⁻ with a bond is read as lithium like any other charged atom —
 *     so `atomValences` applies it, not this. RDKit's exception letting H-
 *     carry two bonds does not survive its own implicit check, which reads
 *     H- as helium and refuses the first bond; neither does it here.
 *   - An element with no default valence (the d- and f-blocks) never moves:
 *     it carries no list, charged or not. The same goes for a charge that
 *     lands on one, which is why Ca- (scandium's electron count) takes no
 *     hydrogens.
 *
 * Where a charge strips every electron (H+ and beyond, effective number zero
 * or less), RDKit takes no hydrogens and checks nothing; `[0]` agrees on the
 * hydrogens and still badges a bond to a bare proton.
 *
 * NOT PORTED: RDKit keeps a trailing `-1` on the alkali and alkaline-earth
 * lists (lithium's reads `[1, -1]`), meaning "anything above is fine", so it
 * sanitises Mg+ with three bonds or Al+ with five. The hydrogen count is zero
 * either way; chem-core badges the bonds, which is a warning on a drawing
 * RDKit would accept, not drift. Nor is the aromatic snap's list split: RDKit
 * snaps a hypervalent anion against the isoelectronic element's list and
 * counts hydrogens against its own, which differs only for one of those
 * anions in an aromatic ring carrying more than two and a half bond orders.
 */
function chargedValences(symbol: string, charge: number): readonly number[] {
  const element = requireElement(symbol);
  if (element.valences.length === 0 || charge === 0) return element.valences;

  const q = Math.round(charge);
  const effectiveZ = element.z - q;
  if (effectiveZ <= 0) return NO_ELECTRONS;
  if (canBeHypervalent(element.z, effectiveZ)) {
    return element.valences.map((valence) => valence + q);
  }
  return elementByZ(effectiveZ)?.valences ?? [];
}

/**
 * The atom's charged valence list: `chargedValences`, plus RDKit's refusal of
 * a bare hydrogen carrying a charge of two or more. `[-1]` is how that refusal
 * is said: no hydrogens, and over-valent even with nothing on the atom, so the
 * badge warns before the export fails.
 *
 * Bareness is read off the raw drawing, not `statedValence`: with nothing on
 * the atom there is no aromatic sum to resolve, and resolving one needs this
 * list.
 */
function atomValences(mol: Molecule, atomId: AtomId): readonly number[] {
  const atom = requireAtom(mol, atomId);
  if (
    atom.element === "H" &&
    Math.abs(Math.round(atom.charge)) >= 2 &&
    atom.radicalElectrons === 0 &&
    Math.max(0, atom.explicitHydrogenCount ?? 0) === 0 &&
    degree(mol, atomId) === 0
  ) {
    return UNREASONABLE_CHARGE;
  }
  return chargedValences(atom.element, atom.charge);
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

  const valences = atomValences(mol, atomId);
  if (valences.length === 0) return 0;

  const used = explicitValence(mol, atomId);
  for (const target of valences) {
    if (used <= target) return Math.max(0, Math.round(target - used));
  }
  // Over-valent: nothing left to fill. `valenceIssues` reports it separately.
  return 0;
}

/**
 * Resolves the half-integers an aromatic-flagged bond leaves in the raw sum.
 *
 * THE BUG THIS EXISTS FOR. Two aromatic bonds at a thiophene sulfur sum to 3.
 * Searching the valence list for the smallest entry at or above 3 skips
 * sulfur's 2 and lands on its 4, and a hydrogen appears that the Kekule form
 * of the same molecule does not have — C4H5S against C4H4S. Benzene hid it for
 * a long time: carbon has a single valence, so there is no wrong entry to
 * pick. Every multi-valence heteroatom in an aromatic ring had it.
 *
 * THE RULE IS RDKIT'S, from `Atom::calcExplicitValence`, and it is not "round
 * the sum". When the raw sum exceeds the element's lowest charge-adjusted
 * valence and the atom carries aromatic perception, the sum is snapped DOWN to
 * the highest permitted valence that does not exceed it: an aromatic ring
 * cannot be asked to host hydrogens the delocalisation already accounts for.
 * Thiophene's sulfur snaps 3 -> 2, furan's oxygen 3 -> 2, a naphthalene fusion
 * carbon 4.5 -> 4. Following RDKit rather than inventing a rounding rule is
 * the point: the valence table here was calibrated against RDKit precisely so
 * an import/export round-trip does not gain or lose hydrogens, and a private
 * rule would put the two back out of step.
 *
 * A sum at or below that lowest valence is left ALONE, half-integer or not.
 * That is what keeps tropylium, cyclopentadienide, the cyclopropenyl cation
 * and pyrylium reading exactly as they did — their charged centres sit on
 * their charge-adjusted maximum, `kekulize` resolves the resulting ambiguity
 * by outcome, and snapping them would break a working path to fix nothing.
 *
 * THE SLACK CLAMP is what keeps this from swallowing a real error. A flag can
 * inflate the sum by at most half a bond order over the Kekule structure it
 * stands for, and an aromatic atom has at most three ring bonds, so 1.5 is the
 * largest discrepancy perception can possibly introduce. A gap wider than that
 * is an atom with too many bonds drawn on it, not flag noise — a ring carbon
 * carrying two extra substituents sums to 5 against a valence of 4 — and
 * snapping it would hide the over-valence `valenceIssues` exists to report.
 * The clamp is RDKit's too; what is NOT ported is the integer rounding RDKit
 * finishes with, because the only inputs it would change are malformed ones
 * (a lone flagged acyclic bond, half of a ring assigned) where rounding a
 * half-integer up invents a bond order nobody drew.
 *
 * NOT EVERY ELEMENT CAN BE RESOLVED THIS WAY, and the residue is pyrrole's
 * problem, not a new one. Snapping down reads a heteroatom as a LONE-PAIR
 * DONOR — thiophene's sulfur, furan's oxygen — which is right in a five-ring
 * and wrong for the rarer element that takes a ring double bond instead. Tin
 * and lead carry `[2, 4]` like sulfur, and stannabenzene's Sn is pi-bonded, so
 * its flagged form snaps to 2 and reads one hydrogen short. Valence alone
 * cannot separate the two cases: the local picture is identical, exactly as it
 * is for pyrrole's nitrogen against pyridine's. The answer is the same as
 * pyrrole's — pin `explicitHydrogenCount`, which is what RDKit's `[nH]` and
 * `[snH]` carry — and the choice of which reading to default to is RDKit's,
 * whose table these valence lists are calibrated against.
 */
function resolveAromaticValence(
  mol: Molecule,
  atomId: AtomId,
  raw: number,
): number {
  const valences = atomValences(mol, atomId);
  // No default valences means no implicit hydrogens ever, so there is nothing
  // to snap to and nothing downstream that would read it.
  if (valences.length === 0) return raw;
  if (!hasAromaticPerception(mol, atomId)) return raw;

  const lowest = valences[0]!;
  if (raw <= lowest) return raw;

  let resolved = lowest;
  for (const target of valences) {
    if (target > raw) break;
    resolved = target;
  }
  return raw - resolved > MAX_AROMATIC_SLACK ? raw : resolved;
}

/**
 * Bond orders drawn, plus radical electrons, with aromatic half-integers
 * resolved — RDKit's `calcExplicitValence` rather than a bare sum. Identical
 * to `bondOrderSum` + radicals on the Kekule storage form, which carries no
 * flags for `resolveAromaticValence` to act on.
 */
export function explicitValence(mol: Molecule, atomId: AtomId): number {
  const raw = bondOrderSum(mol, atomId) + requireAtom(mol, atomId).radicalElectrons;
  return resolveAromaticValence(mol, atomId, raw);
}

/** Everything: drawn bonds, radicals, and implicit hydrogens. */
export function totalValence(mol: Molecule, atomId: AtomId): number {
  return explicitValence(mol, atomId) + implicitHydrogenCount(mol, atomId);
}

/**
 * Every valence this atom may take, charge applied — for a charged atom that
 * is the isoelectronic element's list, see `chargedValences` — ascending.
 * Empty for a metal, which carries none, and for a charge that lands on one.
 *
 * The LIST, not just its last entry, is what a caller reasoning about a
 * multi-valence element needs. Sulfur allows 2, 4 and 6 and picks whichever
 * one its bonding actually reaches: divalent in a thiol, hexavalent in a
 * sulfone. Collapsing that to `maxValence` and measuring room against 6 makes
 * a two-connected sulfur look like it has four bonds' worth of capacity going
 * spare, which is true of a sulfone and nonsense for a thiophene.
 */
export function chargeAdjustedValences(mol: Molecule, atomId: AtomId): number[] {
  return [...atomValences(mol, atomId)];
}

/**
 * The highest valence this atom could reach, charge included. Infinite where
 * there is no list to top out: a metal, or a charge that lands on one.
 */
export function maxValence(mol: Molecule, atomId: AtomId): number {
  const valences = atomValences(mol, atomId);
  return valences.length === 0 ? Infinity : valences[valences.length - 1]!;
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

/**
 * Drawn bonds, radicals AND a pinned hydrogen count: the valence the atom is
 * STATED to carry, which is the number over-valence has to be measured on.
 *
 * THE BUG THIS EXISTS FOR. `explicitValence` leaves a pinned count out, and
 * rightly — `implicitHydrogenCount` returns the pin verbatim, so it is not an
 * input there. But measuring over-valence on it alone meant a methylamine
 * nitrogen pinned to three hydrogens and left uncharged read as sound: one
 * drawn bond, three stated hydrogens, a valence of four on a neutral
 * nitrogen, and no error anywhere. RDKit counts those hydrogens
 * (`numExplicitHs`) and refuses the structure, so "Clean up" failed with
 * "Explicit valence for atom # 1 N, 4, is greater than permitted" on a
 * drawing the editor itself called clean.
 *
 * THE ORDER IS RDKIT'S. `calcExplicitValence` adds the explicit hydrogens
 * BEFORE the aromatic snap, not after. That is what keeps a flagged pyrrole's
 * `[nH]` legal: two aromatic bonds and the pinned hydrogen sum to 4, the snap
 * brings it to 3, and nitrogen allows 3. Adding the pin after the snap would
 * report every pyrrole, indole and imidazole an importer flagged.
 */
export function statedValence(mol: Molecule, atomId: AtomId): number {
  const atom = requireAtom(mol, atomId);
  const pinned = Math.max(0, atom.explicitHydrogenCount ?? 0);
  const raw = bondOrderSum(mol, atomId) + atom.radicalElectrons + pinned;
  return resolveAromaticValence(mol, atomId, raw);
}

/** On `statedValence`, so a pinned hydrogen count is counted. */
export function isOverValent(mol: Molecule, atomId: AtomId): boolean {
  const max = maxValence(mol, atomId);
  return max !== Infinity && statedValence(mol, atomId) > max;
}

export type ValenceIssueKind = "over-valent" | "negative-hydrogens";

/**
 * A valence problem, located.
 *
 * `atomId` is the ANCHOR — the atom a UI selects and centres on. `atomIds`
 * and `bondIds` are everything the problem concerns, anchor first, so an
 * overlay can mark the lot without re-deriving which bonds make an atom
 * over-valent. `message` is the sentence for a list or a tooltip; `label` is
 * the few words that fit beside the atom on the canvas.
 */
export interface ValenceIssue {
  readonly kind: ValenceIssueKind;
  readonly atomId: AtomId;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly label: string;
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
      const drawn = explicitValence(mol, atomId);
      const bonds = `${drawn} ${drawn === 1 ? "bond" : "bonds"}`;
      const max = maxValence(mol, atomId);
      const pinned = Math.max(0, atom.explicitHydrogenCount ?? 0);
      // Named only when it is part of the count. A stated count of zero adds
      // nothing, and "and 0 pinned hydrogens" would send the reader looking
      // for a cause that is not there.
      const hydrogens =
        pinned === 0 ? "" : ` and ${pinned} pinned ${pinned === 1 ? "hydrogen" : "hydrogens"}`;
      issues.push({
        kind: "over-valent",
        atomId,
        atomIds: [atomId],
        // Every bond at the atom: which one is surplus is the author's call,
        // and `issueFixes` offers to lower one only when there is no choice.
        bondIds: bondsAt(mol, atomId).map((bond) => bond.id),
        severity: "error",
        message: `${atom.element} has ${bonds}${hydrogens} but allows at most ${max}`,
        label:
          pinned === 0
            ? `${atom.element} has ${bonds}; max ${max}`
            : `${atom.element} has ${bonds} + ${pinned} H; max ${max}`,
      });
    }
    if (atom.explicitHydrogenCount !== undefined && atom.explicitHydrogenCount < 0) {
      issues.push({
        kind: "negative-hydrogens",
        atomId,
        atomIds: [atomId],
        bondIds: [],
        severity: "error",
        message: `${atom.element} has a negative hydrogen count`,
        label: `${atom.element} has ${atom.explicitHydrogenCount} H`,
      });
    }
  }
  return issues;
}

/**
 * An explicit hydrogen atom that is chemically an implicit one: natural
 * isotope, uncharged, not a radical, bonded to nothing but its one neighbour.
 *
 * It lives here, beside the implicit count it is interchangeable with, rather
 * than in cip.ts where it was first needed: symmetry.ts folds protium into a
 * hydrogen count and cip.ts now reads symmetry.ts, so leaving it in cip.ts
 * would close an import cycle between the two.
 */
export function isProtiumAtom(mol: Molecule, atomId: AtomId): boolean {
  const atom = getAtom(mol, atomId);
  if (atom === undefined || atom.element !== "H") return false;
  if (atom.isotope !== undefined && atom.isotope !== 1) return false;
  if (atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  if (implicitHydrogenCount(mol, atomId) !== 0) return false;
  return bondsAt(mol, atomId).length === 1;
}
