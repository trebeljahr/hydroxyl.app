import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain } from "./builders.js";
import {
  DEFAULT_ATOM_TOLERANCE,
  DEFAULT_LABEL_RADIUS,
  atomsInRect,
  bondsInRect,
  hitTest,
  nearestAtom,
  nearestBond,
  rectFromCorners,
} from "./hit.js";
import type { Bond, Molecule } from "./types.js";
import { distance, lerp, midpoint, vec, type Vec2 } from "./vec.js";

/** Endpoint coordinates of a bond, which every geometric assertion here needs. */
function ends(mol: Molecule, bond: Bond): { from: Vec2; to: Vec2 } {
  return { from: mol.atoms[bond.from]!.pos, to: mol.atoms[bond.to]!.pos };
}

function firstBond(mol: Molecule): Bond {
  return mol.bonds[mol.bondIds[0]!]!;
}

describe("hitTest on benzene", () => {
  const mol = benzene(1);
  const bond = firstBond(mol);
  const { from, to } = ends(mol, bond);

  it("picks the bond when the pointer is on its midpoint", () => {
    const mid = midpoint(from, to);
    // The premise: on a unit ring the midpoint is half a bond from either
    // vertex, well outside the 0.18 + 0.12 default atom target.
    expect(distance(mid, from)).toBeCloseTo(0.5, 12);
    expect(DEFAULT_LABEL_RADIUS + DEFAULT_ATOM_TOLERANCE).toBeLessThan(0.5);

    const hit = hitTest(mol, mid);
    expect(hit.kind).toBe("bond");
    if (hit.kind !== "bond") return;
    expect(hit.bondId).toBe(bond.id);
    expect(hit.distance).toBeCloseTo(0, 12);
    expect(hit.t).toBeCloseTo(0.5, 12);
  });

  it("picks the atom when an injected label radius reaches that far", () => {
    // 0.4 of a bond out from a carbon: inside a label drawn 0.6 wide, so the
    // renderer-measured radius is what flips the priority to the atom.
    const p = lerp(from, to, 0.4);
    const hit = hitTest(mol, p, { labelRadius: () => 0.6 });
    expect(hit.kind).toBe("atom");
    if (hit.kind !== "atom") return;
    expect(hit.atomId).toBe(bond.from);
    expect(hit.distance).toBeCloseTo(0.4, 12);
  });

  it("keeps that same point bond-hittable at the default radius", () => {
    // Acceptance criterion: a bare-vertex carbon must not swallow the bond
    // leading into it, or "click a bond to promote it to a double" dies.
    const p = lerp(from, to, 0.4);
    const hit = hitTest(mol, p);
    expect(hit.kind).toBe("bond");
    if (hit.kind !== "bond") return;
    expect(hit.bondId).toBe(bond.id);
    expect(hit.t).toBeCloseTo(0.4, 12);
  });

  it("picks the atom when the pointer is on its centre", () => {
    const hit = hitTest(mol, from);
    expect(hit.kind).toBe("atom");
    if (hit.kind !== "atom") return;
    expect(hit.atomId).toBe(bond.from);
    expect(hit.distance).toBe(0);
  });

  it("reports nothing when the pointer is off the structure", () => {
    expect(hitTest(mol, vec(10, 10)).kind).toBe("none");
  });
});

describe("hitTest with per-atom label sizes", () => {
  /**
   * A methoxy group: the chain carbon keeps its vertex, and the renderer
   * folds the terminal methyl into one wide "OCH3" glyph on the oxygen. The
   * two atoms are therefore drawn at very different sizes, which is the whole
   * reason `labelRadius` is injected per atom rather than fixed globally.
   */
  const methoxy = buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    const o = b.atom("O", vec(1, 0));
    b.bond(c, o, 1);
  });
  const radii: Record<string, number> = { a1: 0.4, a2: 0.72 };
  const labelRadius = (id: string): number => radii[id] ?? DEFAULT_LABEL_RADIUS;

  it("picks the atom whose glyph the pointer is inside, not the nearer centre", () => {
    const p = vec(0.45, 0);
    // The premise, spelled out so a regression cannot be read as a rounding
    // change: the pointer is OUTSIDE the carbon's "CH3" (0.45 > 0.40, it only
    // qualifies at all through the tolerance slack) and comfortably INSIDE
    // the oxygen's "OCH3" (0.55 < 0.72) — while being nearer the carbon.
    expect(distance(p, methoxy.atoms["a1"]!.pos)).toBeCloseTo(0.45, 12);
    expect(distance(p, methoxy.atoms["a2"]!.pos)).toBeCloseTo(0.55, 12);
    expect(0.45).toBeLessThan(0.55);
    expect(0.45).toBeLessThan(0.4 + DEFAULT_ATOM_TOLERANCE);

    const hit = hitTest(methoxy, p, { labelRadius });
    expect(hit.kind).toBe("atom");
    if (hit.kind !== "atom") return;
    expect(hit.atomId).toBe("a2");
    // The reported distance stays the true centre distance — penetration is a
    // ranking key, not something callers see.
    expect(hit.distance).toBeCloseTo(0.55, 12);
  });

  it("still picks the near atom once the pointer is inside its glyph too", () => {
    // Deeper into the carbon: -0.20 penetration against the oxygen's +0.08,
    // so ranking by glyph does not simply mean "the widest label always wins".
    const p = vec(0.2, 0);
    const hit = hitTest(methoxy, p, { labelRadius });
    expect(hit.kind).toBe("atom");
    if (hit.kind !== "atom") return;
    expect(hit.atomId).toBe("a1");
  });
});

describe("nearestAtom / nearestBond", () => {
  it("returns undefined only for an empty structure", () => {
    const empty = buildMolecule(() => {});
    expect(nearestAtom(empty, vec(0, 0))).toBeUndefined();
    expect(nearestBond(empty, vec(0, 0))).toBeUndefined();
  });

  it("ignores tolerances and reports the nearest atom at any distance", () => {
    const mol = benzene(1);
    const hit = nearestAtom(mol, vec(0, 50));
    expect(hit?.atomId).toBe("a4"); // the top vertex of a flat-bottomed ring
    expect(hit?.distance).toBeCloseTo(49, 12);
  });

  it("clamps to the start endpoint for a point off the front of a chain", () => {
    // Propane: without the clamp, a point far off one end measures to the
    // infinite line and both bonds look equally close.
    const propane = linearChain(3);
    const hit = nearestBond(propane, vec(-2, 0));
    expect(hit?.bondId).toBe(propane.bondIds[0]);
    expect(hit?.t).toBe(0);
    // Atoms and bonds share one counter, so the chain's atoms are a1, a2, a4 —
    // index into atomIds rather than guessing the id.
    expect(hit?.point).toEqual(propane.atoms[propane.atomIds[0]!]!.pos);
  });

  it("clamps to the end endpoint for a point off the back of a chain", () => {
    const propane = linearChain(3);
    const hit = nearestBond(propane, vec(4, -0.5));
    expect(hit?.bondId).toBe(propane.bondIds[1]);
    expect(hit?.t).toBe(1);
    expect(hit?.point).toEqual(propane.atoms[propane.atomIds[2]!]!.pos);
  });
});

describe("marquee selection", () => {
  const mol = benzene(1);
  // Upper half of a flat-bottomed ring: a3 (right-upper), a4 (top), a5
  // (left-upper). a1/a2/a6 all sit at negative y.
  const expected = ["a3", "a4", "a5"];

  it("selects the atoms inside the box, in insertion order", () => {
    const rect = rectFromCorners(vec(-2, 0), vec(2, 2));
    expect(atomsInRect(mol, rect)).toEqual(expected);
  });

  it("does not care which way the drag went", () => {
    const downRight = rectFromCorners(vec(-2, 0), vec(2, 2));
    const upLeft = rectFromCorners(vec(2, 2), vec(-2, 0));
    expect(upLeft).toEqual(downRight);
    expect(atomsInRect(mol, upLeft)).toEqual(atomsInRect(mol, downRight));
  });

  it("includes atoms exactly on the boundary", () => {
    const top = mol.atoms["a4"]!.pos;
    const rect = rectFromCorners(top, vec(2, 2));
    expect(atomsInRect(mol, rect)).toContain("a4");
  });

  it("takes only bonds with both endpoints inside", () => {
    const rect = rectFromCorners(vec(-2, 0), vec(2, 2));
    const selected = bondsInRect(mol, rect);
    for (const bondId of selected) {
      const bond = mol.bonds[bondId]!;
      expect(expected).toContain(bond.from);
      expect(expected).toContain(bond.to);
    }
    // a3-a4 and a4-a5; the two bonds crossing y = 0 are excluded.
    expect(selected).toHaveLength(2);
  });
});

describe("degenerate geometry", () => {
  it("does not produce NaN for a bond whose atoms share a position", () => {
    // An import with duplicate coordinates, or a paste onto itself.
    const stacked = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const o = b.atom("O", vec(0, 0));
      b.bond(c, o, 1);
    });

    const hit = nearestBond(stacked, vec(3, 4));
    expect(hit).toBeDefined();
    expect(Number.isNaN(hit!.distance)).toBe(false);
    expect(hit!.distance).toBeCloseTo(5, 12);
    expect(hit!.t).toBe(0);
    expect(hit!.point).toEqual({ x: 0, y: 0 });

    // And picking still resolves: coincident atoms tie, and the later one —
    // the one drawn on top — wins.
    const atom = hitTest(stacked, vec(0, 0));
    expect(atom.kind).toBe("atom");
    if (atom.kind !== "atom") return;
    expect(atom.atomId).toBe("a2");
  });
});
