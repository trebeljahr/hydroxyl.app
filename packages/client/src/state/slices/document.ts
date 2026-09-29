/**
 * The document slice: the only place a `SketchDocument` is replaced, and the
 * only place the undo history is written.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * Every molecule and every document is computed OUTSIDE the immer recipe,
 * from `get()`, and assigned WHOLESALE into the draft. Nothing here ever
 * writes `draft.document.molecule.atoms[id].pos = ...`.
 *
 * Reaching into the draft would hand chem-core a Proxy instead of a Molecule,
 * and chem-core keys its adjacency and ring caches on the Molecule INSTANCE —
 * see the header of chem-guard.ts for what that costs and why it never
 * throws. It would also break the two things the history depends on:
 * structural sharing (an edit returns a molecule that shares every unchanged
 * atom with its predecessor, so a snapshot costs a pointer) and reference
 * identity (chem-core returns the INPUT molecule when an op changes nothing,
 * which is how a no-op edit is recognised and recorded as nothing at all).
 *
 * Consequently the pattern below is the same in every action:
 *
 *   const before = snapshot();                       // real values, never drafts
 *   const next   = computeSomethingNew(before);      // pure, outside the recipe
 *   if (next === before.document) return;            // no-op: record nothing
 *   commit(label, { document: next, selection });    // one entry, one set()
 *
 * WHAT IS UNDOABLE HERE: everything that changes the SAVED document. Not just
 * the molecule — the title, the style preset and the panel layout are all
 * part of the file, so removing a panel by accident has to be recoverable the
 * same way deleting an atom is. The viewport, the tool and the transient UI
 * are handled by other slices precisely because they are not part of the file.
 */

import type { Molecule } from "@starter/chem-core";
import { pruneSchemeAnnotations } from "@starter/chem-render";
import {
  DISPLAY_FLAG_KEYS,
  createPanel,
  pruneLocants,
  setAtomLocant as withAtomLocant,
  touchDocument,
  withFigureLayout,
  withLocants,
  type DisplayFlagKey,
  type Panel,
  type Representation,
  type RepresentationDisplay,
  type SketchDocument,
} from "@starter/shared";
import { castDraft } from "immer";
import { assertNotDraft } from "../chem-guard";
import { mintStartupIdentity } from "../startup-document";
import {
  abortTransaction as historyAbort,
  beginTransaction as historyBegin,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commitTransaction as historyCommit,
  createHistory,
  record as historyRecord,
  redo as historyRedo,
  rewriteHistory as historyRewrite,
  redoLabel as historyRedoLabel,
  undo as historyUndo,
  undoLabel as historyUndoLabel,
  type EqualFn,
  type History,
} from "../history";
import type {
  DocumentSlice,
  EditorSliceCreator,
  PanelPatch,
  UndoableState,
} from "../types";
import { EMPTY_SELECTION, pruneSelection } from "./selection";

/**
 * Reference equality per field, which is exactly right here and would be
 * wrong almost anywhere else: chem-core values are immutable and its ops
 * return the input on a no-op, and the selection slice returns the current
 * selection by reference when nothing changed. Two states that are `===` in
 * both fields therefore genuinely describe the same drawing, and a deep
 * comparison would only pay to discover that on every keystroke of a drag.
 */
const undoableEqual: EqualFn<UndoableState> = (a, b) =>
  a.document === b.document && a.selection === b.selection;

/**
 * The predicate a TRANSACTION commits with, and deliberately not
 * `undoableEqual`: it ignores the selection entirely.
 *
 * A canvas gesture opens its transaction on pointerdown and selects the atom
 * under the cursor there, because a click and a drag are indistinguishable
 * until the pointer moves. Comparing the selection too would therefore make a
 * plain click on an atom push an undo entry — the next Ctrl+Z would deselect
 * instead of reverting the last chemical edit, which is precisely what the
 * "selection is never its own undo step" rule exists to prevent, and what the
 * untransacted path already gets right by never calling `record` at all.
 *
 * The entry that a real edit pushes still carries the base SELECTION (the
 * whole `UndoableState` is the snapshot), so undoing an edit restores what was
 * selected when the gesture began.
 */
const documentEqual: EqualFn<UndoableState> = (a, b) => a.document === b.document;

/**
 * The same drawing, give or take `modifiedAt` — and the selection, which is
 * never its own undo step (see `documentEqual`).
 *
 * Driven by the keys rather than written out, so a document-level field added
 * later is compared automatically instead of being ignored.
 */
function sameApartFromModifiedAt(a: SketchDocument, b: SketchDocument): boolean {
  if (a === b) return true;
  const shallowEqual = (x: object, y: object, skip: string): boolean => {
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    return keys.every(
      (key) =>
        key === skip ||
        (Object.hasOwn(y, key) &&
          (x as Record<string, unknown>)[key] === (y as Record<string, unknown>)[key]),
    );
  };
  return shallowEqual(a, b, "metadata") && shallowEqual(a.metadata, b.metadata, "modifiedAt");
}

// ---------------------------------------------------------------------------
// Panel helpers
//
// Panels are rebuilt field by field rather than spread, for the same reason
// @starter/shared assembles them by hand: `caption` must be an ABSENT key when
// there is none, never a key holding `undefined`. A document that carries
// `{ caption: undefined }` stops being deep-equal to its own round trip, and
// the undo entry that should have been a no-op becomes a step.
// ---------------------------------------------------------------------------

function displayEqual(
  a: RepresentationDisplay,
  b: RepresentationDisplay,
): boolean {
  // Driven by the key list rather than written out, so a flag added to
  // chem-render is compared here automatically. A forgotten comparison would
  // make a real toggle look like a no-op and be dropped by `patchPanel`.
  return DISPLAY_FLAG_KEYS.every((key) => a[key] === b[key]);
}

/** Written out key by key instead of `{ ...base, ...patch }` because a spread
 *  of a `Partial` copies keys that are present with the value `undefined`,
 *  which is how a flag would silently become "not a boolean". `??`, not `||`:
 *  `false` is a legitimate patch value. */
function mergeDisplay(
  base: RepresentationDisplay,
  patch: Partial<RepresentationDisplay> | undefined,
): RepresentationDisplay {
  if (!patch) return base;
  const merged = {} as { -readonly [K in DisplayFlagKey]: boolean };
  for (const key of DISPLAY_FLAG_KEYS) merged[key] = patch[key] ?? base[key];
  return merged;
}

/**
 * Applies a patch to one panel, returning the SAME panel when nothing moved.
 *
 * A kind change KEEPS the display flags. They are stored per panel so that
 * flipping between skeletal and Kekule and back does not lose the "show lone
 * pairs" the chemist turned on — see the note on `RepresentationDisplay` in
 * @starter/shared.
 */
function patchPanel(panel: Panel, patch: PanelPatch): Panel {
  const kind = patch.kind ?? panel.representation.kind;
  const display = mergeDisplay(panel.representation.display, patch.display);
  if (
    kind === panel.representation.kind &&
    displayEqual(display, panel.representation.display)
  ) {
    return panel;
  }
  const representation: Representation = { kind, display };
  const next: { -readonly [K in keyof Panel]: Panel[K] } = {
    id: panel.id,
    representation,
  };
  if (panel.caption !== undefined) next.caption = panel.caption;
  return next;
}

function panelWithCaption(panel: Panel, caption: string | null): Panel {
  if (caption === null ? panel.caption === undefined : panel.caption === caption) {
    return panel;
  }
  const next: { -readonly [K in keyof Panel]: Panel[K] } = {
    id: panel.id,
    representation: panel.representation,
  };
  // Omitted, not assigned `undefined` — see the section header.
  if (caption !== null) next.caption = caption;
  return next;
}

export interface DocumentSliceOptions {
  /** The document the editor opens with. */
  readonly document: SketchDocument;
  /** Injectable clock, so a test can assert on `modifiedAt` without racing
   *  the wall. */
  readonly now: () => string;
  /** Undo depth; defaults to the history module's own limit. */
  readonly historyLimit?: number | undefined;
}

export function createDocumentSlice(
  options: DocumentSliceOptions,
): EditorSliceCreator<DocumentSlice> {
  // At construction, not at first use: a store opened on a draft would hand
  // that proxy to chem-core on the very first edit, and the failure would
  // surface as a cache that never hits rather than as an error. `openDocument`
  // makes the same check on every later document; this covers the first one.
  assertNotDraft(options.document, "createEditorStore(document)");
  assertNotDraft(options.document.molecule, "createEditorStore(molecule)");

  return (set, get) => {
    /**
     * The undoable half of the current state.
     *
     * `get()` ALWAYS returns finalised state, recipe or no recipe: zustand
     * hands immer's curried producer to the vanilla `setState`, which only
     * reassigns the state once the producer has returned, so a `get()` from
     * inside a recipe sees the previous state rather than the draft. (That
     * also means calling an action from inside a `set` recipe is a LOST
     * UPDATE, not a draft leak — the inner action's write lands first and the
     * outer producer's result then overwrites it, silently. Nothing here does
     * that, and every recipe in this store is a wholesale assignment that
     * calls nothing, which is the property that keeps it true.)
     *
     * The assertion is therefore not about recipes. It catches a draft that
     * entered the state from OUTSIDE — through `createEditorStore({ document })`
     * or a raw `store.setState` — before it can be handed to chem-core and
     * quietly defeat its instance-keyed caches. `createDocumentSlice` checks
     * the initial document eagerly for the same reason; this is the net under
     * everything else.
     */
    const snapshot = (): UndoableState => {
      const state = get();
      assertNotDraft(state.document, "snapshot(document)");
      return { document: state.document, selection: state.selection };
    };

    /**
     * The single write path for undoable state: record the step, then assign
     * the finished values into the draft in one `set` so subscribers see the
     * document, the selection and the history move together.
     *
     * `record` is a no-op while a transaction is in flight, which is the whole
     * mechanism behind "a 30-frame drag is one undo step".
     */
    const commit = (label: string, next: UndoableState): void => {
      const before = snapshot();
      if (undoableEqual(before, next)) return;
      // THE FIRST EDIT IS WHERE THE STARTUP DOCUMENT STOPS BEING A
      // PLACEHOLDER. Its id is a fixed string so the prerender and the browser
      // render the same `data-doc-id`, and that string is the same in every
      // visitor's browser — so it may never reach storage. Minting it here
      // makes the mint part of the very edit that gives the document a reason
      // to exist: one `set`, one undo entry, and nothing downstream ever sees
      // the reserved id on a document worth saving. See
      // `../startup-document`.
      //
      // `next`, not `before`: `openDocument` arrives with a document of its
      // own and must keep it, while every edit path rebuilds `before.document`
      // and carries the id along.
      const identified: UndoableState = {
        document: mintStartupIdentity(next.document, options.now()),
        selection: next.selection,
      };
      const history = historyRecord(
        get().history,
        label,
        before,
        identified,
        undoableEqual,
      );
      set((draft) => {
        draft.document = castDraft(identified.document);
        draft.selection = castDraft(identified.selection);
        draft.history = castDraft(history);
      });
    };

    /** Undo, redo and abort all restore a snapshot verbatim, without pushing
     *  an entry of their own. */
    const restore = (
      next: UndoableState,
      history: History<UndoableState>,
    ): void => {
      set((draft) => {
        draft.document = castDraft(next.document);
        draft.selection = castDraft(next.selection);
        draft.history = castDraft(history);
      });
    };

    /** Every document-level edit funnels through here so that `modifiedAt` is
     *  stamped in exactly one place. */
    const commitDocument = (label: string, document: SketchDocument): void => {
      const before = snapshot();
      if (document === before.document) return;
      commit(label, {
        document: touchDocument(document, options.now()),
        selection: before.selection,
      });
    };

    const commitPanels = (
      label: string,
      panels: readonly Panel[],
    ): void => {
      const before = snapshot();
      commitDocument(label, { ...before.document, panels });
    };

    return {
      document: options.document,
      history: createHistory<UndoableState>(options.historyLimit),

      /**
       * Replacing the document is UNDOABLE, deliberately.
       *
       * This store holds one document, so opening a dropped .mol file
       * overwrites whatever was on the canvas. Without an entry, a mis-drop
       * onto an unsaved sketch would destroy it with no way back — and the
       * entry is nearly free, because the outgoing document is a value that
       * already exists. When the multi-document shell lands (a later task)
       * opening a file will make a new document instead, and this action
       * becomes the "revert to saved" path rather than the import path.
       *
       * The selection is cleared in the same entry: its ids name atoms of the
       * outgoing molecule and mean nothing in the incoming one.
       */
      openDocument(document, label = "Open document") {
        const before = snapshot();
        if (document === before.document) return;
        assertNotDraft(document.molecule, "openDocument");
        commit(label, { document, selection: EMPTY_SELECTION });
      },

      /**
       * The restore path. Wholesale assignment, no history entry, fresh
       * history — see the note on `DocumentSlice.loadDocument`.
       *
       * `restore` is reused deliberately: it is already the "assign a
       * snapshot verbatim and push nothing" primitive that undo, redo and
       * abort share, and a second one would be a second place for the
       * document and the selection to get out of step.
       */
      loadDocument(document) {
        assertNotDraft(document, "loadDocument");
        assertNotDraft(document.molecule, "loadDocument(molecule)");
        restore(
          { document, selection: EMPTY_SELECTION },
          createHistory<UndoableState>(options.historyLimit),
        );
      },

      applyMoleculeEdit(label, edit) {
        const before = snapshot();
        // OUTSIDE the recipe, against the real molecule. The guarded facade in
        // chem-guard.ts asserts the same thing from the other side.
        const molecule: Molecule = edit(before.document.molecule);
        assertNotDraft(molecule, `applyMoleculeEdit(${label})`);
        // chem-core returns the input when an op changes nothing — clicking an
        // atom that is already carbon, a drag that has not crossed a pixel.
        // Recording that would be an undo step with nothing to see.
        if (molecule === before.document.molecule) return;

        // Annotations whose anchors the edit removed go in the SAME entry, and
        // a species reference whose atom went but whose species survived is
        // re-pointed (decision 103) — so undo brings atoms and arrows back
        // together, and no saved document ever holds a dangling reference.
        // The same array comes back when nothing it names was touched.
        const annotations = pruneSchemeAnnotations(
          before.document.annotations,
          before.document.molecule,
          molecule,
        );
        // Explicit locants of deleted atoms go in the same entry for the same
        // reason (decision 142): a saved document never names an atom it does
        // not hold. The same map comes back when no numbered atom went.
        const locants = pruneLocants(before.document.locants, molecule);
        const edited: SketchDocument = { ...before.document, molecule, annotations };
        commit(label, {
          document: touchDocument(
            locants === before.document.locants ? edited : withLocants(edited, locants ?? null),
            options.now(),
          ),
          // In the SAME entry as the edit, so undoing a deletion brings the
          // atoms and the selection back together.
          selection: pruneSelection(before.selection, molecule, annotations),
        });
      },

      setStylePreset(preset) {
        const before = get().document;
        if (before.stylePreset === preset) return;
        commitDocument("Change style preset", {
          ...before,
          stylePreset: preset,
        });
      },

      setDocumentTitle(title) {
        const before = get().document;
        if (before.metadata.title === title) return;
        commitDocument("Rename document", {
          ...before,
          metadata: { ...before.metadata, title },
        });
      },

      adoptDocumentTitle(title) {
        const before = snapshot();
        if (before.document.metadata.title === title) return;
        // One retitled document per original, so snapshots that shared a
        // document still share one: a transaction whose gesture has not moved
        // anything must still commit as a no-op.
        const retitled = new Map<SketchDocument, SketchDocument>();
        const rewrite = (state: UndoableState): UndoableState => {
          const document = state.document;
          if (document.metadata.title === title) return state;
          let next = retitled.get(document);
          if (next === undefined) {
            next = { ...document, metadata: { ...document.metadata, title } };
            retitled.set(document, next);
          }
          return { document: next, selection: state.selection };
        };
        const { history, current } = historyRewrite(
          get().history,
          before,
          rewrite,
          (a, b) => sameApartFromModifiedAt(a.document, b.document),
        );
        set((draft) => {
          draft.document = castDraft(current.document);
          // The selection is NOT assigned: it did not change, and it stays the
          // same reference for the history's reference equality.
          draft.history = castDraft(history);
        });
      },

      addPanel(kind, caption) {
        const panel = createPanel(kind, caption);
        commitPanels("Add panel", [...get().document.panels, panel]);
        return panel.id;
      },

      removePanel(id) {
        const panels = get().document.panels;
        const next = panels.filter((panel) => panel.id !== id);
        if (next.length === panels.length) return;
        commitPanels("Remove panel", next);
      },

      updatePanel(id, patch) {
        const panels = get().document.panels;
        let changed = false;
        const next = panels.map((panel) => {
          if (panel.id !== id) return panel;
          const patched = patchPanel(panel, patch);
          if (patched !== panel) changed = true;
          return patched;
        });
        if (!changed) return;
        commitPanels("Change representation", next);
      },

      setPanelCaption(id, caption) {
        const panels = get().document.panels;
        let changed = false;
        const next = panels.map((panel) => {
          if (panel.id !== id) return panel;
          const patched = panelWithCaption(panel, caption);
          if (patched !== panel) changed = true;
          return patched;
        });
        if (!changed) return;
        commitPanels(caption === null ? "Remove caption" : "Edit caption", next);
      },

      reorderPanels(order) {
        const panels = get().document.panels;
        const byId = new Map(panels.map((panel) => [panel.id, panel]));
        // A permutation or nothing. A drag-reorder always hands over the full
        // list; a shorter one is a caller bug, and honouring it would delete
        // the panels it forgot to mention.
        if (order.length !== panels.length) return;
        const next: Panel[] = [];
        for (const id of order) {
          const panel = byId.get(id);
          if (!panel) return;
          byId.delete(id);
          next.push(panel);
        }
        if (next.every((panel, i) => panel === panels[i])) return;
        commitPanels("Reorder panels", next);
      },

      movePanel(id, delta) {
        const panels = get().document.panels;
        const from = panels.findIndex((panel) => panel.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= panels.length) return;
        const order = panels.map((panel) => panel.id);
        order[from] = order[to]!;
        order[to] = id;
        get().reorderPanels(order);
      },

      setFigureColumns(columns) {
        const before = get().document;
        const next = withFigureLayout(before, columns === null ? null : { columns });
        if ((next.figure?.columns ?? null) === (before.figure?.columns ?? null)) return;
        commitDocument(columns === null ? "Reset figure columns" : "Set figure columns", next);
      },

      setAtomLocant(atomId, locant) {
        const before = get().document;
        if (!Object.hasOwn(before.molecule.atoms, atomId)) return;
        const label =
          locant === undefined ? "Clear locant" : locant === "" ? "Hide locant" : "Set locant";
        commitDocument(label, withAtomLocant(before, atomId, locant));
      },

      beginTransaction(label) {
        const history = historyBegin(get().history, label, snapshot());
        set((draft) => {
          draft.history = castDraft(history);
        });
      },

      commitTransaction() {
        const history = historyCommit(
          get().history,
          snapshot(),
          // Document-only: see the note on `documentEqual`.
          documentEqual,
        );
        set((draft) => {
          draft.history = castDraft(history);
        });
      },

      abortTransaction() {
        const { history, state } = historyAbort(get().history);
        // `state` is null when nothing was in flight; there is then nothing to
        // restore and the history is already the one we hold.
        if (!state) return;
        restore(state, history);
      },

      transact(label, fn) {
        // Does THIS call open the gesture, or join one already in flight?
        // `abortTransaction` unwinds every nesting level by design, so a
        // nested `transact` — the "Delete selection" an action performs inside
        // the user's "Draw ring" — must not be allowed to reach for it. If it
        // did, a caller that caught the inner failure and carried on would
        // find the outer transaction gone: its edits so far silently rolled
        // back, and every remaining pointer-move frame recording an entry of
        // its own, which is the thirty-entry drag transactions exist to
        // prevent.
        const outermost = get().history.transaction === null;
        get().beginTransaction(label);
        try {
          fn();
        } catch (error) {
          if (outermost) {
            // We own the gesture and it failed, so the base is the only state
            // known to be consistent.
            get().abortTransaction();
          } else {
            // Unwind only our own level. `commitTransaction` above depth 0
            // decrements and pushes nothing, so the outer transaction keeps
            // its base and its label and stays in flight; whether the failure
            // ends the gesture is the outer level's decision to make.
            get().commitTransaction();
          }
          // Rethrow either way: swallowing it would leave the caller believing
          // a half-applied edit succeeded.
          throw error;
        }
        get().commitTransaction();
      },

      undo() {
        const result = historyUndo(get().history, snapshot());
        if (!result) return false;
        restore(result.state, result.history);
        return true;
      },

      redo() {
        const result = historyRedo(get().history, snapshot());
        if (!result) return false;
        restore(result.state, result.history);
        return true;
      },

      canUndo() {
        return historyCanUndo(get().history);
      },

      canRedo() {
        return historyCanRedo(get().history);
      },

      undoLabel() {
        return historyUndoLabel(get().history);
      },

      redoLabel() {
        return historyRedoLabel(get().history);
      },
    };
  };
}
