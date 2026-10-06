import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { benzene, buildMolecule, setCharge, vec, withStereoGroups } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createMemoryDocumentStore, type MemoryDocumentStore } from "@/persistence/memory-store";
import { setDocumentStore } from "@/persistence/documents";
import { recordFor } from "@/persistence/record";
import {
  baselineEditorDocument,
  startEditorPersistence,
  stopEditorPersistence,
} from "@/persistence/session";
import { createEditorStore, type EditorStore } from "@/state";

import { molblockVersionNotice } from "@/lib/rdkit/translate";

import { applyImport, exportCurrent, leaveToRecents, newSketch } from "./file";

/** Ethanol: three heavy atoms, so a document swap is visible by count alone. */
function ethanol() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1.5, 0));
    const o = b.atom("O", vec(2.25, 1.3));
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

/**
 * The import path's ONE destructive edge: a native `.hydroxyl.json` carries
 * its own `doc.id`, and every object store keys on it.
 */

let store: MemoryDocumentStore;
let editor: EditorStore;

beforeEach(() => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
  editor = createEditorStore({
    document: createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
  });
});

afterEach(() => {
  stopEditorPersistence();
  vi.unstubAllEnvs();
  setDocumentStore(null);
});

describe("a new sketch", () => {
  it("opens in Publication, whatever the sketch before it used (decision 135)", async () => {
    editor.getState().setStylePreset("screen");
    await newSketch(editor);
    expect(editor.getState().document.molecule.atomIds).toHaveLength(0);
    expect(editor.getState().document.stylePreset).toBe("publication");
  });
});

describe("importing a document that is already in storage", () => {
  it("does NOT overwrite a stored sketch that has been edited since the file was written", async () => {
    // Export a sketch, keep drawing, then drag the exported file back in to
    // check that it opens. The newer stored copy used to be replaced by the
    // older file, and undo — which decision 7 routes the import through —
    // restores the canvas but not the database row.
    const stored = createDocument({
      id: "doc_1",
      title: "Benzene",
      molecule: ethanol(),
      now: "2024-06-01T00:00:00.000Z",
    });
    await store.put(recordFor(stored));

    const fromFile = createDocument({
      id: "doc_1",
      title: "Benzene",
      molecule: benzene(),
      now: "2024-01-01T00:00:00.000Z",
    });
    await applyImport(editor, [fromFile], []);

    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(2);
    // The stored one is untouched: still ethanol, still its own timestamp.
    const original = await store.get("doc_1");
    expect(original.ok && original.value.molecule.atomIds).toHaveLength(3);
    // And the import is on the canvas under a fresh id.
    expect(editor.getState().document.id).not.toBe("doc_1");
    expect(editor.getState().document.molecule.atomIds).toHaveLength(6);
    expect(editor.getState().ui.statusMessage).toMatch(/new sketch/i);
  });

  it("keeps the file's own id when nothing newer is stored", async () => {
    // The ordinary "open my own sketch" case, including a fresh browser with
    // an empty library. Forking there would mint a duplicate on every open.
    const fromFile = createDocument({
      id: "doc_1",
      title: "Benzene",
      molecule: benzene(),
      now: "2024-01-01T00:00:00.000Z",
    });
    await applyImport(editor, [fromFile], []);

    expect(editor.getState().document.id).toBe("doc_1");
    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("reads the META store only, never a molecule, to decide", async () => {
    // The recents grid's whole design is that a listing costs no molecules,
    // and an import must not be the one place that deserializes the library.
    const fromFile = createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" });
    await applyImport(editor, [fromFile], []);
    expect(store.counts.get).toBe(0);
  });
});

/**
 * Decision 49's OTHER status line. `exportCurrent` had no test at all, so
 * deleting its generation note left the client suite green — and a DOWNLOADED
 * file that quietly changed generation is exactly the case decision 49 names: an
 * old reader rejects it for no visible reason.
 *
 * The real serialisation runs; only the browser's download plumbing is stubbed,
 * so the bytes asserted are the bytes `exportDocument` would have written.
 */
describe("exporting the current document says which molfile generation it wrote", () => {
  let downloads: string[];

  beforeEach(() => {
    downloads = [];
    // jsdom has no blob URLs. Capturing the Blob here is also how the written
    // text is read back.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => downloads.push(text));
        return "blob:stub";
      },
      revokeObjectURL: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function exported(molecule: Molecule): Promise<string> {
    const store = createEditorStore({
      document: createDocument({ molecule, title: "sketch", now: "2024-01-01T00:00:00.000Z" }),
      viewportSize: { width: 800, height: 600 },
    });
    await exportCurrent(store, "mol");
    // Let the Blob.text() microtask land before the bytes are read.
    await Promise.resolve();
    await Promise.resolve();
    return store.getState().ui.statusMessage ?? "";
  }

  it("adds the sentence for a grouped structure and omits it otherwise", async () => {
    const plain = ethanol();
    expect(molblockVersionNotice(plain)).toBeNull();
    expect(await exported(plain)).toBe("Exported “sketch”");
    expect(downloads.join("")).toContain("V2000");

    downloads = [];
    const chiral = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0.6));
      const o = b.atom("O", vec(1, 2));
      const c3 = b.atom("C", vec(2, 0));
      b.bond(c1, c2);
      b.bond(c2, o, 1, "wedge");
      b.bond(c2, c3);
    });
    const racemate = withStereoGroups(chiral, [{ kind: "and", index: 1, atomIds: ["a2"] }]);
    const note = molblockVersionNotice(racemate)!;
    expect(note).toContain("V3000");
    expect(await exported(racemate)).toBe(`Exported “sketch”. ${note}`);
    // And the file really did change generation, so the sentence is not decorative.
    expect(downloads.join("")).toContain("V3000");
    expect(downloads.join("")).toContain("MDLV30/STERAC1");
  });
});

describe("leaving the editor for the recents grid", () => {
  /** A real edit to the open benzene: the first carbon becomes a cation. */
  function chargeFirstAtom(): void {
    const atomId = Object.keys(editor.getState().document.molecule.atoms)[0]!;
    editor.getState().applyMoleculeEdit("Increase charge", (m) => setCharge(m, atomId, 1));
  }

  function openSession(): void {
    // A debounce that never fires on its own inside a test, so the only write
    // that can land the edit is the one leaving starts.
    startEditorPersistence(editor, { debounceMs: 100_000 });
    baselineEditorDocument(editor.getState().document);
  }

  it("puts the pending edit in storage BEFORE it navigates", async () => {
    openSession();
    chargeFirstAtom();
    const id = editor.getState().document.id;

    const storedAtNavigation: number[] = [];
    const navigate = vi.fn(() => {
      // Read synchronously inside the navigation: by the time a real page
      // load starts, the write has to have happened already.
      storedAtNavigation.push(store.counts.put);
    });
    await leaveToRecents(editor, { navigate, confirm: () => false });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(storedAtNavigation).toEqual([1]);
    const stored = await store.get(id);
    expect(stored.ok && Object.values(stored.value.molecule.atoms).some((a) => a.charge === 1)).toBe(
      true,
    );
  });

  it("writes nothing and asks nothing when the sketch is already saved", async () => {
    openSession();
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    const navigate = vi.fn();

    await leaveToRecents(editor, { navigate, confirm });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(store.counts.put).toBe(0);
  });

  it("goes to the route in the server build and to a document-relative file in the export", async () => {
    openSession();
    const navigate = vi.fn();

    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "0");
    await leaveToRecents(editor, { navigate });
    vi.stubEnv("NEXT_PUBLIC_FILE_EXPORT", "1");
    await leaveToRecents(editor, { navigate });

    // Never a literal "/" in the export: opened from a subdirectory or an app
    // shell, that names a file outside the bundle.
    expect(navigate.mock.calls).toEqual([["/"], ["index.html"]]);
  });

  it("ASKS before leaving a sketch the store refused, and stays when told to", async () => {
    openSession();
    store.failWith("quota", "There is no room left in this browser's storage.");
    chargeFirstAtom();
    const confirm = vi.fn<(message: string) => boolean>(() => false);
    const navigate = vi.fn();

    await leaveToRecents(editor, { navigate, confirm });

    expect(navigate).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    // The store's own reason, verbatim, and the sketch by name.
    expect(confirm.mock.calls[0]?.[0]).toMatch(/no room left/);
    expect(confirm.mock.calls[0]?.[0]).toMatch(/“Untitled”/);
    expect(editor.getState().ui.statusMessage).toMatch(/Stayed in the editor/);
  });

  it("leaves a refused sketch when the chemist says so", async () => {
    openSession();
    store.failWith("quota", "There is no room left in this browser's storage.");
    chargeFirstAtom();
    const navigate = vi.fn();

    await leaveToRecents(editor, { navigate, confirm: () => true });

    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
