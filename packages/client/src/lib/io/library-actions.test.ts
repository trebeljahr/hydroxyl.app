import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { benzene, molecularFormula, netCharge } from "@starter/chem-core";
import { acetate } from "@starter/chem-render";
import { createDocument } from "@starter/shared";
import type { SketchDocument } from "@starter/shared";

import { setDocumentStore } from "@/persistence/documents";
import { createMemoryDocumentStore, type MemoryDocumentStore } from "@/persistence/memory-store";
import { recordFor } from "@/persistence/record";

import type { writeBlobFile, WriteOutcome } from "./file-system";
import { exportLibrary, importIntoLibrary } from "./library-actions";

const NOW = "2026-09-29T08:00:00.000Z";

let store: MemoryDocumentStore;

function put(doc: SketchDocument) {
  return store.put(recordFor(doc, null));
}

/**
 * A `writeBlobFile` that keeps what it was given instead of saving it, with
 * the real one's contract: the picker's answer first, then the producer, and
 * a producer that throws comes back as a failure carrying its message.
 */
function capturingWrite(outcome: WriteOutcome = { ok: true, method: "download" }) {
  const written: { text: string | null; filename: string | null } = { text: null, filename: null };
  const write: typeof writeBlobFile = async (content, filename) => {
    written.filename = filename;
    if (!outcome.ok) return outcome;
    try {
      const blob = typeof content === "function" ? await content() : content;
      written.text = await blob.text();
    } catch (error) {
      return { ok: false, cancelled: false, message: error instanceof Error ? error.message : String(error) };
    }
    return outcome;
  };
  return { write, written };
}

beforeEach(() => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
});

afterEach(() => {
  setDocumentStore(null);
});

describe("Export all sketches", () => {
  it("writes every sketch to one dated file and says how many", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    await put(createDocument({ id: "doc_2", title: "Acetate", molecule: acetate(), now: NOW }));
    const { write, written } = capturingWrite();

    const report = await exportLibrary({ now: NOW, write });

    expect(report).toEqual({
      outcome: "done",
      message: "Exported 2 sketches to hydroxyl-library-2026-09-29.json.",
    });
    expect(written.filename).toBe("hydroxyl-library-2026-09-29.json");
    const file = JSON.parse(written.text ?? "{}") as { documents: unknown[] };
    expect(file.documents).toHaveLength(2);
  });

  it("refuses an empty library with a sentence, not an empty file", async () => {
    const { write, written } = capturingWrite();
    const report = await exportLibrary({ now: NOW, write });
    expect(written.text).toBeNull();
    expect(report).toEqual({ outcome: "failed", message: "There are no sketches to export." });
  });

  it("says nothing when the picker is dismissed", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    const { write } = capturingWrite({ ok: false, cancelled: true });
    expect(await exportLibrary({ now: NOW, write })).toEqual({ outcome: "cancelled", message: null });
  });
});

describe("Import", () => {
  async function exported(): Promise<string> {
    const { write, written } = capturingWrite();
    await exportLibrary({ now: NOW, write });
    return written.text ?? "";
  }

  it("restores an exported library into an empty browser, ids and chemistry intact", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    await put(createDocument({ id: "doc_2", title: "Acetate", molecule: acetate(), now: NOW }));
    const text = await exported();

    // A new computer: nothing stored.
    store = createMemoryDocumentStore();
    setDocumentStore(store);
    const report = await importIntoLibrary({
      pick: () => Promise.resolve([{ name: "hydroxyl-library-2026-09-29.json", text }]),
    });

    expect(report).toEqual({ outcome: "done", message: "Imported 2 sketches." });
    const benzeneBack = await store.get("doc_1");
    expect(benzeneBack.ok && molecularFormula(benzeneBack.value.molecule)).toBe("C6H6");
    expect((await store.get("doc_2")).ok).toBe(true);
  });

  it("restores a backup exported before the rename (decision 229)", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    await put(createDocument({ id: "doc_2", title: "Acetate", molecule: acetate(), now: NOW }));
    const today = JSON.parse(await exported()) as Record<string, unknown>;
    const text = JSON.stringify({ ...today, format: "chemistry-sketcher-library" });

    store = createMemoryDocumentStore();
    setDocumentStore(store);
    const report = await importIntoLibrary({
      pick: () => Promise.resolve([{ name: "chemistry-sketcher-library-2026-09-29.json", text }]),
    });

    expect(report).toEqual({ outcome: "done", message: "Imported 2 sketches." });
    const benzeneBack = await store.get("doc_1");
    expect(benzeneBack.ok && molecularFormula(benzeneBack.value.molecule)).toBe("C6H6");
    const acetateBack = await store.get("doc_2");
    expect(acetateBack.ok && netCharge(acetateBack.value.molecule)).toBe(-1);
  });

  it("never overwrites a sketch edited after the file was written", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    const text = await exported();
    // Keep drawing after the backup.
    await put(
      createDocument({ id: "doc_1", title: "Benzene, edited", molecule: benzene(), now: "2026-09-30T00:00:00.000Z" }),
    );

    const report = await importIntoLibrary({ pick: () => Promise.resolve([{ name: "backup.json", text }]) });

    expect(report.message).toMatch(/1 was saved as a new sketch/);
    const kept = await store.get("doc_1");
    expect(kept.ok && kept.value.metadata.title).toBe("Benzene, edited");
    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(2);
  });

  it("reports a file it cannot read and imports nothing", async () => {
    const report = await importIntoLibrary({
      pick: () => Promise.resolve([{ name: "notes.txt", text: "this is not a structure" }]),
    });
    expect(report.outcome).toBe("failed");
    expect(report.message).toMatch(/^notes\.txt: /);
    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it("surfaces a refused write instead of claiming the import worked", async () => {
    await put(createDocument({ id: "doc_1", title: "Benzene", molecule: benzene(), now: NOW }));
    const text = await exported();
    store = createMemoryDocumentStore();
    setDocumentStore(store);
    store.failWith("quota", "There is no room left in this browser's storage.");

    const report = await importIntoLibrary({ pick: () => Promise.resolve([{ name: "backup.json", text }]) });

    expect(report.outcome).toBe("failed");
    expect(report.message).toMatch(/could not be saved — There is no room left/);
  });

  it("says nothing when the picker is dismissed", async () => {
    expect(await importIntoLibrary({ pick: () => Promise.resolve([]) })).toEqual({
      outcome: "cancelled",
      message: null,
    });
  });
});
