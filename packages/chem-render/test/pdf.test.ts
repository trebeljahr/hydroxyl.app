/**
 * The PDF export (decision 236): a one-page vector PDF of the same figure the
 * SVG serialiser writes, with Arimo embedded.
 *
 * No PDF library is available to a test here, so the file is checked the way
 * a reader would walk it: the cross-reference table must point at every
 * object, the font stream must inflate to the TrueType the generator rebuilds
 * from the vendored WOFF, and every glyph must be placed where the measurer
 * put it. The files land in test/output/ so they can be opened as well.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";

import { buildSfnt, extractPdfFontData } from "../scripts/generate-font-metrics.mjs";
import { cyanideAdditionToAcetone, ethanol } from "../src/fixtures.js";
import { composeFigure } from "../src/figure/compose.js";
import type { Figure, FigurePanelSpec } from "../src/figure/compose.js";
import { physicalFigureSize } from "../src/figure/physical.js";
import { pdfColor, serializeFigurePdf } from "../src/pdf/figure.js";
import { pdfFallbackCodePoints } from "../src/pdf/symbol.js";
import { pathOperators } from "../src/pdf/path.js";
import { representation } from "../src/representation.js";
import type { TextRunPrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE } from "../src/style.js";
import { FigureUnavailableError, serializeFigure } from "../src/svg/figure.js";
import { PDF_FACES } from "../src/text/generated/arimo-sfnt.js";
import { BUNDLED_MEASURER, measureTextRun } from "../src/text/measurer.js";

const OUTPUT = new URL("./output/", import.meta.url);
const FONT_BYTES = readFileSync(new URL("../assets/arimo-latin-400-normal.woff", import.meta.url));
const GREEK_FONT_BYTES = readFileSync(new URL("../assets/arimo-greek-400-normal.woff", import.meta.url));
const [LATIN_FACE, GREEK_FACE] = PDF_FACES;
if (LATIN_FACE === undefined || GREEK_FACE === undefined) throw new Error("two faces");

function writeOutput(name: string, bytes: Uint8Array | string): void {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(new URL(name, OUTPUT), bytes);
}

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

const PANELS: readonly FigurePanelSpec[] = [
  { id: "s", representation: representation("skeletal"), caption: "Skeletal" },
  { id: "l", representation: representation("lewis") },
  { id: "f", representation: representation("sumFormula") },
];

/** The objects of a PDF by number, read through its xref table. */
function objects(pdf: Uint8Array): Map<number, string> {
  const text = latin1(pdf);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref)) ?? [];
  expect(Number(first)).toBe(0);
  const table = text.slice(startxref).split("\n").slice(2, 2 + Number(count));
  const out = new Map<number, string>();
  table.forEach((entry, n) => {
    // Every entry is exactly 20 bytes including its newline.
    expect(entry.length).toBe(19);
    if (n === 0) return;
    const offset = Number(entry.slice(0, 10));
    expect(text.startsWith(`${n} 0 obj\n`, offset)).toBe(true);
    out.set(n, text.slice(offset, text.indexOf("endobj", offset)));
  });
  return out;
}

function streamBytes(pdf: Uint8Array, object: string): Uint8Array {
  const text = latin1(pdf);
  const at = text.indexOf(object) + object.indexOf("stream\n") + "stream\n".length;
  const length = Number(/\/Length (\d+)/.exec(object)?.[1]);
  return pdf.subarray(at, at + length);
}

function find(objs: Map<number, string>, needle: string): string {
  const found = [...objs.values()].find((o) => o.includes(needle));
  if (found === undefined) throw new Error(`No object with ${needle}`);
  return found;
}

describe("the generated TrueType faces", () => {
  const faces = [
    ["Latin", LATIN_FACE, FONT_BYTES],
    ["Greek", GREEK_FACE, GREEK_FONT_BYTES],
  ] as const;

  it.each(faces)("%s is its vendored WOFF unwrapped, byte for byte", (_name, face, woff) => {
    const sfnt = buildSfnt(woff);
    const committed = inflateSync(Buffer.from(face.deflatedBase64, "base64"));
    expect(committed.length).toBe(face.length);
    expect(Buffer.compare(committed, Buffer.from(sfnt))).toBe(0);
    // WOFF's header records the sfnt size its encoder started from.
    expect(sfnt.length).toBe(new DataView(woff.buffer, woff.byteOffset).getUint32(16));
    expect(face.fontBBox).toEqual(extractPdfFontData(woff).fontBBox);
  });

  it("sets every code point from the first face that has it", () => {
    expect(LATIN_FACE.glyphIds).toEqual(extractPdfFontData(FONT_BYTES).glyphIds);
    const latin = new Set(LATIN_FACE.glyphIds.map(([cp]) => cp));
    const greekOnly = extractPdfFontData(GREEK_FONT_BYTES).glyphIds.filter(([cp]) => !latin.has(cp));
    expect(GREEK_FACE.glyphIds).toEqual(greekOnly);
    expect(GREEK_FACE.glyphIds.some(([cp]) => cp === 0x3b4)).toBe(true);
  });
});

describe("serializeFigurePdf", () => {
  const figure = composeFigure(ethanol(), PUBLICATION_STYLE, PANELS);
  const size = physicalFigureSize(figure, 8.25);
  const dimensions = { width: size.widthCm, height: size.heightCm, unit: "cm" as const };
  const pdf = serializeFigurePdf(figure, { dimensions, title: "ethanol" });
  writeOutput("ethanol-figure.pdf", pdf);
  writeOutput("ethanol-figure.svg", serializeFigure(figure, { dimensions, embedFont: true }));
  const objs = objects(pdf);

  it("is a well-formed PDF whose cross-reference table finds every object", () => {
    expect(latin1(pdf).startsWith("%PDF-1.7\n")).toBe(true);
    expect(objs.size).toBeGreaterThanOrEqual(9);
    expect(find(objs, "/Type /Catalog")).toContain("/Pages 2 0 R");
  });

  it("is a page exactly the printed size", () => {
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(find(objs, "/Type /Page "));
    expect(Number(box?.[1])).toBeCloseTo((size.widthCm / 2.54) * 72, 3);
    expect(Number(box?.[2])).toBeCloseTo((size.heightCm / 2.54) * 72, 3);
  });

  it("embeds Arimo as a TrueType font file that inflates to the vendored face", () => {
    const descriptor = find(objs, "/Type /FontDescriptor");
    expect(descriptor).toContain("/FontFile2");
    const file = find(objs, "/Length1");
    expect(file).toContain(`/Length1 ${LATIN_FACE.length}`);
    const inflated = inflateSync(streamBytes(pdf, file));
    expect(Buffer.compare(inflated, Buffer.from(buildSfnt(FONT_BYTES)))).toBe(0);
    expect(find(objs, "/Subtype /Type0")).toContain("/Encoding /Identity-H");
    // No Greek in ethanol, so neither the Greek face nor Symbol is written.
    expect([...objs.values()].some((o) => o.includes("/BaseFont /Symbol"))).toBe(false);
    expect([...objs.values()].some((o) => o.includes("/BaseFont /Arimo-Greek"))).toBe(false);
  });

  it("maps every glyph it draws back to Unicode, so the text copies", () => {
    const cmap = latin1(streamBytes(pdf, find(objs, "beginbfchar")));
    const glyphO = LATIN_FACE.glyphIds.find(([cp]) => cp === 0x4f)?.[1] ?? -1;
    const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, "0");
    expect(cmap).toContain(`<${hex(glyphO)}> <004F>`);
  });

  it("places a label's glyphs where the measurer put them", () => {
    const content = latin1(streamBytes(pdf, objs.get(4) ?? ""));
    const cell = figure.cells[0];
    if (cell?.content.kind !== "scene") throw new Error("expected a scene");
    const label = cell.content.scene.primitives.find(
      (p): p is TextRunPrimitive => p.type === "textRun" && p.spans.some((s) => s.text.includes("O")),
    );
    if (label === undefined) throw new Error("ethanol has an OH label");
    const box = measureTextRun(
      label.spans,
      {
        fontFamily: label.fontFamily,
        fontSizePx: label.fontSizePx,
        subscriptScale: PUBLICATION_STYLE.subscriptScale,
        anchor: label.anchor,
        baseline: "alphabetic",
      },
      BUNDLED_MEASURER,
    );
    const x = Number((label.origin.x + box.startXPx).toFixed(4));
    const y = Number(label.origin.y.toFixed(4));
    expect(content).toContain(`1 0 0 -1 ${x} ${y} Tm`);
  });

  it("writes the same bytes for the same figure", () => {
    const again = serializeFigurePdf(composeFigure(ethanol(), PUBLICATION_STYLE, PANELS), {
      dimensions,
      title: "ethanol",
    });
    expect(Buffer.compare(Buffer.from(again), Buffer.from(pdf))).toBe(0);
  });

  it("draws curly arrows and wedges through the path converter", () => {
    const mechanism = cyanideAdditionToAcetone();
    const scheme = composeFigure(mechanism.molecule, PUBLICATION_STYLE, [PANELS[0] as FigurePanelSpec], {
      schemeAnnotations: mechanism.annotations,
    });
    const out = serializeFigurePdf(scheme);
    writeOutput("curly-arrows.pdf", out);
    const content = latin1(streamBytes(out, objects(out).get(4) ?? ""));
    // A curly arrow's shaft is a cubic.
    expect(content).toMatch(/ c S Q/);
  });

  it("refuses a figure with an unavailable panel, as the SVG does", () => {
    const withGap = composeFigure(benzene(), PUBLICATION_STYLE, [
      { id: "x", representation: representation("fischer") },
    ]);
    if (withGap.cells.every((c) => c.content.kind === "scene")) return;
    expect(() => serializeFigurePdf(withGap)).toThrow(FigureUnavailableError);
  });
});

describe("Greek, from the vendored Greek face (decision 252)", () => {
  const base = composeFigure(ethanol(), PUBLICATION_STYLE, [PANELS[0] as FigurePanelSpec]);
  const cell = base.cells[0];
  if (cell === undefined) throw new Error("one cell");
  const run = (id: string, text: string, y: number): TextRunPrimitive => ({
    id,
    source: { kind: "decoration" },
    type: "textRun",
    origin: { x: base.bounds.minX + 4, y: base.bounds.minY + y },
    spans: [{ text }],
    fontFamily: PUBLICATION_STYLE.fontFamily,
    fontSizePx: 10,
    fill: { color: "#000000" },
    anchor: "start",
  });
  const delta = run("test:delta", "δ+", 12);
  // An arrow typed into free text: in neither Arimo face, but in Symbol.
  const arrow = run("test:arrow", "→", 24);
  const withFigure = (...runs: TextRunPrimitive[]): Figure => ({
    ...base,
    cells: [{ ...cell, decorations: [...cell.decorations, ...runs] }],
  });
  const figure = withFigure(delta);
  const pdf = serializeFigurePdf(figure);
  writeOutput("greek.pdf", pdf);
  const objs = objects(pdf);
  const content = latin1(streamBytes(pdf, objs.get(4) ?? ""));

  it("embeds the Greek face beside the Latin one, and leaves nothing to Symbol", () => {
    expect(find(objs, "/Subtype /CIDFontType2 /BaseFont /Arimo-Greek")).toContain("/CIDToGIDMap /Identity");
    const file = find(objs, `/Length1 ${GREEK_FACE.length}`);
    expect(Buffer.compare(inflateSync(streamBytes(pdf, file)), Buffer.from(buildSfnt(GREEK_FONT_BYTES)))).toBe(0);
    expect([...objs.values()].some((o) => o.includes("/BaseFont /Symbol"))).toBe(false);
    expect(pdfFallbackCodePoints(figure)).toEqual([]);
  });

  it("sets δ in the Greek face and the + after it in Latin, at the measurer's pen", () => {
    const glyph = GREEK_FACE.glyphIds.find(([cp]) => cp === 0x3b4)?.[1] ?? -1;
    const hex = glyph.toString(16).toUpperCase().padStart(4, "0");
    const x = Number(delta.origin.x.toFixed(4));
    expect(content).toContain(`/F2 10 Tf 1 0 0 -1 ${x} `);
    expect(content).toContain(`<${hex}> Tj`);
    // δ now measures at its own advance, not .notdef's.
    const deltaPx = BUNDLED_MEASURER.measureText("δ", { family: "", sizePx: 10 }).advanceWidthPx;
    expect(deltaPx).not.toBe(7.5);
    expect(content).toContain(`/F1 10 Tf 1 0 0 -1 ${Number((delta.origin.x + deltaPx).toFixed(4))} `);
    const cmaps = [...objs.values()].filter((o) => o.includes("beginbfchar"));
    expect(cmaps.some((o) => latin1(streamBytes(pdf, o)).includes(`<${hex}> <03B4>`))).toBe(true);
  });

  it("falls back to Symbol only for what no face has, and reports it", () => {
    const withArrow = withFigure(delta, arrow);
    const out = serializeFigurePdf(withArrow);
    const arrowObjs = objects(out);
    expect(find(arrowObjs, "/BaseFont /Symbol")).toContain("/Subtype /Type1");
    expect(pdfFallbackCodePoints(withArrow)).toEqual([0x2192]);
    // → is byte 0xAE in Symbol's encoding.
    expect(latin1(streamBytes(out, arrowObjs.get(4) ?? ""))).toMatch(/\/FS 10 Tf 1 0 0 -1 [-\d.]+ [-\d.]+ Tm <AE> Tj/);
  });
});

describe("pathOperators", () => {
  const f = (n: number): string => String(Number(n.toFixed(4)));

  it("spells the scene's M, L and C as PDF's m, l and c", () => {
    expect(pathOperators("M0 0 L10 0 C1 2 3 4 5 6", f, "t")).toBe("0 0 m 10 0 l 1 2 3 4 5 6 c");
  });

  it("resolves relative commands, H, V and Z", () => {
    expect(pathOperators("m1 1 l2 0 h3 v4 z", f, "t")).toBe("1 1 m 3 1 l 6 1 l 6 5 l h");
  });

  it("raises a quadratic to the cubic with the same curve", () => {
    expect(pathOperators("M0 0 Q3 3 6 0", f, "t")).toBe("0 0 m 2 2 4 2 6 0 c");
  });

  it("refuses an arc rather than dropping it", () => {
    expect(() => pathOperators("M0 0 A5 5 0 0 1 10 0", f, "hash")).toThrow(/"A" in hash/);
  });
});

describe("pdfColor", () => {
  it("reads the scene's hex colours", () => {
    expect(pdfColor("#000000", "t")).toEqual([0, 0, 0]);
    expect(pdfColor("#fff", "t")).toEqual([1, 1, 1]);
  });

  it("refuses a colour it cannot read rather than painting it black", () => {
    expect(() => pdfColor("var(--ink)", "bond:b1")).toThrow(/bond:b1/);
  });
});
