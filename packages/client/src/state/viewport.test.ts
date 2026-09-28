import type { Vec2 } from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import {
  clampZoom,
  createViewport,
  DEFAULT_FIT_MARGIN,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  rescaleScene,
  setViewportSize,
  setZoom,
  toModel,
  toScreen,
  visibleBounds,
  type Viewport,
  type ViewportSize,
  zoomAt,
  zoomToFit,
} from "./viewport";

/** Builds a viewport directly, so a test of one function does not depend on
 *  another one being correct first. */
function makeViewport(pan: Vec2, zoom: number, size: ViewportSize): Viewport {
  return { pan, zoom, size };
}

const ZOOMS = [MIN_ZOOM, 0.25, 1, 3.7, MAX_ZOOM];
const PANS: Vec2[] = [
  { x: 0, y: 0 },
  { x: 12.5, y: -40 },
  { x: -333.25, y: 901.75 },
];
const SIZES: ViewportSize[] = [
  { width: 800, height: 600 },
  { width: 1, height: 1 },
  { width: 1920, height: 1080 },
];
const POINTS: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: -1 },
  { x: 250.5, y: -732.25 },
  { x: -1000, y: 1000 },
];

describe("createViewport", () => {
  it("starts centred on the origin at 1:1", () => {
    const vp = createViewport({ width: 640, height: 480 });
    expect(vp.pan).toEqual({ x: 0, y: 0 });
    expect(vp.zoom).toBe(1);
    expect(vp.size).toEqual({ width: 640, height: 480 });
  });

  it("folds a NaN or negative measurement to zero", () => {
    expect(createViewport({ width: Number.NaN, height: -10 }).size).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("toScreen / toModel", () => {
  it("round trips in both directions across zooms, pans and sizes", () => {
    for (const zoom of ZOOMS) {
      for (const pan of PANS) {
        for (const size of SIZES) {
          const vp = makeViewport(pan, zoom, size);
          for (const p of POINTS) {
            const back = toModel(vp, toScreen(vp, p));
            expect(back.x).toBeCloseTo(p.x, 9);
            expect(back.y).toBeCloseTo(p.y, 9);

            const forward = toScreen(vp, toModel(vp, p));
            expect(forward.x).toBeCloseTo(p.x, 9);
            expect(forward.y).toBeCloseTo(p.y, 9);
          }
        }
      }
    }
  });

  it("puts the pan point at the viewport centre", () => {
    const vp = makeViewport({ x: 40, y: -70 }, 2.5, { width: 800, height: 600 });
    expect(toScreen(vp, vp.pan)).toEqual({ x: 400, y: 300 });
  });

  it("never negates an axis: +y in the scene is +y on screen", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 2, { width: 800, height: 600 });
    const lower = toScreen(vp, { x: 0, y: 0 });
    const higher = toScreen(vp, { x: 0, y: 10 });
    expect(higher.y).toBeGreaterThan(lower.y);
    const right = toScreen(vp, { x: 10, y: 0 });
    expect(right.x).toBeGreaterThan(lower.x);
  });

  it("stays finite for a zero-size viewport", () => {
    const vp = makeViewport({ x: 5, y: 5 }, 1, { width: 0, height: 0 });
    const s = toScreen(vp, { x: 12, y: -3 });
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    const m = toModel(vp, s);
    expect(m.x).toBeCloseTo(12, 9);
    expect(m.y).toBeCloseTo(-3, 9);
  });
});

describe("clampZoom", () => {
  it("clamps to the limits and passes values through in between", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1e6)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM);
    expect(clampZoom(3.7)).toBe(3.7);
  });

  it("falls back to 1 for NaN rather than propagating it", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("panBy", () => {
  it("moves the pan point by the screen delta scaled into scene units", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 2, { width: 800, height: 600 });
    const moved = panBy(vp, { x: 100, y: -50 });
    expect(moved.pan).toEqual({ x: 50, y: -25 });
    expect(moved.zoom).toBe(2);
  });

  it("returns the same viewport for a zero or non-finite delta", () => {
    const vp = makeViewport({ x: 3, y: 4 }, 1, { width: 800, height: 600 });
    expect(panBy(vp, { x: 0, y: 0 })).toBe(vp);
    expect(panBy(vp, { x: Number.NaN, y: 0 })).toBe(vp);
  });
});

describe("setZoom", () => {
  it("keeps the centre pinned", () => {
    const vp = makeViewport({ x: 17, y: -3 }, 1, { width: 800, height: 600 });
    const zoomed = setZoom(vp, 8);
    expect(zoomed.pan).toEqual(vp.pan);
    expect(toScreen(zoomed, vp.pan)).toEqual({ x: 400, y: 300 });
  });

  it("returns the input when the clamped zoom is unchanged", () => {
    const vp = makeViewport({ x: 0, y: 0 }, MAX_ZOOM, { width: 800, height: 600 });
    expect(setZoom(vp, 1000)).toBe(vp);
  });
});

describe("zoomAt", () => {
  it("keeps the screen anchor pinned to the same scene point", () => {
    const anchors: Vec2[] = [
      { x: 0, y: 0 },
      { x: 400, y: 300 },
      { x: 799, y: 12.5 },
    ];
    for (const zoom of [0.25, 1, 3.7]) {
      for (const factor of [1.1, 0.5, 4]) {
        for (const anchor of anchors) {
          const vp = makeViewport({ x: -20, y: 60 }, zoom, { width: 800, height: 600 });
          const before = toModel(vp, anchor);
          const after = zoomAt(vp, anchor, factor);
          const stillThere = toScreen(after, before);
          expect(stillThere.x).toBeCloseTo(anchor.x, 8);
          expect(stillThere.y).toBeCloseTo(anchor.y, 8);
        }
      }
    }
  });

  it("pins the anchor even when the clamp truncates the factor", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 32, { width: 800, height: 600 });
    const anchor = { x: 100, y: 500 };
    const before = toModel(vp, anchor);
    const after = zoomAt(vp, anchor, 1000);
    expect(after.zoom).toBe(MAX_ZOOM);
    const stillThere = toScreen(after, before);
    expect(stillThere.x).toBeCloseTo(anchor.x, 8);
    expect(stillThere.y).toBeCloseTo(anchor.y, 8);
  });

  it("ignores a non-positive or non-finite factor", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
    expect(zoomAt(vp, { x: 0, y: 0 }, 0)).toBe(vp);
    expect(zoomAt(vp, { x: 0, y: 0 }, -2)).toBe(vp);
    expect(zoomAt(vp, { x: 0, y: 0 }, Number.NaN)).toBe(vp);
    expect(zoomAt(vp, { x: Number.NaN, y: 0 }, 2)).toBe(vp);
  });

  it("stays finite on a zero-size viewport", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 0, height: 0 });
    const after = zoomAt(vp, { x: 0, y: 0 }, 2);
    expect(Number.isFinite(after.pan.x)).toBe(true);
    expect(Number.isFinite(after.pan.y)).toBe(true);
    expect(after.zoom).toBe(2);
  });
});

describe("rescaleScene", () => {
  // Screen -> Publication and back: the two factors a style switch hands in.
  const FACTORS = [24 / 44, 44 / 24];

  it("paints every point of the redrawn scene on the pixel it had before", () => {
    for (const factor of FACTORS) {
      for (const size of SIZES) {
        for (const pan of PANS) {
          for (const zoom of [0.25, 1, 3.7]) {
            const vp = makeViewport(pan, zoom, size);
            const next = rescaleScene(vp, factor);
            for (const p of POINTS) {
              const before = toScreen(vp, p);
              const after = toScreen(next, { x: p.x * factor, y: p.y * factor });
              expect(after.x).toBeCloseTo(before.x, 6);
              expect(after.y).toBeCloseTo(before.y, 6);
            }
          }
        }
      }
    }
  });

  it("undoes itself: there and back is the viewport it started from", () => {
    const vp = makeViewport({ x: -333.25, y: 901.75 }, 3.7, { width: 800, height: 600 });
    const back = rescaleScene(rescaleScene(vp, 24 / 44), 44 / 24);
    expect(back.zoom).toBeCloseTo(vp.zoom, 12);
    expect(back.pan.x).toBeCloseTo(vp.pan.x, 9);
    expect(back.pan.y).toBeCloseTo(vp.pan.y, 9);
    expect(back.size).toEqual(vp.size);
  });

  it("returns the input for a factor of 1, and ignores one that is not a size", () => {
    const vp = makeViewport({ x: 12.5, y: -40 }, 2, { width: 800, height: 600 });
    for (const factor of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rescaleScene(vp, factor)).toBe(vp);
    }
  });

  it("stays inside the zoom limits, and keeps the centre where it was", () => {
    // At MAX_ZOOM a Publication scene would need 44/24 of the limit to keep
    // its size. It changes size instead, and the scene point at the centre of
    // the view stays at the centre.
    const vp = makeViewport({ x: 44, y: -88 }, MAX_ZOOM, { width: 800, height: 600 });
    const next = rescaleScene(vp, 24 / 44);
    expect(next.zoom).toBe(MAX_ZOOM);
    expect(toScreen(next, { x: 24, y: -48 })).toEqual({ x: 400, y: 300 });
  });
});

describe("setViewportSize", () => {
  it("keeps pan and zoom so the centre survives a resize", () => {
    const vp = makeViewport({ x: 11, y: 22 }, 3, { width: 800, height: 600 });
    const resized = setViewportSize(vp, { width: 400, height: 1200 });
    expect(resized.pan).toEqual(vp.pan);
    expect(resized.zoom).toBe(3);
    expect(toScreen(resized, vp.pan)).toEqual({ x: 200, y: 600 });
  });

  it("returns the input when nothing changed", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
    expect(setViewportSize(vp, { width: 800, height: 600 })).toBe(vp);
  });
});

describe("zoomToFit", () => {
  it("centres the bounds", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
    const fitted = zoomToFit(vp, { min: { x: -100, y: 40 }, max: { x: 300, y: 140 } });
    expect(fitted.pan).toEqual({ x: 100, y: 90 });
    expect(toScreen(fitted, fitted.pan)).toEqual({ x: 400, y: 300 });
  });

  it("frames the bounds exactly with a zero margin", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 400, height: 200 });
    // 100 x 50 content in a 400 x 200 viewport: both axes want 4x.
    const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } };
    const fitted = zoomToFit(vp, bounds, 0);
    expect(fitted.zoom).toBe(4);
    const visible = visibleBounds(fitted);
    expect(visible.min.x).toBeCloseTo(bounds.min.x, 9);
    expect(visible.min.y).toBeCloseTo(bounds.min.y, 9);
    expect(visible.max.x).toBeCloseTo(bounds.max.x, 9);
    expect(visible.max.y).toBeCloseTo(bounds.max.y, 9);
  });

  it("fits the constraining axis and leaves the content inside the view", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 400, height: 400 });
    // Wide and short: width is the binding constraint.
    const bounds = { min: { x: -50, y: -1 }, max: { x: 50, y: 1 } };
    const fitted = zoomToFit(vp, bounds, 0);
    expect(fitted.zoom).toBe(4);
    const visible = visibleBounds(fitted);
    expect(visible.min.x).toBeLessThanOrEqual(bounds.min.x + 1e-9);
    expect(visible.max.x).toBeGreaterThanOrEqual(bounds.max.x - 1e-9);
    expect(visible.min.y).toBeLessThan(bounds.min.y);
    expect(visible.max.y).toBeGreaterThan(bounds.max.y);
  });

  it("leaves the margin fraction empty on each side", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 400, height: 400 });
    const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
    const fitted = zoomToFit(vp, bounds, 0.1);
    // 400 * (1 - 0.2) = 320 px of room for 100 units of content.
    expect(fitted.zoom).toBeCloseTo(3.2, 9);
    expect(DEFAULT_FIT_MARGIN).toBeGreaterThan(0);
  });

  it("recentres without NaN on zero-area bounds (a single atom)", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 2, { width: 800, height: 600 });
    const point = { x: 42, y: -7 };
    const fitted = zoomToFit(vp, { min: point, max: point });
    expect(fitted.zoom).toBe(2);
    expect(fitted.pan).toEqual(point);
    expect(Number.isFinite(fitted.zoom)).toBe(true);
  });

  it("recentres without NaN on a zero-size viewport", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1.5, { width: 0, height: 0 });
    const fitted = zoomToFit(vp, { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } });
    expect(fitted.zoom).toBe(1.5);
    expect(fitted.pan).toEqual({ x: 0, y: 0 });
    const visible = visibleBounds(fitted);
    expect(Number.isFinite(visible.min.x)).toBe(true);
    expect(Number.isFinite(visible.max.y)).toBe(true);
  });

  it("clamps a fit that would exceed the zoom limits", () => {
    const vp = makeViewport({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
    const huge = zoomToFit(vp, { min: { x: -1e9, y: -1e9 }, max: { x: 1e9, y: 1e9 } }, 0);
    expect(huge.zoom).toBe(MIN_ZOOM);
    const tiny = zoomToFit(vp, { min: { x: 0, y: 0 }, max: { x: 1e-9, y: 1e-9 } }, 0);
    expect(tiny.zoom).toBe(MAX_ZOOM);
  });

  it("ignores non-finite bounds", () => {
    const vp = makeViewport({ x: 1, y: 2 }, 1, { width: 800, height: 600 });
    expect(
      zoomToFit(vp, { min: { x: Number.NaN, y: 0 }, max: { x: 1, y: 1 } }),
    ).toBe(vp);
  });
});

describe("visibleBounds", () => {
  it("is the inverse of the corner mapping", () => {
    const vp = makeViewport({ x: -12, y: 34 }, 2.5, { width: 800, height: 600 });
    const visible = visibleBounds(vp);
    const topLeft = toModel(vp, { x: 0, y: 0 });
    const bottomRight = toModel(vp, { x: 800, y: 600 });
    expect(visible.min.x).toBeCloseTo(topLeft.x, 9);
    expect(visible.min.y).toBeCloseTo(topLeft.y, 9);
    expect(visible.max.x).toBeCloseTo(bottomRight.x, 9);
    expect(visible.max.y).toBeCloseTo(bottomRight.y, 9);
  });

  it("collapses to the pan point for a zero-size viewport", () => {
    const vp = makeViewport({ x: 9, y: 9 }, 1, { width: 0, height: 0 });
    expect(visibleBounds(vp)).toEqual({ min: { x: 9, y: 9 }, max: { x: 9, y: 9 } });
  });
});
