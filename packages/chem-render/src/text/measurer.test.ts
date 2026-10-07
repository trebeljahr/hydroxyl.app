/**
 * Text measurement.
 *
 * The expected widths below are hand-computed from the font units in
 * `generated/arimo-400-metrics.ts` — B=1366, r=682, I=569, O=1593, H=1479 against
 * a 2048-unit em — rather than read back from `measureTextRun`. A test that
 * calls the implementation to produce its own expectation asserts only that
 * the code is deterministic, which is not the interesting half.
 *
 * Every number here is exact, not approximate: a 2048-unit em makes each
 * advance a dyadic fraction, so `toBe` is the right matcher and a drift of one
 * bit is a real failure rather than noise.
 */

import { describe, expect, it } from "vitest";

import type { TextSpan } from "../scene/types.js";
import { PUBLICATION_STYLE } from "../style.js";

import {
  BUNDLED_MEASURER,
  type MeasureRunOptions,
  type Measurer,
  measureTextRun,
  measurerFor,
  glyphInkRects,
  textRunInkRect,
  textRunRect,
} from "./measurer.js";
import { EM_ASCENT, EM_CAP_HEIGHT, EM_DESCENT, EM_NOTDEF_ADVANCE } from "./metrics.js";

const FONT_SIZE_PX = 10;

const OPTIONS: MeasureRunOptions = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontWeight: "normal" as const,
  fontSizePx: FONT_SIZE_PX,
  subscriptScale: 0.72,
  anchor: "start",
  baseline: "alphabetic",
};

function options(overrides: Partial<MeasureRunOptions>): MeasureRunOptions {
  return { ...OPTIONS, ...overrides };
}

/** Font units -> px at the test's font size. */
function px(units: number, sizePx: number = FONT_SIZE_PX): number {
  return (units * sizePx) / 2048;
}

describe("the environment these numbers are produced in", () => {
  it("has no DOM and no canvas", () => {
    // Stated rather than left true by accident of the runner's config: the
    // whole reason for a bundled table is that measurement must work where
    // there is nothing to measure with. If a DOM ever appears here, someone
    // has changed the vitest environment and a canvas-backed shortcut becomes
    // possible — which would then fail in the static-export path only.
    expect(typeof globalThis.document).toBe("undefined");
    expect("HTMLCanvasElement" in globalThis).toBe(false);
  });
});

describe("BUNDLED_MEASURER", () => {
  it("measures a string from its font units", () => {
    const font = { family: "Arial", weight: "normal", sizePx: FONT_SIZE_PX };
    // "Br" is 1366 + 682 = 2048 units — exactly one em, which is a pleasant
    // accident worth pinning because it makes the arithmetic checkable by eye.
    expect(BUNDLED_MEASURER.measureText("Br", font).advanceWidthPx).toBe(10);
    expect(BUNDLED_MEASURER.measureText("I", font).advanceWidthPx).toBe(
      px(569),
    );
    expect(BUNDLED_MEASURER.measureText("", font).advanceWidthPx).toBe(0);
  });

  it("makes a halogen's label width depend on which halogen it is", () => {
    // The whole point of real metrics: the old 0.6-em-per-character estimate
    // said "Br" was exactly twice "I". It is 3.6 times, and a bounds box built
    // on the estimate is wrong by more than a margin can hide.
    const font = { family: "Arial", weight: "normal", sizePx: FONT_SIZE_PX };
    const br = BUNDLED_MEASURER.measureText("Br", font).advanceWidthPx;
    const i = BUNDLED_MEASURER.measureText("I", font).advanceWidthPx;
    expect(br / i).toBeCloseTo(2048 / 569, 12);
    expect(br / i).not.toBeCloseTo(2, 1);
  });

  it("falls back to .notdef for anything outside both vendored subsets", () => {
    const font = { family: "Arial", weight: "normal", sizePx: FONT_SIZE_PX };
    const ideograph = BUNDLED_MEASURER.measureText("中", font);
    expect(ideograph.advanceWidthPx).toBe(EM_NOTDEF_ADVANCE * FONT_SIZE_PX);
    expect(ideograph.advanceWidthPx).toBeGreaterThan(0);
    expect(ideograph.notdefCount).toBe(1);
  });

  it("measures Greek from the vendored Greek face (decision 252)", () => {
    const font = { family: "Arial", weight: "normal", sizePx: FONT_SIZE_PX };
    const omega = BUNDLED_MEASURER.measureText("Ω", font);
    expect(omega.notdefCount).toBe(0);
    // 1531 units: close to .notdef's 1536, which is why the width is pinned.
    expect(omega.advanceWidthPx).toBe((1531 / 2048) * FONT_SIZE_PX);
    const delta = BUNDLED_MEASURER.measureText("δ", font);
    expect(delta.notdefCount).toBe(0);
    expect(delta.advanceWidthPx).toBe((1140 / 2048) * FONT_SIZE_PX);
  });

  it("counts a surrogate pair as one code point, not two", () => {
    // U+1D407 MATHEMATICAL BOLD CAPITAL H is two UTF-16 units. Charging it
    // twice would desynchronise our width from the browser's for exactly the
    // characters someone reached for because ASCII would not do.
    const font = { family: "Arial", weight: "normal", sizePx: FONT_SIZE_PX };
    const bold = BUNDLED_MEASURER.measureText("\u{1D407}", font);
    expect(bold.notdefCount).toBe(1);
    expect(bold.advanceWidthPx).toBe(EM_NOTDEF_ADVANCE * FONT_SIZE_PX);
  });

  it("reports vertical metrics scaled to the requested size", () => {
    const v = BUNDLED_MEASURER.verticalMetrics({ family: "Arial", weight: "normal", sizePx: 20 });
    expect(v.ascentPx).toBe(EM_ASCENT * 20);
    expect(v.descentPx).toBe(EM_DESCENT * 20);
    expect(v.capHeightPx).toBe(EM_CAP_HEIGHT * 20);
    // Descent is a positive depth, so a naive ascent+descent is the line box.
    expect(v.descentPx).toBeGreaterThan(0);
  });

  it("measures bold Arimo wider than regular (decision 250)", () => {
    // A bold style that measured a bromine at regular widths would run its
    // bond into a glyph that is in fact wider. (C, H, O and the digits keep
    // their widths in Arial Bold, so "OH" alone would not show it.)
    for (const text of ["Br", "Cl", "CH2Cl", "SiMe3"]) {
      const regular = BUNDLED_MEASURER.measureText(text, { family: "Arimo", weight: "normal", sizePx: 10 });
      const bold = BUNDLED_MEASURER.measureText(text, { family: "Arimo", weight: "bold", sizePx: 10 });
      expect(bold.advanceWidthPx, text).toBeGreaterThan(regular.advanceWidthPx);
      expect(bold.notdefCount).toBe(0);
    }
  });

  it("measures a Times stack with the Tinos table, not Arimo's", () => {
    const tinos = BUNDLED_MEASURER.measureText("OH", { family: "Tinos, Times New Roman, serif", weight: "normal", sizePx: 10 });
    const times = BUNDLED_MEASURER.measureText("OH", { family: '"Times New Roman", serif', weight: "normal", sizePx: 10 });
    const arimo = BUNDLED_MEASURER.measureText("OH", { family: "Arimo, Arial", weight: "normal", sizePx: 10 });
    expect(times.advanceWidthPx).toBe(tinos.advanceWidthPx);
    expect(tinos.advanceWidthPx).not.toBe(arimo.advanceWidthPx);
    expect(BUNDLED_MEASURER.verticalMetrics({ family: "Tinos", weight: "normal", sizePx: 2048 }).capHeightPx).toBe(1341);
  });

  it("is frozen and names itself", () => {
    expect(BUNDLED_MEASURER.id).toBe("arimo-table");
    expect(Object.isFrozen(BUNDLED_MEASURER)).toBe(true);
  });
});

describe("measurerFor", () => {
  it("defaults to the bundled table", () => {
    expect(measurerFor(PUBLICATION_STYLE)).toBe(BUNDLED_MEASURER);
  });

  it("uses the style's own measurer when it carries one", () => {
    const stub: Measurer = {
      id: "stub",
      measureText: () => ({ advanceWidthPx: 1, notdefCount: 0 }),
      verticalMetrics: () => ({
        ascentPx: 1,
        descentPx: 1,
        capHeightPx: 1,
        xHeightPx: 1,
      }),
    };
    expect(measurerFor({ ...PUBLICATION_STYLE, measurer: stub })).toBe(stub);
    // Resolution is per-call and per-style: no module-level state was written,
    // so the preset is untouched immediately afterwards. A `setDefaultMeasurer`
    // could not pass this without teardown.
    expect(measurerFor(PUBLICATION_STYLE)).toBe(BUNDLED_MEASURER);
  });
});

describe("measureTextRun", () => {
  it("sums the advances of a plain run", () => {
    const spans: readonly TextSpan[] = [{ text: "O" }, { text: "H" }];
    const box = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);
    // 1593 + 1479 = 3072 units = 1.5 em = 15 px at font size 10.
    expect(box.advanceWidthPx).toBe(15);
    expect(box.spans[0]!.startXPx).toBe(0);
    expect(box.spans[0]!.advanceWidthPx).toBe(px(1593));
    expect(box.spans[1]!.startXPx).toBe(px(1593));
    expect(box.spans[1]!.advanceWidthPx).toBe(px(1479));
    expect(box.notdefCount).toBe(0);
  });

  it("sets a subscript smaller and lower, and says so in the descent", () => {
    // "H" then a subscript "3" — a methyl's hydrogen count.
    const spans: readonly TextSpan[] = [
      { text: "H" },
      { text: "3", script: "sub" },
    ];
    const box = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);
    const subSize = FONT_SIZE_PX * 0.72;

    expect(box.spans[1]!.fontSizePx).toBe(subSize);
    // The shift is a fraction of the RUN's size, not of the scaled span size —
    // the serialiser computes it that way and the two must agree.
    expect(box.spans[1]!.dyPx).toBe(FONT_SIZE_PX * 0.25);
    expect(box.advanceWidthPx).toBe(px(1479) + px(1139, subSize));
    // The descent now reaches below a plain run's, which is precisely what the
    // old unshifted estimator could not see.
    expect(box.descentPx / FONT_SIZE_PX).toBeCloseTo(0.402578125, 12);
    expect(box.descentPx).toBeGreaterThan(EM_DESCENT * FONT_SIZE_PX);
  });

  it("sets a superscript higher, and says so in the ascent", () => {
    // An acetate oxygen: "O" with a superscript U+2212 MINUS SIGN.
    const spans: readonly TextSpan[] = [
      { text: "O" },
      { text: "−", script: "super" },
    ];
    const box = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);

    expect(box.spans[1]!.dyPx).toBe(FONT_SIZE_PX * -0.35);
    expect(box.ascentPx / FONT_SIZE_PX).toBeCloseTo(1.001796875, 12);
    expect(box.ascentPx).toBeGreaterThan(EM_ASCENT * FONT_SIZE_PX);
    // U+2212 is in the vendored subset; a fallback here would mean the charge
    // sign is being drawn as tofu in every exported figure.
    expect(box.notdefCount).toBe(0);
    expect(box.advanceWidthPx).toBe(px(1593) + px(1196, FONT_SIZE_PX * 0.72));
  });

  it("lets an all-superscript run measure a negative descent", () => {
    const box = measureTextRun(
      [{ text: "+", script: "super" }],
      OPTIONS,
      BUNDLED_MEASURER,
    );
    // The run sits entirely above the baseline, so its lowest ink does too.
    // Clamping this to zero would re-inflate the box of every charged label.
    expect(box.descentPx).toBeLessThan(0);
    expect(box.descentPx / FONT_SIZE_PX).toBeCloseTo(-0.197421875, 12);
  });

  it("reports the run's cap band, not a max over spans", () => {
    const box = measureTextRun(
      [{ text: "N" }, { text: "H" }, { text: "4", script: "sub" }],
      OPTIONS,
      BUNDLED_MEASURER,
    );
    // A label is centred on ONE band. If a subscript could widen it, adding a
    // hydrogen count would shift the whole label off its bond.
    expect(box.capHeightPx).toBe(EM_CAP_HEIGHT * FONT_SIZE_PX);
  });

  it("measures an empty run as a plain, zero-width one", () => {
    const empty = measureTextRun([], OPTIONS, BUNDLED_MEASURER);
    expect(empty.advanceWidthPx).toBe(0);
    expect(empty.ascentPx).toBe(EM_ASCENT * FONT_SIZE_PX);
    expect(empty.descentPx).toBe(EM_DESCENT * FONT_SIZE_PX);

    // A span that is present but empty has no ink and must not drag the band:
    // an empty superscript is vertically a plain run, not a hoisted one.
    const blankSuper = measureTextRun(
      [{ text: "", script: "super" }],
      OPTIONS,
      BUNDLED_MEASURER,
    );
    expect(blankSuper.advanceWidthPx).toBe(0);
    expect(blankSuper.ascentPx).toBe(EM_ASCENT * FONT_SIZE_PX);
    // Every input span still gets an entry, so an index into the caller's
    // array indexes this one — the placement pass depends on that.
    expect(blankSuper.spans).toHaveLength(1);
  });

  it("places the pen from the anchor and the baseline from the mode", () => {
    const spans: readonly TextSpan[] = [{ text: "O" }, { text: "H" }];
    const start = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);
    const middle = measureTextRun(
      spans,
      options({ anchor: "middle" }),
      BUNDLED_MEASURER,
    );
    const end = measureTextRun(spans, options({ anchor: "end" }), BUNDLED_MEASURER);

    expect(start.startXPx).toBe(0);
    expect(middle.startXPx).toBe(-7.5);
    expect(end.startXPx).toBe(-15);

    expect(start.baselineYPx).toBe(0);
    expect(
      measureTextRun(spans, options({ baseline: "hanging" }), BUNDLED_MEASURER)
        .baselineYPx,
    ).toBe(start.ascentPx);
    expect(
      measureTextRun(spans, options({ baseline: "middle" }), BUNDLED_MEASURER)
        .baselineYPx,
    ).toBe((start.ascentPx - start.descentPx) / 2);
  });

  it("measures identically every time", () => {
    // No cache, no rounding, no ambient state: same input, same doubles. This
    // is what makes an unchanged molecule re-render to identical bytes.
    const spans: readonly TextSpan[] = [
      { text: "13", script: "super" },
      { text: "C" },
      { text: "H" },
      { text: "3", script: "sub" },
    ];
    const a = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);
    const b = measureTextRun(spans, OPTIONS, BUNDLED_MEASURER);

    for (const key of [
      "advanceWidthPx",
      "ascentPx",
      "descentPx",
      "capHeightPx",
      "startXPx",
      "baselineYPx",
      "notdefCount",
    ] as const) {
      expect(Object.is(a[key], b[key])).toBe(true);
    }
    expect(a.spans).toHaveLength(b.spans.length);
    for (let i = 0; i < a.spans.length; i++) {
      const left = a.spans[i]!;
      const right = b.spans[i]!;
      expect(Object.is(left.startXPx, right.startXPx)).toBe(true);
      expect(Object.is(left.advanceWidthPx, right.advanceWidthPx)).toBe(true);
      expect(Object.is(left.fontSizePx, right.fontSizePx)).toBe(true);
      expect(Object.is(left.dyPx, right.dyPx)).toBe(true);
    }
  });

  it("takes its measurer as a parameter rather than looking one up", () => {
    const doubling: Measurer = {
      id: "doubling",
      measureText: (text, font) => {
        const real = BUNDLED_MEASURER.measureText(text, font);
        return {
          advanceWidthPx: real.advanceWidthPx * 2,
          notdefCount: real.notdefCount,
        };
      },
      verticalMetrics: (font) => BUNDLED_MEASURER.verticalMetrics(font),
    };
    const spans: readonly TextSpan[] = [{ text: "O" }, { text: "H" }];
    expect(measureTextRun(spans, OPTIONS, doubling).advanceWidthPx).toBe(30);
    expect(measureTextRun(spans, OPTIONS, BUNDLED_MEASURER).advanceWidthPx).toBe(
      15,
    );
  });
});

describe("textRunRect", () => {
  it("places the ink box at an origin, y-down", () => {
    const box = measureTextRun(
      [{ text: "O" }, { text: "H" }],
      OPTIONS,
      BUNDLED_MEASURER,
    );
    const rect = textRunRect(box, { x: 100, y: 50 });

    expect(rect.minX).toBe(100);
    expect(rect.maxX).toBe(115);
    // minY is the TOP edge: scene y grows downward.
    expect(rect.minY).toBe(50 - EM_ASCENT * FONT_SIZE_PX);
    expect(rect.maxY).toBe(50 + EM_DESCENT * FONT_SIZE_PX);
    expect(rect.minY).toBeLessThan(rect.maxY);
  });

  it("shifts with the anchor", () => {
    const spans: readonly TextSpan[] = [{ text: "O" }, { text: "H" }];
    const centred = textRunRect(
      measureTextRun(spans, options({ anchor: "middle" }), BUNDLED_MEASURER),
      { x: 0, y: 0 },
    );
    expect(centred.minX).toBe(-7.5);
    expect(centred.maxX).toBe(7.5);
  });
});

describe("glyphInkRects", () => {
  // Ink boxes from the glyph outlines, font units y-up:
  // O 97,-20,1495,1430 (advance 1593); H 168,0,1312,1409; 3 78,-20,1049,1430.
  it("gives each glyph its own outline box, once, at its pen position", () => {
    const box = measureTextRun([{ text: "OH" }], OPTIONS, BUNDLED_MEASURER);
    const rects = glyphInkRects(box, { x: 100, y: 50 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight);
    expect(rects).toEqual([
      { minX: 100 + px(97), minY: 50 - px(1430), maxX: 100 + px(1495), maxY: 50 + px(20) },
      { minX: 100 + px(1593 + 168), minY: 50 - px(1409), maxX: 100 + px(1593 + 1312), maxY: 50 },
    ]);
    // Tighter than the typographic band on both sides.
    const band = textRunRect(box, { x: 100, y: 50 });
    for (const rect of rects) {
      expect(rect.minY).toBeGreaterThan(band.minY);
      expect(rect.maxY).toBeLessThan(band.maxY);
    }
  });

  it("sets a subscript's ink at its own size and shift", () => {
    const box = measureTextRun([{ text: "H" }, { text: "3", script: "sub" }], OPTIONS, BUNDLED_MEASURER);
    const [h, three] = glyphInkRects(box, { x: 0, y: 0 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight);
    const sub = FONT_SIZE_PX * 0.72;
    const x = px(1479);
    const dy = FONT_SIZE_PX * 0.25;
    expect(h).toEqual({ minX: px(168), minY: -px(1409), maxX: px(1312), maxY: 0 });
    expect(three).toEqual({
      minX: x + px(78, sub),
      minY: dy - px(1430, sub),
      maxX: x + px(1049, sub),
      maxY: dy + px(20, sub),
    });
  });

  it("gives a space no ink, and a run of spaces no ink box at all", () => {
    const box = measureTextRun([{ text: "O H" }], OPTIONS, BUNDLED_MEASURER);
    expect(glyphInkRects(box, { x: 0, y: 0 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight)).toHaveLength(2);
    const blank = measureTextRun([{ text: "  " }], OPTIONS, BUNDLED_MEASURER);
    expect(textRunInkRect(blank, { x: 0, y: 0 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight)).toBeUndefined();
  });

  it("falls back to each span's full band for a measurer that knows only advances", () => {
    // Looser, never tighter: an ink test run against it can only report
    // more, never pass ink off as clear.
    const advancesOnly: Measurer = {
      id: "advances-only",
      measureText: BUNDLED_MEASURER.measureText,
      verticalMetrics: BUNDLED_MEASURER.verticalMetrics,
    };
    const box = measureTextRun([{ text: "OH" }], OPTIONS, advancesOnly);
    expect(glyphInkRects(box, { x: 0, y: 0 }, advancesOnly, OPTIONS.fontFamily, OPTIONS.fontWeight)).toEqual([
      textRunRect(box, { x: 0, y: 0 }),
    ]);
  });

  it("unions to the run's ink box", () => {
    const box = measureTextRun([{ text: "(S)" }], options({ anchor: "middle" }), BUNDLED_MEASURER);
    const ink = textRunInkRect(box, { x: 0, y: 0 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight)!;
    const rects = glyphInkRects(box, { x: 0, y: 0 }, BUNDLED_MEASURER, OPTIONS.fontFamily, OPTIONS.fontWeight);
    expect(rects).toHaveLength(3);
    expect(ink.minX).toBe(Math.min(...rects.map((r) => r.minX)));
    expect(ink.maxY).toBe(Math.max(...rects.map((r) => r.maxY)));
  });
});
