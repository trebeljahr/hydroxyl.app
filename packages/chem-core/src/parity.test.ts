/**
 * The one lift both stereo readers call (decisions 28 and 29).
 *
 * Asserted on ligand lists rather than molecules, so a failure here names the
 * lift and not the ranking. The chemistry-level consequences (letters on fan
 * drawings, cross-checked against RDKit) are pinned in stereo.test.ts and
 * stereo-config.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  liftParity,
  pointsParity,
  PSEUDO_3D_DEPTH,
  RELATIVE_VOLUME_FLOOR,
  type LiftLigand,
} from "./parity.js";
import { DEG, fromPolar, type Vec2 } from "./vec.js";

function drawn(degrees: number, depth = 0, length = 1): LiftLigand {
  return { kind: "drawn", offset: fromPolar(degrees * DEG, length), depth };
}

function at(offset: Vec2, depth = 0): LiftLigand {
  return { kind: "drawn", offset, depth };
}

const H: LiftLigand = { kind: "implicit" };

describe("liftParity", () => {
  it("pins the sign on the textbook (R)-CHBrClF: Br north wedge, Cl lower right, F lower left", () => {
    // Priority order Br, Cl, F, H. R is a negative volume.
    expect(liftParity([drawn(90, 1), drawn(-30), drawn(210), H])).toEqual({
      kind: "specified",
      parity: -1,
    });
    expect(PSEUDO_3D_DEPTH).not.toBe(0);
  });

  it("puts the implicit ligand opposite a fan, not behind the centre", () => {
    // Br 0° wedge, Cl +75°, F −75°: R by the geometry and by RDKit. With the
    // hydrogen straight behind the centre the volume comes out positive (S).
    expect(liftParity([drawn(0, 1), drawn(75), drawn(-75), H])).toEqual({
      kind: "specified",
      parity: -1,
    });
    // A regular-hexagon bridgehead: bonds at 0°, 60°, 120°, the middle one
    // wedged. Behind the centre this is exactly coplanar; opposite the fan it
    // is R (RDKit agrees).
    expect(liftParity([drawn(0), drawn(60, 1), drawn(120), H])).toEqual({
      kind: "specified",
      parity: -1,
    });
  });

  it("keeps a surrounded centre and an exact T on the behind-the-centre placement", () => {
    // Gap of exactly 180° between the two plain bonds: the fan placement would
    // put H in one plane with the wedge. Surrounded reads S, the letter
    // stereo.ts has always given this drawing (its glyceraldehyde fixture).
    // RDKit reads the same degenerate T as R, and refuses within about 5° of
    // it; the boundary is a known disagreement, not a verified letter.
    expect(liftParity([drawn(90, 1), drawn(150), drawn(-30), H])).toEqual({
      kind: "specified",
      parity: 1,
    });
  });

  it("refuses the X drawing at the exact X and half a degree either side", () => {
    // Wedge 135°, hash 315°, plain 225° and 45°: the sign flips at 45°.
    for (const nudge of [-0.5, 0, 0.5]) {
      expect(liftParity([drawn(135, 1), drawn(315, -1), drawn(225), drawn(45 + nudge)])).toEqual({
        kind: "ambiguous",
      });
    }
    // Well clear of the flip, the same marks state a configuration.
    expect(liftParity([drawn(135, 1), drawn(315, -1), drawn(225), drawn(60)]).kind).toBe(
      "specified",
    );
  });

  it("refuses when the raw and unit-direction readings disagree, even above the floor", () => {
    // Raw volume −0.33, unit volume +1.38 (both relative): the sign depends on
    // how long the lines were drawn.
    const ligands = [
      at({ x: 1.8, y: 1.4 }, 1),
      at({ x: -1.5, y: 1.2 }, -1),
      at({ x: 1.5, y: -1.9 }),
      at({ x: 0.5, y: -0.2 }),
    ];
    expect(liftParity(ligands)).toEqual({ kind: "ambiguous" });
  });

  it("is scale-free: a drawing in ångström reads as the same drawing in bond lengths", () => {
    const base = [drawn(0, 1, 1), drawn(100, 0, 0.8), drawn(230, -1, 1.2), drawn(300, 0, 0.9)];
    const scaled = base.map((l) =>
      l.kind === "drawn" ? at({ x: l.offset.x * 1.54, y: l.offset.y * 1.54 }, l.depth) : l,
    );
    const tiny = base.map((l) =>
      l.kind === "drawn" ? at({ x: l.offset.x * 1e-3, y: l.offset.y * 1e-3 }, l.depth) : l,
    );
    expect(liftParity(base).kind).toBe("specified");
    expect(liftParity(scaled)).toEqual(liftParity(base));
    expect(liftParity(tiny)).toEqual(liftParity(base));
  });

  it("separates silence from contradiction", () => {
    expect(liftParity([drawn(90), drawn(-30), drawn(210), H])).toEqual({ kind: "flat" });
    // A wedge and a hash around one implicit H leave it no side.
    expect(liftParity([drawn(90, 1), drawn(-30, -1), drawn(210), H])).toEqual({
      kind: "ambiguous",
    });
    // Two implicit ligands cannot both be placed.
    expect(liftParity([drawn(90, 1), drawn(-30), H, H])).toEqual({ kind: "ambiguous" });
    // A zero-length bond has no direction.
    expect(liftParity([at({ x: 0, y: 0 }, 1), drawn(-30), drawn(210), H])).toEqual({
      kind: "ambiguous",
    });
    expect(liftParity([drawn(90, 1), drawn(-30), drawn(210)])).toEqual({ kind: "ambiguous" });
  });
});

describe("pointsParity", () => {
  it("applies the relative floor at the scale it is given", () => {
    const tetra = [
      { x: 1, y: 0, z: 1 },
      { x: -1, y: 0, z: 1 },
      { x: 0, y: 1, z: -1 },
      { x: 0, y: -1, z: -1 },
    ];
    expect(pointsParity(tetra, PSEUDO_3D_DEPTH)).toBe(-1);
    const flat = tetra.map((p) => ({ ...p, z: 0 }));
    expect(pointsParity(flat, PSEUDO_3D_DEPTH)).toBeUndefined();
    const sliver = tetra.map((p) => ({ ...p, z: p.z * RELATIVE_VOLUME_FLOOR * 0.1 }));
    expect(pointsParity(sliver, PSEUDO_3D_DEPTH)).toBeUndefined();
    expect(pointsParity(tetra, 0)).toBeUndefined();
  });
});
