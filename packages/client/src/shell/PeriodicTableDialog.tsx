"use client";

/**
 * The full periodic table behind the element picker's "Show all elements".
 *
 * AN 18-COLUMN TABLE, NOT A LIST. A chemist finds an element by where it sits
 * — "the one under palladium" — far more often than by spelling its name, so
 * the picker is laid out the way every printed table is, lanthanides and
 * actinides in their own rows below. The search box is for the other case:
 * "pt", "platinum" and "78" all narrow the table to one cell, and Enter places
 * it.
 *
 * EVERY CELL IS AN ENTRY IN THE SHARED PICKER STATES. It paints with
 * `pickerEntryClasses`, the same idle / selected / unavailable pairs as the
 * quick picker, so the 4.5:1 contrast the e2e measures on one is a property of
 * the other rather than a second promise. A cell chem-core cannot handle is
 * `aria-disabled` rather than `disabled` so the keyboard can still land on it
 * and hear why; today chem-core knows all 118 and no cell is refused.
 *
 * ONE TAB STOP. The table is an ARIA grid with a roving tabindex: Tab goes
 * search box → table → close, and the arrows move inside the table. 118 tab
 * stops would make the dialog unusable from the keyboard.
 *
 * Choosing a cell runs `element.<symbol>` through the registry, exactly like
 * the quick picker, so a table pick arms the element tool (or retypes the
 * selection) and lands in the quick picker's recent row by the same path.
 */

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { ElementInfo } from "@starter/chem-core";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { commandById } from "@/editor/commands/registry";
import {
  F_BLOCK_MARKERS,
  LANTHANIDE_ROW,
  TABLE_COLUMNS,
  TABLE_ROWS,
  bestMatch,
  buildPeriodicTable,
  categoryTitle,
  elementLabel,
  elementNotes,
  matchingCells,
  moveInTable,
} from "@/editor/periodic-table";
import type { PeriodicCell, TableKey } from "@/editor/periodic-table";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

import { pickerEntryClasses } from "./picker-entry";

type Lookup = (z: number) => ElementInfo | undefined;

export function PeriodicTableDialog({
  lookup,
}: {
  /** Test seam: a chem-core lookup that lacks an element, to reach the
   *  refused-cell branch the real table never shows. */
  readonly lookup?: Lookup;
} = {}): ReactElement {
  const open = useEditorStore((state) => state.ui.periodicTableOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => editorStore.getState().setPeriodicTableOpen(next)}
    >
      <DialogContent
        className="top-[4%] max-h-[92vh] max-w-3xl overflow-y-auto p-4"
        data-shell="periodic-table"
      >
        <DialogTitle className="text-sm font-semibold">All elements</DialogTitle>
        <DialogDescription className="text-muted-foreground mb-3 text-xs">
          Pick an element to place it, or to retype the selected atoms. Search by symbol,
          name or atomic number; the arrow keys move through the table.
        </DialogDescription>
        {/* Mounted only while open, so every opening starts from an empty
            search and a focus on the armed element. */}
        {open ? <PeriodicTableBody lookup={lookup} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const KEY_MAP: Readonly<Record<string, TableKey>> = {
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  Home: "Home",
  End: "End",
};

function tableKey(event: KeyboardEvent): TableKey | undefined {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key === "Home") return "CtrlHome";
  if (mod && event.key === "End") return "CtrlEnd";
  return KEY_MAP[event.key];
}

/** Reading order: row by row, left to right — the order the grid is drawn. */
function readingOrder(a: PeriodicCell, b: PeriodicCell): number {
  return a.row - b.row || a.column - b.column;
}

function PeriodicTableBody({ lookup }: { readonly lookup: Lookup | undefined }): ReactElement {
  const cells = useMemo(() => buildPeriodicTable(lookup), [lookup]);
  const current = useEditorStore((state) => state.toolOptions.element);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => matchingCells(cells, query), [cells, query]);
  const visible = useMemo(
    () => cells.filter((cell) => shown.has(cell.z)).sort(readingOrder),
    [cells, shown],
  );

  const currentZ = cells.find((cell) => cell.element?.symbol === current)?.z;
  const [focusZ, setFocusZ] = useState<number>(currentZ ?? 1);
  const [hoverZ, setHoverZ] = useState<number | null>(null);
  // The roving tab stop has to be a cell that is actually drawn: after a
  // search narrows the table, the remembered one may have been filtered out.
  const tabStop = shown.has(focusZ) ? focusZ : visible[0]?.z;
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  const byPosition = useMemo(() => {
    const map = new Map<string, PeriodicCell>();
    for (const cell of cells) map.set(`${String(cell.row)}:${String(cell.column)}`, cell);
    return map;
  }, [cells]);

  const detail = cells.find((cell) => cell.z === (hoverZ ?? tabStop ?? currentZ));

  function focusCell(z: number | undefined): void {
    if (z === undefined) return;
    setFocusZ(z);
    // A keyboard move takes the detail strip back from the pointer. Without
    // this, a pointer left parked over a cell — where the "Show all" click
    // put it — kept naming THAT element while the arrows walked elsewhere.
    setHoverZ(null);
    buttons.current.get(z)?.focus();
  }

  function choose(cell: PeriodicCell): void {
    if (!cell.placeable || cell.element === undefined) return;
    const store = editorStore.getState();
    store.setPeriodicTableOpen(false);
    void commandById(`element.${cell.element.symbol}`).run(editorStore);
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const key = tableKey(event);
    if (key === undefined || tabStop === undefined) return;
    event.preventDefault();
    focusCell(moveInTable(visible, tabStop, key));
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      const match = bestMatch(visible, query);
      if (match !== undefined) choose(match);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(tabStop);
    }
  }

  const matchCount = visible.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          aria-label="Search elements by symbol, name or atomic number"
          placeholder="Search: Pt, platinum, 78"
          autoComplete="off"
          spellCheck={false}
          data-periodic-search=""
          className="border-input bg-background text-foreground focus:ring-ring h-8 w-64 max-w-full rounded-md border px-2 text-xs focus:outline-none focus:ring-2"
        />
        <p data-periodic-count="" className="text-popover-foreground text-xs" aria-live="polite">
          {query.trim() === ""
            ? ""
            : matchCount === 1
              ? "1 element matches"
              : `${String(matchCount)} elements match`}
        </p>
      </div>

      <ElementDetail cell={detail} />

      <div className="overflow-x-auto p-1">
        <div
          role="grid"
          aria-label="Periodic table"
          aria-rowcount={TABLE_ROWS}
          aria-colcount={TABLE_COLUMNS}
          onKeyDown={onGridKeyDown}
          className="flex min-w-max flex-col gap-0.5"
        >
          {Array.from({ length: TABLE_ROWS }, (_, i) => i + 1).map((row) => (
            <div
              key={row}
              role="row"
              aria-rowindex={row}
              className={cn(
                "grid gap-0.5",
                // The f-block rows sit apart from the main table, as printed.
                row === LANTHANIDE_ROW && "mt-2",
              )}
              style={{ gridTemplateColumns: `repeat(${String(TABLE_COLUMNS)}, 2.25rem)` }}
            >
              {Array.from({ length: TABLE_COLUMNS }, (_, j) => j + 1).map((column) => {
                const key = `${String(row)}:${String(column)}`;
                const marker = F_BLOCK_MARKERS.find(
                  (m) => m.row === row && m.column === column,
                );
                if (marker !== undefined) {
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      aria-colindex={column}
                      aria-label={marker.label}
                      data-periodic-marker={marker.text}
                      className="bg-popover text-popover-foreground flex h-10 items-center justify-center rounded border border-dashed text-[9px] leading-none"
                    >
                      {marker.text}
                    </div>
                  );
                }
                const cell = byPosition.get(key);
                if (cell === undefined || !shown.has(cell.z)) {
                  // A gap in the table, or a cell the search filtered out. Kept
                  // as an empty slot so the table keeps its shape while typing.
                  return <div key={key} aria-hidden="true" className="h-10" />;
                }
                return (
                  <div key={key} role="gridcell" aria-colindex={column}>
                    <ElementCell
                      cell={cell}
                      active={cell.element?.symbol === current}
                      tabbable={cell.z === tabStop}
                      register={(node) => {
                        if (node === null) buttons.current.delete(cell.z);
                        else buttons.current.set(cell.z, node);
                      }}
                      onChoose={() => choose(cell)}
                      onFocus={() => setFocusZ(cell.z)}
                      onHover={(on) => setHoverZ(on ? cell.z : null)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ElementCell({
  cell,
  active,
  tabbable,
  register,
  onChoose,
  onFocus,
  onHover,
}: {
  readonly cell: PeriodicCell;
  readonly active: boolean;
  readonly tabbable: boolean;
  readonly register: (node: HTMLButtonElement | null) => void;
  readonly onChoose: () => void;
  readonly onFocus: () => void;
  readonly onHover: (on: boolean) => void;
}): ReactElement {
  const { element, placeable, reason, z } = cell;
  const label =
    element === undefined
      ? `Element ${String(z)}`
      : `${elementLabel(element)}, atomic number ${String(z)}`;
  const reasonId = `periodic-reason-${String(z)}`;
  const disabled = !placeable;
  return (
    <button
      ref={register}
      type="button"
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-pressed={active && !disabled}
      title={reason ?? label}
      {...(disabled ? { "aria-disabled": true, "aria-describedby": reasonId } : {})}
      {...(element === undefined
        ? { "data-periodic-z": String(z) }
        : { "data-periodic-element": element.symbol })}
      onClick={() => {
        // `aria-disabled` does not stop a click the way `disabled` does, and
        // the cell has to stay focusable so the reason can be read.
        if (disabled) return;
        onChoose();
      }}
      onFocus={onFocus}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "flex h-10 w-full flex-col items-center justify-center gap-0.5 leading-none",
        pickerEntryClasses({ active, disabled }),
      )}
    >
      <span className="text-[9px]">{z}</span>
      <span className="font-mono text-sm font-semibold">{element?.symbol ?? "?"}</span>
      {reason === undefined ? null : (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </button>
  );
}

/**
 * The strip above the table: what the focused or hovered cell is, and what
 * placing it will not give you. Reserved height, so moving through the table
 * does not make the grid jump.
 */
function ElementDetail({ cell }: { readonly cell: PeriodicCell | undefined }): ReactElement {
  if (cell === undefined) {
    return <div data-periodic-detail="" className="min-h-14" />;
  }
  const { element } = cell;
  if (element === undefined) {
    return (
      <div data-periodic-detail="" className="text-popover-foreground min-h-14 text-xs">
        <p className="font-medium">Element {cell.z}</p>
        <p>{cell.reason}</p>
      </div>
    );
  }
  const notes = elementNotes(element);
  return (
    <div data-periodic-detail="" className="text-popover-foreground min-h-14 text-xs">
      <p>
        <span className="font-medium">{element.name}</span>
        <span className="font-mono"> {element.symbol}</span>
        {` · atomic number ${String(element.z)} · atomic weight ${String(element.weight)} · ${categoryTitle(element.category)}`}
      </p>
      {notes.length === 0 ? null : (
        <ul className="mt-1 list-disc pl-4">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
