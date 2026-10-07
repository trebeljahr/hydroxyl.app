import { describe, expect, it } from "vitest";
import { benzene } from "@starter/chem-core";

import { physicalFigureSize } from "../src/figure/physical.js";
import { composeFigure } from "../src/figure/compose.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { serializeScene } from "../src/svg/serialize.js";
import { NATURE_STYLE, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
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
