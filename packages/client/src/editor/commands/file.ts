/**
 * The file commands' behaviour, kept out of `registry.ts` for the same reason
 * `cleanup.ts` is: they are async, they touch storage and the file system, and
 * the registry has to stay importable by a plain-node test.
 *
 * EVERY ONE OF THEM REPORTS. A save that failed, an import that was refused
 * and a picker the user dismissed are three different outcomes and the status
 * line says which — flattening them to silence is the failure mode this whole
 * task exists to remove.
 */

import { createDocument, type SketchDocument } from "@starter/shared";

import { exportDocument, type ExportFormat } from "@/lib/io/save";
import { openText, type OpenTextOptions } from "@/lib/io/open";
import { pickTextFiles } from "@/lib/io/file-system";
import { saveDocument } from "@/persistence/documents";
import { baselineEditorDocument, flushEditorDocument } from "@/persistence/session";
import type { EditorStore } from "@/state";

/** What a chemist's file manager will offer, plus the wildcard: the whole
 *  point of content sniffing is that the extension is not trusted. */
export const OPEN_ACCEPT = ".mol,.sdf,.sd,.json,.txt,.smi,.smiles,*";

/**
 * Save the current sketch to storage NOW, rather than waiting for the
 * autosave debounce. Mod+S means "make sure", and answering it with silence
 * because a timer has not fired yet is not an answer.
 */
export async function saveNow(store: EditorStore): Promise<void> {
  const doc = store.getState().document;
  const flushed = await flushEditorDocument();
  // `flush` returns null when the document is already the one on disk, which
  // is the common case for a deliberate Mod+S and still deserves a word.
  if (flushed === null) {
    const result = await saveDocument(doc);
    store
      .getState()
      .setStatusMessage(result.ok ? `Saved “${doc.metadata.title}”` : result.error.message);
    return;
  }
  const result = flushed as { ok: boolean; error?: { message: string } };
  store
    .getState()
    .setStatusMessage(
      result.ok ? `Saved “${doc.metadata.title}”` : (result.error?.message ?? "Not saved"),
    );
}

/** Export to a file the rest of the world reads. */
export async function exportCurrent(
  store: EditorStore,
  format: ExportFormat,
): Promise<void> {
  const doc = store.getState().document;
  const outcome = await exportDocument(doc, format);
  if (outcome.ok) {
    store.getState().setStatusMessage(`Exported “${doc.metadata.title}”`);
    return;
  }
  // A dismissed picker is not a failure and gets no message: the user closed
  // the dialog and knows they did.
  if (outcome.cancelled) return;
  // Verbatim, because for a molfile this is `MolblockLabelError`'s message
  // naming the atoms carrying a cosmetic label (decision 8), and "export
  // failed" would throw away the only part worth reading.
  store.getState().setStatusMessage(outcome.message);
}

/**
 * How an import lands on the editor.
 *
 * DECISION 7: a dropped structure opens a NEW document, undoable, leaving the
 * current one untouched — so this goes through `openDocument`, which pushes a
 * history entry whose base is the sketch that was on the canvas. A mis-drop
 * onto unsaved work is one Ctrl+Z away from being undone.
 *
 * A multi-record SDF becomes N documents. The first is opened; the rest are
 * written straight to storage, because a store holding one document cannot
 * open forty and a grid that lists them can.
 */
export async function applyImport(
  store: EditorStore,
  documents: readonly SketchDocument[],
  warnings: readonly string[],
): Promise<void> {
  const [first, ...rest] = documents;
  if (first === undefined) return;

  store.getState().openDocument(first, `Open ${first.metadata.title}`);
  // Baselined, then saved explicitly: the import IS the change worth
  // persisting, and letting the debounce find it would leave a window in
  // which the drop is on screen and nowhere else.
  baselineEditorDocument(store.getState().document);
  const saved = await saveDocument(store.getState().document);

  const failures: string[] = [];
  if (!saved.ok) failures.push(saved.error.message);
  for (const doc of rest) {
    const result = await saveDocument(doc);
    if (!result.ok) failures.push(result.error.message);
  }

  const parts: string[] = [];
  parts.push(
    rest.length === 0
      ? `Opened “${first.metadata.title}”`
      : `Opened “${first.metadata.title}” and saved ${String(rest.length)} more from the same file`,
  );
  parts.push(...warnings);
  // One failure message is enough; they will all be the same quota error.
  if (failures[0] !== undefined) parts.push(failures[0]);
  store.getState().setStatusMessage(parts.join(" — "));
}

/** Read text and put it on the canvas, reporting whatever went wrong. */
export async function importText(
  store: EditorStore,
  text: string,
  options: OpenTextOptions = {},
): Promise<void> {
  const result = await openText(text, options);
  if (!result.ok) {
    store.getState().setStatusMessage(result.message);
    return;
  }
  await applyImport(store, result.value.documents, result.value.warnings);
}

/** The file picker, then the import. */
export async function openFromDisk(store: EditorStore): Promise<void> {
  const files = await pickTextFiles(OPEN_ACCEPT);
  if (files.length === 0) return;
  const documents: SketchDocument[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const result = await openText(file.text, { name: file.name });
    if (!result.ok) {
      warnings.push(`${file.name}: ${result.message}`);
      continue;
    }
    documents.push(...result.value.documents);
    warnings.push(...result.value.warnings);
  }
  if (documents.length === 0) {
    store.getState().setStatusMessage(warnings[0] ?? "Nothing could be read from that file.");
    return;
  }
  await applyImport(store, documents, warnings);
}

/** A blank sketch, opened here rather than on a new route: this is one editor
 *  holding one document, and navigating would throw away the undo stack. */
export async function newSketch(store: EditorStore): Promise<void> {
  const doc = createDocument({ title: "Untitled" });
  store.getState().openDocument(doc, "New sketch");
  baselineEditorDocument(store.getState().document);
  store.getState().setStatusMessage("New sketch");
  // Not saved: an empty document has nothing to lose, and writing one on every
  // Mod+N would fill the recents grid with blanks. The first edit persists it.
  await Promise.resolve();
}
