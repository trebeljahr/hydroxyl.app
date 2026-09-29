"use client";

/**
 * The figure panel chooser: which views of the molecule go into the exported
 * figure, and in which order.
 *
 * WHY IT EXISTS. The strip above the canvas showed "(a) Skeletal (b) Sum
 * formula" with nothing saying what a panel is or what the letter means, and
 * the export dialog sent the reader to the properties panel to change them.
 * Reported as "not sure what the a/b stuff is" and "the panels for the export
 * are a bit weird". So the chooser leads with one sentence that answers both,
 * and it is mounted where the question is asked: in a popover off the strip,
 * and beside the export preview, so the letters in the list and the letters in
 * the preview are on screen together.
 *
 * ONE EDITOR, TWO DOORS. It changes panels only through the store's
 * `addPanel` / `removePanel` / `movePanel`, the same actions the properties
 * panel's `FigurePanels` list calls, so the two can never disagree about the
 * figure. The chooser is the light version: add, remove, reorder. Captions,
 * per-panel view changes and the column count stay in the properties panel.
 *
 * STATES FOLLOW THE PICKER CONVENTION (4a8a0c9). Every entry names its own
 * ground AND ink, resting and hovered, and the muted ink means unavailable and
 * nothing else. A usable entry lights up under the pointer; an unavailable one
 * keeps its resting pair through the hover, stated rather than left to the
 * cascade, because `--muted-foreground` on `--accent` is 4.349:1 in light mode.
 * Unavailable entries are `disabled` and carry their reason as visible text,
 * the way the view-options checkboxes do.
 */

import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";

import {
  VIEW_KIND_TITLES,
  panelLetter,
  representationAvailability,
} from "@starter/chem-render";
import { VIEW_KINDS } from "@starter/shared";
import type { Panel, RepresentationKind } from "@starter/shared";

import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

import { blocking } from "./FigurePanels";
import { PLANNED_PROJECTIONS, PLANNED_PROJECTION_REASON } from "./planned-projections";

const FOCUS_RING = "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2";

/**
 * The two states a chooser entry can be in, each naming both of its colours
 * and its hover pair.
 *
 * `bg-popover`, not `bg-background`: the chooser sits in a popover and in the
 * dialog, both of which paint `bg-popover`, so the entry states the ground it
 * is actually drawn on. (The two tokens are equal today in both themes; naming
 * the right one keeps that an accident rather than a dependency.)
 */
export function chooserEntryClasses(available: boolean): string {
  return available
    ? "bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground"
    : "bg-popover text-muted-foreground hover:bg-popover hover:text-muted-foreground cursor-not-allowed";
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        // A scripted click still reaches onClick on a disabled button.
        if (!disabled) onClick();
      }}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
        FOCUS_RING,
        chooserEntryClasses(!disabled),
      )}
    >
      {children}
    </button>
  );
}

function PanelEntry({
  panel,
  index,
  count,
}: {
  readonly panel: Panel;
  readonly index: number;
  readonly count: number;
}): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const reasonId = useId();
  const letter = panelLetter(index);
  const kind = panel.representation.kind;
  const reason = blocking(representationAvailability(molecule, kind));
  const move = (delta: -1 | 1): void => editorStore.getState().movePanel(panel.id, delta);

  return (
    <li
      data-chooser-panel={panel.id}
      data-panel-letter={letter}
      data-panel-kind={kind}
      {...(reason === null ? {} : { "aria-describedby": reasonId })}
      className="bg-popover text-popover-foreground flex flex-col rounded-md border px-1.5 py-1"
    >
      <div className="flex items-center gap-1">
        <span className="w-7 shrink-0 font-mono font-semibold">({letter})</span>
        <span
          data-chooser-panel-title
          // Line-through is the non-colour signal for "this panel will not
          // export"; the ink stays at full contrast, same as the strip.
          className={cn("min-w-0 flex-1 truncate", reason !== null && "line-through")}
        >
          {VIEW_KIND_TITLES[kind]}
        </span>
        <IconButton
          label={`Move panel (${letter}) earlier`}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowUpIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label={`Move panel (${letter}) later`}
          disabled={index === count - 1}
          onClick={() => move(1)}
        >
          <ArrowDownIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label={`Remove panel (${letter}) from the figure`}
          disabled={false}
          onClick={() => editorStore.getState().removePanel(panel.id)}
        >
          <XIcon className="size-3.5" />
        </IconButton>
      </div>
      {reason === null ? null : (
        <p
          id={reasonId}
          data-chooser-reason
          className="text-muted-foreground pl-8 text-[11px] leading-snug"
        >
          {reason} This panel will not export until that changes.
        </p>
      )}
    </li>
  );
}

function AddViewEntry({ kind }: { readonly kind: RepresentationKind }): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const reasonId = useId();
  const why = blocking(representationAvailability(molecule, kind));
  const available = why === null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        data-add-view={kind}
        disabled={!available}
        {...(available ? {} : { "aria-describedby": reasonId })}
        onClick={() => {
          // Re-asked at click time, not trusted from the last render.
          const now = editorStore.getState().document.molecule;
          if (blocking(representationAvailability(now, kind)) !== null) return;
          editorStore.getState().addPanel(kind);
        }}
        className={cn(
          // Wraps rather than truncates: "Condensed formula" is the longest
          // title and a truncated view name is a guess the reader has to make.
          "flex min-h-7 items-center gap-1 rounded-md border px-1.5 py-1 text-left leading-tight transition-colors",
          FOCUS_RING,
          chooserEntryClasses(available),
        )}
      >
        <PlusIcon className="size-3.5 shrink-0" />
        <span>{VIEW_KIND_TITLES[kind]}</span>
      </button>
      {available ? null : (
        <p
          id={reasonId}
          data-add-view-reason={kind}
          className="text-muted-foreground px-1 text-[11px] leading-snug"
        >
          {why}
        </p>
      )}
    </div>
  );
}

function PlannedEntry({
  id,
  title,
  shows,
  reasonId,
}: {
  readonly id: string;
  readonly title: string;
  readonly shows: string;
  readonly reasonId: string;
}): ReactElement {
  return (
    <button
      type="button"
      disabled
      data-planned-view={id}
      // The name already carries what it shows (both spans are content), so
      // the description is only the reason it cannot be picked.
      aria-describedby={reasonId}
      className={cn(
        "flex flex-col items-start rounded-md border px-1.5 py-1 text-left",
        chooserEntryClasses(false),
      )}
    >
      <span className="font-medium">{title}</span>
      <span className="text-[11px] leading-snug">
        {shows}
      </span>
    </button>
  );
}

export function FigurePanelChooser({
  className,
}: {
  /** Layout only: where the chooser sits decides its height and scrolling. */
  readonly className?: string;
}): ReactElement {
  const panels = useEditorStore((state) => state.document.panels);
  const headingId = useId();
  const plannedReasonId = useId();

  return (
    <section
      data-shell="panel-chooser"
      aria-labelledby={headingId}
      className={cn("bg-popover text-popover-foreground flex flex-col gap-3 text-xs", className)}
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="font-semibold">
          Figure panels
        </h3>
        <p data-shell="panel-chooser-help" className="leading-snug">
          Each panel draws this molecule in one view. The exported figure puts the panels side by
          side and labels each with its letter: (a) is the first panel, (b) the second.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="font-medium">In the figure</h4>
        {panels.length === 0 ? (
          <p data-shell="panel-chooser-empty">No panels yet. Add a view below.</p>
        ) : (
          <ol data-shell="panel-chooser-list" className="flex flex-col gap-1">
            {panels.map((panel, index) => (
              <PanelEntry key={panel.id} panel={panel} index={index} count={panels.length} />
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="font-medium">Add a view</h4>
        <div data-shell="panel-chooser-add" className="grid grid-cols-2 gap-1">
          {VIEW_KINDS.map((kind) => (
            <AddViewEntry key={kind} kind={kind} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="font-medium">Projections</h4>
        <p
          id={plannedReasonId}
          data-shell="planned-projection-reason"
          className="text-muted-foreground leading-snug"
        >
          {PLANNED_PROJECTION_REASON}
        </p>
        <div data-shell="panel-chooser-planned" className="flex flex-col gap-1">
          {PLANNED_PROJECTIONS.map((planned) => (
            <PlannedEntry
              key={planned.id}
              id={planned.id}
              title={planned.title}
              shows={planned.shows}
              reasonId={plannedReasonId}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
