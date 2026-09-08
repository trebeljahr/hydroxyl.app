/**
 * The transient UI slice: hover, the command palette, one status line, and
 * the keystrokes typed at the canvas before they resolve to an element.
 *
 * NOT UNDOABLE, and none of it is saved. All of it describes the moment
 * rather than the drawing.
 *
 * `UiState` is the one part of the store that is a plain nested record with
 * no immutable value semantics of its own, so it is also the one part these
 * slices edit THROUGH THE DRAFT — `draft.ui.hoveredAtomId = id`. That is safe
 * here for the reason it is forbidden for molecules: nothing outside the
 * store holds a reference to a `UiState`, no cache is keyed on its identity,
 * and no chem-core function ever sees it. Every setter still guards against a
 * write that changes nothing, because hover fires on every pointer-move frame
 * and re-rendering the canvas for an unchanged id is the easiest performance
 * bug in the app to introduce.
 */

import type { EditorSliceCreator, UiSlice, UiState } from "../types";

export const INITIAL_UI_STATE: UiState = Object.freeze({
  hoveredAtomId: null,
  hoveredBondId: null,
  focusedAtomId: null,
  previousFocusedAtomId: null,
  commandPaletteOpen: false,
  statusMessage: null,
  elementInputBuffer: "",
});

export interface UiSliceOptions {
  readonly ui?: UiState | undefined;
}

export function createUiSlice(
  options: UiSliceOptions = {},
): EditorSliceCreator<UiSlice> {
  return (set, get) => ({
    ui: options.ui ?? INITIAL_UI_STATE,

    setHoveredAtom(id) {
      if (get().ui.hoveredAtomId === id) return;
      set((draft) => {
        draft.ui.hoveredAtomId = id;
      });
    },

    setHoveredBond(id) {
      if (get().ui.hoveredBondId === id) return;
      set((draft) => {
        draft.ui.hoveredBondId = id;
      });
    },

    setFocusedAtom(id) {
      const current = get().ui.focusedAtomId;
      if (current === id) return;
      set((draft) => {
        // The atom being left becomes "previous" in the same `set`, so no
        // subscriber ever sees a focus that has moved with a stale history
        // behind it.
        draft.ui.previousFocusedAtomId = current;
        draft.ui.focusedAtomId = id;
      });
    },

    setStatusMessage(message) {
      if (get().ui.statusMessage === message) return;
      set((draft) => {
        draft.ui.statusMessage = message;
      });
    },

    setCommandPaletteOpen(open) {
      if (get().ui.commandPaletteOpen === open) return;
      set((draft) => {
        draft.ui.commandPaletteOpen = open;
      });
    },

    toggleCommandPalette() {
      const open = !get().ui.commandPaletteOpen;
      set((draft) => {
        draft.ui.commandPaletteOpen = open;
      });
    },

    setElementInputBuffer(buffer) {
      if (get().ui.elementInputBuffer === buffer) return;
      set((draft) => {
        draft.ui.elementInputBuffer = buffer;
      });
    },

    clearElementInputBuffer() {
      if (get().ui.elementInputBuffer === "") return;
      set((draft) => {
        draft.ui.elementInputBuffer = "";
      });
    },
  });
}
