/**
 * Pan and zoom for the sketch canvas.
 *
 * THIS FILE OWNS NEITHER THE Y-FLIP NOR THE MODEL-UNITS-TO-PX SCALE.
 *
 * chem-core coordinates are y-up in abstract bond-length units. Turning those
 * into pixels — picking a bond length in px for a style preset, and flipping y
 * so it grows downwards the way a screen does — is `RenderStyle`'s job over in
 * chem-render. A scene therefore arrives here ALREADY IN PIXELS with y ALREADY
 * FLIPPED, and everything below is a plain uniform affine map inside that
 * space. Consequently NO AXIS IS NEGATED ANYWHERE IN THIS FILE: x and y are
 * treated identically, and `min.y < max.y` still means "higher on the screen".
 *
 * If a wedge ever comes out on the wrong side or a structure renders
 * upside-down, the bug is in chem-render's style, not here. Adding a second
 * flip here to compensate would make the two layers disagree about which
 * direction "up" is, and every hit test would be right only by accident.
 *
 * That invariant is single-site and checkable: `modelToPx` in
 * chem-render/src/style.ts is the only function in the repo that scales or
 * negates. A later layer that has to cross back — a pointer position in px
 * becoming an atom position in model units — goes through chem-render's
 * `pxToModel`, and a pointer DISPLACEMENT goes through it too: it is linear,
 * so the y-negation factors out of a difference rather than cancelling in it.
 * `pxPerModelUnit(style)` alone is for SCALARS — a tolerance, a grab radius.
 * Note that `toModel` below is AFFINE and must NOT be applied to a delta: its
 * translation would be added once too often. Divide a delta by the zoom.
 * Nothing in this file needs any of it: this module never leaves px.
 *
 * The convention, which the rest of the app may rely on:
 *
 *   toScreen(vp, p) = { x: (p.x - pan.x) * zoom + width / 2,
 *                       y: (p.y - pan.y) * zoom + height / 2 }
 *
 * i.e. `pan` is the scene point (in px) sitting at the centre of the viewport.
 * Centre-anchored rather than corner-anchored because a resize then keeps the
 * structure the user is looking at in view instead of pinning the top-left
 * corner of an empty canvas.
 *
 * Pure functions over an immutable `Viewport`, in the house style: an edit
 * returns a new value, and a no-op returns the input by reference so memoised
 * renders downstream are not invalidated for nothing.
 */

import type { Vec2 } from "@starter/chem-core";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  /** The scene point (px) sitting at the viewport centre. */
  readonly pan: Vec2;
  readonly zoom: number;
  readonly size: ViewportSize;
}

export interface Bounds {
  readonly min: Vec2;
  readonly max: Vec2;
}

/**
 * Zoom limits. 0.05 still shows a 20x-wider-than-screen reaction scheme;
 * 64 is roughly "one bond fills the canvas", past which there is nothing left
 * to look at. They are also what keeps `toModel` free of a division by zero.
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

/**
 * A viewport created before the canvas element has been measured still has to
 * produce usable numbers — a zero size would make `zoomToFit` degenerate on
 * the very first document load, which is exactly when it is called. 800x600 is
 * a placeholder that the first ResizeObserver callback overwrites.
 */
export const DEFAULT_VIEWPORT_SIZE: ViewportSize = { width: 800, height: 600 };

/** Fraction of the viewport left empty on each side by `zoomToFit`. */
export const DEFAULT_FIT_MARGIN = 0.05;

function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/**
 * A DOM measurement can legitimately be 0 (a hidden panel) and, during a
 * teardown, NaN. Both are folded to 0 here so that every consumer only has to
 * handle the one degenerate case, and none of them has to handle NaN.
 */
function normalizeSize(size: ViewportSize): ViewportSize {
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 0;
  const height =
    Number.isFinite(size.height) && size.height > 0 ? size.height : 0;
  return { width, height };
}

export function createViewport(size: ViewportSize = DEFAULT_VIEWPORT_SIZE): Viewport {
  return { pan: { x: 0, y: 0 }, zoom: 1, size: normalizeSize(size) };
}

export function toScreen(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - vp.pan.x) * vp.zoom + vp.size.width / 2,
    y: (p.y - vp.pan.y) * vp.zoom + vp.size.height / 2,
  };
}

export function toModel(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - vp.size.width / 2) / vp.zoom + vp.pan.x,
    y: (p.y - vp.size.height / 2) / vp.zoom + vp.pan.y,
  };
}

/**
 * NaN needs its own branch: `Math.min`/`Math.max` propagate it, and a NaN zoom
 * poisons every coordinate on the canvas at once with no way back. Infinities
 * do clamp correctly, so only NaN is special-cased, and it falls back to 1
 * rather than to a limit — "I have no idea" reads better as 100% than as the
 * most extreme zoom available.
 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Moves the VIEWPORT by `deltaScreen` pixels; the scene therefore appears to
 * move the opposite way.
 *
 * A grab-drag handler passes the negated pointer delta. That negation lives at
 * the gesture, not here, so this file stays a pure affine map with no sign
 * conventions of its own to remember.
 */
export function panBy(vp: Viewport, deltaScreen: Vec2): Viewport {
  if (!isFiniteVec(deltaScreen)) return vp;
  if (deltaScreen.x === 0 && deltaScreen.y === 0) return vp;
  return {
    ...vp,
    pan: {
      x: vp.pan.x + deltaScreen.x / vp.zoom,
      y: vp.pan.y + deltaScreen.y / vp.zoom,
    },
  };
}

/** Zooms about the viewport centre, which is `pan` by definition — so `pan`
 *  is unchanged and nothing appears to slide sideways. */
export function setZoom(vp: Viewport, zoom: number): Viewport {
  const next = clampZoom(zoom);
  if (next === vp.zoom) return vp;
  return { ...vp, zoom: next };
}

/**
 * Scales by `factor` while keeping the scene point currently under
 * `screenAnchor` pinned to that same screen pixel — wheel-zoom under the
 * cursor, and pinch-zoom about the pinch centre.
 *
 * Solving `toScreen(vp', anchorModel) === screenAnchor` for the new pan gives
 * `pan' = anchorModel - (screenAnchor - size/2) / zoom'`. Doing it this way
 * rather than nudging the pan by a delta means the anchor stays pinned exactly
 * even when the clamp truncates the requested factor.
 */
export function zoomAt(vp: Viewport, screenAnchor: Vec2, factor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return vp;
  if (!isFiniteVec(screenAnchor)) return vp;

  const zoom = clampZoom(vp.zoom * factor);
  if (zoom === vp.zoom) return vp;

  const anchorModel = toModel(vp, screenAnchor);
  return {
    ...vp,
    zoom,
    pan: {
      x: anchorModel.x - (screenAnchor.x - vp.size.width / 2) / zoom,
      y: anchorModel.y - (screenAnchor.y - vp.size.height / 2) / zoom,
    },
  };
}

/**
 * A resize keeps `pan` and `zoom`, so the scene point at the centre stays at
 * the centre and the canvas grows outwards from what the user was looking at.
 */
export function setViewportSize(vp: Viewport, size: ViewportSize): Viewport {
  const next = normalizeSize(size);
  if (next.width === vp.size.width && next.height === vp.size.height) return vp;
  return { ...vp, size: next };
}

/**
 * Frames `bounds`, centred, with `margin` of the viewport left empty on each
 * side.
 *
 * Every degenerate input recentres without touching the zoom rather than
 * producing NaN or Infinity:
 *
 * - a single atom (zero-area bounds) has no finite scale that "fits" it;
 * - a zero-size viewport (an unmeasured or hidden canvas) has no room to fit
 *   anything into, and its size will be corrected a frame later anyway.
 *
 * Keeping the current zoom in both cases means "fit" on an empty document
 * centres the origin instead of blanking the canvas at some extreme scale.
 */
export function zoomToFit(
  vp: Viewport,
  bounds: Bounds,
  margin: number = DEFAULT_FIT_MARGIN,
): Viewport {
  if (!isFiniteVec(bounds.min) || !isFiniteVec(bounds.max)) return vp;

  // Clamped below 0.5 because a margin of half the viewport per side leaves
  // nothing to draw in.
  const m = Number.isFinite(margin)
    ? Math.min(Math.max(margin, 0), 0.45)
    : DEFAULT_FIT_MARGIN;

  // `abs` so an inverted box (max before min) frames the same region rather
  // than inverting the zoom.
  const contentWidth = Math.abs(bounds.max.x - bounds.min.x);
  const contentHeight = Math.abs(bounds.max.y - bounds.min.y);
  const availableWidth = vp.size.width * (1 - 2 * m);
  const availableHeight = vp.size.height * (1 - 2 * m);

  const scales: number[] = [];
  if (contentWidth > 0 && availableWidth > 0) {
    scales.push(availableWidth / contentWidth);
  }
  if (contentHeight > 0 && availableHeight > 0) {
    scales.push(availableHeight / contentHeight);
  }

  // The smaller scale wins: it is the axis that would otherwise overflow.
  const zoom = scales.length === 0 ? vp.zoom : clampZoom(Math.min(...scales));

  return {
    ...vp,
    zoom,
    pan: {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
    },
  };
}

/**
 * The scene rectangle currently on screen, in px.
 *
 * `min` is top-left in screen terms as well as numerically smallest, because
 * y is not flipped here — see the header. Safe from division by zero: every
 * constructor and setter routes zoom through `clampZoom`.
 */
export function visibleBounds(vp: Viewport): Bounds {
  const halfWidth = vp.size.width / (2 * vp.zoom);
  const halfHeight = vp.size.height / (2 * vp.zoom);
  return {
    min: { x: vp.pan.x - halfWidth, y: vp.pan.y - halfHeight },
    max: { x: vp.pan.x + halfWidth, y: vp.pan.y + halfHeight },
  };
}
