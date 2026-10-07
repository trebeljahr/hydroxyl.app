import { chemistryIssues, implicitHydrogenCount, requireAtom } from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import { exampleNamed } from "@/components/landing/example-document";

import { chargeRows, forgottenMinus, guideFigures, mistakeReport, signed } from "./formal-charges";
import { fixedAmmonium, unchargedAmmonium } from "./formal-charges-examples";
import { guideBySlug } from "./guides";

describe("the formal-charge table", () => {
  const rows = chargeRows();

  it("closes the textbook rule on every row: valence − lone-pair electrons − bonds", () => {
    for (const row of rows) {
      expect(row.counted, row.atom).toBe(
        row.valenceElectrons - row.lonePairElectrons - row.bonds,
      );
    }
  });

  it("agrees with the charge drawn on every correct structure, and not on the mistake", () => {
    const [nh3, nh4, carbonyl, oxide, mistake] = rows;
    expect([nh3, nh4, carbonyl, oxide].map((r) => [r!.counted, r!.drawn])).toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
      [-1, -1],
    ]);
    // Ammonia's single pair, acetate's three on the oxide: the Lewis view's own counts.
    expect(nh3!.lonePairElectrons).toBe(2);
    expect(nh4!.lonePairElectrons).toBe(0);
    expect(oxide!.lonePairElectrons).toBe(6);
    expect(carbonyl!.lonePairElectrons).toBe(4);
    expect(carbonyl!.bonds).toBe(2);
    expect([mistake!.counted, mistake!.drawn]).toEqual([1, 0]);
  });

  it("writes charges with a real minus sign", () => {
    expect([signed(1), signed(0), signed(-1)]).toEqual(["+1", "0", "−1"]);
  });
});

describe("the mistake and its fix", () => {
  it("quotes chem-core's issue and its single fix", () => {
    const report = mistakeReport();
    expect(report.atomName).toBe("N · atom 1");
    expect(report.canvasLabel).toBe("N has 4 bonds; max 3");
    expect(report.listMessage).toBe("N has 4 bonds but allows at most 3");
    expect(report.fixTitles).toEqual(["Make it N⁺"]);
    expect(report.issuesAfterFix).toBe(0);
    expect(report.chargeAfterFix).toBe("+1");
  });

  it("repairs the drawing without adding a hydrogen", () => {
    const fixed = fixedAmmonium();
    expect(chemistryIssues(fixed)).toHaveLength(0);
    const n = fixed.atomIds.find((id) => requireAtom(fixed, id).element === "N")!;
    expect(implicitHydrogenCount(fixed, n)).toBe(0);
    expect(fixed.atomIds).toHaveLength(unchargedAmmonium().atomIds.length);
  });
});

describe("the forgotten minus on acetate", () => {
  it("raises no error and turns the ion into acetic acid", () => {
    expect(forgottenMinus()).toEqual({ ion: "C₂H₃O₂⁻", neutral: "C₂H₄O₂", issues: 0 });
  });
});

describe("the guide's figures", () => {
  it("export, and each opens in the editor as the document it draws", () => {
    const figures = guideFigures();
    for (const [key, figure] of Object.entries(figures)) {
      expect(figure.svg, key).toMatch(/^<svg/);
      expect(figure.widthCm, key).toBeGreaterThan(0);
    }
    for (const figure of guideBySlug("formal-charges-and-lone-pairs").figures) {
      expect(exampleNamed(figure.example), figure.example).not.toBeNull();
    }
  });

  it("opens the mistake with its error still in it", () => {
    const doc = exampleNamed("formal-charges-mistake")!;
    expect(chemistryIssues(doc.molecule).map((i) => i.kind)).toEqual(["over-valent"]);
  });
});
