/**
 * Every number and every quoted sentence the multi-panel guide prints.
 *
 * ── THE FIGURES ARE THE EXPORT PATH'S OWN OUTPUT ───────────────────────────
 *
 * Aspirin in four panels, through `prepareFigure` at a single column twice:
 * with the column count the guide sets, and with the field left empty so
 * chem-render picks it. The sizes, the shrink and the label warning are what
 * the export dialog shows for those two documents.
 *
 * ── THE PRODUCT'S WORDS ARE IMPORTED, NOT TYPED ────────────────────────────
 *
 * The view names the steps tell the reader to choose are `VIEW_KIND_TITLES`,
 * the table the panel menus read. The sentence the editor gives for refusing
 * a condensed formula is `representationAvailability`'s own. The automatic
 * column count is `defaultFigureColumns`. A rename in chem-render changes
 * the guide with it.
 *
 * ── THE JOURNAL'S WORDS ARE CITED ──────────────────────────────────────────
 *
 * ACS asks for a caption for the whole figure, in the manuscript. That is
 * the one rule here that comes from a journal, so it is quoted with the page
 * and the day it was read, like the figure-size guide's ACS numbers.
 */

import {
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  VIEW_KIND_TITLES,
  defaultFigureColumns,
  panelLetter,
  representationAvailability,
} from "@starter/chem-render";
import { DEFAULT_PANELS, MAX_FIGURE_COLUMNS } from "@starter/shared";

import {
  MULTI_PANEL_COLUMNS,
  MULTI_PANEL_VIEWS,
  aspirinMolecule,
  multiPanelAutomaticDocument,
  multiPanelDocument,
} from "./multi-panel-examples";
import { singleColumnFigure } from "./guide-figure";
import type { WorkedFigure } from "./guide-figure";
import { ACS_GUIDELINE } from "./journal-figure-size";

/**
 * What ACS asks of a figure caption, from the same ACS Catalysis author
 * guidelines the figure-size guide cites, section "Figures", read on
 * 2026-10-07. The guidelines say the caption gives the figure number and a
 * brief description, preferably one or two sentences.
 */
export const ACS_FIGURE_CAPTION = Object.freeze({
  pageTitle: ACS_GUIDELINE.pageTitle,
  url: ACS_GUIDELINE.url,
  fetched: "2026-10-07",
  section: "Figures",
  /** The one sentence fragment quoted verbatim. */
  quote: "A caption giving the figure number and a brief description",
});

export interface MultiPanelPanel {
  /** "(a)". */
  readonly label: string;
  /** The panel menu's name for the view: "Explicit H". */
  readonly view: string;
  readonly caption: string;
}

export interface MultiPanelNumbers {
  readonly panels: readonly MultiPanelPanel[];
  readonly columns: number;
  /** Panels per row when the Columns field is empty. */
  readonly automaticColumns: number;
  readonly maxColumns: number;
  readonly singleCm: string;
  readonly minLabelPt: string;
  /** The editor's sentence for refusing a condensed formula of aspirin. */
  readonly condensedRefusal: string;
  /** The views of the panels a new sketch opens with, in order. The steps
   *  are written for two: the first kept, the second changed. */
  readonly newSketchViews: readonly string[];
  readonly finished: WorkedFigure;
  readonly automatic: WorkedFigure;
  /** "75", the automatic figure's scale in a single column. */
  readonly automaticScalePercent: string;
}

export function multiPanelNumbers(): MultiPanelNumbers {
  const condensed = representationAvailability(aspirinMolecule(), "condensed");
  if (condensed.available) {
    // The guide explains why (d) is not the condensed formula. If chem-render
    // ever draws one for a ring, that section is wrong, and this says so.
    throw new Error("The multi-panel guide expects aspirin to have no condensed formula.");
  }
  const finished = singleColumnFigure(multiPanelDocument());
  const automatic = singleColumnFigure(multiPanelAutomaticDocument());
  return {
    panels: MULTI_PANEL_VIEWS.map(({ kind, caption }, index) => ({
      label: `(${panelLetter(index)})`,
      view: VIEW_KIND_TITLES[kind],
      caption,
    })),
    columns: MULTI_PANEL_COLUMNS,
    automaticColumns: defaultFigureColumns(MULTI_PANEL_VIEWS.length),
    maxColumns: MAX_FIGURE_COLUMNS,
    singleCm: String(JOURNAL_WIDTHS_CM.single),
    minLabelPt: String(MIN_PRINTED_LABEL_PT),
    condensedRefusal: condensed.message,
    newSketchViews: DEFAULT_PANELS.map((panel) => VIEW_KIND_TITLES[panel.representation.kind]),
    finished,
    automatic,
    automaticScalePercent: String(Math.round((automatic.widthCm / automatic.naturalWidthCm) * 100)),
  };
}

/** A size the way the export dialog prints it: "7.62 × 8.91 cm". */
export function printedSize(figure: WorkedFigure): string {
  return `${figure.widthCm.toFixed(2)} × ${figure.heightCm.toFixed(2)} cm`;
}
