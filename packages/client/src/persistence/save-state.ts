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
 * NOTHING HERE CALLS `console.error`. `e2e/editor.spec.ts` fails a spec on any
 * console error, deliberately — a persistence layer that reported its failures
 * only to a console nobody has open is exactly the silence this module exists
 * to remove.
 */

import { useSyncExternalStore } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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
