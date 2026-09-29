import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
} from "@starter/chem-render";
import { describe, expect, it } from "vitest";

import { ACS_GUIDELINE, cmFromPt, guideNumbers, ptFromCm } from "./journal-figure-size";

const numbers = guideNumbers();

describe("the guide's product numbers", () => {
  it("are chem-render's constants, not copies of them", () => {
    expect(numbers.bondCm).toBe(String(PRINTED_BOND_LENGTH_CM));
    expect(numbers.singleCm).toBe(String(JOURNAL_WIDTHS_CM.single));
    expect(numbers.doubleCm).toBe(String(JOURNAL_WIDTHS_CM.double));
    expect(numbers.minLabelPt).toBe(String(MIN_PRINTED_LABEL_PT));
  });

  it("read the Publication style at the printed bond as the ACS 1996 setting", () => {
    expect(numbers.bondPt).toBe("14.4");
    expect(numbers.labelPt).toBe("10");
    expect(numbers.lineWidthPt).toBe("0.6");
  });

  it("let a Publication figure shrink to 80 % before its labels pass 8 pt", () => {
    expect(numbers.shrinkFloorPercent).toBe("80");
    // 8.25 / 0.8 = 10.3125, rounded down so the width keeps 8 pt.
    expect(numbers.maxNaturalSingleCm).toBe("10.3");
  });
});

describe("the ACS numbers the guide quotes", () => {
  it("agree with the product where the product follows them", () => {
    expect(cmFromPt(ACS_GUIDELINE.bondLengthPt)).toBeCloseTo(PRINTED_BOND_LENGTH_CM, 3);
    expect(Number(numbers.labelPt)).toBe(ACS_GUIDELINE.labelPt);
    expect(Number(numbers.lineWidthPt)).toBe(ACS_GUIDELINE.lineWidthPt);
    expect(MIN_PRINTED_LABEL_PT).toBe(ACS_GUIDELINE.minArtworkTextPt);
  });

  it("convert 240 pt and 300–504 pt to centimetres", () => {
    expect(numbers.acsSingleCm).toBe("8.47");
    expect(numbers.acsDoubleMinCm).toBe("10.58");
    expect(numbers.acsDoubleMaxCm).toBe("17.78");
  });

  it("put the product's single column inside the ACS one, and its double column at 7 in to the millimetre", () => {
    // If either side moves, the page's sentence about the difference is wrong.
    expect(JOURNAL_WIDTHS_CM.single).toBeLessThan(cmFromPt(ACS_GUIDELINE.singleColumnMaxPt));
    expect(JOURNAL_WIDTHS_CM.double).toBe(Number(cmFromPt(ACS_GUIDELINE.doubleColumnMaxPt).toFixed(1)));
    expect(ptFromCm(cmFromPt(240))).toBeCloseTo(240, 9);
  });

  it("quote one sentence that states the number it is quoted for", () => {
    expect(ACS_GUIDELINE.quote).toContain(`${ACS_GUIDELINE.singleColumnMaxPt} points`);
    expect(ACS_GUIDELINE.quote.split(/\s+/).length).toBeLessThan(15);
  });
});

describe("the worked example", () => {
  it("prints two panels to a row at full size", () => {
    const { twoPerRow } = numbers;
    expect(twoPerRow.columns).toBe(2);
    expect(twoPerRow.scaleNotice).toBeNull();
    expect(twoPerRow.labelNotice).toBeNull();
    expect(twoPerRow.widthCm).toBeCloseTo(twoPerRow.naturalWidthCm, 9);
    expect(twoPerRow.widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single);
    expect(twoPerRow.fontSizePt).toBe("10.0");
  });

  it("shrinks four in a row to the column, labels and all, and warns as the dialog does", () => {
    const { oneRow } = numbers;
    expect(oneRow.columns).toBe(4);
    expect(oneRow.naturalWidthCm).toBeGreaterThan(Number(numbers.maxNaturalSingleCm));
    expect(oneRow.widthCm).toBe(JOURNAL_WIDTHS_CM.single);
    expect(oneRow.scaleNotice).toMatch(/^Scaled to \d+% to fit a single column\.$/);
    expect(Number(oneRow.fontSizePt)).toBeLessThan(MIN_PRINTED_LABEL_PT);
    expect(oneRow.labelNotice).toContain(`below the ${MIN_PRINTED_LABEL_PT} pt minimum`);
  });

  it("gives the two inline figures different element ids", () => {
    const ids = (svg: string): string[] => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
    const shared = ids(numbers.twoPerRow.svg).filter((id) => ids(numbers.oneRow.svg).includes(id));
    expect(shared).toEqual([]);
  });
});
