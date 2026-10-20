"use client";

/**
 * The Export dialog's support line: one light sentence under the buttons
 * after an export finishes, linking the donate page. `claimSupportLine` in
 * `lib/donation.ts` decides whether it may show and makes sure it shows once.
 *
 * Mounted with the dialog's content, so it listens only while the dialog is
 * open: an export made from the command palette earlier does not bring it up.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import { ProjectDonateLink } from "@/components/project-donate-link";
import { DONATE_URL, claimSupportLine, subscribeExportsFinished } from "@/lib/donation";

type LineState = "waiting" | "shown" | "closed";

export function SupportLine(): ReactElement | null {
  const [state, setState] = useState<LineState>("waiting");
  // Two exports can finish before the first answer renders; only the first asks.
  const decided = useRef(false);

  useEffect(() => {
    if (state !== "waiting") return;
    return subscribeExportsFinished(() => {
      if (decided.current) return;
      decided.current = true;
      setState(claimSupportLine() ? "shown" : "closed");
    });
  }, [state]);

  if (state !== "shown") return null;
  return (
    <p data-shell="support-line" className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
      <span aria-hidden="true">🍪</span>
      <span>
        If Hydroxyl saved you some time on this figure, you can{" "}
        <ProjectDonateLink
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          buy me some cookies
        </ProjectDonateLink>
        .
      </span>
      <button
        type="button"
        aria-label="Hide this line"
        title="Hide this line"
        data-shell="support-line-close"
        className="hover:bg-accent focus-visible:ring-ring ml-auto rounded px-1.5 leading-5 focus-visible:outline-none focus-visible:ring-2"
        onClick={() => setState("closed")}
      >
        ×
      </button>
    </p>
  );
}
