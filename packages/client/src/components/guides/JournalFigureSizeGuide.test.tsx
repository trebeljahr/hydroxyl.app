import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commandById, formatShortcut } from "@/editor/commands/registry";

import { JournalFigureSizeGuide } from "./JournalFigureSizeGuide";
import { ACS_GUIDELINE } from "./journal-figure-size";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the journal figure size guide", () => {
  it("answers the question in its first paragraph", () => {
    const { container } = render(<JournalFigureSizeGuide />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "How big should a chemical structure be in a single-column figure?",
    );
    const answer = container.querySelector('[data-guide="answer"]')?.textContent ?? "";
    expect(answer).toContain("0.508 cm");
    expect(answer).toContain("10 pt");
    expect(answer.split(/\s+/).length).toBeLessThanOrEqual(50);
  });

  it("links the ACS page it quotes, with the date it was read, and quotes it once", () => {
    const { container } = render(<JournalFigureSizeGuide />);
    expect(container.querySelector('[data-guide="source"]')).toHaveAttribute("href", ACS_GUIDELINE.url);
    expect(container.querySelector('[data-guide="fetched"]')).toHaveAttribute("dateTime", "2026-09-29");
    expect(container.querySelector('[data-guide="fetched"]')).toHaveTextContent("29 September 2026");
    expect(container.querySelectorAll("blockquote[data-guide='quote']")).toHaveLength(1);
  });

  it("names the export dialog's real shortcut", () => {
    // Typed in the prose, so held to the registry here: a rebinding that left
    // the guide naming the old keys would fail this.
    const { container } = render(<JournalFigureSizeGuide />);
    const shortcut = commandById("figure.export-dialog").shortcut ?? "";
    expect(container.querySelector('[data-guide="shortcut"]')).toHaveTextContent(
      formatShortcut(shortcut, false),
    );
    expect(container.textContent).toContain(formatShortcut(shortcut, true));
  });

  it("links the editor as the export needs it", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<JournalFigureSizeGuide />);
    expect(container.querySelector('[data-guide="open-editor"]')).toHaveAttribute("href", "editor.html");
  });

  it("uses none of the banned marketing words", () => {
    const { container } = render(<JournalFigureSizeGuide />);
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
