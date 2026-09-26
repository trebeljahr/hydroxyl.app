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

  /**
   * THE SECOND `typeof`-BRANCH IN THIS FILE, and the one that has not bitten
   * yet. `isApplePlatform()` answers `false` where there is no `navigator` and
   * reads the real one in a browser, so any shortcut hint it formats is "Ctrl"
   * in the prerendered HTML and "⌘" on a Mac — the same class of mismatch as
   * the document id, in text rather than in an attribute.
   *
   * It is harmless today only because every call site renders inside a
   * `TooltipContent` or the command palette's dialog, and Radix renders
   * neither on the server. That is a fact about where a hint happens to sit,
   * not a decision anyone recorded, so it is pinned here: a shortcut hint
   * moved into the header proper fails this.
   */
  it("prerenders no keyboard shortcut, so no platform branch reaches the HTML", () => {
    expect(prerender()).not.toMatch(/Ctrl|Shift|Alt|⌘|⇧|⌥/);
  });

  it("renders the same markup twice", () => {
    // A weaker assertion than the one above and worth having anyway: it fails
    // for ANY unstable value that reaches the header — a formatted date, a
    // `typeof window` branch, a second generated id.
    expect(prerender()).toBe(prerender());
  });
});
