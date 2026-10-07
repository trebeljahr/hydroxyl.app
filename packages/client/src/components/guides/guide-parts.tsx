/**
 * The pieces every guide page is built from: a section, a tagged product
 * number, and a figure with its "Open this figure in the editor" link.
 *
 * Server components, like the guides that use them. Every link is a plain
 * anchor from `@/lib/deployment`, for the reason given there.
 */

import type { ReactElement, ReactNode } from "react";

import { editorExampleHref } from "@/lib/deployment";

import type { GuideFigure } from "./guides";
import type { WorkedFigure } from "./guide-figure";

/** A product number, tagged so the e2e spec can hold it to chem-render. */
export function N({ k, children }: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return <span data-guide-number={k}>{children}</span>;
}

export function Section({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={`${id}-heading`} data-guide-section={id} className="border-t py-8">
      <h2 id={`${id}-heading`} className="text-foreground mb-4 text-xl font-semibold tracking-tight">
        {heading}
      </h2>
      <div className="space-y-4 leading-relaxed">{children}</div>
    </section>
  );
}

export function WorkedExample({
  id,
  figure,
  label,
  opens,
}: {
  readonly id: string;
  readonly figure: WorkedFigure;
  readonly label: string;
  /** The guide figure this is, for its editor link. */
  readonly opens: GuideFigure;
}): ReactElement {
  return (
    <figure className="space-y-2">
      <div className="inline-block max-w-full rounded-lg border bg-white p-3 shadow-sm">
        <div
          data-guide-figure={id}
          role="img"
          aria-label={label}
          // CSS centimetres, so the figures on one page keep their printed
          // widths relative to each other. Markup this app generated at build
          // time from its own document, never from anyone's file.
          style={{ width: `${figure.widthCm}cm` }}
          className="max-w-full [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: figure.svg }}
        />
      </div>
      {/* A copy under a fresh id, stored only once edited (decision 127). */}
      <a
        href={editorExampleHref(opens.example)}
        data-guide-open-example={opens.example}
        className="text-foreground focus-visible:ring-ring block w-fit rounded-sm text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
      >
        Open this figure in the editor
      </a>
    </figure>
  );
}

/** "29 September 2026", for the day a cited page was read. */
export function fetchedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
