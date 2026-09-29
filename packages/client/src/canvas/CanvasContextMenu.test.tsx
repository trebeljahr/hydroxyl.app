/**
 * The context menu as the user meets it: a right-click (or a held finger)
 * lands on the real canvas, the real store selects what it hit, and the real
 * menu opens with that target's entries.
 *
 * Driven through `EditorCanvas`, not through `CanvasContextMenu` alone,
 * because the failures worth catching live in the wiring — a pick against the
 * wrong viewport, a menu that opens without selecting what it will act on, a
 * long-press whose release still clicks the atom under the finger.
 *
 * jsdom lays nothing out and runs no cascade, so the colours are asserted as
 * the classes each state DECLARES (the picker-state convention's reading, via
 * `test/picker-colours`); what Chromium resolves them to is measured in
 * e2e/context-menu.spec.ts.
 */

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireBond } from "@starter/chem-core";
import type { Vec2 } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";

import { setClipboardForTest } from "@/editor/commands/registry";
import { editorStore, toScreen } from "@/state";

import { declaredColours, variantColours } from "../../test/picker-colours";
import { EditorCanvas } from "./EditorCanvas";
import { fixtureDocument } from "./fixture";
import { renderStyleFor } from "./scene-bridge";
import { LONG_PRESS_MS } from "./useCanvasGestures";

const DOC = fixtureDocument("2024-01-01T00:00:00.000Z");
const MOL = DOC.molecule;

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(DOC);
  state.clearSelection();
  state.setHoveredAtom(null);
  state.setHoveredBond(null);
  state.setTool("select");
  state.setToolOption("bondOrder", 1);
  state.setViewportSize({ width: 800, height: 600 });
  state.resetViewport();
  setClipboardForTest(null);
});

function canvasRoot(): SVGSVGElement {
  const svg = document.querySelector('[data-canvas-root="true"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error("no canvas root");
  return svg;
}

/** At the open document's style, which for the fixture is Publication. */
function canvasPointFor(model: Vec2): Vec2 {
  const state = editorStore.getState();
  return toScreen(state.viewport, modelToPx(renderStyleFor(state.document), model));
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

/** The benzene fixture's centre: inside the ring, on no atom and no bond. */
function emptyPoint(): Vec2 {
  const xs = MOL.atomIds.map((id) => MOL.atoms[id]!.pos.x);
  const ys = MOL.atomIds.map((id) => MOL.atoms[id]!.pos.y);
  return canvasPointFor({
    x: xs.reduce((a, b) => a + b) / xs.length,
    y: ys.reduce((a, b) => a + b) / ys.length,
  });
}

function rightClick(point: Vec2): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    clientX: point.x,
    clientY: point.y,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    canvasRoot().dispatchEvent(event);
  });
  return event;
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-context-menu]");
}

function entry(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-menu-entry="${id}"]`);
  if (found === null) throw new Error(`no menu entry ${id}`);
  return found;
}

/** Radix opens a submenu on its trigger's click as well as on hover. */
function openSubmenu(id: string): void {
  const trigger = document.querySelector<HTMLElement>(`[data-menu-submenu="${id}"]`);
  if (trigger === null) throw new Error(`no submenu ${id}`);
  act(() => {
    fireEvent.pointerMove(trigger);
    fireEvent.click(trigger);
  });
}

function shortcutOf(id: string): string | null {
  return entry(id).querySelector("[data-shortcut]")?.textContent ?? null;
}

describe("right-click on an atom", () => {
  it("replaces the browser's menu with the atom menu, and selects the atom it acts on", () => {
    render(<EditorCanvas />);
    const event = rightClick(atomPoint("a1"));
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("data-context-menu")).toBe("atom");
    expect(document.querySelector("[data-context-menu-title]")?.textContent).toMatch(/^C, 2 bonds/);
    expect(editorStore.getState().selection).toEqual({ atomIds: ["a1"], bondIds: [], annotationIds: [] });
    for (const id of ["element", "isotope", "hydrogens", "lone-pairs", "stereo"]) {
      expect(document.querySelector(`[data-menu-submenu="${id}"]`), id).not.toBeNull();
    }
    expect(shortcutOf("structure.charge-up")).toBe("+");
    expect(shortcutOf("edit.delete")).toBe("Delete");
  });

  it("retypes the atom from the element submenu, typed symbol shown as its key", () => {
    render(<EditorCanvas />);
    rightClick(atomPoint("a1"));
    openSubmenu("element");
    expect(shortcutOf("element.N")).toBe("N");
    act(() => {
      fireEvent.click(entry("element.N"));
    });
    expect(editorStore.getState().document.molecule.atoms["a1"]!.element).toBe("N");
    expect(menu()).toBeNull();
  });

  it("opens the full periodic table from the element submenu, and leaves focus in it", async () => {
    render(<EditorCanvas />);
    rightClick(atomPoint("a1"));
    openSubmenu("element");
    act(() => {
      fireEvent.click(entry("element.table"));
    });
    expect(editorStore.getState().ui.periodicTableOpen).toBe(true);
    // The menu's own focus return waits a task. A dialog opened by the entry
    // may have taken focus by then, and the canvas must not take it back.
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
    editorStore.getState().setPeriodicTableOpen(false);
  });
});

describe("right-click on a bond", () => {
  it("offers the three orders with their keys, and sets the one clicked", () => {
    render(<EditorCanvas />);
    const bondId = MOL.bondIds.find((id) => requireBond(MOL, id).order === 1)!;
    rightClick(bondPoint(bondId));
    expect(menu()?.getAttribute("data-context-menu")).toBe("bond");
    expect(editorStore.getState().selection).toEqual({ atomIds: [], bondIds: [bondId], annotationIds: [] });
    expect(shortcutOf("bond.order.1")).toBe("1");
    expect(shortcutOf("bond.order.2")).toBe("2");
    expect(shortcutOf("bond.order.3")).toBe("3");
    expect(entry("bond.order.1").getAttribute("aria-checked")).toBe("true");
    expect(entry("bond.order.1").getAttribute("role")).toBe("menuitemradio");

    act(() => {
      fireEvent.click(entry("bond.order.2"));
    });
    expect(requireBond(editorStore.getState().document.molecule, bondId).order).toBe(2);
    expect(menu()).toBeNull();
    // One undo step takes it back.
    editorStore.getState().undo();
    expect(requireBond(editorStore.getState().document.molecule, bondId).order).toBe(1);
  });
});

describe("right-click inside a selection", () => {
  it("keeps the selection and offers the selection menu", () => {
    render(<EditorCanvas />);
    editorStore.getState().selectAll();
    const before = editorStore.getState().selection;
    rightClick(atomPoint("a3"));
    expect(menu()?.getAttribute("data-context-menu")).toBe("selection");
    expect(editorStore.getState().selection).toBe(before);
    expect(document.querySelector("[data-context-menu-title]")?.textContent).toBe(
      "6 atoms, 6 bonds selected",
    );
    for (const id of ["edit.cut", "edit.copy", "structure.flip-horizontal", "select.invert"]) {
      expect(entry(id).hasAttribute("data-unavailable"), id).toBe(false);
    }
    expect(shortcutOf("edit.copy")).toBe("Ctrl+C");
    openSubmenu("rotate");
    act(() => {
      fireEvent.click(entry("structure.rotate-180"));
    });
    const moved = editorStore.getState().document.molecule;
    expect(moved.atoms["a1"]!.pos.x).toBeCloseTo(MOL.atoms["a4"]!.pos.x, 9);
  });
});

describe("right-click on empty canvas", () => {
  it("leaves the selection alone and offers paste, undo and the view", () => {
    render(<EditorCanvas />);
    editorStore.getState().selectAtoms(["a2"]);
    rightClick(emptyPoint());
    expect(menu()?.getAttribute("data-context-menu")).toBe("canvas");
    expect(editorStore.getState().selection.atomIds).toEqual(["a2"]);
    expect(shortcutOf("edit.undo")).toBe("Ctrl+Z");
    expect(shortcutOf("view.command-palette")).toBe("Ctrl+K");
  });

  it("greys paste with its reason on the row, and swallows its click", () => {
    render(<EditorCanvas />);
    rightClick(emptyPoint());
    const paste = entry("edit.paste");
    expect(paste.hasAttribute("data-unavailable")).toBe(true);
    expect(paste.getAttribute("aria-disabled")).toBe("true");
    // Focusable, not `disabled`: a keyboard user has to be able to land on it
    // to hear why.
    expect(paste.hasAttribute("data-disabled")).toBe(false);
    const reason = paste.querySelector("[data-disabled-reason]")?.textContent ?? "";
    expect(reason).toMatch(/Nothing has been copied/);
    expect(paste.getAttribute("title")).toBe(reason);

    const before = editorStore.getState().document.molecule;
    act(() => {
      fireEvent.click(paste);
    });
    expect(menu()).not.toBeNull();
    expect(editorStore.getState().document.molecule).toBe(before);
  });
});

describe("the entries' states (the picker-state convention)", () => {
  it("names a ground and an ink on every row, live and unavailable alike", () => {
    render(<EditorCanvas />);
    rightClick(emptyPoint());
    for (const row of document.querySelectorAll("[data-menu-entry]")) {
      const id = row.getAttribute("data-menu-entry") ?? "?";
      const { ground, ink } = declaredColours(row);
      expect(ground, id).toEqual(["bg-popover"]);
      expect(ink, id).toHaveLength(1);
    }
  });

  it("lights a live row up under the pointer and the keyboard alike", () => {
    render(<EditorCanvas />);
    rightClick(emptyPoint());
    const live = entry("view.fit");
    for (const prefix of ["hover:", "data-[highlighted]:"]) {
      const colours = variantColours(live, prefix);
      expect(colours.ground, prefix).toEqual(["bg-accent"]);
      expect(colours.ink, prefix).toEqual(["text-accent-foreground"]);
    }
  });

  it("holds an unavailable row's muted pair through hover and highlight", () => {
    // `text-muted-foreground` on `bg-accent` is 4.349:1 in light mode, under
    // the floor; on `bg-popover` it is 4.742:1. So the row does not move.
    render(<EditorCanvas />);
    rightClick(emptyPoint());
    const refused = entry("edit.paste");
    expect(declaredColours(refused).ink).toEqual(["text-muted-foreground"]);
    for (const prefix of ["hover:", "data-[highlighted]:"]) {
      const colours = variantColours(refused, prefix);
      expect(colours.ground, prefix).toEqual(["bg-popover"]);
      expect(colours.ink, prefix).toEqual(["text-muted-foreground"]);
    }
    // And "unavailable" is said by signals that are not a colour.
    expect(refused.querySelector(".line-through")).not.toBeNull();
    expect(refused.getAttribute("class")).toContain("cursor-not-allowed");
  });
});

describe("closing", () => {
  it("keeps the browser's menu shut for a second right-click while ours is open", () => {
    render(<EditorCanvas />);
    rightClick(atomPoint("a1"));
    // The modal layer takes pointer events off the page, so the browser
    // targets the root element with the second click, not the canvas.
    const second = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      document.documentElement.dispatchEvent(second);
    });
    expect(second.defaultPrevented).toBe(true);
  });

  it("stops swallowing right-clicks elsewhere once it has closed", () => {
    render(<EditorCanvas />);
    rightClick(atomPoint("a1"));
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    const later = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      document.body.dispatchEvent(later);
    });
    expect(later.defaultPrevented).toBe(false);
  });

  it("closes on Escape and hands focus back to the canvas", async () => {
    render(<EditorCanvas />);
    rightClick(atomPoint("a1"));
    expect(menu()).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(menu()).toBeNull();
    // Radix restores focus from a zero-delay timeout after the content
    // unmounts, so the canvas has it one task later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(canvasRoot());
  });
});

describe("long-press on touch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function touch(type: string, point: Vec2): void {
    const event = new MouseEvent(type, {
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "pointerId", { value: 3 });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    act(() => {
      canvasRoot().dispatchEvent(event);
    });
  }

  it("opens the atom menu, and the finger's lift does not retype the atom", () => {
    render(<EditorCanvas />);
    // The element tool is where a stray click would do damage: a click on an
    // atom retypes it to the armed element.
    editorStore.getState().setToolOption("element", "N");
    editorStore.getState().setTool("element");
    const before = editorStore.getState().document.molecule;

    touch("pointerdown", atomPoint("a2"));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    touch("pointerup", atomPoint("a2"));

    expect(menu()?.getAttribute("data-context-menu")).toBe("atom");
    expect(document.querySelector("[data-context-menu-title]")?.textContent).toMatch(/^C, 2 bonds/);
    expect(editorStore.getState().document.molecule).toBe(before);
    expect(editorStore.getState().selection.atomIds).toEqual(["a2"]);
  });
});
