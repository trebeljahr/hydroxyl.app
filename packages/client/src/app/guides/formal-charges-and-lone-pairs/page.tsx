/**
 * `/guides/formal-charges-and-lone-pairs` — the formal-charge rule, worked
 * in the Lewis view, and the editor's check for a missing charge.
 *
 * A server component with no client state, like `/about`. In the static
 * export this page is moved to the export root as
 * `guides-formal-charges-and-lone-pairs.html` (decision 137, `scripts/flatten-export.mjs`),
 * which is why every link on it is a root-level href from `@/lib/deployment`.
 *
 * Its title, description, social card and whether it is released all come
 * from its entry in `components/guides/guides.ts` (decision 243).
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { FormalChargesGuide } from "@/components/guides/FormalChargesGuide";
import { GuidePageShell } from "@/components/guides/GuidePageShell";
import { guideBySlug } from "@/components/guides/guides";
import { guideMetadata } from "@/components/guides/metadata";

const GUIDE = guideBySlug("formal-charges-and-lone-pairs");

export const metadata: Metadata = guideMetadata(GUIDE);

export default function FormalChargesPage(): ReactElement {
  return (
    <GuidePageShell>
      <FormalChargesGuide />
    </GuidePageShell>
  );
}
