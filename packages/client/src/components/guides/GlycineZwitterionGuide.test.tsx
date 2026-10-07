import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commandById, formatShortcut } from "@/editor/commands/registry";

import { GlycineZwitterionGuide } from "./GlycineZwitterionGuide";
import { PUBCHEM_GLYCINE } from "./glycine-zwitterion";
import { guideBySlug } from "./guides";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the glycine zwitterion guide", () => {
  it("answers the question in its first paragraph", () => {
    const { container } = render(<GlycineZwitterionGuide />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Glycine as a neutral molecule and as a zwitterion",
    );
    const answer = container.querySelector('[data-guide="answer"]')?.textContent ?? "";
    expect(answer).toContain("C₂H₅NO₂");
    expect(answer).toContain("75.0320");
    expect(answer.split(/\s+/).length).toBeLessThanOrEqual(60);
  });

  it("marks the formal charges as the one row that differs", () => {
    const { container } = render(<GlycineZwitterionGuide />);
    const differing = [...container.querySelectorAll('[data-guide-row][data-guide-same="false"]')].map(
      (row) => row.getAttribute("data-guide-row"),
    );
    // The hydrogen rows follow from the charges; every drawn property agrees.
    expect(differing).toEqual(["formal-charges", "n-hydrogens", "o-hydrogens"]);
    expect(container.querySelector('[data-guide-number="neutral-formal-charges"]')).toHaveTextContent("none");
    expect(container.querySelector('[data-guide-number="zwitterion-formal-charges"]')).toHaveTextContent(
      "−1, +1",
    );
  });

  it("links both PubChem records, with the date they were read", () => {
    const { container } = render(<GlycineZwitterionGuide />);
    expect(container.querySelector('[data-guide-source="neutral"]')).toHaveAttribute(
      "href",
      "https://pubchem.ncbi.nlm.nih.gov/compound/750",
    );
    expect(container.querySelector('[data-guide-source="zwitterion"]')).toHaveAttribute(
      "href",
      "https://pubchem.ncbi.nlm.nih.gov/compound/5257127",
    );
    expect(container.querySelector('[data-guide="fetched"]')).toHaveAttribute("dateTime", PUBCHEM_GLYCINE.fetched);
    expect(container.querySelector('[data-guide="fetched"]')).toHaveTextContent("7 October 2026");
    // Each record by the title PubChem gives it, not a title we prefer.
    expect(container.textContent).toContain("“Glycine”");
    expect(container.textContent).toContain("“alpha-Glycine”");
  });

  it("names the editor's real charge keys", () => {
    const { container } = render(<GlycineZwitterionGuide />);
    expect(container.querySelector('[data-guide="shortcut-increase"]')).toHaveTextContent(
      formatShortcut(commandById("structure.charge-up").shortcut ?? "", false),
    );
    expect(container.querySelector('[data-guide="shortcut-decrease"]')).toHaveTextContent(
      formatShortcut(commandById("structure.charge-down").shortcut ?? "", false),
    );
  });

  it("puts an editor link under each figure, opening that figure's example", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<GlycineZwitterionGuide />);
    const figures = [...container.querySelectorAll("figure")].filter(
      (f) => f.querySelector("[data-guide-figure]") !== null,
    );
    expect(
      figures.map((f) => f.querySelector("[data-guide-figure]")?.getAttribute("data-guide-figure")),
    ).toEqual(["neutral", "zwitterion"]);
    expect(
      figures.map((f) => f.querySelector("a[data-guide-open-example]")?.getAttribute("href")),
    ).toEqual(guideBySlug("glycine-zwitterion").figures.map((g) => `editor.html?example=${g.example}`));
    expect(container.querySelector('[data-guide="open-editor"]')).toHaveAttribute("href", "editor.html");
  });

  it("uses none of the banned marketing words", () => {
    const { container } = render(<GlycineZwitterionGuide />);
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
