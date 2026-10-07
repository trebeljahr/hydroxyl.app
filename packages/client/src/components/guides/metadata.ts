/**
 * A guide page's `<head>`: its title and description from `guides.ts`, its
 * own social card (decision 245), and `noindex` until Rico releases it
 * (decision 243).
 *
 * `noindex` is the half of "unreleased" a crawler can see. Keeping a guide
 * out of the sitemap and every link already hides it from a well-behaved
 * crawler, but a URL pasted into a chat or a bug report can still be found;
 * the meta tag keeps that from becoming a search result before Rico has read
 * the page. `scripts/check-export.mjs` uses the same tag to check the
 * export's sitemap against its pages.
 */

import type { Metadata } from "next";

import { SOCIAL_CARD } from "@/components/landing/social-card";
import { SITE_NAME } from "@/lib/site";

import { guideCardPath } from "./guides";
import type { Guide } from "./guides";

export interface GuideSocialCard {
  /** Served from `public/`; `metadataBase` makes it absolute. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

export function guideSocialCard(guide: Guide): GuideSocialCard {
  return {
    path: guideCardPath(guide.slug),
    width: SOCIAL_CARD.width,
    height: SOCIAL_CARD.height,
    alt: `${SITE_NAME}. ${guide.title} ${guide.figures[0].alt}`,
  };
}

/** Kept out of search results while unreleased; links on it still count. */
export const UNRELEASED_ROBOTS = { index: false, follow: true } as const;

export function guideMetadata(guide: Guide): Metadata {
  const card = guideSocialCard(guide);
  const image = {
    url: card.path,
    width: card.width,
    height: card.height,
    alt: card.alt,
    type: "image/png",
  };
  return {
    title: guide.title,
    description: guide.description,
    ...(guide.released === null ? { robots: UNRELEASED_ROBOTS } : {}),
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      url: `/guides/${guide.slug}`,
      title: guide.title,
      description: guide.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: guide.title,
      description: guide.description,
      images: [image],
    },
  };
}
