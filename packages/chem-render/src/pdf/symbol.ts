/**
 * The faces a PDF sets a code point in, as far as anyone outside the writer
 * needs to know: whether it falls back to the reader's Symbol font.
 *
 * Its own module, re-exported from the root barrel, so the export dialog can
 * say which characters are not embedded without loading `pdf/figure.ts` and
 * the fonts it carries.
 */

import type { Figure } from "../figure/compose.js";
import { figureCodePoints } from "../figure/text.js";
import { faceMetricsFor } from "../text/metrics.js";

/**
 * Code points the standard Symbol font has and no embedded face file
 * does, with their byte in Symbol's built-in encoding: arrows and relations a
 * conditions line may carry as the author typed them. Greek is not here — the
 * Greek face is embedded (decision 252) — and ↑ ↓ are in the Latin face, so
 * `hasGlyph` takes them first.
 */
export const SYMBOL_CODES: ReadonlyMap<number, number> = new Map([
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
 * than an embedded face, each once, in draw order. What the export
 * dialog reports: those glyphs are not embedded.
 */
export function pdfFallbackCodePoints(figure: Figure): readonly number[] {
  const face = faceMetricsFor(figure.style.fontFamily, figure.style.fontWeight);
  return figureCodePoints(figure).filter((cp) => !face.hasGlyph(cp) && SYMBOL_CODES.has(cp));
}
