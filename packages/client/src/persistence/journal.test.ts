import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDocument } from "@starter/shared";
import { benzene } from "@starter/chem-core";

import { createEditorStore, guardedOps } from "@/state";

import {
  clearJournal,
  journalKey,
  journaledDocumentIds,
  readJournals,
  writeJournal,
} from "./journal";
import { createMemoryDocumentStore } from "./memory-store";
import { documentStore, saveDocument, removeDocument, setDocumentStore } from "./documents";
import {
  holdEditorDocument,
  journalEditorDocument,
  recoverJournaledDocuments,
  resetEditorPersistence,
  saveEditorDocumentNow,
  startEditorPersistence,
} from "./session";
import { resetSaveState, saveState } from "./save-state";
import { storeOk, type PutReceipt, type StoreResult } from "./types";

function doc(title = "Benzene") {
  return createDocument({ molecule: benzene(), title });
}

beforeEach(() => {
  localStorage.clear();
  resetEditorPersistence();
  resetSaveState();
  setDocumentStore(createMemoryDocumentStore());
});

describe("the unsaved-work journal", () => {
  it("round-trips a document through the STORE's own encoding", () => {
    // Same `encodeDocument` in, same `decodeStored` out, so a journal written
    // by one build and recovered by the next takes the identical migration
    // path. A second format here would need its own versioning.
    const original = doc("Ethanol-ish");
    expect(writeJournal(original)).toBe(true);

    const [back] = readJournals();
    expect(back?.id).toBe(original.id);
    expect(back?.metadata.title).toBe("Ethanol-ish");
    expect(back?.molecule.atomIds).toHaveLength(original.molecule.atomIds.length);
  });

  it("answers which documents it holds WITHOUT decoding anything", () => {
    const original = doc();
    writeJournal(original);
    // The id is the key, so the question costs no schema parse of a 20 000-atom
    // chain and not even a JSON.parse.
    const parse = vi.spyOn(JSON, "parse");
    expect(journaledDocumentIds()).toEqual([original.id]);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("keeps one entry PER DOCUMENT, so two tabs closing together both keep their rescue", () => {
    // `localStorage` is shared by every tab of the origin. Closing a window
    // with two editors fires two pagehides; one slot would keep only the last.
    const a = doc("From tab A");
    const b = doc("From tab B");
    writeJournal(a);
    writeJournal(b);
    expect(readJournals().map((d) => d.metadata.title).sort()).toEqual(["From tab A", "From tab B"]);
  });

  it("is empty when there is nothing to recover", () => {
    expect(readJournals()).toEqual([]);
    expect(journaledDocumentIds()).toEqual([]);
  });

  it("DROPS a half-written journal rather than failing every later load", () => {
    // It is written during a teardown, the one moment a truncated value is
    // plausible. Reporting it would give the chemist nothing to act on — the
    // content is gone either way — and keeping it would re-attempt the same
    // failed decode forever.
    localStorage.setItem(journalKey("doc_x"), '{"schemaVersion":1,"id":"doc_x"');
    expect(readJournals()).toEqual([]);
    expect(localStorage.getItem(journalKey("doc_x"))).toBeNull();
  });

  it("drops a well-formed value that is not a document", () => {
    localStorage.setItem(journalKey("doc_x"), '{"nope":true}');
    expect(readJournals()).toEqual([]);
    expect(localStorage.getItem(journalKey("doc_x"))).toBeNull();
  });

  it("reports a refused write rather than throwing out of an unload handler", () => {
    // `setItem` throws once the origin is full, and a 20 000-atom stress
    // fixture will manage it. Throwing here would take the IndexedDB flush
    // attempt down with it.
    // On the prototype of the object the code actually holds, not on the
    // instance and not on a named global. jsdom's localStorage is a named-
    // property Proxy, so an instance spy just stores an item called
    // "setItem". And Node 26 ships its own MemoryStorage whose prototype is
    // not Storage.prototype, so a Storage.prototype spy misses it there. The
    // live object's own prototype is right in both.
    const setItem = vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(writeJournal(doc())).toBe(false);
    setItem.mockRestore();
  });
});

describe("recovering the journal", () => {
  it("writes the stranded document into storage and then forgets it", async () => {
    const stranded = doc("Interrupted");
    writeJournal(stranded);

    const recovered = await recoverJournaledDocuments();
    expect(recovered.map((d) => d.id)).toEqual([stranded.id]);
    // Under its OWN id: this is the tail of an interrupted write, not an
    // import, so it lands on the row it came from rather than forking a copy.
    const listed = await createStoreListing();
    expect(listed.map((meta) => meta.id)).toEqual([stranded.id]);
    expect(localStorage.getItem(journalKey(stranded.id))).toBeNull();
  });

  it("KEEPS the journal when the recovery write is refused", async () => {
    // The rescued document is the only copy there is. Deleting it because the
    // retry failed would destroy exactly the work the journal was written to
    // keep; the next load tries again.
    const store = createMemoryDocumentStore();
    store.failWith("quota", "There is no room left.");
    setDocumentStore(store);

    const stranded = doc();
    writeJournal(stranded);
    await recoverJournaledDocuments();
    expect(localStorage.getItem(journalKey(stranded.id))).not.toBeNull();
  });

  it("is a no-op when nothing was stranded", async () => {
    await expect(recoverJournaledDocuments()).resolves.toEqual([]);
  });
});

describe("the journal and the store agree about what exists", () => {
  it("is cleared by a successful save of the SAME document", async () => {
    const only = doc();
    writeJournal(only);
    await saveDocument(only);
    expect(localStorage.getItem(journalKey(only.id))).toBeNull();
  });

  it("is NOT cleared by a save of a different document", async () => {
    // A journal belonging to some other sketch is still the only copy of that
    // sketch.
    const stranded = doc("Stranded");
    writeJournal(stranded);
    await saveDocument(doc("Unrelated"));
    expect(journaledDocumentIds()).toEqual([stranded.id]);
  });

  it("is cleared when its document is deleted, so a reload cannot resurrect it", async () => {
    const condemned = doc();
    await saveDocument(condemned);
    writeJournal(condemned);
    await removeDocument(condemned.id);
    expect(localStorage.getItem(journalKey(condemned.id))).toBeNull();
  });

  it("is NOT cleared by an OLDER write that lands after it was written", async () => {
    // v1's write goes out, the chemist edits to v2, the tab is hidden and v2 is
    // journalled, THEN v1's write lands. Clearing on "same id" would delete v2's
    // only durable copy while v2's own write is still in flight.
    const real = createMemoryDocumentStore();
    let release: () => void = () => undefined;
    setDocumentStore({
      ...real,
      put: (record) =>
        new Promise<StoreResult<PutReceipt>>((resolve) => {
          release = () => void real.put(record).then(resolve);
        }),
    });
    const v1 = doc("v1");
    const inFlight = saveDocument(v1);
    const v2 = { ...v1, metadata: { ...v1.metadata, title: "v2" } };
    writeJournal(v2);
    release();
    await inFlight;
    expect(readJournals().map((d) => d.metadata.title)).toEqual(["v2"]);

    // A save that STARTS after the journal carries the newer document, and
    // does clear it.
    setDocumentStore(real);
    await saveDocument(v2);
    expect(journaledDocumentIds()).toEqual([]);
  });
});

describe("a document deleted in another tab", () => {
  it("is not resurrected by this tab's autosave, its journal, or anything but an explicit Save", async () => {
    const editor = createEditorStore({
      document: doc(),
      viewportSize: { width: 800, height: 600 },
    });
    startEditorPersistence(editor, { debounceMs: 0 });
    const open = editor.getState().document;
    await saveDocument(open);
    await removeDocument(open.id);

    holdEditorDocument(open.id, "Deleted in another tab.");
    editor
      .getState()
      .applyMoleculeEdit("Retype", (m) => guardedOps.setElement(m, m.atomIds[0]!, "N"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const listed = await documentStore().listMeta();
    expect(listed.ok && listed.value, "autosave must not write it back").toEqual([]);
    expect(saveState().status).toBe("error");
    expect(journalEditorDocument(), "nor may the teardown journal").toBe(false);
    expect(journaledDocumentIds()).toEqual([]);

    const saved = await saveEditorDocumentNow(editor.getState().document);
    expect(saved).toEqual(storeOk(undefined));
    const relisted = await documentStore().listMeta();
    expect(relisted.ok && relisted.value.map((m) => m.id)).toEqual([open.id]);
  });
});

async function createStoreListing() {
  const listed = await documentStore().listMeta();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value;
}
