/**
 * Panel figures: several representations of ONE molecule on one grid.
 *
 * ── ONE STYLE, ONE BOND LENGTH (decision 5) ──────────────────────────────
 *
 * `composeFigure` takes a single `RenderStyle` and builds every panel with it.
 * That signature IS the enforcement of decision 5: there is no per-panel style
 * to pass, so there is no way to draw the Lewis panel at a smaller bond length
 * to make it fit beside the skeleton. A reader comparing panels (a) and (b)
 * measures the same bond with the same ruler.
 *
 * What differs wildly between panels — a sum formula is one line of text, a
 * Lewis structure is several times the area of the same skeleton — is absorbed
 * by LAYOUT, and only by layout:
 *
 *   - a column is as wide as its widest cell, a row as tall as its tallest;
 *   - a panel's ink is centred in its cell on both axes, so a formula sits at
 *     the vertical middle of a row whose height a Lewis structure set;
 *   - the (a)(b)(c) label sits above the cell's top-left corner and the caption
 *     below, centred and word-wrapped to the column's width.
 *
 * The price, accepted in the ruling, is whitespace next to a text panel.
 *
 * ── A PANEL TRANSFORM IS A TRANSLATE ─────────────────────────────────────
 *
 * Nothing here rewrites a primitive. Each cell carries an `offset`, and the
 * serialiser emits the panel's primitives unchanged inside
 * `<g transform="translate(dx dy)">`. `modelToPx` stays the only function that
 * scales. The one figure-level scale there is — centimetres per px, fixed by
 * the printed bond length and shrunk only to fit a column (physical.ts) —
 * lives in the SVG's own viewBox-to-viewport mapping, and is uniform by
 * construction.
 *
 * ── AVAILABILITY FIRST, SCENE SECOND ─────────────────────────────────────
 *
 * `buildScene` does not enforce availability: a sum formula over a molecule
 * with a `Ph` label builds a confidently wrong formula, a condensed view of a
 * ring silently falls back to the sum formula, and an unknown element throws.
 * So every panel is checked BEFORE its scene is requested, and an unavailable
 * panel becomes a marked placeholder that carries its reason. It never becomes
 * an empty cell, and the serialiser refuses to write it unless told to mark it.
 *
 * DOM-free and deterministic, like the rest of the package: labels and
 * captions are measured against the vendored font table, never a browser.
 */

import { medianBondLength } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { representationAvailability } from "../availability.js";
import type { ViewAvailability } from "../availability.js";
import { VIEW_KIND_TITLES } from "../representation.js";
import type { Representation } from "../representation.js";
import { sceneBounds } from "../scene/bounds.js";
import { buildScene } from "../scene/build.js";
import type { SceneBuildOptions } from "../scene/build.js";
import type {
  PolygonPrimitive,
  RenderScene,
  SceneBounds,
  ScenePoint,
  ScenePrimitive,
  TextRunPrimitive,
} from "../scene/types.js";
import { withStyle } from "../style.js";
import type { RenderStyle } from "../style.js";
import { measurerFor, measureTextRun } from "../text/measurer.js";

export interface FigurePanelSpec {
  /** The document's panel id. Namespaces every element the panel emits. */
  readonly id: string;
  readonly representation: Representation;
  readonly caption?: string | undefined;
}

export interface FigureOptions {
  /** Panels per row. Clamped to [1, panel count]; see `defaultFigureColumns`. */
  readonly columns?: number | undefined;
  /**
   * The document's locants, handed to EVERY panel's scene exactly as the
   * canvas hands them to its own (`SceneBuildOptions.locants`), so the file
   * and the editor draw the same numbers (decision 21). ONE map for the whole
   * figure, never one per panel: the same atom carries the same number in
   * each panel it appears in. A panel still draws them only while its own
   * `showLocants` is on, so passing them changes nothing for a panel that
   * has the flag off.
   */
  readonly locants?: SceneBuildOptions["locants"];
  /**
   * The document's stored scheme annotations, handed to every panel as the
   * canvas hands them to its own (decision 197). Each panel draws the curly
   * arrows whose anchors it places, against its own geometry; a text panel
   * draws none. Ids stay unique across panels through the serialiser's
   * per-panel prefix.
   */
  readonly schemeAnnotations?: SceneBuildOptions["schemeAnnotations"];
}

/**
 * Layout spacing, in EMS of the style's font size.
 *
 * Ems rather than px or bond lengths on purpose: the gaps belong to the
 * typography (a label's distance from its panel reads right relative to the
 * label's own size), and expressing them in bond lengths would be a second
 * place reading the bond scale.
 */
export const FIGURE_SPACING = Object.freeze({
  /** Between columns and between rows. */
  gutterEm: 2,
  /** From the bottom of the (a) label to the top of the panel's cell. */
  labelGapEm: 0.3,
  /** From the bottom of the panel's cell to the top of its caption. */
  captionGapEm: 0.6,
  /** Baseline to baseline, for a caption that wraps. */
  captionLineEm: 1.25,
  /**
   * A caption narrower than this never wraps just because its panel is narrow
   * — "Sum formula" under a one-line formula would otherwise stack its two
   * words. Longer captions still wrap, at the column width this sets.
   */
  captionMinWrapEm: 10,
  /** How wide the marked placeholder of an unavailable panel is. */
  placeholderWidthEm: 14,
  placeholderPaddingEm: 0.8,
});

/** Up to three panels share a row; a fourth starts a second. */
export function defaultFigureColumns(panelCount: number): number {
  return Math.max(1, Math.min(panelCount, 3));
}

/**
 * The letter for the panel at `index`: a…z, then aa, ab, … (bijective
 * base 26, the way spreadsheet columns count), so a 27th panel is labelled
 * rather than wrapping back to (a) and duplicating a label.
 */
export function panelLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`panelLetter: index must be a non-negative integer, got ${index}`);
  }
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type UnavailableViewAvailability = Extract<ViewAvailability, { available: false }>;

export type FigureCellContent =
  | { readonly kind: "scene"; readonly scene: RenderScene }
  | {
      readonly kind: "unavailable";
      readonly availability: UnavailableViewAvailability;
      /** The dashed frame and the reason, in the cell's LOCAL coordinates. */
      readonly primitives: readonly ScenePrimitive[];
    };

export interface FigureCell {
  readonly panelId: string;
  readonly index: number;
  /** "a", "b", … — the label run adds the parentheses. */
  readonly letter: string;
  readonly representation: Representation;
  readonly content: FigureCellContent;
  /**
   * The translate that places the content's primitives in figure space. The
   * whole of a panel's transform: no scale, no flip.
   */
  readonly offset: ScenePoint;
  /** Label and caption runs, already in FIGURE coordinates. */
  readonly decorations: readonly ScenePrimitive[];
  /** The grid cell this panel occupies, label and caption included. */
  readonly cell: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface Figure {
  readonly style: RenderStyle;
  readonly columns: number;
  readonly cells: readonly FigureCell[];
  /** Union of every panel's ink, label and caption, grown by `style.marginPx`. */
  readonly bounds: SceneBounds;
  /**
   * The molecule's median drawn bond, in MODEL UNITS — 1 for anything drawn
   * in this editor, and 1 when there is no bond to measure.
   *
   * A READ-OUT, never a scale: nothing multiplies geometry by it. It exists
   * so the printed bond length the export reports is the length of the bonds
   * actually on the page, not of an abstract model unit a structure from
   * another tool (or an old document) may not have been drawn at.
   */
  readonly drawnBondLength: number;
}

/** The cells whose view could not be produced, in panel order. */
export function unavailableCells(figure: Figure): readonly FigureCell[] {
  return figure.cells.filter((cell) => cell.content.kind === "unavailable");
}

export function composeFigure(
  mol: Molecule,
  style: RenderStyle,
  panels: readonly FigurePanelSpec[],
  options: FigureOptions = {},
): Figure {
  const fs = style.fontSizePx;
  const gutter = FIGURE_SPACING.gutterEm * fs;
  const labelGap = FIGURE_SPACING.labelGapEm * fs;
  const captionGap = FIGURE_SPACING.captionGapEm * fs;
  const lineHeight = FIGURE_SPACING.captionLineEm * fs;
  // Ink, not ink-plus-margin: the margin is a FIGURE property, applied once
  // around the whole grid. Only the margin differs from `style` — the same
  // measurer, the same subscript scale — and this style never builds a scene.
  const inkStyle = withStyle(style, { marginPx: 0 });
  const text = textMetrics(style);

  const columns = clampColumns(options.columns, panels.length);

  // Pass 1: each panel's content and natural size.
  const natural = panels.map((panel, index) => {
    const letter = panelLetter(index);
    const content = cellContent(mol, style, panel.representation, text, options);
    const primitives =
      content.kind === "scene" ? content.scene.primitives : content.primitives;
    const ink = sceneBounds(primitives, inkStyle);
    const label = text.measure(`(${letter})`);
    const caption = (panel.caption ?? "").trim();
    const longestWord =
      caption === ""
        ? 0
        : Math.max(
            ...caption.split(/\s+/).map((word) => text.measure(word).width),
            Math.min(text.measure(caption).width, FIGURE_SPACING.captionMinWrapEm * fs),
          );
    return {
      panel,
      index,
      letter,
      content,
      ink,
      caption,
      minWidth: Math.max(label.width, ink.width, longestWord),
    };
  });

  const rows = Math.ceil(panels.length / columns);
  const colWidth: number[] = Array.from({ length: columns }, () => 0);
  for (const cell of natural) {
    const c = cell.index % columns;
    colWidth[c] = Math.max(colWidth[c] ?? 0, cell.minWidth);
  }

  // Pass 2: captions wrap to their column, which fixes each row's height.
  const wrapped = natural.map((cell) =>
    cell.caption === ""
      ? []
      : wrapText(cell.caption, colWidth[cell.index % columns] ?? 0, text),
  );
  const labelHeight = text.ascent + text.descent;
  const rowInk: number[] = Array.from({ length: rows }, () => 0);
  const rowCaption: number[] = Array.from({ length: rows }, () => 0);
  for (const cell of natural) {
    const r = Math.floor(cell.index / columns);
    rowInk[r] = Math.max(rowInk[r] ?? 0, cell.ink.height);
    const lines = wrapped[cell.index]?.length ?? 0;
    if (lines > 0) {
      const height = captionGap + (lines - 1) * lineHeight + text.ascent + text.descent;
      rowCaption[r] = Math.max(rowCaption[r] ?? 0, height);
    }
  }

  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c < columns; c += 1) {
    colX.push(x);
    x += (colWidth[c] ?? 0) + gutter;
  }
  const rowY: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r += 1) {
    rowY.push(y);
    y += labelHeight + labelGap + (rowInk[r] ?? 0) + (rowCaption[r] ?? 0) + gutter;
  }

  // Pass 3: place.
  const cells: FigureCell[] = natural.map((cell) => {
    const c = cell.index % columns;
    const r = Math.floor(cell.index / columns);
    const cx = colX[c] ?? 0;
    const cy = rowY[r] ?? 0;
    const width = colWidth[c] ?? 0;
    const inkHeight = rowInk[r] ?? 0;
    const contentTop = cy + labelHeight + labelGap;

    const offset: ScenePoint = {
      x: cx + (width - cell.ink.width) / 2 - cell.ink.minX,
      y: contentTop + (inkHeight - cell.ink.height) / 2 - cell.ink.minY,
    };

    const decorations: ScenePrimitive[] = [
      textRun(style, "label", { x: cx, y: cy + text.ascent }, `(${cell.letter})`, "start"),
    ];
    const lines = wrapped[cell.index] ?? [];
    lines.forEach((line, i) => {
      decorations.push(
        textRun(
          style,
          `caption:${i}`,
          {
            x: cx + width / 2,
            y: contentTop + inkHeight + captionGap + text.ascent + i * lineHeight,
          },
          line,
          "middle",
        ),
      );
    });

    return {
      panelId: cell.panel.id,
      index: cell.index,
      letter: cell.letter,
      representation: cell.panel.representation,
      content: cell.content,
      offset,
      decorations,
      cell: {
        x: cx,
        y: cy,
        width,
        height: labelHeight + labelGap + inkHeight + (rowCaption[r] ?? 0),
      },
    };
  });

  return {
    style,
    columns,
    cells,
    bounds: figureBounds(
      cells,
      natural.map((n) => n.ink),
      inkStyle,
      style.marginPx,
    ),
    drawnBondLength: medianBondLength(mol) ?? 1,
  };
}

function clampColumns(requested: number | undefined, panelCount: number): number {
  const fallback = defaultFigureColumns(panelCount);
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), Math.max(1, panelCount)));
}

interface TextMetrics {
  readonly ascent: number;
  readonly descent: number;
  measure(value: string): { readonly width: number };
}

function textMetrics(style: RenderStyle): TextMetrics {
  const measurer = measurerFor(style);
  const measure = (value: string): { width: number; ascent: number; descent: number } => {
    const box = measureTextRun(
      [{ text: value }],
      {
        fontFamily: style.fontFamily,
        fontSizePx: style.fontSizePx,
        subscriptScale: style.subscriptScale,
        anchor: "start",
        baseline: "alphabetic",
      },
      measurer,
    );
    return { width: box.advanceWidthPx, ascent: box.ascentPx, descent: box.descentPx };
  };
  // The plain face's band, from a run with ink in it. Every label and caption
  // is set in that one size, so one band serves them all.
  const band = measure("(a)");
  return { ascent: band.ascent, descent: band.descent, measure };
}

/**
 * Greedy word wrap against the font table. A word wider than `maxWidth` gets
 * a line to itself rather than being broken mid-word; `composeFigure` has
 * already widened the column to the longest word, so inside a figure that
 * never overflows.
 */
export function wrapText(
  value: string,
  maxWidth: number,
  metrics: { measure(value: string): { readonly width: number } },
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "");
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      // A small tolerance, so a caption measured exactly at the column width
      // it set does not wrap on floating-point dust.
      if (line !== "" && metrics.measure(candidate).width > maxWidth + 1e-6) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== "") lines.push(line);
  }
  return lines;
}

function textRun(
  style: RenderStyle,
  id: string,
  origin: ScenePoint,
  value: string,
  anchor: "start" | "middle",
): TextRunPrimitive {
  return {
    id,
    type: "textRun",
    source: { kind: "decoration" },
    origin,
    spans: [{ text: value }],
    fontFamily: style.fontFamily,
    fontSizePx: style.fontSizePx,
    fill: { color: style.colors.label },
    anchor,
  };
}

function cellContent(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
  text: TextMetrics,
  figure: FigureOptions,
): FigureCellContent {
  const availability = representationAvailability(mol, representation.kind);
  if (availability.available) {
    const { locants, schemeAnnotations } = figure;
    const options =
      locants === undefined && schemeAnnotations === undefined
        ? undefined
        : {
            ...(locants === undefined ? {} : { locants }),
            ...(schemeAnnotations === undefined ? {} : { schemeAnnotations }),
          };
    return { kind: "scene", scene: buildScene(mol, style, representation, options) };
  }
  return {
    kind: "unavailable",
    availability,
    primitives: placeholder(style, representation, availability, text),
  };
}

/**
 * The marked cell an unavailable view gets: a dashed frame with the view's
 * name and the availability function's own sentence inside it. A reader sees
 * WHY the panel is not there, rather than a gap that looks like a rendering
 * bug.
 */
function placeholder(
  style: RenderStyle,
  representation: Representation,
  availability: UnavailableViewAvailability,
  text: TextMetrics,
): ScenePrimitive[] {
  const fs = style.fontSizePx;
  const pad = FIGURE_SPACING.placeholderPaddingEm * fs;
  const lineHeight = FIGURE_SPACING.captionLineEm * fs;
  const title = `${VIEW_KIND_TITLES[representation.kind]} view unavailable.`;
  // Wide enough for the title on one line; the reason wraps beneath it.
  const width = Math.max(
    FIGURE_SPACING.placeholderWidthEm * fs,
    text.measure(title).width + 2 * pad,
  );
  const lines = [title, ...wrapText(availability.message, width - 2 * pad, text)];
  const height = 2 * pad + (lines.length - 1) * lineHeight + text.ascent + text.descent;

  const frame: PolygonPrimitive = {
    id: "unavailable:frame",
    type: "polygon",
    source: { kind: "decoration" },
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    stroke: {
      color: style.colors.label,
      width: style.bondLineWidthPx / 2,
      dash: [fs * 0.4, fs * 0.3],
    },
  };
  const runs = lines.map((line, i) =>
    textRun(
      style,
      `unavailable:${i}`,
      { x: width / 2, y: pad + text.ascent + i * lineHeight },
      line,
      "middle",
    ),
  );
  return [frame, ...runs];
}

function figureBounds(
  cells: readonly FigureCell[],
  inks: readonly SceneBounds[],
  inkStyle: RenderStyle,
  margin: number,
): SceneBounds {
  if (cells.length === 0) {
    return sceneBounds([], withStyle(inkStyle, { marginPx: margin }));
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (box: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }): void => {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  };
  cells.forEach((cell, i) => {
    const ink = inks[i];
    if (ink !== undefined) {
      add({
        minX: ink.minX + cell.offset.x,
        minY: ink.minY + cell.offset.y,
        maxX: ink.maxX + cell.offset.x,
        maxY: ink.maxY + cell.offset.y,
      });
    }
    if (cell.decorations.length > 0) add(sceneBounds(cell.decorations, inkStyle));
  });
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
