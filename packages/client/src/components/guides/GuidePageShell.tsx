/**
 * The header every guide page and the `/guides` index share: the site name,
 * "Guides" once one is released, "About" and "New sketch".
 *
 * A server component with no client state. In the static export each page it
 * wraps sits at the export root (decision 137), which is why every link here
 * is a root-level href from `@/lib/deployment`.
 */

import type { ReactElement, ReactNode } from "react";

import { aboutHref, editorHref, recentsHref } from "@/lib/deployment";
import { SITE_NAME } from "@/lib/site";

import { GuidesNavLink } from "./GuidesNavLink";

export function GuidePageShell({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <a href={recentsHref()} className="text-lg font-semibold tracking-tight">
          {SITE_NAME}
        </a>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <GuidesNavLink />
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
      <main>{children}</main>
    </div>
  );
}
