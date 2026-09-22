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
  horizontalMirror,
  ORIGIN,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import {
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
  phenanthrene,
} from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import type { StructuralRepresentation } from "../src/representation.js";
import { annotationLayout, buildScene } from "../src/scene/build.js";
import type { SceneBuildOptions } from "../src/scene/build.js";
import type {
  RenderScene,
  ScenePoint,
  TextRunPrimitive,
} from "../src/scene/types.js";
import { modelToPx, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";
import { BUNDLED_MEASURER, measureTextRun, textRunRect } from "../src/text/measurer.js";

/**
 * The Publication preset as it was before decision 44: the ACS 1996 label
 * font (decision 26) with annotations still at 0.85 of it, a 14.2 px "(S)"
 * on a 24 px bond. Not shipped; kept as the CROWDED setting, because it is
 * where the reporting path is exercised on real molecules — the steroid's C17
 * (S) has no clear slot that reads as C17's there.
 */
const CROWDED_PUBLICATION_STYLE: RenderStyle = withStyle(PUBLICATION_STYLE, {
  name: "publication-crowded",
  stereoDescriptorScale: 0.85,
});

/** A style's name with its annotation size: shown in every failure message. */
function styleLabel(style: RenderStyle): string {
  return `${style.name}@${Math.round(style.fontSizePx * style.stereoDescriptorScale * 10) / 10}px`;
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
        // Both shipped presets have the room (at Publication that is what
        // decision 44's scale was chosen for). At the crowded setting the room
        // that reads as C17's is taken by the wedge to O17 and the bonds to C13
        // and C16; a 14 px "(S)" touches one of them wherever it goes. Reported
        // there, never passed off as clear.
        const crowded = style === CROWDED_PUBLICATION_STYLE;
        expect(placed.clear, styleLabel(style)).toBe(!crowded);
        expect(layout.unplaced.some((u) => u.id === placed.id), styleLabel(style)).toBe(crowded);
        // Clear or reported, it reads as C17's.
        const centre = centreOf(placed.box);
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
    });
    expect(placed.clear).toBe(false);
    expect(overlaps(first.box, wall.box)).toBe(true);
    expect(overlaps(placed.box, wall.box)).toBe(false);
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
    // Reported placements too: an annotation that found no clear slot must
    // still not be set beside a neighbour while a slot beside its own atom
    // exists, and in these fixtures one always does.
    let checked = 0;
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
            const c = centreOf(placed.box);
            let own: number;
            if (placed.source.kind === "atom") {
              own = d2(c, modelToPx(style, molecule.atoms[placed.source.atomId]!.pos));
            } else {
              const bond = molecule.bonds[placed.source.bondId]!;
              const a = modelToPx(style, molecule.atoms[bond.from]!.pos);
              const b = modelToPx(style, molecule.atoms[bond.to]!.pos);
              own = squaredDistanceToSegment(c, a, b);
            }
            for (const other of centres) {
              if (placed.source.kind === "atom" && other.id === placed.source.atomId) continue;
              expect(own, `${name}/${styleLabel(style)}/${view}${showImplicitHydrogens ? "+H" : ""}/${placed.id} nearer ${other.id}`).toBeLessThan(
                d2(c, other.at),
              );
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
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
    expect(readsAsOwn(result.box)).toBe(false);
  });

  it("(2) reads as its own atom's before it hits fewer glyphs", () => {
    // A second glyph over everything north of y = 15. A candidate reading as
    // a1's hits both glyphs; some reading as a2's hit only the blanket.
    const north = { kind: "rect" as const, box: { minX: -far, minY: -far, maxX: far, maxY: 15 } };
    const result = placeAnnotation(request("locant", "a1"), {
      ...EMPTY_CONTEXT,
      obstacles: [blanket, north],
      atomCentres: twoAtoms,
    });
    expect(result.clear).toBe(false);
    expect(readsAsOwn(result.box)).toBe(true);
    expect(overlaps(result.box, north.box)).toBe(true);
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
      segments: lines,
    });
    expect(result.clear).toBe(false);
    expect(overlaps(result.box, north.box)).toBe(false);
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
          const c = {
            x: (placed.box.minX + placed.box.maxX) / 2,
            y: (placed.box.minY + placed.box.maxY) / 2,
          };
          const own = modelToPx(PUBLICATION_STYLE, molecule.atoms[placed.source.atomId]!.pos);
          const ownD = (c.x - own.x) ** 2 + (c.y - own.y) ** 2;
          if (hydrogens.some((h) => (c.x - h.x) ** 2 + (c.y - h.y) ** 2 <= ownD)) besideHydrogen++;
        }
      }
    }
    expect(besideHydrogen).toBeGreaterThan(0);
  });
});

describe("decision 44: Publication's own annotation scale", () => {
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

  /** The measurement recorded in style.ts, recomputed. */
  function reported(style: RenderStyle): { total: number; unplaced: number; descriptors: number } {
    let total = 0;
    let unplaced = 0;
    let descriptors = 0;
    for (const [, molecule, locants] of cases()) {
      for (const view of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
        const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
        const layout = annotationLayout(molecule, style, rep, { locants });
        total += layout.placements.length;
        unplaced += layout.unplaced.length;
        descriptors += layout.unplaced.filter((u) => u.kind === "descriptor").length;
      }
    }
    return { total, unplaced, descriptors };
  }

  it("is smaller than Screen's, above the 60% legibility floor, with atom labels unchanged", () => {
    expect(PUBLICATION_STYLE.fontSizePx).toBe(50 / 3);
    expect(SCREEN_STYLE.stereoDescriptorScale).toBe(0.85);
    expect(PUBLICATION_STYLE.stereoDescriptorScale).toBeLessThan(SCREEN_STYLE.stereoDescriptorScale);
    // The annotation is set in the label's own face, so the cap-height ratio
    // is the scale; measured anyway rather than assumed.
    const cap = (fontSizePx: number): number =>
      measureTextRun(
        [{ text: "(S)" }],
        { fontFamily: PUBLICATION_STYLE.fontFamily, fontSizePx, subscriptScale: 0.72, anchor: "middle", baseline: "middle" },
        BUNDLED_MEASURER,
      ).capHeightPx;
    const ratio =
      cap(PUBLICATION_STYLE.fontSizePx * PUBLICATION_STYLE.stereoDescriptorScale) /
      cap(PUBLICATION_STYLE.fontSizePx);
    expect(ratio).toBeGreaterThanOrEqual(0.6);
    // Locants share the scale: one annotation size per figure.
    const { molecule, locants } = steroidSkeletonWithLocants();
    const sizes = new Set(
      annotationLayout(molecule, PUBLICATION_STYLE, ANNOTATED, { locants }).placements.map((p) => p.fontSizePx),
    );
    expect([...sizes]).toEqual([PUBLICATION_STYLE.fontSizePx * PUBLICATION_STYLE.stereoDescriptorScale]);
  });

  it("reports what style.ts records: 42 of 516 before, 38 after", () => {
    expect(reported(CROWDED_PUBLICATION_STYLE)).toEqual({ total: 516, unplaced: 42, descriptors: 14 });
    expect(reported(PUBLICATION_STYLE)).toEqual({ total: 516, unplaced: 38, descriptors: 10 });
  });

  it("records WHICH annotations the smaller scale traded, not only how many", () => {
    // The locant count is 28 at both scales, but it is not the same 28: seven
    // locants are newly reported at 0.66 and seven newly clear. A count alone
    // hid that, so the trade is pinned by id. Steroid atoms are named by their
    // real locant (C13 is a3); every other molecule by its atom id.
    const unplacedIds = (style: RenderStyle): Set<string> => {
      const ids = new Set<string>();
      for (const [name, molecule, locants] of cases()) {
        const label = (id: string): string =>
          name === "steroidSkeleton" ? `C${steroidSkeletonWithLocants().locants[id as AtomId]}` : id;
        for (const view of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
          const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
          for (const u of annotationLayout(molecule, style, rep, { locants }).unplaced) {
            const [, id, kind] = u.id.split(":");
            ids.add(`${name}/${view}/${u.source.kind === "atom" ? label(id!) : id}:${kind}`);
          }
        }
      }
      return ids;
    };
    const before = unplacedIds(CROWDED_PUBLICATION_STYLE);
    const after = unplacedIds(PUBLICATION_STYLE);
    expect([...after].filter((id) => !before.has(id)).sort()).toEqual(
      [
        "chrysene/skeletal/a25:locant",
        "steroidSkeleton/explicitH/C1:locant",
        "steroidSkeleton/explicitH/C12:locant",
        "steroidSkeleton/kekule/C13:locant",
        "steroidSkeleton/lewis/C1:locant",
        "steroidSkeleton/lewis/C12:locant",
        "steroidSkeleton/skeletal/C13:locant",
      ].sort(),
    );
    expect([...before].filter((id) => !after.has(id)).sort()).toEqual(
      [
        "chrysene/explicitH/a25:locant",
        "chrysene/lewis/a25:locant",
        "steroidSkeleton/explicitH/C10:descriptor",
        "steroidSkeleton/explicitH/C3:locant",
        "steroidSkeleton/kekule/C17:descriptor",
        "steroidSkeleton/lewis/C10:descriptor",
        "steroidSkeleton/skeletal/C17:descriptor",
        "tertButylCation/explicitH/a1:locant",
        "tertButylCation/lewis/a1:locant",
        "unmergedDropOverlap/explicitH/a6:locant",
        "unmergedDropOverlap/lewis/a6:locant",
      ].sort(),
    );
  });

  it("is the largest 0.01 step at or above the floor that sets C17's (S) clear", () => {
    const { molecule, locants } = steroidSkeletonWithLocants();
    const c17 = Object.entries(locants).find(([, text]) => text === "17")![0];
    const c17Clear = (scale: number): boolean =>
      [representation("skeletal", { showStereoDescriptors: true }), ANNOTATED].every(
        (rep) =>
          annotationLayout(molecule, withStyle(PUBLICATION_STYLE, { stereoDescriptorScale: scale }), rep, {
            locants,
          }).placements.find((p) => p.id === `atom:${c17}:descriptor`)!.clear,
      );
    expect(c17Clear(PUBLICATION_STYLE.stereoDescriptorScale)).toBe(true);
    const cents = Math.round(PUBLICATION_STYLE.stereoDescriptorScale * 100);
    for (let step = cents + 1; step <= 85; step++) {
      expect(c17Clear(step / 100), `scale ${step / 100}`).toBe(false);
    }
  });

  it("keeps every shipped preset's skeletal and kekule descriptors clear", () => {
    for (const style of SHIPPED_STYLES) {
      for (const [name, molecule, locants] of cases()) {
        for (const view of ["skeletal", "kekule"] as const) {
          const rep = representation(view, { showStereoDescriptors: true, showLocants: true });
          const layout = annotationLayout(molecule, style, rep, { locants });
          expect(
            layout.unplaced.filter((u) => u.kind === "descriptor").map((u) => u.id),
            `${name}/${styleLabel(style)}/${view}`,
          ).toEqual([]);
        }
      }
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
    expect(runs).toHaveLength(19);
    const drawn = new Map(runs.map((run) => [run.id, textOf(run)]));
    // Created out of numbering order on purpose: id a1 is C11, not C1.
    expect(drawn.get("atom:a1:locant")).toBe("11");
    for (const [atomId, locant] of Object.entries(locants)) {
      expect(drawn.get(`atom:${atomId}:locant`)).toBe(locant);
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
            baseline: h.baseline,
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
      const box = placed.box;
      const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
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
          baseline: run.baseline,
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
      { ...options, anchor: run.anchor, baseline: run.baseline },
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
          expect(runs.map((r) => r.id)).toEqual(layout.placements.map((p) => p.id));

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
            // - Crowded (Publication at 0.85): the steroid's C17 (S) has no
            //   room that reads as C17's (see decision 35's C17 test), and
            //   C17's locant, placed after it, loses too.
            // - Publication (0.66, decision 44): C17's (S) is clear, but the
            //   locants of C13 and C17 are reported, and so is chrysene's
            //   locant on a25 in the skeletal view. The ladder's outermost
            //   rung is a fixed number of the annotation's OWN cap heights, so
            //   the smaller run also searches less far: chrysene a25's clear
            //   slot at 0.85 sits 21.5 px north of it (a fusion vertex, with
            //   the skeletal view's inscribed circles around it), and at 0.66
            //   the ladder stops near 16.7 px. C13's locant was clear at 0.85
            //   for the same reason. Reported, as the contract allows, rather
            //   than widened here; see the escalation recorded in style.ts.
            const { locants: steroidLocants } = steroidSkeletonWithLocants();
            const byLocant = (text: string): AtomId =>
              Object.entries(steroidLocants).find(([, t]) => t === text)![0] as AtomId;
            const c13 = byLocant("13");
            const c17 = byLocant("17");
            const expected =
              name === "steroidSkeleton" && style === CROWDED_PUBLICATION_STYLE
                ? [`atom:${c17}:descriptor`, `atom:${c17}:locant`]
                : name === "steroidSkeleton" && style === PUBLICATION_STYLE
                  ? [`atom:${c13}:locant`, `atom:${c17}:locant`]
                  : name === "chrysene" && style === PUBLICATION_STYLE && kind === "skeletal"
                    ? ["atom:a25:locant"]
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
