import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { benzene, buildMolecule, vec } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createMemoryDocumentStore, type MemoryDocumentStore } from "@/persistence/memory-store";
import { setDocumentStore } from "@/persistence/documents";
import { recordFor } from "@/persistence/record";
import { flushEditorDocument, resetEditorPersistence } from "@/persistence/session";
import { editorStore, guardedOps, STARTUP_DOCUMENT_ID, startupDocument } from "@/state";

// The shell is the canvas, the rails and the panels — none of which decide
// which document is open. What is under test is the page's mount effect.
vi.mock("@/shell", () => ({ EditorShell: () => null }));

// The page installs the real IndexedDB store on mount (`setDocumentStore(null)`
// clears any `?storage=` override), and jsdom has no IndexedDB. Only the
// page's own call is neutralised; the store this file installs through
// `@/persistence/documents` is the one every read and write goes to.
vi.mock("@/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/persistence")>()),
  setDocumentStore: () => undefined,
}));

import EditorPage, { documentIdFromSearch } from "./page";

function ethanol() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1.5, 0));
    const o = b.atom("O", vec(2.25, 1.3));
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

const FIRST = createDocument({ id: "doc_first", title: "Ethanol", molecule: ethanol() });
const SECOND = createDocument({ id: "doc_second", title: "Benzene", molecule: benzene() });

let store: MemoryDocumentStore;

beforeEach(async () => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
  await store.put(recordFor(FIRST));
  await store.put(recordFor(SECOND));
});

afterEach(() => {
  resetEditorPersistence();
  setDocumentStore(null);
  window.history.replaceState(null, "", "/");
});

function visit(search: string) {
  window.history.replaceState(null, "", `/editor${search}`);
  return render(<EditorPage />);
}

describe("/editor?doc=<id>", () => {
  it("opens THAT document on a second visit in the same tab, not the leftover", async () => {
    // `editorStore` is a module singleton and survives a client-side
    // navigation. The load used to run only into an EMPTY molecule, so any
    // earlier visit left the canvas non-empty, the read was skipped, and the
    // leftover was baselined under the old id: the URL named one sketch, the
    // canvas showed another, and the first edit forked a new record.
    const first = visit(`?doc=${FIRST.id}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(FIRST.id);
    });
    first.unmount();

    visit(`?doc=${SECOND.id}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(SECOND.id);
    });
    expect(editorStore.getState().document.molecule.atomIds).toHaveLength(6);

    // And the first edit lands on the document the URL names, not a fork.
    editorStore
      .getState()
      .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    const result = await flushEditorDocument();
    expect(result?.ok).toBe(true);

    const listed = await store.listMeta();
    expect(listed.ok && listed.value.map((meta) => meta.id).sort()).toEqual(
      [FIRST.id, SECOND.id].sort(),
    );
    const reread = await store.get(SECOND.id);
    expect(reread.ok && reread.value.molecule.atoms[reread.value.molecule.atomIds[0]!]?.element).toBe(
      "N",
    );
  });
});

/**
 * THE STARTUP DOCUMENT NEVER REACHES STORAGE (decision 85).
 *
 * `doc_startup` is a rendering constant, not a document identity: the store
 * opens with it so that the prerendered `data-doc-id` and the browser's agree.
 * It is the same string in every visitor's browser, so a record under it
 * belongs to nobody — and it was reachable, measured against the built app.
 * Opening the benzene fixture is an UNDOABLE entry, so one Ctrl+Z after the
 * editor mounts put the placeholder back on the canvas, twelve atoms drawn on
 * it were autosaved under `doc_startup`, and reopening that recents card
 * showed an empty canvas.
 */
describe("the startup document", () => {
  /** The store as a freshly-evaluated module gives it. */
  function reopenUntouched(): void {
    editorStore.getState().loadDocument(startupDocument());
  }

  it("writes nothing when the editor is opened and undone back to it", async () => {
    reopenUntouched();
    const page = visit("");
    await waitFor(() => {
      expect(editorStore.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
    });

    // The stray gesture: opening the fixture is an undoable entry, so one
    // Ctrl+Z lands back on the placeholder.
    editorStore.getState().undo();
    expect(editorStore.getState().document.id).toBe(STARTUP_DOCUMENT_ID);

    await expect(flushEditorDocument()).resolves.toBeNull();
    page.unmount();

    const listed = await store.listMeta();
    expect(listed.ok && listed.value.map((meta) => meta.id).sort()).toEqual(
      [FIRST.id, SECOND.id].sort(),
    );
  });

  it("gains an identity of its own at the first stroke, and is saved under it", async () => {
    reopenUntouched();
    const page = visit("");
    await waitFor(() => {
      expect(editorStore.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
    });
    editorStore.getState().undo();

    editorStore
      .getState()
      .applyMoleculeEdit("Draw", (m) => guardedOps.addAtom(m, { element: "C" }).molecule);
    const minted = editorStore.getState().document.id;
    expect(minted).not.toBe(STARTUP_DOCUMENT_ID);

    const result = await flushEditorDocument();
    expect(result?.ok).toBe(true);
    page.unmount();

    const listed = await store.listMeta();
    expect(listed.ok && listed.value.map((meta) => meta.id).sort()).toEqual(
      [FIRST.id, SECOND.id, minted].sort(),
    );
  });

  it("is not a document the URL can name, so ?doc= cannot overwrite one", async () => {
    // A record an older build left under the reserved key — the failure this
    // decision exists for. Nothing may read it, replace it or delete it.
    const stray = createDocument({ id: STARTUP_DOCUMENT_ID, title: "Someone's work", molecule: ethanol() });
    await store.put(recordFor(stray));

    reopenUntouched();
    const page = visit(`?doc=${STARTUP_DOCUMENT_ID}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
    });
    // A bare `/editor`, which is what the URL amounts to: the fixture, not an
    // empty canvas wearing the reserved id.
    expect(editorStore.getState().document.molecule.atomIds.length).toBeGreaterThan(0);

    editorStore
      .getState()
      .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await flushEditorDocument();
    page.unmount();

    const reread = await store.get(STARTUP_DOCUMENT_ID);
    expect(reread.ok && reread.value.metadata.title).toBe("Someone's work");
    expect(reread.ok && reread.value.molecule.atomIds).toHaveLength(3);
  });
});

describe("documentIdFromSearch", () => {
  it("reads the id the URL names", () => {
    expect(documentIdFromSearch("?doc=doc_x")).toBe("doc_x");
  });

  it("answers null for no id, an empty id and the reserved placeholder", () => {
    expect(documentIdFromSearch("")).toBeNull();
    expect(documentIdFromSearch("?doc=")).toBeNull();
    expect(documentIdFromSearch("?doc=   ")).toBeNull();
    expect(documentIdFromSearch(`?doc=${STARTUP_DOCUMENT_ID}`)).toBeNull();
  });
});
