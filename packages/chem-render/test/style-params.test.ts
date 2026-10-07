import { describe, expect, it } from "vitest";
import { benzene } from "@starter/chem-core";

import { acetate, ethanol } from "../src/fixtures.js";

import { physicalFigureSize } from "../src/figure/physical.js";
import { composeFigure } from "../src/figure/compose.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { serializeScene } from "../src/svg/serialize.js";
import { NATURE_STYLE, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import { serializeFigure } from "../src/svg/figure.js";
import type { ScenePrimitive, TextRunPrimitive } from "../src/scene/types.js";
import { BUNDLED_MEASURER, measureTextRun } from "../src/text/measurer.js";
import { FONT_FACE_FAMILY } from "../src/text/metrics.js";
import { woffBase64 } from "../src/text/woff.js";
import {
  NO_BACKGROUND,
  applyStyleOverrides,
  styleOverrideIssues,
  styleParams,
} from "../src/style-params.js";

describe("styleParams (decision 237)", () => {
  it("reads Publication as the ACS 1996 setting in print units", () => {
    const p = styleParams(PUBLICATION_STYLE);
    expect(p.bondLengthMm).toBeCloseTo(5.08, 12);
    expect(p.lineWidthPt).toBeCloseTo(0.6, 12);
    expect(p.fontSizePt).toBeCloseTo(10, 12);
    expect(p.background).toBe(NO_BACKGROUND);
    expect(p.bondColor).toBe("#000000");
  });

  it("reads Screen at the same printed bond, with its own heavier lines", () => {
    const p = styleParams(SCREEN_STYLE);
    expect(p.bondLengthMm).toBeCloseTo(5.08, 12);
    expect(p.lineWidthPt).toBeCloseTo((2 * 14.4) / 44, 12);
    expect(p.background).toBe("#ffffff");
  });
});

describe("styleParams on the Nature preset (decision 234)", () => {
  it("reads the structure guide's numbers back", () => {
    const p = styleParams(NATURE_STYLE);
    expect(p.bondLengthMm).toBeCloseTo(3.81, 9);
    expect(p.lineWidthPt).toBeCloseTo(0.6, 2);
    expect(p.wedgeWidthPt).toBeCloseTo(1.56, 2);
    expect(p.hashSpacingPt).toBeCloseTo(1.7, 2);
    expect(p.fontSizePt).toBeCloseTo(6, 2);
  });

  it("keeps the journal's text floor and columns when the bond is edited", () => {
    const style = applyStyleOverrides(NATURE_STYLE, { bondLengthMm: 5 });
    expect(style.print.bondLengthCm).toBeCloseTo(0.5, 12);
    expect(style.print.minTextPt).toBe(NATURE_STYLE.print.minTextPt);
    expect(style.print.columnWidthsCm).toBe(NATURE_STYLE.print.columnWidthsCm);
    expect(styleParams(style).fontSizePt).toBeCloseTo(styleParams(NATURE_STYLE).fontSizePt, 9);
  });
});

describe("applyStyleOverrides", () => {
  it("returns the preset object itself when nothing is edited", () => {
    expect(applyStyleOverrides(PUBLICATION_STYLE, {})).toBe(PUBLICATION_STYLE);
  });

  it("converts an edit to px and leaves unedited fields exactly as the preset has them", () => {
    const style = applyStyleOverrides(PUBLICATION_STYLE, { lineWidthPt: 1.2 });
    expect(style.bondLineWidthPx).toBe(2);
    expect(style.fontSizePx).toBe(PUBLICATION_STYLE.fontSizePx);
    expect(style.bondLengthPx).toBe(PUBLICATION_STYLE.bondLengthPx);
    expect(Object.isFrozen(style)).toBe(true);
    expect(styleParams(style).lineWidthPt).toBeCloseTo(1.2, 9);
  });

  it("keeps every printed size when the bond length changes, as ChemDraw does", () => {
    const style = applyStyleOverrides(PUBLICATION_STYLE, { bondLengthMm: 6 });
    const p = styleParams(style);
    expect(p.bondLengthMm).toBeCloseTo(6, 12);
    expect(p.lineWidthPt).toBeCloseTo(0.6, 9);
    expect(p.fontSizePt).toBeCloseTo(10, 9);
    // The scene's resolution does not move: the canvas zoom is in its bonds.
    expect(style.bondLengthPx).toBe(24);
    expect(style.bondLineWidthPx).toBeLessThan(PUBLICATION_STYLE.bondLineWidthPx);
  });

  it("prints a benzene figure at the edited bond length", () => {
    const style = applyStyleOverrides(PUBLICATION_STYLE, { bondLengthMm: 6 });
    const figure = composeFigure(benzene(), style, [
      { id: "p1", representation: representation("skeletal") },
    ]);
    expect(physicalFigureSize(figure, 17.8).bondLengthMm).toBeCloseTo(6, 6);
    const acs = composeFigure(benzene(), PUBLICATION_STYLE, [
      { id: "p1", representation: representation("skeletal") },
    ]);
    expect(physicalFigureSize(acs, 17.8).bondLengthMm).toBeCloseTo(5.08, 6);
  });

  it("draws benzene's bonds in the edited colour and width, on no background", () => {
    const style = applyStyleOverrides(SCREEN_STYLE, {
      bondColor: "#1d4ed8",
      lineWidthPt: 0.6,
      background: NO_BACKGROUND,
    });
    expect(style.colors.background).toBeUndefined();
    const scene = buildScene(benzene(), style, representation("kekule"));
    const lines = scene.primitives.filter((p) => p.type === "line");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.stroke.color).toBe("#1d4ed8");
      expect(line.stroke.width).toBeCloseTo((0.6 * 44) / 14.4, 9);
    }
    expect(serializeScene(scene)).not.toContain("<rect");
  });

  it("refuses a value outside its range, and an unknown key", () => {
    expect(() => applyStyleOverrides(PUBLICATION_STYLE, { lineWidthPt: 0 })).toThrow(RangeError);
    expect(styleOverrideIssues({ fontSizePt: 100 })).toHaveLength(1);
    expect(styleOverrideIssues({ bondColor: "red" })).toHaveLength(1);
    expect(styleOverrideIssues({ bondColor: "#ABCDEF" })).toHaveLength(1);
    expect(styleOverrideIssues({ labelColor: NO_BACKGROUND })).toHaveLength(1);
    expect(styleOverrideIssues({ background: NO_BACKGROUND })).toHaveLength(0);
    expect(styleOverrideIssues({ fontFamily: "Times" })).toHaveLength(1);
  });
});

describe("the label font (decision 250)", () => {
  it("reads every preset as Arimo regular", () => {
    for (const style of [PUBLICATION_STYLE, NATURE_STYLE, SCREEN_STYLE]) {
      expect(styleParams(style).fontFace).toBe("arimo");
      expect(styleParams(style).fontWeight).toBe("normal");
    }
  });

  it("sets the face's CSS stack and the weight, and nothing else", () => {
    const style = applyStyleOverrides(PUBLICATION_STYLE, { fontFace: "tinos", fontWeight: "bold" });
    expect(style.fontFamily).toBe(FONT_FACE_FAMILY.tinos);
    expect(style.fontWeight).toBe("bold");
    expect(style.fontSizePx).toBe(PUBLICATION_STYLE.fontSizePx);
    expect(style.bondLineWidthPx).toBe(PUBLICATION_STYLE.bondLineWidthPx);
    expect(styleParams(style).fontFace).toBe("tinos");
  });

  it("keeps the preset's own family string when the face is not changed", () => {
    const style = applyStyleOverrides(PUBLICATION_STYLE, { fontFace: "arimo", fontWeight: "bold" });
    expect(style.fontFamily).toBe(PUBLICATION_STYLE.fontFamily);
  });

  it("refuses a face or weight with no vendored table", () => {
    expect(styleOverrideIssues({ fontFace: "comic-sans" })).toEqual([
      { key: "fontFace", message: "fontFace must be one of arimo, tinos" },
    ]);
    expect(styleOverrideIssues({ fontFace: "Arimo" })).toHaveLength(1);
    expect(styleOverrideIssues({ fontWeight: "600" })).toHaveLength(1);
    expect(styleOverrideIssues({ fontWeight: 700 })).toHaveLength(1);
    expect(styleOverrideIssues({ fontFace: "tinos", fontWeight: "bold" })).toEqual([]);
    expect(() => applyStyleOverrides(PUBLICATION_STYLE, { fontWeight: "heavy" as never })).toThrow(RangeError);
  });

  it("draws ethanol's OH and acetate's O− bold only when asked, measured at bold widths", () => {
    const view = representation("skeletal");
    const boldStyle = applyStyleOverrides(PUBLICATION_STYLE, { fontWeight: "bold" });
    for (const mol of [ethanol(), acetate()]) {
      const regular = buildScene(mol, PUBLICATION_STYLE, view);
      const bold = buildScene(mol, boldStyle, view);
      expect(serializeScene(regular)).not.toContain("font-weight");
      expect(serializeScene(bold)).toContain('font-weight="bold"');
      const runs = (scene: ReturnType<typeof buildScene>): TextRunPrimitive[] => {
        const out: TextRunPrimitive[] = [];
        const visit = (p: ScenePrimitive): void => {
          if (p.type === "group") p.children.forEach(visit);
          else if (p.type === "textRun") out.push(p);
        };
        scene.primitives.forEach(visit);
        return out;
      };
      const width = (run: TextRunPrimitive): number =>
        measureTextRun(
          run.spans,
          {
            fontFamily: run.fontFamily,
            fontWeight: run.fontWeight,
            fontSizePx: run.fontSizePx,
            subscriptScale: PUBLICATION_STYLE.subscriptScale,
            anchor: run.anchor,
            baseline: "alphabetic",
          },
          BUNDLED_MEASURER,
        ).advanceWidthPx;
      const regularRuns = runs(regular);
      const boldRuns = runs(bold);
      expect(boldRuns.length).toBe(regularRuns.length);
      expect(boldRuns.length).toBeGreaterThan(0);
      boldRuns.forEach((run, i) => {
        expect(run.fontWeight).toBe("bold");
        // Never narrower. C, H, O and the digits keep their Arial widths in
        // Arial Bold, so these labels may measure equal; Br and Cl do not
        // (measurer.test.ts).
        expect(width(run)).toBeGreaterThanOrEqual(width(regularRuns[i]!));
      });
    }
  });

  it("embeds the chosen face's WOFF in the exported figure, and only that one", () => {
    const panels = [{ id: "s", representation: representation("skeletal") }];
    const svgFor = (overrides: Parameters<typeof applyStyleOverrides>[1]): string =>
      serializeFigure(
        composeFigure(ethanol(), applyStyleOverrides(PUBLICATION_STYLE, overrides), panels),
        { embedFont: true },
      );
    const tinosBold = svgFor({ fontFace: "tinos", fontWeight: "bold" });
    expect(tinosBold).toContain('@font-face{font-family:"Tinos"');
    expect(tinosBold).toContain(woffBase64("tinos", "bold"));
    expect(tinosBold).toContain("font-weight:700");
    expect(tinosBold).not.toContain(woffBase64("arimo", "normal"));
    expect(tinosBold).toContain("Tinos 1.340, Copyright The Tinos Project Authors");
    const arimo = svgFor({});
    expect(arimo).toContain(woffBase64("arimo", "normal"));
    expect(arimo).toContain("font-weight:400");
  });
});
