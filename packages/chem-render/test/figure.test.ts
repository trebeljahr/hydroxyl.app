/**
 * Panel figures and their SVG.
 *
 * The acceptance for the feature is mostly about what the FILE can be trusted
 * to contain, so most assertions here read the serialised markup back rather
 * than the figure object: the ids a validator would see, the transform an
 * illustrator would find, the attributes a journal's width check would read.
 *
 * Every figure is also written to test/output/ (gitignored) so a change to the
 * layout can be looked at, not just asserted on.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { benzene, buildMolecule, linearChain } from "@starter/chem-core";

import {
  acetate,
  benzylAlcoholAbbreviated,
  butan2olWedged,
  dimethylSulfone,
  ethanol,
  FIXTURES,
} from "../src/fixtures.js";
import {
  composeFigure,
  defaultFigureColumns,
  panelLetter,
  unavailableCells,
  wrapText,
} from "../src/figure/compose.js";
import type { Figure, FigurePanelSpec } from "../src/figure/compose.js";
import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
  physicalFigureSize,
  pixelsFor,
  pixelsPerMetre,
  printedCmPerPx,
} from "../src/figure/physical.js";
import { representation, VIEW_KINDS } from "../src/representation.js";
import type { Representation } from "../src/representation.js";
import { sceneBounds } from "../src/scene/bounds.js";
import { buildScene } from "../src/scene/build.js";
import type { LinePrimitive, ScenePrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import {
  FigureUnavailableError,
  panelIdPrefix,
  serializeFigure,
} from "../src/svg/figure.js";
import { BUNDLED_MEASURER, measureTextRun, textRunRect } from "../src/text/measurer.js";

const OUTPUT = new URL("./output/", import.meta.url);

function writeOutput(name: string, svg: string): void {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(new URL(name, OUTPUT), svg);
}

function panel(id: string, rep: Representation, caption?: string): FigurePanelSpec {
  return caption === undefined ? { id, representation: rep } : { id, representation: rep, caption };
}

const THREE_VIEWS: readonly FigurePanelSpec[] = [
  panel("panel-skeletal", representation("skeletal"), "Skeletal"),
  panel("panel-lewis", representation("lewis"), "Lewis structure"),
  panel("panel-sum-formula", representation("sumFormula"), "Sum formula"),
];

function ids(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? "");
}

function lineLength(line: LinePrimitive): number {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function flatten(primitives: readonly ScenePrimitive[]): ScenePrimitive[] {
  return primitives.flatMap((p) => (p.type === "group" ? [p, ...flatten(p.children)] : [p]));
}

describe("panelLetter", () => {
  it("counts a…z and then aa, ab rather than wrapping", () => {
    expect([0, 1, 2, 25, 26, 27, 51, 52].map(panelLetter)).toEqual([
      "a",
      "b",
      "c",
      "z",
      "aa",
      "ab",
      "az",
      "ba",
    ]);
  });
});

describe("composeFigure — one style, one bond length (decision 5)", () => {
  const mol = ethanol();
  const figure = composeFigure(mol, PUBLICATION_STYLE, THREE_VIEWS);

  it("builds every panel with the one style it was given", () => {
    for (const cell of figure.cells) {
      expect(cell.content.kind).toBe("scene");
      if (cell.content.kind === "scene") expect(cell.content.scene.style).toBe(PUBLICATION_STYLE);
    }
  });

  it("leaves every panel's primitives exactly as a lone buildScene draws them", () => {
    // The strongest form of "no second bond-length multiply": the figure did
    // not rewrite a single coordinate. Its only say is the translate.
    for (const cell of figure.cells) {
      if (cell.content.kind !== "scene") throw new Error("expected a scene");
      const alone = buildScene(mol, PUBLICATION_STYLE, cell.representation);
      expect(cell.content.scene.primitives).toEqual(alone.primitives);
    }
  });

  it("draws the same bond at the same length in two structural panels", () => {
    const mol6 = benzene();
    const fig = composeFigure(mol6, PUBLICATION_STYLE, [
      panel("s", representation("skeletal", { aromaticCircles: false })),
      panel("k", representation("kekule")),
    ]);
    const lengths = fig.cells.map((cell) => {
      if (cell.content.kind !== "scene") throw new Error("expected a scene");
      const line = flatten(cell.content.scene.primitives).find(
        (p): p is LinePrimitive => p.type === "line" && p.id.endsWith(":line"),
      );
      if (line === undefined) throw new Error("no bond line");
      return lineLength(line);
    });
    expect(lengths[0]).toBeCloseTo(24, 6);
    expect(lengths[1]).toBeCloseTo(lengths[0] ?? NaN, 9);
  });

  it("writes each panel transform as a translate and nothing else", () => {
    const svg = serializeFigure(figure);
    const transforms = [...svg.matchAll(/transform="([^"]*)"/g)].map((m) => m[1]);
    expect(transforms).toHaveLength(3);
    for (const t of transforms) expect(t).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\)$/);
    expect(svg).not.toMatch(/scale\(|matrix\(|rotate\(/);
  });

  it("labels the panels (a)(b)(c) in panel order", () => {
    const svg = serializeFigure(figure);
    expect([...svg.matchAll(/data-panel-label="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "(a)",
      "(b)",
      "(c)",
    ]);
    for (const letter of ["a", "b", "c"]) expect(svg).toContain(`<tspan>(${letter})</tspan>`);
    writeOutput("figure-ethanol-three-views.svg", serializeFigure(figure, { embedFont: true }));
  });

  it("absorbs the formula's small extent in layout: centred in a Lewis-height row", () => {
    const [, lewis, formula] = figure.cells;
    if (lewis === undefined || formula === undefined) throw new Error("cells");
    const ink = withStyle(PUBLICATION_STYLE, { marginPx: 0 });
    const centreY = (cell: typeof lewis): number => {
      if (cell.content.kind !== "scene") throw new Error("scene");
      const b = sceneBounds(cell.content.scene.primitives, ink);
      return b.minY + b.height / 2 + cell.offset.y;
    };
    expect(centreY(formula)).toBeCloseTo(centreY(lewis), 6);
    // And the formula is not scaled up to fill its cell.
    if (formula.content.kind !== "scene") throw new Error("scene");
    const run = formula.content.scene.primitives[0];
    expect(run?.type === "textRun" && run.fontSizePx).toBe(PUBLICATION_STYLE.fontSizePx);
  });
});

describe("serializeFigure — the exported file", () => {
  it("never repeats an id, even with two panels of the same view kind", () => {
    const mol = dimethylSulfone();
    const figure = composeFigure(
      mol,
      PUBLICATION_STYLE,
      [
        panel("one", representation("skeletal"), "first"),
        panel("two", representation("skeletal"), "second"),
        panel("three", representation("sumFormula")),
        panel("four", representation("sumFormula")),
        panel("five", representation("lewis")),
      ],
      { columns: 2 },
    );
    const all = ids(serializeFigure(figure, { embedFont: true }));
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all).size).toBe(all.length);
  });

  it("draws each panel's stereo descriptors, their ids namespaced per panel", () => {
    // The annotation pass names a descriptor `atom:<id>:descriptor` from its
    // source id, so two panels of one molecule mint the SAME scene id. The
    // figure must still carry both, each under its own panel's prefix.
    const flags = { showStereoDescriptors: true };
    const figure = composeFigure(butan2olWedged(), PUBLICATION_STYLE, [
      panel("left", representation("skeletal", flags)),
      panel("right", representation("kekule", flags)),
      panel("plain", representation("skeletal")),
    ]);
    const svg = serializeFigure(figure);
    const all = ids(svg);
    expect(new Set(all).size).toBe(all.length);
    const descriptors = all.filter((id) => id.endsWith("atom:a2:descriptor"));
    expect(descriptors).toEqual([
      `${panelIdPrefix("left")}atom:a2:descriptor`,
      `${panelIdPrefix("right")}atom:a2:descriptor`,
    ]);
    expect(svg.match(/>\(R\)</g) ?? []).toHaveLength(2);
    writeOutput("descriptors-per-panel.svg", svg);
  });

  it("escapes panel ids injectively, so hostile ids cannot share a namespace", () => {
    const hostile = ["a.b", "a_2e_b", "a b", "a_20_b", "x", "x.", "", "ü", "<\"&>"];
    const prefixes = hostile.map(panelIdPrefix);
    expect(new Set(prefixes).size).toBe(hostile.length);
    for (const p of prefixes) expect(p).toMatch(/^p-[A-Za-z0-9_-]*\.$/);
    expect(panelIdPrefix("panel-skeletal")).toBe("p-panel-skeletal.");
  });

  it("contains nothing that only resolves inside the app", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    const svg = serializeFigure(figure, { embedFont: true });
    expect(svg).not.toContain("var(--");
    expect(svg).not.toMatch(/\sclass=/);
    expect(svg).not.toContain("data-overlay");
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/(href|src)=/);
    expect(svg).not.toMatch(/url\((?!data:font\/woff;base64,)/);
  });

  it("places text by explicit coordinates, never by a baseline property", () => {
    // Illustrator ignores `dominant-baseline` on import, and Chromium and
    // Inkscape read `middle` as half the x-height. Every view of every
    // fixture, descriptors on, both presets: not one run may lean on it.
    const views: Representation[] = [
      ...VIEW_KINDS.map((kind) => representation(kind)),
      representation("skeletal", { showStereoDescriptors: true }),
    ];
    for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
      for (const fixture of FIXTURES) {
        const figure = composeFigure(
          fixture.molecule,
          style,
          views.map((rep, index) => panel(`v${index}`, rep, "caption")),
        );
        const svg = serializeFigure(figure, { embedFont: true, unavailable: "mark" });
        expect(svg, fixture.name).toContain("<text");
        expect(svg, fixture.name).not.toMatch(/dominant-baseline|alignment-baseline|baseline-shift/);
      }
    }
  });

  it("centres a formula's ink on the scene origin, scripts included", () => {
    // The run's y is a baseline the builder computed; this is the check that
    // it put the measured ink band, not the baseline, on the origin.
    for (const kind of ["sumFormula", "condensed"] as const) {
      const scene = buildScene(acetate(), PUBLICATION_STYLE, representation(kind));
      const run = scene.primitives.find((p) => p.type === "textRun");
      if (run?.type !== "textRun") throw new Error(`${kind} drew no run`);
      expect(run.spans.some((s) => s.script === "super"), kind).toBe(true);
      const rect = textRunRect(
        measureTextRun(
          run.spans,
          {
            fontFamily: run.fontFamily,
            fontSizePx: run.fontSizePx,
            subscriptScale: PUBLICATION_STYLE.subscriptScale,
            anchor: run.anchor,
            baseline: "alphabetic",
          },
          BUNDLED_MEASURER,
        ),
        run.origin,
      );
      expect(run.origin.y, kind).toBeGreaterThan(0);
      expect((rect.minY + rect.maxY) / 2, kind).toBeCloseTo(0, 9);
    }
  });

  it("cuts the viewBox from the content bounds plus the margin", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    const { bounds } = figure;
    const svg = serializeFigure(figure);
    expect(svg).toContain(
      `viewBox="${[bounds.minX, bounds.minY, bounds.width, bounds.height]
        .map((n) => Number(n.toFixed(3)).toString())
        .join(" ")}"`,
    );
    // Every panel's ink, moved by its offset, sits inside the bounds with the
    // margin still around it — nothing is clipped at an edge.
    const ink = withStyle(PUBLICATION_STYLE, { marginPx: 0 });
    const m = PUBLICATION_STYLE.marginPx;
    for (const cell of figure.cells) {
      if (cell.content.kind !== "scene") throw new Error("scene");
      const b = sceneBounds(cell.content.scene.primitives, ink);
      expect(b.minX + cell.offset.x).toBeGreaterThanOrEqual(bounds.minX + m - 1e-9);
      expect(b.minY + cell.offset.y).toBeGreaterThanOrEqual(bounds.minY + m - 1e-9);
      expect(b.maxX + cell.offset.x).toBeLessThanOrEqual(bounds.maxX - m + 1e-9);
      expect(b.maxY + cell.offset.y).toBeLessThanOrEqual(bounds.maxY - m + 1e-9);
      const d = sceneBounds(cell.decorations, ink);
      expect(d.minX).toBeGreaterThanOrEqual(bounds.minX + m - 1e-9);
      expect(d.maxY).toBeLessThanOrEqual(bounds.maxY - m + 1e-9);
    }
  });

  it("is byte-deterministic", () => {
    const a = serializeFigure(composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS));
    const b = serializeFigure(composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS));
    expect(a).toBe(b);
  });

  it("writes physical dimensions that print one bond at the house length", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single);
    const svg = serializeFigure(figure, {
      dimensions: { width: size.widthCm, height: size.heightCm, unit: "cm" },
    });
    // Narrower than the column: the column is a maximum, not a target.
    const widthCm = Number.parseFloat(/<svg[^>]*\swidth="([\d.]+)cm"/.exec(svg)![1]!);
    expect(widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single);
    expect(svg).toMatch(/height="\d+(\.\d+)?cm"/);
    // Read back from the attributes the way a renderer would: cm per viewBox
    // unit times px per bond is the printed bond.
    const viewBoxWidth = Number(/viewBox="[^"]*"/.exec(svg)![0].split(" ")[2]);
    expect((widthCm / viewBoxWidth) * PUBLICATION_STYLE.bondLengthPx).toBeCloseTo(
      PRINTED_BOND_LENGTH_CM,
      4,
    );
    expect(size.heightCm / size.widthCm).toBeCloseTo(figure.bounds.height / figure.bounds.width, 9);
  });

  it("writes a physical width at a precision a small screen-preset figure's bond survives", () => {
    // SCREEN_STYLE prints coordinates to 2 places; a width to 2 places of a cm
    // would move a 2 cm figure's bond by a quarter of a percent.
    const figure = composeFigure(ethanol(), SCREEN_STYLE, [THREE_VIEWS[0]!]);
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single);
    const svg = serializeFigure(figure, {
      dimensions: { width: size.widthCm, height: size.heightCm, unit: "cm" },
    });
    const written = Number.parseFloat(/<svg[^>]*\swidth="([\d.]+)cm"/.exec(svg)![1]!);
    expect(Math.abs(written - size.widthCm)).toBeLessThanOrEqual(0.00005);
  });

  it("embeds the font only when asked, with its licence notice", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    expect(serializeFigure(figure)).not.toContain("@font-face");
    const svg = serializeFigure(figure, { embedFont: true });
    expect(svg).toContain('@font-face{font-family:"Arimo"');
    expect(svg).toContain("SIL Open Font License 1.1");
    expect(svg).toContain("Arimo 1.341");
    // Text stays text.
    expect(svg).toContain("<text");
    expect(svg).not.toContain("<path id=\"p-panel-sum-formula.");
  });

  it("paints a background only when the style or the caller asks", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    expect(serializeFigure(figure)).not.toContain("data-decoration=\"background\"");
    expect(serializeFigure(figure, { background: "#ffffff" })).toContain('fill="#ffffff"');
    const screen = composeFigure(ethanol(), SCREEN_STYLE, THREE_VIEWS);
    expect(serializeFigure(screen, { background: null })).not.toContain(
      "data-decoration=\"background\"",
    );
  });
});

describe("an unavailable view never exports as an empty cell", () => {
  const panels = [
    panel("s", representation("skeletal")),
    panel("f", representation("sumFormula"), "Formula"),
  ];
  const figure: Figure = composeFigure(benzylAlcoholAbbreviated(), PUBLICATION_STYLE, panels);

  it("is refused by default, naming the panel and the reason", () => {
    expect(unavailableCells(figure).map((c) => c.letter)).toEqual(["b"]);
    let caught: unknown;
    try {
      serializeFigure(figure);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FigureUnavailableError);
    const error = caught as FigureUnavailableError;
    expect(error.panels).toHaveLength(1);
    expect(error.panels[0]?.letter).toBe("b");
    expect(error.panels[0]?.availability.reason).toBe("abbreviated-label");
    expect(error.message).toContain("Panel (b)");
    expect(error.message).toContain("Ph");
  });

  it("is drawn as a marked placeholder that states the reason when asked to mark", () => {
    const svg = serializeFigure(figure, { unavailable: "mark" });
    expect(svg).toContain('data-unavailable="abbreviated-label"');
    expect(svg).toContain("Sum formula view unavailable.");
    expect(svg).toContain("stroke-dasharray");
    const cell = figure.cells[1];
    if (cell?.content.kind !== "unavailable") throw new Error("expected unavailable");
    const b = sceneBounds(cell.content.primitives, withStyle(PUBLICATION_STYLE, { marginPx: 0 }));
    expect(b.width).toBeGreaterThan(50);
    expect(b.height).toBeGreaterThan(20);
    writeOutput("figure-unavailable-marked.svg", svg);
  });

  it("does not call buildScene for it (a text view of a Ph label would lie)", () => {
    const cell = figure.cells[1];
    expect(cell?.content.kind).toBe("unavailable");
    expect(svg()).not.toContain("text:sumFormula:formula");
    function svg(): string {
      return serializeFigure(figure, { unavailable: "mark" });
    }
  });
});

describe("layout", () => {
  it("defaults to at most three panels a row, and clamps a requested count", () => {
    expect(defaultFigureColumns(0)).toBe(1);
    expect(defaultFigureColumns(2)).toBe(2);
    expect(defaultFigureColumns(7)).toBe(3);
    const mol = ethanol();
    const four = [0, 1, 2, 3].map((i) => panel(`p${i}`, representation("skeletal")));
    expect(composeFigure(mol, PUBLICATION_STYLE, four).columns).toBe(3);
    expect(composeFigure(mol, PUBLICATION_STYLE, four, { columns: 2 }).columns).toBe(2);
    expect(composeFigure(mol, PUBLICATION_STYLE, four, { columns: 99 }).columns).toBe(4);
    expect(composeFigure(mol, PUBLICATION_STYLE, four, { columns: 0 }).columns).toBe(1);
  });

  it("puts a second row below the first, never overlapping it", () => {
    const mol = ethanol();
    const fig = composeFigure(
      mol,
      PUBLICATION_STYLE,
      [
        panel("a", representation("lewis"), "a long caption that has to wrap onto more lines"),
        panel("b", representation("sumFormula")),
        panel("c", representation("skeletal")),
      ],
      { columns: 2 },
    );
    const [a, , c] = fig.cells;
    if (a === undefined || c === undefined) throw new Error("cells");
    expect(c.cell.y).toBeGreaterThanOrEqual(a.cell.y + a.cell.height);
    writeOutput("figure-two-rows.svg", serializeFigure(fig, { embedFont: true }));
  });

  it("wraps captions against the font table, keeping an over-long word whole", () => {
    const metrics = {
      measure: (value: string) => ({
        width: BUNDLED_MEASURER.measureText(value, { family: "Arimo", sizePx: 10 }).advanceWidthPx,
      }),
    };
    expect(wrapText("one two three", 1000, metrics)).toEqual(["one two three"]);
    expect(wrapText("one two three", 1, metrics)).toEqual(["one", "two", "three"]);
    expect(wrapText("  ", 100, metrics)).toEqual([]);
  });

  it("produces a figure with no panels that still has a drawable viewBox", () => {
    const fig = composeFigure(ethanol(), PUBLICATION_STYLE, []);
    expect(fig.bounds.width).toBeGreaterThan(0);
    expect(serializeFigure(fig)).toContain("<svg");
  });
});

describe("physical size", () => {
  it("derives pixel width from centimetres and dpi the way a journal does", () => {
    expect(pixelsFor(8.25, 300)).toBe(974);
    expect(pixelsFor(8.25, 600)).toBe(1949);
    expect(pixelsFor(17.8, 300)).toBe(2102);
    expect(pixelsFor(17.8, 600)).toBe(4205);
    expect(pixelsPerMetre(300)).toBe(11811);
    expect(pixelsPerMetre(600)).toBe(23622);
  });

  it("prints a one-panel figure narrower than a single column, with a 0.508 cm bond", () => {
    for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
      const figure = composeFigure(benzene(), style, [THREE_VIEWS[0]!]);
      const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single, 300);
      expect(size.scaled, style.name).toBe(false);
      expect(size.scale).toBe(1);
      expect(size.widthCm).toBeLessThan(JOURNAL_WIDTHS_CM.single / 2);
      expect(size.widthCm).toBeCloseTo(figure.bounds.width * printedCmPerPx(style), 12);
      expect(size.naturalWidthCm).toBe(size.widthCm);
      expect(size.bondLengthMm).toBeCloseTo(5.08, 9);
      // The raster follows the final size, not the column.
      expect(size.widthPx).toBe(pixelsFor(size.widthCm, 300));
      expect(size.widthPx).toBeLessThan(pixelsFor(JOURNAL_WIDTHS_CM.single, 300));
    }
  });

  it("prints the same bond whatever the panel count (decision 20)", () => {
    const one = physicalFigureSize(
      composeFigure(ethanol(), PUBLICATION_STYLE, [THREE_VIEWS[0]!]),
      JOURNAL_WIDTHS_CM.single,
    );
    const three = physicalFigureSize(
      composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS),
      JOURNAL_WIDTHS_CM.single,
    );
    expect(one.bondLengthMm).toBeCloseTo(three.bondLengthMm, 12);
    expect(one.fontSizePt).toBeCloseTo(three.fontSizePt, 12);
    expect(one.widthCm).toBeLessThan(three.widthCm);
  });

  it("scales a figure wider than the column down to exactly the column, and reports by how much", () => {
    // A C40 zig-zag chain is about 34 bonds long: 17 cm at the house length.
    const figure = composeFigure(linearChain(40), PUBLICATION_STYLE, THREE_VIEWS.slice(0, 1));
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single, 300);
    expect(size.naturalWidthCm).toBeGreaterThan(JOURNAL_WIDTHS_CM.single);
    expect(size.scaled).toBe(true);
    expect(size.widthCm).toBe(JOURNAL_WIDTHS_CM.single);
    expect(size.scale).toBeCloseTo(JOURNAL_WIDTHS_CM.single / size.naturalWidthCm, 12);
    expect(size.heightCm).toBeCloseTo(size.naturalHeightCm * size.scale, 12);
    expect(size.bondLengthMm).toBeCloseTo(5.08 * size.scale, 9);
    expect(size.widthPx).toBe(974);
    expect(size.heightPx).toBe(Math.round((974 * figure.bounds.height) / figure.bounds.width));

    // The same figure fits a double column and prints at its natural size.
    const double = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.double);
    expect(double.scaled).toBe(false);
    expect(double.widthCm).toBeCloseTo(size.naturalWidthCm, 12);
  });

  it("reports the printed bond length and font size as read-outs of the style used", () => {
    const figure = composeFigure(ethanol(), SCREEN_STYLE, THREE_VIEWS);
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.double, 300);
    expect(size.scaled).toBe(false);
    const cmPerPx = PRINTED_BOND_LENGTH_CM / 44;
    expect(size.bondLengthMm).toBeCloseTo(44 * cmPerPx * 10, 9);
    expect(size.fontSizePt).toBeCloseTo(((16 * cmPerPx) / 2.54) * 72, 9);
    expect(() => physicalFigureSize(figure, 0)).toThrow(RangeError);
  });

  it("prints the publication preset at the ACS 1996 setting: 10 pt labels, 0.6 pt lines (decision 26)", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, [THREE_VIEWS[0]!]);
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single, 300);
    expect(size.scaled).toBe(false);
    expect(size.bondLengthMm).toBeCloseTo(5.08, 9);
    expect(size.fontSizePt).toBeCloseTo(10, 9);
    const ptPerPx = (printedCmPerPx(PUBLICATION_STYLE) / 2.54) * 72;
    expect(PUBLICATION_STYLE.bondLineWidthPx * ptPerPx).toBeCloseTo(0.6, 9);
    // 14.4 pt bond, so the font-to-bond ratio the ruling names.
    expect(PUBLICATION_STYLE.fontSizePx / PUBLICATION_STYLE.bondLengthPx).toBeCloseTo(0.694, 3);
  });

  it("reports the bond as drawn, not the model unit, for a structure at another tool's bond length", () => {
    // A 0.825-unit molfile read at the shared 1.5 scale: 0.55-unit bonds.
    const short = composeFigure(benzene(0.55), PUBLICATION_STYLE, [THREE_VIEWS[0]!]);
    expect(short.drawnBondLength).toBeCloseTo(0.55, 12);
    const size = physicalFigureSize(short, JOURNAL_WIDTHS_CM.single);
    expect(size.scaled).toBe(false);
    expect(size.bondLengthMm).toBeCloseTo(5.08 * 0.55, 9);

    const standard = composeFigure(benzene(), PUBLICATION_STYLE, [THREE_VIEWS[0]!]);
    expect(standard.drawnBondLength).toBeCloseTo(1, 12);
    // A lone atom has no bond to measure and reads as the standard bond.
    expect(
      composeFigure(buildMolecule((b) => void b.atom("O", { x: 0, y: 0 })), PUBLICATION_STYLE, [
        THREE_VIEWS[0]!,
      ]).drawnBondLength,
    ).toBe(1);
  });

  it("reports labels shrunk below 8 pt by scaling to fit, and the width that avoids it (decision 51)", () => {
    expect(MIN_PRINTED_LABEL_PT).toBe(8);
    const figure = composeFigure(linearChain(40), PUBLICATION_STYLE, THREE_VIEWS.slice(0, 1));

    // At its natural size (a double column holds it) the labels are 10 pt,
    // and they stay at or above 8 pt down to 80 % of the natural width.
    const natural = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.double);
    expect(natural.scaled).toBe(false);
    expect(natural.fontSizePt).toBeCloseTo(10, 9);
    expect(natural.naturalFontSizePt).toBeCloseTo(10, 9);
    expect(natural.labelsBelowMinimum).toBe(false);
    expect(natural.minWidthCmForMinLabel).toBeCloseTo(natural.naturalWidthCm * 0.8, 9);

    // The issue's example: scaled to 58 %, labels print at 5.8 pt and bonds at 2.9 mm.
    const shrunk = physicalFigureSize(figure, natural.naturalWidthCm * 0.58);
    expect(shrunk.scale).toBeCloseTo(0.58, 12);
    expect(shrunk.fontSizePt).toBeCloseTo(5.8, 9);
    expect(shrunk.bondLengthMm).toBeCloseTo(2.9464, 3);
    expect(shrunk.naturalFontSizePt).toBeCloseTo(10, 9);
    expect(shrunk.labelsBelowMinimum).toBe(true);
    // The remedy does not depend on the column that was chosen.
    expect(shrunk.minWidthCmForMinLabel).toBe(natural.minWidthCmForMinLabel);

    // A single column is far too narrow for this chain.
    const single = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.single);
    expect(single.labelsBelowMinimum).toBe(true);
    expect(single.fontSizePt).toBeCloseTo(10 * single.scale, 9);

    // Exactly at the reported width the labels are 8 pt and do not warn over
    // floating-point dust; a hair narrower, they do.
    const edge = natural.minWidthCmForMinLabel!;
    const atEdge = physicalFigureSize(figure, edge);
    expect(atEdge.scaled).toBe(true);
    expect(atEdge.fontSizePt).toBeCloseTo(MIN_PRINTED_LABEL_PT, 9);
    expect(atEdge.labelsBelowMinimum).toBe(false);
    expect(physicalFigureSize(figure, edge * 0.999).labelsBelowMinimum).toBe(true);
  });

  it("reports labels below 8 pt even unscaled for the screen style, where no width helps", () => {
    const figure = composeFigure(ethanol(), SCREEN_STYLE, [THREE_VIEWS[0]!]);
    const size = physicalFigureSize(figure, JOURNAL_WIDTHS_CM.double);
    expect(size.scaled).toBe(false);
    // 16 px labels on a 44 px bond at a 14.4 pt bond: 5.24 pt.
    expect(size.fontSizePt).toBeCloseTo((16 / 44) * 14.4, 9);
    expect(size.naturalFontSizePt).toBe(size.fontSizePt);
    expect(size.labelsBelowMinimum).toBe(true);
    expect(size.minWidthCmForMinLabel).toBeNull();
  });

  it("never multiplies geometry for the label read-out: the file's viewBox is the same at every width", () => {
    const figure = composeFigure(linearChain(40), PUBLICATION_STYLE, THREE_VIEWS.slice(0, 1));
    const viewBox = (svg: string) => /<svg[^>]*\sviewBox="([^"]*)"/.exec(svg)![1];
    const at = (widthCm: number) => {
      const size = physicalFigureSize(figure, widthCm);
      return serializeFigure(figure, {
        dimensions: { width: size.widthCm, height: size.heightCm, unit: "cm" },
      });
    };
    const double = at(JOURNAL_WIDTHS_CM.double);
    const single = at(JOURNAL_WIDTHS_CM.single);
    expect(viewBox(single)).toBe(viewBox(double));
    // Only the root's physical attributes differ.
    const strip = (svg: string) => svg.replace(/\s(width|height)="[\d.]+cm"/g, "");
    expect(strip(single)).toBe(strip(double));
  });

  it("never enlarges: a figure exactly as wide as the column is not 'scaled'", () => {
    const figure = composeFigure(ethanol(), PUBLICATION_STYLE, THREE_VIEWS);
    const natural = figure.bounds.width * printedCmPerPx(PUBLICATION_STYLE);
    const size = physicalFigureSize(figure, natural);
    expect(size.scaled).toBe(false);
    expect(size.scale).toBe(1);
  });
});
