/**
 * Which code points a figure sets, for the serialisers that embed fonts.
 *
 * The SVG embeds Arimo's Greek face only when a figure sets a Greek letter
 * (decision 252), and the PDF reports what it leaves to the reader's Symbol
 * font; both need the same walk over every text run, decorations included.
 */

import type { ScenePrimitive } from "../scene/types.js";
import { GREEK_UNICODE_RANGE } from "../text/woff.js";
import type { Figure } from "./compose.js";

/** Every code point any text run of `figure` sets, in first-drawn order. */
export function figureCodePoints(figure: Figure): readonly number[] {
  const seen = new Set<number>();
  const visit = (p: ScenePrimitive): void => {
    if (p.type === "group") p.children.forEach(visit);
    if (p.type !== "textRun") return;
    for (const span of p.spans) {
      for (const character of span.text) seen.add(character.codePointAt(0) ?? 0);
    }
  };
  for (const cell of figure.cells) {
    const primitives =
      cell.content.kind === "scene" ? cell.content.scene.primitives : cell.content.primitives;
    primitives.forEach(visit);
    cell.decorations.forEach(visit);
  }
  return [...seen];
}

/** The Greek face's `unicode-range`, read once into [first, last] pairs. */
const GREEK_RANGES: readonly (readonly [number, number])[] = GREEK_UNICODE_RANGE.split(",").map(
  (part) => {
    const [first, last] = part.replace(/^U\+/, "").split("-");
    const a = parseInt(first ?? "", 16);
    return [a, last === undefined ? a : parseInt(last, 16)] as const;
  },
);

/** Whether `codepoint` is set from the embedded Greek face. */
export function inGreekFace(codepoint: number): boolean {
  return GREEK_RANGES.some(([a, b]) => codepoint >= a && codepoint <= b);
}
