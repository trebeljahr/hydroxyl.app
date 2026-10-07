/**
 * `/guides/skeletal-formula` — where the carbons and the hydrogens are in a
 * skeletal formula, worked through L-isoleucine.
 *
 * A server component with no client state, like the journal guide. In the
 * static export it is moved to the export root as
 * `guides-skeletal-formula.html` (decision 137, `scripts/flatten-export.mjs`).
 *
 * Its title, description, social card and whether it is released all come
 * from its entry in `components/guides/guides.ts` (decision 243).
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { guideBySlug } from "@/components/guides/guides";
import { guideMetadata } from "@/components/guides/metadata";
import { SkeletalFormulaGuide } from "@/components/guides/SkeletalFormulaGuide";

const GUIDE = guideBySlug("skeletal-formula");

export const metadata: Metadata = guideMetadata(GUIDE);

export default function SkeletalFormulaPage(): ReactElement {
  return (
    <GuidePageShell>
      <SkeletalFormulaGuide />
    </GuidePageShell>
  );
}
