/**
 * How big a style's drawing is ON SCREEN, measured in bonds rather than in
 * scene px (decision 107).
 *
 * A scene is in px at its style's bond length: Screen draws a 44 px bond and
 * Publication a 24 px one. Everything the canvas sized in scene px was
 * therefore sized for ONE style. Switching to Publication shrank the molecule
 * to 24/44 of its size, left the halos and handles at Screen's size around
 * it, and kept the zoom readout unchanged while the picture changed.
 *
 * So the canvas measures the view in REFERENCE BONDS instead. A reference
 * bond is Screen's 44 px, which keeps every Screen number where it was:
 *
 *   - the chrome (halos, handles, badges, the ghost bond) is drawn at
 *     `bondScale(style)` times its Screen size, so it is the same fraction of
 *     a bond in every style;
 *   - a style switch rescales the viewport by the ratio of the two bond
 *     lengths, so every atom stays on the screen pixel it was on;
 *   - the zoom readout and Reset speak in `displayZoom`, so 100% means the
 *     same on-screen bond in every style.
 *
 * With all three in place, switching style changes the ink and nothing else.
 * The Publication canvas is then the exported figure at the zoom you were
 * already working at: the scene is the export's scene (see SceneLayer), and
 * nothing moves or resizes when you switch to it.
 *
 * `pxPerModelUnit` is the only way the length is read. This file multiplies
 * no model coordinate and flips nothing; `modelToPx` in chem-render is still
 * the single site that does.
 */

import { SCREEN_STYLE, pxPerModelUnit } from "@starter/chem-render";
import type { RenderStyle } from "@starter/chem-render";

/**
 * The on-screen bond length, at zoom 1, that the view calls 100%. Screen's
 * own bond, so nothing a Screen document shows changes.
 */
export const REFERENCE_BOND_PX = pxPerModelUnit(SCREEN_STYLE);

/** This style's bond as a multiple of the reference bond: 1 for Screen. */
export function bondScale(style: RenderStyle): number {
  return pxPerModelUnit(style) / REFERENCE_BOND_PX;
}

/**
 * The zoom a user reads: the on-screen bond over the reference bond. The
 * viewport's own `zoom` is in scene px, so it reads 183% at Publication for
 * the same picture Screen calls 100%.
 */
export function displayZoom(zoom: number, style: RenderStyle): number {
  return zoom * bondScale(style);
}

/** The viewport zoom that `displayZoom` reports as 100% for this style. */
export function referenceZoom(style: RenderStyle): number {
  return 1 / bondScale(style);
}
