/**
 * `/guides` — the released guides (decision 243). One level down, like
 * `/about`, so the static export writes it flat as `guides.html`.
 *
 * While no guide is released it lists nothing, nothing links to it, it is
 * not in the sitemap, and it asks crawlers not to index it.
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { GUIDES, releasedGuides } from "@/components/guides/guides";
import { GuidesIndex } from "@/components/guides/GuidesIndex";
import { UNRELEASED_ROBOTS } from "@/components/guides/metadata";

export const metadata: Metadata = {
  title: "Guides",
  description: "How to draw a chemical structure and export it for a paper or a course.",
  ...(releasedGuides().length === 0 ? { robots: UNRELEASED_ROBOTS } : {}),
};

export default function GuidesPage(): ReactElement {
  return (
    <GuidePageShell>
      <GuidesIndex guides={GUIDES} />
    </GuidePageShell>
  );
}
