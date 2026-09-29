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
 * ── THE FIGURE STYLE DEFAULTS TO PUBLICATION (decision 50) ───────────────
 *
 * Every export path — the SVG file, the PNG, Copy figure and the dialog's
 * preview — composes with `figureStyle(doc, choice)`, so the four can never
 * disagree about what the file looks like. The choice defaults to
 * `PUBLICATION_STYLE` whatever the canvas shows, and "canvas" resolves through
 * `renderStyleFor(doc)`, the same function the canvas draws with.
 *
 * This partly reverses decision 21 ("export what the canvas shows"). At the
 * fixed printed bond Screen sets 5.2 pt labels where the ACS 1996 setting
 * asks 10 pt; a warning with a one-click switch still let faint figures reach
 * a manuscript, because new documents open in Screen and most people never
 * change it. The choice is session UI state, never the document's preset, so
 * exporting cannot restyle the canvas or leave an undo entry behind.
 *
 * ── HOW BIG IT PRINTS (decision 20) ──────────────────────────────────────
 *
 * One bond prints at `PRINTED_BOND_LENGTH_CM`, and the chosen width is a
 * MAXIMUM: `physicalFigureSize` prints a small figure at its natural size and
 * scales a wide one down to the column, reporting the factor. `scaleNotice`
 * is the sentence the dialog shows for it.
 *
 * ── LABELS BELOW 8 PT WARN, AND STILL EXPORT (decision 51) ───────────────
 *
 * Scaling shrinks the labels with everything else. When they print under
 * `MIN_PRINTED_LABEL_PT`, `labelSizeNotice` says so with the printed size and
 * what would bring them back — never a refusal, since a small figure can be
 * exactly what was wanted.
 *
 * The same check covers every annotation a figure draws (decision 60):
 * `annotationSizeNotice` names which of them print small, and
 * `ANNOTATION_CHECKS` is total over `AnnotationKind` so a new one cannot ship
 * outside the check. Descriptors, group tags and the `rac-`/`rel-` prefix can
 * reach it today — nothing numbers atoms yet, so no figure draws a locant
 * (decision 37) and that part of the check is deliberately unexercised rather
 * than untested. Publication sets descriptors at exactly 8 pt (decision 54), so
 * ANY scaling to fit takes them under while the labels, at 10 pt, still have
 * room; it sets a group tag at 6 pt (decision 123), so a tag is under the
 * minimum at EVERY width; and it sets the prefix at the descriptor's scale
 * (decision 98), so the prefix goes under on exactly the same scaling that
 * takes the descriptors under.
 */

import { BOND_LENGTH_NORMALIZE_TOLERANCE, isEmpty } from "@starter/chem-core";
import {
  ANNOTATION_PRIORITY,
  JOURNAL_WIDTHS_CM,
  MIN_PRINTED_LABEL_PT,
  PRINTED_BOND_LENGTH_CM,
  PUBLICATION_STYLE,
  composeFigure,
  physicalFigureSize,
  serializeFigure,
  unavailableCells,
} from "@starter/chem-render";
import type {
  AnnotationKind,
  Figure,
  PhysicalFigureSize,
  RenderStyle,
} from "@starter/chem-render";
import type { SketchDocument } from "@starter/shared";

import { STYLE_PRESET_TITLES, renderStyleFor, toRenderRepresentation } from "@/canvas/scene-bridge";
import { fileBaseName } from "@/lib/io/save";
import type { FigureExportSettings, FigureStyleChoice } from "@/state/types";

/** A custom width outside this range is refused rather than clamped. */
export const CUSTOM_WIDTH_RANGE_CM = Object.freeze({ min: 2, max: 60 });

/**
 * Canvas limits for the PNG path.
 *
 * ENGINES DISAGREE, SO NO ONE ENGINE'S LIMIT IS APPLIED TO ALL OF THEM.
 * iOS Safari caps a canvas at 16,777,216 px of area; Chromium allows 32,767
 * px a side and 268,435,456 px of area. A figure filling a double column at
 * 600 dpi is 4205 px wide, so once it is taller than about 0.95 of that width
 * it crosses the Safari cap. With a fixed printed bond length only a large
 * structure gets there, but refusing it everywhere would take a size the
 * dialog offers away from the browsers that can draw it.
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

/**
 * The style an export draws with. "canvas" goes through the canvas's own
 * resolution rather than a copy of it, so it cannot pick a different preset.
 */
export function figureStyle(doc: SketchDocument, choice: FigureStyleChoice): RenderStyle {
  return choice === "canvas" ? renderStyleFor(doc) : PUBLICATION_STYLE;
}

/**
 * The sentence the dialog shows when the file will not look like the canvas,
 * or null when it will. Said plainly, so nobody is surprised that the download
 * is lighter than the editor. Screen chosen for print gets no sentence here:
 * its labels print under 8 pt, so `labelSizeNotice` already warns and names
 * Publication as the fix, and a second warning would only repeat it.
 */
export function figureStyleNotice(
  doc: SketchDocument,
  settings: FigureExportSettings,
): string | null {
  if (figureStyle(doc, settings.style) === renderStyleFor(doc)) return null;
  return `The canvas shows the ${STYLE_PRESET_TITLES[doc.stylePreset]} style. The export uses the Publication style.`;
}

export function documentFigure(doc: SketchDocument, choice: FigureStyleChoice): Figure {
  return composeFigure(
    doc.molecule,
    figureStyle(doc, choice),
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

/** "a single column", "a double column", "the 12 cm custom width". */
export function widthName(settings: FigureExportSettings, maxWidthCm: number): string {
  if (settings.width === "single") return "a single column";
  if (settings.width === "double") return "a double column";
  return `the ${formatCm(maxWidthCm)} cm custom width`;
}

function formatCm(cm: number): string {
  return String(Number(cm.toFixed(2)));
}

/**
 * The plain sentence for a figure that had to be shrunk, or null when it
 * prints at the house bond length. Rounded DOWN, so a figure at 99.6 % never
 * claims "100 %" — which would read as "not scaled" while the bond is not
 * the house length.
 */
export function scaleNotice(
  size: PhysicalFigureSize,
  settings: FigureExportSettings,
): string | null {
  if (!size.scaled) return null;
  const percent = Math.floor(size.scale * 100 + 1e-9);
  return `Scaled to ${percent}% to fit ${widthName(settings, size.maxWidthCm)}.`;
}

/**
 * A printed size in points for display, rounded DOWN to a tenth, for the
 * same reason `scaleNotice` rounds down: 7.96 pt shown as "8.0 pt" beside a
 * warning that it is under 8 pt would contradict itself. The small epsilon
 * keeps an exact 10 pt, computed as 9.999999999, from reading 9.9.
 */
export function formatPt(pt: number): string {
  return (Math.floor(pt * 10 + 1e-6) / 10).toFixed(1);
}

export interface LabelSizeNotice {
  /** The finding, short enough for the status bar. */
  readonly summary: string;
  /** What would bring the labels back up to the minimum. */
  readonly advice: string;
}

/**
 * The warning for labels that print below `MIN_PRINTED_LABEL_PT`, or null.
 * Suggests only what would actually help this figure: a double column only
 * when the figure's labels reach the minimum at that width, fewer panels per
 * row only when there is more than one, fewer panels only when there are
 * several.
 */
export function labelSizeNotice(
  prepared: PreparedFigure,
  settings: FigureExportSettings,
): LabelSizeNotice | null {
  const { size } = prepared;
  if (!size.labelsBelowMinimum) return null;
  const summary = `Labels print at ${formatPt(size.fontSizePt)} pt, below the ${MIN_PRINTED_LABEL_PT} pt minimum ACS asks for in figures.`;
  const needed = size.minWidthCmForMinLabel;
  if (needed === null) {
    return {
      summary,
      advice: `This style's labels are under ${MIN_PRINTED_LABEL_PT} pt even at full size, so no width fixes it. Choose a style with larger labels, such as Publication.`,
    };
  }
  return { summary, advice: widthAdvice(prepared, settings, needed) };
}

/** "They reach 8 pt at a maximum width of N cm. Try …", for text that can. */
function widthAdvice(
  prepared: PreparedFigure,
  settings: FigureExportSettings,
  needed: number,
): string {
  const { figure } = prepared;
  const remedies: string[] = [];
  if (settings.width !== "double" && needed <= JOURNAL_WIDTHS_CM.double * (1 + 1e-9)) {
    remedies.push("a double column");
  }
  if (figure.columns > 1) remedies.push("fewer panels per row");
  if (figure.cells.length > 1) remedies.push("fewer panels");
  // Up, so the width it names really does reach the minimum.
  const neededCm = String(Math.ceil(needed * 100 - 1e-6) / 100);
  const reach = `They reach ${MIN_PRINTED_LABEL_PT} pt at a maximum width of ${neededCm} cm.`;
  return remedies.length === 0 ? reach : `${reach} Try ${joinOr(remedies)}.`;
}

/**
 * EVERY annotation kind, with either the name a notice gives it or the reason
 * decision 60's 8 pt check leaves it out.
 *
 * TOTAL BY CONSTRUCTION, which is the point. `CHECKED_ANNOTATION_KINDS` used to
 * be a hand-written subset of three, so a kind added to `AnnotationKind`
 * shipped outside the check with nothing to say so — and that is exactly what
 * happened to `stereoPrefix`, which was ruled into the band by decision 88 and
 * left out of the check until decision 98 noticed. `ANNOTATION_PRIORITY` in
 * chem-render carries an `IsTotal` guard for the same reason; this is its
 * counterpart on the export side, so a seventh kind is a COMPILE ERROR here
 * rather than a silent omission from a figure's warning.
 *
 * `stereoGroup` is checked because decision 123 put it here: its own scale is
 * below the descriptor's, so at Publication a tag prints at 6 pt — under the
 * floor at every width, not only a scaled-down one.
 *
 * `stereoPrefix` is checked because decision 98 put it here: it is set at the
 * DESCRIPTOR scale, which at Publication is exactly 8 pt, so any scale-to-fit
 * takes it under the floor — the identical gap decision 60 exists to close, on
 * the one group mark that reliably draws at Publication.
 *
 * `alphaBeta` and `torsion` are declared kinds with no producer: nothing
 * requests them, so no figure draws one and the check cannot reach them. They
 * say so here rather than being absent, so the day one gains a producer the
 * choice is made deliberately.
 */
type AnnotationCheck = { readonly name: string } | { readonly unchecked: string };

const ANNOTATION_CHECKS = {
  descriptor: { name: "Stereo descriptors" },
  stereoGroup: { name: "Stereo group tags" },
  stereoPrefix: { name: "Stereo prefixes (rac-/rel-)" },
  alphaBeta: { unchecked: "no producer requests it, so no figure draws one" },
  locant: { name: "Locants" },
  torsion: { unchecked: "no producer requests it, so no figure draws one" },
} as const satisfies Readonly<Record<AnnotationKind, AnnotationCheck>>;

/** The kinds with a name above — derived, so the two cannot drift apart. */
export type CheckedAnnotationKind = {
  [K in AnnotationKind]: (typeof ANNOTATION_CHECKS)[K] extends { readonly name: string }
    ? K
    : never;
}[AnnotationKind];

function isChecked(kind: AnnotationKind): kind is CheckedAnnotationKind {
  return "name" in ANNOTATION_CHECKS[kind];
}

/**
 * The checked kinds in the order a notice names them — `ANNOTATION_PRIORITY`'s
 * order, so the sentence reads down the band the way the figure draws it.
 * Filtered from that table rather than spelled again, which is what keeps the
 * order and the membership from disagreeing.
 */
export const CHECKED_ANNOTATION_KINDS: readonly CheckedAnnotationKind[] = Object.freeze(
  ANNOTATION_PRIORITY.filter(isChecked),
);

const ANNOTATION_NAMES: Readonly<Record<CheckedAnnotationKind, string>> = Object.freeze(
  Object.fromEntries(
    CHECKED_ANNOTATION_KINDS.map((kind) => [kind, ANNOTATION_CHECKS[kind].name]),
  ) as Record<CheckedAnnotationKind, string>,
);

export interface AnnotationSizeNotice extends LabelSizeNotice {
  /** The kinds that print under the minimum, in `CHECKED_ANNOTATION_KINDS` order. */
  readonly kinds: readonly CheckedAnnotationKind[];
  /** The smallest of them, as it prints after scaling. */
  readonly fontSizePt: number;
}

/**
 * Each annotation kind the figure DRAWS, with its run size in px: a kind that
 * is switched on but has nothing to draw (no stereocentre, no numbering) is
 * not shown, and a warning about it would be about nothing. Read from the
 * composed scenes, so it is the size the file carries.
 */
function drawnAnnotationSizesPx(prepared: PreparedFigure): Map<CheckedAnnotationKind, number> {
  const sizes = new Map<CheckedAnnotationKind, number>();
  for (const cell of prepared.figure.cells) {
    if (cell.content.kind !== "scene") continue;
    for (const primitive of cell.content.scene.primitives) {
      if (primitive.type !== "textRun") continue;
      for (const kind of CHECKED_ANNOTATION_KINDS) {
        if (!primitive.id.endsWith(`:${kind}`)) continue;
        const known = sizes.get(kind);
        if (known === undefined || primitive.fontSizePx < known) sizes.set(kind, primitive.fontSizePx);
      }
    }
  }
  return sizes;
}

/**
 * Decision 60: decision 51's 8 pt check, for every checked annotation a figure
 * draws — descriptors, group tags, the `rac-`/`rel-` prefix, locants. Null when
 * none is drawn, or when every drawn one prints at the minimum or above. Names
 * the kinds that are small, and, like `labelSizeNotice`, what would help;
 * export stays enabled either way.
 */
export function annotationSizeNotice(
  prepared: PreparedFigure,
  settings: FigureExportSettings,
): AnnotationSizeNotice | null {
  const { size, figure } = prepared;
  // Every run scales with the label: its printed size is the label's times
  // its share of the label's px size.
  const printed = (px: number): number => (size.fontSizePt * px) / figure.style.fontSizePx;
  const natural = (px: number): number => (size.naturalFontSizePt * px) / figure.style.fontSizePx;
  const minimum = MIN_PRINTED_LABEL_PT * (1 - 1e-9);
  const small = [...drawnAnnotationSizesPx(prepared)]
    .filter(([, px]) => printed(px) < minimum)
    .sort(([a], [b]) => CHECKED_ANNOTATION_KINDS.indexOf(a) - CHECKED_ANNOTATION_KINDS.indexOf(b));
  if (small.length === 0) return null;
  const kinds = small.map(([kind]) => kind);
  const smallestPx = Math.min(...small.map(([, px]) => px));
  const fontSizePt = printed(smallestPx);
  const names = kinds.map((kind, index) =>
    index === 0 ? ANNOTATION_NAMES[kind] : ANNOTATION_NAMES[kind].toLowerCase(),
  );
  const summary = `${names.join(" and ")} print at ${formatPt(fontSizePt)} pt, below the ${MIN_PRINTED_LABEL_PT} pt minimum ACS asks for in figures.`;
  const naturalPt = natural(smallestPx);
  if (naturalPt < minimum) {
    return {
      kinds,
      fontSizePt,
      summary,
      advice: `This style sets them under ${MIN_PRINTED_LABEL_PT} pt even at full size, so no width fixes it. Choose a style with larger annotations, such as Publication.`,
    };
  }
  // Linear in the width, as for the labels; never past the natural width.
  const needed = Math.min(size.naturalWidthCm, (size.naturalWidthCm * MIN_PRINTED_LABEL_PT) / naturalPt);
  return { kinds, fontSizePt, summary, advice: widthAdvice(prepared, settings, needed) };
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" or ");
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

/**
 * The plain sentence for a drawing whose bonds are not the standard length,
 * or null when they are.
 *
 * The house bond length is guaranteed for one MODEL UNIT, and imports are
 * normalised to it, but a document saved before that normalisation (or a
 * structure stretched by hand) can still carry other bonds. The read-out then
 * already shows the true printed bond; this says why it is not 5.08 mm, so
 * the difference is not mistaken for fit scaling. Measured against the
 * drawing alone, before any scaling to fit, which `scaleNotice` reports.
 */
export function bondLengthNotice(prepared: PreparedFigure): string | null {
  const ratio = prepared.figure.drawnBondLength;
  if (Math.abs(ratio - 1) <= BOND_LENGTH_NORMALIZE_TOLERANCE) return null;
  const percent = Math.round(ratio * 100);
  const standardMm = (PRINTED_BOND_LENGTH_CM * 10).toFixed(2);
  return `This drawing's bonds are ${percent}% of the standard bond, so they do not print at ${standardMm} mm.`;
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

  const figure = documentFigure(doc, settings.style);
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
export function figurePreviewSvg(doc: SketchDocument, choice: FigureStyleChoice): string {
  return serializeFigure(documentFigure(doc, choice), {
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
    return `A ${widthPx} × ${heightPx} px PNG is larger than any browser canvas can hold. Choose 300 dpi or a narrower maximum width, or export the SVG.`;
  }
  if (area > SAFE_RASTER_AREA_PX && canHold !== undefined && !canHold(widthPx, heightPx)) {
    return `A ${widthPx} × ${heightPx} px PNG is larger than this browser's canvas can hold. Choose 300 dpi or a narrower maximum width, export the SVG, or use a browser with a larger canvas limit.`;
  }
  return null;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
