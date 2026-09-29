/**
 * Picking: turning a pointer position on the canvas into an atom or a bond.
 *
 * THE COORDINATE CHAIN, in full, because it is the single thing most likely to
 * be got wrong by whoever touches this next:
 *
 *     canvas-local px  --toModel(viewport, .)-->  scene px (y-down)
 *     scene px         --pxToModel(style, .)  -->  model units (y-up)
 *
 * Two steps, and only the second one touches the scale or the sign.
 *
 * The first step is the viewport's own inverse — `toModel` from @/state. Note
 * that what the VIEWPORT calls "model" space IS scene px: pan and zoom are a
 * plain uniform affine map inside the already-flipped, already-scaled px space
 * that `buildScene` emitted, and viewport.ts negates no axis anywhere. Its
 * `toModel` therefore undoes pan and zoom and nothing else.
 *
 * The second step is `pxToModel` from chem-render, the exact inverse of
 * `modelToPx`: divide by `bondLengthPx`, negate y. That is where px become
 * bond lengths and where y-down becomes y-up again. chem-render owns both
 * halves of that conversion and nothing here may reimplement either — a second
 * opinion about which way is up gives you a structure that draws correctly and
 * hit-tests mirrored, and the symptom points nowhere near the cause.
 *
 * THE TOLERANCE IS CONVERTED EXACTLY ONCE, here. A grab radius is quoted in
 * SCREEN px — 6px is what a finger or a mouse can reliably land on, whatever
 * the zoom — and reaches `hitTest` in model units after dividing by BOTH the
 * zoom and the px-per-model-unit, because both stand between a screen pixel
 * and a bond length. That division is what keeps pick targets the same size on
 * screen at every zoom level, which is the property the header of
 * chem-core/src/hit.ts spells out and depends on. Passing pixels into
 * `hitTest` would invert it exactly: targets would grow as you zoomed in until
 * a carbon swallowed the bonds around it.
 *
 * The atom's own radius is NOT converted here and does not scale with zoom.
 * It comes from `SceneIndex.labelRadius` already in model units, because a
 * glyph is a fixed size in the drawing — zooming in shows you a bigger picture
 * of the same molecule, not a molecule with bigger labels.
 */

import { NO_HIT, hitTest } from "@starter/chem-core";
import type { Hit, Molecule, Vec2 } from "@starter/chem-core";
import { pxPerModelUnit, pxToModel } from "@starter/chem-render";

// Straight from the viewport module, NOT from the `@/state` barrel. The barrel
// re-exports `./store`, which imports React, calls `setAutoFreeze(false)` at
// module scope and constructs the application-wide store singleton eagerly — so
// a value import of the barrel would drag all three into this file merely by
// being imported. This module, and the note in canvas/index.ts promising a
// headless caller can reach for it directly, both depend on that not happening.
// `state/index.ts` describes exactly this split: `./viewport` is the
// framework-free half.
import { toModel } from "@/state/viewport";
import type { Viewport } from "@/state/viewport";

import type { SceneIndex } from "./metrics";

/**
 * The grab radius, in SCREEN px.
 *
 * 6 is about a mouse's worth of slack: at the screen preset's 44px bond and
 * zoom 1 it works out to 0.14 bond lengths, close to chem-core's own
 * `DEFAULT_ATOM_TOLERANCE` of 0.12, so the middle of every bond stays
 * clickable at the default zoom.
 */
export const DEFAULT_PICK_TOLERANCE_PX = 6;

export interface PickContext {
  readonly molecule: Molecule;
  readonly viewport: Viewport;
  readonly index: SceneIndex;
}

/** Canvas-local px -> model units. Both steps of the chain in the header. */
export function canvasPointToModel(ctx: PickContext, canvasPoint: Vec2): Vec2 {
  return pxToModel(ctx.index.scene.style, toModel(ctx.viewport, canvasPoint));
}

/**
 * What is under `canvasPoint`, with atoms beating bonds where both qualify.
 *
 * `tolerancePx` is in screen px and is converted once, below.
 */
export function pickAt(
  ctx: PickContext,
  canvasPoint: Vec2,
  tolerancePx: number = DEFAULT_PICK_TOLERANCE_PX,
): Hit {
  // A pointer event arriving during teardown — an element already unmounted,
  // a bounding rect measured on a detached node — yields NaN coordinates. NaN
  // poisons every comparison in `hitTest` silently rather than throwing, and
  // the result is a canvas that stops responding with nothing in the console.
  // Refusing to pick is the honest answer to "where is a point that is
  // nowhere".
  if (!isFiniteVec(canvasPoint)) return NO_HIT;

  const style = ctx.index.scene.style;

  // Screen px per model unit. `zoom` is already clamped away from 0 by the
  // store (`clampZoom`, MIN_ZOOM 0.05) and `bondLengthPx` comes from a frozen
  // preset, so this is belt and braces — but a zero here would divide the
  // tolerance into Infinity and make the entire molecule one hit target.
  const screenPxPerModelUnit = ctx.viewport.zoom * pxPerModelUnit(style);
  if (!Number.isFinite(screenPxPerModelUnit) || screenPxPerModelUnit <= 0) {
    return NO_HIT;
  }

  const point = canvasPointToModel(ctx, canvasPoint);
  if (!isFiniteVec(point)) return NO_HIT;

  // Clamped at 0 rather than trusted: a negative tolerance would not fail, it
  // would quietly shrink every pick target inside its own glyph.
  const grabPx = Number.isFinite(tolerancePx)
    ? Math.max(tolerancePx, 0)
    : DEFAULT_PICK_TOLERANCE_PX;
  const tolerance = grabPx / screenPxPerModelUnit;

  return hitTest(ctx.molecule, point, {
    // Wrapped rather than passed as a bare method reference: `labelRadius` is
    // a closure on the index today, but handing a method to a callback slot
    // strips its receiver, and an index that ever becomes a class would fail
    // at run time with a `this` error deep inside chem-core.
    labelRadius: (atomId) => ctx.index.labelRadius(atomId),
    // What the renderer inked of each bond, so the middle of a stub cut short
    // by a big label stays the bond's to click (decision 198).
    drawnSpan: (bondId) => ctx.index.drawnSpan(bondId),
    // The SAME converted tolerance to both. They are one grab radius expressed
    // once; letting them drift would mean a click that misses an atom by a
    // pixel could still fail to reach the bond directly under it.
    atomTolerance: tolerance,
    bondTolerance: tolerance,
  });
}

function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}
