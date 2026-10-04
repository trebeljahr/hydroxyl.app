/**
 * The planar frame's steroid template: the author's drawing turned into the
 * standard steroid orientation, beta toward the viewer, every centre marked
 * by the placement policy, and the ring stereocentres labelled alpha or beta
 * (decision 182). Internal; `project` reads its draft back.
 *
 * ONLY ONCE ACCEPTED (decision 163). The panel needs the cores the user
 * accepted in `PlanarParams.skeletons`, one per species (decision 195);
 * without one it is `unavailable: skeleton-not-accepted`, and with one that
 * no longer fits, `skeleton-mismatch` naming the atoms.
 *
 * IT GENERATES NO COORDINATES (decision 164 keeps that to Mills). Each
 * species holding an accepted core is moved by ONE rigid motion of its own
 * (decision 220): the least-squares fit of its core onto the table's
 * standard orientation (rings A to D left to right), in place about the
 * core's centroid, reflected when that fits better — the same molecule seen
 * from the other side, since the marks are written afterwards from the
 * configuration. A species holding no core (a reagent beside the steroid)
 * keeps its drawn positions. Then the panel's own rotation turns the whole
 * drawing. So a steroid drawn upside down, or drawn as seen from below, comes
 * out in the standard orientation, one drawn with distorted rings keeps its
 * distortion, and a scheme's two steroids drawn at different angles both
 * come out standard without the scheme being turned end over end.
 *
 * NEVER MIRRORED (decision 187). A mirrored panel would show the molecule
 * from its alpha face, rings A to D right to left and every beta ligand
 * hashed beside a "β" label, which is the opposite of what this panel is
 * for; `mirror: true` is `unavailable: mirror-not-drawn`. Turning it is fine:
 * beta stays toward the viewer.
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
import { speciesIndexOf } from "../species.js";
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

export const planarSteroidTemplate: ProjectionTemplateImplementation<PlanarView, readonly PanelSkeleton[]> = {
  resolve(mol, view) {
    const planar = resolvePlanar(mol, view);
    if (planar.kind !== "available") return planar;
    const labels = planar.skeleton.labels;
    if (labels === undefined) return projectionUnavailable("skeleton-not-accepted");
    return { kind: "available", skeleton: labels };
  },
  refuseParams(view) {
    return view.params.mirror ? projectionUnavailable("mirror-not-drawn") : undefined;
  },
  place(mol, config, view, skeletons, toPlace, reach) {
    const b = projectionBondLength(mol);
    const standard = standardOrientation(STEROID_SKELETON).map((p) => ({ x: p.x * b, y: p.y * b }));
    // One motion per species holding a core: `resolve` saw to it that no
    // species holds two.
    const toStandard = new Map<number, (p: Vec2) => Vec2>();
    for (const { core } of skeletons) {
      const drawnCore = core.map((id) => mol.atoms[id]!.pos);
      // The standard shape centred where the drawn core is, so the panel
      // turns each steroid in place.
      const shift = centroidShift(standard, drawnCore);
      toStandard.set(
        speciesIndexOf(mol, core[0]!)!,
        rigidMotion(
          drawnCore,
          standard.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })),
        ),
      );
    }
    const oriented = new Map<AtomId, Vec2>();
    for (const atomId of mol.atomIds) {
      const atom = mol.atoms[atomId];
      if (atom === undefined) continue;
      const motion = toStandard.get(speciesIndexOf(mol, atomId)!);
      oriented.set(atomId, motion === undefined ? atom.pos : motion(atom.pos));
    }
    // Never mirrored: `refuseParams` turned a mirrored view away.
    const move = pageMotion([...oriented.values()], view.params.rotationDeg, false);

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
    attachSkeletonLabels(mol, config, skeletons, draft);
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
