import { describe, expect, it } from "vitest";

import { benzylAlcoholAbbreviated, ethanol } from "@starter/chem-render";
import { emptyMolecule } from "@starter/chem-core";
import { createDocument, createPanel, defaultPanelsFor } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import type { FigureExportSettings } from "@/state/types";

import {
  documentFigure,
  exportWidthCm,
  figurePreviewSvg,
  figureSvgForFile,
  figureSvgForRaster,
  prepareFigure,
  rasterTooLarge,
} from "./figure";

const NOW = "2024-01-01T00:00:00.000Z";
const SINGLE_300: FigureExportSettings = { width: "single", customWidthCm: 12, dpi: 300 };

function threePanelDoc(molecule = ethanol()): SketchDocument {
  const [skeletal, sum] = defaultPanelsFor("screen");
  return createDocument({
    title: "Ethanol",
    molecule,
    panels: [skeletal!, createPanel("lewis", "Lewis"), sum!],
    now: NOW,
  });
}

function prepared(doc: SketchDocument, settings = SINGLE_300) {
  const result = prepareFigure(doc, settings);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("the figure a document exports", () => {
  it("composes the document's panels in order, with its column count", () => {
    const figure = documentFigure({ ...threePanelDoc(), figure: { columns: 2 } });
    expect(figure.cells.map((c) => c.representation.kind)).toEqual(["skeletal", "lewis", "sumFormula"]);
    expect(figure.columns).toBe(2);
    expect(documentFigure(threePanelDoc()).columns).toBe(3);
  });

  it("writes an SVG with physical dimensions matching the single-column preset", () => {
    const svg = figureSvgForFile(prepared(threePanelDoc()));
    expect(svg).toContain('width="8.25cm"');
    expect(svg).toMatch(/height="[\d.]+cm"/);
    expect(svg).toContain("@font-face");
    expect(svg).not.toContain("var(--");
    expect(svg).not.toMatch(/\sclass=/);
    expect(svg).not.toContain("data-overlay");
    expect(svg).not.toContain('data-decoration="background"');
    expect([...svg.matchAll(/data-panel-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "(a)",
      "(b)",
      "(c)",
    ]);
  });

  it("sizes the raster source in the pixels 8.25 cm at 300 dpi implies", () => {
    const p = prepared(threePanelDoc());
    expect(p.size.widthPx).toBe(974);
    const svg = figureSvgForRaster(p);
    expect(svg).toContain(`width="974px"`);
    expect(svg).toContain(`height="${p.size.heightPx}px"`);
    // White under the raster, so a viewer that flattens alpha does not paint black.
    expect(svg).toContain('fill="#ffffff"');
  });

  it("derives the double-column pixel width at 600 dpi", () => {
    const p = prepared(threePanelDoc(), { width: "double", customWidthCm: 12, dpi: 600 });
    expect(p.size.widthCm).toBe(17.8);
    expect(p.size.widthPx).toBe(4205);
  });

  it("accepts a custom width in range and refuses one outside it", () => {
    expect(exportWidthCm({ width: "custom", customWidthCm: 12.5, dpi: 300 })).toEqual({
      ok: true,
      widthCm: 12.5,
    });
    expect(exportWidthCm({ width: "custom", customWidthCm: 0, dpi: 300 }).ok).toBe(false);
    expect(exportWidthCm({ width: "custom", customWidthCm: Number.NaN, dpi: 300 }).ok).toBe(false);
  });

  it("refuses a raster a browser canvas cannot hold", () => {
    const tall = createDocument({
      molecule: ethanol(),
      panels: Array.from({ length: 12 }, () => createPanel("lewis")),
      figure: { columns: 1 },
      now: NOW,
    });
    const p = prepared(tall, { width: "custom", customWidthCm: 60, dpi: 600 });
    expect(rasterTooLarge(p)).toMatch(/larger than a browser canvas/);
    expect(rasterTooLarge(prepared(threePanelDoc()))).toBeNull();
  });
});

describe("refusals", () => {
  it("refuses an empty drawing and a figure with no panels", () => {
    const empty = prepareFigure(createDocument({ molecule: emptyMolecule(), now: NOW }), SINGLE_300);
    expect(empty.ok).toBe(false);
    const noPanels = prepareFigure(
      createDocument({ molecule: ethanol(), panels: [], now: NOW }),
      SINGLE_300,
    );
    expect(noPanels.ok === false && noPanels.message).toMatch(/no panels/);
  });

  it("refuses a figure with an unavailable panel, naming the panel and the reason", () => {
    const result = prepareFigure(threePanelDoc(benzylAlcoholAbbreviated()), SINGLE_300);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Panel (c)");
    expect(result.message).toContain("Ph");
  });

  it("still previews that figure, with the unavailable panel marked rather than empty", () => {
    const svg = figurePreviewSvg(threePanelDoc(benzylAlcoholAbbreviated()));
    expect(svg).toContain('data-unavailable="abbreviated-label"');
    expect(svg).toContain("Sum formula view unavailable.");
  });
});
