/**
 * The status bar: the formula and mass it reports, and the viewport chrome
 * that moved here out of the canvas.
 *
 * The Fit and Reset tests are the ones `EditorCanvas.test.tsx` used to own —
 * they are unchanged in what they assert, and they still mount the canvas,
 * because "Fit re-frames to the same viewport the canvas chose on mount" is a
 * claim about the two agreeing rather than about the button alone.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildMolecule } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { butan2olWedged, steroidSkeletonWithLocants } from "@starter/chem-render";
import { createDocument, createPanel } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { EditorCanvas, fixtureDocument } from "@/canvas";
import { buildCanvasScene, canvasAnnotatedScene } from "@/canvas/scene-bridge";
import { editorStore } from "@/state";

import { StatusBar } from "./StatusBar";

const DOC = fixtureDocument("2024-01-01T00:00:00.000Z");

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(DOC);
  state.clearSelection();
  state.setStatusMessage(null);
  state.setViewportSize({ width: 800, height: 600 });
  state.resetViewport();
});

function statusText(name: string): string {
  const node = document.querySelector(`[data-status="${name}"]`);
  if (node === null) throw new Error(`no [data-status="${name}"]`);
  return node.textContent ?? "";
}

describe("StatusBar — what the drawing is", () => {
  it("shows benzene as C₆H₆, with real subscripts", () => {
    render(<StatusBar />);
    expect(statusText("formula")).toBe("C₆H₆");
  });

  it("reports zero valence issues for benzene and flags a pentavalent carbon", () => {
    render(<StatusBar />);
    expect(statusText("issues")).toContain("0 valence issues");

    // Five bonds on one carbon: the drawing error the badge exists for.
    const overloaded = buildMolecule((b) => {
      const centre = b.atom("C", { x: 0, y: 0 });
      for (let i = 0; i < 5; i++) {
        const arm = b.atom("C", { x: i + 1, y: 0 });
        b.bond(centre, arm, 1);
      }
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(
          createDocument({ molecule: overloaded, now: DOC.metadata.createdAt }),
        );
    });
    expect(statusText("issues")).toContain("1 valence issue");
  });

  it("renders an undefined exact mass as an em dash, never as an average weight", () => {
    // Technetium has no verified monoisotopic mass, so `massSummary` returns
    // `exactMass: undefined` — chem-core refuses to substitute an average
    // atomic weight, and so does the bar.
    const exotic = buildMolecule((b) => {
      b.atom("Tc", { x: 0, y: 0 });
    });
    editorStore
      .getState()
      .openDocument(createDocument({ molecule: exotic, now: DOC.metadata.createdAt }));
    render(<StatusBar />);

    expect(statusText("exact-mass")).toBe("Exact —");
    // And the average weight is still shown, so the row is not simply blank.
    expect(statusText("weight")).not.toContain("—");
  });

  it("shows the net charge", () => {
    render(<StatusBar />);
    expect(statusText("charge")).toBe("Charge neutral");
  });

  it("shows the last gesture's message in a live region", () => {
    render(<StatusBar />);
    act(() => {
      editorStore.getState().setStatusMessage("These atoms are already bonded");
    });
    expect(statusText("message")).toBe("These atoms are already bonded");
    expect(
      document.querySelector('[data-status="message"]')?.getAttribute("aria-live"),
    ).toBe("polite");
  });
});

describe("StatusBar — viewport chrome", () => {
  it("re-frames the molecule when Fit is pressed after a pan", () => {
    render(
      <>
        <EditorCanvas />
        <StatusBar />
      </>,
    );
    const fitted = editorStore.getState().viewport;

    editorStore.getState().panBy({ x: 250, y: -120 });
    expect(editorStore.getState().viewport.pan).not.toEqual(fitted.pan);

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(editorStore.getState().viewport.pan.x).toBeCloseTo(fitted.pan.x, 9);
    expect(editorStore.getState().viewport.pan.y).toBeCloseTo(fitted.pan.y, 9);
    expect(editorStore.getState().viewport.zoom).toBeCloseTo(fitted.zoom, 9);
  });

  it("keeps the fit stable however many times it is applied", () => {
    // The margin lives inside `scene.bounds`, and the fit asks `zoomToFit` for
    // a ZERO fractional margin because of it. A second margin applied per
    // press would shrink the figure a little on every click of Fit.
    render(
      <>
        <EditorCanvas />
        <StatusBar />
      </>,
    );
    const first = editorStore.getState().viewport.zoom;
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    }
    expect(editorStore.getState().viewport.zoom).toBeCloseTo(first, 9);
  });

  it("reports the zoom as a percentage", () => {
    render(<StatusBar />);
    const zoom = editorStore.getState().viewport.zoom;
    expect(statusText("zoom")).toBe(`${String(Math.round(zoom * 100))}%`);
  });

  it("keeps its chrome outside the <svg>, so the canvas root stays the only pointer target", () => {
    render(
      <>
        <EditorCanvas />
        <StatusBar />
      </>,
    );
    const canvas = document.querySelector('[data-canvas-root="true"]')!;
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(canvas.contains(fit)).toBe(false);
  });
});

describe("StatusBar — the viewport buttons are registry entries", () => {
  it("dispatches Fit and Reset through the command registry", () => {
    // Fit used to build the scene and call `zoomToFit` inline, which made it
    // the one action in the shell with no command behind it: no palette row,
    // no shortcut, and reachable from this strip alone.
    render(<StatusBar />);
    for (const id of ["view.fit", "view.reset"]) {
      const button = document.querySelector(`[data-command="${id}"]`);
      expect(button, id).toBeTruthy();
    }
  });

  it("greys Fit out on an empty sketch, the same way the palette does", () => {
    render(<StatusBar />);
    act(() => {
      editorStore
        .getState()
        .openDocument(
          createDocument({
            molecule: buildMolecule(() => undefined),
            now: "2024-01-01T00:00:00.000Z",
          }),
        );
    });
    const button = document.querySelector('[data-command="view.fit"]');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

/** One Publication panel of `kind`, with R/S and E/Z descriptors shown. */
function descriptorDoc(molecule: Molecule, kind: "skeletal" | "explicitH"): SketchDocument {
  const panel = createPanel(kind, undefined, "publication");
  return createDocument({
    molecule,
    stylePreset: "publication",
    panels: [
      {
        ...panel,
        representation: {
          ...panel.representation,
          display: { ...panel.representation.display, showStereoDescriptors: true },
        },
      },
    ],
    now: "2024-01-01T00:00:00.000Z",
  });
}

describe("StatusBar — annotations not placed (decision 62)", () => {
  const steroid = steroidSkeletonWithLocants();
  const c17 = Object.entries(steroid.locants).find(([, text]) => text === "17")![0];
  const unplacedNode = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-status="annotations"]');

  it("shows nothing when every annotation was placed", () => {
    act(() => editorStore.getState().openDocument(descriptorDoc(butan2olWedged(), "skeletal")));
    render(<StatusBar />);
    expect(canvasAnnotatedScene(editorStore.getState().document, null).annotations.placements).toHaveLength(1);
    expect(unplacedNode()).toBeNull();
  });

  it("counts a crowded annotation, and lists it as crowded", () => {
    // Skeletal steroid at Publication: C17's (S) has no clear slot, crosses
    // lines only, and is still drawn.
    act(() => editorStore.getState().openDocument(descriptorDoc(steroid.molecule, "skeletal")));
    render(<StatusBar />);
    const node = unplacedNode()!;
    expect(node).not.toBeNull();
    expect(node.textContent).toBe("1 annotation not placed");
    expect(node.getAttribute("title")).toBe(`${c17} (S): crowded`);
  });

  it("lists a dropped annotation as dropped, beside the crowded ones", () => {
    // Explicit-H: C17's (S) would print on a derived "H" and is not drawn;
    // C13's and C3's are crowded.
    act(() => editorStore.getState().openDocument(descriptorDoc(steroid.molecule, "explicitH")));
    render(<StatusBar />);
    const node = unplacedNode()!;
    expect(node.textContent).toBe("3 annotations not placed");
    const lines = node.getAttribute("title")!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines).toContain(`${c17} (S): dropped`);
    expect(lines.filter((line) => line.endsWith(": crowded"))).toHaveLength(2);
    // And the canvas really does not draw it.
    const scene = buildCanvasScene(editorStore.getState().document, null);
    expect(scene.primitives.some((p) => p.id === `atom:${c17}:descriptor`)).toBe(false);
  });

  it("reads the canvas's own build: one placement run per document", () => {
    const doc = descriptorDoc(steroid.molecule, "skeletal");
    const first = canvasAnnotatedScene(doc, null);
    expect(canvasAnnotatedScene(doc, null)).toBe(first);
    expect(buildCanvasScene(doc, null)).toBe(first.scene);
  });
});
