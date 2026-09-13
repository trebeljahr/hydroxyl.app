import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzylAlcoholAbbreviated, ethanol } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { editorStore } from "@/state";

import { FigurePanels } from "./FigurePanels";

function open(molecule = ethanol()): void {
  act(() => {
    editorStore
      .getState()
      .openDocument(createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }));
    editorStore.getState().setStatusMessage(null);
  });
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-panel-id]")];
}

beforeEach(() => {
  open();
});

describe("FigurePanels", () => {
  it("lists the panels with their (a)(b) labels", () => {
    render(<FigurePanels />);
    expect(rows().map((row) => row.dataset.panelLabel)).toEqual(["(a)", "(b)"]);
    expect(rows().map((row) => row.dataset.panelKind)).toEqual(["skeletal", "sumFormula"]);
  });

  it("adds a panel, moves it up with Alt+ArrowUp, and removes it", () => {
    render(<FigurePanels />);
    fireEvent.click(screen.getByText("Add panel"));
    expect(rows().map((row) => row.dataset.panelKind)).toEqual(["skeletal", "sumFormula", "lewis"]);

    fireEvent.keyDown(rows()[2]!, { key: "ArrowUp", altKey: true });
    expect(rows().map((row) => row.dataset.panelKind)).toEqual(["skeletal", "lewis", "sumFormula"]);

    fireEvent.click(screen.getByLabelText("Move panel (b) down"));
    expect(rows().map((row) => row.dataset.panelKind)).toEqual(["skeletal", "sumFormula", "lewis"]);

    fireEvent.click(screen.getByLabelText("Remove panel (c)"));
    expect(rows()).toHaveLength(2);
  });

  it("commits a caption on blur", () => {
    render(<FigurePanels />);
    const caption = rows()[0]!.querySelector<HTMLInputElement>("[data-panel-caption]")!;
    fireEvent.change(caption, { target: { value: "Ethanol, skeletal" } });
    fireEvent.blur(caption);
    expect(editorStore.getState().document.panels[0]?.caption).toBe("Ethanol, skeletal");
  });

  it("states the reason in the list when a panel's view is unavailable", () => {
    open(benzylAlcoholAbbreviated());
    render(<FigurePanels />);
    const formula = rows()[1]!;
    expect(formula.dataset.panelUnavailable).toBe("true");
    expect(formula.querySelector("[data-panel-reason]")?.textContent).toMatch(
      /Ph is drawn as an abbreviation/,
    );
    expect(rows()[0]!.querySelector("[data-panel-reason]")).toBeNull();
  });

  it("sets and clears the column count", () => {
    render(<FigurePanels />);
    const field = screen.getByLabelText("Columns");
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.blur(field);
    expect(editorStore.getState().document.figure).toEqual({ columns: 1 });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(editorStore.getState().document.figure).toBeUndefined();
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(editorStore.getState().document.figure).toBeUndefined();
    expect(editorStore.getState().ui.statusMessage).toMatch(/whole number/);
  });
});
