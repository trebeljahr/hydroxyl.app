/**
 * The tool slice: which instrument the pointer is holding, and its settings.
 *
 * NOT UNDOABLE. Picking up the eraser is not an edit, and an undo that put
 * the bond tool back instead of restoring the bond you just erased would be
 * indistinguishable from a bug.
 *
 * TOOLS ARE STICKY. A chosen tool stays chosen until another is picked —
 * drawing a bond leaves you holding the bond tool, so a skeleton is drawn in
 * one uninterrupted run of clicks. ChemDraw, MarvinSketch and Inkscape all
 * behave this way; a tool that sprang back to `select` after each stroke
 * would make every second click a mode error. Nothing in this store resets
 * `tool` after an edit, and that absence IS the feature.
 *
 * Escape is the one way back, and it clears the whole transient mode at once:
 * tool, the half-typed element, and the command palette.
 */

import { castDraft } from "immer";
import { COMMON_ORGANIC_ELEMENTS, isKnownElement } from "@starter/chem-core";
import type { ElementSymbol } from "@starter/chem-core";

import type { EditorSliceCreator, ToolOptions, ToolSlice } from "../types";

/**
 * Carbon, a single bond and benzene: the defaults are what an organic chemist
 * draws most of, so the common case needs no setup. Benzene rather than
 * cyclohexane for exactly that reason — an arene is the ring that turns up in
 * most papers, and the saturated ring is one click away in the template
 * popover. `chargeDelta` is +1 because the charge tool's plain click adds a
 * proton's worth and the modifier subtracts.
 */
export const DEFAULT_TOOL_OPTIONS: ToolOptions = Object.freeze({
  bondOrder: 1,
  bondStereo: "none",
  element: "C",
  ringTemplate: "benzene",
  chainLength: 4,
  chargeDelta: 1,
});

/** One row of the quick picker's four-column grid. */
export const RECENT_ELEMENT_LIMIT = 4;

/**
 * The recent list after `symbol` is chosen: moved to the front, deduplicated,
 * capped at one row.
 *
 * AN ELEMENT THE QUICK PICKER ALREADY SHOWS IS LEFT OUT. The list exists to
 * put an element from the full table one click away; pinning carbon beside
 * carbon would spend a slot on nothing and push out the platinum it is for.
 * An unknown symbol is left out too — the list is restored from storage, and a
 * stale or hand-edited entry must not become a button that places nonsense.
 */
export function withRecentElement(
  recent: readonly ElementSymbol[],
  symbol: ElementSymbol,
): readonly ElementSymbol[] {
  if (COMMON_ORGANIC_ELEMENTS.includes(symbol) || !isKnownElement(symbol)) {
    return recent;
  }
  if (recent[0] === symbol) return recent;
  return [symbol, ...recent.filter((entry) => entry !== symbol)].slice(
    0,
    RECENT_ELEMENT_LIMIT,
  );
}

export interface ToolSliceOptions {
  readonly tool?: ToolSlice["tool"] | undefined;
  readonly toolOptions?: ToolOptions | undefined;
}

export function createToolSlice(
  options: ToolSliceOptions = {},
): EditorSliceCreator<ToolSlice> {
  return (set, get) => ({
    tool: options.tool ?? "select",
    toolOptions: options.toolOptions ?? DEFAULT_TOOL_OPTIONS,
    recentElements: [],

    setTool(id) {
      if (get().tool === id) return;
      set((draft) => {
        draft.tool = id;
      });
    },

    escape() {
      const state = get();
      if (
        state.tool === "select" &&
        state.ui.elementInputBuffer === "" &&
        !state.ui.commandPaletteOpen
      ) {
        return;
      }
      // One `set` rather than three actions, so a subscriber never observes an
      // intermediate state where the palette is closed but the tool has not
      // reverted yet. Reaching into another slice's state is fine here — they
      // are separate interfaces over ONE store, and Escape means one thing.
      set((draft) => {
        draft.tool = "select";
        draft.ui.elementInputBuffer = "";
        draft.ui.commandPaletteOpen = false;
      });
    },

    setToolOption(key, value) {
      const current = get().toolOptions;
      if (current[key] === value) return;
      // Copied and written by key rather than spread with a computed property:
      // `{ ...current, [key]: value }` widens to an index signature under a
      // generic key and stops being a `ToolOptions`.
      const next: { -readonly [P in keyof ToolOptions]: ToolOptions[P] } = {
        ...current,
      };
      next[key] = value;
      set((draft) => {
        draft.toolOptions = castDraft(next as ToolOptions);
      });
    },

    noteRecentElement(symbol) {
      const current = get().recentElements;
      const next = withRecentElement(current, symbol);
      if (next === current) return;
      set((draft) => {
        draft.recentElements = castDraft(next);
      });
    },

    setRecentElements(symbols) {
      // Folded through the same rule rather than assigned, oldest first so
      // the newest ends up in front: a restored list obeys the cap, the
      // dedupe and the organic-set exclusion exactly as a live one does.
      let next: readonly ElementSymbol[] = [];
      for (let i = symbols.length - 1; i >= 0; i--) {
        next = withRecentElement(next, symbols[i]!);
      }
      const current = get().recentElements;
      if (next.length === current.length && next.every((s, i) => s === current[i])) {
        return;
      }
      set((draft) => {
        draft.recentElements = castDraft(next);
      });
    },
  });
}
