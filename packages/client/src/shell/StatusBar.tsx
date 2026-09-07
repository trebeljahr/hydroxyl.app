"use client";

/**
 * The status bar: what the drawing IS, what is wrong with it, and where the
 * view is.
 *
 * ── THE EM DASH IS A CONTRACT, NOT A PLACEHOLDER ───────────────────────────
 *
 * `massSummary().exactMass` is `undefined` when any element in the structure
 * has no verified monoisotopic mass, and chem-core's `exactMass()` THROWS in
 * that case rather than substituting an average atomic weight — a plausible
 * wrong mass in a paper is worse than a gap. The bar has to say the same
 * thing, so the undefined case renders as an em dash and never as an average
 * weight, a zero, or a hidden row.
 *
 * ── AND IT SHARES THE CANVAS'S WALK OF THE MOLECULE ────────────────────────
 *
 * Both numbers come through `@/editor/derived`, which memoises them on the
 * Molecule instance. The overlay's valence badges read the same cache, so a
 * document renders its issues once rather than once per consumer.
 *
 * The Fit / Reset / zoom block used to float over the bottom-right corner of
 * the canvas, with a comment saying it was deliberately not a toolbar and
 * would move when the real chrome arrived. This is that move: leaving it there
 * would have put two overlapping strips in the same corner.
 */

import { useCallback } from "react";
import type { ReactElement } from "react";
import { AlertTriangleIcon } from "lucide-react";

import { buildDocumentScene, fitBounds } from "@/canvas";
import { moleculeIssues, moleculeMass } from "@/editor/derived";
import { editorStore, useEditorStore } from "@/state";

/** Four significant decimals: the precision a monoisotopic mass is quoted to. */
function formatMass(value: number): string {
  return value.toFixed(4);
}

function formatCharge(charge: number): string {
  if (charge === 0) return "neutral";
  return charge > 0 ? `+${String(charge)}` : String(charge);
}

export function StatusBar(): ReactElement {
  const doc = useEditorStore((state) => state.document);
  const zoom = useEditorStore((state) => state.viewport.zoom);
  const message = useEditorStore((state) => state.ui.statusMessage);
  const buffer = useEditorStore((state) => state.ui.elementInputBuffer);

  const mass = moleculeMass(doc.molecule);
  const issues = moleculeIssues(doc.molecule);

  // Built on demand rather than memoised on the document: the canvas commits
  // on every pointer-move frame of a drag, and a memo keyed on `doc` would
  // rebuild a scene per frame for a button nobody is pressing. `buildScene`
  // costs 0.037 ms on a 300-atom structure, so paying it on the click is free.
  const fit = useCallback(() => {
    const state = editorStore.getState();
    state.zoomToFit(fitBounds(buildDocumentScene(state.document)), 0);
  }, []);

  return (
    <footer
      data-shell="status-bar"
      className="bg-background text-muted-foreground flex h-8 shrink-0 items-center gap-4 border-t px-3 text-xs"
    >
      <span data-status="formula" className="text-foreground font-medium">
        {mass.formulaUnicode === "" ? "Empty sketch" : mass.formulaUnicode}
      </span>

      <span data-status="weight" title="Average molecular weight">
        MW {formatMass(mass.molecularWeight)}
      </span>

      <span
        data-status="exact-mass"
        title={
          mass.exactMass === undefined
            ? "No verified monoisotopic mass for one of these elements"
            : "Monoisotopic exact mass"
        }
      >
        {/* The em dash. See the header — never an average weight in disguise. */}
        Exact {mass.exactMass === undefined ? "—" : formatMass(mass.exactMass)}
      </span>

      <span data-status="charge">Charge {formatCharge(mass.netCharge)}</span>

      <span
        data-status="issues"
        className={issues.length > 0 ? "text-destructive flex items-center gap-1" : ""}
      >
        {issues.length > 0 ? <AlertTriangleIcon className="size-3" /> : null}
        {issues.length} valence {issues.length === 1 ? "issue" : "issues"}
      </span>

      {buffer === "" ? null : (
        <span data-status="element-buffer" className="font-mono">
          {buffer}…
        </span>
      )}

      {/* One line of feedback from the last gesture, or nothing. `aria-live`
          because a refusal the user cannot see is a refusal they will repeat. */}
      <span
        data-status="message"
        role="status"
        aria-live="polite"
        className="text-foreground min-w-0 flex-1 truncate"
      >
        {message ?? ""}
      </span>

      <button
        type="button"
        onClick={fit}
        className="hover:bg-muted rounded px-2 py-0.5"
      >
        Fit
      </button>
      <button
        type="button"
        onClick={() => editorStore.getState().resetViewport()}
        className="hover:bg-muted rounded px-2 py-0.5"
      >
        Reset
      </button>
      <span
        data-status="zoom"
        className="w-12 text-right font-mono tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </span>
    </footer>
  );
}
