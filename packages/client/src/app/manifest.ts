/**
 * The web app manifest that makes the hosted editor installable (decision
 * 239). The name comes from `SITE_NAME`, so a rename reaches the installed
 * app's title, its launcher label and the install prompt with no second edit.
 *
 * `start_url` is the recents grid rather than the editor: an installed app
 * should open on the chemist's library. The icons are drawn by
 * `scripts/build-app-icons.mjs`.
 */

import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// As in robots.ts: `output: "export"` refuses a metadata route without it.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
