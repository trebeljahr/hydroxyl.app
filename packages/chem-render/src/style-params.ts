/**
 * The editable figure style (decisions 223 and 237): a style's physical
 * vocabulary in the units a printed figure is specified in, and the one
 * function that turns an edited set of those back into a `RenderStyle`.
 *
 * WHY PRINT UNITS AND NOT PX. A journal states a line width in pt and a bond
 * length in mm; nobody can check a px value against an author guide. And a
 * px value is relative to the preset's px-per-bond, so the same number means
 * a different printed line in Screen (44 px bonds) and Publication (24 px).
 * The conversion is the export's own: one bond, `pxPerModelUnit` px, prints at
 * `print.bondLengthCm`.
 *
 * WHAT IS NOT HERE. Only the numbers a house style specifies are editable.
 * The proportions the label and annotation passes were measured against
 * (label padding, descriptor scales, the explicit-H ratios — decisions 54, 71
 * and 123 among them) stay with the preset, in px, and so scale with the bond.
 *
 * THE FONT IS AN ENUM. `fontFace` names one of the vendored faces and
 * `fontWeight` one of their weights (decision 250), never a free family
 * string: the measurer, the SVG's embedded WOFF and the PDF's embedded
 * TrueType exist only for those, and a face none of them knows would set
 * every label box wrong.
 */

import { pxPerModelUnit, withStyle } from "./style.js";
import type { RenderStyle } from "./style.js";
import { FONT_FACE_FAMILY, FONT_FACES, FONT_WEIGHTS, fontFaceOfFamily } from "./text/metrics.js";
import type { FontFace, FontWeight } from "./text/metrics.js";

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/** A colour as the style panel and the file write it: `#rrggbb`, lowercase. */
const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** The background value that means "no background rect" (transparent). */
export const NO_BACKGROUND = "none";

export interface FigureStyleParams {
  /** Printed length of one standard bond. */
  readonly bondLengthMm: number;
  /** Stroke of a bond line. */
  readonly lineWidthPt: number;
  /** Width of the wide end of a solid or hashed wedge. */
  readonly wedgeWidthPt: number;
  /** Centre-to-centre spacing of the bars of a hashed wedge. */
  readonly hashSpacingPt: number;
  /** Centre-to-centre separation of the lines of a double or triple bond. */
  readonly bondSpacingPt: number;
  /** Atom-label size. Subscripts and annotations keep their ratios to it. */
  readonly fontSizePt: number;
  /** The vendored face every label and annotation is set in. */
  readonly fontFace: FontFace;
  readonly fontWeight: FontWeight;
  /** Whitespace around the drawing in an exported figure. */
  readonly marginMm: number;
  readonly bondColor: string;
  readonly labelColor: string;
  /** `#rrggbb`, or `NO_BACKGROUND` for a transparent figure. */
  readonly background: string;
}

export type FigureStyleOverrides = Partial<FigureStyleParams>;

export type NumericStyleParam = {
  readonly [K in keyof FigureStyleParams]: FigureStyleParams[K] extends number ? K : never;
}[keyof FigureStyleParams];

export type FontStyleParam = "fontFace" | "fontWeight";

export type ColorStyleParam = Exclude<keyof FigureStyleParams, NumericStyleParam | FontStyleParam>;

/**
 * The accepted range of each number, inclusive. Wide on purpose: they refuse
 * nonsense (a zero line, a 2 m bond), not unusual taste. A file holding a
 * value outside them is refused rather than clamped (decision 110).
 */
export const STYLE_PARAM_RANGES: Readonly<
  Record<NumericStyleParam, { readonly min: number; readonly max: number }>
> = Object.freeze({
  bondLengthMm: { min: 1, max: 50 },
  lineWidthPt: { min: 0.05, max: 10 },
  wedgeWidthPt: { min: 0.1, max: 40 },
  hashSpacingPt: { min: 0.2, max: 40 },
  bondSpacingPt: { min: 0.1, max: 40 },
  fontSizePt: { min: 2, max: 72 },
  marginMm: { min: 0, max: 50 },
});

export const NUMERIC_STYLE_PARAMS: readonly NumericStyleParam[] = Object.freeze([
  "bondLengthMm",
  "lineWidthPt",
  "wedgeWidthPt",
  "hashSpacingPt",
  "bondSpacingPt",
  "fontSizePt",
  "marginMm",
]);

export const FONT_STYLE_PARAMS: readonly FontStyleParam[] = Object.freeze(["fontFace", "fontWeight"]);

/** The values each font param accepts, in the order a picker lists them. */
export const FONT_STYLE_PARAM_VALUES: Readonly<{
  readonly fontFace: readonly FontFace[];
  readonly fontWeight: readonly FontWeight[];
}> = Object.freeze({ fontFace: FONT_FACES, fontWeight: FONT_WEIGHTS });

export const COLOR_STYLE_PARAMS: readonly ColorStyleParam[] = Object.freeze([
  "bondColor",
  "labelColor",
  "background",
]);

/** Each numeric param's px field on `RenderStyle`, and whether it is a length in mm. */
const PX_FIELD: Readonly<
  Record<Exclude<NumericStyleParam, "bondLengthMm">, { readonly field: keyof RenderStyle; readonly mm: boolean }>
> = {
  lineWidthPt: { field: "bondLineWidthPx", mm: false },
  wedgeWidthPt: { field: "stereoWedgeWidthPx", mm: false },
  hashSpacingPt: { field: "stereoHashPeriodPx", mm: false },
  bondSpacingPt: { field: "doubleBondGapPx", mm: false },
  fontSizePt: { field: "fontSizePx", mm: false },
  marginMm: { field: "marginPx", mm: true },
};

/** Printed pt per scene px at a printed bond of `printedBondLengthCm`. */
function ptPerPx(pxPerBond: number, printedBondLengthCm: number): number {
  return (printedBondLengthCm * 10 * POINTS_PER_INCH) / MM_PER_INCH / pxPerBond;
}

function printedValue(px: number, mm: boolean, ptPx: number): number {
  const pt = px * ptPx;
  return mm ? (pt * MM_PER_INCH) / POINTS_PER_INCH : pt;
}

function pxValue(printed: number, mm: boolean, ptPx: number): number {
  const pt = mm ? (printed * POINTS_PER_INCH) / MM_PER_INCH : printed;
  // Rounded to 1e-9 px: a conversion through pt must not leave a value
  // 1e-16 off the one it stands for, or two documents holding the same pt
  // would serialise different coordinates. The SVG writes 2-3 decimals.
  return Math.round((pt / ptPx) * 1e9) / 1e9;
}

/** `style`'s editable numbers, in print units. */
export function styleParams(style: RenderStyle): FigureStyleParams {
  const ptPx = ptPerPx(pxPerModelUnit(style), style.print.bondLengthCm);
  const printed = (param: Exclude<NumericStyleParam, "bondLengthMm">): number => {
    const { field, mm } = PX_FIELD[param];
    return printedValue(style[field] as number, mm, ptPx);
  };
  return {
    bondLengthMm: style.print.bondLengthCm * 10,
    lineWidthPt: printed("lineWidthPt"),
    wedgeWidthPt: printed("wedgeWidthPt"),
    hashSpacingPt: printed("hashSpacingPt"),
    bondSpacingPt: printed("bondSpacingPt"),
    fontSizePt: printed("fontSizePt"),
    fontFace: fontFaceOfFamily(style.fontFamily),
    fontWeight: style.fontWeight,
    marginMm: printed("marginMm"),
    bondColor: style.colors.bond.toLowerCase(),
    labelColor: style.colors.label.toLowerCase(),
    background: style.colors.background?.toLowerCase() ?? NO_BACKGROUND,
  };
}

/**
 * Why `overrides` cannot be applied, one message per bad key; empty when it
 * can. The shared document schema and `applyStyleOverrides` both ask here,
 * so a file and an edit are held to one rule.
 */
export function styleOverrideIssues(
  overrides: Readonly<Record<string, unknown>>,
): readonly { readonly key: string; readonly message: string }[] {
  const issues: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if ((NUMERIC_STYLE_PARAMS as readonly string[]).includes(key)) {
      const range = STYLE_PARAM_RANGES[key as NumericStyleParam];
      if (typeof value !== "number" || !Number.isFinite(value) || value < range.min || value > range.max) {
        issues.push({ key, message: `${key} must be a number from ${range.min} to ${range.max}` });
      }
    } else if ((FONT_STYLE_PARAMS as readonly string[]).includes(key)) {
      const allowed: readonly string[] = FONT_STYLE_PARAM_VALUES[key as FontStyleParam];
      if (typeof value !== "string" || !allowed.includes(value)) {
        issues.push({ key, message: `${key} must be one of ${allowed.join(", ")}` });
      }
    } else if ((COLOR_STYLE_PARAMS as readonly string[]).includes(key)) {
      const ok =
        typeof value === "string" &&
        (HEX_COLOR.test(value) || (key === "background" && value === NO_BACKGROUND));
      if (!ok) {
        issues.push({
          key,
          message:
            key === "background"
              ? `background must be #rrggbb (lowercase) or "${NO_BACKGROUND}"`
              : `${key} must be #rrggbb (lowercase)`,
        });
      }
    } else {
      issues.push({ key, message: `${key} is not an editable style value` });
    }
  }
  return issues;
}

/**
 * `base` with `overrides` applied, as a frozen `RenderStyle`. An empty
 * override set returns `base` itself, so a document that edited nothing
 * draws with the preset object (identity is how the export dialog tells the
 * canvas style from another).
 *
 * A changed bond length keeps every other PRINTED size: the line stays 0.6 pt
 * on a longer bond, as it does in ChemDraw, so the px values are recomputed
 * against the new pt-per-px. The px per bond itself never moves — it is the
 * scene's resolution, and the canvas zoom is measured in it (decision 107).
 * Fields with no override and no scale change keep the preset's exact px,
 * so no float drift enters a value nobody edited.
 *
 * Throws on an override `styleOverrideIssues` refuses.
 */
export function applyStyleOverrides(
  base: RenderStyle,
  overrides: FigureStyleOverrides,
): RenderStyle {
  const keys = Object.keys(overrides).filter(
    (k) => overrides[k as keyof FigureStyleOverrides] !== undefined,
  );
  if (keys.length === 0) return base;
  const issues = styleOverrideIssues(
    Object.fromEntries(keys.map((k) => [k, overrides[k as keyof FigureStyleOverrides]])),
  );
  if (issues.length > 0) throw new RangeError(issues.map((i) => i.message).join("; "));

  const params = { ...styleParams(base), ...stripUndefined(overrides) };
  // Within float noise of the base's bond is the base's bond: 5.08 mm read
  // back and divided by ten need not be 0.508 to the last bit.
  const rescaled = Math.abs(params.bondLengthMm / 10 - base.print.bondLengthCm) > 1e-12;
  const printedBondLengthCm = rescaled ? params.bondLengthMm / 10 : base.print.bondLengthCm;
  const ptPx = ptPerPx(pxPerModelUnit(base), printedBondLengthCm);

  // Only the bond moves in the print setting: the text floor and the columns
  // are the journal's, and an edited bond does not change whose rules apply.
  const patch: Record<string, unknown> = rescaled
    ? { print: Object.freeze({ ...base.print, bondLengthCm: printedBondLengthCm }) }
    : {};
  for (const param of NUMERIC_STYLE_PARAMS) {
    if (param === "bondLengthMm") continue;
    if (overrides[param] === undefined && !rescaled) continue;
    const { field, mm } = PX_FIELD[param];
    patch[field] = pxValue(params[param], mm, ptPx);
  }
  // The face is written as its CSS stack only when it changes, so an edit
  // that leaves the face alone keeps the preset's exact family string.
  if (params.fontFace !== fontFaceOfFamily(base.fontFamily)) {
    patch["fontFamily"] = FONT_FACE_FAMILY[params.fontFace];
  }
  if (params.fontWeight !== base.fontWeight) patch["fontWeight"] = params.fontWeight;
  const background = params.background === NO_BACKGROUND ? undefined : params.background;
  patch["colors"] =
    background === undefined
      ? { bond: params.bondColor, label: params.labelColor }
      : { bond: params.bondColor, label: params.labelColor, background };
  // `withStyle` replaces `colors` wholesale, so leaving `background` out of
  // the object is how an edit to "none" removes the preset's white.
  return withStyle(base, patch as Partial<RenderStyle>);
}

function stripUndefined(overrides: FigureStyleOverrides): FigureStyleOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as FigureStyleOverrides;
}
