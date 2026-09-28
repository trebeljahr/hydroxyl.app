/**
 * The full periodic table behind the element picker's "Show all elements".
 *
 * jsdom runs no layout and no cascade, so what is pinned here is structure
 * and behaviour — which cells exist, what they are called, where the arrows
 * go, what a pick does to the store. The colours are measured in Chromium, in
 * e2e/shell.spec.ts, like every other picker's.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ELEMENTS, benzene, elementByZ } from "@starter/chem-core";
import type { ElementInfo } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { editorStore } from "@/state";

import { declaredColours } from "../../test/picker-colours";
import { PeriodicTableDialog } from "./PeriodicTableDialog";

beforeEach(() => {
  act(() => {
    const state = editorStore.getState();
    state.openDocument(createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }));
    state.setTool("select");
    state.setToolOption("element", "C");
    state.setRecentElements([]);
    state.setPeriodicTableOpen(false);
  });
});

function openTable(lookup?: (z: number) => ElementInfo | undefined): void {
  act(() => {
    editorStore.getState().setPeriodicTableOpen(true);
  });
  render(<PeriodicTableDialog {...(lookup === undefined ? {} : { lookup })} />);
}

function cell(symbol: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-periodic-element="${symbol}"]`);
  if (node === null) throw new Error(`no cell for ${symbol}`);
  return node;
}

function search(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: /Search elements/ });
}

describe("the periodic table dialog", () => {
  it("renders nothing while closed", () => {
    render(<PeriodicTableDialog />);
    expect(document.querySelector('[data-shell="periodic-table"]')).toBeNull();
  });

  it("offers all 118 elements, each named for a screen reader", () => {
    openTable();
    const grid = screen.getByRole("grid", { name: "Periodic table" });
    expect(within(grid).getAllByRole("row")).toHaveLength(9);
    for (const element of ELEMENTS) {
      const button = within(grid).getByRole("button", {
        name: `${element.name} (${element.symbol}), atomic number ${String(element.z)}`,
      });
      // The SYMBOL is what the cell shows; the name is for the label.
      expect(button.textContent, element.symbol).toBe(`${String(element.z)}${element.symbol}`);
      expect(button, element.symbol).not.toHaveAttribute("aria-disabled");
    }
  });

  it("marks where the f-block rows were lifted from", () => {
    openTable();
    expect(screen.getByRole("gridcell", { name: /^Lanthanides, 57 to 71/ })).toHaveTextContent(
      "57–71",
    );
    expect(screen.getByRole("gridcell", { name: /^Actinides, 89 to 103/ })).toHaveTextContent(
      "89–103",
    );
  });

  it("marks the armed element pressed, and paints it like the quick picker's selected entry", () => {
    openTable();
    expect(cell("C")).toHaveAttribute("aria-pressed", "true");
    expect(cell("N")).toHaveAttribute("aria-pressed", "false");
    expect(declaredColours(cell("C")).ground).toContain("bg-primary");
    const idle = declaredColours(cell("N"));
    expect(idle.ground).toContain("bg-popover");
    expect(idle.ink).toContain("text-popover-foreground");
  });

  it("places a picked element: the tool is armed, the dialog closes, and the pick is recent", () => {
    openTable();
    act(() => {
      fireEvent.click(cell("Pt"));
    });
    const state = editorStore.getState();
    expect(state.toolOptions.element).toBe("Pt");
    expect(state.tool).toBe("element");
    expect(state.ui.periodicTableOpen).toBe(false);
    expect(state.recentElements).toEqual(["Pt"]);
  });

  it("retypes the selected atoms instead when there is a selection", () => {
    const first = editorStore.getState().document.molecule.atomIds[0]!;
    act(() => {
      editorStore.getState().selectAtoms([first]);
    });
    openTable();
    act(() => {
      fireEvent.click(cell("Se"));
    });
    const atom = editorStore.getState().document.molecule.atoms[first];
    expect(atom?.element).toBe("Se");
  });

  it("describes the focused element, including what the drawing will lack", () => {
    openTable();
    act(() => {
      cell("Pt").focus();
    });
    const detail = document.querySelector('[data-periodic-detail]')!;
    expect(detail.textContent).toContain("Platinum");
    expect(detail.textContent).toContain("transition metal");
    expect(detail.textContent).toMatch(/No hydrogens are added to it automatically/);
  });
});

describe("searching the table", () => {
  it("narrows the table by symbol, name or atomic number, and counts the matches", () => {
    openTable();
    act(() => {
      fireEvent.change(search(), { target: { value: "sel" } });
    });
    const grid = screen.getByRole("grid", { name: "Periodic table" });
    expect(within(grid).getAllByRole("button").map((b) => b.getAttribute("data-periodic-element"))).toEqual([
      "Se",
    ]);
    expect(document.querySelector("[data-periodic-count]")).toHaveTextContent("1 element matches");

    act(() => {
      fireEvent.change(search(), { target: { value: "78" } });
    });
    expect(within(grid).getAllByRole("button")).toHaveLength(1);
    expect(cell("Pt")).toBeInTheDocument();
  });

  it("keeps the table's shape while filtering, so the matches stay where they belong", () => {
    openTable();
    act(() => {
      fireEvent.change(search(), { target: { value: "platinum" } });
    });
    // Nine rows and eighteen slots a row, whatever is left in them.
    for (const row of screen.getAllByRole("row")) {
      expect(row.children).toHaveLength(18);
    }
    expect(cell("Pt").closest("[role='gridcell']")).toHaveAttribute("aria-colindex", "10");
  });

  it("places the best match on Enter", () => {
    openTable();
    act(() => {
      fireEvent.change(search(), { target: { value: "s" } });
    });
    act(() => {
      fireEvent.keyDown(search(), { key: "Enter" });
    });
    // Sulfur, not scandium or sodium: an exact symbol outranks a prefix.
    expect(editorStore.getState().toolOptions.element).toBe("S");
    expect(editorStore.getState().ui.periodicTableOpen).toBe(false);
  });

  it("does nothing on Enter when nothing matches", () => {
    openTable();
    act(() => {
      fireEvent.change(search(), { target: { value: "xyz" } });
    });
    act(() => {
      fireEvent.keyDown(search(), { key: "Enter" });
    });
    expect(editorStore.getState().toolOptions.element).toBe("C");
    expect(editorStore.getState().ui.periodicTableOpen).toBe(true);
  });
});

describe("keyboard movement", () => {
  it("is one tab stop, starting on the armed element", () => {
    act(() => {
      editorStore.getState().setToolOption("element", "N");
    });
    openTable();
    const tabbable = screen
      .getAllByRole("button")
      .filter((b) => b.closest("[role='grid']") !== null && b.tabIndex === 0);
    expect(tabbable.map((b) => b.getAttribute("data-periodic-element"))).toEqual(["N"]);
  });

  it("moves the focus and the tab stop with the arrow keys", () => {
    openTable();
    act(() => {
      cell("C").focus();
    });
    act(() => {
      fireEvent.keyDown(cell("C"), { key: "ArrowRight" });
    });
    expect(document.activeElement).toBe(cell("N"));
    expect(cell("N").tabIndex).toBe(0);
    expect(cell("C").tabIndex).toBe(-1);

    act(() => {
      fireEvent.keyDown(cell("N"), { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(cell("P"));
  });

  it("takes the detail strip back from a parked pointer when the arrows move", () => {
    // Found in the browser: the "Show all" click leaves the pointer over a
    // cell, and its hover kept naming potassium while the arrows walked to
    // arsenic.
    openTable();
    const detail = (): string => document.querySelector("[data-periodic-detail]")!.textContent ?? "";
    act(() => {
      fireEvent.mouseEnter(cell("K"));
    });
    expect(detail()).toContain("Potassium");
    act(() => {
      cell("C").focus();
    });
    act(() => {
      fireEvent.keyDown(cell("C"), { key: "ArrowRight" });
    });
    expect(detail()).toContain("Nitrogen");
  });

  it("goes from the search box into the matches with the down arrow", () => {
    openTable();
    act(() => {
      fireEvent.change(search(), { target: { value: "pt" } });
    });
    act(() => {
      fireEvent.keyDown(search(), { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(cell("Pt"));
  });
});

describe("an element chem-core cannot handle", () => {
  // The real chem-core knows all 118, so the refusal is reached by handing
  // the table a lookup that lacks platinum.
  const withoutPlatinum = (z: number) => (z === 78 ? undefined : elementByZ(z));

  it("is shown in its cell, disabled with a reason, and refuses the click", () => {
    openTable(withoutPlatinum);
    const refused = document.querySelector<HTMLElement>('[data-periodic-z="78"]')!;
    expect(refused).toHaveAttribute("aria-disabled", "true");
    expect(refused).toHaveAccessibleName("Element 78");
    expect(refused).toHaveAccessibleDescription(/chem-core has no data for element 78/);
    expect(refused.getAttribute("title")).toMatch(/chem-core has no data for element 78/);
    // The unavailable pair, and the same one the quick picker uses for it.
    const { ground, ink } = declaredColours(refused);
    expect(ground).toContain("bg-popover");
    expect(ink).toContain("text-muted-foreground");

    act(() => {
      fireEvent.click(refused);
    });
    expect(editorStore.getState().toolOptions.element).toBe("C");
    expect(editorStore.getState().ui.periodicTableOpen).toBe(true);
  });

  it("stays reachable from the keyboard, so the reason can be heard", () => {
    openTable(withoutPlatinum);
    act(() => {
      cell("Pd").focus();
    });
    act(() => {
      fireEvent.keyDown(cell("Pd"), { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(document.querySelector('[data-periodic-z="78"]'));
  });
});
