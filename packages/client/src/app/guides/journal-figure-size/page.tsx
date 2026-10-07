/**
 * `/guides/journal-figure-size` — how big a structure should print in a
 * journal column, with ACS's numbers and the editor's.
 *
 * A server component with no client state, like `/about`. In the static
 * export this page is moved to the export root as
 * `guides-journal-figure-size.html` (decision 137, `scripts/flatten-export.mjs`),
 * which is why every link on it is a root-level href from `@/lib/deployment`.
 *
 * Its title, description, social card and whether it is released all come
 * from its entry in `components/guides/guides.ts` (decision 243).
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { guideBySlug } from "@/components/guides/guides";
import { JournalFigureSizeGuide } from "@/components/guides/JournalFigureSizeGuide";
import { guideMetadata } from "@/components/guides/metadata";

const GUIDE = guideBySlug("journal-figure-size");

export const metadata: Metadata = guideMetadata(GUIDE);

export default function JournalFigureSizePage(): ReactElement {
  return (
    <GuidePageShell>
      <JournalFigureSizeGuide />
    </GuidePageShell>
  );
}
