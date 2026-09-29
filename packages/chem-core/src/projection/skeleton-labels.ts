/**
 * An accepted skeleton on a planar panel: checked against the molecule at
 * resolve time, and turned into the panel's numbering and alpha/beta labels
 * at place time (decisions 163, 181, 182). Internal to the planar templates.
 *
 * ONLY WHILE ACCEPTED. A panel whose params hold no skeleton carries no
 * skeleton numbering and no alpha/beta; recognition is a suggestion the user
 * confirms, never something a panel does on its own.
 *
 * WHICH LIGANDS ARE LABELLED. At each core stereocentre in the layout's
 * coverage (the engine drops the rest), every ligand off the core that is
 * not a hydrogen gets a label, and the hydrogen gets one only when the centre
 * has nothing else off the core: 3β-OH (not also 3α-H), 5α-H, 8β-H, 10β for
 * the C19 methyl, 17β for a side chain, and both 17β-OH and 17α at
 * 17α-methyltestosterone's C17.
 */

import { requireAtom, bondsAt } from "../molecule.js";
import { acceptedSkeletonMisfit, type FaceLigand } from "../skeleton/table.js";
import { STEROID_SKELETON, steroidFaces, steroidNumbering } from "../skeleton/steroid.js";
import type { StereoConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import { implicitHydrogenCount } from "../valence.js";
import { projectionUnavailable } from "./frames.js";
import type { PlacedLayout } from "./template.js";
import type { FaceLabel, PlanarView, ProjectionUnavailable } from "./types.js";

/** An acceptance that fits: the core, and the numbering it applies. */
export interface PanelSkeleton {
  readonly core: readonly AtomId[];
  readonly locants: ReadonlyMap<AtomId, string>;
}

/**
 * The view's accepted skeleton against `mol`: none stored, one that fits, or
 * `skeleton-mismatch` naming the atoms that keep it from fitting. Topology
 * only, so it belongs in a template's `resolve`.
 */
export function resolvePanelSkeleton(
  mol: Molecule,
  view: PlanarView,
): { readonly kind: "none" } | { readonly kind: "accepted"; readonly skeleton: PanelSkeleton } | ProjectionUnavailable {
  const accepted = view.params.skeleton;
  if (accepted === undefined) return { kind: "none" };
  const misfit = acceptedSkeletonMisfit(mol, STEROID_SKELETON, accepted);
  if (misfit !== undefined) return projectionUnavailable("skeleton-mismatch", misfit);
  const core = Object.freeze([...accepted.core]);
  return { kind: "accepted", skeleton: Object.freeze({ core, locants: steroidNumbering(mol, core) }) };
}

/** Writes the skeleton's numbering and alpha/beta labels into `draft`. */
export function attachSkeletonLabels(
  mol: Molecule,
  config: StereoConfig,
  skeleton: PanelSkeleton,
  draft: PlacedLayout,
): void {
  for (const [atomId, locant] of skeleton.locants) draft.locants.set(atomId, locant);
  const faces = steroidFaces(mol, config, skeleton.core);
  const byAtom = new Map<AtomId, typeof faces>();
  for (const face of faces) byAtom.set(face.atomId, [...(byAtom.get(face.atomId) ?? []), face]);
  for (const [, list] of byAtom) {
    const heavy = list.filter((f) => !isHydrogen(mol, f.ligand));
    for (const face of heavy.length > 0 ? heavy : list) {
      const group = groupOf(mol, face.ligand);
      const label: FaceLabel = {
        atomId: face.atomId,
        locant: face.locant,
        ligand: face.ligand,
        face: face.face,
        ...(group === undefined ? {} : { group }),
      };
      draft.faceLabels.push(label);
    }
  }
}

function isHydrogen(mol: Molecule, ligand: FaceLigand): boolean {
  return ligand.kind === "implicitHydrogen" || requireAtom(mol, ligand.atomId).element === "H";
}

const HALOGENS = new Set(["F", "Cl", "Br", "I"]);

/**
 * "H", "OH", "SH" or a halogen when the ligand is exactly that — one atom off
 * the core, uncharged, no mass number — else undefined.
 */
function groupOf(mol: Molecule, ligand: FaceLigand): string | undefined {
  if (ligand.kind === "implicitHydrogen") return "H";
  const atom = requireAtom(mol, ligand.atomId);
  if (atom.charge !== 0 || atom.isotope !== undefined || bondsAt(mol, ligand.atomId).length !== 1) return undefined;
  if (atom.element === "H") return "H";
  if (HALOGENS.has(atom.element)) return atom.element;
  if ((atom.element === "O" || atom.element === "S") && implicitHydrogenCount(mol, ligand.atomId) === 1) {
    return `${atom.element}H`;
  }
  return undefined;
}
