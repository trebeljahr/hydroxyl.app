/**
 * The app's one document store, and the save path everything writes through.
 *
 * A MODULE SINGLETON, like the editor store and for the same reason: this is a
 * static, client-only surface with no server package, so the module is
 * instantiated once per browser tab and never once per request. `setDocumentStore`
 * is the seam the unit tests and the "what happens when storage says no"
 * affordance use; nothing in the app calls it.
 *
 * THE STORE IS CONSTRUCTED LAZILY. `createIndexedDbStore` touches no browser
 * global until its first operation, but constructing it at module scope would
 * still mean the recents page and the editor page each decided when that was.
 * One accessor keeps it to one connection per tab.
 */

import { createDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { announceDocumentChange } from "./broadcast";
import { createIndexedDbStore } from "./idb-store";
import { clearJournal, clearJournalSupersededBy, journalSequence } from "./journal";
import { recordFor } from "./record";
import { markSaveFailed, markSaved, markSaving } from "./save-state";
import { documentThumbnail } from "./thumbnail";
import {
  storeOk,
  type DocumentStore,
  type PutOptions,
  type PutReceipt,
  type StoreResult,
  type TitleReceipt,
} from "./types";

let store: DocumentStore | null = null;

export function documentStore(): DocumentStore {
  store ??= createIndexedDbStore();
  return store;
}

/** Test seam, and the seam the `?storage=` affordance on /editor uses.
 *  Passing null restores the real IndexedDB store on the next access. */
export function setDocumentStore(next: DocumentStore | null): void {
  store = next;
}

/**
 * Persist a document and tell the UI how it went.
 *
 * THE THUMBNAIL IS GENERATED HERE rather than in the store, because it is a
 * property of the document and not of the medium: a memory store used in a
 * test should hold the same record the browser would.
 */
export async function saveDocument(
  doc: SketchDocument,
  options: PutOptions = {},
): Promise<StoreResult<PutReceipt>> {
  markSaving();
  // Captured BEFORE the await: a journal written while this write is in flight
  // may hold a newer document than this one, and must survive it.
  const startedAt = journalSequence();
  const result = await documentStore().put(recordFor(doc, documentThumbnail(doc)), options);
  if (result.ok) {
    markSaved();
    // The journal was a stand-in for THIS write. Now that the write has
    // landed, leaving it in place would mean a later startup restoring an
    // older copy over a newer one. Cleared only for the document just saved —
    // a journal belonging to some other sketch is still the only copy of that
    // sketch — and only if it was not written after this save began.
    clearJournalSupersededBy(doc.id, startedAt);
    // So a recents grid open in another tab stops advertising a stale row,
    // and so an editor holding the same id learns it is no longer alone.
    announceDocumentChange({ kind: "put", id: doc.id });
  } else markSaveFailed(result.error.message);
  return result;
}

/**
 * A copy of `doc` under a FRESH id.
 *
 * The id must be new. All three object stores key on `doc.id` and the canvas
 * frames its view on it, so a copy that kept the original's would overwrite
 * its own source the first time either was saved. Used by the grid's
 * Duplicate and by the import path, which forks rather than clobbering a
 * stored document that is newer than the file being read.
 */
export function copyOf(
  doc: SketchDocument,
  options: { readonly title?: string | undefined; readonly now?: string | undefined } = {},
): SketchDocument {
  return createDocument({
    molecule: doc.molecule,
    title: options.title ?? `${doc.metadata.title} copy`,
    stylePreset: doc.stylePreset,
    panels: doc.panels,
    // Field by field through `createDocument`, so a new document-level field
    // has to be named here or a Duplicate silently drops it.
    figure: doc.figure,
    now: options.now,
  });
}

/** Rename, and tell the other tabs — with the title and its revision, so an
 *  editor holding this id can adopt the name without reading storage. */
export async function renameDocument(
  id: string,
  title: string,
): Promise<StoreResult<TitleReceipt>> {
  const result = await documentStore().rename(id, title);
  if (result.ok) {
    announceDocumentChange({
      kind: "rename",
      id,
      title: result.value.title,
      titleRevision: result.value.titleRevision,
    });
  }
  return result;
}

/** Delete, and tell the other tabs — an editor still holding this id would
 *  otherwise resurrect it on its next autosave without anyone noticing. */
export async function removeDocument(id: string): Promise<StoreResult<void>> {
  const result = await documentStore().remove(id);
  if (result.ok) {
    // A journal about the deleted document would put it back on the next
    // load, which is the same resurrection the cross-tab signal exists to
    // stop — just via the other route into storage.
    clearJournal(id);
    announceDocumentChange({ kind: "remove", id });
  }
  return result;
}

export function loadDocument(id: string): Promise<StoreResult<SketchDocument>> {
  return documentStore().get(id);
}

/**
 * Copy a document under a new id.
 *
 * The id MUST be new — `createDocument` mints one — because the canvas frames
 * the view on `doc.id` and the store keys all three of its rows on it. A
 * duplicate that kept the id would silently overwrite its own source.
 */
export async function duplicateDocument(
  id: string,
  makeCopy: (doc: SketchDocument) => SketchDocument,
): Promise<StoreResult<SketchDocument>> {
  const loaded = await documentStore().get(id);
  if (!loaded.ok) return loaded;
  const copy = makeCopy(loaded.value);
  const written = await documentStore().put(recordFor(copy, documentThumbnail(copy)));
  if (!written.ok) return written;
  announceDocumentChange({ kind: "put", id: copy.id });
  return storeOk(copy);
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
 * The recents grid already states the rule for Duplicate — "a copy that kept the
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
export async function forkOverStoredDocuments(
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

/** What an import into the library did. */
export interface ImportReceipt {
  /** The documents now in storage, under the ids they were saved with. */
  readonly saved: readonly SketchDocument[];
  /** How many arrived under a NEW id, because the stored document with their
   *  id had been edited after the file was written. */
  readonly forked: number;
  /** One message per document that could not be written. */
  readonly failures: readonly string[];
}

/**
 * Write imported documents straight into the library, with the same
 * fork-over-newer rule the editor's import applies.
 *
 * The recents grid's Import, which opens nothing: a restored library is forty
 * cards, not forty tabs. The editor's `applyImport` keeps its own loop because
 * it opens the first document and has to baseline it for autosave.
 *
 * A failed write does not stop the loop. A quota error on document 12 will
 * almost certainly repeat on 13, but a document too big for a transaction may
 * not, and trying costs one rejected write each.
 */
export async function importDocuments(
  documents: readonly SketchDocument[],
): Promise<ImportReceipt> {
  const forked = await forkOverStoredDocuments(documents);
  const saved: SketchDocument[] = [];
  const failures: string[] = [];
  for (const doc of forked.documents) {
    const result = await saveDocument(doc);
    if (result.ok) saved.push(doc);
    else failures.push(result.error.message);
  }
  const renamed = forked.documents.filter((doc, index) => doc.id !== documents[index]?.id);
  return { saved, forked: renamed.length, failures };
}

/** Every stored sketch that decodes, and a sentence for each that does not. */
export interface LoadedLibrary {
  readonly documents: readonly SketchDocument[];
  readonly failures: readonly string[];
}

/**
 * Decode the WHOLE library.
 *
 * The one deliberate exception to the rule that the recents grid never calls
 * `get`: a library export is the user asking for every document, so every
 * document has to be read. It runs on a click and never on a page load.
 *
 * A row that does not decode is NAMED and skipped rather than failing the
 * export. A backup missing one sketch, with a sentence saying which, is worth
 * more than no backup.
 */
export async function loadAllDocuments(): Promise<StoreResult<LoadedLibrary>> {
  const store = documentStore();
  const listed = await store.listMeta();
  if (!listed.ok) return listed;
  const documents: SketchDocument[] = [];
  const failures: string[] = [];
  for (const meta of listed.value) {
    const loaded = await store.get(meta.id);
    if (loaded.ok) documents.push(loaded.value);
    else failures.push(`“${meta.title}”: ${loaded.error.message}`);
  }
  return storeOk({ documents, failures });
}
