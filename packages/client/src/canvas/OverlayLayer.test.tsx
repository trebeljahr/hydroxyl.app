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

    // And exactly the primitive count the scene has: six lines, six dots. The
    // one extra element is the screen preset's background rect, which the
    // scene's own style asks for.
    expect(SCENE.primitives).toHaveLength(12);
    expect(svg.match(/<line /g)).toHaveLength(6);
    expect(svg.match(/<circle /g)).toHaveLength(6);
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

  it("keeps the six-and-six count intact when drawn alongside the scene", () => {
    // The whole DOM contract in one assertion: the page must contain exactly
    // six `[data-atom-id]` and six `[data-bond-id]` however much is hovered
    // or selected.
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
