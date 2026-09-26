/**
 * The singleton store's startup document must be IDENTICAL in every module
 * instance, because there is always more than one.
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
 */

import { describe, expect, it, vi } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { claimStartupDocument, createEditorStore, STARTUP_DOCUMENT_ID } from "./store";

/** A placeholder exactly as the singleton is constructed with one, without
 *  reaching for the singleton itself. */
function startupDocumentFrom() {
  return createDocument({ id: STARTUP_DOCUMENT_ID, now: "1970-01-01T00:00:00.000Z" });
}

async function freshStartupDocument() {
  vi.resetModules();
  const { editorStore } = await import("./store");
  return editorStore.getState().document;
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
  });

  it("does not freeze the ids of documents a page actually opens", async () => {
    const { fixtureDocument } = await import("@/canvas/fixture");

    // The opposite failure: a blanket "make every id deterministic" would make
    // two sketches collide in IndexedDB. Only the placeholder is fixed.
    expect(fixtureDocument().id).not.toBe(fixtureDocument().id);
    expect(fixtureDocument().id).not.toBe(STARTUP_DOCUMENT_ID);
  });
});

/**
 * WHAT MAKES THE SHARED ID SAFE, now that it is known not to be safe on its
 * own.
 *
 * The fixed id is the same string in every visitor's browser. A document
 * stored under it belongs to nobody: `/editor?doc=doc_startup` names a
 * different sketch on every machine, and `/editor`'s effect skips the read
 * entirely when the store already holds that id, so the stored sketch is
 * replaced by an empty canvas without a word.
 *
 * It was reachable, and measured so against the built app: opening the benzene
 * fixture is an undoable entry, one Ctrl+Z puts the placeholder back, twelve
 * atoms drawn on it were autosaved under `doc_startup`, and reopening that
 * recents card showed nothing. `claimStartupDocument` closes it by making the
 * id a rendering constant that never outlives hydration.
 */
describe("claiming the startup document", () => {
  it("mints an id of this tab's own, once", () => {
    const store = createEditorStore({ document: startupDocumentFrom() });

    expect(claimStartupDocument(store)).toBe(true);
    const claimed = store.getState().document;
    expect(claimed.id).not.toBe(STARTUP_DOCUMENT_ID);

    // Idempotent: StrictMode mounts the effect twice and a Fast Refresh
    // re-runs it, and neither may mint over the document already open.
    expect(claimStartupDocument(store)).toBe(false);
    expect(store.getState().document.id).toBe(claimed.id);
  });

  it("refuses to touch a document a page has opened", () => {
    const opened = createDocument({ molecule: benzene(), title: "Real work" });
    const store = createEditorStore({ document: opened });

    expect(claimStartupDocument(store)).toBe(false);
    expect(store.getState().document).toBe(opened);
  });

  it("carries the placeholder's content and re-dates it", () => {
    const store = createEditorStore({ document: startupDocumentFrom() });
    const before = store.getState().document;

    claimStartupDocument(store);
    const after = store.getState().document;

    expect(after.molecule).toBe(before.molecule);
    expect(after.panels).toEqual(before.panels);
    expect(after.metadata.title).toBe(before.metadata.title);
    // The epoch is the prerender's stand-in for "no honest creation time".
    // Once the document is this tab's own it has one, and a 1970 card in the
    // recents grid is a bug the chemist can see.
    expect(after.metadata.createdAt).not.toBe(before.metadata.createdAt);
    expect(Date.parse(after.metadata.createdAt)).toBeGreaterThan(0);
  });

  it("leaves nothing to undo back into", () => {
    const store = createEditorStore({ document: startupDocumentFrom() });
    claimStartupDocument(store);
    const claimed = store.getState().document;

    // The trap this whole test file is about: `openDocument` is undoable, so
    // whatever the store held before it is one Ctrl+Z away. Nothing may put
    // the reserved id back on the canvas.
    store.getState().openDocument(createDocument({ molecule: benzene() }), "Open Benzene");
    store.getState().undo();

    expect(store.getState().document.id).toBe(claimed.id);
    expect(store.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
  });
});
