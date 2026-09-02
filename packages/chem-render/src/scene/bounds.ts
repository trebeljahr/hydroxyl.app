/**
 * The extents of a scene, in scene px.
 *
 * This is what the viewBox is cut from, so it measures the ink rather than the
 * atom positions: a stroke straddles its centreline, a circle reaches its
 * radius, a glyph run occupies its summed advance. Measuring positions alone
 * clipped half a line width off every edge of an exported figure.
 *
 * Text used to be estimated here — a flat 0.6 em per code point and a fixed
 * 0.8/0.2 ascent and descent — with the margin absorbing the error. It is now
 * measured against the vendored font's own advance table through
 * `measureTextRun`, which also models the sub- and superscript baseline shifts
 * the estimator ignored. What remains an over-estimate is deliberate: advances
 * rather than ink boxes, so there are no side bearings and a figure gets a
 * fraction of a px of extra whitespace rather than a clipped glyph.
 */

import type { RenderStyle } from "../style.js";
import { measurerFor, measureTextRun, textRunRect } from "../text/measurer.js";
import type {
  SceneBounds,
  ScenePoint,
  ScenePrimitive,
  SceneStroke,
  TextRunPrimitive,
} from "./types.js";

/**
 * Half the smallest box `sceneBounds` will hand back on either axis.
 *
 * An SVG whose viewBox width or height is zero is not rendered at all — the
 * spec makes a zero-size viewport disable the element rather than clip it — so
 * a collapsed box is not a small figure, it is a blank one. The margin
 * normally supplies the size, but `marginPx` is a style field a caller may set
 * to 0, and an empty canvas is the very first thing the editor draws.
 */
const MINIMUM_HALF_EXTENT_PX = 0.5;

/** Mutable accumulator; a scene can hold thousands of primitives. */
interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  empty: boolean;
}

/**
 * Union of the real extents of `primitives`, grown by `style.marginPx` on all
 * four sides. Groups recurse.
 *
 * An empty primitive list yields a zero-size box at the origin grown by the
 * margin, so the viewBox stays valid for an empty canvas.
 */
export function sceneBounds(
  primitives: readonly ScenePrimitive[],
  style: RenderStyle,
): SceneBounds {
  const extent: Extent = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    empty: true,
  };

  for (const primitive of primitives) accumulate(primitive, style, extent);

  // A primitive list that measured to nothing — no primitives at all, or only
  // ones with no geometry (an empty text run, a path with no numbers) —
  // collapses to the origin. The margin is normally what gives the empty
  // canvas its size; `nonDegenerate` below covers the case where the style
  // has no margin to give.
  const box = extent.empty
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : { minX: extent.minX, minY: extent.minY, maxX: extent.maxX, maxY: extent.maxY };

  const m = style.marginPx;
  return nonDegenerate({
    minX: box.minX - m,
    minY: box.minY - m,
    maxX: box.maxX + m,
    maxY: box.maxY + m,
  });
}

/**
 * Opens a collapsed axis out around its own centre and computes the extents.
 *
 * Fires only where an axis has genuinely measured to nothing — an empty canvas
 * under a zero-margin style, a lone zero-radius point, a perfectly horizontal
 * hairline. Any style with a margin is untouched, so this cannot move an
 * ordinary figure by a pixel.
 */
function nonDegenerate(box: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): SceneBounds {
  let { minX, minY, maxX, maxY } = box;
  if (maxX - minX <= 0) {
    const centre = (minX + maxX) / 2;
    minX = centre - MINIMUM_HALF_EXTENT_PX;
    maxX = centre + MINIMUM_HALF_EXTENT_PX;
  }
  if (maxY - minY <= 0) {
    const centre = (minY + maxY) / 2;
    minY = centre - MINIMUM_HALF_EXTENT_PX;
    maxY = centre + MINIMUM_HALF_EXTENT_PX;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function accumulate(
  primitive: ScenePrimitive,
  style: RenderStyle,
  extent: Extent,
): void {
  switch (primitive.type) {
    case "line": {
      const pad = halfWidth(primitive.stroke);
      addPoint(extent, primitive.a, pad);
      addPoint(extent, primitive.b, pad);
      return;
    }
    case "polyline":
    case "polygon": {
      const pad = halfWidth(primitive.stroke);
      for (const point of primitive.points) addPoint(extent, point, pad);
      return;
    }
    case "circle": {
      addPoint(
        extent,
        primitive.centre,
        primitive.radius + halfWidth(primitive.stroke),
      );
      return;
    }
    case "path": {
      const pad = halfWidth(primitive.stroke);
      for (const point of pathPoints(primitive.d)) addPoint(extent, point, pad);
      return;
    }
    case "textRun": {
      addTextRun(extent, primitive, style);
      return;
    }
    case "group": {
      for (const child of primitive.children) accumulate(child, style, extent);
      return;
    }
  }
}

/**
 * A stroke straddles its centreline, so it reaches half its width past the
 * geometry on every side. Caps and joins can push a little further still — a
 * mitre on a sharp corner most of all — which the margin covers; the point
 * here is not to clip the obvious half-width.
 */
function halfWidth(stroke: SceneStroke | undefined): number {
  return stroke === undefined ? 0 : stroke.width / 2;
}

function addPoint(extent: Extent, p: ScenePoint, pad: number): void {
  addBox(extent, p.x - pad, p.y - pad, p.x + pad, p.y + pad);
}

function addBox(
  extent: Extent,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) return;
  if (minX < extent.minX) extent.minX = minX;
  if (minY < extent.minY) extent.minY = minY;
  if (maxX > extent.maxX) extent.maxX = maxX;
  if (maxY > extent.maxY) extent.maxY = maxY;
  extent.empty = false;
}

/**
 * Every coordinate pair that appears in a path's `d`, approximately.
 *
 * This deliberately does not parse SVG path grammar. It pulls the numbers out
 * in order and reads them as x,y pairs, which is exact for M/L/T and for the
 * on-curve endpoints of C/Q, and treats Bézier control points as if they were
 * on the curve — an over-estimate, since a curve stays inside the hull of its
 * control points. Over-estimating is the safe direction: a figure gets a few
 * px of extra whitespace, never a clipped edge.
 *
 * The one shape it gets wrong is an elliptical arc, whose seven parameters do
 * not pair up as coordinates (the rotation and the two flags land in the
 * stream). Arcs are not emitted by this package; if one ever is, measure it
 * properly here rather than trusting this.
 */
function pathPoints(d: string): ScenePoint[] {
  const numbers = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (numbers === null) return [];
  const points: ScenePoint[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = Number(numbers[i]);
    const y = Number(numbers[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  return points;
}

/**
 * The ink box of a glyph run, measured rather than estimated.
 *
 * Width is the summed advance of the spans at their real sizes (scripts at
 * `style.subscriptScale`), placed relative to the origin by `anchor`. Height
 * runs from the highest ascender to the deepest descender WITH the script
 * shifts applied, placed by `baseline`.
 *
 * A run whose spans are all empty measures zero wide and contributes nothing —
 * the guard is what keeps an empty canvas collapsing to the origin so
 * `nonDegenerate` can open it out, rather than being handed a sliver of a box
 * around nothing.
 *
 * An all-superscript run legitimately measures a NEGATIVE descent: its lowest
 * ink is still above the baseline. `addBox` is componentwise min/max and
 * copes; clamping it to zero would re-inflate the box of every charged label.
 */
function addTextRun(
  extent: Extent,
  run: TextRunPrimitive,
  style: RenderStyle,
): void {
  const box = measureTextRun(
    run.spans,
    {
      fontFamily: run.fontFamily,
      fontSizePx: run.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: run.anchor,
      baseline: run.baseline,
    },
    measurerFor(style),
  );
  if (box.advanceWidthPx === 0) return;

  const rect = textRunRect(box, run.origin);
  addBox(extent, rect.minX, rect.minY, rect.maxX, rect.maxY);
}
