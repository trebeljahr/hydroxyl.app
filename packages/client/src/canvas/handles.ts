/**
 * The rotate grab handle: where it is drawn, and what counts as grabbing it.
 *
 * ONE DEFINITION, TWO CONSUMERS. `OverlayLayer` draws the handle and the
 * interaction adapter hit-tests it, and if those two ever computed the
 * position separately the handle would be drawn in one place and grabbable in
 * another — a bug with no error and no obvious cause, since both halves look
 * correct in isolation.
 *
 * SCENE PX, like every other overlay mark, so the handle keeps its size
 * relative to the drawing rather than to the screen. That matches the
 * selection halos, which are documented as fixed in scene space for the same
 * reason, and it keeps the hit test free of the zoom.
 */

import type { AtomId } from "@starter/chem-core";
import type { ScenePoint } from "@starter/chem-render";

import type { SceneIndex } from "./metrics";

/** Grab radius and drawn radius, scene px. The grab is the generous one. */
export const ROTATE_HANDLE_RADIUS_PX = 5;
export const ROTATE_HANDLE_GRAB_PX = 11;

/**
 * Clearance between the outermost selected atom and the handle.
 *
 * Big enough that the handle never lands on top of a selection halo (13px at
 * the screen preset) and the two do not read as one mark.
 */
export const ROTATE_HANDLE_GAP_PX = 30;

/**
 * Where the handle sits for a given set of atoms, or `undefined` when there is
 * nothing to rotate.
 *
 * Directly above the selection's centroid — which is also the pivot — at a
 * distance that clears its furthest member. Above rather than beside because
 * the bottom-right of the canvas carries the zoom chrome and the left is where
 * a tool rail will land.
 */
export function rotateHandlePoint(
  index: SceneIndex,
  atomIds: readonly AtomId[],
): ScenePoint | undefined {
  if (atomIds.length === 0) return undefined;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const centres: ScenePoint[] = [];
  for (const id of atomIds) {
    const centre = index.atomCentre(id);
    if (centre === undefined) continue;
    if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) continue;
    centres.push(centre);
    sumX += centre.x;
    sumY += centre.y;
    count += 1;
  }
  if (count === 0) return undefined;

  const cx = sumX / count;
  const cy = sumY / count;
  let reach = 0;
  for (const centre of centres) {
    reach = Math.max(reach, Math.hypot(centre.x - cx, centre.y - cy));
  }
  // Scene px are y-DOWN, so "above" is a subtraction. This is not a second
  // y-flip: the scene arrived flipped from `modelToPx` and everything here
  // stays in that space.
  return { x: cx, y: cy - reach - ROTATE_HANDLE_GAP_PX };
}
