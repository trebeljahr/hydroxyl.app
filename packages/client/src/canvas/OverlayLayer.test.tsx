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
  PUBLICATION_STYLE,
  SCREEN_STYLE,
  buildScene,
  representation,
  serializeScene,
} from "@starter/chem-render";
import type { RenderScene } from "@starter/chem-render";

import { EMPTY_SELECTION } from "@/state";
import type { Selection } from "@/state";
import type { EditorIssue } from "@/editor/issues";

import { NO_INTERACTION_OVERLAY } from "@/editor/interaction";

import { ROTATE_HANDLE_RADIUS_PX, rotateHandleGeometry } from "./handles";
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

const RING_HANDLE = rotateHandleGeometry(INDEX, ["a1", "a2", "a3", "a4", "a5", "a6"])!;

/** A `translate(x y) scale(s)` frame, as the rotate marks are drawn in. */
function handleFrame(element: Element): { x: number; y: number; scale: number } {
  const match = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
    element.getAttribute("transform") ?? "",
  );
  if (match === null) throw new Error("rotate mark has no screen frame");
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

/** What `valenceIssues` reports for a carbon with five bonds. */
function overValentIssue(atomId: string, bondIds: readonly string[]): EditorIssue {
  return {
    kind: "over-valent",
    severity: "error",
    atomId,
    atomIds: [atomId],
    bondIds,
    message: "C has 5 bonds but allows at most 4",
    label: "C has 5 bonds; max 4",
  };
}

/** A decision-77 warning: sound chemistry this build cannot express. */
function alleneIssue(atomId: string): EditorIssue {
  return {
    kind: "unrepresentable-stereo",
    severity: "warning",
    atomId,
    atomIds: [atomId],
    bondIds: [],
    message: "contains a stereogenic axis or plane this build cannot express",
    label: "allene axis not expressible",
  };
}

const SELECTION: Selection = {
  atomIds: ["a1", "a4"],
  bondIds: ["b7", "b10"],
  annotationIds: [],
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
            selection={{ atomIds: MOL.atomIds, bondIds: MOL.bondIds, annotationIds: [] }}
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
    const container = renderOverlay({ atomIds: ["a1"], bondIds: ["b7"], annotationIds: [] }, null, null);

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
      { atomIds: ["a1", "a99"], bondIds: ["b7", "b99"], annotationIds: [] },
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
        lasso: null,
        pivot: null,
        angle: 0,
        handleHovered: false,
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
        lasso: null,
        pivot: null,
        angle: 0,
        handleHovered: false,
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
        lasso: null,
        pivot: null,
        angle: 0,
        handleHovered: false,
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
        lasso: null,
        pivot: null,
        angle: 0,
        handleHovered: false,
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

  it("rings an error's atom, bands its bonds, and labels it — refusing nothing", () => {
    const container = renderGesture({ issues: [overValentIssue("a1", ["b7", "b12"])] });

    const halo = container.querySelector('[data-overlay="issue-halo"]')!;
    expect(halo.getAttribute("data-overlay-target")).toBe("a1");
    expect(halo.getAttribute("stroke")).toBe("#dc2626");
    // Outside the selection halo, so a located atom shows both rings.
    const centre = INDEX.atomCentre("a1")!;
    expect(Number(halo.getAttribute("cx"))).toBeCloseTo(centre.x, 6);
    expect(Number(halo.getAttribute("r"))).toBeGreaterThan(13);

    const bands = [...container.querySelectorAll('[data-overlay="issue-bond"]')];
    expect(bands.map((b) => b.getAttribute("data-overlay-target"))).toEqual(["b7", "b12"]);

    const label = container.querySelector('[data-overlay="issue-label"]')!;
    expect(label.textContent).toBe("C has 5 bonds; max 4");
    expect(label.getAttribute("data-overlay-target")).toBe("a1");
    // An error is a ring and a label, never the warning's dot.
    expect(container.querySelector('[data-overlay="valence-issue"]')).toBeNull();
  });

  it("keeps the label one SCREEN size whatever the zoom", () => {
    const at = (zoom: number): number =>
      Number(
        renderGesture({ issues: [overValentIssue("a1", [])], zoom })
          .querySelector('[data-overlay="issue-label"]')!
          .getAttribute("font-size"),
      );
    // Scene px times zoom is screen px: the product is the constant.
    expect(at(1) * 1).toBeCloseTo(at(0.25) * 0.25, 6);
    expect(at(4) * 4).toBeCloseTo(at(1) * 1, 6);
  });

  it("marks a warning with an amber dot and no ring or label (decision 77)", () => {
    // A correctly drawn allene carries a mark because this build cannot
    // state its configuration, not because the drawing is wrong. A red ring
    // and a label would say the opposite of what is true.
    const container = renderGesture({ issues: [alleneIssue("a2")] });
    const badge = container.querySelector('[data-overlay="valence-issue"]')!;
    expect(badge.getAttribute("data-overlay-severity")).toBe("warning");
    expect(badge.getAttribute("fill")).toBe("#d97706");
    expect(container.querySelector('[data-overlay="issue-halo"]')).toBeNull();
    expect(container.querySelector('[data-overlay="issue-label"]')).toBeNull();
  });

  it("stacks two errors' labels on one atom rather than dropping or overprinting one", () => {
    // An atom can carry a valence error and a structural one at once — a wedge
    // on an over-valent carbon is one edit away. Keyed on the atom id alone,
    // React renders the first and silently discards the second.
    const container = renderGesture({
      issues: [
        overValentIssue("a1", []),
        {
          kind: "wedge-on-non-stereocenter",
          severity: "error",
          atomId: "a1",
          atomIds: ["a1", "a2"],
          bondIds: ["b7"],
          message: "a wedge bond starts at an atom that is not a stereocentre",
          label: "wedge at a non-stereocentre",
        },
      ],
    });
    const labels = [...container.querySelectorAll('[data-overlay="issue-label"]')];
    expect(labels.map((l) => l.textContent)).toEqual([
      "C has 5 bonds; max 4",
      "wedge at a non-stereocentre",
    ]);
    expect(labels[0]!.getAttribute("y")).not.toBe(labels[1]!.getAttribute("y"));
    expect(container.querySelectorAll('[data-overlay="issue-halo"]')).toHaveLength(2);
  });

  it("draws the rotate handle it is given, and none when it is given none", () => {
    const none = renderGesture({ rotateHandle: undefined });
    expect(none.querySelector('[data-overlay="rotate-handle"]')).toBeNull();

    const some = renderGesture({ rotateHandle: RING_HANDLE });
    const handle = some.querySelector('[data-overlay="rotate-handle"]')!;
    expect(handle).not.toBeNull();
    // Benzene's centroid is the origin, which is scene (0, 0); the handle sits
    // above it, and scene px are y-down so "above" is negative.
    const at = handleFrame(handle);
    expect(at.x).toBeCloseTo(0, 6);
    expect(at.y).toBeCloseTo(-RING_HANDLE.orbit, 6);
  });

  it("draws a rotate arrow inside the handle, so the dot says what it does", () => {
    const container = renderGesture({ rotateHandle: RING_HANDLE });
    const handle = container.querySelector('[data-overlay="rotate-handle"]')!;
    const glyph = handle.querySelector('[data-overlay-glyph="rotate"]');
    expect(glyph).not.toBeNull();
    // An ARC — the circular arrow — not a second circle or a line.
    expect(glyph!.getAttribute("d")).toMatch(/ A /);
  });

  it("keeps the handle one size on screen whatever the zoom", () => {
    // At the ~500% a fitted benzene opens at, a scene-sized handle was a 77px
    // disc. The handle is UI: its frame is scaled by 1/zoom so its ink is
    // ROTATE_HANDLE_RADIUS_PX screen px at every zoom.
    const zoomed = renderGesture({ rotateHandle: RING_HANDLE, zoom: 4 });
    const at = handleFrame(zoomed.querySelector('[data-overlay="rotate-handle"]')!);
    expect(at.scale).toBeCloseTo(0.25, 9);
    const disc = zoomed.querySelector('[data-overlay="rotate-handle"] circle')!;
    expect(Number(disc.getAttribute("r"))).toBe(ROTATE_HANDLE_RADIUS_PX);
  });

  it("previews the rotation only while the pointer rests on the handle", () => {
    const resting = renderGesture({ rotateHandle: RING_HANDLE });
    expect(resting.querySelector('[data-overlay="rotate-preview"]')).toBeNull();

    const hovered = renderGesture({
      rotateHandle: RING_HANDLE,
      interaction: { ...NO_INTERACTION_OVERLAY, handleHovered: true },
    });
    const preview = hovered.querySelector('[data-overlay="rotate-preview"]');
    expect(preview).not.toBeNull();
    // Centred on the pivot the machine turns about — benzene's centroid, the
    // origin — with the pivot dot drawn there.
    const frame = handleFrame(preview!);
    expect(frame.x).toBeCloseTo(0, 6);
    expect(frame.y).toBeCloseTo(0, 6);
    expect(preview!.querySelector("circle")).not.toBeNull();
    // And the orbit arc passes through the handle: its radius is the
    // pivot-to-handle distance.
    const arc = preview!.querySelector("path")!.getAttribute("d")!;
    const radius = Number(/ A ([\d.]+) /.exec(arc)![1]);
    expect(radius).toBeCloseTo(RING_HANDLE.orbit, 6);
  });

  it("carries the handle round its orbit while a rotation is in flight", () => {
    // A quarter turn anticlockwise in the model takes the handle from twelve
    // o'clock to nine o'clock on screen — y-down flips the sign of the angle,
    // not which way the drawing appears to turn.
    const container = renderGesture({
      rotateHandle: RING_HANDLE,
      interaction: { ...NO_INTERACTION_OVERLAY, pivot: { x: 0, y: 0 }, angle: Math.PI / 2 },
    });
    const at = handleFrame(container.querySelector('[data-overlay="rotate-handle"]')!);
    expect(at.x).toBeCloseTo(-RING_HANDLE.orbit, 6);
    expect(at.y).toBeCloseTo(0, 6);
  });

  it("wears no model-entity attribute on any gesture mark", () => {
    const container = renderGesture({
      interaction: {
        ghost: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        target: { atomId: "a4", refused: false },
        marquee: { a: { x: -1, y: -1 }, b: { x: 1, y: 1 } },
        lasso: null,
        pivot: { x: 0, y: 0 },
        angle: 0,
        handleHovered: false,
      },
      issues: [overValentIssue("a1", ["b7"]), alleneIssue("a2")],
      rotateHandle: rotateHandleGeometry(INDEX, ["a1", "a2"]),
    });
    expect(container.querySelectorAll("[data-atom-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-bond-id]")).toHaveLength(0);
    // Marks: ghost, target, marquee, pivot, issue ring, band, label and badge,
    // handle. The marquee and
    // the handle are mutually exclusive in the real canvas — a sweep hides the
    // handle — so this fixture asks for the marquee and gets no handle.
    expect(container.querySelectorAll("[data-overlay]").length).toBeGreaterThan(3);
  });
});

describe("OverlayLayer — sized in bonds, so it is the same in every style (decision 107)", () => {
  // Every mark sized with the drawing: two halos and two bands, a focus
  // ring, an error's ring and band, a warning's dot, and the gesture marks.
  // The rotate handle, its preview, the pivot and the issue label are UI
  // sized in SCREEN px, so they are checked apart below.
  const SCREEN_SIZED = new Set(["rotate-handle", "rotate-preview", "rotate-pivot", "issue-label"]);

  function everyMark(style: typeof SCREEN_STYLE, withMarquee: boolean): Element[] {
    const scene = buildScene(MOL, style, representation("skeletal"));
    const index = createSceneIndex(scene, MOL);
    const { container } = render(
      <svg>
        <OverlayLayer
          index={index}
          selection={{ atomIds: ["a1"], bondIds: ["b7"], annotationIds: [] }}
          hoveredAtomId="a3"
          hoveredBondId="b10"
          focusedAtomId="a5"
          issues={[overValentIssue("a2", ["b8"]), alleneIssue("a6")]}
          rotateHandle={rotateHandleGeometry(index, ["a1", "a2", "a3"])}
          interaction={{
            ghost: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
            target: { atomId: "a4", refused: true },
            marquee: withMarquee ? { a: { x: -1, y: -1 }, b: { x: 1, y: 2 } } : null,
            lasso: null,
            pivot: { x: 0.5, y: -0.5 },
            angle: 0,
            handleHovered: true,
          }}
        />
      </svg>,
    );
    return [...container.querySelectorAll("[data-overlay]")];
  }

  const LENGTHS = ["cx", "cy", "r", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "stroke-width"];

  it("draws every mark at Publication as the Screen mark times 24/44", () => {
    const ratio = PUBLICATION_STYLE.bondLengthPx / SCREEN_STYLE.bondLengthPx;
    for (const withMarquee of [true, false]) {
      const screen = everyMark(SCREEN_STYLE, withMarquee);
      const publication = everyMark(PUBLICATION_STYLE, withMarquee);
      expect(publication.map((el) => el.getAttribute("data-overlay"))).toEqual(
        screen.map((el) => el.getAttribute("data-overlay")),
      );
      expect(screen.filter((el) => !SCREEN_SIZED.has(el.getAttribute("data-overlay")!)).length)
        .toBe(withMarquee ? 11 : 10);

      screen.forEach((mark, at) => {
        const other = publication[at]!;
        const what = mark.getAttribute("data-overlay")!;
        if (SCREEN_SIZED.has(what)) return;
        for (const name of LENGTHS) {
          const value = mark.getAttribute(name);
          if (value === null) continue;
          expect(Number(other.getAttribute(name)), `${what} ${name}`).toBeCloseTo(
            Number(value) * ratio,
            6,
          );
        }
        const dashes = mark.getAttribute("stroke-dasharray");
        if (dashes !== null) {
          const scaled = other.getAttribute("stroke-dasharray")!.split(" ").map(Number);
          dashes
            .split(" ")
            .map(Number)
            .forEach((dash, i) => expect(scaled[i], `${what} dash`).toBeCloseTo(dash * ratio, 9));
        }
      });
    }
  });

  it("keeps the rotate handle's UI the same screen size in both styles", () => {
    // The handle's own frame is `scale(1/zoom)`, whatever the style: it is a
    // control, not part of the drawing, and the zoom already makes it constant
    // on screen. Only the orbit's halo clearance is scene-sized, and it scales
    // with the halo (see the orbit test in view-scale.test.ts).
    const scale = (style: typeof SCREEN_STYLE): string | null =>
      everyMark(style, false)
        .find((el) => el.getAttribute("data-overlay") === "rotate-handle")!
        .getAttribute("transform")!
        .replace(/translate\([^)]*\)\s*/, "");
    expect(scale(PUBLICATION_STYLE)).toBe(scale(SCREEN_STYLE));
    const pivotR = (style: typeof SCREEN_STYLE): string | null =>
      everyMark(style, false)
        .find((el) => el.getAttribute("data-overlay") === "rotate-pivot")!
        .getAttribute("r");
    expect(pivotR(PUBLICATION_STYLE)).toBe(pivotR(SCREEN_STYLE));
  });

  it("leaves every Screen mark exactly as it was", () => {
    // The reference bond IS Screen's, so the factor there is 1 and the
    // attributes are the literals the marks were tuned with.
    const halo = everyMark(SCREEN_STYLE, false).find(
      (el) => el.getAttribute("data-overlay") === "selected-atom",
    )!;
    expect(halo.getAttribute("r")).toBe("13");
    expect(halo.getAttribute("stroke-width")).toBe("2.5");
    const focus = everyMark(SCREEN_STYLE, false).find(
      (el) => el.getAttribute("data-overlay") === "focus-atom",
    )!;
    expect(focus.getAttribute("stroke-dasharray")).toBe("4 3");
  });
});
