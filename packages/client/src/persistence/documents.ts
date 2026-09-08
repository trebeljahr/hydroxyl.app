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

import type { SketchDocument } from "@starter/shared";

import { createIndexedDbStore } from "./idb-store";
import { recordFor } from "./record";
import { markSaveFailed, markSaved, markSaving } from "./save-state";
import { documentThumbnail } from "./thumbnail";
import { storeOk, type DocumentStore, type StoreResult } from "./types";

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
export async function saveDocument(doc: SketchDocument): Promise<StoreResult<void>> {
  markSaving();
  const result = await documentStore().put(recordFor(doc, documentThumbnail(doc)));
  if (result.ok) markSaved();
  else markSaveFailed(result.error.message);
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
  return storeOk(copy);
}
