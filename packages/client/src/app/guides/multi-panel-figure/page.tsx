/**
 * `/guides/multi-panel-figure` — one molecule in four lettered, captioned
 * panels at single-column width, and the clicks that build it.
 *
 * A server component with no client state, like the figure-size guide. In
 * the static export it is moved to `guides-multi-panel-figure.html`
 * (decision 137, `scripts/flatten-export.mjs`).
 *
 * Its title, description, social card and whether it is released all come
 * from its entry in `components/guides/guides.ts` (decision 243).
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { guideBySlug } from "@/components/guides/guides";
import { guideMetadata } from "@/components/guides/metadata";
import { MultiPanelFigureGuide } from "@/components/guides/MultiPanelFigureGuide";

const GUIDE = guideBySlug("multi-panel-figure");

export const metadata: Metadata = guideMetadata(GUIDE);

export default function MultiPanelFigurePage(): ReactElement {
  return (
    <GuidePageShell>
      <MultiPanelFigureGuide />
    </GuidePageShell>
  );
}
