import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commandById, formatShortcut } from "@/editor/commands/registry";

import { guideBySlug } from "./guides";
import { MultiPanelFigureGuide } from "./MultiPanelFigureGuide";
import { ACS_FIGURE_CAPTION, multiPanelNumbers, printedSize } from "./multi-panel-figure";

afterEach(() => {
  vi.unstubAllEnvs();
});

const numbers = multiPanelNumbers();

describe("the multi-panel figure guide", () => {
  it("answers the question in its first paragraph", () => {
    const { container } = render(<MultiPanelFigureGuide />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      guideBySlug("multi-panel-figure").title,
    );
    const answer = container.querySelector('[data-guide="answer"]')?.textContent ?? "";
    expect(answer).toContain("(a) to (d)");
    expect(answer).toContain(`${numbers.finished.widthCm.toFixed(2)} cm`);
    expect(answer.split(/\s+/).length).toBeLessThanOrEqual(55);
  });

  it("names the editor's real shortcuts", () => {
    // Typed in the prose, so held to the registry: a rebinding that left the
    // guide naming the old keys would fail this.
    const { container } = render(<MultiPanelFigureGuide />);
    const keys = (id: string): string => commandById(id).shortcut ?? "";
    expect(container.querySelector('[data-guide="shortcut-select-all"]')).toHaveTextContent(
      formatShortcut(keys("select.all"), false),
    );
    expect(container.querySelector('[data-guide="shortcut-delete"]')).toHaveTextContent(
      formatShortcut(keys("edit.delete"), false),
    );
    expect(container.querySelector('[data-guide="shortcut-export"]')).toHaveTextContent(
      formatShortcut(keys("figure.export-dialog"), false),
    );
    expect(container.textContent).toContain(formatShortcut(keys("select.all"), true));
    expect(container.textContent).toContain(formatShortcut(keys("figure.export-dialog"), true));
  });

  it("names each caption and view the steps ask for", () => {
    const { container } = render(<MultiPanelFigureGuide />);
    expect(
      [...container.querySelectorAll('[data-guide="caption-text"]')].map((q) => q.textContent),
    ).toEqual(numbers.panels.map((p) => p.caption));
    expect(container.querySelector('[data-guide-control="view-b"]')).toHaveTextContent("Explicit H");
    expect(container.querySelector('[data-guide-control="view-c"]')).toHaveTextContent("Lewis");
    expect(container.querySelector('[data-guide="moved-view"]')).toHaveTextContent("Sum formula");
    expect(container.querySelector('[data-guide="condensed-refusal"]')).toHaveTextContent(
      numbers.condensedRefusal,
    );
    expect(
      [...container.querySelectorAll('[data-guide-number="finished-size"]')].map((s) => s.textContent),
    ).toEqual([printedSize(numbers.finished), printedSize(numbers.finished)]);
  });

  it("links the ACS page it quotes, with the date it was read", () => {
    const { container } = render(<MultiPanelFigureGuide />);
    expect(container.querySelector('[data-guide="source"]')).toHaveAttribute("href", ACS_FIGURE_CAPTION.url);
    expect(container.querySelector('[data-guide="fetched"]')).toHaveTextContent("7 October 2026");
    expect(container.querySelectorAll("[data-guide='quote']")).toHaveLength(1);
  });

  it("does not link the figure-size guide while it is unreleased", () => {
    const { container } = render(<MultiPanelFigureGuide />);
    const released = guideBySlug("journal-figure-size").released !== null;
    expect(container.querySelector('[data-guide="related-guide"]') !== null).toBe(released);
  });

  it("links the editor as the export needs it", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<MultiPanelFigureGuide />);
    expect(container.querySelector('[data-guide="open-editor"]')).toHaveAttribute("href", "editor.html");
  });

  it("puts an editor link under each figure, opening that figure's example", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<MultiPanelFigureGuide />);
    const figures = [...container.querySelectorAll("figure")].filter(
      (f) => f.querySelector("[data-guide-figure]") !== null,
    );
    expect(
      figures.map((f) => f.querySelector("[data-guide-figure]")?.getAttribute("data-guide-figure")),
    ).toEqual(["finished", "automatic"]);
    expect(
      figures.map((f) => f.querySelector("a[data-guide-open-example]")?.getAttribute("href")),
    ).toEqual(
      guideBySlug("multi-panel-figure").figures.map((g) => `editor.html?example=${g.example}`),
    );
  });

  it("uses none of the banned marketing words", () => {
    const { container } = render(<MultiPanelFigureGuide />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of [
      "seamless",
      "effortless",
      "powerful",
      "revolutionary",
      "cutting-edge",
      "supercharge",
      "unlock",
      "empower",
      "simply",
      "just ",
      "designed to",
      "the future of",
      "chemdraw",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});
