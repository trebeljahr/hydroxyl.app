/**
 * Arrowheads — one module for every arrow a scheme draws.
 *
 * Two glyphs. The FULL head closes a double-barbed curly arrow and a forward
 * reaction arrow. The HALF head is a single barb on one side of the shaft: it
 * closes a fishhook (the one-electron curly arrow), and it is also each shaft
 * of an equilibrium arrow — geometrically the same glyph, which is why the
 * reaction-arrows task draws its half-barbs through this module rather than a
 * second copy that could drift from this one.
 *
 * THE SHAPE is ChemDraw's: a tip, two barbs, and a NOTCH on the axis short of
 * the barbs, so the back of the head is concave. The shaft stops at the notch,
 * inside the head, which hides the join whatever angle the shaft arrives at.
 *
 * SIZED IN LINE WIDTHS (decision 173). ChemDraw stores an arrowhead's length,
 * its notch and its half-width in hundredths of the line width, and a curly
 * arrow strokes at the bonds' own `bondLineWidthPx`, so a preset with heavier
 * lines gets proportionally larger heads the way ChemDraw's do, and no
 * RenderStyle field has to be kept in step with decision 26 by hand.
 *
 * Scene px throughout. `direction` is the direction of travel INTO the tip;
 * `side` is page-left or page-right of it, through the same `leftNormal` the
 * double bond uses — see curve.ts on why that, and not the y-up textbook
 * normal, is the page's left.
 */

import { leftNormal } from "../bond/geometry.js";
import type { ScenePoint } from "../scene/types.js";

/** A head's dimensions, each as a multiple of the stroke's line width. */
export interface ArrowheadProportions {
  /** Tip to the barbs, along the axis. */
  readonly length: number;
  /** Tip to the notch, along the axis. Shorter than `length`: the back is concave. */
  readonly notch: number;
  /** Axis to one barb. */
  readonly halfWidth: number;
}

/**
 * ChemDraw's curved-arrow tool default: `HeadSize` 800, `ArrowheadCenterSize`
 * 700, `ArrowheadWidth` 200, in hundredths of the line width (decision 173).
 * At Publication's 1 px line that is an 8 px head, 4.8 pt printed, 4 px across.
 */
export const CURLY_ARROWHEAD: ArrowheadProportions = Object.freeze({
  length: 8,
  notch: 7,
  halfWidth: 2,
});

/**
 * A dative bond's head (decision 226): smaller than a curly arrow's, since it
 * sits on a bond a few heads long rather than on a free-standing shaft. At
 * Publication's 1 px line it is 6 px long and 4 px across.
 */
export const DATIVE_ARROWHEAD: ArrowheadProportions = Object.freeze({
  length: 6,
  notch: 5,
  halfWidth: 2,
});

export type ArrowheadShape = "full" | "half";
/** Which side of the direction of travel a half head's one barb is on. */
export type ArrowheadSide = "left" | "right";

export interface Arrowhead {
  /** The polygon, tip first. Four points for a full head, three for a half. */
  readonly points: readonly ScenePoint[];
  readonly tip: ScenePoint;
  /** Unit, the direction of travel into the tip. */
  readonly direction: ScenePoint;
  /** Where the shaft should stop: on the axis, inside the head. */
  readonly notch: ScenePoint;
  /** Tip to barbs, px. */
  readonly length: number;
  /** Tip to notch, px. */
  readonly notchLength: number;
}

/** The head's lengths in px for a stroke `lineWidthPx` wide. */
export function arrowheadLengths(
  lineWidthPx: number,
  proportions: ArrowheadProportions,
): { readonly length: number; readonly notch: number; readonly halfWidth: number } {
  return {
    length: proportions.length * lineWidthPx,
    notch: proportions.notch * lineWidthPx,
    halfWidth: proportions.halfWidth * lineWidthPx,
  };
}

/**
 * The head with its tip at `tip`, travelling along the unit `direction`.
 *
 * `side` is read only for a half head. A full head is symmetric, so it has no
 * side to take.
 */
export function arrowhead(
  tip: ScenePoint,
  direction: ScenePoint,
  lineWidthPx: number,
  proportions: ArrowheadProportions,
  shape: ArrowheadShape,
  side: ArrowheadSide = "left",
): Arrowhead {
  const { length, notch, halfWidth } = arrowheadLengths(lineWidthPx, proportions);
  const left = leftNormal(direction);
  const back = (distance: number, across: number): ScenePoint => ({
    x: tip.x - direction.x * distance + left.x * across,
    y: tip.y - direction.y * distance + left.y * across,
  });
  const notchPoint = back(notch, 0);
  const leftBarb = back(length, halfWidth);
  const rightBarb = back(length, -halfWidth);
  const points =
    shape === "full"
      ? [tip, leftBarb, notchPoint, rightBarb]
      : [tip, side === "left" ? leftBarb : rightBarb, notchPoint];
  return { points, tip, direction, notch: notchPoint, length, notchLength: notch };
}
