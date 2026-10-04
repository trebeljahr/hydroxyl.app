/**
 * An accepted skeleton on a planar panel: checked against the molecule at
 * resolve time, and turned into the panel's numbering and alpha/beta labels
 * at place time (decisions 163, 181, 182). Internal to the planar templates.
 *
 * ONLY WHILE ACCEPTED. A panel whose params hold no skeleton carries no
 * skeleton numbering and no alpha/beta; recognition is a suggestion the user
 * confirms, never something a panel does on its own.
 *
 * ONE CORE PER SPECIES (decisions 195, 220). A scheme numbers each of its
 * steroids, so the params hold a list. Two cores an edit has put in one
 * species (a bond drawn between them, a species join) cannot both be the
 * species' numbering, and the panel says so as `skeleton-mismatch` rather
 * than pick one.
 *
 * WHICH LIGANDS ARE LABELLED. At each core stereocentre in the layout's
 * coverage (the engine drops the rest), every ligand off the core that is
 * not a hydrogen gets a label, and the hydrogen gets one only when the centre
 * has nothing else off the core: 3β-OH (not also 3α-H), 5α-H, 8β-H, 10β for
 * the C19 methyl, 17β for a side chain, and both 17β-OH and 17α at
 * 17α-methyltestosterone's C17.
 */

import { requireAtom, bondsAt } from "../molecule.js";
import { compareIds } from "../selection.js";
import { acceptedSkeletonMisfit, type FaceLigand } from "../skeleton/table.js";
import { speciesIndexOf } from "../species.js";
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
 * The view's accepted skeletons against `mol`: none stored, every one fits
 * in a species of its own, or `skeleton-mismatch` naming the atoms that keep
 * them from it. Topology only, so it belongs in a template's `resolve`.
 */
export function resolvePanelSkeletons(
  mol: Molecule,
  view: PlanarView,
):
  | { readonly kind: "none" }
  | { readonly kind: "accepted"; readonly skeletons: readonly PanelSkeleton[] }
  | ProjectionUnavailable {
  const accepted = view.params.skeletons;
  if (accepted === undefined || accepted.length === 0) return { kind: "none" };
  const misfits = new Set<AtomId>();
  for (const skeleton of accepted) {
    for (const id of acceptedSkeletonMisfit(mol, STEROID_SKELETON, skeleton) ?? []) misfits.add(id);
  }
  if (misfits.size > 0) return projectionUnavailable("skeleton-mismatch", [...misfits].sort(compareIds));
  // Every core now fits, so it is connected and lies in exactly one species.
  const bySpecies = new Map<number, AtomId[][]>();
  for (const { core } of accepted) {
    const index = speciesIndexOf(mol, core[0]!)!;
    bySpecies.set(index, [...(bySpecies.get(index) ?? []), [...core]]);
  }
  const crowded = [...bySpecies.values()].filter((cores) => cores.length > 1).flat(2);
  if (crowded.length > 0) return projectionUnavailable("skeleton-mismatch", crowded.sort(compareIds));
  return {
    kind: "accepted",
    skeletons: Object.freeze(
      accepted.map((skeleton) => {
        const core = Object.freeze([...skeleton.core]);
        return Object.freeze({ core, locants: steroidNumbering(mol, core) });
      }),
    ),
  };
}

/** Writes each skeleton's numbering and alpha/beta labels into `draft`, in stored order. */
export function attachSkeletonLabels(
  mol: Molecule,
  config: StereoConfig,
  skeletons: readonly PanelSkeleton[],
  draft: PlacedLayout,
): void {
  for (const skeleton of skeletons) attachOneSkeleton(mol, config, skeleton, draft);
}

function attachOneSkeleton(mol: Molecule, config: StereoConfig, skeleton: PanelSkeleton, draft: PlacedLayout): void {
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
