import { benzene, buildMolecule, elementCounts, emptyMolecule } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANELS,
  SCHEMA_VERSION,
  createDocument,
  createPanel,
  decodeDocument,
  defaultRepresentation,
  encodeDocument,
  moleculeSchema,
  safeDecodeDocument,
  touchDocument,
  type SketchDocument,
} from "./document.js";

const NOW = "2024-03-01T12:00:00.000Z";

/** Ethanol, CH3CH2OH — no optional atom field anywhere, which is the case the
 *  "no undefined keys" rule is really about. */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 0.87, y: 0.5 });
    const o = b.atom("O", { x: 1.74, y: 0 });
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** Acetate, CH3COO- — carries a formal charge and a double bond. */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", { x: 0, y: 0 });
    const carboxyl = b.atom("C", { x: 0.87, y: 0.5 });
    const carbonyl = b.atom("O", { x: 0.87, y: 1.5 });
    const anionic = b.atom("O", { x: 1.74, y: 0 }, { charge: -1 });
    b.bond(methyl, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, anionic, 1);
  });
}

/**
 * A stereocentre drawn with wedge and hash bonds, plus a labelled placeholder
 * and a 13-C label — between them these exercise every optional atom field
 * and every bond stereo value the format has.
 */
function stereocentre(): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", { x: 0, y: 0 }, { isotope: 13 });
    const br = b.atom("Br", { x: 1, y: 0 });
    const cl = b.atom("Cl", { x: -0.5, y: 0.87 });
    const r = b.atom(
      "C",
      { x: -0.5, y: -0.87 },
      { label: "R", explicitHydrogenCount: 0 },
    );
    b.bond(c, br, 1, "wedge");
    b.bond(c, cl, 1, "hash");
    b.bond(c, r, 1, "wavy");
    // Added after the bonds so the existing ids below keep their numbers:
    // atoms and bonds share one monotonic counter.
    const alkene = b.atom("C", { x: 1.5, y: 1 });
    // `either` — the crossed double bond, cis/trans unspecified. Added when
    // chem-core's molblock reader started producing it from V2000 stereo code
    // 3: the enum here had never heard of it, so a sketch holding one encoded
    // silently and then failed to decode, taking the whole document with it.
    b.bond(br, alkene, 2, "either");
  });
}

function documentOf(molecule: Molecule, title: string): SketchDocument {
  return createDocument({ id: `doc-${title}`, title, molecule, now: NOW });
}

/** Through real JSON, not just through the schemas: a value that survives the
 *  codec but not `JSON.stringify` has not actually round-tripped. */
function roundTrip(doc: SketchDocument): SketchDocument {
  return decodeDocument(JSON.parse(JSON.stringify(encodeDocument(doc))));
}

/** Every own key anywhere in `value` whose value is `undefined`. */
function undefinedValuedPaths(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  const visit = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const child = (node as Record<string, unknown>)[key];
      if (child === undefined) found.push(`${at}.${key}`);
      else visit(child, `${at}.${key}`);
    }
  };
  visit(value, path);
  return found;
}

/** A valid encoded document, as a mutable plain object to corrupt. */
function encodedFixture(): Record<string, any> {
  return JSON.parse(
    JSON.stringify(encodeDocument(documentOf(ethanol(), "fixture"))),
  ) as Record<string, any>;
}

function messagesFor(value: unknown): string[] {
  const result = safeDecodeDocument(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error.issues.map((issue) => issue.message);
}

const FIXTURES: ReadonlyArray<readonly [string, () => Molecule]> = [
  ["benzene", () => benzene()],
  ["ethanol", ethanol],
  ["acetate", acetate],
  ["a wedge-bearing stereocentre", stereocentre],
  ["an empty molecule", emptyMolecule],
];

describe("round trip", () => {
  for (const [name, build] of FIXTURES) {
    it(`preserves ${name}`, () => {
      const original = documentOf(build(), name);
      const decoded = roundTrip(original);

      expect(decoded.molecule.atomIds).toEqual(original.molecule.atomIds);
      expect(decoded.molecule.bondIds).toEqual(original.molecule.bondIds);
      expect(decoded.molecule.nextId).toBe(original.molecule.nextId);
      expect(elementCounts(decoded.molecule)).toEqual(
        elementCounts(original.molecule),
      );
      expect(decoded).toEqual(original);
    });
  }

  it("keeps atom insertion order even when the JSON object order differs", () => {
    // Object key order in a file is not something we control — a reserialising
    // tool may reorder it. `atomIds` is the authoritative order, so shuffling
    // the records must change nothing.
    const encoded = encodedFixture();
    const shuffled: Record<string, unknown> = {};
    for (const id of [...(encoded.molecule.atomIds as string[])].reverse()) {
      shuffled[id] = encoded.molecule.atoms[id];
    }
    encoded.molecule.atoms = shuffled;

    const decoded = decodeDocument(encoded);
    expect(decoded.molecule.atomIds).toEqual(["a1", "a2", "a3"]);
    expect(decoded.molecule.atoms.a3?.element).toBe("O");
  });

  it("preserves the panel list and its captions", () => {
    const original = createDocument({
      id: "doc-panels",
      title: "Panels",
      molecule: ethanol(),
      stylePreset: "publication",
      panels: [
        ...DEFAULT_PANELS,
        createPanel("lewis", "Figure 1. Lone pairs on oxygen."),
      ],
      now: NOW,
    });
    const decoded = roundTrip(original);
    expect(decoded.panels).toEqual(original.panels);
    expect(decoded.panels[2]?.caption).toBe(
      "Figure 1. Lone pairs on oxygen.",
    );
    expect(decoded.stylePreset).toBe("publication");
  });
});

describe("no undefined-valued keys", () => {
  it("leaves none anywhere in a decoded document", () => {
    for (const [name, build] of FIXTURES) {
      const decoded = roundTrip(documentOf(build(), name));
      expect(undefinedValuedPaths(decoded)).toEqual([]);
    }
  });

  it("leaves none anywhere in an encoded document", () => {
    for (const [name, build] of FIXTURES) {
      expect(undefinedValuedPaths(encodeDocument(documentOf(build(), name)))).toEqual(
        [],
      );
    }
  });

  it("drops keys that arrive explicitly set to undefined", () => {
    // This is the shape a hand-built object or a spread of a partial produces,
    // and zod keeps such a key on the parsed value. The decoder must not.
    const encoded = encodedFixture();
    encoded.molecule.atoms.a1.isotope = undefined;
    encoded.molecule.atoms.a1.label = undefined;
    encoded.molecule.atoms.a2.explicitHydrogenCount = undefined;
    encoded.panels[0].caption = undefined;
    encoded.metadata.author = undefined;
    encoded.metadata.notes = undefined;

    const decoded = decodeDocument(encoded);
    expect(undefinedValuedPaths(decoded)).toEqual([]);
    expect(Object.hasOwn(decoded.molecule.atoms.a1!, "isotope")).toBe(false);
    expect(Object.hasOwn(decoded.panels[0]!, "caption")).toBe(false);
    expect(Object.hasOwn(decoded.metadata, "author")).toBe(false);
  });

  it("makes an atom that never had an isotope deep-equal to its round-tripped self", () => {
    const original = documentOf(ethanol(), "ethanol");
    const before = original.molecule.atoms.a1!;
    const after = roundTrip(original).molecule.atoms.a1!;

    expect(after).toEqual(before);
    // `toEqual` ignores keys whose value is undefined, so the own-key lists
    // have to be compared separately — that difference is exactly the bug.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(Object.keys(after)).not.toContain("isotope");
  });

  it("keeps the optional atom fields that are genuinely present", () => {
    const decoded = roundTrip(documentOf(stereocentre(), "stereocentre"));
    expect(decoded.molecule.atoms.a1?.isotope).toBe(13);
    expect(decoded.molecule.atoms.a4?.label).toBe("R");
    expect(decoded.molecule.atoms.a4?.explicitHydrogenCount).toBe(0);
    expect(decoded.molecule.bonds.b5?.stereo).toBe("wedge");
    expect(decoded.molecule.bonds.b6?.stereo).toBe("hash");
    expect(decoded.molecule.bonds.b7?.stereo).toBe("wavy");
    expect(decoded.molecule.bonds.b9?.stereo).toBe("either");
  });
});

describe("structural validation", () => {
  it("rejects a bond pointing at an atom that does not exist", () => {
    const encoded = encodedFixture();
    encoded.molecule.bonds.b4.to = "ghost";
    expect(messagesFor(encoded)).toContain(
      "bond b4 ends at ghost, which is not an atom",
    );
  });

  it("rejects a bond ending at an id that only names an Object.prototype member", () => {
    // `atoms` is a plain object, so `!mol.atoms["toString"]` is false and a
    // membership test written that way waves this through. The decoded
    // molecule would then carry a dangling endpoint, and chem-core's
    // `requireAtom` — an index read as well — would hand back
    // `Object.prototype.toString` instead of throwing "No such atom".
    const encoded = encodedFixture();
    encoded.molecule.bonds.b4.to = "toString";
    expect(messagesFor(encoded)).toContain(
      "bond b4 ends at toString, which is not an atom",
    );
  });

  it("rejects an id list naming a record that only exists on Object.prototype", () => {
    const encoded = encodedFixture();
    encoded.molecule.atomIds.push("constructor");
    expect(messagesFor(encoded)).toContain(
      "atomIds references constructor, which is missing from atoms",
    );
  });

  it("rejects a duplicated id-list entry", () => {
    const encoded = encodedFixture();
    encoded.molecule.atomIds = ["a1", "a2", "a2", "a3"];
    expect(messagesFor(encoded)).toContain("duplicate id a2 in atomIds");
  });

  it("rejects an id list that names a record which is not there", () => {
    const encoded = encodedFixture();
    encoded.molecule.atomIds.push("ghost");
    expect(messagesFor(encoded)).toContain(
      "atomIds references ghost, which is missing from atoms",
    );
  });

  it("rejects a record that no id list mentions", () => {
    const encoded = encodedFixture();
    encoded.molecule.bondIds.pop();
    expect(messagesFor(encoded)).toContain("bonds.b5 is missing from bondIds");
  });

  it("rejects a record whose key and inner id disagree", () => {
    const encoded = encodedFixture();
    encoded.molecule.atoms.a2.id = "a7";
    expect(messagesFor(encoded)).toContain("atoms.a2 carries the id a7");
  });

  it("rejects a self-bond", () => {
    const encoded = encodedFixture();
    encoded.molecule.bonds.b4.to = encoded.molecule.bonds.b4.from;
    expect(messagesFor(encoded)).toContain("bond b4 joins atom a1 to itself");
  });

  it("rejects two bonds between the same pair of atoms", () => {
    const encoded = encodedFixture();
    encoded.molecule.bonds.b5 = {
      ...encoded.molecule.bonds.b4,
      id: "b5",
    };
    encoded.molecule.bondIds.push("b5");
    encoded.molecule.nextId = 6;
    expect(messagesFor(encoded)).toContain(
      "atoms a1 and a2 are bonded more than once",
    );
  });

  it("rejects a nextId that would hand out an id already in use", () => {
    const encoded = encodedFixture();
    encoded.molecule.nextId = 2;
    const messages = messagesFor(encoded);
    expect(messages).toContain("nextId 2 would reuse the id a2");
    expect(messages).toContain("nextId 2 would reuse the id b5");
  });

  it("accepts a nextId exactly one past the highest id", () => {
    const encoded = encodedFixture();
    expect(encoded.molecule.nextId).toBe(6);
    expect(safeDecodeDocument(encoded).ok).toBe(true);
  });

  it("rejects duplicate panel ids", () => {
    const encoded = encodedFixture();
    encoded.panels.push({ ...encoded.panels[0] });
    expect(messagesFor(encoded)).toContain("duplicate panel id panel-skeletal");
  });

  it("rejects a document from a newer schema version", () => {
    const encoded = encodedFixture();
    encoded.schemaVersion = SCHEMA_VERSION + 1;
    expect(safeDecodeDocument(encoded).ok).toBe(false);
  });

  it("rejects a non-finite coordinate", () => {
    const encoded = encodedFixture();
    encoded.molecule.atoms.a1.pos.x = Number.NaN;
    expect(safeDecodeDocument(encoded).ok).toBe(false);
  });

  it("rejects a metadata timestamp that is not ISO-8601", () => {
    const encoded = encodedFixture();
    encoded.metadata.modifiedAt = "01/03/2024";
    expect(messagesFor(encoded)).toContain("expected an ISO-8601 timestamp");
  });

  it("reports every problem at once instead of throwing on the first", () => {
    const encoded = encodedFixture();
    encoded.molecule.bonds.b4.to = "ghost";
    encoded.molecule.atomIds.push("phantom");
    const result = safeDecodeDocument(encoded);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.issues.length).toBeGreaterThan(1);
    expect(result.error.name).toBe("ZodError");
  });

  it("throws a ZodError from decodeDocument", () => {
    expect(() => decodeDocument({ schemaVersion: 1 })).toThrowError();
  });

  it("validates a bare molecule through moleculeSchema", () => {
    const encoded = encodedFixture();
    const molecule = moleculeSchema.parse(encoded.molecule);
    expect(molecule.atomIds).toEqual(["a1", "a2", "a3"]);
    expect(molecule.nextId).toBe(6);
    expect(undefinedValuedPaths(molecule)).toEqual([]);
  });
});

describe("factories", () => {
  it("stamps a fresh document with the injected timestamp", () => {
    const doc = createDocument({ now: NOW });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.metadata.createdAt).toBe(NOW);
    expect(doc.metadata.modifiedAt).toBe(NOW);
    expect(doc.metadata.title).toBe("Untitled");
    expect(doc.molecule).toEqual(emptyMolecule());
    expect(doc.panels).toEqual(DEFAULT_PANELS);
    expect(undefinedValuedPaths(doc)).toEqual([]);
  });

  it("mints a distinct id per document", () => {
    expect(createDocument({ now: NOW }).id).not.toBe(
      createDocument({ now: NOW }).id,
    );
  });

  it("touchDocument moves modifiedAt only", () => {
    const doc = createDocument({ now: NOW });
    const touched = touchDocument(doc, "2024-03-02T09:30:00.000Z");
    expect(touched.metadata.createdAt).toBe(NOW);
    expect(touched.metadata.modifiedAt).toBe("2024-03-02T09:30:00.000Z");
    expect(touched.molecule).toBe(doc.molecule);
    expect(doc.metadata.modifiedAt).toBe(NOW);
    expect(undefinedValuedPaths(touched)).toEqual([]);
  });

  it("defaults display flags per representation kind", () => {
    expect(defaultRepresentation("skeletal").display).toEqual({
      showCarbonLabels: false,
      aromaticCircles: false,
      showLonePairs: false,
      showStereoDescriptors: false,
    });
    // A fully explicit structure spells out its carbons; a Lewis structure is
    // defined by its lone pairs.
    expect(defaultRepresentation("explicitH").display.showCarbonLabels).toBe(true);
    expect(defaultRepresentation("lewis").display.showLonePairs).toBe(true);
    expect(defaultRepresentation("sumFormula").display.showCarbonLabels).toBe(
      false,
    );
  });

  it("gives every created panel its own id", () => {
    const a = createPanel("kekule");
    const b = createPanel("kekule");
    expect(a.id).not.toBe(b.id);
    expect(Object.hasOwn(a, "caption")).toBe(false);
    expect(createPanel("kekule", "Scheme 2").caption).toBe("Scheme 2");
  });
});
