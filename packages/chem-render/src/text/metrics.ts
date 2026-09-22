/**
 * The vendored font, as numbers.
 *
 * This is the only module that imports `generated/arimo-metrics.ts`, so the
 * generated table has exactly one consumer and a regeneration can never ripple
 * further than this file. Nothing here knows about pixels-per-bond-length,
 * molecules, elements or scenes: it converts font units to em fractions and
 * answers "how wide is this code point". Text measurement proper lives one
 * layer up in `measurer.ts`.
 *
 * Font units, not em fractions, are what the table stores and what this module
 * accumulates in. A 2048-unit em makes every advance an exact integer, and
 * summing integers before the single divide is what makes the same string
 * measure to the same double every time. Exported figures get committed and
 * diffed; a width that drifts in the last bit reshuffles a viewBox.
 *
 * NOT A COORDINATE SPACE. There is no y-flip here and no scale: the sign flip
 * applied to `DESCENDER` below turns a signed OS/2 metric into a positive
 * depth, which is a sign *convention on a length*, not a flip of an axis.
 * Nothing downstream may "balance" it with a negation of its own.
 */

import {
  ASCENDER,
  ADVANCE_WIDTHS,
  CAP_HEIGHT,
  DESCENDER,
  INK_BOUNDS,
  NOTDEF_ADVANCE,
  NOTDEF_INK,
  UNITS_PER_EM,
  X_HEIGHT,
} from "./generated/arimo-metrics.js";

/**
 * Font identity, re-exported so no path containing `generated/` ever appears
 * in an import outside this file.
 */
export {
  FONT_FAMILY,
  FONT_VERSION,
  FONT_SHA256,
  UNITS_PER_EM,
} from "./generated/arimo-metrics.js";

/**
 * OS/2 sTypoAscender as a fraction of the em: 1854/2048.
 *
 * The conservative ink top, used for the box a viewBox is cut from — it
 * reserves room for accents no chemical label actually carries, which costs a
 * little whitespace and can never clip. It is emphatically NOT the datum a
 * label is centred on; that is `EM_CAP_HEIGHT`, because centring on the
 * ascender visibly sinks every all-capitals label below its bond.
 */
export const EM_ASCENT = ASCENDER / UNITS_PER_EM;

/**
 * OS/2 sTypoDescender as a POSITIVE depth below the baseline: 434/2048.
 *
 * The table stores it negative, as the spec requires. The negation happens
 * here, once, and turns a signed metric into a distance — the same way a
 * radius is a distance. It is not a coordinate flip and must not be
 * compensated for anywhere else.
 */
export const EM_DESCENT = -DESCENDER / UNITS_PER_EM;

/**
 * OS/2 sCapHeight as a fraction of the em: 1409/2048.
 *
 * THE datum. Chemical labels are capitals, digits and the odd lowercase
 * second letter of a symbol ("Br", "Cl"), so the cap band is what a reader
 * perceives as the label's body. A bond meets an atom on the cap band's
 * midline, and the clear space a bond is trimmed to is the cap band plus
 * padding — not the ascender box, which would stop a bond a visible distance
 * short of a chlorine because of the "l".
 */
export const EM_CAP_HEIGHT = CAP_HEIGHT / UNITS_PER_EM;

/** OS/2 sxHeight as a fraction of the em: 1082/2048. */
export const EM_X_HEIGHT = X_HEIGHT / UNITS_PER_EM;

/** `.notdef`'s advance as a fraction of the em: 1536/2048 = 0.75. */
export const EM_NOTDEF_ADVANCE = NOTDEF_ADVANCE / UNITS_PER_EM;

/**
 * Subscript and superscript baseline offsets, as a fraction of the RUN's font
 * size — not of the already-scaled span size.
 *
 * SVG's own `baseline-shift="sub"` is the obvious spelling, but browsers and
 * the print pipelines that consume these figures disagree about how far it
 * shifts — Inkscape and Chrome place the same "H2O" differently. An explicit
 * `dy` renders identically everywhere. The values are the usual typographic
 * ones: a subscript drops about a quarter of an em, a superscript rises a
 * little more because it also has to clear the x-height.
 *
 * These live here rather than in the serialiser because the measurer and the
 * serialiser must agree to the last bit: the box a superscript charge is
 * measured into and the `dy` it is drawn with are the same number, or a
 * charged label is either clipped or padded by a phantom.
 */
export const SUBSCRIPT_DY_FACTOR = 0.25;
export const SUPERSCRIPT_DY_FACTOR = -0.35;

/**
 * How far a scripted span's baseline sits from the run's baseline, in px,
 * Y-DOWN — positive is lower on the page, matching scene space.
 *
 * `script` is typed structurally rather than as `TextSpan["script"]` so this
 * module stays a leaf with no dependency on the scene IR.
 */
export function scriptDyPx(
  script: "sub" | "super" | undefined,
  fontSizePx: number,
): number {
  if (script === "sub") return fontSizePx * SUBSCRIPT_DY_FACTOR;
  if (script === "super") return fontSizePx * SUPERSCRIPT_DY_FACTOR;
  return 0;
}

/** The font size a span is actually set at: scaled for either script. */
export function scriptFontSizePx(
  script: "sub" | "super" | undefined,
  fontSizePx: number,
  subscriptScale: number,
): number {
  return script === undefined ? fontSizePx : fontSizePx * subscriptScale;
}

/**
 * The table as a lookup, built once.
 *
 * A Map rather than a binary search over the sorted pairs: 233 entries is
 * nothing, and a hash lookup keeps the hot path free of comparisons whose
 * ordering assumptions could rot if the generator ever emitted a different
 * sort.
 */
const ADVANCE_BY_CODEPOINT: ReadonlyMap<number, number> = new Map(
  ADVANCE_WIDTHS.map(([codepoint, advance]) => [codepoint, advance]),
);

/**
 * Advance of one code point, in font units.
 *
 * Anything outside the vendored latin subset gets `.notdef`'s advance, not
 * zero. A missing glyph still paints — as a tofu box three quarters of an em
 * wide in most renderers — and measuring it as nothing clips it out of the
 * viewBox, runs a bond straight through it and shrinks its pick target, all
 * without a single visible error.
 *
 * A combining mark inside the subset legitimately measures 0; that is the
 * font telling the truth, not a miss.
 */
export function advanceWidthUnits(codepoint: number): number {
  return ADVANCE_BY_CODEPOINT.get(codepoint) ?? NOTDEF_ADVANCE;
}

/**
 * Summed advance of `text` in font units, plus how many of its code points
 * fell back to `.notdef`.
 *
 * Iterates CODE POINTS. `text.length` would charge a surrogate pair twice and
 * desynchronise the measured width from what the browser draws — which shows
 * up as a label that is fine in every ASCII test and subtly wrong for the one
 * character that motivated the test.
 */
export function advanceWidthUnitsOf(text: string): {
  readonly units: number;
  readonly notdefCount: number;
} {
  let units = 0;
  let notdefCount = 0;
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    // `for…of` over a string always yields at least one code unit per step, so
    // this is unreachable; the check exists because the type says it can be
    // undefined and silently coercing would hide a real bug elsewhere.
    if (codepoint === undefined) continue;
    const advance = ADVANCE_BY_CODEPOINT.get(codepoint);
    if (advance === undefined) {
      units += NOTDEF_ADVANCE;
      notdefCount += 1;
    } else {
      units += advance;
    }
  }
  return { units, notdefCount };
}

/** A glyph's ink box in font units, y-UP, x from its own pen position. */
export interface GlyphInkUnits {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

const INK_BY_CODEPOINT: ReadonlyMap<number, GlyphInkUnits> = new Map(
  INK_BOUNDS.map(([codepoint, xMin, yMin, xMax, yMax]) => [codepoint, { xMin, yMin, xMax, yMax }]),
);

const NOTDEF_INK_UNITS: GlyphInkUnits | undefined =
  NOTDEF_INK === undefined
    ? undefined
    : { xMin: NOTDEF_INK[0], yMin: NOTDEF_INK[1], xMax: NOTDEF_INK[2], yMax: NOTDEF_INK[3] };

/**
 * The INK a code point puts on the page, in font units; `undefined` for a
 * character with no outline (the space).
 *
 * Distinct from the advance and from the typographic ascender/descender band
 * the measured box uses: a digit's ink sits between the baseline and the cap
 * height, a parenthesis reaches below the baseline. A code point outside the
 * subset gets `.notdef`'s ink, for the same reason it gets `.notdef`'s
 * advance: the tofu box still paints.
 */
export function glyphInkUnits(codepoint: number): GlyphInkUnits | undefined {
  if (ADVANCE_BY_CODEPOINT.has(codepoint)) return INK_BY_CODEPOINT.get(codepoint);
  return NOTDEF_INK_UNITS;
}
