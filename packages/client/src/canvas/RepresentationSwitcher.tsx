"use client";

/**
 * The strip above the canvas: which of the figure's panels the canvas shows,
 * and that panel's view options.
 *
 * A STRIP, NOT A FLOATING OVERLAY. It sits above the drawing surface rather
 * than on top of it, so it never covers a corner of the canvas a click or a
 * drag was aimed at.
 *
 * WHAT A CLICK ON A PANEL DOES. It makes that panel active. The canvas then
 * draws through it when it honestly can — a structural view whose availability
 * holds — and otherwise keeps the default structure and says why, in the
 * strip: a text view has nothing to click, and an unavailable view is exactly
 * the drawing its own availability check refuses. See `canvasPanelFor`.
 *
 * THE OPTIONS ACT ON THE PANEL ON SCREEN, through `updatePanel`, the same path
 * the view.* commands take, so the palette and this popover can never edit
 * different panels.
 */

import type { ReactElement } from "react";
import { SlidersHorizontalIcon } from "lucide-react";

import {
  VIEW_KIND_TITLES,
  isStructuralViewKind,
  panelLetter,
  representationAvailability,
} from "@starter/chem-render";
import { DISPLAY_FLAG_KEYS } from "@starter/shared";
import type { DisplayFlagKey } from "@starter/shared";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

import { canvasPanelFor, canvasRefusal } from "./scene-bridge";

const FLAG_LABELS: Readonly<Record<DisplayFlagKey, string>> = {
  showCarbonLabels: "Carbon labels",
  showImplicitHydrogens: "Hydrogens",
  showLonePairs: "Lone pairs",
  showCharges: "Formal charges",
  showStereoBonds: "Wedge and hash bonds",
  showAtomIndices: "Atom indices",
  aromaticCircles: "Aromatic circles",
  showStereoDescriptors: "R/S and E/Z descriptors",
};

export function RepresentationSwitcher(): ReactElement {
  const doc = useEditorStore((state) => state.document);
  const activePanelId = useEditorStore((state) => state.ui.activePanelId);
  const shown = canvasPanelFor(doc, activePanelId);
  const active =
    activePanelId === null ? undefined : doc.panels.find((panel) => panel.id === activePanelId);
  const notice =
    active !== undefined && shown !== undefined && active.id !== shown.id
      ? canvasRefusal(doc, active)
      : null;

  return (
    <div
      data-shell="representation-switcher"
      role="toolbar"
      aria-label="Panels"
      className="bg-background flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
    >
      {doc.panels.length === 0 ? (
        <span className="text-muted-foreground text-xs">No panels</span>
      ) : null}
      {doc.panels.map((panel, index) => {
        const kind = panel.representation.kind;
        const availability = representationAvailability(doc.molecule, kind);
        const blocked = !availability.available && availability.reason !== "empty-molecule";
        const onCanvas = shown?.id === panel.id;
        return (
          <button
            key={panel.id}
            type="button"
            data-switcher-panel={panel.id}
            aria-pressed={onCanvas}
            title={blocked ? availability.message : VIEW_KIND_TITLES[kind]}
            onClick={() => editorStore.getState().setActivePanel(panel.id)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs",
              "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              onCanvas ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent",
              (blocked || !isStructuralViewKind(kind)) && "text-muted-foreground",
              blocked && "line-through",
            )}
          >
            <span className="font-mono">({panelLetter(index)})</span>
            {VIEW_KIND_TITLES[kind]}
          </button>
        );
      })}

      {notice === null ? null : (
        <span
          data-shell="switcher-notice"
          role="status"
          className="text-muted-foreground min-w-0 truncate text-[11px]"
          title={notice}
        >
          {notice}
        </span>
      )}

      <span className="flex-1" />

      {shown !== undefined && isStructuralViewKind(shown.representation.kind) ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-shell="view-options"
              className="hover:bg-accent focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs focus-visible:outline-none focus-visible:ring-2"
            >
              <SlidersHorizontalIcon className="size-3.5" />
              View options
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56">
            <fieldset className="flex flex-col gap-1">
              <legend className="text-muted-foreground mb-1 text-[11px]">
                {VIEW_KIND_TITLES[shown.representation.kind]} panel
              </legend>
              {DISPLAY_FLAG_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    data-view-flag={key}
                    checked={shown.representation.display[key]}
                    onChange={(event) => {
                      editorStore
                        .getState()
                        .updatePanel(shown.id, { display: { [key]: event.target.checked } });
                    }}
                  />
                  {FLAG_LABELS[key]}
                </label>
              ))}
            </fieldset>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
