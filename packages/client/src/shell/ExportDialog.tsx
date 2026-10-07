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
 * SIZE (decision 20). One bond prints at 0.508 cm, so the figure is only as
 * wide as its content. The width chosen here (single column 8.25 cm, double
 * column 17.8 cm, or custom) is a MAXIMUM: a wider figure is scaled down to
 * fit it, and the dialog says so in a sentence rather than leaving a reader
 * to notice the bond length in the read-out. Printed width, pixels, bond
 * length and label size are read-outs, all after scaling.
 *
 * SMALL LABELS (decision 51). When scaling takes the printed labels under
 * 8 pt, the dialog warns with the printed size and what would help. Every
 * button stays enabled: the warning informs, it does not refuse.
 *
 * STYLE (decision 50). The export draws with Publication by default, whatever
 * the canvas shows; "As shown on the canvas" is the other choice. It is a
 * per-export setting beside width and dpi, not the document's preset, so
 * picking it changes neither the canvas nor the undo history. When the file
 * and the canvas differ the dialog says so. Screen chosen for print needs no
 * warning of its own: its 5.2 pt labels are under decision 51's 8 pt minimum,
 * so the label-size warning names the size and points back to Publication.
 *
 * MOLFILE GENERATION (decision 49). The structure clipboard writes V2000, the
 * generation every other program takes — except for a structure that states
 * stereo groups, which only V3000 can express. That switch is automatic and the
 * dialog states it in a sentence, because a file that silently changed
 * generation is a file an old reader rejects for no visible reason.
 *
 * PANELS ARE CHOSEN HERE, BESIDE THE PREVIEW. The dialog used to send the
 * reader to the properties panel to change which views the figure holds, and
 * the "(a)", "(b)" in the preview went unexplained. `FigurePanelChooser` sits
 * next to the preview, so its letters and the preview's are on screen together
 * and a change shows up in the file at once. Captions and the column count
 * stay in the properties panel.
 *
 * PDF (decision 236). The same figure as the SVG, at the same printed size,
 * with Arimo embedded, Greek included (decision 252). A figure whose free
 * text holds an arrow or relation the bundled faces lack gets a sentence
 * under the buttons: the PDF leaves those to the reader's Symbol font.
 *
 * Every button runs a registry command synchronously inside its click, which
 * is what keeps the clipboard and the save picker inside the user gesture.
 */

import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";


import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STYLE_PRESET_TITLES } from "@/canvas/scene-bridge";
import { commandById } from "@/editor/commands/registry";
import { molblockVersionNotice, wedgelessStereoGroupNotice } from "@/lib/rdkit/translate";
import {
  CUSTOM_WIDTH_RANGE_CM,
  annotationSizeNotice,
  bondLengthNotice,
  figurePreviewSvg,
  figureStyle,
  figureStyleNotice,
  formatPt,
  labelSizeNotice,
  pdfFontNotice,
  prepareFigure,
  rasterTooLarge,
  scaleNotice,
  svgDataUri,
} from "@/lib/export/figure";
import { canvasCanHold } from "@/lib/export/png";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";
import type { FigureExportSettings } from "@/state/types";

import { FigurePanelChooser } from "./FigurePanelChooser";

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

const CHECKERBOARD: CSSProperties = {
  backgroundImage: "repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "16px 16px",
};

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
      return svgDataUri(figurePreviewSvg(doc, settings.style, settings.pngBackground));
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [open, doc, settings.style, settings.pngBackground]);

  const prepared = useMemo(() => (open ? prepareFigure(doc, settings) : null), [open, doc, settings]);
  const tooLarge = prepared?.ok === true ? rasterTooLarge(prepared.value, canvasCanHold) : null;
  const notice = prepared?.ok === true ? scaleNotice(prepared.value.size, settings) : null;
  const bondNotice = prepared?.ok === true ? bondLengthNotice(prepared.value) : null;
  const labelNotice = prepared?.ok === true ? labelSizeNotice(prepared.value, settings) : null;
  const annotationNotice =
    prepared?.ok === true ? annotationSizeNotice(prepared.value, settings) : null;
  const canExport = prepared?.ok === true;
  const pdfNotice = prepared?.ok === true ? pdfFontNotice(prepared.value) : null;
  const styleNotice = figureStyleNotice(doc, settings);
  // Decision 49: the app picks V3000 whenever the structure states stereo
  // groups, and SAYS SO here — before the button is pressed, since a chemist
  // handing the file to old instrument software needs to know it is not V2000.
  // The sentence is `translate.ts`'s, so it cannot disagree with the bytes.
  const molfileNotice = molblockVersionNotice(doc.molecule);
  // Decision 125: the collection this app writes is correct, and an RDKit-based
  // reader will still drop the grouped atoms that carry no wedge. Named here,
  // beside the generation sentence, because both are about what the molfile will
  // mean to the next program rather than about how the figure looks.
  const wedgelessNotice = wedgelessStereoGroupNotice(doc.molecule);
  const exportPreset = settings.style === "canvas" ? doc.stylePreset : "publication";
  // The journal columns of the style being exported (decision 234): a Nature
  // figure offers Nature's 8.8 and 18 cm, not ACS's.
  const columns = figureStyle(doc, settings.style).print.columnWidthsCm;

  return (
    <Dialog open={open} onOpenChange={(next) => editorStore.getState().setExportDialogOpen(next)}>
      <DialogContent
        // Wider than before and capped in height: the panel chooser now shares
        // a row with the preview, and a tall figure must scroll inside the
        // dialog rather than push the buttons off the screen.
        className="top-[4%] max-h-[92vh] max-w-3xl overflow-y-auto p-4"
        data-shell="export-dialog"
      >
        <DialogTitle className="text-sm font-semibold">Export figure</DialogTitle>
        <DialogDescription className="text-muted-foreground mb-3 text-xs">
          Every panel shows the same molecule at the same bond length. Captions and the number of
          columns are set in the properties panel.
        </DialogDescription>

        <div
          data-shell="figure-style"
          data-style-preset={exportPreset}
          data-document-preset={doc.stylePreset}
          className="mb-3 flex flex-col gap-1"
        >
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">Style</legend>
            <Choice
              name="figure-style"
              value="publication"
              checked={settings.style === "publication"}
              label="Publication (ACS 1996)"
              onSelect={() => set({ style: "publication" })}
            />
            <Choice
              name="figure-style"
              value="canvas"
              checked={settings.style === "canvas"}
              label={`As shown on the canvas (${STYLE_PRESET_TITLES[doc.stylePreset]})`}
              onSelect={() => set({ style: "canvas" })}
            />
          </fieldset>
          {styleNotice === null ? null : (
            <p data-shell="figure-style-notice" className="text-muted-foreground text-xs">
              {styleNotice}
            </p>
          )}
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <div
            data-shell="figure-preview-frame"
            data-png-background={settings.pngBackground}
            // A transparent PNG is previewed over the usual grey checkerboard,
            // so it reads as "no background" rather than as white.
            style={settings.pngBackground === "transparent" ? CHECKERBOARD : undefined}
            className="flex max-h-80 min-h-24 items-center justify-center overflow-auto rounded-md border bg-white p-2"
          >
            {preview instanceof Error ? (
              <p className="text-destructive text-xs">{preview.message}</p>
            ) : preview === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URI of the exact file, not an optimisable asset
              <img
                src={preview}
                alt="Preview of the exported figure"
                data-shell="figure-preview"
                className="max-h-72 max-w-full"
              />
            )}
          </div>
          <FigurePanelChooser className="max-h-80 overflow-y-auto rounded-md border p-2" />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">
              Maximum width
            </legend>
            <Choice
              name="figure-width"
              value="single"
              checked={settings.width === "single"}
              label={`Single column (up to ${columns.single} cm)`}
              onSelect={() => set({ width: "single" })}
            />
            <Choice
              name="figure-width"
              value="double"
              checked={settings.width === "double"}
              label={`Double column (up to ${columns.double} cm)`}
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
                aria-label="Custom maximum width in centimetres"
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
            <fieldset className="mt-2 flex flex-col gap-1" data-shell="png-background">
              <legend className="text-muted-foreground mb-1 text-xs font-medium">
                PNG background
              </legend>
              <Choice
                name="figure-png-background"
                value="white"
                checked={settings.pngBackground === "white"}
                label="White"
                onSelect={() => set({ pngBackground: "white" })}
              />
              <Choice
                name="figure-png-background"
                value="transparent"
                checked={settings.pngBackground === "transparent"}
                label="Transparent"
                onSelect={() => set({ pngBackground: "transparent" })}
              />
            </fieldset>
          </fieldset>
        </div>

        {prepared === null ? null : prepared.ok ? (
          <>
            <p data-shell="figure-size" className="mb-1 text-xs">
              Prints {prepared.value.size.widthCm.toFixed(2)} ×{" "}
              {prepared.value.size.heightCm.toFixed(2)} cm
              {" · "}PNG {prepared.value.size.widthPx} × {prepared.value.size.heightPx} px
              {" · "}bond {prepared.value.size.bondLengthMm.toFixed(2)} mm
              {" · "}labels {formatPt(prepared.value.size.fontSizePt)} pt
            </p>
            {notice === null ? (
              <p data-shell="figure-fit" className="text-muted-foreground mb-3 text-xs">
                Printed at its natural size.
              </p>
            ) : (
              <p
                data-shell="figure-scaled"
                role="status"
                className="mb-3 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {notice}
              </p>
            )}
            {labelNotice === null ? null : (
              <p
                data-shell="figure-label-size"
                data-label-pt={formatPt(prepared.value.size.fontSizePt)}
                role="status"
                className="-mt-2 mb-3 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {labelNotice.summary} {labelNotice.advice}
              </p>
            )}
            {annotationNotice === null ? null : (
              <p
                data-shell="figure-annotation-size"
                data-annotation-pt={formatPt(annotationNotice.fontSizePt)}
                data-annotation-kinds={annotationNotice.kinds.join(" ")}
                role="status"
                className="-mt-2 mb-3 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {annotationNotice.summary} {annotationNotice.advice}
              </p>
            )}
            {bondNotice === null ? null : (
              <p
                data-shell="figure-bond-length"
                role="status"
                className="-mt-2 mb-3 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {bondNotice}
              </p>
            )}
          </>
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
            data-command="figure.export-pdf"
            disabled={!canExport}
            onClick={() => run("figure.export-pdf")}
          >
            Download PDF
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
            data-command="figure.copy-inchi"
            onClick={() => run("figure.copy-inchi")}
          >
            Copy InChI
          </button>
          <button
            type="button"
            className={button}
            data-command="figure.copy-inchikey"
            onClick={() => run("figure.copy-inchikey")}
          >
            Copy InChIKey
          </button>
          <button
            type="button"
            className={button}
            data-command="figure.export-cdxml"
            onClick={() => run("figure.export-cdxml")}
          >
            Download CDXML
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
        {pdfNotice === null ? null : (
          <p data-shell="pdf-font" role="status" className="text-muted-foreground mt-2 text-xs">
            {pdfNotice}
          </p>
        )}
        {molfileNotice === null ? null : (
          <p
            data-shell="molfile-version"
            data-molfile-version="V3000"
            role="status"
            className="text-muted-foreground mt-2 text-xs"
          >
            {molfileNotice}
          </p>
        )}
        {wedgelessNotice === null ? null : (
          <p
            data-shell="wedgeless-stereo-group"
            role="status"
            className="text-muted-foreground mt-2 text-xs"
          >
            {wedgelessNotice}
          </p>
        )}
        {/* The status bar sits under the dialog's overlay, so what the last
            button did — or why it refused — is repeated here. */}
        <p data-shell="export-status" role="status" className="text-muted-foreground mt-3 min-h-4 text-xs">
          {status}
        </p>
      </DialogContent>
    </Dialog>
  );
}
