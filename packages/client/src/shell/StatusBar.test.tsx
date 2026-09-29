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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMolecule } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { cis2Butene, steroidSkeletonWithLocants } from "@starter/chem-render";
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

  it("reports zero chemistry errors for benzene and flags a pentavalent carbon", () => {
    render(<StatusBar />);
    expect(statusText("issues")).toContain("0 chemistry errors");

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
    expect(statusText("issues")).toContain("1 chemistry error");
  });

  it("counts an unexpressible feature as an AMBER notice, never as a red error", () => {
    // Decision 77. A correctly drawn allene is chiral in a way no descriptor
    // in this build can state, and the bar used to say "1 valence issue" in
    // red about a structure with nothing wrong with it. Penta-2,3-diene:
    // chem-core reports a stereogenic axis and no valence problem at all.
    // Penta-2,3-diene, CH3-CH=C=CH-CH3: the axis is graph-only, so the
    // coordinates here are just somewhere to put the atoms.
    const allene = buildMolecule((b) => {
      const c1 = b.atom("C", { x: 0, y: 0 });
      const c2 = b.atom("C", { x: 1, y: 0 });
      const c3 = b.atom("C", { x: 2, y: 0 });
      const c4 = b.atom("C", { x: 3, y: 0 });
      const c5 = b.atom("C", { x: 4, y: 0 });
      b.bond(c1, c2, 1);
      b.bond(c2, c3, 2);
      b.bond(c3, c4, 2);
      b.bond(c4, c5, 1);
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: allene, now: DOC.metadata.createdAt }));
    });
    render(<StatusBar />);

    // The red counter says zero, in as many words.
    expect(statusText("issues")).toContain("0 chemistry errors");
    expect(document.querySelector('[data-status="issues"]')?.className ?? "").not.toContain(
      "text-destructive",
    );

    // And the amber one says what is actually true, with the reason on hover.
    const notice = document.querySelector('[data-status="structure-warnings"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toBe("1 feature not expressible");
    expect(notice!.getAttribute("data-warning-count")).toBe("1");
    expect(notice!.className).toContain("amber");
    expect(notice!.getAttribute("title") ?? "").toContain(
      "contains a stereogenic axis or plane this build cannot express",
    );
  });

  it("says nothing about unexpressible features when there are none", () => {
    render(<StatusBar />);
    expect(document.querySelector('[data-status="structure-warnings"]')).toBeNull();
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

  it("weighs an isotope-labelled atom as its nuclide", () => {
    // The reported bug: a 13C label left Exact at methanol's 32.0262.
    const labelled = buildMolecule((b) => {
      const c = b.atom("C", { x: 0, y: 0 }, { isotope: 13 });
      b.bond(c, b.atom("O", { x: 1, y: 0 }), 1);
    });
    editorStore
      .getState()
      .openDocument(createDocument({ molecule: labelled, now: DOC.metadata.createdAt }));
    render(<StatusBar />);

    expect(statusText("exact-mass")).toBe("Exact 33.0296");
    expect(statusText("weight")).toBe("MW 33.0344");
  });

  it("dashes both masses for a label whose nuclide mass is not on record", () => {
    // 64Cu is not in chem-core's nuclide table. Copper's own 62.9296 would be
    // the plausible wrong number, so neither mass is shown.
    const copper64 = buildMolecule((b) => {
      b.atom("Cu", { x: 0, y: 0 }, { isotope: 64 });
    });
    editorStore
      .getState()
      .openDocument(createDocument({ molecule: copper64, now: DOC.metadata.createdAt }));
    render(<StatusBar />);

    expect(statusText("exact-mass")).toBe("Exact —");
    expect(statusText("weight")).toBe("MW —");
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

  it("reads the same percentage for the same picture in either style (decision 107)", () => {
    render(
      <>
        <EditorCanvas />
        <StatusBar />
      </>,
    );
    const before = statusText("zoom");
    // The switch rescales the viewport so nothing moves on screen, which puts
    // the viewport's own zoom at 44/24 of what it was. The readout is in
    // on-screen bonds, so it does not move either.
    act(() => editorStore.getState().setStylePreset("publication"));
    expect(statusText("zoom")).toBe(before);
    expect(editorStore.getState().viewport.zoom).not.toBeCloseTo(
      Number.parseInt(before, 10) / 100,
      2,
    );

    // And Reset lands on the readout's 100%, not on a viewport zoom of 1.
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(statusText("zoom")).toBe("100%");
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
    for (const id of ["view.fit", "view.reset", "view.zoom-in", "view.zoom-out"]) {
      const button = document.querySelector(`[data-command="${id}"]`);
      expect(button, id).toBeTruthy();
    }
  });

  it("names the glyph zoom buttons for what they do, not for their glyph", () => {
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    // The two word buttons keep their visible label as their name.
    expect(screen.getByRole("button", { name: "Fit" })).toBeTruthy();
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

describe("StatusBar — annotations not shown (decisions 62, 66 and 70)", () => {
  const steroid = steroidSkeletonWithLocants();
  const idOf = (locant: string): string =>
    Object.entries(steroid.locants).find(([, text]) => text === locant)![0];
  const unplacedNode = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-status="annotations"]');

  it("shows nothing when every annotation was placed", () => {
    // cis-2-butene's (Z) has room beside its double bond at Publication.
    act(() => editorStore.getState().openDocument(descriptorDoc(cis2Butene(), "skeletal")));
    render(<StatusBar />);
    const layout = canvasAnnotatedScene(editorStore.getState().document, null).annotations;
    expect(layout.placements).toHaveLength(1);
    expect(layout.unplaced).toEqual([]);
    expect(unplacedNode()).toBeNull();
  });

  it("says nothing when every reported annotation is still DRAWN (decision 70)", () => {
    // The skeletal steroid at Publication: all four (S) are reported, and all
    // four are on the page and legible. A count here would cry wolf on a good
    // figure — they are only listed, as tight, once something else is missing.
    act(() => editorStore.getState().openDocument(descriptorDoc(steroid.molecule, "skeletal")));
    render(<StatusBar />);
    const layout = canvasAnnotatedScene(editorStore.getState().document, null).annotations;
    expect(layout.unplaced).toHaveLength(4);
    expect(layout.unplaced.every((u) => !u.dropped)).toBe(true);
    const scene = buildCanvasScene(editorStore.getState().document, null);
    for (const u of layout.unplaced) {
      expect(scene.primitives.some((p) => p.id === u.id), u.id).toBe(true);
    }
    expect(unplacedNode()).toBeNull();
  });

  it("counts only what is missing from the drawing, and names it", () => {
    // With the hydrogens drawn, C13's and C10's (S) can no longer keep their
    // clearance from an "H" (decisions 58 and 64): those are not shown.
    act(() => editorStore.getState().openDocument(descriptorDoc(steroid.molecule, "explicitH")));
    render(<StatusBar />);
    const node = unplacedNode()!;
    expect(node).not.toBeNull();
    const layout = canvasAnnotatedScene(editorStore.getState().document, null).annotations;
    const dropped = layout.unplaced.filter((u) => u.dropped);
    expect(dropped.length).toBeGreaterThan(0);
    expect(node.textContent).toBe(
      `${dropped.length} ${dropped.length === 1 ? "annotation" : "annotations"} not shown`,
    );
    expect(node.getAttribute("data-not-shown")).toBe(String(dropped.length));
    const title = node.getAttribute("title")!;
    expect(title).toContain(`Not shown: ${idOf("13")} (S)`);
    // The drawn-but-tight ones are listed, under their own heading, and are
    // not part of the count.
    expect(title).toContain(`Tight: ${idOf("17")} (S)`);
    expect(node.getAttribute("data-tight")).toBe(
      String(layout.unplaced.length - dropped.length),
    );
    const scene = buildCanvasScene(editorStore.getState().document, null);
    expect(scene.primitives.some((p) => p.id === `atom:${idOf("13")}:descriptor`)).toBe(false);
    expect(scene.primitives.some((p) => p.id === `atom:${idOf("17")}:descriptor`)).toBe(true);
  });

  it("warns in amber, not in the red the valence errors use (decision 66)", () => {
    act(() => editorStore.getState().openDocument(descriptorDoc(steroid.molecule, "explicitH")));
    render(<StatusBar />);
    const className = unplacedNode()!.className;
    expect(className).toContain("amber");
    expect(className).not.toContain("destructive");
    // The valence count beside it keeps the destructive tone for a real error.
    const pentavalent = buildMolecule((b) => {
      const c = b.atom("C", { x: 0, y: 0 });
      for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]] as const) {
        b.bond(c, b.atom("C", { x, y }), 1);
      }
    });
    act(() => editorStore.getState().openDocument(descriptorDoc(pentavalent, "skeletal")));
    render(<StatusBar />);
    expect(document.querySelector('[data-status="issues"]')!.className).toContain("destructive");
  });

  it("reports the ACTIVE panel, not the document's first one", () => {
    // Two panels of the steroid: skeletal, where all four descriptors are
    // drawn and nothing is missing, and explicit-H, where the derived
    // hydrogens leave no clearance and several are dropped.
    const skeletal = descriptorDoc(steroid.molecule, "skeletal").panels[0]!;
    const explicitH = { ...descriptorDoc(steroid.molecule, "explicitH").panels[0]!, id: "panel-explicit" };
    const doc: SketchDocument = {
      ...descriptorDoc(steroid.molecule, "skeletal"),
      panels: [skeletal, explicitH],
    };
    act(() => {
      editorStore.getState().openDocument(doc);
      editorStore.getState().setActivePanel(explicitH.id);
    });
    render(<StatusBar />);
    expect(editorStore.getState().ui.activePanelId).toBe(explicitH.id);
    const first = canvasAnnotatedScene(doc, skeletal.id).annotations;
    const second = canvasAnnotatedScene(doc, explicitH.id).annotations;
    // The two panels disagree, so the assertion cannot pass by accident.
    expect(first.unplaced.filter((u) => u.dropped)).toHaveLength(0);
    expect(second.unplaced.filter((u) => u.dropped).length).toBeGreaterThan(0);
    expect(unplacedNode()!.getAttribute("data-not-shown")).toBe(
      String(second.unplaced.filter((u) => u.dropped).length),
    );
  });

  it("reads the canvas's own build: one placement run per document", () => {
    const doc = descriptorDoc(steroid.molecule, "skeletal");
    const first = canvasAnnotatedScene(doc, null);
    expect(canvasAnnotatedScene(doc, null)).toBe(first);
    expect(buildCanvasScene(doc, null)).toBe(first.scene);
  });
});

describe("StatusBar — the Donate link", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("points at the shared donate page and opens a new tab", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    render(<StatusBar />);
    const link = screen.getByRole("link", { name: "Donate" });
    expect(link).toHaveAttribute("href", "https://ricos.site/donate?from=chemistry-sketcher");
    // A new tab, so the drawing is never navigated away from.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("is left out of the static export an app-store shell would package", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    render(<StatusBar />);
    expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
  });
});

describe("StatusBar — the Feedback link (decisions 140 and 167)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a bare mailto link that carries nothing from the open sketch", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    render(<StatusBar />);
    const link = screen.getByRole("link", { name: "Feedback" });
    // The whole href, so a `?body=` built from the benzene on the canvas
    // would fail here: a drawn structure must not leave the browser.
    expect(link).toHaveAttribute("href", "mailto:feedback@chemistry.trebeljahr.com");
    expect(link).toHaveAttribute("title", "feedback@chemistry.trebeljahr.com");
    // A mail program takes it; the page stays, so no new tab.
    expect(link).not.toHaveAttribute("target");
  });

  it("stays in the static export, where Donate does not", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    render(<StatusBar />);
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "href",
      "mailto:feedback@chemistry.trebeljahr.com",
    );
    expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
  });
});
