"use client";

/**
 * The figure's panel list, in the properties panel: add, remove, reorder,
 * pick each panel's view, caption it, and set how many panels share a row.
 *
 * A LIST, NOT A CANVAS LAYOUT. Free-form dragging of panels on the canvas is
 * out of scope for this task; the grid is computed by chem-render from the
 * order and the column count, so this list IS the layout.
 *
 * GATED BY THE AVAILABILITY FUNCTION. Every view kind a molecule cannot be
 * drawn as is still listed — disabled, with the availability function's own
 * sentence under it — and a panel whose CURRENT view has become unavailable
 * (a label was added, an element was mistyped) says so in the list, in words,
 * with the same sentence the export refuses with.
 *
 * KEYBOARD. Each row is focusable: Alt+ArrowUp / Alt+ArrowDown move it, and
 * the row keeps focus as it moves. The handler marks the event handled so the
 * editor's window-level key layer (which honours `defaultPrevented`) does not
 * also read the arrow as a canvas traversal.
 */

import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, PlusIcon, Trash2Icon } from "lucide-react";

import {
  VIEW_KIND_TITLES,
  defaultFigureColumns,
  panelLetter,
  representationAvailability,
} from "@starter/chem-render";
import type { ViewAvailability } from "@starter/chem-render";
import { MAX_FIGURE_COLUMNS, VIEW_KINDS } from "@starter/shared";
import type { Panel, RepresentationKind } from "@starter/shared";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canvasPanelFor } from "@/canvas/scene-bridge";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

const iconButton =
  "hover:bg-accent focus-visible:ring-ring flex size-6 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40";

const inputClass =
  "border-input bg-background focus:ring-ring h-7 w-full rounded-md border px-2 text-xs focus:outline-none focus:ring-2";

/** Availability as the list presents it: "nothing drawn yet" is not a fault. */
function blocking(availability: ViewAvailability): string | null {
  if (availability.available || availability.reason === "empty-molecule") return null;
  return availability.message;
}

function CaptionField({ panel }: { readonly panel: Panel }): ReactElement {
  const value = panel.caption ?? "";
  const [draft, setDraft] = useState(value);
  const [lastSeen, setLastSeen] = useState(value);
  if (lastSeen !== value) {
    setLastSeen(value);
    setDraft(value);
  }
  const commit = (): void => {
    const next = draft.trim();
    editorStore.getState().setPanelCaption(panel.id, next === "" ? null : next);
  };
  return (
    <input
      type="text"
      aria-label="Caption"
      data-panel-caption
      placeholder="Caption"
      className={inputClass}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function PanelRow({
  panel,
  index,
  count,
  onCanvas,
}: {
  readonly panel: Panel;
  readonly index: number;
  readonly count: number;
  readonly onCanvas: boolean;
}): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const letter = panelLetter(index);
  const kind = panel.representation.kind;
  const reason = blocking(representationAvailability(molecule, kind));

  const move = (delta: -1 | 1): void => {
    editorStore.getState().movePanel(panel.id, delta);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    move(event.key === "ArrowUp" ? -1 : 1);
    refocusRow(panel.id);
  };

  return (
    <li
      tabIndex={0}
      data-panel-id={panel.id}
      data-panel-label={`(${letter})`}
      data-panel-kind={kind}
      data-panel-unavailable={reason === null ? undefined : "true"}
      aria-label={`Panel (${letter}), ${VIEW_KIND_TITLES[kind]}. Alt+Up and Alt+Down reorder.`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onKeyDown={onKeyDown}
      className={cn(
        "focus-visible:ring-ring flex flex-col gap-1.5 rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2",
        onCanvas && "border-foreground/40",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="w-7 font-mono text-xs font-semibold">({letter})</span>
        <button
          type="button"
          className={cn(iconButton, onCanvas && "bg-accent")}
          aria-label={`Show panel (${letter}) on the canvas`}
          aria-pressed={onCanvas}
          onClick={() => editorStore.getState().setActivePanel(panel.id)}
        >
          <EyeIcon className="size-3.5" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className={iconButton}
          aria-label={`Move panel (${letter}) up`}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowUpIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={`Move panel (${letter}) down`}
          disabled={index === count - 1}
          onClick={() => move(1)}
        >
          <ArrowDownIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={`Remove panel (${letter})`}
          onClick={() => editorStore.getState().removePanel(panel.id)}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>

      <Select
        value={kind}
        onValueChange={(value) => {
          editorStore
            .getState()
            .updatePanel(panel.id, { kind: value as RepresentationKind });
        }}
      >
        <SelectTrigger aria-label={`View of panel (${letter})`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEW_KINDS.map((option) => {
            const why = blocking(representationAvailability(molecule, option));
            return (
              <SelectItem
                key={option}
                value={option}
                // The panel's own current kind stays selectable so the
                // trigger can show it; its reason is stated below the select.
                disabled={why !== null && option !== kind}
                {...(why === null ? {} : { description: why })}
              >
                {VIEW_KIND_TITLES[option]}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {reason === null ? null : (
        <p role="note" data-panel-reason className="text-destructive text-[11px] leading-tight">
          {reason} This panel cannot be exported until that changes.
        </p>
      )}

      <CaptionField panel={panel} />
    </li>
  );
}

/**
 * Focus follows a row across a reorder. Reordering keyed siblings moves DOM
 * nodes, and a focused node that is moved loses focus in Chromium, so the row
 * is found again by its panel id once React has committed the move.
 */
function refocusRow(id: string): void {
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(
      `[data-shell="figure-panels"] [data-panel-id="${CSS.escape(id)}"]`,
    );
    row?.focus();
  });
}

function ColumnsField({ count }: { readonly count: number }): ReactElement {
  const columns = useEditorStore((state) => state.document.figure?.columns);
  const shown = columns === undefined ? "" : String(columns);
  const [draft, setDraft] = useState(shown);
  const [lastSeen, setLastSeen] = useState(shown);
  if (lastSeen !== shown) {
    setLastSeen(shown);
    setDraft(shown);
  }
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      editorStore.getState().setFigureColumns(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_FIGURE_COLUMNS) {
      setDraft(shown);
      editorStore
        .getState()
        .setStatusMessage(`Columns must be a whole number from 1 to ${MAX_FIGURE_COLUMNS}.`);
      return;
    }
    editorStore.getState().setFigureColumns(parsed);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium">Columns</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Columns"
        data-figure-columns
        className={cn(inputClass, "w-14")}
        placeholder={String(defaultFigureColumns(count))}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span className="text-muted-foreground text-[11px]">
        {columns === undefined ? "automatic" : "per row"}
      </span>
    </label>
  );
}

export function FigurePanels(): ReactElement {
  const doc = useEditorStore((state) => state.document);
  const activePanelId = useEditorStore((state) => state.ui.activePanelId);
  const [addKind, setAddKind] = useState<RepresentationKind>("lewis");
  const onCanvas = canvasPanelFor(doc, activePanelId)?.id;

  return (
    <section aria-label="Figure panels" data-shell="figure-panels" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Figure panels</h2>
        <ColumnsField count={doc.panels.length} />
      </div>

      {doc.panels.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No panels. Add one to build a figure.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {doc.panels.map((panel, index) => (
            <PanelRow
              key={panel.id}
              panel={panel}
              index={index}
              count={doc.panels.length}
              onCanvas={panel.id === onCanvas}
            />
          ))}
        </ol>
      )}

      <div className="flex items-center gap-1">
        <Select value={addKind} onValueChange={(value) => setAddKind(value as RepresentationKind)}>
          <SelectTrigger aria-label="View for the new panel" className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_KINDS.map((option) => {
              const why = blocking(representationAvailability(doc.molecule, option));
              return (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={why !== null}
                  {...(why === null ? {} : { description: why })}
                >
                  {VIEW_KIND_TITLES[option]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <button
          type="button"
          data-shell="add-panel"
          className="hover:bg-accent flex h-8 items-center gap-1 rounded-md border px-2 text-xs"
          onClick={() => {
            const why = blocking(representationAvailability(doc.molecule, addKind));
            if (why !== null) {
              editorStore.getState().setStatusMessage(why);
              return;
            }
            editorStore.getState().addPanel(addKind);
          }}
        >
          <PlusIcon className="size-3.5" />
          Add panel
        </button>
      </div>
    </section>
  );
}
