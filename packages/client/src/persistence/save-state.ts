"use client";

/**
 * "Is my work safe?", as a value React can subscribe to.
 *
 * SAME SHAPE AS `shell/theme.ts`, and for the same reason: the truth lives
 * outside React — the autosave loop runs whether or not anything is rendered —
 * so React is a subscriber rather than the owner. `useSyncExternalStore` is
 * what makes that a subscription instead of a `useState` corrected in an
 * effect.
 *
 * THE ERROR STATE IS THE POINT OF THE WHOLE MODULE. A write that fails does
 * so silently by default: the promise rejects into nothing, IndexedDB's abort
 * carries the reason and no listener, and the chemist keeps drawing on a
 * document that has stopped being saved. So a failure sets `status: "error"`
 * AND keeps the message, and the status bar renders it in the destructive
 * colour rather than as an absence.
 *
 * AND "SAVED" MUST NOT OUTLIVE THE EDIT THAT INVALIDATED IT. Measured: an
 * edit made inside the autosave debounce, followed immediately by a
 * navigation, does not reach IndexedDB — the flush starts an asynchronous
 * write that the teardown does not wait for — and the indicator went on
 * reading "Saved" for the whole of that window, which is the app asserting
 * that work is safe at precisely the moment it is not. `markUnsaved` is
 * therefore raised on the first changed frame, BEFORE the debounce and even
 * during a drag, so the only thing the indicator ever says about a document
 * that is not in storage is that it is not in storage.
 *
 * NOTHING HERE CALLS `console.error`. `e2e/editor.spec.ts` fails a spec on any
 * console error, deliberately — a persistence layer that reported its failures
 * only to a console nobody has open is exactly the silence this module exists
 * to remove.
 */

import { useSyncExternalStore } from "react";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface SaveState {
  readonly status: SaveStatus;
  /** Present when `status` is "error"; the text a human can act on. */
  readonly message?: string;
  /** ISO-8601 of the last SUCCESSFUL write, if there has been one. */
  readonly savedAt?: string;
}

const IDLE: SaveState = { status: "idle" };

let current: SaveState = IDLE;
const listeners = new Set<() => void>();

function emit(next: SaveState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SaveState {
  return current;
}

/** The export is prerendered, and there is nothing saved at prerender time. */
function getServerSnapshot(): SaveState {
  return IDLE;
}

export function saveState(): SaveState {
  return current;
}

/**
 * The document has changed and is not in storage yet.
 *
 * Does NOT clobber an error: a failed write leaves the document unsaved too,
 * and replacing the quota message with a bland "Unsaved changes" would throw
 * away the only actionable half of it.
 */
export function markUnsaved(): void {
  if (current.status === "unsaved" || current.status === "error") return;
  emit({ status: "unsaved" });
}

/**
 * This document IS the one in storage after all — cancel an unsaved claim.
 *
 * Needed because `markUnsaved` fires on the first frame the document changes,
 * and a RESTORE changes the document too: opening `?doc=` installs the stored
 * sketch, which trips the dirty signal on its way in. Baselining is the moment
 * the session says "this one is already written", so the indicator has to stop
 * saying otherwise or every restored sketch would sit there reading "Unsaved
 * changes" until its first edit.
 *
 * Only "unsaved" is cleared. An error still needs its message, and a "saved"
 * with its timestamp is a stronger statement of the same fact.
 */
export function clearUnsaved(): void {
  if (current.status !== "unsaved") return;
  emit(IDLE);
}

export function markSaving(): void {
  if (current.status === "saving") return;
  emit({ status: "saving" });
}

export function markSaved(at: string = new Date().toISOString()): void {
  emit({ status: "saved", savedAt: at });
}

export function markSaveFailed(message: string): void {
  // The previous `savedAt` is deliberately dropped: "saved at 14:02" beside a
  // failure reads as reassurance about work that is no longer safe.
  emit({ status: "error", message });
}

export function resetSaveState(): void {
  emit(IDLE);
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
