/**
 * Regenerates `src/text/generated/arimo-metrics.ts` from the vendored WOFF.
 *
 *     node scripts/generate-font-metrics.mjs
 *
 * The metrics table is committed rather than parsed at startup, because
 * chem-render must measure text in a Node test, in a static export and in the
 * browser, all identically and with no filesystem access. A generated table is
 * the only form that satisfies all three. `font-metrics.test.ts` re-runs this
 * extraction against the same file and asserts the table still matches, so the
 * committed numbers can never drift from the font they came from.
 *
 * WOFF, not TTF: the vendored file is also what gets embedded into an exported
 * SVG, and measuring the exact bytes that ship is the point. WOFF is a
 * per-table zlib wrapper around an sfnt, so `node:zlib` is the whole decoder.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(here, "..", "assets", "arimo-latin-400-normal.woff");
/**
 * Arimo's Greek subset, from the same `@fontsource/arimo@5.3.0` release
 * (decision 252). A second face rather than a merged font: merging glyph
 * tables needs font tooling this repo does not carry, and two faces of one
 * family are what CSS `unicode-range` and a PDF's font resources both expect.
 * The Latin face wins wherever both cover a code point (only the two spaces).
 */
const GREEK_FONT_PATH = join(here, "..", "assets", "arimo-greek-400-normal.woff");
const OUT_PATH = join(here, "..", "src", "text", "generated", "arimo-metrics.ts");
const WOFF_OUT_PATH = join(here, "..", "src", "text", "generated", "arimo-woff.ts");
const SFNT_OUT_PATH = join(here, "..", "src", "text", "generated", "arimo-sfnt.ts");

const WOFF_SIGNATURE = 0x774f4646;

/** WOFF header -> a tag-keyed map of decompressed sfnt tables. */
function readSfntTables(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== WOFF_SIGNATURE) {
    throw new Error(`${FONT_PATH} is not a WOFF file`);
  }
  const tables = new Map();
  const numTables = dv.getUint16(12);
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const tag = String.fromCharCode(
      dv.getUint8(entry),
      dv.getUint8(entry + 1),
      dv.getUint8(entry + 2),
      dv.getUint8(entry + 3),
    );
    const offset = dv.getUint32(entry + 4);
    const compressedLength = dv.getUint32(entry + 8);
    const originalLength = dv.getUint32(entry + 12);
    const slice = buf.subarray(offset, offset + compressedLength);
    // A table whose compressed length equals its original length is stored raw.
    const data = compressedLength === originalLength ? slice : inflateSync(slice);
    tables.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength));
  }
  return tables;
}

function requireTable(tables, tag) {
  const table = tables.get(tag);
  if (table === undefined) throw new Error(`Font has no ${tag} table`);
  return table;
}

/**
 * The character-to-glyph map, as a plain codepoint->glyph-id Map.
 *
 * Only cmap format 4 is handled, which is what every Google Fonts latin subset
 * ships. A format 12 subtable would be needed for astral codepoints; nothing a
 * chemical label contains lives up there, and failing loudly beats silently
 * measuring half the alphabet.
 */
function readCmap(cmap) {
  const subtableCount = cmap.getUint16(2);
  let offset = -1;
  for (let i = 0; i < subtableCount; i++) {
    const record = 4 + i * 8;
    const platformId = cmap.getUint16(record);
    const encodingId = cmap.getUint16(record + 2);
    const candidate = cmap.getUint32(record + 4);
    const unicode =
      (platformId === 3 && (encodingId === 1 || encodingId === 10)) ||
      platformId === 0;
    if (unicode && cmap.getUint16(candidate) === 4) {
      offset = candidate;
      break;
    }
  }
  if (offset < 0) throw new Error("Font has no format 4 unicode cmap subtable");

  const segCountX2 = cmap.getUint16(offset + 6);
  const endBase = offset + 14;
  const startBase = endBase + segCountX2 + 2; // +2 skips the reserved pad
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;

  const map = new Map();
  for (let s = 0; s < segCountX2 / 2; s++) {
    const end = cmap.getUint16(endBase + s * 2);
    const start = cmap.getUint16(startBase + s * 2);
    const delta = cmap.getInt16(deltaBase + s * 2);
    const rangeOffset = cmap.getUint16(rangeBase + s * 2);
    // 0xffff is the mandatory terminating segment, not a real range.
    if (start === 0xffff) continue;
    for (let cp = start; cp <= end; cp++) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const index = rangeBase + s * 2 + rangeOffset + (cp - start) * 2;
        if (index + 1 >= cmap.byteLength) continue;
        const raw = cmap.getUint16(index);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(cp, glyph);
    }
  }
  return map;
}

/** Advance widths in font units, indexed by glyph id. */
function readAdvances(hhea, hmtx, glyphCount) {
  const longMetrics = hhea.getUint16(34);
  if (longMetrics === 0) throw new Error("Font has no horizontal metrics");
  const advances = new Array(glyphCount);
  // Past numberOfHMetrics the advance is constant and only the side bearing
  // varies, which is how a monospaced tail is stored compactly.
  const last = hmtx.getUint16((longMetrics - 1) * 4);
  for (let g = 0; g < glyphCount; g++) {
    advances[g] = g < longMetrics ? hmtx.getUint16(g * 4) : last;
  }
  return advances;
}

/**
 * Each glyph's ink bounding box in font units, y-UP as the font stores it:
 * `[xMin, yMin, xMax, yMax]`, or `undefined` for a glyph with no outline.
 *
 * Read from each glyf record's own header, which a font compiler writes as the
 * exact bounds of the outline (composite glyphs included). This is the INK a
 * glyph puts on the page, as opposed to its advance and the typographic
 * ascender/descender band: a digit's ink stops at the baseline and near the
 * cap height, a parenthesis reaches below the baseline. Annotation placement
 * judges proximity and overprint on it (decisions 55 and 57).
 */
function readInkBounds(head, loca, glyf, glyphCount) {
  const longOffsets = head.getInt16(50) === 1;
  const offsetOf = (g) => (longOffsets ? loca.getUint32(g * 4) : loca.getUint16(g * 2) * 2);
  const bounds = new Array(glyphCount);
  for (let g = 0; g < glyphCount; g++) {
    const start = offsetOf(g);
    // An empty glyph (a space) has a zero-length glyf record: no ink at all.
    if (offsetOf(g + 1) === start) continue;
    bounds[g] = [
      glyf.getInt16(start + 2),
      glyf.getInt16(start + 4),
      glyf.getInt16(start + 6),
      glyf.getInt16(start + 8),
    ];
  }
  return bounds;
}

/** The first name-table record for `nameId`, preferring the Windows/BMP one. */
function readName(name, nameId) {
  const count = name.getUint16(2);
  const storage = name.getUint16(4);
  let best;
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    if (name.getUint16(record + 6) !== nameId) continue;
    const platformId = name.getUint16(record);
    const length = name.getUint16(record + 8);
    const offset = name.getUint16(record + 10);
    let text = "";
    if (platformId === 3) {
      for (let k = 0; k + 1 < length; k += 2) {
        text += String.fromCharCode(name.getUint16(storage + offset + k));
      }
    } else {
      for (let k = 0; k < length; k++) {
        text += String.fromCharCode(name.getUint8(storage + offset + k));
      }
    }
    if (platformId === 3) return text;
    best ??= text;
  }
  return best ?? "";
}

/**
 * Everything the renderer needs to measure a label, in font units.
 *
 * Exported so the test can re-derive it from the same bytes and compare
 * against the committed table.
 */
export function extractMetrics(fontBytes) {
  const tables = readSfntTables(fontBytes);
  const head = requireTable(tables, "head");
  const hhea = requireTable(tables, "hhea");
  const hmtx = requireTable(tables, "hmtx");
  const maxp = requireTable(tables, "maxp");
  const os2 = requireTable(tables, "OS/2");
  const name = requireTable(tables, "name");

  const unitsPerEm = head.getUint16(18);
  const glyphCount = maxp.getUint16(4);
  const advances = readAdvances(hhea, hmtx, glyphCount);
  const cmap = readCmap(requireTable(tables, "cmap"));
  const inkBounds = readInkBounds(
    head,
    requireTable(tables, "loca"),
    requireTable(tables, "glyf"),
    glyphCount,
  );

  const widths = [];
  const inks = [];
  for (const cp of [...cmap.keys()].sort((a, b) => a - b)) {
    const glyph = cmap.get(cp);
    // Control characters have no ink and no business in a label; they would
    // only bloat the table. Space (0x20) is kept — condensed formulae use it.
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue;
    widths.push([cp, advances[glyph]]);
    const ink = inkBounds[glyph];
    if (ink !== undefined) inks.push([cp, ...ink]);
  }

  return {
    family: readName(name, 1),
    version: readName(name, 5),
    unitsPerEm,
    // OS/2 typographic metrics, not hhea's: hhea carries line-layout values a
    // browser may already have adjusted, while sTypo* is the designer's own
    // statement of where the ascenders and descenders end.
    ascender: os2.getInt16(68),
    descender: os2.getInt16(70),
    capHeight: os2.getInt16(88),
    xHeight: os2.getInt16(86),
    // .notdef's advance, used for any character the subset does not cover.
    notdefAdvance: advances[0],
    notdefInk: inkBounds[0] ?? null,
    widths,
    inks,
  };
}

/**
 * One table from the Latin face plus whatever the Greek face adds.
 *
 * Refuses faces that disagree on anything the measurer treats as global — the
 * em, the vertical metrics, `.notdef` — since a label could then be measured
 * against one face's band and drawn in the other's.
 */
export function mergeMetrics(primary, secondary) {
  for (const key of ["family", "version", "unitsPerEm", "ascender", "descender", "capHeight", "xHeight", "notdefAdvance"]) {
    if (primary[key] !== secondary[key]) {
      throw new Error(`The faces disagree on ${key}: ${primary[key]} vs ${secondary[key]}`);
    }
  }
  const covered = new Set(primary.widths.map(([cp]) => cp));
  const byCodepoint = (a, b) => a[0] - b[0];
  return {
    ...primary,
    widths: [...primary.widths, ...secondary.widths.filter(([cp]) => !covered.has(cp))].sort(byCodepoint),
    inks: [...primary.inks, ...secondary.inks.filter(([cp]) => !covered.has(cp))].sort(byCodepoint),
  };
}

/** The code points `secondary` adds over `primary`, as a CSS `unicode-range`. */
export function addedUnicodeRange(primary, secondary) {
  const covered = new Set(primary.widths.map(([cp]) => cp));
  const added = secondary.widths.map(([cp]) => cp).filter((cp) => !covered.has(cp));
  const ranges = [];
  for (const cp of added) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === cp - 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  return ranges.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(",");
}

export function fontSha256(fontBytes) {
  return createHash("sha256").update(fontBytes).digest("hex");
}

function render(metrics, sha256, greekSha256) {
  const rows = metrics.widths
    .map(([cp, advance]) => `  [0x${cp.toString(16).padStart(4, "0")}, ${advance}],`)
    .join("\n");

  const inkRows = metrics.inks
    .map(
      ([cp, xMin, yMin, xMax, yMax]) =>
        `  [0x${cp.toString(16).padStart(4, "0")}, ${xMin}, ${yMin}, ${xMax}, ${yMax}],`,
    )
    .join("\n");
  const notdefInk =
    metrics.notdefInk === null ? "undefined" : `[${metrics.notdefInk.join(", ")}]`;

  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`node scripts/generate-font-metrics.mjs\` from
 * \`assets/arimo-latin-400-normal.woff\` and \`arimo-greek-400-normal.woff\`
 * (decision 252; Latin wins where both have a code point).
 * \`font-metrics.test.ts\` re-extracts the same numbers from those files and
 * fails if this table has drifted, so the generator is the only sanctioned way
 * to change anything below.
 *
 * All lengths are in font units; divide by \`UNITS_PER_EM\` for em fractions.
 * Integers keep the table exact and diffable — em fractions of a 2048-unit em
 * are dyadic and would round-trip fine, but they read as noise in a review.
 */

/** \`name\` ID 1 of the vendored face. */
export const FONT_FAMILY = ${JSON.stringify(metrics.family)};

/** \`name\` ID 5, so a bug report can name the exact release. */
export const FONT_VERSION = ${JSON.stringify(metrics.version)};

/** SHA-256 of the Latin WOFF these numbers came from. */
export const FONT_SHA256 = ${JSON.stringify(sha256)};

/** SHA-256 of the Greek WOFF, which supplies every code point the Latin one lacks. */
export const GREEK_FONT_SHA256 = ${JSON.stringify(greekSha256)};

export const UNITS_PER_EM = ${metrics.unitsPerEm};

/** OS/2 sTypoAscender / sTypoDescender. Descender is negative. */
export const ASCENDER = ${metrics.ascender};
export const DESCENDER = ${metrics.descender};

/** Cap height is what a label's box is measured against: chemical labels are
 * capitals and digits, so cap height, not ascender, is the visual top. */
export const CAP_HEIGHT = ${metrics.capHeight};
export const X_HEIGHT = ${metrics.xHeight};

/** Advance of .notdef, used for any codepoint outside the subset. */
export const NOTDEF_ADVANCE = ${metrics.notdefAdvance};

/** [codepoint, advance width] for every covered character, codepoint-ascending. */
export const ADVANCE_WIDTHS: readonly (readonly [number, number])[] = [
${rows}
];

/** .notdef's ink box, [xMin, yMin, xMax, yMax], y-up; undefined if it has none. */
export const NOTDEF_INK: readonly [number, number, number, number] | undefined = ${notdefInk};

/**
 * [codepoint, xMin, yMin, xMax, yMax] of each covered character's glyph INK,
 * font units, y-UP from the baseline and x from the pen position,
 * codepoint-ascending. A character with no outline (the space) is absent.
 */
export const INK_BOUNDS: readonly (readonly [number, number, number, number, number])[] = [
${inkRows}
];
`;
}

/**
 * The WOFF itself, as a base64 string module, for embedding into an exported
 * SVG's `@font-face`.
 *
 * A string module rather than a fetched asset for the same three reasons the
 * metrics are a table: the figure serialiser must run in a Node test, in a
 * static export served under an arbitrary subpath, and in the browser, and
 * a `data:` URI inside the SVG is the only form in which an `<img>`-loaded SVG
 * (which is how the PNG export rasterises) can use a font at all — an SVG
 * image may not fetch anything. `font-metrics.test.ts` decodes it and checks
 * its SHA-256 against `FONT_SHA256`, so it cannot drift from the file either.
 */
function renderWoff(bytes, sha256, greekBytes, greekSha256, greekRange) {
  return `/**
 * GENERATED by scripts/generate-font-metrics.mjs from
 * assets/arimo-latin-400-normal.woff. Do not edit by hand.
 *
 * Arimo, Copyright The Arimo Project Authors
 * (https://github.com/googlefonts/arimo), licensed under the SIL Open Font
 * License 1.1 — full text in assets/OFL.txt. The OFL permits embedding the
 * font in a document, and places no obligation on the document.
 *
 * SHA-256 of the decoded bytes: ${sha256}
 */

export const ARIMO_WOFF_BASE64 =
  ${JSON.stringify(Buffer.from(bytes).toString("base64"))};

/**
 * The Greek subset (decision 252), SHA-256 ${greekSha256}. Embedded only in a
 * figure that sets one of its letters, declared with this unicode-range so a
 * browser takes exactly those code points from it.
 */
export const ARIMO_GREEK_WOFF_BASE64 =
  ${JSON.stringify(Buffer.from(greekBytes).toString("base64"))};

export const ARIMO_GREEK_UNICODE_RANGE = ${JSON.stringify(greekRange)};
`;
}

/**
 * The WOFF unwrapped back into the TrueType file it was made from, for the
 * PDF export (decision 236).
 *
 * A PDF embeds TrueType as `FontFile2`; it has no WOFF filter. WOFF stores
 * each table zlib-compressed on its own, so the tables cannot be handed to a
 * PDF reader as one Flate stream, and the browser has no synchronous inflate.
 * The unwrapping therefore happens HERE, at generation time, and the sfnt is
 * re-deflated as a whole so the PDF writer can copy it into a
 * `/FlateDecode` stream byte for byte with no compressor at runtime.
 *
 * Every table keeps the bytes and the checksum WOFF preserved, in the
 * directory's tag order, each padded to four bytes, which is the layout the
 * WOFF spec requires an encoder to have started from.
 */
export function buildSfnt(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== WOFF_SIGNATURE) throw new Error(`${FONT_PATH} is not a WOFF file`);
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const offset = dv.getUint32(entry + 4);
    const compressedLength = dv.getUint32(entry + 8);
    const originalLength = dv.getUint32(entry + 12);
    const slice = buf.subarray(offset, offset + compressedLength);
    entries.push({
      tag: dv.getUint32(entry),
      checksum: dv.getUint32(entry + 16),
      data: compressedLength === originalLength ? slice : inflateSync(slice),
    });
  }
  const pad4 = (n) => (n + 3) & ~3;
  const headerLength = 12 + 16 * numTables;
  const total = entries.reduce((sum, e) => sum + pad4(e.data.length), headerLength);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = 2 ** entrySelector * 16;
  ov.setUint32(0, flavor);
  ov.setUint16(4, numTables);
  ov.setUint16(6, searchRange);
  ov.setUint16(8, entrySelector);
  ov.setUint16(10, numTables * 16 - searchRange);
  let offset = headerLength;
  entries.forEach((e, i) => {
    const record = 12 + i * 16;
    ov.setUint32(record, e.tag);
    ov.setUint32(record + 4, e.checksum);
    ov.setUint32(record + 8, offset);
    ov.setUint32(record + 12, e.data.length);
    out.set(e.data, offset);
    offset += pad4(e.data.length);
  });
  return out;
}

/** What the PDF writer needs beyond the advances: glyph ids and the font box. */
export function extractPdfFontData(fontBytes) {
  const tables = readSfntTables(fontBytes);
  const head = requireTable(tables, "head");
  const cmap = readCmap(requireTable(tables, "cmap"));
  return {
    glyphIds: [...cmap.entries()]
      .filter(([cp]) => !(cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)))
      .sort(([a], [b]) => a - b),
    fontBBox: [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)],
  };
}

function renderSfnt(faces) {
  const covered = new Set();
  const blocks = faces.map(({ name, bytes }) => {
    const sfnt = buildSfnt(bytes);
    const { glyphIds, fontBBox } = extractPdfFontData(bytes);
    // Each code point belongs to the first face that has it.
    const own = glyphIds.filter(([cp]) => !covered.has(cp));
    for (const [cp] of own) covered.add(cp);
    const rows = own
      .map(([cp, gid]) => `      [0x${cp.toString(16).padStart(4, "0")}, ${gid}],`)
      .join("\n");
    return `  {
    baseFont: ${JSON.stringify(name)},
    sha256: ${JSON.stringify(fontSha256(bytes))},
    deflatedBase64:
      ${JSON.stringify(Buffer.from(deflateSync(sfnt, { level: 9 })).toString("base64"))},
    length: ${sfnt.length},
    fontBBox: [${fontBBox.join(", ")}],
    glyphIds: [
${rows}
    ],
  },`;
  });
  return `/**
 * GENERATED by scripts/generate-font-metrics.mjs from
 * assets/arimo-latin-400-normal.woff and assets/arimo-greek-400-normal.woff.
 * Do not edit by hand.
 *
 * Each face unwrapped to the TrueType file a PDF embeds as FontFile2 and
 * deflated whole, so the PDF writer copies it into a /FlateDecode stream
 * without a compressor (decision 236). Latin first; the Greek face carries
 * only the code points Latin lacks (decision 252).
 *
 * Arimo, Copyright The Arimo Project Authors
 * (https://github.com/googlefonts/arimo), licensed under the SIL Open Font
 * License 1.1 — full text in assets/OFL.txt. The OFL permits embedding the
 * font in a document, and places no obligation on the document.
 */

export interface PdfFace {
  /** The PDF /BaseFont name. */
  readonly baseFont: string;
  /** SHA-256 of the WOFF it was unwrapped from. */
  readonly sha256: string;
  /** The TrueType file, zlib-deflated, base64. */
  readonly deflatedBase64: string;
  /** Its length before deflating: a FontFile2 stream's /Length1. */
  readonly length: number;
  /** \`head\` xMin, yMin, xMax, yMax in font units: the descriptor's /FontBBox. */
  readonly fontBBox: readonly [number, number, number, number];
  /** [codepoint, glyph id] for every code point this face is used for, ascending. */
  readonly glyphIds: readonly (readonly [number, number])[];
}

export const PDF_FACES: readonly PdfFace[] = [
${blocks.join("\n")}
];
`;
}

// Only write when run as a script; the test imports `extractMetrics` instead.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = readFileSync(FONT_PATH);
  const greekBytes = readFileSync(GREEK_FONT_PATH);
  const latin = extractMetrics(bytes);
  const greek = extractMetrics(greekBytes);
  const metrics = mergeMetrics(latin, greek);
  writeFileSync(OUT_PATH, render(metrics, fontSha256(bytes), fontSha256(greekBytes)));
  writeFileSync(
    WOFF_OUT_PATH,
    renderWoff(bytes, fontSha256(bytes), greekBytes, fontSha256(greekBytes), addedUnicodeRange(latin, greek)),
  );
  writeFileSync(
    SFNT_OUT_PATH,
    renderSfnt([
      { name: "Arimo", bytes },
      { name: "Arimo-Greek", bytes: greekBytes },
    ]),
  );
  process.stdout.write(
    `Wrote ${OUT_PATH}: ${metrics.widths.length} glyph advances from ` +
      `${metrics.family} ${metrics.version}\n`,
  );
}

export { render, renderWoff, renderSfnt, FONT_PATH, GREEK_FONT_PATH, OUT_PATH, WOFF_OUT_PATH, SFNT_OUT_PATH };
