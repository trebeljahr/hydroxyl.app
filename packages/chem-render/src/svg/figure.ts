/**
 * Figure -> one standalone SVG.
 *
 * The file a journal, a co-author or Illustrator receives, so everything that
 * only resolves inside the app is absent by construction: this module builds
 * the markup from scenes and never touches a DOM, so there is no Tailwind
 * class, no CSS custom property, no `data-overlay` mark and no viewport
 * transform to scrub. The viewBox is the figure's content bounds plus its
 * margin, which is why the editor's pan and zoom cannot reach it.
 *
 * ── ONE ID NAMESPACE PER PANEL ───────────────────────────────────────────
 *
 * Two panels of the same molecule share every atom and bond id, and two
 * sum-formula panels share `text:sumFormula:formula`. Every id a panel emits
 * is therefore prefixed with `panelIdPrefix(panel.id)`, an INJECTIVE escape of
 * the panel id: panel ids come from files, and a lossy sanitiser could map
 * two distinct ids onto one prefix and bring the collision back. The scene IR
 * has no defs, gradients, clip paths or markers today, so nothing inside a
 * panel references an id and prefixing the ids is the whole job; a future
 * `url(#…)` reference must take the same prefix.
 *
 * ── TEXT STAYS TEXT ──────────────────────────────────────────────────────
 *
 * Labels are live `<text>`, so an illustrator can edit them. With
 * `embedFont`, the vendored Arimo WOFF is embedded once as an `@font-face`
 * data URI, and its Greek subset as a second one when a figure sets a Greek
 * letter (decision 252): an SVG opened on its own, or loaded into an `<img>` for the PNG
 * export, cannot fetch a font, and the OFL permits embedding. The
 * `font-family` stack still names Arial and Helvetica after Arimo, which are
 * metric-compatible, for the editors that ignore `@font-face` and resolve
 * fonts by installed name. Inkscape is one: it loads a face only from a
 * ttf/otf file beside the document, never a data URI (sp-style-elem.cpp).
 * Nothing placed on the page depends on the face loading, since every
 * run's `y` is an explicit baseline (see `TextRunPrimitive`).
 */

import type { Figure, FigureCell, UnavailableViewAvailability } from "../figure/compose.js";
import { figureCodePoints, inGreekFace } from "../figure/text.js";
import {
  ARIMO_GREEK_UNICODE_RANGE,
  ARIMO_GREEK_WOFF_BASE64,
  ARIMO_WOFF_BASE64,
} from "../text/generated/arimo-woff.js";
import { FONT_VERSION } from "../text/generated/arimo-metrics.js";
import { attr, emitPrimitive, escapeText, formatNumber, num, push } from "./emit.js";
import type { Emitter } from "./emit.js";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Decimal places for a `width`/`height` in cm, mm or in: 4 places of a cm is 1 µm. */
export const PHYSICAL_LENGTH_PRECISION = 4;

export type FigureLengthUnit = "cm" | "mm" | "in" | "px";

export interface FigureDimensions {
  readonly width: number;
  readonly height: number;
  readonly unit: FigureLengthUnit;
}

export interface FigureSerializeOptions {
  /** Prepend the XML declaration. Defaults to true. */
  readonly standalone?: boolean;
  /** Defaults to true, for the same diffability reason as `serializeScene`. */
  readonly indent?: boolean;
  /**
   * The `width`/`height` attributes. Defaults to the viewBox size in px. Pass
   * the centimetres `physicalFigureSize` reports for a journal figure, or
   * whole pixels equal to a raster's backing store so the PNG is rasterised
   * at that size rather than scaled.
   */
  readonly dimensions?: FigureDimensions;
  /** Embed the Arimo WOFF as an `@font-face` data URI. Defaults to false. */
  readonly embedFont?: boolean;
  /**
   * What to do with a panel whose view is unavailable. `"refuse"` (the
   * default) throws `FigureUnavailableError`; `"mark"` draws the dashed
   * placeholder with its reason. Never an empty cell.
   */
  readonly unavailable?: "refuse" | "mark";
  /**
   * A background fill. Undefined takes `style.colors.background`; null forces
   * a transparent figure.
   */
  readonly background?: string | null;
}

export interface UnavailablePanel {
  readonly panelId: string;
  readonly letter: string;
  readonly availability: UnavailableViewAvailability;
}

/** Thrown instead of writing a figure that has a panel it cannot draw. */
export class FigureUnavailableError extends Error {
  readonly panels: readonly UnavailablePanel[];

  constructor(panels: readonly UnavailablePanel[]) {
    super(
      panels
        .map((p) => `Panel (${p.letter}) cannot be drawn: ${p.availability.message}`)
        .join(" "),
    );
    this.name = "FigureUnavailableError";
    this.panels = panels;
  }
}

/**
 * The id namespace of a panel: `p-` + the panel id with every character
 * outside `[A-Za-z0-9-]` written as `_<hex code point>_` + `.`.
 *
 * Injective because the escaped part can never contain a `.`, so the first
 * `.` after `p-` is always the delimiter, and because `_` itself is escaped,
 * so an escape sequence cannot be forged by a literal id. Readable because
 * the common ids (`panel-skeletal`) pass through untouched.
 */
export function panelIdPrefix(panelId: string): string {
  let escaped = "";
  for (const ch of panelId) {
    escaped += /^[A-Za-z0-9-]$/.test(ch)
      ? ch
      : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return `p-${escaped}.`;
}

/**
 * The copyright and licence line that travels with an embedded font. The OFL
 * places no obligation on a document using the font; saying where the face
 * came from is courtesy and keeps the provenance next to the bytes.
 */
export const EMBEDDED_FONT_NOTICE =
  `Arimo ${FONT_VERSION.replace(/^Version\s+/i, "")}, Copyright The Arimo Project Authors ` +
  "(https://github.com/googlefonts/arimo). SIL Open Font License 1.1 " +
  "(https://openfontlicense.org). Embedded for display; the text remains editable.";

export function serializeFigure(
  figure: Figure,
  options: FigureSerializeOptions = {},
): string {
  const policy = options.unavailable ?? "refuse";
  const missing = figure.cells.flatMap((cell): UnavailablePanel[] =>
    cell.content.kind === "unavailable"
      ? [{ panelId: cell.panelId, letter: cell.letter, availability: cell.content.availability }]
      : [],
  );
  if (policy === "refuse" && missing.length > 0) throw new FigureUnavailableError(missing);

  const standalone = options.standalone ?? true;
  const indent = options.indent ?? true;
  const { bounds, style } = figure;
  const e: Emitter = {
    lines: [],
    idPrefix: "",
    indent,
    precision: style.coordinatePrecision,
    subscriptScale: style.subscriptScale,
  };

  const viewBox = [bounds.minX, bounds.minY, bounds.width, bounds.height]
    .map((v) => num(e, v, "figure bounds"))
    .join(" ");
  const dimensions = options.dimensions ?? {
    width: bounds.width,
    height: bounds.height,
    unit: "px" as const,
  };

  // A physical length gets its own precision. The style's coordinate
  // precision is px-sized (two places on the screen preset), and at two
  // places a 1.2 cm figure's width is off by up to 0.4 % — which is the
  // printed bond length off by the same, the one number decision 20 fixes.
  const dimensionPrecision =
    dimensions.unit === "px" ? style.coordinatePrecision : PHYSICAL_LENGTH_PRECISION;
  const length = (value: number, context: string): string =>
    formatNumber(value, dimensionPrecision, context);

  push(
    e,
    0,
    `<svg` +
      attr("xmlns", SVG_NAMESPACE) +
      attr("viewBox", viewBox) +
      attr("width", `${length(dimensions.width, "figure width")}${dimensions.unit}`) +
      attr("height", `${length(dimensions.height, "figure height")}${dimensions.unit}`) +
      `>`,
  );

  if (options.embedFont === true) {
    push(e, 1, `<!-- ${escapeText(EMBEDDED_FONT_NOTICE)} -->`);
    push(
      e,
      1,
      `<defs><style>@font-face{font-family:"Arimo";` +
        `src:url(data:font/woff;base64,${ARIMO_WOFF_BASE64}) format("woff");` +
        `font-weight:400;font-style:normal}` +
        // The Greek face only when a letter needs it (decision 252), declared
        // second: for code points in its unicode-range a browser checks the
        // last-declared face first, and every other code point stays Latin.
        (figureCodePoints(figure).some(inGreekFace)
          ? `@font-face{font-family:"Arimo";` +
            `src:url(data:font/woff;base64,${ARIMO_GREEK_WOFF_BASE64}) format("woff");` +
            `font-weight:400;font-style:normal;unicode-range:${ARIMO_GREEK_UNICODE_RANGE}}`
          : "") +
        `</style></defs>`,
    );
  }

  const background =
    options.background === undefined ? style.colors.background : options.background;
  if (background !== undefined && background !== null) {
    push(
      e,
      1,
      `<rect` +
        attr("data-decoration", "background") +
        attr("x", num(e, bounds.minX, "background")) +
        attr("y", num(e, bounds.minY, "background")) +
        attr("width", num(e, bounds.width, "background")) +
        attr("height", num(e, bounds.height, "background")) +
        attr("fill", background) +
        `/>`,
    );
  }

  for (const cell of figure.cells) emitCell(e, cell);
  push(e, 0, `</svg>`);

  const body = e.lines.join(indent ? "\n" : "");
  return standalone ? XML_DECLARATION + body : body;
}

/**
 * One panel: an outer group an illustrator can move as a unit, holding the
 * translated content group, then the label and caption runs in figure space.
 */
function emitCell(e: Emitter, cell: FigureCell): void {
  const prefix = panelIdPrefix(cell.panelId);
  const inner: Emitter = { ...e, idPrefix: prefix };

  push(
    e,
    1,
    `<g` +
      attr("id", `${prefix}panel`) +
      attr("data-panel", cell.panelId) +
      attr("data-panel-label", `(${cell.letter})`) +
      attr("data-view", cell.representation.kind) +
      (cell.content.kind === "unavailable"
        ? attr("data-unavailable", cell.content.availability.reason)
        : "") +
      `>`,
  );

  const primitives =
    cell.content.kind === "scene" ? cell.content.scene.primitives : cell.content.primitives;
  // A translate and nothing else — see compose.ts. The attribute is the whole
  // of the panel's transform, and a test reads it back to prove there is no
  // scale in it.
  push(
    e,
    2,
    `<g` +
      attr("id", `${prefix}content`) +
      attr(
        "transform",
        `translate(${num(e, cell.offset.x, "panel offset")} ${num(e, cell.offset.y, "panel offset")})`,
      ) +
      `>`,
  );
  for (const primitive of primitives) emitPrimitive(inner, primitive, 3);
  push(e, 2, `</g>`);

  for (const decoration of cell.decorations) emitPrimitive(inner, decoration, 2);
  push(e, 1, `</g>`);
}
