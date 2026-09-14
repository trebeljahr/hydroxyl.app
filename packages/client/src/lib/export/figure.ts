/**
 * Document -> publication figure: the one place the client turns a sketch's
 * panels into chem-render's figure and decides how big it prints.
 *
 * ── REBUILT FROM SCENES, NEVER FROM THE LIVE CANVAS ───────────────────────
 *
 * The canvas `<svg>` carries Tailwind classes, overlay marks, the viewport's
 * pan-and-zoom transform and `data-atom-id` hooks. None of it may reach a file
 * — a class or a `var(--…)` resolves to nothing outside the app and the figure
 * opens invisible — so nothing here reads the DOM. The export is composed from
 * the document with chem-render and serialised by its DOM-free serialiser,
 * which is also why the editor's pan and zoom cannot move the viewBox.
 *
 * ── THE FIGURE STYLE IS THE PUBLICATION PRESET ────────────────────────────
 *
 * Whatever preset the canvas draws with, a figure is exported in
 * `PUBLICATION_STYLE`: ACS-like line weights and label size relative to the
 * bond, and no background (a transparent SVG takes the colour of the page it
 * lands on). This is a call made for this task, not an owner ruling; it is
 * named in the report so it can be overruled.
 */

import { isEmpty } from "@starter/chem-core";
import {
  JOURNAL_WIDTHS_CM,
  PUBLICATION_STYLE,
  composeFigure,
  physicalFigureSize,
  serializeFigure,
  unavailableCells,
} from "@starter/chem-render";
import type { Figure, PhysicalFigureSize, RenderStyle } from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { toRenderRepresentation } from "@/canvas/scene-bridge";
import { fileBaseName } from "@/lib/io/save";
import type { FigureExportSettings } from "@/state/types";

export const FIGURE_STYLE: RenderStyle = PUBLICATION_STYLE;

/** A custom width outside this range is refused rather than clamped. */
export const CUSTOM_WIDTH_RANGE_CM = Object.freeze({ min: 2, max: 60 });

/**
 * Canvas limits for the PNG path.
 *
 * ENGINES DISAGREE, SO NO ONE ENGINE'S LIMIT IS APPLIED TO ALL OF THEM.
 * iOS Safari caps a canvas at 16,777,216 px of area; Chromium allows 32,767
 * px a side and 268,435,456 px of area. A double-column figure at 600 dpi is
 * 4205 px wide, so anything taller than about 0.95 of its width crosses the
 * Safari cap — a 2 × 2 grid does. Refusing that everywhere would take a
 * preset the dialog offers away from the browsers that can draw it.
 *
 * So: above the HARD limits no engine can hold the canvas and the export is
 * refused outright. Between the SAFE area and the hard limits the answer
 * depends on the browser, and `rasterTooLarge` asks it through a probe (see
 * `canvasCanHold` in png.ts). Below the safe area every engine can.
 */
export const SAFE_RASTER_AREA_PX = 16_777_216;
export const MAX_RASTER_AREA_PX = 268_435_456;
export const MAX_RASTER_SIDE_PX = 32_767;

/** Opaque white for the raster: many submission systems and viewers flatten
 *  a transparent PNG onto black. The SVG stays transparent. */
export const RASTER_BACKGROUND = "#ffffff";

export function documentFigure(doc: SketchDocument): Figure {
  return composeFigure(
    doc.molecule,
    FIGURE_STYLE,
    doc.panels.map((panel) => ({
      id: panel.id,
      representation: toRenderRepresentation(panel.representation),
      caption: panel.caption,
    })),
    { columns: doc.figure?.columns },
  );
}

export type WidthResult =
  | { readonly ok: true; readonly widthCm: number }
  | { readonly ok: false; readonly message: string };

export function exportWidthCm(settings: FigureExportSettings): WidthResult {
  if (settings.width === "single") return { ok: true, widthCm: JOURNAL_WIDTHS_CM.single };
  if (settings.width === "double") return { ok: true, widthCm: JOURNAL_WIDTHS_CM.double };
  const { customWidthCm } = settings;
  if (
    !Number.isFinite(customWidthCm) ||
    customWidthCm < CUSTOM_WIDTH_RANGE_CM.min ||
    customWidthCm > CUSTOM_WIDTH_RANGE_CM.max
  ) {
    return {
      ok: false,
      message: `A custom width must be between ${CUSTOM_WIDTH_RANGE_CM.min} and ${CUSTOM_WIDTH_RANGE_CM.max} cm.`,
    };
  }
  return { ok: true, widthCm: customWidthCm };
}

export interface PreparedFigure {
  readonly figure: Figure;
  readonly size: PhysicalFigureSize & { readonly widthPx: number; readonly heightPx: number };
  readonly filenameBase: string;
}

export type PrepareResult =
  | { readonly ok: true; readonly value: PreparedFigure }
  | { readonly ok: false; readonly message: string };

/**
 * Everything an export needs, or the one sentence explaining why there is no
 * export. Checked here, once, so the SVG download, the PNG download and the
 * clipboard refuse for the same reasons in the same words.
 */
export function prepareFigure(
  doc: SketchDocument,
  settings: FigureExportSettings,
): PrepareResult {
  if (isEmpty(doc.molecule)) {
    return { ok: false, message: "Nothing has been drawn yet, so there is no figure to export." };
  }
  if (doc.panels.length === 0) {
    return { ok: false, message: "The figure has no panels. Add one in the Figure panels list." };
  }
  const width = exportWidthCm(settings);
  if (!width.ok) return width;

  const figure = documentFigure(doc);
  const missing = unavailableCells(figure);
  if (missing.length > 0) {
    // Refused, not marked: a figure with a placeholder in it is not something
    // anybody submits, and exporting one quietly would be the empty cell this
    // task exists to rule out. The preview still draws the marked cell, so
    // the reason is visible before anyone reaches for the button.
    return {
      ok: false,
      message: missing
        .map(
          (cell) =>
            `Panel (${cell.letter}) cannot be drawn: ${
              cell.content.kind === "unavailable" ? cell.content.availability.message : ""
            }`,
        )
        .join(" "),
    };
  }

  const size = physicalFigureSize(figure, width.widthCm, settings.dpi);
  const widthPx = size.widthPx ?? 0;
  const heightPx = size.heightPx ?? 0;
  return {
    ok: true,
    value: {
      figure,
      size: { ...size, widthPx, heightPx },
      filenameBase: fileBaseName(doc),
    },
  };
}

/** The file: physical units, the font embedded, transparent. */
export function figureSvgForFile(prepared: PreparedFigure): string {
  return serializeFigure(prepared.figure, {
    dimensions: { width: prepared.size.widthCm, height: prepared.size.heightCm, unit: "cm" },
    embedFont: true,
    background: null,
  });
}

/**
 * The raster's source. Its `width`/`height` ARE the backing store's pixel
 * size, so the browser rasterises the vectors at that resolution; drawing a
 * small intrinsic image into a large canvas would be an upscaled blur. The
 * font is embedded because an `<img>`-loaded SVG may not fetch anything.
 */
export function figureSvgForRaster(prepared: PreparedFigure): string {
  return serializeFigure(prepared.figure, {
    standalone: false,
    indent: false,
    dimensions: { width: prepared.size.widthPx, height: prepared.size.heightPx, unit: "px" },
    embedFont: true,
    background: RASTER_BACKGROUND,
  });
}

/** For the export dialog: unavailable panels MARKED, so the reason shows. */
export function figurePreviewSvg(doc: SketchDocument): string {
  return serializeFigure(documentFigure(doc), {
    standalone: false,
    indent: false,
    embedFont: true,
    unavailable: "mark",
    background: RASTER_BACKGROUND,
  });
}

/**
 * A sentence when the PNG for `prepared` cannot be drawn in this browser, or
 * null when it can. `canHold` asks the browser whether it can allocate a
 * canvas of that size; it is consulted only above the area every engine
 * supports, so the ordinary case never allocates a probe canvas. Without a
 * probe (a plain-node caller) only the hard limits apply.
 */
export function rasterTooLarge(
  prepared: PreparedFigure,
  canHold?: (widthPx: number, heightPx: number) => boolean,
): string | null {
  const { widthPx, heightPx } = prepared.size;
  const area = widthPx * heightPx;
  if (widthPx > MAX_RASTER_SIDE_PX || heightPx > MAX_RASTER_SIDE_PX || area > MAX_RASTER_AREA_PX) {
    return `A ${widthPx} × ${heightPx} px PNG is larger than any browser canvas can hold. Choose a narrower width or 300 dpi, or export the SVG.`;
  }
  if (area > SAFE_RASTER_AREA_PX && canHold !== undefined && !canHold(widthPx, heightPx)) {
    return `A ${widthPx} × ${heightPx} px PNG is larger than this browser's canvas can hold. Choose a narrower width or 300 dpi, export the SVG, or use a browser with a larger canvas limit.`;
  }
  return null;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
