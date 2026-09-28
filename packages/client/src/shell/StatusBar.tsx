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
 *
 * ── THE DONATE LINK OPENS A NEW TAB ────────────────────────────────────────
 *
 * The editor has no site footer, so the link sits at the end of this strip.
 * A new tab, so the drawing stays open where it was and nothing depends on
 * the leave-page save path. It is left out of the static export: that build
 * is what an app-store shell would package, and the store rules forbid a
 * link to an outside payment page.
 */

import type { ReactElement } from "react";
import { AlertTriangleIcon } from "lucide-react";

import type { ValenceIssue } from "@starter/chem-core";
import type { UnplacedAnnotation } from "@starter/chem-render";

import { canvasAnnotatedScene } from "@/canvas/scene-bridge";
import { commandById } from "@/editor/commands/registry";
import { isFileExportBuild } from "@/lib/deployment";
import { DONATE_URL } from "@/lib/donation";
import { useSaveState } from "@/persistence/save-state";
import { moleculeErrors, moleculeMass, moleculeWarnings } from "@/editor/derived";
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

/** "a9 (S)" — which atom or bond, and what it says. */
function unplacedLine(u: UnplacedAnnotation): string {
  const where = u.source.kind === "atom" ? u.source.atomId : u.source.bondId;
  return `${where} ${u.text}`;
}

/**
 * What the canvas's panel left out of the drawing (decisions 62 and 70), or
 * nothing when everything it has to say is on the page.
 *
 * THE COUNT IS THE MISSING ONES ONLY. An annotation the pass reports is not
 * necessarily absent: most are DRAWN, at a slot that crosses a bond line or
 * sits closer to a neighbour than the rule likes, and at Publication that is
 * the normal state of a fused ring — all four of the steroid's (S) are drawn
 * and legible there. Counting those made the bar cry wolf on a good figure.
 * So "N annotations not shown" counts only what `dropped` leaves out
 * (decisions 58 and 64), and the tight ones are listed under their own
 * heading in the tooltip, where an author looking for something to nudge will
 * find them. Both kinds stay in `AnnotationLayout.unplaced`: the layout is
 * the tooling's report, this is the one line a chemist reads.
 *
 * The report comes from the canvas's own build — `canvasAnnotatedScene` — so
 * it describes exactly the picture on screen.
 *
 * A WARNING TONE, NOT THE DESTRUCTIVE ONE (decision 66). The red beside it is
 * for valence and structural errors: the structure is wrong and the file
 * would be wrong. A missing annotation is a crowded picture with sound
 * chemistry, so it reads as the export dialog's warnings do, in amber.
 */
function UnplacedAnnotations(): ReactElement | null {
  const doc = useEditorStore((state) => state.document);
  const activePanelId = useEditorStore((state) => state.ui.activePanelId);
  const { unplaced } = canvasAnnotatedScene(doc, activePanelId).annotations;
  const notShown = unplaced.filter((u) => u.dropped);
  const tight = unplaced.filter((u) => !u.dropped);
  if (notShown.length === 0) return null;
  const title = [
    `Not shown: ${notShown.map(unplacedLine).join(", ")}`,
    ...(tight.length === 0 ? [] : [`Tight: ${tight.map(unplacedLine).join(", ")}`]),
  ].join("\n");
  return (
    <span
      data-status="annotations"
      data-not-shown={notShown.length}
      data-tight={tight.length}
      title={title}
      className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
    >
      <AlertTriangleIcon className="size-3" />
      {notShown.length} {notShown.length === 1 ? "annotation" : "annotations"} not shown
    </span>
  );
}

/**
 * Chemistry this build cannot fully express, in the ANNOTATION NOTICE'S TONE
 * (decisions 66 and 77), never in the error colour.
 *
 * An allene, an atropisomeric biaryl, a spirane, a cyclophane and a helicene
 * are all drawn correctly and are all chiral in a way no descriptor here can
 * state. Counted beside the valence errors, as they used to be, a correct
 * BINAP read as "1 valence issue" in red, which tells a chemist to go and fix
 * a structure that has nothing wrong with it. The wording says what is true
 * instead: the editor cannot express part of this, not that the author drew
 * it badly. Amber, like the export dialog's warnings and the unplaced
 * annotations beside it.
 */
function StructureWarnings({
  warnings,
}: {
  readonly warnings: readonly ValenceIssue[];
}): ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <span
      data-status="structure-warnings"
      data-warning-count={warnings.length}
      title={warnings.map((issue) => issue.message).join("\n")}
      className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
    >
      <AlertTriangleIcon className="size-3" />
      {warnings.length === 1
        ? "1 feature not expressible"
        : `${warnings.length} features not expressible`}
    </span>
  );
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
  const errors = moleculeErrors(doc.molecule);
  const warnings = moleculeWarnings(doc.molecule);

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
        data-issue-count={errors.length}
        title={
          errors.length === 0
            ? "No valence or wedge errors in this structure"
            : errors.map((issue) => issue.message).join("\n")
        }
        className={errors.length > 0 ? "text-destructive flex items-center gap-1" : ""}
      >
        {errors.length > 0 ? <AlertTriangleIcon className="size-3" /> : null}
        {errors.length} chemistry {errors.length === 1 ? "error" : "errors"}
      </span>

      <StructureWarnings warnings={warnings} />

      <UnplacedAnnotations />

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

      {isFileExportBuild() ? null : (
        <a
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-status="donate"
          className="hover:bg-muted hover:text-foreground rounded px-2 py-0.5"
        >
          Donate
        </a>
      )}
    </footer>
  );
}
