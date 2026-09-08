import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { resetSaveState, saveState } from "@/persistence/save-state";

function Boom(): ReactElement {
  throw new Error("angular fanning divided by zero");
}

/**
 * React logs every error a boundary catches, and jsdom prints it. Silenced
 * here and only here, so a genuine console error elsewhere still shows.
 */
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSaveState();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("the canvas error boundary", () => {
  it("STARTS THE FLUSH before it renders its fallback", () => {
    // "Before the fallback renders" is the acceptance criterion's wording and
    // it is not literally achievable — IndexedDB is async and
    // `componentDidCatch` is sync, so React commits the fallback in the same
    // batch. What IS achievable, and what actually saves the drawing, is that
    // the write has been HANDED OFF by the time the fallback exists. That is
    // what this asserts: the flush was called, synchronously, during the
    // commit that produced the fallback.
    const flush = vi.fn(() => Promise.resolve(null));

    render(
      <CanvasErrorBoundary onFlush={flush}>
        <Boom />
      </CanvasErrorBoundary>,
    );

    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders its children untouched when nothing throws", () => {
    const flush = vi.fn(() => Promise.resolve(null));
    render(
      <CanvasErrorBoundary onFlush={flush}>
        <p>the canvas</p>
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText("the canvas")).toBeInTheDocument();
    expect(flush).not.toHaveBeenCalled();
  });

  it("shows the message rather than a bare apology", () => {
    render(
      <CanvasErrorBoundary onFlush={() => Promise.resolve(null)}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText(/angular fanning divided by zero/)).toBeInTheDocument();
  });

  it("offers a way back to the recents grid", () => {
    render(
      <CanvasErrorBoundary onFlush={() => Promise.resolve(null)}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText("Back to my sketches")).toHaveAttribute("href", "/");
  });

  it("says so when the rescue write ALSO failed", async () => {
    // The worst case, and the one the user most needs told: the canvas is
    // down and the sketch did not reach storage either.
    render(
      <CanvasErrorBoundary onFlush={() => Promise.reject(new Error("No room."))}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(saveState().status).toBe("error");
    expect(saveState().message).toMatch(/No room/);
  });
});
