/**
 * The vendored fonts, as numbers.
 *
 * This is the only module that imports a `generated/*-metrics.ts` table, so
 * each generated table has exactly one consumer and a regeneration can never ripple
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
 * applied to `DESCENDER` in `faceFrom` turns a signed OS/2 metric into a positive
 * depth, which is a sign *convention on a length*, not a flip of an axis.
 * Nothing downstream may "balance" it with a negation of its own.
 */

import * as ARIMO_400 from "./generated/arimo-400-metrics.js";
import * as ARIMO_700 from "./generated/arimo-700-metrics.js";
import * as TINOS_400 from "./generated/tinos-400-metrics.js";
import * as TINOS_700 from "./generated/tinos-700-metrics.js";

/**
 * The default face's identity, re-exported so no path containing
 * `generated/` ever appears in an import outside this file.
 */
export {
  FONT_FAMILY,
  FONT_VERSION,
  FONT_SHA256,
  UNITS_PER_EM,
} from "./generated/arimo-400-metrics.js";

/**
 * The vendored faces (decision 250). An enum, not a family string: a label
 * box is only right for a face whose table is generated here, so a face
 * outside this list cannot be asked for at all.
 *
 * Arimo is metrically compatible with Arial and Helvetica, Tinos with Times
 * and Times New Roman — both are the Liberation designs — so a viewer that
 * lacks the embedded WOFF and falls back down the CSS stack still sets every
 * advance the measurer charged.
 */
export type FontFace = "arimo" | "tinos";
export const FONT_FACES: readonly FontFace[] = Object.freeze(["arimo", "tinos"]);

/** CSS keyword weights. Only the two that have a vendored table. */
export type FontWeight = "normal" | "bold";
export const FONT_WEIGHTS: readonly FontWeight[] = Object.freeze(["normal", "bold"]);

/** The CSS `font-family` stack a style sets for each face. */
export const FONT_FACE_FAMILY: Readonly<Record<FontFace, string>> = Object.freeze({
  arimo: "Arimo, Arial, Helvetica, sans-serif",
  tinos: "Tinos, Times New Roman, Times, serif",
});

/** The face's own name, as an embedded `@font-face` declares it. */
export const FONT_FACE_NAME: Readonly<Record<FontFace, string>> = Object.freeze({
  arimo: "Arimo",
  tinos: "Tinos",
});

/** Numeric `font-weight` of each keyword, as `@font-face` and OS/2 state it. */
export const FONT_WEIGHT_NUMBER: Readonly<Record<FontWeight, 400 | 700>> = Object.freeze({
  normal: 400,
  bold: 700,
});

/** First names of a stack that resolve to Tinos; anything else is Arimo. */
const SERIF_NAMES: ReadonlySet<string> = new Set([
  "tinos",
  "times new roman",
  "times",
  "liberation serif",
  "serif",
]);

/**
 * Which vendored face measures a CSS `font-family` stack: the first family
 * named. Arimo for anything it does not recognise, which is what the bundled
 * measurer did for every family before Tinos was vendored, so a style naming
 * some other sans keeps measuring exactly as it did.
 */
export function fontFaceOfFamily(family: string): FontFace {
  // Every measured span asks, so the parse is remembered per stack. A style
  // has one stack, so the map holds a handful of entries, and what it maps
  // to never depends on what was asked before.
  let face = FACE_OF_FAMILY.get(family);
  if (face === undefined) {
    const first = (family.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
    face = SERIF_NAMES.has(first) ? "tinos" : "arimo";
    FACE_OF_FAMILY.set(family, face);
  }
  return face;
}

const FACE_OF_FAMILY = new Map<string, FontFace>();

/** A glyph's ink box in font units, y-UP, x from its own pen position. */
export interface GlyphInkUnits {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/**
 * One generated table, as numbers and lookups.
 *
 * Font units, not em fractions, are what the table stores and what the
 * lookups accumulate in; the `em*` fields divide once.
 */
export interface FaceMetrics {
  readonly face: FontFace;
  readonly weight: FontWeight;
  /** `name` ID 1 and 5 and the WOFF's SHA-256, for a bug report. */
  readonly family: string;
  readonly version: string;
  readonly sha256: string;
  readonly unitsPerEm: number;
  /**
   * OS/2 sTypoAscender as a fraction of the em: the conservative ink top a
   * viewBox is cut from. NOT the datum a label is centred on; that is
   * `emCapHeight`, because centring on the ascender visibly sinks every
   * all-capitals label below its bond.
   */
  readonly emAscent: number;
  /**
   * OS/2 sTypoDescender as a POSITIVE depth below the baseline. The table
   * stores it negative, as the spec requires; the negation happens here,
   * once, and is a sign convention on a length, not a coordinate flip.
   */
  readonly emDescent: number;
  /**
   * OS/2 sCapHeight as a fraction of the em. THE datum: chemical labels are
   * capitals, digits and the odd lowercase second letter of a symbol, so the
   * cap band is what a reader perceives as the label's body. A bond meets an
   * atom on the cap band's midline.
   */
  readonly emCapHeight: number;
  readonly emXHeight: number;
  readonly emNotdefAdvance: number;
  /** Whether the subset has a glyph for `codepoint` at all. */
  hasGlyph(codepoint: number): boolean;
  /**
   * Advance of one code point, in font units. Anything outside the subset
   * gets `.notdef`'s advance, not zero: a missing glyph still paints, as a
   * tofu box, and measuring it as nothing clips it out of the viewBox.
   */
  advanceWidthUnits(codepoint: number): number;
  /**
   * Summed advance of `text` in font units, plus how many of its code points
   * fell back to `.notdef`. Iterates CODE POINTS: `text.length` would charge
   * a surrogate pair twice.
   */
  advanceWidthUnitsOf(text: string): { readonly units: number; readonly notdefCount: number };
  /**
   * The INK a code point puts on the page; `undefined` for a character with
   * no outline (the space). Outside the subset: `.notdef`'s ink, which
   * still paints.
   */
  glyphInkUnits(codepoint: number): GlyphInkUnits | undefined;
}

interface GeneratedTable {
  readonly FONT_FAMILY: string;
  readonly FONT_VERSION: string;
  readonly FONT_SHA256: string;
  readonly UNITS_PER_EM: number;
  readonly ASCENDER: number;
  readonly DESCENDER: number;
  readonly CAP_HEIGHT: number;
  readonly X_HEIGHT: number;
  readonly NOTDEF_ADVANCE: number;
  readonly ADVANCE_WIDTHS: readonly (readonly [number, number])[];
  readonly NOTDEF_INK: readonly [number, number, number, number] | undefined;
  readonly INK_BOUNDS: readonly (readonly [number, number, number, number, number])[];
}

function faceFrom(table: GeneratedTable, face: FontFace, weight: FontWeight): FaceMetrics {
  // A Map rather than a binary search over the sorted pairs: 233 entries is
  // nothing, and a hash lookup keeps the hot path free of comparisons whose
  // ordering assumptions could rot if the generator emitted a different sort.
  const advances: ReadonlyMap<number, number> = new Map(
    table.ADVANCE_WIDTHS.map(([codepoint, advance]) => [codepoint, advance]),
  );
  const inks: ReadonlyMap<number, GlyphInkUnits> = new Map(
    table.INK_BOUNDS.map(([codepoint, xMin, yMin, xMax, yMax]) => [codepoint, { xMin, yMin, xMax, yMax }]),
  );
  const notdefInk: GlyphInkUnits | undefined =
    table.NOTDEF_INK === undefined
      ? undefined
      : { xMin: table.NOTDEF_INK[0], yMin: table.NOTDEF_INK[1], xMax: table.NOTDEF_INK[2], yMax: table.NOTDEF_INK[3] };
  const upm = table.UNITS_PER_EM;
  return Object.freeze({
    face,
    weight,
    family: table.FONT_FAMILY,
    version: table.FONT_VERSION,
    sha256: table.FONT_SHA256,
    unitsPerEm: upm,
    emAscent: table.ASCENDER / upm,
    emDescent: -table.DESCENDER / upm,
    emCapHeight: table.CAP_HEIGHT / upm,
    emXHeight: table.X_HEIGHT / upm,
    emNotdefAdvance: table.NOTDEF_ADVANCE / upm,
    hasGlyph: (codepoint: number): boolean => advances.has(codepoint),
    advanceWidthUnits: (codepoint: number): number => advances.get(codepoint) ?? table.NOTDEF_ADVANCE,
    advanceWidthUnitsOf(text: string): { readonly units: number; readonly notdefCount: number } {
      let units = 0;
      let notdefCount = 0;
      for (const character of text) {
        const codepoint = character.codePointAt(0);
        // `for…of` over a string always yields a code point; the check exists
        // because the type says it can be undefined.
        if (codepoint === undefined) continue;
        const advance = advances.get(codepoint);
        if (advance === undefined) {
          units += table.NOTDEF_ADVANCE;
          notdefCount += 1;
        } else {
          units += advance;
        }
      }
      return { units, notdefCount };
    },
    glyphInkUnits: (codepoint: number): GlyphInkUnits | undefined =>
      advances.has(codepoint) ? inks.get(codepoint) : notdefInk,
  });
}

const FACE_METRICS: Readonly<Record<FontFace, Readonly<Record<FontWeight, FaceMetrics>>>> = Object.freeze({
  arimo: Object.freeze({
    normal: faceFrom(ARIMO_400, "arimo", "normal"),
    bold: faceFrom(ARIMO_700, "arimo", "bold"),
  }),
  tinos: Object.freeze({
    normal: faceFrom(TINOS_400, "tinos", "normal"),
    bold: faceFrom(TINOS_700, "tinos", "bold"),
  }),
});

/** The generated table of one face at one weight. */
export function faceMetrics(face: FontFace, weight: FontWeight): FaceMetrics {
  return FACE_METRICS[face][weight];
}

/** The table a CSS family stack at `weight` is measured with. */
export function faceMetricsFor(family: string, weight: FontWeight): FaceMetrics {
  return FACE_METRICS[fontFaceOfFamily(family)][weight];
}

/**
 * The default face — Arimo regular, what every preset sets — whose numbers
 * the constants and functions below expose for code and tests that predate
 * the face choice. Anything that lays out a STYLE'S text must go through
 * `faceMetricsFor(style.fontFamily, style.fontWeight)` instead.
 */
const DEFAULT_FACE = FACE_METRICS.arimo.normal;

/** Arimo regular's sTypoAscender as a fraction of the em: 1854/2048. */
export const EM_ASCENT = DEFAULT_FACE.emAscent;

/** Arimo regular's sTypoDescender as a POSITIVE depth: 434/2048. */
export const EM_DESCENT = DEFAULT_FACE.emDescent;

/** Arimo regular's sCapHeight as a fraction of the em: 1409/2048. */
export const EM_CAP_HEIGHT = DEFAULT_FACE.emCapHeight;

/** Arimo regular's sxHeight as a fraction of the em: 1082/2048. */
export const EM_X_HEIGHT = DEFAULT_FACE.emXHeight;

/** Arimo regular's `.notdef` advance as a fraction of the em: 0.75. */
export const EM_NOTDEF_ADVANCE = DEFAULT_FACE.emNotdefAdvance;

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

/** Arimo regular's `hasGlyph`. */
export const hasGlyph = DEFAULT_FACE.hasGlyph;

/** Arimo regular's `advanceWidthUnits`. */
export const advanceWidthUnits = DEFAULT_FACE.advanceWidthUnits;

/** Arimo regular's `advanceWidthUnitsOf`. */
export const advanceWidthUnitsOf = DEFAULT_FACE.advanceWidthUnitsOf;

/** Arimo regular's `glyphInkUnits`. */
export const glyphInkUnits = DEFAULT_FACE.glyphInkUnits;
