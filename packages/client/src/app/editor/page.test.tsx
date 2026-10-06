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

// The worker cannot run under jsdom. `open.ts` imports the bridge dynamically,
// and this stands in for it: any SMILES reads as benzene, except "bad".
vi.mock("@/lib/rdkit", async () => {
  const { benzene: drawBenzene } = await import("@starter/chem-core");
  return {
    fromSmiles: (smiles: string) =>
      Promise.resolve(
        smiles === "bad"
          ? { ok: false, error: { kind: "parse-failed", message: "SMILES Parse Error" } }
          : { ok: true, value: { molecule: drawBenzene(), title: "" }, report: { warnings: [] } },
      ),
  };
});

import { moleculeToMolblock } from "@/lib/rdkit/translate";
import { MAX_FRAGMENT_LENGTH } from "@/lib/io/fragment";
import { EXAMPLE_VIEWS, exampleDocument } from "@/components/landing/example-document";

import EditorPage, { documentIdFromSearch, exampleFromSearch } from "./editor-page";

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
/** Saved in Screen, the way every sketch was before decision 135. */
const SAVED_IN_SCREEN = createDocument({
  id: "doc_screen",
  title: "Saved in Screen",
  molecule: benzene(),
  stylePreset: "screen",
});

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

  it("reopens a sketch saved in Screen in Screen (decision 135)", async () => {
    // New documents open in Publication now. A sketch stored before that
    // stored "screen" and keeps it: the new default fills no gap here.
    await store.put(recordFor(SAVED_IN_SCREEN));
    const page = visit(`?doc=${SAVED_IN_SCREEN.id}`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(SAVED_IN_SCREEN.id);
    });
    expect(editorStore.getState().document.stylePreset).toBe("screen");
    page.unmount();
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

/**
 * `?example=landing` — the landing figure, opened as a sketch of the
 * visitor's own (decision 127).
 */
describe("/editor?example=<name>", () => {
  function freshMount(search: string) {
    editorStore.getState().loadDocument(startupDocument());
    editorStore.getState().setStatusMessage(null);
    return visit(search);
  }

  async function opened(): Promise<void> {
    await waitFor(() => {
      expect(editorStore.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
    });
  }

  it("opens the landing figure's document under an id of this tab's own", async () => {
    const page = freshMount("?example=landing");
    await opened();

    const doc = editorStore.getState().document;
    const example = exampleDocument();
    // The same sketch the visitor was looking at …
    expect(doc.metadata.title).toBe("Acetic acid");
    expect(doc.panels.map((panel) => panel.representation.kind)).toEqual([...EXAMPLE_VIEWS]);
    expect(doc.panels).toEqual(example.panels);
    expect(doc.figure).toEqual(example.figure);
    expect(doc.stylePreset).toBe(example.stylePreset);
    expect(doc.molecule.atomIds).toHaveLength(4);
    // … but not the build-time id, which is the same in every browser.
    expect(doc.id).not.toBe(example.id);
    page.unmount();
  });

  it("stores nothing until the first edit, then stores it under the new id", async () => {
    const page = freshMount("?example=landing");
    await opened();

    await expect(flushEditorDocument()).resolves.toBeNull();
    const untouched = await store.listMeta();
    expect(untouched.ok && untouched.value.map((meta) => meta.id).sort()).toEqual(
      [FIRST.id, SECOND.id].sort(),
    );

    const id = editorStore.getState().document.id;
    editorStore
      .getState()
      .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    const result = await flushEditorDocument();
    expect(result?.ok).toBe(true);
    page.unmount();

    const reread = await store.get(id);
    expect(reread.ok && reread.value.metadata.title).toBe("Acetic acid");
    expect(reread.ok && reread.value.panels).toHaveLength(EXAMPLE_VIEWS.length);
    expect((await store.get(exampleDocument().id)).ok).toBe(false);
  });

  it("is one undo away from the placeholder, which writes nothing", async () => {
    const page = freshMount("?example=landing");
    await opened();
    editorStore.getState().undo();
    expect(editorStore.getState().document.id).toBe(STARTUP_DOCUMENT_ID);
    await expect(flushEditorDocument()).resolves.toBeNull();
    page.unmount();
  });

  it("opens the editor as usual for an unknown name, and says so", async () => {
    const page = freshMount("?example=nope");
    await opened();
    expect(editorStore.getState().document.metadata.title).toBe("Benzene");
    // As a bare /editor does: a new sketch, in Publication (decision 135).
    expect(editorStore.getState().document.stylePreset).toBe("publication");
    expect(editorStore.getState().ui.statusMessage).toBe(
      "There is no example called “nope”. The editor opened a new sketch.",
    );
    page.unmount();
  });

  it("gives way to ?doc=, which names stored work", async () => {
    const page = freshMount(`?doc=${FIRST.id}&example=landing`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(FIRST.id);
    });
    page.unmount();
  });
});

describe("exampleFromSearch", () => {
  it("asks for nothing without a name", () => {
    expect(exampleFromSearch("")).toEqual({ kind: "none" });
    expect(exampleFromSearch("?example=")).toEqual({ kind: "none" });
    expect(exampleFromSearch("?example=%20")).toEqual({ kind: "none" });
  });

  it("mints a new id on every call, so two clicks are two sketches", () => {
    const first = exampleFromSearch("?example=landing");
    const second = exampleFromSearch("?example=landing");
    expect(first.kind === "found" && second.kind === "found").toBe(true);
    if (first.kind !== "found" || second.kind !== "found") return;
    expect(first.document.id).not.toBe(second.document.id);
  });

  it("does not read Object.prototype as a table of examples", () => {
    expect(exampleFromSearch("?example=toString").kind).toBe("unknown");
    expect(exampleFromSearch("?example=__proto__").kind).toBe("unknown");
  });

  it("clips a long name before repeating it on the status line", () => {
    const result = exampleFromSearch(`?example=${"x".repeat(500)}`);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") return;
    expect(result.message).toContain(`“${"x".repeat(39)}…”`);
    expect(result.message.length).toBeLessThan(120);
  });
});

/** `#smiles=` / `#molfile=` — a structure carried in the link (decision 230). */
describe("/editor#<format>=<structure>", () => {
  function freshMount(path: string) {
    editorStore.getState().loadDocument(startupDocument());
    editorStore.getState().setStatusMessage(null);
    window.history.replaceState(null, "", `/editor${path}`);
    return render(<EditorPage />);
  }

  async function opened(): Promise<void> {
    await waitFor(() => {
      expect(editorStore.getState().document.id).not.toBe(STARTUP_DOCUMENT_ID);
    });
  }

  it("opens a SMILES as a new unsaved sketch and takes it off the URL", async () => {
    const page = freshMount(`#smiles=${encodeURIComponent("c1ccccc1")}`);
    await opened();
    expect(editorStore.getState().document.molecule.atomIds).toHaveLength(6);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/editor");
    // Nothing stored until the first edit, as with ?example=.
    await expect(flushEditorDocument()).resolves.toBeNull();
    editorStore.getState().undo();
    expect(editorStore.getState().document.id).toBe(STARTUP_DOCUMENT_ID);
    page.unmount();
  });

  it("opens a molfile through chem-core's reader, keeping the query string", async () => {
    const written = moleculeToMolblock(ethanol(), "Ethanol");
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const page = freshMount(`?storage=x#molfile=${encodeURIComponent(written.value)}`);
    await opened();
    const doc = editorStore.getState().document;
    expect(doc.metadata.title).toBe("Ethanol");
    expect(doc.molecule.atomIds).toHaveLength(3);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?storage=x");
    page.unmount();
  });

  it("opens benzene and says why when the structure does not read", async () => {
    const page = freshMount("#smiles=bad");
    await opened();
    expect(editorStore.getState().document.metadata.title).toBe("Benzene");
    expect(editorStore.getState().ui.statusMessage).toBe(
      "The structure in the link could not be opened: SMILES Parse Error",
    );
    expect(window.location.hash).toBe("");
    page.unmount();
  });

  it("refuses a fragment over the size limit with a status-line message", async () => {
    const page = freshMount(`#smiles=${"C".repeat(MAX_FRAGMENT_LENGTH)}`);
    await opened();
    expect(editorStore.getState().document.metadata.title).toBe("Benzene");
    expect(editorStore.getState().ui.statusMessage).toContain("at most 100,000");
    expect(window.location.hash).toBe("");
    page.unmount();
  });

  it("gives way to ?doc=, which names stored work", async () => {
    const page = freshMount(`?doc=${FIRST.id}#smiles=CCO`);
    await waitFor(() => {
      expect(editorStore.getState().document.id).toBe(FIRST.id);
    });
    page.unmount();
  });
});
