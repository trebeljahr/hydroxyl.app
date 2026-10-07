/**
 * `/guides/glycine-zwitterion` — neutral glycine and its zwitterion: one sum
 * formula, one mass, two structures.
 *
 * A server component with no client state, like the journal-figure-size
 * guide. In the static export it is `guides-glycine-zwitterion.html`
 * (decision 137), so every link on it comes from `@/lib/deployment`.
 *
 * Its title, description, social card and whether it is released all come
 * from its entry in `components/guides/guides.ts` (decision 243).
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { GlycineZwitterionGuide } from "@/components/guides/GlycineZwitterionGuide";
import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { guideBySlug } from "@/components/guides/guides";
import { guideMetadata } from "@/components/guides/metadata";

const GUIDE = guideBySlug("glycine-zwitterion");

export const metadata: Metadata = guideMetadata(GUIDE);

export default function GlycineZwitterionPage(): ReactElement {
  return (
    <GuidePageShell>
      <GlycineZwitterionGuide />
    </GuidePageShell>
  );
}
