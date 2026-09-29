/**
 * `/about` — the landing page on its own, for a link from outside and for
 * anyone who already has sketches and wants the explanation.
 *
 * A server component with no client state. The header links are plain
 * anchors computed from the build flag, for the reason given in
 * `@/lib/deployment`.
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { Landing } from "@/components/landing/Landing";
import { landingSocialMetadata } from "@/components/landing/metadata";
import { editorHref, recentsHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

const DESCRIPTION =
  "Draw a molecule once and export it as skeletal, Lewis or condensed-formula panels, " +
  "sized for a journal column. Runs in the browser with no account.";

export const metadata: Metadata = {
  title: "About",
  description: DESCRIPTION,
  ...landingSocialMetadata({
    path: "/about",
    title: `About ${SITE_NAME}`,
    description: DESCRIPTION,
  }),
};

export default function AboutPage(): ReactElement {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <a href={recentsHref()} className="text-lg font-semibold tracking-tight">
          Chemistry Sketcher
        </a>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <a
            href={recentsHref()}
            data-about="sketches"
            className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5"
          >
            Your sketches
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
        <Landing />
      </main>
    </div>
  );
}
