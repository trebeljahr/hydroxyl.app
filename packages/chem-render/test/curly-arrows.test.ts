/**
 * Curly arrows: anchors resolved against a panel's injected geometry, curves
 * rebuilt from the stored chord frame, a shaft and a head per arrow.
 *
 * Real mechanisms, not synthetic graphs (MECHANISM_FIXTURES): a regression
 * here reads as "the cyanide's arrow bows through the methyl" rather than
 * "point 3 is on the wrong side of segment 1".
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getAtom,
  project,
  removeAtoms,
  setAtomPosition,
  stereoConfig,
  translateAtoms,
} from "@starter/chem-core";
import type { AtomId, Molecule, PlanarView, ProjectedLayout, Vec2 } from "@starter/chem-core";

import { arrowhead, CURLY_ARROWHEAD } from "../src/annotation/arrowhead.js";
import {
  CURLY_ARROW_CURVE,
  chordFrameCurve,
  chordFrameOf,
  curveApex,
  curvePoint,
} from "../src/annotation/curve.js";
import type { CubicCurve } from "../src/annotation/curve.js";
import { defaultCurlyArrowShape, layoutCurlyArrow } from "../src/annotation/curly.js";
import type { CurlyArrowLayout } from "../src/annotation/curly.js";
import {
  acetateResonance,
  bromineHomolysis,
  cyanideAdditionToAcetone,
  MECHANISM_FIXTURES,
} from "../src/fixtures.js";
import { representation, VIEW_KINDS, isStructuralViewKind } from "../src/representation.js";
import type { Representation } from "../src/representation.js";
import { buildAnnotatedScene, buildScene, schemeAnchorContext } from "../src/scene/build.js";
import type { SceneBuildOptions } from "../src/scene/build.js";
import type { PathPrimitive, PolygonPrimitive, ScenePoint, ScenePrimitive } from "../src/scene/types.js";
import {
  assembleSchemeAnnotation,
  pruneSchemeAnnotations,
  sceneAnchorPlacement,
  schemeAnnotationResolves,
} from "../src/scheme/annotation.js";
import type { CurlyArrowAnnotation, SchemeAnnotation } from "../src/scheme/annotation.js";
import { modelToPx, pxToModel, PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";

const STYLES: readonly RenderStyle[] = [PUBLICATION_STYLE, SCREEN_STYLE];
const skeletal = representation("skeletal");
const lewis = representation("lewis");

function arrowsOf(
  mol: Molecule,
  annotations: readonly SchemeAnnotation[],
  style: RenderStyle = PUBLICATION_STYLE,
  rep: Representation = skeletal,
  options: SceneBuildOptions = {},
) {
  return buildAnnotatedScene(mol, style, rep, { ...options, schemeAnnotations: annotations });
}

function layoutOf(
  mol: Molecule,
  arrow: CurlyArrowAnnotation,
  style: RenderStyle = PUBLICATION_STYLE,
  rep: Representation = skeletal,
  options: SceneBuildOptions = {},
): CurlyArrowLayout {
  const layout = arrowsOf(mol, [arrow], style, rep, options).schemeAnnotations.curlyArrows[0];
  if (layout === undefined) throw new Error(`${arrow.id} did not resolve`);
  return layout;
}

function withShape(arrow: CurlyArrowAnnotation, bulge: number, skew = arrow.skew): CurlyArrowAnnotation {
  return assembleSchemeAnnotation({ ...arrow, bulge, skew }) as CurlyArrowAnnotation;
}

/** The numbers of an SVG path's `d`, read back as points. */
function pathPoints(d: string): ScenePoint[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: ScenePoint[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  return points;
}

/** Twice the signed area of a polygon in y-UP model space: positive = counter-clockwise. */
function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

/** Which side of the chord `apex` is on in y-UP model space: + left, - right. */
function sideOfChord(tail: Vec2, head: Vec2, apex: Vec2): number {
  return (head.x - tail.x) * (apex.y - tail.y) - (head.y - tail.y) * (apex.x - tail.x);
}

function toModel(style: RenderStyle, curve: CubicCurve): Vec2[] {
  return [curve.p0, curve.c1, curve.c2, curve.p3].map((p) => pxToModel(style, p));
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function primitiveById<T extends ScenePrimitive>(primitives: readonly ScenePrimitive[], id: string): T {
  const found = primitives.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no primitive ${id}`);
  return found as T;
}

// ---------------------------------------------------------------------------

describe("the chord frame (curve.ts)", () => {
  const tail = { x: 10, y: 40 };
  const head = { x: 70, y: 20 };

  it("passes through the stored apex at t = 1/2, and chordFrameOf reads the shape back", () => {
    for (const bulge of [-1, -0.6, -0.2, 0, 0.1, 0.35, 0.5, 0.9]) {
      for (const skew of [-0.5, -0.2, 0, 0.3, 0.5]) {
        const curve = chordFrameCurve(tail, head, bulge, skew)!;
        const back = chordFrameOf(tail, head, curveApex(curve))!;
        expect(back.bulge).toBeCloseTo(bulge, 12);
        expect(back.skew).toBeCloseTo(skew, 12);
      }
    }
  });

  it("with skew 0 is the circular arc through tail, apex and head", () => {
    // Semicircle: bulge 1/2 puts the apex half a chord off the chord, so every
    // point of the arc is half a chord from the chord midpoint and both end
    // tangents stand square to the chord.
    const curve = chordFrameCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0)!;
    expect(curve.c1.x).toBeCloseTo(0, 12);
    expect(curve.c2.x).toBeCloseTo(100, 12);
    expect(distance(curveApex(curve), { x: 50, y: 0 })).toBeCloseTo(50, 12);
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      // One cubic follows a semicircle to within 2 % of its radius.
      expect(Math.abs(distance(curvePoint(curve, t), { x: 50, y: 0 }) - 50)).toBeLessThan(1);
    }
    // A shallow arrow leaves at the arc's angle, not square off the chord:
    // tan(theta) = 4b / (1 - 4b^2).
    const shallow = chordFrameCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 0)!;
    const slope = Math.abs(shallow.c1.y - shallow.p0.y) / (shallow.c1.x - shallow.p0.x);
    expect(slope).toBeCloseTo((4 * 0.2) / (1 - 4 * 0.04), 12);
  });

  it("is invariant under translation, rotation and uniform scale", () => {
    const base = chordFrameCurve(tail, head, 0.4, 0.2)!;
    const angle = 1.1;
    const scale = 2.7;
    const shift = { x: -33, y: 12 };
    const move = (p: ScenePoint): ScenePoint => ({
      x: scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)) + shift.x,
      y: scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)) + shift.y,
    });
    const moved = chordFrameCurve(move(tail), move(head), 0.4, 0.2)!;
    for (const key of ["p0", "c1", "c2", "p3"] as const) {
      expect(moved[key].x).toBeCloseTo(move(base[key]).x, 9);
      expect(moved[key].y).toBeCloseTo(move(base[key]).y, 9);
    }
  });

  it("has no chord for coincident ends, and bounds what it draws, not what is stored", () => {
    expect(chordFrameCurve(tail, tail, 0.3, 0)).toBeUndefined();
    const capped = chordFrameCurve(tail, head, 7, 0)!;
    expect(chordFrameOf(tail, head, curveApex(capped))!.bulge).toBeCloseTo(CURLY_ARROW_CURVE.maxBulge, 12);
    const nan = chordFrameOf(tail, head, curveApex(chordFrameCurve(tail, head, Number.NaN, Number.NaN)!))!;
    expect(nan.bulge).toBeCloseTo(0, 12);
    expect(nan.skew).toBeCloseTo(0, 12);
  });
});

describe("the y-flip: an arrow keeps its handedness from model to scene", () => {
  const fixture = cyanideAdditionToAcetone();
  const [attack, piShift] = fixture.annotations as [CurlyArrowAnnotation, CurlyArrowAnnotation];

  it("bows the cyanide's arrow to the LEFT of its chord, read back in y-up model space", () => {
    // Tail on the cyanide carbon below, head on the carbonyl carbon above:
    // the chord points up, so left is WEST. A perpendicular taken with the
    // y-up formula in y-down scene space would bow it east, through nothing
    // in particular — a picture that still looks like a mechanism.
    for (const style of STYLES) {
      const layout = layoutOf(fixture.molecule, attack, style);
      const [tail, , , head] = toModel(style, layout.curve);
      const apex = pxToModel(style, curveApex(layout.curve));
      expect(attack.bulge).toBeGreaterThan(0);
      expect(sideOfChord(tail!, head!, apex), style.name).toBeGreaterThan(0);
      expect(apex.x, style.name).toBeLessThan(getAtom(fixture.molecule, fixture.carbonylCarbon)!.pos.x);
    }
  });

  it("renders a counter-clockwise arrow counter-clockwise, from the emitted SVG path", () => {
    // Walking a curve that bows RIGHT of its chord turns left all the way:
    // counter-clockwise. The C=O arrow is stored that way (negative bulge);
    // the cyanide's arrow bows left and sweeps clockwise. Read off the path
    // the scene emits, through the inverse of the one flip.
    for (const style of STYLES) {
      const { scene } = arrowsOf(fixture.molecule, fixture.annotations, style);
      for (const arrow of [attack, piShift]) {
        const shaft = primitiveById<PathPrimitive>(scene.primitives, `annotation:${arrow.id}:shaft`);
        const model = pathPoints(shaft.d).map((p) => pxToModel(style, p));
        const turn = Math.sign(signedArea(model));
        expect(turn, `${style.name} ${arrow.id}`).toBe(arrow.bulge < 0 ? 1 : -1);
      }
    }
    // And the sign is the stored one's, not the fixture's: flip it, flip the turn.
    const flipped = withShape(piShift, -piShift.bulge);
    const shaft = layoutOf(fixture.molecule, flipped).shaft!;
    expect(Math.sign(signedArea(toModel(PUBLICATION_STYLE, shaft)))).toBe(-1);
  });
});

describe("anchors resolve against the panel's geometry", () => {
  const fixture = cyanideAdditionToAcetone();
  const attack = fixture.annotations[0] as CurlyArrowAnnotation;

  it("follows a dragged atom and keeps the arrow's character", () => {
    const moved = translateAtoms(fixture.molecule, [fixture.cyanideCarbon], { x: -1.3, y: 0.6 });
    for (const mol of [fixture.molecule, moved]) {
      const layout = layoutOf(mol, attack);
      const tail = modelToPx(PUBLICATION_STYLE, getAtom(mol, fixture.cyanideCarbon)!.pos);
      expect(layout.curve.p0).toEqual(tail);
      const shape = chordFrameOf(layout.curve.p0, layout.curve.p3, curveApex(layout.curve))!;
      expect(shape.bulge).toBeCloseTo(attack.bulge, 12);
      expect(shape.skew).toBeCloseTo(attack.skew, 12);
    }
  });

  it("draws the same curve at every preset: only the ends the labels hide differ", () => {
    for (const { molecule, annotations } of MECHANISM_FIXTURES) {
      for (const arrow of annotations) {
        const [pub, screen] = STYLES.map((style) => toModel(style, layoutOf(molecule, arrow, style).curve));
        pub!.forEach((point, i) => {
          expect(point.x, arrow.id).toBeCloseTo(screen![i]!.x, 9);
          expect(point.y, arrow.id).toBeCloseTo(screen![i]!.y, 9);
        });
      }
    }
  });

  it("resolves against a re-projected panel's placed positions, not the molecule's", () => {
    const view: PlanarView = {
      kind: "planar",
      template: "wedgeDash",
      frame: {},
      params: { rotationDeg: 90, mirror: false },
    };
    const result = project(fixture.molecule, stereoConfig(fixture.molecule), view);
    if (result.kind !== "available") throw new Error(result.kind);
    const layout: ProjectedLayout = result.layout;
    const placed = (atomId: AtomId): ScenePoint => modelToPx(PUBLICATION_STYLE, layout.positions[atomId]!);
    const drawn = (atomId: AtomId): ScenePoint =>
      modelToPx(PUBLICATION_STYLE, getAtom(fixture.molecule, atomId)!.pos);

    const turned = layoutOf(fixture.molecule, attack, PUBLICATION_STYLE, skeletal, { layout });
    expect(turned.curve.p0.x).toBeCloseTo(placed(fixture.cyanideCarbon).x, 9);
    expect(turned.curve.p0.y).toBeCloseTo(placed(fixture.cyanideCarbon).y, 9);
    expect(turned.curve.p3.x).toBeCloseTo(placed(fixture.carbonylCarbon).x, 9);
    expect(turned.curve.p3.y).toBeCloseTo(placed(fixture.carbonylCarbon).y, 9);
    expect(distance(turned.curve.p0, drawn(fixture.cyanideCarbon))).toBeGreaterThan(10);
    // Frame-relative: the turned panel's arrow is the flat one turned with it.
    const flat = layoutOf(fixture.molecule, attack);
    const shape = chordFrameOf(turned.curve.p0, turned.curve.p3, curveApex(turned.curve))!;
    expect(shape.bulge).toBeCloseTo(attack.bulge, 12);
    expect(distance(turned.curve.p0, turned.curve.p3)).toBeCloseTo(distance(flat.curve.p0, flat.curve.p3), 9);
  });

  it("draws in exactly the panels where every anchor resolves", () => {
    for (const kind of VIEW_KINDS) {
      const rep = isStructuralViewKind(kind) ? representation(kind) : representation(kind);
      const built = arrowsOf(fixture.molecule, fixture.annotations, PUBLICATION_STYLE, rep);
      const placement = sceneAnchorPlacement(built.scene, fixture.molecule);
      for (const arrow of fixture.annotations) {
        const drawn = built.scene.primitives.some((p) => p.id === `annotation:${arrow.id}:head`);
        expect(drawn, `${kind} ${arrow.id}`).toBe(schemeAnnotationResolves(arrow, placement));
        expect(built.schemeAnnotations.unresolved.includes(arrow.id), kind).toBe(!drawn);
      }
      expect(built.schemeAnnotations.curlyArrows.length > 0, kind).toBe(isStructuralViewKind(kind));
    }
  });
});

describe("a degenerate chord falls back deterministically", () => {
  it("draws an arrow whose two ends are one point on a fixed chord, byte for byte", () => {
    // A lone pair onto its own atom: chem-core reports it as an arrow at
    // itself, and a user can still draw it.
    const { molecule, oxygen } = cyanideAdditionToAcetone();
    const self = assembleSchemeAnnotation({
      id: "ann_9",
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "lonePair", atomId: oxygen },
      sink: { kind: "atom", atomId: oxygen },
      bulge: 0.4,
      skew: 0,
    }) as CurlyArrowAnnotation;
    for (const style of STYLES) {
      const layout = layoutOf(molecule, self, style);
      expect(layout.findings.map((f) => f.kind)).toContain("degenerate-chord");
      const once = serializeScene(arrowsOf(molecule, [self], style).scene);
      const twice = serializeScene(arrowsOf(molecule, [self], style).scene);
      expect(once).toBe(twice);
      expect(once).not.toMatch(/NaN|Infinity/);
      expect(once).toContain('id="annotation:ann_9:head"');
    }
  });

  it("draws a bond-to-own-atom heterolysis the same way every time, even with no room for a shaft", () => {
    // Half a bond of chord with a wide "Br" at the head: at 0.1 the labels
    // swallow the shaft and only the head is drawn, reported, never moved.
    const { molecule, annotations } = bromineHomolysis();
    const tight = withShape(annotations[0] as CurlyArrowAnnotation, -0.1);
    const layout = layoutOf(molecule, tight);
    expect(layout.findings.length).toBeGreaterThan(0);
    const svg = serializeScene(arrowsOf(molecule, [tight]).scene);
    expect(serializeScene(arrowsOf(molecule, [tight]).scene)).toBe(svg);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain(`id="annotation:${tight.id}:head"`);
    // The creation-time default finds a shape that does fit.
    const context = schemeAnchorContext(molecule, PUBLICATION_STYLE, skeletal)!;
    const chosen = defaultCurlyArrowShape(tight, context.geometry, PUBLICATION_STYLE, context.obstacles)!;
    expect(chosen.clear).toBe(true);
    expect(layoutOf(molecule, withShape(tight, chosen.bulge, chosen.skew)).findings).toEqual([]);
  });
});

describe("an arrow is its own selectable, deletable thing", () => {
  const fixture = cyanideAdditionToAcetone();
  const seven = assembleSchemeAnnotation({ ...fixture.annotations[0]!, id: "ann_7" }) as CurlyArrowAnnotation;

  it("is sourced to its annotation id, never to decoration, with ids from that id", () => {
    const { scene } = arrowsOf(fixture.molecule, [seven]);
    const mine = scene.primitives.filter((p) => p.source.kind === "annotation");
    expect(mine.map((p) => p.id)).toEqual(["annotation:ann_7:shaft", "annotation:ann_7:head"]);
    for (const primitive of mine) {
      expect(primitive.source).toEqual({ kind: "annotation", annotationId: "ann_7" });
    }
    const svg = serializeScene(scene);
    expect(svg).toContain('id="annotation:ann_7:head" data-annotation="ann_7"');
    expect(svg).not.toMatch(/annotation:ann_7:[^"]*" data-decoration/);
  });

  it("is gone from the next scene once the atom it points at is deleted", () => {
    const after = removeAtoms(fixture.molecule, [fixture.carbonylCarbon]);
    const kept = pruneSchemeAnnotations(fixture.annotations, fixture.molecule, after);
    expect(kept.some((a) => a.id === "ann_1")).toBe(false);
    const { scene } = arrowsOf(after, kept);
    expect(scene.primitives.some((p) => p.id.startsWith("annotation:ann_1:"))).toBe(false);
  });

  it("changes no scene built without annotations", () => {
    for (const style of STYLES) {
      expect(serializeScene(buildScene(fixture.molecule, style, skeletal, { schemeAnnotations: [] }))).toBe(
        serializeScene(buildScene(fixture.molecule, style, skeletal)),
      );
    }
  });
});

describe("shaft and head", () => {
  const fixture = cyanideAdditionToAcetone();

  it("draws the shaft as an unfilled stroked path and the head as a filled unstroked polygon", () => {
    for (const style of STYLES) {
      const { scene } = arrowsOf(fixture.molecule, fixture.annotations, style);
      const shaft = primitiveById<PathPrimitive>(scene.primitives, "annotation:ann_1:shaft");
      const head = primitiveById<PolygonPrimitive>(scene.primitives, "annotation:ann_1:head");
      expect(shaft.fill).toBeUndefined();
      // Decision 173: the bonds' own line width.
      expect(shaft.stroke).toEqual({ color: style.colors.bond, width: style.bondLineWidthPx });
      expect(head.fill).toEqual({ color: style.colors.bond });
      expect(head.stroke).toBeUndefined();
      const svg = serializeScene(scene);
      expect(svg).toMatch(/<path id="annotation:ann_1:shaft"[^>]* fill="none"/);
      expect(svg).toMatch(new RegExp(`<polygon id="annotation:ann_1:head"[^>]* fill="${style.colors.bond}"`));
    }
  });

  it("sizes the head in line widths, ChemDraw's curved-arrow proportions (decision 173)", () => {
    for (const style of STYLES) {
      const { head } = layoutOf(fixture.molecule, fixture.annotations[0] as CurlyArrowAnnotation, style);
      const [tip, left, notch, right] = head.points as [ScenePoint, ScenePoint, ScenePoint, ScenePoint];
      expect(distance(tip, notch)).toBeCloseTo(7 * style.bondLineWidthPx, 9);
      expect(distance(left, right)).toBeCloseTo(4 * style.bondLineWidthPx, 9);
      const back = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      expect(distance(tip, back)).toBeCloseTo(8 * style.bondLineWidthPx, 9);
    }
    expect(CURLY_ARROWHEAD).toEqual({ length: 8, notch: 7, halfWidth: 2 });
  });

  it("closes a pair with a full head and a fishhook with one barb, on the outside of the bend", () => {
    const { molecule, annotations } = bromineHomolysis();
    for (const arrow of annotations as CurlyArrowAnnotation[]) {
      const layout = layoutOf(molecule, arrow, SCREEN_STYLE);
      expect(layout.head.points).toHaveLength(3);
      // The one barb sits on the side the curve bows to: away from its centre
      // of curvature, so a tight curl never lays it across its own shaft.
      const [tip, barb, notch] = layout.head.points as [ScenePoint, ScenePoint, ScenePoint];
      const apex = curveApex(layout.curve);
      const chordMid = { x: (layout.curve.p0.x + layout.curve.p3.x) / 2, y: (layout.curve.p0.y + layout.curve.p3.y) / 2 };
      const outward = { x: apex.x - chordMid.x, y: apex.y - chordMid.y };
      const barbSide = { x: barb.x - (tip.x + notch.x) / 2, y: barb.y - (tip.y + notch.y) / 2 };
      expect(outward.x * barbSide.x + outward.y * barbSide.y, arrow.id).toBeGreaterThan(0);
    }
    const full = arrowhead({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, CURLY_ARROWHEAD, "full");
    expect(full.points).toHaveLength(4);
  });

  it("aims a bond sink at the bond's midpoint and stops at the double-bond gap on the arrival side (decision 172)", () => {
    const { molecule, annotations, singleCO } = acetateResonance();
    const intoBond = annotations[0] as CurlyArrowAnnotation;
    const bond = molecule.bonds[singleCO]!;
    for (const style of STYLES) {
      const layout = layoutOf(molecule, intoBond, style);
      const from = modelToPx(style, getAtom(molecule, bond.from)!.pos);
      const to = modelToPx(style, getAtom(molecule, bond.to)!.pos);
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      expect(layout.curve.p3.x).toBeCloseTo(mid.x, 9);
      expect(layout.curve.p3.y).toBeCloseTo(mid.y, 9);
      const length = distance(from, to);
      const unit = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
      const across = (p: ScenePoint): number => -(p.x - mid.x) * unit.y + (p.y - mid.y) * unit.x;
      const along = (p: ScenePoint): number => (p.x - mid.x) * unit.x + (p.y - mid.y) * unit.y;
      expect(Math.abs(across(layout.head.tip))).toBeCloseTo(style.doubleBondGapPx, 6);
      expect(Math.abs(along(layout.head.tip))).toBeLessThan(length / 4);
      // On the side the curve comes from: the shaft's far end is on the same side.
      expect(Math.sign(across(layout.shaft!.p0))).toBe(Math.sign(across(layout.head.tip)));
    }
  });

  it("starts a bond source's tail on the bond's midpoint", () => {
    const { molecule, annotations, carbonyl } = cyanideAdditionToAcetone();
    const bond = molecule.bonds[carbonyl]!;
    for (const style of STYLES) {
      const layout = layoutOf(molecule, annotations[1] as CurlyArrowAnnotation, style);
      const mid = modelToPx(style, {
        x: (getAtom(molecule, bond.from)!.pos.x + getAtom(molecule, bond.to)!.pos.x) / 2,
        y: (getAtom(molecule, bond.from)!.pos.y + getAtom(molecule, bond.to)!.pos.y) / 2,
      });
      expect(layout.shaft!.p0.x).toBeCloseTo(mid.x, 9);
      expect(layout.shaft!.p0.y).toBeCloseTo(mid.y, 9);
    }
  });

  it("leaves a lone pair from the drawn pair facing its head in the Lewis view", () => {
    const { molecule, annotations, cyanideCarbon, carbonylCarbon } = cyanideAdditionToAcetone();
    const attack = annotations[0] as CurlyArrowAnnotation;
    for (const style of STYLES) {
      const layout = layoutOf(molecule, attack, style, lewis);
      const atom = modelToPx(style, getAtom(molecule, cyanideCarbon)!.pos);
      const target = modelToPx(style, getAtom(molecule, carbonylCarbon)!.pos);
      // Off the atom, on the side facing the carbonyl carbon.
      expect(distance(layout.curve.p0, atom)).toBeGreaterThan(1);
      expect(distance(layout.curve.p0, target)).toBeLessThan(distance(atom, target));
      // Skeletal draws no pairs, so the same arrow leaves from the atom.
      expect(layoutOf(molecule, attack, style).curve.p0).toEqual(atom);
    }
  });
});

describe("collisions: chosen at creation, reported after", () => {
  it("draws every fixture arrow clear, in both views the sheet shows, at both presets", () => {
    for (const { name, molecule, annotations } of MECHANISM_FIXTURES) {
      for (const style of STYLES) {
        for (const rep of [skeletal, lewis]) {
          const built = arrowsOf(molecule, annotations, style, rep);
          expect(built.schemeAnnotations.curlyArrows).toHaveLength(annotations.length);
          for (const layout of built.schemeAnnotations.curlyArrows) {
            expect(layout.findings, `${name} ${style.name} ${rep.kind} ${layout.annotationId}`).toEqual([]);
          }
        }
      }
    }
  });

  it("chooses a clear default shape for a new arrow", () => {
    for (const { molecule, annotations } of MECHANISM_FIXTURES) {
      for (const style of STYLES) {
        const context = schemeAnchorContext(molecule, style, skeletal)!;
        for (const arrow of annotations) {
          const chosen = defaultCurlyArrowShape(arrow, context.geometry, style, context.obstacles)!;
          expect(chosen.clear, arrow.id).toBe(true);
          const layout = layoutCurlyArrow({ ...arrow, ...chosen }, context.geometry, style, context.obstacles)!;
          expect(layout.findings).toEqual([]);
        }
      }
    }
  });

  it("reports a later crossing and moves nothing to avoid it", () => {
    // Drag acetone's left methyl down into the cyanide's arrow.
    const fixture = cyanideAdditionToAcetone();
    const attack = fixture.annotations[0] as CurlyArrowAnnotation;
    const methyl = fixture.molecule.atomIds[0]!;
    const crowded = setAtomPosition(fixture.molecule, methyl, { x: -0.35, y: -1 });
    const before = layoutOf(fixture.molecule, attack);
    const after = layoutOf(crowded, attack);
    expect(before.findings).toEqual([]);
    expect(after.findings.length).toBeGreaterThan(0);
    // The curve is the stored one on the same two anchors: not re-routed.
    expect(after.curve).toEqual(before.curve);
  });
});

describe("chem-render's one scaling function, in the annotation layer", () => {
  it("keeps bondLengthPx out of every annotation source file", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "annotation");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(["anchor.ts", "curve.ts", "arrowhead.ts", "curly.ts", "layer.ts"]));
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/bondLengthPx/);
      expect(code, file).not.toMatch(/Math\.(sin|cos|tan|atan2|hypot)\b/);
    }
  });

  it("builds nothing from a molecule's own coordinates in the resolver", () => {
    const code = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "annotation", "anchor.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.pos\b|modelToPx|mol\.atoms/);
  });
});
