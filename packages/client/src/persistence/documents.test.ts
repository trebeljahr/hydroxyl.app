/**
 * `copyOf` is the one place a document is re-minted under a new id — the
 * recents grid's Duplicate and the import fork both go through it — so a field
 * it does not name is lost from every copy. That happened to a reaction
 * scheme's annotations, which arrived on `SketchDocument` after `copyOf` was
 * written.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildMolecule } from "@starter/chem-core";
import { createDocument, createPanel } from "@starter/shared";
import type { DocumentMetadata, SketchDocument } from "@starter/shared";

import {
  copyOf,
  duplicateDocument,
  forkOverStoredDocuments,
  loadDocument,
  setDocumentStore,
} from "./documents";
import { createMemoryDocumentStore, type MemoryDocumentStore } from "./memory-store";
import { recordFor } from "./record";

const CREATED = "2024-03-04T05:06:07.000Z";
const COPIED = "2024-05-06T07:08:09.000Z";

/**
 * Ethanol oxidised to acetate: ethanol a1-a3 (bonds b4, b5), acetate a6-a9
 * (b10-b12). A reaction arrow from one species to the other, with "[O]" over
 * it.
 *
 * ann_3 was drawn last and deleted, so the counter stands at 4 rather than the
 * 3 a recount of the surviving ids would give — a copy that recomputed it would
 * hand the next arrow an id a stale selection may still hold.
 */
function oxidation(): SketchDocument {
  const molecule = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 0.87, y: 0.5 });
    const o = b.atom("O", { x: 1.74, y: 0 });
    b.bond(c1, c2);
    b.bond(c2, o);
    const methyl = b.atom("C", { x: 5, y: 0 });
    const carboxyl = b.atom("C", { x: 5.87, y: 0.5 });
    const carbonyl = b.atom("O", { x: 5.87, y: 1.5 });
    const anionic = b.atom("O", { x: 6.74, y: 0 }, { charge: -1 });
    b.bond(methyl, carboxyl);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, anionic);
  });
  return createDocument({
    id: "doc_oxidation",
    title: "Ethanol to acetate",
    author: "A. Chemist",
    notes: "Jones oxidation",
    molecule,
    annotations: [
      { id: "ann_1", kind: "reactionArrow", from: ["a1"], to: ["a6"] },
      { id: "ann_2", kind: "text", text: "[O]", at: { x: 3, y: 0.5 } },
    ],
    nextAnnotationId: 4,
    // Screen, the preset a new document does NOT open in (decision 135), so a
    // copy that dropped it would come back in Publication and show.
    stylePreset: "screen",
    styleOverrides: { screen: { lineWidthPt: 1.2, bondColor: "#1d4ed8" } },
    panels: [createPanel("skeletal", "Scheme 1", "screen")],
    figure: { columns: 2 },
    // Explicit locants the user typed: the reacting carbon on each side.
    locants: { a2: "1", a7: "1" },
    now: CREATED,
  });
}

let store: MemoryDocumentStore;

beforeEach(() => {
  store = createMemoryDocumentStore();
  setDocumentStore(store);
});

afterEach(() => {
  setDocumentStore(null);
});

describe("copyOf", () => {
  /**
   * Every key of a document, and whether a copy keeps it or mints it afresh.
   * A `Record` over `keyof`, so a field added to either interface is a type
   * error here until it is classified — and once it is, the test below checks
   * that `copyOf` carries it.
   */
  const DOCUMENT_KEYS: Record<keyof SketchDocument, "kept" | "fresh"> = {
    schemaVersion: "kept",
    id: "fresh",
    molecule: "kept",
    annotations: "kept",
    nextAnnotationId: "kept",
    stylePreset: "kept",
    styleOverrides: "kept",
    panels: "kept",
    figure: "kept",
    locants: "kept",
    metadata: "fresh",
  };
  const METADATA_KEYS: Record<keyof DocumentMetadata, "kept" | "fresh"> = {
    title: "fresh",
    createdAt: "fresh",
    modifiedAt: "fresh",
    author: "kept",
    notes: "kept",
  };

  it("carries every document field but the id and the clock", () => {
    const doc = oxidation();
    // The fixture has to hold every key, optional ones included, or a field
    // copyOf drops could pass by being absent from both sides.
    expect(Object.keys(doc).sort()).toEqual(Object.keys(DOCUMENT_KEYS).sort());
    expect(Object.keys(doc.metadata).sort()).toEqual(Object.keys(METADATA_KEYS).sort());

    const copy = copyOf(doc, { now: COPIED });
    expect(Object.keys(copy).sort()).toEqual(Object.keys(doc).sort());
    expect(Object.keys(copy.metadata).sort()).toEqual(Object.keys(doc.metadata).sort());
    for (const [key, rule] of Object.entries(DOCUMENT_KEYS)) {
      const field = key as keyof SketchDocument;
      if (rule === "kept") expect(copy[field], field).toEqual(doc[field]);
    }
    for (const [key, rule] of Object.entries(METADATA_KEYS)) {
      const field = key as keyof DocumentMetadata;
      if (rule === "kept") expect(copy.metadata[field], field).toEqual(doc.metadata[field]);
    }

    expect(copy.id).not.toBe(doc.id);
    expect(copy.metadata).toMatchObject({
      title: "Ethanol to acetate copy",
      createdAt: COPIED,
      modifiedAt: COPIED,
    });
  });

  it("survives Duplicate through the store, arrow, label and counter", async () => {
    const doc = oxidation();
    await store.put(recordFor(doc));

    const duplicated = await duplicateDocument(doc.id, (loaded) => copyOf(loaded));
    if (!duplicated.ok) throw new Error(duplicated.error.message);
    const reloaded = await loadDocument(duplicated.value.id);
    if (!reloaded.ok) throw new Error(reloaded.error.message);

    expect(reloaded.value.id).not.toBe(doc.id);
    expect(reloaded.value.annotations).toEqual(doc.annotations);
    expect(reloaded.value.annotations.map((a) => a.kind)).toEqual(["reactionArrow", "text"]);
    expect(reloaded.value.nextAnnotationId).toBe(4);
    expect(reloaded.value.locants).toEqual({ a2: "1", a7: "1" });
  });

  it("survives the import fork away from a newer stored copy", async () => {
    const doc = oxidation();
    // The stored row has been edited since the file was written.
    const edited = {
      ...doc,
      metadata: { ...doc.metadata, modifiedAt: COPIED },
    };
    await store.put(recordFor(edited));

    const { documents } = await forkOverStoredDocuments([doc]);
    const forked = documents[0]!;
    expect(forked.id).not.toBe(doc.id);
    expect(forked.metadata.title).toBe(doc.metadata.title);
    expect(forked.annotations).toEqual(doc.annotations);
    expect(forked.nextAnnotationId).toBe(4);
  });
});
