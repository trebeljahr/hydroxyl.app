/**
 * The ONE style hook for italic and Greek (decisions 192 and 252).
 *
 * Chemistry sets some things in italic (the R and S of a descriptor, `cat.`,
 * `aq.`) and some in Greek (alpha and beta on a sugar or a steroid, the delta
 * of a partial charge, Delta for heat, mu). The vendored Arimo is upright
 * only: it has no italic face. Its Greek subset IS vendored (decision 252,
 * from the same @fontsource/arimo release as the Latin one), so Greek is
 * measured from its own advances and embedded in exported figures.
 *
 * Every place that would set italic or Greek asks THIS module, so the day the
 * faces are vendored is an asset change:
 *
 *   - `greek(name)` returns the letter's code point, which the merged metrics
 *     table measures exactly. Before decision 252 it was charged `.notdef`'s
 *     advance and ink; vendoring the range changed no code here or at any
 *     caller, as this hook intended.
 *   - `italic(text)` returns the text UPRIGHT. A `TextSpan` has no slant field
 *     yet, and adding one before there is a face to set it in would be a flag
 *     with nothing behind it. Vendoring the italic face adds the field, and
 *     this function is the one place that sets it.
 *
 * WHAT IS NOT HERE: the double dagger and the arrows. Those are drawn geometry
 * (decisions 191 and 204), not glyphs, so they need no face at all. A code
 * point a caller typed itself — free text in a conditions list keeps the
 * author's spelling (decision 193) — is not rewritten here either; it is
 * measured as whatever the table says and REPORTED when the table has no
 * glyph for it (`unmeasuredCodePoints` for one string, `unmeasuredTextRuns`
 * for a whole scene; decision 206), never thrown on.
 */

import type { RenderScene, SceneSource, ScenePrimitive, TextSpan } from "../scene/types.js";
import { measurerFor } from "./measurer.js";
import type { Measurer } from "./measurer.js";
import type { FontWeight } from "./metrics.js";

/** Which faces beyond the upright Latin subset are vendored. Decision 252: Greek. */
export const VENDORED_FACES = Object.freeze({
  /** Arimo's Greek range (U+0370-03FF). */
  greek: true,
  /** Arimo Italic. */
  italic: false,
});

/**
 * The Greek letters chemistry figures set, by name. Lowercase delta is the
 * partial charge (the one a transition state is made of, far commoner than
 * capital Delta); capital Delta is heat over an arrow; alpha and beta are the
 * sugar and steroid face labels; mu is a bridging ligand and the micro prefix.
 */
export const GREEK_LETTERS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  mu: "μ",
});
export type GreekLetterName = keyof typeof GREEK_LETTERS;

/** The letter, as its code point. See the module header for what it measures as. */
export function greek(name: GreekLetterName): string {
  return GREEK_LETTERS[name];
}

/**
 * `text` as it is set where chemistry wants italic. Upright in v1, because
 * there is no italic face to set it in (decision 192).
 */
export function italic(text: string): string {
  return text;
}

/**
 * The code points of `text` the measurer has no glyph for, each once, in
 * order of first appearance. What a caller REPORTS: a string with any of them
 * is measured at `.notdef`'s advance, so it sits a little off wherever it is
 * centred, and the social-card rasteriser draws a box for it.
 */
export function unmeasuredCodePoints(
  text: string,
  measurer: Measurer,
  fontFamily: string,
  fontWeight: FontWeight,
): readonly number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || seen.has(codePoint)) continue;
    seen.add(codePoint);
    // A size of 1 px: only the notdef count is read, which no size changes.
    if (measurer.measureText(character, { family: fontFamily, weight: fontWeight, sizePx: 1 }).notdefCount > 0) {
      out.push(codePoint);
    }
  }
  return out;
}

/** A text run in a scene that holds code points the measurer has no glyph for. */
export interface UnmeasuredTextRun {
  readonly primitiveId: string;
  readonly source: SceneSource;
  /** The run's text, scripts flattened. */
  readonly text: string;
  /** Each unmeasured code point once, in order of first appearance. */
  readonly codePoints: readonly number[];
}

/**
 * Every text run of `scene` holding a code point the scene's measurer has no
 * glyph for, in draw order — the scene-level REPORT decision 206 asks for.
 *
 * Never an exception: a run with an unmeasured code point is still laid out
 * (at `.notdef`'s advance, a little wide) and drawn (from the next face in
 * the stack), and a figure that says why is better than no figure. A free
 * function over the finished scene, like `detectCollisions`, so no build
 * pays for it and nothing serialises it by accident.
 */
export function unmeasuredTextRuns(scene: RenderScene): readonly UnmeasuredTextRun[] {
  const measurer = measurerFor(scene.style);
  const out: UnmeasuredTextRun[] = [];
  const visit = (primitive: ScenePrimitive): void => {
    if (primitive.type === "group") {
      primitive.children.forEach(visit);
      return;
    }
    if (primitive.type !== "textRun") return;
    const text = primitive.spans.map((span) => span.text).join("");
    const codePoints = unmeasuredCodePoints(text, measurer, primitive.fontFamily, primitive.fontWeight);
    if (codePoints.length > 0) {
      out.push({ primitiveId: primitive.id, source: primitive.source, text, codePoints });
    }
  };
  scene.primitives.forEach(visit);
  return out;
}

/**
 * True when a run's spaces only survive if the SVG says to keep them: a span
 * that starts or ends with whitespace (the space between `H2SO4` and
 * `(cat.)` falls at a span boundary, after the subscript), or two spaces in a
 * row. Without `xml:space="preserve"` librsvg drops a space at a span edge and
 * every renderer collapses a double one, so the run draws narrower than it
 * was measured and sits off-centre over its shaft. The measurer counts every
 * space, so the emitters keep every space; a run with none of these draws the
 * same either way and is emitted exactly as before.
 */
export function needsPreservedSpace(spans: readonly TextSpan[]): boolean {
  return spans.some((span) => /^\s|\s$|\s\s/.test(span.text));
}
