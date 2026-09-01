import { describe, expect, it } from "vitest";
import * as V from "./vec.js";

const close = (a: number, b: number, eps = 1e-12) => Math.abs(a - b) <= eps;

describe("add / sub", () => {
  it("adds both components independently", () => {
    // Regression: the old addVector returned `y: v1.x + v2.x`, so any vector
    // sum silently produced a 45-degree diagonal.
    expect(V.add(V.vec(1, 2), V.vec(10, 20))).toEqual({ x: 11, y: 22 });
    expect(V.add(V.vec(3, 0), V.vec(0, 4))).toEqual({ x: 3, y: 4 });
  });

  it("sub is the inverse of add", () => {
    const a = V.vec(3, -7);
    const b = V.vec(-2, 11);
    expect(V.sub(V.add(a, b), b)).toEqual(a);
  });
});

describe("angleOf", () => {
  it("distinguishes vectors that differ only in the sign of y", () => {
    // Regression: acos(x/len) cannot tell +60 from -60 degrees.
    const up = V.angleOf(V.vec(1, 1));
    const down = V.angleOf(V.vec(1, -1));
    expect(close(up, Math.PI / 4)).toBe(true);
    expect(close(down, -Math.PI / 4)).toBe(true);
    expect(up).not.toBeCloseTo(down);
  });

  it("covers all four quadrants", () => {
    expect(close(V.angleOf(V.vec(1, 0)), 0)).toBe(true);
    expect(close(V.angleOf(V.vec(0, 1)), Math.PI / 2)).toBe(true);
    expect(close(V.angleOf(V.vec(-1, 0)), Math.PI)).toBe(true);
    expect(close(V.angleOf(V.vec(0, -1)), -Math.PI / 2)).toBe(true);
  });

  it("round-trips through fromPolar", () => {
    for (let deg = -170; deg <= 180; deg += 10) {
      const a = V.toRadians(deg);
      expect(close(V.angleOf(V.fromPolar(a, 3)), a, 1e-12)).toBe(true);
    }
  });
});

describe("fromPolar", () => {
  it("respects the y-up convention", () => {
    const v = V.fromPolar(V.toRadians(90), 2);
    expect(close(v.x, 0, 1e-12)).toBe(true);
    expect(close(v.y, 2, 1e-12)).toBe(true);
  });

  it("produces the requested length", () => {
    expect(close(V.length(V.fromPolar(1.234, 5)), 5, 1e-12)).toBe(true);
  });
});

describe("normalize / withLength", () => {
  it("returns a unit vector", () => {
    expect(close(V.length(V.normalize(V.vec(3, 4))), 1)).toBe(true);
  });

  it("returns origin for a zero vector instead of NaN", () => {
    expect(V.normalize(V.ORIGIN)).toEqual(V.ORIGIN);
    expect(Number.isNaN(V.normalize(V.ORIGIN).x)).toBe(false);
  });

  it("withLength rescales without changing direction", () => {
    const v = V.withLength(V.vec(3, 4), 10);
    expect(close(V.length(v), 10)).toBe(true);
    expect(close(V.angleOf(v), V.angleOf(V.vec(3, 4)))).toBe(true);
  });
});

describe("rotate", () => {
  it("rotates counter-clockwise", () => {
    const r = V.rotate(V.vec(1, 0), Math.PI / 2);
    expect(close(r.x, 0, 1e-12)).toBe(true);
    expect(close(r.y, 1, 1e-12)).toBe(true);
  });

  it("preserves length", () => {
    expect(close(V.length(V.rotate(V.vec(3, 4), 0.7)), 5, 1e-12)).toBe(true);
  });

  it("rotateAround leaves the centre fixed", () => {
    const c = V.vec(5, 5);
    expect(V.approxEqual(V.rotateAround(c, c, 1.1), c)).toBe(true);
  });
});

describe("perp", () => {
  it("is 90 degrees counter-clockwise and orthogonal", () => {
    const v = V.vec(2, 1);
    const p = V.perp(v);
    expect(p).toEqual({ x: -1, y: 2 });
    expect(close(V.dot(v, p), 0)).toBe(true);
    expect(V.cross(v, p)).toBeGreaterThan(0);
  });
});

describe("cross", () => {
  it("signs the turn direction", () => {
    expect(V.cross(V.vec(1, 0), V.vec(0, 1))).toBeGreaterThan(0);
    expect(V.cross(V.vec(1, 0), V.vec(0, -1))).toBeLessThan(0);
    expect(V.cross(V.vec(1, 0), V.vec(2, 0))).toBe(0);
  });
});

describe("normalizeAngle", () => {
  it("wraps into (-PI, PI]", () => {
    expect(close(V.normalizeAngle(3 * Math.PI), Math.PI)).toBe(true);
    expect(close(V.normalizeAngle(-3 * Math.PI), Math.PI)).toBe(true);
    expect(close(V.normalizeAngle(Math.PI), Math.PI)).toBe(true);
    expect(close(V.normalizeAngle(0), 0)).toBe(true);
  });

  it("normalizeAnglePositive wraps into [0, 2PI)", () => {
    expect(close(V.normalizeAnglePositive(-Math.PI / 2), (3 * Math.PI) / 2)).toBe(true);
    expect(close(V.normalizeAnglePositive(0), 0)).toBe(true);
  });
});

describe("angleBetween", () => {
  it("is signed", () => {
    expect(close(V.angleBetween(V.vec(1, 0), V.vec(0, 1)), Math.PI / 2)).toBe(true);
    expect(close(V.angleBetween(V.vec(0, 1), V.vec(1, 0)), -Math.PI / 2)).toBe(true);
  });
});

describe("snapAngle", () => {
  it("snaps to the nearest multiple", () => {
    const step = V.toRadians(30);
    expect(close(V.toDegrees(V.snapAngle(V.toRadians(34), step)), 30, 1e-9)).toBe(true);
    expect(close(V.toDegrees(V.snapAngle(V.toRadians(46), step)), 60, 1e-9)).toBe(true);
    expect(close(V.toDegrees(V.snapAngle(V.toRadians(-14), step)), 0, 1e-9)).toBe(true);
  });

  it("is a no-op for a non-positive step", () => {
    expect(V.snapAngle(1.234, 0)).toBe(1.234);
  });
});

describe("bounds", () => {
  it("returns a zero box for no points", () => {
    expect(V.bounds([])).toEqual({ min: V.ORIGIN, max: V.ORIGIN, width: 0, height: 0 });
  });

  it("covers the point set", () => {
    const b = V.bounds([V.vec(-1, 2), V.vec(3, -4), V.vec(0, 0)]);
    expect(b.min).toEqual({ x: -1, y: -4 });
    expect(b.max).toEqual({ x: 3, y: 2 });
    expect(b.width).toBe(4);
    expect(b.height).toBe(6);
  });
});
