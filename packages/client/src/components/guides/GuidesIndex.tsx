/**
 * The `/guides` index: every released guide, newest first, and nothing else
 * (decision 243). An unreleased guide is not listed, not even greyed out —
 * the index is public, and the guide is not yet.
 */

import type { ReactElement } from "react";

import { guideHref } from "@/lib/deployment";

import { releasedGuides } from "./guides";
import type { Guide } from "./guides";

function publishedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function GuidesIndex({ guides }: { readonly guides: readonly Guide[] }): ReactElement {
  const listed = releasedGuides(guides);
  return (
    <article data-guides="index" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <header className="py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Guides</h1>
        <p className="text-muted-foreground mt-4 max-w-prose text-lg leading-relaxed">
          How to draw a chemical structure and export it for a paper or a course. Each guide has
          figures you can open in the editor.
        </p>
      </header>
      {listed.length === 0 ? (
        <p data-guides="empty" className="text-muted-foreground border-t py-8">
          No guides are published yet.
        </p>
      ) : (
        <ul className="border-t">
          {listed.map((guide) => (
            <li
              key={guide.slug}
              data-guides="entry"
              data-guide-slug={guide.slug}
              className="border-b py-6"
            >
              <a
                href={guideHref(guide.slug)}
                className="text-foreground text-xl font-semibold tracking-tight underline-offset-4 hover:underline"
              >
                {guide.title}
              </a>
              <p className="text-muted-foreground mt-2 leading-relaxed">{guide.description}</p>
              {guide.released === null ? null : (
                <p className="text-muted-foreground mt-2 text-sm">
                  Published <time dateTime={guide.released}>{publishedOn(guide.released)}</time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
