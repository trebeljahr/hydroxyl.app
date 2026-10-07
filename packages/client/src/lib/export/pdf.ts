/**
 * Prepared figure -> PDF blob (decision 236).
 *
 * The writer is chem-render's `serializeFigurePdf`, imported from its own
 * entry point on demand: it carries the embedded Arimo, ~20 kB, which no one
 * who never exports a PDF should download. The page is the size the dialog
 * reports, in centimetres, so the PDF prints at exactly the width the SVG
 * does. Transparent like the SVG; paper supplies the white.
 */

import type { PreparedFigure } from "./figure";

export async function figurePdfBlob(prepared: PreparedFigure): Promise<Blob> {
  const { serializeFigurePdf } = await import("@starter/chem-render/pdf");
  const bytes = serializeFigurePdf(prepared.figure, {
    dimensions: { width: prepared.size.widthCm, height: prepared.size.heightCm, unit: "cm" },
    background: null,
    title: prepared.filenameBase,
  });
  return new Blob([bytes], { type: "application/pdf" });
}
