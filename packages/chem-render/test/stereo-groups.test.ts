/**
 * Enhanced stereochemistry on a figure: decision 40's per-centre tags and
 * decision 88's rac-/rel- prefix.
 *
 * THE FIRST TEST IS THE ACCEPTANCE TEST. Decision 71 settles the annotation
 * geometry, and the 55 committed goldens are what that settlement is written
 * in: a molecule with no stereo groups has to ask the placement pass for
 * exactly what it asked before, so every golden stays byte-identical. The
 * goldens themselves catch a moved glyph; the sweep below catches the cause,
 * which is a request that should not have been made.
 *
 * Fixtures are real compounds, so a failure reads as a chemistry error. The
 * groups are attached with `withStereoGroups`, never by hand: it is the one
 * validator, and a hand-built list could hold an atom that is in two
 * collections at once — which the figure's single-valued tag depends on being
 * impossible.
 */

import { describe, expect, it } from "vitest";

import {
  ABS_STEREO_GROUP_INDEX,
  buildMolecule,
  flipAtoms,
  horizontalMirror,
  ORIGIN,
  stereoGroupCoverage,
  withStereoGroups,
} from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import {
  annotationFontSizePx,
  placeAnnotations,
  structureInkBounds,
  structurePrefixRequest,
} from "../src/label/annotations.js";
import type {
  AnnotationContext,
  AnnotationLayout,
  AnnotationPlacement,
  AnnotationRequest,
} from "../src/label/annotations.js";
import type { LabelBox } from "../src/label/placement.js";
import { butan2olWedged, FIXTURES } from "../src/fixtures.js";
import { representation } from "../src/representation.js";
import { annotationLayout, annotationObstacles, buildAnnotatedScene } from "../src/scene/build.js";
import type { CirclePrimitive, RenderScene, TextRunPrimitive } from "../src/scene/types.js";
import { PUBLICATION_STYLE, SCREEN_STYLE } from "../src/style.js";
import type { RenderStyle } from "../src/style.js";
import { serializeScene } from "../src/svg/serialize.js";

const STYLES: readonly RenderStyle[] = Object.freeze([PUBLICATION_STYLE, SCREEN_STYLE]);
const DESCRIPTORS = representation("skeletal", { showStereoDescriptors: true });
const PLAIN = representation("skeletal");

/** C2 of (R)-butan-2-ol as `butan2olWedged` builds it: the wedge's narrow end. */
const BUTANOL_C2 = "a2" as AtomId;

/**
 * Threo/erythro 3-chlorobutan-2-ol, `CC(O)C(C)Cl`, drawn as a zig-zag with the
 * hydroxyl wedged and the chlorine hashed.
 *
 * TWO ADJACENT STEREOCENTRES, which is the smallest structure where a racemate
 * (one AND group over both) and a mixture of diastereomers (two AND groups, one
 * each) are different compounds. Only that distinction can tell decision 40's
 * prefix from its per-centre tags apart, so `butan2olWedged` — one centre, where
 * any AND group covers everything — cannot stand in for it.
 *
 * Local rather than added to `FIXTURES`: that list drives the goldens and the
 * contact sheet, and this molecule says nothing about a bond or a label that
 * butan-2-ol does not.
 */
function chlorobutanol(): {
  readonly mol: Molecule;
  readonly c2: AtomId;
  readonly c3: AtomId;
} {
  let c2: AtomId = "";
  let c3: AtomId = "";
  const mol = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    c2 = b.atom("C", { x: 0.866, y: 0.5 });
    const o = b.atom("O", { x: 0.866, y: 1.5 });
    c3 = b.atom("C", { x: 1.732, y: 0 });
    const c4 = b.atom("C", { x: 2.598, y: 0.5 });
    const cl = b.atom("Cl", { x: 1.732, y: -1 });
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
    b.bond(c3, cl, 1, "hash");
  });
  return { mol, c2, c3 };
}

function placementsOfKind(
  layout: AnnotationLayout,
  kind: AnnotationPlacement["kind"],
): readonly AnnotationPlacement[] {
  return layout.placements.filter((placed) => placed.kind === kind);
}

function annotationRuns(scene: RenderScene, suffix: string): readonly TextRunPrimitive[] {
  return scene.primitives.filter(
    (primitive): primitive is TextRunPrimitive =>
      primitive.type === "textRun" && primitive.id.endsWith(suffix),
  );
}

// ---------------------------------------------------------------------------
// T9: a molecule with no groups asks for nothing new
// ---------------------------------------------------------------------------

describe("decision 71: a molecule with no stereo groups asks for nothing new", () => {
  it("makes ZERO stereoGroup and stereoPrefix requests, over every fixture", () => {
    // Descriptors on, at one preset. Both new kinds are gated on that flag, and
    // the request set is a function of the molecule and the flags and not of
    // the style — so a second preset, or the locants on top, would re-run the
    // ladder to re-derive the same empty list.
    for (const fixture of FIXTURES) {
      expect(fixture.molecule.stereoGroups).toBeUndefined();
      const layout = annotationLayout(fixture.molecule, PUBLICATION_STYLE, DESCRIPTORS);
      const added = layout.placements.filter(
        (placed) => placed.kind === "stereoGroup" || placed.kind === "stereoPrefix",
      );
      expect(added.map((placed) => placed.id), fixture.name).toEqual([]);
    }
  });

  it("draws the same bytes with the groups cleared again as it did before they existed", () => {
    // The strongest form available in one process: the SVG of a molecule with no
    // groups, the SVG once a group is on it, and the SVG after the group is
    // cleared. The first and third must be byte-identical and the second must
    // not, or "no groups costs nothing" is passing for the wrong reason.
    const plain = butan2olWedged();
    const grouped = withStereoGroups(plain, [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [BUTANOL_C2] },
    ]);
    const cleared = withStereoGroups(grouped, []);
    // Screen, because at Publication this fixture's own "(R)" is already
    // crowded and the tag beside it is dropped (decision 58) — so the grouped
    // SVG would equal the plain one for the wrong reason and the second
    // assertion would prove nothing.
    const svg = (mol: Molecule): string =>
      serializeScene(buildAnnotatedScene(mol, SCREEN_STYLE, DESCRIPTORS).scene);
    expect(svg(cleared)).toBe(svg(plain));
    expect(svg(grouped)).not.toBe(svg(plain));
  });
});

// ---------------------------------------------------------------------------
// Decision 40: the per-centre tag
// ---------------------------------------------------------------------------

describe("decision 40: a grouped centre carries its collection's tag", () => {
  it("asks for one tag per grouped centre, named after its collection", () => {
    const mol = withStereoGroups(butan2olWedged(), [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [BUTANOL_C2] },
    ]);
    for (const style of STYLES) {
      const tags = placementsOfKind(annotationLayout(mol, style, DESCRIPTORS), "stereoGroup");
      expect(tags).toHaveLength(1);
      expect(tags[0]!.text).toBe("abs");
      expect(tags[0]!.source).toEqual({ kind: "atom", atomId: BUTANOL_C2 });
      expect(tags[0]!.id).toBe(`atom:${BUTANOL_C2}:stereoGroup`);
      // An abs group is an assertion, not a prefix: decision 40 gives rac-/rel-
      // to AND and OR only.
      expect(placementsOfKind(annotationLayout(mol, style, DESCRIPTORS), "stereoPrefix")).toEqual([]);
    }
  });

  it("places and draws the tag where the centre has room for it", () => {
    // SCREEN, where butan-2-ol's C2 has room for the letter AND the tag.
    // Publication is asserted separately, in decision 93's block: it needed the
    // tag's own smaller scale before the tag was drawn there at all.
    const mol = withStereoGroups(butan2olWedged(), [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [BUTANOL_C2] },
    ]);
    const { scene, annotations } = buildAnnotatedScene(mol, SCREEN_STYLE, DESCRIPTORS);
    const tag = placementsOfKind(annotations, "stereoGroup")[0]!;
    expect(tag.clear).toBe(true);
    expect(tag.drawn).toBe(true);
    expect(annotations.unplaced).toEqual([]);
    const runs = annotationRuns(scene, ":stereoGroup");
    expect(runs.map((run) => run.id)).toEqual([`atom:${BUTANOL_C2}:stereoGroup`]);
    expect(runs[0]!.spans).toEqual([{ text: "abs" }]);
    // It belongs to its atom, so a click on it picks that atom — the same as
    // for the "(R)" beside it.
    expect(runs[0]!.source).toEqual({ kind: "atom", atomId: BUTANOL_C2 });
    // And it is a second run, not a replacement: the letter is still there.
    expect(annotationRuns(scene, ":descriptor")).toHaveLength(1);
  });

  it("prints the STORED index, not a position in the group list (decision 92)", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // Two AND groups, numbered 3 and 7: a mixture of diastereomers, and a
    // numbering with a gap, which a V3000 file is entitled to contain. Tags
    // derived from the array position would read and1/and2.
    const mixture = withStereoGroups(mol, [
      { kind: "and", index: 7, atomIds: [c3] },
      { kind: "and", index: 3, atomIds: [c2] },
    ]);
    const layout = annotationLayout(mixture, PUBLICATION_STYLE, DESCRIPTORS);
    const byAtom = new Map(
      placementsOfKind(layout, "stereoGroup").map((placed) => [
        placed.source.kind === "atom" ? placed.source.atomId : "",
        placed.text,
      ]),
    );
    expect(byAtom.get(c2)).toBe("and3");
    expect(byAtom.get(c3)).toBe("and7");
  });

  it("tags an or group, and tags only the centres the group names", () => {
    const { mol, c2 } = chlorobutanol();
    // One OR group over ONE of the two centres: the other centre is absolutely
    // configured and gets no tag, and no prefix applies to the molecule.
    const half = withStereoGroups(mol, [{ kind: "or", index: 2, atomIds: [c2] }]);
    const layout = annotationLayout(half, PUBLICATION_STYLE, DESCRIPTORS);
    const tags = placementsOfKind(layout, "stereoGroup");
    expect(tags.map((placed) => placed.text)).toEqual(["or2"]);
    expect(placementsOfKind(layout, "stereoPrefix")).toEqual([]);
  });

  it("tags a group whose atoms this build reads as no stereocentre at all (T14)", () => {
    const mol = withStereoGroups(butan2olWedged(), [
      // a1 is the terminal methyl. chem-core reports the coverage as
      // `unresolved`; the figure must still say the collection is there rather
      // than drop it and read as a molecule nobody said anything about.
      { kind: "and", index: 1, atomIds: ["a1" as AtomId] },
    ]);
    const layout = annotationLayout(mol, PUBLICATION_STYLE, DESCRIPTORS);
    expect(placementsOfKind(layout, "stereoGroup").map((p) => p.text)).toEqual(["and1"]);
    // And it must NOT read rac-: "every stereocentre is in one AND group" is
    // vacuously true here, and that is exactly the claim T14 forbids.
    expect(placementsOfKind(layout, "stereoPrefix")).toEqual([]);
  });

  it("draws nothing new while showStereoDescriptors is off", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    for (const style of STYLES) {
      const { scene, annotations } = buildAnnotatedScene(racemate, style, PLAIN);
      expect(annotations.placements).toEqual([]);
      expect(annotationRuns(scene, ":stereoGroup")).toEqual([]);
      expect(annotationRuns(scene, ":stereoPrefix")).toEqual([]);
      // The flag is the one switch a figure has for stereochemistry, so the
      // drawing is the plain one to the byte.
      expect(serializeScene(scene)).toBe(
        serializeScene(buildAnnotatedScene(mol, style, PLAIN).scene),
      );
    }
  });

  it("draws nothing new with LOCANTS on and stereo descriptors off", () => {
    // The configuration that tells a real gate from an accident of the pass's
    // early return: `annotationRequests` returns early only when the locants are
    // off TOO, so with them on the `showStereoDescriptors` guard on the coverage
    // query is the only thing keeping a tag and a prefix off a figure whose one
    // stereochemistry switch is off. Dropping that guard left every committed
    // golden byte-identical and every other assertion green.
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const locants = Object.fromEntries(mol.atomIds.map((id, i) => [id, `${i + 1}`]));
    const locantsOnly = representation("skeletal", {
      showStereoDescriptors: false,
      showLocants: true,
    });
    for (const style of STYLES) {
      const { scene, annotations } = buildAnnotatedScene(racemate, style, locantsOnly, { locants });
      // The locants really are drawn, or this proves nothing about the gate.
      expect(placementsOfKind(annotations, "locant").length).toBeGreaterThan(0);
      expect(placementsOfKind(annotations, "stereoGroup")).toEqual([]);
      expect(placementsOfKind(annotations, "stereoPrefix")).toEqual([]);
      expect(annotationRuns(scene, ":stereoGroup")).toEqual([]);
      expect(annotationRuns(scene, ":stereoPrefix")).toEqual([]);
      // And the numbered figure is the same bytes as the ungrouped molecule's.
      expect(serializeScene(scene)).toBe(
        serializeScene(buildAnnotatedScene(mol, style, locantsOnly, { locants }).scene),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Decision 93: the tag's own scale
// ---------------------------------------------------------------------------

describe("decision 93: a per-centre tag is set smaller than the letter beside it", () => {
  it("carries the measured scale on both presets, under the 8 pt floor at Publication", () => {
    expect(PUBLICATION_STYLE.stereoGroupTagScale).toBe(0.6);
    expect(SCREEN_STYLE.stereoGroupTagScale).toBe(0.7);
    // Smaller than the descriptor it stands beside, at both presets: that
    // relationship is the ruling, not the two numbers on their own.
    for (const style of STYLES) {
      expect(style.stereoGroupTagScale).toBeLessThan(style.stereoDescriptorScale);
    }
    // 50/3 px is Publication's 10 pt label (decision 26), so the tag prints at
    // exactly 6 pt — deliberately UNDER the 8 pt ACS artwork floor decision 51
    // cites, which is why decision 93 also requires the export dialog's check to
    // cover this kind and name it.
    const pt = (px: number): number => (px * 10) / (50 / 3);
    expect(pt(annotationFontSizePx("stereoGroup", PUBLICATION_STYLE))).toBeCloseTo(6, 12);
    expect(pt(annotationFontSizePx("descriptor", PUBLICATION_STYLE))).toBeCloseTo(8, 12);
  });

  it("sizes the tag kind and only the tag kind from its own scale", () => {
    // `annotationFontSizePx` is the one owner of every annotation's size, so the
    // exception has to be visible here rather than at a call site.
    for (const style of STYLES) {
      expect(annotationFontSizePx("stereoGroup", style)).toBeCloseTo(
        style.fontSizePx * style.stereoGroupTagScale,
        12,
      );
      for (const kind of ["descriptor", "stereoPrefix", "locant", "alphaBeta", "torsion"] as const) {
        expect(annotationFontSizePx(kind, style), kind).toBeCloseTo(
          style.fontSizePx * style.stereoDescriptorScale,
          12,
        );
      }
    }
  });

  it("DRAWS butan-2-ol's tag at Publication, which the descriptor scale did not", () => {
    // Decision 93's whole reason, as the measurement that produced it: with the
    // tag sized at `stereoDescriptorScale` this tag came back `drawn: false`,
    // `clear: false` in ALL FOUR views — decision 40's per-centre half invisible
    // in exactly the figures that get published. The letter beside it is
    // untouched, which is what keeps this a size change and not a priority one.
    const mol = withStereoGroups(butan2olWedged(), [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [BUTANOL_C2] },
    ]);
    for (const view of ["skeletal", "kekule", "explicitH", "lewis"] as const) {
      const rep = representation(view, { showStereoDescriptors: true });
      const { scene, annotations } = buildAnnotatedScene(mol, PUBLICATION_STYLE, rep);
      const tag = placementsOfKind(annotations, "stereoGroup")[0];
      expect(tag?.text, view).toBe("abs");
      expect(tag?.drawn, view).toBe(true);
      expect(annotationRuns(scene, ":stereoGroup").map((run) => run.id), view).toEqual([
        `atom:${BUTANOL_C2}:stereoGroup`,
      ]);
      // And it really is the smaller run in the file, not merely placed.
      expect(annotationRuns(scene, ":stereoGroup")[0]?.fontSizePx, view).toBeCloseTo(
        PUBLICATION_STYLE.fontSizePx * PUBLICATION_STYLE.stereoGroupTagScale,
        12,
      );
    }
  });

  it("leaves every other annotation on the same figure at the descriptor size", () => {
    // TWO sizes on a figure that has a group, and the tag is the smaller one.
    // The descriptor and the locant beside it must not have moved: decision 71
    // froze their geometry, and a scale change that leaked would move it.
    const mol = withStereoGroups(butan2olWedged(), [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [BUTANOL_C2] },
    ]);
    const locants = Object.fromEntries(mol.atomIds.map((id, i) => [id, `${i + 1}`]));
    const rep = representation("skeletal", { showStereoDescriptors: true, showLocants: true });
    const layout = annotationLayout(mol, SCREEN_STYLE, rep, { locants });
    const byKind = new Map(layout.placements.map((p) => [p.kind, p.fontSizePx]));
    expect(byKind.get("stereoGroup")).toBeCloseTo(
      SCREEN_STYLE.fontSizePx * SCREEN_STYLE.stereoGroupTagScale,
      12,
    );
    for (const kind of ["descriptor", "locant"] as const) {
      expect(byKind.get(kind), kind).toBeCloseTo(
        SCREEN_STYLE.fontSizePx * SCREEN_STYLE.stereoDescriptorScale,
        12,
      );
    }
    expect(new Set(layout.placements.map((p) => p.fontSizePx)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Decision 88: the molecule prefix
// ---------------------------------------------------------------------------

describe("decision 88: rac- and rel- above the structure", () => {
  it("reads rac- for one AND group over every centre, and omits the tags", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    for (const style of STYLES) {
      const { scene, annotations } = buildAnnotatedScene(racemate, style, DESCRIPTORS);
      const prefix = placementsOfKind(annotations, "stereoPrefix");
      expect(prefix).toHaveLength(1);
      expect(prefix[0]!.text).toBe("rac-");
      expect(prefix[0]!.id).toBe("structure:stereoPrefix");
      expect(prefix[0]!.source).toEqual({ kind: "structure" });
      // Decision 40: the prefix already says it about every centre.
      expect(placementsOfKind(annotations, "stereoGroup")).toEqual([]);
      const runs = annotationRuns(scene, ":stereoPrefix");
      expect(runs).toHaveLength(1);
      // It belongs to no model entity, so hit-testing leaves it alone.
      expect(runs[0]!.source).toEqual({ kind: "decoration" });
    }
  });

  it("reads rel- for one OR group over every centre", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const relative = withStereoGroups(mol, [{ kind: "or", index: 1, atomIds: [c2, c3] }]);
    const layout = annotationLayout(relative, PUBLICATION_STYLE, DESCRIPTORS);
    expect(placementsOfKind(layout, "stereoPrefix").map((p) => p.text)).toEqual(["rel-"]);
    expect(placementsOfKind(layout, "stereoGroup")).toEqual([]);
  });

  it("sits ABOVE the structure's ink, clear of it, at its horizontal middle", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    for (const style of STYLES) {
      const context = annotationObstacles(racemate, style, DESCRIPTORS)!;
      const ink = structureInkBounds(context)!;
      const layout = annotationLayout(racemate, style, DESCRIPTORS);
      const prefix = placementsOfKind(layout, "stereoPrefix")[0]!;
      expect(prefix.clear).toBe(true);
      expect(prefix.drawn).toBe(true);
      // Scene px are y-down, so "above" is a smaller y. Strictly above and
      // clear of the ink, not merely not overlapping it.
      expect(prefix.inkBox.maxY).toBeLessThan(ink.minY);
      // Offset from the ink rather than resting on it: the near ladder's first
      // rung is a fraction of a bond out (decision 67), which is what supplies
      // the gap.
      expect(ink.minY - prefix.inkBox.maxY).toBeGreaterThan(1);
      // Anchored at the middle of the ink, and the ladder's first rung is due
      // north, so the run is centred over the structure.
      const middle = (ink.minX + ink.maxX) / 2;
      const inkCentreX = (prefix.inkBox.minX + prefix.inkBox.maxX) / 2;
      expect(Math.abs(inkCentreX - middle)).toBeLessThan(style.fontSizePx);
    }
  });

  it("unions the bare-vertex dots into the ink box", () => {
    // The unit half: decision 61 keeps those dots out of `glyphInk`, so they
    // reach the box through their own list or not at all.
    const context = annotationObstacles(butan2olWedged(), PUBLICATION_STYLE, DESCRIPTORS)!;
    const withoutDots = structureInkBounds(context)!;
    const withDots = structureInkBounds({
      ...context,
      dots: [{ centre: { x: 0, y: -1000 }, radius: 3 }],
    })!;
    expect(withoutDots.minY).toBeGreaterThan(-1000);
    expect(withDots.minY).toBe(-1003);
  });

  it("clears a bare-vertex DOT that is the highest ink on the page", () => {
    // The end-to-end half, and the one that catches a builder that forgot to
    // hand the dots over: a skeletal drawing's topmost ink is often a dot and
    // not a glyph — benzene draws six of them and not one letter — so a prefix
    // measured off the glyphs alone would be set on top of it.
    //
    // (R)-butan-2-ol flipped top-to-bottom: the hydroxyl and the lettered C2
    // hang below, and the two highest things on the page are the bare vertices
    // C1 and C3.
    const flipped = flipAtoms(butan2olWedged(), butan2olWedged().atomIds, horizontalMirror(ORIGIN));
    // One centre in one AND group is a racemate, so this molecule earns a
    // prefix and the whole path is exercised.
    const mol = withStereoGroups(flipped, [
      { kind: "and", index: 1, atomIds: [BUTANOL_C2] },
    ]);
    for (const style of STYLES) {
      const { scene, annotations } = buildAnnotatedScene(mol, style, DESCRIPTORS);
      const context = annotationObstacles(mol, style, DESCRIPTORS)!;
      const dots = scene.primitives.filter(
        (primitive): primitive is CirclePrimitive => primitive.type === "circle",
      );
      expect(dots.length).toBeGreaterThan(0);
      const dotTop = Math.min(...dots.map((dot) => dot.centre.y - dot.radius));
      const glyphTop = Math.min(...(context.glyphInk ?? []).map((box) => box.minY));
      // The dot really is above every glyph, or the fixture proves nothing.
      expect(dotTop).toBeLessThan(glyphTop);
      const prefix = placementsOfKind(annotations, "stereoPrefix")[0]!;
      expect(prefix.text).toBe("rac-");
      expect(prefix.drawn).toBe(true);
      // The claim: the prefix clears the DOT, not merely the glyphs. A builder
      // that left the dots out of the ink box would put it below this line.
      expect(prefix.inkBox.maxY).toBeLessThan(dotTop);
    }
  });

  it("is judged against the WHOLE structure: no atom competes with it", () => {
    // Decision 88's third own case. The prefix's slot is far from every atom —
    // it is above the whole drawing — so an own-atom rule would refuse every
    // candidate and the prefix would always report as crowded.
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const layout = annotationLayout(racemate, PUBLICATION_STYLE, DESCRIPTORS);
    expect(layout.unplaced.filter((u) => u.kind === "stereoPrefix")).toEqual([]);
    // And the ink box really is what it is measured to: zero inside the box.
    const context = annotationObstacles(racemate, PUBLICATION_STYLE, DESCRIPTORS)!;
    const ink = structureInkBounds(context)!;
    const request = structurePrefixRequest("rac-", ink);
    expect(request.anchorBox).toEqual(ink);
    expect(request.anchor).toEqual({ x: (ink.minX + ink.maxX) / 2, y: ink.minY });
    expect(request.preferred).toEqual({ x: 0, y: -1 });
  });

  it("is reported and NOT drawn when the only slots left print on text", () => {
    // Every slot walled off and the whole plane covered in glyph ink: the
    // fallback lands on a letter, so decision 58 leaves it out of the drawing
    // and the report says so. A real molecule cannot be crowded like this —
    // the space above a structure is empty page — which is why the case is
    // built rather than found.
    const far = 1e4;
    const plane: LabelBox = { minX: -far, minY: -far, maxX: far, maxY: far };
    const context: AnnotationContext = {
      style: PUBLICATION_STYLE,
      obstacles: [{ kind: "rect", box: plane }],
      segments: [],
      glyphInk: [plane],
    };
    const ink: LabelBox = { minX: -20, minY: -10, maxX: 20, maxY: 10 };
    const request: AnnotationRequest = structurePrefixRequest("rac-", ink);
    const layout = placeAnnotations([request], context);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0]!.clear).toBe(false);
    expect(layout.placements[0]!.drawn).toBe(false);
    expect(layout.unplaced).toHaveLength(1);
    expect(layout.unplaced[0]!.dropped).toBe(true);
    expect(layout.unplaced[0]!.reason).toBe("printsOnText");
    expect(layout.unplaced[0]!.id).toBe("structure:stereoPrefix");
    expect(layout.unplaced[0]!.source).toEqual({ kind: "structure" });
  });

  it("still tags a SECOND collection the prefix does not speak for", () => {
    // The one case where the figure and the file disagreed about how many
    // statements exist. `and1` over both centres earns `rac-`; `or1` over C1, a
    // methyl this build reads as no centre at all, does not disturb that — so
    // coverage is `whole` and suppressing every tag drew a figure saying ONE
    // thing while the file carried both `MDLV30/STERAC1` and `MDLV30/STEREL1`.
    // Decision 40's "the tags are then omitted" is about the centres the prefix
    // covers, and T14 says a collection resolving to no centre must stay visible.
    const { mol, c2, c3 } = chlorobutanol();
    const both = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2, c3] },
      { kind: "or", index: 1, atomIds: ["a1" as AtomId] },
    ]);
    for (const style of STYLES) {
      const layout = annotationLayout(both, style, DESCRIPTORS);
      expect(placementsOfKind(layout, "stereoPrefix").map((p) => p.text)).toEqual(["rac-"]);
      // Exactly one tag, on the atom the prefix says nothing about.
      const tags = placementsOfKind(layout, "stereoGroup");
      expect(tags.map((p) => p.text)).toEqual(["or1"]);
      expect(tags[0]!.source).toEqual({ kind: "atom", atomId: "a1" });
    }
    // And the covered centres still lose their tags to the prefix, including a
    // non-centre inside the prefix's OWN group — the prefix names that group, so
    // repeating its tag would say it twice.
    const padded = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2, c3, "a1" as AtomId] },
    ]);
    const paddedLayout = annotationLayout(padded, PUBLICATION_STYLE, DESCRIPTORS);
    expect(placementsOfKind(paddedLayout, "stereoPrefix").map((p) => p.text)).toEqual(["rac-"]);
    expect(placementsOfKind(paddedLayout, "stereoGroup")).toEqual([]);
  });

  it("tells two AND collections apart by their stored INDEX, not by kind", () => {
    // The same case as above with the second collection changed from `or1` to
    // `and2`, which is what a real racemate import looks like: kind alone no
    // longer separates the two, so only the stored index (decision 92) can say
    // which group the prefix speaks for.
    //
    // Reachable exactly as the `or1` case is — a V3000 file carrying
    // `MDLV30/STERAC1 ATOMS=(2 2 4)` and `MDLV30/STERAC2 ATOMS=(1 1)` — and
    // without this the figure prints `rac-` alone while the file holds TWO
    // statements, which is the one disagreement decision 97 exists to forbid.
    const { mol, c2, c3 } = chlorobutanol();
    const twoAnd = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2, c3] },
      { kind: "and", index: 2, atomIds: ["a1" as AtomId] },
    ]);
    // The prefix really does come from `and1`, so the tag below is the one it
    // does NOT speak for rather than an accident of ordering.
    expect(stereoGroupCoverage(twoAnd)).toMatchObject({
      kind: "whole",
      prefix: "rac-",
      group: { kind: "and", index: 1 },
    });
    for (const style of STYLES) {
      const layout = annotationLayout(twoAnd, style, DESCRIPTORS);
      expect(placementsOfKind(layout, "stereoPrefix").map((p) => p.text)).toEqual(["rac-"]);
      const tags = placementsOfKind(layout, "stereoGroup");
      expect(tags.map((p) => p.text), style.name).toEqual(["and2"]);
      expect(tags[0]!.source).toEqual({ kind: "atom", atomId: "a1" });
    }
  });

  it("loses to the letter and to the tag when they contest one slot", () => {
    // Decision 17's band order, at the only place it can be seen: all three
    // want the same free slot. The letter takes it, then the tag, then the
    // prefix — an "(R)" pushed aside by a "rac-" would be the wrong trade.
    const context: AnnotationContext = {
      style: PUBLICATION_STYLE,
      obstacles: [],
      segments: [],
    };
    // One anchor, one text, one preferred direction, so the three really are
    // after the same slot and only the priority table separates them.
    const shared = {
      text: "XY",
      anchor: { x: 0, y: 0 },
      preferred: { x: 0, y: -1 },
    } as const;
    const atom = { kind: "atom", atomId: "a1" as AtomId } as const;
    const layout = placeAnnotations(
      [
        { kind: "stereoPrefix", source: { kind: "structure" }, ...shared },
        { kind: "stereoGroup", source: atom, ...shared },
        { kind: "descriptor", source: atom, ...shared },
      ],
      context,
    );
    expect(layout.placements.map((p) => p.kind)).toEqual([
      "descriptor",
      "stereoGroup",
      "stereoPrefix",
    ]);
    // Three distinct slots, in ladder order: nothing is drawn on anything.
    const origins = layout.placements.map((p) => `${String(p.origin.x)},${String(p.origin.y)}`);
    expect(new Set(origins).size).toBe(3);
    expect(layout.unplaced).toEqual([]);
  });
});
