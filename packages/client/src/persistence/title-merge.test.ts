/**
 * A rename made in another tab against the open editor's writes.
 *
 * The bug this pins: the editor wrote its whole document back on every
 * autosave, stale title included, so renaming a card in the recents grid while
 * the sketch was open elsewhere lasted only until that tab's next edit. The
 * store half is proven against the memory store, which shares `mergeTitle`
 * with the IndexedDB one; the browser half is in e2e/persistence.spec.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createEditorStore, guardedOps, type EditorStore } from "@/state";

import { documentStore, loadDocument, renameDocument, saveDocument, setDocumentStore } from "./documents";
import { createMemoryDocumentStore } from "./memory-store";
import { recordFor } from "./record";
import { resetSaveState, saveState } from "./save-state";
import {
  baselineEditorDocument,
  flushEditorDocument,
  learnStoredTitle,
  resetEditorPersistence,
  saveEditorDocumentNow,
  startEditorPersistence,
} from "./session";
import { storedTitleOf } from "./title-merge";

function benzeneDoc(title = "Benzene") {
  return createDocument({ id: "doc_1", molecule: benzene(), title });
}

async function storedTitle(id = "doc_1"): Promise<string | undefined> {
  const read = await loadDocument(id);
  const listed = await documentStore().listMeta();
  const meta = listed.ok ? listed.value.find((row) => row.id === id) : undefined;
  // Both halves, or the grid and the editor could disagree.
  expect(read.ok && read.value.metadata.title).toBe(meta?.title);
  return meta?.title;
}

function retypeFirstAtom(editor: EditorStore, element: "N" | "O"): void {
  editor
    .getState()
    .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, element));
}

beforeEach(() => {
  localStorage.clear();
  resetEditorPersistence();
  resetSaveState();
  setDocumentStore(createMemoryDocumentStore());
});

describe("a put's title", () => {
  it("keeps a title renamed elsewhere when the writer never changed its own", async () => {
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc()));
    await store.rename("doc_1", "Cyclohexatriene");

    const put = await store.put(recordFor(benzeneDoc()), { titleBase: "Benzene" });
    expect(put).toEqual({
      ok: true,
      value: { title: "Cyclohexatriene", titleRevision: 1, replacedTitle: null },
    });
    const read = await store.get("doc_1");
    expect(read.ok && read.value.metadata.title).toBe("Cyclohexatriene");
  });

  it("writes the writer's own new title over a rename, and names what it replaced (decision 52)", async () => {
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc()));
    await store.rename("doc_1", "Cyclohexatriene");

    const put = await store.put(recordFor(benzeneDoc("[6]Annulene")), { titleBase: "Benzene" });
    expect(put).toEqual({
      ok: true,
      value: { title: "[6]Annulene", titleRevision: 2, replacedTitle: "Cyclohexatriene" },
    });
  });

  it("writes an ordinary title edit when nothing moved elsewhere", async () => {
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc()));
    const put = await store.put(recordFor(benzeneDoc("[6]Annulene")), { titleBase: "Benzene" });
    expect(put.ok && put.value).toEqual({
      title: "[6]Annulene",
      titleRevision: 1,
      replacedTitle: null,
    });
  });

  it("writes the record's title as it stands when there is no base", async () => {
    // An import, a duplicate, a journal recovery: nothing to merge against.
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc()));
    await store.rename("doc_1", "Cyclohexatriene");
    const put = await store.put(recordFor(benzeneDoc()));
    expect(put.ok && put.value.title).toBe("Benzene");
    expect(put.ok && put.value.titleRevision).toBe(2);
  });

  it("reads a row written before revisions existed as revision 0", () => {
    // `metaFor` writes no revision; only a store's put adds one.
    const legacy = recordFor(benzeneDoc()).meta;
    expect(storedTitleOf(legacy)).toEqual({ title: "Benzene", titleRevision: 0 });
    expect(storedTitleOf({ ...legacy, titleRevision: -3 })?.titleRevision).toBe(0);
    expect(storedTitleOf({ id: "doc_1" })).toBeNull();
  });
});

describe("an editor with the document open while another tab renames it", () => {
  function openEditor(): EditorStore {
    const editor = createEditorStore({
      document: benzeneDoc(),
      viewportSize: { width: 800, height: 600 },
    });
    // A long debounce: every write in these tests is an explicit flush.
    startEditorPersistence(editor, { debounceMs: 100_000 });
    return editor;
  }

  it("does not overwrite the rename on its next save, and adopts it outside the undo history", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);

    // The grid renames it; this tab hears nothing (no BroadcastChannel in
    // jsdom), which is also what a tab on an older build sends.
    await renameDocument("doc_1", "Pyridine");
    retypeFirstAtom(editor, "N");
    expect((await flushEditorDocument())?.ok).toBe(true);

    expect(await storedTitle()).toBe("Pyridine");
    // The put's receipt brought the name back to the editor.
    expect(editor.getState().document.metadata.title).toBe("Pyridine");
    expect(editor.getState().undoLabel()).toBe("Retype");
    editor.getState().undo();
    expect(editor.getState().document.metadata.title).toBe("Pyridine");
  });

  it("adopts a broadcast rename at once, without marking the sketch unsaved", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);
    resetSaveState();

    const renamed = await renameDocument("doc_1", "Cyclohexatriene");
    if (!renamed.ok) throw new Error(renamed.error.message);
    learnStoredTitle("doc_1", renamed.value.title, renamed.value.titleRevision);

    expect(editor.getState().document.metadata.title).toBe("Cyclohexatriene");
    expect(saveState().status).toBe("idle");
    expect(editor.getState().canUndo()).toBe(false);
    expect(await flushEditorDocument()).toBeNull();
  });

  it("ignores title news older than what it already knows", async () => {
    // A put's receipt and a rename's broadcast can arrive either way round.
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);

    learnStoredTitle("doc_1", "Cyclohexatriene", 2);
    learnStoredTitle("doc_1", "Benzene", 1);
    expect(editor.getState().document.metadata.title).toBe("Cyclohexatriene");
    // And news about some other document leaves this one alone.
    learnStoredTitle("doc_2", "Toluene", 9);
    expect(editor.getState().document.metadata.title).toBe("Cyclohexatriene");
  });

  it("keeps its own unsaved title over a broadcast rename, says so, and writes it (decision 52)", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);

    editor.getState().setDocumentTitle("[6]Annulene");
    const renamed = await renameDocument("doc_1", "Cyclohexatriene");
    if (!renamed.ok) throw new Error(renamed.error.message);
    learnStoredTitle("doc_1", renamed.value.title, renamed.value.titleRevision);

    expect(editor.getState().document.metadata.title).toBe("[6]Annulene");
    expect(editor.getState().ui.statusMessage).toContain("Cyclohexatriene");
    expect((await flushEditorDocument())?.ok).toBe(true);
    expect(await storedTitle()).toBe("[6]Annulene");
  });

  it("keeps its own unsaved title over a rename it never heard about, and names the one it replaced", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);

    editor.getState().setDocumentTitle("[6]Annulene");
    await renameDocument("doc_1", "Cyclohexatriene");
    expect((await saveEditorDocumentNow(editor.getState().document)).ok).toBe(true);

    expect(await storedTitle()).toBe("[6]Annulene");
    expect(editor.getState().document.metadata.title).toBe("[6]Annulene");
    expect(editor.getState().ui.statusMessage).toContain("Cyclohexatriene");
  });
});
