/**
 * The editor store: five slices composed into one vanilla zustand store,
 * behind the immer middleware.
 *
 * VANILLA FIRST, REACT SECOND. `createEditorStore` returns a plain store with
 * no React in it, which is what the whole test suite drives — the editor's
 * behaviour is provable in a node process with no DOM, and a store test that
 * needed jsdom would mean the store had grown a UI dependency. The React hook
 * at the bottom is a five-line adapter over the same object.
 *
 * AUTO-FREEZE IS OFF, DELIBERATELY.
 *
 * immer's default is to deep-freeze every value a recipe produces. Here that
 * would be both wasteful and wrong-headed:
 *
 * - Wasteful: the values assigned into the draft are whole molecules and
 *   documents built OUTSIDE the recipe. Freezing walks each one in full, so
 *   every pointer-move frame of a drag would traverse the entire atom record
 *   — turning chem-core's structurally-shared O(moved) edit back into O(atoms)
 *   for no benefit. With auto-freeze off, immer stores the assigned value as
 *   it is and does not descend into it at all.
 * - Wrong-headed: freezing is a mutation of an object the store did not
 *   create. A molecule handed to `openDocument` by an importer, or held by a
 *   render cache, would come back frozen from a call the caller thought was a
 *   read.
 *
 * The immutability that freezing would enforce is already guaranteed the way
 * this repo guarantees it everywhere else: chem-core values are pure and its
 * edits return new molecules, and chem-guard.ts throws the moment a draft
 * crosses the boundary in the other direction.
 */

import type { SketchDocument } from "@starter/shared";
import { createDocument } from "@starter/shared";
import { setAutoFreeze } from "immer";
import { useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createDocumentSlice } from "./slices/document";
import { createSelectionSlice } from "./slices/selection";
import { createToolSlice } from "./slices/tool";
import { createUiSlice } from "./slices/ui";
import { createViewportSlice } from "./slices/viewport";
import type { EditorState } from "./types";
import type { ViewportSize } from "./viewport";

// Module scope on purpose: immer's freeze setting is global, and a store that
// disabled it per-instance would still be at the mercy of whichever store was
// constructed last. See the header for why it is off.
setAutoFreeze(false);

export interface EditorStoreInit {
  /** The document to open with. Defaults to a fresh empty sketch. */
  readonly document?: SketchDocument | undefined;
  /** The measured canvas size, if it is already known. */
  readonly viewportSize?: ViewportSize | undefined;
  /** Injectable clock for `metadata.modifiedAt`, so tests are deterministic. */
  readonly now?: (() => string) | undefined;
}

export type EditorStore = StoreApi<EditorState>;

export function createEditorStore(init: EditorStoreInit = {}): EditorStore {
  const now = init.now ?? (() => new Date().toISOString());
  const document = init.document ?? createDocument({ now: now() });

  // The `(...a)` spread is zustand's slice pattern: each creator receives the
  // same `set`/`get`/`store` triple and contributes its own keys to one flat
  // state object, so a component selects `state.tool` without knowing which
  // file defined it.
  return createStore<EditorState>()(
    immer((...a) => ({
      ...createDocumentSlice({ document, now })(...a),
      ...createSelectionSlice()(...a),
      ...createToolSlice()(...a),
      ...createViewportSlice({ size: init.viewportSize })(...a),
      ...createUiSlice()(...a),
    })),
  );
}

/**
 * The application's store.
 *
 * A module singleton is safe HERE and would not be in a typical Next app: this
 * is a static, client-only surface (there is no server package), so the module
 * is instantiated once per browser tab and never once per request. If server
 * rendering ever arrives, this must move into a React provider — a
 * module-level store on the server is shared between users.
 */
export const editorStore: EditorStore = createEditorStore();

/**
 * React binding for the singleton. `selector` is required: subscribing to the
 * whole state re-renders every component on every pointer-move frame of a
 * drag.
 */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
