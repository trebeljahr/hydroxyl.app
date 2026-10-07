/**
 * The drift test for the generated font tables.
 *
 * `src/text/generated/<face>-metrics.ts` is committed rather than parsed at
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
  addedUnicodeRange,
  extractMetrics,
  FACES,
  fontSha256,
  generateFace,
} from "../scripts/generate-font-metrics.mjs";
import {
  ASCENDER,
  CAP_HEIGHT,
  DESCENDER,
  INK_BOUNDS,
  NOTDEF_ADVANCE,
  NOTDEF_INK,
  UNITS_PER_EM,
  X_HEIGHT,
  ADVANCE_WIDTHS,
} from "../src/text/generated/arimo-400-metrics.js";
import * as ARIMO_400 from "../src/text/generated/arimo-400-metrics.js";
import * as ARIMO_700 from "../src/text/generated/arimo-700-metrics.js";
import * as TINOS_400 from "../src/text/generated/tinos-400-metrics.js";
import * as TINOS_700 from "../src/text/generated/tinos-700-metrics.js";
import {
  EM_ASCENT,
  EM_CAP_HEIGHT,
  EM_DESCENT,
  EM_NOTDEF_ADVANCE,
  EM_X_HEIGHT,
  FONT_FACES,
  FONT_WEIGHTS,
  advanceWidthUnits,
  faceMetrics,
  glyphInkUnits,
} from "../src/text/metrics.js";
import { GREEK_UNICODE_RANGE, greekWoffBase64, woffBase64 } from "../src/text/woff.js";

/** Each generated module, by the generator's face id. */
const TABLES = {
  "arimo-400": ARIMO_400,
  "arimo-700": ARIMO_700,
  "tinos-400": TINOS_400,
  "tinos-700": TINOS_700,
} as const;

/** The (face, weight) each generator id is served as. */
const SERVED_AS = {
  "arimo-400": ["arimo", "normal"],
  "arimo-700": ["arimo", "bold"],
  "tinos-400": ["tinos", "normal"],
  "tinos-700": ["tinos", "bold"],
} as const;

/**
 * The face each table must name. Metric compatibility is the whole reason a
 * style may declare Arial or Times after it, so a merely similar face swapped
 * in would keep every other check green and every label subtly wrong.
 */
const FAMILY = { "arimo-400": "Arimo", "arimo-700": "Arimo", "tinos-400": "Tinos", "tinos-700": "Tinos" } as const;

type Face = (typeof FACES)[number] & { readonly id: keyof typeof TABLES };

describe.each((FACES as readonly Face[]).map((face) => [face.id, face] as const))(
  "the committed %s table still describes its vendored fonts",
  (id, face) => {
    const bytes = readFileSync(face.fontPath);
    const greekBytes = readFileSync(face.greekFontPath);
    const latin = extractMetrics(bytes);
    const greek = extractMetrics(greekBytes);
    const generated = generateFace(face);
    // The committed table is the Latin file plus what the Greek file adds
    // (decision 252).
    const extracted = generated.metrics;
    const table = TABLES[id];
    const [faceName, weight] = SERVED_AS[id];

    it("came from these exact bytes", () => {
      // The sha is the one assertion that fails when a WOFF is replaced
      // wholesale — a new upstream release with identical metrics would slip
      // past every other check here.
      expect(fontSha256(bytes)).toBe(table.FONT_SHA256);
      expect(fontSha256(greekBytes)).toBe(table.GREEK_FONT_SHA256);
    });

    it("names the same face, release and weight", () => {
      expect(extracted.family).toBe(table.FONT_FAMILY);
      expect(extracted.version).toBe(table.FONT_VERSION);
      expect(table.FONT_FAMILY).toBe(FAMILY[id]);
      expect(extracted.weight).toBe(table.FONT_WEIGHT);
      expect(table.FONT_WEIGHT).toBe(id.endsWith("700") ? 700 : 400);
    });

    it("agrees on the em and every vertical metric", () => {
      expect(extracted.unitsPerEm).toBe(table.UNITS_PER_EM);
      // The PDF writer's glyph space assumes it for every face.
      expect(table.UNITS_PER_EM).toBe(2048);
      expect(extracted.ascender).toBe(table.ASCENDER);
      expect(extracted.descender).toBe(table.DESCENDER);
      expect(extracted.capHeight).toBe(table.CAP_HEIGHT);
      expect(extracted.xHeight).toBe(table.X_HEIGHT);
      expect(extracted.notdefAdvance).toBe(table.NOTDEF_ADVANCE);
      // The OS/2 descender is stored signed, as the spec requires.
      expect(table.DESCENDER).toBeLessThan(0);
    });

    it("agrees on every advance width and every glyph's ink box", () => {
      // Deep equality over the whole list rather than a spot check. The ink
      // boxes decide proximity and overprint for annotations (decisions 55
      // and 57); a stale one moves a placement silently.
      expect(extracted.widths).toEqual(table.ADVANCE_WIDTHS.map(([cp, w]) => [cp, w]));
      expect(extracted.inks).toEqual(table.INK_BOUNDS.map((row) => [...row]));
      expect(extracted.notdefInk).toEqual(table.NOTDEF_INK === undefined ? null : [...table.NOTDEF_INK]);
    });

    it("regenerates the committed files byte for byte", () => {
      // Stronger than the field checks: the generator's output IS the file, so
      // a hand edit anywhere in it — a comment included — fails here.
      expect(generated.metricsTs).toBe(readFileSync(face.outPath, "utf8"));
      expect(generated.woffTs).toBe(readFileSync(face.woffOutPath, "utf8"));
    });

    it("is codepoint-ascending with no duplicates", () => {
      // The lookup builds a Map from these pairs; a duplicate codepoint would
      // silently keep the last one, and the ordering is what makes the
      // generated file reviewable as a diff.
      const widths = table.ADVANCE_WIDTHS;
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]![0]).toBeGreaterThan(widths[i - 1]![0]);
      }
      expect(new Set(widths.map(([cp]) => cp)).size).toBe(widths.length);
    });

    it("takes the Latin and Greek files from one release, with one em and one set of vertical metrics", () => {
      // mergeMetrics refuses files that disagree; this pins that they do not.
      for (const key of ["version", "weight", "unitsPerEm", "ascender", "descender", "capHeight", "xHeight"] as const) {
        expect(greek[key], key).toBe(latin[key]);
      }
      // Where both have a code point (only the spaces), they agree on its width.
      const latinWidths = new Map(latin.widths);
      for (const [cp, width] of greek.widths) {
        if (latinWidths.has(cp)) expect(width, cp.toString(16)).toBe(latinWidths.get(cp));
      }
    });

    it("covers the Greek letters chemistry sets (decision 252), over the one unicode-range", () => {
      for (const character of "αβγδΔμΩ") {
        const codepoint = character.codePointAt(0)!;
        expect(table.ADVANCE_WIDTHS.some(([cp]) => cp === codepoint), character).toBe(true);
      }
      // `woff.ts` serves one range for every face, so each must add exactly it.
      expect(addedUnicodeRange(latin, greek)).toBe(GREEK_UNICODE_RANGE);
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
          table.ADVANCE_WIDTHS.some(([cp]) => cp === codepoint),
          `${character} (U+${codepoint.toString(16).padStart(4, "0")}) is missing from the subset`,
        ).toBe(true);
      }
    });

    it("is the table metrics.ts serves for its face and weight", () => {
      const served = faceMetrics(faceName, weight);
      expect(served.sha256).toBe(table.FONT_SHA256);
      expect(served.emCapHeight).toBe(table.CAP_HEIGHT / table.UNITS_PER_EM);
      for (const [codepoint, advance] of table.ADVANCE_WIDTHS) {
        expect(served.advanceWidthUnits(codepoint)).toBe(advance);
      }
    });

    it("embeds as the exact bytes the metrics were measured from", () => {
      // An exported figure embeds these strings. If one drifted from the WOFF
      // the table was generated against, labels would be laid out for one face
      // and drawn in another — the failure the whole metrics pipeline exists
      // to rule out.
      const decoded = Buffer.from(woffBase64(faceName, weight), "base64");
      expect(fontSha256(decoded)).toBe(table.FONT_SHA256);
      expect(decoded.equals(bytes)).toBe(true);
      const decodedGreek = Buffer.from(greekWoffBase64(faceName, weight), "base64");
      expect(fontSha256(decodedGreek)).toBe(table.GREEK_FONT_SHA256);
      expect(decodedGreek.equals(greekBytes)).toBe(true);
    });
  },
);

describe("the vendored faces (decision 250)", () => {
  it("cover every face and weight a style can name, each from its own files", () => {
    expect(FACES).toHaveLength(FONT_FACES.length * FONT_WEIGHTS.length);
    const shas = FONT_FACES.flatMap((f) => FONT_WEIGHTS.map((w) => faceMetrics(f, w).sha256));
    expect(new Set(shas).size).toBe(shas.length);
  });

  it("give bold its own, wider advances", () => {
    // Arimo is metric-compatible with Arial, so its bold advances are Arial
    // Bold's. Not every glyph widens — Arial Bold's "O" is exactly as wide as
    // Arial's — but a bold table equal to the regular one would mean the
    // generator read the same file twice.
    const regular = faceMetrics("arimo", "normal");
    const bold = faceMetrics("arimo", "bold");
    const labels = "BrClNaOHSiMgCa0123456789";
    expect(bold.advanceWidthUnitsOf(labels).units).toBeGreaterThan(regular.advanceWidthUnitsOf(labels).units);
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
    // Outside both subsets (a CJK ideograph): .notdef's box, which still paints.
    expect(glyphInkUnits(0x4e00)).toEqual(
      NOTDEF_INK === undefined
        ? undefined
        : { xMin: NOTDEF_INK[0], yMin: NOTDEF_INK[1], xMax: NOTDEF_INK[2], yMax: NOTDEF_INK[3] },
    );
  });

  it("looks up covered code points and falls back for the rest", () => {
    for (const [codepoint, advance] of ADVANCE_WIDTHS) {
      expect(advanceWidthUnits(codepoint)).toBe(advance);
    }
    // A CJK ideograph is in neither subset.
    expect(advanceWidthUnits(0x4e00)).toBe(NOTDEF_ADVANCE);
  });
});
