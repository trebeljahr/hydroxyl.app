/**
 * The stereo marks, and the descriptors that annotate them.
 *
 * The property every assertion here is really guarding is that the picture
 * agrees with the model's convention: narrow end at `bond.from`, and nothing
 * downstream allowed to have its own opinion about which end that is. A wedge
 * drawn the wrong way round renders beautifully and states the opposite
 * configuration, which is the failure the whole module exists to prevent.
 */

import { describe, expect, it } from "vitest";

import { flipBond, setBondStereo } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { bondAxis } from "../src/bond/geometry.js";
import { hashBars, wedgePoints } from "../src/bond/stereo.js";
import {
  butan2olWedged,
  cis2Butene,
  FIXTURES,
  trans2Butene,
  wedgeOnNonStereocentre,
} from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { buildScene } from "../src/scene/build.js";
import type {
  LinePrimitive,
  PathPrimitive,
  PolygonPrimitive,
  RenderScene,
  ScenePoint,
  ScenePrimitive,
  TextRunPrimitive,
} from "../src/scene/types.js";
import { atomLabelPlacement } from "../src/scene/build.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { BUNDLED_MEASURER, measureTextRun, textRunRect } from "../src/text/measurer.js";

// Skeletal now DEFAULTS to the aromatic circle — the forced consequence of
// decision 11, which stripped Kekulé's carbon labels and left the circle as
// the only thing telling the two views apart. This file's baseline is the
// plain structural drawing with its Kekulé alternation intact, so it asks for
// the circle to be off rather than relying on a default that has moved.
const SKELETAL = representation("skeletal", { aromaticCircles: false });
const WITH_DESCRIPTORS = representation("skeletal", { showStereoDescriptors: true });
const STYLES: readonly RenderStyle[] = Object.freeze([
  PUBLICATION_STYLE,
  SCREEN_STYLE,
]);

/** The wedge bond of the butan-2-ol fixture: C2 -> O, narrow end at C2. */
const WEDGE_BOND = "b7";

function find(scene: RenderScene, id: string): ScenePrimitive | undefined {
  return scene.primitives.find((p) => p.id === id);
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Every coordinate pair in a path's `d`, in order. */
function pathPoints(d: string): ScenePoint[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: ScenePoint[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  }
  return points;
}

describe("the solid wedge", () => {
  it("puts its apex at the bond's `from` atom, not at the first id in a list", () => {
    const scene = buildScene(butan2olWedged(), PUBLICATION_STYLE, SKELETAL);
    const wedge = find(scene, `bond:${WEDGE_BOND}:wedge`) as
      | PolygonPrimitive
      | undefined;
    expect(wedge?.type).toBe("polygon");
    const points = wedge!.points;
    expect(points).toHaveLength(3);

    // The apex is the lone vertex: the other two are the base, a wedge width
    // apart. Identified geometrically rather than by index, so the assertion
    // survives a reordering of the polygon's own points.
    const [apex, left, right] = points as [ScenePoint, ScenePoint, ScenePoint];
    expect(distance(left, right)).toBeCloseTo(PUBLICATION_STYLE.stereoWedgeWidthPx, 9);

    // C2 sits north-east of C1 and the oxygen due north of C2, so the apex is
    // the LOWER of the two ends on the page (scene y grows downward).
    expect(apex.y).toBeGreaterThan(left.y);
    expect(apex.y).toBeGreaterThan(right.y);
  });

  it("moves its apex to the other end when the bond is flipped", () => {
    // `flipBond` swaps from/to and deliberately leaves the stereo string
    // alone, so the ONLY thing that can invert the picture is the renderer
    // honouring `from`. This is that criterion, stated as pixels.
    const before = buildScene(butan2olWedged(), PUBLICATION_STYLE, SKELETAL);
    const after = buildScene(
      flipBond(butan2olWedged(), WEDGE_BOND),
      PUBLICATION_STYLE,
      SKELETAL,
    );

    const apexOf = (scene: RenderScene): ScenePoint => {
      const wedge = find(scene, `bond:${WEDGE_BOND}:wedge`) as PolygonPrimitive;
      return wedge.points[0]!;
    };
    const a = apexOf(before);
    const b = apexOf(after);
    expect(a).not.toEqual(b);
    // The two apexes are at opposite ends of the same bond rather than merely
    // different: each lies nearer its own end's atom than the other end's.
    // Stated against the atom centres, not as a fraction of the bond, because
    // both ends are trimmed against labels (the stereocentre draws its H) and
    // how much of the bond survives depends on the preset's font size.
    const mol = butan2olWedged();
    const wedge = mol.bonds[WEDGE_BOND]!;
    const stereocentre = modelToPx(PUBLICATION_STYLE, mol.atoms[wedge.from]!.pos);
    const oxygen = modelToPx(PUBLICATION_STYLE, mol.atoms[wedge.to]!.pos);
    expect(distance(a, stereocentre)).toBeLessThan(distance(a, oxygen));
    expect(distance(b, oxygen)).toBeLessThan(distance(b, stereocentre));
  });

  it("replaces the bond's line rather than drawing over it", () => {
    // A line down the middle of a filled triangle is a hairline seam at
    // publication scale and a visible spine at screen scale.
    const scene = buildScene(butan2olWedged(), PUBLICATION_STYLE, SKELETAL);
    expect(find(scene, `bond:${WEDGE_BOND}:line`)).toBeUndefined();
  });

  it("is not drawn at all when the representation turns stereo bonds off", () => {
    // Lewis makes no 3D claim, and `DEFAULT_FLAGS_BY_KIND` says so.
    const scene = buildScene(
      butan2olWedged(),
      PUBLICATION_STYLE,
      representation("lewis"),
    );
    expect(find(scene, `bond:${WEDGE_BOND}:wedge`)).toBeUndefined();
    expect(find(scene, `bond:${WEDGE_BOND}:line`)).toBeDefined();
  });

  it("is not drawn on a double bond, whatever an importer stored there", () => {
    // wedge/hash/wavy describe a SINGLE bond (types.ts). A wedge on a double
    // bond is a file that has been through something lossy, and drawing a
    // triangle for it would assert a configuration nobody can read off it.
    const wedgedDouble = setBondStereo(cis2Butene(), "b3", "wedge");
    const scene = buildScene(wedgedDouble, PUBLICATION_STYLE, SKELETAL);
    expect(find(scene, "bond:b3:wedge")).toBeUndefined();
    expect(find(scene, "bond:b3:line")).toBeDefined();
    expect(find(scene, "bond:b3:line2")).toBeDefined();
  });
});

describe("the hashed wedge", () => {
  function barsOf(mol: Molecule, style: RenderStyle): ScenePoint[] {
    const scene = buildScene(mol, style, SKELETAL);
    const hash = find(scene, `bond:${WEDGE_BOND}:hash`) as PathPrimitive | undefined;
    expect(hash?.type).toBe("path");
    return pathPoints(hash!.d);
  }

  const hashed = () => setBondStereo(butan2olWedged(), WEDGE_BOND, "hash");

  it("is ONE path, never a line per bar", () => {
    // Loose lines would poison two passes at once: `detectCollisions` takes
    // the first `line` of a bond as its representative segment for the
    // crossing scan, and the editor's `bondSegment` takes the first line for
    // the selection halo. Bar zero is a couple of px long.
    const scene = buildScene(hashed(), PUBLICATION_STYLE, SKELETAL);
    const own = scene.primitives.filter(
      (p) => p.source.kind === "bond" && p.source.bondId === WEDGE_BOND,
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.type).toBe("path");
  });

  it("spaces its bars evenly", () => {
    for (const style of STYLES) {
      const points = barsOf(hashed(), style);
      const midpoints: ScenePoint[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        const a = points[i]!;
        const b = points[i + 1]!;
        midpoints.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      expect(midpoints.length).toBeGreaterThanOrEqual(3);
      const gaps = midpoints
        .slice(1)
        .map((point, i) => distance(midpoints[i]!, point));
      for (const gap of gaps) {
        // Read back out of the path's `d`, whose numbers are already rounded
        // to `style.coordinatePrecision` — that rounding is the point of
        // formatting them there, and it is the whole of the tolerance here.
        expect(gap, style.name).toBeCloseTo(gaps[0]!, 1);
      }
    }
  });

  it("widens monotonically from the narrow end", () => {
    for (const style of STYLES) {
      const points = barsOf(hashed(), style);
      const widths: number[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        widths.push(distance(points[i]!, points[i + 1]!));
      }
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]!, style.name).toBeGreaterThan(widths[i - 1]!);
      }
      // The last bar is the full wedge width; the first is visible but short.
      expect(widths[widths.length - 1]!).toBeCloseTo(style.stereoWedgeWidthPx, 6);
      expect(widths[0]!).toBeGreaterThan(0);
      expect(widths[0]!).toBeLessThan(style.stereoWedgeWidthPx / 2);
    }
  });

  it("starts its narrow end where the solid wedge puts its apex", () => {
    // The two marks are the same statement with opposite signs, so they must
    // agree about which end the claim is made from — otherwise flipping a
    // wedge to a hash would silently move the stereocentre.
    const wedgeScene = buildScene(butan2olWedged(), PUBLICATION_STYLE, SKELETAL);
    const apex = (find(wedgeScene, `bond:${WEDGE_BOND}:wedge`) as PolygonPrimitive)
      .points[0]!;
    const bars = barsOf(hashed(), PUBLICATION_STYLE);
    const firstBarCentre: ScenePoint = {
      x: (bars[0]!.x + bars[1]!.x) / 2,
      y: (bars[0]!.y + bars[1]!.y) / 2,
    };
    // The wedge's apex is a raw scene coordinate and the hash's is read back
    // out of a formatted path, so they agree to the style's precision rather
    // than to the bit.
    expect(firstBarCentre.x).toBeCloseTo(apex.x, 2);
    expect(firstBarCentre.y).toBeCloseTo(apex.y, 2);
  });

  it("agrees with `hashBars`, which is the geometry the scene consumes", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 30, y: 0 };
    const axis = bondAxis(from, to, undefined, undefined, 1);
    expect(axis).toBeDefined();
    const bars = hashBars(axis!, 6, 3);
    expect(bars).toHaveLength(11);
    expect(bars[0]!.a.x).toBeCloseTo(0, 9);
    expect(bars[bars.length - 1]!.a.x).toBeCloseTo(30, 9);
  });
});

describe("the wavy bond", () => {
  const wavy = () => setBondStereo(butan2olWedged(), WEDGE_BOND, "wavy");

  it("keeps its period fixed rather than stretching it with the bond", () => {
    // A wavy bond is a mark with exactly one meaning. A wave whose period grew
    // with the bond would read as a different mark on a long bond, and one
    // that ran off the end would read as a bond that had been cut.
    for (const style of STYLES) {
      const scene = buildScene(wavy(), style, SKELETAL);
      const path = find(scene, `bond:${WEDGE_BOND}:wavy`) as PathPrimitive;
      const points = pathPoints(path.d);
      // M plus three points per cubic: the on-curve endpoints are every third
      // point after the first.
      const nodes: ScenePoint[] = [points[0]!];
      for (let i = 3; i < points.length; i += 3) nodes.push(points[i]!);
      expect(nodes.length).toBeGreaterThanOrEqual(3);

      const spans = nodes
        .slice(1)
        .map((point, i) => distance(nodes[i]!, point));
      for (const span of spans) {
        // As above: the nodes come back out of a `d` rounded to the style's
        // precision, and the screen preset rounds to two places.
        expect(span, style.name).toBeCloseTo(spans[0]!, 1);
      }
      // Two half-waves make one period, and the rounding can only move it by
      // half a half-wave either way.
      const drawnPeriod = spans[0]! * 2;
      expect(drawnPeriod).toBeGreaterThan(style.stereoWavyPeriodPx * 0.6);
      expect(drawnPeriod).toBeLessThan(style.stereoWavyPeriodPx * 1.6);
    }
  });

  it("begins and ends on the bond axis", () => {
    // A wave cut off mid-swing leaves a visible kink where the bond meets its
    // atom, which reads as a drawing error rather than as an unspecified
    // configuration.
    const scene = buildScene(wavy(), PUBLICATION_STYLE, SKELETAL);
    const path = find(scene, `bond:${WEDGE_BOND}:wavy`) as PathPrimitive;
    const points = pathPoints(path.d);
    const start = points[0]!;
    const end = points[points.length - 1]!;
    // Both endpoints lie on the vertical C2-O axis of this fixture.
    expect(start.x).toBeCloseTo(end.x, 6);
  });
});

describe("the crossed double bond", () => {
  it("draws two crossing segments instead of a parallel pair", () => {
    const crossed = setBondStereo(cis2Butene(), "b3", "either");
    const scene = buildScene(crossed, PUBLICATION_STYLE, SKELETAL);
    const first = find(scene, "bond:b3:cross") as LinePrimitive | undefined;
    const second = find(scene, "bond:b3:cross2") as LinePrimitive | undefined;
    expect(first?.type).toBe("line");
    expect(second?.type).toBe("line");
    expect(find(scene, "bond:b3:line")).toBeUndefined();

    // They cross: the two segments start on opposite sides of the axis and end
    // on opposite sides of it. On this horizontal bond that is a sign flip in
    // y at each end.
    expect(Math.sign(first!.a.y - first!.b.y)).toBe(
      -Math.sign(second!.a.y - second!.b.y),
    );
  });

  it("leaves an `either` stored on a single bond alone", () => {
    // `either` describes a DOUBLE bond (V2000 code 3). On a single bond it is
    // a file artefact, and crossing a single bond would invent a notation.
    const odd = setBondStereo(butan2olWedged(), WEDGE_BOND, "either");
    const scene = buildScene(odd, PUBLICATION_STYLE, SKELETAL);
    expect(find(scene, `bond:${WEDGE_BOND}:cross`)).toBeUndefined();
    expect(find(scene, `bond:${WEDGE_BOND}:line`)).toBeDefined();
  });
});

describe("descriptor labels", () => {
  function descriptorsOf(scene: RenderScene): TextRunPrimitive[] {
    return scene.primitives.filter(
      (p): p is TextRunPrimitive =>
        p.type === "textRun" && p.id.endsWith(":descriptor"),
    );
  }

  it("are off unless the representation asks for them", () => {
    const scene = buildScene(butan2olWedged(), PUBLICATION_STYLE, SKELETAL);
    expect(descriptorsOf(scene)).toEqual([]);
  });

  it("set (R) beside the wedged stereocentre", () => {
    const scene = buildScene(butan2olWedged(), PUBLICATION_STYLE, WITH_DESCRIPTORS);
    const runs = descriptorsOf(scene);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe("atom:a2:descriptor");
    expect(runs[0]!.spans.map((s) => s.text).join("")).toBe("(R)");
  });

  it("set (Z) and (E) on the two butenes, from their coordinates", () => {
    for (const [molecule, expected] of [
      [cis2Butene(), "(Z)"],
      [trans2Butene(), "(E)"],
    ] as const) {
      const scene = buildScene(molecule, PUBLICATION_STYLE, WITH_DESCRIPTORS);
      const runs = descriptorsOf(scene);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.id).toBe("bond:b3:descriptor");
      expect(runs[0]!.spans.map((s) => s.text).join("")).toBe(expected);
    }
  });

  it("say nothing beside a wedge that is not on a stereocentre", () => {
    // The fixture still DRAWS its wedge — the pass reports and never repairs —
    // but there is no configuration to name, so no letter appears. A "(?)"
    // here would read as a wavy bond, which is a chemical claim of its own.
    const scene = buildScene(
      wedgeOnNonStereocentre(),
      PUBLICATION_STYLE,
      WITH_DESCRIPTORS,
    );
    expect(descriptorsOf(scene)).toEqual([]);
    expect(find(scene, "bond:b6:wedge")).toBeDefined();
  });

  it("clear every bond and every atom label, on every fixture at both presets", () => {
    // The acceptance criterion, run over the corpus rather than one drawing.
    // `detectCollisions` cannot state this for us: its scan is atoms and bonds
    // only, so a descriptor lying across a bond is invisible to it.
    for (const style of STYLES) {
      for (const fixture of FIXTURES) {
        const scene = buildScene(fixture.molecule, style, WITH_DESCRIPTORS);
        const runs = descriptorsOf(scene);
        if (runs.length === 0) continue;

        const segments = scene.primitives.filter(
          (p): p is LinePrimitive => p.type === "line" && p.source.kind === "bond",
        );
        const obstacles = fixture.molecule.atomIds.flatMap((atomId) => {
          const placement = atomLabelPlacement(
            fixture.molecule,
            atomId,
            style,
            WITH_DESCRIPTORS,
          );
          return placement === undefined ? [] : [...placement.obstacles];
        });

        for (const run of runs) {
          const box = textRunRect(
            measureTextRun(
              run.spans,
              {
                fontFamily: run.fontFamily,
                fontSizePx: run.fontSizePx,
                subscriptScale: style.subscriptScale,
                anchor: run.anchor,
                baseline: run.baseline,
              },
              BUNDLED_MEASURER,
            ),
            run.origin,
          );
          const where = `${fixture.name}/${style.name}/${run.id}`;
          for (const obstacle of obstacles) {
            if (obstacle.kind !== "rect") continue;
            const overlaps =
              box.minX < obstacle.box.maxX &&
              obstacle.box.minX < box.maxX &&
              box.minY < obstacle.box.maxY &&
              obstacle.box.minY < box.maxY;
            expect(overlaps, `${where} over a label`).toBe(false);
          }
          for (const segment of segments) {
            expect(
              boxMeetsSegment(box, segment.a, segment.b),
              `${where} over ${segment.id}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

/** Liang-Barsky, local to the test so it cannot inherit a bug from the source. */
function boxMeetsSegment(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  a: ScenePoint,
  b: ScenePoint,
): boolean {
  let entry = 0;
  let exit = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > exit) return false;
      if (r > entry) entry = r;
    } else {
      if (r < entry) return false;
      if (r < exit) exit = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - box.minX)) return false;
  if (!clip(dx, box.maxX - a.x)) return false;
  if (!clip(-dy, a.y - box.minY)) return false;
  if (!clip(dy, box.maxY - a.y)) return false;
  return entry <= exit;
}

describe("wedgePoints", () => {
  it("takes the narrow end from the axis and nothing else", () => {
    // The unit test of the rule, with no molecule in the way: whatever
    // `bondAxis` was handed as its FIRST point is the apex. `scene/build.ts`
    // calls it with `bond.from` first, and that is the whole chain.
    const axis = bondAxis({ x: 0, y: 0 }, { x: 20, y: 0 }, undefined, undefined, 1);
    const points = wedgePoints(axis!, 6);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]!.x).toBeCloseTo(20, 9);
    expect(points[2]!.x).toBeCloseTo(20, 9);
    expect(Math.abs(points[1]!.y - points[2]!.y)).toBeCloseTo(6, 9);
  });
});
