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
  /**
   * Called on the first frame in which the document differs from the one last
   * written — INCLUDING mid-gesture, before the debounce and before any
   * transaction has closed.
   *
   * That timing is the point. The debounce is a window in which the drawing
   * exists only in memory, and the save indicator used to spend it still
   * reading "Saved" from the previous write; an edit made in that window and
   * followed by a navigation is lost, and the UI asserted the opposite. This
   * is how the indicator learns to stop claiming it.
   */
  readonly onDirty?: ((doc: SketchDocument) => void) | undefined;
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
  /**
   * The document that is NOT in storage yet, or null when nothing is
   * outstanding.
   *
   * Synchronous, and that is the entire point. `flush` starts an IndexedDB
   * write, and a write started during a teardown never commits — measured, see
   * the header of `journal.ts`. The last-moment rescue has to hand the
   * document to something synchronous instead, and it cannot ask an
   * asynchronous API which document that is.
   */
  pending(): SketchDocument | null;
  /**
   * Run a store update that brings the document IN LINE WITH storage rather
   * than away from it — a title renamed in another tab — without that update
   * counting as unsaved work.
   *
   * Every change mints a new document, and this loop tells "unsaved" by
   * reference, so adopting the stored title would otherwise look exactly like
   * an edit: the indicator would flip to "Unsaved changes" and a write would
   * go out to store what is already stored. Instead the references this loop
   * holds for the outgoing document move to the incoming one. Anything that
   * was genuinely unsaved stays unsaved and is written as usual.
   */
  adopt(update: () => void): void;
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

  /**
   * The document storage has actually CONFIRMED, as opposed to the one that
   * has merely been handed to it.
   *
   * `lastSaved` is claimed before the await so that a second edit arriving
   * mid-write schedules its own save; it therefore says "a write for this went
   * out", not "this is in storage". Those differ for as long as the write is
   * in flight, and that gap is exactly when a page can be torn down — an
   * IndexedDB transaction that has not committed by then never will. So the
   * last-moment journal asks THIS one, and an in-flight write still counts as
   * unsaved work worth rescuing.
   */
  let lastConfirmed: SketchDocument | null = null;

  /** The write in flight, so `flush` can be awaited meaningfully and two
   *  writes of the same document cannot race each other into storage. */
  let inFlight: Promise<StoreResult<void>> | null = null;

  /** Set only for the duration of `adopt`'s update. */
  let adopting = false;

  /**
   * Outgoing document -> the one `adopt` replaced it with, so a write still in
   * flight for the outgoing one confirms its successor. That write lands on
   * storage that already carries the adopted title — the put merges it — so
   * the successor is what is actually stored.
   */
  const successors = new WeakMap<SketchDocument, SketchDocument>();
  function latest(doc: SketchDocument): SketchDocument {
    let current = doc;
    for (let next = successors.get(current); next !== undefined; next = successors.get(current)) {
      current = next;
    }
    return current;
  }

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
    if (result.ok) lastConfirmed = latest(doc);
    if (!result.ok) {
      // Un-claim it: a failed write leaves the document unsaved, so the next
      // change — or a retry — has to try again rather than see it as done.
      if (lastSaved === latest(doc)) lastSaved = null;
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

  function react(state: ReturnType<EditorStore["getState"]>): void {
    // BEFORE the transaction guard, deliberately. A drag in progress is
    // unsaved work and the indicator has to say so; only the WRITE waits for
    // the boundary.
    if (state.document !== lastSaved) options.onDirty?.(state.document);
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
  }

  const unsubscribe = store.subscribe((state) => {
    if (stopped || adopting) return;
    react(state);
  });

  return {
    baseline(doc) {
      clear();
      lastSaved = doc;
      // Both, because a baseline is a statement that this document IS in
      // storage — the restored one, or the fixture that must not litter the
      // grid — and not merely that a write for it went out.
      lastConfirmed = doc;
    },
    flush() {
      clear();
      const doc = store.getState().document;
      if (doc === lastSaved) {
        // Handed to storage already — but "handed" is not "stored". While that
        // write is in flight, answer with IT: the canvas error boundary prints
        // "saved" or "not saved" off this result, and resolving null here
        // would let it claim a save that could still be refused.
        return doc === lastConfirmed || inFlight === null ? Promise.resolve(null) : inFlight;
      }
      return run(doc);
    },
    pending() {
      // Against `lastConfirmed`, NOT `lastSaved`: a write that is still in
      // flight has not reached storage, and a page torn down while it is in
      // flight loses it. See the field's own comment.
      const doc = store.getState().document;
      return doc === lastConfirmed ? null : doc;
    },
    adopt(update) {
      const before = store.getState().document;
      adopting = true;
      try {
        update();
      } finally {
        adopting = false;
      }
      const after = store.getState().document;
      if (after === before) return;
      successors.set(before, after);
      if (lastSaved === before) lastSaved = after;
      if (lastConfirmed === before) lastConfirmed = after;
      if (!stopped) react(store.getState());
    },
    stop() {
      stopped = true;
      clear();
      unsubscribe();
    },
  };
}
