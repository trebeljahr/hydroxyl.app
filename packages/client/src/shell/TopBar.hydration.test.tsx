/**
 * What the PRERENDER writes into `out/editor.html`.
 *
 * The hydration mismatch in manual notes 3 was one attribute: the header's
 * `data-doc-id`. The server's module instance and the browser's each built
 * their own startup document, each with an id minted from `Date.now()` and
 * `Math.random()`, so the attribute could not agree — and React does not patch
 * a mismatched attribute up, so the served markup kept the BUILD's id.
 *
 * Asserting on the server-rendered string is the closest a unit test gets to
 * the symptom: this is literally the byte sequence `next build` emits, and it
 * is the same assertion `e2e/shell.spec.ts` makes against the built page.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { STARTUP_DOCUMENT_ID } from "@/state";

import { TopBar } from "./TopBar";

function prerender(): string {
  // The provider is the shell's, not decoration: `TopBar`'s buttons are
  // `TooltipTrigger`s and Radix throws without one.
  return renderToStaticMarkup(
    <TooltipProvider>
      <TopBar />
    </TooltipProvider>,
  );
}

describe("the prerendered top bar", () => {
  it("names the fixed startup document, not a minted id", () => {
    expect(prerender()).toContain(`data-doc-id="${STARTUP_DOCUMENT_ID}"`);
  });

  it("renders the same markup twice", () => {
    // A weaker assertion than the one above and worth having anyway: it fails
    // for ANY unstable value that reaches the header — a formatted date, a
    // `typeof window` branch, a second generated id.
    expect(prerender()).toBe(prerender());
  });
});
