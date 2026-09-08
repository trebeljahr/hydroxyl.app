/**
 * Autosave, driven by the undo history rather than by a timer over the
 * document.
 *
 * ── THE OBVIOUS PREDICATE IS WRONG, AND MEASURABLY SO ──────────────────────
 *
 * "Save when the document changes and no transaction is open" sounds like
 * `s.document !== prev.document && s.history.transaction === null`, and that
 * NEVER FIRES at the end of a drag. During a gesture `applyMoleculeEdit` still
 * runs a full `set()` on every pointer-move frame — only `historyRecord` is
 * suppressed while a transaction is in flight — so the document reference
 * changes sixty times a second WITH the transaction open. Then
 * `commitTransaction()` assigns `draft.history` and nothing else, so at the
 * one instant the gesture ends, `document === prev.document` and the save is
 * skipped. The drawing would be persisted only at whatever untransacted edit
 * happened next.
 *
 * The fix is to compare against the last document this module actually WROTE,
 * held here, rather than against the previous state. Reference identity is
 * sound for that comparison — the store returns the same `SketchDocument` on a
 * no-op and mints a new one on every real edit — which is the same property
 * the undo history is built on.
 *
 * ── AND WHY A BASELINE, NOT A SAVE ON MOUNT ────────────────────────────────
 *
 * Opening `/editor` loads a benzene fixture. Persisting it immediately would
 * put an untouched benzene in the recents grid every time anyone opened the
 * editor, so `baseline(doc)` tells this module "that document is already
 * accounted for" and the first WRITE happens at the first real edit. A
 * document restored from storage is baselined the same way, which is also what
 * stops a load from immediately re-saving what it just read.
 *
 * ── THE DEBOUNCE IS NOT THE MECHANISM ──────────────────────────────────────
 *
 * Transaction boundaries are. The debounce only coalesces a burst of
 * untransacted edits — six arrow taps, a run of element retypes — into one
 * write; remove it and the behaviour is still correct, just chattier. It is
 * therefore short, and `flush()` bypasses it entirely.
 *
 * Framework-free on purpose: no React, no `indexedDB`, no DOM. The sink is
 * injected, so the whole loop is provable in a plain node process.
 */

import type { SketchDocument } from "@starter/shared";

import type { EditorStore } from "@/state";

import type { StoreResult } from "./types";

/** Where a save goes. Returns a result; it must not throw. */
export type SaveSink = (doc: SketchDocument) => Promise<StoreResult<void>>;

/** Long enough to swallow a run of keystrokes, short enough that a browser
 *  crash costs at most this much drawing. */
export const AUTOSAVE_DEBOUNCE_MS = 400;

export interface AutosaveOptions {
  readonly debounceMs?: number | undefined;
  /** Called with every result, successful or not. The UI's save-state
   *  indicator is wired here rather than inside this module so the loop stays
   *  testable without it. */
  readonly onResult?: ((result: StoreResult<void>, doc: SketchDocument) => void) | undefined;
  readonly onSaving?: ((doc: SketchDocument) => void) | undefined;
}

export interface AutosaveHandle {
  /** Declare a document already persisted, without writing it. */
  baseline(doc: SketchDocument): void;
  /**
   * Write the current document NOW, skipping the debounce.
   *
   * Returns a promise, but callers on the crash path (the canvas error
   * boundary, `pagehide`) cannot await it and must not pretend to — see the
   * header of CanvasErrorBoundary.
   */
  flush(): Promise<StoreResult<void> | null>;
  stop(): void;
}

export function startAutosave(
  store: EditorStore,
  sink: SaveSink,
  options: AutosaveOptions = {},
): AutosaveHandle {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;

  let lastSaved: SketchDocument | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  /** The write in flight, so `flush` can be awaited meaningfully and two
   *  writes of the same document cannot race each other into storage. */
  let inFlight: Promise<StoreResult<void>> | null = null;

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function write(doc: SketchDocument): Promise<StoreResult<void>> {
    // Claimed BEFORE the await. A second edit landing while this write is in
    // flight must schedule its own save rather than be swallowed, and the only
    // way to tell the two apart is by what has already been handed to storage.
    lastSaved = doc;
    options.onSaving?.(doc);
    const result = await sink(doc);
    if (!result.ok) {
      // Un-claim it: a failed write leaves the document unsaved, so the next
      // change — or a retry — has to try again rather than see it as done.
      if (lastSaved === doc) lastSaved = null;
    }
    options.onResult?.(result, doc);
    return result;
  }

  async function run(doc: SketchDocument): Promise<StoreResult<void>> {
    // Serialise. IndexedDB would order two overlapping puts of the same key
    // by itself, but the save-state indicator would flicker through the older
    // write's result afterwards and claim a stale "saved".
    const previous = inFlight;
    if (previous) await previous.catch(() => undefined);
    const current = write(doc);
    inFlight = current;
    try {
      return await current;
    } finally {
      if (inFlight === current) inFlight = null;
    }
  }

  const unsubscribe = store.subscribe((state) => {
    if (stopped) return;
    // MID-GESTURE. Not "mid-drag" specifically: an open transaction is also a
    // run of arrow-key nudges (useKeyBindings holds one for 400 ms across
    // taps) and any composite command. All of them are ONE edit and get ONE
    // save, at the boundary.
    if (state.history.transaction !== null) return;
    if (state.document === lastSaved) return;
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      const doc = store.getState().document;
      // Re-checked after the wait: a transaction may have opened in the
      // meantime, and saving a half-finished drag is the one thing this
      // module promises not to do.
      if (store.getState().history.transaction !== null) return;
      if (doc === lastSaved) return;
      void run(doc);
    }, debounceMs);
  });

  return {
    baseline(doc) {
      clear();
      lastSaved = doc;
    },
    flush() {
      clear();
      const doc = store.getState().document;
      if (doc === lastSaved) return Promise.resolve(null);
      return run(doc);
    },
    stop() {
      stopped = true;
      clear();
      unsubscribe();
    },
  };
}
