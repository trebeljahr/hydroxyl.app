/**
 * The faces a PDF sets a code point in, as far as anyone outside the writer
 * needs to know: whether it falls back to the reader's Symbol font.
 *
 * Its own module, re-exported from the root barrel, so the export dialog can
 * say which letters are not embedded without loading `pdf/figure.ts` and the
 * ~20 kB font it carries.
 */

import type { Figure } from "../figure/compose.js";
import type { ScenePrimitive } from "../scene/types.js";
import { hasGlyph } from "../text/metrics.js";

/**
 * Code points the standard Symbol font has and Arimo's Latin subset does not,
 * with their byte in Symbol's built-in encoding. The Greek alphabet first —
 * the letters chemistry sets (typography.ts) and the rest of it, since a
 * conditions line keeps whatever the author typed — then arrows and
 * relations.
 */
export const SYMBOL_CODES: ReadonlyMap<number, number> = new Map([
  ...[..."ΑΒΧΔΕΦΓΗΙ"].map((ch, i) => [ch.codePointAt(0) ?? 0, "ABCDEFGHI".charCodeAt(i)] as const),
  ...[..."ϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ"].map((ch, i) => [ch.codePointAt(0) ?? 0, "JKLMNOPQRSTUVWXYZ".charCodeAt(i)] as const),
  ...[..."αβχδεφγηιϕκλμνοπθρστυϖωξψζ"].map((ch, i) => [ch.codePointAt(0) ?? 0, "abcdefghijklmnopqrstuvwxyz".charCodeAt(i)] as const),
  [0x2194, 0xab], // ↔
  [0x2190, 0xac], // ←
  [0x2191, 0xad], // ↑
  [0x2192, 0xae], // →
  [0x2193, 0xaf], // ↓
  [0x221e, 0xa5], // ∞
  [0x2264, 0xa3], // ≤
  [0x2265, 0xb3], // ≥
  [0x2260, 0xb9], // ≠
  [0x2261, 0xba], // ≡
  [0x2248, 0xbb], // ≈
]);

/**
 * The code points of `figure` the PDF sets in the reader's Symbol font rather
 * than the embedded Arimo, each once, in draw order. What the export dialog
 * reports: those glyphs are not embedded.
 */
export function pdfFallbackCodePoints(figure: Figure): readonly number[] {
  const out: number[] = [];
  const visit = (p: ScenePrimitive): void => {
    if (p.type === "group") p.children.forEach(visit);
    if (p.type !== "textRun") return;
    for (const span of p.spans) {
      for (const character of span.text) {
        const codepoint = character.codePointAt(0) ?? 0;
        if (hasGlyph(codepoint) || !SYMBOL_CODES.has(codepoint)) continue;
        if (!out.includes(codepoint)) out.push(codepoint);
      }
    }
  };
  for (const cell of figure.cells) {
    const primitives =
      cell.content.kind === "scene" ? cell.content.scene.primitives : cell.content.primitives;
    primitives.forEach(visit);
    cell.decorations.forEach(visit);
  }
  return out;
}
