import { existsSync } from "node:fs";
import { join } from "node:path";

import { species } from "@starter/chem-core";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleNamed } from "@/components/landing/example-document";

import { GUIDES, guideBySlug, guideCardPath, releasedGuides, unreleasedGuides } from "./guides";
import type { Guide } from "./guides";
import { GuidesIndex } from "./GuidesIndex";
import { GuidesNavLink } from "./GuidesNavLink";
import { guideMetadata } from "./metadata";
import { guideSocialCardSvg } from "./social-card";

afterEach(() => {
  vi.unstubAllEnvs();
});

function guide(slug: string, released: string | null): Guide {
  return {
    slug,
    title: `Guide ${slug}`,
    description: `About ${slug}.`,
    released,
    figures: [{ example: "landing", alt: "Acetic acid." }],
  };
}

const MIXED: readonly Guide[] = [
  guide("old", "2026-10-01"),
  guide("draft", null),
  guide("new", "2026-11-02"),
];

describe("the guide list (decision 243)", () => {
  it("gives every guide a unique slug and a page folder of its own", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      const page = join(import.meta.dirname, "..", "..", "app", "guides", slug, "page.tsx");
      expect(existsSync(page), slug).toBe(true);
    }
  });

  it("opens every guide figure in the editor through a ?example= name", () => {
    for (const g of GUIDES) {
      for (const figure of g.figures) {
        const doc = exampleNamed(figure.example);
        expect(doc, figure.example).not.toBeNull();
        expect(species(doc!.molecule).length, figure.example).toBeGreaterThan(0);
      }
    }
  });

  it("stores a release as a real calendar date", () => {
    for (const g of GUIDES.filter((x) => x.released !== null)) {
      expect(g.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${g.released}T00:00:00Z`).toISOString().slice(0, 10)).toBe(g.released);
    }
  });

  it("releases newest first and keeps drafts apart", () => {
    expect(releasedGuides(MIXED).map((g) => g.slug)).toEqual(["new", "old"]);
    expect(unreleasedGuides(MIXED).map((g) => g.slug)).toEqual(["draft"]);
    expect(() => guideBySlug("nope", MIXED)).toThrow(/nope/);
  });
});

describe("the /guides index", () => {
  it("lists only the released guides, newest first", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    const { container } = render(<GuidesIndex guides={MIXED} />);
    const entries = [...container.querySelectorAll('[data-guides="entry"]')];
    expect(entries.map((e) => e.getAttribute("data-guide-slug"))).toEqual(["new", "old"]);
    expect(entries[0]?.querySelector("a")).toHaveAttribute("href", "/guides/new");
    expect(entries[0]?.querySelector("time")).toHaveTextContent("2 November 2026");
    expect(container.textContent).not.toContain("Guide draft");
    expect(container.querySelector('[data-guides="empty"]')).toBeNull();
  });

  it("links the export's flat file names", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<GuidesIndex guides={MIXED} />);
    expect(container.querySelector('[data-guide-slug="old"] a')).toHaveAttribute(
      "href",
      "guides-old.html",
    );
  });

  it("says so when nothing is released", () => {
    const { container } = render(<GuidesIndex guides={[guide("draft", null)]} />);
    expect(container.querySelectorAll('[data-guides="entry"]')).toHaveLength(0);
    expect(container.querySelector('[data-guides="empty"]')).toBeInTheDocument();
  });
});

describe("the Guides nav link", () => {
  it("is absent while no guide is released", () => {
    const { container } = render(<GuidesNavLink guides={[guide("draft", null)]} />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("points at the index once one is", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const { container } = render(<GuidesNavLink guides={MIXED} />);
    expect(container.querySelector('a[data-nav="guides"]')).toHaveAttribute("href", "guides.html");
  });
});

describe("a guide page's metadata (decisions 243 and 245)", () => {
  it("keeps an unreleased guide out of search results", () => {
    expect(guideMetadata(guide("draft", null)).robots).toEqual({ index: false, follow: true });
    expect(guideMetadata(guide("old", "2026-10-01")).robots).toBeUndefined();
  });

  it("names the guide's own card, not the landing's", () => {
    const meta = guideMetadata(guide("old", "2026-10-01"));
    const images = meta.openGraph?.images;
    const first = Array.isArray(images) ? images[0] : images;
    expect(first).toMatchObject({ url: guideCardPath("old"), width: 1200, height: 630 });
    expect(guideCardPath("old")).toBe("/social-cards/old.png");
  });
});

describe("a guide's social card", () => {
  it("draws the guide's first figure under its title", () => {
    for (const g of GUIDES) {
      const svg = guideSocialCardSvg(g);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('width="1200" height="630"');
      // The figure, nested as its own <svg>.
      expect(svg.match(/<svg\b/g)?.length).toBe(2);
      // The title is set across lines, so check its first and last words.
      const words = g.title.split(" ");
      expect(svg).toContain(words[0]);
      expect(svg).toContain(words.at(-1));
    }
  });
});
