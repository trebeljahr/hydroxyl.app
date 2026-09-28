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

import { castDraft } from "immer";

import type { EditorSliceCreator, UiSlice, UiState } from "../types";

export const INITIAL_UI_STATE: UiState = Object.freeze({
  hoveredAtomId: null,
  hoveredBondId: null,
  focusedAtomId: null,
  previousFocusedAtomId: null,
  commandPaletteOpen: false,
  statusMessage: null,
  elementInputBuffer: "",
  activePanelId: null,
  exportDialogOpen: false,
  periodicTableOpen: false,
  figureExport: Object.freeze({ width: "single", customWidthCm: 12, dpi: 300, style: "publication" }),
  refusal: null,
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

    setActivePanel(id) {
      if (get().ui.activePanelId === id) return;
      set((draft) => {
        draft.ui.activePanelId = id;
      });
    },

    setExportDialogOpen(open) {
      if (get().ui.exportDialogOpen === open) return;
      set((draft) => {
        draft.ui.exportDialogOpen = open;
      });
    },

    setPeriodicTableOpen(open) {
      if (get().ui.periodicTableOpen === open) return;
      set((draft) => {
        draft.ui.periodicTableOpen = open;
      });
    },

    setFigureExport(patch) {
      const current = get().ui.figureExport;
      const next = { ...current };
      if (patch.width !== undefined) next.width = patch.width;
      if (patch.dpi !== undefined) next.dpi = patch.dpi;
      if (patch.style !== undefined) next.style = patch.style;
      if (patch.customWidthCm !== undefined && Number.isFinite(patch.customWidthCm)) {
        next.customWidthCm = patch.customWidthCm;
      }
      if (
        next.width === current.width &&
        next.dpi === current.dpi &&
        next.style === current.style &&
        next.customWidthCm === current.customWidthCm
      ) {
        return;
      }
      set((draft) => {
        draft.ui.figureExport = next;
      });
    },

    clearElementInputBuffer() {
      if (get().ui.elementInputBuffer === "") return;
      set((draft) => {
        draft.ui.elementInputBuffer = "";
      });
    },

    setRefusal(refusal) {
      if (get().ui.refusal === refusal) return;
      set((draft) => {
        draft.ui.refusal = castDraft(refusal);
      });
    },
  });
}
