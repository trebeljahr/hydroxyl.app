/**
 * Where the rotate handle goes, and when there is one at all.
 *
 * Pure geometry over a real benzene scene: the overlay draws from this and
 * the adapter hit-tests against it, so a wrong answer here is a handle drawn
 * somewhere unreachable or offered where it does nothing — both of which are
 * what manual notes 3 reported.
 */

import { describe, expect, it } from "vitest";

import { benzene, buildMolecule } from "@starter/chem-core";
import { SCREEN_STYLE, buildScene, representation } from "@starter/chem-render";

import { visibleBounds } from "@/state/viewport";
import type { Viewport } from "@/state/viewport";

import {
  ROTATE_HANDLE_GAP_PX,
  ROTATE_HANDLE_HALO_CLEARANCE_PX,
  ROTATE_HANDLE_RADIUS_PX,
  rotateHandleGeometry,
} from "./handles";
import { createSceneIndex } from "./metrics";

const MOL = benzene();
const INDEX = createSceneIndex(
  buildScene(MOL, SCREEN_STYLE, representation("skeletal")),
  MOL,
);
const RING = MOL.atomIds;
/** Benzene's vertices are one bond length from its centre. */
const REACH = SCREEN_STYLE.bondLengthPx;

function view(zoom: number, width: number, height: number): Viewport {
  return { pan: { x: 0, y: 0 }, zoom, size: { width, height } };
}

describe("rotateHandleGeometry — when there is a handle", () => {
  it("offers none for a single atom, which is its own centroid", () => {
    // Manual notes 3: "when selecting an atom right now there is a blue
    // bubble/dot above it … makes not a whole lot of sense". The rotation it
    // offered was the identity.
    expect(rotateHandleGeometry(INDEX, [])).toBeUndefined();
    expect(rotateHandleGeometry(INDEX, ["a1"])).toBeUndefined();
  });

  it("offers none for atoms stacked on one point", () => {
    const stacked = buildMolecule((b) => {
      b.atom("C", { x: 0, y: 0 });
      b.atom("O", { x: 0, y: 0 });
    });
    const index = createSceneIndex(
      buildScene(stacked, SCREEN_STYLE, representation("skeletal")),
      stacked,
    );
    expect(rotateHandleGeometry(index, stacked.atomIds)).toBeUndefined();
  });

  it("offers one for two atoms — a selected bond turns about its midpoint", () => {
    expect(rotateHandleGeometry(INDEX, ["a1", "a2"])).toBeDefined();
  });
});

describe("rotateHandleGeometry — where it goes", () => {
  it("sits straight above the centroid, clear of the outermost halo", () => {
    const geometry = rotateHandleGeometry(INDEX, RING)!;
    expect(geometry.pivot.x).toBeCloseTo(0, 6);
    expect(geometry.pivot.y).toBeCloseTo(0, 6);
    expect(geometry.bearing).toBeCloseTo(-Math.PI / 2, 12);
    expect(geometry.orbit).toBeCloseTo(
      REACH + ROTATE_HANDLE_HALO_CLEARANCE_PX + ROTATE_HANDLE_GAP_PX + ROTATE_HANDLE_RADIUS_PX,
      6,
    );
    // Scene px are y-down: above is negative.
    expect(geometry.handle.x).toBeCloseTo(0, 6);
    expect(geometry.handle.y).toBeCloseTo(-geometry.orbit, 6);
  });

  it("keeps its screen-px clearance as the view zooms in", () => {
    // The halo it clears is scene px and scales; the gap and the handle's
    // own radius are screen px and must not.
    const geometry = rotateHandleGeometry(INDEX, RING, view(4, 4000, 4000))!;
    const clearOfHaloScreenPx =
      (geometry.orbit - REACH - ROTATE_HANDLE_HALO_CLEARANCE_PX) * 4;
    expect(clearOfHaloScreenPx).toBeCloseTo(ROTATE_HANDLE_GAP_PX + ROTATE_HANDLE_RADIUS_PX, 6);
  });

  it("moves to a corner when the view is fitted too tight for 'above'", () => {
    // The shape a fresh document opens in: the ring fills the canvas with a
    // halo's width to spare, so straight up is off the top edge — the handle
    // that used to live there could be neither seen nor grabbed.
    const tight = view(4, 480, 464);
    const geometry = rotateHandleGeometry(INDEX, RING, tight)!;
    expect(geometry.bearing).toBeCloseTo(-Math.PI / 4, 12);

    const visible = visibleBounds(tight);
    const inset = ROTATE_HANDLE_RADIUS_PX / 4;
    expect(geometry.handle.x + inset).toBeLessThanOrEqual(visible.max.x);
    expect(geometry.handle.y - inset).toBeGreaterThanOrEqual(visible.min.y);
  });

  it("stays above when nowhere fits, rather than guessing", () => {
    const tiny = view(4, 100, 100);
    expect(rotateHandleGeometry(INDEX, RING, tiny)!.bearing).toBeCloseTo(-Math.PI / 2, 12);
  });
});
