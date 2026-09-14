/**
 * Physical size: how big a figure prints.
 *
 * ── A FIXED BOND LENGTH; THE COLUMN WIDTH IS A MAXIMUM (decision 20) ─────
 *
 * One bond prints at `PRINTED_BOND_LENGTH_CM` whatever the figure holds, so
 * a one-panel benzene and a six-panel scheme in the same paper draw their
 * bonds and labels at the same size. The figure is therefore only as wide as
 * its content: its NATURAL width is its viewBox width in style px times
 * `printedCmPerPx(style)`.
 *
 * The chosen journal width (8.25 cm single column, 17.8 cm double, or a
 * custom one) is a MAXIMUM. A figure at or below it prints at its natural
 * size, narrower than the column rather than stretched to it. A figure wider
 * than it is scaled down uniformly until it fits the column exactly, and the
 * scale factor is REPORTED, so the export dialog can say so — a bond that
 * silently prints at 72 % of the house length is exactly the mismatch between
 * figures this rule exists to prevent.
 *
 * The first implementation made the chosen width exact, which made the bond
 * length and the label size a function of how many panels a figure had.
 *
 * ── NO COORDINATE IS MULTIPLIED HERE ─────────────────────────────────────
 *
 * The figure stays in style px, and `modelToPx` stays the only function that
 * scales geometry. The physical mapping reaches a file in exactly two places:
 * an SVG's `width`/`height` attributes against its viewBox, and a raster's
 * pixel size. The bond length and font size this module reports are READ-OUTS
 * of that mapping; they are never fed back into a style.
 *
 * ── LABELS SHRINK WITH THE FIGURE (decision 51) ──────────────────────────
 *
 * Scaling to fit shrinks the labels by the same factor: a Publication figure
 * at 58 % prints 10 pt labels at 5.8 pt. That stays allowed — a TOC graphic
 * or an SI figure may be small on purpose, and some journals accept smaller
 * text — but the size reports when its printed labels fall below
 * `MIN_PRINTED_LABEL_PT`, and the narrowest column that would bring them back
 * up to it, so the export dialog can warn with something to act on.
 *
 * The bond read-out measures the DRAWING (`figure.drawnBondLength`), not the
 * model unit: the house length is guaranteed for one model unit, and a
 * structure is only at the house length if its bonds are one unit long.
 * Importers normalise to that, but a report that assumed it would state
 * 5.08 mm for any drawing at all.
 */

import { pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";
import type { Figure } from "./compose.js";

export const CM_PER_INCH = 2.54;
const POINTS_PER_INCH = 72;

/**
 * The printed length of one standard bond: 0.508 cm, i.e. 0.2 in or 14.4 pt.
 *
 * Source: the ACS 1996 document setting shipped with ChemDraw ("ACS
 * Document 1996"), which ACS journals ask authors to draw structures with.
 * It is the one number every figure in a manuscript should share, which is
 * why it is a constant here and not a property of a preset: the screen and
 * publication styles differ in px per bond, and dividing by that is what
 * makes both print the same bond.
 */
export const PRINTED_BOND_LENGTH_CM = 0.508;

/**
 * The two widths nearly every chemistry journal specifies (ACS: 3.25 in and
 * 7 in, i.e. 8.25 cm and 17.8 cm). Maximums, not targets — see above.
 */
export const JOURNAL_WIDTHS_CM = Object.freeze({
  single: 8.25,
  double: 17.8,
});

/**
 * The smallest printed atom-label size the export dialog accepts without a
 * warning (decision 51). Source: the ACS author guidelines (checked on ACS
 * Catalysis's, 2026-09-14) ask for text in artwork "no smaller than 8 pt".
 * The same page's Appendix 2 allows 4.5 pt in the final published format and
 * Elsevier asks 7 pt; the house style is ACS (decisions 20 and 26), so its
 * stricter number is the one warned at. A warning, never a refusal.
 */
export const MIN_PRINTED_LABEL_PT = 8;

export const RASTER_DPI_CHOICES = Object.freeze([300, 600] as const);

/**
 * Centimetres per style px at the house bond length: one bond, which is
 * `pxPerModelUnit(style)` px in the scene, prints at `PRINTED_BOND_LENGTH_CM`.
 * Derived from the style ACTUALLY used for the export, so a screen-preset
 * figure (44 px bonds) and a publication-preset one (24 px) both print a
 * 0.508 cm bond.
 */
export function printedCmPerPx(style: RenderStyle): number {
  return PRINTED_BOND_LENGTH_CM / pxPerModelUnit(style);
}

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
  /** The printed size, after any scaling to fit. */
  readonly widthCm: number;
  readonly heightCm: number;
  /** The size at the house bond length, before any scaling. */
  readonly naturalWidthCm: number;
  readonly naturalHeightCm: number;
  /** The column width the figure had to fit. */
  readonly maxWidthCm: number;
  /**
   * Printed size over natural size: exactly 1 when the figure fits, below 1
   * when it was scaled down to the column. Never above 1 — a small figure is
   * not enlarged.
   */
  readonly scale: number;
  /** `scale < 1`, spelled out for the caller that has to say so. */
  readonly scaled: boolean;
  /** Present only when a dpi was given. */
  readonly widthPx?: number;
  readonly heightPx?: number;
  /**
   * The figure's median drawn bond, as it will print. 5.08 mm for a structure
   * at the standard bond that was not scaled to fit. A drawing whose bonds are
   * not one model unit long prints them at their own length, and this says
   * so rather than repeating the house constant.
   */
  readonly bondLengthMm: number;
  /** The label font, as it will print: after any scaling to fit. */
  readonly fontSizePt: number;
  /** The label font at the house bond length, before any scaling. */
  readonly naturalFontSizePt: number;
  /** `fontSizePt` is below `MIN_PRINTED_LABEL_PT` (decision 51). */
  readonly labelsBelowMinimum: boolean;
  /**
   * The narrowest maximum width at which the labels still print at
   * `MIN_PRINTED_LABEL_PT`: below it, scaling to fit takes them under. Null
   * when the style's labels are under the minimum even unscaled, since no
   * column width can fix that — only a style with larger labels can.
   */
  readonly minWidthCmForMinLabel: number | null;
}

/**
 * Relative slack when comparing the natural width with the column. The
 * natural width is a product of floating-point numbers, and a figure whose
 * content lands on the column width to the last bit must not read as
 * "scaled to 99 %".
 */
const FIT_TOLERANCE = 1e-9;

function ptFromCm(cm: number): number {
  return (cm / CM_PER_INCH) * POINTS_PER_INCH;
}

export function physicalFigureSize(
  figure: Figure,
  maxWidthCm: number,
  dpi?: number,
): PhysicalFigureSize {
  if (!(maxWidthCm > 0) || !Number.isFinite(maxWidthCm)) {
    throw new RangeError(
      `physicalFigureSize: maximum width must be a positive length, got ${maxWidthCm}`,
    );
  }
  const { width, height } = figure.bounds;
  const naturalCmPerPx = printedCmPerPx(figure.style);
  const naturalWidthCm = width * naturalCmPerPx;
  const naturalHeightCm = height * naturalCmPerPx;

  const fits = naturalWidthCm <= maxWidthCm * (1 + FIT_TOLERANCE);
  const scale = fits ? 1 : maxWidthCm / naturalWidthCm;
  // The column width itself when scaled, not `naturalWidthCm * scale`: that
  // product can miss 8.25 in the last bit, and the attribute has to say
  // exactly the width the user chose.
  const widthCm = fits ? naturalWidthCm : maxWidthCm;
  const cmPerPx = naturalCmPerPx * scale;
  const heightCm = height * cmPerPx;
  const naturalFontSizePt = ptFromCm(figure.style.fontSizePx * naturalCmPerPx);
  const fontSizePt = ptFromCm(figure.style.fontSizePx * cmPerPx);
  // Same slack as the fit test, the other way round: a figure scaled to
  // exactly the minimum must not warn over the last bit of a product.
  const naturalReachesMinimum = naturalFontSizePt >= MIN_PRINTED_LABEL_PT * (1 - FIT_TOLERANCE);

  const base = {
    widthCm,
    heightCm,
    naturalWidthCm,
    naturalHeightCm,
    maxWidthCm,
    scale,
    scaled: !fits,
    bondLengthMm: pxPerModelUnit(figure.style) * figure.drawnBondLength * cmPerPx * 10,
    fontSizePt,
    naturalFontSizePt,
    labelsBelowMinimum: fontSizePt < MIN_PRINTED_LABEL_PT * (1 - FIT_TOLERANCE),
    // Labels scale linearly with the width, so the width that prints them at
    // the minimum is the natural width times minimum over natural size. The
    // natural size is at or above the minimum here, so this never exceeds the
    // natural width.
    minWidthCmForMinLabel: naturalReachesMinimum
      ? Math.min(naturalWidthCm, (naturalWidthCm * MIN_PRINTED_LABEL_PT) / naturalFontSizePt)
      : null,
  };
  if (dpi === undefined) return base;
  const widthPx = Math.max(1, pixelsFor(widthCm, dpi));
  // From the pixel width and the aspect ratio, not from rounding the height
  // in centimetres separately: two independent roundings can disagree on the
  // aspect by a pixel, and the rasteriser would then stretch.
  const heightPx = Math.max(1, Math.round((widthPx * height) / width));
  return { ...base, widthPx, heightPx };
}
