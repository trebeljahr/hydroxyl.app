/**
 * What the 3D view draws, as spheres and cylinders, before any WebGL is
 * involved — so the three rendering modes can be tested in plain node.
 *
 * ── THE THREE MODES ────────────────────────────────────────────────────────
 *
 * Space-fill: every atom a sphere at its van der Waals radius, no bonds.
 * Ball and stick: small spheres (a quarter of the vdW radius, so hydrogens
 * stay smaller than carbons) and bonds as thin rods, double and triple bonds
 * as two or three parallel rods. Stick: every bond one thick rod, every atom
 * a sphere of the same radius so the joints are round; bond order is not
 * drawn, as in every licorice rendering.
 *
 * Rods are split at their midpoint and each half takes its atom's colour, so
 * a C–O bond reads as half grey, half red in both modes that draw bonds.
 *
 * ── RADII ──────────────────────────────────────────────────────────────────
 *
 * Bondi's van der Waals radii (J. Phys. Chem. 1964, 68, 441), with hydrogen
 * at Rowland and Taylor's 1.10 Å (J. Phys. Chem. 1996, 100, 7384), which is
 * what most viewers now use, and Mantina et al.'s values for the main-group
 * elements Bondi left out (J. Phys. Chem. A 2009, 113, 5806). Anything else
 * draws at 2.0 Å — visibly "some atom", never a claim about its size.
 *
 * Colours are chem-core's Jmol/CPK table.
 */

import { elementBySymbol } from "@starter/chem-core";

import type { ConformerResult } from "@/lib/conformer";

export type ThreeDMode = "ball-and-stick" | "stick" | "space-fill";

export const THREE_D_MODES: readonly ThreeDMode[] = Object.freeze([
  "ball-and-stick",
  "stick",
  "space-fill",
]);

export const THREE_D_MODE_TITLES: Readonly<Record<ThreeDMode, string>> = Object.freeze({
  "ball-and-stick": "Ball and stick",
  stick: "Stick",
  "space-fill": "Space-fill",
});

const VDW_RADII: Readonly<Record<string, number>> = Object.freeze({
  H: 1.1,
  He: 1.4,
  Li: 1.82,
  Be: 1.53,
  B: 1.92,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  Ne: 1.54,
  Na: 2.27,
  Mg: 1.73,
  Al: 1.84,
  Si: 2.1,
  P: 1.8,
  S: 1.8,
  Cl: 1.75,
  Ar: 1.88,
  K: 2.75,
  Ca: 2.31,
  Ga: 1.87,
  Ge: 2.11,
  As: 1.85,
  Se: 1.9,
  Br: 1.85,
  Kr: 2.02,
  Rb: 3.03,
  Sr: 2.49,
  In: 1.93,
  Sn: 2.17,
  Sb: 2.06,
  Te: 2.06,
  I: 1.98,
  Xe: 2.16,
});

export const FALLBACK_VDW_RADIUS = 2.0;
const FALLBACK_COLOR = "#ff1493";

const BALL_SCALE = 0.25;
const BALL_BOND_RADIUS = 0.1;
const MULTIPLE_BOND_RADIUS = 0.065;
const MULTIPLE_BOND_SPACING = 0.17;
const STICK_RADIUS = 0.16;

export function vdwRadius(element: string): number {
  return VDW_RADII[element] ?? FALLBACK_VDW_RADIUS;
}

export function elementColor(element: string): string {
  return elementBySymbol(element)?.color ?? FALLBACK_COLOR;
}

export type Vec3 = readonly [number, number, number];

export interface Sphere {
  readonly center: Vec3;
  readonly radius: number;
  readonly color: string;
}

export interface Rod {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
  readonly color: string;
}

export interface Primitives {
  readonly spheres: readonly Sphere[];
  readonly rods: readonly Rod[];
  /** Radius of a sphere around the origin that holds everything drawn. */
  readonly extent: number;
}

type Conformer = Extract<ConformerResult, { ok: true }>;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const size = length(a);
  return size === 0 ? [0, 0, 0] : scale(a, 1 / size);
};

/** Any atom bonded to `atom` other than `exclude`. */
function firstNeighbour(conformer: Conformer, atom: number, exclude: number): number | undefined {
  for (const bond of conformer.bonds) {
    if (bond.a === atom && bond.b !== exclude) return bond.b;
    if (bond.b === atom && bond.a !== exclude) return bond.a;
  }
  return undefined;
}

/**
 * The direction a double bond's rods are spread along: perpendicular to the
 * bond, in the plane of a neighbouring atom, so an alkene's or a carbonyl's
 * rods lie in the plane of its substituents as a drawing would show them.
 */
function spreadDirection(conformer: Conformer, a: number, b: number): Vec3 {
  const at = (i: number): Vec3 => {
    const atom = conformer.atoms[i]!;
    return [atom.x, atom.y, atom.z];
  };
  const axis = unit(sub(at(b), at(a)));
  const neighbour = firstNeighbour(conformer, a, b) ?? firstNeighbour(conformer, b, a);
  let reference: Vec3 = neighbour === undefined ? [0, 0, 1] : sub(at(neighbour), at(a));
  let normal = cross(axis, reference);
  if (length(normal) < 1e-6) {
    reference = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    normal = cross(axis, reference);
  }
  return unit(cross(normal, axis));
}

export function primitives(conformer: Conformer, mode: ThreeDMode): Primitives {
  const position = (i: number): Vec3 => {
    const atom = conformer.atoms[i]!;
    return [atom.x, atom.y, atom.z];
  };
  const spheres: Sphere[] = conformer.atoms.map((atom, i) => ({
    center: position(i),
    color: elementColor(atom.element),
    radius:
      mode === "space-fill"
        ? vdwRadius(atom.element)
        : mode === "stick"
          ? STICK_RADIUS
          : vdwRadius(atom.element) * BALL_SCALE,
  }));

  const rods: Rod[] = [];
  if (mode !== "space-fill") {
    for (const bond of conformer.bonds) {
      const from = position(bond.a);
      const to = position(bond.b);
      const middle = scale(add(from, to), 0.5);
      const colorA = spheres[bond.a]!.color;
      const colorB = spheres[bond.b]!.color;
      const count = mode === "stick" ? 1 : bond.order;
      const radius =
        mode === "stick" ? STICK_RADIUS : count === 1 ? BALL_BOND_RADIUS : MULTIPLE_BOND_RADIUS;
      const spread = count === 1 ? ([0, 0, 0] as Vec3) : spreadDirection(conformer, bond.a, bond.b);
      for (let k = 0; k < count; k++) {
        const offset = scale(spread, (k - (count - 1) / 2) * MULTIPLE_BOND_SPACING);
        rods.push({ from: add(from, offset), to: add(middle, offset), radius, color: colorA });
        rods.push({ from: add(middle, offset), to: add(to, offset), radius, color: colorB });
      }
    }
  }

  const extent = spheres.reduce(
    (max, sphere) => Math.max(max, length(sphere.center) + sphere.radius),
    0,
  );
  return { spheres, rods, extent };
}
