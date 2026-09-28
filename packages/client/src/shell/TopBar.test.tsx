/**
 * The top bar's way out of the editor.
 *
 * The href is the half that breaks silently. The static export can be served
 * from a subdirectory, or loaded as a document-relative `index.html` inside an
 * app-store shell, and a literal "/" there names a file outside the bundle —
 * the link renders, looks right, and lands on the host's root. So the link is
 * asserted as the browser would resolve it from an editor that lives three
 * directories down.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { editorStore } from "@/state";

import { TopBar } from "./TopBar";

const leaveToRecents = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// The registry's `file.recents` calls this, and the real one navigates, which
// jsdom does not implement. What it does is pinned in `file.test.ts`; here the
// question is only whether a click reaches it.
vi.mock("@/editor/commands/file", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/editor/commands/file")>()),
  leaveToRecents,
}));

function renderTopBar(): void {
  render(
    <TooltipProvider>
      <TopBar />
    </TooltipProvider>,
  );
}

function recentsLink(): HTMLAnchorElement {
  return screen.getByRole("link", { name: "Back to my sketches" });
}

afterEach(() => {
  vi.unstubAllEnvs();
  leaveToRecents.mockClear();
  document.head.querySelectorAll("base").forEach((b) => b.remove());
});

describe("the top bar's link back to the recents grid", () => {
  it("resolves beside the editor when the export is served under a subpath", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const base = document.createElement("base");
    base.href = "https://example.test/lab/tools/chem/editor.html?doc=doc_1";
    document.head.append(base);

    renderTopBar();

    expect(recentsLink().getAttribute("href")).toBe("index.html");
    expect(recentsLink().href).toBe("https://example.test/lab/tools/chem/index.html");
  });

  it("is the route in the server build", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    renderTopBar();
    expect(recentsLink().getAttribute("href")).toBe("/");
  });

  it("is already right in the prerendered HTML, not only after hydration", () => {
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TopBar />
      </TooltipProvider>,
    );
    expect(html).toMatch(/<a href="index\.html"[^>]*data-shell="recents-link"/);
  });

  it("saves-then-leaves on a plain click, instead of letting the browser navigate", () => {
    renderTopBar();
    const allowed = fireEvent.click(recentsLink());
    // `fireEvent` answers false when a handler called preventDefault: the
    // navigation is `leaveToRecents`'s to make, after its write.
    expect(allowed).toBe(false);
    expect(leaveToRecents).toHaveBeenCalledWith(editorStore);
  });

  it("leaves a modified click to the browser, which opens another tab", () => {
    renderTopBar();
    // Read at the window, after React's own listener has run, and cancelled
    // THERE: jsdom would otherwise try to follow the link and log that it
    // cannot navigate.
    const prevented: boolean[] = [];
    const record = (event: Event): void => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    try {
      for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
        fireEvent.click(recentsLink(), modifier);
      }
    } finally {
      window.removeEventListener("click", record);
    }
    expect(prevented).toEqual([false, false, false]);
    expect(leaveToRecents).not.toHaveBeenCalled();
  });
});
