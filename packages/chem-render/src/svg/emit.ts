/**
 * The primitive emitter shared by the single-scene serialiser and the figure
 * serialiser.
 *
 * NOT RE-EXPORTED from the package index: these are the mechanics of spelling
 * a primitive, and the public surface is `serializeScene` / `serializeFigure`.
 * It lives in its own module only so both of those can use one copy — a
 * second emitter would be a second place deciding attribute order, and byte
 * determinism dies the moment two of them disagree.
 *
 * `idPrefix` is the one thing a figure needs that a lone scene does not. Two
 * panels of the same molecule share every atom and bond id, so every `id`
 * attribute a panel emits is prefixed with that panel's namespace. A lone
 * scene uses the empty prefix and its output is byte-identical to what it was
 * before the prefix existed; the goldens pin that.
 *
 * Nothing here scales or flips anything. The scene arrives in final px with y
 * already down (see `modelToPx` in style.ts); this file only decides how those
 * numbers are spelled.
 */

import type {
  SceneFill,
  ScenePoint,
  ScenePrimitive,
  SceneSource,
  SceneStroke,
  TextRunPrimitive,
} from "../scene/types.js";
import { scriptDyPx, scriptFontSizePx } from "../text/metrics.js";

/*
 * No `dominant-baseline` is emitted, not even `alphabetic`: every run's `y` is
 * already its alphabetic baseline (see `TextRunPrimitive`), which is what the
 * property's initial value means for horizontal text, so spelling it out would
 * only invite a reader to think another value is ever meant.
 */

/*
 * The sub/superscript baseline offsets used to live here. They now live in
 * `text/metrics.ts`, beside the font's own em fractions, because the measurer
 * and this file have to agree on them to the last bit: the box a superscript
 * charge is measured into and the `dy` it is drawn with must be the same
 * number, or a charged label is clipped by exactly the discrepancy. The
 * measurer models the shift, so `sceneBounds` no longer under-measures a
 * scripted run — see `SUBSCRIPT_DY_FACTOR` there for why an explicit `dy`
 * rather than SVG's own `baseline-shift`.
 */

/** Accumulates markup and carries the per-scene formatting decisions. */
export interface Emitter {
  readonly lines: string[];
  /** Prepended to every `id` attribute. Empty for a lone scene. */
  readonly idPrefix: string;
  readonly indent: boolean;
  readonly precision: number;
  readonly subscriptScale: number;
}

export function push(e: Emitter, depth: number, markup: string): void {
  e.lines.push(e.indent ? "  ".repeat(depth) + markup : markup);
}

/** ` name="value"`, with the value escaped. The leading space is part of it. */
export function attr(name: string, value: string): string {
  return ` ${name}="${escapeAttr(value)}"`;
}

export function num(e: Emitter, value: number, context: string): string {
  return formatNumber(value, e.precision, context);
}

/**
 * The back-reference, as one data attribute.
 *
 * Every primitive carries it so the rendered SVG stays walkable back to the
 * model: a hit-test can read `data-bond` off the element under the cursor
 * instead of re-deriving geometry, and a debugging session can find "the line
 * for b3" in a dump by grepping. The attribute name encodes the kind, so a
 * selector like `[data-atom]` picks out exactly the atom primitives.
 */
function sourceAttr(source: SceneSource): string {
  switch (source.kind) {
    case "atom":
      return attr("data-atom", source.atomId);
    case "bond":
      return attr("data-bond", source.bondId);
    case "hydrogen":
      // Two attributes, not one: a consumer wants "which atom does this
      // hydrogen belong to" far more often than it wants the index, and
      // joining them into one string would make every reader split it again.
      return (
        attr("data-hydrogen-host", source.hostAtomId) +
        attr("data-hydrogen-index", String(source.index))
      );
    case "ring":
      // Space-separated, which is how SVG spells a list of ids everywhere
      // else. The set IS the ring's name: chem-core gives a ring no id of its
      // own, only an index into a list whose order is insertion order.
      return attr("data-ring", source.atomIds.join(" "));
    case "decoration":
      // No model entity to point at; the flag exists so hit-testing can skip it.
      return attr("data-decoration", "true");
  }
}

function strokeAttrs(e: Emitter, stroke: SceneStroke, context: string): string {
  let out =
    attr("stroke", stroke.color) +
    attr("stroke-width", num(e, stroke.width, context));
  if (stroke.cap !== undefined) out += attr("stroke-linecap", stroke.cap);
  if (stroke.join !== undefined) out += attr("stroke-linejoin", stroke.join);
  // An empty dash array is not a valid stroke-dasharray, and it means the same
  // thing as no dashing at all, so it is dropped rather than emitted as "".
  if (stroke.dash !== undefined && stroke.dash.length > 0) {
    out += attr(
      "stroke-dasharray",
      stroke.dash.map((d) => num(e, d, context)).join(" "),
    );
  }
  return out;
}

/**
 * `fill` is emitted even when the primitive has none.
 *
 * SVG fills shapes black by default, so an unfilled polygon or path that
 * simply omits the attribute comes out as a black blob. `fill="none"` is the
 * only way to say "outline only".
 */
function fillAttr(fill: SceneFill | undefined): string {
  return attr("fill", fill === undefined ? "none" : fill.color);
}

function pointsAttrValue(
  e: Emitter,
  points: readonly ScenePoint[],
  context: string,
): string {
  return points
    .map((p) => `${num(e, p.x, context)},${num(e, p.y, context)}`)
    .join(" ");
}

/**
 * A `<text>` element and its spans, always on a single line.
 *
 * The indentation that every other element gets is deliberately suppressed
 * inside the run: whitespace between `<tspan>`s is collapsed to a space rather
 * than removed, which would set "H2O" as "H 2 O". Determinism is unaffected —
 * the layout is fixed either way.
 */
function textRunMarkup(e: Emitter, p: TextRunPrimitive): string {
  let out =
    `<text` +
    attr("id", e.idPrefix + p.id) +
    sourceAttr(p.source) +
    attr("x", num(e, p.origin.x, p.id)) +
    attr("y", num(e, p.origin.y, p.id)) +
    attr("font-family", p.fontFamily) +
    attr("font-size", num(e, p.fontSizePx, p.id)) +
    attr("fill", p.fill.color) +
    attr("text-anchor", p.anchor) +
    `>`;

  // `dy` is a *relative* shift that persists for the rest of the run, so each
  // span emits the delta from the span before it — a subscript is followed by
  // an equal and opposite shift back up to the baseline.
  let shift = 0;
  for (const span of p.spans) {
    const target = scriptDyPx(span.script, p.fontSizePx);
    const dy = target - shift;
    shift = target;

    let spanAttrs = "";
    if (span.script !== undefined) {
      spanAttrs += attr(
        "font-size",
        num(e, scriptFontSizePx(span.script, p.fontSizePx, e.subscriptScale), p.id),
      );
    }
    // A zero dy is omitted: it is a no-op, and printing "dy=0" on every plain
    // span in a formula is pure noise in a diff.
    if (formatNumber(dy, e.precision, p.id) !== "0") {
      spanAttrs += attr("dy", num(e, dy, p.id));
    }
    out += `<tspan${spanAttrs}>${escapeText(span.text)}</tspan>`;
  }

  return `${out}</text>`;
}

export function emitPrimitive(e: Emitter, p: ScenePrimitive, depth: number): void {
  // Identity first, back-reference second, on every element. Geometry and
  // paint follow in a per-type order fixed below.
  const head = attr("id", e.idPrefix + p.id) + sourceAttr(p.source);

  switch (p.type) {
    case "line":
      push(
        e,
        depth,
        `<line${head}` +
          attr("x1", num(e, p.a.x, p.id)) +
          attr("y1", num(e, p.a.y, p.id)) +
          attr("x2", num(e, p.b.x, p.id)) +
          attr("y2", num(e, p.b.y, p.id)) +
          strokeAttrs(e, p.stroke, p.id) +
          `/>`,
      );
      break;

    case "polyline":
      // A polyline has no fill in the IR, but SVG would fill it black anyway.
      push(
        e,
        depth,
        `<polyline${head}` +
          attr("points", pointsAttrValue(e, p.points, p.id)) +
          fillAttr(undefined) +
          strokeAttrs(e, p.stroke, p.id) +
          `/>`,
      );
      break;

    case "polygon":
      push(
        e,
        depth,
        `<polygon${head}` +
          attr("points", pointsAttrValue(e, p.points, p.id)) +
          fillAttr(p.fill) +
          (p.stroke === undefined ? "" : strokeAttrs(e, p.stroke, p.id)) +
          `/>`,
      );
      break;

    case "path":
      // `d` is opaque: it is already scene px, and re-formatting its numbers
      // would mean parsing path syntax. Whoever builds a path owes it the
      // style's precision.
      push(
        e,
        depth,
        `<path${head}` +
          attr("d", p.d) +
          fillAttr(p.fill) +
          (p.stroke === undefined ? "" : strokeAttrs(e, p.stroke, p.id)) +
          `/>`,
      );
      break;

    case "circle":
      push(
        e,
        depth,
        `<circle${head}` +
          attr("cx", num(e, p.centre.x, p.id)) +
          attr("cy", num(e, p.centre.y, p.id)) +
          attr("r", num(e, p.radius, p.id)) +
          fillAttr(p.fill) +
          (p.stroke === undefined ? "" : strokeAttrs(e, p.stroke, p.id)) +
          `/>`,
      );
      break;

    case "textRun":
      push(e, depth, textRunMarkup(e, p));
      break;

    case "group": {
      if (p.children.length === 0) {
        push(e, depth, `<g${head}/>`);
        break;
      }
      push(e, depth, `<g${head}>`);
      for (const child of p.children) emitPrimitive(e, child, depth + 1);
      push(e, depth, `</g>`);
      break;
    }
  }
}

/**
 * The single number formatter, used for every coordinate and length.
 *
 * Fixes the decimal count, then strips trailing zeros and a trailing dot so
 * "24.000" prints as "24". Crucially it also normalises -0 to 0: the y-flip
 * turns a 0 into a -0, and whether that reaches the output depends on nothing
 * a reader could predict.
 *
 * Non-finite input throws. `context` is woven into the message so a NaN can be
 * traced to the primitive that produced it rather than to this function.
 */
export function formatNumber(
  n: number,
  precision: number,
  context?: string,
): string {
  if (!Number.isFinite(n)) {
    const where = context === undefined ? "" : ` in ${context}`;
    throw new Error(`Cannot serialise non-finite number ${String(n)}${where}`);
  }

  let out = n.toFixed(precision);
  if (out.includes(".")) {
    out = out.replace(/0+$/, "").replace(/\.$/, "");
  }
  // toFixed keeps the sign of a negative value that rounds to nothing, so
  // -0.0004 at precision 2 arrives here as "-0.00" and leaves as "-0".
  if (out === "-0") out = "0";
  return out;
}

/**
 * Escapes `&`, `<` and `>` for text content. Exported for test.
 *
 * `>` is not strictly required outside a `]]>` sequence, but escaping it keeps
 * the output safe to paste into an HTML document that is parsed loosely.
 */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes `&`, `<`, `>` and `"` for a double-quoted attribute value. */
export function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
