/**
 * Turning one implicit hydrogen into a real atom, so an arrow can reach it.
 *
 * HYDROGENS ARE DERIVED, NOT FORBIDDEN. The invariant in CLAUDE.md is that a
 * hydrogen is not STORED as an atom by default — valence derives it at query
 * time — not that a real H atom may never exist. The model already allows one
 * (a deuterium label, an H an importer drew, a hydride), and every consumer
 * reads a drawn protium the same as an implicit one. A curly arrow needs one:
 * protonation and deprotonation are the two commonest arrows in organic
 * chemistry, and an arrow cannot anchor to a hydrogen that is only a number.
 *
 * NEVER CALLED FROM mechanism.ts (decision 131). `applyArrows` anchors only to
 * atoms, bonds and lone pairs that exist; an op that edited the molecule
 * unasked would have no arrow to reverse, which breaks the reverse-arrows
 * oracle. The caller promotes first — in the same undoable transaction as the
 * arrow it is drawing — and whether the arrow tool offers to is the editor's
 * question, deferred to `scheme-editor-arrow-tools`.
 *
 * WHAT IT GUARANTEES (decision 152):
 *
 *   - THE HYDROGEN COUNT IS CONSERVED EXACTLY. One H moves from the implicit
 *     count to a drawn atom, nothing else changes. A pinned
 *     `explicitHydrogenCount` is decremented; a derived one is left to derive,
 *     unless adding the bond would make valence derive a different count, in
 *     which case the count is pinned to one less so the total still holds.
 *   - A CONFIGURATION IS NEVER CHANGED. The H goes where a sprout would, in
 *     the widest gap at the drawing's own bond length. At a stereocentre that
 *     can read as the ENANTIOMER: (R)-butan-2-ol drawn with its OH wedged
 *     straight up has its widest gap straight down, a plain H there reads
 *     (S), and a hash there sits opposite the wedge, which decision 42 calls
 *     ambiguous (measured, and pinned by a test). So at a specified centre the
 *     candidates are where a sprout would go and then every gap's bisector,
 *     widest first, each with a plain, a hashed and a wedged bond, and the
 *     first that keeps the parity against the same ligands wins. If none
 *     does, the promotion is refused.
 *   - IT REFUSES RATHER THAN GUESSES, with a named reason.
 */

import type { LigandRef } from "./cip.js";
import { addAtom, addBond } from "./molecule.js";
import { setBondStereo, updateAtom } from "./ops.js";
import { DEFAULT_BOND_LENGTH, bondDirections, defaultSproutPosition } from "./sprout.js";
import { ligandRefs, parityAgainst, stereoConfig, type CentreConfig } from "./stereo-config.js";
import { medianBondLength } from "./transform.js";
import type { AtomId, BondId, BondStereo, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import { add, angleOf, fromPolar, normalizeAnglePositive, type Vec2 } from "./vec.js";

export type PromoteHydrogenFailure =
  /** The atom is not in the molecule. */
  | "no-such-atom"
  /** The atom carries no implicit hydrogen to promote. */
  | "no-implicit-hydrogen"
  /** No position and mark for the new bond keeps the centre's configuration. */
  | "configuration-not-kept";

export type PromoteHydrogenResult =
  | {
      readonly ok: true;
      readonly molecule: Molecule;
      /** The new hydrogen atom. */
      readonly hydrogenId: AtomId;
      /** The bond from `atomId` to it; its narrow end, if marked, at `atomId`. */
      readonly bondId: BondId;
    }
  | { readonly ok: false; readonly reason: PromoteHydrogenFailure };

/** Marks tried on the new bond, plain first. */
const MARKS: readonly BondStereo[] = ["none", "hash", "wedge"];

/**
 * `mol` with one of `atomId`'s implicit hydrogens drawn as a real H atom.
 * Pure: `mol` is untouched, and the new atom and bond take the next ids from
 * its counter, atom first.
 */
export function promoteImplicitHydrogen(mol: Molecule, atomId: AtomId): PromoteHydrogenResult {
  if (!Object.hasOwn(mol.atoms, atomId)) return { ok: false, reason: "no-such-atom" };
  const atom = mol.atoms[atomId]!;
  const before = implicitHydrogenCount(mol, atomId);
  if (before < 1) return { ok: false, reason: "no-implicit-hydrogen" };

  const bondLength = medianBondLength(mol) ?? DEFAULT_BOND_LENGTH;
  const promoteAt = (pos: Vec2) => {
    const withAtom = addAtom(mol, { element: "H", pos });
    const withBond = addBond(withAtom.molecule, { from: atomId, to: withAtom.id });
    let next = withBond.molecule;
    if (atom.explicitHydrogenCount !== undefined) {
      next = updateAtom(next, atomId, { explicitHydrogenCount: atom.explicitHydrogenCount - 1 });
    } else if (implicitHydrogenCount(next, atomId) !== before - 1) {
      // The bond moved the atom onto a different valence; pin rather than
      // let a hydrogen appear or vanish.
      next = updateAtom(next, atomId, { explicitHydrogenCount: before - 1 });
    }
    return { molecule: next, hydrogenId: withAtom.id, bondId: withBond.id };
  };

  const centre = stereoConfig(mol).centres.find((c) => c.atomId === atomId);
  if (centre === undefined || centre.reading.kind !== "specified" || !centre.implicitHydrogen) {
    // No stated configuration to keep: a plain bond where a sprout would go.
    return { ok: true, ...promoteAt(defaultSproutPosition(mol, atomId, { bondLength })) };
  }
  for (const pos of candidatePositions(mol, atomId, bondLength)) {
    const promoted = promoteAt(pos);
    const kept = keepConfiguration(centre, promoted.molecule, promoted.hydrogenId, promoted.bondId);
    if (kept !== undefined) return { ok: true, ...promoted, molecule: kept };
  }
  return { ok: false, reason: "configuration-not-kept" };
}

/**
 * Where the hydrogen may go, best first: where a sprout would put it, then
 * the bisector of every gap between the atom's bonds, widest first, ties by
 * angle, so the same drawing always gives the same answer.
 */
function candidatePositions(mol: Molecule, atomId: AtomId, bondLength: number): Vec2[] {
  const origin = mol.atoms[atomId]!.pos;
  const angles = bondDirections(mol, atomId)
    .map((d) => normalizeAnglePositive(angleOf(d)))
    .sort((a, b) => a - b);
  const gaps = angles.map((start, i) => {
    const end = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    return { start, gap: end - start };
  });
  gaps.sort((p, q) => q.gap - p.gap || p.start - q.start);
  return [
    defaultSproutPosition(mol, atomId, { bondLength }),
    ...gaps.map(({ start, gap }) => add(origin, fromPolar(start + gap / 2, bondLength))),
  ];
}

/**
 * `next` with the mark on `bondId` that keeps `centre`'s parity against the
 * same four ligands — the implicit hydrogen now named by its atom — or
 * undefined when no mark does at this position.
 */
function keepConfiguration(
  centre: CentreConfig,
  next: Molecule,
  hydrogenId: AtomId,
  bondId: BondId,
): Molecule | undefined {
  if (centre.reading.kind !== "specified") return next;
  const order: LigandRef[] = ligandRefs(centre).map((ref) =>
    ref.kind === "implicitHydrogen" ? { kind: "atom", atomId: hydrogenId } : ref,
  );
  for (const mark of MARKS) {
    const candidate = mark === "none" ? next : setBondStereo(next, bondId, mark);
    const after = stereoConfig(candidate).centres.find((c) => c.atomId === centre.atomId);
    if (after !== undefined && parityAgainst(after, order) === centre.reading.parity) {
      return candidate;
    }
  }
  return undefined;
}
