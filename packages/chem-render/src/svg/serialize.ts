/**
 * Scene -> SVG text.
 *
 * DOM-FREE, deliberately. No `document`, no `XMLSerializer`: the exporter has
 * to run in a Node test and, later, anywhere a figure is generated headlessly.
 * Building a string is also the only way to control byte-for-byte output.
 *
 * BYTE-DETERMINISM is a hard requirement — exported figures get committed and
 * diffed. Attribute order is fixed per primitive type and every number goes
 * through `formatNumber`.
 *
 * Nothing here scales or flips anything. The scene arrives in final px with y
 * already down (see `modelToPx` in style.ts); this file only decides how those
 * numbers are spelled.
 */

import type {
  RenderScene,
  SceneFill,
  ScenePoint,
  ScenePrimitive,
  SceneSource,
  SceneStroke,
  TextRunPrimitive,
} from "../scene/types.js";
import { scriptDyPx, scriptFontSizePx } from "../text/metrics.js";

export interface SerializeOptions {
  /**
   * Prepend the XML declaration, making the output a standalone `.svg` file.
   * Defaults to true; pass false for a fragment to embed inline in HTML.
   */
  readonly standalone?: boolean;
  readonly indent?: boolean;
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

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
interface Emitter {
  readonly lines: string[];
  readonly indent: boolean;
  readonly precision: number;
  readonly subscriptScale: number;
}

function push(e: Emitter, depth: number, markup: string): void {
  e.lines.push(e.indent ? "  ".repeat(depth) + markup : markup);
}

/** ` name="value"`, with the value escaped. The leading space is part of it. */
function attr(name: string, value: string): string {
  return ` ${name}="${escapeAttr(value)}"`;
}

function num(e: Emitter, value: number, context: string): string {
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
    attr("id", p.id) +
    sourceAttr(p.source) +
    attr("x", num(e, p.origin.x, p.id)) +
    attr("y", num(e, p.origin.y, p.id)) +
    attr("font-family", p.fontFamily) +
    attr("font-size", num(e, p.fontSizePx, p.id)) +
    attr("fill", p.fill.color) +
    attr("text-anchor", p.anchor) +
    attr("dominant-baseline", p.baseline) +
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

function emitPrimitive(e: Emitter, p: ScenePrimitive, depth: number): void {
  // Identity first, back-reference second, on every element. Geometry and
  // paint follow in a per-type order fixed below.
  const head = attr("id", p.id) + sourceAttr(p.source);

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

/** Serialises `scene` to SVG markup. */
export function serializeScene(
  scene: RenderScene,
  options?: SerializeOptions,
): string {
  const standalone = options?.standalone ?? true;
  // Indented by default: these files get committed, and a one-line SVG makes
  // every change look like a whole-file rewrite in a diff.
  const indent = options?.indent ?? true;

  const { bounds, style } = scene;
  const e: Emitter = {
    lines: [],
    indent,
    precision: style.coordinatePrecision,
    subscriptScale: style.subscriptScale,
  };

  const viewBox = [bounds.minX, bounds.minY, bounds.width, bounds.height]
    .map((v) => num(e, v, "scene bounds"))
    .join(" ");
  const width = num(e, bounds.width, "scene bounds");
  const height = num(e, bounds.height, "scene bounds");

  push(
    e,
    0,
    `<svg` +
      attr("xmlns", SVG_NAMESPACE) +
      attr("viewBox", viewBox) +
      // Explicit px units: a unitless width is interpreted against the
      // containing block by some consumers, and a figure that resizes with its
      // container is not a figure.
      attr("width", `${width}px`) +
      attr("height", `${height}px`) +
      `>`,
  );

  // Only when the style asks for one. A style with no background produces a
  // transparent SVG that takes the colour of the page it lands on; baking in a
  // white rect is why exported figures show up as bright blocks on dark slides.
  const background = style.colors.background;
  if (background !== undefined) {
    push(
      e,
      1,
      `<rect` +
        attr("data-decoration", "background") +
        attr("x", num(e, bounds.minX, "background")) +
        attr("y", num(e, bounds.minY, "background")) +
        attr("width", width) +
        attr("height", height) +
        attr("fill", background) +
        `/>`,
    );
  }

  for (const primitive of scene.primitives) emitPrimitive(e, primitive, 1);
  push(e, 0, `</svg>`);

  const body = e.lines.join(indent ? "\n" : "");
  return standalone ? XML_DECLARATION + body : body;
}

/**
 * The scene as a `data:` URI — percent-encoded rather than base64, which stays
 * readable in devtools and is smaller for text.
 *
 * The payload is the inline form: no XML declaration and no indentation, since
 * nothing is going to diff a URI and every byte is encoded twice over.
 */
export function serializeToDataUri(scene: RenderScene): string {
  const svg = serializeScene(scene, { standalone: false, indent: false });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
