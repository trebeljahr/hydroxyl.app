/**
 * The scene as REAL DOM, not a serialised blob.
 *
 * The cheap way to draw a scene in React is `serializeScene` plus
 * `dangerouslySetInnerHTML`, and everything the editor is built on then stops
 * working: React cannot reconcile a single line, nothing can hang a ref or a
 * class on one bond, and every re-render replaces the whole picture. The tests
 * below are what tell the two apart — one node per primitive, keyed by the
 * primitive's own id, so a node survives a change that renumbers its
 * neighbours.
 *
 * ELEMENT COUNT IS LOAD-BEARING: benzene must produce exactly six elements
 * matching `[data-atom-id]` and six matching `[data-bond-id]`. The e2e spec
 * and the overlay's whole attribute scheme depend on those two selectors
 * counting drawn model entities and nothing else.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { benzene, removeBond } from "@starter/chem-core";
import {
  SCREEN_STYLE,
  buildScene,
  formatNumber,
  modelToPx,
  representation,
  withStyle,
} from "@starter/chem-render";
import type { RenderScene } from "@starter/chem-render";

import { SceneLayer } from "./SceneLayer";

const MOL = benzene();
const SKELETAL = representation("skeletal");
const SCENE = buildScene(MOL, SCREEN_STYLE, SKELETAL);

/** The layer needs an `<svg>` around it, exactly as `EditorCanvas` gives it. */
function renderScene(scene: RenderScene): HTMLElement {
  const { container } = render(
    <svg>
      <SceneLayer scene={scene} />
    </svg>,
  );
  return container;
}

function tagsOf(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((el) =>
    el.tagName.toLowerCase(),
  );
}

describe("SceneLayer", () => {
  it("draws benzene as exactly six bond elements and six atom elements", () => {
    const container = renderScene(SCENE);

    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(6);
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(6);
    // Six plain lines and six dots, because bond order is ignored until the
    // second line of a double bond is a real rendering pass. Benzene is an
    // explicit Kekule ring and nothing in the view compensates for that.
    expect(tagsOf(container, "[data-bond-id]")).toEqual(Array(6).fill("line"));
    expect(tagsOf(container, "[data-atom-id]")).toEqual(Array(6).fill("circle"));
  });

  it("names each element by its primitive's own id, not by an index", () => {
    const container = renderScene(SCENE);
    const ids = [...container.querySelectorAll("[data-primitive-id]")].map((el) =>
      el.getAttribute("data-primitive-id"),
    );
    // Derived from the source atom or bond — `bond:b7:line`, `atom:a1:dot` —
    // which is what makes the output byte-deterministic and what lets React
    // move a node instead of rewriting every element after an insertion.
    expect(ids).toEqual(SCENE.primitives.map((p) => p.id));
    expect(ids).toContain("bond:b7:line");
    expect(ids).toContain("atom:a1:dot");
    for (const id of ids) expect(id).toMatch(/^(atom|bond):[ab]\d+:/);
  });

  it("points each element back at the atom or bond it was drawn for", () => {
    const container = renderScene(SCENE);
    for (const bondId of MOL.bondIds) {
      const el = container.querySelector(`[data-bond-id="${bondId}"]`);
      expect(el?.getAttribute("data-primitive-id")).toBe(`bond:${bondId}:line`);
      expect(el?.getAttribute("data-atom-id")).toBeNull();
    }
    for (const atomId of MOL.atomIds) {
      const el = container.querySelector(`[data-atom-id="${atomId}"]`);
      expect(el?.getAttribute("data-primitive-id")).toBe(`atom:${atomId}:dot`);
      expect(el?.getAttribute("data-bond-id")).toBeNull();
    }
  });

  it("builds real SVG nodes, one per primitive, with no stray markup between", () => {
    const container = renderScene(SCENE);
    const layer = container.querySelector('[data-layer="scene"]');
    expect(layer).not.toBeNull();
    // `childNodes`, not `children`: an innerHTML blob would also leave text
    // nodes for the whitespace between elements.
    expect(layer?.childNodes).toHaveLength(SCENE.primitives.length);
    for (const node of layer!.childNodes) {
      expect(node.nodeType).toBe(Node.ELEMENT_NODE);
      expect((node as Element).namespaceURI).toBe("http://www.w3.org/2000/svg");
    }
    // Pointer-events off on the layer: the root <svg> is the only element that
    // handles pointers, so the DOM under the cursor can never disagree with
    // what `hitTest` says is under it.
    expect((layer as SVGElement).style.pointerEvents).toBe("none");
  });

  it("keeps the same DOM node for a primitive when its neighbours renumber", () => {
    // THE test that innerHTML cannot pass, and that an index key fails
    // differently: dropping the first bond shifts every later primitive down
    // one position. Keyed by primitive id, `bond:b8:line` keeps the node it
    // had; keyed by index, the node that used to be `bond:b7:line` is reused
    // for it instead.
    const { container, rerender } = render(
      <svg>
        <SceneLayer scene={SCENE} />
      </svg>,
    );
    const nodeB7 = container.querySelector('[data-primitive-id="bond:b7:line"]');
    const nodeB8 = container.querySelector('[data-primitive-id="bond:b8:line"]');
    expect(nodeB7).not.toBeNull();
    expect(nodeB8).not.toBeNull();

    const trimmed = removeBond(MOL, "b7");
    rerender(
      <svg>
        <SceneLayer scene={buildScene(trimmed, SCREEN_STYLE, SKELETAL)} />
      </svg>,
    );

    expect(container.querySelector('[data-primitive-id="bond:b7:line"]')).toBeNull();
    expect(container.querySelector('[data-primitive-id="bond:b8:line"]')).toBe(
      nodeB8,
    );
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(5);
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(6);
  });

  it("neither scales nor flips: coordinates are the scene's own px, verbatim", () => {
    // The scene arrives from chem-render in final px with y already flipped.
    // A second scale or a second flip here is the classic way to get a
    // structure that draws correctly and hit-tests mirrored.
    const container = renderScene(SCENE);
    const precision = SCREEN_STYLE.coordinatePrecision;
    for (const atomId of MOL.atomIds) {
      const expected = modelToPx(SCREEN_STYLE, MOL.atoms[atomId]!.pos);
      const dot = container.querySelector(`[data-atom-id="${atomId}"]`)!;
      // Through chem-render's own formatter at the scene's precision, so the
      // canvas and the exported figure agree to the last decimal — and so the
      // -0 the y-flip manufactures reaches the DOM as "0" in both.
      expect(dot.getAttribute("cx")).toBe(formatNumber(expected.x, precision, atomId));
      expect(dot.getAttribute("cy")).toBe(formatNumber(expected.y, precision, atomId));
    }
    // a1 sits at model y = -1, so its scene y is +44: y-down, flipped once.
    const a1 = container.querySelector('[data-atom-id="a1"]')!;
    expect(Number(a1.getAttribute("cy"))).toBeCloseTo(SCREEN_STYLE.bondLengthPx, 1);
  });

  it("marks a text view's glyph run as a decoration belonging to nothing", () => {
    // A click on "C6H6" selects nothing, so the run must carry neither
    // back-reference — otherwise it would inflate the two counts above.
    const container = renderScene(
      buildScene(MOL, SCREEN_STYLE, representation("sumFormula")),
    );
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(0);
    expect(container.querySelectorAll('[data-decoration="true"]')).toHaveLength(1);
    expect(container.querySelector("text")?.textContent).toBe("C6H6");
    // Subscripts as real spans, not digits parsed back out of a flat string.
    expect(container.querySelectorAll("tspan").length).toBeGreaterThan(1);
  });

  it("draws nothing at all for a style that suppresses the placeholder dot", () => {
    // `atomDotRadiusPx: 0` is how a preset says "no vertex marker". The atoms
    // are then unrepresented in the DOM and must still not be invented here —
    // `SceneIndex` is what keeps them pickable.
    const container = renderScene(
      buildScene(MOL, withStyle(SCREEN_STYLE, { atomDotRadiusPx: 0 }), SKELETAL),
    );
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(6);
  });
});
