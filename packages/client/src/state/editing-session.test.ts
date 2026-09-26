/**
 * WHAT A LONG EDITING SESSION IS ALLOWED TO RETAIN.
 *
 * Manual notes 3 report the dev process dying of "Ineffective mark-compacts
 * near heap limit" at ~2 GB after about 200 seconds of drawing, with the GC
 * log showing a steady climb rather than one huge allocation — the signature
 * of something that KEEPS what it is handed. This file is the standing check
 * that the editor's own model path is not that something.
 *
 * WHY THE ASSERTIONS ARE COUNTS AND NOT A HEAP FIGURE. `heapUsed` is only
 * meaningful after a forced collection, `global.gc` exists only under
 * `--expose-gc`, and a threshold in megabytes fails on whichever machine is
 * slowest to collect rather than on the regression. The three counts below are
 * the things that WOULD grow without bound if the retainer were here, and each
 * of them fails deterministically:
 *
 *   - the undo history, which snapshots a document per edit;
 *   - the DOCUMENTS the per-document scene cache keeps alive;
 *   - the MOLECULES the derived-chemistry caches keep alive.
 *
 * THE COUNTS THAT MATTER ARE THE RETAINED ONES, and the distinction was paid
 * for. An earlier version of this file counted only the scenes cached for the
 * NEWEST document and checked that a memo returned the same array twice. Both
 * hold for a cache that has kept every document of the session, so turning the
 * two `WeakMap`s into plain `Map`s — the exact regression the crash report
 * describes — left all 735 client tests green. `documentsRetained` and
 * `moleculesRetained` are the numbers that move.
 *
 * AND THEY MOVE ONLY FOR A CACHE THE REGISTRY KNOWS ABOUT. Both numbers come
 * from `@/lib/weak-cache`, which every document- or molecule-keyed cache in
 * the app is built by; a cache written with a bare `new Map` would be outside
 * them and this file would stay green while it held the session. That second
 * gap is a source-level property and `src/lib/weak-cache.node.test.ts` is its
 * guard. Neither test is the contract on its own.
 *
 * The heap figure is still worth having, so it is measured and reported when
 * the runner was started with `--expose-gc`:
 *
 *     NODE_OPTIONS=--expose-gc pnpm --filter @starter/client exec \
 *       vitest run --project node src/state/editing-session.test.ts
 *
 * Measured that way on the 300-atom stress fixture, 300 transactions of 10
 * pointer frames each (3000 molecule edits, 3000 scene builds): 28.4 MB at the
 * start, 52.2 MB after 100, 58.2 MB after 150, and 58.0 MB at the end — a
 * plateau at the point the history cap starts dropping its oldest entries.
 */

import { describe, expect, it } from "vitest";

import { setAtomPositions } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { fixtureDocument } from "@/canvas/fixture";
import { buildCanvasScene, canvasSceneCacheStats } from "@/canvas/scene-bridge";
import { derivedCacheStats, moleculeIssues, moleculeMass } from "@/editor/derived";

import { DEFAULT_HISTORY_LIMIT } from "./history";
import { createEditorStore } from "./store";

/** Far past the history cap, and past the ~200 edits the crash report
 *  describes. Cheap: benzene is six atoms. */
const EDITS = 500;
const FRAMES_PER_EDIT = 5;

function drive(store: ReturnType<typeof createEditorStore>, edits: number): void {
  const state = () => store.getState();
  for (let i = 1; i <= edits; i += 1) {
    // One transaction per gesture, several pointer frames inside it — the
    // shape a drag actually has, and the one that mints a Molecule per frame.
    state().beginTransaction(`Move ${i}`);
    for (let f = 0; f < FRAMES_PER_EDIT; f += 1) {
      const id = state().document.molecule.atomIds[0]!;
      state().applyMoleculeEdit("Move", (m: Molecule) =>
        setAtomPositions(m, [[id, { x: (i % 7) + f * 0.01, y: (i % 5) + f * 0.01 }]]),
      );
      // Everything the canvas and the status bar do on every frame.
      buildCanvasScene(state().document, state().ui.activePanelId);
      moleculeIssues(state().document.molecule);
      moleculeMass(state().document.molecule);
    }
    state().commitTransaction();
    if (i % 3 === 0) state().undo();
    if (i % 7 === 0) state().redo();
    if (i % 11 === 0) state().setStylePreset(i % 22 === 0 ? "publication" : "screen");
  }
}

describe("a long editing session", () => {
  it("keeps a bounded undo history", () => {
    const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });
    drive(store, EDITS);

    const { past, future } = store.getState().history;
    // Every entry holds a whole document, so an uncapped stack IS the leak.
    expect(past.length).toBeLessThanOrEqual(DEFAULT_HISTORY_LIMIT);
    expect(future.length).toBeLessThanOrEqual(DEFAULT_HISTORY_LIMIT);
    // And it is genuinely full rather than empty for some other reason —
    // otherwise the bound above would pass on a broken store.
    expect(past.length).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it("caches one scene per panel per document, and retains no document", () => {
    const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });
    drive(store, EDITS);

    const doc = store.getState().document;
    const stats = canvasSceneCacheStats(doc);
    // Every panel the canvas was ever asked for, plus the `null` "whatever the
    // canvas defaults to" key.
    expect(stats.panels).toBeLessThanOrEqual(doc.panels.length + 1);
    // AND THIS IS THE ONE THAT WOULD CATCH THE CRASH. The bound above counts
    // the newest document's entries and is satisfied whatever became of the
    // 499 before it; a cache keyed strongly on a value the store replaces per
    // edit keeps every one of them, along with every molecule, scene and issue
    // list hanging off them.
    expect(stats.documentsRetained).toBe(0);

    // The memo still works — a second read of the same document costs nothing.
    const first = buildCanvasScene(doc, store.getState().ui.activePanelId);
    const second = buildCanvasScene(doc, store.getState().ui.activePanelId);
    expect(second).toBe(first);
  });

  it("memoises derived chemistry on the molecule rather than accumulating it", () => {
    const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });
    drive(store, EDITS);

    const mol = store.getState().document.molecule;
    // A `WeakMap` hit returns the very same array — and so would a cache keyed
    // by value that never dropped anything, which is why the retention count
    // is asserted beside it. 500 transactions of 5 frames mint thousands of
    // molecules; a strongly-keyed memo would still be holding all of them.
    expect(moleculeIssues(mol)).toBe(moleculeIssues(mol));
    expect(moleculeMass(mol)).toBe(moleculeMass(mol));
    expect(derivedCacheStats().moleculesRetained).toBe(0);
  });

  // SKIPPED, NOT PASSED, without `--expose-gc`. A heap figure is only honest
  // after a forced collection, so without one this test has nothing to say; a
  // body that asserted its own inability to run would report a green test for
  // a measurement nobody took.
  it.runIf(typeof (globalThis as { gc?: () => void }).gc === "function")(
    "does not grow the heap once the history cap is reached",
    () => {
    const gc = (globalThis as { gc?: () => void }).gc!;
    const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });

    drive(store, DEFAULT_HISTORY_LIMIT * 2);
    gc();
    gc();
    const settled = process.memoryUsage().heapUsed;

    drive(store, DEFAULT_HISTORY_LIMIT * 3);
    gc();
    gc();
    const later = process.memoryUsage().heapUsed;

    // Generous, because this is a plateau test and not a byte count: past the
    // cap, three times as many further edits must not cost another whole
    // session's worth of memory.
    expect(later).toBeLessThan(settled * 2 + 16 * 1024 * 1024);
    },
  );
});
