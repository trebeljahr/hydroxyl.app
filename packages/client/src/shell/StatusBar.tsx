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
 *
 * ── THE SAVE INDICATOR IS NOT DECORATION ──────────────────────────────────
 *
 * A write to IndexedDB fails silently by default: the abort carries its reason
 * and no listener, and the chemist keeps drawing on a document that stopped
 * being saved several minutes ago. So the failure state is rendered in the
 * destructive colour with the reason beside it, and the aria-live message line
 * says it too — a full disk is actionable (delete a sketch, export this one)
 * and only if someone is told.
 *
 * BOTH BUTTONS ARE REGISTRY ENTRIES. Fit used to build the scene and call
 * `zoomToFit` inline, which made it the one action in the whole shell with no
 * command behind it — no palette row, no shortcut, reachable from this strip
 * and nowhere else — and Reset duplicated `view.reset` rather than dispatching
 * it. Two code paths for one behaviour is exactly what the single registry is
 * meant to make impossible.
 */

import type { ReactElement } from "react";
import { AlertTriangleIcon } from "lucide-react";

import { commandById } from "@/editor/commands/registry";
import { useSaveState } from "@/persistence/save-state";
import { moleculeIssues, moleculeMass } from "@/editor/derived";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

/** Four significant decimals: the precision a monoisotopic mass is quoted to. */
function formatMass(value: number): string {
  return value.toFixed(4);
}

function formatCharge(charge: number): string {
  if (charge === 0) return "neutral";
  return charge > 0 ? `+${String(charge)}` : String(charge);
}

/**
 * One of the two viewport buttons, dispatched through the registry so its
 * disabled state is the same `enabled(state)` the palette greys on.
 */
function ViewButton({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}): ReactElement {
  const command = commandById(id);
  const enabled = useEditorStore((state) => command.enabled(state));
  return (
    <button
      type="button"
      data-command={id}
      disabled={!enabled}
      onClick={() => {
        void command.run(editorStore);
      }}
      className={cn(
        "rounded px-2 py-0.5",
        enabled ? "hover:bg-muted" : "cursor-not-allowed opacity-40",
      )}
    >
      {label}
    </button>
  );
}

/**
 * The save indicator. Five states, and the error one carries its reason.
 *
 * "Unsaved changes" is not padding between "Saved" and "Saving…": an edit made
 * inside the autosave debounce and followed immediately by a navigation does
 * not reach storage, and the indicator used to go on saying "Saved" for the
 * whole of that window. See persistence/save-state.ts.
 */
function SaveIndicator(): ReactElement {
  const save = useSaveState();
  const label =
    save.status === "saving"
      ? "Saving…"
      : save.status === "saved"
        ? "Saved"
        : save.status === "error"
          ? (save.message ?? "Not saved")
          : save.status === "unsaved"
            ? "Unsaved changes"
            : "Not saved yet";
  return (
    <span
      data-status="save-state"
      data-save-status={save.status}
      title={save.status === "error" ? label : undefined}
      className={cn(
        "min-w-0 max-w-[28rem] truncate",
        save.status === "error" ? "text-destructive font-medium" : "",
      )}
    >
      {label}
    </span>
  );
}

export function StatusBar(): ReactElement {
  const doc = useEditorStore((state) => state.document);
  const zoom = useEditorStore((state) => state.viewport.zoom);
  const message = useEditorStore((state) => state.ui.statusMessage);
  const buffer = useEditorStore((state) => state.ui.elementInputBuffer);

  const mass = moleculeMass(doc.molecule);
  const issues = moleculeIssues(doc.molecule);

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

      <SaveIndicator />

      <ViewButton id="view.fit" label="Fit" />
      <ViewButton id="view.reset" label="Reset" />
      <span
        data-status="zoom"
        className="w-12 text-right font-mono tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </span>
    </footer>
  );
}
