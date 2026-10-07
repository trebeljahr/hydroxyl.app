/**
 * A guide figure, made by the export dialog's own path at a single column.
 *
 * Every guide draws its figures through `prepareFigure` at build time, with
 * the settings the export dialog opens with, so the sizes and the warnings a
 * guide prints are the ones a reader gets when they export the same document.
 * A document the export would refuse fails the build here: a guide must not
 * show a picture the editor cannot make.
 */

import { serializeFigure } from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { formatPt, labelSizeNotice, prepareFigure, scaleNotice } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

export interface WorkedFigure {
  /** Inline SVG with no XML declaration, for the page to size in CSS cm. */
  readonly svg: string;
  readonly columns: number;
  readonly naturalWidthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly fontSizePt: string;
  /** "Scaled to 67% to fit a single column.", or null at full size. */
  readonly scaleNotice: string | null;
  /** The dialog's own label warning, summary and advice, or null. */
  readonly labelNotice: string | null;
}

/** The export dialog's settings with "Single column" chosen. */
export const SINGLE_COLUMN: FigureExportSettings = {
  width: "single",
  customWidthCm: 12,
  dpi: 600,
  style: "publication",
  pngBackground: "white",
};

export function singleColumnFigure(doc: SketchDocument): WorkedFigure {
  const prepared = prepareFigure(doc, SINGLE_COLUMN);
  if (!prepared.ok) {
    // Same stance as the landing page: a guide whose example cannot be
    // exported would be describing an export that does not happen.
    throw new Error(`The guide figure "${doc.metadata.title}" cannot be exported: ${prepared.message}`);
  }
  const { figure, size } = prepared.value;
  const label = labelSizeNotice(prepared.value, SINGLE_COLUMN);
  return {
    svg: serializeFigure(figure, {
      standalone: false,
      indent: false,
      embedFont: false,
      background: null,
    }),
    columns: figure.columns,
    naturalWidthCm: size.naturalWidthCm,
    widthCm: size.widthCm,
    heightCm: size.heightCm,
    fontSizePt: formatPt(size.fontSizePt),
    scaleNotice: scaleNotice(size, SINGLE_COLUMN),
    labelNotice: label === null ? null : `${label.summary} ${label.advice}`,
  };
}
