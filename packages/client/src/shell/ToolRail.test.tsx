/**
 * The rail, as a rendering of the tool registry.
 *
 * The assertions worth having here are the ones about the rail and the
 * registry being the SAME list — a rail assembled from its own array would
 * pass a test that only checked "eight buttons appear".
 */

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TOOLS } from "@/editor/tools";
import { editorStore } from "@/state";

import { ToolRail } from "./ToolRail";

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(
    createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
  );
  state.setTool("select");
  state.clearSelection();
  // The tool OPTIONS survive a tool change by design, so they also survive
  // between tests in this file and have to be put back by hand.
  state.setToolOption("element", "C");
  state.setToolOption("bondStereo", "none");
  state.setToolOption("bondOrder", 1);
  state.setToolOption("ringTemplate", "benzene");
});

function renderRail(): void {
  render(
    <TooltipProvider>
      <ToolRail />
    </TooltipProvider>,
  );
}

function toolButton(id: string): HTMLElement {
  const node = document.querySelector(`[data-tool="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no button for ${id}`);
  return node;
}

describe("ToolRail", () => {
  it("renders exactly the registry's tools, in its order", () => {
    renderRail();
    const rendered = [...document.querySelectorAll("[data-tool]")].map((node) =>
      node.getAttribute("data-tool"),
    );
    expect(rendered).toEqual(TOOLS.map((tool) => tool.id));
  });

  it("picks a tool up on click and marks it pressed", () => {
    renderRail();
    expect(toolButton("select").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toolButton("eraser"));
    expect(editorStore.getState().tool).toBe("eraser");
    expect(toolButton("eraser").getAttribute("aria-pressed")).toBe("true");
    expect(toolButton("select").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the tool held after the click — tools are sticky", () => {
    // Decision 3. A tool that sprang back to select after each stroke would
    // make every second click a mode error in a long synthesis.
    renderRail();
    fireEvent.click(toolButton("bond"));
    act(() => {
      editorStore.getState().applyMoleculeEdit("Draw bond", (mol) => mol);
    });
    expect(editorStore.getState().tool).toBe("bond");
  });

  it("advertises each tool's hotkey to assistive technology", () => {
    renderRail();
    for (const tool of TOOLS) {
      expect(toolButton(tool.id).getAttribute("aria-keyshortcuts")).toBe(
        tool.hotkey,
      );
    }
  });

  it("gives every tool an accessible name", () => {
    renderRail();
    for (const tool of TOOLS) {
      expect(toolButton(tool.id).textContent).toContain(tool.title);
    }
  });

  it("draws inline SVG rather than <img>, so the icon can follow the theme", () => {
    // An external SVG in an <img> is an isolated document: `currentColor`
    // resolves to black there, so a pressed or dark-theme button would show a
    // black icon on a black ground.
    renderRail();
    expect(document.querySelectorAll("[data-tool] img")).toHaveLength(0);
    for (const tool of TOOLS) {
      const svg = toolButton(tool.id).querySelector("svg");
      // The element button draws its SYMBOL as text — no glyph says
      // "nitrogen" better than "N" — so it legitimately has no <svg>.
      if (svg === null) {
        expect(toolButton(tool.id).textContent, tool.id).not.toBe(tool.title);
        continue;
      }
      const painted = [
        svg?.getAttribute("stroke"),
        svg?.getAttribute("fill"),
        ...[...(svg?.querySelectorAll("[stroke], [fill]") ?? [])].flatMap((el) => [
          el.getAttribute("stroke"),
          el.getAttribute("fill"),
        ]),
      ];
      expect(painted, tool.id).not.toContain("#000");
      expect(painted, tool.id).not.toContain("#000000");
    }
  });

  it("shows what the tool is ARMED with, not a static glyph", () => {
    // A ring button that always drew a plain hexagon would say "ring" while
    // the tool was set to place benzene, and the chemist would find out by
    // placing one.
    renderRail();
    act(() => {
      editorStore.getState().setToolOption("element", "Br");
    });
    expect(toolButton("element").textContent).toContain("Br");

    act(() => {
      editorStore.getState().setToolOption("bondStereo", "wedge");
    });
    // The wedge glyph is the only filled one in the set.
    expect(
      toolButton("bond").querySelector('[fill="currentColor"]'),
    ).not.toBeNull();
  });

  it("only offers options for the tools that carry them", () => {
    renderRail();
    const withOptions = ["Draw bond", "Element", "Ring template", "Chain"];
    for (const title of withOptions) {
      expect(
        document.querySelector(`[aria-label="${title} options"]`),
        title,
      ).not.toBeNull();
    }
    expect(document.querySelector('[aria-label="Select options"]')).toBeNull();
    expect(document.querySelector('[aria-label="Eraser options"]')).toBeNull();
  });
});

describe("the element picker's way to every other element", () => {
  function openElementPicker(): void {
    const trigger = document.querySelector<HTMLElement>('[aria-label="Element options"]');
    if (trigger === null) throw new Error("no element options trigger");
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
    });
  }

  function showAll(): HTMLElement {
    const node = document.querySelector<HTMLElement>('[data-option="element-show-all"]');
    if (node === null) throw new Error("no Show all entry");
    return node;
  }

  beforeEach(() => {
    act(() => {
      editorStore.getState().setRecentElements([]);
      editorStore.getState().setPeriodicTableOpen(false);
    });
  });

  it("offers Show all under the organic grid, as a button that opens a dialog", () => {
    renderRail();
    openElementPicker();
    const entry = showAll();
    expect(entry).toHaveAccessibleName("Show all elements (periodic table)");
    expect(entry).toHaveAttribute("aria-haspopup", "dialog");
    // An action, not an option: it is never "pressed", and saying "not
    // pressed" would announce it as a toggle.
    expect(entry).not.toHaveAttribute("aria-pressed");
    act(() => {
      fireEvent.click(entry);
    });
    expect(editorStore.getState().ui.periodicTableOpen).toBe(true);
    // The popover closed on the pick, so the dialog is not opening behind it.
    expect(document.querySelector('[data-option="element-show-all"]')).toBeNull();
  });

  it("has no Recent row until something outside the organic set is picked", () => {
    renderRail();
    openElementPicker();
    expect(document.querySelector("[data-element-recent]")).toBeNull();
  });

  it("pins recent picks from the full table in the quick picker, newest first", () => {
    act(() => {
      editorStore.getState().noteRecentElement("Pd");
      editorStore.getState().noteRecentElement("Pt");
    });
    renderRail();
    openElementPicker();
    const row = document.querySelector<HTMLElement>("[data-element-recent]");
    expect(row).not.toBeNull();
    const pinned = [...row!.querySelectorAll("[data-element]")].map((node) =>
      node.getAttribute("data-element"),
    );
    expect(pinned).toEqual(["Pt", "Pd"]);
    // The organic grid is untouched by it: thirteen elements plus decision
    // 238's R-group entry, then the two pinned.
    expect(document.querySelectorAll("[data-element]")).toHaveLength(13 + 1 + 2);
    expect(document.querySelector('[data-element="R"]')).toHaveAccessibleName(
      "R-group, numbered R1, R2… (R)",
    );

    const platinum = row!.querySelector<HTMLElement>('[data-element="Pt"]')!;
    expect(platinum).toHaveAccessibleName("Platinum (Pt)");
    act(() => {
      fireEvent.click(platinum);
    });
    expect(editorStore.getState().toolOptions.element).toBe("Pt");
    expect(editorStore.getState().tool).toBe("element");
  });

  it("shows the armed recent element as pressed, like any other entry", () => {
    act(() => {
      editorStore.getState().noteRecentElement("Pt");
      editorStore.getState().setToolOption("element", "Pt");
    });
    renderRail();
    openElementPicker();
    expect(
      document.querySelector('[data-element-recent] [data-element="Pt"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
