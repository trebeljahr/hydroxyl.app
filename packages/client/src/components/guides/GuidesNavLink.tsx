/**
 * The "Guides" link in a page header, shown only once a guide is released
 * (decision 243). Until then the `/guides` index lists nothing, and a link to
 * an empty page is a link nobody should follow.
 *
 * A plain anchor from `@/lib/deployment`, like every link between pages.
 */

import type { ReactElement } from "react";

import { guidesIndexHref } from "@/lib/deployment";

import { GUIDES, releasedGuides } from "./guides";
import type { Guide } from "./guides";

export function GuidesNavLink({
  guides = GUIDES,
  dataAttribute = "guides",
}: {
  readonly guides?: readonly Guide[];
  /** Read by the specs: `data-nav="guides"`. */
  readonly dataAttribute?: string;
}): ReactElement | null {
  if (releasedGuides(guides).length === 0) return null;
  return (
    <a
      href={guidesIndexHref()}
      data-nav={dataAttribute}
      className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5"
    >
      Guides
    </a>
  );
}
