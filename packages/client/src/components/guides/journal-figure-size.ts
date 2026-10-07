/**
 * Every number the journal-figure-size guide prints, and where each one comes
 * from.
 *
 * ── TWO SOURCES, KEPT APART ON PURPOSE ─────────────────────────────────────
 *
 * The PRODUCT's numbers are imported from chem-render, never typed: the bond
 * length, the column widths, the label minimum and the dpi choices are the
 * constants the export dialog applies, so the guide cannot describe an export
 * the editor no longer makes. The Publication label size and line width are
 * computed from `PUBLICATION_STYLE` at the printed bond, the same way
 * `physicalFigureSize` reads them out.
 *
 * The JOURNAL's numbers are ACS's own text, so they are typed — there is
 * nothing to import them from — with the page and the date they were read.
 * Where the two should agree (the 14.4 pt bond, the 10 pt label, the 8 pt
 * minimum) the unit test says so, so a drift on either side fails a test
 * rather than printing two different numbers on one page.
 *
 * ── THE TWO DO NOT AGREE ON THE COLUMN, AND THE PAGE SAYS SO ───────────────
 *
 * ACS allows a single column up to 240 pt, 8.47 cm. `JOURNAL_WIDTHS_CM.single`
 * is 8.25 cm (3.25 in), a little narrower, so a figure sized for it fits. The
 * double column is 17.8 cm, which is 504 pt (7 in) rounded to the millimetre.
 * Neither is changed here: those widths are decision 20's, and the guide
 * reports them as they are.
 *
 * ── THE WORKED EXAMPLE IS THE EXPORT PATH'S OWN OUTPUT ─────────────────────
 *
 * The landing page's acetic acid, run through `prepareFigure` twice: as it
 * ships, two panels to a row, and with all four in one row. The sizes and the
 * warning sentence are what the export dialog shows for those two documents
 * at a single column. It runs at build time; the guide is a server component.
 */

import {
  CM_PER_INCH,
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
  PUBLICATION_STYLE,
  RASTER_DPI_CHOICES,
  printedCmPerPx,
  serializeFigure,
} from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { exampleDocument, exampleOneRowDocument } from "@/components/landing/example-document";
import { formatPt, labelSizeNotice, prepareFigure, scaleNotice } from "@/lib/export/figure";
import type { FigureExportSettings } from "@/state/types";

const POINTS_PER_INCH = 72;

export function cmFromPt(pt: number): number {
  return (pt / POINTS_PER_INCH) * CM_PER_INCH;
}

export function ptFromCm(cm: number): number {
  return (cm / CM_PER_INCH) * POINTS_PER_INCH;
}

/**
 * What the ACS Catalysis author guidelines say, read on 2026-09-29.
 *
 * That page because it states everything the guide needs in one place: the
 * structure drawing settings, "no smaller than 8 pt" for artwork text, and
 * Appendix 2's sizes. The JACS, J. Org. Chem. and Org. Lett. pages carry the
 * same Appendix 2 size text word for word (checked the same day), but not the
 * drawing settings or the 8 pt line. It is the page chem-render's
 * `MIN_PRINTED_LABEL_PT` cites, too.
 */
export const ACS_GUIDELINE = Object.freeze({
  pageTitle: "ACS Catalysis author guidelines",
  url: "https://researcher-resources.acs.org/publish/author_guidelines?coden=accacs",
  fetched: "2026-09-29",
  /** The one sentence quoted verbatim; everything else is paraphrased. */
  quote: "Single-column graphics can be sized up to 240 points wide (3.33 in.)",
  singleColumnMaxPt: 240,
  doubleColumnMinPt: 300,
  doubleColumnMaxPt: 504,
  bondLengthPt: 14.4,
  labelPt: 10,
  lineWidthPt: 0.6,
  boldWidthPt: 2,
  /** "Artwork Tables/Schemes/Graphics": fonts no smaller than 8 pt. */
  minArtworkTextPt: 8,
  /** Appendix 2: lettering no smaller than 4.5 pt in the final published format. */
  minPublishedLetteringPt: 4.5,
  lineArtDpi: 1200,
  grayscaleDpi: 600,
  colourDpi: 300,
});

/** A length for prose: at most `digits` decimals, trailing zeros dropped. */
export function decimal(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

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

const SINGLE_COLUMN: FigureExportSettings = {
  width: "single",
  customWidthCm: 12,
  dpi: 600,
  style: "publication",
  pngBackground: "white",
};

function worked(doc: SketchDocument): WorkedFigure {
  const prepared = prepareFigure(doc, SINGLE_COLUMN);
  if (!prepared.ok) {
    // Same stance as the landing page: a guide whose example cannot be
    // exported would be describing an export that does not happen.
    throw new Error(`The figure-size guide's example cannot be exported: ${prepared.message}`);
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

export interface GuideNumbers {
  readonly bondCm: string;
  readonly bondMm: string;
  readonly bondPt: string;
  readonly labelPt: string;
  readonly lineWidthPt: string;
  readonly singleCm: string;
  readonly doubleCm: string;
  readonly minLabelPt: string;
  readonly dpiChoices: readonly number[];
  /** How far a Publication figure can shrink before its labels pass the minimum. */
  readonly shrinkFloorPercent: string;
  /** The widest a structure can be at full size and still keep its labels
   *  at the minimum in a single column. */
  readonly maxNaturalSingleCm: string;
  readonly acsSingleCm: string;
  readonly acsDoubleMinCm: string;
  readonly acsDoubleMaxCm: string;
  readonly twoPerRow: WorkedFigure;
  readonly oneRow: WorkedFigure;
}

export function guideNumbers(): GuideNumbers {
  const cmPerPx = printedCmPerPx(PUBLICATION_STYLE);
  const labelPt = ptFromCm(PUBLICATION_STYLE.fontSizePx * cmPerPx);
  const lineWidthPt = ptFromCm(PUBLICATION_STYLE.bondLineWidthPx * cmPerPx);
  const shrinkFloor = MIN_PRINTED_LABEL_PT / labelPt;
  return {
    bondCm: String(PRINTED_BOND_LENGTH_CM),
    bondMm: (PRINTED_BOND_LENGTH_CM * 10).toFixed(2),
    bondPt: decimal(ptFromCm(PRINTED_BOND_LENGTH_CM), 1),
    labelPt: decimal(labelPt, 1),
    lineWidthPt: decimal(lineWidthPt, 2),
    singleCm: String(JOURNAL_WIDTHS_CM.single),
    doubleCm: String(JOURNAL_WIDTHS_CM.double),
    minLabelPt: String(MIN_PRINTED_LABEL_PT),
    dpiChoices: RASTER_DPI_CHOICES,
    shrinkFloorPercent: decimal(shrinkFloor * 100, 0),
    // Down, so the width it names really does keep the labels at the minimum.
    maxNaturalSingleCm: (Math.floor((JOURNAL_WIDTHS_CM.single / shrinkFloor) * 10) / 10).toFixed(1),
    acsSingleCm: cmFromPt(ACS_GUIDELINE.singleColumnMaxPt).toFixed(2),
    acsDoubleMinCm: cmFromPt(ACS_GUIDELINE.doubleColumnMinPt).toFixed(2),
    acsDoubleMaxCm: cmFromPt(ACS_GUIDELINE.doubleColumnMaxPt).toFixed(2),
    twoPerRow: worked(exampleDocument()),
    oneRow: worked(exampleOneRowDocument()),
  };
}
