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
import type { Measurer } from "./text/measurer.js";

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
   * Radius of the dot drawn at a BARE VERTEX — an atom the label pass decided
   * not to draw a label for. Set to 0 to suppress it entirely.
   *
   * It used to mark every atom, because there were no labels and a dot was the
   * only way to see where an atom was. Now an atom that draws a label draws no
   * dot: a dot at a labelled atom is not merely redundant, it is the universal
   * notation for an unpaired electron, so a methyl radical and a plain methyl
   * would differ only in a dot's position.
   *
   * Both presets keep a non-zero radius. Bond trimming has landed, so a bare
   * carbon vertex IS now fully described by the two lines meeting at it and
   * this could go to 0 — but that is a visible change to every skeletal
   * figure in the repo and a decision of its own, not something to fold into
   * the pass that made it possible. What it would still buy afterwards is a
   * marker for the editor's own hit target, which belongs on an overlay
   * rather than in the figure.
   */
  readonly atomDotRadiusPx: number;
  /**
   * The inscribed circle of an aromatic ring, as a fraction of the ring's
   * APOTHEM — its centroid-to-nearest-edge distance.
   *
   * Calibrated on benzene: a regular hexagon of unit bonds has an apothem of
   * sqrt(3)/2, so 0.75 puts the circle at 0.65 bond lengths, which is where
   * the convention draws it and just inside where the inner line of a Kekule
   * ring double bond would sit. Being a fraction of the apothem rather than
   * of the circumradius is what makes it degrade correctly on a ring the user
   * has dragged out of shape: the circle shrinks to stay clear of the nearest
   * bond instead of crossing it.
   */
  readonly aromaticCircleRatio: number;
  /**
   * Width of the WIDE end of a solid or hashed wedge, px.
   *
   * Physical vocabulary, so it belongs on the style rather than on a
   * representation: it is the same kind of number as `doubleBondGapPx`, and a
   * house style that prints heavier bonds prints fatter wedges with them.
   * Roughly three line widths is where a wedge reads as a triangle rather than
   * as a thick line at the sizes both presets use.
   */
  readonly stereoWedgeWidthPx: number;
  /** Centre-to-centre spacing of the bars of a hashed wedge, px. */
  readonly stereoHashPeriodPx: number;
  /**
   * Full period of a wavy bond, px — one complete swing out and back.
   *
   * FIXED, and deliberately not derived from the bond length: a wavy bond is a
   * mark with one meaning, and a wave that stretched with the bond would read
   * as a different mark on a long bond than on a short one. Only the number of
   * half-waves varies, rounded so the wave lands on both ends.
   */
  readonly stereoWavyPeriodPx: number;
  /**
   * Size of an `(R)`/`(S)`/`(E)`/`(Z)` label, as a fraction of `fontSizePx`.
   *
   * Smaller than an atom label because it is an annotation ABOUT the structure
   * rather than part of it: set at the same size it competes with the element
   * symbols for the reader's eye. Not `subscriptScale`, which is a typographic
   * relationship inside one run and would drag the descriptor along with any
   * future change to how a subscript is set.
   */
  readonly stereoDescriptorScale: number;
  readonly colors: RenderColors;
  /** Decimal places emitted for every coordinate. Fixed so output is byte-deterministic. */
  readonly coordinatePrecision: number;
  /**
   * The text measurer this style's scenes are measured with.
   *
   * UNDEFINED MEANS THE BUNDLED ARIMO TABLE, resolved in exactly one place —
   * `measurerFor(style)` in `text/measurer.ts`. Nothing may read this field
   * directly, or the two halves of a scene can end up measured by different
   * backends and the labels and the viewBox stop agreeing.
   *
   * CAVEAT: a style carrying a measurer is no longer JSON-round-trippable,
   * because a function does not survive serialisation. That is acceptable
   * precisely because it is optional and unset on both presets, so any style
   * that is actually persisted is unaffected.
   */
  readonly measurer?: Measurer;
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
  // Arimo first: it is the face this package vendors metrics for, so the
  // measured advances and the drawn glyphs are the same glyphs. The fallbacks
  // are metric-compatible with it by design, which is what makes the boxes
  // still correct on a machine that has no Arimo installed.
  fontFamily: "Arimo, Arial, Helvetica, sans-serif",
  fontSizePx: 10,
  subscriptScale: 0.72,
  labelPaddingPx: 1.6,
  marginPx: 8,
  atomDotRadiusPx: 0.9,
  aromaticCircleRatio: 0.75,
  stereoWedgeWidthPx: 4.2,
  stereoHashPeriodPx: 3,
  stereoWavyPeriodPx: 8,
  stereoDescriptorScale: 0.85,
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
  // Arimo first: it is the face this package vendors metrics for, so the
  // measured advances and the drawn glyphs are the same glyphs. The fallbacks
  // are metric-compatible with it by design, which is what makes the boxes
  // still correct on a machine that has no Arimo installed.
  fontFamily: "Arimo, Arial, Helvetica, sans-serif",
  fontSizePx: 16,
  subscriptScale: 0.72,
  labelPaddingPx: 3,
  marginPx: 16,
  atomDotRadiusPx: 2,
  aromaticCircleRatio: 0.75,
  stereoWedgeWidthPx: 7,
  stereoHashPeriodPx: 5,
  stereoWavyPeriodPx: 15,
  stereoDescriptorScale: 0.85,
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
 * FOR A DELTA — a drag displacement, one vector in px becoming one vector in
 * model units — THIS IS STILL THE RIGHT FUNCTION, y-negation included. It is a
 * LINEAR map (scale plus a sign, no translation term), so
 * `pxToModel(p2) - pxToModel(p1) === pxToModel(p2 - p1)` exactly: the negation
 * factors out of the subtraction, it does not cancel. An earlier version of
 * this comment claimed the opposite and told the editor to divide a drag delta
 * by `pxPerModelUnit` alone, which mirrors every drag vertically — the atom
 * goes down while the pointer goes up.
 *
 * `pxPerModelUnit` alone is right for a SCALAR — a tolerance, a pick radius, a
 * distance — because a length has no sign to flip.
 *
 * What is genuinely unsafe for a delta is the VIEWPORT's `toModel`, which is
 * AFFINE: its `(p - size/2) / zoom + pan` translation cancels in a difference,
 * so a delta must be divided by the zoom alone. Safest of all is to have no
 * vector in the calculation: convert both endpoints and subtract.
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
