import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleNamed } from "@/components/landing/example-document";

import { guideBySlug } from "./guides";
import { IUPAC_DRAWING, PUBCHEM_ISOLEUCINE } from "./skeletal-formula";
import { FIVE_BONDS_EXAMPLE, SkeletalFormulaGuide } from "./SkeletalFormulaGuide";

afterEach(() => {
  vi.unstubAllEnvs();
});

const GUIDE = guideBySlug("skeletal-formula");

describe("the skeletal formula guide", () => {
  it("answers the question in its first paragraph", () => {
    const { container } = render(<SkeletalFormulaGuide />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(GUIDE.title);
    const answer = container.querySelector('[data-guide="answer"]')?.textContent ?? "";
    expect(answer).toContain("carbon");
    expect(answer).toContain("four bonds");
    expect(answer.split(/\s+/).length).toBeLessThanOrEqual(50);
  });

  it("is unreleased until Rico releases it", () => {
    expect(GUIDE.released).toBeNull();
  });

  it("prints a table row per carbon that matches the counts beside it", () => {
    const { container } = render(<SkeletalFormulaGuide />);
    const rows = [...container.querySelectorAll("[data-guide-carbon]")];
    expect(rows).toHaveLength(6);
    const hydrogens = rows.map((r) => Number(r.querySelector("[data-guide-hydrogens]")?.textContent));
    const carbonH = container.querySelector('[data-guide-number="carbon-hydrogens"]')?.textContent;
    expect(String(hydrogens.reduce((a, b) => a + b, 0))).toBe(carbonH);
    expect(container.querySelector('[data-guide-number="formula"]')).toHaveTextContent("C₆H₁₃NO₂");
  });

  it("cites IUPAC by section and PubChem by record, and quotes once", () => {
    const { container } = render(<SkeletalFormulaGuide />);
    const sections = [...container.querySelectorAll('a[data-guide="iupac-section"]')].map((a) =>
      a.getAttribute("href"),
    );
    expect(new Set(sections)).toEqual(
      new Set(Object.values(IUPAC_DRAWING.sections).map((s) => `${IUPAC_DRAWING.url}${s.anchor}`)),
    );
    expect(container.querySelector('[data-guide="pubchem"]')).toHaveAttribute("href", PUBCHEM_ISOLEUCINE.url);
    expect(container.querySelector('[data-guide="source"]')).toHaveAttribute("href", IUPAC_DRAWING.url);
    expect(container.querySelector('[data-guide="fetched"]')).toHaveTextContent("7 October 2026");
    expect(container.querySelectorAll('[data-guide="quote"]')).toHaveLength(1);
  });

  it("puts an editor link under the figure, and links the five-bond example", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<SkeletalFormulaGuide />);
    const figures = [...container.querySelectorAll("figure")].filter(
      (f) => f.querySelector("[data-guide-figure]") !== null,
    );
    expect(
      figures.map((f) => f.querySelector("a[data-guide-open-example]")?.getAttribute("href")),
    ).toEqual(GUIDE.figures.map((g) => `editor.html?example=${g.example}`));
    expect(container.querySelector(`a[data-guide-open-example="${FIVE_BONDS_EXAMPLE}"]`)).toHaveAttribute(
      "href",
      `editor.html?example=${FIVE_BONDS_EXAMPLE}`,
    );
    expect(exampleNamed(FIVE_BONDS_EXAMPLE)).not.toBeNull();
    expect(container.querySelector('[data-guide="open-editor"]')).toHaveAttribute("href", "editor.html");
  });

  it("names the issue label chem-core gives a carbon with five bonds", () => {
    const { container } = render(<SkeletalFormulaGuide />);
    expect(container.querySelector('[data-guide="issue-label"]')).toHaveTextContent("C has 5 bonds; max 4");
  });

  it("uses none of the banned marketing words", () => {
    const { container } = render(<SkeletalFormulaGuide />);
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
      "obviously",
      "of course",
      "designed to",
      "the future of",
      "chemdraw",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});
