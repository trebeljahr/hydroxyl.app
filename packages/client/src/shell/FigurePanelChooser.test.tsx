/**
 * The figure panel chooser: it explains the letters, edits the figure through
 * the store's panel actions, and paints each state the picker way (4a8a0c9) —
 * both colours named, resting and hovered, muted ink for unavailable only.
 *
 * jsdom runs no cascade, so no contrast ratio is claimed here; e2e measures
 * the resolved colours in Chromium.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { ethanol } from "@starter/chem-render";
import { DEFAULT_PANELS, VIEW_KINDS, createDocument, createPanel } from "@starter/shared";
import type { Panel } from "@starter/shared";

import { editorStore } from "@/state";

import { declaredColours, hasFocusRing, variantColours } from "../../test/picker-colours";
import { FigurePanelChooser } from "./FigurePanelChooser";
import { PLANNED_PROJECTIONS, PLANNED_PROJECTION_REASON } from "./planned-projections";

const NOW = "2024-01-01T00:00:00.000Z";

function open(molecule = ethanol(), panels?: readonly Panel[]): void {
  act(() => {
    editorStore
      .getState()
      .openDocument(
        createDocument(panels === undefined ? { molecule, now: NOW } : { molecule, panels: [...panels], now: NOW }),
      );
  });
}

function entries(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-chooser-panel]")];
}

const letters = (): string[] => entries().map((e) => e.dataset.panelLetter ?? "");
const kinds = (): string[] => entries().map((e) => e.dataset.panelKind ?? "");

function addButton(kind: string): HTMLButtonElement {
  const node = document.querySelector(`[data-add-view="${kind}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`no add button for ${kind}`);
  return node;
}

function plannedButton(id: string): HTMLButtonElement {
  const node = document.querySelector(`[data-planned-view="${id}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`no planned entry for ${id}`);
  return node;
}

beforeEach(() => {
  open();
});

describe("FigurePanelChooser explains itself", () => {
  it("says what a panel is and what the letter means in the exported figure", () => {
    render(<FigurePanelChooser />);
    const help = document.querySelector('[data-shell="panel-chooser-help"]')?.textContent ?? "";
    expect(help).toMatch(/one view/);
    expect(help).toMatch(/exported figure/);
    expect(help).toMatch(/\(a\) is the first panel/);
  });

  it("lists the figure's panels in order, lettered as the figure letters them", () => {
    render(<FigurePanelChooser />);
    expect(letters()).toEqual(["a", "b"]);
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
    expect(entries()[0]!.textContent).toContain("(a)");
    expect(entries()[1]!.textContent).toContain("Sum formula");
  });

  it("says so when the figure has no panels", () => {
    open(ethanol(), []);
    render(<FigurePanelChooser />);
    expect(entries()).toHaveLength(0);
    expect(document.querySelector('[data-shell="panel-chooser-empty"]')).not.toBeNull();
  });
});

describe("FigurePanelChooser edits the figure", () => {
  it("adds a view at the end, as the next letter", () => {
    render(<FigurePanelChooser />);
    fireEvent.click(addButton("lewis"));
    expect(kinds()).toEqual(["skeletal", "sumFormula", "lewis"]);
    expect(letters()).toEqual(["a", "b", "c"]);
    expect(editorStore.getState().document.panels.map((p) => p.representation.kind)).toEqual([
      "skeletal",
      "sumFormula",
      "lewis",
    ]);
  });

  it("offers every view kind, and a second panel of a kind already in the figure", () => {
    render(<FigurePanelChooser />);
    for (const kind of VIEW_KINDS) addButton(kind);
    fireEvent.click(addButton("skeletal"));
    expect(kinds()).toEqual(["skeletal", "sumFormula", "skeletal"]);
  });

  it("moves a panel earlier and later, and the letters follow the order", () => {
    render(<FigurePanelChooser />);
    fireEvent.click(addButton("lewis"));
    fireEvent.click(screen.getByLabelText("Move panel (c) earlier"));
    expect(kinds()).toEqual(["skeletal", "lewis", "sumFormula"]);
    fireEvent.click(screen.getByLabelText("Move panel (a) later"));
    expect(kinds()).toEqual(["lewis", "skeletal", "sumFormula"]);
  });

  it("cannot move the first panel earlier or the last later", () => {
    render(<FigurePanelChooser />);
    const first = screen.getByLabelText<HTMLButtonElement>("Move panel (a) earlier");
    const last = screen.getByLabelText<HTMLButtonElement>("Move panel (b) later");
    expect(first.disabled).toBe(true);
    expect(last.disabled).toBe(true);
    fireEvent.click(first);
    fireEvent.click(last);
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
  });

  it("removes a panel, and the later letters close up", () => {
    render(<FigurePanelChooser />);
    fireEvent.click(addButton("lewis"));
    fireEvent.click(screen.getByLabelText("Remove panel (a) from the figure"));
    expect(kinds()).toEqual(["sumFormula", "lewis"]);
    expect(letters()).toEqual(["a", "b"]);
  });

  it("is one undo step per edit, like the properties panel list", () => {
    render(<FigurePanelChooser />);
    fireEvent.click(addButton("lewis"));
    act(() => editorStore.getState().undo());
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
  });
});

describe("FigurePanelChooser refuses what cannot be drawn", () => {
  it("disables a view the molecule has no form of, with the reason in words", () => {
    open(benzene());
    render(<FigurePanelChooser />);
    const condensed = addButton("condensed");
    expect(condensed.disabled).toBe(true);
    const reason = document.querySelector('[data-add-view-reason="condensed"]');
    expect(reason?.textContent).toMatch(/ring has no condensed formula/);
    expect(condensed.getAttribute("aria-describedby")).toBe(reason?.id);
    // A scripted click still reaches onClick; the store must not hear of it.
    fireEvent.click(condensed);
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
  });

  it("marks a panel already in the figure that has become unavailable", () => {
    const condensed = createPanel("condensed");
    open(benzene(), [...DEFAULT_PANELS, condensed]);
    render(<FigurePanelChooser />);
    const entry = document.querySelector<HTMLElement>(`[data-chooser-panel="${condensed.id}"]`)!;
    expect(entry.querySelector("[data-chooser-reason]")?.textContent).toMatch(
      /ring has no condensed formula.*will not export/,
    );
    expect(entry.querySelector("[data-chooser-panel-title]")?.className).toContain("line-through");
    // Still removable: that is the way out.
    fireEvent.click(screen.getByLabelText("Remove panel (c) from the figure"));
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
  });

  it("lists every planned projection, disabled, saying what it draws and why it is not here", () => {
    render(<FigurePanelChooser />);
    const reason = document.querySelector('[data-shell="planned-projection-reason"]');
    expect(reason?.textContent).toBe(PLANNED_PROJECTION_REASON);
    for (const planned of PLANNED_PROJECTIONS) {
      const button = plannedButton(planned.id);
      expect(button.disabled, planned.id).toBe(true);
      expect(button.textContent).toContain(planned.title);
      expect(button.textContent).toContain(planned.shows);
      expect(button.getAttribute("aria-describedby")).toBe(reason?.id);
      fireEvent.click(button);
    }
    expect(kinds()).toEqual(["skeletal", "sumFormula"]);
  });

  it("stores no projection from any of its controls yet, so the planned list is honest", () => {
    // A panel CAN store a view since decision 128 (`Panel.view`), but no
    // control here sets one. The day one does, this fails: remove that
    // projection from PLANNED_PROJECTIONS, or it is offered twice.
    render(<FigurePanelChooser />);
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-shell="panel-chooser"] button'),
    ];
    expect(buttons.length).toBeGreaterThan(VIEW_KINDS.length + PLANNED_PROJECTIONS.length);
    for (const button of buttons) {
      if (button.isConnected && !button.disabled) fireEvent.click(button);
    }
    const panels = editorStore.getState().document.panels;
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.filter((panel) => Object.hasOwn(panel, "view"))).toEqual([]);
  });
});

describe("FigurePanelChooser states", () => {
  it("names a ground and an ink on every entry, live and unavailable alike", () => {
    open(benzene());
    render(<FigurePanelChooser />);
    const controls = document.querySelectorAll(
      '[data-shell="panel-chooser"] button, [data-chooser-panel]',
    );
    expect(controls.length).toBeGreaterThan(15);
    for (const control of controls) {
      const { ground, ink } = declaredColours(control);
      const what = control.getAttribute("aria-label") ?? control.textContent ?? "?";
      expect(ground, what).toContain("bg-popover");
      expect(ink, what).toHaveLength(1);
    }
  });

  it("lights a live entry up on hover, and holds an unavailable one still", () => {
    open(benzene());
    render(<FigurePanelChooser />);

    const live = variantColours(addButton("lewis"), "hover:");
    expect(live.ground).toEqual(["bg-accent"]);
    expect(live.ink).toEqual(["text-accent-foreground"]);
    expect(hasFocusRing(addButton("lewis"))).toBe(true);

    // Not `bg-accent`: muted ink on the accent ground is 4.349:1 in light mode.
    for (const refused of [addButton("condensed"), plannedButton("fischer")]) {
      const hover = variantColours(refused, "hover:");
      expect(hover.ground).toEqual(["bg-popover"]);
      expect(hover.ink).toEqual(["text-muted-foreground"]);
      expect(declaredColours(refused).ink).toEqual(["text-muted-foreground"]);
    }
  });

  it("keeps the muted ink for unavailable things only", () => {
    // The reported bug behind 4a8a0c9 was one grey doing two jobs. Here every
    // muted element is either a disabled control or the reason one gives.
    open(benzene());
    render(<FigurePanelChooser />);
    const muted = document.querySelectorAll(
      '[data-shell="panel-chooser"] .text-muted-foreground',
    );
    expect(muted.length).toBeGreaterThan(0);
    for (const node of muted) {
      const isDisabledControl = node instanceof HTMLButtonElement && node.disabled;
      const isReason =
        node.hasAttribute("data-add-view-reason") ||
        node.hasAttribute("data-chooser-reason") ||
        node.getAttribute("data-shell") === "planned-projection-reason";
      expect(isDisabledControl || isReason, node.outerHTML.slice(0, 120)).toBe(true);
    }
    // And no live control wears it.
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-shell="panel-chooser"] button:not(:disabled)',
    )) {
      expect(declaredColours(button).ink).not.toContain("text-muted-foreground");
    }
  });
});
