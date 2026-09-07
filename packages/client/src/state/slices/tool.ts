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
  });
}
