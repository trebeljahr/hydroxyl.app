/**
 * The fully-explicit view's phantom hydrogens.
 *
 * Hydrogens are IMPLICIT in chem-core and always will be — they are derived
 * from valence at query time and never stored as atoms, because the model that
 * stored them made every traversal, layout pass and export filter them back
 * out. So the fully-explicit view cannot ask the graph where its hydrogens
 * are; it has to DERIVE a position for each one, at render time, and throw the
 * result away again. That is this file, and nothing it produces ever reaches
 * chem-core.
 *
 * WHERE THEY GO: into the angular gaps the atom's real bonds leave, fanned by
 * chem-core's `fanDirections` — the generalisation of the same
 * `largestGapBisector` the drawing tool uses to decide where a new bond
 * sprouts. Asking the same question one way keeps a derived hydrogen from
 * landing somewhere the editor would refuse to put a bond.
 *
 * THE FAN IS COMPUTED IN MODEL SPACE, y-up, and converted once through
 * `modelToPx`. Doing it in scene px instead would mean re-deriving the gap
 * search inside `label/placement.ts`, whose header refuses to import a
 * chem-core vector helper at all — a second copy of the geometry, with its own
 * rounding, on a y-flipped axis. The shortened bond length is a RATIO on
 * `RenderStyle`, applied here in model units, so `bondLengthPx` is still
 * multiplied in exactly one function in the package.
 *
 * CROWDING IS REPORTED, NOT AVOIDED. A hydrogen fanned into the widest gap of
 * a crowded fused vertex can still land on a neighbour two bonds away, and
 * this pass does not move it: nudging would make the drawing disagree with the
 * coordinates the author drew, which is the same call `detectCollisions` makes
 * about every other overlap. `hydrogen-over-atom` is the finding.
 *
 * ITS OWN HOST IS THE ONE EXCEPTION, and it is not an exception to that rule.
 * The DIRECTION is the author's — it comes out of the gaps their bonds leave —
 * but the distance is this file's invention, and 0.66 of a bond length is not
 * far enough to clear a wide label: a carbon-13 sets its mass number as a
 * superscript to the west, and the hydrogen fanned west landed inside it, so
 * the stem trimmed to nothing and the "H" drew with no bond at all. So the
 * distance, and only the distance, is pushed out until the stem clears both
 * labels by `MIN_STEM_LINE_WIDTHS` line widths. Moving a mark out of the way
 * of the renderer's OWN glyphs is not the same act as moving it out of the way
 * of an atom the author placed.
 */

import {
  bondDirections,
  fanDirections,
  fromPolar,
  getAtom,
  implicitHydrogenCount,
  neighborIds,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import { drawsHydrogenVertices } from "../label/visibility.js";
import { placeAtomLabel, trimDistance } from "../label/placement.js";
import type { AtomLabelPlacement } from "../label/placement.js";
import type { ComposedLabel } from "../label/compose.js";
import type { StructuralRepresentation } from "../representation.js";
import type { ScenePoint } from "../scene/types.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";

/** One derived hydrogen: whose it is, which of that atom's fan it is, and
 *  where its glyph sits — all in scene px, y already flipped. */
export interface PhantomHydrogen {
  readonly hostAtomId: AtomId;
  /** Index within THIS host's own fan, never a scene-wide counter. */
  readonly index: number;
  readonly centre: ScenePoint;
  /** The "H" glyph's placement, so bond trimming and collision detection see
   *  the same box the drawing does. */
  readonly placement: AtomLabelPlacement;
}

/**
 * How much clear stem a derived hydrogen is guaranteed, in bond line widths.
 *
 * Two, not one. `scene/build.ts` passes `style.bondLineWidthPx` to `bondAxis`
 * as the length below which a bond draws nothing, so one line width is exactly
 * the threshold and floating-point noise decides; two is the shortest stem
 * that reads as a line rather than as a smudge between two glyphs.
 */
const MIN_STEM_LINE_WIDTHS = 2;

/** `atom:a2:h:0`. Derived from the host and the fan index, per the
 *  byte-determinism rule that a primitive id never comes from a counter. */
export function phantomHydrogenId(hostAtomId: AtomId, index: number): string {
  return `atom:${hostAtomId}:h:${index}`;
}

/**
 * The scene-px directions `atomId`'s derived hydrogens take — unit vectors,
 * y already flipped, empty when the view draws none.
 *
 * SPLIT OUT FROM THE POSITIONS because the host's own label placement needs
 * them and cannot wait for the positions: a lone pair must not claim the slot
 * a hydrogen is about to take (see `AtomLabelInput.derivedHydrogenDirections`),
 * while a hydrogen's DISTANCE depends on how far that finished placement's
 * glyphs reach. Directions first, then the label, then the positions — the
 * order is what keeps the two from being a cycle.
 *
 * The fan itself is still computed in model space, by chem-core, and converted
 * through `modelToPx`: a unit step along the angle is taken from the atom and
 * both ends go through the one conversion, so the flip happens exactly once
 * and this file still never negates a y.
 */
export function derivedHydrogenDirections(
  mol: Molecule,
  atomId: AtomId,
  style: RenderStyle,
  representation: StructuralRepresentation,
): ScenePoint[] {
  if (!drawsHydrogenVertices(mol, atomId, representation)) return [];
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return [];

  const centre = modelToPx(style, atom.pos);
  const count = implicitHydrogenCount(mol, atomId);
  return fanDirections(bondDirections(mol, atomId), count).map((angle) => {
    const step = fromPolar(angle, 1);
    const tip = modelToPx(style, {
      x: atom.pos.x + step.x,
      y: atom.pos.y + step.y,
    });
    const dx = tip.x - centre.x;
    const dy = tip.y - centre.y;
    // `Math.sqrt`, never `Math.hypot` — the same rule the placement pass
    // states in its header, for the same byte-determinism reason.
    const length = Math.sqrt(dx * dx + dy * dy);
    return { x: dx / length, y: dy / length };
  });
}

/**
 * Every phantom hydrogen the representation asks for, in the molecule's own
 * insertion order.
 *
 * Empty unless `showImplicitHydrogens` is on, which in practice means the
 * explicitH and lewis views — so the other two pay one boolean for it.
 *
 * `placements` IS REQUIRED, not optional with a fallback. Where a hydrogen
 * ends up depends on how far its host's label reaches, so a caller that could
 * omit the placements would get a different answer from the one that supplied
 * them — and `scene/build.ts` would then trim the stem against a label
 * `scene/collide.ts` had never seen. `atomLabelPlacements` builds the map both
 * of them pass.
 *
 * PURE AND NOT MEMOISED, exactly like `atomLabelPlacement`, which it is a
 * sibling of: a caller running it per pointer-move should cache on the
 * molecule instance rather than expect this to.
 */
export function phantomHydrogens(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
): PhantomHydrogen[] {
  if (!representation.flags.showImplicitHydrogens) return [];

  const out: PhantomHydrogen[] = [];
  for (const atomId of mol.atomIds) {
    const directions = derivedHydrogenDirections(mol, atomId, style, representation);
    if (directions.length === 0) continue;
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;

    const hostCentre = modelToPx(style, atom.pos);
    const hostPlacement = placements.get(atomId);
    // MODEL SPACE, then one conversion. The ratio is in bond lengths and
    // `modelToPx` does the only scaling and the only y-flip; the scale is
    // isotropic, so one measurement serves every direction.
    const ratioTip = modelToPx(style, {
      x: atom.pos.x + style.explicitHydrogenLengthRatio,
      y: atom.pos.y,
    });
    const baseDistance = Math.abs(ratioTip.x - hostCentre.x);

    directions.forEach((direction, index) => {
      const id = phantomHydrogenId(atomId, index);
      const back: ScenePoint = { x: -direction.x, y: -direction.y };
      const place = (centre: ScenePoint): AtomLabelPlacement =>
        placeAtomLabel({
          atomId: id,
          centre,
          // Its one neighbour is its host, which is what orients the glyph and
          // gives `freeDirection` something to work from.
          neighbourCentres: [hostCentre],
          label: hydrogenLabel(id),
          style,
        });

      let centre = along(hostCentre, direction, baseDistance);
      let placement = place(centre);

      // EXACTLY the two trims `bondAxis` will apply to the stem, asked of the
      // same placements through the same function, so the arithmetic below is
      // the stem's real length and not an estimate of it. A "H" carries no
      // dots and no hydrogens of its own, so its obstacles are a translation
      // of themselves and this reach does not change when the glyph moves.
      const hostReach = hostPlacement === undefined ? 0 : trimDistance(hostPlacement, direction);
      const hydrogenReach = trimDistance(placement, back);
      const clear =
        hostReach + hydrogenReach + MIN_STEM_LINE_WIDTHS * style.bondLineWidthPx;
      if (clear > baseDistance) {
        centre = along(hostCentre, direction, clear);
        placement = place(centre);
      }

      out.push({ hostAtomId: atomId, index, centre, placement });
    });
  }
  return out;
}

/** `from` plus `distance` along a unit direction. Scene px throughout — no
 *  scaling, no flip, nothing this file is not allowed to do. */
function along(from: ScenePoint, direction: ScenePoint, distance: number): ScenePoint {
  return {
    x: from.x + direction.x * distance,
    y: from.y + direction.y * distance,
  };
}

/**
 * The label a phantom hydrogen draws: a bare "H", and nothing else.
 *
 * Built here rather than through `composeAtomLabel`, which takes an atom id
 * that has to resolve in the molecule — and a phantom hydrogen deliberately
 * has no atom to resolve to. A derived hydrogen carries no isotope (the mass
 * number belongs to the atom it was derived FROM), no charge, no radical and
 * no lone pair of its own: every one of those is a property of the heavy atom
 * whose valence produced it, and drawing one on the H would attribute it to
 * the wrong centre.
 */
function hydrogenLabel(atomId: AtomId): ComposedLabel {
  return {
    atomId,
    element: "H",
    reason: "non-carbon",
    isotope: [],
    symbol: [{ text: "H" }],
    hydrogens: [],
    charge: [],
    hydrogenCount: 0,
    radicalDotCount: 0,
    lonePairCount: 0,
    chargeDetached: false,
  };
}

/**
 * The atoms a phantom hydrogen could plausibly collide with: its host's
 * neighbours and its host's neighbours' neighbours.
 *
 * Not used for drawing — `detectCollisions` walks every atom anyway — but
 * exported because it is the honest statement of what "crowded" means here:
 * a hydrogen fanned off a fused-ring vertex has nowhere to go but toward the
 * ring's other side.
 */
export function crowdingCandidates(
  mol: Molecule,
  hostAtomId: AtomId,
): readonly AtomId[] {
  const out = new Set<AtomId>();
  for (const neighbourId of neighborIds(mol, hostAtomId)) {
    out.add(neighbourId);
    for (const second of neighborIds(mol, neighbourId)) {
      if (second !== hostAtomId) out.add(second);
    }
  }
  return [...out];
}
