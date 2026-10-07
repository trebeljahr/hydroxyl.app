/**
 * The three 3D modes as spheres and rods, on real molecules' shapes: the
 * point is that a carbonyl is drawn as two rods in ball and stick and one in
 * stick, that space-fill draws no bonds, and that atoms are sized by element.
 */

import { describe, expect, it } from "vitest";

import type { ConformerResult } from "@/lib/conformer";

import { elementColor, primitives, vdwRadius } from "./primitives";

type Conformer = Extract<ConformerResult, { ok: true }>;

/** Formaldehyde, H2C=O, roughly at its MMFF geometry. */
const FORMALDEHYDE: Conformer = {
  ok: true,
  energy: 0,
  attempts: 1,
  atoms: [
    { element: "C", x: 0, y: 0, z: 0 },
    { element: "O", x: 1.21, y: 0, z: 0 },
    { element: "H", x: -0.55, y: 0.94, z: 0 },
    { element: "H", x: -0.55, y: -0.94, z: 0 },
  ],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ],
};

describe("primitives", () => {
  it("draws the C=O as two parallel rods in ball and stick, split by colour", () => {
    const { rods } = primitives(FORMALDEHYDE, "ball-and-stick");
    // Two rods per drawn line (one half per atom): 2 lines for C=O, 1 each for C–H.
    expect(rods).toHaveLength(2 * 2 + 2 + 2);
    const carbonyl = rods.slice(0, 4);
    expect(carbonyl.map((rod) => rod.color)).toEqual([
      elementColor("C"),
      elementColor("O"),
      elementColor("C"),
      elementColor("O"),
    ]);
    // Spread in the molecule's plane (z = 0), as the drawing would show it.
    for (const rod of carbonyl) expect(rod.from[2]).toBeCloseTo(0, 6);
    expect(carbonyl[0]!.from[1]).not.toBeCloseTo(carbonyl[2]!.from[1], 2);
  });

  it("draws every bond as one rod in stick, whatever its order", () => {
    const { rods, spheres } = primitives(FORMALDEHYDE, "stick");
    expect(rods).toHaveLength(3 * 2);
    expect(new Set(spheres.map((sphere) => sphere.radius)).size).toBe(1);
  });

  it("draws no bonds in space-fill, and sizes atoms by their van der Waals radius", () => {
    const { rods, spheres, extent } = primitives(FORMALDEHYDE, "space-fill");
    expect(rods).toHaveLength(0);
    expect(spheres.map((sphere) => sphere.radius)).toEqual([1.7, 1.52, 1.1, 1.1]);
    expect(extent).toBeCloseTo(1.21 + 1.52, 6);
  });

  it("keeps hydrogen's ball smaller than carbon's", () => {
    const { spheres } = primitives(FORMALDEHYDE, "ball-and-stick");
    expect(spheres[2]!.radius).toBeLessThan(spheres[0]!.radius);
  });

  it("falls back to a stated radius and colour for an element it has no data for", () => {
    expect(vdwRadius("Og")).toBe(2);
    expect(elementColor("Xx")).toBe("#ff1493");
  });
});
