/**
 * `/guides/journal-figure-size` — how big a structure should print in a
 * journal column, with ACS's numbers and the editor's.
 *
 * A server component with no client state, like `/about`. In the static
 * export this page is moved to the export root as
 * `guides-journal-figure-size.html` (decision 137, `scripts/flatten-export.mjs`),
 * which is why every link on it is a root-level href from `@/lib/deployment`.
 *
 * Deliberately linked from nowhere yet: not the landing header, not a sitemap,
 * not a nav. Rico reads it first.
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { JournalFigureSizeGuide } from "@/components/guides/JournalFigureSizeGuide";
import { aboutHref, editorHref, recentsHref } from "@/lib/deployment";

export const metadata: Metadata = {
  title: "How big should a chemical structure be in a single-column figure?",
  description:
    "Bond length, label size and column width for a chemical structure in a journal figure, " +
    "from the ACS author guidelines, and how to export a figure at those sizes.",
};

export default function JournalFigureSizePage(): ReactElement {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <a href={recentsHref()} className="text-lg font-semibold tracking-tight">
          Chemistry Sketcher
        </a>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <a
            href={aboutHref()}
            className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5"
          >
            About
          </a>
          <a
            href={editorHref()}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium"
          >
            New sketch
          </a>
        </nav>
      </header>
      <main>
        <JournalFigureSizeGuide />
      </main>
    </div>
  );
}
