/**
 * The autosave loop, driven against a REAL store and a counting sink.
 *
 * No IndexedDB and no DOM: the loop is framework-free and the sink is
 * injected, which is what makes "does it fire at the right moment" answerable
 * without a browser.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { benzene, buildMolecule, vec } from "@starter/chem-core";
import { createDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { createEditorStore, guardedOps } from "@/state";
import type { EditorStore } from "@/state";

import { startAutosave } from "./autosave";
import { storeFail, storeOk, type StoreResult } from "./types";

/** Three atoms in a row, so a document swap is visible by atom count alone. */
function threeAtoms() {
  return buildMolecule((b) => {
    const a = b.atom("C", vec(0, 0));
    const c = b.atom("C", vec(1.5, 0));
    const o = b.atom("O", vec(2.25, 1.3));
    b.bond(a, c);
    b.bond(c, o);
  });
}

function makeStore(): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
  });
}

interface Recorder {
  readonly sink: (doc: SketchDocument) => Promise<StoreResult<void>>;
  readonly saved: SketchDocument[];
  fail: boolean;
}

function recorder(): Recorder {
  const state: Recorder = {
    saved: [],
    fail: false,
    sink: (doc) => {
      if (state.fail) return Promise.resolve(storeFail<void>("quota", "No room."));
      state.saved.push(doc);
      return Promise.resolve(storeOk(undefined));
    },
  };
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

/** Let the debounce fire and the sink's promise settle. */
async function tick(ms = 500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("autosave", () => {
  it("writes nothing until something changes", async () => {
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);

    await tick();
    expect(sink.saved).toHaveLength(0);
    handle.stop();
  });

  it("writes once after an untransacted edit", async () => {
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);

    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();

    expect(sink.saved).toHaveLength(1);
    expect(sink.saved[0]).toBe(store.getState().document);
    handle.stop();
  });

  it("DOES NOT write mid-drag, and writes once at the transaction boundary", async () => {
    // THE CENTRAL CLAIM OF THE MODULE, and the one the obvious predicate gets
    // wrong: `applyMoleculeEdit` still runs a full `set()` on every frame of a
    // drag — only the history RECORD is suppressed — so the document reference
    // changes thirty times while the transaction is open, and at
    // `commitTransaction` it does not change at all.
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);

    const id = store.getState().document.molecule.atomIds[0]!;
    store.getState().beginTransaction("Move atom");
    for (let frame = 1; frame <= 30; frame++) {
      store
        .getState()
        .applyMoleculeEdit("Move atom", (m) =>
          guardedOps.setAtomPositions(m, [[id, vec(frame * 0.01, 0)]]),
        );
      await tick(20);
    }
    expect(sink.saved, "a save landed mid-gesture").toHaveLength(0);

    store.getState().commitTransaction();
    await tick();

    expect(sink.saved).toHaveLength(1);
    expect(sink.saved[0]).toBe(store.getState().document);
    handle.stop();
  });

  it("reports the document DIRTY on the first changed frame, mid-drag included", async () => {
    // The window between an edit and its write is exactly the window in which
    // that edit can still be lost — a navigation during it does not wait for
    // IndexedDB — and the save indicator used to spend the whole of it still
    // reading "Saved" from the previous write. So the dirty signal is raised
    // before the debounce and before the transaction closes.
    const store = makeStore();
    const sink = recorder();
    const dirty = vi.fn();
    startAutosave(store, sink.sink, { onDirty: dirty });

    store.getState().beginTransaction("Move atom");
    store
      .getState()
      .applyMoleculeEdit("Move atom", (m) =>
        guardedOps.setAtomPositions(m, [[m.atomIds[0]!, vec(0.1, 0)]]),
      );

    expect(dirty, "a drag in progress is unsaved work").toHaveBeenCalled();
    expect(sink.saved, "and it is still not written").toHaveLength(0);

    store.getState().commitTransaction();
    await tick();
    expect(sink.saved).toHaveLength(1);
  });

  it("does not call back dirty for a document it has already written", async () => {
    const store = makeStore();
    const sink = recorder();
    const dirty = vi.fn();
    startAutosave(store, sink.sink, { onDirty: dirty });

    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();
    expect(sink.saved).toHaveLength(1);
    const afterWrite = dirty.mock.calls.length;

    // A selection change mints no new document, so nothing is dirty.
    store.getState().setStatusMessage("hello");
    expect(dirty.mock.calls.length).toBe(afterWrite);
  });

  it("flush answers with a write still IN FLIGHT rather than claiming nothing is left", async () => {
    // The canvas error boundary prints "saved" or "not saved" off this result.
    // Resolving null for a document merely HANDED to storage let it claim a
    // save that storage then refused.
    const store = makeStore();
    let settle: (result: StoreResult<void>) => void = () => undefined;
    const handle = startAutosave(
      store,
      () =>
        new Promise<StoreResult<void>>((resolve) => {
          settle = resolve;
        }),
      { debounceMs: 10 },
    );
    handle.baseline(store.getState().document);
    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick(20);

    const flushed = handle.flush();
    settle(storeFail<void>("quota", "No room."));
    const result = await flushed;
    expect(result?.ok).toBe(false);
    // And once it has actually landed, there really is nothing left.
    handle.stop();
  });

  it("coalesces a burst of untransacted edits into one write", async () => {
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 50 });
    handle.baseline(store.getState().document);

    for (const element of ["N", "O", "S"] as const) {
      store
        .getState()
        .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, element));
      await tick(10);
    }
    await tick();

    expect(sink.saved).toHaveLength(1);
    handle.stop();
  });

  it("saves an undo, because an undo changes the document", async () => {
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);

    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();
    store.getState().undo();
    await tick();

    expect(sink.saved).toHaveLength(2);
    handle.stop();
  });

  it("re-tries after a failed write instead of believing the document saved", async () => {
    // A failed write UN-CLAIMS the document. Leaving it claimed would mean the
    // next edit compared equal to a document that never reached storage, and
    // the sketch would stay lost for the rest of the session.
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);

    sink.fail = true;
    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();
    expect(sink.saved).toHaveLength(0);

    sink.fail = false;
    await handle.flush();
    expect(sink.saved).toHaveLength(1);
    handle.stop();
  });

  it("reports every outcome, successful or not", async () => {
    const store = makeStore();
    const sink = recorder();
    const results: boolean[] = [];
    const handle = startAutosave(store, sink.sink, {
      debounceMs: 10,
      onResult: (result) => results.push(result.ok),
    });
    handle.baseline(store.getState().document);

    sink.fail = true;
    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();
    sink.fail = false;
    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[1]!, "O"));
    await tick();

    expect(results).toEqual([false, true]);
    handle.stop();
  });

  describe("flush", () => {
    it("writes immediately, without waiting for the debounce", async () => {
      const store = makeStore();
      const sink = recorder();
      const handle = startAutosave(store, sink.sink, { debounceMs: 100_000 });
      handle.baseline(store.getState().document);

      store.getState().openDocument(createDocument({ molecule: threeAtoms() }));
      await handle.flush();

      expect(sink.saved).toHaveLength(1);
      expect(sink.saved[0]?.molecule.atomIds).toHaveLength(3);
      handle.stop();
    });

    it("is a no-op when the document is already the one on disk", async () => {
      const store = makeStore();
      const sink = recorder();
      const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
      handle.baseline(store.getState().document);

      expect(await handle.flush()).toBeNull();
      expect(sink.saved).toHaveLength(0);
      handle.stop();
    });
  });

  describe("adopt", () => {
    it("takes on a title renamed elsewhere without calling it unsaved or writing it", async () => {
      const store = makeStore();
      const sink = recorder();
      const dirty = vi.fn();
      const handle = startAutosave(store, sink.sink, { debounceMs: 10, onDirty: dirty });
      handle.baseline(store.getState().document);

      handle.adopt(() => store.getState().adoptDocumentTitle("Cyclohexatriene"));
      await tick();

      expect(store.getState().document.metadata.title).toBe("Cyclohexatriene");
      expect(dirty).not.toHaveBeenCalled();
      expect(sink.saved).toHaveLength(0);
      expect(handle.pending()).toBeNull();
      expect(await handle.flush()).toBeNull();
      handle.stop();
    });

    it("still writes work that was unsaved before the adoption, under the adopted title", async () => {
      const store = makeStore();
      const sink = recorder();
      const handle = startAutosave(store, sink.sink, { debounceMs: 50 });
      handle.baseline(store.getState().document);

      store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
      handle.adopt(() => store.getState().adoptDocumentTitle("Pyridine"));
      await tick();

      expect(sink.saved).toHaveLength(1);
      expect(sink.saved[0]?.metadata.title).toBe("Pyridine");
      expect(handle.pending()).toBeNull();
      handle.stop();
    });

    it("lets a write in flight for the outgoing document confirm the adopted one", async () => {
      // The put in flight merges the stored title, so what lands IS the adopted
      // document. Confirming only the outgoing reference would leave the
      // teardown journal rescuing a sketch that is already in storage.
      const store = makeStore();
      let settle: (result: StoreResult<void>) => void = () => undefined;
      const handle = startAutosave(
        store,
        () =>
          new Promise<StoreResult<void>>((resolve) => {
            settle = resolve;
          }),
        { debounceMs: 10 },
      );
      handle.baseline(store.getState().document);
      store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
      await tick(20);

      handle.adopt(() => store.getState().adoptDocumentTitle("Pyridine"));
      expect(handle.pending()?.metadata.title).toBe("Pyridine");
      settle(storeOk(undefined));
      await tick();
      expect(handle.pending()).toBeNull();
      handle.stop();
    });
  });

  it("stops listening once stopped", async () => {
    const store = makeStore();
    const sink = recorder();
    const handle = startAutosave(store, sink.sink, { debounceMs: 10 });
    handle.baseline(store.getState().document);
    handle.stop();

    store.getState().applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await tick();
    expect(sink.saved).toHaveLength(0);
  });
});
