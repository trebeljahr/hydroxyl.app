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
import { commandById, displayFlagCommandId } from "@/editor/commands/registry";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";
import type { EditorState } from "@/state";

import { canvasPanelFor, canvasRefusal } from "./scene-bridge";

const FLAG_LABELS: Readonly<Record<DisplayFlagKey, string>> = {
  showCarbonLabels: "Carbon labels",
  showImplicitHydrogens: "Hydrogens",
  showLonePairs: "Lone pairs",
  showCharges: "Formal charges",
  showStereoBonds: "Wedge and hash bonds",
  // Chemical locants, never atom ids or positions (decision 18).
  showLocants: "Locants",
  aromaticCircles: "Aromatic circles",
  showStereoDescriptors: "R/S and E/Z descriptors",
};

/**
 * Whether a checkbox is live, and if not why — read from the flag's COMMAND.
 *
 * The palette greys `view.show-locants` out with a reason until something
 * numbers the atoms (decision 37) — while the flag is off; while it is on the
 * command is live so it can be switched off (decision 56). A checkbox that
 * bypassed the registry would be a second door onto the same switch, open
 * while the palette's is shut, so the popover asks the very command the
 * palette asks.
 */
function flagAvailability(
  key: DisplayFlagKey,
  state: EditorState,
): { readonly enabled: boolean; readonly reason: string | undefined } {
  const command = commandById(displayFlagCommandId(key));
  const enabled = command.enabled(state);
  return { enabled, reason: enabled ? undefined : command.disabledReason?.(state) };
}

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
              "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors",
              "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              // ── ONE GREY MEANT TWO THINGS, AND THAT WAS THE BUG ──────────
              //
              // `text-muted-foreground` used to be applied for `blocked ||
              // !isStructuralViewKind(kind)`, so a "(b) Sum formula" button —
              // fully clickable, with nothing refusing it — painted the very
              // same rgb(115,115,115) in light mode as the genuinely disabled
              // locants label in the popover below. A strip whose usable entries
              // wear the disabled colour reads as all-disabled-except-the-
              // selected-one, which is the picture behind the "broken, the CSS
              // is not loading" report.
              //
              // THE TREATMENT PICKED: the muted ink is reserved for UNAVAILABLE,
              // where it keeps the companions it already had — a line-through
              // and a `title` carrying `availability.message`. A non-structural
              // view is NOT unavailable: clicking it makes it the active panel,
              // and the strip's notice then says why the canvas keeps the
              // structure. So it paints at full contrast like any other usable
              // entry. Which panel is text and which is structural is said by
              // its NAME ("Sum formula" is plainly not a drawing) and by that
              // notice — never by dimming a control that works.
              //
              // Every branch names a ground AND an ink, the idle one included: a
              // state defined by the absence of a class is a state that vanishes
              // the moment the cascade hiccups.
              //
              // A BLOCKED PANEL IS STILL NOT `disabled`. Its click is the way to
              // read the refusal, so taking the click away would hide the only
              // explanation. `blocked` is tested first all the same: if a
              // blocked panel ever did reach the canvas, "unavailable" is the
              // more important of the two things to say.
              //
              // AND BECAUSE IT IS NOT `disabled`, ITS HOVER MUST CLEAR 4.5:1.
              // WCAG 1.4.3 exempts INACTIVE controls from the contrast floor;
              // this one is active, so the exemption never covered it. Carrying
              // the muted ink through the hover put `--muted-foreground`
              // (rgb 115) on `--accent` (rgb 245) in light mode: 4.349:1, under
              // the floor, at precisely the moment the pointer is on the button
              // in order to read `availability.message`. The idle pair is fine
              // (115 on rgb 255 is 4.742:1), which is why this hid for so long.
              //
              // SO THE INK GOES TO FULL CONTRAST ON HOVER, and the entry still
              // reads as unavailable, because the ink was never the thing saying
              // so. The LINE-THROUGH says it — it survives the hover untouched —
              // and the `title` spells out the reason. Ink was the third and
              // weakest of those three signals, and it is the only one the
              // contrast floor binds, so it is the one that yields. Pairing the
              // hover ink with its own hover ground (`accent-foreground` on
              // `accent`: 16.444:1 light, 14.499:1 dark) is what both branches
              // below already do, so a hovered unavailable entry now reads as
              // struck through rather than as merely faint — the clearer of the
              // two, and the same treatment ToolRail's disabled picker entry
              // needed for the identical token pair.
              blocked
                ? "bg-background text-muted-foreground line-through hover:bg-accent hover:text-accent-foreground"
                : onCanvas
                  ? "bg-accent text-accent-foreground font-medium"
                  : "bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
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
              // Its own ground and ink, for the same reason the panel buttons
              // now have them: `hover:bg-accent` alone left the resting state
              // to whatever the strip happened to be inheriting.
              className="bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2"
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
              {DISPLAY_FLAG_KEYS.map((key) => {
                const { enabled, reason } = flagAvailability(key, editorStore.getState());
                return (
                  <label
                    key={key}
                    // The row, not the box: the colours under test are the
                    // label's, and Chromium is the only place they can be
                    // measured, so the e2e run needs a handle on the element
                    // that declares them.
                    data-view-flag-row={key}
                    className={cn(
                      // `-mx-1 px-1` so the hover highlight below has an edge to
                      // reach without moving the text off the legend's margin.
                      "-mx-1 flex flex-wrap items-center gap-x-2 rounded-sm px-1 text-xs",
                      // BOTH branches named, not just the disabled one. A live
                      // label used to carry no colour at all and was legible
                      // only by inheriting from `PopoverContent`; the disabled
                      // one was the only label stating an ink, so a half-applied
                      // cascade left the greyed-out rows as the readable ones.
                      //
                      // AND BOTH branches name a GROUND, not only an ink. Naming
                      // one of the pair is naming neither: `text-popover-
                      // foreground` is a promise about a contrast ratio, and the
                      // ratio does not exist until the other half of it is on
                      // the element too. Until now every label here was legible
                      // only by inheriting `PopoverContent`'s ground — the exact
                      // dependency this change exists to remove, one level in
                      // from the entries that already had it removed.
                      //
                      // AND BOTH NAME A HOVER PAIR, including the disabled
                      // branch, whose hover deliberately repeats its resting
                      // colours. A state defined by the absence of a class is a
                      // state that vanishes the moment the cascade hiccups, and
                      // that is as true of "this row does not react" as it is of
                      // a resting colour: written down, the non-reaction is a
                      // decision; left out, it is whatever the cascade does.
                      //
                      // The disabled row must not move to `bg-accent`, because
                      // `--muted-foreground` on `--accent` is 4.349:1 in light
                      // mode — the same failure just fixed on the blocked panel
                      // button above. Holding `bg-popover` keeps it at 4.742:1
                      // light and 7.849:1 dark, and the still ground is itself
                      // the signal: only the live rows light up under the
                      // pointer, so hovering the column tells you which switches
                      // are actually yours, without either row going dim.
                      enabled
                        ? "bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                        : "bg-popover text-muted-foreground hover:bg-popover hover:text-muted-foreground cursor-not-allowed",
                    )}
                    title={reason}
                  >
                    <input
                      type="checkbox"
                      data-view-flag={key}
                      checked={shown.representation.display[key]}
                      disabled={!enabled}
                      className="focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
                      onChange={(event) => {
                        // `disabled` alone is not a guarantee: a synthetic or
                        // scripted click still reaches React's onChange. The
                        // command's own answer is re-asked at the moment of
                        // the change, not trusted from the last render.
                        if (!flagAvailability(key, editorStore.getState()).enabled) return;
                        editorStore
                          .getState()
                          .updatePanel(shown.id, { display: { [key]: event.target.checked } });
                      }}
                    />
                    {FLAG_LABELS[key]}
                    {reason === undefined ? null : (
                      <span data-disabled-reason className="basis-full pl-5 text-[10px]">
                        {reason}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
