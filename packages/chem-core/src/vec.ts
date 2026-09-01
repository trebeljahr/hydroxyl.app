/**
 * 2D vector math for molecule layout.
 *
 * COORDINATE CONVENTION: y is UP.
 *
 * This matches molfile/SDF and ordinary maths, so angle arithmetic reads the
 * way chemists draw it (60 degrees points up-and-right) and molfile IO needs
 * no flipping. The SVG renderer is the only place that flips to y-down.
 *
 * Lengths are in abstract bond-length units: 1.0 is one standard bond. The
 * renderer decides what that is in px/pt for a given style preset.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product. Sign gives turn direction:
 *  positive => b is counter-clockwise from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return lengthSq(sub(a, b));
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

/** Unit vector. Returns ORIGIN for a zero vector rather than NaN. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? ORIGIN : { x: v.x / len, y: v.y / len };
}

/** Rescale to an exact length. Zero vectors stay zero. */
export function withLength(v: Vec2, len: number): Vec2 {
  return scale(normalize(v), len);
}

export function fromPolar(angle: number, len = 1): Vec2 {
  return { x: len * Math.cos(angle), y: len * Math.sin(angle) };
}

/**
 * Angle of v in radians, counter-clockwise from +x, in (-PI, PI].
 *
 * Uses atan2 deliberately: acos(x/len) collapses the sign of y, so it can
 * never distinguish +60 degrees from -60 degrees.
 */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Rotate about an arbitrary centre. */
export function rotateAround(v: Vec2, centre: Vec2, angle: number): Vec2 {
  return add(centre, rotate(sub(v, centre), angle));
}

/** 90 degrees counter-clockwise. Used for double-bond offset lines. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return lerp(a, b, 0.5);
}

/** Signed angle from a to b, in (-PI, PI]. */
export function angleBetween(a: Vec2, b: Vec2): number {
  return normalizeAngle(angleOf(b) - angleOf(a));
}

/** Wrap any angle into (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** Wrap any angle into [0, 2PI). */
export function normalizeAnglePositive(angle: number): number {
  const twoPi = 2 * Math.PI;
  const a = angle % twoPi;
  return a < 0 ? a + twoPi : a;
}

export const DEG = Math.PI / 180;

export function toRadians(degrees: number): number {
  return degrees * DEG;
}

export function toDegrees(radians: number): number {
  return radians / DEG;
}

/** Snap an angle to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  if (step <= 0) return angle;
  return Math.round(angle / step) * step;
}

export function approxEqual(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/** Axis-aligned bounding box of a point set. Empty input gives a zero box. */
export function bounds(points: readonly Vec2[]): {
  min: Vec2;
  max: Vec2;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { min: ORIGIN, max: ORIGIN, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width: maxX - minX,
    height: maxY - minY,
  };
}
