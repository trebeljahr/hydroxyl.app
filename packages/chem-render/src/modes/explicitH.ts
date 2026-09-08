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
import { placeAtomLabel } from "../label/placement.js";
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

/** `atom:a2:h:0`. Derived from the host and the fan index, per the
 *  byte-determinism rule that a primitive id never comes from a counter. */
export function phantomHydrogenId(hostAtomId: AtomId, index: number): string {
  return `atom:${hostAtomId}:h:${index}`;
}

/**
 * Every phantom hydrogen the representation asks for, in the molecule's own
 * insertion order.
 *
 * Empty unless `showImplicitHydrogens` is on, which in practice means the
 * explicitH and lewis views — so the other two pay one boolean for it.
 *
 * PURE AND NOT MEMOISED, exactly like `atomLabelPlacement`, which it is a
 * sibling of: both `scene/build.ts` and `scene/collide.ts` call it, and a
 * caller running it per pointer-move should cache on the molecule instance
 * rather than expect this to.
 */
export function phantomHydrogens(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
): PhantomHydrogen[] {
  if (!representation.flags.showImplicitHydrogens) return [];

  const out: PhantomHydrogen[] = [];
  for (const atomId of mol.atomIds) {
    if (!drawsHydrogenVertices(mol, atomId, representation)) continue;
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;

    const count = implicitHydrogenCount(mol, atomId);
    const hostCentre = modelToPx(style, atom.pos);
    const angles = fanDirections(bondDirections(mol, atomId), count);

    angles.forEach((angle, index) => {
      // MODEL SPACE, then one conversion. `fromPolar` is chem-core's, the
      // ratio is in bond lengths, and `modelToPx` does the only scaling and
      // the only y-flip that happens to this point.
      const modelPos = {
        x: atom.pos.x + fromPolar(angle, style.explicitHydrogenLengthRatio).x,
        y: atom.pos.y + fromPolar(angle, style.explicitHydrogenLengthRatio).y,
      };
      const centre = modelToPx(style, modelPos);
      out.push({
        hostAtomId: atomId,
        index,
        centre,
        placement: placeAtomLabel({
          atomId: phantomHydrogenId(atomId, index),
          centre,
          // Its one neighbour is its host, which is what orients the glyph and
          // gives `freeDirection` something to work from.
          neighbourCentres: [hostCentre],
          label: hydrogenLabel(phantomHydrogenId(atomId, index)),
          style,
        }),
      });
    });
  }
  return out;
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
