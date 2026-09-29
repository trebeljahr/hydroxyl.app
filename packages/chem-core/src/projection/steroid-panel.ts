/**
 * The planar frame's steroid template: the author's drawing turned into the
 * standard steroid orientation, beta toward the viewer, every centre marked
 * by the placement policy, and the ring stereocentres labelled alpha or beta
 * (decision 182). Internal; `project` reads its draft back.
 *
 * ONLY ONCE ACCEPTED (decision 163). The panel needs the core the user
 * accepted in `PlanarParams.skeleton`; without one it is
 * `unavailable: skeleton-not-accepted`, and with one that no longer fits,
 * `skeleton-mismatch` naming the atoms.
 *
 * IT GENERATES NO COORDINATES (decision 164 keeps that to Mills). The whole
 * drawing is moved by ONE rigid motion: the least-squares fit of its core onto
 * the table's standard orientation (rings A to D left to right), reflected
 * when that fits better — the same molecule seen from the other side, since
 * the marks are written afterwards from the configuration — and then the
 * panel's own rotation and mirror. So a steroid drawn upside down, or drawn
 * as seen from below, comes out in the standard orientation, and one drawn
 * with distorted rings keeps its distortion.
 *
 * BETA IS A WEDGE BY READ-BACK, NOT BY RULE. The author's centre marks are
 * dropped and every centre gets one mark by the policy (marks.ts, decision
 * 178), exchanged until it reads the configuration. In the standard
 * orientation the reference plane faces the viewer with its beta side, so a
 * beta substituent comes out a bold wedge and an alpha one a hash, and a
 * ring-fusion centre shows its hydrogen: 5α-H hashed, 8β-H wedged. Nothing
 * here asks which way anything points on the page.
 */

import { standardOrientation } from "../skeleton/table.js";
import { STEROID_SKELETON } from "../skeleton/steroid.js";
import { readConfig } from "../stereo-config.js";
import type { AtomId } from "../types.js";
import type { Vec2 } from "../vec.js";
import { projectionUnavailable } from "./frames.js";
import { writeCentreMarks } from "./marks.js";
import { rigidMotion } from "./mills.js";
import {
  correctDoubleBonds,
  pageMotion,
  placeSourceBonds,
  resolvePlanar,
  setDepthFromMarks,
  WEDGE_HASH,
} from "./planar.js";
import { attachSkeletonLabels, type PanelSkeleton } from "./skeleton-labels.js";
import {
  draftLayoutAccess,
  emptyPlacedLayout,
  placeLayoutAtom,
  placementOfLayout,
  projectionBondLength,
  type ProjectionTemplateImplementation,
} from "./template.js";
import type { PlanarView } from "./types.js";

export const planarSteroidTemplate: ProjectionTemplateImplementation<PlanarView, PanelSkeleton> = {
  resolve(mol, view) {
    const planar = resolvePlanar(mol, view);
    if (planar.kind !== "available") return planar;
    const labels = planar.skeleton.labels;
    if (labels === undefined) return projectionUnavailable("skeleton-not-accepted");
    return { kind: "available", skeleton: labels };
  },
  place(mol, config, view, skeleton, toPlace, reach) {
    const b = projectionBondLength(mol);
    const drawnCore = skeleton.core.map((id) => mol.atoms[id]!.pos);
    const standard = standardOrientation(STEROID_SKELETON).map((p) => ({ x: p.x * b, y: p.y * b }));
    // The standard shape centred where the drawn core is, so the panel turns
    // the drawing in place.
    const shift = centroidShift(standard, drawnCore);
    const toStandard = rigidMotion(
      drawnCore,
      standard.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })),
    );
    const oriented = new Map<AtomId, Vec2>();
    for (const atomId of mol.atomIds) {
      const atom = mol.atoms[atomId];
      if (atom !== undefined) oriented.set(atomId, toStandard(atom.pos));
    }
    const move = pageMotion([...oriented.values()], view.params.rotationDeg, view.params.mirror);

    const draft = emptyPlacedLayout(WEDGE_HASH, b);
    for (const [atomId, pos] of oriented) placeLayoutAtom(draft, atomId, move(pos));
    placeSourceBonds(mol, draft);
    writeCentreMarks(mol, config, draft, toPlace.centres);
    const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), WEDGE_HASH, {
      centres: [],
      doubleBonds: reach.doubleBonds,
    });
    if (read.kind === "read") correctDoubleBonds(mol, config, toPlace, read.config, draft);
    setDepthFromMarks(draft);
    attachSkeletonLabels(mol, config, skeleton, draft);
    return draft;
  },
};

function centroidShift(from: readonly Vec2[], to: readonly Vec2[]): Vec2 {
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (const p of from) {
    fx += p.x;
    fy += p.y;
  }
  for (const p of to) {
    tx += p.x;
    ty += p.y;
  }
  return { x: (tx - fx) / to.length, y: (ty - fy) / to.length };
}
