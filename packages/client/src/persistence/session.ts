/**
 * The editor's persistence session: one autosave loop, wired to the app's
 * store and the app's document store.
 *
 * A MODULE SINGLETON, because there is one editor per tab and because two of
 * its consumers cannot be handed a value through props. The canvas error
 * boundary needs to flush from `componentDidCatch`, and the `pagehide`
 * listener needs to flush from outside React entirely; both are reaching for
 * "the session that is running", which is what this module names.
 *
 * `stop()` before `start()` is deliberate rather than defensive: React runs
 * effects twice on mount in development StrictMode, and two live
 * subscriptions to the same store would write every document twice.
 */

import type { SketchDocument } from "@starter/shared";

import type { EditorStore } from "@/state";

import { startAutosave, type AutosaveHandle, type AutosaveOptions } from "./autosave";
import { saveDocument } from "./documents";
import { readJournals, writeJournal } from "./journal";
import { clearUnsaved, markSaveFailed, markUnsaved, resetSaveState } from "./save-state";
import { storeFail, type StoreResult } from "./types";

let session: AutosaveHandle | null = null;

/**
 * The document another tab DELETED while this one had it open, if any.
 *
 * Announcing the delete is not enough on its own. The autosave loop writes
 * whatever is on the canvas under its id, so the next edit here would put all
 * three rows straight back — and replace the warning with "Saved" as it did.
 * While an id is held, autosave and the teardown journal both refuse it, and
 * only an explicit Save (`saveEditorDocumentNow`) releases it: bringing a
 * deleted sketch back is a decision, not a side effect of nudging an atom.
 */
let held: { readonly id: string; readonly message: string } | null = null;

/** The autosave sink: `saveDocument`, unless the document is held. */
function sink(doc: SketchDocument): Promise<StoreResult<void>> {
  if (held !== null && held.id === doc.id) {
    markSaveFailed(held.message);
    return Promise.resolve(storeFail<void>("rejected", held.message));
  }
  return saveDocument(doc);
}

/** Stop saving `id` in this tab — it was deleted elsewhere — and say so. */
export function holdEditorDocument(id: string, message: string): void {
  held = { id, message };
  markSaveFailed(message);
}

/** Resume saving `id`: another tab wrote it back, or the chemist chose to. */
export function releaseEditorDocument(id: string): void {
  if (held !== null && held.id === id) held = null;
}

export function isEditorDocumentHeld(id: string): boolean {
  return held !== null && held.id === id;
}

export interface EditorPersistenceOptions {
  readonly debounceMs?: number | undefined;
  readonly onResult?: AutosaveOptions["onResult"];
}

export function startEditorPersistence(
  store: EditorStore,
  options: EditorPersistenceOptions = {},
): AutosaveHandle {
  stopEditorPersistence();
  held = null;
  session = startAutosave(store, sink, {
    debounceMs: options.debounceMs,
    onResult: options.onResult,
    // The indicator must not go on saying "Saved" across the debounce window,
    // which is exactly the window in which an edit can still be lost.
    onDirty: markUnsaved,
  });
  return session;
}

export function stopEditorPersistence(): void {
  session?.stop();
  session = null;
}

/**
 * Declare a document already saved — the restored one, or the fixture the
 * editor opens with, which must not litter the recents grid.
 *
 * Clears the unsaved claim as well as the pending write. `markUnsaved` fires
 * on the first frame the document changes and a restore changes it too, so
 * without this every sketch opened from the recents grid would sit reading
 * "Unsaved changes" until someone edited it — the honest indicator lying in
 * the other direction.
 */
export function baselineEditorDocument(doc: SketchDocument): void {
  session?.baseline(doc);
  clearUnsaved();
}

/**
 * Write now.
 *
 * Resolves the STORE RESULT, not `unknown`, and null when there was nothing
 * to write. That distinction is load-bearing on the crash path: `saveDocument`
 * never rejects — `persistence/types.ts` states the contract as "nothing here
 * throws", and a quota-exhausted put really does resolve `{ok:false}` — so a
 * caller that only handled a rejection would report every refusal as a
 * success. The canvas error boundary used to, and told the chemist their
 * sketch was safe while the status bar beside it showed the quota error.
 */
export function flushEditorDocument(): Promise<StoreResult<void> | null> {
  return session?.flush() ?? Promise.resolve(null);
}

/**
 * An explicit Save of the open document: releases a hold, then writes.
 *
 * Resolves the result of whichever write actually carried the document —
 * the flushed autosave, or a direct put when the document was already the one
 * on disk, which a deliberate Mod+S still deserves an answer about.
 */
export async function saveEditorDocumentNow(doc: SketchDocument): Promise<StoreResult<void>> {
  releaseEditorDocument(doc.id);
  return (await flushEditorDocument()) ?? (await saveDocument(doc));
}

/**
 * Hand the unsaved document to the synchronous journal, and say whether there
 * was one.
 *
 * THE FIRST THING A TEARDOWN HANDLER SHOULD DO, before `flushEditorDocument`.
 * The IndexedDB flush is the write that matters when the page survives —
 * a tab switch, a route change — but it provably does not commit when the page
 * does not, and this one always does. Running both, in this order, costs a
 * `localStorage.setItem` that the next successful save deletes again.
 */
export function journalEditorDocument(): boolean {
  const doc = session?.pending() ?? null;
  if (doc === null) return false;
  // A held document was deleted elsewhere; journalling it would resurrect it
  // on the next load by the back door.
  if (isEditorDocumentHeld(doc.id)) return false;
  return writeJournal(doc);
}

/**
 * Put anything the journal is holding back into IndexedDB, and drop it.
 *
 * Called on startup, BEFORE a page reads the library — otherwise the recents
 * grid lists a row the journal has already superseded, and `?doc=` restores
 * the older copy over the newer one.
 *
 * Each recovered document is written under its OWN id, so it lands on the row
 * it came from rather than forking a second copy of the same sketch. That is
 * the whole intent: this is the tail of a write that was interrupted, not an
 * import. `saveDocument` clears the entry on success.
 *
 * A failed recovery LEAVES THE JOURNAL IN PLACE. If storage is full or
 * unavailable the rescued document is the only copy there is, and deleting it
 * because the retry failed would destroy exactly the work the journal was
 * written to keep; the next load tries again, and `saveDocument` has already
 * put the reason on the save indicator.
 *
 * Resolves the documents that were written back.
 */
export async function recoverJournaledDocuments(): Promise<readonly SketchDocument[]> {
  const recovered: SketchDocument[] = [];
  for (const doc of readJournals()) {
    const result = await saveDocument(doc);
    if (result.ok) recovered.push(doc);
  }
  return recovered;
}

export function resetEditorPersistence(): void {
  stopEditorPersistence();
  held = null;
  resetSaveState();
}
