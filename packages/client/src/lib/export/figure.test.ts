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
  MAX_RASTER_SIDE_PX,
  rasterTooLarge,
  SAFE_RASTER_AREA_PX,
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
    expect(p.size.heightPx).toBeGreaterThan(MAX_RASTER_SIDE_PX);
    // Past the hard limits no probe is asked: no engine could say yes.
    expect(rasterTooLarge(p, () => true)).toMatch(/larger than any browser canvas/);
    expect(rasterTooLarge(prepared(threePanelDoc()))).toBeNull();
  });

  it("does not apply one engine's canvas cap to every browser: double column at 600 dpi", () => {
    // A two-column grid at 17.8 cm and 600 dpi is 4205 px wide; once it is
    // taller than about 0.95 of that it is past iOS Safari's 16,777,216 px
    // area, and still far inside Chromium's.
    const grid = createDocument({
      molecule: ethanol(),
      panels: (["skeletal", "lewis", "skeletal", "lewis", "sumFormula", "sumFormula"] as const).map(
        (kind) => createPanel(kind),
      ),
      figure: { columns: 2 },
      now: NOW,
    });
    const p = prepared(grid, { width: "double", customWidthCm: 12, dpi: 600 });
    expect(p.size.widthPx).toBe(4205);
    expect(p.size.widthPx * p.size.heightPx).toBeGreaterThan(SAFE_RASTER_AREA_PX);

    const asked: string[] = [];
    const probe = (fits: boolean) => (w: number, h: number) => {
      asked.push(`${w}x${h}`);
      return fits;
    };
    expect(rasterTooLarge(p, probe(true))).toBeNull();
    expect(rasterTooLarge(p, probe(false))).toMatch(/larger than this browser's canvas/);
    expect(asked).toEqual([`4205x${p.size.heightPx}`, `4205x${p.size.heightPx}`]);
    // No probe (a node caller): only the hard limits, which this is inside.
    expect(rasterTooLarge(p)).toBeNull();

    // Below the area every engine supports, the browser is never asked.
    asked.length = 0;
    expect(rasterTooLarge(prepared(threePanelDoc()), probe(false))).toBeNull();
    expect(asked).toEqual([]);
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
