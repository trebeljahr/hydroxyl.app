/**
 * The figure commands: export SVG, export PNG, copy the figure, copy the
 * structure as SMILES or as a molfile.
 *
 * Kept out of `registry.ts` for the reason the file commands are: the registry
 * stays importable by a plain-node test, and this is where the browser APIs
 * (Blob, canvas, clipboard) are reached.
 *
 * EVERY ONE REPORTS, through the status bar, in a sentence — including the
 * refusals. An export that cannot be made says which panel and why; a
 * molfile that cannot be written says which atoms and selects them.
 *
 * GESTURE DISCIPLINE. The clipboard and the save picker both need the user
 * activation of the click that asked for them, and an `await` spends it. So
 * each command does all of its synchronous work first and hands the slow part
 * (rasterising, loading RDKit) to the clipboard or the picker AS A PROMISE.
 * See `writeClipboardParts` and `writeBlobFile`.
 */

import { isEmpty } from "@starter/chem-core";
import type { AtomId } from "@starter/chem-core";

import {
  annotationSizeNotice,
  figureSvgForFile,
  figureSvgForRaster,
  prepareFigure,
  rasterTooLarge,
  labelSizeNotice,
  scaleNotice,
} from "@/lib/export/figure";
import type { PreparedFigure } from "@/lib/export/figure";
import { textBlob, writeClipboardParts } from "@/lib/export/clipboard";
import { canvasCanHold, rasterizeSvg } from "@/lib/export/png";
import { writeBlobFile } from "@/lib/io/file-system";
import { moleculeToMolblock } from "@/lib/rdkit/translate";
import type { EditorStore } from "@/state";

function report(store: EditorStore, message: string): void {
  store.getState().setStatusMessage(message);
}

function prepared(store: EditorStore): PreparedFigure | null {
  const state = store.getState();
  const result = prepareFigure(state.document, state.ui.figureExport);
  if (!result.ok) {
    report(store, result.message);
    return null;
  }
  return result.value;
}

function sizeNote(store: EditorStore, p: PreparedFigure): string {
  const size = `${p.size.widthCm.toFixed(2)} × ${p.size.heightCm.toFixed(2)} cm`;
  // A shrunk figure is said out loud here too: the dialog may already be closed.
  const settings = store.getState().ui.figureExport;
  const notice = scaleNotice(p.size, settings);
  const labels = labelSizeNotice(p, settings);
  const annotations = annotationSizeNotice(p, settings);
  return [notice === null ? `${size}.` : `${size}. ${notice}`, labels?.summary, annotations?.summary]
    .filter((part) => part !== undefined)
    .join(" ");
}

export async function exportFigureSvg(store: EditorStore): Promise<void> {
  const figure = prepared(store);
  if (figure === null) return;
  const svg = figureSvgForFile(figure);
  const outcome = await writeBlobFile(
    textBlob(svg, "image/svg+xml"),
    `${figure.filenameBase}.svg`,
    "image/svg+xml",
    "SVG figure",
    ".svg",
  );
  if (outcome.ok) report(store, `Exported the figure as SVG, ${sizeNote(store, figure)}`);
  else if (!outcome.cancelled) report(store, outcome.message);
}

export async function exportFigurePng(store: EditorStore): Promise<void> {
  const figure = prepared(store);
  if (figure === null) return;
  const tooLarge = rasterTooLarge(figure, canvasCanHold);
  if (tooLarge !== null) {
    report(store, tooLarge);
    return;
  }
  const { widthPx, heightPx } = figure.size;
  const dpi = store.getState().ui.figureExport.dpi;
  // Built now, rasterised only once the picker has its answer.
  const svg = figureSvgForRaster(figure);
  const outcome = await writeBlobFile(
    () => rasterizeSvg(svg, widthPx, heightPx, dpi),
    `${figure.filenameBase}.png`,
    "image/png",
    "PNG figure",
    ".png",
  );
  if (outcome.ok) {
    report(store, `Exported the figure as PNG, ${widthPx} × ${heightPx} px at ${dpi} dpi`);
  } else if (!outcome.cancelled) {
    report(store, outcome.message);
  }
}

export async function copyFigure(store: EditorStore): Promise<void> {
  const figure = prepared(store);
  if (figure === null) return;
  const tooLarge = rasterTooLarge(figure, canvasCanHold);
  const svg = figureSvgForFile(figure);
  const parts: Record<string, Promise<Blob>> = {
    "image/svg+xml": Promise.resolve(textBlob(svg, "image/svg+xml")),
    "text/plain": Promise.resolve(textBlob(svg)),
  };
  if (tooLarge === null) {
    const { widthPx, heightPx } = figure.size;
    parts["image/png"] = rasterizeSvg(
      figureSvgForRaster(figure),
      widthPx,
      heightPx,
      store.getState().ui.figureExport.dpi,
    );
  }
  const { written, done } = writeClipboardParts(parts);
  try {
    await done;
    const copied = `Copied the figure (${written.map((type) => type.replace(/^\w+\//, "").replace("+xml", "")).join(", ")})`;
    // A PNG left out is said out loud, with why, not implied by its absence.
    report(store, tooLarge === null ? copied : `${copied}, without a PNG. ${tooLarge}`);
  } catch (error) {
    report(store, `The figure could not be copied: ${describe(error)}`);
  }
}

/**
 * Surface a refused molblock as decision 8 requires: the error's own sentence,
 * which names each labelled atom, AND the atoms selected on the canvas so the
 * user can see which ones to expand or strip.
 */
function refuseLabelled(store: EditorStore, message: string, atomIds: readonly AtomId[] | undefined): void {
  if (atomIds !== undefined && atomIds.length > 0) {
    store.getState().setSelection({ atomIds, bondIds: [] });
  }
  report(store, message);
}

export async function copyMolblock(store: EditorStore): Promise<void> {
  const doc = store.getState().document;
  if (isEmpty(doc.molecule)) {
    report(store, "Nothing has been drawn yet, so there is no molfile to copy.");
    return;
  }
  const written = moleculeToMolblock(doc.molecule, doc.metadata.title);
  if (!written.ok) {
    refuseLabelled(store, written.error.message, written.error.atomIds);
    return;
  }
  const { done } = writeClipboardParts({ "text/plain": Promise.resolve(textBlob(written.value)) });
  try {
    await done;
    report(store, "Copied the structure as a molfile");
  } catch (error) {
    report(store, `The molfile could not be copied: ${describe(error)}`);
  }
}

export async function copySmiles(store: EditorStore): Promise<void> {
  const doc = store.getState().document;
  if (isEmpty(doc.molecule)) {
    report(store, "Nothing has been drawn yet, so there is no SMILES to copy.");
    return;
  }
  // Checked synchronously first: the same molblock gate `toSmiles` applies,
  // so a labelled atom is reported and selected before the clipboard or the
  // wasm is touched at all.
  const gate = moleculeToMolblock(doc.molecule, doc.metadata.title);
  if (!gate.ok) {
    refuseLabelled(store, gate.error.message, gate.error.atomIds);
    return;
  }
  // Dynamic, like clean-up: /editor must not fetch RDKit until asked.
  const smiles = import("@/lib/rdkit/client").then(async ({ toSmiles }) => {
    const result = await toSmiles(doc.molecule, doc.metadata.title);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  const { done } = writeClipboardParts({ "text/plain": smiles.then((text) => textBlob(text)) });
  try {
    await done;
    report(store, `Copied SMILES ${await smiles}`);
  } catch (error) {
    report(store, `The SMILES could not be copied: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
