/**
 * Physical size: what a journal's "single column" means for a figure.
 *
 * A journal specifies a figure as a printed width plus a resolution, never as
 * a pixel count. So the export takes a width in centimetres and, for a raster,
 * a dpi, and DERIVES everything else from them and from the figure's own
 * aspect ratio.
 *
 * NO COORDINATE IS MULTIPLIED HERE. The figure stays in style px; an SVG's
 * `width="8.25cm"` against its viewBox is the one uniform scale, applied by
 * whatever renders the file. The bond length and font size this module
 * reports are READ-OUTS of that mapping, so a user choosing a width can see
 * what it does to the chemistry — they are never fed back into a style.
 */

import { pxPerModelUnit } from "../style.js";
import type { Figure } from "./compose.js";

export const CM_PER_INCH = 2.54;
const POINTS_PER_INCH = 72;

/**
 * The two widths nearly every chemistry journal specifies (ACS: 3.25 in and
 * 7 in, i.e. 8.25 cm and 17.8 cm).
 */
export const JOURNAL_WIDTHS_CM = Object.freeze({
  single: 8.25,
  double: 17.8,
});

export const RASTER_DPI_CHOICES = Object.freeze([300, 600] as const);

/**
 * Pixels for a physical length at a resolution, rounded to the nearest whole
 * pixel. 8.25 cm at 300 dpi is 974.4 px, so 974.
 */
export function pixelsFor(lengthCm: number, dpi: number): number {
  return Math.round((lengthCm / CM_PER_INCH) * dpi);
}

/** PNG's pHYs unit is pixels per metre. 300 dpi is 11811. */
export function pixelsPerMetre(dpi: number): number {
  return Math.round((dpi / CM_PER_INCH) * 100);
}

export interface PhysicalFigureSize {
  readonly widthCm: number;
  readonly heightCm: number;
  /** Present only when a dpi was given. */
  readonly widthPx?: number;
  readonly heightPx?: number;
  /** One model bond, as it will print. */
  readonly bondLengthMm: number;
  /** The label font, as it will print. */
  readonly fontSizePt: number;
}

export function physicalFigureSize(
  figure: Figure,
  widthCm: number,
  dpi?: number,
): PhysicalFigureSize {
  if (!(widthCm > 0) || !Number.isFinite(widthCm)) {
    throw new RangeError(`physicalFigureSize: width must be a positive length, got ${widthCm}`);
  }
  const { width, height } = figure.bounds;
  const cmPerPx = widthCm / width;
  const heightCm = height * cmPerPx;
  const base = {
    widthCm,
    heightCm,
    bondLengthMm: pxPerModelUnit(figure.style) * cmPerPx * 10,
    fontSizePt: ((figure.style.fontSizePx * cmPerPx) / CM_PER_INCH) * POINTS_PER_INCH,
  };
  if (dpi === undefined) return base;
  const widthPx = pixelsFor(widthCm, dpi);
  // From the pixel width and the aspect ratio, not from rounding the height
  // in centimetres separately: two independent roundings can disagree on the
  // aspect by a pixel, and the rasteriser would then stretch.
  const heightPx = Math.max(1, Math.round((widthPx * height) / width));
  return { ...base, widthPx, heightPx };
}
