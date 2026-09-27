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
import { molblockVersionNotice } from "@/lib/rdkit/translate";
import { openText, type OpenTextOptions } from "@/lib/io/open";
import { pickTextFiles } from "@/lib/io/file-system";
import { copyOf, documentStore, saveDocument } from "@/persistence/documents";
import { baselineEditorDocument, saveEditorDocumentNow } from "@/persistence/session";
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
  // Also the one way to bring back a sketch another tab deleted while it was
  // open here: autosave holds it, and a deliberate Save releases the hold.
  const result = await saveEditorDocumentNow(doc);
  store
    .getState()
    .setStatusMessage(result.ok ? `Saved “${doc.metadata.title}”` : result.error.message);
}

/** Export to a file the rest of the world reads. */
export async function exportCurrent(
  store: EditorStore,
  format: ExportFormat,
): Promise<void> {
  const doc = store.getState().document;
  const outcome = await exportDocument(doc, format);
  if (outcome.ok) {
    // Decision 49's switch is silent in the file itself — a V3000 molblock looks
    // like a molblock — so the line that says the export happened is where a
    // downloaded one says which generation it is.
    const note = format === "mol" ? molblockVersionNotice(doc.molecule) : null;
    store
      .getState()
      .setStatusMessage(
        note === null
          ? `Exported “${doc.metadata.title}”`
          : `Exported “${doc.metadata.title}”. ${note}`,
      );
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
  const forked = await forkOverStoredDocuments(documents);
  const [first, ...rest] = forked.documents;
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
  if (forked.note !== null) parts.push(forked.note);
  // One failure message is enough; they will all be the same quota error.
  if (failures[0] !== undefined) parts.push(failures[0]);
  store.getState().setStatusMessage(parts.join(" — "));
}

/**
 * Re-id any incoming document that would OVERWRITE a newer stored one.
 *
 * A native `.chemsketch.json` carries its own `doc.id` — `openJson` returns
 * the decoded document verbatim, and it has to, or reopening an exported
 * sketch on a fresh machine would not be the same sketch. But all three object
 * stores key on that id, so importing a file whose stored counterpart has
 * moved on REPLACES the newer rows: export a sketch, keep drawing, drag the
 * exported file back in to check that it opens, and the newer copy is gone.
 * Undo puts the canvas back but nothing rolls the database back, and the
 * undone state has a different id, so no later autosave repairs it.
 *
 * `page.tsx` already states the rule for Duplicate — "a copy that kept the
 * original's id would overwrite its own source" — and this is the same rule
 * on the import path.
 *
 * THE COMPARISON IS `modifiedAt`, not existence. Reopening a file that is at
 * least as new as the stored row loses nothing and should keep its identity,
 * which is the ordinary "open my own sketch" case; only a stored document that
 * has moved on since the file was written gets forked away from.
 *
 * Reads the META store only, in one call. The recents grid's whole design is
 * that a listing costs no molecules, and an import must not be the one place
 * that quietly deserializes the library.
 */
async function forkOverStoredDocuments(
  documents: readonly SketchDocument[],
): Promise<{ readonly documents: readonly SketchDocument[]; readonly note: string | null }> {
  const listed = await documentStore().listMeta();
  // A listing that failed is not a reason to refuse an import: without it the
  // worst case is the behaviour this function replaced, and the alternative is
  // losing the drop entirely.
  if (!listed.ok) return { documents, note: null };

  const newer = new Map<string, string>();
  for (const meta of listed.value) newer.set(meta.id, meta.modifiedAt);

  let forked = 0;
  const next = documents.map((doc) => {
    const storedAt = newer.get(doc.id);
    if (storedAt === undefined || storedAt <= doc.metadata.modifiedAt) return doc;
    forked += 1;
    return copyOf(doc, { title: doc.metadata.title });
  });

  return {
    documents: next,
    note:
      forked === 0
        ? null
        : forked === 1
          ? "imported as a new sketch, because the saved one has been edited since this file was written"
          : `${String(forked)} were imported as new sketches, because the saved ones have been edited since this file was written`,
  };
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
