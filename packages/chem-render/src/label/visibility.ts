/**
 * Which atoms get a label at all, and whether that label carries hydrogens.
 *
 * The decision is separated from the composition of the label's text because
 * the two questions have different inputs and different consumers. "Does this
 * atom draw?" is asked by the bond-trimming pass (a bond that meets a bare
 * vertex is not trimmed), by hit-testing (a labelled atom has a much larger
 * pick target than a dot), and by the label pass itself. Answering it inside
 * the text composer would mean every one of those callers had to compose a
 * string it then threw away, and — worse — that two of them could reach
 * different answers by asking in slightly different ways.
 *
 * NO CHEMISTRY IS RE-DERIVED HERE. Hydrogen counts come from chem-core's
 * `implicitHydrogenCount` and nothing in this package is allowed to recount
 * them. Where this file needs to know a hydrogen exists it asks; where it
 * needs to know how many, it does not ask at all, because that is the
 * composer's business.
 */

import {
  bondsAt,
  degree,
  getAtom,
  implicitHydrogenCount,
  isCarbon,
  isHydrogen,
} from "@starter/chem-core";
import type { Atom, AtomId, Molecule } from "@starter/chem-core";

import type { StructuralRepresentation } from "../representation.js";

/**
 * Why an atom is drawn with a label, rather than just whether it is.
 *
 * The reason is what makes a failure legible: "the carbon labelled itself
 * because of `showCarbonLabels`" and "the carbon labelled itself because it
 * carries a charge" are the same boolean and completely different bugs. It is
 * also what a debug overlay and a future "why is this drawn?" inspector want,
 * and deriving it a second time from the same conditions is exactly the drift
 * this package avoids elsewhere.
 */
export type LabelReason =
  | "override"
  | "non-carbon"
  | "isolated"
  | "charge"
  | "radical"
  | "isotope"
  | "stereocentre"
  | "carbon-labels-flag";

/**
 * The atom's display override — "Ph", "Boc", "R" — or undefined.
 *
 * A whitespace-only label counts as absent. This is the single source of
 * truth for "is there an override", and both this file and the composer go
 * through it: if they disagreed, an atom labelled with a space would force a
 * label here and then compose nothing there, drawing an invisible atom with a
 * bond stopping short of it for no visible reason.
 *
 * The string is returned RAW, unstripped. What a chemist typed is what gets
 * set; trimming it would be this layer quietly editing the user's text.
 */
export function labelOverride(atom: Atom): string | undefined {
  const label = atom.label;
  if (label === undefined) return undefined;
  return label.trim() === "" ? undefined : label;
}

/**
 * The formal charge as it will be DRAWN: an integer, and 0 for anything that
 * is not a finite number.
 *
 * `Atom.charge` is a plain `number` and a mid-edit UI can put a NaN in it.
 * NaN survives every comparison silently and would reach the composer as
 * `String(NaN)`, setting a superscript "NaN" beside an oxygen.
 */
export function drawnCharge(atom: Atom): number {
  return Number.isFinite(atom.charge) ? Math.round(atom.charge) : 0;
}

/**
 * How many radical dots this atom draws.
 *
 * DELIBERATELY UNCLAMPED above. It would be tidy to cap the cluster at three
 * dots, but `radicalElectrons` feeds `implicitHydrogenCount`: four electrons
 * have already removed four hydrogens from the formula the user is reading, so
 * drawing three dots makes the picture disagree with the formula panel. A
 * silly-looking cluster is a drawing of what the model says; a truncated one
 * is a lie. The layout in `placement.ts` therefore handles arbitrary counts.
 */
export function radicalDotCount(atom: Atom): number {
  const electrons = atom.radicalElectrons;
  return Number.isFinite(electrons) && electrons > 0
    ? Math.round(electrons)
    : 0;
}

/**
 * True when this atom's implicit hydrogen has to be drawn to make a
 * stereochemical claim readable.
 *
 * A wedge or hash from a carbon says "this substituent is toward you / away
 * from you", and on a CH stereocentre the fourth substituent IS the implicit
 * hydrogen. Leaving it implicit there leaves the reader counting to four in
 * their head; every drawing package spells it out, and that is the one place
 * a skeletal drawing puts an H on a carbon.
 *
 * NARROW END ONLY. chem-core fixes the wedge convention as "narrow end at
 * `from`", so the stereocentre is the atom the wedge starts at; the atom at
 * the wide end is the substituent being pointed at and learns nothing about
 * its own configuration from the bond.
 *
 * "wavy" is excluded on purpose. A wavy bond states that the configuration is
 * UNSPECIFIED, so a hydrogen drawn to disambiguate it disambiguates nothing —
 * it just asserts a geometry the model is explicitly declining to assert.
 */
export function revealsStereoHydrogen(mol: Molecule, atomId: AtomId): boolean {
  // No hydrogen, nothing to reveal — a quaternary stereocentre is perfectly
  // legitimate and needs no label.
  if (getAtom(mol, atomId) === undefined) return false;
  if (implicitHydrogenCount(mol, atomId) === 0) return false;
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.from !== atomId) continue;
    if (bond.stereo === "wedge" || bond.stereo === "hash") return true;
  }
  return false;
}

/**
 * Why this atom is labelled, or undefined if it is a bare vertex.
 *
 * The order of the tests is the order of the rules, most specific first, and
 * it is fixed: an atom can satisfy several at once and the reason reported
 * should be the one a chemist would give. An abbreviation is an abbreviation
 * whatever else is true of it; a nitrogen is a nitrogen before it is a cation.
 *
 * Carbon is the interesting case, because a bare vertex IS the carbon
 * notation. It draws only where the vertex would be lying or ambiguous: a
 * lone atom (a vertex with no bonds is invisible), a charge or a radical or an
 * isotope (all decorations that need something to sit on), a stereocentre
 * whose hydrogen has to show, or an explicit request via the flags.
 *
 * `getAtom` rather than `requireAtom`: a scene is a view of a possibly
 * mid-edit molecule, and an id that no longer resolves is an ordinary UI race.
 */
export function atomLabelReason(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): LabelReason | undefined {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return undefined;

  if (labelOverride(atom) !== undefined) return "override";
  if (!isCarbon(atom.element)) return "non-carbon";
  if (degree(mol, atomId) === 0) return "isolated";

  const flags = representation.flags;
  if (flags.showCharges && drawnCharge(atom) !== 0) return "charge";
  // Ungated: there is no `showRadicals` flag, and there must not be one. A
  // radical that draws invisibly changes the formula the reader is shown
  // without changing the picture they are shown it beside.
  if (radicalDotCount(atom) > 0) return "radical";
  if (
    atom.isotope !== undefined &&
    Number.isFinite(atom.isotope) &&
    atom.isotope > 0
  ) {
    return "isotope";
  }
  if (flags.showStereoBonds && revealsStereoHydrogen(mol, atomId)) {
    return "stereocentre";
  }
  if (flags.showCarbonLabels) return "carbon-labels-flag";

  // A terminal methyl falls through to here, and so does a carbon with a
  // pinned `explicitHydrogenCount`: pinning the count says how many hydrogens
  // there are, not that they should be drawn.
  return undefined;
}

export function atomLabelVisible(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): boolean {
  return atomLabelReason(mol, atomId, representation) !== undefined;
}

/**
 * Whether this atom's label carries its hydrogens.
 *
 * An atom with no label has nowhere to put them, so this is false there by
 * construction. An atom with a display override is false too: the override
 * replaces the element symbol, and "PhH5" is nonsense — a phenyl group's
 * hydrogens are inside the abbreviation, not pending beside it. And hydrogen
 * itself never carries hydrogens, or an explicit H₂ molecule sets "HH".
 *
 * `flags.showImplicitHydrogens` INVERTS THE ANSWER, and getting the sense of
 * it right is the whole reason this function exists as a named seam.
 *
 * The flag means "promote hydrogens to their own DRAWN VERTICES" — it is what
 * separates the explicitH and lewis views from kekule, and
 * `representation.ts` says so: kekule has it OFF while its comment notes that
 * the hydrogens still ride along on the labels. So it is NOT "draw H on
 * labels"; reading it that way would leave ethanol's hydroxyl set as a bare
 * "O" under every skeletal view, which is not a drawing of ethanol, and every
 * existing test would stay green while it happened, because nothing else in
 * the package looks at a label's text.
 *
 * With the vertex pass landed (`modes/explicitH.ts`) it is the opposite: an
 * atom whose hydrogens have BECOME drawn atoms must stop printing them on its
 * label, or a fully-explicit methane reads "CH₄" with four hydrogens hanging
 * off it as well. This is the one place that can say so, and it is the only
 * condition that changed — every other view is untouched.
 *
 * `flags.showAtomIndices` is still not consulted here: atom indices are a
 * debugging overlay that belongs beside the label rather than inside its run.
 */
export function atomShowsHydrogens(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): boolean {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return false;
  if (!atomLabelVisible(mol, atomId, representation)) return false;
  if (labelOverride(atom) !== undefined) return false;
  if (isHydrogen(atom.element)) return false;
  // The vertex pass has them. See `drawsHydrogenVertices`, which is the same
  // predicate from the other side, and is what the explicitH mode iterates.
  if (drawsHydrogenVertices(mol, atomId, representation)) return false;
  return true;
}

/**
 * Whether this atom's implicit hydrogens are drawn as their own vertices,
 * fanned into the space its bonds leave.
 *
 * THE COMPLEMENT of `atomShowsHydrogens`, and deliberately a separate exported
 * predicate rather than a negation at the call site: `modes/explicitH.ts`
 * iterates it to decide which atoms sprout phantoms, and the label pass
 * consults it to decide which labels go quiet. If the two ever disagreed the
 * symptom would be hydrogens drawn twice or not at all, so there is one rule.
 *
 * A DISPLAY OVERRIDE SUPPRESSES THEM, for the reason the label does: "Ph" is
 * an abbreviation whose hydrogens are inside it, and fanning five of them off
 * the label would draw a phenyl group as a hypervalent atom. Hydrogen itself
 * sprouts nothing either, or an explicit H₂ grows a hydrogen off a hydrogen.
 */
export function drawsHydrogenVertices(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): boolean {
  if (!representation.flags.showImplicitHydrogens) return false;
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return false;
  if (labelOverride(atom) !== undefined) return false;
  if (isHydrogen(atom.element)) return false;
  return implicitHydrogenCount(mol, atomId) > 0;
}
