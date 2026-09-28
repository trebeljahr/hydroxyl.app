/**
 * Store tests.
 *
 * NODE ENVIRONMENT, NO REACT, NO DOM. Everything below drives the vanilla
 * store returned by `createEditorStore`. That is the point of the vitest
 * project split: if one of these ever needs jsdom, the editor's state has
 * grown a UI dependency and this file is where it shows up.
 *
 * The molecules are real ones — benzene, ethanol — so a failure reads as a
 * chemistry error rather than as a graph error.
 */

import {
  benzene,
  buildMolecule,
  requireAtom,
  type AtomId,
  type Molecule,
  type Vec2,
} from "@starter/chem-core";
import { SCHEMA_VERSION, createDocument, type SketchDocument } from "@starter/shared";
import { createDraft, isDraft, produce } from "immer";
import { describe, expect, it } from "vitest";
import { guardedOps } from "./chem-guard";
import { DEFAULT_HISTORY_LIMIT } from "./history";
import { createEditorStore, type EditorStore } from "./store";

/** Ethanol, drawn the way the chain tool would lay it down. */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 1, y: 0 });
    const o = b.atom("O", { x: 1.5, y: 0.87 });
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

/** A clock that advances one second per call, so `modifiedAt` is both
 *  deterministic and strictly increasing across edits. */
function fakeClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2024, 0, 1, 0, 0, tick)).toISOString();
  };
}

function makeStore(molecule: Molecule = benzene()): EditorStore {
  const now = fakeClock();
  return createEditorStore({
    document: createDocument({ molecule, now: now() }),
    now,
  });
}

function firstAtomId(store: EditorStore): AtomId {
  const id = store.getState().document.molecule.atomIds[0];
  if (!id) throw new Error("fixture molecule has no atoms");
  return id;
}

function posOf(store: EditorStore, id: AtomId): Vec2 {
  return requireAtom(store.getState().document.molecule, id).pos;
}

/** The move the drag tests replay frame by frame. */
function moveTo(store: EditorStore, id: AtomId, x: number, y: number): void {
  store
    .getState()
    .applyMoleculeEdit("Move atom", (mol) =>
      guardedOps.setAtomPosition(mol, id, { x, y }),
    );
}

/**
 * The two facts the vitest project split exists to guarantee. They are
 * asserted rather than left to the config because a config is edited by
 * whoever is in a hurry, and both failures are silent: a store that quietly
 * started needing a DOM still passes under jsdom, and a `paths` mapping into
 * `packages/shared/src` still compiles — right up until Turbopack tries to
 * bundle the TypeScript source and the NodeNext `./x.js` re-exports fail to
 * resolve (see CLAUDE.md).
 */
/** `import.meta.resolve` is not in the client's `lib` (it is typed only under
 *  NodeNext module resolution), so it is reached through a cast rather than by
 *  widening the tsconfig for one assertion. */
function resolveModule(specifier: string): string {
  const meta = import.meta as unknown as {
    readonly resolve?: (s: string) => string;
  };
  if (typeof meta.resolve !== "function") {
    throw new Error("import.meta.resolve is unavailable in this runner");
  }
  return meta.resolve(specifier);
}

describe("test environment", () => {
  it("runs in plain node with no DOM globals", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    // jsdom installs both; the `node` project in vitest.config.ts installs
    // neither, and this file must stay in that project.
    expect(globalThis).not.toHaveProperty("HTMLElement");
  });

  it("resolves @starter/shared to the package's built dist/", () => {
    // `import.meta.resolve` reports the resolution THIS FILE's own import of
    // `@starter/shared` went through, so it also fails if someone adds the
    // tsconfig `paths` mapping into `packages/shared/src` that CLAUDE.md
    // forbids — a plain `require.resolve` would keep reporting dist/ and miss
    // it. The package is ESM-only (no `require` condition in its exports),
    // which is why this is not a `createRequire` call.
    const resolved = resolveModule("@starter/shared");
    expect(resolved.replaceAll("\\", "/")).toMatch(/\/packages\/shared\/dist\//);
    expect(resolved.endsWith(".js")).toBe(true);
  });
});

describe("createEditorStore", () => {
  it("opens on an empty document built from the installed @starter/shared", () => {
    const store = createEditorStore();
    // Resolved from packages/shared/dist via the package exports, not from a
    // tsconfig paths mapping into src.
    expect(SCHEMA_VERSION).toBe(1);
    expect(store.getState().document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(store.getState().document.molecule.atomIds).toEqual([]);
    expect(store.getState().document.panels.length).toBeGreaterThan(0);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(false);
  });

  it("hands the edit callback a real molecule and stores the result by reference", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    let seenDraft = true;
    let produced: Molecule | undefined;

    store.getState().applyMoleculeEdit("Move atom", (mol) => {
      seenDraft = isDraft(mol);
      produced = guardedOps.setAtomPosition(mol, id, { x: 9, y: 9 });
      return produced;
    });

    expect(seenDraft).toBe(false);
    // Identity, not equality: immer must not have copied or frozen the
    // molecule on its way into the state, or the history's `===` comparison
    // and chem-core's WeakMap caches would both be defeated.
    expect(store.getState().document.molecule).toBe(produced);
  });

  it("records nothing for an edit that changes nothing", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const before = store.getState().document;
    const { x, y } = posOf(store, id);

    moveTo(store, id, x, y);

    expect(store.getState().document).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().canUndo()).toBe(false);
  });

  it("stamps modifiedAt on an edit and leaves createdAt alone", () => {
    const store = makeStore();
    const before = store.getState().document.metadata;

    moveTo(store, firstAtomId(store), 3, 4);

    const after = store.getState().document.metadata;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.modifiedAt).not.toBe(before.modifiedAt);
  });
});

describe("transactions", () => {
  it("collapses a 30-frame drag into one undo entry", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    store.getState().beginTransaction("Move atom");
    for (let frame = 1; frame <= 30; frame += 1) {
      moveTo(store, id, frame, frame * 2);
    }
    store.getState().commitTransaction();

    expect(posOf(store, id)).toEqual({ x: 30, y: 60 });
    expect(store.getState().history.past).toHaveLength(1);

    expect(store.getState().undo()).toBe(true);
    expect(posOf(store, id)).toEqual(origin);
    expect(store.getState().canUndo()).toBe(false);
  });

  it("produces 30 entries for the same 30 frames without a transaction", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    for (let frame = 1; frame <= 30; frame += 1) {
      moveTo(store, id, frame, frame * 2);
    }

    // The transaction is the only thing that collapses them — without it every
    // pointer-move frame is its own step, which is exactly the behaviour
    // transactions exist to prevent.
    expect(store.getState().history.past).toHaveLength(30);
    store.getState().undo();
    expect(posOf(store, id)).toEqual({ x: 29, y: 58 });

    for (let i = 0; i < 29; i += 1) store.getState().undo();
    expect(posOf(store, id)).toEqual(origin);
  });

  it("is not undoable while a transaction is in flight", () => {
    const store = makeStore();
    const id = firstAtomId(store);

    moveTo(store, id, 1, 1);
    expect(store.getState().canUndo()).toBe(true);

    store.getState().beginTransaction("Move atom");
    moveTo(store, id, 2, 2);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().undo()).toBe(false);

    store.getState().commitTransaction();
    expect(store.getState().canUndo()).toBe(true);
  });

  it("keeps a nested transaction inside the outer one", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    store.getState().transact("Draw ring", () => {
      moveTo(store, id, 1, 1);
      store.getState().transact("Delete selection", () => {
        moveTo(store, id, 2, 2);
      });
      moveTo(store, id, 3, 3);
    });

    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().undoLabel()).toBe("Draw ring");
    store.getState().undo();
    expect(posOf(store, id)).toEqual(origin);
  });

  it("records nothing for a transaction that only moved the selection", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const before = store.getState().document;

    // The shape of every canvas gesture: pointerdown opens the transaction and
    // selects the atom under the cursor, because a click and a drag are
    // indistinguishable until the pointer moves. A click that never becomes a
    // drag must not leave a step behind — the next Ctrl+Z belongs to the last
    // chemical edit, not to a deselection.
    store.getState().beginTransaction("Move atom");
    store.getState().selectAtoms([id]);
    store.getState().commitTransaction();

    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().document).toBe(before);
    // The selection change itself stands: it was never undoable, so there is
    // nothing to roll back either.
    expect(store.getState().selection.atomIds).toEqual([id]);
  });

  it("keeps the outer transaction alive when a nested one throws", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    store.getState().transact("Draw ring", () => {
      moveTo(store, id, 1, 1);
      expect(() =>
        store.getState().transact("Snap to grid", () => {
          throw new Error("no grid point in range");
        }),
      ).toThrow("no grid point in range");
      // The outer gesture still owns the transaction: this frame joins it
      // rather than becoming an entry of its own.
      moveTo(store, id, 3, 3);
    });

    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().undoLabel()).toBe("Draw ring");
    store.getState().undo();
    expect(posOf(store, id)).toEqual(origin);
  });

  it("restores the base when a transaction body throws, and rethrows", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    expect(() =>
      store.getState().transact("Draw ring", () => {
        moveTo(store, id, 7, 7);
        throw new Error("gesture failed");
      }),
    ).toThrow("gesture failed");

    expect(posOf(store, id)).toEqual(origin);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("drops the oldest entry once the cap is reached", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const overflow = 5;

    for (let step = 1; step <= DEFAULT_HISTORY_LIMIT + overflow; step += 1) {
      moveTo(store, id, step, 0);
    }

    expect(store.getState().history.past).toHaveLength(DEFAULT_HISTORY_LIMIT);
    for (let i = 0; i < DEFAULT_HISTORY_LIMIT; i += 1) store.getState().undo();

    // The first `overflow` steps fell off the far end, so the earliest state
    // still reachable is the one after them — NOT the original position.
    expect(store.getState().canUndo()).toBe(false);
    expect(posOf(store, id)).toEqual({ x: overflow, y: 0 });
  });
});

describe("undo and redo", () => {
  it("round-trips undo / redo / undo", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const origin = posOf(store, id);

    moveTo(store, id, 4, 5);
    expect(store.getState().undo()).toBe(true);
    expect(posOf(store, id)).toEqual(origin);
    expect(store.getState().redo()).toBe(true);
    expect(posOf(store, id)).toEqual({ x: 4, y: 5 });
    expect(store.getState().undo()).toBe(true);
    expect(posOf(store, id)).toEqual(origin);
    expect(store.getState().redo()).toBe(true);
    expect(posOf(store, id)).toEqual({ x: 4, y: 5 });
  });

  it("clears the redo branch when a new edit lands", () => {
    const store = makeStore();
    const id = firstAtomId(store);

    moveTo(store, id, 1, 1);
    store.getState().undo();
    expect(store.getState().canRedo()).toBe(true);

    moveTo(store, id, 2, 2);
    expect(store.getState().canRedo()).toBe(false);
    expect(store.getState().redo()).toBe(false);
  });

  it("restores the exact document object an undo entry holds", () => {
    const store = makeStore();
    const original = store.getState().document;

    moveTo(store, firstAtomId(store), 1, 1);
    store.getState().undo();

    // Reference equality: an undo hands back the snapshot itself, so nothing
    // in the store copies documents on the way in or out.
    expect(store.getState().document).toBe(original);
  });
});

describe("selection", () => {
  it("records no undo entry for any selection change", () => {
    const store = makeStore();
    const [a, b] = store.getState().document.molecule.atomIds;
    if (!a || !b) throw new Error("benzene should have six atoms");

    store.getState().selectAtoms([a]);
    store.getState().addToSelection({ atomIds: [b] });
    store.getState().toggleAtom(a);
    store.getState().selectAll();
    store.getState().clearSelection();

    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().canUndo()).toBe(false);
  });

  it("keeps the same selection object when nothing changes", () => {
    const store = makeStore();
    const a = firstAtomId(store);

    store.getState().selectAtoms([a]);
    const selection = store.getState().selection;
    // Re-selecting the same atom, and selecting it twice over, must not mint a
    // new value: the history compares snapshots with `===`.
    store.getState().selectAtoms([a]);
    expect(store.getState().selection).toBe(selection);
    store.getState().selectAtoms([a, a]);
    expect(store.getState().selection).toBe(selection);
  });

  it("prunes deleted atoms and restores the selection on undo", () => {
    const store = makeStore();
    const [a, b] = store.getState().document.molecule.atomIds;
    if (!a || !b) throw new Error("benzene should have six atoms");

    store.getState().selectAtoms([a, b]);
    const before = store.getState().selection;

    store
      .getState()
      .applyMoleculeEdit("Erase", (mol) => guardedOps.removeAtoms(mol, [a]));

    expect(store.getState().selection.atomIds).toEqual([b]);
    // The bonds at the erased atom went with it, so their ids are gone too.
    expect(store.getState().isAtomSelected(a)).toBe(false);

    // One entry, one undo: the atoms and the selection come back together.
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().selection).toBe(before);
    expect(store.getState().isAtomSelected(a)).toBe(true);
  });

  it("prunes an id that names an Object.prototype member", () => {
    const store = makeStore();
    const a = firstAtomId(store);
    // Not a synthetic worry: `decodeDocument` accepts an atom whose id is
    // "constructor", so a dropped file can put one in a selection. A prune
    // written as `id in molecule.atoms` walks the prototype chain and keeps
    // it, and the next drag over the selection dies inside `setAtomPositions`
    // with a `Object` function where an atom should be.
    const ghost = "constructor" as AtomId;
    store.getState().selectAtoms([a, ghost]);

    moveTo(store, a, 4, 4);

    expect(store.getState().selection.atomIds).toEqual([a]);
    expect(store.getState().isAtomSelected(ghost)).toBe(false);
  });

  it("selects every atom and bond in insertion order", () => {
    const store = makeStore();
    const molecule = store.getState().document.molecule;

    store.getState().selectAll();

    expect(store.getState().selection.atomIds).toEqual(molecule.atomIds);
    expect(store.getState().selection.bondIds).toEqual(molecule.bondIds);
  });
});

describe("tools", () => {
  it("stays on the chosen tool across edits", () => {
    const store = makeStore();
    const id = firstAtomId(store);

    store.getState().setTool("bond");
    moveTo(store, id, 1, 1);
    moveTo(store, id, 2, 2);
    store.getState().undo();

    expect(store.getState().tool).toBe("bond");
  });

  it("returns to select on escape, clearing the element buffer and palette", () => {
    const store = makeStore();

    store.getState().setTool("element");
    store.getState().setElementInputBuffer("Cl");
    store.getState().setCommandPaletteOpen(true);

    store.getState().escape();

    expect(store.getState().tool).toBe("select");
    expect(store.getState().ui.elementInputBuffer).toBe("");
    expect(store.getState().ui.commandPaletteOpen).toBe(false);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("remembers tool options across a tool change", () => {
    const store = makeStore();

    store.getState().setToolOption("bondOrder", 2);
    store.getState().setToolOption("element", "N");
    store.getState().setTool("eraser");
    store.getState().setTool("bond");

    expect(store.getState().toolOptions.bondOrder).toBe(2);
    expect(store.getState().toolOptions.element).toBe("N");
    expect(store.getState().history.past).toHaveLength(0);
  });
});

describe("viewport", () => {
  it("records no undo entry and survives an undo unchanged", () => {
    const store = makeStore();
    const id = firstAtomId(store);

    store.getState().panBy({ x: 120, y: -40 });
    store.getState().setZoom(2);
    const viewport = store.getState().viewport;
    expect(store.getState().history.past).toHaveLength(0);

    moveTo(store, id, 1, 1);
    store.getState().undo();

    // Ctrl+Z takes back the edit, not the pan: the canvas must not jump under
    // the cursor when a mistake is undone.
    expect(store.getState().viewport).toBe(viewport);
    expect(store.getState().viewport.zoom).toBe(2);
    // panBy ran at zoom 1, so the pan is the raw screen delta; setZoom is
    // centre-anchored and leaves it alone.
    expect(store.getState().viewport.pan).toEqual({ x: 120, y: -40 });
  });

  it("keeps the measured size across a reset", () => {
    const store = createEditorStore({ viewportSize: { width: 1024, height: 768 } });

    store.getState().panBy({ x: 10, y: 10 });
    store.getState().resetViewport();

    expect(store.getState().viewport.size).toEqual({ width: 1024, height: 768 });
    expect(store.getState().viewport.pan).toEqual({ x: 0, y: 0 });
    expect(store.getState().viewport.zoom).toBe(1);
  });

  it("resets to the zoom it is given, which is how Publication reads 100%", () => {
    const store = createEditorStore({ viewportSize: { width: 1024, height: 768 } });

    store.getState().panBy({ x: 10, y: 10 });
    store.getState().resetViewport(44 / 24);

    expect(store.getState().viewport.pan).toEqual({ x: 0, y: 0 });
    expect(store.getState().viewport.zoom).toBeCloseTo(44 / 24, 12);
    // Already there: no new viewport, so nothing re-renders for it.
    const settled = store.getState().viewport;
    store.getState().resetViewport(44 / 24);
    expect(store.getState().viewport).toBe(settled);
  });

  it("rescales for a redrawn scene without an undo entry (decision 107)", () => {
    const store = makeStore();
    store.getState().panBy({ x: 88, y: -44 });
    store.getState().setZoom(2);
    const past = store.getState().history.past.length;

    store.getState().rescaleViewport(24 / 44);

    expect(store.getState().viewport.zoom).toBeCloseTo(2 * (44 / 24), 12);
    expect(store.getState().viewport.pan.x).toBeCloseTo(48, 12);
    expect(store.getState().viewport.pan.y).toBeCloseTo(-24, 12);
    expect(store.getState().history.past).toHaveLength(past);
  });
});

describe("documents and panels", () => {
  it("makes opening a document undoable", () => {
    const store = makeStore();
    const previous = store.getState().document;
    const dropped: SketchDocument = createDocument({
      molecule: ethanol(),
      title: "Dropped file",
      now: "2024-06-01T12:00:00.000Z",
    });

    store.getState().selectAtoms([firstAtomId(store)]);
    store.getState().openDocument(dropped);

    expect(store.getState().document).toBe(dropped);
    expect(store.getState().selection.atomIds).toEqual([]);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document).toBe(previous);
    expect(store.getState().selection.atomIds).toHaveLength(1);
  });

  it("RESTORES a document without making it undoable, and forgets the history", () => {
    // `loadDocument` is the reload path, not the import path, and the
    // difference is the whole reason it exists. Restoring a saved sketch
    // through `openDocument` would push an entry whose base is the empty
    // startup document, so the first Ctrl+Z after a reload would wipe the
    // canvas — and autosave would then persist the empty document over the
    // good one.
    const store = makeStore();
    store.getState().applyMoleculeEdit("Retype", (m) =>
      guardedOps.setElement(m, firstAtomId(store), "N"),
    );
    expect(store.getState().canUndo()).toBe(true);

    const restored: SketchDocument = createDocument({
      molecule: ethanol(),
      title: "Restored from storage",
      now: "2024-06-01T12:00:00.000Z",
    });
    store.getState().selectAtoms([firstAtomId(store)]);
    store.getState().loadDocument(restored);

    expect(store.getState().document).toBe(restored);
    expect(store.getState().selection.atomIds).toEqual([]);
    // No entry pushed, and the entries that were there described a document
    // that is no longer loaded.
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(false);
    expect(store.getState().history.past).toHaveLength(0);
  });

  describe("a title renamed in another tab", () => {
    function retypeFirstAtom(store: EditorStore, element: "N" | "O"): void {
      store
        .getState()
        .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, firstAtomId(store), element));
    }

    function firstElement(store: EditorStore): string {
      return requireAtom(store.getState().document.molecule, firstAtomId(store)).element;
    }

    it("is adopted without an undo step, and no undo or redo brings the old title back", () => {
      // Pyridine from benzene: the retype is the edit, the rename is news.
      const store = makeStore();
      retypeFirstAtom(store, "N");
      const selection = store.getState().selection;
      const modifiedAt = store.getState().document.metadata.modifiedAt;

      store.getState().adoptDocumentTitle("Pyridine");
      expect(store.getState().document.metadata.title).toBe("Pyridine");
      expect(store.getState().document.metadata.modifiedAt).toBe(modifiedAt);
      expect(store.getState().history.past).toHaveLength(1);
      expect(store.getState().undoLabel()).toBe("Retype");
      expect(store.getState().selection).toBe(selection);

      // Undoing the RETYPE restores the carbon, not the title it was made under.
      expect(store.getState().undo()).toBe(true);
      expect(firstElement(store)).toBe("C");
      expect(store.getState().document.metadata.title).toBe("Pyridine");
      expect(store.getState().redo()).toBe(true);
      expect(firstElement(store)).toBe("N");
      expect(store.getState().document.metadata.title).toBe("Pyridine");
    });

    it("is a no-op that keeps every reference when the title already matches", () => {
      const store = makeStore();
      const before = store.getState();
      store.getState().adoptDocumentTitle(before.document.metadata.title);
      expect(store.getState().document).toBe(before.document);
      expect(store.getState().history).toBe(before.history);
    });

    it("drops the title-only steps it leaves doing nothing, in the past and the future", () => {
      const store = makeStore();
      store.getState().setDocumentTitle("P");
      store.getState().setDocumentTitle("Py");
      retypeFirstAtom(store, "N");
      store.getState().setDocumentTitle("Pyr");
      retypeFirstAtom(store, "O");
      // Undo the oxygen AND the "Pyr" keystroke, so the redo stack has a
      // title-only step too.
      store.getState().undo();
      store.getState().undo();
      expect(store.getState().history.past).toHaveLength(3);
      expect(store.getState().history.future).toHaveLength(2);

      store.getState().adoptDocumentTitle("Pyridine");
      // Two keystrokes before the retype and one after it would each be an
      // undo that visibly does nothing.
      expect(store.getState().history.past.map((e) => e.label)).toEqual(["Retype"]);
      expect(store.getState().history.future.map((e) => e.label)).toEqual(["Retype"]);

      expect(store.getState().redo()).toBe(true);
      expect(firstElement(store)).toBe("O");
      expect(store.getState().document.metadata.title).toBe("Pyridine");
      store.getState().undo();
      expect(store.getState().undo()).toBe(true);
      expect(firstElement(store)).toBe("C");
      expect(store.getState().document.metadata.title).toBe("Pyridine");
      expect(store.getState().canUndo()).toBe(false);
    });

    it("lands mid-gesture without turning the gesture into a step or reverting on abort", () => {
      const store = makeStore();
      const id = firstAtomId(store);

      // A click that never moves commits as nothing, rename or not: the
      // transaction base and the current state still share one document.
      store.getState().beginTransaction("Move atom");
      store.getState().adoptDocumentTitle("Cyclohexatriene");
      store.getState().commitTransaction();
      expect(store.getState().history.past).toHaveLength(0);

      store.getState().beginTransaction("Move atom");
      moveTo(store, id, 5, 5);
      store.getState().adoptDocumentTitle("Benzene, moved");
      moveTo(store, id, 6, 6);
      store.getState().abortTransaction();
      expect(posOf(store, id)).not.toEqual({ x: 6, y: 6 });
      expect(store.getState().document.metadata.title).toBe("Benzene, moved");
    });
  });

  it("adds, captions, reorders and removes panels as undoable steps", () => {
    const store = makeStore();
    const initial = store.getState().document.panels;

    const added = store.getState().addPanel("lewis");
    expect(store.getState().document.panels).toHaveLength(initial.length + 1);

    store.getState().setPanelCaption(added, "Figure 1");
    const captioned = store
      .getState()
      .document.panels.find((panel) => panel.id === added);
    expect(captioned?.caption).toBe("Figure 1");

    store.getState().setPanelCaption(added, null);
    const uncaptioned = store
      .getState()
      .document.panels.find((panel) => panel.id === added);
    // Absent, not present-and-undefined: a saved document must never carry a
    // key whose value is `undefined`.
    expect(uncaptioned && "caption" in uncaptioned).toBe(false);

    const order = store
      .getState()
      .document.panels.map((panel) => panel.id)
      .reverse();
    store.getState().reorderPanels(order);
    expect(store.getState().document.panels.map((panel) => panel.id)).toEqual(
      order,
    );

    store.getState().removePanel(added);
    expect(store.getState().document.panels).toHaveLength(initial.length);

    // Add, caption, uncaption, reorder, remove: five steps back to the start.
    for (let i = 0; i < 5; i += 1) store.getState().undo();
    expect(store.getState().document.panels).toBe(initial);
    expect(store.getState().canUndo()).toBe(false);
  });

  it("moves a panel one step at a time, and ignores a move off either end", () => {
    const store = makeStore();
    const added = store.getState().addPanel("lewis");
    const ids = (): string[] => store.getState().document.panels.map((p) => p.id);
    const [first, second] = ids();
    expect(ids()).toEqual([first, second, added]);

    store.getState().movePanel(added, -1);
    expect(ids()).toEqual([first, added, second]);
    const pastBefore = store.getState().history.past.length;
    store.getState().movePanel(first!, -1);
    store.getState().movePanel(second!, 1);
    expect(store.getState().history.past).toHaveLength(pastBefore);

    store.getState().undo();
    expect(ids()).toEqual([first, second, added]);
  });

  it("sets and resets the figure column count as an undoable document edit", () => {
    const store = makeStore();
    expect(store.getState().document.figure).toBeUndefined();
    store.getState().setFigureColumns(2);
    expect(store.getState().document.figure).toEqual({ columns: 2 });
    const past = store.getState().history.past.length;
    store.getState().setFigureColumns(2);
    expect(store.getState().history.past).toHaveLength(past);
    store.getState().setFigureColumns(null);
    expect(Object.hasOwn(store.getState().document, "figure")).toBe(false);
    store.getState().undo();
    expect(store.getState().document.figure).toEqual({ columns: 2 });
  });

  it("keeps the active panel out of history", () => {
    const store = makeStore();
    store.getState().setActivePanel("panel-sum-formula");
    expect(store.getState().ui.activePanelId).toBe("panel-sum-formula");
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("ignores a reorder that is not a permutation", () => {
    const store = makeStore();
    const panels = store.getState().document.panels;
    const first = panels[0];
    if (!first) throw new Error("a fresh document should have panels");

    store.getState().reorderPanels([first.id]);

    // Honouring a short list would silently delete the panels it forgot.
    expect(store.getState().document.panels).toBe(panels);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("makes the style preset and the title undoable", () => {
    const store = makeStore();

    store.getState().setStylePreset("publication");
    store.getState().setDocumentTitle("Aspirin synthesis");
    expect(store.getState().history.past).toHaveLength(2);

    store.getState().undo();
    expect(store.getState().document.metadata.title).toBe("Untitled");
    store.getState().undo();
    expect(store.getState().document.stylePreset).toBe("screen");
  });
});

describe("draft safety", () => {
  it("throws when an edit hands chem-core an immer draft", () => {
    const store = makeStore();
    const id = firstAtomId(store);
    const before = store.getState().document;

    expect(() =>
      store.getState().applyMoleculeEdit("Sabotage", (mol) =>
        produce(mol, (draft) => {
          // The cast is the point: this is exactly the mistake the guard
          // exists to catch, and TypeScript alone would not have stopped it.
          guardedOps.removeAtoms(draft as unknown as Molecule, [id]);
        }),
      ),
    ).toThrow(/removeAtoms received an immer draft/);

    // The throw escaped before anything was written, so the document and the
    // history are untouched.
    expect(store.getState().document).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("throws when the store is constructed on a draft document", () => {
    const document = createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" });
    const draft = createDraft(document as unknown as Record<string, unknown>);

    // The one route a draft can actually take into the state: `get()` never
    // returns one, recipe or not, so everything else the store holds is a
    // value it computed itself.
    expect(() =>
      createEditorStore({ document: draft as unknown as SketchDocument }),
    ).toThrow(/createEditorStore\(document\) received an immer draft/);
  });

  it("throws when an edit returns a draft instead of a finished molecule", () => {
    const store = makeStore();
    const before = store.getState().document;
    // `createDraft` produces the same proxy a half-written recipe would leak.
    // Storing it would put a revocable proxy in the document, and every later
    // read of it would throw somewhere unrelated.
    const leaked = createDraft(store.getState().document.molecule);

    expect(() =>
      store
        .getState()
        .applyMoleculeEdit("Leak", () => leaked as unknown as Molecule),
    ).toThrow(/applyMoleculeEdit\(Leak\) received an immer draft/);

    expect(store.getState().document).toBe(before);
    expect(isDraft(store.getState().document.molecule)).toBe(false);
  });
});
