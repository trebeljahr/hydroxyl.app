/**
 * The viewport slice: a thin store wrapper over the pure maths in
 * ../viewport.ts.
 *
 * NOT UNDOABLE, AND NOT IN `UndoableState`. Ctrl+Z after panning must undo
 * the last chemical edit, not the pan — undo is for the drawing, not for
 * where you were standing when you made it. The practical consequence is
 * visible in the tests: an undo restores the document and leaves the viewport
 * exactly where the user left it, so the canvas does not jump under the
 * cursor when a mistake is taken back.
 *
 * Every action delegates to the pure function and assigns the result
 * wholesale, and every pure function returns its input by reference when
 * nothing changed — so a wheel event at the zoom limit, or a pointer-move
 * that has not crossed a pixel, notifies no subscriber at all.
 */

import { castDraft } from "immer";
import type { EditorSliceCreator, ViewportSlice } from "../types";
import {
  createViewport,
  panBy as vpPanBy,
  setViewportSize as vpSetViewportSize,
  setZoom as vpSetZoom,
  zoomAt as vpZoomAt,
  zoomToFit as vpZoomToFit,
  type Viewport,
  type ViewportSize,
} from "../viewport";

export interface ViewportSliceOptions {
  readonly size?: ViewportSize | undefined;
}

export function createViewportSlice(
  options: ViewportSliceOptions = {},
): EditorSliceCreator<ViewportSlice> {
  return (set, get) => {
    const apply = (next: Viewport): void => {
      if (next === get().viewport) return;
      set((draft) => {
        draft.viewport = castDraft(next);
      });
    };

    return {
      viewport: createViewport(options.size),

      panBy(deltaScreen) {
        // The pure function moves the VIEWPORT by this delta, so a grab-drag
        // handler passes the negated pointer delta. That negation belongs to
        // the gesture, not here — see ../viewport.ts.
        apply(vpPanBy(get().viewport, deltaScreen));
      },

      zoomAt(screenAnchor, factor) {
        apply(vpZoomAt(get().viewport, screenAnchor, factor));
      },

      setZoom(zoom) {
        apply(vpSetZoom(get().viewport, zoom));
      },

      setViewportSize(size) {
        apply(vpSetViewportSize(get().viewport, size));
      },

      zoomToFit(bounds, margin) {
        // Bounds arrive in px from the renderer. The store cannot compute them
        // itself: turning model units into pixels is `RenderStyle`'s job over
        // in chem-render, and duplicating the scale here would let the two
        // disagree the first time a style preset changed the bond length.
        apply(vpZoomToFit(get().viewport, bounds, margin));
      },

      resetViewport() {
        const current = get().viewport;
        if (current.pan.x === 0 && current.pan.y === 0 && current.zoom === 1) {
          return;
        }
        // The measured size is kept: a reset means "back to 100% at the
        // origin", not "forget how big the canvas is" — dropping the size
        // would blank the view until the next ResizeObserver callback.
        apply(createViewport(current.size));
      },
    };
  };
}
