/**
 * The scene, drawn as real DOM.
 *
 * chem-render already knows how to turn a scene into a picture — that is what
 * `serializeScene` does — and the tempting shortcut is to call it and drop the
 * markup in with `dangerouslySetInnerHTML`. This file exists because that
 * shortcut costs the thing the editor is built on: a string blob is replaced
 * wholesale on every re-render, so React can never reconcile a single line, an
 * `<svg>` inside it cannot be reached by a ref, and nothing downstream can
 * hang a class or an event on one bond. One React node per primitive keeps all
 * of that available.
 *
 * NOTHING HERE SCALES, FLIPS OR TRANSFORMS ANYTHING. The scene arrives in
 * final px with y already down (see `modelToPx` in chem-render's style.ts);
 * this file only decides how those numbers are spelled. Pan and zoom live on
 * an ancestor transform, not here.
 *
 * COORDINATES GO THROUGH chem-render's `formatNumber` at the scene's own
 * `coordinatePrecision`. Letting React stringify the raw numbers would be
 * easier and very nearly right, which is the problem: the canvas would sit a
 * few thousandths of a px away from the figure the export produces, and -0
 * (which the y-flip manufactures every time a coordinate is 0) would reach the
 * DOM as "-0" here and as "0" there. Same formatter, same rounding, same sign
 * normalisation — the canvas is the export, rendered through a different
 * backend.
 *
 * ATTRIBUTE NAMES DIVERGE FROM THE EXPORTER ON PURPOSE. serialize.ts spells
 * the back-reference `data-atom` / `data-bond`; the DOM canvas spells it
 * `data-atom-id` / `data-bond-id`, which is what the editor's DOM contract and
 * the e2e specs select on. If you arrived here grepping for one spelling and
 * found the other: they are two names for the same back-reference, the
 * exported file uses the short pair and the live canvas the long pair, and
 * `data-decoration` is common to both.
 */

import type { ReactElement } from "react";

import { formatNumber } from "@starter/chem-render";
import type {
  RenderScene,
  SceneFill,
  ScenePoint,
  ScenePrimitive,
  SceneSource,
  SceneStroke,
  TextRunPrimitive,
} from "@starter/chem-render";

export interface SceneLayerProps {
  readonly scene: RenderScene;
}

/**
 * Sub/superscript offsets, as a fraction of the run's font size.
 *
 * DUPLICATED FROM serialize.ts, which keeps them module-private. Two copies of
 * a typographic constant is a real seam: change the exporter's and a formula
 * sets its subscripts one place on screen and another in the exported figure,
 * with nothing to catch it. The honest fix is for chem-render to export them
 * (or better, to resolve the shifts into the scene IR so both backends read
 * the same numbers off the primitive) — a later task. Until then, if you touch
 * one of these, touch the other.
 */
const SUBSCRIPT_DY_FACTOR = 0.25;
const SUPERSCRIPT_DY_FACTOR = -0.35;

/** The per-scene formatting decisions, threaded down instead of re-read. */
interface Format {
  readonly precision: number;
  readonly subscriptScale: number;
}

/** The back-reference and the primitive's identity, as data attributes. */
interface SourceAttrs {
  readonly "data-primitive-id": string;
  readonly "data-atom-id"?: string;
  readonly "data-bond-id"?: string;
  readonly "data-decoration"?: string;
}

interface StrokeProps {
  readonly stroke: string;
  readonly strokeWidth: string;
  readonly strokeLinecap?: "butt" | "round" | "square";
  readonly strokeLinejoin?: "miter" | "round" | "bevel";
  readonly strokeDasharray?: string;
}

export function SceneLayer({ scene }: SceneLayerProps): ReactElement {
  const format: Format = {
    precision: scene.style.coordinatePrecision,
    subscriptScale: scene.style.subscriptScale,
  };

  return (
    // Pointer-events off on the whole layer: the root <svg> is the single
    // element that handles pointers, and picking runs through chem-core's
    // `hitTest` on model geometry rather than on whatever DOM node happened to
    // be under the cursor. A line that swallowed its own clicks would make the
    // two disagree — the DOM would report the drawn (trimmed) bond while the
    // hit-test reasoned about the full one.
    <g data-layer="scene" style={{ pointerEvents: "none" }}>
      {scene.primitives.map((primitive) => primitiveElement(primitive, format))}
    </g>
  );
}

/**
 * One primitive, one element.
 *
 * The switch has NO `default`, and the return type is `ReactElement` rather
 * than `ReactElement | null`, so adding an arm to `ScenePrimitive` breaks the
 * build here instead of silently dropping that shape from the canvas — the
 * same discipline `emitPrimitive` in serialize.ts runs on.
 *
 * The key is `primitive.id`, never the array index. Ids derive from the source
 * (`bond:b3:line`), so when an atom is inserted in the middle of a molecule
 * every other primitive keeps the identity it had, and React moves nodes
 * instead of rewriting the shape of every element after the insertion point.
 * An index key would renumber everything from the edit onwards.
 */
function primitiveElement(primitive: ScenePrimitive, f: Format): ReactElement {
  const attrs = sourceAttrs(primitive.id, primitive.source);

  switch (primitive.type) {
    case "line":
      return (
        <line
          key={primitive.id}
          id={primitive.id}
          {...attrs}
          x1={num(f, primitive.a.x, primitive.id)}
          y1={num(f, primitive.a.y, primitive.id)}
          x2={num(f, primitive.b.x, primitive.id)}
          y2={num(f, primitive.b.y, primitive.id)}
          {...strokeProps(f, primitive.stroke, primitive.id)}
        />
      );

    case "polyline":
      return (
        <polyline
          key={primitive.id}
          id={primitive.id}
          {...attrs}
          points={pointsValue(f, primitive.points, primitive.id)}
          // A polyline carries no fill in the IR, but SVG fills one black by
          // default and closes it in the process: an open zig-zag becomes a
          // solid wedge. `fill="none"` is the only way to say "outline only",
          // and the serialiser emits it for the same reason.
          fill="none"
          {...strokeProps(f, primitive.stroke, primitive.id)}
        />
      );

    case "polygon":
      return (
        <polygon
          key={primitive.id}
          id={primitive.id}
          {...attrs}
          points={pointsValue(f, primitive.points, primitive.id)}
          fill={fillValue(primitive.fill)}
          {...optionalStrokeProps(f, primitive.stroke, primitive.id)}
        />
      );

    case "path":
      return (
        <path
          key={primitive.id}
          id={primitive.id}
          {...attrs}
          // `d` is opaque and passed through verbatim: it is already scene px,
          // and re-formatting its numbers would mean parsing path syntax.
          // Whoever builds a path owes it the style's precision.
          d={primitive.d}
          fill={fillValue(primitive.fill)}
          {...optionalStrokeProps(f, primitive.stroke, primitive.id)}
        />
      );

    case "circle":
      return (
        <circle
          key={primitive.id}
          id={primitive.id}
          {...attrs}
          cx={num(f, primitive.centre.x, primitive.id)}
          cy={num(f, primitive.centre.y, primitive.id)}
          r={num(f, primitive.radius, primitive.id)}
          fill={fillValue(primitive.fill)}
          {...optionalStrokeProps(f, primitive.stroke, primitive.id)}
        />
      );

    case "textRun":
      return textRunElement(primitive, f, attrs);

    case "group":
      // A group is its own element with its own source, and its children carry
      // theirs — the several strokes of one atom label, filed under the atom
      // but individually addressable.
      return (
        <g key={primitive.id} id={primitive.id} {...attrs}>
          {primitive.children.map((child) => primitiveElement(child, f))}
        </g>
      );
  }
}

/**
 * A `<text>` and its spans.
 *
 * `dy` is a RELATIVE shift that persists for the rest of the run, so each span
 * emits the delta from the span before it — a subscript is followed by an
 * equal and opposite shift back up to the baseline. SVG's own
 * `baseline-shift="sub"` is the obvious spelling and is not used, here or in
 * the exporter, because browsers and print pipelines disagree about how far it
 * shifts; an explicit `dy` lands identically everywhere.
 *
 * No structural representation emits a textRun today — atom labels are a later
 * rendering task — so this arm currently only fires for a condensed or
 * sum-formula panel. It is written out in full anyway: the alternative is a
 * panel that silently renders blank the day one lands.
 */
function textRunElement(
  p: TextRunPrimitive,
  f: Format,
  attrs: SourceAttrs,
): ReactElement {
  let shift = 0;

  return (
    <text
      key={p.id}
      id={p.id}
      {...attrs}
      x={num(f, p.origin.x, p.id)}
      y={num(f, p.origin.y, p.id)}
      fontFamily={p.fontFamily}
      fontSize={num(f, p.fontSizePx, p.id)}
      fill={p.fill.color}
      textAnchor={p.anchor}
      dominantBaseline={p.baseline}
    >
      {p.spans.map((span, index) => {
        const target =
          span.script === "sub"
            ? p.fontSizePx * SUBSCRIPT_DY_FACTOR
            : span.script === "super"
              ? p.fontSizePx * SUPERSCRIPT_DY_FACTOR
              : 0;
        const dy = target - shift;
        shift = target;

        // The one place an index is part of a key, and it has to be: a span is
        // an anonymous position in a run, not a model entity, so it has no id
        // of its own. Scoping it under the run's id keeps it unique across the
        // scene, and a re-run of the same formula produces the same spans in
        // the same order.
        const key = `${p.id}:span:${String(index)}`;
        const shifted = num(f, dy, p.id) !== "0";

        return (
          <tspan
            key={key}
            {...(span.script === undefined
              ? {}
              : { fontSize: num(f, p.fontSizePx * f.subscriptScale, p.id) })}
            {...(shifted ? { dy: num(f, dy, p.id) } : {})}
          >
            {span.text}
          </tspan>
        );
      })}
    </text>
  );
}

/**
 * The back-reference, as data attributes.
 *
 * `data-primitive-id` goes on every element regardless of source, so a
 * primitive can be found in the DOM by the same id the scene IR and the
 * exported file call it. See the header on why the atom and bond attributes
 * are spelled differently here than in serialize.ts.
 */
function sourceAttrs(id: string, source: SceneSource): SourceAttrs {
  switch (source.kind) {
    case "atom":
      return { "data-primitive-id": id, "data-atom-id": source.atomId };
    case "bond":
      return { "data-primitive-id": id, "data-bond-id": source.bondId };
    case "decoration":
      // No model entity to point at; the flag exists so a consumer walking the
      // DOM can skip the background rect and the frame the way hit-testing
      // skips them in the IR.
      return { "data-primitive-id": id, "data-decoration": "true" };
  }
}

function strokeProps(
  f: Format,
  stroke: SceneStroke,
  context: string,
): StrokeProps {
  return {
    stroke: stroke.color,
    strokeWidth: num(f, stroke.width, context),
    ...(stroke.cap === undefined ? {} : { strokeLinecap: stroke.cap }),
    ...(stroke.join === undefined ? {} : { strokeLinejoin: stroke.join }),
    // An empty dash array is not a valid stroke-dasharray and means the same
    // thing as no dashing at all, so it is dropped rather than set to "".
    ...(stroke.dash === undefined || stroke.dash.length === 0
      ? {}
      : {
          strokeDasharray: stroke.dash
            .map((d) => num(f, d, context))
            .join(" "),
        }),
  };
}

/** Stroke props for the primitives whose stroke is optional. */
function optionalStrokeProps(
  f: Format,
  stroke: SceneStroke | undefined,
  context: string,
): StrokeProps | Record<string, never> {
  return stroke === undefined ? {} : strokeProps(f, stroke, context);
}

/**
 * `fill` is emitted even when the primitive has none — see the polyline note.
 * The serialiser makes the same unconditional choice.
 */
function fillValue(fill: SceneFill | undefined): string {
  return fill === undefined ? "none" : fill.color;
}

function pointsValue(
  f: Format,
  points: readonly ScenePoint[],
  context: string,
): string {
  return points
    .map((p) => `${num(f, p.x, context)},${num(f, p.y, context)}`)
    .join(" ");
}

function num(f: Format, value: number, context: string): string {
  return formatNumber(value, f.precision, context);
}
