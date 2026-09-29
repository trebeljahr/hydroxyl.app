/**
 * No derived hydrogen shares a pixel with another mark.
 *
 * THE FAILURE THIS EXISTS FOR is two "H" glyphs printed edge to edge. A
 * reader does not see two hydrogens on two carbons; they see "HH" beside one
 * carbon, which is a formula, and the picture has told them something the
 * molecule does not say. It is a different and worse failure from a mark that
 * is merely close, which is why this measures INK and the crowding sweep in
 * `representations.test.ts` measures the padded clear space.
 *
 * THE INK IS TAKEN OFF THE SCENE, not off the placement pass. A test that
 * asks `derivedHydrogens` where it put things and then checks its own answer
 * can only catch the pass disagreeing with itself; what matters is where the
 * glyphs were DRAWN, so every box below is measured from a `textRun`
 * primitive with the same measurer the serialiser will use. A regression that
 * placed hydrogens correctly and emitted them somewhere else would fail here
 * and nowhere else.
 *
 * The ink box is one rectangle per GLYPH from the vendored ink table, side
 * bearings and all (decision 55) — the same measure the annotation ladder
 * uses to decide that a descriptor would print on a letter. Not the cap band
 * over the advance, which is the CLEARANCE rectangle: at Publication an "H"
 * is 12.0 px of advance around 8.9 px of ink, so measuring separation that
 * way would fail two hydrogens with 3 px of white between them.
 */

import { describe, expect, it } from "vitest";

import { ORIGIN, rotateAtoms } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { FIXTURES, perhydrophenanthrene, steroidSkeleton } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import type { StructuralRepresentation } from "../src/representation.js";
import { atomLabelPlacements, buildScene, derivedHydrogens } from "../src/scene/build.js";
import { detectCollisions } from "../src/scene/collide.js";
import type { LabelBox } from "../src/label/placement.js";
import type {
  RenderScene,
  ScenePoint,
  ScenePrimitive,
  TextRunPrimitive,
} from "../src/scene/types.js";
import { modelToPx, RENDER_STYLES, withStyle } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { glyphInkRects, measurerFor, measureTextRun } from "../src/text/measurer.js";

const VIEWS: readonly StructuralRepresentation[] = Object.freeze([
  representation("explicitH"),
  representation("lewis"),
]);
const PRESETS: readonly RenderStyle[] = Object.freeze([
  RENDER_STYLES.publication,
  RENDER_STYLES.screen,
]);

/**
 * Every fixture, plus perhydrophenanthrene and the steroid.
 *
 * THE STEROID IS WHY THIS FILE IS NOT JUST A LOOP OVER `FIXTURES`. Nothing in
 * the fixture set puts a hydrogen-bearing carbon between two other
 * hydrogen-bearing carbons in a ring: a chain vertex has 240 degrees of empty
 * page to fan into, and naphthalene's fused vertices carry no hydrogens at
 * all. The steroid's ring system does it eighteen times over, and before the
 * separation pass it drew five overlapping pairs of hydrogens at Publication
 * — 54 px² between C1's and C14's — while every fixture in `FIXTURES` drew
 * at most one. Perhydrophenanthrene is the same ring system without the
 * steroid's methyls and wedges.
 */
const SUBJECTS: readonly { readonly name: string; readonly molecule: Molecule }[] =
  Object.freeze([
    ...FIXTURES,
    Object.freeze({ name: "perhydrophenanthrene", molecule: perhydrophenanthrene() }),
    Object.freeze({ name: "steroidSkeleton", molecule: steroidSkeleton() }),
  ]);

/** One drawn glyph run's ink, per span, with the span's own script size. */
interface Glyph {
  readonly id: string;
  readonly isHydrogen: boolean;
  readonly box: LabelBox;
}

function glyphs(scene: RenderScene): Glyph[] {
  const out: Glyph[] = [];
  const visit = (primitive: ScenePrimitive): void => {
    if (primitive.type === "group") {
      primitive.children.forEach(visit);
      return;
    }
    if (primitive.type !== "textRun") return;
    out.push(...runGlyphs(primitive, scene.style));
  };
  scene.primitives.forEach(visit);
  return out;
}

function runGlyphs(run: TextRunPrimitive, style: RenderStyle): Glyph[] {
  const measurer = measurerFor(style);
  const measured = measureTextRun(
    run.spans,
    {
      fontFamily: run.fontFamily,
      fontSizePx: run.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: run.anchor,
      // `origin.y` is ALWAYS the alphabetic baseline — see the note on
      // `TextRunPrimitive`. Measuring it any other way would shift every box
      // by part of a cap height and make this test agree with nothing.
      baseline: "alphabetic",
    },
    measurer,
  );
  const isHydrogen = run.source.kind === "hydrogen";
  return glyphInkRects(measured, run.origin, measurer, run.fontFamily).map(
    (box) => ({ id: run.id, isHydrogen, box }),
  );
}

/** Strict overlap: two glyphs sharing an edge are touching, not overlapping. */
function overlapArea(a: LabelBox, b: LabelBox): number {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Every pair of drawn glyphs that share ink and of which at least one is a
 * derived hydrogen, as readable strings.
 *
 * Two glyphs of the SAME run are skipped: the letters of "OH" are set side by
 * side by construction, and a run overlapping itself is a question about the
 * measurer, not about hydrogen placement.
 */
function hydrogenInkOverlaps(scene: RenderScene): string[] {
  const marks = glyphs(scene);
  const out: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const a = marks[i]!;
      const b = marks[j]!;
      if (a.id === b.id) continue;
      if (!a.isHydrogen && !b.isHydrogen) continue;
      const area = overlapArea(a.box, b.box);
      if (area <= 0) continue;
      out.push(`${a.id} ~ ${b.id} (${area.toFixed(2)} px²)`);
    }
  }
  return out;
}

describe("derived hydrogen separation", () => {
  it("never prints a derived hydrogen on top of another glyph", () => {
    // The whole matrix the two hydrogen-drawing views are used in. Both
    // presets, because the defect was a Publication one — at Screen's 44 px
    // bond and 16 px label there is half again as much room per glyph — and a
    // test that only ran at Screen passed throughout.
    for (const subject of SUBJECTS) {
      for (const view of VIEWS) {
        for (const style of PRESETS) {
          const scene = buildScene(subject.molecule, style, view);
          const overlaps = hydrogenInkOverlaps(scene);
          expect(
            overlaps,
            `${subject.name} ${view.kind} ${style.name}`,
          ).toEqual([]);
        }
      }
    }
  });

  it("reports the hydrogens it could not find room for", () => {
    // THE OTHER HALF OF THE CONTRACT. The search gives up rather than shoving
    // a mark somewhere it does not belong, so on a page with no room left
    // there are hydrogens it cannot clear. What must never happen is that
    // such an overlap goes out silently: it has to come back out of
    // `detectCollisions`, which is what the editor shows and what the export
    // warning counts.
    //
    // THE PAGE IS FILLED BY THE STYLE, NOT BY A CONTRIVED MOLECULE. Every
    // subject above clears at both presets — the steroid's C19 methyl, one
    // bond from three ring carbons, still meets C1's label at one of the
    // crowding sweep's nine rotations — which is the point of the pass, so a
    // test that waited for a natural failure would be asserting almost
    // nothing. Tripling the label
    // against the bond puts 32 hydrogens and 21 labels on a page that cannot
    // hold them, and is a style a caller may legitimately build.
    const crowded = withStyle(RENDER_STYLES.publication, { fontSizePx: 50 });
    const mol = steroidSkeleton();
    for (const view of VIEWS) {
      const scene = buildScene(mol, crowded, view);
      const overlaps = hydrogenInkOverlaps(scene);
      expect(overlaps.length, view.kind).toBeGreaterThan(0);
      const reported = new Set(
        detectCollisions(scene, mol, { maxFindings: 10_000 })
          .collisions.filter((collision) => collision.kind === "hydrogen-over-atom")
          .flatMap((collision) => [collision.a, collision.b])
          .flatMap((source) =>
            source?.kind === "hydrogen"
              ? [`atom:${source.hostAtomId}:h:${source.index}:label`]
              : [],
          ),
      );
      // Every hydrogen still touching something is named in the report. The
      // ids are compared rather than the counts: a report that happened to
      // hold as many findings as there are overlaps, about other hydrogens,
      // would pass a count and mean nothing.
      for (const overlap of overlaps) {
        const [a, b] = overlap.split(" ~ ");
        const named = [a!, b!.slice(0, b!.indexOf(" ("))].filter((id) =>
          id.includes(":h:"),
        );
        expect(named.some((id) => reported.has(id)), overlap).toBe(true);
      }
    }
  });

  it("leaves an uncrowded fan exactly where the gap search put it", () => {
    // The separation pass is a LAST RESORT, not a layout of its own: benzene
    // has one hydrogen per vertex with a third of the page each, so every one
    // of them must still sit on the bisector of its own widest gap — which
    // for a ring vertex is the outward radius. A pass that turned hydrogens it
    // did not have to would satisfy the assertion above and quietly restyle
    // every figure in the repository.
    const mol = FIXTURES.find((fixture) => fixture.name === "benzene")!.molecule;
    for (const style of PRESETS) {
      const scene = buildScene(mol, style, VIEWS[0]!);
      let seen = 0;
      for (const glyph of glyphs(scene)) {
        if (!glyph.isHydrogen) continue;
        seen++;
      }
      expect(seen, style.name).toBe(6);

      // The PLACED centres, not the ink boxes: a glyph's ink is not exactly
      // centred on its advance — Arimo's "H" has a left and a right bearing
      // that differ by a font unit — and a test that read the ink for this
      // would be measuring the typeface rather than the placement.
      for (const hydrogen of derivedHydrogens(
        mol,
        style,
        VIEWS[0]!,
        atomLabelPlacements(mol, style, VIEWS[0]!),
      )) {
        const host = modelToPx(style, mol.atoms[hydrogen.hostAtomId]!.pos);
        // Benzene is centred on the origin, so "did not turn" is a
        // collinearity check: the ring centre, the host and the hydrogen lie
        // on one radius. Both vectors are normalised first, so the tolerance
        // means the same thing at either preset's scale.
        expect(
          Math.abs(unitCross(host, hydrogen.centre)),
          `${hydrogen.hostAtomId}:${hydrogen.index} ${style.name}`,
        ).toBeLessThan(1e-9);
      }
    }
  });
});

/** Sine of the angle between two vectors from the origin. */
function unitCross(a: ScenePoint, b: ScenePoint): number {
  const lengthA = Math.sqrt(a.x * a.x + a.y * a.y);
  const lengthB = Math.sqrt(b.x * b.x + b.y * b.y);
  return (a.x / lengthA) * (b.y / lengthB) - (a.y / lengthA) * (b.x / lengthB);
}
