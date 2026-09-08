/**
 * THE ACCEPTANCE CRITERION: nothing the overlay draws can reach an export.
 *
 * The overlay is a React-only sibling of the scene layer, built from the
 * `SceneIndex` rather than pushed into `scene.primitives`. The cheap-looking
 * alternative — append a highlight primitive and filter it back out at export
 * time — puts the correctness of every export path on remembering to filter,
 * and the failure mode is a blue hover ring baked into a manuscript figure.
 *
 * So the test renders the overlay with a hover AND a selection live, then
 * serialises the VERY SAME scene object and asserts the string contains none
 * of it — not the markers, not the colours, not one extra element.
 *
 * The second half of the file guards the attribute scheme. `[data-atom-id]`
 * and `[data-bond-id]` count DRAWN MODEL ENTITIES; an overlay element wearing
 * one would turn "benzene renders six atoms" into an assertion about what
 * happened to be hovered when the page was inspected.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import {
  SCREEN_STYLE,
  buildScene,
  representation,
  serializeScene,
} from "@starter/chem-render";
import type { RenderScene } from "@starter/chem-render";

import { EMPTY_SELECTION } from "@/state";
import type { Selection } from "@/state";

import { createSceneIndex } from "./metrics";
import { OverlayLayer } from "./OverlayLayer";
import type { OverlayLayerProps } from "./OverlayLayer";
import { SceneLayer } from "./SceneLayer";

const MOL = benzene();
const SCENE: RenderScene = buildScene(
  MOL,
  SCREEN_STYLE,
  representation("skeletal"),
);
const INDEX = createSceneIndex(SCENE, MOL);

const SELECTION: Selection = {
  atomIds: ["a1", "a4"],
  bondIds: ["b7", "b10"],
};

function renderOverlay(
  selection: Selection,
  hoveredAtomId: string | null,
  hoveredBondId: string | null,
): HTMLElement {
  const { container } = render(
    <svg>
      <OverlayLayer
        index={INDEX}
        selection={selection}
        hoveredAtomId={hoveredAtomId}
        hoveredBondId={hoveredBondId}
      />
    </svg>,
  );
  return container;
}

describe("OverlayLayer — the export boundary", () => {
  it("emits overlay marks and NOTHING that counts as a drawn atom or bond", () => {
    const container = renderOverlay(SELECTION, "a3", "b11");

    // Two selected atoms, two selected bonds, one hovered atom, one hovered
    // bond. Hover and selection stack, so an already-selected hovered atom
    // would draw both — here they are deliberately different ids.
    expect(container.querySelectorAll("[data-overlay]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-primitive-id]")).toHaveLength(0);
  });

  it("says what each mark is and which id it points at", () => {
    const container = renderOverlay(SELECTION, "a3", "b11");
    const roles = [...container.querySelectorAll("[data-overlay]")].map((el) => [
      el.getAttribute("data-overlay"),
      el.getAttribute("data-overlay-target"),
    ]);
    // Draw order: bonds under atoms, selection under hover. Hover on top
    // because it answers "what do I get if I click here", which has to win
    // over "what did I already have".
    expect(roles).toEqual([
      ["selected-bond", "b7"],
      ["selected-bond", "b10"],
      ["selected-atom", "a1"],
      ["selected-atom", "a4"],
      ["hover-bond", "b11"],
      ["hover-atom", "a3"],
    ]);
  });

  it("leaves no trace in serializeScene of the same scene", () => {
    // Rendered first, so the scene object has demonstrably been through the
    // overlay before it is serialised.
    const container = renderOverlay(SELECTION, "a3", "b11");
    expect(container.querySelectorAll("[data-overlay]").length).toBeGreaterThan(0);

    const svg = serializeScene(SCENE, { standalone: false });

    expect(svg).not.toContain("data-overlay");
    expect(svg).not.toContain("hover-atom");
    expect(svg).not.toContain("hover-bond");
    expect(svg).not.toContain("selected-atom");
    expect(svg).not.toContain("selected-bond");
    // The halo colours, which is what would actually be visible in a figure.
    expect(svg).not.toContain("#3b82f6");
    expect(svg).not.toContain("#2563eb");

    // And exactly the primitive count the scene has: six ring edges, six
    // bare-vertex dots and the one inscribed circle skeletal now defaults to,
    // which replaces the alternation's inner lines. The extra element is the
    // screen preset's background rect, which the scene's own style asks for.
    expect(SCENE.primitives).toHaveLength(13);
    expect(svg.match(/<line /g)).toHaveLength(6);
    expect(svg.match(/<circle /g)).toHaveLength(7);
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).toContain('data-bond="b7"');
    expect(svg).toContain('data-atom="a1"');
  });

  it("does not mutate the scene it measures", () => {
    // The `SceneIndex` walks `scene.primitives` once; if the overlay ever
    // pushed a highlight into that list, this is where it would show.
    const before = SCENE.primitives.map((p) => p.id);
    renderOverlay(SELECTION, "a3", "b11");
    expect(SCENE.primitives.map((p) => p.id)).toEqual(before);
    expect(INDEX.scene).toBe(SCENE);
  });

  it("keeps the scene's own element count intact when drawn alongside it", () => {
    // The whole DOM contract in one assertion: the page must contain exactly
    // the scene's six `[data-atom-id]` and nine `[data-bond-id]` however much
    // is hovered or selected. The overlay adds `[data-overlay]` elements and
    // never a source attribute of its own.
    const { container } = render(
      <svg data-canvas-root="true">
        <g>
          <SceneLayer scene={SCENE} />
          <OverlayLayer
            index={INDEX}
            selection={{ atomIds: MOL.atomIds, bondIds: MOL.bondIds }}
            hoveredAtomId="a2"
            hoveredBondId="b9"
          />
        </g>
      </svg>,
    );

    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(6);
    // Every atom and bond selected, plus one hovered atom and one hovered bond.
    expect(container.querySelectorAll("[data-overlay]")).toHaveLength(14);
    // Two sibling layers, both inert to pointers.
    const scene = container.querySelector('[data-layer="scene"]') as SVGElement;
    const overlay = container.querySelector('[data-layer="overlay"]') as SVGElement;
    expect(scene.parentElement).toBe(overlay.parentElement);
    expect(overlay.style.pointerEvents).toBe("none");
  });
});

describe("OverlayLayer — geometry and staleness", () => {
  it("draws each mark on the ink the index reports, not on model coordinates", () => {
    const container = renderOverlay({ atomIds: ["a1"], bondIds: ["b7"] }, null, null);

    const centre = INDEX.atomCentre("a1")!;
    const ring = container.querySelector('[data-overlay="selected-atom"]')!;
    expect(Number(ring.getAttribute("cx"))).toBeCloseTo(centre.x, 9);
    expect(Number(ring.getAttribute("cy"))).toBeCloseTo(centre.y, 9);

    const segment = INDEX.bondSegment("b7")!;
    const band = container.querySelector('[data-overlay="selected-bond"]')!;
    expect(Number(band.getAttribute("x1"))).toBeCloseTo(segment.a.x, 9);
    expect(Number(band.getAttribute("y2"))).toBeCloseTo(segment.b.y, 9);
  });

  it("sizes the halo to the pick target, not to the placeholder dot", () => {
    // A 2px dot measures ~2.8px of circumscribed ink. A ring that size would
    // be a speck, and worse, would flatter what a click actually grabs:
    // chem-core's bare-vertex target is 0.18 bond lengths, i.e. ~8px here.
    const container = renderOverlay(EMPTY_SELECTION, "a1", null);
    const halo = container.querySelector('[data-overlay="hover-atom"]')!;
    const r = Number(halo.getAttribute("r"));
    expect(r).toBeGreaterThan(INDEX.atomRadiusPx("a1") * 3);
    expect(r).toBeGreaterThanOrEqual(
      INDEX.labelRadius("a1") * SCREEN_STYLE.bondLengthPx,
    );
    // Still short of half a bond, so two adjacent halos leave clear bond
    // between them.
    expect(r).toBeLessThan(SCREEN_STYLE.bondLengthPx / 2);
  });

  it("draws nothing rather than throwing for an id the molecule no longer has", () => {
    // Undo restores a selection alongside the document it belonged to, and for
    // the render between the two the selection legitimately names atoms the
    // current molecule has lost. Feedback that crashes the canvas is worse
    // than feedback that is briefly missing.
    const container = renderOverlay(
      { atomIds: ["a1", "a99"], bondIds: ["b7", "b99"] },
      "a98",
      "b98",
    );
    expect(container.querySelectorAll("[data-overlay]")).toHaveLength(2);
    expect(
      container.querySelector('[data-overlay-target="a99"]'),
    ).toBeNull();
  });

  it("renders an empty group for an empty selection with nothing hovered", () => {
    const container = renderOverlay(EMPTY_SELECTION, null, null);
    const overlay = container.querySelector('[data-layer="overlay"]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.childNodes).toHaveLength(0);
  });
});

/**
 * The gesture marks.
 *
 * Every one of them wears `data-overlay` and none of them wears
 * `data-atom-id`/`data-bond-id`, which is what keeps "benzene renders six
 * atoms" a structural assertion — an e2e spec counts those selectors
 * PAGE-WIDE, so a ghost bond or a marquee rectangle carrying one would break a
 * test that has nothing to do with drawing.
 */
describe("OverlayLayer — gesture marks", () => {
  function renderGesture(props: Partial<OverlayLayerProps>): HTMLElement {
    const { container } = render(
      <svg>
        <OverlayLayer
          index={INDEX}
          selection={EMPTY_SELECTION}
          hoveredAtomId={null}
          hoveredBondId={null}
          {...props}
        />
      </svg>,
    );
    return container;
  }

  it("draws the ghost bond through modelToPx, flip included", () => {
    const container = renderGesture({
      interaction: {
        ghost: { from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
        target: null,
        marquee: null,
        pivot: null,
      },
    });
    const ghost = container.querySelector('[data-overlay="ghost-bond"]')!;
    expect(ghost).not.toBeNull();
    // Model y-up, scene y-down: a ghost pointing UP in the model has a
    // NEGATIVE scene y at its far end. A missing flip here would draw every
    // bond-in-progress mirrored about its own atom.
    expect(Number(ghost.getAttribute("y1"))).toBe(0);
    expect(Number(ghost.getAttribute("y2"))).toBe(-SCREEN_STYLE.bondLengthPx);
  });

  it("marks an accepted target differently from a refused one", () => {
    const accepted = renderGesture({
      interaction: {
        ghost: null,
        target: { atomId: "a4", refused: false },
        marquee: null,
        pivot: null,
      },
    });
    expect(
      accepted.querySelector('[data-overlay="target-accepted"]'),
    ).not.toBeNull();

    const refused = renderGesture({
      interaction: {
        ghost: null,
        target: { atomId: "a2", refused: true },
        marquee: null,
        pivot: null,
      },
    });
    const mark = refused.querySelector('[data-overlay="target-refused"]')!;
    expect(mark).not.toBeNull();
    // Decision 2 made visible: the user has to see the refusal while the
    // button is still down, not discover it when nothing happens on release.
    expect(mark.getAttribute("data-overlay-target")).toBe("a2");
  });

  it("normalises the marquee AFTER the flip, never before it", () => {
    // The y-flip swaps which corner is on top, so a rect normalised in model
    // units comes back inverted — and an SVG <rect> with a negative height
    // renders nothing at all, silently, with no console output to notice.
    const upLeft = renderGesture({
      interaction: {
        ghost: null,
        target: null,
        marquee: { a: { x: 1, y: 1 }, b: { x: -1, y: -1 } },
        pivot: null,
      },
    });
    const rect = upLeft.querySelector('[data-overlay="marquee"]')!;
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(
      2 * SCREEN_STYLE.bondLengthPx,
      6,
    );
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(
      2 * SCREEN_STYLE.bondLengthPx,
      6,
    );
    expect(Number(rect.getAttribute("height"))).toBeGreaterThan(0);
  });

  it("badges a valence issue without refusing anything", () => {
    const container = renderGesture({
      issues: [
        { atomId: "a1", severity: "error", message: "C has 5 bonds but allows at most 4" },
      ],
    });
    const badge = container.querySelector('[data-overlay="valence-issue"]')!;
    expect(badge).not.toBeNull();
    expect(badge.getAttribute("data-overlay-target")).toBe("a1");
    expect(badge.querySelector("title")?.textContent).toContain("at most 4");
  });

  it("badges two issues on one atom rather than dropping the second", () => {
    // An atom can carry a valence error and a structural one at once — a wedge
    // on an over-valent carbon is one edit away — and the two arrive as one
    // concatenated list from `EditorCanvas`. Keyed on the atom id alone, React
    // renders the first and silently discards the second.
    const container = renderGesture({
      issues: [
        { atomId: "a1", severity: "error", message: "C has 5 bonds but allows at most 4" },
        {
          atomId: "a1",
          severity: "warning",
          message: "a wedge bond starts at an atom that is not a stereocentre",
        },
      ],
    });
    const badges = container.querySelectorAll('[data-overlay="valence-issue"]');
    expect(badges).toHaveLength(2);
  });

  it("places the rotate handle above the atoms it turns, and only when there are some", () => {
    const none = renderGesture({ handleAtomIds: [] });
    expect(none.querySelector('[data-overlay="rotate-handle"]')).toBeNull();

    const some = renderGesture({ handleAtomIds: ["a1", "a2", "a3", "a4", "a5", "a6"] });
    const handle = some.querySelector('[data-overlay="rotate-handle"]')!;
    expect(handle).not.toBeNull();
    // Benzene's centroid is the origin, which is scene (0, 0); the handle sits
    // above it, and scene px are y-down so "above" is negative.
    expect(Number(handle.getAttribute("cx"))).toBeCloseTo(0, 6);
    expect(Number(handle.getAttribute("cy"))).toBeLessThan(0);
  });

  it("wears no model-entity attribute on any gesture mark", () => {
    const container = renderGesture({
      interaction: {
        ghost: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        target: { atomId: "a4", refused: false },
        marquee: { a: { x: -1, y: -1 }, b: { x: 1, y: 1 } },
        pivot: { x: 0, y: 0 },
      },
      issues: [{ atomId: "a1", severity: "error", message: "x" }],
      handleAtomIds: ["a1", "a2"],
    });
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(0);
    // Six marks: ghost, target, marquee, pivot, badge, handle. The marquee and
    // the handle are mutually exclusive in the real canvas — a sweep hides the
    // handle — so this fixture asks for the marquee and gets no handle.
    expect(container.querySelectorAll("[data-overlay]").length).toBeGreaterThan(3);
  });
});
