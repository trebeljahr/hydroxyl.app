/**
 * The keyboard layer, driven by synthetic events against a real store.
 *
 * `handleEditorKeyDown` is exported precisely so this can be a plain function
 * test: the alternative is mounting the whole shell and firing at `window`,
 * which proves the same thing far more slowly and with the palette, the
 * tooltips and the canvas all in the way.
 *
 * THE GUARD ORDER IS WHAT MOST OF THIS FILE IS ABOUT. Three of the four guards
 * exist because something concrete went wrong without them, and each one has
 * a test that fails if it is removed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { handleEditorKeyDown } from "./useKeyBindings";

let store: EditorStore;

beforeEach(() => {
  document.body.innerHTML = "";
  store = createEditorStore({
    document: createDocument({
      molecule: benzene(),
      now: "2024-01-01T00:00:00.000Z",
    }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
});

interface KeyInit {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly target?: Element;
  readonly defaultPrevented?: boolean;
}

function press(init: KeyInit): boolean {
  const event = new KeyboardEvent("keydown", {
    key: init.key,
    ctrlKey: init.mod === true,
    shiftKey: init.shift === true,
    altKey: init.alt === true,
    cancelable: true,
    bubbles: true,
  });
  if (init.defaultPrevented === true) event.preventDefault();
  const target = init.target ?? document.body;
  document.body.appendChild(target === document.body ? document.createTextNode("") : target);
  Object.defineProperty(event, "target", { value: target, configurable: true });
  return handleEditorKeyDown(event, { store });
}

function makeElement(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe("the guards", () => {
  it("declines an event the canvas already claimed", () => {
    // The canvas's gesture hook cancels a drag on Escape and calls
    // `stopPropagation`, which does NOT stop another listener on `window`.
    // Without the defaultPrevented check the first Escape of a two-Escape
    // sequence would cancel the drag AND put the tool down.
    store.getState().setTool("bond");
    expect(press({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(store.getState().tool).toBe("bond");

    // A second, unclaimed Escape does put it down.
    expect(press({ key: "Escape" })).toBe(true);
    expect(store.getState().tool).toBe("select");
  });

  it("is completely inert while the command palette is open", () => {
    store.getState().setCommandPaletteOpen(true);
    expect(press({ key: "d" })).toBe(false);
    expect(press({ key: "c" })).toBe(false);
    expect(press({ key: "z", mod: true })).toBe(false);
    expect(store.getState().tool).toBe("select");
  });

  it("is inert while a text input, textarea or select has focus", () => {
    for (const html of [
      '<input type="text" />',
      "<textarea></textarea>",
      "<select><option>a</option></select>",
      '<div contenteditable="true"></div>',
    ]) {
      const element = makeElement(html);
      expect(press({ key: "d", target: element }), html).toBe(false);
      expect(press({ key: "Delete", target: element }), html).toBe(false);
    }
    expect(store.getState().tool).toBe("select");
  });

  it("is NOT inert while a toolbar BUTTON has focus", () => {
    // The canvas's own `consumesSpace` matches buttons on purpose, so that
    // space activates them instead of panning. Reusing it here would make
    // every shortcut dead for as long as a tool button had focus — which is
    // the state the user is in the instant after clicking a tool.
    const button = makeElement('<button type="button">Draw bond</button>');
    expect(press({ key: "r", target: button })).toBe(true);
    expect(store.getState().tool).toBe("ring");
  });
});

describe("tools and elements share the bare letters", () => {
  it("picks up a tool by its letter", () => {
    expect(press({ key: "d" })).toBe(true);
    expect(store.getState().tool).toBe("bond");
    press({ key: "x" });
    expect(store.getState().tool).toBe("eraser");
    press({ key: "v" });
    expect(store.getState().tool).toBe("select");
  });

  it("routes a letter the registry did not claim to the element buffer", () => {
    press({ key: "c" });
    expect(store.getState().toolOptions.element).toBe("C");
    expect(store.getState().ui.elementInputBuffer).toBe("C");

    press({ key: "l" });
    expect(store.getState().toolOptions.element).toBe("Cl");
    expect(store.getState().ui.elementInputBuffer).toBe("");
  });

  it("distinguishes Cl from Ca from a bare C", () => {
    press({ key: "c" });
    press({ key: "a" });
    expect(store.getState().toolOptions.element).toBe("Ca");

    store.getState().clearElementInputBuffer();
    press({ key: "c" });
    expect(store.getState().toolOptions.element).toBe("C");
  });

  it("applies an element to the SELECTION when there is one", () => {
    store.getState().selectAtoms(["a1"]);
    press({ key: "n" });
    expect(store.getState().document.molecule.atoms["a1"]!.element).toBe("N");
  });

  it("clears a half-typed element on Escape", () => {
    press({ key: "c" });
    expect(store.getState().ui.elementInputBuffer).toBe("C");
    press({ key: "Escape" });
    expect(store.getState().ui.elementInputBuffer).toBe("");
  });
});

describe("editing shortcuts", () => {
  it("deletes the selection on Delete and on Backspace", () => {
    store.getState().selectAtoms(["a1"]);
    press({ key: "Delete" });
    expect(store.getState().document.molecule.atomIds).toHaveLength(5);

    store.getState().selectAtoms(["a2"]);
    press({ key: "Backspace" });
    expect(store.getState().document.molecule.atomIds).toHaveLength(4);
  });

  it("undoes and redoes", () => {
    store.getState().selectAtoms(["a1"]);
    press({ key: "Delete" });
    expect(store.getState().document.molecule.atomIds).toHaveLength(5);

    press({ key: "z", mod: true });
    expect(store.getState().document.molecule.atomIds).toHaveLength(6);
    press({ key: "z", mod: true, shift: true });
    expect(store.getState().document.molecule.atomIds).toHaveLength(5);
  });

  it("swallows a shortcut whose command is disabled, rather than letting it through", () => {
    // Mod+Z with nothing to undo must not reach the browser: the editor has
    // claimed the key whether or not it can act on it this instant.
    expect(store.getState().canUndo()).toBe(false);
    expect(press({ key: "z", mod: true })).toBe(true);
  });

  it("selects everything on Mod+A and clears it on Mod+Shift+A", () => {
    press({ key: "a", mod: true });
    expect(store.getState().selection.atomIds).toHaveLength(6);
    press({ key: "a", mod: true, shift: true });
    expect(store.getState().selection.atomIds).toHaveLength(0);
  });

  it("sets the bond order from 1, 2 and 3", () => {
    press({ key: "3" });
    expect(store.getState().toolOptions.bondOrder).toBe(3);
  });

  it("changes the charge with + and -", () => {
    store.getState().selectAtoms(["a1"]);
    press({ key: "+", shift: true });
    expect(store.getState().document.molecule.atoms["a1"]!.charge).toBe(1);
    press({ key: "-" });
    press({ key: "-" });
    expect(store.getState().document.molecule.atoms["a1"]!.charge).toBe(-1);
  });
});

describe("arrows", () => {
  it("nudges the selection when focus is not on the canvas", () => {
    store.getState().selectAtoms(["a1"]);
    const before = store.getState().document.molecule.atoms["a1"]!.pos;
    press({ key: "ArrowUp" });
    const after = store.getState().document.molecule.atoms["a1"]!.pos;
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.x).toBeCloseTo(before.x, 12);
  });

  it("coalesces a run of nudges into ONE history entry", () => {
    store.getState().selectAtoms(["a1"]);
    const before = store.getState().history.past.length;
    for (let i = 0; i < 10; i++) press({ key: "ArrowRight" });
    // Still inside the open transaction: nothing has been recorded yet.
    expect(store.getState().history.past.length).toBe(before);

    // Anything else closes it, and it lands as one entry.
    press({ key: "v" });
    expect(store.getState().history.past.length).toBe(before + 1);
    expect(store.getState().history.past.at(-1)?.label).toBe("Nudge selection");

    // And one undo puts the atom back where it started.
    const nudged = store.getState().document.molecule.atoms["a1"]!.pos;
    store.getState().undo();
    expect(store.getState().document.molecule.atoms["a1"]!.pos.x).not.toBeCloseTo(
      nudged.x,
      9,
    );
  });

  it("nudges by a smaller step with shift held", () => {
    store.getState().selectAtoms(["a1"]);
    const start = store.getState().document.molecule.atoms["a1"]!.pos.x;
    press({ key: "ArrowRight" });
    const coarse = store.getState().document.molecule.atoms["a1"]!.pos.x - start;

    // Close the run before undoing it: the nudge transaction is still open,
    // and `undo` inside one has nothing recorded to undo.
    press({ key: "v" });
    store.getState().undo();
    store.getState().selectAtoms(["a1"]);
    press({ key: "ArrowRight", shift: true });
    const fine = store.getState().document.molecule.atoms["a1"]!.pos.x - start;
    expect(Math.abs(fine)).toBeLessThan(Math.abs(coarse));
  });

  it("moves the roving focus instead when the canvas is focused", () => {
    const canvas = makeElement('<div data-canvas-root="true"></div>');
    store.getState().selectAtoms(["a1"]);
    const before = store.getState().document.molecule.atoms["a1"]!.pos;

    press({ key: "ArrowUp", target: canvas });

    expect(store.getState().ui.focusedAtomId).not.toBeNull();
    // And the selected atom did NOT move: on the canvas an arrow is
    // navigation, not a nudge.
    expect(store.getState().document.molecule.atoms["a1"]!.pos).toEqual(before);
  });

  it("still nudges from the canvas with the platform modifier held", () => {
    const canvas = makeElement('<div data-canvas-root="true"></div>');
    store.getState().selectAtoms(["a1"]);
    const before = store.getState().document.molecule.atoms["a1"]!.pos;
    press({ key: "ArrowUp", mod: true, target: canvas });
    expect(store.getState().document.molecule.atoms["a1"]!.pos.y).toBeGreaterThan(
      before.y,
    );
  });

  it("announces the atom it moved to", () => {
    const canvas = makeElement('<div data-canvas-root="true"></div>');
    const heard: string[] = [];
    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: canvas });
    handleEditorKeyDown(event, { store, onAnnounce: (m) => heard.push(m) });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatch(/^C, \d bonds?$/);
  });
});
