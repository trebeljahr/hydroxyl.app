import { describe, expect, it } from "vitest";

import { molecularFormula } from "@starter/chem-core";
import { MIN_PRINTED_LABEL_PT } from "@starter/chem-render";

import { EXAMPLE_VIEWS, exampleDocument, exampleFigure, exampleMolecule } from "./example-figure";

describe("the landing page's example figure", () => {
  it("is acetic acid", () => {
    expect(molecularFormula(exampleMolecule())).toBe("C2H4O2");
  });

  it("goes through the export path with every panel drawable", () => {
    // `exampleFigure` throws when `prepareFigure` refuses — which it does for
    // any panel whose view cannot draw this molecule. A condensed formula of a
    // ring, say, would fail the build here rather than ship a false claim.
    const figure = exampleFigure();
    expect(figure.panelCount).toBe(EXAMPLE_VIEWS.length);
    expect(figure.svg.startsWith("<svg")).toBe(true);
    for (const kind of EXAMPLE_VIEWS) expect(figure.svg).toContain(`data-view="${kind}"`);
  });

  it("prints its labels at or above the minimum the page talks about", () => {
    // The page says the dialog warns under 8 pt. Its own showcase must not be
    // a figure the dialog would warn about.
    const labelPt = Number.parseFloat(exampleFigure().labelSize);
    expect(labelPt).toBeGreaterThanOrEqual(MIN_PRINTED_LABEL_PT);
  });

  it("carries no embedded font, since it is inline in every page load", () => {
    expect(exampleFigure().svg).not.toContain("@font-face");
  });

  it("is the same bytes on every build", () => {
    expect(exampleFigure().svg).toBe(exampleFigure().svg);
    expect(exampleDocument().panels.map((panel) => panel.id)).toEqual(
      EXAMPLE_VIEWS.map((kind) => `panel-example-${kind}`),
    );
  });
});
