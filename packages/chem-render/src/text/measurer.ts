/**
 * Text measurement, in px.
 *
 * Everything this module produces is already in scene px and y-DOWN, because
 * every number it starts from is an em fraction and a font size — never a
 * model coordinate. There is nothing here that could be scaled by a bond
 * length or flipped, and nothing here may acquire either.
 *
 * WHY A PLUGGABLE MEASURER AT ALL. The bundled table measures Arimo, which is
 * metrically compatible with Arial and Helvetica, and both shipped presets set
 * exactly that stack — so the default is exact for everything this package
 * actually draws. A house style that sets some other face needs a measurer
 * that knows it, and the seam is one optional field on `RenderStyle` resolved
 * in one function, `measurerFor`. There is deliberately NO module-level
 * default and no `setDefaultMeasurer`: an ambient mutable measurer brings back
 * test-order dependence, and in a server-rendered app it produces an
 * SSR/hydration split in which every atom label mismatches at once.
 *
 * NO CANVAS BACKEND SHIPS HERE. chem-render's tsconfig has no DOM lib, which
 * enforces that for free. A browser-backed `Measurer` belongs in the client,
 * where a `document` legitimately exists.
 *
 * NO ROUNDING, NO CACHING. `formatNumber` in the serialiser is the only place
 * in the pipeline that rounds. A `toFixed` or a memo table here would make the
 * same molecule measure differently depending on what was measured before it.
 */

import type { RenderStyle } from "../style.js";
import type { ScenePoint, TextSpan } from "../scene/types.js";

import {
  EM_ASCENT,
  EM_CAP_HEIGHT,
  EM_DESCENT,
  EM_X_HEIGHT,
  UNITS_PER_EM,
  advanceWidthUnits,
  advanceWidthUnitsOf,
  glyphInkUnits,
  scriptDyPx,
  scriptFontSizePx,
} from "./metrics.js";

export interface FontRequest {
  /**
   * The CSS font family the text will be SET in.
   *
   * SHARP EDGE: `BUNDLED_MEASURER` ignores this, and that is correct only
   * because Arimo is metrically compatible with the Arial/Helvetica stack both
   * presets declare. A style that names a face with different metrics and does
   * not also install a matching `Measurer` is measured wrongly, and nothing
   * detects it — the labels simply sit a little off and the boxes are a little
   * loose or a little tight.
   */
  readonly family: string;
  readonly sizePx: number;
}

export interface GlyphRunMetrics {
  readonly advanceWidthPx: number;
  /** Code points the measurer had no glyph for. A label with any is suspect. */
  readonly notdefCount: number;
}

/** All four are positive px distances from the baseline. */
export interface FontVerticalMetrics {
  readonly ascentPx: number;
  readonly descentPx: number;
  readonly capHeightPx: number;
  readonly xHeightPx: number;
}

/**
 * Whatever can answer "how wide is this string in this font".
 *
 * `id` exists so a scene, a golden file or a bug report can name the measurer
 * its numbers came from. Two figures measured by different backends are not
 * comparable byte-for-byte, and the id is what makes that visible rather than
 * mysterious.
 */
export interface Measurer {
  readonly id: string;
  measureText(text: string, font: FontRequest): GlyphRunMetrics;
  verticalMetrics(font: FontRequest): FontVerticalMetrics;
  /**
   * One ink box per glyph of `text` that has ink, px, relative to the text's
   * pen start ON ITS BASELINE, y-DOWN (so a glyph above the baseline has a
   * negative `minY`).
   *
   * Optional, because a measurer that only knows advances cannot answer it.
   * Without it `glyphInkRects` falls back to each span's full measured box —
   * the advance by the ascender-to-descender band — which contains the ink,
   * so an ink test degrades to the looser em-box test and never passes ink
   * off as clear.
   */
  inkBoxes?(text: string, font: FontRequest): readonly InkRect[];
}

/** A rectangle in px, y-down: `minY` is the top edge. */
export interface InkRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The vendored Arimo table, as a `Measurer`. Pure, synchronous, frozen; no
 * filesystem, no DOM, no async initialisation, no cache.
 */
export const BUNDLED_MEASURER: Measurer = Object.freeze({
  id: "arimo-table",

  measureText(text: string, font: FontRequest): GlyphRunMetrics {
    // Accumulate in integer font units, divide exactly once. Summing px per
    // character would make the total depend on the order of the additions.
    const { units, notdefCount } = advanceWidthUnitsOf(text);
    return {
      advanceWidthPx: (units * font.sizePx) / UNITS_PER_EM,
      notdefCount,
    };
  },

  verticalMetrics(font: FontRequest): FontVerticalMetrics {
    return {
      ascentPx: EM_ASCENT * font.sizePx,
      descentPx: EM_DESCENT * font.sizePx,
      capHeightPx: EM_CAP_HEIGHT * font.sizePx,
      xHeightPx: EM_X_HEIGHT * font.sizePx,
    };
  },

  inkBoxes(text: string, font: FontRequest): readonly InkRect[] {
    // The pen advances in integer font units and each edge is divided once,
    // the same discipline as `measureText`, so a glyph's box does not depend
    // on how many glyphs came before it in floating point.
    const boxes: InkRect[] = [];
    let penUnits = 0;
    for (const character of text) {
      const codepoint = character.codePointAt(0);
      if (codepoint === undefined) continue;
      const ink = glyphInkUnits(codepoint);
      if (ink !== undefined) {
        boxes.push({
          minX: ((penUnits + ink.xMin) * font.sizePx) / UNITS_PER_EM,
          // y-up font units to y-down px: the top edge is the glyph's yMax.
          minY: (-ink.yMax * font.sizePx) / UNITS_PER_EM,
          maxX: ((penUnits + ink.xMax) * font.sizePx) / UNITS_PER_EM,
          maxY: (-ink.yMin * font.sizePx) / UNITS_PER_EM,
        });
      }
      penUnits += advanceWidthUnits(codepoint);
    }
    return boxes;
  },
});

/**
 * THE single point at which "which measurer" is decided.
 *
 * Undefined on the style means the bundled table. Callers resolve here and
 * pass the result down explicitly; nothing else may read `style.measurer`, or
 * the two halves of a scene can end up measured by different backends.
 */
export function measurerFor(style: RenderStyle): Measurer {
  return style.measurer ?? BUNDLED_MEASURER;
}

export interface MeasureRunOptions {
  readonly fontFamily: string;
  /** The RUN's size. Scripted spans are set at `fontSizePx * subscriptScale`. */
  readonly fontSizePx: number;
  readonly subscriptScale: number;
  readonly anchor: "start" | "middle" | "end";
  /**
   * Which line of the MEASURED box `origin.y` names: the baseline, the centre
   * of the ink band, or its top. A measuring convenience only — it is not
   * SVG's `dominant-baseline` and must never be emitted as one. CSS `middle`
   * is half the x-height, which Chromium and Inkscape draw about 0.08 em
   * higher than this `middle`, and Illustrator ignores the property. A caller
   * that centres a run this way converts to a baseline origin with
   * `baselineYPx` before building a primitive.
   */
  readonly baseline: "alphabetic" | "middle" | "hanging";
}

export interface MeasuredSpan {
  readonly span: TextSpan;
  /** Pen x where this span starts, RELATIVE to the run's pen start. First = 0. */
  readonly startXPx: number;
  readonly advanceWidthPx: number;
  /** Already script-scaled — the size this span is actually set at. */
  readonly fontSizePx: number;
  /**
   * ABSOLUTE baseline offset from the run's baseline, y-down. Not the
   * incremental `dy` the serialiser emits, which is a delta from the span
   * before it; converting between the two is the serialiser's business.
   */
  readonly dyPx: number;
  readonly notdefCount: number;
}

export interface TextRunBox {
  readonly advanceWidthPx: number;
  /** Above the baseline, script shifts included. */
  readonly ascentPx: number;
  /**
   * Below the baseline, script shifts included. MAY BE NEGATIVE: an
   * all-superscript run sits entirely above the baseline, so its lowest ink is
   * above it too. Do not clamp — `addBox` in the bounds pass is componentwise
   * min/max and copes, whereas clamping re-inflates every charged label's box.
   */
  readonly descentPx: number;
  /**
   * `EM_CAP_HEIGHT * options.fontSizePx` — the RUN's cap band, not a max over
   * spans. A label is centred on one band, so a superscript charge must not be
   * allowed to widen it and shift the whole label off its bond.
   */
  readonly capHeightPx: number;
  /** Where the pen starts relative to the run's origin, from `anchor`. */
  readonly startXPx: number;
  /** Where the baseline sits relative to the run's origin, from `baseline`. */
  readonly baselineYPx: number;
  /** One entry per input span, in order — including empty ones, so an index
   *  into the caller's span array indexes this array too. */
  readonly spans: readonly MeasuredSpan[];
  readonly notdefCount: number;
}

/**
 * Measures a run of spans at a given size, anchor and baseline.
 *
 * The measurer is a REQUIRED parameter, not a default and not an ambient
 * lookup — see the module header.
 *
 * Vertically the run is measured with its script shifts applied, which is what
 * the serialiser actually draws. The older estimator measured every run as one
 * unshifted line, so a superscript charge overshot its own box; that defect is
 * gone rather than documented.
 *
 * Horizontally the result is the summed ADVANCE, not an ink box: the table
 * carries no side bearings, and an advance is the safe over-estimate. A figure
 * gets a fraction of a px of extra whitespace, never a clipped glyph.
 */
export function measureTextRun(
  spans: readonly TextSpan[],
  options: MeasureRunOptions,
  measurer: Measurer,
): TextRunBox {
  const measured: MeasuredSpan[] = [];
  let penXPx = 0;
  let notdefCount = 0;

  // Seeded from the plain font so a run of nothing still reports a sane band;
  // any span with ink replaces these via the max below.
  let ascentPx = EM_ASCENT * options.fontSizePx;
  let descentPx = EM_DESCENT * options.fontSizePx;
  let sawInk = false;

  for (const span of spans) {
    const sizePx = scriptFontSizePx(
      span.script,
      options.fontSizePx,
      options.subscriptScale,
    );
    // A fraction of the RUN's size, exactly as the serialiser computes it —
    // the two must agree to the bit or the measured box and the drawn glyph
    // part company.
    const dyPx = scriptDyPx(span.script, options.fontSizePx);
    const run = measurer.measureText(span.text, {
      family: options.fontFamily,
      sizePx,
    });

    measured.push({
      span,
      startXPx: penXPx,
      advanceWidthPx: run.advanceWidthPx,
      fontSizePx: sizePx,
      dyPx,
      notdefCount: run.notdefCount,
    });

    penXPx += run.advanceWidthPx;
    notdefCount += run.notdefCount;

    // An empty span has no ink and must not drag the band around: a run whose
    // only span is an empty superscript is vertically a plain run, not one
    // hoisted a third of an em.
    if (span.text.length === 0) continue;
    const spanAscent = -dyPx + EM_ASCENT * sizePx;
    const spanDescent = dyPx + EM_DESCENT * sizePx;
    if (!sawInk) {
      ascentPx = spanAscent;
      descentPx = spanDescent;
      sawInk = true;
    } else {
      if (spanAscent > ascentPx) ascentPx = spanAscent;
      if (spanDescent > descentPx) descentPx = spanDescent;
    }
  }

  const startXPx =
    options.anchor === "start"
      ? 0
      : options.anchor === "middle"
        ? -penXPx / 2
        : -penXPx;

  // `origin.y` means a different line of the glyph box per baseline mode: the
  // baseline itself, the visual centre, or the top of the ascenders.
  const baselineYPx =
    options.baseline === "alphabetic"
      ? 0
      : options.baseline === "middle"
        ? (ascentPx - descentPx) / 2
        : ascentPx;

  return {
    advanceWidthPx: penXPx,
    ascentPx,
    descentPx,
    capHeightPx: EM_CAP_HEIGHT * options.fontSizePx,
    startXPx,
    baselineYPx,
    spans: measured,
    notdefCount,
  };
}

/**
 * The run's ink rectangle, placed at `origin` in scene px (y-down, so `minY`
 * is the TOP edge).
 *
 * This is the box a viewBox is cut from. The much tighter cap-band box a bond
 * is trimmed against is a different rectangle, computed by the placement pass;
 * conflating the two stops a bond a full em short of an oxygen that carries a
 * superscript charge.
 */
export function textRunRect(
  box: TextRunBox,
  origin: ScenePoint,
): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const minX = origin.x + box.startXPx;
  const baselineY = origin.y + box.baselineYPx;
  return {
    minX,
    minY: baselineY - box.ascentPx,
    maxX: minX + box.advanceWidthPx,
    maxY: baselineY + box.descentPx,
  };
}

/**
 * One INK rectangle per drawn glyph of a measured run placed at `origin`, in
 * scene px, y-down — each glyph once, whatever its span.
 *
 * `box` must be the run as measured with the same anchor and baseline the
 * `origin` is given in, exactly as for `textRunRect`. Spans keep their script
 * size and shift. A measurer with no `inkBoxes` yields each non-empty span's
 * measured box instead (see `Measurer.inkBoxes`).
 */
export function glyphInkRects(
  box: TextRunBox,
  origin: ScenePoint,
  measurer: Measurer,
  fontFamily: string,
): InkRect[] {
  const penX = origin.x + box.startXPx;
  const baselineY = origin.y + box.baselineYPx;
  const rects: InkRect[] = [];
  for (const span of box.spans) {
    if (span.span.text.length === 0) continue;
    const x = penX + span.startXPx;
    const y = baselineY + span.dyPx;
    if (measurer.inkBoxes === undefined) {
      rects.push({
        minX: x,
        minY: y - EM_ASCENT * span.fontSizePx,
        maxX: x + span.advanceWidthPx,
        maxY: y + EM_DESCENT * span.fontSizePx,
      });
      continue;
    }
    for (const ink of measurer.inkBoxes(span.span.text, { family: fontFamily, sizePx: span.fontSizePx })) {
      rects.push({ minX: x + ink.minX, minY: y + ink.minY, maxX: x + ink.maxX, maxY: y + ink.maxY });
    }
  }
  return rects;
}

/**
 * The bounding box of a run's ink: the union of `glyphInkRects`, or
 * `undefined` for a run that draws nothing.
 */
export function textRunInkRect(
  box: TextRunBox,
  origin: ScenePoint,
  measurer: Measurer,
  fontFamily: string,
): InkRect | undefined {
  let union: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  for (const r of glyphInkRects(box, origin, measurer, fontFamily)) {
    if (union === undefined) union = { ...r };
    else {
      if (r.minX < union.minX) union.minX = r.minX;
      if (r.minY < union.minY) union.minY = r.minY;
      if (r.maxX > union.maxX) union.maxX = r.maxX;
      if (r.maxY > union.maxY) union.maxY = r.maxY;
    }
  }
  return union;
}
