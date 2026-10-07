import { describe, expect, it } from "vitest";

import { ethanol, sn2TransitionState } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import type { FigureExportSettings } from "@/state/types";

import { pdfFontNotice, prepareFigure } from "./figure";
import { figurePdfBlob } from "./pdf";

const NOW = "2024-01-01T00:00:00.000Z";
const SINGLE: FigureExportSettings = { width: "single", customWidthCm: 12, dpi: 300, style: "publication", pngBackground: "white" };

function prepared(doc: SketchDocument) {
  const result = prepareFigure(doc, SINGLE);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const ethanolDoc = createDocument({
  title: "Ethanol",
  molecule: ethanol(),
  panels: [createPanel("skeletal")],
  now: NOW,
});

describe("the PDF download (decision 236)", () => {
  it("is a PDF the printed size the dialog reports, titled after the sketch", async () => {
    const figure = prepared(ethanolDoc);
    const blob = await figurePdfBlob(figure);
    expect(blob.type).toBe("application/pdf");
    const text = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(Number(box?.[1])).toBeCloseTo((figure.size.widthCm / 2.54) * 72, 3);
    expect(Number(box?.[2])).toBeCloseTo((figure.size.heightCm / 2.54) * 72, 3);
    expect(text).toContain("/FontFile2");
    // "Ethanol" in UTF-16BE.
    expect(text).toContain("/Title <FEFF0045007400680061006E006F006C>");
  });

  it("says nothing about fonts when every glyph is embedded", () => {
    expect(pdfFontNotice(prepared(ethanolDoc))).toBeNull();
  });

  it("names the Greek letters it leaves to the reader's Symbol font", () => {
    const scheme = sn2TransitionState();
    const doc = createDocument({
      molecule: scheme.molecule,
      annotations: scheme.annotations,
      panels: [createPanel("skeletal")],
      now: NOW,
    });
    expect(pdfFontNotice(prepared(doc))).toBe(
      "The PDF sets δ in the reader's Symbol font and does not embed it. The bundled font has no Greek letters.",
    );
  });
});
