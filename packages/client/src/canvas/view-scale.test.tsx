/**
 * The reference bond the canvas measures its view in (decision 107), and the
 * one part of the rotate handle that is sized with the drawing: the clearance
 * its orbit keeps from the selection halo.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import {
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  buildScene,
  representation,
} from "@starter/chem-render";

import { EMPTY_SELECTION } from "@/state";

import {
  ROTATE_HANDLE_GAP_PX,
  ROTATE_HANDLE_HALO_CLEARANCE_PX,
  ROTATE_HANDLE_RADIUS_PX,
  rotateHandleGeometry,
} from "./handles";
import { createSceneIndex } from "./metrics";
import { OverlayLayer } from "./OverlayLayer";
import {
  REFERENCE_BOND_PX,
  bondScale,
  displayZoom,
  referenceZoom,
} from "./view-scale";

describe("the reference bond", () => {
  it("is Screen's bond, so nothing a Screen document shows changes", () => {
    expect(REFERENCE_BOND_PX).toBe(SCREEN_STYLE.bondLengthPx);
    expect(bondScale(SCREEN_STYLE)).toBe(1);
    expect(displayZoom(2.5, SCREEN_STYLE)).toBe(2.5);
    expect(referenceZoom(SCREEN_STYLE)).toBe(1);
  });

  it("puts Publication's 24 px bond at 24/44 of it", () => {
    expect(bondScale(PUBLICATION_STYLE)).toBeCloseTo(24 / 44, 12);
    // The zoom that shows Screen's 44 px bond reads 100% in both styles.
    expect(referenceZoom(PUBLICATION_STYLE)).toBeCloseTo(44 / 24, 12);
    expect(displayZoom(referenceZoom(PUBLICATION_STYLE), PUBLICATION_STYLE)).toBeCloseTo(1, 12);
  });
});

describe("the rotate handle's orbit clears the halo it is drawn beside", () => {
  const MOL = benzene();
  const ATOMS = ["a1", "a2", "a3", "a4", "a5", "a6"];

  for (const style of [SCREEN_STYLE, PUBLICATION_STYLE]) {
    it(`by exactly the halo's radius at ${style.name}`, () => {
      const index = createSceneIndex(buildScene(MOL, style, representation("skeletal")), MOL);
      // No viewport: zoom 1, so the screen-px part is its px at face value.
      const geometry = rotateHandleGeometry(index, ATOMS)!;
      // Benzene's vertices are one bond from its centroid.
      const clearance =
        geometry.orbit - style.bondLengthPx - (ROTATE_HANDLE_GAP_PX + ROTATE_HANDLE_RADIUS_PX);
      expect(clearance).toBeCloseTo(ROTATE_HANDLE_HALO_CLEARANCE_PX * bondScale(style), 9);

      // And that is the ring the overlay draws round a bare vertex, so the
      // handle never sits inside a selection halo in either style.
      const { container } = render(
        <svg>
          <OverlayLayer
            index={index}
            selection={{ ...EMPTY_SELECTION, atomIds: ["a1"] }}
            hoveredAtomId={null}
            hoveredBondId={null}
          />
        </svg>,
      );
      const halo = container.querySelector('[data-overlay="selected-atom"]')!;
      expect(Number(halo.getAttribute("r"))).toBeCloseTo(clearance, 9);
    });
  }
});
