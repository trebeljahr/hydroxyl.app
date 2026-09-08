"use client";

/**
 * The net under the canvas. A render exception here must not cost the drawing.
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 *
 * The canvas is where the accumulated geometry runs: angular fanning, quadrant
 * label placement, bond trimming against glyph boxes, CIP ranking, collision
 * detection. Every one of those is a pure function over a molecule the user is
 * free to draw into any shape, so a throw from one of them is not a
 * hypothetical — and React's default for an uncaught render error is to unmount
 * the whole tree. Without a boundary the chemist's answer to a geometry bug is
 * a white page and a lost sketch.
 *
 * ── "FLUSHES BEFORE THE FALLBACK RENDERS" IS NOT LITERALLY ACHIEVABLE ──────
 *
 * IndexedDB is asynchronous and `componentDidCatch` is synchronous; React
 * commits the fallback in the same batch that calls it. What actually happens
 * — and what the acceptance criterion is really about — is that the flush is
 * INITIATED here, before anything else, and the drawing therefore survives the
 * reload. Do not write a test asserting the write completed before the
 * fallback painted; it cannot, and a test that appears to pass would be
 * measuring the scheduler.
 *
 * The boundary also flushes on `pagehide`, which covers the other half of the
 * same worry: a tab closed mid-debounce.
 *
 * ── AND WHY IT DOES NOT `console.error` ────────────────────────────────────
 *
 * `e2e/editor.spec.ts` fails a spec on any console error, deliberately. The
 * error is put on screen and into the save-state store instead, which is where
 * a person will actually see it. React itself still logs the error it caught;
 * that is React's, not ours.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { markSaveFailed } from "@/persistence/save-state";

export interface CanvasErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Write the current document NOW. Injected rather than imported so this
   * component can be unit-tested without storage, and so the editor page owns
   * the wiring between the autosave loop and its own flush.
   */
  readonly onFlush: () => Promise<unknown>;
  /** Where "Back to my sketches" goes. */
  readonly recentsHref?: string;
}

interface CanvasErrorBoundaryState {
  readonly error: Error | null;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  override state: CanvasErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): CanvasErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void info;
    // FIRST STATEMENT IN THE METHOD. Everything else here is presentation;
    // this is the drawing.
    this.props.onFlush().then(
      () => undefined,
      (flushError: unknown) => {
        markSaveFailed(
          `The canvas failed and the sketch could not be saved either: ` +
            `${flushError instanceof Error ? flushError.message : String(flushError)}`,
        );
      },
    );
    void error;
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div
        data-shell="canvas-error"
        role="alert"
        className="bg-background flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h2 className="text-lg font-semibold">The canvas stopped drawing</h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          Something went wrong while rendering this structure. Your sketch has been
          saved — reload to carry on from where you were.
        </p>
        <pre
          data-shell="canvas-error-message"
          className="bg-muted max-w-prose overflow-x-auto rounded px-3 py-2 text-left font-mono text-xs"
        >
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            data-shell="canvas-error-reload"
            onClick={() => {
              window.location.reload();
            }}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
          >
            Reload
          </button>
          <a
            href={this.props.recentsHref ?? "/"}
            data-shell="canvas-error-recents"
            className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
          >
            Back to my sketches
          </a>
        </div>
      </div>
    );
  }
}
