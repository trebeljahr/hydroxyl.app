import { describe, expect, it } from "vitest";

import {
  JOURNAL_WIDTHS_CM,
  PRINTED_BOND_LENGTH_CM,
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  benzylAlcoholAbbreviated,
  butan2olWedged,
  ethanol,
} from "@starter/chem-render";
import { benzene, buildMolecule, emptyMolecule, linearChain, withStereoGroups } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { createDocument, createPanel, defaultPanelsFor } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { INITIAL_UI_STATE } from "@/state/slices/ui";
import type { FigureExportSettings } from "@/state/types";

import {
  annotationSizeNotice,
  bondLengthNotice,
  documentFigure,
  exportWidthCm,
  figurePreviewSvg,
  figureSvgForFile,
  figureSvgForRaster,
  figureStyleNotice,
  formatPt,
  labelSizeNotice,
  prepareFigure,
  MAX_RASTER_SIDE_PX,
  rasterTooLarge,
  SAFE_RASTER_AREA_PX,
  scaleNotice,
} from "./figure";

const NOW = "2024-01-01T00:00:00.000Z";
const SINGLE_300: FigureExportSettings = { width: "single", customWidthCm: 12, dpi: 300, style: "publication" };

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
    const figure = documentFigure({ ...threePanelDoc(), figure: { columns: 2 } }, "publication");
    expect(figure.cells.map((c) => c.representation.kind)).toEqual(["skeletal", "lewis", "sumFormula"]);
    expect(figure.columns).toBe(2);
    expect(documentFigure(threePanelDoc(), "publication").columns).toBe(3);
  });

  it("writes a small figure at its natural size, narrower than the column, with a 0.508 cm bond", () => {
    const p = prepared(threePanelDoc());
    expect(p.size.scaled).toBe(false);
    expect(p.size.widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single);
    expect(scaleNotice(p.size, SINGLE_300)).toBeNull();
    const svg = figureSvgForFile(p);
    expect(svg).not.toContain('width="8.25cm"');
    expect(printedBondCm(svg, PUBLICATION_STYLE.bondLengthPx)).toBeCloseTo(PRINTED_BOND_LENGTH_CM, 4);
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

  it("exports each panel's stereo descriptors under that panel's id prefix, in both presets", () => {
    // The document's display flags reach the exported file through the same
    // annotation pass the canvas uses; two panels of one molecule mint the
    // same `atom:<id>:descriptor`, so only the panel prefix keeps them apart.
    for (const preset of ["publication", "screen"] as const) {
      const withDescriptors = (panel: ReturnType<typeof createPanel>) => ({
        ...panel,
        representation: {
          ...panel.representation,
          display: { ...panel.representation.display, showStereoDescriptors: true },
        },
      });
      const doc = createDocument({
        molecule: butan2olWedged(),
        stylePreset: preset,
        panels: [
          withDescriptors(createPanel("skeletal", undefined, preset)),
          withDescriptors(createPanel("kekule", undefined, preset)),
        ],
        now: NOW,
      });
      for (const svg of [figureSvgForFile(prepared(doc)), figureSvgForRaster(prepared(doc))]) {
        const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]!);
        expect(new Set(ids).size, preset).toBe(ids.length);
        const descriptors = ids.filter((id) => id.endsWith(":descriptor"));
        expect(descriptors, preset).toHaveLength(2);
        expect(new Set(descriptors.map((id) => id.slice(0, id.indexOf(".") + 1))).size, preset).toBe(2);
        expect(svg.match(/\(R\)/g) ?? [], preset).toHaveLength(2);
      }
    }
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
    expect(printedBondCm(svg, PUBLICATION_STYLE.bondLengthPx)).toBeCloseTo(
      PRINTED_BOND_LENGTH_CM * p.size.scale,
      4,
    );
    const percent = Math.floor(p.size.scale * 100);
    expect(scaleNotice(p.size, SINGLE_300)).toBe(`Scaled to ${percent}% to fit a single column.`);
    expect(
      scaleNotice(p.size, { width: "custom", customWidthCm: 8.25, dpi: 300, style: "publication" }),
    ).toBe(`Scaled to ${percent}% to fit the 8.25 cm custom width.`);
  });

  it("derives the double-column pixel width at 600 dpi for a figure that fills it", () => {
    const p = prepared(onePanelDoc(linearChain(80)), { width: "double", customWidthCm: 12, dpi: 600, style: "publication" });
    expect(p.size.scaled).toBe(true);
    expect(p.size.widthCm).toBe(17.8);
    expect(p.size.widthPx).toBe(4205);
  });

  it("exports in Publication by default, whatever the canvas shows (decision 50)", () => {
    const screen = threePanelDoc();
    expect(screen.stylePreset).toBe("screen");
    expect(INITIAL_UI_STATE.figureExport.style).toBe("publication");
    expect(documentFigure(screen, "publication").style).toBe(PUBLICATION_STYLE);

    const publication: SketchDocument = { ...screen, stylePreset: "publication" };
    // The default file of a Screen document IS the Publication document's file.
    expect(figureSvgForFile(prepared(screen))).toBe(figureSvgForFile(prepared(publication)));
    const p = prepared(screen);
    expect(p.figure.style).toBe(PUBLICATION_STYLE);
    expect(p.size.fontSizePt).toBeCloseTo(10, 9);
    // The preview follows the choice, not the canvas.
    expect(figurePreviewSvg(screen, "publication")).toBe(figurePreviewSvg(publication, "publication"));

    expect(figureStyleNotice(screen, SINGLE_300)).toBe(
      "The canvas shows the Screen style. The export uses the Publication style.",
    );
    expect(figureStyleNotice(publication, SINGLE_300)).toBeNull();
    expect(labelSizeNotice(p, SINGLE_300)).toBeNull();
  });

  it("exports the canvas's own preset when that is chosen, and says what it prints", () => {
    const screen = threePanelDoc();
    const publication: SketchDocument = { ...screen, stylePreset: "publication" };
    const asCanvas: FigureExportSettings = { ...SINGLE_300, style: "canvas" };
    expect(documentFigure(screen, "canvas").style).toBe(SCREEN_STYLE);
    expect(documentFigure(publication, "canvas").style).toBe(PUBLICATION_STYLE);

    const screenSvg = figureSvgForFile(prepared(screen, asCanvas));
    const publicationSvg = figureSvgForFile(prepared(publication, asCanvas));
    expect(screenSvg).not.toBe(publicationSvg);
    // Same printed bond either way: the physical scale divides by the style used.
    expect(printedBondCm(screenSvg, SCREEN_STYLE.bondLengthPx)).toBeCloseTo(PRINTED_BOND_LENGTH_CM, 4);
    expect(printedBondCm(publicationSvg, PUBLICATION_STYLE.bondLengthPx)).toBeCloseTo(
      PRINTED_BOND_LENGTH_CM,
      4,
    );
    expect(screenSvg).toContain(`stroke-width="${SCREEN_STYLE.bondLineWidthPx}"`);
    expect(publicationSvg).toContain(`stroke-width="${PUBLICATION_STYLE.bondLineWidthPx}"`);
    expect(figurePreviewSvg(screen, "canvas")).not.toBe(figurePreviewSvg(publication, "canvas"));

    // Screen at the fixed printed bond: 16 px on a 44 px bond of 14.4 pt.
    const p = prepared(screen, asCanvas);
    expect(p.size.fontSizePt).toBeCloseTo((16 * 14.4) / 44, 6);
    // No style sentence (the file matches the canvas), but decision 51's
    // label warning points back to Publication.
    expect(figureStyleNotice(screen, asCanvas)).toBeNull();
    expect(labelSizeNotice(p, asCanvas)?.advice).toContain("such as Publication");
    expect(figureStyleNotice(publication, asCanvas)).toBeNull();
  });

  it("reports the bond as drawn, and says why, for a drawing not at the standard bond", () => {
    // A document holding a 0.825-unit molfile's benzene as it read before
    // imports were normalised: 0.55-unit bonds.
    const standard = prepared(onePanelDoc(benzene()));
    expect(standard.size.bondLengthMm).toBeCloseTo(5.08, 9);
    expect(bondLengthNotice(standard)).toBeNull();

    const short = prepared(onePanelDoc(benzene(0.55)));
    expect(short.size.scaled).toBe(false);
    expect(short.size.bondLengthMm).toBeCloseTo(5.08 * 0.55, 9);
    // The file agrees with the read-out: its drawn bond is what prints.
    expect(printedBondCm(figureSvgForFile(short), PUBLICATION_STYLE.bondLengthPx * 0.55)).toBeCloseTo(
      short.size.bondLengthMm / 10,
      4,
    );
    expect(bondLengthNotice(short)).toBe(
      "This drawing's bonds are 55% of the standard bond, so they do not print at 5.08 mm.",
    );
  });

  it("warns when scaling takes the labels under 8 pt, names the printed size, and still exports (decision 51)", () => {
    const DOUBLE_300: FigureExportSettings = { width: "double", customWidthCm: 12, dpi: 300, style: "publication" };
    // A C40 chain in Publication is about 17 cm: 10 pt labels at its natural
    // size, under 8 pt in a single column.
    const doc = onePanelDoc(linearChain(40), "publication");
    const single = prepared(doc);
    expect(single.size.scaled).toBe(true);
    const pt = formatPt(single.size.fontSizePt);
    expect(Number(pt)).toBeLessThan(8);
    const neededCm = Math.ceil(single.size.minWidthCmForMinLabel! * 100 - 1e-6) / 100;
    expect(labelSizeNotice(single, SINGLE_300)).toEqual({
      summary: `Labels print at ${pt} pt, below the 8 pt minimum ACS asks for in figures.`,
      advice: `They reach 8 pt at a maximum width of ${neededCm} cm. Try a double column.`,
    });
    // A warning, not a refusal: the figure is prepared and exports.
    expect(figureSvgForFile(single)).toContain('width="8.25cm"');

    // In the double column it fits at its natural size: 10 pt, no warning.
    const double = prepared(doc, DOUBLE_300);
    expect(formatPt(double.size.fontSizePt)).toBe("10.0");
    expect(labelSizeNotice(double, DOUBLE_300)).toBeNull();

    // Suggestions follow the figure: three panels three abreast are too wide
    // for any column, so a double column is not offered but the layout is.
    const three = { ...threePanelDoc(linearChain(40)), stylePreset: "publication" as const };
    const wide = prepared(three, DOUBLE_300);
    expect(wide.size.minWidthCmForMinLabel!).toBeGreaterThan(17.8);
    expect(labelSizeNotice(wide, DOUBLE_300)?.advice).toMatch(
      /^They reach 8 pt at a maximum width of [\d.]+ cm\. Try fewer panels per row or fewer panels\.$/,
    );
  });

  it("warns that no width helps when the style's labels are under 8 pt at full size", () => {
    // Screen, chosen for the export: 16 px labels on a 44 px bond print at 5.2 pt unscaled.
    const p = prepared(onePanelDoc(benzene()), { ...SINGLE_300, style: "canvas" });
    expect(p.size.scaled).toBe(false);
    expect(labelSizeNotice(p, SINGLE_300)).toEqual({
      summary: "Labels print at 5.2 pt, below the 8 pt minimum ACS asks for in figures.",
      advice:
        "This style's labels are under 8 pt even at full size, so no width fixes it. Choose a style with larger labels, such as Publication.",
    });
  });

  it("rounds a printed point size down, so a size under the minimum never displays as 8.0", () => {
    expect(formatPt(7.96)).toBe("7.9");
    expect(formatPt(10 - 1e-9)).toBe("10.0");
    expect(formatPt(5.8)).toBe("5.8");
  });

  it("accepts a custom width in range and refuses one outside it", () => {
    expect(exportWidthCm({ width: "custom", customWidthCm: 12.5, dpi: 300, style: "publication" })).toEqual({
      ok: true,
      widthCm: 12.5,
    });
    expect(exportWidthCm({ width: "custom", customWidthCm: 0, dpi: 300, style: "publication" }).ok).toBe(false);
    expect(exportWidthCm({ width: "custom", customWidthCm: Number.NaN, dpi: 300, style: "publication" }).ok).toBe(false);
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
    const p = prepared(tall, { width: "custom", customWidthCm: 60, dpi: 600, style: "publication" });
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
    const p = prepared(square, { width: "double", customWidthCm: 12, dpi: 600, style: "publication" });
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
    const svg = figurePreviewSvg(threePanelDoc(benzylAlcoholAbbreviated()), "publication");
    expect(svg).toContain('data-unavailable="abbreviated-label"');
    expect(svg).toContain("Sum formula view unavailable.");
  });
});

/** butan-2-ol in three panels with its (R) shown in each. */
function descriptorDoc(stylePreset: "screen" | "publication" = "publication", show = true): SketchDocument {
  const withDescriptors = (panel: ReturnType<typeof createPanel>) => ({
    ...panel,
    representation: {
      ...panel.representation,
      display: { ...panel.representation.display, showStereoDescriptors: show },
    },
  });
  return createDocument({
    molecule: butan2olWedged(),
    stylePreset,
    panels: [
      withDescriptors(createPanel("skeletal", undefined, stylePreset)),
      withDescriptors(createPanel("kekule", undefined, stylePreset)),
      withDescriptors(createPanel("lewis", undefined, stylePreset)),
    ],
    now: NOW,
  });
}

describe("annotations below 8 pt (decision 60)", () => {
  const custom = (customWidthCm: number): FigureExportSettings => ({
    width: "custom",
    customWidthCm,
    dpi: 300,
    style: "publication",
  });

  it("says nothing at Publication's natural size, where descriptors print at exactly 8 pt", () => {
    const p = prepared(descriptorDoc(), custom(60));
    expect(p.size.scaled).toBe(false);
    expect(p.figure.cells.some((c) => c.content.kind === "scene" && c.content.scene.primitives.some((q) => q.id.endsWith(":descriptor")))).toBe(true);
    expect(annotationSizeNotice(p, custom(60))).toBeNull();
  });

  it("names the stereo descriptors fit scaling takes under 8 pt while the labels still clear it, and still exports", () => {
    const natural = prepared(descriptorDoc(), custom(60)).size.naturalWidthCm;
    const settings = custom(natural * 0.9);
    expect(settings.customWidthCm).toBeGreaterThan(2);
    const p = prepared(descriptorDoc(), settings);
    expect(p.size.scaled).toBe(true);
    // Labels at 9 pt: decision 51's own check is quiet.
    expect(p.size.fontSizePt).toBeCloseTo(9, 6);
    expect(labelSizeNotice(p, settings)).toBeNull();

    const notice = annotationSizeNotice(p, settings)!;
    expect(notice.kinds).toEqual(["descriptor"]);
    expect(notice.fontSizePt).toBeCloseTo(7.2, 6);
    expect(notice.summary).toBe(
      `Stereo descriptors print at ${formatPt(notice.fontSizePt)} pt, below the 8 pt minimum ACS asks for in figures.`,
    );
    // They reach 8 pt only at the natural width: nothing narrower helps.
    const neededCm = String(Math.ceil(natural * 100 - 1e-6) / 100);
    expect(notice.advice).toBe(
      `They reach 8 pt at a maximum width of ${neededCm} cm. Try a double column, fewer panels per row, or fewer panels.`,
    );
    // A warning, not a refusal.
    expect(figureSvgForFile(p)).toContain("(R)");
  });

  it("names the stereo group tags, which are under 8 pt at EVERY width (decision 93)", () => {
    // Decision 93 gave the per-centre tag its own smaller scale so it would be
    // drawn at all, and 0.60 of Publication's 10 pt label is 6 pt — under the
    // floor even at the natural width, where the descriptors sit at exactly 8 and
    // the check is otherwise silent. So the ruling required this check to cover
    // the kind and NAME it: a label the reader cannot resolve is not an
    // improvement on one that was never drawn.
    const doc = descriptorDoc();
    const grouped: SketchDocument = {
      ...doc,
      molecule: withStereoGroups(doc.molecule, [{ kind: "abs", index: 1, atomIds: ["a2"] }]),
    };
    const settings = custom(60);
    const p = prepared(grouped, settings);
    expect(p.size.scaled).toBe(false);
    // The tag really is drawn, or the notice would be about nothing.
    expect(
      p.figure.cells.some(
        (c) =>
          c.content.kind === "scene" &&
          c.content.scene.primitives.some((q) => q.id.endsWith(":stereoGroup")),
      ),
    ).toBe(true);
    const notice = annotationSizeNotice(p, settings)!;
    // Descriptors are at 8 pt here, so only the tag is named.
    expect(notice.kinds).toEqual(["stereoGroup"]);
    expect(notice.fontSizePt).toBeCloseTo(6, 6);
    expect(notice.summary).toBe(
      `Stereo group tags print at ${formatPt(notice.fontSizePt)} pt, below the 8 pt minimum ACS asks for in figures.`,
    );
    // No width fixes it, because the scale is under the floor at full size.
    expect(notice.advice).toBe(
      "This style sets them under 8 pt even at full size, so no width fixes it. Choose a style with larger annotations, such as Publication.",
    );
    // A warning, not a refusal: the tag is in the file.
    expect(figureSvgForFile(p)).toContain("abs");
  });

  it("names the descriptors FIRST when scaling takes both under, in band order", () => {
    const natural = prepared(descriptorDoc(), custom(60)).size.naturalWidthCm;
    const settings = custom(natural * 0.9);
    const doc = descriptorDoc();
    const grouped: SketchDocument = {
      ...doc,
      molecule: withStereoGroups(doc.molecule, [{ kind: "abs", index: 1, atomIds: ["a2"] }]),
    };
    const p = prepared(grouped, settings);
    expect(p.size.scaled).toBe(true);
    const notice = annotationSizeNotice(p, settings)!;
    expect(notice.kinds).toEqual(["descriptor", "stereoGroup"]);
    // The SMALLEST of them is the size reported, which is the TAG's 0.60 of the
    // scaled label and not the descriptor's 0.80 — the point of naming two kinds
    // and one number.
    expect(notice.fontSizePt).toBeCloseTo(
      p.size.fontSizePt * PUBLICATION_STYLE.stereoGroupTagScale,
      9,
    );
    expect(notice.fontSizePt).toBeLessThan(p.size.fontSizePt * PUBLICATION_STYLE.stereoDescriptorScale);
    expect(notice.summary).toBe(
      `Stereo descriptors and stereo group tags print at ${formatPt(notice.fontSizePt)} pt, below the 8 pt minimum ACS asks for in figures.`,
    );
  });

  it("says nothing when the figure draws no annotation, flag on or off", () => {
    const settings = custom(2);
    // Flag on, but ethanol has no stereocentre: nothing is drawn.
    const ethanolDoc = descriptorDoc();
    const noStereo: SketchDocument = { ...ethanolDoc, molecule: ethanol() };
    expect(prepared(noStereo, settings).size.scaled).toBe(true);
    expect(annotationSizeNotice(prepared(noStereo, settings), settings)).toBeNull();
    // Flag off.
    expect(annotationSizeNotice(prepared(descriptorDoc("publication", false), settings), settings)).toBeNull();
  });

  it("sends a style whose annotations are under 8 pt at full size to Publication", () => {
    const settings: FigureExportSettings = { ...custom(60), style: "canvas" };
    const p = prepared(descriptorDoc("screen"), settings);
    expect(p.size.scaled).toBe(false);
    const notice = annotationSizeNotice(p, settings)!;
    expect(notice.kinds).toEqual(["descriptor"]);
    expect(notice.fontSizePt).toBeCloseTo(p.size.fontSizePt * SCREEN_STYLE.stereoDescriptorScale, 9);
    expect(notice.advice).toBe(
      "This style sets them under 8 pt even at full size, so no width fixes it. Choose a style with larger annotations, such as Publication.",
    );
  });
});
