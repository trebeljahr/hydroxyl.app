/**
 * The rotate grab handle: where it is drawn, and what counts as grabbing it.
 *
 * ONE DEFINITION, TWO CONSUMERS. `OverlayLayer` draws the handle and the
 * interaction adapter hit-tests it, and if those two ever computed the
 * position separately the handle would be drawn in one place and grabbable in
 * another — a bug with no error and no obvious cause, since both halves look
 * correct in isolation.
 *
 * A SCREEN-SIZED CONTROL IN A SCENE-SIZED WORLD. The handle is UI, not part
 * of the drawing, so its radius, its grab reach and its clearance are screen
 * px and stay put as the view zooms. It started out in scene px, like the
 * selection halos, and at the zoom a fresh document opens at — a fitted
 * benzene sits near 500% — that made it a 77px disc parked 145px above the
 * molecule, which is off the top of the canvas: the one selection a user is
 * most likely to want to turn got a handle nobody could see or reach. Only
 * the orbit's inner part is scene px, because what it has to clear — the
 * selected atoms and their halos — is.
 *
 * WHERE IT GOES: on a circle about the selection's centroid (the pivot a
 * rotation turns about), at the first of a fixed list of bearings where the
 * whole handle is on screen. Straight up when that fits, which is the common
 * case; a diagonal when the view is fitted tight, since a fit leaves its
 * corners empty; the other sides after that. The list is fixed so the handle
 * does not wander between equally good spots as the view pans.
 */

import type { AtomId } from "@starter/chem-core";
import type { ScenePoint } from "@starter/chem-render";

import { visibleBounds } from "@/state/viewport";
import type { Viewport } from "@/state/viewport";

import type { SceneIndex } from "./metrics";

/**
 * Drawn radius and grab radius, SCREEN px. The grab is the generous one.
 *
 * 8 rather than the 5 the handle started at, because it now carries a
 * rotate-arrow glyph (manual notes 3: a bare blue ring above a selection said
 * nothing about what it was for) and an arrow inside a 5px circle is a speck.
 * The grab keeps a 4px margin over the ink.
 */
export const ROTATE_HANDLE_RADIUS_PX = 8;
export const ROTATE_HANDLE_GRAB_PX = 12;

/**
 * SCENE px the orbit clears the outermost selected atom by: the selection
 * halo's radius around an unlabelled atom (9 + 4 in OverlayLayer). Scene px
 * because the halo is — it grows with the zoom, and a screen-sized clearance
 * would let the halo swallow the handle as the user zooms in.
 */
export const ROTATE_HANDLE_HALO_CLEARANCE_PX = 13;

/** SCREEN px of clear canvas between that halo and the handle's ink. */
export const ROTATE_HANDLE_GAP_PX = 10;

/** SCREEN px the whole handle keeps from the canvas edge to count as visible. */
const EDGE_INSET_PX = 4;

/**
 * Below this spread, in scene px, the selection has nothing to turn.
 *
 * Rotating about the centroid moves each atom along a circle whose radius is
 * its distance from that centroid. A single atom IS its own centroid, so the
 * rotation is the identity — and a handle that offers it is a control that
 * does nothing, which is exactly the "what is this blue dot for" report that
 * prompted this rule. A thousandth of a pixel rather than zero so two atoms
 * stacked by a merge that has not happened yet count as one position.
 */
const MIN_ROTATABLE_REACH_PX = 1e-3;

const UP = -Math.PI / 2;
const QUARTER = Math.PI / 4;

/**
 * Candidate bearings, most preferred first, SCENE radians (y-down, so up is
 * -pi/2). Up first because "above" is where every drawing program puts a
 * rotate handle; the two upper diagonals next because a tight fit leaves the
 * corners empty; then the sides; the bottom last, since that is where the
 * status bar and the eye's next line of text are.
 */
const BEARINGS: readonly number[] = [
  UP,
  UP + QUARTER,
  UP - QUARTER,
  0,
  Math.PI,
  Math.PI / 2 - QUARTER,
  Math.PI / 2 + QUARTER,
  Math.PI / 2,
];

/** Where the handle is, and what it turns about. Scene px throughout. */
export interface RotateHandleGeometry {
  /** The handle's centre at rest. */
  readonly handle: ScenePoint;
  /**
   * The centroid of the atoms it turns — the same point the machine rotates
   * about, reached through the index instead of the molecule.
   */
  readonly pivot: ScenePoint;
  /** Pivot-to-handle distance: the circle the handle travels while dragged. */
  readonly orbit: number;
  /** The direction from pivot to handle at rest, scene radians (y-down). */
  readonly bearing: number;
}

/**
 * The handle's geometry for a given set of atoms, or `undefined` when there is
 * nothing to rotate — fewer than two atoms, none the index can place, or all
 * of them on one point.
 *
 * `viewport` decides the zoom (for the screen-px parts) and which bearings
 * are on screen. Without one — a test, a caller with no view — the zoom is 1
 * and the handle goes straight up.
 */
export function rotateHandleGeometry(
  index: SceneIndex,
  atomIds: readonly AtomId[],
  viewport?: Viewport,
): RotateHandleGeometry | undefined {
  if (atomIds.length < 2) return undefined;

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

  const pivot = { x: sumX / count, y: sumY / count };
  let reach = 0;
  for (const centre of centres) {
    reach = Math.max(reach, Math.hypot(centre.x - pivot.x, centre.y - pivot.y));
  }
  if (reach < MIN_ROTATABLE_REACH_PX) return undefined;

  const zoom =
    viewport !== undefined && Number.isFinite(viewport.zoom) && viewport.zoom > 0
      ? viewport.zoom
      : 1;
  const orbit =
    reach +
    ROTATE_HANDLE_HALO_CLEARANCE_PX +
    (ROTATE_HANDLE_GAP_PX + ROTATE_HANDLE_RADIUS_PX) / zoom;

  // Scene px are y-DOWN, so "up" is a negative sine. This is not a second
  // y-flip: the scene arrived flipped from `modelToPx` and everything here
  // stays in that space.
  const at = (bearing: number): ScenePoint => ({
    x: pivot.x + orbit * Math.cos(bearing),
    y: pivot.y + orbit * Math.sin(bearing),
  });

  let bearing = UP;
  if (viewport !== undefined) {
    const visible = visibleBounds(viewport);
    const inset = (ROTATE_HANDLE_RADIUS_PX + EDGE_INSET_PX) / zoom;
    const onScreen = (p: ScenePoint): boolean =>
      p.x - inset >= visible.min.x &&
      p.x + inset <= visible.max.x &&
      p.y - inset >= visible.min.y &&
      p.y + inset <= visible.max.y;
    // Nowhere fits when the selection is bigger than the view; up it is, and
    // the user pans or zooms out to reach it, as they would for the atoms.
    bearing = BEARINGS.find((candidate) => onScreen(at(candidate))) ?? UP;
  }

  return { handle: at(bearing), pivot, orbit, bearing };
}
