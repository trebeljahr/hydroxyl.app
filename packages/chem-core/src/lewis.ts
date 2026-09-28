/**
 * Electron bookkeeping: how many lone pairs an atom carries.
 *
 * DERIVED, WITH A PER-ATOM OVERRIDE (decision 4) — the same arrangement the
 * hydrogens have, and for the same reason. A lone pair is implied by the
 * valence electrons, the formal charge and the bonding already in the model,
 * so storing one per atom would be a second copy of a number that is already
 * there, and the two would disagree the first time a bond order changed.
 *
 * A separate module from valence.ts because it answers a different question.
 * valence.ts is about how many BONDS an atom can take, and every consumer of
 * it — hydrogens, free valence, over-valence, formula, mass — is a chemistry
 * query the whole app depends on. Lone pairs are a DRAWING convention: only
 * the Lewis view reads them, nothing downstream of them affects the formula,
 * and keeping them out of valence.ts is what stops a rendering question from
 * acquiring a vote on the hydrogen count.
 *
 * No geometry here. Where the pairs go around a label is the renderer's
 * problem, and this file has no opinion about it.
 */

import { requireElement } from "./elements.js";
import { requireAtom } from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { outerElectronCount, totalValence } from "./valence.js";

/**
 * Why an atom's lone pairs cannot be counted.
 *
 * Shaped like `stereo.ts`'s undetermined arm on purpose: this package's
 * answer to "I cannot work this out" is a named reason, never a plausible
 * zero. A metal drawn with no lone pairs and a metal whose lone pairs nobody
 * can count look identical on the page, and only one of them is honest.
 */
export type LonePairReason =
  /** The element carries no default valences: a metal. The noble gases carry
   *  RDKit's `[0]` and are counted like any other main-group atom. */
  | "no-valence-data"
  /** More bonds and charge than the atom has electrons to spend. */
  | "over-subscribed";

export type LonePairCount =
  | { readonly kind: "counted"; readonly pairs: number; readonly unpaired: number }
  | { readonly kind: "unknown"; readonly reason: LonePairReason }
  /** The atom pins its own count — decision 4's per-atom override. */
  | { readonly kind: "pinned"; readonly pairs: number };

/**
 * The lone pairs on `atomId`, as a result rather than a number.
 *
 * THE ARITHMETIC: outer electrons, minus the formal charge, minus everything
 * spent on bonding and on unpaired electrons, over two.
 *
 *     pairs = (outer − charge − totalValence) / 2
 *
 * `totalValence` — not `bondOrderSum`, and not `explicitValence` either.
 * `bondOrderSum` is the RAW sum where an aromatic-flagged bond still weighs
 * 1.5, so an imported thiophene would come back with half a lone pair;
 * `explicitValence` resolves those halves but excludes the IMPLICIT
 * hydrogens, and a hydrogen is a bonding electron pair like any other, so
 * water's oxygen would read three pairs instead of two. `totalValence` is
 * bonds plus radicals plus implicit hydrogens, which is exactly the electron
 * budget spent.
 *
 * Each radical electron is charged once, by `totalValence`, and is reported
 * separately as `unpaired` — a nitroxide's oxygen has two pairs and one
 * unpaired electron, and a renderer draws the two differently.
 *
 * The five worked cases, all pinned by tests:
 *
 *   water's O        6 − 0 − 2 = 4 → 2 pairs
 *   ammonia's N      5 − 0 − 3 = 2 → 1 pair
 *   a carbonyl O     6 − 0 − 2 = 4 → 2 pairs
 *   a nitro N⁺       5 − 1 − 4 = 0 → 0 pairs
 *   a sulfone S      6 − 0 − 6 = 0 → 0 pairs
 *
 * The sulfone is the expanded-octet reading, which is what the model stores:
 * chem-core gives sulfur the valence list [2, 4, 6] and a sulfone really is
 * drawn with two S=O double bonds. The charge-separated reading — S²⁺ with
 * two pairs and two single bonds to O⁻ — is a different DRAWING, and a
 * chemist who wants it either draws it or pins it. That is what the override
 * is for.
 *
 * NEGATIVE IS NOT CLAMPED TO ZERO, it is reported. An atom with more bonds
 * than electrons is over-valent, `valenceIssues` says so separately, and a
 * quiet 0 here would draw a perfectly ordinary Lewis structure over a
 * structure that cannot exist.
 */
export function lonePairCount(mol: Molecule, atomId: AtomId): LonePairCount {
  const atom = requireAtom(mol, atomId);
  if (atom.lonePairs !== undefined) {
    return { kind: "pinned", pairs: Math.max(0, Math.round(atom.lonePairs)) };
  }

  const outer = outerElectronCount(atom.element);
  if (outer === undefined) return { kind: "unknown", reason: "no-valence-data" };

  const charge = Number.isFinite(atom.charge) ? Math.round(atom.charge) : 0;
  const unpaired = Math.max(0, Math.round(atom.radicalElectrons));
  const spare = outer - charge - totalValence(mol, atomId);
  if (spare < 0) return { kind: "unknown", reason: "over-subscribed" };

  // An ODD remainder is real and is left as an unpaired electron rather than
  // rounded into a pair. It happens where the model already says the atom
  // carries one — `totalValence` charges the radical electron, so a methyl
  // radical lands on exactly 0 — and where an importer handed us something
  // odd. Floor, and let the leftover show up in `unpaired`, because half a
  // pair drawn as a pair is a closed shell that is not there.
  return {
    kind: "counted",
    pairs: Math.floor(spare / 2),
    unpaired: unpaired + (spare % 2),
  };
}

/**
 * The count as a plain number, with anything uncountable reading 0.
 *
 * For a renderer, which has to draw something. It is deliberately the LOSSY
 * form and deliberately not the only one: a caller deciding whether the Lewis
 * view can be produced at all wants the reason, and `availability` in
 * chem-render asks `lonePairCount` for it.
 */
export function drawnLonePairs(mol: Molecule, atomId: AtomId): number {
  const result = lonePairCount(mol, atomId);
  return result.kind === "unknown" ? 0 : result.pairs;
}

/**
 * Whether every atom's lone pairs can be counted — the question the Lewis
 * view's availability turns on.
 *
 * Returns the offending atom ids rather than a boolean so the caller can name
 * them. An empty array means yes.
 */
export function atomsWithUncountableLonePairs(mol: Molecule): AtomId[] {
  const out: AtomId[] = [];
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (atom === undefined) continue;
    // An unknown element throws out of `requireElement`; that is a different
    // failure with its own availability reason, so it is left to propagate
    // only where the caller has already checked the symbols.
    requireElement(atom.element);
    if (lonePairCount(mol, atomId).kind === "unknown") out.push(atomId);
  }
  return out;
}
