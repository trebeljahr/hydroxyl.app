/**
 * The document -> renderer translation, which is lossy on purpose.
 *
 * @starter/shared and @starter/chem-render both export a type called
 * `Representation` and they are not the same type — the document's is the
 * persisted truth (flags stored for every panel, whatever its kind), the
 * renderer's is a discriminated union that makes "lone pairs on a sum formula"
 * unrepresentable. The tests below pin the three things that go wrong when
 * someone tidies the seam away: a flag that stops carrying across, a text kind
 * that grows a flags bag, and a stale panel id that throws instead of falling
 * back.
 */

import { benzene } from "@starter/chem-core";
import {
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  cyanideAdditionToAcetone,
  isStructural,
} from "@starter/chem-render";
import {
  DISPLAY_FLAG_KEYS,
  createDocument,
  createPanel,
  defaultRepresentation,
} from "@starter/shared";
import type {
  DisplayFlagKey,
  Panel,
  Representation,
  SketchDocument,
} from "@starter/shared";
import { describe, expect, it } from "vitest";

import { fixtureDocument } from "./fixture";
import {
  buildDocumentScene,
  canvasAnnotatedScene,
  renderStyleFor,
  toRenderRepresentation,
} from "./scene-bridge";

/** A stored representation with every display switch turned on, so a flag that
 *  fails to carry across reads as `false` rather than as "the default was
 *  already right". Built from `DISPLAY_FLAG_KEYS` so a flag added to
 *  chem-render is covered here the moment it exists. */
function allDisplayOn(kind: Representation["kind"]): Representation {
  const display = {} as { -readonly [K in DisplayFlagKey]: boolean };
  for (const key of DISPLAY_FLAG_KEYS) display[key] = true;
  return { kind, display };
}

/** The mirror image: everything off. */
function allDisplayOff(kind: Representation["kind"]): Representation {
  const display = {} as { -readonly [K in DisplayFlagKey]: boolean };
  for (const key of DISPLAY_FLAG_KEYS) display[key] = false;
  return { kind, display };
}

function docWithPanels(panels: readonly Panel[]): SketchDocument {
  return createDocument({
    molecule: benzene(),
    panels,
    now: "2024-01-01T00:00:00.000Z",
  });
}

describe("renderStyleFor", () => {
  it("resolves the document's preset to the frozen render style object", () => {
    // Identity, not deep equality: `buildScene` and the editor both compare
    // styles by reference to decide whether a scene needs rebuilding.
    // The fixture opens in Publication, as every new document does (decision
    // 135); Screen is the preset a user switches to.
    expect(renderStyleFor(fixtureDocument("2024-01-01T00:00:00.000Z"))).toBe(
      PUBLICATION_STYLE,
    );
    const screen = createDocument({
      molecule: benzene(),
      stylePreset: "screen",
      now: "2024-01-01T00:00:00.000Z",
    });
    expect(renderStyleFor(screen)).toBe(SCREEN_STYLE);
  });
});

describe("toRenderRepresentation", () => {
  it("carries showCarbonLabels and showLonePairs across for a structural kind", () => {
    const rendered = toRenderRepresentation(allDisplayOn("skeletal"));
    expect(rendered.kind).toBe("skeletal");
    if (!isStructural(rendered)) throw new Error("skeletal must be structural");
    expect(rendered.flags.showCarbonLabels).toBe(true);
    expect(rendered.flags.showLonePairs).toBe(true);
  });

  it("carries a switched-off flag across too, overriding the kind's default", () => {
    // Lewis defaults to lone pairs on — that is what makes it a Lewis
    // structure — so a document that stored them off is the case where a
    // "just take the kind's defaults" shortcut silently wins.
    const rendered = toRenderRepresentation(allDisplayOff("lewis"));
    if (!isStructural(rendered)) throw new Error("lewis must be structural");
    expect(rendered.flags.showLonePairs).toBe(false);
    expect(rendered.flags.showCarbonLabels).toBe(false);
    // Lewis's own default is already `false` here, so it proves nothing on its
    // own — what it does prove is that a stored `false` is not read as
    // "unset". The four flags below are the ones decision 10 made
    // persistable, and each defaults to a value the document overrode.
    expect(rendered.flags.showStereoBonds).toBe(false);
    expect(rendered.flags.showCharges).toBe(false);
    expect(rendered.flags.showImplicitHydrogens).toBe(false);
  });

  it("gives a text kind no flags at all, however many the document stored", () => {
    const rendered = toRenderRepresentation(allDisplayOn("sumFormula"));
    expect(rendered.kind).toBe("sumFormula");
    expect(isStructural(rendered)).toBe(false);
    // Not `.flags === undefined`: the key must be ABSENT. A present-but-
    // undefined flags bag is exactly the dead state the union removes.
    expect(Object.hasOwn(rendered, "flags")).toBe(false);
    expect(Object.keys(rendered)).toEqual(["kind"]);
  });

  it("carries every one of the document's display fields across", () => {
    // Since decision 10 the document stores chem-render's own flag set, so
    // this is a pass-through and the sorted key list below is what proves it:
    // a renderer flag with no persisted home is a toggle a user can set and
    // cannot save, and a document field with no renderer counterpart is a
    // toggle that lights up and does nothing.
    const rendered = toRenderRepresentation(allDisplayOn("kekule"));
    if (!isStructural(rendered)) throw new Error("kekule must be structural");
    expect(rendered.flags.aromaticCircles).toBe(true);
    expect(rendered.flags.showStereoDescriptors).toBe(true);
    expect(Object.keys(rendered.flags).sort()).toEqual([
      "aromaticCircles",
      "showCarbonLabels",
      "showCharges",
      "showImplicitHydrogens",
      "showLocants",
      "showLonePairs",
      "showStereoBonds",
      "showStereoDescriptors",
    ]);
  });
});

describe("the document's curly arrows", () => {
  const mechanism = cyanideAdditionToAcetone();
  const doc = createDocument({
    molecule: mechanism.molecule,
    annotations: mechanism.annotations,
    panels: [createPanel("skeletal"), createPanel("sumFormula")],
    now: "2024-01-01T00:00:00.000Z",
  });
  const arrowIds = (primitives: readonly { readonly id: string }[]): string[] =>
    primitives.map((p) => p.id).filter((id) => id.startsWith("annotation:"));

  it("are drawn on the canvas, shaft and head, from the stored annotations", () => {
    const built = canvasAnnotatedScene(doc, null);
    expect(arrowIds(built.scene.primitives)).toEqual([
      "annotation:ann_1:shaft",
      "annotation:ann_1:head",
      "annotation:ann_2:shaft",
      "annotation:ann_2:head",
    ]);
    expect(built.schemeAnnotations.curlyArrows.map((a) => a.annotationId)).toEqual(["ann_1", "ann_2"]);
    expect(arrowIds(buildDocumentScene(doc).primitives)).toHaveLength(4);
  });

  it("drop out of a panel that places no atom for them", () => {
    const text = doc.panels[1]!;
    expect(arrowIds(buildDocumentScene(doc, text.id).primitives)).toEqual([]);
  });
});

describe("buildDocumentScene", () => {
  it("draws the named panel", () => {
    const structural = createPanel("skeletal");
    const text = createPanel("sumFormula");
    const doc = docWithPanels([structural, text]);

    expect(buildDocumentScene(doc, text.id).representation.kind).toBe(
      "sumFormula",
    );
    expect(buildDocumentScene(doc, structural.id).representation.kind).toBe(
      "skeletal",
    );
  });

  it("prefers the first STRUCTURAL panel when none is named", () => {
    // `DEFAULT_PANELS` opens skeletal first and sum-formula second, but a
    // document is free to store them the other way round — and the editor
    // canvas is for drawing structures, so "C6H6" with nothing to click is the
    // wrong default even when it is the first panel.
    const doc = docWithPanels([createPanel("sumFormula"), createPanel("lewis")]);
    expect(buildDocumentScene(doc).representation.kind).toBe("lewis");
  });

  it("falls back rather than throwing for a panel id that names nothing", () => {
    // A stale panel id is an ordinary UI race — an undo or a panel removal
    // landing a frame before the canvas re-renders — not a corrupt document.
    const doc = fixtureDocument("2024-01-01T00:00:00.000Z");
    const scene = buildDocumentScene(doc, "panel-that-was-removed");
    expect(scene.representation.kind).toBe("skeletal");
    expect(scene.primitives).toHaveLength(13);
  });

  it("draws a skeletal molecule for a document with no panels at all", () => {
    // `sketchDocumentSchema` permits an empty panel array, and the molecule is
    // still worth drawing.
    const doc = docWithPanels([]);
    const scene = buildDocumentScene(doc);
    expect(scene.representation.kind).toBe("skeletal");
    expect(scene.primitives.filter((p) => p.type === "line")).toHaveLength(6);
  });

  it("draws benzene through the document's own style preset", () => {
    const doc = fixtureDocument("2024-01-01T00:00:00.000Z");
    const scene = buildDocumentScene(doc);
    // Six ring bonds as six lines, one inscribed circle and six placeholder
    // dots. Skeletal defaults to the circle, which SUPPRESSES the Kekulé
    // alternation's second lines rather than being drawn over them — and the
    // circle names itself by its atom set, because a ring has no id of its own
    // in chem-core and an index into `rings()` is exactly the counter the
    // determinism rule forbids.
    expect(scene.style).toBe(PUBLICATION_STYLE);
    expect(scene.primitives.map((p) => p.id)).toEqual([
      "bond:b7:line",
      "bond:b8:line",
      "bond:b9:line",
      "bond:b10:line",
      "bond:b11:line",
      "bond:b12:line",
      "ring:a1+a2+a3+a4+a5+a6:aromaticCircle",
      "atom:a1:dot",
      "atom:a2:dot",
      "atom:a3:dot",
      "atom:a4:dot",
      "atom:a5:dot",
      "atom:a6:dot",
    ]);
  });

  it("passes the representation through, rather than flattening it to one view", () => {
    // The structural kinds used to be interchangeable here, because labels,
    // trimming, second lines and stereo were all unimplemented and every kind
    // produced six lines and six dots.
    //
    // What is actually under test is the BRIDGE: that the panel's chosen
    // representation reaches `buildScene` intact. A view that quietly
    // substituted one kind for another would pass the old assertion and fail
    // this one.
    const idsFor = (kind: "skeletal" | "kekule" | "explicitH" | "lewis") => {
      const doc = docWithPanels([
        { id: `panel-${kind}`, representation: defaultRepresentation(kind) },
      ]);
      return buildDocumentScene(doc).primitives.map((p) => p.id);
    };

    const labelled = (kind: "skeletal" | "kekule" | "explicitH" | "lewis") =>
      idsFor(kind).filter((id) => id.endsWith(":label")).length;

    // THE DIVERGENCE THIS TEST USED TO PIN IS RESOLVED (decisions 10 and 11).
    // `defaultRepresentation` no longer holds an opinion of its own: it reads
    // chem-render's per-kind table, so there is one answer to "what does
    // Kekulé mean" rather than two that disagreed. Kekulé means alternating
    // bonds and BARE carbons, so it labels nothing — and what tells it apart
    // from skeletal is that skeletal now takes the aromatic circle.
    expect(labelled("skeletal")).toBe(0);
    expect(labelled("kekule")).toBe(0);
    // Twelve, not six: explicitH labels every carbon AND draws every hydrogen
    // as its own vertex, each with a glyph of its own.
    expect(labelled("explicitH")).toBe(12);
    expect(labelled("lewis")).toBe(12);

    // And the two views that used to render identically no longer do.
    expect(idsFor("kekule")).not.toEqual(idsFor("skeletal"));
    expect(idsFor("skeletal")).toContain("ring:a1+a2+a3+a4+a5+a6:aromaticCircle");
    expect(idsFor("kekule")).toContain("bond:b8:line2");

    // The bridge's own job, which is what this test is really for: the panel's
    // representation reaches `buildScene` intact rather than being flattened.
    expect(idsFor("explicitH")).not.toEqual(idsFor("skeletal"));
  });
});
