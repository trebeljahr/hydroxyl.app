import { describe, expect, it } from "vitest";

import { benzene, elementCounts, molecularFormula, netCharge } from "@starter/chem-core";
import { acetate, dimethylSulfone, ethanol } from "@starter/chem-render";
import { createDocument, encodeDocument, SCHEMA_VERSION } from "@starter/shared";

import {
  isLibraryFile,
  LEGACY_LIBRARY_FORMATS,
  LIBRARY_FORMAT,
  LIBRARY_FORMAT_VERSION,
  libraryFileName,
  readLibrary,
  serializeLibrary,
} from "./library";
import { openText } from "./open";

const NOW = "2026-09-29T08:00:00.000Z";

function library() {
  return [
    createDocument({ id: "doc_benzene", title: "Benzene", molecule: benzene(), now: NOW }),
    createDocument({ id: "doc_acetate", title: "Acetate", molecule: acetate(), now: NOW }),
    createDocument({ id: "doc_sulfone", title: "Dimethyl sulfone", molecule: dimethylSulfone(), now: NOW }),
  ];
}

describe("the library file", () => {
  it("names itself after the export's UTC day", () => {
    expect(libraryFileName(NOW)).toBe("hydroxyl-library-2026-09-29.json");
  });

  it("round-trips real molecules with their chemistry intact", () => {
    const docs = library();
    const { text } = serializeLibrary(docs, NOW);
    const read = readLibrary(JSON.parse(text));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.failures).toEqual([]);
    expect(read.documents.map((doc) => doc.id)).toEqual(["doc_benzene", "doc_acetate", "doc_sulfone"]);

    // Asserted through chem-core's own queries, not a string: benzene keeps
    // its implicit hydrogens, acetate its charge, the sulfone its hexavalent S.
    const [benzeneBack, acetateBack, sulfoneBack] = read.documents;
    expect(molecularFormula(benzeneBack!.molecule)).toBe("C6H6");
    expect(netCharge(acetateBack!.molecule)).toBe(-1);
    expect(elementCounts(acetateBack!.molecule)).toEqual(elementCounts(acetate()));
    expect(elementCounts(sulfoneBack!.molecule)).toEqual(elementCounts(dimethylSulfone()));
    // The figure travels with the structure: panels are part of the sketch.
    expect(benzeneBack!.panels).toEqual(docs[0]!.panels);
  });

  it("stores each entry exactly as the single-sketch export writes it", () => {
    const docs = library();
    const parsed = JSON.parse(serializeLibrary(docs, NOW).text) as { documents: unknown[] };
    expect(parsed.documents[0]).toEqual(JSON.parse(JSON.stringify(encodeDocument(docs[0]!))));
  });

  it("is recognised by its envelope, and nothing else is", () => {
    expect(isLibraryFile({ format: LIBRARY_FORMAT })).toBe(true);
    expect(isLibraryFile({ format: "chemistry-sketcher-library" })).toBe(true);
    expect(isLibraryFile({ format: "some-other-library" })).toBe(false);
    expect(isLibraryFile(encodeDocument(library()[0]!))).toBe(false);
    expect(isLibraryFile(null)).toBe(false);
    // Untrusted input: an inherited `format` is not the file saying so.
    expect(isLibraryFile(Object.create({ format: LIBRARY_FORMAT }))).toBe(false);
  });

  it("refuses a library from a newer version rather than dropping what it added", () => {
    const read = readLibrary({
      format: LIBRARY_FORMAT,
      formatVersion: LIBRARY_FORMAT_VERSION + 1,
      exportedAt: NOW,
      documents: [],
    });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toMatch(/newer version/);
  });

  it("imports what reads and names what did not, like an SDF", () => {
    const [good] = library();
    const read = readLibrary({
      format: LIBRARY_FORMAT,
      formatVersion: LIBRARY_FORMAT_VERSION,
      exportedAt: NOW,
      documents: [
        encodeDocument(good!),
        { schemaVersion: SCHEMA_VERSION + 1, id: "from_the_future" },
        { hello: "world" },
      ],
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.documents.map((doc) => doc.id)).toEqual(["doc_benzene"]);
    expect(read.entries).toBe(3);
    expect(read.failures).toHaveLength(2);
    expect(read.failures[0]).toMatch(/^sketch 2 of 3: .*newer version/);
  });

  it("keeps the first of two entries that share an id, and says so", () => {
    const [first] = library();
    const second = createDocument({ id: "doc_benzene", title: "Ethanol", molecule: ethanol(), now: NOW });
    const read = readLibrary({
      format: LIBRARY_FORMAT,
      formatVersion: LIBRARY_FORMAT_VERSION,
      exportedAt: NOW,
      documents: [encodeDocument(first!), encodeDocument(second)],
    });
    expect(read.ok && read.documents.map((doc) => doc.metadata.title)).toEqual(["Benzene"]);
    expect(read.ok && read.failures[0]).toMatch(/repeats the id/);
  });

  it("refuses a file in which nothing reads", () => {
    const read = readLibrary({
      format: LIBRARY_FORMAT,
      formatVersion: LIBRARY_FORMAT_VERSION,
      exportedAt: NOW,
      documents: [{ nope: true }],
    });
    expect(read.ok).toBe(false);
  });

  it("opens through the ordinary import path as N documents", async () => {
    // So a library file dropped on the editor behaves like an SDF: the first
    // opens and the rest are saved. The reader never asks for RDKit.
    let rdkitLoads = 0;
    const result = await openText(serializeLibrary(library(), NOW).text, {
      loadRdkit: () => {
        rdkitLoads++;
        return Promise.reject(new Error("not needed"));
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents).toHaveLength(3);
    expect(result.value.warnings).toEqual([]);
    expect(rdkitLoads).toBe(0);
  });

  it("still opens a backup written under the old name (decision 229)", async () => {
    // A file exported before the rename differs from today's in the
    // envelope's name and nothing else.
    expect(LEGACY_LIBRARY_FORMATS).toContain("chemistry-sketcher-library");
    const today = JSON.parse(serializeLibrary(library(), NOW).text) as Record<string, unknown>;
    const old = JSON.stringify({ ...today, format: "chemistry-sketcher-library" });

    const result = await openText(old, { loadRdkit: () => Promise.reject(new Error("not needed")) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [benzeneBack, acetateBack, sulfoneBack] = result.value.documents;
    expect(molecularFormula(benzeneBack!.molecule)).toBe("C6H6");
    expect(netCharge(acetateBack!.molecule)).toBe(-1);
    expect(elementCounts(sulfoneBack!.molecule)).toEqual(elementCounts(dimethylSulfone()));
  });
});
