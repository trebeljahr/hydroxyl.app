/**
 * Where an `(R)`, `(S)`, `(E)` or `(Z)` goes.
 *
 * A descriptor is an annotation rather than part of the structure, so its
 * placement problem is the opposite of an atom label's: the label has to sit
 * ON the atom and everything else moves out of its way, while the descriptor
 * has to find the space nothing else wanted. It therefore gets no clear space
 * of its own, is never trimmed against, and never displaces a bond — it only
 * looks for a hole.
 *
 * THE SEARCH IS A FIXED LADDER, NOT AN OPTIMISATION. Eight compass directions
 * tried in a deterministic order, each at a small ladder of radii, and the
 * first that clears everything wins. No float sort decides anything: two
 * candidates that tie on clearance are separated by their position in the
 * fixed order, which is the same discipline `beatsOnTieBreak` in placement.ts
 * follows and for the same reason — `bondsAt` order changes when a fragment is
 * pasted or a file round-trips, and an annotation that moved on either of
 * those would put a spurious diff into an exported figure nobody edited.
 *
 * The preferred direction is the atom's own `freeDirection` — the emptiest
 * place around it, already computed by the label pass — so on an ordinary
 * zig-zag the descriptor lands where the hydrogen would have, opposite the
 * bonds. For a bond descriptor there is no such thing, and the perpendicular
 * to the bond is used instead.
 *
 * INPUTS ARE SCENE PX WITH Y ALREADY FLIPPED, as everywhere in this layer.
 * No `Math.atan2`, no `Math.hypot`: the eight directions are literals, the
 * diagonals built from `Math.SQRT1_2` (an exactly specified double), and the
 * only length taken is `Math.sqrt(x*x + y*y)`.
 */

import type { ScenePoint, TextSpan } from "../scene/types.js";
import type { RenderStyle } from "../style.js";
import { measurerFor, measureTextRun, textRunRect } from "../text/measurer.js";
import type { LabelBox, LabelObstacle } from "./placement.js";

export const DESCRIPTOR_PLACEMENT = Object.freeze({
  /**
   * The first radius tried, as a multiple of the descriptor's own cap height.
   *
   * Measured from the anchor to the CENTRE of the descriptor's box, so it has
   * to clear roughly half the box before it clears anything else. 1.4 puts a
   * two-glyph run just outside a bare vertex and just outside a one-letter
   * atom label; the ladder handles everything wider.
   */
  firstRadiusCapHeights: 1.4,
  /** How much further out each rung of the ladder reaches. */
  radiusStepCapHeights: 0.55,
  /** Rungs tried before giving up and taking the first candidate anyway. */
  radiusSteps: 5,
  /** Extra clear space demanded around the descriptor's measured box, px. */
  clearancePx: 1,
});

/** A drawn segment a descriptor must not lie across. */
export interface DescriptorSegment {
  readonly a: ScenePoint;
  readonly b: ScenePoint;
}

export interface DescriptorPlacement {
  /** Origin for a middle-anchored, middle-baselined text run. */
  readonly origin: ScenePoint;
  readonly fontSizePx: number;
  /** The measured box, for the caller to feed back in as an obstacle. */
  readonly box: LabelBox;
  /**
   * False when every rung of the ladder was blocked and the first candidate
   * was taken anyway.
   *
   * A descriptor is never dropped for want of space: a figure missing one
   * letter with no explanation is worse than a crowded one, and the crowding
   * is visible. The flag exists so a caller can say so.
   */
  readonly clear: boolean;
}

export interface DescriptorRequest {
  readonly text: string;
  /** Where the annotation belongs: an atom centre, or a bond's midpoint. */
  readonly anchor: ScenePoint;
  /** Unit, scene px. The direction tried first. */
  readonly preferred: ScenePoint;
  readonly style: RenderStyle;
  /** Label glyphs, drawn bond lines, and descriptors already placed. */
  readonly obstacles: readonly LabelObstacle[];
  readonly segments: readonly DescriptorSegment[];
}

const SQRT_HALF = Math.SQRT1_2;

/**
 * The eight directions, in the order they are preferred when the requested one
 * is not available.
 *
 * North first for the same reason the radical-dot cluster prefers it: it is
 * where an annotation is conventionally written and the direction least likely
 * to meet the 30-degree bonds a skeletal drawing is made of. The list is only
 * a TIE-BREAK order — candidates are actually sorted by how close they lie to
 * the caller's preferred direction, and this order decides between two that
 * are equally close.
 */
const COMPASS: readonly ScenePoint[] = Object.freeze([
  { x: 0, y: -1 },
  { x: SQRT_HALF, y: -SQRT_HALF },
  { x: 1, y: 0 },
  { x: SQRT_HALF, y: SQRT_HALF },
  { x: 0, y: 1 },
  { x: -SQRT_HALF, y: SQRT_HALF },
  { x: -1, y: 0 },
  { x: -SQRT_HALF, y: -SQRT_HALF },
]);

/**
 * Places one descriptor.
 *
 * Always returns a placement. `clear` reports whether the search found room;
 * see the field for why nothing is dropped.
 */
export function placeDescriptor(request: DescriptorRequest): DescriptorPlacement {
  const { style } = request;
  const fontSizePx = style.fontSizePx * style.stereoDescriptorScale;
  const spans: readonly TextSpan[] = [{ text: request.text }];
  const box = measureTextRun(
    spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: "middle",
      baseline: "middle",
    },
    measurerFor(style),
  );

  const step = box.capHeightPx * DESCRIPTOR_PLACEMENT.radiusStepCapHeights;
  const first = box.capHeightPx * DESCRIPTOR_PLACEMENT.firstRadiusCapHeights;
  // Half the run's own width, so a wide descriptor starts further out than a
  // narrow one instead of overlapping the thing it annotates.
  const reach = first + box.advanceWidthPx / 2;

  const directions = orderedDirections(request.preferred);
  let fallback: DescriptorPlacement | undefined;

  for (let rung = 0; rung < DESCRIPTOR_PLACEMENT.radiusSteps; rung++) {
    const radius = reach + rung * step;
    for (const direction of directions) {
      const origin: ScenePoint = {
        x: request.anchor.x + direction.x * radius,
        y: request.anchor.y + direction.y * radius,
      };
      const rect = textRunRect(box, origin);
      const padded = pad(rect, DESCRIPTOR_PLACEMENT.clearancePx);
      const candidate: DescriptorPlacement = {
        origin,
        fontSizePx,
        box: padded,
        clear: true,
      };
      if (fallback === undefined) fallback = { ...candidate, clear: false };
      if (isClear(padded, request.obstacles, request.segments)) return candidate;
    }
  }

  // Unreachable while `radiusSteps` and `COMPASS` are both non-empty; spelled
  // out rather than asserted so the type stays honest.
  return (
    fallback ?? {
      origin: request.anchor,
      fontSizePx,
      box: pad(textRunRect(box, request.anchor), DESCRIPTOR_PLACEMENT.clearancePx),
      clear: false,
    }
  );
}

/**
 * The compass directions sorted by how close they lie to `preferred`, ties
 * going to whichever comes first in `COMPASS`.
 *
 * Closeness is the dot product, which for unit vectors is the cosine of the
 * angle — no inverse trig, and monotone in exactly the right direction. The
 * sort is stable in every engine ECMAScript 2019 onwards requires, so the
 * `COMPASS` order IS the tie-break and no float comparison decides between two
 * equal candidates.
 */
function orderedDirections(preferred: ScenePoint): readonly ScenePoint[] {
  const length = Math.sqrt(preferred.x * preferred.x + preferred.y * preferred.y);
  if (length === 0) return COMPASS;
  const unit: ScenePoint = { x: preferred.x / length, y: preferred.y / length };
  return [...COMPASS].sort(
    (a, b) => b.x * unit.x + b.y * unit.y - (a.x * unit.x + a.y * unit.y),
  );
}

function pad(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  padding: number,
): LabelBox {
  return {
    minX: rect.minX - padding,
    minY: rect.minY - padding,
    maxX: rect.maxX + padding,
    maxY: rect.maxY + padding,
  };
}

function isClear(
  box: LabelBox,
  obstacles: readonly LabelObstacle[],
  segments: readonly DescriptorSegment[],
): boolean {
  for (const obstacle of obstacles) {
    if (boxMeetsObstacle(box, obstacle)) return false;
  }
  for (const segment of segments) {
    if (boxMeetsSegment(box, segment.a, segment.b)) return false;
  }
  return true;
}

function boxMeetsObstacle(box: LabelBox, obstacle: LabelObstacle): boolean {
  if (obstacle.kind === "rect") return boxesOverlap(box, obstacle.box);
  // Closest point on the box to the disc's centre, which is the exact
  // box-versus-circle test and cheaper than it looks.
  const x = clamp(obstacle.centre.x, box.minX, box.maxX);
  const y = clamp(obstacle.centre.y, box.minY, box.maxY);
  const dx = obstacle.centre.x - x;
  const dy = obstacle.centre.y - y;
  return dx * dx + dy * dy < obstacle.radius * obstacle.radius;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Does the segment meet the box: the Liang-Barsky slab clip, plus the
 * both-endpoints-inside case the slab test alone would still catch.
 *
 * Exact rather than the sampled approximation `detectCollisions` uses. That
 * one is ranking a warning list and only has to be roughly proportional; this
 * one is deciding where a glyph goes, and a sample that fell between two bond
 * lines would put the descriptor on top of one.
 */
function boxMeetsSegment(box: LabelBox, a: ScenePoint, b: ScenePoint): boolean {
  let entry = 0;
  let exit = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > exit) return false;
      if (r > entry) entry = r;
    } else {
      if (r < entry) return false;
      if (r < exit) exit = r;
    }
    return true;
  };

  if (!clip(-dx, a.x - box.minX)) return false;
  if (!clip(dx, box.maxX - a.x)) return false;
  if (!clip(-dy, a.y - box.minY)) return false;
  if (!clip(dy, box.maxY - a.y)) return false;
  return entry <= exit;
}
