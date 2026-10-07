/**
 * One social card per guide, drawn from the guide's first figure (decision
 * 245, which amends 138's one card for the landing pages).
 *
 * The card is the landing's layout with the guide's title as the headline and
 * its description as the caption. The figure is the one the page shows first,
 * exported exactly as the page's "Open this figure in the editor" link opens
 * it, so a link preview never shows a structure the page does not.
 *
 * Every guide gets a card, released or not. The guide's page names its card
 * in `og:image` from the day it is merged, so releasing it changes nothing
 * about how a link to it unfurls.
 */

import { serializeFigure } from "@starter/chem-render";

import { exampleNamed } from "@/components/landing/example-document";
import { composeSocialCard } from "@/components/landing/social-card";
import { prepareFigure } from "@/lib/export/figure";

import { GUIDES, guideCardPath } from "./guides";
import type { Guide } from "./guides";

/** A guide title is a question, longer than the landing headline. */
const GUIDE_HEADLINE_PX = 40;

export function guideSocialCardSvg(guide: Guide): string {
  const { example } = guide.figures[0];
  const doc = exampleNamed(example);
  if (doc === null) {
    throw new Error(`Guide "${guide.slug}" draws its card from "${example}", which is not an example.`);
  }
  const prepared = prepareFigure(doc, {
    width: "single",
    customWidthCm: 12,
    dpi: 600,
    style: "publication",
    pngBackground: "white",
  });
  if (!prepared.ok) {
    throw new Error(`Guide "${guide.slug}"'s card figure cannot be exported: ${prepared.message}`);
  }
  return composeSocialCard({
    figureSvg: serializeFigure(prepared.value.figure, {
      standalone: false,
      indent: false,
      embedFont: false,
      background: null,
    }),
    headline: guide.title,
    caption: guide.description,
    headlineSizePx: GUIDE_HEADLINE_PX,
  });
}

/** The guide cards `scripts/build-social-card.mjs` writes beside the
 *  landing's. `svg` is lazy so the script can name the card that failed. */
export function allGuideSocialCards(
  guides: readonly Guide[] = GUIDES,
): { readonly path: string; readonly svg: () => string }[] {
  return guides.map((guide) => ({
    path: guideCardPath(guide.slug),
    svg: () => guideSocialCardSvg(guide),
  }));
}
