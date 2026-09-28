import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DONATE_URL } from "@/lib/donation";

import { Landing } from "./Landing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the landing page", () => {
  it("leads with the outcome and a way to start", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Draw the molecule once. Export every view your figure needs.",
    );
    expect(screen.getByText("New sketch").closest("a")).toHaveAttribute("href", "/editor");
  });

  it("prints the example's size from the export code, not from a typed number", () => {
    const { container } = render(<Landing />);
    const caption = container.querySelector("figcaption")?.textContent ?? "";
    expect(caption).toMatch(/prints \d+\.\d × \d+\.\d cm, with \d+\.\d pt labels/);
    expect(container.querySelector('[data-landing="figure"] svg')).not.toBeNull();
  });

  it("states what the editor does not do", () => {
    render(<Landing />);
    const limits = screen.getByRole("heading", { name: "Not in this version" }).closest("section");
    expect(limits).toHaveTextContent(/No InChI import/);
    expect(limits).toHaveTextContent(/No sync between computers/);
  });

  it("uses none of the banned marketing words", () => {
    // The house copy rules, enforced where they can be: a word from this list
    // means somebody stopped checking whether the claim was true.
    const { container } = render(<Landing />);
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
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("links Donate on the web and drops it from the static export", () => {
    const { unmount } = render(<Landing />);
    expect(screen.getByText("Donate").closest("a")).toHaveAttribute("href", DONATE_URL);
    unmount();

    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    render(<Landing />);
    expect(screen.queryByText("Donate")).not.toBeInTheDocument();
    expect(screen.getByText("New sketch").closest("a")?.getAttribute("href")).toBe("editor.html");
  });
});
