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

import { isStartupDocument, type EditorStore } from "@/state";

import { startAutosave, type AutosaveHandle, type AutosaveOptions } from "./autosave";
import { saveDocument } from "./documents";
import { readJournals, writeJournal } from "./journal";
import { clearUnsaved, markSaveFailed, markUnsaved, resetSaveState } from "./save-state";
import { storeFail, storeOk, type StoreResult } from "./types";

let session: AutosaveHandle | null = null;

/** The store the running session saves, for the title news that has to reach
 *  it from a put's receipt or another tab's rename. */
let editor: EditorStore | null = null;

/**
 * The title this tab last knew to be in storage for the open document, and
 * the revision that said so (-1 when it came from a load, which reads the
 * document and not its meta row).
 *
 * It is the base of the per-field title merge — see `PutOptions.titleBase` —
 * and the comparison that tells "renamed elsewhere" from "renamed here": the
 * open document's title differing from it is a title edit this tab has not
 * saved yet.
 */
let titleBase: { readonly id: string; readonly title: string; readonly revision: number } | null =
  null;

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

/**
 * The autosave sink: `saveDocument` with the title merged against what this
 * tab knows is stored, unless the document is held.
 */
async function sink(doc: SketchDocument): Promise<StoreResult<void>> {
  if (held !== null && held.id === doc.id) {
    markSaveFailed(held.message);
    return storeFail<void>("rejected", held.message);
  }
  const base = titleBase !== null && titleBase.id === doc.id ? titleBase.title : undefined;
  const result = await saveDocument(doc, { titleBase: base });
  if (!result.ok) return result;
  const { title, titleRevision, replacedTitle } = result.value;
  learnStoredTitle(doc.id, title, titleRevision);
  if (replacedTitle !== null && editor?.getState().document.id === doc.id) {
    editor
      .getState()
      .setStatusMessage(
        `Another tab renamed this sketch “${replacedTitle}”. ` +
          `The title changed here, “${title}”, has replaced it.`,
      );
  }
  return storeOk(undefined);
}

/**
 * Storage holds `title` for `id` at `revision` — from this tab's own put, or
 * from another tab's rename. Bring the open document in line.
 *
 * Revisions decide the ORDER, never timing: a receipt and a broadcast about
 * the same document can arrive either way round, and the older one must not
 * be adopted last. Whether to adopt is decided by the title base. When the
 * open title still equals it, nothing here touched the title and the stored
 * one is taken on — outside the undo history and without dirtying the
 * document. When it does not, this tab has its own unsaved title, which wins
 * (decision 52): it is kept, and the next save writes it over the rename.
 */
export function learnStoredTitle(id: string, title: string, revision: number): void {
  const store = editor;
  if (store === null) return;
  const open = store.getState().document;
  if (open.id !== id) return;
  const base = titleBase !== null && titleBase.id === id ? titleBase : null;
  if (base !== null && revision < base.revision) return;
  titleBase = { id, title, revision };

  const local = open.metadata.title;
  if (local === title) return;
  if (base === null || local === base.title) {
    const adopt = (): void => {
      store.getState().adoptDocumentTitle(title);
    };
    if (session === null) adopt();
    else session.adopt(adopt);
    store.getState().setStatusMessage(`Renamed “${title}” in another tab.`);
    return;
  }
  // Only when the title really moved elsewhere. A receipt for this tab's own
  // earlier write carries the base itself, and is not a rename.
  if (base.title !== title) {
    store
      .getState()
      .setStatusMessage(
        `Another tab renamed this sketch “${title}”. ` +
          `The title changed here, “${local}”, will replace it on the next save.`,
      );
  }
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
  titleBase = null;
  editor = store;
  session = startAutosave(store, sink, {
    debounceMs: options.debounceMs,
    onResult: options.onResult,
    // The indicator must not go on saying "Saved" across the debounce window,
    // which is exactly the window in which an edit can still be lost.
    onDirty: markUnsaved,
    // The startup placeholder is nobody's document and must never reach
    // storage under its reserved id — decision 85, and see
    // `@/state/startup-document`. Refused here rather than in the sink so a
    // refusal is silent: `sink` reports failures to the save indicator, and an
    // untouched editor has nothing to fail at.
    persistable: (doc) => !isStartupDocument(doc),
  });
  return session;
}

export function stopEditorPersistence(): void {
  session?.stop();
  session = null;
  editor = null;
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
  // Whatever was loaded is what storage is taken to hold. A fixture that was
  // never stored has no row for the base to be compared against, so its first
  // save writes its title as it stands.
  titleBase = { id: doc.id, title: doc.metadata.title, revision: -1 };
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
  // Through the sink rather than `saveDocument`, so a deliberate Save merges
  // the title exactly as an autosave would.
  return (await flushEditorDocument()) ?? (await sink(doc));
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
  titleBase = null;
  resetSaveState();
}

export type ReleaseSaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Save the open document before this tab reloads into a newer release, and say
 * whether the reload is safe.
 *
 * A reload is a teardown the page chose, so unlike `pagehide` it can wait for
 * the IndexedDB write and refuse when it fails. The journal copy goes first
 * anyway: it is the one write that survives if the browser kills the page
 * mid-flush. Refuses, rather than reloading, when the write fails, when the
 * document is held because another tab deleted it (a reload would drop this
 * tab's copy), or when a newer edit arrived while the write was running.
 */
export async function saveBeforeReleaseReload(): Promise<ReleaseSaveResult> {
  const doc = session?.pending() ?? null;
  if (doc === null) return { ok: true };
  if (held !== null && held.id === doc.id) return { ok: false, message: held.message };
  writeJournal(doc);
  const result = await flushEditorDocument();
  if (result !== null && !result.ok) return { ok: false, message: result.error.message };
  if ((session?.pending() ?? null) !== null)
    return { ok: false, message: "The latest change is still being saved." };
  return { ok: true };
}
