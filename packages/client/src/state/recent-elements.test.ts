/**
 * The quick picker's recent row, as the store keeps it.
 *
 * NODE ENVIRONMENT, like every test under src/state: the rule for what the
 * row holds is store logic, and it has to be provable without a DOM.
 */

import { describe, expect, it } from "vitest";

import { createEditorStore } from "./store";
import { RECENT_ELEMENT_LIMIT, withRecentElement } from "./slices/tool";

describe("withRecentElement", () => {
  it("puts the newest pick first and drops the duplicate", () => {
    expect(withRecentElement(["Pt", "Pd"], "Pd")).toEqual(["Pd", "Pt"]);
    expect(withRecentElement(["Pt"], "Fe")).toEqual(["Fe", "Pt"]);
  });

  it("keeps one row of the quick picker's grid, dropping the oldest", () => {
    let recent: readonly string[] = [];
    for (const symbol of ["Pt", "Pd", "Fe", "Cu", "Zn"]) recent = withRecentElement(recent, symbol);
    expect(recent).toHaveLength(RECENT_ELEMENT_LIMIT);
    expect(recent).toEqual(["Zn", "Cu", "Fe", "Pd"]);
  });

  it("leaves out what the quick picker already shows, and what is not an element", () => {
    const before = ["Pt"];
    // The same array back, not an equal one: nothing changed, so a subscriber
    // keyed on identity does not re-render.
    expect(withRecentElement(before, "N")).toBe(before);
    expect(withRecentElement(before, "Se")).toBe(before);
    expect(withRecentElement(before, "R")).toBe(before);
    expect(withRecentElement(before, "Pt")).toBe(before);
  });
});

describe("the tool slice's recent elements", () => {
  it("starts empty and records a pick", () => {
    const store = createEditorStore();
    expect(store.getState().recentElements).toEqual([]);
    store.getState().noteRecentElement("Pt");
    expect(store.getState().recentElements).toEqual(["Pt"]);
  });

  it("restores a stored list through the same rule a live pick obeys", () => {
    const store = createEditorStore();
    // Newest first, as stored; carbon, a duplicate and a placeholder symbol
    // are the kind of thing a stale or hand-edited entry contains.
    store.getState().setRecentElements(["Pt", "C", "Pd", "Pt", "R", "Fe", "Cu", "Zn"]);
    expect(store.getState().recentElements).toEqual(["Pt", "Pd", "Fe", "Cu"]);
  });

  it("does not notify subscribers for a pick that changes nothing", () => {
    const store = createEditorStore();
    store.getState().noteRecentElement("Pt");
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.getState().noteRecentElement("Pt");
    store.getState().noteRecentElement("C");
    store.getState().setRecentElements(["Pt"]);
    unsubscribe();
    expect(calls).toBe(0);
  });
});
