/**
 * The switcher's view options are a second door onto the display flags, so
 * they must say what the palette says: every flag listed, the locants toggle
 * named as locants (decision 18), disabled with the registry's reason over a
 * document that numbers nothing (decision 37), live over one that numbers an
 * atom (decision 168), and live while locants are on, so it can switch them
 * off (decision 56).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readMolblock } from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { ethanol } from "@starter/chem-render";
import { DISPLAY_FLAG_KEYS, createDocument } from "@starter/shared";

import { commandById } from "@/editor/commands/registry";
import { editorStore } from "@/state";

import { RepresentationSwitcher } from "./RepresentationSwitcher";
import { buildCanvasScene, canvasPanelFor } from "./scene-bridge";

beforeEach(() => {
  act(() => {
    editorStore
      .getState()
      .openDocument(createDocument({ molecule: ethanol(), now: "2024-01-01T00:00:00.000Z" }));
  });
});

function openOptions(): void {
  render(<RepresentationSwitcher />);
  // Radix opens a popover on pointerdown in some versions and on click in
  // others; a click fires both paths jsdom supports.
  const trigger = screen.getByText("View options");
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
}

function checkbox(key: string): HTMLInputElement {
  const box = document.querySelector<HTMLInputElement>(`[data-view-flag="${key}"]`);
  expect(box, key).not.toBeNull();
  return box!;
}

describe("RepresentationSwitcher view options", () => {
  it("lists every display flag, and nothing called an atom index", () => {
    openOptions();
    for (const key of DISPLAY_FLAG_KEYS) checkbox(key);
    expect(document.querySelector('[data-view-flag="showAtomIndices"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/atom ind/i);
  });

  it("shows the locants toggle disabled over ethanol, which nothing numbers, with the registry's reason", () => {
    openOptions();
    const locants = checkbox("showLocants");
    expect(locants.disabled).toBe(true);
    expect(locants.checked).toBe(false);
    const reason = commandById("view.show-locants").disabledReason?.(editorStore.getState());
    expect(reason).toMatch(/numbering/i);
    const label = locants.closest("label")!;
    expect(label.textContent).toContain("Locants");
    expect(label.getAttribute("title")).toBe(reason);
    expect(label.querySelector("[data-disabled-reason]")?.textContent).toBe(reason);

    // Clicking a disabled box changes nothing on the document.
    fireEvent.click(locants);
    for (const panel of editorStore.getState().document.panels) {
      expect(panel.representation.display.showLocants, panel.id).toBe(false);
    }
  });

  it("enables the locants box while locants are on, and disables it once off (decision 56)", () => {
    act(() => {
      const state = editorStore.getState();
      for (const panel of state.document.panels) {
        state.updatePanel(panel.id, { display: { showLocants: true } });
      }
    });
    openOptions();
    const locants = checkbox("showLocants");
    expect(locants.checked).toBe(true);
    expect(locants.disabled).toBe(false);
    const label = (): HTMLLabelElement => checkbox("showLocants").closest("label")!;
    expect(label().getAttribute("title")).toBeNull();
    expect(label().querySelector("[data-disabled-reason]")).toBeNull();

    act(() => {
      fireEvent.click(locants);
    });
    // The panel the switcher shows is the one it writes to.
    const shown = (): boolean => {
      const state = editorStore.getState();
      return canvasPanelFor(state.document, state.ui.activePanelId)!.representation.display.showLocants;
    };
    expect(shown()).toBe(false);
    const off = checkbox("showLocants");
    expect(off.checked).toBe(false);
    expect(off.disabled).toBe(true);
    expect(label().querySelector("[data-disabled-reason]")?.textContent).toMatch(/numbering/i);
    // And it stays off: a click on the disabled box switches nothing on.
    act(() => {
      fireEvent.click(off);
    });
    expect(shown()).toBe(false);
  });

  it("enables the locants box over a numbered document, and the canvas draws them (decision 168)", () => {
    // Beta-D-glucopyranose: the ring carbons C1 to C5, and C6.
    act(() => {
      editorStore.getState().openDocument(
        createDocument({
          molecule: readMolblock(dictionaryEntryById("beta-d-glucopyranose")!.molblock).molecule,
          now: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    openOptions();
    const locants = checkbox("showLocants");
    expect(locants.checked).toBe(false);
    expect(locants.disabled).toBe(false);
    expect(locants.closest("label")!.querySelector("[data-disabled-reason]")).toBeNull();

    act(() => {
      fireEvent.click(locants);
    });
    const state = editorStore.getState();
    const drawn = buildCanvasScene(state.document, state.ui.activePanelId).primitives.flatMap((p) =>
      p.type === "textRun" && p.id.endsWith(":locant") ? [p.spans.map((s) => s.text).join("")] : [],
    );
    expect(drawn.sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    // On, and still live: it can be switched back off.
    expect(checkbox("showLocants").checked).toBe(true);
    expect(checkbox("showLocants").disabled).toBe(false);
  });

  it("leaves every other flag live, with no reason attached", () => {
    openOptions();
    for (const key of DISPLAY_FLAG_KEYS.filter((k) => k !== "showLocants")) {
      const box = checkbox(key);
      expect(box.disabled, key).toBe(false);
      expect(box.closest("label")!.querySelector("[data-disabled-reason]"), key).toBeNull();
    }
    const circles = checkbox("aromaticCircles");
    const before = circles.checked;
    fireEvent.click(circles);
    const panel = editorStore.getState().document.panels[0]!;
    expect(panel.representation.display.aromaticCircles).toBe(!before);
  });
});

describe("RepresentationSwitcher names the strip", () => {
  it("opens the figure panel chooser from a labelled button at the head of the strip", () => {
    render(<RepresentationSwitcher />);
    const strip = document.querySelector('[data-shell="representation-switcher"]')!;
    const trigger = document.querySelector<HTMLElement>('[data-shell="panel-chooser-trigger"]')!;
    // First in the strip, so the row reads "Figure panels: (a) … (b) …".
    expect(strip.firstElementChild).toBe(trigger);
    expect(trigger.textContent).toBe("Figure panels");

    expect(document.querySelector('[data-shell="panel-chooser"]')).toBeNull();
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
    });
    expect(document.querySelector('[data-shell="panel-chooser"]')).not.toBeNull();

    // Adding from the popover adds a button to the strip.
    act(() => {
      fireEvent.click(document.querySelector('[data-add-view="lewis"]')!);
    });
    expect(document.querySelectorAll("[data-switcher-panel]")).toHaveLength(3);
  });

  it("says in each panel button's title that the letter labels the exported figure", () => {
    render(<RepresentationSwitcher />);
    const titles = [...document.querySelectorAll("[data-switcher-panel]")].map((b) =>
      b.getAttribute("title"),
    );
    expect(titles).toEqual([
      "Panel (a) of the exported figure: Skeletal",
      "Panel (b) of the exported figure: Sum formula",
    ]);
  });
});
