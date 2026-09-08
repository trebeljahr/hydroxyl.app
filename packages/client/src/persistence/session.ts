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
import { resetSaveState } from "./save-state";

let session: AutosaveHandle | null = null;

export interface EditorPersistenceOptions {
  readonly debounceMs?: number | undefined;
  readonly onResult?: AutosaveOptions["onResult"];
}

export function startEditorPersistence(
  store: EditorStore,
  options: EditorPersistenceOptions = {},
): AutosaveHandle {
  stopEditorPersistence();
  session = startAutosave(store, saveDocument, {
    debounceMs: options.debounceMs,
    onResult: options.onResult,
  });
  return session;
}

export function stopEditorPersistence(): void {
  session?.stop();
  session = null;
}

/** Declare a document already saved — the restored one, or the fixture the
 *  editor opens with, which must not litter the recents grid. */
export function baselineEditorDocument(doc: SketchDocument): void {
  session?.baseline(doc);
}

/**
 * Write now. Returns a promise that the crash path cannot await — see the
 * header of `CanvasErrorBoundary` — and that the tests can.
 */
export function flushEditorDocument(): Promise<unknown> {
  return session?.flush() ?? Promise.resolve(null);
}

export function resetEditorPersistence(): void {
  stopEditorPersistence();
  resetSaveState();
}
