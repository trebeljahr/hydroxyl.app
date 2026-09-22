/**
 * The annotation pass: decision 17's priority table, decision 18's locants,
 * decisions 34 and 35 (full obstacle search, proximity), and the determinism
 * every exported figure depends on.
 *
 * The clearance test runs over the steroid, where almost every ring atom's
 * free direction is already occupied — the fixture a single-candidate
 * placement fails on nearly everywhere.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildMolecule,
  flipAtoms,
  setBondStereo,
  horizontalMirror,
  ORIGIN,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import {
  ANNOTATION_PLACEMENT,
  ANNOTATION_PRIORITY,
  annotationId,
  canonicalFreeDirection,
  compareAnnotationRequests,
  placeAnnotation,
  placeAnnotations,
} from "../src/label/annotations.js";
import type {
  AnnotationContext,
  AnnotationKind,
  AnnotationRequest,
} from "../src/label/annotations.js";
import { freeDirection } from "../src/label/placement.js";
import type { LabelBox } from "../src/label/placement.js";
import {
  acetate,
  steroidSkeletonWithLocants,
  butan2olWedged,
  chrysene,
  ethanol,
  FIXTURES,
  methylRadical,
  phenanthrene,
} from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import type { StructuralRepresentation } from "../src/representation.js";
import {
  annotationLayout,
  annotationObstacles,
  buildAnnotatedScene,
  buildScene,
} from "../src/scene/build.js";
import type { SceneBuildOptions } from "../src/scene/build.js";
import type {
  RenderScene,
  ScenePoint,
  TextRunPrimitive,
} from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";
import {
  BUNDLED_MEASURER,
  glyphInkRects,
  measureTextRun,
  textRunInkRect,
  textRunRect,
} from "../src/text/measurer.js";

/**
 * The Publication preset as it was before decisions 44 and 54: the ACS 1996
 * label font (decision 26) with annotations still at 0.85 of it, a 14.2 px
 * "(S)" on a 24 px bond. Not shipped; kept as the CROWDED setting, one step
 * more crowded than Publication's 0.80, so every guarantee is also held where
 * the reporting path is exercised hardest.
 */
const CROWDED_PUBLICATION_STYLE: RenderStyle = withStyle(PUBLICATION_STYLE, {
  name: "publication-crowded",
  stereoDescriptorScale: 0.85,
});

/** A style's name with its annotation size: shown in every failure message. */
function styleLabel(style: RenderStyle): string {
  return `${style.name}@${Math.round(style.fontSizePx * style.stereoDescriptorScale * 10) / 10}px`;
}

/**
 * Where the reader sees a placed annotation: the centre of its glyph INK
 * (decision 57), measured here from the drawn run — its alphabetic-baseline
 * origin (decision 53) and the vendored glyph outlines — rather than read back
 * from the placement's own `inkBox`.
 */
function inkCentre(
  placed: { readonly origin: ScenePoint; readonly text: string; readonly fontSizePx: number },
  style: RenderStyle,
): ScenePoint {
  const run = measureTextRun(
    [{ text: placed.text }],
    {
      fontFamily: style.fontFamily,
      fontSizePx: placed.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: "middle",
      baseline: "alphabetic",
    },
    BUNDLED_MEASURER,
  );
  const ink = textRunInkRect(run, placed.origin, BUNDLED_MEASURER, style.fontFamily)!;
  return { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2 };
}

/** Both shipped presets, and the crowded setting every guarantee must survive. */
const STYLES: readonly RenderStyle[] = Object.freeze([
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  CROWDED_PUBLICATION_STYLE,
]);
const SHIPPED_STYLES: readonly RenderStyle[] = Object.freeze([PUBLICATION_STYLE, SCREEN_STYLE]);
const ANNOTATED = representation("skeletal", {
  showStereoDescriptors: true,
  showLocants: true,
});
const LOCANTS_ONLY = representation("skeletal", { showLocants: true });

const EMPTY_CONTEXT: AnnotationContext = Object.freeze({
  style: PUBLICATION_STYLE,
  obstacles: [],
  segments: [],
});

function request(
  kind: AnnotationKind,
  id: string,
  text = "XY",
  anchor: ScenePoint = { x: 0, y: 0 },
): AnnotationRequest {
  return {
    kind,
    source: id.startsWith("b")
      ? { kind: "bond", bondId: id }
      : { kind: "atom", atomId: id },
    text,
    anchor,
    preferred: { x: 0, y: -1 },
  };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/**
 * The first N slots the ladder offers for "XY" at the origin, each found with
 * every earlier slot blocked — which is exactly what an earlier, higher-
 * priority annotation does to a later one.
 */
function successiveSlots(count: number): ScenePoint[] {
  const slots: ScenePoint[] = [];
  const obstacles: { kind: "rect"; box: LabelBox }[] = [];
  for (let i = 0; i < count; i++) {
    const placed = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles,
    });
    expect(placed.clear).toBe(true);
    slots.push(placed.origin);
    obstacles.push({ kind: "rect", box: placed.box });
  }
  return slots;
}

describe("decision 17: who gets a contested slot", () => {
  it("gives the slot to the descriptor, whichever request came first", () => {
    const [first, second] = successiveSlots(2);
    for (const order of permutations([request("locant", "a1"), request("descriptor", "a1")])) {
      const layout = placeAnnotations(order, EMPTY_CONTEXT);
      const byKind = new Map(layout.placements.map((p) => [p.kind, p]));
      expect(byKind.get("descriptor")!.origin).toEqual(first);
      // The loser takes its NEXT candidate, not a nudge off the winner.
      expect(byKind.get("locant")!.origin).toEqual(second);
      expect(layout.unplaced).toEqual([]);
    }
  });

  it("ranks all four kinds by the fixed table, for every arrival order", () => {
    expect(ANNOTATION_PRIORITY).toEqual(["descriptor", "alphaBeta", "locant", "torsion"]);
    const slots = successiveSlots(4);
    // alphaBeta and torsion have no producer yet; synthetic requests are the
    // only way to prove the pass already ranks them.
    const requests = [
      request("torsion", "b7"),
      request("locant", "a1"),
      request("alphaBeta", "a1"),
      request("descriptor", "a1"),
    ];
    let reference: string | undefined;
    for (const order of permutations(requests)) {
      const layout = placeAnnotations(order, EMPTY_CONTEXT);
      expect(layout.placements.map((p) => p.kind)).toEqual([
        "descriptor",
        "alphaBeta",
        "locant",
        "torsion",
      ]);
      layout.placements.forEach((placed, index) => {
        expect(placed.origin).toEqual(slots[index]);
      });
      const serialised = JSON.stringify(layout);
      reference ??= serialised;
      expect(serialised).toBe(reference);
    }
  });

  it("breaks a same-kind tie by compareIds, so a9 beats a10", () => {
    // Plain string order puts "a10" first. The id order a human reads does
    // not, and neither does iteration order: both arrival orders agree.
    const [first, second] = successiveSlots(2);
    for (const order of [
      [request("locant", "a9"), request("locant", "a10")],
      [request("locant", "a10"), request("locant", "a9")],
    ]) {
      const layout = placeAnnotations(order, EMPTY_CONTEXT);
      const bySource = new Map(
        layout.placements.map((p) => [p.source.kind === "atom" ? p.source.atomId : "", p]),
      );
      expect(bySource.get("a9")!.origin).toEqual(first);
      expect(bySource.get("a10")!.origin).toEqual(second);
    }
    expect(compareAnnotationRequests(request("locant", "a9"), request("locant", "a10"))).toBeLessThan(0);
  });

  it("reports, and still places, the annotation that found no clear slot", () => {
    // Everything but the first slot is walled off, so only one of the two can
    // be clear — and the descriptor is the one that gets it.
    const [first] = successiveSlots(1);
    const box = placeAnnotation(request("descriptor", "a1"), EMPTY_CONTEXT).box;
    const far = 1e4;
    const walls: { kind: "rect"; box: LabelBox }[] = [
      { kind: "rect", box: { minX: -far, minY: -far, maxX: box.minX, maxY: far } },
      { kind: "rect", box: { minX: box.maxX, minY: -far, maxX: far, maxY: far } },
      { kind: "rect", box: { minX: box.minX, minY: -far, maxX: box.maxX, maxY: box.minY } },
      { kind: "rect", box: { minX: box.minX, minY: box.maxY, maxX: box.maxX, maxY: far } },
    ];
    for (const order of permutations([request("locant", "a1"), request("descriptor", "a1")])) {
      const layout = placeAnnotations(order, { ...EMPTY_CONTEXT, obstacles: walls });
      const descriptor = layout.placements.find((p) => p.kind === "descriptor")!;
      const locant = layout.placements.find((p) => p.kind === "locant")!;
      expect(descriptor.clear).toBe(true);
      expect(descriptor.origin).toEqual(first);
      // Never dropped: a missing number with no explanation is worse than a
      // crowded one. Placed at its first candidate and named in the report.
      expect(locant.clear).toBe(false);
      expect(layout.unplaced.map((u) => u.id)).toEqual(["atom:a1:locant"]);
    }
  });

  it("never prints an unplaceable annotation over one already placed", () => {
    // Nothing anywhere is clear, so both are reported. The descriptor takes
    // the first slot; the locant must not take the same one on top of it
    // while a candidate beside it overlaps no annotation.
    const everything = {
      kind: "rect" as const,
      box: { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 },
    };
    const [first] = successiveSlots(1);
    for (const order of permutations([request("locant", "a1"), request("descriptor", "a1")])) {
      const layout = placeAnnotations(order, { ...EMPTY_CONTEXT, obstacles: [everything] });
      const descriptor = layout.placements.find((p) => p.kind === "descriptor")!;
      const locant = layout.placements.find((p) => p.kind === "locant")!;
      expect(descriptor.origin).toEqual(first);
      expect(overlaps(locant.box, descriptor.box)).toBe(false);
      expect(layout.unplaced.map((u) => u.id)).toEqual(["atom:a1:descriptor", "atom:a1:locant"]);
    }
  });

  it("refuses two requests that would share an id", () => {
    expect(() =>
      placeAnnotations([request("locant", "a1", "1"), request("locant", "a1", "2")], EMPTY_CONTEXT),
    ).toThrow(/atom:a1:locant/);
  });
});

describe("decision 35: an annotation reads as its own atom's", () => {
  const centreOf = (box: LabelBox): ScenePoint => ({
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  });
  const d2 = (p: ScenePoint, q: ScenePoint): number => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;

  it("passes over a free slot that sits nearer another atom", () => {
    const [north] = successiveSlots(1);
    const alone = placeAnnotation(request("locant", "a1"), EMPTY_CONTEXT);
    expect(alone.origin).toEqual(north);
    // A neighbour just beyond the north slot: the slot is empty page, but a
    // number there is nearer the neighbour than its own atom.
    const slot = centreOf(alone.box);
    const neighbour = { x: slot.x, y: slot.y * 1.8 };
    const placed = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      atomCentres: [
        { atomId: "a1", centre: { x: 0, y: 0 } },
        { atomId: "a2", centre: neighbour },
      ],
    });
    expect(placed.clear).toBe(true);
    expect(placed.origin).not.toEqual(north);
    const own = centreOf(placed.box);
    expect(d2(own, { x: 0, y: 0 })).toBeLessThan(d2(own, neighbour));
  });

  it("reports an annotation no candidate of which reads as its own", () => {
    // A second atom on the very same spot: every slot is exactly as near it,
    // and a tie is not "nearer".
    const [north] = successiveSlots(1);
    const layout = placeAnnotations([request("locant", "a1")], {
      ...EMPTY_CONTEXT,
      atomCentres: [
        { atomId: "a1", centre: { x: 0, y: 0 } },
        { atomId: "a2", centre: { x: 0, y: 0 } },
      ],
    });
    expect(layout.placements[0]!.origin).toEqual(north);
    expect(layout.unplaced.map((u) => u.id)).toEqual(["atom:a1:locant"]);
  });

  it("measures a bond annotation's proximity to the bond, not its midpoint", () => {
    // Preferred north-east, so that slot is tried first. A third atom sits
    // nearer that slot than the bond's MIDPOINT is, yet further than the bond
    // itself: the slot is the bond's only when measured to the segment.
    const preferred = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const bondRequest: AnnotationRequest = { ...request("torsion", "b1"), preferred };
    const firstSlot = placeAnnotation(bondRequest, EMPTY_CONTEXT);
    const slot = centreOf(firstSlot.box);
    const r = Math.sqrt(d2(slot, { x: 0, y: 0 }));
    const segment = { a: { x: -60, y: 0 }, b: { x: 60, y: 0 } };
    const context: AnnotationContext = {
      ...EMPTY_CONTEXT,
      atomCentres: [
        { atomId: "a1", centre: segment.a },
        { atomId: "a2", centre: segment.b },
        { atomId: "a3", centre: { x: slot.x + 0.85 * r, y: slot.y } },
      ],
    };
    const bySegment = placeAnnotation({ ...bondRequest, anchorSegment: segment }, context);
    expect(bySegment.clear).toBe(true);
    expect(bySegment.origin).toEqual(firstSlot.origin);
    const byMidpoint = placeAnnotation(bondRequest, context);
    expect(byMidpoint.origin).not.toEqual(firstSlot.origin);
  });

  it("sets the steroid's C17 (S) beside C17, not beside C13's methyl", () => {
    // The contact-sheet cell that read wrong: a clear "(S)" on the far rung,
    // nearer C18 than C17, so a chemist read it as C13's.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const c17 = Object.entries(locants).find(([, text]) => text === "17")![0];
    for (const style of STYLES) {
      for (const rep of [representation("skeletal", { showStereoDescriptors: true }), ANNOTATED]) {
        const layout = annotationLayout(molecule, style, rep, { locants });
        const placed = layout.placements.find((p) => p.id === `atom:${c17}:descriptor`)!;
        expect(placed.text).toBe("(S)");
        // Screen has the room. At Publication's 8 pt (decision 54) and the
        // crowded setting the room that reads as C17's is taken by the wedge
        // to O17 and the bonds to C13 and C16; an "(S)" that size touches one
        // of them wherever it goes. Reported there, never passed off as clear.
        const crowded = style !== SCREEN_STYLE;
        expect(placed.clear, styleLabel(style)).toBe(!crowded);
        expect(layout.unplaced.some((u) => u.id === placed.id), styleLabel(style)).toBe(crowded);
        // Clear or reported, it reads as C17's.
        const centre = inkCentre(placed, style);
        const own = d2(centre, modelToPx(style, molecule.atoms[c17]!.pos));
        for (const atomId of molecule.atomIds) {
          if (atomId === c17) continue;
          const other = d2(centre, modelToPx(style, molecule.atoms[atomId]!.pos));
          expect(own, `${styleLabel(style)} (S) nearer ${locants[atomId] ?? atomId}`).toBeLessThan(other);
        }
      }
    }
  });

  it("gives an unclear annotation the least wrong candidate, not the first", () => {
    // Every candidate meets the blanket, so nothing is clear. A second wall
    // covers the page north of the atom, where the first candidate is: taking
    // the first would hit two things where candidates to the south hit one.
    const blanket = { kind: "rect" as const, box: { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 } };
    const first = placeAnnotation(request("locant", "a1"), { ...EMPTY_CONTEXT, obstacles: [blanket] });
    expect(first.clear).toBe(false);
    const wall = { kind: "rect" as const, box: { minX: -60, minY: -60, maxX: 60, maxY: -4 } };
    const placed = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket, wall],
      // The wall is glyph ink (decision 55); the blanket only makes nothing clear.
      glyphInk: [wall.box],
    });
    expect(placed.clear).toBe(false);
    expect(overlaps(first.inkBox, wall.box)).toBe(true);
    expect(overlaps(placed.inkBox, wall.box)).toBe(false);
  });

  it("keeps an unplaceable annotation off another even when nothing reads as its own", () => {
    // A second atom on the very spot and a blanket over everything: no
    // candidate is clear and none is nearer a1 than a2. The locant must still
    // not land on the descriptor, which would make both unreadable.
    const blanket = { kind: "rect" as const, box: { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 } };
    const context: AnnotationContext = {
      ...EMPTY_CONTEXT,
      obstacles: [blanket],
      atomCentres: [
        { atomId: "a1", centre: { x: 0, y: 0 } },
        { atomId: "a2", centre: { x: 0, y: 0 } },
      ],
    };
    for (const order of permutations([request("locant", "a1"), request("descriptor", "a1")])) {
      const layout = placeAnnotations(order, context);
      const [descriptor, locant] = layout.placements;
      expect(descriptor!.kind).toBe("descriptor");
      expect(overlaps(locant!.box, descriptor!.box)).toBe(false);
      expect(layout.unplaced).toHaveLength(2);
    }
  });

  it("holds for every placement, reported ones included, measured independently", () => {
    // Measured at decision 63's margin: a CLEAR placement is always visibly
    // nearer its own atom than any other heavy one. A reported placement may
    // not be — decision 45 takes the least wrong candidate when none reads as
    // its own — and every such case is counted below and pinned, so a new one
    // is a failure rather than a silent change.
    let checked = 0;
    const notOwn = new Set<string>();
    const molecules: [string, Molecule, Readonly<Record<AtomId, string>>][] = [
      ["steroidSkeleton", ...Object.values(steroidSkeletonWithLocants()) as [Molecule, Record<AtomId, string>]],
      ["butan2olWedged", butan2olWedged(), {}],
      ...FIXTURES.map((f): [string, Molecule, Record<AtomId, string>] => [
        f.name,
        f.molecule,
        Object.fromEntries(f.molecule.atomIds.map((id, index) => [id, `${index + 1}`])),
      ]),
    ];
    for (const [name, molecule, locants] of molecules) {
      for (const style of STYLES) {
        for (const [view, showImplicitHydrogens] of [
          ["skeletal", false], ["skeletal", true], ["kekule", false], ["explicitH", false], ["lewis", false],
        ] as const) {
          const rep = representation(view, {
            showStereoDescriptors: true,
            showLocants: true,
            showImplicitHydrogens,
          });
          const layout = annotationLayout(molecule, style, rep, { locants });
          const centres = molecule.atomIds.map((id) => ({
            id,
            at: modelToPx(style, molecule.atoms[id]!.pos),
          }));
          for (const placed of layout.placements) {
            checked++;
            const c = inkCentre(placed, style);
            let own: number;
            if (placed.source.kind === "atom") {
              own = d2(c, modelToPx(style, molecule.atoms[placed.source.atomId]!.pos));
            } else {
              const bond = molecule.bonds[placed.source.bondId]!;
              const a = modelToPx(style, molecule.atoms[bond.from]!.pos);
              const b = modelToPx(style, molecule.atoms[bond.to]!.pos);
              own = squaredDistanceToSegment(c, a, b);
            }
            const where = `${name}/${styleLabel(style)}/${view}${showImplicitHydrogens ? "+H" : ""}/${placed.id}`;
            for (const other of centres) {
              if (placed.source.kind === "atom" && other.id === placed.source.atomId) continue;
              // Decision 63's margin, not a bare inequality.
              if (own <= 0.85 * 0.85 * d2(c, other.at)) continue;
              // A clear placement never reads as another atom's.
              expect(placed.clear, `${where} nearer ${other.id}`).toBe(false);
              notOwn.add(where);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect([...notOwn].sort()).toEqual(NOT_OWN_REPORTED);
  });
});

describe("decision 45: the fallback order when nothing is clear", () => {
  const centreOf = (box: LabelBox): ScenePoint => ({
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  });
  const d2 = (p: ScenePoint, q: ScenePoint): number => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  const far = 1e4;
  /** One glyph every candidate meets, so no candidate is ever clear. */
  const blanket = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: far } };
  const A1 = { x: 0, y: 0 };
  /** Beyond a1 to the south: a candidate centred below y = 15 reads as a2's. */
  const A2 = { x: 0, y: 30 };
  const twoAtoms = [
    { atomId: "a1", centre: A1 },
    { atomId: "a2", centre: A2 },
  ];
  const readsAsOwn = (box: LabelBox): boolean => d2(centreOf(box), A1) < d2(centreOf(box), A2);

  it("(1) keeps off a placed annotation before it reads as its own atom's", () => {
    // Every candidate that reads as a1's overlaps the placed box, which covers
    // the page down to y = 15; only candidates wholly south of it, all nearer
    // a2, do not. Printing over another annotation is the worse wrong.
    const placed: LabelBox = { minX: -far, minY: -far, maxX: far, maxY: 15 };
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket],
      atomCentres: twoAtoms,
      placed: [placed],
    });
    expect(result.clear).toBe(false);
    expect(overlaps(result.box, placed)).toBe(false);
    expect(readsAsOwn(result.inkBox)).toBe(false);
  });

  it("(2) reads as its own atom's before it hits fewer glyphs", () => {
    // A second glyph over everything north of y = 15. A candidate reading as
    // a1's hits both glyphs; some reading as a2's hit only the blanket.
    const north = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: 15 } };
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket, north],
      glyphInk: [north.box],
      atomCentres: twoAtoms,
    });
    expect(result.clear).toBe(false);
    expect(readsAsOwn(result.inkBox)).toBe(true);
    expect(overlaps(result.inkBox, north.box)).toBe(true);
  });

  it("(3) hits fewer glyphs before it hits fewer lines", () => {
    // North of y = 0 a second glyph; south of it a stack of lines one px
    // apart. A candidate straddling y = 0 meets both; one wholly south meets
    // one glyph and several lines, and wins over any meeting two glyphs.
    const north = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: 0 } };
    const lines = Array.from({ length: 200 }, (_, i) => ({
      a: { x: -far, y: i + 0.5 },
      b: { x: far, y: i + 0.5 },
    }));
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket, north],
      glyphInk: [north.box],
      segments: lines,
    });
    expect(result.clear).toBe(false);
    expect(overlaps(result.inkBox, north.box)).toBe(false);
    const lineHits = lines.filter((l) => l.a.y > result.box.minY && l.a.y < result.box.maxY).length;
    expect(lineHits).toBeGreaterThan(1);
  });

  it("(4) hits fewer lines before ladder order", () => {
    // Lines over the north half only: the first candidate (north) meets them,
    // and a candidate that meets none must be taken instead.
    const lines = Array.from({ length: 200 }, (_, i) => ({
      a: { x: -far, y: -i - 0.5 },
      b: { x: far, y: -i - 0.5 },
    }));
    const first = placeAnnotation(request("locant", "a1"), { ...EMPTY_CONTEXT, obstacles: [blanket] });
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket],
      segments: lines,
    });
    expect(result.clear).toBe(false);
    expect(result.origin).not.toEqual(first.origin);
    expect(result.box.minY).toBeGreaterThanOrEqual(-0.5);
  });

  it("(5) then takes the FIRST candidate in ladder order — no geometric tiebreak", () => {
    // Nothing reads as a1's: a ring of 64 other atoms two px out is nearer
    // every candidate. All candidates hit the one blanket and nothing else, so
    // every key ties and ladder order decides: the first rung, north. A
    // "least misattributed" key — the own-to-nearest-other ratio an earlier
    // version used — would pick an outer rung instead.
    const ring = Array.from({ length: 64 }, (_, i) => {
      const angle = (i / 64) * 2 * Math.PI;
      return { atomId: `r${i}`, centre: { x: 2 * Math.cos(angle), y: 2 * Math.sin(angle) } };
    });
    const atomCentres = [{ atomId: "a1", centre: A1 }, ...ring];
    const [north] = successiveSlots(1);
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket],
      atomCentres,
    });
    expect(result.clear).toBe(false);
    expect(result.origin).toEqual(north);
  });
});

describe("decision 55: a glyph hit is ink overprinted, by area", () => {
  const far = 1e4;
  const blanket = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: far } };

  it("always ranks a real overprint below a near-miss that only reaches clearance padding", () => {
    // Nothing is clear (the blanket). The first candidate's ink touches one
    // glyph's ink by a sliver: a real overprint. Every other candidate meets
    // only CLEARANCE records — four walls fencing the first candidate's box,
    // standing in for the padded cap-band and line-band boxes a label adds —
    // and no ink at all. Counting records, the first candidate ties the rest
    // (two each) and wins on ladder order, printing on the glyph. By ink
    // area it has the only nonzero score and loses to every near-miss.
    const first = placeAnnotation(request("locant", "a1"), { ...EMPTY_CONTEXT, obstacles: [blanket] });
    const ink = first.inkBox;
    const glyph: LabelBox = { minX: ink.maxX - 0.25, minY: ink.minY, maxX: ink.maxX + 6, maxY: ink.maxY };
    const box = first.box;
    const fence: { kind: "rect"; box: LabelBox }[] = [
      { kind: "rect", box: { minX: -far, minY: -far, maxX: box.minX, maxY: far } },
      { kind: "rect", box: { minX: box.maxX, minY: -far, maxX: far, maxY: far } },
      { kind: "rect", box: { minX: box.minX, minY: -far, maxX: box.maxX, maxY: box.minY } },
      { kind: "rect", box: { minX: box.minX, minY: box.maxY, maxX: box.maxX, maxY: far } },
    ];
    const placed = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket, { kind: "rect", box: glyph }, ...fence],
      glyphInk: [glyph],
    });
    expect(placed.clear).toBe(false);
    expect(overlaps(first.inkBox, glyph)).toBe(true);
    expect(placed.origin).not.toEqual(first.origin);
    expect(overlaps(placed.inkBox, glyph)).toBe(false);
  });

  it("does not count obstacle records: naming one glyph several times changes nothing", () => {
    // A label names each glyph more than once among its CLEARANCE records (a
    // cap-band box and a line-band box, padded). Those decide whether a
    // candidate is clear; they must not weigh in the fallback. The glyph
    // below covers the north half of the page; listed once or five times as
    // an obstacle, the fallback is the same placement, off its ink.
    const north: LabelBox = { minX: -far, minY: -far, maxX: far, maxY: 0 };
    const record = { kind: "rect" as const, box: north };
    const withRecords = (count: number) =>
      placeAnnotation(request("locant", "a1"), {
        ...EMPTY_CONTEXT,
        obstacles: [blanket, ...Array.from({ length: count }, () => record)],
        glyphInk: [north],
      });
    const once = withRecords(1);
    expect(once.clear).toBe(false);
    expect(overlapArea(once.inkBox, north)).toBe(0);
    for (const count of [0, 2, 5]) expect(withRecords(count)).toEqual(once);
  });
});

describe("decision 58: a reported annotation that would print on text is not drawn", () => {
  const far = 1e4;
  const blanket = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: far } };

  it("drops it, reports why, and lets it block nothing", () => {
    // Glyph ink under every candidate: no slot is clear, and the least wrong
    // one still prints on text.
    const context: AnnotationContext = {
      ...EMPTY_CONTEXT,
      obstacles: [blanket],
      glyphInk: [blanket.box],
    };
    for (const order of permutations([request("locant", "a1"), request("descriptor", "a1")])) {
      const layout = placeAnnotations(order, context);
      const [descriptor, locant] = layout.placements;
      expect(descriptor!.kind).toBe("descriptor");
      expect(descriptor!.drawn).toBe(false);
      expect(locant!.drawn).toBe(false);
      expect(layout.unplaced.map((u) => [u.id, u.dropped, u.reason])).toEqual([
        ["atom:a1:descriptor", true, "printsOnText"],
        ["atom:a1:locant", true, "printsOnText"],
      ]);
      // Not on the page, so not in the way: the locant is free to take the
      // very slot the dropped descriptor was given.
      expect(locant!.origin).toEqual(descriptor!.origin);
    }
  });

  it("still draws a reported annotation that only crosses bond lines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      a: { x: -far, y: i - 100.5 },
      b: { x: far, y: i - 100.5 },
    }));
    const layout = placeAnnotations([request("descriptor", "a1")], {
      ...EMPTY_CONTEXT,
      segments: lines,
      glyphInk: [],
    });
    expect(layout.placements[0]!.clear).toBe(false);
    expect(layout.placements[0]!.drawn).toBe(true);
    expect(layout.unplaced.map((u) => [u.id, u.dropped, u.reason])).toEqual([
      ["atom:a1:descriptor", false, "crowded"],
    ]);
  });

  it("keeps the steroid's reported descriptors that only cross lines, drops the ones on text", () => {
    // Every one of the four is reported at 8 pt (decision 63's margin). C17's
    // crosses bond lines and is still drawn in all three views; C3's sits on
    // the wedge to O17 — filled shapes are ink (decision 65) — and C13's on a
    // derived "H" once the hydrogens are drawn.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const idOf = (locant: string): string =>
      `atom:${Object.entries(locants).find(([, text]) => text === locant)![0]}:descriptor`;
    const expected: Record<string, readonly string[]> = {
      skeletal: [idOf("3")],
      explicitH: [idOf("13"), idOf("10"), idOf("3")],
      lewis: [idOf("13"), idOf("10"), idOf("3")],
    };
    for (const view of ["skeletal", "explicitH", "lewis"] as const) {
      const rep = representation(view, { showStereoDescriptors: true });
      const layout = annotationLayout(molecule, PUBLICATION_STYLE, rep);
      const dropped = layout.unplaced.filter((u) => u.dropped).map((u) => u.id);
      expect(new Set(dropped), view).toEqual(new Set(expected[view]));
      expect(layout.unplaced.some((u) => u.id === idOf("17") && !u.dropped), view).toBe(true);
      const ids = buildScene(molecule, PUBLICATION_STYLE, rep).primitives.map((p) => p.id);
      expect(ids.includes(idOf("17")), view).toBe(true);
      for (const id of expected[view]!) expect(ids.includes(id), `${view}/${id}`).toBe(false);
    }
  });

  it("draws no annotation's ink on any text's ink, in any fixture, view or preset", () => {
    // Independent of the pass: glyph ink recomputed from the emitted runs
    // (alphabetic baselines, decision 53) and compared glyph by glyph.
    const glyphs = (run: TextRunPrimitive, style: RenderStyle): LabelBox[] =>
      glyphInkRects(
        measureTextRun(
          run.spans,
          {
            fontFamily: run.fontFamily,
            fontSizePx: run.fontSizePx,
            subscriptScale: style.subscriptScale,
            anchor: run.anchor,
            baseline: "alphabetic",
          },
          BUNDLED_MEASURER,
        ),
        run.origin,
        BUNDLED_MEASURER,
        run.fontFamily,
      );
    const numbered = (m: Molecule): Record<AtomId, string> =>
      Object.fromEntries(m.atomIds.map((id, index) => [id, `${index + 1}`]));
    const steroid = steroidSkeletonWithLocants();
    const molecules: [string, Molecule, Record<AtomId, string>][] = [
      ...FIXTURES.map((f): [string, Molecule, Record<AtomId, string>] => [f.name, f.molecule, numbered(f.molecule)]),
      ["steroidSkeleton", steroid.molecule, { ...numbered(steroid.molecule), ...steroid.locants }],
      ["phenanthrene", phenanthrene(), numbered(phenanthrene())],
    ];
    let annotations = 0;
    for (const [name, molecule, locants] of molecules) {
      for (const style of STYLES) {
        for (const view of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
          for (const aromaticCircles of [false, true]) {
            const rep = representation(view, { showStereoDescriptors: true, showLocants: true, aromaticCircles });
            const runs = buildScene(molecule, style, rep, { locants }).primitives.filter(
              (p): p is TextRunPrimitive => p.type === "textRun",
            );
            const isAnnotation = (run: TextRunPrimitive): boolean =>
              run.id.endsWith(":locant") || run.id.endsWith(":descriptor");
            const ink = runs.map((run) => ({ run, boxes: glyphs(run, style) }));
            for (const { run, boxes } of ink) {
              if (!isAnnotation(run)) continue;
              annotations++;
              for (const other of ink) {
                if (other.run === run) continue;
                for (const a of boxes) {
                  for (const b of other.boxes) {
                    expect(
                      overlapArea(a, b),
                      `${name}/${styleLabel(style)}/${view}/circles=${aromaticCircles}: ${run.id} on ${other.run.id}`,
                    ).toBe(0);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(annotations).toBeGreaterThan(1000);
  });
});

describe("decision 63: a slot has to be VISIBLY its own atom's", () => {
  it("refuses a slot nearer its own atom by less than the margin, and takes one that clears it", () => {
    // The first slot is 1 px nearer a1 than a2 — a strict inequality passed
    // it, and a reader sees a number midway between two atoms.
    const first = placeAnnotation(request("locant", "a1"), EMPTY_CONTEXT);
    const centre = inkCentre(first, PUBLICATION_STYLE);
    const radius = Math.sqrt(centre.x ** 2 + centre.y ** 2);
    const atoms = (gap: number): AnnotationContext => ({
      ...EMPTY_CONTEXT,
      atomCentres: [
        { atomId: "a1", centre: ORIGIN_PX },
        // Straight beyond the slot, so its distance to a2 is `gap` more.
        { atomId: "a2", centre: { x: centre.x * (1 + gap / radius), y: centre.y * (1 + gap / radius) } },
      ],
    });
    const near = placeAnnotation(request("locant", "a1"), atoms(1));
    expect(near.clear).toBe(true);
    expect(near.origin).not.toEqual(first.origin);
    const nearCentre = inkCentre(near, PUBLICATION_STYLE);
    const own = Math.sqrt(nearCentre.x ** 2 + nearCentre.y ** 2);
    const other = Math.sqrt(
      (nearCentre.x - atoms(1).atomCentres![1]!.centre.x) ** 2 +
        (nearCentre.y - atoms(1).atomCentres![1]!.centre.y) ** 2,
    );
    expect(own / other).toBeLessThanOrEqual(ANNOTATION_PLACEMENT.ownDistanceRatio);

    // With the neighbour far enough away — the slot then sits half as far
    // from its own atom as from it — the first slot clears the margin and is
    // taken, so the refusal above is the margin and not the geometry.
    const far = placeAnnotation(request("locant", "a1"), atoms(2 * radius));
    expect(far.clear).toBe(true);
    expect(far.origin).toEqual(first.origin);
  });

  it("stops passing the steroid's C10 (S), centred in ring A, off as clear", () => {
    // The case decision 63 was ruled on: it sat in the middle of ring A and
    // was 0.01 px nearer C10 than its neighbour.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const c10 = Object.entries(locants).find(([, text]) => text === "10")![0];
    const layout = annotationLayout(
      molecule,
      PUBLICATION_STYLE,
      representation("skeletal", { showStereoDescriptors: true }),
    );
    const placed = layout.placements.find((p) => p.id === `atom:${c10}:descriptor`)!;
    expect(placed.clear).toBe(false);
    expect(layout.unplaced.some((u) => u.id === placed.id)).toBe(true);
  });
});

describe("decision 64: drawn means a clearance from every glyph, not just no overlap", () => {
  const far = 1e4;
  /** Lines everywhere, so nothing is clear and no glyph ink ranks anything. */
  const lines = Array.from({ length: 400 }, (_, i) => ({
    a: { x: -far, y: i - 200.5 },
    b: { x: far, y: i - 200.5 },
  }));

  it("drops a reported annotation half a pixel from a glyph, and draws one a clearance away", () => {
    const crowded = placeAnnotations([request("locant", "a1", "13")], {
      ...EMPTY_CONTEXT,
      segments: lines,
    });
    const chosen = crowded.placements[0]!;
    expect(chosen.clear).toBe(false);
    expect(chosen.drawn).toBe(true);
    // A "C" just above the chosen slot's ink, touching nothing: "13" that
    // near a letter reads as 13-C.
    const beside = (gap: number): LabelBox => ({
      minX: chosen.inkBox.minX,
      minY: chosen.inkBox.minY - gap - 4,
      maxX: chosen.inkBox.maxX,
      maxY: chosen.inkBox.minY - gap,
    });
    const at = (gap: number) =>
      placeAnnotations([request("locant", "a1", "13")], {
        ...EMPTY_CONTEXT,
        segments: lines,
        glyphInk: [beside(gap)],
      });
    const near = at(0.5);
    expect(near.placements[0]!.origin).toEqual(chosen.origin);
    expect(near.placements[0]!.drawn).toBe(false);
    expect(near.unplaced.map((u) => [u.dropped, u.reason])).toEqual([[true, "printsOnText"]]);
    const clearOfIt = at(ANNOTATION_PLACEMENT.clearancePx + 0.01);
    expect(clearOfIt.placements[0]!.origin).toEqual(chosen.origin);
    expect(clearOfIt.placements[0]!.drawn).toBe(true);
    expect(clearOfIt.unplaced.map((u) => [u.dropped, u.reason])).toEqual([[false, "crowded"]]);
  });
});

describe("decision 65: a filled shape is ink, a hashed one is lines", () => {
  const wedged = butan2olWedged();
  const rep = representation("skeletal", { showLocants: true });
  const locants = Object.fromEntries(wedged.atomIds.map((id, i) => [id, `${i + 1}`]));

  function inkIn(molecule: Molecule): { boxes: readonly LabelBox[]; wedge: LabelBox | undefined } {
    const context = annotationObstacles(molecule, PUBLICATION_STYLE, rep, { locants })!;
    const polygon = buildScene(molecule, PUBLICATION_STYLE, rep, { locants }).primitives.find(
      (p) => p.type === "polygon",
    );
    if (polygon === undefined || polygon.type !== "polygon") {
      return { boxes: context.glyphInk ?? [], wedge: undefined };
    }
    const xs = polygon.points.map((p) => p.x);
    const ys = polygon.points.map((p) => p.y);
    return {
      boxes: context.glyphInk ?? [],
      wedge: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
    };
  }

  it("makes the solid wedge's own area glyph ink, in slices rather than one loose box", () => {
    const { boxes, wedge } = inkIn(wedged);
    expect(wedge).toBeDefined();
    const inside = boxes.filter((box) => overlapArea(box, wedge!) > 0);
    expect(inside.length).toBeGreaterThan(1);
    // Every slice is inside the wedge's own bounding box…
    for (const box of inside) {
      expect(box.minX).toBeGreaterThanOrEqual(wedge!.minX - 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(wedge!.maxX + 1e-9);
      expect(box.minY).toBeGreaterThanOrEqual(wedge!.minY - 1e-9);
      expect(box.maxY).toBeLessThanOrEqual(wedge!.maxY + 1e-9);
    }
    // …and together they cover about the triangle, not the box around it.
    const area = inside.reduce((sum, box) => sum + (box.maxX - box.minX) * (box.maxY - box.minY), 0);
    const boxArea = (wedge!.maxX - wedge!.minX) * (wedge!.maxY - wedge!.minY);
    expect(area).toBeGreaterThan(boxArea * 0.4);
    expect(area).toBeLessThan(boxArea * 0.75);
  });

  it("leaves a hashed wedge as lines: no glyph ink where the ladder is", () => {
    const hashed = setBondStereo(wedged, "b7", "hash");
    const { boxes } = inkIn(hashed);
    const { wedge } = inkIn(wedged);
    // The same bond, drawn as a ladder of strokes: nothing there is ink.
    // (The atom labels' own ink is elsewhere; the wedge's box is the region
    // the solid mark filled.)
    const inside = boxes.filter((box) => overlapArea(box, wedge!) > 0);
    expect(inside).toEqual([]);
  });

  it("drops the steroid's C3 (S), which would otherwise print inside the solid wedge", () => {
    const { molecule, locants: steroidLocants } = steroidSkeletonWithLocants();
    const c3 = Object.entries(steroidLocants).find(([, text]) => text === "3")![0];
    const layout = annotationLayout(
      molecule,
      PUBLICATION_STYLE,
      representation("skeletal", { showStereoDescriptors: true }),
    );
    const report = layout.unplaced.find((u) => u.id === `atom:${c3}:descriptor`)!;
    expect(report).toBeDefined();
    expect(report.dropped).toBe(true);
    expect(report.reason).toBe("printsOnText");
  });
});

describe("decision 61: which dots are glyph ink", () => {
  it("counts radical and lone-pair dots as glyph ink, and a bare-vertex dot only as an obstacle", () => {
    const cases: [Molecule, "skeletal" | "lewis", RegExp, boolean][] = [
      [ethanol(), "skeletal", /^atom:a\d+:dot$/, false],
      [methylRadical(), "skeletal", /:radical:/, true],
      [acetate(), "lewis", /:lonepair:/, true],
    ];
    for (const [molecule, view, pattern, isInk] of cases) {
      const rep = representation(view, { showLocants: true });
      const locants = { [molecule.atomIds[0]!]: "1" };
      const context = annotationObstacles(molecule, PUBLICATION_STYLE, rep, { locants })!;
      const dots = buildScene(molecule, PUBLICATION_STYLE, rep, { locants }).primitives.filter(
        (p) => p.type === "circle" && pattern.test(p.id),
      );
      expect(dots.length, String(pattern)).toBeGreaterThan(0);
      for (const dot of dots) {
        if (dot.type !== "circle") continue;
        const box = {
          minX: dot.centre.x - dot.radius,
          minY: dot.centre.y - dot.radius,
          maxX: dot.centre.x + dot.radius,
          maxY: dot.centre.y + dot.radius,
        };
        // Glyph ink or not, as ruled.
        expect(context.glyphInk!.some((ink) => overlaps(ink, box)), dot.id).toBe(isInk);
        // Either way it stops a slot counting as clear.
        expect(
          context.obstacles.some(
            (o) => (o.kind === "disc" ? discMeetsBox(o.centre, o.radius, box) : overlaps(o.box, box)),
          ),
          dot.id,
        ).toBe(true);
      }
    }
  });

  it("reports the build's own annotations beside its scene, from one placement run", () => {
    const { molecule, locants } = steroidSkeletonWithLocants();
    const built = buildAnnotatedScene(molecule, PUBLICATION_STYLE, ANNOTATED, { locants });
    expect(serializeScene(built.scene)).toBe(serializeScene(buildScene(molecule, PUBLICATION_STYLE, ANNOTATED, { locants })));
    expect(built.annotations).toEqual(annotationLayout(molecule, PUBLICATION_STYLE, ANNOTATED, { locants }));
  });
});

describe("decision 59: the ladder is sized from the atom label", () => {
  const labelCap = (style: RenderStyle): number =>
    BUNDLED_MEASURER.verticalMetrics({ family: style.fontFamily, sizePx: style.fontSizePx }).capHeightPx;

  it("starts the first rung at the same label-sized radius whatever the annotation's size", () => {
    for (const scale of [0.5, 0.66, 0.8, 1]) {
      const style = withStyle(PUBLICATION_STYLE, { stereoDescriptorScale: scale });
      const placed = placeAnnotation(request("locant", "a1"), { ...EMPTY_CONTEXT, style });
      const centreY = (placed.box.minY + placed.box.maxY) / 2;
      const halfWidth = (placed.box.maxX - placed.box.minX - 2) / 2;
      expect(placed.clear).toBe(true);
      expect(-centreY - halfWidth, `scale ${scale}`).toBeCloseTo(1.4 * labelCap(style), 9);
    }
  });

  it("searches as far for a small annotation as for a large one", () => {
    // Everything within 30 px of the atom is taken. Sized from the
    // annotation's own cap height, a 0.5-scale run's outermost rung stops
    // near 26 px and it would be reported; sized from the label, every size
    // reaches past the disc.
    const disc = { kind: "disc" as const, centre: { x: 0, y: 0 }, radius: 30 };
    for (const scale of [0.5, 0.66, 0.8, 1]) {
      const style = withStyle(PUBLICATION_STYLE, { stereoDescriptorScale: scale });
      const placed = placeAnnotation(request("locant", "a1"), { ...EMPTY_CONTEXT, style, obstacles: [disc] });
      expect(placed.clear, `scale ${scale}`).toBe(true);
    }
  });
});

describe("decision 57: proximity is judged at the ink centre", () => {
  it("refuses a slot whose em-box centre reads as its own but whose ink does not", () => {
    // The em box a run is measured in is centred on its advance and on the
    // ascender-to-descender band; the ink is not. A "1" sits right of its
    // advance's centre, so "17"'s ink centre is ~0.17 px right of its em
    // centre at 8 pt; "(S)"'s parentheses reach below the baseline, putting
    // its ink centre ~1.2 px lower. The reader sees the ink.
    //
    // For each, a neighbour is placed so that the perpendicular bisector of
    // a1 and the neighbour runs exactly between the two centres of the first
    // slot: by its em centre the slot reads as a1's, by its ink it reads as
    // the neighbour's. It must be refused.
    const d = (p: ScenePoint, q: ScenePoint): number => Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
    //
    // Each is tried on the side its ink leans to (east for "17", south for
    // "(S)"), which puts a1 on the em centre's side of that bisector.
    for (const [kind, text, minimumLift, preferred] of [
      ["locant", "17", 0.1, { x: 1, y: 0 }],
      ["descriptor", "(S)", 1, { x: 0, y: 1 }],
    ] as const) {
      const req = { ...request(kind, "a1", text), preferred };
      const first = placeAnnotation(req, EMPTY_CONTEXT);
      const em = { x: (first.box.minX + first.box.maxX) / 2, y: (first.box.minY + first.box.maxY) / 2 };
      const ink = inkCentre(first, PUBLICATION_STYLE);
      // The premise: the two centres differ, measurably.
      const lift = d(em, ink);
      expect(lift, text).toBeGreaterThan(minimumLift);
      // Reflect a1 across the bisector of em and ink.
      const u = { x: (ink.x - em.x) / lift, y: (ink.y - em.y) / lift };
      const mid = { x: (em.x + ink.x) / 2, y: (em.y + ink.y) / 2 };
      const along = mid.x * u.x + mid.y * u.y;
      expect(along, text).toBeGreaterThan(0);
      const neighbour = { x: 2 * along * u.x, y: 2 * along * u.y };
      expect(d(em, ORIGIN_PX), text).toBeLessThan(d(em, neighbour));
      expect(d(ink, neighbour), text).toBeLessThan(d(ink, ORIGIN_PX));

      const placed = placeAnnotation(req, {
        ...EMPTY_CONTEXT,
        atomCentres: [
          { atomId: "a1", centre: ORIGIN_PX },
          { atomId: "a2", centre: neighbour },
        ],
      });
      expect(placed.origin, text).not.toEqual(first.origin);
      const seen = inkCentre(placed, PUBLICATION_STYLE);
      expect(d(seen, ORIGIN_PX), text).toBeLessThan(d(seen, neighbour));
    }
  });

  it("emits the ink where the placement measured it: origin on the baseline", () => {
    // Decision 53 carried through the pass: the run's y is its alphabetic
    // baseline, and the measured box and ink box are exactly where the run's
    // own measurement from that baseline puts them.
    const { molecule, locants } = steroidSkeletonWithLocants();
    for (const style of SHIPPED_STYLES) {
      const layout = annotationLayout(molecule, style, ANNOTATED, { locants });
      for (const placed of layout.placements) {
        const run = measureTextRun(
          [{ text: placed.text }],
          {
            fontFamily: style.fontFamily,
            fontSizePx: placed.fontSizePx,
            subscriptScale: style.subscriptScale,
            anchor: "middle",
            baseline: "alphabetic",
          },
          BUNDLED_MEASURER,
        );
        const rect = textRunRect(run, placed.origin);
        expect(rect.minY - 1, placed.id).toBeCloseTo(placed.box.minY, 9);
        expect(rect.maxY + 1, placed.id).toBeCloseTo(placed.box.maxY, 9);
        const ink = textRunInkRect(run, placed.origin, BUNDLED_MEASURER, style.fontFamily)!;
        expect(ink.minY, placed.id).toBeCloseTo(placed.inkBox.minY, 9);
        expect(ink.maxY, placed.id).toBeCloseTo(placed.inkBox.maxY, 9);
        // The ink stays inside the measured band.
        expect(ink.minY).toBeGreaterThanOrEqual(rect.minY - 1e-9);
        expect(ink.maxY).toBeLessThanOrEqual(rect.maxY + 1e-9);
      }
    }
  });
});

describe("decision 46: only real atoms compete in the proximity rule", () => {
  it("places annotations clear beside a drawn hydrogen that is nearer than their own atom", () => {
    // The explicitH and Lewis views draw derived hydrogens. They are obstacles
    // (no annotation prints over one), but they are not atoms an annotation
    // can be misread as belonging to. If they competed, every clear placement
    // below would be nearer its own atom than every drawn "H"; some are not.
    let besideHydrogen = 0;
    const molecules: [string, Molecule, Readonly<Record<AtomId, string>>][] = [
      ["steroidSkeleton", ...(Object.values(steroidSkeletonWithLocants()) as [Molecule, Record<AtomId, string>])],
      ...FIXTURES.map((f): [string, Molecule, Record<AtomId, string>] => [
        f.name,
        f.molecule,
        Object.fromEntries(f.molecule.atomIds.map((id, index) => [id, `${index + 1}`])),
      ]),
    ];
    for (const [, molecule, locants] of molecules) {
      for (const view of ["explicitH", "lewis"] as const) {
        const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
        const scene = buildScene(molecule, PUBLICATION_STYLE, rep, { locants });
        const hydrogens = scene.primitives
          .filter((p): p is TextRunPrimitive => p.type === "textRun" && p.id.includes(":h:"))
          .map((run) => run.origin);
        const layout = annotationLayout(molecule, PUBLICATION_STYLE, rep, { locants });
        for (const placed of layout.placements) {
          if (!placed.clear || placed.source.kind !== "atom") continue;
          const c = inkCentre(placed, PUBLICATION_STYLE);
          const own = modelToPx(PUBLICATION_STYLE, molecule.atoms[placed.source.atomId]!.pos);
          const ownD = (c.x - own.x) ** 2 + (c.y - own.y) ** 2;
          if (hydrogens.some((h) => (c.x - h.x) ** 2 + (c.y - h.y) ** 2 <= ownD)) besideHydrogen++;
        }
      }
    }
    expect(besideHydrogen).toBeGreaterThan(0);
  });
});

describe("decision 54: Publication annotations at the 8 pt floor", () => {
  /** The measurement set style.ts records its counts on. */
  const cases = (): [string, Molecule, Readonly<Record<AtomId, string>>][] => {
    const steroid = steroidSkeletonWithLocants();
    const numbered = (molecule: Molecule): Record<AtomId, string> =>
      Object.fromEntries(molecule.atomIds.map((id, index) => [id, `${index + 1}`]));
    return [
      ...FIXTURES.map((f): [string, Molecule, Record<AtomId, string>] => [f.name, f.molecule, numbered(f.molecule)]),
      [
        "steroidSkeleton",
        steroid.molecule,
        { ...numbered(steroid.molecule), ...steroid.locants },
      ],
      ["phenanthrene", phenanthrene(), numbered(phenanthrene())],
    ];
  };
  const VIEWS = ["skeletal", "kekule", "explicitH", "lewis"] as const;

  /** Every report over the measurement set; steroid atoms named by their real locant. */
  function reportedIds(style: RenderStyle): string[] {
    const { locants: steroidLocants } = steroidSkeletonWithLocants();
    const ids: string[] = [];
    for (const [name, molecule, locants] of cases()) {
      for (const view of VIEWS) {
        const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
        for (const u of annotationLayout(molecule, style, rep, { locants }).unplaced) {
          const [, id, kind] = u.id.split(":");
          const label =
            name === "steroidSkeleton" && u.source.kind === "atom" ? `C${steroidLocants[id as AtomId]}` : id;
          ids.push(`${name}/${view}/${label}:${kind}${u.dropped ? " (dropped)" : ""}`);
        }
      }
    }
    return ids.sort();
  }

  function counts(style: RenderStyle): {
    total: number;
    descriptors: number;
    unplaced: number;
    unplacedDescriptors: number;
    dropped: number;
  } {
    let dropped = 0;
    let total = 0;
    let descriptors = 0;
    let unplaced = 0;
    let unplacedDescriptors = 0;
    for (const [, molecule, locants] of cases()) {
      for (const view of VIEWS) {
        const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
        const layout = annotationLayout(molecule, style, rep, { locants });
        total += layout.placements.length;
        descriptors += layout.placements.filter((p) => p.kind === "descriptor").length;
        unplaced += layout.unplaced.length;
        unplacedDescriptors += layout.unplaced.filter((u) => u.kind === "descriptor").length;
        dropped += layout.unplaced.filter((u) => u.dropped).length;
      }
    }
    return { total, descriptors, unplaced, unplacedDescriptors, dropped };
  }

  it("sets descriptors and locants at 8 pt beside the 10 pt label, and leaves Screen alone", () => {
    expect(PUBLICATION_STYLE.stereoDescriptorScale).toBe(0.8);
    expect(SCREEN_STYLE.stereoDescriptorScale).toBe(0.85);
    // Decision 26's label: 50/3 px is 10 pt at the printed bond, so 0.8 of it
    // is the 8 pt ACS artwork minimum decision 51 cites.
    expect(PUBLICATION_STYLE.fontSizePx).toBe(50 / 3);
    const pt = (px: number): number => (px * 10) / (50 / 3);
    expect(pt(PUBLICATION_STYLE.fontSizePx * PUBLICATION_STYLE.stereoDescriptorScale)).toBeCloseTo(8, 12);
    // One annotation size per figure: locants share the descriptor's scale.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const sizes = new Set(
      annotationLayout(molecule, PUBLICATION_STYLE, ANNOTATED, { locants }).placements.map((p) => p.fontSizePx),
    );
    expect([...sizes]).toEqual([PUBLICATION_STYLE.fontSizePx * PUBLICATION_STYLE.stereoDescriptorScale]);
  });

  it("reports what style.ts records: 104 of 516 at 0.80 (24 of 28 descriptors), 53 not drawn", () => {
    expect(counts(PUBLICATION_STYLE)).toEqual({
      total: 516,
      descriptors: 28,
      unplaced: 104,
      unplacedDescriptors: 24,
      dropped: 53,
    });
    // The pre-decision-44 scale, for the record style.ts keeps beside it.
    // With the ladder sized from the label (decision 59) the scale no longer
    // changes how far the search reaches, and here not the count either.
    expect(counts(CROWDED_PUBLICATION_STYLE)).toEqual({
      total: 516,
      descriptors: 28,
      unplaced: 106,
      unplacedDescriptors: 24,
      dropped: 51,
    });
  });

  it("reports exactly these annotations at 0.80, by id — C17's (S) among them", () => {
    // By id rather than by count: a scale, ladder or obstacle change that
    // trades one report for another fails here instead of passing unchanged.
    expect(reportedIds(PUBLICATION_STYLE)).toEqual(
      [
        "acetate/explicitH/a2:locant (dropped)",
        "acetate/lewis/a2:locant (dropped)",
        "butan2olWedged/explicitH/a2:descriptor (dropped)",
        "butan2olWedged/explicitH/a2:locant",
        "butan2olWedged/kekule/a2:descriptor",
        "butan2olWedged/lewis/a2:descriptor (dropped)",
        "butan2olWedged/lewis/a2:locant",
        "butan2olWedged/skeletal/a2:descriptor",
        "chrysene/explicitH/a15:locant (dropped)",
        "chrysene/explicitH/a16:locant (dropped)",
        "chrysene/explicitH/a24:locant (dropped)",
        "chrysene/explicitH/a25:locant (dropped)",
        "chrysene/explicitH/a2:locant",
        "chrysene/explicitH/a3:locant (dropped)",
        "chrysene/kekule/a16:locant",
        "chrysene/kekule/a25:locant",
        "chrysene/lewis/a15:locant (dropped)",
        "chrysene/lewis/a16:locant (dropped)",
        "chrysene/lewis/a24:locant (dropped)",
        "chrysene/lewis/a25:locant (dropped)",
        "chrysene/lewis/a2:locant",
        "chrysene/lewis/a3:locant (dropped)",
        "chrysene/skeletal/a16:locant",
        "chrysene/skeletal/a25:locant",
        "cis2Butene/explicitH/b3:descriptor",
        "cis2Butene/lewis/b3:descriptor",
        "dimethylSulfone/explicitH/a1:locant",
        "dimethylSulfone/kekule/a1:locant",
        "dimethylSulfone/lewis/a1:locant",
        "dimethylSulfone/skeletal/a1:locant",
        "naphthalene/explicitH/a2:locant",
        "naphthalene/explicitH/a3:locant (dropped)",
        "naphthalene/lewis/a2:locant",
        "naphthalene/lewis/a3:locant (dropped)",
        "phenanthrene/explicitH/a15:locant (dropped)",
        "phenanthrene/explicitH/a16:locant (dropped)",
        "phenanthrene/explicitH/a2:locant",
        "phenanthrene/explicitH/a3:locant (dropped)",
        "phenanthrene/kekule/a16:locant",
        "phenanthrene/lewis/a15:locant (dropped)",
        "phenanthrene/lewis/a16:locant (dropped)",
        "phenanthrene/lewis/a2:locant",
        "phenanthrene/lewis/a3:locant (dropped)",
        "phenanthrene/skeletal/a16:locant",
        "steroidSkeleton/explicitH/C10:descriptor (dropped)",
        "steroidSkeleton/explicitH/C10:locant (dropped)",
        "steroidSkeleton/explicitH/C11:locant (dropped)",
        "steroidSkeleton/explicitH/C12:locant",
        "steroidSkeleton/explicitH/C13:descriptor (dropped)",
        "steroidSkeleton/explicitH/C13:locant (dropped)",
        "steroidSkeleton/explicitH/C14:locant (dropped)",
        "steroidSkeleton/explicitH/C17:descriptor",
        "steroidSkeleton/explicitH/C17:locant (dropped)",
        "steroidSkeleton/explicitH/C19:locant",
        "steroidSkeleton/explicitH/C1:locant (dropped)",
        "steroidSkeleton/explicitH/C3:descriptor (dropped)",
        "steroidSkeleton/explicitH/C3:locant (dropped)",
        "steroidSkeleton/explicitH/C5:locant",
        "steroidSkeleton/explicitH/C8:locant",
        "steroidSkeleton/explicitH/C9:locant (dropped)",
        "steroidSkeleton/kekule/C10:descriptor",
        "steroidSkeleton/kekule/C13:descriptor",
        "steroidSkeleton/kekule/C13:locant",
        "steroidSkeleton/kekule/C17:descriptor",
        "steroidSkeleton/kekule/C17:locant (dropped)",
        "steroidSkeleton/kekule/C3:descriptor (dropped)",
        "steroidSkeleton/lewis/C10:descriptor (dropped)",
        "steroidSkeleton/lewis/C10:locant (dropped)",
        "steroidSkeleton/lewis/C11:locant (dropped)",
        "steroidSkeleton/lewis/C12:locant",
        "steroidSkeleton/lewis/C13:descriptor (dropped)",
        "steroidSkeleton/lewis/C13:locant (dropped)",
        "steroidSkeleton/lewis/C14:locant (dropped)",
        "steroidSkeleton/lewis/C17:descriptor",
        "steroidSkeleton/lewis/C17:locant (dropped)",
        "steroidSkeleton/lewis/C19:locant",
        "steroidSkeleton/lewis/C1:locant (dropped)",
        "steroidSkeleton/lewis/C3:descriptor (dropped)",
        "steroidSkeleton/lewis/C3:locant (dropped)",
        "steroidSkeleton/lewis/C5:locant",
        "steroidSkeleton/lewis/C8:locant",
        "steroidSkeleton/lewis/C9:locant (dropped)",
        "steroidSkeleton/skeletal/C10:descriptor",
        "steroidSkeleton/skeletal/C13:descriptor",
        "steroidSkeleton/skeletal/C13:locant",
        "steroidSkeleton/skeletal/C17:descriptor",
        "steroidSkeleton/skeletal/C17:locant (dropped)",
        "steroidSkeleton/skeletal/C3:descriptor (dropped)",
        "tertButylCation/explicitH/a1:locant (dropped)",
        "tertButylCation/lewis/a1:locant",
        "trans2Butene/explicitH/b3:descriptor",
        "trans2Butene/lewis/b3:descriptor",
        "unmergedDropOverlap/explicitH/a2:locant (dropped)",
        "unmergedDropOverlap/explicitH/a3:locant",
        "unmergedDropOverlap/explicitH/a6:locant",
        "unmergedDropOverlap/kekule/a3:locant",
        "unmergedDropOverlap/kekule/a6:locant",
        "unmergedDropOverlap/lewis/a2:locant (dropped)",
        "unmergedDropOverlap/lewis/a3:locant (dropped)",
        "unmergedDropOverlap/lewis/a6:locant (dropped)",
        "unmergedDropOverlap/skeletal/a3:locant",
        "unmergedDropOverlap/skeletal/a6:locant",
        "wedgeOnNonStereocentre/explicitH/a2:locant",
        "wedgeOnNonStereocentre/lewis/a2:locant",
      ].sort(),
    );
  });

  it("reports every steroid descriptor at 0.80, C17's (S) included", () => {
    // Decision 54's reason in one fixture, with decision 63's margin on top:
    // at 8 pt no slot on the steroid's ring junctions is visibly nearer its
    // own atom than the next, so all four are reported — locants off and on,
    // which is decision 17's guarantee. The author decides what to do.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const byLocant = (text: string): string =>
      Object.entries(locants).find(([, t]) => t === text)![0];
    for (const rep of [representation("skeletal", { showStereoDescriptors: true }), ANNOTATED]) {
      const layout = annotationLayout(molecule, PUBLICATION_STYLE, rep, { locants });
      expect(layout.unplaced.filter((u) => u.kind === "descriptor").map((u) => u.id)).toEqual(
        ["13", "17", "10", "3"].map((text) => `atom:${byLocant(text)}:descriptor`),
      );
    }
  });
});

describe("annotation ids", () => {
  it("derive from the kind and the source, never from a counter", () => {
    expect(annotationId("descriptor", { kind: "atom", atomId: "a2" })).toBe("atom:a2:descriptor");
    expect(annotationId("locant", { kind: "atom", atomId: "a2" })).toBe("atom:a2:locant");
    expect(annotationId("alphaBeta", { kind: "atom", atomId: "a2" })).toBe("atom:a2:alphaBeta");
    expect(annotationId("torsion", { kind: "bond", bondId: "b3" })).toBe("bond:b3:torsion");
  });

  it("never repeat within a scene", () => {
    const { molecule, locants } = steroidSkeletonWithLocants();
    for (const style of STYLES) {
      const ids = buildScene(molecule, style, ANNOTATED, { locants }).primitives.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("are computed with no atan2 or hypot anywhere in the placement path", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["../src/label/annotations.ts", "../src/scene/build.ts"]) {
      const code = readFileSync(join(here, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/Math\.(atan2|hypot)\b/);
    }
  });
});

describe("decision 18: showLocants draws chemical locants and nothing else", () => {
  const locantRuns = (scene: RenderScene): TextRunPrimitive[] =>
    scene.primitives.filter(
      (p): p is TextRunPrimitive => p.type === "textRun" && p.id.endsWith(":locant"),
    );
  const textOf = (run: TextRunPrimitive): string => run.spans.map((s) => s.text).join("");

  it("draws nothing at all when no locants are supplied", () => {
    // The trap decision 18 closes: with the flag on and no numbering, the one
    // number available is the atom's id or index, and that must not appear.
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, LOCANTS_ONLY);
    expect(locantRuns(scene)).toEqual([]);
    expect(serializeScene(scene)).toBe(
      serializeScene(buildScene(ethanol(), PUBLICATION_STYLE, representation("skeletal"))),
    );
  });

  it("draws nothing while the flag is off, locants or not", () => {
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, representation("skeletal"), {
      locants: { a1: "1", a2: "2", a3: "3" },
    });
    expect(locantRuns(scene)).toEqual([]);
  });

  it("gives an atom missing from the numbering nothing — not its id", () => {
    const scene = buildScene(ethanol(), PUBLICATION_STYLE, LOCANTS_ONLY, {
      locants: { a1: "1", a3: "3", a2: "" },
    });
    expect(locantRuns(scene).map((run) => [run.id, textOf(run)])).toEqual([
      ["atom:a1:locant", "1"],
      ["atom:a3:locant", "3"],
    ]);
  });

  it("does not resolve an id up the prototype chain", () => {
    const inherited = Object.create({ a1: "1" }) as Record<AtomId, string>;
    expect(
      locantRuns(buildScene(ethanol(), PUBLICATION_STYLE, LOCANTS_ONLY, { locants: inherited })),
    ).toEqual([]);

    // An imported file can name an atom "constructor", which is what
    // `record[id]` finds on every plain object.
    const methane = buildMolecule((b) => {
      b.atom("C", ORIGIN);
    });
    const atom = methane.atoms[methane.atomIds[0]!]!;
    const named: Molecule = {
      atoms: { constructor: { ...atom, id: "constructor" } },
      bonds: {},
      atomIds: ["constructor"],
      bondIds: [],
      nextId: methane.nextId,
    };
    const scene = buildScene(named, PUBLICATION_STYLE, LOCANTS_ONLY, { locants: {} });
    expect(locantRuns(scene)).toEqual([]);
    expect(
      locantRuns(
        buildScene(named, PUBLICATION_STYLE, LOCANTS_ONLY, { locants: { constructor: "1" } }),
      ).map((run) => run.id),
    ).toEqual(["atom:constructor:locant"]);
  });

  it("accepts a callback, and ignores locants for atoms that do not exist", () => {
    const options: SceneBuildOptions = {
      locants: (atomId) => (atomId === "a2" ? "2" : atomId === "a99" ? "99" : undefined),
    };
    const runs = locantRuns(buildScene(ethanol(), PUBLICATION_STYLE, LOCANTS_ONLY, options));
    expect(runs.map((run) => [run.id, textOf(run)])).toEqual([["atom:a2:locant", "2"]]);
  });

  it("puts the steroid's real numbers on its atoms, not their ids", () => {
    const { molecule, locants } = steroidSkeletonWithLocants();
    const runs = locantRuns(buildScene(molecule, PUBLICATION_STYLE, LOCANTS_ONLY, { locants }));
    const layout = annotationLayout(molecule, PUBLICATION_STYLE, LOCANTS_ONLY, { locants });
    // One per numbered atom, less the ones decision 58 leaves out of the
    // drawing; those are named in the report rather than silently missing.
    const dropped = new Set(layout.unplaced.filter((u) => u.dropped).map((u) => u.id));
    expect(layout.placements).toHaveLength(19);
    expect(runs).toHaveLength(19 - dropped.size);
    const drawn = new Map(runs.map((run) => [run.id, textOf(run)]));
    // Created out of numbering order on purpose: id a1 is C11, not C1.
    expect(drawn.get("atom:a1:locant")).toBe("11");
    for (const [atomId, locant] of Object.entries(locants)) {
      const id = `atom:${atomId}:locant`;
      if (dropped.has(id)) continue;
      expect(drawn.get(id)).toBe(locant);
    }
  });
});

describe("offsets are scene px, y-down", () => {
  /** The locant of `atomId`: its drawn centre, and the atom's centre. */
  function locantAndCentre(mol: Molecule, atomId: AtomId): { run: ScenePoint; atom: ScenePoint } {
    const layout = annotationLayout(mol, PUBLICATION_STYLE, LOCANTS_ONLY, {
      locants: { [atomId]: "2" },
    });
    const placed = layout.placements.find((p) => p.id === `atom:${atomId}:locant`)!;
    const atom = mol.atoms[atomId]!;
    return { run: placed.origin, atom: modelToPx(PUBLICATION_STYLE, atom.pos) };
  }

  it("sets ethanol's methylene locant ABOVE it on the page, and below once flipped", () => {
    // Ethanol's methylene is the apex of the zig-zag: in model space (y-up)
    // it is the highest atom, so on the page it is the TOP one and its free
    // space is above it — smaller scene y. A direction taken from model space
    // without the flip sends the locant down into the two bonds; a horizontal
    // fixture could never tell.
    const upright = locantAndCentre(ethanol(), "a2");
    expect(upright.run.y).toBeLessThan(upright.atom.y);

    const mol = ethanol();
    const flipped = flipAtoms(mol, mol.atomIds, horizontalMirror(ORIGIN));
    const below = locantAndCentre(flipped, "a2");
    expect(below.run.y).toBeGreaterThan(below.atom.y);
    // The mirror is top/bottom only, and so is the locant's move.
    expect(below.run.x - below.atom.x).toBeCloseTo(upright.run.x - upright.atom.x, 9);
  });

  it("sets the steroid's angular-methyl locants above their atoms on the page", () => {
    // Vertically asymmetric: C18 and C19 point up the page. Their locants must
    // sit above their own atoms in scene px.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const layout = annotationLayout(molecule, PUBLICATION_STYLE, LOCANTS_ONLY, { locants });
    const idOf = (locant: string): AtomId =>
      Object.entries(locants).find(([, text]) => text === locant)![0];
    for (const methyl of ["18", "19"]) {
      const atomId = idOf(methyl);
      const placed = layout.placements.find((p) => p.id === `atom:${atomId}:locant`)!;
      const centre = modelToPx(PUBLICATION_STYLE, molecule.atoms[atomId]!.pos);
      expect(placed.box.maxY, methyl).toBeLessThan(centre.y);
    }
  });
});

describe("determinism", () => {
  it("builds the annotated steroid byte-identically twice", () => {
    for (const style of STYLES) {
      const first = steroidSkeletonWithLocants();
      const second = steroidSkeletonWithLocants();
      expect(
        serializeScene(buildScene(first.molecule, style, ANNOTATED, { locants: first.locants })),
      ).toBe(
        serializeScene(buildScene(second.molecule, style, ANNOTATED, { locants: second.locants })),
      );
    }
  });

  it("places every annotation identically when the bonds were added in reverse", () => {
    // Bond ids and every atom's neighbour order change; the drawing does not,
    // so neither may a single annotation. Atom ids are unchanged because every
    // atom is created before any bond.
    for (const style of STYLES) {
      for (const rep of [ANNOTATED, representation("explicitH", { showStereoDescriptors: true, showLocants: true })]) {
        const forward = steroidSkeletonWithLocants();
        const reversed = steroidSkeletonWithLocants({ reverseBonds: true });
        expect(reversed.molecule.atomIds).toEqual(forward.molecule.atomIds);
        const firstBond = forward.molecule.bondIds[0]!;
        expect(reversed.molecule.bonds[firstBond]).not.toEqual(forward.molecule.bonds[firstBond]);
        const a = annotationLayout(forward.molecule, style, rep, { locants: forward.locants });
        const b = annotationLayout(reversed.molecule, style, rep, { locants: reversed.locants });
        expect(a.placements.length).toBeGreaterThan(19);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }
    }
  });

  it("places E/Z and centre annotations identically for every bond insertion order", () => {
    // The steroid has no double bond, so the bond-descriptor branch needs its
    // own molecule: a 2,4-hexadiene with a chlorine and a hydroxyl, every
    // atom created before any bond so only bond ids and neighbour order vary.
    const positions = [
      { x: 0, y: 0 }, { x: 0.866, y: 0.5 }, { x: 1.732, y: 0 }, { x: 2.598, y: 0.5 },
      { x: 3.464, y: 0 }, { x: 4.33, y: 0.5 }, { x: 0.866, y: 1.5 }, { x: 2.598, y: 1.5 },
    ];
    const elements = ["C", "C", "C", "C", "C", "C", "Cl", "O"] as const;
    const bonds: ReadonlyArray<readonly [number, number, 1 | 2]> = [
      [0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 2], [4, 5, 1], [1, 6, 1], [3, 7, 1],
    ];
    const build = (order: readonly number[]): Molecule =>
      buildMolecule((b) => {
        const ids = positions.map((position, index) => b.atom(elements[index]!, position));
        for (const index of order) {
          const [from, to, bondOrder] = bonds[index]!;
          b.bond(ids[from]!, ids[to]!, bondOrder);
        }
      });
    const identity = bonds.map((_, index) => index);
    const orders = [
      identity,
      [...identity].reverse(),
      ...identity.map((_, shift) => [...identity.slice(shift), ...identity.slice(0, shift)]),
      [3, 6, 0, 5, 2, 4, 1],
    ];
    for (const style of STYLES) {
      for (const view of ["skeletal", "explicitH"] as const) {
        const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
        const reference = build(identity);
        const locants = Object.fromEntries(reference.atomIds.map((id, index) => [id, `${index + 1}`]));
        const expected = annotationLayout(reference, style, rep, { locants });
        expect(expected.placements.filter((p) => p.source.kind === "bond").length).toBe(2);
        for (const order of orders) {
          const molecule = build(order);
          expect(molecule.atomIds).toEqual(reference.atomIds);
          // Bond ids follow insertion, so compare by what each annotation
          // sits on and where, not by id.
          const where = (layout: typeof expected): string[] =>
            layout.placements
              .map((p) => `${p.kind}|${p.text}|${p.origin.x}|${p.origin.y}|${p.clear}`)
              .sort();
          expect(where(annotationLayout(molecule, style, rep, { locants }))).toEqual(where(expected));
        }
      }
    }
  });

  it("places a tied locant identically for every bond order that leaks into the free direction", () => {
    // The whole-scene tests above pass even with the order guards removed:
    // no atom in them has a free direction that lands on a tie. This one
    // does. A carbon with neighbours at 105°, 180° and 255° has its free
    // direction due east; a lone carbon to the east makes the east slot read
    // as ITS atom's (decision 35), so the choice falls to north-east against
    // south-east — equally close to east, separated only by the last bit of
    // the preferred vector, and that bit depends on the order the three bond
    // directions were summed in. Removing both the neighbour sort and the
    // direction quantum makes this test fail; either guard alone holds it.
    const DEG = Math.PI / 180;
    const unit = (degrees: number): ScenePoint => ({
      x: Math.cos(degrees * DEG),
      y: Math.sin(degrees * DEG),
    });
    // Where the lone carbon sits, per setting, in bonds: near enough that the
    // east slot is the lone carbon's, far enough that its CH4 label leaves the
    // north-east and south-east slots clear. The window moves with the ratio of
    // annotation size to bond length, so it is found per setting rather than
    // shared: at Publication's 11 px annotation anything nearer than 0.9 lets
    // the CH4 label block both diagonals and the locant goes west, where no
    // tie is consulted.
    const loneCarbonX = new Map<RenderStyle, number>([
      [PUBLICATION_STYLE, 1],
      [SCREEN_STYLE, 0.76],
      [CROWDED_PUBLICATION_STYLE, 1.2],
    ]);
    const build = (order: readonly number[], x: number): Molecule =>
      buildMolecule((b) => {
        const centre = b.atom("C", ORIGIN);
        const neighbours = [105, 255, 180].map((degrees) => b.atom("C", unit(degrees)));
        b.atom("C", { x, y: 0 });
        for (const index of order) b.bond(centre, neighbours[index]!, 1);
      });
    const orders = permutations([0, 1, 2]);
    for (const style of STYLES) {
      const x = loneCarbonX.get(style)!;
      const rep = representation("skeletal", { showLocants: true });
      const placements = orders.map((order) => {
        const molecule = build(order, x);
        return annotationLayout(molecule, style, rep, { locants: { [molecule.atomIds[0]!]: "1" } })
          .placements[0]!;
      });

      // The premise: in bond-insertion order the plain free direction ranks
      // the compass differently for different orders.
      const S = Math.SQRT1_2;
      const compass = [[0, -1], [S, -S], [1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S]] as const;
      const rankings = new Set(
        orders.map((order) => {
          const molecule = build(order, x);
          const centre = modelToPx(style, ORIGIN);
          const neighbours = molecule.bondIds.map((bondId) =>
            modelToPx(style, molecule.atoms[molecule.bonds[bondId]!.to]!.pos),
          );
          const p = freeDirection(centre, neighbours);
          return compass
            .map(([x, y], index) => [index, x * p.x + y * p.y] as const)
            .sort((u, v) => v[1] - u[1])
            .map(([index]) => index)
            .join("");
        }),
      );
      expect(rankings.size, `${styleLabel(style)}: premise`).toBeGreaterThan(1);

      // The tie was actually consulted: the locant sits on a diagonal, not
      // in the east slot.
      const first = placements[0]!;
      expect(first.clear).toBe(true);
      expect(first.origin.y).not.toBe(0);
      expect(first.origin.x).toBeGreaterThan(0);
      for (const placed of placements) expect(placed).toEqual(first);
    }
  });

  it("ranks candidates from the canonical free direction, whatever order the neighbours came in", () => {
    // Three neighbour centres whose free direction differs in its last bit
    // between orderings: summed in the order given, (a+b)+c is not a+(b+c).
    const centre = { x: 12.5, y: -7.25 };
    const neighbours = [
      { x: 42.5, y: -7.25 },
      { x: -2.499999999999993, y: 18.73076211353316 },
      { x: 2.2393957002299185, y: -35.440778623577245 },
    ];
    const key = (p: ScenePoint): string => `${p.x},${p.y}`;
    const raw = new Set(permutations(neighbours).map((order) => key(freeDirection(centre, order))));
    // The premise: order DOES leak into the plain function.
    expect(raw.size).toBeGreaterThan(1);
    const canonical = new Set(
      permutations(neighbours).map((order) => key(canonicalFreeDirection(centre, order))),
    );
    expect(canonical.size).toBe(1);
  });

  it("treats two compass candidates a last-bit apart as tied, falling to the fixed order", () => {
    // Preferred almost straight down the page. South is blocked by a speck,
    // so the choice is south-east against south-west, which differ in
    // closeness only by the preferred vector's 1e-12 lean. Quantised, that is
    // a tie and COMPASS order (south-east first) decides — for either lean.
    const south = placeAnnotation(
      { ...request("locant", "a1"), preferred: { x: 0, y: 1 } },
      EMPTY_CONTEXT,
    ).origin;
    expect(south.x).toBe(0);
    expect(south.y).toBeGreaterThan(0);
    const speck = {
      kind: "rect" as const,
      box: { minX: south.x - 0.01, minY: south.y - 0.01, maxX: south.x + 0.01, maxY: south.y + 0.01 },
    };
    const origins = [-1e-12, 1e-12].map(
      (lean) =>
        placeAnnotation(
          { ...request("locant", "a1"), preferred: { x: lean, y: 1 } },
          { ...EMPTY_CONTEXT, obstacles: [speck] },
        ).origin,
    );
    expect(origins[0]).toEqual(origins[1]);
    expect(origins[0]!.x).toBeGreaterThan(0);
    expect(origins[0]!.y).toBeGreaterThan(0);
  });

  it("never moves a descriptor when locants are switched on", () => {
    // Decision 17's reason, as a test: descriptors claim first, so adding
    // locants cannot move one — in any fixture, view, preset or flag set.
    const molecules: [string, Molecule][] = [
      ["steroidSkeleton", steroidSkeletonWithLocants().molecule],
      ...FIXTURES.map((f): [string, Molecule] => [f.name, f.molecule]),
    ];
    let compared = 0;
    for (const [name, molecule] of molecules) {
      const locants = Object.fromEntries(molecule.atomIds.map((id, index) => [id, `${index + 1}`]));
      for (const style of STYLES) {
        for (const view of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
          for (const aromaticCircles of [false, true]) {
            const flags = { showStereoDescriptors: true, aromaticCircles };
            const without = representation(view, flags);
            const withLocants = representation(view, { ...flags, showLocants: true });
            const before = annotationLayout(molecule, style, without);
            const after = annotationLayout(molecule, style, withLocants, { locants });
            const where = `${name}/${styleLabel(style)}/${view}/circles=${aromaticCircles}`;
            expect(after.placements.filter((p) => p.kind === "descriptor"), where).toEqual(
              before.placements,
            );
            expect(after.unplaced.filter((u) => u.kind === "descriptor"), where).toEqual(
              before.unplaced,
            );
            const descriptorRuns = (scene: RenderScene): string =>
              JSON.stringify(
                scene.primitives.filter((p) => p.type === "textRun" && p.id.endsWith(":descriptor")),
              );
            expect(descriptorRuns(buildScene(molecule, style, withLocants, { locants })), where).toBe(
              descriptorRuns(buildScene(molecule, style, without)),
            );
            compared += before.placements.length;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
    const { molecule } = steroidSkeletonWithLocants();
    expect(
      annotationLayout(molecule, PUBLICATION_STYLE, representation("skeletal", { showStereoDescriptors: true }))
        .placements.map((p) => p.text),
    ).toEqual(["(S)", "(S)", "(S)", "(S)"]);
  });

  it("emits a descriptor-only scene in the order it always had: atoms, then bonds", () => {
    const scene = buildScene(butan2olWedged(), PUBLICATION_STYLE, representation("skeletal", { showStereoDescriptors: true }));
    expect(scene.primitives.at(-1)!.id).toBe("atom:a2:descriptor");
  });
});

describe("decision 34: descriptors search the full obstacle set", () => {
  it("moves butan-2-ol's (R) off C2's derived hydrogen where there is room", () => {
    // Before decision 34 descriptors searched only label glyphs and bond
    // axes, so this (R) was drawn on C2's revealed "H" at (38.105…, 0.539)
    // in the screen preset and reported. Seeing the hydrogen, it moves.
    const rep = representation("explicitH", { showStereoDescriptors: true });
    const screen = annotationLayout(butan2olWedged(), SCREEN_STYLE, rep);
    expect(screen.unplaced).toEqual([]);
    expect(screen.placements[0]!.origin).not.toEqual({ x: 38.105117766515306, y: 0.538945312500001 });
    const scene = buildScene(butan2olWedged(), SCREEN_STYLE, rep);
    const hydrogens = scene.primitives.filter(
      (p): p is TextRunPrimitive => p.type === "textRun" && p.id.includes(":h:"),
    );
    expect(hydrogens.length).toBeGreaterThan(0);
    const box = screen.placements[0]!.box;
    for (const h of hydrogens) {
      const ink = textRunRect(
        measureTextRun(
          h.spans,
          {
            fontFamily: h.fontFamily,
            fontSizePx: h.fontSizePx,
            subscriptScale: SCREEN_STYLE.subscriptScale,
            anchor: h.anchor,
            baseline: "alphabetic",
          },
          BUNDLED_MEASURER,
        ),
        h.origin,
      );
      expect(overlaps(box, ink), h.id).toBe(false);
    }
  });

  it("finds the slot between two coarse rungs beside a labelled C2", () => {
    // A compact setting — a 10 px label font and a 1.4 px line on the 24 px
    // bond, Publication's proportions before decision 26 — with C2's hydrogen
    // revealed. The coarse ladder's first north-east rung meets C2's own
    // label, and its second is already nearer O than C2, so with that ladder
    // alone the (R) was reported and set on C2's "H" although clear room lay
    // between the two rungs. The geometry is specific to those proportions,
    // so the setting is spelled out here rather than taken from a preset.
    const COMPACT_PUBLICATION_STYLE = withStyle(PUBLICATION_STYLE, {
      fontSizePx: 10,
      bondLineWidthPx: 1.4,
      stereoDescriptorScale: 0.85,
    });
    for (const [view, showImplicitHydrogens] of [
      ["skeletal", true],
      ["explicitH", false],
      ["lewis", false],
    ] as const) {
      const rep = representation(view, { showStereoDescriptors: true, showImplicitHydrogens });
      const molecule = butan2olWedged();
      const layout = annotationLayout(molecule, COMPACT_PUBLICATION_STYLE, rep);
      expect(layout.unplaced, view).toEqual([]);
      const placed = layout.placements[0]!;
      expect(placed.id).toBe("atom:a2:descriptor");
      const centre = inkCentre(placed, COMPACT_PUBLICATION_STYLE);
      const d2 = (p: ScenePoint): number => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2;
      const own = d2(modelToPx(COMPACT_PUBLICATION_STYLE, molecule.atoms.a2!.pos));
      for (const atomId of molecule.atomIds) {
        if (atomId === "a2") continue;
        expect(own, `${view}: nearer ${atomId}`).toBeLessThan(
          d2(modelToPx(COMPACT_PUBLICATION_STYLE, molecule.atoms[atomId]!.pos)),
        );
      }
    }
  });
});

describe("clearance on fused rings", () => {
  interface DrawnSegment {
    readonly id: string;
    readonly a: ScenePoint;
    readonly b: ScenePoint;
    /** Half the stroke width: a line's ink reaches this far either side. */
    readonly halfWidth: number;
  }

  /** Every drawn segment of the scene, straight from its primitives. */
  function drawnSegments(scene: RenderScene): DrawnSegment[] {
    const out: DrawnSegment[] = [];
    for (const p of scene.primitives) {
      if (p.type === "line") out.push({ id: p.id, a: p.a, b: p.b, halfWidth: p.stroke.width / 2 });
      if (p.type === "polygon") {
        const halfWidth = (p.stroke?.width ?? 0) / 2;
        p.points.forEach((point, index) => {
          out.push({ id: p.id, a: point, b: p.points[(index + 1) % p.points.length]!, halfWidth });
        });
      }
      if (p.type === "path") {
        // Hash ladders are `M x y L x y` bars; wavy bonds are curves and the
        // steroid has none.
        const numbers = (p.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        expect(p.d.includes("C"), `${p.id} is a curve`).toBe(false);
        const halfWidth = (p.stroke?.width ?? 0) / 2;
        for (let i = 0; i + 3 < numbers.length; i += 4) {
          out.push({
            id: p.id,
            a: { x: numbers[i]!, y: numbers[i + 1]! },
            b: { x: numbers[i + 2]!, y: numbers[i + 3]! },
            halfWidth,
          });
        }
      }
    }
    return out;
  }

  function inkBox(run: TextRunPrimitive, style: RenderStyle): LabelBox {
    return textRunRect(
      measureTextRun(
        run.spans,
        {
          fontFamily: run.fontFamily,
          fontSizePx: run.fontSizePx,
          subscriptScale: style.subscriptScale,
          anchor: run.anchor,
          baseline: "alphabetic",
        },
        BUNDLED_MEASURER,
      ),
      run.origin,
    );
  }

  /**
   * One ink box per SPAN of a drawn run — "O", then the superscript "−" —
   * measured from the scene primitive through the vendored metrics.
   *
   * Deliberately NOT `atomLabelPlacement(...).obstacles`, the boxes the pass
   * itself avoids: a test built on the placement's own obstacle model cannot
   * catch a bug in that model. Each span's box is its full ascent-to-descent
   * band at its own size and script shift, which is looser than the cap-band
   * obstacles the label pass uses, never tighter.
   */
  function spanInkBoxes(run: TextRunPrimitive, style: RenderStyle): LabelBox[] {
    const options = {
      fontFamily: run.fontFamily,
      fontSizePx: run.fontSizePx,
      subscriptScale: style.subscriptScale,
    };
    const whole = measureTextRun(
      run.spans,
      { ...options, anchor: run.anchor, baseline: "alphabetic" },
      BUNDLED_MEASURER,
    );
    const baseline = { x: run.origin.x + whole.startXPx, y: run.origin.y + whole.baselineYPx };
    return whole.spans.flatMap((measured) => {
      if (measured.span.text.length === 0) return [];
      const alone = measureTextRun(
        [measured.span],
        { ...options, anchor: "start", baseline: "alphabetic" },
        BUNDLED_MEASURER,
      );
      return [textRunRect(alone, { x: baseline.x + measured.startXPx, y: baseline.y })];
    });
  }

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly molecule: Molecule;
    readonly locants: Readonly<Record<AtomId, string>>;
  }> = [
    { name: "steroidSkeleton", ...steroidSkeletonWithLocants() },
    {
      // A descriptor crowded by C2's derived "H" and its stem in the
      // explicitH view.
      name: "butan2olWedged",
      molecule: butan2olWedged(),
      locants: {},
    },
    {
      // Aromatic circles and double bonds, which the steroid has neither of.
      name: "chrysene",
      molecule: chrysene(),
      locants: Object.fromEntries(chrysene().atomIds.map((id, index) => [id, `${index + 1}`])),
    },
    {
      // A charged label: the "−" is a superscript span beside the "O".
      name: "acetate",
      molecule: acetate(),
      locants: Object.fromEntries(acetate().atomIds.map((id, index) => [id, `${index + 1}`])),
    },
  ];

  // The shipped presets, plus strokes heavier than either: a clearance model
  // that treats a bond as a hairline passes at 1–2 px and fails here.
  const CLEARANCE_STYLES: readonly RenderStyle[] = [
    ...STYLES,
    withStyle(SCREEN_STYLE, { bondLineWidthPx: 3 }),
    withStyle(PUBLICATION_STYLE, { bondLineWidthPx: 6 }),
  ];

  it("keeps every annotation off every bond, glyph, circle and other annotation — or reports it", () => {
    let checked = 0;
    let glyphCount = 0;
    for (const { name, molecule, locants } of cases) {
      for (const style of CLEARANCE_STYLES) {
        for (const kind of ["skeletal", "kekule", "explicitH"] as const) {
          const rep: StructuralRepresentation = representation(kind, {
            showStereoDescriptors: true,
            showLocants: true,
          });
          const scene = buildScene(molecule, style, rep, { locants });
          const layout = annotationLayout(molecule, style, rep, { locants });
          const reported = new Set(layout.unplaced.map((u) => u.id));
          const isAnnotation = (p: TextRunPrimitive): boolean =>
            p.id.endsWith(":locant") || p.id.endsWith(":descriptor");
          const textRuns = scene.primitives.filter(
            (p): p is TextRunPrimitive => p.type === "textRun",
          );
          const runs = textRuns.filter(isAnnotation);
          // Every drawn placement, and only those (decision 58).
          expect(runs.map((r) => r.id)).toEqual(layout.placements.filter((p) => p.drawn).map((p) => p.id));

          const segments = drawnSegments(scene);
          // Atom labels, derived-hydrogen labels, detached charges: every
          // glyph the drawing set that is not itself an annotation.
          const glyphs = textRuns
            .filter((run) => !isAnnotation(run))
            .flatMap((run) => spanInkBoxes(run, style).map((box) => ({ id: run.id, box })));
          glyphCount += glyphs.length;
          const circles = scene.primitives.filter((p) => p.type === "circle");

          for (const run of runs) {
            if (reported.has(run.id)) continue;
            checked++;
            const box = inkBox(run, style);
            const where = `${name}/${styleLabel(style)}/line${style.bondLineWidthPx}/${kind}/${run.id}`;
            for (const segment of segments) {
              const inked = inflate(box, segment.halfWidth);
              expect(boxMeetsSegment(inked, segment.a, segment.b), `${where} over ${segment.id}`).toBe(false);
            }
            for (const glyph of glyphs) {
              expect(overlaps(box, glyph.box), `${where} over ${glyph.id}`).toBe(false);
            }
            for (const circle of circles) {
              if (circle.type !== "circle") continue;
              const hit =
                circle.stroke !== undefined
                  ? outlineMeetsBox(circle.centre, circle.radius, circle.stroke.width / 2, box)
                  : discMeetsBox(circle.centre, circle.radius, box);
              expect(hit, `${where} over ${circle.id}`).toBe(false);
            }
            for (const other of runs) {
              if (other.id === run.id) continue;
              expect(overlaps(box, inkBox(other, style)), `${where} over ${other.id}`).toBe(false);
            }
          }

          // Reported or not, no annotation prints over another.
          for (const run of runs) {
            for (const other of runs) {
              if (other.id <= run.id) continue;
              expect(
                overlaps(inkBox(run, style), inkBox(other, style)),
                `${name}/${styleLabel(style)}/${kind}: ${run.id} over ${other.id}`,
              ).toBe(false);
            }
          }

          if (STYLES.includes(style) && kind !== "explicitH") {
            // In the two uncrowded views at the shipped strokes, EVERY report
            // is listed here by id — the steroid's locants included — so a
            // scale change that trades one report for another shows up as a
            // failure, not as an unchanged count.
            //
            // - Screen: nothing is reported.
            // - Publication (0.80, decision 54) and the crowded 0.85: with
            //   decision 63's margin no slot on the steroid's ring junctions
            //   is visibly nearer its own atom than the next, so all four
            //   descriptors are reported, and the locants of C13 and C17
            //   after them. C3's descriptor is dropped (it would sit on the
            //   filled wedge, decision 65) and so is C17's locant; the rest
            //   cross lines only and are drawn. Butan-2-ol's (R) and two of
            //   chrysene's locants go the same way.
            const { locants: steroidLocants } = steroidSkeletonWithLocants();
            const byLocant = (text: string): AtomId =>
              Object.entries(steroidLocants).find(([, t]) => t === text)![0] as AtomId;
            const c13 = byLocant("13");
            const c17 = byLocant("17");
            const expected: readonly string[] =
              style === SCREEN_STYLE
                ? []
                : name === "steroidSkeleton"
                  ? [
                      `atom:${c13}:descriptor`,
                      `atom:${c17}:descriptor`,
                      `atom:${byLocant("10")}:descriptor`,
                      `atom:${byLocant("3")}:descriptor`,
                      `atom:${c13}:locant`,
                      `atom:${c17}:locant`,
                      ...(style === CROWDED_PUBLICATION_STYLE ? [`atom:${byLocant("3")}:locant`] : []),
                    ]
                  : name === "butan2olWedged"
                    ? ["atom:a2:descriptor"]
                    : name === "chrysene"
                      ? ["atom:a16:locant", "atom:a25:locant"]
                      : [];

            expect(
              layout.unplaced.map((u) => u.id),
              `${name}/${styleLabel(style)}/line${style.bondLineWidthPx}/${kind}`,
            ).toEqual(expected);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(glyphCount).toBeGreaterThan(100);
  });
});

function inflate(box: LabelBox, by: number): LabelBox {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function discMeetsBox(centre: ScenePoint, radius: number, box: LabelBox): boolean {
  const x = Math.min(Math.max(centre.x, box.minX), box.maxX);
  const y = Math.min(Math.max(centre.y, box.minY), box.maxY);
  return (x - centre.x) ** 2 + (y - centre.y) ** 2 < radius * radius;
}

function outlineMeetsBox(
  centre: ScenePoint,
  radius: number,
  halfWidth: number,
  box: LabelBox,
): boolean {
  if (!discMeetsBox(centre, radius + halfWidth, box)) return false;
  const farX = Math.max(centre.x - box.minX, box.maxX - centre.x);
  const farY = Math.max(centre.y - box.minY, box.maxY - centre.y);
  return farX ** 2 + farY ** 2 > (radius - halfWidth) ** 2;
}

function squaredDistanceToSegment(p: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared : 0;
  const u = Math.min(1, Math.max(0, t));
  return (p.x - (a.x + dx * u)) ** 2 + (p.y - (a.y + dy * u)) ** 2;
}

/** Liang-Barsky, local to the test so it cannot inherit a bug from the source. */
function boxMeetsSegment(box: LabelBox, a: ScenePoint, b: ScenePoint): boolean {
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

/**
 * Reported placements that read as another atom's, because every slot that
 * reads as their own prints over an annotation already placed (decision 45's
 * first key). Only at the crowded setting's 14 px run.
 */
const NOT_OWN_REPORTED: readonly string[] = [
  // The steroid's C13 locant, placed after three descriptors that already
  // took the room around that ring junction, and both of
  // unmergedDropOverlap's locants on the pair of atoms the fixture draws a
  // third of a bond apart — no slot there is 15% nearer one than the other.
  "steroidSkeleton/publication-crowded@14.2px/kekule/atom:a3:locant",
  "steroidSkeleton/publication-crowded@14.2px/skeletal+H/atom:a3:locant",
  "steroidSkeleton/publication-crowded@14.2px/skeletal/atom:a3:locant",
  "steroidSkeleton/publication@13.3px/kekule/atom:a3:locant",
  "steroidSkeleton/publication@13.3px/skeletal+H/atom:a3:locant",
  "steroidSkeleton/publication@13.3px/skeletal/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/explicitH/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/explicitH/atom:a6:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/kekule/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/kekule/atom:a6:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/lewis/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/lewis/atom:a6:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/skeletal+H/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/skeletal+H/atom:a6:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/skeletal/atom:a3:locant",
  "unmergedDropOverlap/publication-crowded@14.2px/skeletal/atom:a6:locant",
  "unmergedDropOverlap/publication@13.3px/explicitH/atom:a3:locant",
  "unmergedDropOverlap/publication@13.3px/explicitH/atom:a6:locant",
  "unmergedDropOverlap/publication@13.3px/kekule/atom:a3:locant",
  "unmergedDropOverlap/publication@13.3px/kekule/atom:a6:locant",
  "unmergedDropOverlap/publication@13.3px/lewis/atom:a3:locant",
  "unmergedDropOverlap/publication@13.3px/lewis/atom:a6:locant",
  "unmergedDropOverlap/publication@13.3px/skeletal+H/atom:a3:locant",
  "unmergedDropOverlap/publication@13.3px/skeletal+H/atom:a6:locant",
  "unmergedDropOverlap/publication@13.3px/skeletal/atom:a3:locant",
  "unmergedDropOverlap/publication@13.3px/skeletal/atom:a6:locant",
  "unmergedDropOverlap/screen@13.6px/explicitH/atom:a3:locant",
  "unmergedDropOverlap/screen@13.6px/explicitH/atom:a6:locant",
  "unmergedDropOverlap/screen@13.6px/kekule/atom:a3:locant",
  "unmergedDropOverlap/screen@13.6px/kekule/atom:a6:locant",
  "unmergedDropOverlap/screen@13.6px/lewis/atom:a3:locant",
  "unmergedDropOverlap/screen@13.6px/lewis/atom:a6:locant",
  "unmergedDropOverlap/screen@13.6px/skeletal+H/atom:a3:locant",
  "unmergedDropOverlap/screen@13.6px/skeletal+H/atom:a6:locant",
  "unmergedDropOverlap/screen@13.6px/skeletal/atom:a3:locant",
  "unmergedDropOverlap/screen@13.6px/skeletal/atom:a6:locant",
];


const ORIGIN_PX: ScenePoint = Object.freeze({ x: 0, y: 0 });

function overlapArea(a: LabelBox, b: LabelBox): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}
