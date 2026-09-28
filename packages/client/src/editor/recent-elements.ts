/**
 * Keeps the quick picker's recent elements across a reload.
 *
 * A PER-BROWSER CONVENIENCE, NOT DOCUMENT STATE. Which metal a chemist keeps
 * reaching for belongs to the chemist, not to the sketch, so it lives in
 * `localStorage` beside the theme rather than in the saved document, and a
 * shared file never carries someone else's recents into another editor.
 *
 * READ AFTER MOUNT, NEVER DURING RENDER. The editor is prerendered, and the
 * store the server rendered from has an empty list; restoring the stored one
 * in the store's initialiser would make the first client render disagree with
 * the HTML — the hydration mismatch the startup document was fixed for. The
 * popover that shows the list is closed at first paint anyway, so an effect
 * costs nothing visible.
 *
 * EVERY STORAGE CALL IS GUARDED. Private windows, blocked site data and a
 * full quota all throw, and none of them is worth failing the editor over:
 * the list then lasts for the session, which is what it did before it was
 * stored at all.
 */

import { useEffect } from "react";
import type { ElementSymbol } from "@starter/chem-core";

import { editorStore } from "@/state";
import type { EditorStore } from "@/state";

export const RECENT_ELEMENTS_STORAGE_KEY = "chemistry-sketcher.recent-elements";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The stored list, or an empty one. Shape-checked only — the store's
 * `setRecentElements` applies the real rule (known element, not already in
 * the quick picker, one row at most), so a hand-edited entry cannot become a
 * button.
 */
export function readStoredRecentElements(
  storage: ReadableStorage | undefined = defaultStorage(),
): readonly ElementSymbol[] {
  try {
    const raw = storage?.getItem(RECENT_ELEMENTS_STORAGE_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function writeStoredRecentElements(
  symbols: readonly ElementSymbol[],
  storage: WritableStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(RECENT_ELEMENTS_STORAGE_KEY, JSON.stringify(symbols));
  } catch {
    // Only the memory is lost; the list in the store is still right.
  }
}

/**
 * Restore the stored list once, then write it back whenever it changes.
 * Mounted once, in the editor shell.
 */
export function usePersistedRecentElements(store: EditorStore = editorStore): void {
  useEffect(() => {
    store.getState().setRecentElements(readStoredRecentElements());
    let previous = store.getState().recentElements;
    return store.subscribe((state) => {
      if (state.recentElements === previous) return;
      previous = state.recentElements;
      writeStoredRecentElements(previous);
    });
  }, [store]);
}
