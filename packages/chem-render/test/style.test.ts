/**
 * The model-to-px seam, from both sides.
 *
 * `modelToPx` and `pxToModel` are the only two functions in the repo that know
 * the scale or which way is up, and the editor draws with one and hit-tests
 * with the other. So the property that matters is not that either is
 * individually plausible but that they compose to the identity: if they ever
 * drift apart — a scale applied twice, a flip applied once — a structure still
 * draws correctly and starts selecting the mirrored atom, which is the exact
 * failure the single-site rule exists to prevent and the hardest one to read
 * off a screenshot.
 *
 * Everything here runs against both presets. They differ in `bondLengthPx`
 * (24 against 44), so a bug that cancels out at one scale — a hard-coded
 * factor, a division against the wrong preset — cannot pass both.
 */

import { describe, expect, it } from "vitest";

import type { Vec2 } from "@starter/chem-core";

import { FIXTURES } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type { CirclePrimitive, ScenePoint } from "../src/scene/types.js";
import {
  modelToPx,
  PUBLICATION_STYLE,
  pxPerModelUnit,
  pxToModel,
  SCREEN_STYLE,
} from "../src/style.js";

const STYLES = [PUBLICATION_STYLE, SCREEN_STYLE];

/** Precision for a round trip: one multiply and one divide, nothing more. */
const PLACES = 10;

const MODEL_POINTS: readonly Vec2[] = [
  { x: 0, y: 0 }, // the origin, where the sign of zero shows up
  { x: 1, y: 0 }, // exactly one standard bond along x
  { x: 0, y: 1 },
  { x: 2.25, y: -3.5 }, // negative y: the flip's business end
  { x: -0.5, y: -1.75 },
  { x: 0.8660254, y: 0.5 }, // a hexagon vertex, awkward decimals on purpose
];

const SCENE_POINTS: readonly ScenePoint[] = [
  { x: 0, y: 0 },
  { x: 24, y: -24 },
  { x: -13.5, y: 71.25 },
  { x: 100, y: 0 },
  { x: -7.125, y: -0.75 },
];

describe("pxToModel", () => {
  for (const style of STYLES) {
    it(`inverts modelToPx for every model point (${style.name})`, () => {
      for (const p of MODEL_POINTS) {
        const back = pxToModel(style, modelToPx(style, p));
        expect(back.x).toBeCloseTo(p.x, PLACES);
        expect(back.y).toBeCloseTo(p.y, PLACES);
      }
    });

    it(`is inverted by modelToPx for every scene point (${style.name})`, () => {
      // The other direction is the one the editor actually leans on: a pointer
      // position goes to model units for hit testing, and whatever the pick
      // returns has to land back under the cursor.
      for (const q of SCENE_POINTS) {
        const back = modelToPx(style, pxToModel(style, q));
        expect(back.x).toBeCloseTo(q.x, PLACES);
        expect(back.y).toBeCloseTo(q.y, PLACES);
      }
    });

    it(`really inverts y rather than merely scaling it (${style.name})`, () => {
      // A round trip alone cannot see a missing flip: divide by the same thing
      // you multiplied by and the sign error cancels itself. So state the
      // half-step. Model y-up, scene y-down — a point above the origin in
      // chem-core is drawn above it in SVG, which means a *negative* scene y.
      const above = modelToPx(style, { x: 0, y: 1 });
      expect(above.y).toBeLessThan(0);

      const upInScene = pxToModel(style, { x: 0, y: -pxPerModelUnit(style) });
      expect(upInScene.y).toBeGreaterThan(0);
      expect(upInScene.y).toBeCloseTo(1, PLACES);

      // x is untouched by the flip, at both scales.
      expect(modelToPx(style, { x: 1, y: 0 }).x).toBeGreaterThan(0);
      expect(pxToModel(style, { x: pxPerModelUnit(style), y: 0 }).x).toBeCloseTo(
        1,
        PLACES,
      );
    });

    it(`agrees with pxPerModelUnit about how big a bond is (${style.name})`, () => {
      // The two exports are the same number seen from different sides, and a
      // caller measuring a tolerance with one and converting a point with the
      // other must get consistent answers. Offset a scene point by exactly one
      // `pxPerModelUnit` in x; the model points must be one bond apart.
      const scale = pxPerModelUnit(style);
      for (const q of SCENE_POINTS) {
        const here = pxToModel(style, q);
        const there = pxToModel(style, { x: q.x + scale, y: q.y });
        expect(there.x - here.x).toBeCloseTo(1, PLACES);
        expect(there.y).toBeCloseTo(here.y, PLACES);
      }
      expect(scale).toBe(style.bondLengthPx);
    });
  }

  it("maps a DELTA with the flip intact, because it is linear", () => {
    // THE CLAIM AN EARLIER DOC COMMENT GOT BACKWARDS, and the one aimed
    // squarely at whoever writes the editor's drag maths.
    //
    // `pxToModel` has no translation term, so it is a LINEAR map and
    // `f(p2) - f(p1) === f(p2 - p1)` exactly: the y-negation FACTORS OUT of a
    // difference, it does not cancel in it. Routing a drag displacement
    // through here is therefore correct and the negation is required.
    // Dividing that displacement by `pxPerModelUnit` alone — which the comment
    // used to prescribe — mirrors every drag vertically: the atom goes down
    // while the pointer goes up, and nothing about the symptom points at the
    // conversion.
    //
    // `pxPerModelUnit` alone is right for a SCALAR. A length has no sign.
    for (const style of STYLES) {
      const scale = pxPerModelUnit(style);
      const a = { x: 37, y: -12 };
      const b = { x: 37 - 3 * scale, y: -12 - scale };

      const byEndpoints = {
        x: pxToModel(style, b).x - pxToModel(style, a).x,
        y: pxToModel(style, b).y - pxToModel(style, a).y,
      };
      const byDelta = pxToModel(style, { x: b.x - a.x, y: b.y - a.y });
      expect(byDelta.x).toBeCloseTo(byEndpoints.x, PLACES);
      expect(byDelta.y).toBeCloseTo(byEndpoints.y, PLACES);

      // The sign, stated on its own so a symmetric error cannot hide: dragging
      // one bond length UP the screen (a NEGATIVE scene y) is a displacement
      // of +1 in model y.
      expect(pxToModel(style, { x: 0, y: -scale }).y).toBeCloseTo(1, PLACES);
      // ...and dividing by the scale alone would have said -1.
      expect(-scale / scale).toBe(-1);
    }
  });

  it("differs between the presets, so neither can stand in for the other", () => {
    // Guards the guard: if both presets ever shared a bond length, every
    // "at both scales" assertion above would quietly become one assertion.
    expect(pxPerModelUnit(PUBLICATION_STYLE)).not.toBe(
      pxPerModelUnit(SCREEN_STYLE),
    );
  });

  it("returns a zero at the origin whose sign does not matter", () => {
    // Negating y turns 0 into -0, so the origin comes out of either direction
    // with a signed zero. It is numerically equal to 0 — every comparison and
    // every piece of arithmetic downstream treats it as such — and the one
    // place the sign could become visible, serialised output, is normalised:
    // `formatNumber` rewrites "-0" to "0" before it reaches the SVG. So assert
    // the value rather than the sign bit; a `toBe(0)` here compares with
    // Object.is, fails on -0, and invites a cosmetic `+ 0` that would mask a
    // genuine sign error later.
    for (const style of STYLES) {
      const model = pxToModel(style, { x: 0, y: 0 });
      expect(model.x === 0).toBe(true);
      expect(model.y === 0).toBe(true);

      const scene = modelToPx(style, { x: 0, y: 0 });
      expect(scene.x === 0).toBe(true);
      expect(scene.y === 0).toBe(true);
    }
  });
});

/**
 * THE CANVAS RELIES ON A PRESET SWITCH BEING ONE SCALE (decision 107).
 *
 * The editor keeps every atom on its screen pixel across a Screen/Publication
 * switch by dividing its zoom by the ratio of the two bond lengths, and
 * nothing else. That is exact only while an atom's scene position is
 * `modelToPx` of its model position and the bond length is the only number in
 * it — no per-style offset, no margin folded into a coordinate, no second
 * scale. Every fixture's bare-vertex dots are checked, because a dot's centre
 * is the one primitive whose position is the atom's own.
 */
describe("a preset switch moves every atom by the bond-length ratio alone", () => {
  function dots(style: typeof SCREEN_STYLE, fixture: (typeof FIXTURES)[number]) {
    const scene = buildScene(fixture.molecule, style, representation("skeletal"));
    const byAtom = new Map<string, ScenePoint>();
    for (const primitive of scene.primitives) {
      // By id, not by "a circle from an atom": a radical's electron dot is
      // one too, and it sits beside the label, where the glyph size puts it.
      if (primitive.type !== "circle" || primitive.source.kind !== "atom") continue;
      if (primitive.id !== `atom:${primitive.source.atomId}:dot`) continue;
      byAtom.set(primitive.source.atomId, (primitive as CirclePrimitive).centre);
    }
    return byAtom;
  }

  it("scales every bare vertex by 24/44 and moves none of them otherwise", () => {
    const ratio = pxPerModelUnit(PUBLICATION_STYLE) / pxPerModelUnit(SCREEN_STYLE);
    let checked = 0;
    for (const fixture of FIXTURES) {
      const screen = dots(SCREEN_STYLE, fixture);
      const publication = dots(PUBLICATION_STYLE, fixture);
      // The label pass decides which atoms are bare from chemistry, not from
      // the style, so both presets draw a dot on the same atoms.
      expect([...publication.keys()].sort(), fixture.name).toEqual([...screen.keys()].sort());
      for (const [atomId, centre] of screen) {
        const other = publication.get(atomId)!;
        expect(other.x, `${fixture.name} ${atomId}`).toBeCloseTo(centre.x * ratio, 9);
        expect(other.y, `${fixture.name} ${atomId}`).toBeCloseTo(centre.y * ratio, 9);
        checked += 1;
      }
    }
    // Guards the loop: a fixture set with no bare vertex would pass vacuously.
    expect(checked).toBeGreaterThan(50);
  });
});
