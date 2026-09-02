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

import {
  acetate,
  bromomethane,
  ethanol,
  iodomethane,
} from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import { sceneBounds } from "../src/scene/bounds.js";
import type { ScenePrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import {
  advanceWidthUnits,
  EM_ASCENT,
  EM_DESCENT,
  UNITS_PER_EM,
} from "../src/text/metrics.js";
import { BUNDLED_MEASURER } from "../src/text/measurer.js";
import type { Measurer } from "../src/text/measurer.js";

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
 * Lines, circles and glyph runs — the three shapes the pass now produces.
 * Anything else throws rather than being silently ignored, which is what made
 * this helper notice the day labels started appearing.
 *
 * The text arm RESTATES the measurement rather than calling `measureTextRun`
 * or `textRunRect`: a helper that delegates to the implementation asserts
 * nothing at all. It reads the advance table directly, applies the script
 * scale and the two baseline-shift factors as literals, and does its own
 * anchor and baseline arithmetic.
 */
function measure(
  primitives: readonly ScenePrimitive[],
  style: RenderStyle,
): Box {
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
  const growBox = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void => {
    box.minX = Math.min(box.minX, minX);
    box.minY = Math.min(box.minY, minY);
    box.maxX = Math.max(box.maxX, maxX);
    box.maxY = Math.max(box.maxY, maxY);
  };
  for (const p of primitives) {
    if (p.type === "line") {
      const pad = p.stroke.width / 2;
      grow(p.a.x, p.a.y, pad);
      grow(p.b.x, p.b.y, pad);
    } else if (p.type === "circle") {
      grow(p.centre.x, p.centre.y, p.radius);
    } else if (p.type === "textRun") {
      let width = 0;
      let ascent = EM_ASCENT * p.fontSizePx;
      let descent = EM_DESCENT * p.fontSizePx;
      let sawInk = false;
      for (const span of p.spans) {
        const size =
          span.script === undefined
            ? p.fontSizePx
            : p.fontSizePx * style.subscriptScale;
        // The serialiser's own dy factors, restated as literals.
        const dy =
          span.script === "sub"
            ? p.fontSizePx * 0.25
            : span.script === "super"
              ? p.fontSizePx * -0.35
              : 0;
        let units = 0;
        for (const character of span.text) {
          units += advanceWidthUnits(character.codePointAt(0) ?? 0);
        }
        width += (units * size) / UNITS_PER_EM;
        if (span.text.length === 0) continue;
        const spanAscent = -dy + EM_ASCENT * size;
        const spanDescent = dy + EM_DESCENT * size;
        if (!sawInk) {
          ascent = spanAscent;
          descent = spanDescent;
          sawInk = true;
        } else {
          ascent = Math.max(ascent, spanAscent);
          descent = Math.max(descent, spanDescent);
        }
      }
      if (width === 0) continue;
      const left =
        p.anchor === "start"
          ? p.origin.x
          : p.anchor === "middle"
            ? p.origin.x - width / 2
            : p.origin.x - width;
      const baselineY =
        p.baseline === "alphabetic"
          ? p.origin.y
          : p.baseline === "middle"
            ? p.origin.y + (ascent - descent) / 2
            : p.origin.y + ascent;
      growBox(left, baselineY - ascent, left + width, baselineY + descent);
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
        const ink = measure(scene.primitives, style);
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

  it("sizes a halogen's label from the halogen, not from a flat estimate", () => {
    // The point of vendoring a metrics table at all. Bromomethane and
    // iodomethane are the same molecule but for one atom, and "Br" is 2048
    // font units against "I"'s 569 — 3.6 times the advance. Under the old
    // flat 0.6-em-per-code-point estimate the two labels measured 2:1 purely
    // from their character counts, so a figure of an iodide carried half an em
    // of whitespace it had not earned and a bromide's box was too tight.
    const bromo = buildScene(bromomethane(), PUBLICATION_STYLE, SKELETAL);
    const iodo = buildScene(iodomethane(), PUBLICATION_STYLE, SKELETAL);

    const brWidth =
      (advanceWidthUnits("B".codePointAt(0)!) +
        advanceWidthUnits("r".codePointAt(0)!)) *
      (PUBLICATION_STYLE.fontSizePx / UNITS_PER_EM);
    const iWidth =
      advanceWidthUnits("I".codePointAt(0)!) *
      (PUBLICATION_STYLE.fontSizePx / UNITS_PER_EM);
    expect(brWidth).toBeGreaterThan(iWidth);

    // Both fixtures put the halogen at the same position with the same bond,
    // so the only thing that can move a bound is the label. HALF the advance
    // difference, not all of it: the halogen carries no hydrogen, so its
    // symbol is centred on its atom and the label grows symmetrically — but
    // the methyl sits to its left, so only the right-hand growth reaches the
    // box. Asserting the full difference here would be asserting that the
    // label is anchored at its left edge, which is exactly the bug the
    // symbol-centring rule exists to prevent.
    expect(bromo.bounds.width - iodo.bounds.width).toBeCloseTo(
      (brWidth - iWidth) / 2,
      9,
    );
    // And it is a real difference, not a rounding artefact the margin hides.
    expect(bromo.bounds.width).toBeGreaterThan(iodo.bounds.width + 1);
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
      const ink = measure(scene.primitives, style);
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
