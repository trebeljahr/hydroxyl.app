/**
 * The coordinate chain, end to end, and what the pointer picks at the end of it.
 *
 *     canvas px --toModel(viewport)--> scene px (y-down) --pxToModel(style)--> model units (y-up)
 *
 * Two steps, one scale, one flip, each owned by exactly one module. The tests
 * below exist because every plausible bug in that chain draws a correct
 * picture and hit-tests wrongly: a second flip mirrors the structure, a second
 * bond-length divide shrinks every target, and a tolerance passed through in
 * pixels inverts the zoom relationship so that a carbon swallows its bonds at
 * 8x. None of those is visible in a screenshot.
 *
 * state/viewport.test.ts already proves `toScreen`/`toModel` invert each other
 * in px space. What is new here is the composition with chem-render's scale
 * and flip, and the tolerance conversion that only pick.ts performs.
 */

import {
  DEFAULT_ATOM_TOLERANCE,
  DEFAULT_LABEL_RADIUS,
  benzene,
  buildMolecule,
  distance,
} from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";
import {
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  buildScene,
  modelToPx,
  pxPerModelUnit,
  representation,
} from "@starter/chem-render";
import type { RenderStyle } from "@starter/chem-render";
import { describe, expect, it } from "vitest";

import { MAX_ZOOM, MIN_ZOOM, toScreen, zoomAt } from "@/state";
import type { Viewport, ViewportSize } from "@/state";

import { createSceneIndex } from "./metrics";
import { DEFAULT_PICK_TOLERANCE_PX, canvasPointToModel, pickAt } from "./pick";
import type { PickContext } from "./pick";

const BENZENE = benzene();

/**
 * Ethanol as a chemist draws it: a zig-zag C-C-O, so the two bonds are not
 * parallel and a sign error on one axis cannot cancel out.
 */
const ETHANOL: Molecule = buildMolecule((b) => {
  const c1 = b.atom("C", { x: 0, y: 0 });
  const c2 = b.atom("C", { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) });
  const o = b.atom("O", { x: 2 * Math.cos(Math.PI / 6), y: 0 });
  b.bond(c1, c2, 1);
  b.bond(c2, o, 1);
});

const SKELETAL = representation("skeletal");

function makeViewport(pan: Vec2, zoom: number, size: ViewportSize): Viewport {
  return { pan, zoom, size };
}

function contextFor(
  mol: Molecule,
  style: RenderStyle,
  viewport: Viewport,
): PickContext {
  const scene = buildScene(mol, style, SKELETAL);
  return { molecule: mol, viewport, index: createSceneIndex(scene, mol) };
}

/** The FORWARD chain: model units -> scene px -> canvas px. `canvasPointToModel`
 *  must invert exactly this and nothing more. */
function toCanvas(ctx: PickContext, model: Vec2): Vec2 {
  return toScreen(ctx.viewport, modelToPx(ctx.index.scene.style, model));
}

/** One screen pixel, expressed in model units at this zoom and style. */
function onePixelInModelUnits(ctx: PickContext): number {
  return 1 / (ctx.viewport.zoom * pxPerModelUnit(ctx.index.scene.style));
}

function midpoint(mol: Molecule, bondId: string): Vec2 {
  const bond = mol.bonds[bondId]!;
  const from = mol.atoms[bond.from]!.pos;
  const to = mol.atoms[bond.to]!.pos;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** A point on the bond's axis at parameter `t`, in model units. */
function alongBond(mol: Molecule, bondId: string, t: number): Vec2 {
  const bond = mol.bonds[bondId]!;
  const from = mol.atoms[bond.from]!.pos;
  const to = mol.atoms[bond.to]!.pos;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

const ZOOMS = [MIN_ZOOM, 0.4, 1, 2.75, 11, MAX_ZOOM];
const PANS: Vec2[] = [
  { x: 0, y: 0 },
  { x: 137.5, y: -92.25 },
  { x: -1200, y: 640 },
];
const SIZES: ViewportSize[] = [
  { width: 800, height: 600 },
  { width: 1920, height: 1080 },
  { width: 320, height: 900 },
];

describe("canvasPointToModel — the round trip", () => {
  it("inverts the forward chain exactly, at every zoom, pan and size", () => {
    // If anything scaled or flipped twice, this is where it shows: the error
    // would be proportional to the coordinate, so the far corner of a large
    // pan is the loudest case.
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      ...BENZENE.atomIds.map((id) => BENZENE.atoms[id]!.pos),
      { x: -37.5, y: 84.25 },
    ];

    for (const style of [SCREEN_STYLE, PUBLICATION_STYLE]) {
      for (const zoom of ZOOMS) {
        for (const pan of PANS) {
          for (const size of SIZES) {
            const ctx = contextFor(BENZENE, style, makeViewport(pan, zoom, size));
            for (const model of points) {
              const back = canvasPointToModel(ctx, toCanvas(ctx, model));
              expect(back.x).toBeCloseTo(model.x, 9);
              expect(back.y).toBeCloseTo(model.y, 9);
            }
          }
        }
      }
    }
  });

  it("flips y exactly once: model +y is UP the screen", () => {
    // chem-core is y-up, SVG is y-down, and `modelToPx` owns the single
    // negation. A structure that draws correctly but hit-tests mirrored is
    // what a second flip anywhere in this chain produces.
    const ctx = contextFor(
      BENZENE,
      SCREEN_STYLE,
      makeViewport({ x: 0, y: 0 }, 1, { width: 800, height: 600 }),
    );
    const centre = toCanvas(ctx, { x: 0, y: 0 });
    const above = toCanvas(ctx, { x: 0, y: 1 });
    expect(above.y).toBeLessThan(centre.y);
    expect(above.y).toBeCloseTo(centre.y - SCREEN_STYLE.bondLengthPx, 9);

    // And back the other way, through the function under test.
    expect(canvasPointToModel(ctx, { x: 400, y: 300 - 44 }).y).toBeCloseTo(1, 9);
    expect(canvasPointToModel(ctx, { x: 400, y: 300 + 44 }).y).toBeCloseTo(-1, 9);
  });

  it("divides by the style's bond length exactly once", () => {
    // 44px at the screen preset, 24px at publication. A second divide would
    // make the whole molecule collapse toward the origin.
    const size = { width: 800, height: 600 };
    for (const style of [SCREEN_STYLE, PUBLICATION_STYLE]) {
      const ctx = contextFor(BENZENE, style, makeViewport({ x: 0, y: 0 }, 1, size));
      const model = canvasPointToModel(ctx, {
        x: size.width / 2 + style.bondLengthPx,
        y: size.height / 2,
      });
      expect(model.x).toBeCloseTo(1, 9);
    }
  });
});

describe("the wheel-zoom invariant", () => {
  /**
   * THE property a wheel zoom has to have: whatever is under the cursor stays
   * under the cursor. Asserted end to end through the real conversion chain —
   * resolve a canvas point to a model point, zoom about that same canvas
   * point, resolve it again — rather than on the viewport maths alone, because
   * a bug in the composition (a re-scale, a stale style) survives a viewport
   * test perfectly well.
   */
  function assertAnchorPinned(
    style: RenderStyle,
    viewport: Viewport,
    anchor: Vec2,
    factor: number,
  ): void {
    const before = contextFor(BENZENE, style, viewport);
    const modelBefore = canvasPointToModel(before, anchor);

    const after = contextFor(BENZENE, style, zoomAt(viewport, anchor, factor));
    const modelAfter = canvasPointToModel(after, anchor);

    // Within a pixel, converted to model units at the TIGHTER of the two
    // zooms, so zooming in does not make the tolerance generous.
    const tolerance = Math.min(
      onePixelInModelUnits(before),
      onePixelInModelUnits(after),
    );
    expect(distance(modelBefore, modelAfter)).toBeLessThan(tolerance);
  }

  const size = { width: 800, height: 600 };
  // Deliberately NOT the viewport centre. A pan solved for the centre is
  // correct by construction; the off-centre anchor is what catches a zoom that
  // forgets the `(anchor - size/2)` term.
  const ANCHORS: Vec2[] = [
    { x: 400, y: 300 },
    { x: 137, y: 88 },
    { x: 799, y: 1 },
    { x: 0, y: 599 },
  ];

  it("holds for a notch in and a notch back out, at several zooms", () => {
    for (const zoom of [0.3, 1, 2.75, 9]) {
      for (const pan of PANS) {
        for (const anchor of ANCHORS) {
          const vp = makeViewport(pan, zoom, size);
          assertAnchorPinned(SCREEN_STYLE, vp, anchor, 1.25);
          assertAnchorPinned(SCREEN_STYLE, vp, anchor, 1 / 1.25);
        }
      }
    }
  });

  it("holds when the clamp truncates the requested factor", () => {
    // `zoomAt` solves for the pan against the CLAMPED zoom rather than
    // nudging by a delta, which is what keeps the anchor pinned at the limits
    // instead of drifting a little further on every event at the stop.
    for (const anchor of ANCHORS) {
      assertAnchorPinned(
        SCREEN_STYLE,
        makeViewport({ x: 40, y: -20 }, MAX_ZOOM / 2, size),
        anchor,
        64,
      );
      assertAnchorPinned(
        SCREEN_STYLE,
        makeViewport({ x: 40, y: -20 }, MIN_ZOOM * 2, size),
        anchor,
        1 / 64,
      );
    }
  });

  it("holds at the publication preset too, where a bond is 24px not 44px", () => {
    for (const anchor of ANCHORS) {
      assertAnchorPinned(
        PUBLICATION_STYLE,
        makeViewport({ x: -310, y: 155 }, 1.75, size),
        anchor,
        2,
      );
    }
  });

  it("returns to the same view after zooming in and back out by the same factor", () => {
    // The exponential wheel curve depends on this: scrolling back undoes the
    // zoom exactly, with no drift after a hundred events.
    const anchor = { x: 137, y: 88 };
    const start = makeViewport({ x: 12, y: -34 }, 1.6, size);
    let vp = start;
    for (let i = 0; i < 50; i++) vp = zoomAt(vp, anchor, 1.07);
    for (let i = 0; i < 50; i++) vp = zoomAt(vp, anchor, 1 / 1.07);

    const before = contextFor(BENZENE, SCREEN_STYLE, start);
    const after = contextFor(BENZENE, SCREEN_STYLE, vp);
    expect(vp.zoom).toBeCloseTo(start.zoom, 6);
    const a = canvasPointToModel(before, anchor);
    const b = canvasPointToModel(after, anchor);
    expect(distance(a, b)).toBeLessThan(onePixelInModelUnits(after));
  });
});

describe("pickAt", () => {
  const size = { width: 800, height: 600 };
  const viewport = makeViewport({ x: 0, y: 0 }, 1, size);

  it("picks the bond under a click on its midpoint", () => {
    const ctx = contextFor(BENZENE, SCREEN_STYLE, viewport);
    for (const bondId of BENZENE.bondIds) {
      const hit = pickAt(ctx, toCanvas(ctx, midpoint(BENZENE, bondId)));
      expect(hit.kind).toBe("bond");
      if (hit.kind !== "bond") throw new Error("unreachable");
      expect(hit.bondId).toBe(bondId);
      // Halfway along, which is what a split or an order-cycle would act on.
      expect(hit.t).toBeCloseTo(0.5, 6);
    }
  });

  it("picks the ATOM, not the bond that ends there", () => {
    // Atom-over-bond priority is the whole reason chem-core's `hitTest` ranks
    // by penetration into each atom's own radius. A point ON the bond axis a
    // tenth of a bond from the vertex has zero perpendicular distance to the
    // bond and is still inside the atom's label — the atom must win.
    const ctx = contextFor(ETHANOL, SCREEN_STYLE, viewport);
    const bond = ETHANOL.bonds["b4"]!;
    const t = 0.1;
    expect(t).toBeLessThan(DEFAULT_LABEL_RADIUS);

    const hit = pickAt(ctx, toCanvas(ctx, alongBond(ETHANOL, "b4", t)));
    expect(hit.kind).toBe("atom");
    if (hit.kind !== "atom") throw new Error("unreachable");
    expect(hit.atomId).toBe(bond.from);

    // Dead on the vertex, unambiguously.
    const centre = pickAt(ctx, toCanvas(ctx, ETHANOL.atoms[bond.from]!.pos));
    expect(centre).toMatchObject({ kind: "atom", atomId: bond.from });
  });

  it("leaves the middle of every bond clickable, which is the property the floor buys", () => {
    // 0.18 + the tolerance reaches ~0.30 along a standard bond, so the middle
    // 40% belongs to the bond. Ethanol's hydroxyl bond is the one to check:
    // an O and a C, both bare vertices today.
    const ctx = contextFor(ETHANOL, SCREEN_STYLE, viewport);
    expect(DEFAULT_LABEL_RADIUS + DEFAULT_ATOM_TOLERANCE).toBeLessThan(0.35);
    for (const t of [0.35, 0.5, 0.65]) {
      const point = toCanvas(ctx, alongBond(ETHANOL, "b5", t));
      expect(pickAt(ctx, point)).toMatchObject({ kind: "bond", bondId: "b5" });
    }
  });

  it("picks nothing on empty space", () => {
    const ctx = contextFor(BENZENE, SCREEN_STYLE, viewport);
    // Well outside the ring, and dead in the middle of it — benzene's centre
    // is half a bond from every atom and further still from every bond axis.
    expect(pickAt(ctx, toCanvas(ctx, { x: 5, y: 5 })).kind).toBe("none");
    expect(pickAt(ctx, toCanvas(ctx, { x: 0, y: 0 })).kind).toBe("none");
    expect(pickAt(ctx, { x: 0, y: 0 }).kind).toBe("none");
  });

  it("refuses to pick at a non-finite point rather than poisoning the hit test", () => {
    // A pointer event during teardown — a rect measured on a detached node —
    // yields NaN, and NaN loses every comparison inside `hitTest` silently.
    const ctx = contextFor(BENZENE, SCREEN_STYLE, viewport);
    expect(pickAt(ctx, { x: Number.NaN, y: 0 }).kind).toBe("none");
    expect(pickAt(ctx, { x: 0, y: Number.POSITIVE_INFINITY }).kind).toBe("none");
  });
});

describe("the tolerance is zoom-invariant", () => {
  const size = { width: 800, height: 600 };

  /**
   * A point `offsetPx` SCREEN pixels off the bond's axis at its midpoint.
   *
   * The normal is taken in CANVAS space, from the bond's own projected
   * endpoints, not from the model and then carried across. A model-space
   * normal pushed into canvas coordinates is perpendicular to the MIRRORED
   * bond — the y-flip is exactly what makes the two differ — so the "offset"
   * would slide along the bond toward an endpoint and this whole section would
   * be measuring the atom's grab radius instead of the bond's.
   */
  function offBond(ctx: PickContext, bondId: string, offsetPx: number): Vec2 {
    const bond = ETHANOL.bonds[bondId]!;
    const a = toCanvas(ctx, ETHANOL.atoms[bond.from]!.pos);
    const b = toCanvas(ctx, ETHANOL.atoms[bond.to]!.pos);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const mid = toCanvas(ctx, midpoint(ETHANOL, bondId));
    return { x: mid.x + normal.x * offsetPx, y: mid.y + normal.y * offsetPx };
  }

  it("hits the same screen-px miss at 0.5x and at 4x", () => {
    // THE property that breaks the instant pixels are passed into `hitTest`
    // instead of being divided by the zoom first: a fixed model tolerance
    // grows on screen as you zoom in, so a 4px miss that grabs the bond at
    // 0.5x would grab half the molecule at 4x.
    const inside = 4;
    expect(inside).toBeLessThan(DEFAULT_PICK_TOLERANCE_PX);
    for (const zoom of [0.5, 1, 4]) {
      const ctx = contextFor(
        ETHANOL,
        SCREEN_STYLE,
        makeViewport({ x: 0, y: 0 }, zoom, size),
      );
      for (const sign of [1, -1]) {
        expect(pickAt(ctx, offBond(ctx, "b5", inside * sign))).toMatchObject({
          kind: "bond",
          bondId: "b5",
        });
      }
    }
  });

  it("misses the same screen-px overshoot at 0.5x and at 4x", () => {
    const outside = 12;
    expect(outside).toBeGreaterThan(DEFAULT_PICK_TOLERANCE_PX);
    for (const zoom of [0.5, 1, 4]) {
      const ctx = contextFor(
        ETHANOL,
        SCREEN_STYLE,
        makeViewport({ x: 0, y: 0 }, zoom, size),
      );
      expect(pickAt(ctx, offBond(ctx, "b5", outside)).kind).toBe("none");
    }
  });

  it("keeps the grab radius the same size on screen across five octaves", () => {
    // Measured rather than asserted indirectly: bisect for the screen offset
    // at which the bond stops being grabbable. That distance must not move
    // with the zoom — which is the whole claim, since the model-space
    // tolerance handed to `hitTest` differs by 32x across this range.
    const edges = [0.5, 1, 4, 16].map((zoom) => {
      const ctx = contextFor(
        ETHANOL,
        SCREEN_STYLE,
        makeViewport({ x: 0, y: 0 }, zoom, size),
      );
      let hit = 0;
      let miss = 40;
      for (let i = 0; i < 40; i++) {
        const mid = (hit + miss) / 2;
        if (pickAt(ctx, offBond(ctx, "b5", mid)).kind === "bond") hit = mid;
        else miss = mid;
      }
      return hit;
    });

    for (const edge of edges) expect(edge).toBeCloseTo(edges[0]!, 6);
    // And it is the documented grab radius, not merely something constant.
    expect(edges[0]).toBeCloseTo(DEFAULT_PICK_TOLERANCE_PX, 6);
  });

  it("holds at the publication preset, where the same 6px is a wider grab", () => {
    // 6px is 0.14 bond lengths at the screen preset and 0.25 at publication.
    // The pixel is the invariant, not the bond fraction — which is also why
    // the publication preset runs out of clickable bond sooner on the way
    // out: at 0.5x its 6px grab is half a bond, and the vertices meet in the
    // middle. That is the documented consequence, not a defect.
    for (const zoom of [1, 4]) {
      const ctx = contextFor(
        ETHANOL,
        PUBLICATION_STYLE,
        makeViewport({ x: 0, y: 0 }, zoom, size),
      );
      expect(pickAt(ctx, offBond(ctx, "b5", 4))).toMatchObject({ kind: "bond" });
      expect(pickAt(ctx, offBond(ctx, "b5", 12)).kind).toBe("none");
    }
  });

  it("clamps a negative tolerance at zero instead of shrinking every target", () => {
    const ctx = contextFor(
      ETHANOL,
      SCREEN_STYLE,
      makeViewport({ x: 0, y: 0 }, 1, size),
    );
    const mid = toCanvas(ctx, midpoint(ETHANOL, "b5"));
    expect(pickAt(ctx, mid, -100)).toMatchObject({ kind: "bond", bondId: "b5" });
    expect(pickAt(ctx, offBond(ctx, "b5", 3), 0).kind).toBe("none");
  });
});
