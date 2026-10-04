/**
 * The save a tab makes before it reloads into a newer release.
 *
 * Unlike `pagehide`, an expiry reload is a teardown this page chooses, so it
 * may wait for IndexedDB and must refuse to reload when the sketch is not
 * stored. These tests pin both halves against the memory store.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { shouldReload } from "@/components/ReleaseLifetime";
import { createEditorStore, guardedOps, type EditorStore } from "@/state";

import { loadDocument, saveDocument, setDocumentStore } from "./documents";
import { journalKey } from "./journal";
import { createMemoryDocumentStore } from "./memory-store";
import { resetSaveState } from "./save-state";
import {
  baselineEditorDocument,
  holdEditorDocument,
  resetEditorPersistence,
  saveBeforeReleaseReload,
  startEditorPersistence,
} from "./session";
import { storeFail } from "./types";

function openEditor(): EditorStore {
  const editor = createEditorStore({
    document: createDocument({ id: "doc_1", molecule: benzene(), title: "Benzene" }),
    viewportSize: { width: 800, height: 600 },
  });
  // A long debounce: only the release save writes in these tests.
  startEditorPersistence(editor, { debounceMs: 100_000 });
  return editor;
}

function retypeFirstAtom(editor: EditorStore): void {
  editor
    .getState()
    .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
}

async function storedMolecule(): Promise<unknown> {
  const read = await loadDocument("doc_1");
  return read.ok ? read.value.molecule : undefined;
}

beforeEach(() => {
  localStorage.clear();
  resetEditorPersistence();
  resetSaveState();
  setDocumentStore(createMemoryDocumentStore());
});

describe("saving before a release reload", () => {
  it("allows a reload when there is no open sketch", async () => {
    expect(await saveBeforeReleaseReload()).toEqual({ ok: true });
  });

  it("stores the unsaved edit before allowing the reload", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);
    retypeFirstAtom(editor);

    const edited = editor.getState().document.molecule;
    expect(await storedMolecule()).not.toEqual(edited);
    expect(await saveBeforeReleaseReload()).toEqual({ ok: true });
    expect(await storedMolecule()).toEqual(edited);
  });

  it("refuses the reload when storage rejects the write, and keeps the journal copy", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);
    const store = createMemoryDocumentStore();
    setDocumentStore({ ...store, put: async () => storeFail("quota", "Storage is full.") });
    retypeFirstAtom(editor);

    const result = await saveBeforeReleaseReload();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/full/i);
    expect(localStorage.getItem(journalKey("doc_1"))).not.toBeNull();
  });

  it("refuses the reload for a sketch deleted in another tab", async () => {
    const editor = openEditor();
    await saveDocument(editor.getState().document);
    baselineEditorDocument(editor.getState().document);
    holdEditorDocument("doc_1", "This sketch was deleted in another tab.");
    retypeFirstAtom(editor);

    expect(await saveBeforeReleaseReload()).toEqual({
      ok: false,
      message: "This sketch was deleted in another tab.",
    });
  });
});

describe("release expiry", () => {
  const own = "a".repeat(40);
  it("reloads only when valid shared metadata no longer lists this release", () => {
    expect(shouldReload(own, { schema: 2, releases: ["b".repeat(40)] })).toBe(true);
    expect(shouldReload(own, { schema: 2, releases: ["b".repeat(40), own] })).toBe(false);
    expect(shouldReload(own, { schema: 1, releases: ["b".repeat(40)] })).toBe(false);
    expect(shouldReload(own, { schema: 2, releases: [] })).toBe(false);
    expect(shouldReload(own, { schema: 2, releases: ["../x"] })).toBe(false);
    expect(shouldReload(own, null)).toBe(false);
  });
});
