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
