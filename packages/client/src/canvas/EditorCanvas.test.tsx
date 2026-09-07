/**
 * The canvas as the user meets it: a pointer lands somewhere on an `<svg>`,
 * and the editor store ends up holding a selection.
 *
 * Driven through the REAL component and the REAL store rather than by calling
 * `pickAt` and `selectBonds` next to each other in a test. The interesting
 * failures live in the wiring — a pick context read a frame late, a shift-click
 * routed to `selectBonds` instead of `toggleBond`, an empty-space click that
 * clears a multi-select the user spent four clicks assembling — and every one
 * of them survives a test that skips the component.
 *
 * WHAT jsdom DOES AND DOES NOT GIVE US. `getBoundingClientRect` returns zeros,
 * so a client coordinate IS a canvas coordinate here, and there is no
 * `ResizeObserver`, so the viewport keeps the size the store was given. Both
 * are fine: every canvas point below is computed from the STORE's viewport,
 * which is the same viewport `toModel` will use when the event arrives. The
 * one thing this harness cannot prove is that the element's measured size and
 * the store's agree — that is the e2e spec's job.
 *
 * NOTHING HERE MAY MUTATE THE MOLECULE. This task is view-only, and the last
 * test in the file is the one that says so.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildMolecule } from "@starter/chem-core";
import type { Vec2 } from "@starter/chem-core";
import { SCREEN_STYLE, modelToPx } from "@starter/chem-render";

import { editorStore, toScreen } from "@/state";

import { EditorCanvas } from "./EditorCanvas";
import { fixtureDocument } from "./fixture";

const DOC = fixtureDocument("2024-01-01T00:00:00.000Z");
const MOL = DOC.molecule;

beforeEach(() => {
  // The store is a module singleton — safe in the app, which is one store per
  // browser tab, but shared between the tests in this file.
  const state = editorStore.getState();
  state.openDocument(DOC);
  state.clearSelection();
  // Hover is not part of the selection and survives `clearSelection`. Without
  // this, a test that leaves a halo up makes the next file-order-dependent
  // "no overlay marks" assertion fail for a reason unrelated to what it tests.
  state.setHoveredAtom(null);
  state.setHoveredBond(null);
  state.setViewportSize({ width: 800, height: 600 });
  state.resetViewport();
});

function canvasRoot(): SVGSVGElement {
  const svg = document.querySelector('[data-canvas-root="true"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error("no canvas root");
  return svg;
}

/**
 * Where a model position currently sits in canvas px.
 *
 * The forward chain, read off the LIVE viewport: `EditorCanvas` fits the
 * document on mount, so a point computed against the initial viewport would
 * miss by the whole fit.
 */
function canvasPointFor(model: Vec2): Vec2 {
  return toScreen(editorStore.getState().viewport, modelToPx(SCREEN_STYLE, model));
}

function atomPoint(atomId: string): Vec2 {
  return canvasPointFor(MOL.atoms[atomId]!.pos);
}

function bondPoint(bondId: string): Vec2 {
  const bond = MOL.bonds[bondId]!;
  const from = MOL.atoms[bond.from]!.pos;
  const to = MOL.atoms[bond.to]!.pos;
  return canvasPointFor({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
}

/** A full click: down and up at the same point, which is what the gesture's
 *  slop test requires before it will fire a select. */
function click(point: Vec2, shift = false): void {
  const svg = canvasRoot();
  const event = { button: 0, pointerId: 1, clientX: point.x, clientY: point.y };
  fireEvent.pointerDown(svg, event);
  fireEvent.pointerUp(svg, { ...event, shiftKey: shift });
}

function selection(): { atomIds: readonly string[]; bondIds: readonly string[] } {
  const { atomIds, bondIds } = editorStore.getState().selection;
  return { atomIds, bondIds };
}

describe("EditorCanvas — the DOM contract", () => {
  it("mounts one canvas root with a scene layer and an overlay layer inside it", () => {
    render(<EditorCanvas />);
    const svg = canvasRoot();
    expect(document.querySelectorAll('[data-canvas-root="true"]')).toHaveLength(1);

    const scene = svg.querySelector('[data-layer="scene"]');
    const overlay = svg.querySelector('[data-layer="overlay"]');
    expect(scene).not.toBeNull();
    expect(overlay).not.toBeNull();
    // Siblings under the one pan/zoom transform, so the overlay tracks the
    // scene without a second copy of the affine map.
    expect(scene?.parentElement).toBe(overlay?.parentElement);
  });

  it("renders benzene as six atoms and nine bond elements", () => {
    // Nine, not six: a Kekule benzene's three double bonds each draw a second
    // line, and both lines carry the same `data-bond-id`.
    render(<EditorCanvas />);
    expect(document.querySelectorAll("[data-atom-id]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-bond-id]")).toHaveLength(9);
    expect(
      new Set(
        [...document.querySelectorAll("[data-bond-id]")].map((el) =>
          el.getAttribute("data-bond-id"),
        ),
      ).size,
    ).toBe(6);
  });

  it("badges a wedge drawn on an atom that is not a stereocentre", () => {
    // The acceptance criterion, end to end: chem-core reports it, the canvas
    // has to show it. Propan-2-ol's carbinol carbon carries two methyls, so
    // the wedge asserts a configuration that does not exist — and it renders
    // perfectly, which is why only a badge catches it.
    //
    // Composed in `EditorCanvas` from `valenceIssues` plus `structuralIssues`,
    // which is the wiring under test: the second list is a sibling of the
    // first rather than part of it, because stereo perception reads valence.
    const molecule = buildMolecule((b) => {
      const c1 = b.atom("C", { x: 0, y: 0 });
      const c2 = b.atom("C", { x: 0.87, y: 0.5 });
      const c3 = b.atom("C", { x: 1.73, y: 0 });
      const oxygen = b.atom("O", { x: 0.87, y: 1.5 });
      b.bond(c1, c2, 1);
      b.bond(c2, oxygen, 1, "wedge");
      b.bond(c2, c3, 1);
    });
    editorStore.getState().openDocument({ ...DOC, molecule });
    render(<EditorCanvas />);

    const badge = document.querySelector('[data-overlay="valence-issue"]');
    expect(badge).not.toBeNull();
    // Badged on the narrow end, which is where the wedge makes its claim.
    expect(badge?.getAttribute("data-overlay-target")).toBe("a2");
    expect(badge?.querySelector("title")?.textContent).toContain("stereocentre");
  });

  it("paints through the viewport's own affine map, not a second one", () => {
    render(<EditorCanvas />);
    const transform = canvasRoot().querySelector("g")!.getAttribute("transform")!;

    // `translate(w/2, h/2) scale(zoom) translate(-pan)`, which SVG applies
    // right to left and which is `toScreen` term for term. Parsed and APPLIED
    // rather than string-matched, because the numbers are emitted through a
    // guard that snaps sub-micropixel values to 0 — and because applying it is
    // the actual claim: a stray second scale or flip would show up as clicks
    // landing a few px off, worse the further you pan, with nothing in the
    // markup obviously wrong.
    // A number starts with a digit or a sign, so `translate`'s own letters
    // cannot be mistaken for one.
    const [tx, ty, scale, px, py] = [
      ...transform.matchAll(/[-+]?\d[\d.]*(?:e[-+]?\d+)?/gi),
    ].map((m) => Number(m[0]));
    const paint = (p: Vec2): Vec2 => ({
      x: (p.x + px!) * scale! + tx!,
      y: (p.y + py!) * scale! + ty!,
    });

    for (const atomId of MOL.atomIds) {
      const scenePoint = modelToPx(SCREEN_STYLE, MOL.atoms[atomId]!.pos);
      const painted = paint(scenePoint);
      const predicted = toScreen(editorStore.getState().viewport, scenePoint);
      expect(painted.x).toBeCloseTo(predicted.x, 4);
      expect(painted.y).toBeCloseTo(predicted.y, 4);
      // And that is where the pointer maths says the atom is, so a click there
      // picks it — the picture and the hit test are one map written twice.
      expect(painted.x).toBeCloseTo(atomPoint(atomId).x, 4);
      expect(painted.y).toBeCloseTo(atomPoint(atomId).y, 4);
    }
  });

  it("frames the molecule on mount, with the ring centred", () => {
    render(<EditorCanvas />);
    // Benzene is symmetric about the origin and so is the scene margin, so a
    // correct fit puts the model origin on the viewport centre and leaves the
    // ring comfortably inside it.
    const centre = canvasPointFor({ x: 0, y: 0 });
    expect(centre.x).toBeCloseTo(400, 6);
    expect(centre.y).toBeCloseTo(300, 6);
    expect(editorStore.getState().viewport.zoom).toBeGreaterThan(1);
    for (const atomId of MOL.atomIds) {
      const point = atomPoint(atomId);
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(800);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(600);
    }
  });
});

describe("EditorCanvas — selection", () => {
  it("selects the bond under a click on its midpoint", () => {
    render(<EditorCanvas />);
    click(bondPoint("b9"));
    expect(selection()).toEqual({ atomIds: [], bondIds: ["b9"] });
    // And the overlay says so, without wearing a data-bond-id of its own.
    expect(
      document.querySelector('[data-overlay="selected-bond"]')?.getAttribute(
        "data-overlay-target",
      ),
    ).toBe("b9");
    expect(document.querySelectorAll("[data-bond-id]")).toHaveLength(9);
  });

  it("extends the selection to two bonds on a shift-click", () => {
    render(<EditorCanvas />);
    click(bondPoint("b9"));
    click(bondPoint("b11"), true);
    expect(selection().bondIds).toEqual(["b9", "b11"]);
    expect(document.querySelectorAll('[data-overlay="selected-bond"]')).toHaveLength(
      2,
    );
  });

  it("removes a bond when the same shift-click lands on it again", () => {
    render(<EditorCanvas />);
    click(bondPoint("b9"));
    click(bondPoint("b11"), true);
    click(bondPoint("b9"), true);
    // A toggle, not a replace: shift is "add or remove", and the bond picked
    // first is the one that goes.
    expect(selection().bondIds).toEqual(["b11"]);
    click(bondPoint("b11"), true);
    expect(selection()).toEqual({ atomIds: [], bondIds: [] });
  });

  it("replaces the selection on an unmodified click", () => {
    render(<EditorCanvas />);
    click(bondPoint("b9"));
    click(bondPoint("b11"), true);
    click(bondPoint("b7"));
    expect(selection().bondIds).toEqual(["b7"]);
  });

  it("picks the ATOM, not the bond that ends there", () => {
    // The atom-over-bond priority chem-core's hit.ts is built around: a1 is an
    // endpoint of two bonds, and a click on the vertex must not grab either.
    render(<EditorCanvas />);
    click(atomPoint("a1"));
    expect(selection()).toEqual({ atomIds: ["a1"], bondIds: [] });
    expect(
      document.querySelector('[data-overlay="selected-atom"]')?.getAttribute(
        "data-overlay-target",
      ),
    ).toBe("a1");
  });

  it("clears the selection on a click over empty space", () => {
    render(<EditorCanvas />);
    click(atomPoint("a1"));
    expect(selection().atomIds).toEqual(["a1"]);
    // The ring centre: half a bond from every atom and further from every bond
    // axis than the grab radius reaches at this zoom.
    click(canvasPointFor({ x: 0, y: 0 }));
    expect(selection()).toEqual({ atomIds: [], bondIds: [] });
    expect(document.querySelectorAll("[data-overlay]")).toHaveLength(0);
  });

  it("keeps a multi-select when a SHIFT-click misses", () => {
    // Shift-click is "add to what I already picked", and a multi-select is
    // assembled by aiming at small targets. Missing one by two pixels must not
    // discard the four the user already collected.
    render(<EditorCanvas />);
    click(atomPoint("a1"));
    click(atomPoint("a3"), true);
    click(canvasPointFor({ x: 0, y: 0 }), true);
    expect(selection().atomIds).toEqual(["a1", "a3"]);
  });

  it("does not fire the click path at the end of a drag", () => {
    // Without the slop test, every drag that happens to end over empty space
    // also reads as a click on empty space. A drag is a drag for its whole
    // length: this one starts on an atom and ends back where it began, and
    // must still not be treated as a click on that atom.
    //
    // What it DOES do — a marquee over empty canvas selects what it encloses,
    // which here is nothing — is the assertion below. The click path would
    // have left "a1" selected instead, because the gesture ended on it.
    render(<EditorCanvas />);
    click(atomPoint("a1"));
    expect(selection().atomIds).toEqual(["a1"]);

    const svg = canvasRoot();
    const empty = canvasPointFor({ x: 6, y: 6 });
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 2,
      clientX: empty.x,
      clientY: empty.y,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 2,
      buttons: 1,
      clientX: empty.x + 40,
      clientY: empty.y + 40,
    });
    fireEvent.pointerUp(svg, {
      button: 0,
      pointerId: 2,
      clientX: empty.x,
      clientY: empty.y,
    });

    expect(selection().atomIds).toEqual([]);
    expect(selection().bondIds).toEqual([]);
  });

  it("records no undo entry for any of it", () => {
    // Clicking around a structure is not an edit. A history full of "select
    // bond / select nothing / select bond" buries the last real change under a
    // dozen presses of Ctrl+Z.
    render(<EditorCanvas />);
    const before = editorStore.getState().history;
    click(bondPoint("b9"));
    click(bondPoint("b11"), true);
    click(canvasPointFor({ x: 0, y: 0 }));
    expect(editorStore.getState().history).toBe(before);
  });
});

describe("EditorCanvas — hover", () => {
  it("hovers the atom under the pointer and draws a halo for it", () => {
    render(<EditorCanvas />);
    const svg = canvasRoot();
    const point = atomPoint("a2");
    fireEvent.pointerMove(svg, { pointerId: 1, buttons: 0, clientX: point.x, clientY: point.y });

    expect(editorStore.getState().ui.hoveredAtomId).toBe("a2");
    expect(editorStore.getState().ui.hoveredBondId).toBeNull();
    expect(
      document.querySelector('[data-overlay="hover-atom"]')?.getAttribute(
        "data-overlay-target",
      ),
    ).toBe("a2");
  });

  it("writes BOTH hover ids on every move, so no stale halo is left behind", () => {
    // Writing only the half that matched leaves the other id set from wherever
    // the pointer was last, and the overlay then draws two halos — one of them
    // on an atom the pointer left three bonds ago.
    render(<EditorCanvas />);
    const svg = canvasRoot();
    const atom = atomPoint("a2");
    fireEvent.pointerMove(svg, { pointerId: 1, buttons: 0, clientX: atom.x, clientY: atom.y });
    const bond = bondPoint("b10");
    fireEvent.pointerMove(svg, { pointerId: 1, buttons: 0, clientX: bond.x, clientY: bond.y });

    expect(editorStore.getState().ui.hoveredAtomId).toBeNull();
    expect(editorStore.getState().ui.hoveredBondId).toBe("b10");
    expect(document.querySelectorAll("[data-overlay]")).toHaveLength(1);
  });

  it("drops the hover when the pointer leaves the canvas", () => {
    render(<EditorCanvas />);
    const svg = canvasRoot();
    const point = atomPoint("a2");
    fireEvent.pointerMove(svg, { pointerId: 1, buttons: 0, clientX: point.x, clientY: point.y });
    expect(editorStore.getState().ui.hoveredAtomId).toBe("a2");

    fireEvent.pointerLeave(svg, { pointerId: 1 });
    expect(editorStore.getState().ui.hoveredAtomId).toBeNull();
    expect(editorStore.getState().ui.hoveredBondId).toBeNull();
    expect(document.querySelectorAll('[data-overlay^="hover"]')).toHaveLength(0);
  });

  it("hovers nothing over empty space", () => {
    render(<EditorCanvas />);
    const centre = canvasPointFor({ x: 0, y: 0 });
    fireEvent.pointerMove(canvasRoot(), {
      pointerId: 1,
      buttons: 0,
      clientX: centre.x,
      clientY: centre.y,
    });
    expect(editorStore.getState().ui.hoveredAtomId).toBeNull();
    expect(editorStore.getState().ui.hoveredBondId).toBeNull();
  });
});

describe("EditorCanvas — viewport chrome", () => {
  it("re-frames the molecule when Fit is pressed after a pan", () => {
    render(<EditorCanvas />);
    const fitted = editorStore.getState().viewport;

    editorStore.getState().panBy({ x: 250, y: -120 });
    expect(editorStore.getState().viewport.pan).not.toEqual(fitted.pan);

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(editorStore.getState().viewport.pan.x).toBeCloseTo(fitted.pan.x, 9);
    expect(editorStore.getState().viewport.pan.y).toBeCloseTo(fitted.pan.y, 9);
    expect(editorStore.getState().viewport.zoom).toBeCloseTo(fitted.zoom, 9);
  });

  it("keeps the fit stable however many times it is applied", () => {
    // The margin lives inside `scene.bounds`, and the canvas asks `zoomToFit`
    // for a ZERO fractional margin because of it. A second margin applied per
    // press would shrink the figure a little on every click of Fit.
    render(<EditorCanvas />);
    const first = editorStore.getState().viewport.zoom;
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    }
    expect(editorStore.getState().viewport.zoom).toBeCloseTo(first, 9);
  });

  it("reports the zoom as a percentage", () => {
    render(<EditorCanvas />);
    const zoom = editorStore.getState().viewport.zoom;
    expect(screen.getByText(`${String(Math.round(zoom * 100))}%`)).toBeInTheDocument();
  });

  it("puts its chrome outside the <svg>, so the canvas root stays the only pointer target", () => {
    render(<EditorCanvas />);
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(canvasRoot().contains(fit)).toBe(false);
  });
});

/**
 * The canvas as an EDITING surface, end to end through the real store.
 *
 * jsdom has no layout, so nothing here proves anything about geometry — every
 * point below is computed from the STORE's viewport, which is the same
 * viewport `toModel` uses when the event arrives, and that is the most this
 * harness can honestly claim. What it CAN prove is the wiring: that a drag
 * reaches the machine, that the machine's commands reach the store, and that
 * a gesture leaves exactly one entry in the history. The geometry of a drag is
 * `machine.test.ts`'s job (synthetic facts, real numbers) and the e2e spec's.
 */
describe("EditorCanvas — editing", () => {
  function drag(from: Vec2, to: Vec2, steps = 6): void {
    const svg = canvasRoot();
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 7,
      clientX: from.x,
      clientY: from.y,
    });
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      fireEvent.pointerMove(svg, {
        pointerId: 7,
        buttons: 1,
        clientX: from.x + (to.x - from.x) * t,
        clientY: from.y + (to.y - from.y) * t,
      });
    }
    fireEvent.pointerUp(svg, {
      button: 0,
      pointerId: 7,
      clientX: to.x,
      clientY: to.y,
    });
  }

  it("draws one bond and records ONE undo entry for the whole drag", () => {
    render(<EditorCanvas />);
    const before = editorStore.getState();
    const pastBefore = before.history.past.length;

    // STRAIGHT DOWN AND AWAY FROM THE RING. The direction matters: the drag
    // snaps to a 30-degree step relative to a1's own first bond and the bond
    // it draws is one bond long, so a drag aimed across the hexagon snaps onto
    // a neighbouring vertex and becomes a REFUSED ring closure — a1 and a2 are
    // already bonded. a1 sits at the bottom of the ring, so due south is the
    // one direction with nothing in it.
    drag(atomPoint("a1"), canvasPointFor({ x: 0, y: -3 }), 20);

    const after = editorStore.getState();
    expect(after.document.molecule.atomIds).toHaveLength(7);
    expect(after.document.molecule.bondIds).toHaveLength(7);
    // Twenty move frames, one entry. `record` is a no-op while a transaction
    // is in flight, which is the whole mechanism.
    expect(after.history.past.length).toBe(pastBefore + 1);
    expect(after.history.past.at(-1)?.label).toBe("Draw bond");

    expect(after.undo()).toBe(true);
    expect(editorStore.getState().document.molecule).toBe(before.document.molecule);
  });

  it("leaves the molecule byte-identical when Escape cancels the drag", () => {
    render(<EditorCanvas />);
    const molecule = editorStore.getState().document.molecule;
    const pastBefore = editorStore.getState().history.past.length;

    const svg = canvasRoot();
    const from = atomPoint("a1");
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 8,
      clientX: from.x,
      clientY: from.y,
    });
    const to = canvasPointFor({ x: 0, y: -3 });
    fireEvent.pointerMove(svg, {
      pointerId: 8,
      buttons: 1,
      clientX: to.x,
      clientY: to.y,
    });
    // Mid-drag: the bond exists in the store at this instant, by design.
    expect(editorStore.getState().document.molecule).not.toBe(molecule);

    fireEvent.keyDown(window, { key: "Escape" });

    // `abortTransaction` restores the base snapshot verbatim, so this is
    // reference identity rather than a deep compare — a strictly stronger
    // statement than "byte-identical".
    expect(editorStore.getState().document.molecule).toBe(molecule);
    expect(editorStore.getState().history.past.length).toBe(pastBefore);
    // And the cancelled drag cannot resume: the pointerup that follows must
    // neither commit nor fire a select.
    fireEvent.pointerUp(svg, {
      button: 0,
      pointerId: 8,
      clientX: to.x,
      clientY: to.y,
    });
    expect(editorStore.getState().document.molecule).toBe(molecule);
    expect(editorStore.getState().history.past.length).toBe(pastBefore);
  });

  it("moves a selected atom rather than drawing from it", () => {
    render(<EditorCanvas />);
    click(atomPoint("a1"));
    const atomCount = editorStore.getState().document.molecule.atomIds.length;

    drag(atomPoint("a1"), canvasPointFor({ x: 4, y: 4 }), 10);

    const after = editorStore.getState().document.molecule;
    // No atom was minted: a selected atom moves, an unselected one sprouts.
    expect(after.atomIds).toHaveLength(atomCount);
    expect(after.atoms["a1"]!.pos).not.toEqual(MOL.atoms["a1"]!.pos);
  });

  it("does not refit the view on every frame of a drag", () => {
    // The fit effect is guarded on `doc.id`, not on the document reference —
    // every per-move commit mints a new document, so a reference guard would
    // re-frame and re-scale the canvas sixty times a second while the user is
    // drawing, sliding the structure out from under the cursor.
    render(<EditorCanvas />);
    const viewport = editorStore.getState().viewport;

    drag(atomPoint("a1"), canvasPointFor({ x: 0, y: -3 }), 20);

    expect(editorStore.getState().viewport.zoom).toBe(viewport.zoom);
    expect(editorStore.getState().viewport.pan).toEqual(viewport.pan);
  });
});

describe("EditorCanvas — view gestures", () => {
  it("never touches the molecule when the gesture was a view gesture", () => {
    // Hovering, clicking, panning and zooming are not edits. The canvas is
    // drawable now, so this is no longer a property of the whole component —
    // but it is still a property of every gesture below, and the molecule that
    // comes out is the very object that went in, not merely an equal one.
    render(<EditorCanvas />);
    const molecule = editorStore.getState().document.molecule;

    click(atomPoint("a1"));
    click(bondPoint("b9"), true);
    click(canvasPointFor({ x: 0, y: 0 }));
    fireEvent.pointerMove(canvasRoot(), {
      pointerId: 1,
      buttons: 0,
      clientX: atomPoint("a3").x,
      clientY: atomPoint("a3").y,
    });
    editorStore.getState().panBy({ x: 30, y: 30 });
    editorStore.getState().zoomAt({ x: 100, y: 100 }, 2);

    expect(editorStore.getState().document.molecule).toBe(molecule);
    expect(editorStore.getState().document).toBe(DOC);
  });
});
