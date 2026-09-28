"use client";

/**
 * The status bar's issue counters, and the list they open.
 *
 * ── WHY A LIST AND NOT A TOOLTIP ───────────────────────────────────────────
 *
 * The counter used to carry every message in a `title`: "N has 4 bonds but
 * allows at most 3", with nothing to say WHICH nitrogen. On a drawing with
 * twenty of them that is a sentence with no address, and after a refused
 * "Clean up" it was worse — RDKit's own words, naming the atom by an index
 * nobody can see. So the counter opens a list, and every row is a place:
 * clicking it selects the atom and brings it to the middle of the view, where
 * the overlay is already ringing it. Where chem-core knows the obvious repair
 * — a charge, one bond order, a wedge turned round — the row carries it as a
 * button, applied as one undoable edit.
 *
 * ── ERRORS AND WARNINGS STAY APART (decision 77) ───────────────────────────
 *
 * Two counters, two tones, one list with two headings. A correctly drawn
 * allene is in the list, because it is worth being able to find, and it is
 * under its own heading in amber, because nothing about it is wrong.
 *
 * No chemistry here: the rows come from `editorIssues`, the fixes from
 * chem-core through `fixesFor`, and every click goes through `@/editor/issues`.
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { AlertTriangleIcon } from "lucide-react";

import type { Molecule } from "@starter/chem-core";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  applyFix,
  editorIssues,
  fixesFor,
  issueAtomName,
  locateIssue,
  type EditorIssue,
} from "@/editor/issues";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

/** Two buttons at most per row: past that the choice is not obvious. */
const MAX_FIXES_SHOWN = 2;

function sentence(message: string): string {
  return message.length === 0 ? message : message[0]!.toUpperCase() + message.slice(1);
}

function IssueRow({
  molecule,
  issue,
}: {
  readonly molecule: Molecule;
  readonly issue: EditorIssue;
}): ReactElement {
  const fixes = fixesFor(molecule, issue).slice(0, MAX_FIXES_SHOWN);
  const error = issue.severity === "error";
  return (
    <li
      data-issue-row=""
      data-issue-kind={issue.kind}
      data-issue-severity={issue.severity}
      data-issue-target={issue.atomId}
      className="border-b py-1.5 last:border-b-0"
    >
      <button
        type="button"
        data-issue-locate=""
        onClick={() => locateIssue(editorStore, issue)}
        title="Select this atom and centre it"
        className="hover:bg-muted focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded px-1.5 py-1 text-left outline-none focus-visible:ring-2"
      >
        <span
          className={cn(
            "text-xs font-semibold",
            error ? "text-destructive" : "text-amber-700 dark:text-amber-400",
          )}
        >
          {issueAtomName(molecule, issue.atomId)}
        </span>
        <span className="text-foreground text-xs">{sentence(issue.message)}</span>
      </button>
      {fixes.length === 0 ? null : (
        <div className="flex flex-wrap gap-1 px-1.5 pt-1">
          {fixes.map((fix) => (
            <button
              key={`${fix.kind}:${fix.title}`}
              type="button"
              data-issue-fix={fix.kind}
              onClick={() => applyFix(editorStore, issue, fix)}
              className="bg-background text-foreground hover:bg-muted focus-visible:ring-ring rounded border px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-2"
            >
              {fix.title}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/** Every issue on the current molecule, errors first. */
export function IssueList({
  molecule,
  issues,
}: {
  readonly molecule: Molecule;
  readonly issues: readonly EditorIssue[];
}): ReactElement {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity !== "error");
  return (
    <div data-shell="issue-list" className="flex max-h-80 w-96 flex-col overflow-y-auto">
      {issues.length === 0 ? (
        <p className="text-muted-foreground px-1.5 py-1 text-xs">
          No chemistry issues left in this structure.
        </p>
      ) : null}
      {errors.length === 0 ? null : (
        <section aria-label="Chemistry errors">
          <h3 className="text-muted-foreground px-1.5 pb-0.5 text-[11px] font-semibold uppercase">
            Chemistry errors
          </h3>
          <ul>
            {errors.map((issue, at) => (
              <IssueRow key={`${at}:${issue.kind}:${issue.atomId}`} molecule={molecule} issue={issue} />
            ))}
          </ul>
        </section>
      )}
      {warnings.length === 0 ? null : (
        <section aria-label="Not expressible in this build">
          <h3 className="text-muted-foreground px-1.5 pt-1 pb-0.5 text-[11px] font-semibold uppercase">
            Not expressible in this build
          </h3>
          <ul>
            {warnings.map((issue, at) => (
              <IssueRow key={`${at}:${issue.kind}:${issue.atomId}`} molecule={molecule} issue={issue} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function errorCountText(count: number): string {
  return `${count} chemistry ${count === 1 ? "error" : "errors"}`;
}

/**
 * The red error counter and the amber warning counter, each opening the list.
 *
 * With nothing to list the red counter is plain text reading "0 chemistry
 * errors" — a button that opens an empty list is a button that does nothing.
 */
export function IssueStatus(): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const refusal = useEditorStore((state) => state.ui.refusal);
  const issues = editorIssues(molecule, refusal);

  if (issues.length === 0) {
    return (
      <span
        data-status="issues"
        data-issue-count={0}
        title="No valence or wedge errors in this structure"
      >
        {errorCountText(0)}
      </span>
    );
  }
  return <IssueCounters molecule={molecule} issues={issues} />;
}

/**
 * The counters as buttons, and the list they open.
 *
 * Its own component so the open flag lives and dies with a non-empty list.
 * Held one level up, it outlived the last fix — the list closed because the
 * counters stopped rendering, not because anything said so — and the next
 * issue to arrive, a refused "Clean up" say, reopened the list over the
 * canvas without anyone asking for it.
 */
function IssueCounters({
  molecule,
  issues,
}: {
  readonly molecule: Molecule;
  readonly issues: readonly EditorIssue[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity !== "error");
  const title =
    errors.length === 0
      ? "No valence or wedge errors in this structure"
      : errors.map((issue) => issue.message).join("\n");
  const errorText = errorCountText(errors.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="flex items-center gap-4">
          <button
            type="button"
            data-status="issues"
            data-issue-count={errors.length}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={title}
            onClick={() => setOpen((was) => !was)}
            className={cn(
              "hover:bg-muted rounded px-1 py-0.5",
              errors.length > 0 ? "text-destructive flex items-center gap-1" : "",
            )}
          >
            {errors.length > 0 ? <AlertTriangleIcon className="size-3" /> : null}
            {errorText}
          </button>
          {warnings.length === 0 ? null : (
            // Decision 77's amber counter, in the annotation notice's tone.
            <button
              type="button"
              data-status="structure-warnings"
              data-warning-count={warnings.length}
              aria-haspopup="dialog"
              aria-expanded={open}
              title={warnings.map((issue) => issue.message).join("\n")}
              onClick={() => setOpen((was) => !was)}
              className="hover:bg-muted flex items-center gap-1 rounded px-1 py-0.5 font-medium text-amber-700 dark:text-amber-400"
            >
              <AlertTriangleIcon className="size-3" />
              {warnings.length === 1
                ? "1 feature not expressible"
                : `${warnings.length} features not expressible`}
            </button>
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent side="top" align="start" aria-label="Chemistry issues">
        <IssueList molecule={molecule} issues={issues} />
      </PopoverContent>
    </Popover>
  );
}
