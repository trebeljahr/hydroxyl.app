/**
 * The image a link to `/` or `/about` unfurls into: 1200×630, the size Open
 * Graph and Twitter's large card both crop to without losing an edge.
 *
 * ── THE PRODUCT'S OWN OUTPUT, LIKE THE LANDING FIGURE ──────────────────────
 *
 * The right half is `exampleFigure()` — the same `prepareFigure` export the
 * landing page shows, unedited, nested as its own `<svg>` so its viewBox and
 * coordinates are exactly the file's. The text beside it is the landing's
 * headline and its caption, whose numbers are computed from that figure. A
 * card drawn once in an image editor would keep making the page's claims
 * after the renderer changed; this one is rebuilt on every build.
 *
 * ── COMPOSED HERE, RASTERISED BY `scripts/build-social-card.mjs` ───────────
 *
 * This module only writes SVG, so it stays testable under Vitest and free of
 * any rasteriser. The script bundles it, renders it with resvg and writes
 * `public/social-card.png`. `public/` is copied verbatim by both
 * `output:"standalone"` and the static export, so one file serves both builds
 * and neither has a route handler to prerender, or a wasm rasteriser to carry
 * through Turbopack's server bundle.
 *
 * ── TEXT IS SET IN ARIMO AND MEASURED WITH ITS TABLE ───────────────────────
 *
 * The script loads Arimo, the face chem-render vendors, as the ONLY font, so
 * the card looks the same on a laptop and in the Docker build. SVG does not
 * wrap text, so lines are broken here with chem-render's Arimo metrics, which
 * are the widths resvg will set them at.
 */

import { BUNDLED_MEASURER } from "@starter/chem-render";
import type { FontRequest } from "@starter/chem-render";

import { SITE_NAME } from "@/lib/site";

import { LANDING_HEADLINE } from "./copy";
import { EXAMPLE_FIGURE_ALT, exampleCaption, exampleFigure } from "./example-figure";

export const SOCIAL_CARD = {
  /** Served from `public/`; `metadataBase` makes it absolute. */
  path: "/social-card.png",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME}. ${LANDING_HEADLINE} ${EXAMPLE_FIGURE_ALT}`,
} as const;

const FONT_FAMILY = "Arimo, Arial, Helvetica, sans-serif";

// The landing page's own tokens (styles/globals.css, light theme), as hex:
// resvg reads neither `var(--…)` nor `hsl()` with space-separated arguments.
const FOREGROUND = "#0a0a0a"; // --foreground, hsl(0 0% 3.9%)
const MUTED = "#737373"; // --muted-foreground, hsl(0 0% 45.1%)
const BORDER = "#e5e5e5"; // --border, hsl(0 0% 89.8%)

const MARGIN = 64;
/** Between the text column and the figure's frame. */
const GUTTER = 56;
/** Inside the frame, around the figure — the landing's `p-4` scaled up. */
const FRAME_PADDING = 28;
const FRAME_RADIUS = 12;
/** The figure never takes more than this share of the card's width. */
const MAX_FIGURE_SHARE = 0.46;

interface TextBlock {
  readonly lines: readonly string[];
  readonly sizePx: number;
  /** Baseline to baseline, as a multiple of the size. */
  readonly lineHeight: number;
  readonly fill: string;
}

function font(sizePx: number): FontRequest {
  return { family: FONT_FAMILY, sizePx };
}

function widthOf(text: string, sizePx: number): number {
  const { advanceWidthPx, notdefCount } = BUNDLED_MEASURER.measureText(text, font(sizePx));
  // The measurer's table and the vendored WOFF cover the same Latin set. A
  // character outside it would be measured as a gap and drawn as nothing.
  if (notdefCount > 0) throw new Error(`The social card cannot set "${text}" in Arimo.`);
  return advanceWidthPx;
}

/**
 * The units a line may break between: words, except that a number stays with
 * what follows it and "×" with both sides, so "6.1 × 6.4 cm" and "10.0 pt"
 * never split across lines.
 */
function breakUnits(sentence: string): string[] {
  const units: string[] = [];
  let glue = false;
  for (const word of sentence.split(/\s+/)) {
    const last = units.length - 1;
    if (glue && last >= 0) units[last] = `${units[last]} ${word}`;
    else units.push(word);
    glue = /^[\d.]+$/.test(word) || word === "×";
  }
  return units;
}

function greedy(units: readonly string[], sizePx: number, widthPx: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const unit of units) {
    const candidate = line === "" ? unit : `${line} ${unit}`;
    if (line !== "" && widthOf(candidate, sizePx) > widthPx) {
      lines.push(line);
      line = unit;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * Balanced wrap, like the landing `<h1>`'s `text-wrap: balance`: as few lines
 * as the column allows, then the narrowest width that still needs no more, so
 * no line ends up holding one word. Each sentence starts a new line — a
 * headline broken across a full stop reads as two unrelated fragments.
 */
export function wrap(text: string, sizePx: number, maxWidthPx: number): string[] {
  const lines: string[] = [];
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const units = breakUnits(sentence);
    const count = greedy(units, sizePx, maxWidthPx).length;
    let narrow = 0;
    let wide = maxWidthPx;
    while (wide - narrow > 0.5) {
      const mid = (narrow + wide) / 2;
      if (greedy(units, sizePx, mid).length <= count) wide = mid;
      else narrow = mid;
    }
    lines.push(...greedy(units, sizePx, wide));
  }
  for (const line of lines) {
    if (widthOf(line, sizePx) > maxWidthPx) {
      throw new Error(`"${line}" is wider than the social card's text column.`);
    }
  }
  return lines;
}

function blockHeight(block: TextBlock): number {
  const v = BUNDLED_MEASURER.verticalMetrics(font(block.sizePx));
  return v.capHeightPx + (block.lines.length - 1) * block.sizePx * block.lineHeight + v.descentPx;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function px(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The figure's aspect ratio, read from the root `viewBox` it was written with. */
function viewBoxAspect(svg: string): number {
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const viewBox = /\sviewBox="([^"]+)"/.exec(root)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const [, , width, height] = viewBox ?? [];
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0)) {
    throw new Error("The example figure's root <svg> has no usable viewBox.");
  }
  return width / height;
}

/** Re-seats a standalone `<svg>` as a nested one at `box`. Its viewBox, and so
 *  every coordinate inside it, is untouched; the default
 *  `preserveAspectRatio` centres it in the box. */
function nestAt(
  svg: string,
  box: { x: number; y: number; width: number; height: number },
): string {
  const root = /^<svg\b([^>]*)>/.exec(svg);
  if (root === null) throw new Error("The example figure does not start with <svg>.");
  const attributes = (root[1] ?? "").replace(/\s(?:x|y|width|height)="[^"]*"/g, "");
  return (
    `<svg${attributes} x="${px(box.x)}" y="${px(box.y)}" ` +
    `width="${px(box.width)}" height="${px(box.height)}">` +
    svg.slice(root[0].length)
  );
}

export function socialCardSvg(): string {
  const { width: W, height: H } = SOCIAL_CARD;
  const example = exampleFigure();

  // The figure, as large as the height allows and no wider than its share.
  const aspect = viewBoxAspect(example.svg);
  const maxFigureWidth = W * MAX_FIGURE_SHARE - 2 * FRAME_PADDING;
  const maxFigureHeight = H - 2 * MARGIN - 2 * FRAME_PADDING;
  const figureWidth = Math.min(maxFigureWidth, maxFigureHeight * aspect);
  const figureHeight = figureWidth / aspect;
  const frame = {
    width: figureWidth + 2 * FRAME_PADDING,
    height: figureHeight + 2 * FRAME_PADDING,
    x: W - MARGIN - (figureWidth + 2 * FRAME_PADDING),
    y: (H - (figureHeight + 2 * FRAME_PADDING)) / 2,
  };

  const column = frame.x - GUTTER - MARGIN;
  const blocks: TextBlock[] = [
    { lines: [SITE_NAME], sizePx: 30, lineHeight: 1.2, fill: FOREGROUND },
    { lines: wrap(LANDING_HEADLINE, 46, column), sizePx: 46, lineHeight: 1.16, fill: FOREGROUND },
    { lines: wrap(exampleCaption(example), 22, column), sizePx: 22, lineHeight: 1.45, fill: MUTED },
  ];
  const gaps = [44, 36];

  const total =
    blocks.reduce((sum, block) => sum + blockHeight(block), 0) + gaps.reduce((a, b) => a + b, 0);
  let top = (H - total) / 2;
  if (top < MARGIN / 2) {
    throw new Error("The social card's text no longer fits its height; shorten it or shrink it.");
  }

  const text: string[] = [];
  blocks.forEach((block, i) => {
    const v = BUNDLED_MEASURER.verticalMetrics(font(block.sizePx));
    block.lines.forEach((line, j) => {
      const baseline = top + v.capHeightPx + j * block.sizePx * block.lineHeight;
      text.push(
        `<text x="${MARGIN}" y="${px(baseline)}" font-family="${FONT_FAMILY}" ` +
          `font-size="${block.sizePx}" fill="${block.fill}">${escapeXml(line)}</text>`,
      );
    });
    top += blockHeight(block) + (gaps[i] ?? 0);
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    ...text,
    `<rect x="${px(frame.x)}" y="${px(frame.y)}" width="${px(frame.width)}" ` +
      `height="${px(frame.height)}" rx="${FRAME_RADIUS}" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>`,
    nestAt(example.svg, {
      x: frame.x + FRAME_PADDING,
      y: frame.y + FRAME_PADDING,
      width: figureWidth,
      height: figureHeight,
    }),
    `</svg>`,
  ].join("\n");
}
