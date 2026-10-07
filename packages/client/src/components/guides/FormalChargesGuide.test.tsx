import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commandById, formatShortcut } from "@/editor/commands/registry";

import { OPENSTAX_SOURCE } from "./formal-charges";
import { FormalChargesGuide } from "./FormalChargesGuide";
import { guideBySlug } from "./guides";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the formal charges guide", () => {
  it("answers the question in its first paragraph", () => {
    const { container } = render(<FormalChargesGuide />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "How do you count formal charges and lone pairs?",
    );
    const answer = container.querySelector('[data-guide="answer"]')?.textContent ?? "";
    expect(answer).toContain("5 − 0 − 4 = +1");
    expect(answer.split(/\s+/).length).toBeLessThanOrEqual(50);
  });

  it("cites the textbook rule with the date it was read", () => {
    const { container } = render(<FormalChargesGuide />);
    expect(container.querySelector('[data-guide="source"]')).toHaveAttribute(
      "href",
      OPENSTAX_SOURCE.url,
    );
    expect(container.querySelector('[data-guide="fetched"]')).toHaveTextContent("7 October 2026");
  });

  it("prints every count from the table, the mistake's in red", () => {
    const { container } = render(<FormalChargesGuide />);
    const rows = container.querySelectorAll("[data-guide-row]");
    expect(rows).toHaveLength(5);
    expect(rows[4]).toHaveTextContent("+1 (drawn as 0)");
    expect(container.querySelector('[data-guide-count="ammonia"]')).toHaveTextContent(
      "5 − 2 − 3 = 0",
    );
    expect(container.querySelector('[data-guide-count="oxide"]')).toHaveTextContent(
      "6 − 6 − 1 = −1",
    );
  });

  it("quotes the editor's issue and fix as chem-core writes them", () => {
    const { container } = render(<FormalChargesGuide />);
    expect(container.querySelector('[data-guide="canvas-label"]')).toHaveTextContent(
      "N has 4 bonds; max 3",
    );
    expect(container.querySelector('[data-guide="issue-message"]')).toHaveTextContent(
      "N has 4 bonds but allows at most 3",
    );
    expect(
      [...container.querySelectorAll('[data-guide="fix-title"]')].map((e) => e.textContent),
    ).toEqual(["Make it N⁺"]);
  });

  it("names the charge keys the editor binds", () => {
    const { container } = render(<FormalChargesGuide />);
    for (const id of ["structure.charge-up", "structure.charge-down"]) {
      expect(container.querySelector(`[data-guide-shortcut="${id}"]`)).toHaveTextContent(
        formatShortcut(commandById(id).shortcut ?? "", false),
      );
    }
  });

  it("puts an editor link under each figure, opening that figure's example", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<FormalChargesGuide />);
    const figures = [...container.querySelectorAll("figure")];
    expect(
      figures.map((f) => f.querySelector("a[data-guide-open-example]")?.getAttribute("href")),
    ).toEqual(
      guideBySlug("formal-charges-and-lone-pairs").figures.map(
        (g) => `editor.html?example=${g.example}`,
      ),
    );
  });

  it("uses none of the banned marketing words", () => {
    const { container } = render(<FormalChargesGuide />);
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
      "designed to",
      "the future of",
      "chemdraw",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});
