/**
 * Bond geometry: trimming, the second and third lines, the aromatic circle.
 *
 * The assertions here are about a PICTURE, so they are written as geometry a
 * chemist could check by eye — "the inner line is nearer the ring centroid
 * than the axis is", "the line stops short of the O" — rather than as
 * coordinate literals. A coordinate literal pins whatever the code did on the
 * day it was written; the goldens already do that, and this file is the layer
 * that says whether what it did was right.
 */

import {
  addAtom,
  addBond,
  benzene,
  buildMolecule,
  DEG,
  emptyMolecule,
  flipBond,
  fromPolar,
  getAtom,
  ORIGIN,
  readMolblock,
  ringCentroid,
  ringsAtBond,
  setAtomPosition,
  updateBond,
  writeMolblock,
} from "@starter/chem-core";
import type { BondId, Molecule, Vec2 } from "@starter/chem-core";
import { describe, expect, it } from "vitest";

import { insetForVertex, leftNormal } from "../src/bond/geometry.js";
import { inscribedCircle } from "../src/bond/aromatic.js";
import { resolveDoubleBondSide } from "../src/bond/doubleBond.js";
import {
  acetate,
  chrysene,
  dimethylSulfone,
  ethanol,
  naphthalene,
} from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { atomLabelPlacement, buildScene } from "../src/scene/build.js";
import type { LinePrimitive, RenderScene, ScenePoint } from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";

const SKELETAL = representation("skeletal");
const CIRCLES = representation("skeletal", { aromaticCircles: true });

function linesOf(scene: RenderScene, bondId: BondId): LinePrimitive[] {
  return scene.primitives.filter(
    (p): p is LinePrimitive =>
      p.type === "line" && p.source.kind === "bond" && p.source.bondId === bondId,
  );
}

function midpoint(line: LinePrimitive): ScenePoint {
  return { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
}

function lengthOf(line: LinePrimitive): number {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** One unit-length step from `from`, at `degrees` counter-clockwise from +x. */
function step(from: Vec2, degrees: number): Vec2 {
  return { x: from.x + fromPolar(degrees * DEG, 1).x, y: from.y + fromPolar(degrees * DEG, 1).y };
}

describe("double bonds in a ring", () => {
  it("leans every benzene double bond toward the ring centroid", () => {
    const mol = benzene();
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    const centre = modelToPx(PUBLICATION_STYLE, ringCentroid(mol, 0));

    let doubles = 0;
    for (const bondId of mol.bondIds) {
      const lines = linesOf(scene, bondId);
      if (mol.bonds[bondId]?.order !== 2) {
        expect(lines).toHaveLength(1);
        continue;
      }
      doubles++;
      expect(lines).toHaveLength(2);
      const [axis, inner] = lines as [LinePrimitive, LinePrimitive];
      // The whole claim, as one comparison: the second line is closer to the
      // centre of the ring than the bond it belongs to is.
      expect(distance(midpoint(inner), centre)).toBeLessThan(
        distance(midpoint(axis), centre) - 1,
      );
      // And it stops short of the vertices, or a benzene reads as a hexagon
      // with three lines poking through its corners.
      expect(lengthOf(inner)).toBeLessThan(lengthOf(axis) - 1);
    }
    expect(doubles).toBe(3);
  });

  it("insets the inner line to the inset hexagon exactly", () => {
    // A regular hexagon inset by g is the same hexagon scaled by
    // (apothem - g) / apothem, so its edge is shorter by that factor. This is
    // the one place a number is asserted, because it is derivable rather than
    // observed: getting the vertex half-angle wrong is a silent, plausible
    // -looking error that no "is it inside the ring" test would catch.
    const mol = benzene();
    const style = PUBLICATION_STYLE;
    const scene = buildScene(mol, style, SKELETAL);
    const apothem = (Math.sqrt(3) / 2) * style.bondLengthPx;
    const expected =
      style.bondLengthPx * ((apothem - style.doubleBondGapPx) / apothem);

    for (const bondId of mol.bondIds) {
      if (mol.bonds[bondId]?.order !== 2) continue;
      const inner = linesOf(scene, bondId)[1]!;
      expect(lengthOf(inner)).toBeCloseTo(expected, 9);
    }
  });

  it("draws naphthalene's central fusion bond centred", () => {
    // Two aromatic six-rings pull it in opposite directions, and the
    // topological key ties. Centred is the only mirror-equivariant answer, and
    // it is how the ring system is drawn.
    const mol = naphthalene();
    const fusion = mol.bondIds.find(
      (id) => mol.bonds[id]?.order === 2 && ringsAtBond(mol, id).length === 2,
    );
    expect(fusion).toBeDefined();
    expect(resolveDoubleBondSide(mol, fusion!)).toEqual({ kind: "centered" });

    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    const [first, second] = linesOf(scene, fusion!) as [LinePrimitive, LinePrimitive];
    const bond = mol.bonds[fusion!]!;
    const axisMid = {
      x:
        (modelToPx(PUBLICATION_STYLE, getAtom(mol, bond.from)!.pos).x +
          modelToPx(PUBLICATION_STYLE, getAtom(mol, bond.to)!.pos).x) /
        2,
      y:
        (modelToPx(PUBLICATION_STYLE, getAtom(mol, bond.from)!.pos).y +
          modelToPx(PUBLICATION_STYLE, getAtom(mol, bond.to)!.pos).y) /
        2,
    };
    // Symmetric about the axis, and equally long.
    expect(distance(midpoint(first), axisMid)).toBeCloseTo(
      distance(midpoint(second), axisMid),
      9,
    );
    expect(lengthOf(first)).toBeCloseTo(lengthOf(second), 9);
  });

  it("keeps every chrysene inner line inside its own ring", () => {
    const mol = chrysene();
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    for (const bondId of mol.bondIds) {
      if (mol.bonds[bondId]?.order !== 2) continue;
      const ringIndices = ringsAtBond(mol, bondId);
      const lines = linesOf(scene, bondId);
      if (ringIndices.length !== 1) continue;
      const centre = modelToPx(
        PUBLICATION_STYLE,
        ringCentroid(mol, ringIndices[0]!),
      );
      const [axis, inner] = lines as [LinePrimitive, LinePrimitive];
      expect(distance(midpoint(inner), centre)).toBeLessThan(
        distance(midpoint(axis), centre),
      );
    }
  });
});

describe("double bonds outside a ring", () => {
  it("draws a chain C=C centred at both presets", () => {
    // trans-2-butene: one substituent on each carbon, on opposite sides, so
    // the counts tie at 1-1 and there is nothing to lean toward.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      const c3Pos = step(c2Pos, -30);
      const c3 = b.atom("C", c3Pos);
      const c4 = b.atom("C", step(c3Pos, 30));
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 2);
      b.bond(c3, c4, 1);
    });
    const alkene = mol.bondIds[1]!;
    expect(resolveDoubleBondSide(mol, alkene)).toEqual({ kind: "centered" });

    for (const style of [PUBLICATION_STYLE, SCREEN_STYLE]) {
      const lines = linesOf(buildScene(mol, style, SKELETAL), alkene);
      expect(lines).toHaveLength(2);
      expect(lengthOf(lines[0]!)).toBeCloseTo(lengthOf(lines[1]!), 9);
    }
  });

  it("leans a cis alkene into the pocket its substituents make", () => {
    // Both methyls on the same side of the axis: 2-0, so the second line goes
    // between them, which is where a chemist draws it.
    const mol = buildMolecule((b) => {
      const c2 = b.atom("C", ORIGIN);
      const c3Pos: Vec2 = { x: 1, y: 0 };
      const c3 = b.atom("C", c3Pos);
      b.bond(c2, c3, 2);
      b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
      b.bond(c3, b.atom("C", step(c3Pos, 60)), 1);
    });
    const resolution = resolveDoubleBondSide(mol, mol.bondIds[0]!);
    expect(resolution.kind).toBe("toward");
    if (resolution.kind !== "toward") throw new Error("unreachable");
    // The substituents are at +y in model space; so is the mean it leans to.
    expect(resolution.point.y).toBeGreaterThan(0);
  });

  it("draws a carbonyl centred, ring atom or not", () => {
    // Acetate's C=O: the oxygen is terminal, so there is no enclosed region
    // for an inner line and a leaning C=O reads as a drawing error.
    const mol = acetate();
    const carbonyl = mol.bondIds.find((id) => mol.bonds[id]?.order === 2)!;
    expect(resolveDoubleBondSide(mol, carbonyl)).toEqual({ kind: "centered" });

    // Cyclohexanone: the carbon IS in a ring but the BOND is not, which is
    // what keeps `isRingAtom` out of the rule. Leaning it into the ring is the
    // classic version of this bug.
    const ring = benzene();
    const anchor = ring.atomIds[0]!;
    const anchorPos = getAtom(ring, anchor)!.pos;
    const withOxygen = addAtom(ring, {
      element: "O",
      pos: { x: anchorPos.x * 2, y: anchorPos.y * 2 },
    });
    const exocyclic = addBond(withOxygen.molecule, {
      from: anchor,
      to: withOxygen.id,
      order: 2,
    });
    expect(resolveDoubleBondSide(exocyclic.molecule, exocyclic.id)).toEqual({
      kind: "centered",
    });
  });

  it("draws both of a sulfone's S=O centred", () => {
    const mol = dimethylSulfone();
    for (const bondId of mol.bondIds) {
      if (mol.bonds[bondId]?.order !== 2) continue;
      expect(resolveDoubleBondSide(mol, bondId)).toEqual({ kind: "centered" });
    }
  });

  it("ignores a neighbour lying on the bond axis", () => {
    // Tetramethylallene, R2C=C=CR2. The central carbon's far neighbour is
    // collinear with each double bond, and the sign of its offset is float
    // noise: without the on-axis bucket every allene picks a side at random.
    const mol = buildMolecule((b) => {
      const left = b.atom("C", { x: -1, y: 0 });
      const centre = b.atom("C", ORIGIN);
      const right = b.atom("C", { x: 1, y: 0 });
      b.bond(left, centre, 2);
      b.bond(centre, right, 2);
      b.bond(left, b.atom("C", { x: -1.5, y: 0.866 }), 1);
      b.bond(left, b.atom("C", { x: -1.5, y: -0.866 }), 1);
      b.bond(right, b.atom("C", { x: 1.5, y: 0.866 }), 1);
      b.bond(right, b.atom("C", { x: 1.5, y: -0.866 }), 1);
    });
    expect(resolveDoubleBondSide(mol, mol.bondIds[0]!)).toEqual({ kind: "centered" });
    expect(resolveDoubleBondSide(mol, mol.bondIds[1]!)).toEqual({ kind: "centered" });
  });

  it("honours a manual left or right, and mirrors under flipBond", () => {
    // `left`/`right` are relative to the bond's own direction (transform.ts),
    // so swapping `from` and `to` MUST move the line. `flipBond` is documented
    // as the gesture that moves a pinned inner line by hand, and quietly
    // compensating would make the button do nothing.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", { x: 1, y: 0 });
      b.bond(c1, c2, 2);
    });
    const bondId = mol.bondIds[0]!;
    const pinned = updateBond(mol, bondId, { doubleBondSide: "left" });
    const left = resolveDoubleBondSide(pinned, bondId);
    expect(left.kind).toBe("toward");
    if (left.kind !== "toward") throw new Error("unreachable");
    // from -> to points along +x in y-up model space, so left is +y.
    expect(left.point.y).toBeGreaterThan(0);

    const flipped = resolveDoubleBondSide(flipBond(pinned, bondId), bondId);
    if (flipped.kind !== "toward") throw new Error("unreachable");
    expect(flipped.point.y).toBeLessThan(0);
  });

  it("leaves an AUTO bond where it is when the bond is flipped", () => {
    // The other half of the same rule: a resolution derived from POSITIONS is
    // direction-independent, so `flipBond` on an auto bond is a visible no-op.
    // It is `left`/`right` that the gesture moves.
    const mol = benzene();
    const bondId = mol.bondIds.find((id) => mol.bonds[id]?.order === 2)!;
    expect(resolveDoubleBondSide(flipBond(mol, bondId), bondId)).toEqual(
      resolveDoubleBondSide(mol, bondId),
    );
  });
});

describe("triple bonds", () => {
  it("draws three lines, centred, a full gap apart", () => {
    // But-2-yne. The outer pair sits a FULL gap out rather than half of one,
    // so the line-to-line spacing matches a centred double bond's; half a gap
    // would make every alkyne read as a slightly thick double.
    const mol = buildMolecule((b) => {
      const c2 = b.atom("C", ORIGIN);
      const c3 = b.atom("C", { x: 1, y: 0 });
      b.bond(c2, c3, 3);
    });
    const style = PUBLICATION_STYLE;
    const lines = linesOf(buildScene(mol, style, SKELETAL), mol.bondIds[0]!);
    expect(lines).toHaveLength(3);
    const ys = lines.map((l) => l.a.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeCloseTo(style.doubleBondGapPx, 9);
    expect(ys[2]! - ys[1]!).toBeCloseTo(style.doubleBondGapPx, 9);
    for (const line of lines) expect(lengthOf(line)).toBeCloseTo(lengthOf(lines[0]!), 9);
  });
});

describe("trimming against a label", () => {
  function trimmedEnds(mol: Molecule, style = PUBLICATION_STYLE) {
    const scene = buildScene(mol, style, SKELETAL);
    return mol.bondIds.map((bondId) => {
      const bond = mol.bonds[bondId]!;
      const line = linesOf(scene, bondId)[0]!;
      return {
        bondId,
        from: modelToPx(style, getAtom(mol, bond.from)!.pos),
        to: modelToPx(style, getAtom(mol, bond.to)!.pos),
        line,
        placementTo: atomLabelPlacement(mol, bond.to, style, SKELETAL),
      };
    });
  }

  it("stops short of an OH on a diagonal bond", () => {
    // Ethanol's C-O runs at -30 degrees into a hydroxyl that sets "OH".
    const mol = ethanol();
    const [, cToO] = trimmedEnds(mol);
    expect(cToO!.placementTo).toBeDefined();
    const gap = distance(cToO!.line.b, cToO!.to);
    expect(gap).toBeGreaterThan(PUBLICATION_STYLE.labelPaddingPx);
    // The end sits OUTSIDE the label's obstacles, which is the actual claim —
    // "some distance short" would pass with the line still through the O.
    for (const obstacle of cToO!.placementTo!.obstacles) {
      if (obstacle.kind !== "rect") continue;
      // Strictly inside: the trimmed end lands exactly ON the far edge of the
      // obstacle it exited, which is the whole point of an exact ray-exit.
      const epsilon = 1e-9;
      const inside =
        cToO!.line.b.x > obstacle.box.minX + epsilon &&
        cToO!.line.b.x < obstacle.box.maxX - epsilon &&
        cToO!.line.b.y > obstacle.box.minY + epsilon &&
        cToO!.line.b.y < obstacle.box.maxY - epsilon;
      expect(inside).toBe(false);
    }
    // And it did not overshoot past the atom it was heading for.
    expect(distance(cToO!.line.a, cToO!.line.b)).toBeLessThan(
      distance(cToO!.from, cToO!.to),
    );
  });

  it("stops short of an OH on an axis-aligned bond", () => {
    // The slab test divides by the direction component, so a perfectly
    // horizontal or vertical bond is the one that finds a missing d === 0
    // branch. methanol-13C is drawn horizontal for exactly this reason.
    const mol = buildMolecule((b) => {
      const carbon = b.atom("C", ORIGIN);
      b.bond(carbon, b.atom("O", { x: 1, y: 0 }), 1);
    });
    const [horizontal] = trimmedEnds(mol);
    expect(distance(horizontal!.line.b, horizontal!.to)).toBeGreaterThan(
      PUBLICATION_STYLE.labelPaddingPx,
    );

    const vertical = buildMolecule((b) => {
      const carbon = b.atom("C", ORIGIN);
      b.bond(carbon, b.atom("O", { x: 0, y: 1 }), 1);
    });
    const [up] = trimmedEnds(vertical);
    expect(distance(up!.line.b, up!.to)).toBeGreaterThan(
      PUBLICATION_STYLE.labelPaddingPx,
    );
  });

  it("does not trim at a bare vertex", () => {
    // Benzene is all bare carbons, so every line still runs centre to centre.
    const mol = benzene();
    for (const entry of trimmedEnds(mol)) {
      expect(entry.line.a).toEqual(entry.from);
      expect(entry.line.b).toEqual(entry.to);
    }
  });

  it("draws no line at all when the two labels meet", () => {
    // A bond so short that both clear boxes cover it. A minimum stub would
    // fabricate geometry the author did not draw and the picture would lie; a
    // zero-length line paints a dot, which is the radical notation.
    const mol = buildMolecule((b) => {
      const o1 = b.atom("O", ORIGIN);
      b.bond(o1, b.atom("O", { x: 0.02, y: 0 }), 1);
    });
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    expect(linesOf(scene, mol.bondIds[0]!)).toHaveLength(0);
  });

  it("draws no line between two coincident atoms", () => {
    // No axis, so every division is NaN — which survives silently all the way
    // to `formatNumber` and throws there, pointing nowhere near the cause.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", ORIGIN);
      b.bond(a, b.atom("C", ORIGIN), 1);
    });
    const scene = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    expect(linesOf(scene, mol.bondIds[0]!)).toHaveLength(0);
    // And the scene still serialises, which is the failure this guards.
    expect(() => serializeScene(scene)).not.toThrow();
  });
});

describe("aromatic circles", () => {
  it("replaces the alternation with one circle whose radius matches the ring", () => {
    const mol = benzene();
    const kekule = buildScene(mol, PUBLICATION_STYLE, SKELETAL);
    const circled = buildScene(mol, PUBLICATION_STYLE, CIRCLES);

    expect(kekule.primitives.filter((p) => p.type === "line")).toHaveLength(9);
    // Six plain edges: every second line is gone, replaced by one circle.
    expect(circled.primitives.filter((p) => p.type === "line")).toHaveLength(6);

    const ringCircles = circled.primitives.filter(
      (p) => p.type === "circle" && p.source.kind === "ring",
    );
    expect(ringCircles).toHaveLength(1);
    const circle = ringCircles[0]!;
    if (circle.type !== "circle") throw new Error("unreachable");

    const apothem = (Math.sqrt(3) / 2) * PUBLICATION_STYLE.bondLengthPx;
    expect(circle.radius).toBeCloseTo(
      PUBLICATION_STYLE.aromaticCircleRatio * apothem,
      9,
    );
    // The centroid of the converted points, not the conversion of the
    // centroid: `modelToPx` is linear so they agree, but not bit for bit.
    const centroid = modelToPx(PUBLICATION_STYLE, ringCentroid(mol, 0));
    expect(circle.centre.x).toBeCloseTo(centroid.x, 9);
    expect(circle.centre.y).toBeCloseTo(centroid.y, 9);
    // Inside every vertex, which is the property "matches the perceived ring"
    // has to mean for a ring that is not a regular polygon.
    for (const atomId of mol.atomIds) {
      const vertex = modelToPx(PUBLICATION_STYLE, getAtom(mol, atomId)!.pos);
      expect(distance(vertex, circle.centre)).toBeGreaterThan(circle.radius);
    }
  });

  it("names the circle by its atom set, never by a ring index", () => {
    const scene = buildScene(benzene(), PUBLICATION_STYLE, CIRCLES);
    const circle = scene.primitives.find((p) => p.source.kind === "ring")!;
    expect(circle.id).toBe("ring:a1+a2+a3+a4+a5+a6:aromaticCircle");
    expect(circle.source).toEqual({
      kind: "ring",
      atomIds: ["a1", "a2", "a3", "a4", "a5", "a6"],
    });
  });

  it("gives naphthalene two circles and no inner lines at all", () => {
    const mol = naphthalene();
    const scene = buildScene(mol, PUBLICATION_STYLE, CIRCLES);
    expect(
      scene.primitives.filter((p) => p.source.kind === "ring"),
    ).toHaveLength(2);
    expect(scene.primitives.filter((p) => p.type === "line")).toHaveLength(
      mol.bondIds.length,
    );
  });

  it("keeps the alternation on a ring too distorted for a circle", () => {
    // Perception is purely topological and position-blind, so it will hand
    // this pass a ring whose drawn geometry is nonsense. Below the floor the
    // circle is barely thicker than the strokes around it: drawing it is worse
    // than not, and nudging the atoms apart is forbidden.
    const mol = benzene();
    // Squashed flat: the ring is still perceived (perception never looks at a
    // coordinate) but there is no room inside it for anything.
    let collapsed = mol;
    for (const atomId of mol.atomIds) {
      const pos = getAtom(mol, atomId)!.pos;
      collapsed = setAtomPosition(collapsed, atomId, { x: pos.x, y: pos.y * 0.02 });
    }
    const scene = buildScene(collapsed, PUBLICATION_STYLE, CIRCLES);
    expect(scene.primitives.filter((p) => p.source.kind === "ring")).toHaveLength(0);
    // Not a bare hexagon with nothing inside it: the double bonds are back.
    expect(
      scene.primitives.filter((p) => p.id.endsWith(":line2")).length,
    ).toBeGreaterThan(0);
  });

  it("uses the nearest EDGE, not the nearest vertex", () => {
    // A concave ring: the vertex dragged across the ring leaves the nearest
    // BOND much closer to the centroid than the nearest VERTEX is, so a
    // circumradius fraction would draw the circle straight through a bond.
    const square: ScenePoint[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    expect(inscribedCircle(square, 1, 0)!.radius).toBeCloseTo(10, 9);
    const pinched: ScenePoint[] = [...square];
    pinched[2] = { x: 1, y: 1 };
    const circle = inscribedCircle(pinched, 1, 0)!;
    // The nearest vertex is 1.4 away; the nearest edge is nearer still, and
    // the radius has to follow the edge.
    expect(circle.radius).toBeLessThan(
      Math.min(...pinched.map((p) => distance(p, circle.centre))),
    );
  });

  it("leaves an exocyclic double bond's second line alone", () => {
    // Suppression is keyed on membership of a CIRCLED ring, not on
    // aromaticity, so styrene's vinyl keeps both its lines.
    const ring = benzene();
    const anchor = ring.atomIds[0]!;
    const anchorPos = getAtom(ring, anchor)!.pos;
    const added = addAtom(ring, {
      element: "C",
      pos: { x: anchorPos.x * 2, y: anchorPos.y * 2 },
    });
    const styrene = addBond(added.molecule, {
      from: anchor,
      to: added.id,
      order: 2,
    });
    const scene = buildScene(styrene.molecule, PUBLICATION_STYLE, CIRCLES);
    expect(linesOf(scene, styrene.id)).toHaveLength(2);
  });
});

describe("determinism", () => {
  it("serialises the same molecule twice byte for byte", () => {
    for (const rep of [SKELETAL, CIRCLES]) {
      const a = serializeScene(buildScene(chrysene(), PUBLICATION_STYLE, rep));
      const b = serializeScene(buildScene(chrysene(), PUBLICATION_STYLE, rep));
      expect(a).toBe(b);
    }
  });

  it("resolves every side the same way for two constructions of one molecule", () => {
    // The assertion that actually bites. Two builds of the SAME molecule share
    // their ids, so they cannot catch a rule keyed on an id, an index or a
    // list position — chem-core's own rings.test.ts says as much and builds
    // naphthalene two ways for the same reason.
    //
    // Comparing SVG bytes across constructions is not available: two builds
    // mint different atom and bond ids and primitive ids derive from them, by
    // design. So the verdicts are keyed on the bond's own endpoint POSITIONS,
    // which is the physical decision rather than the bookkeeping.
    const original = naphthalene();
    const rebuilt = rebuildInReverse(original);
    const roundTripped = readMolblock(writeMolblock(original)).molecule;

    const reference = verdictsByPosition(original);
    expect(verdictsByPosition(rebuilt)).toEqual(reference);
    // A molblock rounds coordinates to four decimals, which is enough to break
    // naphthalene's fusion symmetry by ~0.001 px. A distance-based tiebreak
    // would flip the central bond the first time a figure was saved and
    // reopened; the topological key cannot.
    expect(verdictsByPosition(roundTripped)).toEqual(reference);
  });

  /** The same atoms and bonds, inserted back to front. Different ids. */
  function rebuildInReverse(mol: Molecule): Molecule {
    const oldToNew = new Map<string, string>();
    let out = emptyMolecule();
    for (const atomId of [...mol.atomIds].reverse()) {
      const atom = getAtom(mol, atomId)!;
      const added = addAtom(out, { element: atom.element, pos: atom.pos });
      out = added.molecule;
      oldToNew.set(atomId, added.id);
    }
    for (const bondId of [...mol.bondIds].reverse()) {
      const bond = mol.bonds[bondId]!;
      out = addBond(out, {
        from: oldToNew.get(bond.to)!,
        to: oldToNew.get(bond.from)!,
        order: bond.order,
      }).molecule;
    }
    return out;
  }

  /** Each double bond's verdict, keyed on where the bond physically is. */
  function verdictsByPosition(mol: Molecule): Record<string, string> {
    const round = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);
    const out: Record<string, string> = {};
    for (const bondId of mol.bondIds) {
      if (mol.bonds[bondId]?.order !== 2) continue;
      const bond = mol.bonds[bondId]!;
      const from = getAtom(mol, bond.from)!.pos;
      const to = getAtom(mol, bond.to)!.pos;
      const keyFrom = `${round(from.x)},${round(from.y)}`;
      const keyTo = `${round(to.x)},${round(to.y)}`;
      // Both the key and the handedness are taken along the SORTED endpoints.
      // A rebuild can relabel `from` and `to`, and `left`/`right` are relative
      // to the bond's own direction, so reading the sign off `from`->`to`
      // would report a flip where the drawing is identical.
      const forward = keyFrom < keyTo;
      const [a, b] = forward ? [from, to] : [to, from];
      const resolution = resolveDoubleBondSide(mol, bondId);
      out[[keyFrom, keyTo].sort().join("|")] =
        resolution.kind === "centered"
          ? "centered"
          : // The physical direction it leans, not the point itself: the point
            // is a centroid in one construction and the same centroid in the
            // other, but rounding differs after a molblock round trip.
            leanSign(a, b, resolution.point);
    }
    return out;
  }

  function leanSign(from: Vec2, to: Vec2, point: Vec2): string {
    const cross =
      (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
    return cross > 0 ? "left" : "right";
  }
});

describe("the geometry helpers on their own", () => {
  it("gives the textbook inset at a 120-degree vertex", () => {
    // offset / tan(60 degrees).
    const east: ScenePoint = { x: 1, y: 0 };
    const upLeft: ScenePoint = { x: -0.5, y: -Math.sqrt(3) / 2 };
    expect(insetForVertex(east, upLeft, 4.2)).toBeCloseTo(4.2 / Math.tan(Math.PI / 3), 9);
    // A right-angle vertex insets by the whole offset.
    expect(insetForVertex(east, { x: 0, y: -1 }, 4.2)).toBeCloseTo(4.2, 9);
    // Collinear: nothing to inset against.
    expect(insetForVertex(east, { x: -1, y: 0 }, 4.2)).toBe(0);
  });

  it("puts the left normal visually up for an eastward bond", () => {
    // y is already flipped here, so the textbook (-y, x) would point the other
    // way. Walking east on the page, left is up, which is scene -y.
    expect(leftNormal({ x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
  });
});
