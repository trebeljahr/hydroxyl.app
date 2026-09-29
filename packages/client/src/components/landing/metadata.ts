/**
 * Open Graph and Twitter card metadata for the two pages that show the
 * landing: `/` and `/about` (decision 138).
 *
 * Not in the root layout, although that would reach every page: Next merges
 * `openGraph` per key, so a layout's `og:url` would be inherited by pages it
 * does not describe. And `/editor` gets no card on purpose — its `?doc=` URLs
 * open a sketch that exists only in the sharer's browser, so a preview would
 * promise the recipient something the link cannot show them.
 *
 * Paths are relative. The root layout's `metadataBase` makes them absolute,
 * and Next adds the trailing slash where the build uses one.
 */

import type { Metadata } from "next";

import { SITE_NAME } from "@/lib/site";

import { SOCIAL_CARD } from "./social-card";

export function landingSocialMetadata(page: {
  readonly path: string;
  readonly title: string;
  readonly description: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const image = {
    url: SOCIAL_CARD.path,
    width: SOCIAL_CARD.width,
    height: SOCIAL_CARD.height,
    alt: SOCIAL_CARD.alt,
    type: "image/png",
  };
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: page.path,
      title: page.title,
      description: page.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image],
    },
  };
}
