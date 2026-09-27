import {
  benzene,
  buildMolecule,
  elementCounts,
  emptyMolecule,
  withStereoGroups,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { DEFAULT_DISPLAY_FLAGS } from "@starter/chem-render";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANELS,
  DISPLAY_FLAG_KEYS,
  VIEW_KINDS,
  defaultPanelsFor,
  SCHEMA_VERSION,
  createDocument,
  createPanel,
  decodeDocument,
  defaultRepresentation,
  encodeDocument,
  moleculeSchema,
  safeDecodeDocument,
  touchDocument,
  withFigureLayout,
  MAX_FIGURE_COLUMNS,
  STEREO_GROUP_KIND_VALUES,
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

/**
 * A racemate: threo/erythro 3-chlorobutan-2-ol with BOTH stereocentres in one
 * AND group, plus a separately-asserted absolute centre and a relative one.
 *
 * This is the fixture the `either` bug would have caught. A widened `Molecule`
 * whose schema had not been widened with it encodes fine — `encodeMolecule`
 * returns a `JsonObject`, so a new member is not a type error — and then fails
 * to decode, and one grouped molecule is enough to lose a whole document.
 */
function racemate(): Molecule {
  const ids: string[] = [];
  const mol = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 0.87, y: 0.5 });
    const o = b.atom("O", { x: 0.87, y: 1.5 });
    const c3 = b.atom("C", { x: 1.74, y: 0 });
    const c4 = b.atom("C", { x: 2.61, y: 0.5 });
    const cl = b.atom("Cl", { x: 1.74, y: -1 });
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
    b.bond(c3, cl, 1, "hash");
    ids.push(c2, c3);
  });
  return withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: ids }]);
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
  ["a racemate with an AND group", racemate],
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

  it("still decodes a v1 document written before four of the flags existed", () => {
    // THE COMPATIBILITY CASE DECISION 10 CREATED. Every document saved before
    // the unification carries exactly four display fields; making the other
    // four required in the schema would have made the entire saved corpus
    // fail to decode, and no fixture-based test would have caught it because
    // the fixtures get regenerated with the new fields present. So the
    // four-field object below is written out by hand, deliberately, and must
    // keep working.
    const encoded = encodeDocument(
      createDocument({ id: "doc-old", molecule: ethanol(), now: NOW }),
    ) as {
      panels: { representation: { kind: string; display: Record<string, boolean> } }[];
    };
    for (const panel of encoded.panels) {
      panel.representation.display = {
        showCarbonLabels: panel.representation.display.showCarbonLabels!,
        aromaticCircles: panel.representation.display.aromaticCircles!,
        showLonePairs: panel.representation.display.showLonePairs!,
        showStereoDescriptors: panel.representation.display.showStereoDescriptors!,
      };
    }
    const decoded = decodeDocument(encoded);
    const skeletal = decoded.panels[0]!.representation.display;
    // The four it carried survive verbatim...
    expect(skeletal.aromaticCircles).toBe(true);
    expect(skeletal.showCarbonLabels).toBe(false);
    // ...and the four it could not carry come from the kind's defaults rather
    // than from `false`: a document saved before `showCharges` was
    // persistable never meant "hide the charges".
    expect(skeletal.showCharges).toBe(true);
    expect(skeletal.showStereoBonds).toBe(true);
    expect(skeletal.showImplicitHydrogens).toBe(false);
    expect(skeletal.showLocants).toBe(false);
    expect(undefinedValuedPaths(decoded)).toEqual([]);
  });

  it("round-trips every display flag against every view kind's default", () => {
    // Each flag flipped away from its kind's default, one at a time, so a
    // codec that silently fell back to the default for any single key — the
    // exact shape of the decision-10 drift — fails on that key by name.
    for (const kind of VIEW_KINDS) {
      for (const key of DISPLAY_FLAG_KEYS) {
        const base = defaultRepresentation(kind).display;
        const panel = createPanel(kind);
        const flipped = {
          ...panel,
          representation: {
            kind,
            display: { ...base, [key]: !base[key] },
          },
        };
        const original = createDocument({
          id: `doc-${kind}-${key}`,
          molecule: ethanol(),
          panels: [flipped],
          now: NOW,
        });
        const decoded = roundTrip(original);
        expect(decoded.panels[0]!.representation, `${kind}.${key}`).toEqual(
          flipped.representation,
        );
        expect(decoded.panels[0]!.representation.display[key]).toBe(!base[key]);
      }
    }
  });

  it("opens a document carrying the legacy showAtomIndices key, and drops it", () => {
    // DECISION 18. Documents saved between decision 10 and the rename carry
    // `showAtomIndices`; they must open. Its value is NOT carried into
    // `showLocants` — an atomIds position is not a chemical locant — so a
    // document that had it ON opens with locants at the kind's default (off).
    // The panels alternate true and false, so neither value leaks through.
    const encoded = encodedFixture();
    expect(encoded.panels.length).toBeGreaterThan(1);
    encoded.panels.forEach((panel: { representation: { display: Record<string, boolean> } }, index: number) => {
      const display = panel.representation.display;
      delete display.showLocants;
      display.showAtomIndices = index % 2 === 0;
    });
    const json = JSON.parse(JSON.stringify(encoded)) as unknown;

    const decoded = decodeDocument(json);
    for (const panel of decoded.panels) {
      const display = panel.representation.display;
      expect(Object.hasOwn(display, "showAtomIndices")).toBe(false);
      expect(display.showLocants).toBe(false);
      expect(Object.keys(display).sort()).toEqual([...DISPLAY_FLAG_KEYS].sort());
    }
    expect(undefinedValuedPaths(decoded)).toEqual([]);

    const reencoded = encodeDocument(decoded);
    expect(JSON.stringify(reencoded)).not.toContain("showAtomIndices");
    expect(undefinedValuedPaths(reencoded)).toEqual([]);

    const again = decodeDocument(JSON.parse(JSON.stringify(reencoded)));
    expect(again).toEqual(decoded);
    expect(Object.keys(again.panels[0]!.representation.display).sort()).toEqual(
      Object.keys(decoded.panels[0]!.representation.display).sort(),
    );
  });

  it("still validates the legacy showAtomIndices key as a boolean", () => {
    // Accepted, not ignored: it was a boolean field of v1, and a v1 document
    // holding a string there is as malformed as it always was.
    const encoded = encodedFixture();
    encoded.panels[0].representation.display.showAtomIndices = "yes";
    expect(safeDecodeDocument(encoded).ok).toBe(false);
  });

  it("lets a real showLocants value win over a legacy key beside it", () => {
    const encoded = encodedFixture();
    encoded.panels[0].representation.display.showAtomIndices = false;
    encoded.panels[0].representation.display.showLocants = true;
    const decoded = decodeDocument(encoded);
    expect(decoded.panels[0]!.representation.display.showLocants).toBe(true);
  });

  it("strips a display key this build does not know (decision 38, accepted until v2)", () => {
    // The reverse of the legacy case: a newer build's flag reaching this one
    // is dropped on decode, so re-saving here loses it. Accepted for now and
    // owed to the scheme-model v2 bump; this test pins today's behaviour so
    // a change to it is a deliberate one.
    const encoded = encodedFixture();
    encoded.panels[0].representation.display.showSomethingNewer = true;
    const decoded = decodeDocument(encoded);
    expect(Object.hasOwn(decoded.panels[0]!.representation.display, "showSomethingNewer")).toBe(
      false,
    );
    expect(JSON.stringify(encodeDocument(decoded))).not.toContain("showSomethingNewer");
  });

  it("is still schema version 1: the rename is additive", () => {
    // The scheme-model task owns the single bump to 2. A second bump here
    // would give one release two migrations.
    expect(SCHEMA_VERSION).toBe(1);
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
    // THE DEFAULTS ARE CHEM-RENDER'S (decision 10), so this asserts the
    // conventions rather than a table that lives here. Skeletal is the
    // neutral baseline plus the aromatic circle; a fully explicit structure
    // spells out its carbons; a Lewis structure is defined by its lone pairs.
    expect(defaultRepresentation("skeletal").display).toEqual({
      ...DEFAULT_DISPLAY_FLAGS,
      aromaticCircles: true,
    });
    expect(defaultRepresentation("explicitH").display.showCarbonLabels).toBe(true);
    expect(defaultRepresentation("lewis").display.showLonePairs).toBe(true);
    // Kekulé means alternating bonds and BARE carbons (decision 11): no
    // labels, and no circle, which is the only thing distinguishing it from
    // skeletal once the labels are gone.
    expect(defaultRepresentation("kekule").display.showCarbonLabels).toBe(false);
    expect(defaultRepresentation("kekule").display.aromaticCircles).toBe(false);
    expect(defaultRepresentation("sumFormula").display.showCarbonLabels).toBe(
      false,
    );
  });

  it("stores every flag the renderer honours, not a subset of them", () => {
    // The drift decision 10 closed: four of chem-render's eight flags had no
    // persisted home, so a chemist could turn one on and not save it. The
    // display object is now generated from chem-render's own key list.
    expect(Object.keys(defaultRepresentation("skeletal").display).sort()).toEqual(
      [...DISPLAY_FLAG_KEYS].sort(),
    );
  });

  it("takes the aromatic-circle default from the style preset", () => {
    // Circle-versus-Kekule is a PER-PANEL choice — a figure has to be able to
    // say "this one draws the circle" — and the preset supplies only its
    // initial value. Both shipped presets now DEFER TO THE VIEW KIND, because
    // after decision 11 stripped Kekulé's carbon labels the circle is the only
    // thing left distinguishing the two views; a preset-wide "circles off"
    // would collapse them back into one picture.
    //
    // The point of the assertion is that the parameter is WIRED, not that the
    // two answers differ today: a third preset with the opposite convention
    // adds a row to the table and this test is where it would show.
    for (const preset of ["publication", "screen"] as const) {
      expect(defaultRepresentation("skeletal", preset).display.aromaticCircles).toBe(
        true,
      );
      expect(
        createPanel("skeletal", undefined, preset).representation.display
          .aromaticCircles,
      ).toBe(true);
      expect(
        createPanel("kekule", undefined, preset).representation.display
          .aromaticCircles,
      ).toBe(false);
      expect(
        defaultPanelsFor(preset).every(
          (panel) =>
            panel.representation.display.aromaticCircles ===
            (panel.representation.kind === "skeletal"),
        ),
      ).toBe(true);
    }
    // A document created under a preset gets panels seeded from it, rather
    // than from a constant frozen before any preset was chosen.
    const doc = createDocument({ stylePreset: "publication" });
    expect(doc.panels.map((panel) => panel.representation.kind)).toEqual([
      "skeletal",
      "sumFormula",
    ]);
  });

  it("gives every created panel its own id", () => {
    const a = createPanel("kekule");
    const b = createPanel("kekule");
    expect(a.id).not.toBe(b.id);
    expect(Object.hasOwn(a, "caption")).toBe(false);
    expect(createPanel("kekule", "Scheme 2").caption).toBe("Scheme 2");
  });
});

describe("figure layout (additive, no schema bump)", () => {
  it("round-trips a column count", () => {
    const original = createDocument({
      id: "doc-figure",
      molecule: ethanol(),
      figure: { columns: 2 },
      now: NOW,
    });
    const encoded = JSON.parse(JSON.stringify(encodeDocument(original))) as Record<string, unknown>;
    expect(encoded.figure).toEqual({ columns: 2 });
    expect(encoded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    const decoded = decodeDocument(encoded);
    expect(decoded.figure).toEqual({ columns: 2 });
    expect(decoded).toEqual(original);
  });

  it("decodes a v1 document written before the field existed, with no key", () => {
    const old = JSON.parse(
      JSON.stringify(encodeDocument(createDocument({ id: "old", molecule: ethanol(), now: NOW }))),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(old, "figure")).toBe(false);
    const decoded = decodeDocument(old);
    expect(Object.hasOwn(decoded, "figure")).toBe(false);
    expect(Object.hasOwn(encodeDocument(decoded) as object, "figure")).toBe(false);
  });

  it("rejects a column count that is not a whole number in range", () => {
    const base = JSON.parse(
      JSON.stringify(encodeDocument(createDocument({ id: "bad", molecule: ethanol(), now: NOW }))),
    ) as Record<string, unknown>;
    for (const columns of [0, -1, 1.5, MAX_FIGURE_COLUMNS + 1, "2"]) {
      expect(safeDecodeDocument({ ...base, figure: { columns } }).ok).toBe(false);
    }
  });

  it("sets and clears the layout without leaving an undefined-valued key", () => {
    const doc = createDocument({ molecule: ethanol(), now: NOW });
    const set = withFigureLayout(doc, { columns: 3 });
    expect(set.figure).toEqual({ columns: 3 });
    expect(withFigureLayout(doc, { columns: 99 }).figure).toEqual({ columns: MAX_FIGURE_COLUMNS });
    const cleared = withFigureLayout(set, null);
    expect(Object.hasOwn(cleared, "figure")).toBe(false);
  });
});


describe("stereo groups (additive, no schema bump)", () => {
  /** An encoded document whose molecule carries one AND group, as a mutable
   *  plain object to corrupt. */
  function groupedFixture(): Record<string, any> {
    return JSON.parse(
      JSON.stringify(encodeDocument(documentOf(racemate(), "racemate"))),
    ) as Record<string, any>;
  }

  function molOf(encoded: Record<string, any>): Record<string, any> {
    return encoded.molecule as Record<string, any>;
  }

  it("round-trips a group through real JSON, at schema version 1", () => {
    const original = documentOf(racemate(), "racemate");
    const encoded = groupedFixture();
    expect(molOf(encoded).stereoGroups).toEqual([
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]);
    // O1: the field is optional and additive, so the version does not move. A
    // bump here would make `.max(SCHEMA_VERSION)` reject every document the
    // other build writes.
    expect(encoded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    expect(roundTrip(original)).toEqual(original);
  });

  it("decodes a document written before the field existed, with no key", () => {
    const old = encodedFixture();
    expect(Object.hasOwn(molOf(old), "stereoGroups")).toBe(false);
    const decoded = decodeDocument(old);
    // Absent has to stay absent through the whole cycle: `{}` and
    // `{ stereoGroups: [] }` are two spellings of one statement that no
    // `toEqual` would match, and absent already means something different from
    // an explicit abs group (decision 91).
    expect(Object.hasOwn(decoded.molecule, "stereoGroups")).toBe(false);
    const reencoded = encodeDocument(decoded) as { molecule: Record<string, unknown> };
    expect(Object.hasOwn(reencoded.molecule, "stereoGroups")).toBe(false);
  });

  it("keeps an explicit abs group distinct from no groups (decision 91)", () => {
    const encoded = groupedFixture();
    molOf(encoded).stereoGroups = [{ kind: "abs", index: 1, atomIds: ["a2", "a4"] }];
    const decoded = decodeDocument(encoded);
    expect(decoded.molecule.stereoGroups).toEqual([
      { kind: "abs", index: 1, atomIds: ["a2", "a4"] },
    ]);
  });

  it("names the atom when one atom is in two groups (T11)", () => {
    const encoded = groupedFixture();
    molOf(encoded).stereoGroups = [
      { kind: "and", index: 1, atomIds: ["a2"] },
      { kind: "or", index: 1, atomIds: ["a2"] },
    ];
    expect(messagesFor(encoded).join(" ")).toMatch(/a2 is in stereo groups/);
  });

  it("rejects a group that names one atom twice", () => {
    // The arm nothing pinned, and the one whose consequence is a WRONG LABEL
    // rather than a rejected file: with this refinement deleted, a group holding
    // `[a2, a2]` on a molecule with two centres decoded clean and
    // `stereoGroupCoverage` read it as `rac-` — a racemate claim about a mixture
    // of diastereomers. chem-core now counts distinct centres as well, so the two
    // halves defend each other.
    const encoded = groupedFixture();
    molOf(encoded).stereoGroups = [{ kind: "and", index: 1, atomIds: ["a2", "a2"] }];
    expect(messagesFor(encoded).join(" ")).toMatch(/names atom a2 twice/);
    // And the honest single mention of the same atom is accepted, so the
    // refinement is about the repeat and not about the id.
    const once = groupedFixture();
    molOf(once).stereoGroups = [{ kind: "and", index: 1, atomIds: ["a2"] }];
    expect(safeDecodeDocument(once).ok).toBe(true);
  });

  it("rejects a group naming an atom that does not exist, a prototype member included", () => {
    for (const atomId of ["a99", "toString", "__proto__", "constructor"]) {
      const encoded = groupedFixture();
      molOf(encoded).stereoGroups = [{ kind: "and", index: 1, atomIds: [atomId] }];
      expect(messagesFor(encoded).join(" "), atomId).toMatch(/is not an atom/);
    }
  });

  it("rejects an empty group, a present-but-empty list, and a repeated index", () => {
    const empty = groupedFixture();
    molOf(empty).stereoGroups = [{ kind: "and", index: 1, atomIds: [] }];
    expect(safeDecodeDocument(empty).ok).toBe(false);

    const none = groupedFixture();
    molOf(none).stereoGroups = [];
    expect(messagesFor(none).join(" ")).toMatch(/present but empty/);

    const repeated = groupedFixture();
    molOf(repeated).stereoGroups = [
      { kind: "and", index: 1, atomIds: ["a2"] },
      { kind: "and", index: 1, atomIds: ["a4"] },
    ];
    expect(messagesFor(repeated).join(" ")).toMatch(/both carry index 1/);

    // Per KIND, so these two are different groups and must be accepted.
    const perKind = groupedFixture();
    molOf(perKind).stereoGroups = [
      { kind: "and", index: 1, atomIds: ["a2"] },
      { kind: "or", index: 1, atomIds: ["a4"] },
    ];
    expect(safeDecodeDocument(perKind).ok).toBe(true);
  });

  it("rejects a numbered abs group, since V3000 writes STEABS unnumbered", () => {
    const encoded = groupedFixture();
    molOf(encoded).stereoGroups = [{ kind: "abs", index: 2, atomIds: ["a2"] }];
    expect(messagesFor(encoded).join(" ")).toMatch(/absolute collection/);
  });

  it("rejects an index or a kind the model cannot express", () => {
    for (const group of [
      { kind: "and", index: 0, atomIds: ["a2"] },
      { kind: "and", index: 1.5, atomIds: ["a2"] },
      { kind: "and", index: -1, atomIds: ["a2"] },
      { kind: "racemic", index: 1, atomIds: ["a2"] },
      { kind: "and", index: 1, atomIds: "a2" },
    ]) {
      const encoded = groupedFixture();
      molOf(encoded).stereoGroups = [group];
      expect(safeDecodeDocument(encoded).ok, JSON.stringify(group)).toBe(false);
    }
  });

  it("keeps the kind list and the model in step", () => {
    // The two-way `satisfies` guard in document.ts is the compile-time half;
    // this is the half that fails when someone adds a kind and forgets the list.
    expect([...STEREO_GROUP_KIND_VALUES]).toEqual(["abs", "and", "or"]);
    for (const kind of STEREO_GROUP_KIND_VALUES) {
      const encoded = groupedFixture();
      molOf(encoded).stereoGroups = [
        { kind, index: 1, atomIds: ["a2"] },
      ];
      expect(safeDecodeDocument(encoded).ok, kind).toBe(true);
    }
  });
});
