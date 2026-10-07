/**
 * Figure -> one-page vector PDF (decision 236).
 *
 * The same figure the SVG serialiser writes, drawn from the same scenes, so
 * the two files cannot disagree about what is on the page: no DOM, no
 * rasterising, no library. The scene IR is seven primitive types and PDF has
 * an operator for each of them, which is less code than adapting a general
 * SVG-to-PDF converter and keeps chem-render dependency-free.
 *
 * Served from `@starter/chem-render/pdf` and never from the root barrel: the
 * embedded font is ~20 kB of base64, and only an actual PDF export should
 * load it.
 *
 * ── THE FONT IS EMBEDDED, SO IT PRINTS LIKE THE SVG ──────────────────────
 *
 * Every glyph is set in the vendored Arimo — the Latin face, and the Greek
 * face for Greek letters (decision 252) — each embedded whole as a TrueType
 * `FontFile2` behind its own Type0 / Identity-H font, with a ToUnicode map
 * so the text still copies and searches. The glyphs are placed at the
 * measurer's own advances (the `/W` widths are the same font units the
 * measurer sums), so every label sits exactly where placement put it — on the
 * box the bonds were trimmed against and the page was cut from.
 *
 * A few arrows and relations a conditions line may carry are in neither
 * face; those that the PDF standard Symbol font has are set in it, which
 * every reader must supply and which is NOT embedded.
 * `pdfFallbackCodePoints` (symbol.ts) names them so the dialog can say so. A
 * code point no face has is drawn as Arimo's `.notdef`, at the advance the
 * measurer charged it — the box the SVG would show.
 *
 * ── PAGE AND COORDINATES ─────────────────────────────────────────────────
 *
 * The page is the figure's bounds, at the physical size the caller passes
 * (the centimetres `physicalFigureSize` reported). One `cm` maps scene px,
 * y-down, onto the page's points, y-up; text undoes the flip in its own `Tm`
 * so glyphs stand upright. Nothing else is rescaled, so a bond is exactly as
 * long in the PDF as in the SVG at the same printed width.
 *
 * Byte-deterministic like the SVG: no creation date, no random ids. The same
 * figure always writes the same file.
 */

import type { Figure, FigureCell } from "../figure/compose.js";
import { CM_PER_INCH } from "../figure/physical.js";
import type {
  SceneFill,
  ScenePoint,
  ScenePrimitive,
  SceneStroke,
  TextRunPrimitive,
} from "../scene/types.js";
import { FigureUnavailableError, EMBEDDED_FONT_NOTICE } from "../svg/figure.js";
import type { FigureDimensions, UnavailablePanel } from "../svg/figure.js";
import { PDF_FACES } from "../text/generated/arimo-sfnt.js";
import { measureTextRun, measurerFor } from "../text/measurer.js";
import type { Measurer } from "../text/measurer.js";
import {
  EM_ASCENT,
  EM_CAP_HEIGHT,
  EM_DESCENT,
  EM_X_HEIGHT,
  UNITS_PER_EM,
  advanceWidthUnits,
} from "../text/metrics.js";
import { pathOperators } from "./path.js";
import { SYMBOL_CODES } from "./symbol.js";

const POINTS_PER_INCH = 72;
/** CSS: 96 px to the inch, 72 pt to the inch. */
const POINTS_PER_PX = 0.75;
/** Decimal places for every number in the content stream: 1e-4 px. */
const PRECISION = 4;
/** SVG's default `stroke-miterlimit`; PDF's own default is 10. */
const SVG_MITER_LIMIT = 4;
/** A circle as four cubics: the control distance for a quarter arc. */
const KAPPA = 0.5522847498307936;

/** Code point -> the embedded face it is set in, and its glyph id there. */
const GLYPH_BY_CODEPOINT: ReadonlyMap<number, { readonly face: number; readonly glyph: number }> = new Map(
  PDF_FACES.flatMap((face, index) =>
    face.glyphIds.map(([codepoint, glyph]) => [codepoint, { face: index, glyph }] as const),
  ),
);

/** Page resource names: /F1, /F2… for the embedded faces, /FS for Symbol. */
const faceResource = (face: number): string => `F${face + 1}`;


export interface FigurePdfOptions {
  /**
   * The page size. Pass the centimetres `physicalFigureSize` reports. "px"
   * means CSS px (0.75 pt). Defaults to the bounds in CSS px.
   */
  readonly dimensions?: FigureDimensions;
  /** A background fill; null (the default) leaves the page transparent. */
  readonly background?: string | null;
  /** The document title, written to the PDF's Info dictionary. */
  readonly title?: string;
}

/** Points per one unit of `unit`. */
function pointsPer(unit: FigureDimensions["unit"]): number {
  switch (unit) {
    case "in":
      return POINTS_PER_INCH;
    case "cm":
      return POINTS_PER_INCH / CM_PER_INCH;
    case "mm":
      return POINTS_PER_INCH / CM_PER_INCH / 10;
    case "px":
      return POINTS_PER_PX;
  }
}

function fmt(n: number, context: string): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot write non-finite number ${String(n)} in ${context}`);
  }
  let out = n.toFixed(PRECISION);
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  if (out === "-0") out = "0";
  return out;
}

/**
 * `#rgb` or `#rrggbb` -> PDF's 0..1 components. The scene IR's colours are
 * hex today; anything else is refused by name rather than painted black.
 */
export function pdfColor(color: string, context: string): readonly [number, number, number] {
  const named: Readonly<Record<string, string>> = { black: "#000000", white: "#ffffff" };
  const hex = named[color.toLowerCase()] ?? color;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const parts = short !== null ? short.slice(1).map((c) => c + c) : long?.slice(1);
  if (parts === undefined) {
    throw new Error(`The PDF export cannot paint the colour "${color}" in ${context}.`);
  }
  const [r, g, b] = parts.map((p) => parseInt(p, 16) / 255);
  return [r ?? 0, g ?? 0, b ?? 0];
}

function colorOps(color: string, op: "rg" | "RG", context: string): string {
  return `${pdfColor(color, context).map((c) => fmt(c, context)).join(" ")} ${op}`;
}

/** The glyphs and Symbol bytes a figure uses, gathered while drawing. */
interface FontUse {
  /** Per embedded face: glyph id -> the code point it stands for (-1: .notdef). */
  readonly glyphs: Map<number, Map<number, number>>;
  symbol: boolean;
}

interface Writer {
  readonly ops: string[];
  readonly fonts: FontUse;
  readonly measurer: Measurer;
  readonly subscriptScale: number;
}

function strokeOps(stroke: SceneStroke, context: string): string {
  const parts = [colorOps(stroke.color, "RG", context), `${fmt(stroke.width, context)} w`];
  // SVG's defaults, said explicitly: butt caps, miter joins, limit 4.
  parts.push(`${{ butt: 0, round: 1, square: 2 }[stroke.cap ?? "butt"]} J`);
  parts.push(`${{ miter: 0, round: 1, bevel: 2 }[stroke.join ?? "miter"]} j`);
  parts.push(`${SVG_MITER_LIMIT} M`);
  if (stroke.dash !== undefined && stroke.dash.length > 0) {
    // SVG repeats an odd-length dash list to make it even; PDF does not.
    const dash = stroke.dash.length % 2 === 1 ? [...stroke.dash, ...stroke.dash] : stroke.dash;
    parts.push(`[${dash.map((d) => fmt(d, context)).join(" ")}] 0 d`);
  }
  return parts.join(" ");
}

/** Paint what was constructed: fill, stroke, both, or neither. */
function paint(
  w: Writer,
  construct: string,
  fill: SceneFill | undefined,
  stroke: SceneStroke | undefined,
  context: string,
): void {
  if (construct === "") return;
  const state: string[] = [];
  if (fill !== undefined) state.push(colorOps(fill.color, "rg", context));
  if (stroke !== undefined) state.push(strokeOps(stroke, context));
  const op = fill !== undefined ? (stroke !== undefined ? "B" : "f") : stroke !== undefined ? "S" : "n";
  w.ops.push(`q ${[...state, construct, op].join(" ")} Q`);
}

function polyOps(points: readonly ScenePoint[], close: boolean, context: string): string {
  if (points.length === 0) return "";
  const ops = points.map((p, i) => `${fmt(p.x, context)} ${fmt(p.y, context)} ${i === 0 ? "m" : "l"}`);
  if (close) ops.push("h");
  return ops.join(" ");
}

function circleOps(c: ScenePoint, r: number, context: string): string {
  const k = r * KAPPA;
  const p = (x: number, y: number): string => `${fmt(x, context)} ${fmt(y, context)}`;
  return [
    `${p(c.x + r, c.y)} m`,
    `${p(c.x + r, c.y + k)} ${p(c.x + k, c.y + r)} ${p(c.x, c.y + r)} c`,
    `${p(c.x - k, c.y + r)} ${p(c.x - r, c.y + k)} ${p(c.x - r, c.y)} c`,
    `${p(c.x - r, c.y - k)} ${p(c.x - k, c.y - r)} ${p(c.x, c.y - r)} c`,
    `${p(c.x + k, c.y - r)} ${p(c.x + r, c.y - k)} ${p(c.x + r, c.y)} c`,
    "h",
  ].join(" ");
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * One text run. Laid out by `measureTextRun`, the function the scene's own
 * placement and bounds used, so the anchor, the script sizes and the script
 * baselines are the measurer's to the bit. Each stretch of one face is placed
 * at the pen position the measurer computed for its first character.
 */
function textRunOps(w: Writer, p: TextRunPrimitive): void {
  const context = p.id;
  const box = measureTextRun(
    p.spans,
    {
      fontFamily: p.fontFamily,
      fontSizePx: p.fontSizePx,
      subscriptScale: w.subscriptScale,
      anchor: p.anchor,
      baseline: "alphabetic",
    },
    w.measurer,
  );
  const ops: string[] = [colorOps(p.fill.color, "rg", context)];
  for (const span of box.spans) {
    let pen = p.origin.x + box.startXPx + span.startXPx;
    const y = p.origin.y + span.dyPx;
    const size = fmt(span.fontSizePx, context);
    // An embedded face's index, or "symbol".
    let face: number | "symbol" | null = null;
    let codes = "";
    let at = pen;
    const flush = (): void => {
      if (face === null || codes === "") return;
      ops.push(
        `BT /${face === "symbol" ? "FS" : faceResource(face)} ${size} Tf 1 0 0 -1 ${fmt(at, context)} ${fmt(y, context)} Tm <${codes}> Tj ET`,
      );
      codes = "";
    };
    for (const character of span.span.text) {
      const codepoint = character.codePointAt(0) ?? 0;
      const glyph = GLYPH_BY_CODEPOINT.get(codepoint);
      const symbol = glyph === undefined ? SYMBOL_CODES.get(codepoint) : undefined;
      // A Symbol glyph's own width is not what the measurer charged, so each
      // one starts its own stretch, at the measurer's pen. A code point no
      // face has is the Latin face's .notdef.
      const next = symbol !== undefined ? "symbol" : (glyph?.face ?? 0);
      if (next !== face || next === "symbol") {
        flush();
        face = next;
        at = pen;
      }
      if (symbol !== undefined) {
        w.fonts.symbol = true;
        codes += symbol.toString(16).toUpperCase().padStart(2, "0");
      } else {
        const id = glyph?.glyph ?? 0;
        const used = w.fonts.glyphs.get(next as number) ?? new Map<number, number>();
        used.set(id, glyph === undefined ? -1 : codepoint);
        w.fonts.glyphs.set(next as number, used);
        codes += hex4(id);
      }
      pen += w.measurer.measureText(character, { family: p.fontFamily, sizePx: span.fontSizePx }).advanceWidthPx;
    }
    flush();
  }
  w.ops.push(`q ${ops.join(" ")} Q`);
}

function primitiveOps(w: Writer, p: ScenePrimitive): void {
  switch (p.type) {
    case "line":
      paint(w, polyOps([p.a, p.b], false, p.id), undefined, p.stroke, p.id);
      return;
    case "polyline":
      paint(w, polyOps(p.points, false, p.id), undefined, p.stroke, p.id);
      return;
    case "polygon":
      paint(w, polyOps(p.points, true, p.id), p.fill, p.stroke, p.id);
      return;
    case "path":
      paint(w, pathOperators(p.d, (n) => fmt(n, p.id), p.id), p.fill, p.stroke, p.id);
      return;
    case "circle":
      paint(w, circleOps(p.centre, p.radius, p.id), p.fill, p.stroke, p.id);
      return;
    case "textRun":
      textRunOps(w, p);
      return;
    case "group":
      for (const child of p.children) primitiveOps(w, child);
      return;
  }
}

function cellOps(w: Writer, cell: FigureCell): void {
  const primitives =
    cell.content.kind === "scene" ? cell.content.scene.primitives : cell.content.primitives;
  // A translate and nothing else, as in the SVG.
  w.ops.push(`q 1 0 0 1 ${fmt(cell.offset.x, "panel offset")} ${fmt(cell.offset.y, "panel offset")} cm`);
  for (const primitive of primitives) primitiveOps(w, primitive);
  w.ops.push("Q");
  for (const decoration of cell.decorations) primitiveOps(w, decoration);
}

// ── File assembly ───────────────────────────────────────────────────────────

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** No `atob`: chem-render's lib is ES2022 with no DOM, and Node has no need of one. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    const v = BASE64.indexOf(ch);
    if (v < 0) throw new Error("Corrupt embedded font data");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (value >> bits) & 0xff;
      o += 1;
    }
  }
  return out;
}

/** Each face's decoded font file, decoded on first use. */
const fontFiles = new Map<number, Uint8Array<ArrayBuffer>>();

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) throw new Error("Non-ASCII byte in PDF structure");
    out[i] = c;
  }
  return out;
}

/** A PDF text string in UTF-16BE with its byte-order mark, as hex. */
function textString(text: string): string {
  let out = "<FEFF";
  for (let i = 0; i < text.length; i += 1) out += hex4(text.charCodeAt(i));
  return `${out}>`;
}

/** Font units -> the 1000-unit glyph space PDF font dictionaries use. */
function glyphSpace(units: number): string {
  return fmt((units * 1000) / UNITS_PER_EM, "font metrics");
}

/** An em fraction in the same glyph space. */
function em(fraction: number): string {
  return fmt(fraction * 1000, "font metrics");
}

function toUnicodeCMap(glyphs: ReadonlyMap<number, number>): string {
  const entries = [...glyphs].filter(([, cp]) => cp >= 0).sort(([a], [b]) => a - b);
  const lines: string[] = [];
  // At most 100 entries per bfchar block, as the CMap spec requires.
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [glyph, cp] of chunk) {
      lines.push(`<${hex4(glyph)}> <${hex4(cp)}>`);
    }
    lines.push("endbfchar");
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...lines,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/**
 * The figure as a one-page PDF. Refuses a figure with an unavailable panel,
 * exactly as `serializeFigure` does by default, with the same error.
 */
export function serializeFigurePdf(
  figure: Figure,
  options: FigurePdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const missing = figure.cells.flatMap((cell): UnavailablePanel[] =>
    cell.content.kind === "unavailable"
      ? [{ panelId: cell.panelId, letter: cell.letter, availability: cell.content.availability }]
      : [],
  );
  if (missing.length > 0) throw new FigureUnavailableError(missing);

  const { bounds, style } = figure;
  const dimensions = options.dimensions ?? {
    width: bounds.width,
    height: bounds.height,
    unit: "px" as const,
  };
  const pageWidth = dimensions.width * pointsPer(dimensions.unit);
  const pageHeight = dimensions.height * pointsPer(dimensions.unit);
  const sx = pageWidth / bounds.width;
  const sy = pageHeight / bounds.height;

  const w: Writer = {
    ops: [],
    fonts: { glyphs: new Map(), symbol: false },
    measurer: measurerFor(style),
    subscriptScale: style.subscriptScale,
  };
  // Scene px, y-down, from the bounds' corner -> page points, y-up.
  w.ops.push(
    `q ${fmt(sx, "page")} 0 0 ${fmt(-sy, "page")} ${fmt(-bounds.minX * sx, "page")} ${fmt(pageHeight + bounds.minY * sy, "page")} cm`,
  );
  if (options.background !== undefined && options.background !== null) {
    w.ops.push(
      `q ${colorOps(options.background, "rg", "background")} ${fmt(bounds.minX, "background")} ${fmt(bounds.minY, "background")} ${fmt(bounds.width, "background")} ${fmt(bounds.height, "background")} re f Q`,
    );
  }
  for (const cell of figure.cells) cellOps(w, cell);
  w.ops.push("Q");
  const content = w.ops.join("\n");

  // Objects, numbered in the order they are written.
  const objects: (string | { readonly dict: string; readonly stream: Uint8Array })[] = [];
  const ref = (n: number): string => `${n} 0 R`;
  const CATALOG = 1;
  const PAGES = 2;
  const PAGE = 3;
  const CONTENT = 4;
  const INFO = 5;
  let next = 6;
  const fontRefs: string[] = [];
  const later: (() => void)[] = [];

  for (const [faceIndex, glyphs] of [...w.fonts.glyphs].sort(([a], [b]) => a - b)) {
    const face = PDF_FACES[faceIndex];
    if (face === undefined) throw new Error(`No embedded face ${faceIndex}`);
    const type0 = next;
    const cidFont = next + 1;
    const descriptor = next + 2;
    const file = next + 3;
    const toUnicode = next + 4;
    next += 5;
    fontRefs.push(`/${faceResource(faceIndex)} ${ref(type0)}`);
    later.push(() => {
      const widths = [...glyphs]
        .sort(([a], [b]) => a - b)
        // -1 (.notdef) is in no table, so it reads as the notdef advance —
        // what the measurer charged for it.
        .map(([glyph, cp]) => `${glyph} [${glyphSpace(advanceWidthUnits(cp))}]`)
        .join(" ");
      const bytes = fontFiles.get(faceIndex) ?? decodeBase64(face.deflatedBase64);
      fontFiles.set(faceIndex, bytes);
      const name = `/${face.baseFont}`;
      objects[type0 - 1] =
        `<< /Type /Font /Subtype /Type0 /BaseFont ${name} /Encoding /Identity-H /DescendantFonts [${ref(cidFont)}] /ToUnicode ${ref(toUnicode)} >>`;
      objects[cidFont - 1] =
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ref(descriptor)} /CIDToGIDMap /Identity /W [${widths}] >>`;
      objects[descriptor - 1] =
        `<< /Type /FontDescriptor /FontName ${name} /Flags 32 /FontBBox [${face.fontBBox.map(glyphSpace).join(" ")}] /ItalicAngle 0 /Ascent ${em(EM_ASCENT)} /Descent ${em(-EM_DESCENT)} /CapHeight ${em(EM_CAP_HEIGHT)} /XHeight ${em(EM_X_HEIGHT)} /StemV 80 /FontFile2 ${ref(file)} >>`;
      objects[file - 1] = {
        dict: `<< /Length ${bytes.length} /Length1 ${face.length} /Filter /FlateDecode >>`,
        stream: bytes,
      };
      const cmap = ascii(toUnicodeCMap(glyphs));
      objects[toUnicode - 1] = { dict: `<< /Length ${cmap.length} >>`, stream: cmap };
    });
  }
  if (w.fonts.symbol) {
    const symbol = next;
    next += 1;
    fontRefs.push(`/FS ${ref(symbol)}`);
    later.push(() => {
      objects[symbol - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>";
    });
  }

  const contentBytes = ascii(content);
  objects[CATALOG - 1] = `<< /Type /Catalog /Pages ${ref(PAGES)} >>`;
  objects[PAGES - 1] = `<< /Type /Pages /Kids [${ref(PAGE)}] /Count 1 >>`;
  objects[PAGE - 1] =
    `<< /Type /Page /Parent ${ref(PAGES)} /MediaBox [0 0 ${fmt(pageWidth, "page")} ${fmt(pageHeight, "page")}] ` +
    `/Resources << /Font << ${fontRefs.join(" ")} >> >> /Contents ${ref(CONTENT)} >>`;
  objects[CONTENT - 1] = { dict: `<< /Length ${contentBytes.length} >>`, stream: contentBytes };
  const info = [`/Producer ${textString("Chemistry Sketcher")}`];
  if (options.title !== undefined && options.title !== "") info.push(`/Title ${textString(options.title)}`);
  if (w.fonts.glyphs.size > 0) info.push(`/Subject ${textString(EMBEDDED_FONT_NOTICE)}`);
  objects[INFO - 1] = `<< ${info.join(" ")} >>`;
  for (const fill of later) fill();

  // Header: the binary comment tells transfer tools the file is not text.
  const chunks: Uint8Array[] = [ascii("%PDF-1.7\n"), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let length = chunks.reduce((sum, c) => sum + c.length, 0);
  const push = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    if (typeof object === "string") {
      push(ascii(`${index + 1} 0 obj\n${object}\nendobj\n`));
    } else {
      push(ascii(`${index + 1} 0 obj\n${object.dict}\nstream\n`));
      push(object.stream);
      push(ascii("\nendstream\nendobj\n"));
    }
  });
  const xref = length;
  // Each xref entry is exactly 20 bytes: the trailing space before the
  // newline is part of the format.
  const entries = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  push(
    ascii(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
        `trailer\n<< /Size ${objects.length + 1} /Root ${ref(CATALOG)} /Info ${ref(INFO)} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
