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
 * The identity of the document the singleton store holds BEFORE a page has
 * opened one.
 *
 * ── THIS CONSTANT IS A HYDRATION FIX, NOT TIDINESS ─────────────────────────
 *
 * `createDocument()` mints its id from `Date.now()` and `Math.random()`, and
 * `TopBar` renders `state.document.id` into `data-doc-id`. The store below is
 * a module singleton, so it is constructed ONCE PER MODULE INSTANCE — and
 * there are always two: the prerender's and the browser's. Each minted its own
 * id, so the two never agreed and every load of `/editor` reported
 *
 *     + data-doc-id="doc_mue9v6v1_1_hnb6s68v"
 *     - data-doc-id="doc_mue9v6pk_1_pts6ksvh"
 *
 * — React's own first two bullets ("a server/client branch", "variable input
 * such as Date.now() or Math.random()") in one attribute. It is NOT a dev-only
 * symptom: `/editor` is prerendered, so the id in the shipped HTML is whatever
 * `next build` happened to mint, frozen at build time, and every visitor's
 * browser disagrees with it. React does not patch a mismatched attribute up,
 * so the served DOM keeps the build's id until something re-renders.
 *
 * A FIXED IDENTITY IS THE FIX, and it is only safe for as long as the id stays
 * a RENDERING CONSTANT — a string two module instances can agree on — and
 * never becomes a document identity. It is the same string in every tab and in
 * every visitor's browser, so a record stored under it belongs to nobody:
 * `/editor?doc=doc_startup` would name a different sketch on every machine,
 * and two tabs on one machine would overwrite each other.
 *
 * An earlier version of this comment claimed the placeholder could not reach
 * storage because `/editor`'s mount effect always opens something else. That
 * was wrong, and measured wrong: opening the fixture is an UNDOABLE entry by
 * design (see `DocumentSlice.openDocument`), so one Ctrl+Z after the editor
 * mounts puts the placeholder back on the canvas, and the next stroke autosaves
 * it. Twelve atoms drawn that way were stored under `doc_startup`, and
 * reopening the resulting recents card showed an empty canvas — the
 * `state.document.id === savedId` shortcut in `/editor`'s effect matched,
 * because every fresh store already holds that id, so nothing was read back.
 *
 * `claimStartupDocument` is what keeps the constant a constant: `/editor`
 * calls it as the first thing it does after hydration, and from that moment
 * the tab holds a document with a minted id like any other.
 *
 * The epoch timestamp is deliberate rather than arbitrary: until the mint it
 * is the one value on screen that must not vary between the prerender and the
 * browser, and a placeholder has no honest creation time to report.
 */
export const STARTUP_DOCUMENT_ID = "doc_startup";
const STARTUP_DOCUMENT_TIME = "1970-01-01T00:00:00.000Z";

/** The placeholder document the singleton opens with. Deterministic, and the
 *  reason is `STARTUP_DOCUMENT_ID`'s. */
export function startupDocument(): SketchDocument {
  return createDocument({ id: STARTUP_DOCUMENT_ID, now: STARTUP_DOCUMENT_TIME });
}

/**
 * Turn the prerender placeholder into a document of this tab's own, and answer
 * whether there was one to turn.
 *
 * CALLED ONCE, FROM THE MOUNT EFFECT, BEFORE ANYTHING PERSISTS. Hydration is
 * over by then, so minting is free again; everything downstream — autosave,
 * the journal, `?doc=`, the recents grid — then sees an ordinary document with
 * an id no other browser can produce. See `STARTUP_DOCUMENT_ID` for what goes
 * wrong when the shared string reaches storage.
 *
 * The CONTENT is carried over rather than rebuilt. The placeholder is empty
 * today, but a future startup document that was not would otherwise be
 * silently discarded here; only the identity and the timestamps change, and
 * they change together because a document minted now was not created in 1970.
 *
 * `loadDocument` rather than `openDocument`: this is not an edit anyone should
 * be able to undo back INTO, which is the trap the fixed id fell into.
 * `loadDocument` resets the history, which at mount is empty anyway.
 */
export function claimStartupDocument(store: EditorStore = editorStore): boolean {
  const state = store.getState();
  const placeholder = state.document;
  if (placeholder.id !== STARTUP_DOCUMENT_ID) return false;
  // The id comes from a throwaway `createDocument` because minting one is
  // `@starter/shared`'s job and it exposes no other way to ask for one.
  const now = new Date().toISOString();
  const minted = createDocument({ now });
  state.loadDocument({
    ...placeholder,
    id: minted.id,
    metadata: { ...placeholder.metadata, createdAt: now, modifiedAt: now },
  });
  return true;
}

/**
 * The application's store.
 *
 * A module singleton is safe HERE and would not be in a typical Next app: this
 * is a static, client-only surface (there is no server package), so the module
 * is instantiated once per browser tab and never once per request. If server
 * rendering ever arrives, this must move into a React provider — a
 * module-level store on the server is shared between users.
 *
 * It is not, however, instantiated only once per tab: the PRERENDER evaluates
 * this module too, which is why the document it opens with has a fixed
 * identity rather than a minted one.
 */
export const editorStore: EditorStore = createEditorStore({ document: startupDocument() });

/**
 * React binding for the singleton. `selector` is required: subscribing to the
 * whole state re-renders every component on every pointer-move frame of a
 * drag.
 */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
