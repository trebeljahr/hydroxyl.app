/**
 * The straight furniture of a scheme: reaction, equilibrium, retrosynthetic
 * and resonance arrows with their conditions, the plus and the coefficient,
 * brackets with their charge and double dagger, and a transition state's
 * partial bonds and deltas (decisions 191-194, 201-205 and 212-214).
 *
 * Real schemes, not synthetic graphs: the SN2 of hydroxide on bromomethane
 * through its transition state, the proline aldol of List, Lerner and
 * Barbas, the allyl cation's resonance pair, the acid-catalysed hydrolysis
 * of ethyl acetate at equilibrium, an enolate methylation in two numbered
 * steps, methane burning with its coefficients — and, from RDKit's own
 * molblocks, D-glucose's mutarotation, the Oppenauer oxidation of
 * cholesterol and testosterone's retrosynthesis back to cholesterol. A
 * regression here reads as "the arrow into the transition state runs through
 * its bracket", not "segment 3 is too long".
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cipDescriptor,
  insertFragment,
  project,
  readMolblock,
  species,
  stereoConfig,
  translateAtoms,
} from "@starter/chem-core";
import type { AtomId, Molecule, PlanarView } from "@starter/chem-core";

import { chargeText } from "../src/annotation/bracket.js";
import { conditionSpans, conditionText, formulaSpans, formatQuantity, stepLabel } from "../src/annotation/conditions.js";
import { STRAIGHT_ARROWHEAD } from "../src/annotation/reaction.js";
import type { StraightArrowLayout } from "../src/annotation/reaction.js";
import { primitivesBox, SCHEME_LAYOUT } from "../src/annotation/scheme-mark.js";
import type { SchemeBox } from "../src/annotation/species-box.js";
import { composeFigure } from "../src/figure/compose.js";
import {
  allylCationResonance,
  enolateMethylation,
  esterHydrolysisEquilibrium,
  methaneCombustion,
  prolineAldol,
  SCHEME_FIXTURES,
  sn2TransitionState,
} from "../src/fixtures.js";
import type { SchemeFixture } from "../src/fixtures.js";
import { representation, TEXT_VIEW_KINDS } from "../src/representation.js";
import type { Representation } from "../src/representation.js";
import { buildAnnotatedScene, buildScene } from "../src/scene/build.js";
import type { SceneBuildOptions } from "../src/scene/build.js";
import type {
  LinePrimitive,
  PathPrimitive,
  PolygonPrimitive,
  PolylinePrimitive,
  ScenePrimitive,
  TextRunPrimitive,
} from "../src/scene/types.js";
import { assembleSchemeAnnotation, materialFlow, schemeAnnotationId } from "../src/scheme/annotation.js";
import type { SchemeAnnotation, SchemeAnnotationInput } from "../src/scheme/annotation.js";
import { pxPerModelUnit, PUBLICATION_STYLE, SCREEN_STYLE, withStyle } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { serializeFigure } from "../src/svg/figure.js";
import { serializeScene } from "../src/svg/serialize.js";
import { EM_CAP_HEIGHT } from "../src/text/metrics.js";
import { BUNDLED_MEASURER, measureTextRun, textRunInkRect } from "../src/text/measurer.js";
import { unmeasuredTextRuns } from "../src/text/typography.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..", "chem-core", "test", "fixtures");
const STYLES: readonly RenderStyle[] = [PUBLICATION_STYLE, SCREEN_STYLE];
const skeletal = representation("skeletal");
const withDescriptors = representation("skeletal", { showStereoDescriptors: true });

function load(file: string): Molecule {
  return readMolblock(readFileSync(join(CORE, file), "utf8")).molecule;
}

type Draft = SchemeAnnotationInput extends infer T ? (T extends unknown ? Omit<T, "id"> : never) : never;

function mark(n: number, draft: Draft): SchemeAnnotation {
  return assembleSchemeAnnotation({ ...draft, id: schemeAnnotationId(n) } as SchemeAnnotationInput);
}

function build(
  mol: Molecule,
  annotations: readonly SchemeAnnotation[],
  style: RenderStyle = PUBLICATION_STYLE,
  rep: Representation = skeletal,
  options: SceneBuildOptions = {},
) {
  return buildAnnotatedScene(mol, style, rep, { ...options, schemeAnnotations: annotations });
}

function byId<T extends ScenePrimitive = ScenePrimitive>(primitives: readonly ScenePrimitive[], id: string): T {
  const found = primitives.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no primitive ${id}`);
  return found as T;
}

function textOf(run: TextRunPrimitive): string {
  return run.spans.map((span) => span.text).join("");
}

function arrowOf(layouts: readonly StraightArrowLayout[], id: string): StraightArrowLayout {
  const found = layouts.find((layout) => layout.annotationId === id);
  if (found === undefined) throw new Error(`no arrow ${id}`);
  return found;
}

function inside(box: SchemeBox, outer: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return box.minX >= outer.minX && box.maxX <= outer.maxX && box.minY >= outer.minY && box.maxY <= outer.maxY;
}

function length(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Every primitive a structure draws, whatever a scheme adds on top. */
function structurePrimitives(primitives: readonly ScenePrimitive[]): ScenePrimitive[] {
  return primitives.filter((p) => p.source.kind !== "annotation");
}

/**
 * The mutarotation of D-glucose: the open chain in equilibrium with
 * alpha-D-glucopyranose, from the projection fixtures' RDKit molblocks, the
 * ring six bond lengths to the right.
 */
function mutarotation(): { molecule: Molecule; chain: AtomId; ring: AtomId } {
  const chain = load("projection/d-glucose-open.mol");
  const ring = load("projection/alpha-d-glucopyranose.mol");
  const inserted = insertFragment(chain, ring, { offset: { x: 13, y: 0 } });
  return { molecule: inserted.molecule, chain: chain.atomIds[0]!, ring: inserted.atomIdMap.get(ring.atomIds[0]!)! };
}

/**
 * The Oppenauer oxidation, cholesterol to cholest-4-en-3-one, from the
 * skeleton fixtures' two-species molblock with the product moved `offset`
 * from where RDKit laid it out (below-left of cholesterol, overlapping it).
 */
function oppenauer(offset: { x: number; y: number }): { molecule: Molecule; cholesterol: AtomId; enone: AtomId } {
  const drawn = load("skeleton/oppenauer-scheme.mol");
  const [first, second] = species(drawn);
  const molecule = translateAtoms(drawn, second!.atomIds, offset);
  return { molecule, cholesterol: first!.atomIds[0]!, enone: second!.atomIds[0]! };
}

const OPPENAUER_CONDITIONS = {
  steps: [
    [
      { kind: "reagent" as const, text: "Al(OiPr)3" },
      { kind: "reagent" as const, text: "acetone" },
      { kind: "solvent" as const, text: "toluene" },
      { kind: "text" as const, text: "reflux" },
    ],
  ],
  numbered: false,
};

describe("every scheme fixture draws clear, at both presets (decisions 203, 204, 213)", () => {
  for (const fixture of SCHEME_FIXTURES) {
    for (const style of STYLES) {
      it(`draws every mark of ${fixture.name} at ${style.name} with nothing to report but the unvendored delta`, () => {
        const { scene, schemeAnnotations: report } = build(fixture.molecule, fixture.annotations, style);
        expect(report.unresolved).toEqual([]);
        const laidOut = [
          ...report.straightArrows,
          ...report.plusSigns,
          ...report.coefficients,
          ...report.brackets,
          ...report.partialBonds,
          ...report.texts,
        ];
        const ids = [...laidOut.map((l) => l.annotationId), ...report.partialCharges.map((l) => l.annotationId)];
        expect([...ids].sort()).toEqual(fixture.annotations.map((a) => a.id).sort());
        for (const layout of laidOut) {
          expect(layout.findings, `${fixture.name} ${layout.annotationId}`).toEqual([]);
          expect(layout.primitives.length, layout.annotationId).toBeGreaterThan(0);
          for (const primitive of layout.primitives) {
            expect(scene.primitives, primitive.id).toContain(primitive);
            expect(primitive.source).toEqual({ kind: "annotation", annotationId: layout.annotationId });
          }
        }
        for (const delta of report.partialCharges) {
          // Pinned until Greek is vendored (decision 206), and nothing else.
          expect(delta.findings).toEqual([{ kind: "unmeasured-glyphs", codePoints: [0x3b4] }]);
          expect(delta.drawn).toBe(true);
        }
      });
    }

    it(`moves nothing of ${fixture.name}'s structure: the scheme only adds`, () => {
      const plain = buildScene(fixture.molecule, PUBLICATION_STYLE, skeletal);
      const { scene } = build(fixture.molecule, fixture.annotations);
      const deltas = (p: ScenePrimitive) => p.id.endsWith(":partialCharge");
      expect(structurePrimitives(scene.primitives).filter((p) => !deltas(p))).toEqual(plain.primitives);
    });
  }
});

describe("a straight arrow is drawn geometry whose shaft stretches to its text (decisions 191, 203)", () => {
  it("draws the SN2's bare arrow at the stated minimum and the aldol's at its widest line plus an em, with one head size", () => {
    const style = PUBLICATION_STYLE;
    const sn2 = sn2TransitionState();
    const aldol = prolineAldol();
    const bare = arrowOf(build(sn2.molecule, sn2.annotations).schemeAnnotations.straightArrows, "ann_2");
    const worded = arrowOf(build(aldol.molecule, aldol.annotations).schemeAnnotations.straightArrows, "ann_2");
    expect(bare.lengthPx).toBe(SCHEME_LAYOUT.minArrowBonds * pxPerModelUnit(style));
    const widest = Math.max(...worded.conditions.map((line) => line.advanceWidthPx));
    expect(worded.lengthPx).toBeCloseTo(widest + 2 * SCHEME_LAYOUT.conditionsPadEm * style.fontSizePx, 9);
    expect(worded.lengthPx).toBeGreaterThan(2 * bare.lengthPx);
    // The head is ChemDraw's straight-arrow head in line widths, the same
    // polygon on the long shaft as on the short one.
    const headOf = (layout: StraightArrowLayout) =>
      (layout.primitives.find((p) => p.id.endsWith(":head")) as PolygonPrimitive).points;
    for (const layout of [bare, worded]) {
      const [tip, leftBarb, notch, rightBarb] = headOf(layout);
      expect(length(tip!, notch!)).toBeCloseTo(STRAIGHT_ARROWHEAD.notch * style.bondLineWidthPx, 9);
      expect(length(leftBarb!, rightBarb!)).toBeCloseTo(2 * STRAIGHT_ARROWHEAD.halfWidth * style.bondLineWidthPx, 9);
      expect(tip).toEqual(layout.tip);
    }
    // No arrow is ever a glyph: no text run anywhere holds one.
    for (const fixture of SCHEME_FIXTURES) {
      const { scene } = build(fixture.molecule, fixture.annotations);
      for (const p of scene.primitives) {
        if (p.type === "textRun") expect(textOf(p)).not.toMatch(/[→⇌⇒↔‡]/u);
      }
    }
  });

  it("sets the aldol's reagent above the shaft and its solvent and temperature below, centred by measured advance", () => {
    const aldol = prolineAldol();
    for (const style of STYLES) {
      const { scene, schemeAnnotations } = build(aldol.molecule, aldol.annotations, style);
      const arrow = arrowOf(schemeAnnotations.straightArrows, "ann_2");
      expect(arrow.axis).toBe("horizontal");
      const above = arrow.conditions.filter((c) => c.side === "above").map((c) => c.spans.map((s) => s.text).join(""));
      const below = arrow.conditions.filter((c) => c.side === "below").map((c) => c.spans.map((s) => s.text).join(""));
      expect(above).toEqual(["L-proline (30 mol%)"]);
      expect(below).toEqual(["DMSO, rt"]);
      const middle = (arrow.tail.x + arrow.tip.x) / 2;
      const shaftY = arrow.tip.y;
      arrow.conditions.forEach((line, index) => {
        const run = byId<TextRunPrimitive>(scene.primitives, `annotation:ann_2:conditions-${line.side}-0`);
        expect(run.anchor).toBe("middle");
        expect(run.origin).toEqual(line.origin);
        expect(line.origin.x).toBeCloseTo(middle, 9);
        // Measured against the one table, with no .notdef, so the advance it
        // is centred on is the advance a viewer with Arimo, Arial or
        // Helvetica draws.
        const measured = measureTextRun(
          run.spans,
          { fontFamily: run.fontFamily, fontSizePx: run.fontSizePx, subscriptScale: style.subscriptScale, anchor: "middle", baseline: "alphabetic" },
          BUNDLED_MEASURER,
        );
        expect(measured.advanceWidthPx).toBe(line.advanceWidthPx);
        const box = primitivesBox([run], style);
        expect(box.maxX - box.minX).toBeCloseTo(line.advanceWidthPx, 9);
        expect((box.minX + box.maxX) / 2).toBeCloseTo(middle, 9);
        for (const span of run.spans) {
          expect(BUNDLED_MEASURER.measureText(span.text, { family: run.fontFamily, sizePx: 10 }).notdefCount).toBe(0);
        }
        if (line.side === "above") expect(box.maxY, `${index}`).toBeLessThan(shaftY);
        else expect(box.minY, `${index}`).toBeGreaterThan(shaftY);
      });
    }
  });

  it("numbers the enolate methylation's two steps, one a line, the first above: a real minus and a degree sign", () => {
    const fixture = enolateMethylation();
    const arrow = build(fixture.molecule, fixture.annotations).schemeAnnotations.straightArrows[0]!;
    const lines = arrow.conditions.map((c) => [c.side, c.spans.map((s) => s.text).join("")]);
    expect(lines).toEqual([
      ["above", "(i) LDA, THF, −78 °C"],
      ["below", "(ii) MeI"],
    ]);
    expect(stepLabel(0)).toBe("(i)");
    expect(stepLabel(3)).toBe("(iv)");
    expect(stepLabel(8)).toBe("(ix)");
  });

  it("wraps a long list between items only, keeps each comma, and stretches past the room rather than split a name", () => {
    const aldol = prolineAldol();
    // A Suzuki coupling's conditions on the aldol's species, where only the
    // room between them is available: the lines must break.
    const suzuki = [
      mark(1, {
        kind: "reactionArrow",
        from: [aldol.acetone, aldol.aldehyde],
        to: [aldol.product],
        conditions: {
          steps: [
            [
              { kind: "reagent", text: "Pd(PPh3)4" },
              { kind: "reagent", text: "K2CO3" },
              { kind: "reagent", text: "PhB(OH)2" },
              { kind: "reagent", text: "18-crown-6" },
              { kind: "solvent", text: "dioxane" },
              { kind: "solvent", text: "H2O" },
              { kind: "temperature", value: 80, unit: "C" },
              { kind: "time", value: 12, unit: "h" },
            ],
          ],
          numbered: false,
        },
      }),
    ];
    const style = PUBLICATION_STYLE;
    const arrow = build(aldol.molecule, suzuki, style).schemeAnnotations.straightArrows[0]!;
    const text = (side: "above" | "below") =>
      arrow.conditions.filter((c) => c.side === side).map((c) => c.spans.map((s) => s.text).join(""));
    expect(text("above").length).toBeGreaterThan(1);
    expect(text("above").join(" ")).toBe("Pd(PPh3)4, K2CO3, PhB(OH)2, 18-crown-6");
    expect(text("below").join(" ")).toBe("dioxane, H2O, 80 °C, 12 h");
    const wrap = Math.max(SCHEME_LAYOUT.minArrowBonds * pxPerModelUnit(style), arrow.roomPx) - 2 * SCHEME_LAYOUT.conditionsPadEm * style.fontSizePx;
    for (const side of ["above", "below"] as const) {
      const lines = arrow.conditions.filter((c) => c.side === side);
      lines.forEach((line, index) => {
        const printed = line.spans.map((s) => s.text).join("");
        if (index < lines.length - 1) expect(printed).toMatch(/,$/);
        // A line wider than the wrap holds exactly one item.
        if (line.advanceWidthPx > wrap) expect(printed.replace(/,$/, "")).not.toContain(", ");
      });
    }
  });

  it("subscripts a formula's counts, raises its charge, and prints a text item exactly as typed", () => {
    expect(formulaSpans("NaBH4")).toEqual([{ text: "NaBH" }, { text: "4", script: "sub" }]);
    expect(formulaSpans("Pd(PPh3)4")).toEqual([
      { text: "Pd(PPh" },
      { text: "3", script: "sub" },
      { text: ")" },
      { text: "4", script: "sub" },
    ]);
    expect(formulaSpans("H3O+")).toEqual([{ text: "H" }, { text: "3", script: "sub" }, { text: "O" }, { text: "+", script: "super" }]);
    expect(formulaSpans("Fe3+")).toEqual([{ text: "Fe" }, { text: "3+", script: "super" }]);
    expect(formulaSpans("MeO-")).toEqual([{ text: "MeO" }, { text: "−", script: "super" }]);
    // A number that starts a token is a quantity, not a count.
    expect(formulaSpans("2 M HCl")).toEqual([{ text: "2 M HCl" }]);
    expect(formulaSpans("18-crown-6")).toEqual([{ text: "18-crown-6" }]);
    expect(conditionSpans({ kind: "text", text: "NaBH4, then H3O+" })).toEqual([{ text: "NaBH4, then H3O+" }]);
    expect(conditionText({ kind: "temperature", value: -78, unit: "C" })).toBe("−78 °C");
    expect(conditionText({ kind: "temperature", value: 298.15, unit: "K" })).toBe("298.15 K");
    expect(conditionText({ kind: "time", value: 0.5, unit: "h" })).toBe("0.5 h");
    expect(formatQuantity(-0.0001)).toBe("0");
  });

  it("draws the ester hydrolysis as two half-headed shafts, each barb outside, the favoured reverse half longer", () => {
    const fixture = esterHydrolysisEquilibrium();
    const style = PUBLICATION_STYLE;
    const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
    const arrow = arrowOf(schemeAnnotations.straightArrows, "ann_2");
    expect(arrow.arrow).toBe("equilibrium");
    expect(materialFlow(fixture.annotations[1]!)).toMatchObject({ reversible: true });
    const forward = byId<LinePrimitive>(scene.primitives, "annotation:ann_2:forward-shaft");
    const reverse = byId<LinePrimitive>(scene.primitives, "annotation:ann_2:reverse-shaft");
    const forwardHead = byId<PolygonPrimitive>(scene.primitives, "annotation:ann_2:forward-head");
    const reverseHead = byId<PolygonPrimitive>(scene.primitives, "annotation:ann_2:reverse-head");
    // Half heads: tip, one barb, notch.
    expect(forwardHead.points).toHaveLength(3);
    expect(reverseHead.points).toHaveLength(3);
    // The double-bond gap apart, forward above (page-left of travel).
    expect(reverse.a.y - forward.a.y).toBeCloseTo(style.doubleBondGapPx, 9);
    expect(forwardHead.points[1]!.y).toBeLessThan(forward.a.y);
    expect(reverseHead.points[1]!.y).toBeGreaterThan(reverse.a.y);
    // Forward points right, reverse points left.
    expect(forwardHead.points[0]!.x).toBeGreaterThan(forward.a.x);
    expect(reverseHead.points[0]!.x).toBeLessThan(reverse.a.x);
    // Decision 194's bias: the reverse half is the whole arrow, the forward
    // 0.6 of it, centred on it.
    const drawnLength = (shaft: LinePrimitive, head: PolygonPrimitive) =>
      Math.abs(head.points[0]!.x - shaft.a.x);
    expect(drawnLength(reverse, reverseHead)).toBeCloseTo(arrow.lengthPx, 9);
    expect(drawnLength(forward, forwardHead)).toBeCloseTo(arrow.lengthPx * SCHEME_LAYOUT.equilibriumMinorFraction, 9);
    expect((forward.a.x + forwardHead.points[0]!.x) / 2).toBeCloseTo((reverse.a.x + reverseHead.points[0]!.x) / 2, 9);
    // Unbiased, the two halves are equal.
    const even = [fixture.annotations[0]!, mark(2, { ...(fixture.annotations[1] as Draft), equilibrium: {} } as Draft), fixture.annotations[2]!];
    const flat = build(fixture.molecule, even, style).scene.primitives;
    const f = byId<LinePrimitive>(flat, "annotation:ann_2:forward-shaft");
    const fh = byId<PolygonPrimitive>(flat, "annotation:ann_2:forward-head");
    const r = byId<LinePrimitive>(flat, "annotation:ann_2:reverse-shaft");
    const rh = byId<PolygonPrimitive>(flat, "annotation:ann_2:reverse-head");
    expect(drawnLength(f, fh)).toBeCloseTo(drawnLength(r, rh), 9);
  });

  it("draws testosterone => cholesterol as two shafts closed by an open chevron, pointing from the target to its precursor", () => {
    const testosterone = load("steroid/testosterone.mol");
    const cholesterol = load("steroid/cholesterol.mol");
    const inserted = insertFragment(testosterone, cholesterol, { offset: { x: 9.5, y: 0 } });
    const target = testosterone.atomIds[0]!;
    const precursor = inserted.atomIdMap.get(cholesterol.atomIds[0]!)!;
    const retro = mark(1, { kind: "retrosynthesisArrow", target: [target], precursors: [precursor] });
    // Non-vacuous: both are the real stereoisomers, every centre a letter.
    const letters = (mol: Molecule) => mol.atomIds.filter((id) => ["R", "S"].includes(cipDescriptor(mol, id)?.kind ?? ""));
    expect(letters(testosterone)).toHaveLength(6);
    expect(letters(cholesterol)).toHaveLength(8);
    const { scene, schemeAnnotations } = build(inserted.molecule, [retro]);
    const arrow = schemeAnnotations.straightArrows[0]!;
    expect(arrow.arrow).toBe("retrosynthesis");
    expect(arrow.findings).toEqual([]);
    const upper = byId<LinePrimitive>(scene.primitives, "annotation:ann_1:shaft-left");
    const lower = byId<LinePrimitive>(scene.primitives, "annotation:ann_1:shaft-right");
    const head = byId<PolylinePrimitive>(scene.primitives, "annotation:ann_1:head");
    expect(head.type).toBe("polyline");
    expect(Object.hasOwn(head, "fill")).toBe(false);
    expect(serializeScene(scene)).toMatch(/<polyline id="annotation:ann_1:head"[^>]*fill="none"/);
    expect(lower.a.y - upper.a.y).toBeCloseTo(PUBLICATION_STYLE.doubleBondGapPx, 9);
    // The tip is on cholesterol's side: the arrow points AGAINST material
    // flow, and `materialFlow` is what turns it round.
    const testosteroneBox = primitivesBox(structurePrimitives(scene.primitives).filter((p) => p.source.kind === "atom" && testosterone.atomIds.includes(p.source.atomId)), PUBLICATION_STYLE);
    expect(head.points[1]!.x).toBeGreaterThan(testosteroneBox.maxX);
    expect(arrow.tip.x).toBeGreaterThan(arrow.tail.x);
    expect(materialFlow(retro)).toEqual({ reactants: [precursor], products: [target], reversible: false });
  });

  it("draws the allyl cation's resonance arrow with a head at each end, and reports a pair that is not one compound", () => {
    const fixture = allylCationResonance();
    const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations);
    const arrow = arrowOf(schemeAnnotations.straightArrows, "ann_1");
    expect(arrow.arrow).toBe("resonance");
    expect(byId<PolygonPrimitive>(scene.primitives, "annotation:ann_1:head").points).toHaveLength(4);
    expect(byId<PolygonPrimitive>(scene.primitives, "annotation:ann_1:tail-head").points).toHaveLength(4);
    expect(materialFlow(fixture.annotations[0]!)).toBeUndefined();
    // Redraw the second form as the neutral propene radical's skeleton, and
    // the arrow no longer joins two forms of one ion.
    const neutral = { ...fixture.molecule, atoms: { ...fixture.molecule.atoms, [fixture.second]: { ...fixture.molecule.atoms[fixture.second]!, charge: 0 } } };
    const broken = arrowOf(build(neutral, fixture.annotations).schemeAnnotations.straightArrows, "ann_1");
    expect(broken.findings).toContainEqual({ kind: "resonance-charge-differs" });
  });

  it("reports an arrow its species crowd, and moves none of them", () => {
    const aldol = prolineAldol();
    const product = species(aldol.molecule).find((s) => s.atomIds.includes(aldol.product))!.atomIds;
    const crowded = translateAtoms(aldol.molecule, product, { x: -6, y: 0 });
    const { scene, schemeAnnotations } = build(crowded, aldol.annotations);
    const arrow = arrowOf(schemeAnnotations.straightArrows, "ann_2");
    expect(arrow.findings).toContainEqual({ kind: "crowds-species" });
    expect(arrow.lengthPx).toBeGreaterThan(arrow.roomPx);
    expect(structurePrimitives(scene.primitives)).toEqual(buildScene(crowded, PUBLICATION_STYLE, skeletal).primitives);
  });

  it("runs vertically between stacked species, the Oppenauer's reagents to its right and the rest to its left", () => {
    const { molecule, cholesterol, enone } = oppenauer({ x: 0, y: 6 });
    const arrow = mark(1, { kind: "reactionArrow", from: [cholesterol], to: [enone], conditions: OPPENAUER_CONDITIONS });
    const layout = build(molecule, [arrow]).schemeAnnotations.straightArrows[0]!;
    expect(layout.axis).toBe("vertical");
    expect(layout.findings).toEqual([]);
    // The product is ABOVE cholesterol in the drawing (y-up), so the arrow
    // points up the page.
    expect(layout.tip.y).toBeLessThan(layout.tail.y);
    const shaftX = layout.tip.x;
    for (const line of layout.conditions) {
      if (line.side === "above") {
        expect(line.anchor).toBe("start");
        expect(line.origin.x).toBeGreaterThan(shaftX);
      } else {
        expect(line.anchor).toBe("end");
        expect(line.origin.x).toBeLessThan(shaftX);
      }
    }
    // A side column wraps at four bond lengths, so each pair stacks.
    expect(layout.conditions.filter((c) => c.side === "above").map((c) => c.spans.map((s) => s.text).join(""))).toEqual([
      "Al(OiPr)3,",
      "acetone",
    ]);
    expect(layout.conditions.filter((c) => c.side === "below").map((c) => c.spans.map((s) => s.text).join(""))).toEqual([
      "toluene,",
      "reflux",
    ]);
  });
});

describe("the scheme plus and the coefficient are not charges (decision 204)", () => {
  it("draws the plus as two strokes 0.4 bond lengths long that no font size or subscript scale reaches", () => {
    const fixture = methaneCombustion();
    const arms = (style: RenderStyle) => {
      const plus = byId<PathPrimitive>(build(fixture.molecule, fixture.annotations, style).scene.primitives, "annotation:ann_2:plus");
      const numbers = plus.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      return { horizontal: Math.abs(numbers[2]! - numbers[0]!), vertical: Math.abs(numbers[7]! - numbers[5]!), stroke: plus.stroke };
    };
    const base = arms(PUBLICATION_STYLE);
    expect(base.horizontal).toBeCloseTo(2 * SCHEME_LAYOUT.plusHalfArmBonds * pxPerModelUnit(PUBLICATION_STYLE), 2);
    expect(base.vertical).toBeCloseTo(base.horizontal, 2);
    expect(base.stroke?.width).toBe(PUBLICATION_STYLE.bondLineWidthPx);
    // Neither the label size nor the subscript scale changes its size (the
    // labels it sits between do move it, so only the arms are compared).
    const restyled = arms(withStyle(PUBLICATION_STYLE, { subscriptScale: 0.5, fontSizePx: 30 }));
    expect(restyled.horizontal).toBeCloseTo(base.horizontal, 2);
    expect(restyled.vertical).toBeCloseTo(base.vertical, 2);
    expect(restyled.stroke).toEqual(base.stroke);
  });

  it("leaves a formal charge at its own superscript size beside a scheme plus, and the plus at its own", () => {
    const fixture = sn2TransitionState();
    const style = PUBLICATION_STYLE;
    const charged = (primitives: readonly ScenePrimitive[]) =>
      byId<TextRunPrimitive>(primitives, `atom:${fixture.hydroxide}:label`);
    const alone = charged(buildScene(fixture.molecule, style, skeletal).primitives);
    const inScheme = build(fixture.molecule, fixture.annotations, style).scene.primitives;
    expect(charged(inScheme)).toEqual(alone);
    const charge = alone.spans.find((span) => span.script === "super");
    expect(charge?.text).toBe("−");
    // The formal charge is a superscript glyph at subscriptScale; the scheme
    // plus is a stroked path half a bond wide, with no font size at all.
    const plus = byId<PathPrimitive>(inScheme, "annotation:ann_1:plus");
    expect(plus.type).toBe("path");
    const chargeHeight = EM_CAP_HEIGHT * style.fontSizePx * style.subscriptScale;
    expect(2 * SCHEME_LAYOUT.plusHalfArmBonds * pxPerModelUnit(style)).toBeGreaterThan(chargeHeight);
  });

  it("sets 2 before O2 and before H2O at the label size, and keeps the plus clear of it", () => {
    const fixture = methaneCombustion();
    const style = PUBLICATION_STYLE;
    const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
    expect(schemeAnnotations.coefficients.map((c) => c.text)).toEqual(["2", "2"]);
    const two = byId<TextRunPrimitive>(scene.primitives, "annotation:ann_1:coefficient");
    expect(two.fontSizePx).toBe(style.fontSizePx);
    expect(two.anchor).toBe("end");
    // A quarter em before the O's INK, the species' box (decision 203).
    const oxygen = byId<TextRunPrimitive>(scene.primitives, `atom:${fixture.oxygen}:label`);
    const runBox = measureTextRun(
      oxygen.spans,
      { fontFamily: oxygen.fontFamily, fontSizePx: oxygen.fontSizePx, subscriptScale: style.subscriptScale, anchor: oxygen.anchor, baseline: "alphabetic" },
      BUNDLED_MEASURER,
    );
    const ink = textRunInkRect(runBox, oxygen.origin, BUNDLED_MEASURER, oxygen.fontFamily)!;
    expect(two.origin.x).toBeCloseTo(ink.minX - SCHEME_LAYOUT.coefficientGapEm * style.fontSizePx, 6);
    const plus = schemeAnnotations.plusSigns.find((p) => p.annotationId === "ann_2")!;
    expect(plus.box.maxX).toBeLessThan(schemeAnnotations.coefficients[0]!.box.minX);
    // A second coefficient on O2 is reported and not drawn.
    const doubled = [...fixture.annotations, mark(6, { kind: "coefficient", species: fixture.oxygen, value: 3 })];
    const again = build(fixture.molecule, doubled, style).schemeAnnotations.coefficients;
    expect(again.find((c) => c.annotationId === "ann_6")).toMatchObject({ primitives: [], findings: [{ kind: "duplicate-coefficient" }] });
  });
});

describe("brackets carry their charge outside, top right (decisions 194, 204, 212)", () => {
  it("encloses both allyl forms and the resonance arrow, with + outside the closing bracket on its top edge", () => {
    const fixture = allylCationResonance();
    for (const style of STYLES) {
      const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
      const bracket = schemeAnnotations.brackets[0]!;
      expect(bracket.findings).toEqual([]);
      expect(bracket.chargeText).toBe("+");
      const arrow = schemeAnnotations.straightArrows[0]!;
      expect(inside(arrow.box, bracket.enclosure)).toBe(true);
      for (const p of structurePrimitives(scene.primitives)) {
        expect(inside(primitivesBox([p], style), bracket.enclosure), p.id).toBe(true);
      }
      const charge = byId<TextRunPrimitive>(scene.primitives, "annotation:ann_2:charge");
      expect(charge.origin.x).toBeGreaterThan(bracket.enclosure.maxX);
      expect(charge.fontSizePx).toBeCloseTo(style.fontSizePx * style.subscriptScale, 9);
      // Its cap band starts on the bracket's top edge.
      expect(charge.origin.y - EM_CAP_HEIGHT * charge.fontSizePx).toBeCloseTo(bracket.enclosure.minY, 9);
      const close = byId<PolylinePrimitive>(scene.primitives, "annotation:ann_2:close");
      expect(close.points.map((p) => p.x)).toEqual([
        bracket.enclosure.maxX - SCHEME_LAYOUT.bracketSerifBonds * pxPerModelUnit(style),
        bracket.enclosure.maxX,
        bracket.enclosure.maxX,
        bracket.enclosure.maxX - SCHEME_LAYOUT.bracketSerifBonds * pxPerModelUnit(style),
      ]);
    }
    expect([1, 2, -1, -3].map(chargeText)).toEqual(["+", "2+", "−", "3−"]);
  });

  it("reports a stored charge the forms do not carry", () => {
    const fixture = allylCationResonance();
    const wrong = [fixture.annotations[0]!, mark(2, { kind: "bracket", species: [fixture.first, fixture.second], charge: -1 })];
    expect(build(fixture.molecule, wrong).schemeAnnotations.brackets[0]!.findings).toEqual([
      { kind: "charge-mismatch", atomId: fixture.first, netCharge: 1 },
    ]);
  });

  it("draws the SN2 transition state's double dagger before its charge, from strokes, and stops both arrows at the bracket", () => {
    const fixture = sn2TransitionState();
    const style = PUBLICATION_STYLE;
    const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
    const bracket = schemeAnnotations.brackets[0]!;
    expect(bracket.chargeText).toBe("−");
    const stem = byId<LinePrimitive>(scene.primitives, "annotation:ann_7:dagger-stem");
    const upper = byId<LinePrimitive>(scene.primitives, "annotation:ann_7:dagger-upper");
    const lower = byId<LinePrimitive>(scene.primitives, "annotation:ann_7:dagger-lower");
    const charge = byId<TextRunPrimitive>(scene.primitives, "annotation:ann_7:charge");
    const capHeight = EM_CAP_HEIGHT * style.fontSizePx * style.subscriptScale;
    expect(stem.b.y - stem.a.y).toBeCloseTo(capHeight, 9);
    expect(stem.a.y).toBeCloseTo(bracket.enclosure.minY, 9);
    for (const bar of [upper, lower]) {
      expect(bar.a.y).toBe(bar.b.y);
      expect((bar.a.x + bar.b.x) / 2).toBeCloseTo(stem.a.x, 9);
    }
    expect(stem.a.x).toBeGreaterThan(bracket.enclosure.maxX);
    expect(charge.origin.x).toBeGreaterThan(upper.b.x);
    // Everything inside: the three fragments, both partial bonds, both deltas.
    for (const p of scene.primitives) {
      const isTs =
        (p.source.kind === "atom" && [fixture.tsOxygen, fixture.tsCarbon, fixture.tsBromine].includes(p.source.atomId)) ||
        (p.source.kind === "annotation" && ["ann_3", "ann_4", "ann_5", "ann_6"].includes(p.source.annotationId));
      if (isTs) expect(inside(primitivesBox([p], style), bracket.enclosure), p.id).toBe(true);
    }
    // The arrow in ends before "[" and the arrow out starts after "‡−".
    const into = arrowOf(schemeAnnotations.straightArrows, "ann_2");
    const out = arrowOf(schemeAnnotations.straightArrows, "ann_8");
    expect(into.box.maxX).toBeLessThan(bracket.enclosure.minX);
    expect(out.box.minX).toBeGreaterThan(bracket.box.maxX);
  });

  it("holds a transition state to its fragments' formal charges only when it draws any", () => {
    const fixture = sn2TransitionState();
    // No fragment is charged: the bracket states the charge alone.
    expect(build(fixture.molecule, fixture.annotations).schemeAnnotations.brackets[0]!.findings).toEqual([]);
    // The hydroxide's charge drawn on the transition state's oxygen agrees
    // with the stored -1; a +1 on the bromine as well sums to 0, and does not.
    const atoms = fixture.molecule.atoms;
    const withCharges = (charges: Record<AtomId, number>): Molecule => ({
      ...fixture.molecule,
      atoms: Object.fromEntries(Object.entries(atoms).map(([id, atom]) => [id, id in charges ? { ...atom, charge: charges[id]! } : atom])),
    });
    expect(build(withCharges({ [fixture.tsOxygen]: -1 }), fixture.annotations).schemeAnnotations.brackets[0]!.findings).toEqual([]);
    expect(
      build(withCharges({ [fixture.tsOxygen]: -1, [fixture.tsBromine]: 1 }), fixture.annotations).schemeAnnotations.brackets[0]!
        .findings,
    ).toEqual([{ kind: "charge-mismatch", atomId: fixture.tsOxygen, netCharge: 0 }]);
  });
});

describe("a transition state's partial bonds and deltas (decisions 205, 214)", () => {
  it("dashes each partial bond between the labels it joins, sourced to its annotation", () => {
    const fixture = sn2TransitionState();
    for (const style of STYLES) {
      const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
      const bond = pxPerModelUnit(style);
      for (const id of ["ann_3", "ann_4"]) {
        const line = byId<LinePrimitive>(scene.primitives, `annotation:${id}:partial-bond`);
        expect(line.stroke.dash).toEqual(SCHEME_LAYOUT.partialBondDashBonds.map((f) => f * bond));
        expect(line.stroke.width).toBe(style.bondLineWidthPx);
        // Trimmed: shorter than the two bond lengths between the centres.
        expect(length(line.a, line.b)).toBeLessThan(2 * bond);
        expect(length(line.a, line.b)).toBeGreaterThan(0.5 * bond);
      }
      expect(schemeAnnotations.partialBonds.map((p) => p.findings)).toEqual([[], []]);
    }
    // One drawn over a bond the molecule already has is reported.
    const aldol = prolineAldol();
    const over = mark(1, { kind: "partialBond", atoms: [aldol.carbinol, aldol.molecule.atomIds.find((id) => id !== aldol.carbinol && aldol.molecule.bondIds.some((b) => { const x = aldol.molecule.bonds[b]!; return (x.from === aldol.carbinol && x.to === id) || (x.to === aldol.carbinol && x.from === id); }))!] });
    expect(build(aldol.molecule, [over]).schemeAnnotations.partialBonds[0]!.findings).toEqual([{ kind: "on-drawn-bond" }]);
  });

  it("places the deltas through the one label pass, clear of every glyph, sourced to their annotations", () => {
    const fixture = sn2TransitionState();
    for (const style of STYLES) {
      const { scene, annotations, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
      for (const [annotationId, atomId] of [["ann_5", fixture.tsOxygen], ["ann_6", fixture.tsBromine]] as const) {
        const placement = annotations.placements.find((p) => p.id === `atom:${atomId}:partialCharge`);
        expect(placement?.kind).toBe("partialCharge");
        expect(placement?.text).toBe("δ−");
        expect(placement?.clear, style.name).toBe(true);
        expect(placement?.drawn).toBe(true);
        const run = byId<TextRunPrimitive>(scene.primitives, `atom:${atomId}:partialCharge`);
        expect(run.source).toEqual({ kind: "annotation", annotationId });
        expect(run.fontSizePx).toBeCloseTo(style.fontSizePx * style.stereoDescriptorScale, 9);
        const report = schemeAnnotations.partialCharges.find((d) => d.annotationId === annotationId)!;
        expect(report.placement).toEqual(placement);
      }
      expect(annotations.unplaced).toEqual([]);
    }
  });

  it("reports the delta as the one unmeasured run of the scene, and throws on nothing (decision 206)", () => {
    const fixture = sn2TransitionState();
    const { scene } = build(fixture.molecule, fixture.annotations);
    const runs = unmeasuredTextRuns(scene);
    expect(runs.map((r) => [r.primitiveId, r.text, r.codePoints])).toEqual([
      [`atom:${fixture.tsOxygen}:partialCharge`, "δ−", [0x3b4]],
      [`atom:${fixture.tsBromine}:partialCharge`, "δ−", [0x3b4]],
    ]);
  });
});

describe("a scheme never moves a descriptor (real molecules, letters first)", () => {
  it("draws D-glucose's mutarotation equilibrium, and a delta on its carbonyl, without moving one of its nine letters", () => {
    const { molecule, chain, ring } = mutarotation();
    const letters = molecule.atomIds.filter((id) => ["R", "S"].includes(cipDescriptor(molecule, id)?.kind ?? ""));
    expect(letters).toHaveLength(9);
    const carbonyl = molecule.atomIds.find(
      (id) => molecule.atoms[id]!.element === "O" && molecule.bondIds.some((b) => { const x = molecule.bonds[b]!; return x.order === 2 && (x.from === id || x.to === id); }),
    )!;
    const scheme = [
      mark(1, {
        kind: "reactionArrow",
        from: [chain],
        to: [ring],
        equilibrium: {},
        conditions: { steps: [[{ kind: "solvent", text: "H2O" }]], numbered: false },
      }),
      mark(2, { kind: "partialCharge", atomId: carbonyl, sign: "-" }),
    ];
    const style = SCREEN_STYLE;
    const plain = buildAnnotatedScene(molecule, style, withDescriptors);
    const drawn = build(molecule, scheme, style, withDescriptors);
    const descriptors = (layout: typeof plain.annotations) =>
      layout.placements.filter((p) => p.kind === "descriptor").map((p) => [p.id, p.text, p.origin, p.drawn]);
    expect(descriptors(plain.annotations)).toHaveLength(9);
    expect(descriptors(drawn.annotations)).toEqual(descriptors(plain.annotations));
    expect(drawn.schemeAnnotations.straightArrows[0]!.findings).toEqual([]);
    expect(drawn.schemeAnnotations.partialCharges[0]!.drawn).toBe(true);
  });

  it("draws the Oppenauer oxidation of cholesterol with its conditions, clear, and every letter where it was", () => {
    const { molecule, cholesterol, enone } = oppenauer({ x: 24.5, y: -8.13 });
    const letters = molecule.atomIds.filter((id) => ["R", "S"].includes(cipDescriptor(molecule, id)?.kind ?? ""));
    expect(letters).toHaveLength(15);
    const arrow = mark(1, { kind: "reactionArrow", from: [cholesterol], to: [enone], conditions: OPPENAUER_CONDITIONS });
    for (const style of STYLES) {
      const plain = buildAnnotatedScene(molecule, style, withDescriptors);
      const drawn = build(molecule, [arrow], style, withDescriptors);
      const layout = drawn.schemeAnnotations.straightArrows[0]!;
      expect(layout.axis).toBe("horizontal");
      expect(layout.findings).toEqual([]);
      expect(drawn.annotations.placements).toEqual(plain.annotations.placements);
      expect(structurePrimitives(drawn.scene.primitives)).toEqual(plain.scene.primitives);
    }
  });
});

describe("bounds and export enclose every mark (done-when)", () => {
  it("grows the scene bounds and the exported viewBox around every conditions line, bracket and arrowhead", () => {
    for (const fixture of SCHEME_FIXTURES) {
      for (const style of STYLES) {
        const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, style);
        const boxes = [
          ...schemeAnnotations.straightArrows,
          ...schemeAnnotations.plusSigns,
          ...schemeAnnotations.coefficients,
          ...schemeAnnotations.brackets,
          ...schemeAnnotations.partialBonds,
        ].map((l) => [l.annotationId, l.box] as const);
        for (const [id, box] of boxes) expect(inside(box, scene.bounds), `${fixture.name} ${id}`).toBe(true);

        const figure = composeFigure(fixture.molecule, style, [{ id: "p", representation: skeletal }], {
          schemeAnnotations: fixture.annotations,
        });
        const svg = serializeFigure(figure);
        const [minX, minY, width, height] = /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number) as [number, number, number, number];
        const offset = figure.cells[0]!.offset;
        const viewBox = { minX, minY, maxX: minX + width, maxY: minY + height };
        for (const [id, box] of boxes) {
          const moved = { minX: box.minX + offset.x, maxX: box.maxX + offset.x, minY: box.minY + offset.y, maxY: box.maxY + offset.y };
          expect(inside(moved, viewBox), `${fixture.name} ${id} in the exported viewBox`).toBe(true);
        }
        // The export draws them: every mark's primitives are in the file.
        for (const annotation of fixture.annotations) {
          if (annotation.kind === "partialCharge") continue;
          expect(svg, `${fixture.name} ${annotation.id}`).toContain(`data-annotation="${annotation.id}"`);
        }
      }
    }
  });
});

describe("visibility is the one rule (decision 213)", () => {
  it("draws nothing of a scheme in a text view and lists every mark unresolved there", () => {
    const fixture = sn2TransitionState();
    for (const kind of TEXT_VIEW_KINDS) {
      const { scene, schemeAnnotations } = build(fixture.molecule, fixture.annotations, PUBLICATION_STYLE, representation(kind));
      expect(schemeAnnotations.unresolved).toEqual(fixture.annotations.map((a) => a.id));
      expect(scene.primitives.filter((p) => p.source.kind === "annotation")).toEqual([]);
    }
  });

  it("draws species marks on a turned planar panel and keeps a free label, which names the model frame, off it", () => {
    const fixture = methaneCombustion();
    const label = mark(9, { kind: "text", text: "Scheme 1", at: { x: 6, y: -1.5 } });
    const annotations = [...fixture.annotations, label];
    const view: PlanarView = { kind: "planar", template: "wedgeDash", frame: {}, params: { rotationDeg: 90, mirror: false } };
    const result = project(fixture.molecule, stereoConfig(fixture.molecule), view);
    if (result.kind !== "available") throw new Error(JSON.stringify(result));
    const turned = build(fixture.molecule, annotations, PUBLICATION_STYLE, skeletal, { layout: result.layout });
    expect(turned.schemeAnnotations.unresolved).toEqual(["ann_9"]);
    expect(turned.schemeAnnotations.straightArrows[0]!.axis).toBe("vertical");
    const plain = build(fixture.molecule, annotations);
    expect(plain.schemeAnnotations.unresolved).toEqual([]);
    const text = byId<TextRunPrimitive>(plain.scene.primitives, "annotation:ann_9:text");
    expect(textOf(text)).toBe("Scheme 1");
    expect(text.anchor).toBe("middle");
  });
});
