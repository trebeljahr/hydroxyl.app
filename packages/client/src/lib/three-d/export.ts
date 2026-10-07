/**
 * The 3D PNG's size, from the same figure settings the 2D export uses.
 *
 * A journal states a figure as a printed width and a resolution, so the 3D
 * PNG takes the export dialog's width (single or double column, or custom)
 * and its dpi, and derives pixels. Its height follows the 3D view's own
 * shape on screen, so the file is the picture the user framed. The file
 * carries the dpi in a pHYs chunk like the 2D PNG (`withPhysChunk`).
 */

import { CM_PER_INCH } from "@starter/chem-render";

import { exportWidthCm } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

export type ThreeDPngSize =
  | {
      readonly ok: true;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly widthCm: number;
      readonly dpi: number;
    }
  | { readonly ok: false; readonly message: string };

export function threeDPngSize(settings: FigureExportSettings, aspect: number): ThreeDPngSize {
  const width = exportWidthCm(settings);
  if (!width.ok) return width;
  const widthPx = Math.round((width.widthCm / CM_PER_INCH) * settings.dpi);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return {
    ok: true,
    widthPx,
    heightPx: Math.max(1, Math.round(widthPx / safeAspect)),
    widthCm: width.widthCm,
    dpi: settings.dpi,
  };
}
