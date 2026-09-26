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

import { STARTUP_DOCUMENT_ID } from "./store";

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
    // Emptiness is what makes the fixed id safe: `/editor` opens the benzene
    // fixture — with a freshly minted id — whenever the store holds an empty
    // molecule and the URL names no document, so nothing is ever SAVED under
    // the shared id.
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
