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
  isStructural,
} from "@starter/chem-render";
import { createDocument, createPanel, defaultRepresentation } from "@starter/shared";
import type { Panel, Representation, SketchDocument } from "@starter/shared";
import { describe, expect, it } from "vitest";

import { fixtureDocument } from "./fixture";
import {
  buildDocumentScene,
  renderStyleFor,
  toRenderRepresentation,
} from "./scene-bridge";

/** A stored representation with every display switch turned on, so a flag that
 *  fails to carry across reads as `false` rather than as "the default was
 *  already right". */
function allDisplayOn(kind: Representation["kind"]): Representation {
  return {
    kind,
    display: {
      showCarbonLabels: true,
      aromaticCircles: true,
      showLonePairs: true,
      showStereoDescriptors: true,
    },
  };
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
    expect(renderStyleFor(fixtureDocument("2024-01-01T00:00:00.000Z"))).toBe(
      SCREEN_STYLE,
    );
    const publication = createDocument({
      molecule: benzene(),
      stylePreset: "publication",
      now: "2024-01-01T00:00:00.000Z",
    });
    expect(renderStyleFor(publication)).toBe(PUBLICATION_STYLE);
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
    const stored: Representation = {
      kind: "lewis",
      display: {
        showCarbonLabels: false,
        aromaticCircles: false,
        showLonePairs: false,
        showStereoDescriptors: false,
      },
    };
    const rendered = toRenderRepresentation(stored);
    if (!isStructural(rendered)) throw new Error("lewis must be structural");
    expect(rendered.flags.showLonePairs).toBe(false);
    expect(rendered.flags.showCarbonLabels).toBe(false);
    // Untouched by the document: it comes from chem-render's own per-kind
    // defaults, and lewis deliberately makes no 3D claim.
    expect(rendered.flags.showStereoBonds).toBe(false);
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

  it("drops aromaticCircles and showStereoDescriptors, which have no counterpart", () => {
    // A truthful "not implemented yet" rather than a wrong picture. When a
    // later pass grows them this test is the one that has to change.
    const rendered = toRenderRepresentation(allDisplayOn("kekule"));
    if (!isStructural(rendered)) throw new Error("kekule must be structural");
    expect(Object.keys(rendered.flags).sort()).toEqual([
      "showAtomIndices",
      "showCarbonLabels",
      "showCharges",
      "showImplicitHydrogens",
      "showLonePairs",
      "showStereoBonds",
    ]);
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
    expect(scene.primitives).toHaveLength(12);
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
    // Six ring bonds as six plain lines and six placeholder dots: benzene is
    // an explicit Kekule ring, and the second line of a double bond is a later
    // rendering pass. Nothing in the canvas compensates for that.
    expect(scene.style).toBe(SCREEN_STYLE);
    expect(scene.primitives.map((p) => p.id)).toEqual([
      "bond:b7:line",
      "bond:b8:line",
      "bond:b9:line",
      "bond:b10:line",
      "bond:b11:line",
      "bond:b12:line",
      "atom:a1:dot",
      "atom:a2:dot",
      "atom:a3:dot",
      "atom:a4:dot",
      "atom:a5:dot",
      "atom:a6:dot",
    ]);
  });

  it("renders every structural kind identically today, and does not pretend otherwise", () => {
    // skeletal / kekule / explicitH / lewis all produce six lines and six dots
    // because labels, trimming, second lines and stereo are unimplemented. A
    // view that quietly compensated for that would have to be un-compensated
    // when the real passes land.
    const kinds = ["skeletal", "kekule", "explicitH", "lewis"] as const;
    const shapes = kinds.map((kind) => {
      const doc = docWithPanels([
        { id: `panel-${kind}`, representation: defaultRepresentation(kind) },
      ]);
      return buildDocumentScene(doc).primitives.map((p) => p.id);
    });
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
  });
});
