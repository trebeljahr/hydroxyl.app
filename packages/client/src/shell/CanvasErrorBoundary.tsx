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
 * ── AND IT REPORTS WHAT THE FLUSH ACTUALLY DID ─────────────────────────────
 *
 * The first version printed "Your sketch has been saved" unconditionally and
 * handled only a REJECTED flush. Nothing rejects: `saveDocument` resolves a
 * `StoreResult`, `persistence/types.ts` states the contract as "nothing here
 * throws", and a quota-exhausted put really does resolve `{ok:false}`. So the
 * one case the sentence most needed to be right about — the canvas is down AND
 * the sketch did not reach storage — was the one it got wrong, while the
 * status bar beside it (which stays mounted, outside this boundary) showed the
 * quota error. The result is inspected now, and the fallback says one of three
 * things.
 *
 * ── THERE IS A WAY OUT THAT IS NOT THE SAME DOCUMENT ───────────────────────
 *
 * `canvas/crash.ts` records the measurement that React swallows a one-shot
 * throw as a recoverable error, so the throws that actually reach
 * `componentDidCatch` are the DETERMINISTIC ones: a geometry bug over a
 * particular molecule, which is the case this boundary exists for. Both
 * original exits led straight back to it — Reload is the same URL, and the
 * recents card links at the same id — so the sketch that broke the canvas
 * became permanently unopenable. "Start a blank sketch" is the third exit, and
 * it is the reason the flush above is not a trap: the document is safe in
 * storage, and the editor is reachable without it.
 *
 * ── AND WHY IT DOES NOT `console.error` ────────────────────────────────────
 *
 * `e2e/editor.spec.ts` fails a spec on any console error, deliberately. The
 * error is put on screen and into the save-state store instead, which is where
 * a person will actually see it. React itself still logs the error it caught;
 * that is React's, not ours.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { editorHref, recentsHref } from "@/lib/deployment";
import { cn } from "@/lib/utils";
import { markSaveFailed } from "@/persistence/save-state";
import type { StoreResult } from "@/persistence/types";

export interface CanvasErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Write the current document NOW. Injected rather than imported so this
   * component can be unit-tested without storage, and so the editor page owns
   * the wiring between the autosave loop and its own flush.
   */
  readonly onFlush: () => Promise<StoreResult<void> | null>;
  /** Where "Back to my sketches" goes. Resolved at render time in the export,
   *  where the recents page is a document-relative `index.html`. */
  readonly recentsHref?: string;
  /** Where "Start a blank sketch" goes — the editor with no `?doc=`. */
  readonly newSketchHref?: string;
}

/** What the rescue write did. `null` means it has not answered yet. */
type RescueOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface CanvasErrorBoundaryState {
  readonly error: Error | null;
  readonly rescue: RescueOutcome | null;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  override state: CanvasErrorBoundaryState = { error: null, rescue: null };

  private mounted = true;

  static getDerivedStateFromError(error: unknown): CanvasErrorBoundaryState {
    // `rescue` is cleared with it: a fresh throw gets a fresh answer about the
    // rescue write, rather than inheriting the previous one's verdict.
    return { error: error instanceof Error ? error : new Error(String(error)), rescue: null };
  }

  override componentWillUnmount(): void {
    this.mounted = false;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void info;
    // FIRST STATEMENT IN THE METHOD. Everything else here is presentation;
    // this is the drawing.
    this.props.onFlush().then(
      (result) => {
        // `null` means the document was already the one on disk, which is a
        // success — the autosave debounce had already fired.
        if (result === null || result.ok) {
          this.settle({ ok: true });
          return;
        }
        // The contract-honouring failure, and the one the first version could
        // not see: a refusal RESOLVES, it does not reject.
        markSaveFailed(result.error.message);
        this.settle({ ok: false, message: result.error.message });
      },
      (flushError: unknown) => {
        const message =
          flushError instanceof Error ? flushError.message : String(flushError);
        markSaveFailed(
          `The canvas failed and the sketch could not be saved either: ${message}`,
        );
        this.settle({ ok: false, message });
      },
    );
    void error;
  }

  /** `setState` after an await, so guarded: the boundary can be unmounted by
   *  a route change while the write is still in flight. */
  private settle(rescue: RescueOutcome): void {
    if (!this.mounted) return;
    this.setState({ rescue });
  }

  override render(): ReactNode {
    const { error, rescue } = this.state;
    if (error === null) return this.props.children;
    const rescueLine =
      rescue === null
        ? "Saving your sketch…"
        : rescue.ok
          ? "Your sketch has been saved — reload to carry on from where you were."
          : `Your sketch could NOT be saved: ${rescue.message}`;
    return (
      <div
        data-shell="canvas-error"
        role="alert"
        className="bg-background flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h2 className="text-lg font-semibold">The canvas stopped drawing</h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          Something went wrong while rendering this structure.
        </p>
        <p
          data-shell="canvas-error-rescue"
          data-rescue={rescue === null ? "pending" : rescue.ok ? "saved" : "failed"}
          className={cn(
            "max-w-prose text-sm",
            rescue !== null && !rescue.ok ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          {rescueLine}
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
            href={this.props.newSketchHref ?? editorHref()}
            data-shell="canvas-error-new"
            className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
          >
            Start a blank sketch
          </a>
          <a
            href={this.props.recentsHref ?? recentsHref()}
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
