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
      expect(svg, tool.id).not.toBeNull();
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
