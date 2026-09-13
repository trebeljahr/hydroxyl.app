import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { resetSaveState, saveState } from "@/persistence/save-state";
import { storeFail, storeOk, type StoreResult } from "@/persistence/types";

/** `flushEditorDocument`'s real shape: a result, or null when there was
 *  nothing left to write. */
const flushedNothing = (): Promise<StoreResult<void> | null> => Promise.resolve(null);

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
    const flush = vi.fn(flushedNothing);

    render(
      <CanvasErrorBoundary onFlush={flush}>
        <Boom />
      </CanvasErrorBoundary>,
    );

    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders its children untouched when nothing throws", () => {
    const flush = vi.fn(flushedNothing);
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
      <CanvasErrorBoundary onFlush={flushedNothing}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText(/angular fanning divided by zero/)).toBeInTheDocument();
  });

  it("offers a way back to the recents grid", () => {
    render(
      <CanvasErrorBoundary onFlush={flushedNothing}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText("Back to my sketches")).toHaveAttribute("href", "/");
  });

  it("offers a BLANK sketch, so a document that reliably crashes is not a trap", async () => {
    // React swallows a one-shot throw as a recoverable error (see
    // canvas/crash.ts), so a throw that actually reaches `componentDidCatch`
    // is deterministic over this document. Reload is the same URL and the
    // recents card links at the same id, which left the sketch permanently
    // unopenable with no third exit.
    render(
      <CanvasErrorBoundary onFlush={flushedNothing}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(await screen.findByText("Start a blank sketch")).toHaveAttribute("href", "/editor");
  });

  it("reports a REFUSED rescue write, which RESOLVES rather than rejecting", async () => {
    // The case the first version could not see. `saveDocument` resolves a
    // StoreResult and never rejects — persistence/types.ts states the contract
    // as "nothing here throws", and a quota-exhausted put really does resolve
    // `{ok:false}` — so a boundary that handled only a rejection printed "Your
    // sketch has been saved" over a write that had been refused.
    render(
      <CanvasErrorBoundary
        onFlush={() => Promise.resolve(storeFail<void>("quota", "There is no room left."))}
      >
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(await screen.findByText(/could NOT be saved/)).toHaveTextContent(
      /There is no room left/,
    );
    expect(saveState().status).toBe("error");
    expect(saveState().message).toMatch(/no room left/i);
  });

  it("says the sketch is safe only once the write has actually answered", async () => {
    let settle: (result: StoreResult<void> | null) => void = () => undefined;
    const pending = new Promise<StoreResult<void> | null>((resolve) => {
      settle = resolve;
    });
    render(
      <CanvasErrorBoundary onFlush={() => pending}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    // Not "saved" yet — that sentence was unconditional before, and printed
    // beside a write that had not happened.
    expect(screen.getByText(/Saving your sketch/)).toBeInTheDocument();

    settle(storeOk<void>(undefined));
    expect(await screen.findByText(/has been saved/)).toBeInTheDocument();
  });

  it("says so when the rescue write REJECTED", async () => {
    // The other worst case: not a refusal but a throw on the way to storage.
    render(
      <CanvasErrorBoundary onFlush={() => Promise.reject(new Error("No room."))}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(await screen.findByText(/could NOT be saved/)).toHaveTextContent(/No room/);
    expect(saveState().status).toBe("error");
    expect(saveState().message).toMatch(/No room/);
  });
});
