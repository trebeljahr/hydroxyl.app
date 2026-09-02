/**
 * What the canvas measures off a built scene, and the two numbers everything
 * else is built on top of.
 *
 * `labelRadius` is in MODEL UNITS and `fitBounds` is in SCENE PX, and getting
 * either wrong produces a canvas that looks correct and behaves wrongly:
 * a radius left in px makes every vertex a target a hundred bond lengths
 * wide, and a fit that double-counts the preset's margin opens a fresh
 * document at half the size it should be. Neither shows up in a screenshot.
 *
 * state/viewport.test.ts already proves `zoomToFit` frames an arbitrary box.
 * What is proved here is the composition — `zoomToFit(fitBounds(scene), 0)`
 * against a real molecule's real scene — which is where the double margin
 * would live.
 */

import { DEFAULT_LABEL_RADIUS, benzene } from "@starter/chem-core";
import {
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  bromomethane,
  buildScene,
  ethanol,
  iodomethane,
  modelToPx,
  pxPerModelUnit,
  representation,
  sceneBounds,
  withStyle,
} from "@starter/chem-render";
import type { RenderScene, RenderStyle } from "@starter/chem-render";
import { describe, expect, it } from "vitest";

import { createViewport, toScreen, zoomToFit } from "@/state";
import type { Viewport } from "@/state";

import { createSceneIndex, fitBounds } from "./metrics";

const MOL = benzene();
const SKELETAL = representation("skeletal");

function sceneFor(style: RenderStyle): RenderScene {
  return buildScene(MOL, style, SKELETAL);
}

/** The four corners of a px box, as the fit has to frame all of them. */
function corners(b: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): { x: number; y: number }[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.maxY },
  ];
}

describe("createSceneIndex — geometry", () => {
  it("puts every benzene atom where modelToPx puts it, and nowhere else", () => {
    const scene = sceneFor(SCREEN_STYLE);
    const index = createSceneIndex(scene, MOL);
    for (const atomId of MOL.atomIds) {
      const expected = modelToPx(SCREEN_STYLE, MOL.atoms[atomId]!.pos);
      const actual = index.atomCentre(atomId);
      expect(actual?.x).toBeCloseTo(expected.x, 9);
      expect(actual?.y).toBeCloseTo(expected.y, 9);
    }
  });

  it("returns undefined for an atom or bond the molecule does not have", () => {
    const index = createSceneIndex(sceneFor(SCREEN_STYLE), MOL);
    expect(index.atomCentre("a99")).toBeUndefined();
    expect(index.bondSegment("b99")).toBeUndefined();
    expect(index.atomRadiusPx("a99")).toBe(0);
  });

  /**
   * An id naming an Object.prototype member must MISS, not resolve up the
   * prototype chain.
   *
   * metrics.ts buckets its primitives into `Map`s for exactly this reason, but
   * the maps are only half of it: `atomCentre` also asks chem-core's `getAtom`,
   * which is a plain `mol.atoms[id]`. Unguarded, `atomCentre("constructor")`
   * gets `Object.prototype.constructor` back, reads `.pos` off a function and
   * throws a TypeError out of `modelToPx` — and `OverlayLayer` asks for a
   * centre per selected id, so one such id in a restored selection takes the
   * whole canvas down rather than drawing one halo fewer. Hence the
   * `Object.hasOwn` guard in metrics.ts, matching `pruneSelection` in the
   * store. Ids come from documents, which are untrusted input.
   */
  it("returns undefined for an id that names an Object.prototype member", () => {
    const index = createSceneIndex(sceneFor(SCREEN_STYLE), MOL);
    expect(index.atomCentre("constructor")).toBeUndefined();
    expect(index.bondSegment("toString")).toBeUndefined();
  });

  it("takes a bond segment from the drawn line, ending on the two atom centres", () => {
    const scene = sceneFor(SCREEN_STYLE);
    const index = createSceneIndex(scene, MOL);
    const bond = MOL.bonds["b7"]!;
    const segment = index.bondSegment("b7");
    expect(segment?.a).toEqual(modelToPx(SCREEN_STYLE, MOL.atoms[bond.from]!.pos));
    expect(segment?.b).toEqual(modelToPx(SCREEN_STYLE, MOL.atoms[bond.to]!.pos));
    // Untrimmed today, and the overlay draws over whatever the line reports —
    // which is the point of reading it off the primitive rather than the model.
    expect(scene.primitives.filter((p) => p.type === "line")).toHaveLength(6);
  });

  it("still reports a centre for an atom the style draws nothing for", () => {
    // `atomDotRadiusPx: 0` suppresses the placeholder dot, and a skeletal
    // chain carbon draws no label either, so this atom contributes no ink at
    // all. It still has a position, and still has to be hoverable and
    // selectable — an invisible vertex is the normal way a carbon is drawn.
    //
    // It has to be a BONDED carbon: an isolated atom of any element labels
    // itself, because a vertex with nothing meeting it is invisible rather
    // than implied.
    const style = withStyle(SCREEN_STYLE, { atomDotRadiusPx: 0 });
    const mol = ethanol();
    const index = createSceneIndex(buildScene(mol, style, SKELETAL), mol);
    expect(index.atomCentre("a1")).toEqual({ x: 0, y: -0 });
    expect(index.atomRadiusPx("a1")).toBe(0);
    // ...whereas the hydroxyl oxygen in the same molecule does draw.
    expect(index.atomRadiusPx("a3")).toBeGreaterThan(0);
  });
});

describe("createSceneIndex — labelRadius", () => {
  it("is in model units, never pixels", () => {
    const scene = sceneFor(SCREEN_STYLE);
    const index = createSceneIndex(scene, MOL);
    const radius = index.labelRadius("a1");

    // A bond is 1.0 model unit and 44px at this preset. A radius quoted in px
    // would be a pick target dozens of bonds wide; the assertion is that it is
    // a fraction of a bond, not a multiple of one.
    expect(radius).toBeLessThan(1);
    // Both sides converted into the SAME space before comparing. Holding the
    // px measurement up against the model-unit radius directly would be a
    // dimensionless coincidence that stays true however wrong the units are —
    // which is the exact bug this test claims to catch.
    expect(index.atomRadiusPx("a1") / pxPerModelUnit(SCREEN_STYLE)).toBeLessThan(
      radius,
    );
    expect(radius * pxPerModelUnit(SCREEN_STYLE)).toBeGreaterThan(
      index.atomRadiusPx("a1"),
    );
  });

  it("never drops below chem-core's DEFAULT_LABEL_RADIUS at either preset", () => {
    // THE regression this exists to catch: measuring the placeholder dot
    // literally gives ~0.06 bond lengths, a target a twentieth of a bond wide,
    // and every vertex carbon becomes something you have to aim at.
    for (const style of [SCREEN_STYLE, PUBLICATION_STYLE]) {
      const index = createSceneIndex(sceneFor(style), MOL);
      for (const atomId of MOL.atomIds) {
        expect(index.labelRadius(atomId)).toBeGreaterThanOrEqual(
          DEFAULT_LABEL_RADIUS,
        );
      }
    }
  });

  it("is the same number at both presets, because a bond length is the unit", () => {
    // Model units are preset-independent by construction. If the publication
    // preset ever reported a smaller radius than the screen one, the px had
    // leaked through the conversion.
    const screen = createSceneIndex(sceneFor(SCREEN_STYLE), MOL);
    const publication = createSceneIndex(sceneFor(PUBLICATION_STYLE), MOL);
    for (const atomId of MOL.atomIds) {
      expect(publication.labelRadius(atomId)).toBeCloseTo(
        screen.labelRadius(atomId),
        12,
      );
    }
    // And the placeholder dot is under the floor at both, so today they are
    // both exactly the floor.
    expect(screen.labelRadius("a1")).toBe(DEFAULT_LABEL_RADIUS);
  });

  it("lets a measured label overtake the floor once one is drawn", () => {
    // This used to be simulated with an enormous placeholder dot, because
    // there were no labels to measure. There are now, so it asserts the real
    // thing: ethanol's two carbons are bare vertices and sit on the floor,
    // while its hydroxyl oxygen draws an "OH" and measures its way past it.
    // The floor has to be a floor, not a cap.
    const mol = ethanol();
    const index = createSceneIndex(buildScene(mol, SCREEN_STYLE, SKELETAL), mol);

    expect(index.labelRadius("a1")).toBe(DEFAULT_LABEL_RADIUS);
    expect(index.labelRadius("a2")).toBe(DEFAULT_LABEL_RADIUS);
    expect(index.labelRadius("a3")).toBeGreaterThan(DEFAULT_LABEL_RADIUS);

    // And it measures the SYMBOL, not the whole run. The "H" of "OH" hangs
    // east of the oxygen the bond arrives at from the west; a radius that
    // reached it would be projected back along the bond, where no glyph is,
    // and would beat the bond at its own midpoint. Half a bond is the line
    // that must not be crossed.
    expect(index.labelRadius("a3")).toBeLessThan(0.5);
  });

  it("measures a wider symbol as a wider target", () => {
    // The radius is a measurement, not a constant per element: "Br" is three
    // and a half times the advance of "I", and the pick target has to follow
    // the glyph the user is actually aiming at.
    const br = bromomethane();
    const i = iodomethane();
    const brIndex = createSceneIndex(buildScene(br, SCREEN_STYLE, SKELETAL), br);
    const iIndex = createSceneIndex(buildScene(i, SCREEN_STYLE, SKELETAL), i);
    expect(brIndex.labelRadius("a2")).toBeGreaterThan(iIndex.labelRadius("a2"));
  });

  it("excludes the style's margin from the measured ink", () => {
    // `sceneBounds` grows every box it returns by `marginPx`. A margin baked
    // into a per-atom radius would inflate every pick target by 16px at the
    // screen preset — a third of a bond.
    const index = createSceneIndex(sceneFor(SCREEN_STYLE), MOL);
    expect(index.atomRadiusPx("a1")).toBeLessThan(SCREEN_STYLE.marginPx);
    expect(index.atomRadiusPx("a1")).toBeCloseTo(
      Math.hypot(SCREEN_STYLE.atomDotRadiusPx, SCREEN_STYLE.atomDotRadiusPx),
      9,
    );
  });
});

describe("fitBounds + zoomToFit", () => {
  const scene = sceneFor(SCREEN_STYLE);
  const bounds = fitBounds(scene);

  it("reports the scene's own px extents, margin included", () => {
    expect(bounds).toEqual({
      min: { x: scene.bounds.minX, y: scene.bounds.minY },
      max: { x: scene.bounds.maxX, y: scene.bounds.maxY },
    });

    // The preset's whitespace is genuinely INSIDE the box being framed — which
    // is why the canvas passes a zero fractional margin. Measured against the
    // same primitives with the margin stripped.
    const ink = sceneBounds(scene.primitives, withStyle(SCREEN_STYLE, { marginPx: 0 }));
    expect(bounds.min.x).toBeCloseTo(ink.minX - SCREEN_STYLE.marginPx, 9);
    expect(bounds.min.y).toBeCloseTo(ink.minY - SCREEN_STYLE.marginPx, 9);
    expect(bounds.max.x).toBeCloseTo(ink.maxX + SCREEN_STYLE.marginPx, 9);
    expect(bounds.max.y).toBeCloseTo(ink.maxY + SCREEN_STYLE.marginPx, 9);
    expect(SCREEN_STYLE.marginPx).toBeGreaterThan(0);
  });

  it("frames the whole structure inside the viewport", () => {
    const size = { width: 800, height: 600 };
    const fitted: Viewport = zoomToFit(createViewport(size), bounds, 0);
    for (const corner of corners(scene.bounds)) {
      const screen = toScreen(fitted, corner);
      expect(screen.x).toBeGreaterThanOrEqual(-1e-6);
      expect(screen.x).toBeLessThanOrEqual(size.width + 1e-6);
      expect(screen.y).toBeGreaterThanOrEqual(-1e-6);
      expect(screen.y).toBeLessThanOrEqual(size.height + 1e-6);
    }
  });

  it("is TIGHT: the limiting axis fills the viewport to within a pixel", () => {
    // The assertion that a double-applied margin fails. Benzene at the screen
    // preset is 112 x 124 px, so height binds in a 4:3 viewport; asking
    // `zoomToFit` for its default 5% on top of the preset's own whitespace
    // would leave ~57px of slack here instead of ~0.
    const size = { width: 800, height: 600 };
    const fitted = zoomToFit(createViewport(size), bounds, 0);
    const topLeft = toScreen(fitted, { x: bounds.min.x, y: bounds.min.y });
    const bottomRight = toScreen(fitted, { x: bounds.max.x, y: bounds.max.y });

    expect(scene.bounds.height).toBeGreaterThan(scene.bounds.width);
    expect(bottomRight.y - topLeft.y).toBeCloseTo(size.height, 0);
    expect(Math.abs(bottomRight.y - topLeft.y - size.height)).toBeLessThan(1);
    // The other axis is merely inside, not filled.
    expect(bottomRight.x - topLeft.x).toBeLessThan(size.width);
  });

  it("fits width when width is the binding axis", () => {
    // A bug that only shows on one orientation is exactly the one a single
    // 4:3 assertion misses.
    const size = { width: 300, height: 900 };
    const fitted = zoomToFit(createViewport(size), bounds, 0);
    const topLeft = toScreen(fitted, { x: bounds.min.x, y: bounds.min.y });
    const bottomRight = toScreen(fitted, { x: bounds.max.x, y: bounds.max.y });
    expect(Math.abs(bottomRight.x - topLeft.x - size.width)).toBeLessThan(1);
    expect(bottomRight.y - topLeft.y).toBeLessThan(size.height);
  });

  it("centres the structure, so the ring's centroid lands on the viewport centre", () => {
    const size = { width: 800, height: 600 };
    const fitted = zoomToFit(createViewport(size), bounds, 0);
    // Benzene is symmetric about the origin, and the margin is symmetric too.
    const centre = toScreen(fitted, modelToPx(SCREEN_STYLE, { x: 0, y: 0 }));
    expect(centre.x).toBeCloseTo(size.width / 2, 6);
    expect(centre.y).toBeCloseTo(size.height / 2, 6);
  });
});
