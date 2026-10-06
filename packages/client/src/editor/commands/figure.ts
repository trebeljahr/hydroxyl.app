/**
 * The figure commands: export SVG, export PNG, copy the figure, copy the
 * structure as SMILES, InChI, InChIKey or a molfile, download it as CDXML,
 * copy its elemental analysis.
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

import { elementalAnalysisLine, extractFragment, isEmpty, writeCdxml } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

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
import { fileBaseName } from "@/lib/io/save";
import { moleculeToMolblock, molblockVersionNotice } from "@/lib/rdkit/translate";
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
  const { dpi, pngBackground } = store.getState().ui.figureExport;
  // Built now, rasterised only once the picker has its answer.
  const svg = figureSvgForRaster(figure, pngBackground);
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

/**
 * The structure as a ChemDraw CDXML file, for a co-author on ChemDraw.
 *
 * The STRUCTURE, not the figure: CDXML is a drawing a co-author edits, so it
 * holds the molecule as drawn on the canvas and none of the panels. Needs no
 * panel and no RDKit — chem-core writes it directly. What CDXML cannot hold is
 * said in the status line, never dropped silently.
 */
export async function exportCdxml(store: EditorStore): Promise<void> {
  const doc = store.getState().document;
  if (isEmpty(doc.molecule)) {
    report(store, "Nothing has been drawn yet, so there is no CDXML to download.");
    return;
  }
  const { cdxml, dropped } = writeCdxml(doc.molecule, { program: "Hydroxyl" });
  const outcome = await writeBlobFile(
    textBlob(cdxml, "chemical/x-cdxml"),
    `${fileBaseName(doc)}.cdxml`,
    "chemical/x-cdxml",
    "ChemDraw CDXML",
    ".cdxml",
  );
  if (outcome.ok) {
    report(store, ["Downloaded the structure as CDXML.", ...dropped].join(" "));
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
    const { dpi, pngBackground } = store.getState().ui.figureExport;
    parts["image/png"] = rasterizeSvg(figureSvgForRaster(figure, pngBackground), widthPx, heightPx, dpi);
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
    store.getState().setSelection({ atomIds, bondIds: [], annotationIds: [] });
  }
  report(store, message);
}

/**
 * What a text copy covers: the whole structure, or the selected atoms cut out
 * as a molecule of their own.
 */
export type CopyScope = "structure" | "selection";

interface CopySource {
  readonly molecule: Molecule;
  /** "structure" or "selection", for the sentence that reports the copy. */
  readonly noun: string;
  /**
   * A refusal restated in the document's ids. `extractFragment` MINTS NEW
   * IDS (a1, a2, …), so an atom the writer names in the fragment is not the
   * atom of that name on the canvas: selecting it would highlight the wrong
   * one, and the sentence would point at it too.
   */
  readonly refusal: (
    message: string,
    ids: readonly AtomId[] | undefined,
  ) => { readonly message: string; readonly atomIds: readonly AtomId[] | undefined };
}

function copySource(store: EditorStore, scope: CopyScope): CopySource | null {
  const state = store.getState();
  const mol = state.document.molecule;
  if (scope === "structure") {
    return {
      molecule: mol,
      noun: "structure",
      refusal: (message, atomIds) => ({ message, atomIds }),
    };
  }
  if (state.selection.atomIds.length === 0) return null;
  const fragment = extractFragment(mol, state.selection.atomIds);
  const back = new Map<AtomId, AtomId>();
  for (const [source, copied] of fragment.atomIdMap) back.set(copied, source);
  return {
    molecule: fragment.molecule,
    noun: "selection",
    refusal: (message, atomIds) => ({
      // ONE pass over the sentence, so a fragment a1 that maps to document a5
      // is never rewritten a second time by a fragment a5's own entry.
      message: message.replace(/\b[a-z]+\d+\b/g, (id) =>
        atomIds?.includes(id) === true ? (back.get(id) ?? id) : id,
      ),
      atomIds: atomIds?.flatMap((id) => back.get(id) ?? []),
    }),
  };
}

export async function copyMolblock(
  store: EditorStore,
  scope: CopyScope = "structure",
): Promise<void> {
  const doc = store.getState().document;
  const source = copySource(store, scope);
  if (source === null || isEmpty(source.molecule)) {
    report(
      store,
      scope === "selection"
        ? "No atoms are selected, so there is no molfile to copy."
        : "Nothing has been drawn yet, so there is no molfile to copy.",
    );
    return;
  }
  const written = moleculeToMolblock(source.molecule, doc.metadata.title);
  if (!written.ok) {
    const refused = source.refusal(written.error.message, written.error.atomIds);
    refuseLabelled(store, refused.message, refused.atomIds);
    return;
  }
  // Decision 49: the generation was chosen from the molecule, so the line that
  // says the copy happened says which generation it was. The dialog shows the
  // same sentence before the click; it is repeated because the copy may have
  // been made from the palette, with no dialog on screen.
  const versionNote = molblockVersionNotice(source.molecule);
  const { done } = writeClipboardParts({ "text/plain": Promise.resolve(textBlob(written.value)) });
  try {
    await done;
    report(
      store,
      versionNote === null
        ? `Copied the ${source.noun} as a molfile`
        : `Copied the ${source.noun} as a molfile. ${versionNote}`,
    );
  } catch (error) {
    report(store, `The molfile could not be copied: ${describe(error)}`);
  }
}

/**
 * The "Anal. Calcd for …" line of an experimental section (decision 233), as
 * plain text and as HTML whose formula counts are real subscripts, so a word
 * processor pastes C<sub>9</sub>H<sub>8</sub>O<sub>4</sub> rather than C9H8O4.
 * chem-core decides what is refused; this only routes the sentence.
 */
export async function copyElementalAnalysis(
  store: EditorStore,
  scope: CopyScope = "structure",
): Promise<void> {
  const source = copySource(store, scope);
  if (source === null || isEmpty(source.molecule)) {
    report(
      store,
      scope === "selection"
        ? "No atoms are selected, so there is no elemental analysis to copy."
        : "Nothing has been drawn yet, so there is no elemental analysis to copy.",
    );
    return;
  }
  const line = elementalAnalysisLine(source.molecule);
  if (!line.ok) {
    report(store, line.reason);
    return;
  }
  const { done } = writeClipboardParts({
    "text/plain": Promise.resolve(textBlob(line.text)),
    "text/html": Promise.resolve(textBlob(line.html, "text/html")),
  });
  try {
    await done;
    report(store, `Copied the ${source.noun}'s elemental analysis: ${line.text}`);
  } catch (error) {
    report(store, `The elemental analysis could not be copied: ${describe(error)}`);
  }
}

export async function copySmiles(
  store: EditorStore,
  scope: CopyScope = "structure",
): Promise<void> {
  await copyRdkitText(store, scope, "SMILES", async (molecule, title) => {
    const { toSmiles } = await import("@/lib/rdkit/client");
    const result = await toSmiles(molecule, title);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
}

/**
 * The InChI or the InChIKey. Both come out of one worker call (`toInchi`
 * returns the pair), but each command puts ONE string on the clipboard: a
 * database search box wants the key alone, and a supplementary-information
 * table wants the identifier alone.
 *
 * There is no InChI READER behind this. The bundled RDKit writes an InChI but
 * cannot parse one; `inchi.node.test.ts` pins that, and `open.ts` refuses a
 * pasted InChI by name.
 */
export async function copyInchi(
  store: EditorStore,
  scope: CopyScope = "structure",
  which: "inchi" | "inchikey" = "inchi",
): Promise<void> {
  const format = which === "inchi" ? "InChI" : "InChIKey";
  await copyRdkitText(store, scope, format, async (molecule, title) => {
    const { toInchi } = await import("@/lib/rdkit/client");
    const result = await toInchi(molecule, title);
    if (!result.ok) throw new Error(result.error.message);
    if (which === "inchi") return result.value.inchi;
    // An empty key is RDKit's only failure signal from the key step (see
    // `inchiAndMolblock`). Never put an empty string on the clipboard.
    if (result.value.inchiKey === "") {
      throw new Error("RDKit produced no InChIKey for this structure.");
    }
    return result.value.inchiKey;
  });
}

/** The shared body of every text copy that has to go through the RDKit worker. */
async function copyRdkitText(
  store: EditorStore,
  scope: CopyScope,
  format: string,
  write: (molecule: Molecule, title: string) => Promise<string>,
): Promise<void> {
  const doc = store.getState().document;
  const source = copySource(store, scope);
  if (source === null || isEmpty(source.molecule)) {
    report(
      store,
      scope === "selection"
        ? `No atoms are selected, so there is no ${format} to copy.`
        : `Nothing has been drawn yet, so there is no ${format} to copy.`,
    );
    return;
  }
  const molecule = source.molecule;
  // Checked synchronously first: the same molblock gate the worker call
  // applies, so a labelled atom is reported and selected before the clipboard
  // or the wasm is touched at all.
  const gate = moleculeToMolblock(molecule, doc.metadata.title);
  if (!gate.ok) {
    const refused = source.refusal(gate.error.message, gate.error.atomIds);
    refuseLabelled(store, refused.message, refused.atomIds);
    return;
  }
  // Dynamic, like clean-up: /editor must not fetch RDKit until asked.
  const text = write(molecule, doc.metadata.title);
  const { done } = writeClipboardParts({ "text/plain": text.then((value) => textBlob(value)) });
  try {
    await done;
    report(store, `Copied ${format} ${await text}`);
  } catch (error) {
    report(store, `The ${format} could not be copied: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
