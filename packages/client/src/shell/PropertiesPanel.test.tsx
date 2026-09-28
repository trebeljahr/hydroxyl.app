/**
 * The properties panel, against a real store.
 *
 * The assertions worth having are the ones about what the panel REFUSES and
 * about what it does not offer at all — the fields themselves are thin
 * wrappers over chem-core ops that already have their own tests.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzene, buildMolecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { handleEditorKeyDown } from "@/editor/useKeyBindings";
import { editorStore } from "@/state";

import { PropertiesPanel } from "./PropertiesPanel";

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(
    createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
  );
  state.clearSelection();
  state.setStatusMessage(null);
});

function select(atomIds: readonly string[], bondIds: readonly string[] = []): void {
  act(() => {
    editorStore.getState().setSelection({ atomIds, bondIds, annotationIds: [] });
  });
}

function field(label: string): HTMLInputElement {
  const node = screen.getByText(label).parentElement?.querySelector("input");
  if (!(node instanceof HTMLInputElement)) throw new Error(`no "${label}" field`);
  return node;
}

function atom(id: string) {
  return editorStore.getState().document.molecule.atoms[id]!;
}

describe("PropertiesPanel — nothing, or too much, selected", () => {
  it("asks for a selection when there is none", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText(/Select one atom or one bond/)).toBeTruthy();
  });

  it("says so rather than guessing when several things are selected", () => {
    render(<PropertiesPanel />);
    select(["a1", "a2", "a3"]);
    expect(screen.getByText(/3 things selected/)).toBeTruthy();
  });
});

describe("PropertiesPanel — an atom", () => {
  it("edits the charge, and one undo puts it back", () => {
    render(<PropertiesPanel />);
    select(["a1"]);

    const charge = field("Charge");
    act(() => {
      fireEvent.change(charge, { target: { value: "-1" } });
      fireEvent.blur(charge);
    });
    expect(atom("a1").charge).toBe(-1);

    act(() => {
      editorStore.getState().undo();
    });
    expect(atom("a1").charge).toBe(0);
  });

  it("keeps a lone minus sign long enough to become a negative number", () => {
    // The reason the field holds a draft string: writing the store per
    // keystroke would reject "-" as NaN, and the sign would never survive to
    // be followed by a digit.
    render(<PropertiesPanel />);
    select(["a1"]);
    const charge = field("Charge");
    act(() => {
      fireEvent.change(charge, { target: { value: "-" } });
    });
    expect(charge.value).toBe("-");
    expect(atom("a1").charge).toBe(0);
  });

  it("clears an isotope back to natural abundance with an empty field", () => {
    render(<PropertiesPanel />);
    select(["a1"]);
    const isotope = field("Isotope");
    act(() => {
      fireEvent.change(isotope, { target: { value: "13" } });
      fireEvent.blur(isotope);
    });
    expect(atom("a1").isotope).toBe(13);

    act(() => {
      fireEvent.change(isotope, { target: { value: "" } });
      fireEvent.blur(isotope);
    });
    // The KEY is gone, not set to undefined — that is chem-core's contract and
    // what keeps a saved document from carrying an undefined-valued field.
    expect(Object.hasOwn(atom("a1"), "isotope")).toBe(false);
  });

  it("normalises a loose element symbol and refuses one that is not an element", () => {
    // `setElement` writes whatever string it is handed — ElementSymbol is
    // deliberately `string`, since an editor must be able to hold an element
    // the table does not know. Validating is the caller's job, and an atom
    // typed "carbo" would derive no valence, no mass and no formula.
    render(<PropertiesPanel />);
    select(["a1"]);

    act(() => {
      fireEvent.blur(field("Element"), { target: { value: "cl" } });
    });
    expect(atom("a1").element).toBe("Cl");

    // RE-QUERIED, not reused: the field is keyed on the atom's element so it
    // remounts when the element changes, and the old node is detached.
    act(() => {
      fireEvent.blur(field("Element"), { target: { value: "carbo" } });
    });
    expect(atom("a1").element).toBe("Cl");
    expect(editorStore.getState().ui.statusMessage).toContain("not an element");
  });

  it("warns that a display label blocks the molfile path", () => {
    // Decision 8: writeMolblock THROWS on a labelled atom so a Ph is never
    // silently written as a methyl — which means Clean up structure, which
    // goes through a molblock, refuses for that molecule.
    render(<PropertiesPanel />);
    select(["a1"]);
    expect(screen.getByText(/cannot be written to a molfile/)).toBeTruthy();
  });

  it("offers no control for the aromatic flag", () => {
    // Kekule is the storage form and aromaticity is derived. A checkbox here
    // would put a lie into the model that every downstream pass has to honour.
    render(<PropertiesPanel />);
    select(["a1"]);
    expect(screen.queryByText(/aromatic/i)).toBeNull();
  });
});

describe("PropertiesPanel — a bond", () => {
  it("shows the bond's order, stereo and double-bond side", () => {
    const mol = buildMolecule((b) => {
      const a = b.atom("C", { x: 0, y: 0 });
      const c = b.atom("C", { x: 1, y: 0 });
      b.bond(a, c, 2);
    });
    act(() => {
      editorStore
        .getState()
        .openDocument(createDocument({ molecule: mol, now: "2024-01-01T00:00:00.000Z" }));
    });
    render(<PropertiesPanel />);
    select([], [editorStore.getState().document.molecule.bondIds[0]!]);

    expect(screen.getByText("Double")).toBeTruthy();
    expect(screen.getByText("Plain")).toBeTruthy();
    expect(screen.getByText("auto")).toBeTruthy();
  });

  it("flips the wedge by swapping the endpoints, leaving the stereo name alone", () => {
    render(<PropertiesPanel />);
    const bondId = editorStore.getState().document.molecule.bondIds[0]!;
    const before = editorStore.getState().document.molecule.bonds[bondId]!;
    select([], [bondId]);

    act(() => {
      fireEvent.click(screen.getByText("Flip wedge direction"));
    });
    const after = editorStore.getState().document.molecule.bonds[bondId]!;
    expect(after.from).toBe(before.to);
    expect(after.to).toBe(before.from);
    expect(after.stereo).toBe(before.stereo);
  });
});

describe("PropertiesPanel — the keyboard layer must not reach through it", () => {
  /**
   * THE REAL RADIX MARKUP, not an approximation of it.
   *
   * The guard in `useKeyBindings` used to match `input, textarea, select,
   * [contenteditable]`, and a Radix Select is none of those — it renders a
   * `<button role="combobox">`, with no popper wrapper at all while it is
   * closed. So with a bond selected and the Order control focused, a single
   * `d` switched to the bond tool AND retyped the bond as a double; `t` made
   * it a triple and put two valence errors on the canvas. One keystroke, two
   * edits, no menu ever opened. Rendering the panel and firing at the actual
   * trigger is the only version of this test that would have caught it.
   */
  it("swallows a bare letter typed at a Radix Select trigger", () => {
    render(<PropertiesPanel />);
    select([], ["b7"]);
    const trigger = screen.getAllByRole("combobox")[0];
    expect(trigger, "the panel should render a Radix Select").toBeTruthy();
    expect(trigger?.tagName).toBe("BUTTON");

    const before = editorStore.getState().document.molecule.bonds["b7"]?.order;
    for (const key of ["d", "t", "2", "3", "Delete"]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      Object.defineProperty(event, "target", { value: trigger });
      expect(handleEditorKeyDown(event), key).toBe(false);
    }
    expect(editorStore.getState().document.molecule.bonds["b7"]?.order).toBe(
      before,
    );
    expect(editorStore.getState().tool).toBe("select");
  });
});
