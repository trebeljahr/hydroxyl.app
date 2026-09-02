/**
 * The inscribed circle: a perceived aromatic ring drawn as delocalisation
 * rather than as alternating orders.
 *
 * KEKULE STAYS THE STORAGE FORM. Nothing here writes back to the molecule and
 * nothing here calls `kekulize`. Circle mode is a render-time SUBSTITUTION:
 * the ring's bond orders are still 1, 2, 1, 2, 1, 2 in the model, and the
 * scene simply draws one line per ring bond plus one circle. That is what
 * makes the toggle a display flag rather than an edit, and what lets one
 * figure show the same molecule both ways in two panels.
 *
 * THE RADIUS COMES FROM THE APOTHEM, not from a vertex distance, and it is the
 * MINIMUM apothem over the ring's edges. That is the only measure that
 * guarantees the circle cannot cross a ring bond: drag one vertex across the
 * ring and the nearest EDGE can be much closer to the centroid than the
 * nearest VERTEX is, so a circumradius fraction draws the circle straight
 * through a bond. `aromaticRings` is purely topological and position-blind —
 * it will hand this pass a ring whose drawn geometry is nonsense — so the
 * geometry floor below, and the report `detectCollisions` makes of it, are the
 * only guard there is.
 *
 * SCENE PX ONLY. The caller converts the ring's atom positions through
 * `modelToPx` and hands the points in, exactly as `scene/build.ts` does for
 * placement.ts. Computing an apothem in model units and multiplying by a bond
 * length would plant the second model-to-px scale that this package's layering
 * exists to prevent. chem-core's `distanceToSegment` is declined for the same
 * kind of reason: it bottoms out in `Math.hypot`, and this number lands in a
 * committed golden.
 */

import type { AtomId } from "@starter/chem-core";

import type { ScenePoint } from "../scene/types.js";

export interface InscribedCircle {
  readonly centre: ScenePoint;
  readonly radius: number;
}

/**
 * The circle for a ring whose atoms are at `ringPoints`, in walk order.
 *
 * `undefined` when the ring is degenerate — fewer than three atoms, or an
 * apothem so small the circle would be barely thicker than the strokes around
 * it. Drawing that is worse than not drawing it, and nudging the atoms apart
 * is forbidden; the caller reports it instead.
 */
export function inscribedCircle(
  ringPoints: readonly ScenePoint[],
  ratio: number,
  floorPx: number,
): InscribedCircle | undefined {
  if (ringPoints.length < 3) return undefined;

  let cx = 0;
  let cy = 0;
  for (const p of ringPoints) {
    cx += p.x;
    cy += p.y;
  }
  const centre: ScenePoint = {
    x: cx / ringPoints.length,
    y: cy / ringPoints.length,
  };

  let apothem = Infinity;
  for (let i = 0; i < ringPoints.length; i++) {
    const a = ringPoints[i]!;
    const b = ringPoints[(i + 1) % ringPoints.length]!;
    const d = distanceToSegment(centre, a, b);
    if (d < apothem) apothem = d;
  }

  const radius = ratio * apothem;
  if (!(radius >= floorPx)) return undefined;
  return { centre, radius };
}

/**
 * Point-to-segment distance, local rather than borrowed from chem-core.
 *
 * `Math.sqrt` is correctly rounded by IEEE-754; `Math.hypot`, which chem-core's
 * `distance` uses, is left implementation-approximated by ECMAScript. Same
 * reasoning as the header of label/placement.ts, and it matters more here
 * because this number becomes a radius in a committed SVG.
 */
function distanceToSegment(p: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The primitive id for a ring's circle.
 *
 * A ring has no id in chem-core — it is an INDEX into `rings(mol)`, which is
 * literally the iteration counter the byte-determinism contract forbids as an
 * id source, and which is not even stable across an edit that adds a ring. The
 * ring's ATOM SET is: SSSR rings are determined by their atom sets, and the
 * set survives a drag untouched.
 *
 * `atomIds` must already be ordered by index in `mol.atomIds`. NEVER sort them
 * lexicographically: benzene's bonds are b7..b12 and "b10" sorts before "b7".
 */
export function aromaticCircleId(atomIds: readonly AtomId[]): string {
  return `ring:${atomIds.join("+")}:aromaticCircle`;
}
