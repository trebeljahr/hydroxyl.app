import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorStore } from "@/state";

import {
  RECENT_ELEMENTS_STORAGE_KEY,
  readStoredRecentElements,
  usePersistedRecentElements,
  writeStoredRecentElements,
} from "./recent-elements";

/** A Storage stand-in; jsdom's own is shared across the file. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("reading and writing the stored list", () => {
  it("round-trips a list", () => {
    const storage = memoryStorage();
    writeStoredRecentElements(["Pt", "Pd"], storage);
    expect(readStoredRecentElements(storage)).toEqual(["Pt", "Pd"]);
  });

  it("reads anything malformed as an empty list rather than throwing", () => {
    for (const raw of ["not json", "{}", "42", "null"]) {
      const storage = memoryStorage({ [RECENT_ELEMENTS_STORAGE_KEY]: raw });
      expect(readStoredRecentElements(storage), raw).toEqual([]);
    }
    const mixed = memoryStorage({ [RECENT_ELEMENTS_STORAGE_KEY]: '["Pt", 3, null, "Fe"]' });
    expect(readStoredRecentElements(mixed)).toEqual(["Pt", "Fe"]);
  });

  it("survives a storage that throws, as a private window's does", () => {
    const hostile = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readStoredRecentElements(hostile)).toEqual([]);
    expect(() => writeStoredRecentElements(["Pt"], hostile)).not.toThrow();
  });
});

describe("usePersistedRecentElements", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the stored list on mount and writes each change back", () => {
    window.localStorage.setItem(RECENT_ELEMENTS_STORAGE_KEY, '["Pd"]');
    const store = createEditorStore();
    const { unmount } = renderHook(() => usePersistedRecentElements(store));
    expect(store.getState().recentElements).toEqual(["Pd"]);

    store.getState().noteRecentElement("Pt");
    expect(JSON.parse(window.localStorage.getItem(RECENT_ELEMENTS_STORAGE_KEY)!)).toEqual([
      "Pt",
      "Pd",
    ]);
    unmount();
  });

  it("does not write while nothing it keeps has changed", () => {
    const store = createEditorStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { unmount } = renderHook(() => usePersistedRecentElements(store));
    store.getState().setTool("bond");
    store.getState().setToolOption("element", "N");
    expect(setItem).not.toHaveBeenCalled();
    unmount();
  });
});
