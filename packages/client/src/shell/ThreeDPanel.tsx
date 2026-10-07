"use client";

/**
 * The 3D view beside the canvas (decisions 222 and 232): the current drawing
 * as a conformer, in ball and stick, stick or space-fill, turned with the
 * mouse and exported as a PNG at the figure's width and dpi.
 *
 * DERIVED, NEVER STORED. The geometry is computed from the molecule each time
 * the drawing changes and is thrown away with the panel; chem-core's model
 * stays 2D, as an implicit hydrogen is derived and never stored. Nothing here
 * writes to the document or the undo history.
 *
 * DEBOUNCED, AND THE NEWEST EDIT WINS. Every edit restarts a short timer, and
 * only when the drawing has been still for `REFRESH_DELAY_MS` is a conformer
 * asked for. A request still running when the next one is made is abandoned
 * by the worker client (it terminates the worker), so a picture of an older
 * drawing never replaces a newer one.
 *
 * Mounted only while open, so closing the panel ends the worker and frees the
 * WebGL context.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { XIcon } from "lucide-react";

import { isEmpty } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { disposeConformerWorker, requestConformer } from "@/lib/conformer";
import type { ConformerResult } from "@/lib/conformer";
import { rasterBackground } from "@/lib/export/figure";
import { withPhysChunk } from "@/lib/export/png";
import { writeBlobFile } from "@/lib/io/file-system";
import { fileBaseName } from "@/lib/io/save";
import { moleculeToMolblock } from "@/lib/rdkit/translate";
import { threeDPngSize } from "@/lib/three-d/export";
import { THREE_D_MODES, THREE_D_MODE_TITLES } from "@/lib/three-d/primitives";
import type { ThreeDMode } from "@/lib/three-d/primitives";
import type { MoleculeViewer } from "@/lib/three-d/viewer";
import { cn } from "@/lib/utils";
import { editorStore, useEditorStore } from "@/state";

export const REFRESH_DELAY_MS = 400;

type Conformer = Extract<ConformerResult, { ok: true }>;

type Status =
  | { readonly kind: "empty" }
  | { readonly kind: "computing" }
  | { readonly kind: "ready"; readonly conformer: Conformer }
  | { readonly kind: "failed"; readonly message: string };

function statusLine(status: Status, shown: Conformer | undefined): string {
  switch (status.kind) {
    case "empty":
      return "Draw a structure to see it in 3D.";
    case "computing":
      return shown === undefined ? "Computing the 3D geometry…" : "Updating the 3D geometry…";
    case "failed":
      return status.message;
    case "ready":
      return `MMFF94s+ geometry, ${status.conformer.atoms.length} atoms with hydrogens.`;
  }
}

export function ThreeDPanel(): ReactElement {
  const molecule = useEditorStore((state) => state.document.molecule);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MoleculeViewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [mode, setMode] = useState<ThreeDMode>("ball-and-stick");
  // The latest answer, with the molecule it answers. Status is DERIVED from
  // it: an answer for an older molecule means "computing", so no effect ever
  // has to reset state synchronously when the drawing changes.
  const [answer, setAnswer] = useState<{ readonly molecule: Molecule; readonly status: Status } | null>(
    null,
  );
  // The conformer last drawn, kept through a recompute so the old picture
  // stays up (and the camera keeps its angle) until the new one lands.
  const [lastShown, setLastShown] = useState<Conformer | undefined>(undefined);
  const empty = isEmpty(molecule);
  const status: Status = empty
    ? { kind: "empty" }
    : answer?.molecule === molecule
      ? answer.status
      : { kind: "computing" };
  const shown = empty ? undefined : lastShown;
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (host === null) return;
    void import("@/lib/three-d/viewer")
      .then(({ MoleculeViewer: Viewer }) => {
        if (cancelled) return;
        viewerRef.current = new Viewer(host);
        setViewerError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setViewerError(
          `The 3D view could not start WebGL: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      disposeConformerWorker();
    };
  }, []);

  useEffect(() => {
    if (isEmpty(molecule)) return;
    let current = true;
    const timer = setTimeout(() => {
      const molblock = moleculeToMolblock(molecule);
      if (!molblock.ok) {
        setAnswer({ molecule, status: { kind: "failed", message: molblock.error.message } });
        return;
      }
      void requestConformer(molblock.value).then((result) => {
        // `null` is a request a newer one replaced; that one will answer.
        if (!current || result === null) return;
        if (result.ok) {
          setAnswer({ molecule, status: { kind: "ready", conformer: result } });
          setLastShown(result);
        } else {
          setAnswer({ molecule, status: { kind: "failed", message: result.message } });
        }
      });
    }, REFRESH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [molecule]);

  // Hand the viewer what is shown. Refit only when there was nothing on
  // screen before, so an edit keeps the angle the molecule was turned to.
  const hadStructure = useRef(false);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null) return;
    viewer.setStructure(shown, !hadStructure.current);
    hadStructure.current = shown !== undefined;
  }, [shown, viewerError]);

  useEffect(() => {
    viewerRef.current?.setMode(mode);
  }, [mode]);

  const exportPng = async (): Promise<void> => {
    const viewer = viewerRef.current;
    if (viewer === null || shown === undefined) return;
    const state = editorStore.getState();
    const size = threeDPngSize(state.ui.figureExport, viewer.aspect());
    if (!size.ok) {
      state.setStatusMessage(size.message);
      return;
    }
    setExporting(true);
    try {
      const outcome = await writeBlobFile(
        async () =>
          new Blob([withPhysChunk(await viewer.renderPng(size.widthPx, size.heightPx, rasterBackground(state.ui.figureExport.pngBackground)), size.dpi) as BlobPart], {
            type: "image/png",
          }),
        `${fileBaseName(state.document)}-3d.png`,
        "image/png",
        "PNG image",
        ".png",
      );
      if (outcome.ok) {
        state.setStatusMessage(
          `Exported the 3D view as PNG, ${size.widthPx} × ${size.heightPx} px at ${size.dpi} dpi`,
        );
      } else if (!outcome.cancelled) {
        state.setStatusMessage(outcome.message);
      }
    } finally {
      setExporting(false);
    }
  };

  const settings = useEditorStore((state) => state.ui.figureExport);
  const line = viewerError ?? statusLine(status, shown);

  return (
    <aside
      aria-label="3D view"
      data-shell="three-d-panel"
      data-status={status.kind}
      className="bg-background flex w-80 shrink-0 flex-col gap-2 border-l p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide">3D view</h2>
        <button
          type="button"
          aria-label="Close the 3D view"
          className="hover:bg-accent rounded p-1"
          onClick={() => editorStore.getState().setThreeDViewOpen(false)}
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div role="radiogroup" aria-label="3D style" className="flex gap-1">
        {THREE_D_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            data-three-d-mode={option}
            onClick={() => setMode(option)}
            className={cn(
              "flex-1 rounded-md border px-1.5 py-1 text-xs",
              mode === option ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50",
            )}
          >
            {THREE_D_MODE_TITLES[option]}
          </button>
        ))}
      </div>

      <div
        ref={hostRef}
        data-shell="three-d-viewport"
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-md border bg-white",
          status.kind === "computing" && shown !== undefined ? "opacity-60" : null,
        )}
      />

      <p
        data-shell="three-d-status"
        role={status.kind === "failed" || viewerError !== null ? "alert" : undefined}
        className={cn(
          "text-xs",
          status.kind === "failed" || viewerError !== null ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {line}
      </p>
      <p className="text-muted-foreground text-xs">
        Drag to rotate, scroll to zoom, right-drag to move. The geometry is computed in this
        browser.
      </p>

      <button
        type="button"
        data-shell="three-d-export-png"
        disabled={shown === undefined || exporting || viewerError !== null}
        onClick={() => void exportPng()}
        className="hover:bg-accent rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
      >
        Export PNG ({settings.dpi} dpi, figure width)
      </button>
    </aside>
  );
}
