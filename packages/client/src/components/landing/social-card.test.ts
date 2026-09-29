import { describe, expect, it } from "vitest";

import { BUNDLED_MEASURER } from "@starter/chem-render";

import { LANDING_HEADLINE } from "./copy";
import { EXAMPLE_VIEWS } from "./example-document";
import { exampleFigure } from "./example-figure";
import { landingSocialMetadata } from "./metadata";
import { SOCIAL_CARD, socialCardSvg, wrap } from "./social-card";

function widthAt(text: string, sizePx: number): number {
  return BUNDLED_MEASURER.measureText(text, { family: "Arimo", sizePx }).advanceWidthPx;
}

describe("the social card", () => {
  it("is 1200×630 and carries the landing's exported figure itself", () => {
    const svg = socialCardSvg();
    expect(svg).toMatch(/^<svg [^>]*width="1200" height="630" viewBox="0 0 1200 630">/);
    for (const kind of EXAMPLE_VIEWS) expect(svg).toContain(`data-view="${kind}"`);
    // Nested with its own viewBox, so every coordinate is the file's.
    const figureViewBox = /viewBox="([^"]+)"/.exec(exampleFigure().svg)?.[1];
    expect(svg).toContain(`viewBox="${figureViewBox}"`);
  });

  it("sets the landing's headline and the figure's computed printed size", () => {
    const svg = socialCardSvg();
    const text = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
    expect(text).toContain(LANDING_HEADLINE);
    expect(text).toContain(`prints ${exampleFigure().printedSize}`);
  });

  it("keeps every line inside the text column, and a number with its unit", () => {
    const lines = wrap("At single-column width it prints 6.1 × 6.4 cm, with 10.0 pt labels.", 22, 330);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(widthAt(line, 22)).toBeLessThanOrEqual(330);
    expect(lines.some((line) => line.includes("6.1 × 6.4 cm,"))).toBe(true);
    expect(lines.some((line) => line.includes("10.0 pt"))).toBe(true);
  });

  it("balances a wrapped sentence rather than leaving one word on the last line", () => {
    const lines = wrap(LANDING_HEADLINE, 46, 540);
    expect(lines[0]).toBe("Draw the molecule once.");
    expect(lines.slice(1).join(" ")).toBe("Export every view your figure needs.");
    expect(lines.at(-1)?.split(" ").length).toBeGreaterThan(1);
  });

  it("refuses a line it cannot fit rather than drawing past the edge", () => {
    expect(() => wrap("Hydroxymethylcyclohexanecarboxylic", 46, 200)).toThrow(/wider than/);
  });
});

describe("the landing pages' link-preview metadata", () => {
  it("points Open Graph and Twitter at the card, with its size and a description of it", () => {
    const meta = landingSocialMetadata({ path: "/about", title: "About", description: "D" });
    expect(meta.openGraph).toMatchObject({
      url: "/about",
      images: [{ url: "/social-card.png", width: 1200, height: 630, alt: SOCIAL_CARD.alt }],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: "/social-card.png", alt: SOCIAL_CARD.alt }],
    });
    expect(SOCIAL_CARD.alt).toContain(LANDING_HEADLINE);
  });
});
