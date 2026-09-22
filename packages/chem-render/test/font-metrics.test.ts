/**
 * The drift test for the generated font table.
 *
 * `src/text/generated/arimo-metrics.ts` is committed rather than parsed at
 * startup, because chem-render has to measure identically in a Node test, in a
 * static export and in the browser, with no filesystem access anywhere. That
 * is the right trade, but it buys a new failure mode: a table that no longer
 * describes the font shipped beside it. Every label in every figure would then
 * be measured against a face nobody is drawing with, and the symptom — labels
 * a shade too wide, boxes a shade too loose — is exactly the kind that gets
 * looked at and dismissed.
 *
 * So this test re-runs the generator's own extraction against the same WOFF
 * bytes and demands the committed numbers still match, field by field and
 * advance by advance. It is the reason the rest of the package may treat the
 * generated table as ground truth.
 *
 * `node:fs` appears HERE and nowhere in `src/`. The runtime never reads the
 * font; only this test does.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  extractMetrics,
  fontSha256,
  OUT_PATH,
  render,
} from "../scripts/generate-font-metrics.mjs";
import {
  ADVANCE_WIDTHS,
  ASCENDER,
  CAP_HEIGHT,
  DESCENDER,
  FONT_FAMILY,
  FONT_SHA256,
  FONT_VERSION,
  INK_BOUNDS,
  NOTDEF_ADVANCE,
  NOTDEF_INK,
  UNITS_PER_EM,
  X_HEIGHT,
} from "../src/text/generated/arimo-metrics.js";
import { ARIMO_WOFF_BASE64 } from "../src/text/generated/arimo-woff.js";
import {
  EM_ASCENT,
  EM_CAP_HEIGHT,
  EM_DESCENT,
  EM_NOTDEF_ADVANCE,
  EM_X_HEIGHT,
  advanceWidthUnits,
  glyphInkUnits,
} from "../src/text/metrics.js";

const FONT_BYTES = readFileSync(
  new URL("../assets/arimo-latin-400-normal.woff", import.meta.url),
);

const EXTRACTED = extractMetrics(FONT_BYTES);

describe("the committed table still describes the vendored font", () => {
  it("came from these exact bytes", () => {
    // The sha is the one assertion that fails when the WOFF is replaced
    // wholesale — a new upstream release with identical metrics would slip
    // past every other check here.
    expect(fontSha256(FONT_BYTES)).toBe(FONT_SHA256);
  });

  it("names the same face and release", () => {
    expect(EXTRACTED.family).toBe(FONT_FAMILY);
    expect(EXTRACTED.version).toBe(FONT_VERSION);
    // Metric compatibility with Arial/Helvetica is why both presets can
    // declare that stack and still be measured by this table. Swapping in a
    // face that is merely similar would keep every test below green and make
    // every label subtly wrong, so pin the name.
    expect(FONT_FAMILY).toBe("Arimo");
  });

  it("agrees on the em and every vertical metric", () => {
    expect(EXTRACTED.unitsPerEm).toBe(UNITS_PER_EM);
    expect(EXTRACTED.ascender).toBe(ASCENDER);
    expect(EXTRACTED.descender).toBe(DESCENDER);
    expect(EXTRACTED.capHeight).toBe(CAP_HEIGHT);
    expect(EXTRACTED.xHeight).toBe(X_HEIGHT);
    expect(EXTRACTED.notdefAdvance).toBe(NOTDEF_ADVANCE);
    // The OS/2 descender is stored signed, as the spec requires.
    expect(DESCENDER).toBeLessThan(0);
  });

  it("agrees on every advance width", () => {
    // Deep equality over the whole list rather than a spot check: a subset
    // regenerated from a different character set would differ only in the
    // entries nobody thought to sample.
    expect(EXTRACTED.widths).toEqual(ADVANCE_WIDTHS.map(([cp, w]) => [cp, w]));
  });

  it("agrees on every glyph's ink box", () => {
    // The ink boxes decide proximity and overprint for annotations
    // (decisions 55 and 57); a stale one moves a placement silently.
    expect(EXTRACTED.inks).toEqual(INK_BOUNDS.map((row) => [...row]));
    expect(EXTRACTED.notdefInk).toEqual(NOTDEF_INK === undefined ? null : [...NOTDEF_INK]);
  });

  it("regenerates the committed file byte for byte", () => {
    // Stronger than the field checks: the generator's output IS the file, so
    // a hand edit anywhere in it — a comment included — fails here.
    expect(render(EXTRACTED, fontSha256(FONT_BYTES))).toBe(readFileSync(OUT_PATH, "utf8"));
  });

  it("is codepoint-ascending with no duplicates", () => {
    // `advanceWidthUnits` builds a Map from these pairs; a duplicate codepoint
    // would silently keep the last one, and the ordering is what makes the
    // generated file reviewable as a diff.
    for (let i = 1; i < ADVANCE_WIDTHS.length; i++) {
      const previous = ADVANCE_WIDTHS[i - 1];
      const current = ADVANCE_WIDTHS[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(current![0]).toBeGreaterThan(previous![0]);
    }
    expect(new Set(ADVANCE_WIDTHS.map(([cp]) => cp)).size).toBe(
      ADVANCE_WIDTHS.length,
    );
  });

  it("covers the characters chemical labels are actually made of", () => {
    // Element symbols, hydrogen counts, the two charge signs. U+2212 MINUS
    // SIGN in particular: a label that fell back to the ASCII hyphen would
    // still render, just short and low and reading as a bond.
    const required = [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ..."abcdefghijklmnopqrstuvwxyz",
      ..."0123456789",
      "+",
      "−",
      " ",
    ];
    for (const character of required) {
      const codepoint = character.codePointAt(0)!;
      expect(
        ADVANCE_WIDTHS.some(([cp]) => cp === codepoint),
        `${character} (U+${codepoint.toString(16).padStart(4, "0")}) is missing from the subset`,
      ).toBe(true);
    }
  });
});

describe("metrics.ts derives em fractions from the table", () => {
  it("converts each vertical metric exactly once", () => {
    expect(EM_ASCENT).toBe(ASCENDER / UNITS_PER_EM);
    expect(EM_CAP_HEIGHT).toBe(CAP_HEIGHT / UNITS_PER_EM);
    expect(EM_X_HEIGHT).toBe(X_HEIGHT / UNITS_PER_EM);
    expect(EM_NOTDEF_ADVANCE).toBe(NOTDEF_ADVANCE / UNITS_PER_EM);
    // A 2048-unit em makes every one of these dyadic, hence exact.
    expect(EM_ASCENT).toBe(0.9052734375);
    expect(EM_CAP_HEIGHT).toBe(0.68798828125);
    expect(EM_NOTDEF_ADVANCE).toBe(0.75);
  });

  it("reports the descender as a positive depth", () => {
    // The sign flip is a convention on a length, not a coordinate flip. If
    // this ever comes back negative, something downstream will "fix" it with a
    // second negation and every label will sit a fifth of an em too high.
    expect(EM_DESCENT).toBeGreaterThan(0);
    expect(EM_DESCENT).toBe(0.2119140625);
    expect(EM_DESCENT).toBe(-DESCENDER / UNITS_PER_EM);
  });

  it("gives digits ink from the baseline to the cap height, and none to a space", () => {
    // Real outlines, not the typographic band: a digit's ink stops just
    // below the baseline's overshoot and at about the cap height, and a
    // parenthesis reaches below the baseline.
    const zero = glyphInkUnits(0x30)!;
    expect(zero.yMin).toBeLessThanOrEqual(0);
    expect(zero.yMin).toBeGreaterThan(DESCENDER);
    expect(zero.yMax).toBeGreaterThan(CAP_HEIGHT * 0.95);
    expect(zero.yMax).toBeLessThan(ASCENDER);
    expect(glyphInkUnits(0x28)!.yMin).toBeLessThan(-200);
    expect(glyphInkUnits(0x20)).toBeUndefined();
    // Outside the subset: .notdef's box, which still paints.
    expect(glyphInkUnits(0x03a9)).toEqual(
      NOTDEF_INK === undefined
        ? undefined
        : { xMin: NOTDEF_INK[0], yMin: NOTDEF_INK[1], xMax: NOTDEF_INK[2], yMax: NOTDEF_INK[3] },
    );
  });

  it("looks up covered code points and falls back for the rest", () => {
    for (const [codepoint, advance] of ADVANCE_WIDTHS) {
      expect(advanceWidthUnits(codepoint)).toBe(advance);
    }
    // Greek omega is not in a latin subset.
    expect(advanceWidthUnits(0x03a9)).toBe(NOTDEF_ADVANCE);
  });
});

describe("the embeddable font string is the vendored font", () => {
  it("decodes to the exact bytes the metrics were measured from", () => {
    // An exported figure embeds this string. If it drifted from the WOFF the
    // table was generated against, labels would be laid out for one face and
    // drawn in another — the failure the whole metrics pipeline exists to
    // rule out.
    const decoded = Buffer.from(ARIMO_WOFF_BASE64, "base64");
    expect(fontSha256(decoded)).toBe(FONT_SHA256);
    expect(decoded.equals(FONT_BYTES)).toBe(true);
  });
});
