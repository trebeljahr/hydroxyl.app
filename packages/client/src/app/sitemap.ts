/**
 * `/sitemap.xml`, the landing and the about page (decision 122).
 *
 * No `lastModified`: the only date to hand is the build's, and stamping it
 * would tell crawlers both pages changed on every deploy.
 */

import type { MetadataRoute } from "next";

import { indexablePageUrls } from "@/lib/deployment";

// Measured: without it `output: "export"` refuses the route outright ("export
// const dynamic = "force-static" … not configured on route"), even though
// nothing here reads the request. Standalone would cache it as static anyway.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return indexablePageUrls().map((url) => ({ url }));
}
