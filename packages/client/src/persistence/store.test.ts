/**
 * The document store contract, plus the two claims the recents grid rests on:
 * a listing decodes no molecules, and a refused write is reported rather than
 * swallowed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { benzene, molecularFormulaUnicode } from "@starter/chem-core";
import { createDocument, encodeDocument, SCHEMA_VERSION } from "@starter/shared";

import { createMemoryDocumentStore } from "./memory-store";
import { decodeStored, migrateStored, storedSchemaVersion } from "./migrate";
import { metaFor, recordFor } from "./record";
import {
  markSaveFailed,
  markSaved,
  resetSaveState,
  saveState,
} from "./save-state";
import { saveDocument, setDocumentStore } from "./documents";

const NOW = "2024-03-04T05:06:07.000Z";

function benzeneDoc(id?: string, title = "Benzene") {
  return createDocument({ id, title, molecule: benzene(), now: NOW });
}

describe("the meta row", () => {
  it("carries everything the grid renders, so nothing has to be derived on read", () => {
    const doc = benzeneDoc("doc_1");
    expect(metaFor(doc)).toEqual({
      id: "doc_1",
      title: "Benzene",
      createdAt: NOW,
      modifiedAt: NOW,
      atomCount: 6,
      bondCount: 6,
      formulaUnicode: molecularFormulaUnicode(doc.molecule),
      schemaVersion: SCHEMA_VERSION,
    });
  });
});

describe("a document store", () => {
  it("round-trips a document through its encoded form", async () => {
    const doc = benzeneDoc("doc_1");
    const store = createMemoryDocumentStore();
    expect((await store.put(recordFor(doc))).ok).toBe(true);

    const read = await store.get("doc_1");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // toEqual, not toBe: the round trip must reproduce the document exactly,
    // which is what @starter/shared's "no key is ever present with the value
    // undefined" rule exists to make possible.
    expect(read.value).toEqual(doc);
  });

  it("LISTS WITHOUT DESERIALIZING A SINGLE MOLECULE", async () => {
    // The acceptance criterion, asserted rather than assumed. In the real
    // store this is structural — `listMeta` opens a transaction over the meta
    // object store alone — and here it is counted.
    const store = createMemoryDocumentStore();
    for (let i = 0; i < 5; i++) {
      await store.put(recordFor(benzeneDoc(`doc_${String(i)}`, `Sketch ${String(i)}`)));
    }

    const listed = await store.listMeta();
    expect(listed.ok && listed.value).toHaveLength(5);
    expect(store.counts.get).toBe(0);
  });

  it("lists newest first", async () => {
    const store = createMemoryDocumentStore();
    await store.put(
      recordFor(createDocument({ id: "old", title: "Old", now: "2024-01-01T00:00:00.000Z" })),
    );
    await store.put(
      recordFor(createDocument({ id: "new", title: "New", now: "2024-06-01T00:00:00.000Z" })),
    );
    const listed = await store.listMeta();
    expect(listed.ok && listed.value.map((meta) => meta.id)).toEqual(["new", "old"]);
  });

  it("renames the meta row AND the stored document together", async () => {
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc("doc_1")));
    expect((await store.rename("doc_1", "Cyclohexatriene")).ok).toBe(true);

    const listed = await store.listMeta();
    expect(listed.ok && listed.value[0]?.title).toBe("Cyclohexatriene");
    const read = await store.get("doc_1");
    // A grid that says one thing and an editor that says another is worse
    // than either being wrong.
    expect(read.ok && read.value.metadata.title).toBe("Cyclohexatriene");
  });

  it("removes all three rows", async () => {
    const store = createMemoryDocumentStore();
    await store.put(recordFor(benzeneDoc("doc_1"), "<svg/>"));
    await store.remove("doc_1");
    expect((await store.get("doc_1")).ok).toBe(false);
    expect((await store.listMeta()).ok && (await store.listMeta())).toMatchObject({
      value: [],
    });
    expect((await store.getThumbnail("doc_1")).ok && (await store.getThumbnail("doc_1"))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("names a missing document rather than returning nothing", async () => {
    const store = createMemoryDocumentStore();
    const read = await store.get("nope");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe("not-found");
  });
});

describe("the schema ladder", () => {
  it("reads the version off an untrusted value without the `in` operator", () => {
    expect(storedSchemaVersion({ schemaVersion: 1 })).toBe(1);
    expect(storedSchemaVersion(Object.create({ schemaVersion: 1 }) as unknown)).toBeUndefined();
    expect(storedSchemaVersion(null)).toBeUndefined();
    expect(storedSchemaVersion("nope")).toBeUndefined();
  });

  it("passes the current version through untouched", () => {
    const encoded = encodeDocument(benzeneDoc("doc_1"));
    const migrated = migrateStored(encoded);
    expect(migrated.ok && migrated.value).toBe(encoded);
  });

  it("REFUSES a newer schema rather than truncating it", () => {
    // Reading a future document with this build's schema would drop whatever
    // it added and then re-save the truncated result over the original — the
    // one outcome worse than "this file is from a newer version".
    const migrated = migrateStored({ schemaVersion: SCHEMA_VERSION + 1 });
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(migrated.message).toMatch(/newer version/i);
  });

  it("upgrades a v1 row to v2: it gains annotations: [] and loses nothing", () => {
    const original = benzeneDoc("doc_1");
    const v1 = JSON.parse(JSON.stringify(encodeDocument(original))) as Record<string, unknown>;
    delete v1.annotations;
    delete v1.nextAnnotationId;
    v1.schemaVersion = 1;
    const migrated = migrateStored(v1);
    expect(migrated.ok && migrated.upgradedFrom).toBe(1);
    const decoded = decodeStored(v1);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.annotations).toEqual([]);
    expect(decoded.value).toEqual(original);
  });

  it("names a row holding a field this build does not know as a newer build's (decision 110)", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(benzeneDoc("doc_1")))) as {
      panels: Record<string, unknown>[];
    };
    // `view` itself is known since decision 128, so the newer field is one
    // inside it: the list of ring assignments decision 162 did not build.
    encoded.panels[0]!.view = {
      kind: "ring",
      template: "haworth",
      frame: { ringAtomIds: ["a1", "a2", "a3", "a4", "a5", "a6"], assignments: [] },
      params: { face: "front" },
    };
    const decoded = decodeStored(encoded);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error.message).toMatch(/newer version/i);
  });

  it("refuses a value carrying no version at all", () => {
    expect(migrateStored({}).ok).toBe(false);
    expect(migrateStored({ schemaVersion: 0 }).ok).toBe(false);
  });

  it("reports a corrupt row as corrupt, with the field that failed", () => {
    const broken = { ...(encodeDocument(benzeneDoc("doc_1")) as object), stylePreset: "neon" };
    const decoded = decodeStored(broken);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error.kind).toBe("corrupt");
    expect(decoded.error.message).toMatch(/stylePreset/);
  });

  it("survives a document whose atom id is a prototype key", () => {
    // `Object.hasOwn`, not `in`. The codec is already hardened against this;
    // the migration ladder reads the same untrusted value.
    const decoded = decodeStored({
      schemaVersion: 1,
      id: "doc_1",
      molecule: {
        atoms: { constructor: { id: "constructor", element: "C", pos: { x: 0, y: 0 }, charge: 0, radicalElectrons: 0, aromatic: false } },
        bonds: {},
        atomIds: ["constructor"],
        bondIds: [],
        nextId: 2,
      },
      stylePreset: "screen",
      panels: [],
      metadata: { title: "Odd", createdAt: NOW, modifiedAt: NOW },
    });
    expect(decoded.ok).toBe(true);
  });
});

describe("the preset a stored sketch reopens in (decision 135)", () => {
  /** A row as a build that opened new documents in Screen stored it. */
  function savedInScreen(): Record<string, unknown> {
    const doc = createDocument({ id: "doc_screen", molecule: benzene(), stylePreset: "screen", now: NOW });
    return JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, unknown>;
  }

  it("reopens a v2 row saved in Screen in Screen", async () => {
    const row = savedInScreen();
    expect(row.schemaVersion).toBe(2);
    expect(row.stylePreset).toBe("screen");
    const decoded = decodeStored(row);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.stylePreset).toBe("screen");

    // And through a store, the way `?doc=` reads it.
    const store = createMemoryDocumentStore();
    await store.put(recordFor(decoded.value));
    const read = await store.get("doc_screen");
    expect(read.ok && read.value.stylePreset).toBe("screen");
  });

  it("reopens a v1 row saved in Screen in Screen, through the upgrade", () => {
    const row = savedInScreen();
    delete row.annotations;
    delete row.nextAnnotationId;
    row.schemaVersion = 1;
    const decoded = decodeStored(row);
    expect(decoded.ok && decoded.value.stylePreset).toBe("screen");
  });
});

describe("the save path", () => {
  beforeEach(() => {
    resetSaveState();
    setDocumentStore(null);
  });

  it("moves the indicator to saved", async () => {
    setDocumentStore(createMemoryDocumentStore());
    const result = await saveDocument(benzeneDoc("doc_1"));
    expect(result.ok).toBe(true);
    expect(saveState().status).toBe("saved");
  });

  it("SURFACES A QUOTA FAILURE INSTEAD OF SWALLOWING IT", async () => {
    // The acceptance criterion. A rejected write is silent by default: the
    // abort carries its reason and no listener.
    const store = createMemoryDocumentStore();
    store.failWith("quota", "There is no room left in this browser's storage.");
    setDocumentStore(store);

    const result = await saveDocument(benzeneDoc("doc_1"));
    expect(result.ok).toBe(false);
    const state = saveState();
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/no room left/i);
  });

  it("drops the last-saved time on a failure, so nothing reassures falsely", () => {
    markSaved("2024-01-01T00:00:00.000Z");
    expect(saveState().savedAt).toBe("2024-01-01T00:00:00.000Z");
    markSaveFailed("No room.");
    expect(saveState().savedAt).toBeUndefined();
  });

  it("stores a thumbnail for a small structure", async () => {
    const store = createMemoryDocumentStore();
    setDocumentStore(store);
    await saveDocument(benzeneDoc("doc_1"));
    const thumbnail = await store.getThumbnail("doc_1");
    expect(thumbnail.ok && thumbnail.value).toMatch(/^<svg/);
  });
});
