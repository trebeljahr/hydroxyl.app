/**
 * `/robots.txt` (decision 122).
 *
 * The editor is closed to crawlers: its `?doc=` URLs name a document in one
 * visitor's IndexedDB, so a crawler following a shared link would index an
 * empty canvas. `Disallow` matches by prefix, which covers `/editor/`,
 * `/editor?doc=…` and the static export's `editor.html` with one rule.
 */

import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/deployment";

// Measured: without it `output: "export"` refuses the route outright ("export
// const dynamic = "force-static" … not configured on route"), even though
// nothing here reads the request. Standalone would cache it as static anyway.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/editor" },
    sitemap: new URL("sitemap.xml", siteUrl()).href,
  };
}
