/**
 * Text measurement.
 *
 * The expected widths below are hand-computed from the font units in
 * `generated/arimo-metrics.ts` — B=1366, r=682, I=569, O=1593, H=1479 against
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
  textRunRect,
} from "./measurer.js";
import { EM_ASCENT, EM_CAP_HEIGHT, EM_DESCENT, EM_NOTDEF_ADVANCE } from "./metrics.js";

const FONT_SIZE_PX = 10;

const OPTIONS: MeasureRunOptions = {
  fontFamily: "Arial, Helvetica, sans-serif",
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
    const font = { family: "Arial", sizePx: FONT_SIZE_PX };
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
    const font = { family: "Arial", sizePx: FONT_SIZE_PX };
    const br = BUNDLED_MEASURER.measureText("Br", font).advanceWidthPx;
    const i = BUNDLED_MEASURER.measureText("I", font).advanceWidthPx;
    expect(br / i).toBeCloseTo(2048 / 569, 12);
    expect(br / i).not.toBeCloseTo(2, 1);
  });

  it("falls back to .notdef for anything outside the latin subset", () => {
    const font = { family: "Arial", sizePx: FONT_SIZE_PX };
    const omega = BUNDLED_MEASURER.measureText("Ω", font);
    expect(omega.advanceWidthPx).toBe(EM_NOTDEF_ADVANCE * FONT_SIZE_PX);
    expect(omega.advanceWidthPx).toBeGreaterThan(0);
    expect(omega.notdefCount).toBe(1);
  });

  it("counts a surrogate pair as one code point, not two", () => {
    // U+1D407 MATHEMATICAL BOLD CAPITAL H is two UTF-16 units. Charging it
    // twice would desynchronise our width from the browser's for exactly the
    // characters someone reached for because ASCII would not do.
    const font = { family: "Arial", sizePx: FONT_SIZE_PX };
    const bold = BUNDLED_MEASURER.measureText("\u{1D407}", font);
    expect(bold.notdefCount).toBe(1);
    expect(bold.advanceWidthPx).toBe(EM_NOTDEF_ADVANCE * FONT_SIZE_PX);
  });

  it("reports vertical metrics scaled to the requested size", () => {
    const v = BUNDLED_MEASURER.verticalMetrics({ family: "Arial", sizePx: 20 });
    expect(v.ascentPx).toBe(EM_ASCENT * 20);
    expect(v.descentPx).toBe(EM_DESCENT * 20);
    expect(v.capHeightPx).toBe(EM_CAP_HEIGHT * 20);
    // Descent is a positive depth, so a naive ascent+descent is the line box.
    expect(v.descentPx).toBeGreaterThan(0);
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
