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

import type { RenderScene } from "../scene/types.js";
import { attr, emitPrimitive, num, push } from "./emit.js";
import type { Emitter } from "./emit.js";

// Re-exported so the package's public number and escape helpers keep their
// home here; the implementations moved to emit.ts with the rest of the
// emitter.
export { escapeAttr, escapeText, formatNumber } from "./emit.js";

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
    idPrefix: "",
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
