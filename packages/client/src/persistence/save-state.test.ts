import { beforeEach, describe, expect, it } from "vitest";

import {
  clearUnsaved,
  markSaveFailed,
  markSaved,
  markSaving,
  markUnsaved,
  resetSaveState,
  saveState,
} from "./save-state";

/**
 * "Is my work safe?" has to be answered honestly at every moment, including
 * the ones in between. Measured before `markUnsaved` existed: an edit made
 * inside the autosave debounce and followed immediately by a navigation never
 * reached IndexedDB, and the indicator read "Saved" for the whole of that
 * window — the app asserting the work was safe at exactly the moment it was
 * not.
 */

beforeEach(() => {
  resetSaveState();
});

describe("the save state", () => {
  it("stops claiming SAVED the moment the document changes", () => {
    markSaved();
    expect(saveState().status).toBe("saved");
    markUnsaved();
    expect(saveState().status).toBe("unsaved");
  });

  it("drops the previous savedAt, so no timestamp reassures about stale work", () => {
    markSaved("2024-01-01T00:00:00.000Z");
    markUnsaved();
    expect(saveState().savedAt).toBeUndefined();
  });

  it("does not clobber a failure with a blander truth", () => {
    // Both are true — a refused write leaves the document unsaved — but only
    // one of them tells the chemist to delete something or export.
    markSaveFailed("There is no room left in this browser's storage.");
    markUnsaved();
    expect(saveState().status).toBe("error");
    expect(saveState().message).toMatch(/no room left/i);
  });

  it("takes the unsaved claim back when the document turns out to BE the stored one", () => {
    // A restore installs the stored sketch, which changes the document and so
    // trips the dirty signal on its way in. Baselining is the session saying
    // "this one is already written"; without this every sketch opened from the
    // recents grid would read "Unsaved changes" until someone edited it.
    markUnsaved();
    clearUnsaved();
    expect(saveState().status).toBe("idle");
  });

  it("does not downgrade a real failure, or a real save, on the way past", () => {
    markSaveFailed("There is no room left in this browser's storage.");
    clearUnsaved();
    expect(saveState().status).toBe("error");

    resetSaveState();
    markSaved("2024-01-01T00:00:00.000Z");
    clearUnsaved();
    expect(saveState().status).toBe("saved");
    expect(saveState().savedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("runs the full cycle", () => {
    markUnsaved();
    markSaving();
    expect(saveState().status).toBe("saving");
    markSaved();
    expect(saveState().status).toBe("saved");
    expect(saveState().savedAt).toBeTruthy();
  });
});
