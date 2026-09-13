/**
 * The unsaved sketch, written synchronously at the last possible moment.
 *
 * ── WHY THIS EXISTS: INDEXEDDB CANNOT BE WRITTEN DURING A TEARDOWN ─────────
 *
 * The autosave debounce is a window in which the drawing exists only in
 * memory, and the obvious way to close it — flush to IndexedDB from `pagehide`
 * — DOES NOT WORK. Measured in Chrome against the production build, with the
 * connection already warm and the whole path from the event to
 * `IDBObjectStore.put` made synchronous on purpose:
 *
 *     put:documents, put:meta, put:thumbnails, pagehide   ← requests queued
 *     (no put-ok, no tx-complete, ever)                    ← never committed
 *
 * The requests are issued, the transaction is opened, and then the document is
 * destroyed before the transaction commits. Navigating 50 ms after the edit
 * loses it exactly as reliably as navigating in the same tick; only waiting
 * out the full debounce, so an ordinary autosave does the write, saves the
 * work. IndexedDB is asynchronous all the way down and there is no version of
 * "flush harder" that changes that.
 *
 * `localStorage.setItem` is synchronous. It returns with the value already
 * committed, which is the one property needed here and the reason this module
 * uses a storage mechanism the rest of the persistence layer deliberately does
 * not.
 *
 * ── IT IS A JOURNAL, NOT A SECOND STORE ────────────────────────────────────
 *
 * It holds AT MOST ONE entry PER DOCUMENT — the one being edited in some tab —
 * and only for the span between an edit and the next successful IndexedDB
 * write. `saveDocument` clears it on success, so in the ordinary run of things
 * it is empty. It is read on startup, and its content is written straight into
 * IndexedDB and then dropped. Nothing else in the app reads it, and no feature
 * is built on it: the recents grid, the migrations and the thumbnails all
 * belong to the real store.
 *
 * KEYED BY DOCUMENT ID, not one slot for the origin. `localStorage` is shared
 * by every tab, and closing a window with two editors in it fires two
 * `pagehide`s; a single key would keep whichever tab ran last and silently
 * drop the other's rescue.
 *
 * ── AND A SAVE CLEARS ONLY A JOURNAL IT SUPERSEDES ─────────────────────────
 *
 * An older write can COMPLETE after a newer journal was written: edit to v1,
 * its write goes out, edit to v2, the tab is hidden and v2 is journalled, then
 * v1's write lands. Clearing on "same id" would delete v2's only durable copy
 * while v2's own write is still in flight. So every journal write takes a
 * sequence number, a save remembers the sequence at which it STARTED, and it
 * clears the entry only if nothing was journalled for that id after it began —
 * a save started later carries the current document, which is at least as new
 * as anything journalled before it.
 *
 * The encoding is the SAME as the store's — `encodeDocument` in, `decodeStored`
 * out — so a document journalled by one build and recovered by the next goes
 * through the identical migration path. A journal is not a place to invent a
 * second format that would then need its own versioning.
 *
 * ── EVERY PATH DEGRADES TO A NO-OP ─────────────────────────────────────────
 *
 * `localStorage` is absent under SSR, throws on access in a sandboxed iframe
 * and with third-party storage blocked, and `setItem` throws once the origin's
 * few megabytes are full — which a 20 000-atom stress fixture will manage. All
 * of that is caught and reported as "not journalled", which is honest: the
 * save indicator is already showing "Unsaved changes" for exactly this
 * document, so the failure is visible without this module saying anything. A
 * best-effort rescue that took the page down with it would be worse than no
 * rescue at all.
 */

import { encodeDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { decodeStored } from "./migrate";

const JOURNAL_PREFIX = "chemistry-sketcher/unsaved/";

/** The key one document's journal lives under. Exported for the specs, which
 *  assert a rescue copy is gone once it has been honoured. */
export function journalKey(id: string): string {
  return `${JOURNAL_PREFIX}${id}`;
}

/** Bumped on every journal write in THIS page. */
let sequence = 0;
/** The sequence at which each id was last journalled by this page. A journal
 *  left by an earlier page load has no entry, which reads as 0: any save
 *  started now supersedes it. */
const journalledAt = new Map<string, number>();

/** `localStorage`, or null wherever reaching for it is not safe. Accessing the
 *  property itself throws when a browser is set to block site data, so the
 *  guard has to be a try/catch rather than a `typeof` check alone. */
function journalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Write the unsaved document. Returns whether it actually landed.
 *
 * Called from `pagehide` and from `visibilitychange`, so it must be cheap and
 * it must not throw: a rescue that broke the unload handler would take the
 * IndexedDB flush attempt down with it.
 */
export function writeJournal(doc: SketchDocument): boolean {
  const store = journalStorage();
  if (store === null) return false;
  try {
    store.setItem(journalKey(doc.id), JSON.stringify(encodeDocument(doc)));
    sequence += 1;
    journalledAt.set(doc.id, sequence);
    return true;
  } catch {
    // Out of room, or a browser refusing to persist anything for this origin.
    return false;
  }
}

/** The current journal sequence. A save captures it before it starts. */
export function journalSequence(): number {
  return sequence;
}

/** Forget one document's journal. Idempotent, and safe when there is none. */
export function clearJournal(id: string): void {
  const store = journalStorage();
  if (store === null) return;
  try {
    store.removeItem(journalKey(id));
    journalledAt.delete(id);
  } catch {
    // Nothing to do, and nothing worth failing a save over.
  }
}

/**
 * Clear `id`'s journal after a successful save that STARTED at `startedAt`,
 * unless the journal was written after that — see the header.
 */
export function clearJournalSupersededBy(id: string, startedAt: number): void {
  if ((journalledAt.get(id) ?? 0) > startedAt) return;
  clearJournal(id);
}

/** The ids with a journal entry, without decoding anything — the id is the
 *  key, so no molecule and not even a `JSON.parse` is paid for. */
export function journaledDocumentIds(): readonly string[] {
  const store = journalStorage();
  if (store === null) return [];
  const ids: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== null && key.startsWith(JOURNAL_PREFIX) && key.length > JOURNAL_PREFIX.length) {
        ids.push(key.slice(JOURNAL_PREFIX.length));
      }
    }
  } catch {
    return [];
  }
  return ids;
}

/**
 * Every journalled document.
 *
 * An entry that cannot be read is DROPPED rather than reported. It is written
 * during a teardown, which is the one moment a half-written value is
 * plausible, and there is no useful thing a chemist could do with the news —
 * the content is gone either way, and leaving it in place would mean
 * re-attempting the same failed decode on every subsequent load. An entry
 * whose decoded id disagrees with its key is dropped for the same reason:
 * recovering it would write under an id nobody journalled.
 */
export function readJournals(): readonly SketchDocument[] {
  const store = journalStorage();
  if (store === null) return [];
  const docs: SketchDocument[] = [];
  for (const id of journaledDocumentIds()) {
    let raw: string | null;
    try {
      raw = store.getItem(journalKey(id));
    } catch {
      continue;
    }
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      clearJournal(id);
      continue;
    }
    const decoded = decodeStored(parsed);
    if (!decoded.ok || decoded.value.id !== id) {
      clearJournal(id);
      continue;
    }
    docs.push(decoded.value);
  }
  return docs;
}
