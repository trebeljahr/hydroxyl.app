/**
 * The bounds pass, which is what the viewBox is cut from.
 *
 * The failure this guards against is silent: a box measured from atom
 * positions rather than ink looks correct on screen, because the browser
 * happily draws outside the viewBox of an inline SVG, and only clips when the
 * same file is placed in a manuscript. So the assertions here measure the ink
 * independently and demand the margin be exactly what the style asked for.
 */

import { describe, expect, it } from "vitest";

import { benzene, emptyMolecule } from "@starter/chem-core";

import { acetate, ethanol } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { sceneBounds } from "../src/scene/bounds.js";
import type { ScenePrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";

const SKELETAL = representation("skeletal");

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The ink extent of the primitives `buildScene` actually emits, measured here
 * rather than by calling the code under test.
 *
 * Only lines and circles, because those are the only two shapes the
 * foundation pass produces. When wedges and labels land, this grows with
 * them — and if it does not, the assertion below fails, which is the point.
 */
function measure(primitives: readonly ScenePrimitive[]): Box {
  const box: Box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const grow = (x: number, y: number, pad: number): void => {
    box.minX = Math.min(box.minX, x - pad);
    box.minY = Math.min(box.minY, y - pad);
    box.maxX = Math.max(box.maxX, x + pad);
    box.maxY = Math.max(box.maxY, y + pad);
  };
  for (const p of primitives) {
    if (p.type === "line") {
      const pad = p.stroke.width / 2;
      grow(p.a.x, p.a.y, pad);
      grow(p.b.x, p.b.y, pad);
    } else if (p.type === "circle") {
      grow(p.centre.x, p.centre.y, p.radius);
    } else {
      throw new Error(`measure() does not know how to size a ${p.type}`);
    }
  }
  return box;
}

describe("sceneBounds", () => {
  for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
    it(`encloses every primitive and leaves exactly marginPx of slack (${style.name})`, () => {
      for (const molecule of [benzene(), ethanol(), acetate()]) {
        const scene = buildScene(molecule, style, SKELETAL);
        const ink = measure(scene.primitives);
        const m = style.marginPx;

        expect(scene.bounds.minX).toBeCloseTo(ink.minX - m, 9);
        expect(scene.bounds.minY).toBeCloseTo(ink.minY - m, 9);
        expect(scene.bounds.maxX).toBeCloseTo(ink.maxX + m, 9);
        expect(scene.bounds.maxY).toBeCloseTo(ink.maxY + m, 9);
        expect(scene.bounds.width).toBeCloseTo(
          scene.bounds.maxX - scene.bounds.minX,
          9,
        );
        expect(scene.bounds.height).toBeCloseTo(
          scene.bounds.maxY - scene.bounds.minY,
          9,
        );
      }
    });
  }

  it("grows a line by half its stroke width, not by nothing", () => {
    // The regression that motivated measuring ink: a half-width sliver clipped
    // off every edge of an exported figure.
    const scene = buildScene(benzene(), SCREEN_STYLE, SKELETAL);
    const positions = scene.primitives.flatMap((p) =>
      p.type === "circle" ? [p.centre.x] : [],
    );
    const rightmostAtom = Math.max(...positions);
    // The dot is the widest thing at that x, so the box must clear its radius.
    expect(scene.bounds.maxX).toBeGreaterThanOrEqual(
      rightmostAtom + SCREEN_STYLE.atomDotRadiusPx + SCREEN_STYLE.marginPx,
    );
  });

  it("gives an empty molecule a valid, margin-sized box", () => {
    // Zero width would make the viewBox unusable, and an empty canvas is the
    // very first thing the editor renders.
    const scene = buildScene(emptyMolecule(), PUBLICATION_STYLE, SKELETAL);
    expect(scene.primitives).toHaveLength(0);
    expect(scene.bounds).toEqual({
      minX: -8,
      minY: -8,
      maxX: 8,
      maxY: 8,
      width: 16,
      height: 16,
    });
  });

  it("gives a text view a box big enough to hold its glyphs", () => {
    const scene = buildScene(
      acetate(),
      PUBLICATION_STYLE,
      representation("sumFormula"),
    );
    // Seven parts of C2H3O2-, so the run is wider than the bare margin box.
    expect(scene.bounds.width).toBeGreaterThan(2 * PUBLICATION_STYLE.marginPx);
    expect(scene.bounds.height).toBeGreaterThan(2 * PUBLICATION_STYLE.marginPx);
  });

  it("never hands back a zero-width or zero-height box", () => {
    // An SVG whose viewBox or width is zero is not rendered at all — not
    // clipped, blank — so a collapsed box is a page with nothing on it rather
    // than a small figure. `marginPx` is a public style field, and 0 is a
    // legitimate value for a caller placing figures in its own layout.
    const flat = withStyle(PUBLICATION_STYLE, { marginPx: 0 });

    const empty = sceneBounds([], flat);
    expect(empty.width).toBeGreaterThan(0);
    expect(empty.height).toBeGreaterThan(0);
    // Opened out around the centre, so the box the caller gets is still
    // centred on where the (absent) ink was.
    expect(empty.minX).toBe(-empty.maxX);
    expect(empty.minY).toBe(-empty.maxY);

    // A single zero-radius dot collapses the same way, and so does a
    // perfectly horizontal hairline: one axis measures to nothing while the
    // other is fine, and only the collapsed one may move.
    const hairline: ScenePrimitive = {
      id: "bond:b1:line",
      source: { kind: "bond", bondId: "b1" },
      type: "line",
      a: { x: 0, y: 5 },
      b: { x: 40, y: 5 },
      stroke: { color: "#000000", width: 0 },
    };
    const line = sceneBounds([hairline], flat);
    expect(line.width).toBe(40);
    expect(line.height).toBeGreaterThan(0);
  });

  it("leaves an ordinary figure exactly where the margin put it", () => {
    // The guard above must be inert for every style that has a margin. If it
    // ever fires on a real molecule it is silently moving every golden.
    for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
      const scene = buildScene(benzene(), style, SKELETAL);
      const ink = measure(scene.primitives);
      expect(scene.bounds.minX).toBeCloseTo(ink.minX - style.marginPx, 9);
      expect(scene.bounds.maxY).toBeCloseTo(ink.maxY + style.marginPx, 9);
    }
  });

  it("recurses into groups", () => {
    // Nothing emits groups yet, so this is the only place the recursion is
    // exercised before a label pass starts relying on it.
    const dot: ScenePrimitive = {
      id: "atom:a1:dot",
      source: { kind: "atom", atomId: "a1" },
      type: "circle",
      centre: { x: 100, y: -40 },
      radius: 3,
      fill: { color: "#000000" },
    };
    const grouped: ScenePrimitive = {
      id: "atom:a1:label",
      source: { kind: "atom", atomId: "a1" },
      type: "group",
      children: [dot],
    };
    expect(sceneBounds([grouped], PUBLICATION_STYLE)).toEqual(
      sceneBounds([dot], PUBLICATION_STYLE),
    );
  });
});
