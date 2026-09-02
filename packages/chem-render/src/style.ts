/**
 * Render styles: everything about how a molecule looks that is not chemistry.
 *
 * A style is the whole of the drawing's physical vocabulary — how long a bond
 * is, how thick a line is, what a label is set in — bundled so a figure can be
 * re-rendered in a different house style by swapping one object rather than
 * threading a dozen numbers through every call.
 *
 * THE SCALE LIVES HERE AND NOWHERE ELSE. chem-core positions are y-up and in
 * abstract bond-length units: 1.0 is one standard bond, and nothing in the
 * model knows what a pixel is. `bondLengthPx` is the single number that gives
 * those units a size, and `modelToPx` below is the single function that
 * applies it and flips y for SVG. Every other layer — scene building, bounds,
 * serialisation, the editor viewport — consumes coordinates that have already
 * been through it.
 */

import type { Vec2 } from "@starter/chem-core";

import type { ScenePoint } from "./scene/types.js";

export interface RenderColors {
  readonly bond: string;
  readonly label: string;
  /** undefined = transparent; the SVG omits the background rect entirely. */
  readonly background?: string;
}

export interface RenderStyle {
  readonly name: string;
  /** px per 1.0 chem-core model unit (one standard bond). Sole model->px scale. */
  readonly bondLengthPx: number;
  readonly bondLineWidthPx: number;
  /** Centre-to-centre separation of the two lines of a double bond, px. */
  readonly doubleBondGapPx: number;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  /** Multiplier applied to fontSizePx for subscripts (H2O's 2). */
  readonly subscriptScale: number;
  /** Clear space kept around an atom label before a bond may be drawn, px. */
  readonly labelPaddingPx: number;
  /** Whitespace added around the scene's primitive extents for the viewBox, px. */
  readonly marginPx: number;
  /**
   * Placeholder vertex dot radius. Labels are a later task; until then a dot is
   * the only way to see where an atom is. Set to 0 to suppress.
   */
  readonly atomDotRadiusPx: number;
  readonly colors: RenderColors;
  /** Decimal places emitted for every coordinate. Fixed so output is byte-deterministic. */
  readonly coordinatePrecision: number;
}

export type RenderStyleName = "publication" | "screen";

/**
 * ACS-like figure style: small, tight, hairline-black, no background.
 *
 * The background is omitted rather than set to white on purpose — a figure
 * dropped into a manuscript or a dark-themed slide should take the page's
 * colour, and a baked-in white rect is the classic reason an exported SVG
 * shows up as a bright block.
 */
export const PUBLICATION_STYLE: RenderStyle = Object.freeze({
  name: "publication",
  bondLengthPx: 24,
  bondLineWidthPx: 1.4,
  doubleBondGapPx: 4.2,
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSizePx: 10,
  subscriptScale: 0.72,
  labelPaddingPx: 1.6,
  marginPx: 8,
  atomDotRadiusPx: 0.9,
  colors: Object.freeze({ bond: "#000000", label: "#000000" }),
  coordinatePrecision: 3,
});

/**
 * On-screen editing style: larger, heavier, and opaque.
 *
 * Roughly twice the publication scale because a bond has to be a comfortable
 * mouse target, not just legible. The editor canvas owns pan and zoom on top
 * of this; it must not re-derive the scale itself.
 */
export const SCREEN_STYLE: RenderStyle = Object.freeze({
  name: "screen",
  bondLengthPx: 44,
  bondLineWidthPx: 2,
  doubleBondGapPx: 7,
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSizePx: 16,
  subscriptScale: 0.72,
  labelPaddingPx: 3,
  marginPx: 16,
  atomDotRadiusPx: 2,
  colors: Object.freeze({
    bond: "#1f2937",
    label: "#111827",
    background: "#ffffff",
  }),
  coordinatePrecision: 2,
});

export const RENDER_STYLES: Readonly<Record<RenderStyleName, RenderStyle>> =
  Object.freeze({
    publication: PUBLICATION_STYLE,
    screen: SCREEN_STYLE,
  });

/**
 * A copy of `base` with `overrides` applied. The result is frozen, as the
 * presets are, so a style handed to `buildScene` can never be mutated behind
 * the scene that was built from it.
 *
 * `colors` is replaced wholesale rather than merged key-by-key: a half-merged
 * palette (new bond colour, inherited label colour) is nearly always a bug,
 * and spelling out all three fields is cheap.
 *
 * A key present with an explicit `undefined` is treated as "leave the base
 * value alone", not "unset it". `exactOptionalPropertyTypes` forbids writing
 * that in TypeScript, but the object still arrives that way from a JS caller
 * or from a spread of optional locals, and silently blanking `fontFamily` in
 * that case would be a miserable bug to chase.
 */
export function withStyle(
  base: RenderStyle,
  overrides: Partial<RenderStyle>,
): RenderStyle {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  if (overrides.colors !== undefined) {
    merged["colors"] = Object.freeze({ ...overrides.colors });
  }
  return Object.freeze(merged as unknown as RenderStyle);
}

/**
 * THE conversion from a chem-core position to a scene point.
 *
 * Two things happen here and only here:
 *
 *   1. Scale. Model coordinates are in bond-length units; `bondLengthPx` is
 *      the sole factor that turns them into px.
 *   2. The y-flip. chem-core is y-up (molfile and ordinary maths); SVG is
 *      y-down. The negation on y IS that flip.
 *
 * Keeping both in one three-line function is the point. When the conversion
 * was spread across the renderer, the bounds pass and the editor's pointer
 * maths, every one of them had its own idea of which way was up, and a
 * structure would draw correctly but hit-test upside down. Anything
 * downstream of here — bounds, serialisation, hit-testing, the viewport's pan
 * and zoom — works in final px, y-down, and must never scale or flip again.
 */
export function modelToPx(style: RenderStyle, p: Vec2): ScenePoint {
  return { x: p.x * style.bondLengthPx, y: -p.y * style.bondLengthPx };
}

/**
 * The exact inverse of `modelToPx`: a scene point back to a chem-core position.
 *
 * Its caller is the editor canvas. A pointer lands somewhere in scene px, and
 * chem-core's `hitTest` wants a model position — so the division and the
 * un-flip have to happen somewhere, and this file is the only place they are
 * allowed to. An editor that spelled out `p.y / -bondLengthPx` for itself
 * would be precisely the second site the invariant above exists to prevent:
 * the one that quietly disagrees about which way is up the day a style changes
 * or a transform is inserted, and makes a structure hit-test mirrored.
 *
 * For a DELTA or a tolerance — a drag distance, a pick radius — use
 * `pxPerModelUnit` and divide. There is no y to flip in a difference of two
 * points (the two negations cancel), and running one through here would negate
 * it once too often.
 */
export function pxToModel(style: RenderStyle, p: ScenePoint): Vec2 {
  return { x: p.x / style.bondLengthPx, y: -p.y / style.bondLengthPx };
}

/**
 * The scale factor alone, for callers that need it without a point — an
 * editor converting a pointer delta back into model units, say.
 */
export function pxPerModelUnit(style: RenderStyle): number {
  return style.bondLengthPx;
}
