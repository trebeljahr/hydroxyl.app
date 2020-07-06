import { BondTypes } from "../../types";

export interface Vec2D {
  x: number;
  y: number;
}

export function addVector(v1: Vec2D, v2: Vec2D): Vec2D {
  return { x: v1.x + v2.x, y: v1.x + v2.x };
}
export function electronsNeededBy(bondType: string): number {
  switch (bondType) {
    case BondTypes.double:
      return 2;
    case BondTypes.triple:
      return 3;
    case BondTypes.single:
    case BondTypes.wedge:
    case BondTypes.hash:
    case BondTypes.wave:
    default:
      return 1;
  }
}

export function origin(): Vec2D {
  return { x: 0, y: 0 };
}

export const defaultBondLength = 10;

export function vectorFromPolarCoordinates(angle: number, bondLength = 10) {
  return {
    x: bondLength * Math.cos(angle),
    y: bondLength * Math.sin(angle),
  };
}

export function vectorMagnitude(v: Vec2D) {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function getAngleFromVector(v: Vec2D) {
  const length = vectorMagnitude(v);
  return Math.acos(v.x / length);
}

export function getVectorBetweenPoints(p1: Vec2D, p2: Vec2D): Vec2D {
  return {
    x: p1.x - p2.x,
    y: p1.y - p2.y,
  };
}

export function getRightAngleVector(v: Vec2D): Vec2D {
  return {
    x: -v.y,
    y: v.x,
  };
}

export function reverseVector(v: Vec2D): Vec2D {
  return {
    x: -v.x,
    y: -v.y,
  };
}

export const trim = (str: String): String => str.replace(/\s+/g, "");
