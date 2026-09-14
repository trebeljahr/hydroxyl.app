"use client";

/**
 * Export figure: a preview, the physical size, and the buttons.
 *
 * THE PREVIEW IS THE FILE. It is an `<img>` of the self-contained SVG the
 * serialiser writes, loaded exactly the way a browser opening the exported
 * file loads it — no app stylesheet, no fetched font. If the export would
 * come out invisible, the preview comes out invisible first. The one
 * difference is deliberate: an unavailable panel is drawn MARKED here, with
 * its reason, where the export refuses.
 *
 * SIZE IS CHOSEN THE WAY A JOURNAL STATES IT: a printed width (single column
 * 8.25 cm, double column 17.8 cm, or custom) and a resolution for the PNG.
 * Pixels, printed bond length and label size are read-outs, so choosing a
 * width shows what it does to the chemistry before anything is written.
 *
 * Every button runs a registry command synchronously inside its click, which
 * is what keeps the clipboard and the save picker inside the user gesture.
 */

import { useMemo } from "react";
import type { ReactElement } from "react";

import { JOURNAL_WIDTHS_CM } from "@starter/chem-render";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { commandById } from "@/editor/commands/registry";
import {
  CUSTOM_WIDTH_RANGE_CM,
  figurePreviewSvg,
  prepareFigure,
  rasterTooLarge,
  svgDataUri,
} from "@/lib/export/figure";
import { canvasCanHold } from "@/lib/export/png";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";
import type { FigureExportSettings } from "@/state/types";

const button =
  "hover:bg-accent focus-visible:ring-ring flex h-8 items-center justify-center rounded-md border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40";

function run(id: string): void {
  void commandById(id).run(editorStore);
}

function Choice({
  name,
  value,
  checked,
  label,
  onSelect,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} />
      {label}
    </label>
  );
}

export function ExportDialog(): ReactElement {
  const open = useEditorStore((state) => state.ui.exportDialogOpen);
  const doc = useEditorStore((state) => state.document);
  const settings = useEditorStore((state) => state.ui.figureExport);
  const status = useEditorStore((state) => state.ui.statusMessage);
  const set = (patch: Partial<FigureExportSettings>): void => {
    editorStore.getState().setFigureExport(patch);
  };

  const preview = useMemo(() => {
    if (!open) return null;
    try {
      return svgDataUri(figurePreviewSvg(doc));
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [open, doc]);

  const prepared = useMemo(() => (open ? prepareFigure(doc, settings) : null), [open, doc, settings]);
  const tooLarge = prepared?.ok === true ? rasterTooLarge(prepared.value, canvasCanHold) : null;
  const canExport = prepared?.ok === true;

  return (
    <Dialog open={open} onOpenChange={(next) => editorStore.getState().setExportDialogOpen(next)}>
      <DialogContent className="top-[6%] max-w-2xl p-4" data-shell="export-dialog">
        <DialogTitle className="text-sm font-semibold">Export figure</DialogTitle>
        <DialogDescription className="text-muted-foreground mb-3 text-xs">
          Every panel shows the same molecule at the same bond length. Edit the panels in the
          properties panel.
        </DialogDescription>

        <div className="mb-3 flex max-h-72 min-h-24 items-center justify-center overflow-auto rounded-md border bg-white p-2">
          {preview instanceof Error ? (
            <p className="text-destructive text-xs">{preview.message}</p>
          ) : preview === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI of the exact file, not an optimisable asset
            <img
              src={preview}
              alt="Preview of the exported figure"
              data-shell="figure-preview"
              className="max-h-64 max-w-full"
            />
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">Width</legend>
            <Choice
              name="figure-width"
              value="single"
              checked={settings.width === "single"}
              label={`Single column (${JOURNAL_WIDTHS_CM.single} cm)`}
              onSelect={() => set({ width: "single" })}
            />
            <Choice
              name="figure-width"
              value="double"
              checked={settings.width === "double"}
              label={`Double column (${JOURNAL_WIDTHS_CM.double} cm)`}
              onSelect={() => set({ width: "double" })}
            />
            <div className="flex items-center gap-1.5">
              <Choice
                name="figure-width"
                value="custom"
                checked={settings.width === "custom"}
                label="Custom"
                onSelect={() => set({ width: "custom" })}
              />
              <input
                type="number"
                aria-label="Custom width in centimetres"
                data-shell="custom-width"
                min={CUSTOM_WIDTH_RANGE_CM.min}
                max={CUSTOM_WIDTH_RANGE_CM.max}
                step={0.05}
                value={settings.customWidthCm}
                onChange={(event) =>
                  set({ width: "custom", customWidthCm: Number(event.target.value) })
                }
                className="border-input bg-background h-7 w-20 rounded-md border px-2 text-xs"
              />
              <span className="text-xs">cm</span>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">
              PNG resolution
            </legend>
            <Choice
              name="figure-dpi"
              value="300"
              checked={settings.dpi === 300}
              label="300 dpi"
              onSelect={() => set({ dpi: 300 })}
            />
            <Choice
              name="figure-dpi"
              value="600"
              checked={settings.dpi === 600}
              label="600 dpi"
              onSelect={() => set({ dpi: 600 })}
            />
          </fieldset>
        </div>

        {prepared === null ? null : prepared.ok ? (
          <p data-shell="figure-size" className="mb-3 text-xs">
            {prepared.value.size.widthCm.toFixed(2)} × {prepared.value.size.heightCm.toFixed(2)} cm
            {" · "}PNG {prepared.value.size.widthPx} × {prepared.value.size.heightPx} px
            {" · "}bond {prepared.value.size.bondLengthMm.toFixed(1)} mm
            {" · "}labels {prepared.value.size.fontSizePt.toFixed(1)} pt
          </p>
        ) : (
          <p role="alert" data-shell="figure-refusal" className="text-destructive mb-3 text-xs">
            {prepared.message}
          </p>
        )}
        {tooLarge === null ? null : (
          <p role="alert" className="text-destructive mb-3 text-xs">
            {tooLarge}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(button, "font-medium")}
            data-command="figure.export-svg"
            disabled={!canExport}
            onClick={() => run("figure.export-svg")}
          >
            Download SVG
          </button>
          <button
            type="button"
            className={button}
            data-command="figure.export-png"
            disabled={!canExport || tooLarge !== null}
            onClick={() => run("figure.export-png")}
          >
            Download PNG
          </button>
          <button
            type="button"
            className={button}
            data-command="figure.copy"
            disabled={!canExport}
            onClick={() => run("figure.copy")}
          >
            Copy figure
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className={button}
            data-command="figure.copy-smiles"
            onClick={() => run("figure.copy-smiles")}
          >
            Copy SMILES
          </button>
          <button
            type="button"
            className={button}
            data-command="figure.copy-molblock"
            onClick={() => run("figure.copy-molblock")}
          >
            Copy molfile
          </button>
        </div>
        {/* The status bar sits under the dialog's overlay, so what the last
            button did — or why it refused — is repeated here. */}
        <p data-shell="export-status" role="status" className="text-muted-foreground mt-3 min-h-4 text-xs">
          {status}
        </p>
      </DialogContent>
    </Dialog>
  );
}
