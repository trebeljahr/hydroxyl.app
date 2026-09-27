/**
 * The singleton store's startup document: the same in every module instance,
 * and in storage in none of them.
 *
 * ── THE HYDRATION HALF ─────────────────────────────────────────────────────
 *
 * `/editor` is prerendered: `next build` evaluates `store.ts` once and bakes
 * whatever document it holds into `out/editor.html` (`TopBar` renders the id
 * as `data-doc-id`), and the browser evaluates it again on load. When the id
 * was minted from `Date.now()` and `Math.random()` the two never matched, and
 * React reported an attribute hydration mismatch it explicitly does not patch
 * up — see the log in manual notes 3.
 *
 * `vi.resetModules()` is what makes the second instance real: it drops the
 * module registry so the next `import()` constructs a fresh store, exactly as
 * the browser does after the prerender.
 *
 * ── THE DATA-LOSS HALF ─────────────────────────────────────────────────────
 *
 * The fixed id is the same string in every visitor's browser, so a document
 * stored under it belongs to nobody. It was reachable, and measured so against
 * the built app: opening the benzene fixture is an undoable entry, one Ctrl+Z
 * puts the placeholder back, twelve atoms drawn on it were autosaved under
 * `doc_startup`, and reopening that recents card showed nothing.
 *
 * Decision 85: ephemeral until the first edit. The store mints a real identity
 * as part of that edit, which is what the second half of this file pins.
 */

import { describe, expect, it, vi } from "vitest";

import { addAtom, benzene, emptyMolecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import {
  isStartupDocument,
  mintStartupIdentity,
  STARTUP_DOCUMENT_ID,
  startupDocument,
} from "./startup-document";
import { createEditorStore } from "./store";

async function freshStartupDocument() {
  vi.resetModules();
  const { editorStore } = await import("./store");
  return editorStore.getState().document;
}

/** A store opened exactly as the singleton is, without reaching for the
 *  singleton itself. */
function startupStore() {
  return createEditorStore({ document: startupDocument() });
}

describe("the startup document", () => {
  it("is the same document in two module instances", async () => {
    const first = await freshStartupDocument();
    const second = await freshStartupDocument();

    // The id is the one that reaches the DOM, so it is the one that matters;
    // the timestamps are asserted too because `metadata` is one `Date.now()`
    // away from being rendered somewhere as well.
    expect(second.id).toBe(first.id);
    expect(second.metadata.createdAt).toBe(first.metadata.createdAt);
    expect(second.metadata.modifiedAt).toBe(first.metadata.modifiedAt);
  });

  it("carries the reserved placeholder id and an empty molecule", async () => {
    const doc = await freshStartupDocument();

    expect(doc.id).toBe(STARTUP_DOCUMENT_ID);
    expect(doc.molecule.atomIds).toHaveLength(0);
    expect(isStartupDocument(doc)).toBe(true);
  });

  it("does not freeze the ids of documents a page actually opens", async () => {
    const { fixtureDocument } = await import("@/canvas/fixture");

    // The opposite failure: a blanket "make every id deterministic" would make
    // two sketches collide in IndexedDB. Only the placeholder is fixed.
    expect(fixtureDocument().id).not.toBe(fixtureDocument().id);
    expect(fixtureDocument().id).not.toBe(STARTUP_DOCUMENT_ID);
    expect(isStartupDocument(fixtureDocument())).toBe(false);
  });
});

describe("minting the startup identity", () => {
  it("replaces the reserved id and re-dates the document", () => {
    const before = startupDocument();
    const after = mintStartupIdentity(before, "2024-05-05T10:00:00.000Z");

    expect(after.id).not.toBe(STARTUP_DOCUMENT_ID);
    expect(after.metadata.createdAt).toBe("2024-05-05T10:00:00.000Z");
    expect(after.metadata.modifiedAt).toBe("2024-05-05T10:00:00.000Z");
    // The CONTENT is carried, not rebuilt: a startup document that was not
    // empty would otherwise be silently discarded at the mint.
    expect(after.molecule).toBe(before.molecule);
    expect(after.panels).toBe(before.panels);
    expect(after.metadata.title).toBe(before.metadata.title);
  });

  it("leaves a document that already has an identity alone", () => {
    const opened = createDocument({ molecule: benzene(), title: "Real work" });
    expect(mintStartupIdentity(opened, "2024-05-05T10:00:00.000Z")).toBe(opened);
  });

  it("mints ids that differ from each other", () => {
    const a = mintStartupIdentity(startupDocument(), "2024-05-05T10:00:00.000Z");
    const b = mintStartupIdentity(startupDocument(), "2024-05-05T10:00:00.000Z");
    expect(a.id).not.toBe(b.id);
  });
});

describe("the store's first edit", () => {
  it("mints an identity, in the same entry as the edit", () => {
    const store = startupStore();
    expect(store.getState().document.id).toBe(STARTUP_DOCUMENT_ID);

    store.getState().applyMoleculeEdit("Add atom", (m) => addAtom(m, { element: "C", pos: { x: 0, y: 0 } }).molecule);

    const edited = store.getState().document;
    expect(edited.id).not.toBe(STARTUP_DOCUMENT_ID);
    expect(edited.molecule.atomIds).toHaveLength(1);
    // ONE undo entry, not two. The mint is part of the edit; a separate entry
    // would put the reserved id one Ctrl+Z away from being the saved document
    // again, which is the trap this whole file is about.
    expect(store.getState().history.past).toHaveLength(1);
  });

  it("keeps the minted identity for every later edit", () => {
    const store = startupStore();
    store.getState().applyMoleculeEdit("Add atom", (m) => addAtom(m, { element: "C", pos: { x: 0, y: 0 } }).molecule);
    const minted = store.getState().document.id;

    store.getState().applyMoleculeEdit("Add atom", (m) => addAtom(m, { element: "O", pos: { x: 1, y: 0 } }).molecule);
    store.getState().setDocumentTitle("Glycine");
    store.getState().setStylePreset("publication");

    expect(store.getState().document.id).toBe(minted);
  });

  it("mints on a non-molecule edit too", () => {
    // A retitle is as much "the chemist has started" as a stroke is, and it
    // is just as much a document worth keeping.
    const store = startupStore();
    store.getState().setDocumentTitle("Glycine");
    expect(store.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
  });

  it("does not mint for a document a page opens", () => {
    // `openDocument` arrives with an identity of its own and must keep it:
    // opening the benzene fixture is what a bare `/editor` does on mount, and
    // the fixture's id is the one the recents card will carry.
    const store = startupStore();
    const fixture = createDocument({ molecule: benzene(), title: "Benzene" });
    store.getState().openDocument(fixture, "Open Benzene");

    expect(store.getState().document.id).toBe(fixture.id);
  });

  it("puts the placeholder back on an undo, which is the point", () => {
    // The mount sequence that caused the data loss, end to end. Undoing the
    // fixture the editor opened with lands back on the placeholder — and that
    // is SAFE now, because nothing will write it: see
    // `persistence/autosave.ts`'s `persistable`.
    const store = startupStore();
    store.getState().openDocument(createDocument({ molecule: benzene() }), "Open Benzene");
    store.getState().undo();

    const back = store.getState().document;
    expect(back.id).toBe(STARTUP_DOCUMENT_ID);
    expect(isStartupDocument(back)).toBe(true);

    // And the next stroke gives it an identity, so the work is not stranded.
    store.getState().applyMoleculeEdit("Add atom", (m) => addAtom(m, { element: "N", pos: { x: 0, y: 0 } }).molecule);
    expect(store.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
  });

  it("does not mint on an edit that changes nothing", () => {
    const store = startupStore();
    // chem-core returns the input when an op changes nothing, and the store
    // records nothing for it. A mint there would give the untouched editor an
    // identity — and a recents card — for a gesture that drew no atom.
    store.getState().applyMoleculeEdit("No-op", (m) => m);
    expect(store.getState().document.id).toBe(STARTUP_DOCUMENT_ID);
    expect(store.getState().document.molecule).toEqual(emptyMolecule());
    expect(store.getState().history.past).toHaveLength(0);
  });
});
