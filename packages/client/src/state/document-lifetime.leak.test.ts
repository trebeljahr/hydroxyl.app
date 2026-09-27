/**
 * IS A RELEASED DOCUMENT ACTUALLY COLLECTABLE?
 *
 * ── WHY THIS HARNESS AND NOT A HEAP PROFILE ────────────────────────────────
 *
 * Manual notes 3 report the dev process dying of "Ineffective mark-compacts
 * near heap limit" at ~2 GB after about 200 seconds of drawing, with the GC
 * log showing a steady climb rather than one huge allocation — the signature
 * of something that KEEPS what it is handed. The obvious way to chase that is
 * to run the dev server and diff two CDP heap snapshots. Decision 86 rules
 * that out and prescribes this instead: a node harness under `--expose-gc`
 * that drives the store, the scene bridge, the derived caches and the
 * persistence loop through 500+ simulated edits and then ASKS THE COLLECTOR.
 * It is deterministic, it takes seconds, and it runs in CI — none of which is
 * true of a profile of a server that has to be used for three minutes first.
 *
 * ── WHY `WeakRef` AND NOT A SIZE BOUND ─────────────────────────────────────
 *
 * The editor's model path has exactly one shape that climbs under ordinary
 * drawing: a cache keyed on a `SketchDocument` or a `Molecule`. Both are
 * immutable and both are minted afresh per edit, so a cache with STRONG keys
 * keeps one dead document — and its molecule, its scenes and its issue lists —
 * per edit, forever. With weak keys it keeps none.
 *
 * The two are indistinguishable from the outside by every cheap test.
 * `f(m) === f(m)` holds for both. The newest document has at most one entry
 * either way, so a size bound on it passes either way — measured: turning the
 * two `WeakMap`s into plain `Map`s left all 735 client tests green. What
 * differs is whether an OLD document is still reachable, and `WeakRef.deref()`
 * after a forced collection is the only thing that answers that. Decision 87
 * requires exactly this: the suite must FAIL when a per-document cache becomes
 * strongly keyed.
 *
 * ── WHAT IT DOES NOT CLAIM ─────────────────────────────────────────────────
 *
 * It measures the model path this process can build: the store, the scene
 * bridge, the derived chemistry caches and the autosave loop. A retainer in
 * the React tree, in the bundler's dev server, or in a browser API (the
 * module-scope `BroadcastChannel` that used to survive every Fast Refresh) is
 * outside it and has its own test. And it observes only what a collection can
 * reach: a document held by a closure this file also holds would be reported
 * as retained and would be this file's own bug, which is why every handle is
 * dropped inside a function whose frame is gone before the collection runs.
 */

import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { setAtomPositions } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import type { SketchDocument } from "@starter/shared";

import { buildCanvasScene, canvasSceneCacheStats } from "@/canvas/scene-bridge";
import { fixtureDocument } from "@/canvas/fixture";
import { derivedCacheStats, moleculeIssues, moleculeMass } from "@/editor/derived";
import { keysRetained } from "@/lib/weak-cache";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { storeOk, type StoreResult } from "@/persistence/types";

import { DEFAULT_HISTORY_LIMIT } from "./history";
import { createEditorStore, type EditorStore } from "./store";

/** Far past the history cap, and past the ~200 edits the crash report
 *  describes. Cheap: benzene is six atoms. */
const EDITS = 500;
const FRAMES_PER_EDIT = 3;

/**
 * A REAL FORCED COLLECTION, without needing the process to have been started
 * a particular way.
 *
 * `globalThis.gc` exists only under `--expose-gc`, and decision 86 asks for
 * this to run in CI through the ordinary suite. Passing the flag through
 * vitest's `poolOptions.forks.execArgv` does not work here — measured against
 * vitest 4.1.6, the runner replaces the child's argument list wholesale, so
 * the flag arrived nowhere and every assertion below skipped itself while the
 * run reported green.
 *
 * `v8.setFlagsFromString` turns the same flag on at runtime; `runInNewContext`
 * is what makes the newly-exposed binding reachable, because the current
 * context's globals were installed before the flag changed. The flag is turned
 * off again immediately so nothing else in the process gains a `gc` it did not
 * ask for. This is the documented way to get a collector from inside node and
 * it is a genuine full collection, not a hint.
 */
function forcedCollector(): (() => void) | undefined {
  const exposed = (globalThis as { gc?: () => void }).gc;
  if (exposed !== undefined) return exposed;
  try {
    setFlagsFromString("--expose-gc");
    const collect = runInNewContext("gc") as unknown;
    return typeof collect === "function" ? (collect as () => void) : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      setFlagsFromString("--no-expose-gc");
    } catch {
      // Older or hardened builds refuse the reset. Harmless: the worst case is
      // a `gc` on the global of a test process.
    }
  }
}

const gc = forcedCollector();

/**
 * Force a collection and let any finaliser run.
 *
 * TWICE, and with a macrotask in between. One `gc()` collects the young
 * generation and whatever the current mark cycle had already reached; an
 * object that died during that cycle survives it and is only reclaimed by the
 * next. The `setTimeout` yields the stack as well as the loop: V8 keeps a
 * value alive while a register or a live stack slot still names it, and a
 * `deref()` asked from the same frame that built the object has been seen to
 * answer with it.
 */
async function collect(): Promise<void> {
  if (gc === undefined) throw new Error("no forced collector is available in this process");
  for (let pass = 0; pass < 3; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

/**
 * A sink that keeps nothing. Every candidate retainer in the persistence path
 * must be the loop's own, not the test's.
 */
function countingSink(): { readonly sink: () => Promise<StoreResult<void>>; writes: number } {
  const state = {
    writes: 0,
    // Takes no argument on purpose: a `SaveSink` may ignore its document, and
    // naming a parameter here would be a reference this file holds to the very
    // thing it is asking the collector about.
    sink: (): Promise<StoreResult<void>> => {
      state.writes += 1;
      return Promise.resolve(storeOk(undefined));
    },
  };
  return state;
}

/** Everything a drawing hand and the panels around it do, per edit. */
function drive(store: EditorStore, edits: number): void {
  const state = () => store.getState();
  for (let i = 1; i <= edits; i += 1) {
    // One transaction per gesture, several pointer frames inside it — the
    // shape a drag actually has, and the one that mints a Molecule per frame.
    state().beginTransaction(`Move ${i}`);
    for (let frame = 0; frame < FRAMES_PER_EDIT; frame += 1) {
      const id = state().document.molecule.atomIds[0]!;
      state().applyMoleculeEdit("Move", (m: Molecule) =>
        setAtomPositions(m, [[id, { x: (i % 7) + frame * 0.01, y: (i % 5) + frame * 0.01 }]]),
      );
      // Everything the canvas and the status bar read on every frame, so the
      // per-document and per-molecule caches see every intermediate value.
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

interface Released {
  readonly store: EditorStore;
  readonly handle: AutosaveHandle;
  readonly writes: () => number;
  readonly document: WeakRef<SketchDocument>;
  readonly molecule: WeakRef<Molecule>;
  readonly scene: WeakRef<object>;
  readonly collected: Promise<string>;
  /** Held only so the registry itself outlives the function that made it: a
   *  collected registry runs no finalisers, and the promise below would then
   *  never settle for a reason that has nothing to do with the document. */
  readonly registry: FinalizationRegistry<(value: string) => void>;
}

/**
 * Run a session, and hand back weak references to ONE document from early in
 * it — along with the store and the autosave loop, which stay alive exactly as
 * they do in a tab the chemist is still drawing in.
 *
 * THE STORE IS RETURNED ON PURPOSE. The easy version of this test drops
 * everything and asks whether the whole session can be collected; that passes
 * with a strongly-keyed cache too, because the cache goes with it. The
 * question the crash report asks is the other one: while the session
 * CONTINUES, is a document it has finished with still reachable?
 *
 * Strong references to the observed document exist only inside this function,
 * so its frame — and every register that named it — is gone before the caller
 * forces a collection.
 */
function releaseOneDocument(): Released {
  const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });
  const sink = countingSink();
  const handle = startAutosave(store, sink.sink, { debounceMs: 0 });
  handle.baseline(store.getState().document);

  // The document under observation, put through every per-document and
  // per-molecule cache the app has.
  drive(store, 1);
  const doomed = store.getState().document;
  const scene = buildCanvasScene(doomed, null) as unknown as object;
  moleculeIssues(doomed.molecule);
  moleculeMass(doomed.molecule);

  const finalised = new FinalizationRegistry<(value: string) => void>((resolve) => {
    resolve("collected");
  });
  let announce: (value: string) => void = () => undefined;
  const collected = new Promise<string>((resolve) => {
    announce = resolve;
  });
  finalised.register(doomed, announce);

  const released: Released = {
    store,
    handle,
    writes: () => sink.writes,
    document: new WeakRef(doomed),
    molecule: new WeakRef(doomed.molecule),
    scene: new WeakRef(scene),
    collected,
    registry: finalised,
  };

  // Past the history cap in both directions, so the observed document is held
  // by neither `past` nor `future`, and past the point where the autosave loop
  // still names it.
  drive(store, EDITS);
  return released;
}

describe.runIf(gc !== undefined)("a document the session has finished with", () => {
  it("is collectable while the store, the caches and autosave live on", async () => {
    const released = releaseOneDocument();
    await collect();

    // THE ASSERTION THE WHOLE FILE EXISTS FOR. A `WeakMap` in
    // `@/lib/weak-cache` turned into a `Map` — the exact regression the crash
    // report describes — keeps this document, its molecule and its scenes
    // alive, and nothing else in the suite notices.
    expect(released.document.deref()).toBeUndefined();
    expect(released.molecule.deref()).toBeUndefined();
    expect(released.scene.deref()).toBeUndefined();

    // The session really is still running, so the assertion above is about
    // retention and not about a store that was collected wholesale.
    expect(released.store.getState().document.molecule.atomIds.length).toBeGreaterThan(0);
    // And the persistence loop was really driven, so the write path is inside
    // the measurement rather than beside it.
    expect(released.writes()).toBeGreaterThan(0);
    released.handle.stop();
  });

  it("is reported collected by a FinalizationRegistry", async () => {
    const released = releaseOneDocument();
    await collect();

    // `deref()` and a finaliser answer the same question from opposite ends,
    // and the finaliser is the one that cannot be satisfied by a reference
    // that merely happens to be unreachable from THIS frame.
    await expect(
      Promise.race([
        released.collected,
        new Promise((resolve) => setTimeout(() => resolve("still reachable"), 500)),
      ]),
    ).resolves.toBe("collected");
    released.handle.stop();
  });

  it("leaves every registered per-document cache holding nothing", () => {
    const released = releaseOneDocument();

    // The cheap half of the contract, kept beside the expensive one: a count
    // that is non-zero says WHICH kind of key grew, which `deref()` cannot.
    expect(keysRetained("document")).toBe(0);
    expect(keysRetained("molecule")).toBe(0);
    expect(derivedCacheStats().moleculesRetained).toBe(0);

    const current = released.store.getState().document;
    const stats = canvasSceneCacheStats(current);
    // Every panel the canvas was ever asked for, plus the `null` "whatever the
    // canvas defaults to" key.
    expect(stats.panels).toBeLessThanOrEqual(current.panels.length + 1);
    expect(stats.documentsRetained).toBe(0);
    released.handle.stop();
  });
});

describe.runIf(gc !== undefined)("a long session", () => {
  it("keeps a bounded undo history", () => {
    const released = releaseOneDocument();
    const { past, future } = released.store.getState().history;

    // Every entry holds a whole document, so an uncapped stack IS the leak.
    expect(past.length).toBe(DEFAULT_HISTORY_LIMIT);
    expect(future.length).toBeLessThanOrEqual(DEFAULT_HISTORY_LIMIT);
    released.handle.stop();
  });

  it("does not grow the heap once the history cap is reached", async () => {
    const store = createEditorStore({ document: fixtureDocument("2024-01-01T00:00:00.000Z") });
    const sink = countingSink();
    const handle = startAutosave(store, sink.sink, { debounceMs: 0 });
    handle.baseline(store.getState().document);

    drive(store, DEFAULT_HISTORY_LIMIT * 2);
    await collect();
    const settled = process.memoryUsage().heapUsed;

    drive(store, DEFAULT_HISTORY_LIMIT * 6);
    await collect();
    const later = process.memoryUsage().heapUsed;

    // Generous, because this is a plateau test and not a byte count: past the
    // cap, six times as many further edits must not cost another whole
    // session's worth of memory. A strongly-keyed cache fails it by orders of
    // magnitude, which is what "2 GB after 200 seconds" was.
    expect(later).toBeLessThan(settled * 2 + 16 * 1024 * 1024);
    handle.stop();
  });
});

/**
 * NOT SKIPPED SILENTLY. Without `--expose-gc` every test above is `runIf`-ed
 * away, and a suite that reports "0 failed" for a measurement nobody took is
 * the failure mode this whole file is guarding against. This one line fails
 * the run instead.
 */
describe("the harness itself", () => {
  it("has a forced collector", () => {
    expect(typeof gc).toBe("function");
  });

  it("collects something unreachable, so the assertions above can mean no", async () => {
    // A control: if `gc` were a no-op, every `deref()` below would answer
    // with the object and the suite would report a leak that is not there —
    // or, worse, a future no-op collector would make the whole file pass
    // vacuously in the other direction.
    const ref = (() => new WeakRef({ big: new Array(1000).fill(0) }))();
    await collect();
    expect(ref.deref()).toBeUndefined();
  });
});
