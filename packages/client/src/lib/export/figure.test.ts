import { describe, expect, it } from "vitest";

import {
  JOURNAL_WIDTHS_CM,
  PRINTED_BOND_LENGTH_CM,
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  benzylAlcoholAbbreviated,
  ethanol,
} from "@starter/chem-render";
import { benzene, buildMolecule, emptyMolecule, linearChain } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
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
  scaleNotice,
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

/**
 * Four methanes on the corners of a `side`-bond square: the cheapest drawing
 * whose figure is as tall as it is wide at any size, for the raster limits.
 */
function methaneSquare(side: number): Molecule {
  return buildMolecule((b) => {
    for (const [x, y] of [[0, 0], [side, 0], [0, side], [side, side]] as const) {
      b.atom("C", { x, y });
    }
  });
}

function onePanelDoc(molecule: Molecule, stylePreset: "screen" | "publication" = "screen"): SketchDocument {
  return createDocument({
    molecule,
    stylePreset,
    panels: [createPanel("skeletal")],
    now: NOW,
  });
}

/** cm per viewBox unit times px per bond: the bond a renderer of the file prints. */
function printedBondCm(svg: string, bondLengthPx: number): number {
  const width = Number.parseFloat(/<svg[^>]*\swidth="([\d.]+)cm"/.exec(svg)![1]!);
  const viewBoxWidth = Number(/<svg[^>]*\sviewBox="([^"]*)"/.exec(svg)![1]!.split(" ")[2]);
  return (width / viewBoxWidth) * bondLengthPx;
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

  it("writes a small figure at its natural size, narrower than the column, with a 0.508 cm bond", () => {
    const p = prepared(threePanelDoc());
    expect(p.size.scaled).toBe(false);
    expect(p.size.widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single);
    expect(scaleNotice(p.size, SINGLE_300)).toBeNull();
    const svg = figureSvgForFile(p);
    expect(svg).not.toContain('width="8.25cm"');
    expect(printedBondCm(svg, SCREEN_STYLE.bondLengthPx)).toBeCloseTo(PRINTED_BOND_LENGTH_CM, 4);
    expect(svg).toMatch(/height="[\d.]+cm"/);
    expect(svg).toContain("@font-face");
    expect(svg).not.toContain("var(--");
    expect(svg).not.toMatch(/\sclass=/);
    expect(svg).not.toMatch(/\sstyle=/);
    expect(svg).not.toContain("data-overlay");
    expect(svg).not.toContain('data-decoration="background"');
    expect([...svg.matchAll(/data-panel-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "(a)",
      "(b)",
      "(c)",
    ]);
  });

  it("sizes the raster from the final printed width, not from the column", () => {
    const p = prepared(onePanelDoc(benzene()));
    expect(p.size.widthPx).toBe(Math.round((p.size.widthCm / 2.54) * 300));
    expect(p.size.widthPx).toBeLessThan(974);
    const svg = figureSvgForRaster(p);
    expect(svg).toContain(`width="${p.size.widthPx}px"`);
    expect(svg).toContain(`height="${p.size.heightPx}px"`);
    // White under the raster, so a viewer that flattens alpha does not paint black.
    expect(svg).toContain('fill="#ffffff"');
  });

  it("scales a figure wider than a single column down to exactly 8.25 cm, 974 px at 300 dpi, and says so", () => {
    // A C40 zig-zag chain is about 17 cm at the house bond length.
    const p = prepared(onePanelDoc(linearChain(40)));
    expect(p.size.naturalWidthCm).toBeGreaterThan(JOURNAL_WIDTHS_CM.single);
    expect(p.size.scaled).toBe(true);
    expect(p.size.widthCm).toBe(8.25);
    expect(p.size.widthPx).toBe(974);
    const svg = figureSvgForFile(p);
    expect(svg).toContain('width="8.25cm"');
    expect(printedBondCm(svg, SCREEN_STYLE.bondLengthPx)).toBeCloseTo(
      PRINTED_BOND_LENGTH_CM * p.size.scale,
      4,
    );
    const percent = Math.floor(p.size.scale * 100);
    expect(scaleNotice(p.size, SINGLE_300)).toBe(`Scaled to ${percent}% to fit a single column.`);
    expect(
      scaleNotice(p.size, { width: "custom", customWidthCm: 8.25, dpi: 300 }),
    ).toBe(`Scaled to ${percent}% to fit the 8.25 cm custom width.`);
  });

  it("derives the double-column pixel width at 600 dpi for a figure that fills it", () => {
    const p = prepared(onePanelDoc(linearChain(80)), { width: "double", customWidthCm: 12, dpi: 600 });
    expect(p.size.scaled).toBe(true);
    expect(p.size.widthCm).toBe(17.8);
    expect(p.size.widthPx).toBe(4205);
  });

  it("exports in the document's own style preset, the one the canvas draws with (decision 21)", () => {
    const screen = threePanelDoc();
    expect(screen.stylePreset).toBe("screen");
    expect(documentFigure(screen).style).toBe(SCREEN_STYLE);
    const publication: SketchDocument = { ...screen, stylePreset: "publication" };
    expect(documentFigure(publication).style).toBe(PUBLICATION_STYLE);

    const screenSvg = figureSvgForFile(prepared(screen));
    const publicationSvg = figureSvgForFile(prepared(publication));
    expect(screenSvg).not.toBe(publicationSvg);
    // Same printed bond either way: the physical scale divides by the style used.
    expect(printedBondCm(screenSvg, SCREEN_STYLE.bondLengthPx)).toBeCloseTo(PRINTED_BOND_LENGTH_CM, 4);
    expect(printedBondCm(publicationSvg, PUBLICATION_STYLE.bondLengthPx)).toBeCloseTo(
      PRINTED_BOND_LENGTH_CM,
      4,
    );
    expect(screenSvg).toContain(`stroke-width="${SCREEN_STYLE.bondLineWidthPx}"`);
    expect(publicationSvg).toContain(`stroke-width="${PUBLICATION_STYLE.bondLineWidthPx}"`);
    // And the preview follows it too.
    expect(figurePreviewSvg(screen)).not.toBe(figurePreviewSvg(publication));
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
    // 300 bonds tall is 152 cm at the house length: 35,906 px at 600 dpi,
    // past every engine's 32,767 px side. Narrow, so nothing scales it.
    const tall = onePanelDoc(
      buildMolecule((b) => {
        b.atom("C", { x: 0, y: 0 });
        b.atom("C", { x: 0, y: 300 });
      }),
    );
    const p = prepared(tall, { width: "custom", customWidthCm: 60, dpi: 600 });
    expect(p.size.scaled).toBe(false);
    expect(p.size.heightPx).toBeGreaterThan(MAX_RASTER_SIDE_PX);
    // Past the hard limits no probe is asked: no engine could say yes.
    expect(rasterTooLarge(p, () => true)).toMatch(/larger than any browser canvas/);
    expect(rasterTooLarge(prepared(threePanelDoc()))).toBeNull();
  });

  it("does not apply one engine's canvas cap to every browser: double column at 600 dpi", () => {
    // A figure filling a double column at 600 dpi is 4205 px wide; once it is
    // taller than about 0.95 of that it is past iOS Safari's 16,777,216 px
    // area, and still far inside Chromium's. A 40-bond square fills it.
    const square = onePanelDoc(methaneSquare(40));
    const p = prepared(square, { width: "double", customWidthCm: 12, dpi: 600 });
    expect(p.size.scaled).toBe(true);
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
