/**
 * The switcher's view options are a second door onto the display flags, so
 * they must say what the palette says: every flag listed, the locants toggle
 * named as locants (decision 18) and disabled with the registry's reason
 * (decision 37).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ethanol } from "@starter/chem-render";
import { DISPLAY_FLAG_KEYS, createDocument } from "@starter/shared";

import { commandById } from "@/editor/commands/registry";
import { editorStore } from "@/state";

import { RepresentationSwitcher } from "./RepresentationSwitcher";

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

  it("shows the locants toggle disabled, with the registry's reason", () => {
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
