import { readFileSync } from "node:fs";

import {
  atomNumbering,
  benzene,
  buildMolecule,
  carbohydrates,
  elementCounts,
  emptyMolecule,
  isTestOnlyMolecule,
  joinSpecies,
  locantOf,
  readMolblock,
  removeAtoms,
  setBondBold,
  setBondDative,
  TEST_ONLY_MOLECULE,
  withStereoGroups,
  project,
  stereoConfig,
} from "@starter/chem-core";
import type { Molecule, ProjectionView } from "@starter/chem-core";
import { join } from "node:path";
// The projection harness's layout-to-Molecule builder lives in chem-core's
// TEST tree, never in its published package (decision 210); only a test
// reaches it, and this one hands its product to the document assembler.
import { moleculeFromLayout } from "../../chem-core/test/harness/rebuild.js";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { DEFAULT_DISPLAY_FLAGS, prolineAldol, sn2TransitionState } from "@starter/chem-render";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANELS,
  DISPLAY_FLAG_KEYS,
  DOCUMENT_UPGRADES,
  addSchemeAnnotation,
  isFromNewerBuild,
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
  withLocants,
  pruneLocants,
  setAtomLocant,
  MAX_FIGURE_COLUMNS,
  MAX_LOCANT_LENGTH,
  NEW_DOCUMENT_PRESET,
  STEREO_GROUP_KIND_VALUES,
  TestOnlyMoleculeError,
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

  it("refuses a display key this build does not know rather than stripping it (decision 110)", () => {
    // The reverse of the legacy case: a newer build's flag reaching this one.
    // Until v2 it was dropped on decode and the next save lost it (decision
    // 38); now the decode fails and names the cause, so nothing is re-saved.
    const encoded = encodedFixture();
    encoded.panels[0].representation.display.showSomethingNewer = true;
    const result = safeDecodeDocument(encoded);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isFromNewerBuild(result.error)).toBe(true);
    expect(JSON.stringify(result.error.issues)).toContain("showSomethingNewer");
  });

  it("is schema version 2, the scheme model's single bump", () => {
    // The scheme model owns the only bump in the projection and mechanism
    // plan. A second one would give one release two migrations.
    expect(SCHEMA_VERSION).toBe(2);
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

describe("dative and bold bonds (decision 226)", () => {
  it("round-trips both flags and writes no key for a plain bond", () => {
    const plain = ethanol();
    const flagged = setBondBold(setBondDative(plain, "b5", true), "b4", true);
    const decoded = roundTrip(documentOf(flagged, "flags")).molecule;
    expect(decoded.bonds.b5?.dative).toBe(true);
    expect(decoded.bonds.b4?.bold).toBe(true);
    expect(decoded).toEqual(flagged);
    const encoded = encodedFixture();
    expect(Object.keys(encoded.molecule.bonds.b4)).not.toContain("dative");
    expect(Object.keys(encoded.molecule.bonds.b4)).not.toContain("bold");
  });

  it("refuses a dative double bond and a false flag", () => {
    const double = encodedFixture();
    double.molecule.bonds.b4.order = 2;
    double.molecule.bonds.b4.dative = true;
    expect(messagesFor(double)).toContain("bond b4 is dative, which is a single non-aromatic bond");
    const spelledFalse = encodedFixture();
    spelledFalse.molecule.bonds.b4.bold = false;
    expect(safeDecodeDocument(spelledFalse).ok).toBe(false);
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

  it("opens a new document in Publication unless a preset is given (decision 135)", () => {
    expect(NEW_DOCUMENT_PRESET).toBe("publication");
    expect(createDocument({ now: NOW }).stylePreset).toBe("publication");
    // A preset that is stated is kept, which is what a copy and a decoded
    // file rely on.
    expect(createDocument({ now: NOW, stylePreset: "screen" }).stylePreset).toBe("screen");
  });

  it("keeps the preset a stored document states when it decodes", () => {
    // A sketch saved while new documents opened in Screen stored "screen"
    // explicitly, and reopens in it; the default only fills a gap.
    const saved = encodeDocument(createDocument({ now: NOW, stylePreset: "screen" }));
    const reread = JSON.parse(JSON.stringify(saved)) as unknown;
    expect(decodeDocument(reread).stylePreset).toBe("screen");
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
    // Nature (decision 234) is that preset: its guide asks for discrete bonds
    // rather than circles, so even a skeletal panel starts Kekule.
    expect(defaultRepresentation("skeletal", "nature").display.aromaticCircles).toBe(false);
    expect(
      defaultPanelsFor("nature").every(
        (panel) => panel.representation.display.aromaticCircles === false,
      ),
    ).toBe(true);
    const nature = createDocument({ now: NOW, stylePreset: "nature" });
    const reread = JSON.parse(JSON.stringify(encodeDocument(nature))) as unknown;
    expect(decodeDocument(reread).stylePreset).toBe("nature");
    // A document created under a preset gets panels seeded from it, rather
    // than from a constant frozen before any preset was chosen. Screen, so
    // this is the branch that does not reuse `DEFAULT_PANELS`.
    const doc = createDocument({ stylePreset: "screen" });
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


describe("explicit locants (additive on v2, decision 142)", () => {
  /** Open-chain D-glucose from the structure dictionary, as the insert box reads it. */
  function glucose(): Molecule {
    return readMolblock(dictionaryEntryById("aldehydo-d-glucose")!.molblock).molecule;
  }

  it("round-trips, in atom order, and feeds atomNumbering ahead of the derived numbers", () => {
    const molecule = glucose();
    const [unit] = carbohydrates(molecule);
    const [c1, c2] = unit!.backbone;
    const original = createDocument({
      id: "doc-locants",
      molecule,
      // Given out of atom order: the writer puts them back in it.
      locants: { [c2!]: "", [c1!]: "1a" },
      now: NOW,
    });
    expect(Object.keys(original.locants!)).toEqual(
      molecule.atomIds.filter((id) => id === c1 || id === c2),
    );
    const encoded = JSON.parse(JSON.stringify(encodeDocument(original))) as Record<string, unknown>;
    const decoded = decodeDocument(encoded);
    expect(decoded).toEqual(original);
    const numbering = atomNumbering(decoded.molecule, decoded.locants);
    expect(locantOf(numbering, c1!)).toBe("1a");
    // The empty string hides the C2 the rules would derive.
    expect(locantOf(numbering, c2!)).toBeUndefined();
    expect(locantOf(numbering, unit!.backbone[2]!)).toBe("3");
  });

  it("has no key when there are none, and refuses a present-but-empty map", () => {
    const doc = createDocument({ molecule: glucose(), now: NOW });
    expect(Object.hasOwn(doc, "locants")).toBe(false);
    expect(Object.hasOwn(encodeDocument(doc) as object, "locants")).toBe(false);
    expect(Object.hasOwn(withLocants(doc, {}), "locants")).toBe(false);
    const encoded = JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, unknown>;
    expect(safeDecodeDocument({ ...encoded, locants: {} }).ok).toBe(false);
  });

  it("refuses a locant naming an atom the molecule does not hold, prototype names included", () => {
    const doc = createDocument({ molecule: glucose(), now: NOW });
    const encoded = JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, unknown>;
    for (const key of ["a999", "constructor", "toString"]) {
      const result = safeDecodeDocument({ ...encoded, locants: { [key]: "1" } });
      expect(result.ok, key).toBe(false);
    }
    expect(safeDecodeDocument({ ...encoded, locants: { a1: "x".repeat(MAX_LOCANT_LENGTH + 1) } }).ok).toBe(
      false,
    );
    expect(() => withLocants(doc, { constructor: "1" })).toThrow(/does not hold/);
  });

  it("refuses a __proto__ key rather than dropping it with a real locant beside it", () => {
    // JSON.parse makes "__proto__" an OWN key, which is how a hand-edited
    // file carries one; a record parser that assigns it sets a prototype and
    // the entry vanishes. Refused by name, never stripped (decision 110).
    const molecule = glucose();
    const c1 = carbohydrates(molecule)[0]!.backbone[0]!;
    const encoded = JSON.parse(JSON.stringify(encodeDocument(createDocument({ molecule, now: NOW })))) as Record<
      string,
      unknown
    >;
    for (const text of [`{"${c1}":"1","__proto__":"x"}`, `{"__proto__":"1"}`]) {
      const locants = JSON.parse(text) as Record<string, string>;
      expect(Object.hasOwn(locants, "__proto__")).toBe(true);
      expect(messagesFor({ ...encoded, locants }), text).toContain(
        "a locant names __proto__, which is not in the molecule",
      );
    }
    // The same map without the key decodes, so the refusal is about the key.
    expect(safeDecodeDocument({ ...encoded, locants: { [c1]: "1" } }).ok).toBe(true);
  });

  it("prunes the locant of a deleted atom and keeps the rest, by reference when nothing went", () => {
    const molecule = glucose();
    const [unit] = carbohydrates(molecule);
    const [c1, c2] = unit!.backbone;
    const locants = withLocants(createDocument({ molecule, now: NOW }), { [c1!]: "1", [c2!]: "2*" }).locants;
    expect(pruneLocants(locants, molecule)).toBe(locants);
    expect(pruneLocants(locants, removeAtoms(molecule, [c1!]))).toEqual({ [c2!]: "2*" });
    expect(pruneLocants(locants, removeAtoms(molecule, [c1!, c2!]))).toBeUndefined();
  });

  it("sets and clears one atom's locant, returning the document itself on a no-op", () => {
    const molecule = glucose();
    const [unit] = carbohydrates(molecule);
    const c1 = unit!.backbone[0]!;
    const doc = createDocument({ molecule, now: NOW });
    const set = setAtomLocant(doc, c1, "C-1");
    expect(set.locants).toEqual({ [c1]: "C-1" });
    expect(setAtomLocant(set, c1, "C-1")).toBe(set);
    expect(Object.hasOwn(setAtomLocant(set, c1, undefined), "locants")).toBe(false);
    expect(setAtomLocant(doc, c1, undefined)).toBe(doc);
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

  it("round-trips a group through real JSON", () => {
    const original = documentOf(racemate(), "racemate");
    const encoded = groupedFixture();
    expect(molOf(encoded).stereoGroups).toEqual([
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]);
    // O1: the field arrived optional and additive at v1. It rides unchanged
    // into v2, whose bump belongs to the scheme model.
    expect(encoded.schemaVersion).toBe(SCHEMA_VERSION);
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

describe("the scheme model (schema v2)", () => {
  /** Ethanol oxidised to sodium acetate, drawn as one molecule: ethanol
   *  a1-a3 (bonds b4, b5), acetate a6-a9 (b10-b12) five bond lengths right,
   *  and a sodium cation a13 beside it. With the three annotation shapes that
   *  point at structure — a curly arrow, a reaction arrow between species and
   *  a label — their ids minted by the document. */
  function schemeMolecule(): Molecule {
    return buildMolecule((b) => {
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
      b.atom("Na", { x: 8, y: 0 }, { charge: 1 });
    });
  }

  function scheme(): SketchDocument {
    let doc = createDocument({
      id: "doc-scheme",
      title: "scheme",
      molecule: schemeMolecule(),
      now: NOW,
    });
    doc = addSchemeAnnotation(doc, {
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "lonePair", atomId: "a3" },
      sink: { kind: "bond", bondId: "b11" },
      bulge: 0.4,
      skew: -0.1,
    }).document;
    doc = addSchemeAnnotation(doc, {
      kind: "reactionArrow",
      from: ["a1"],
      to: ["a6"],
      row: undefined,
    }).document;
    doc = addSchemeAnnotation(doc, { kind: "text", text: "[O]", at: { x: 3, y: 1 } }).document;
    return doc;
  }

  /** The sodium acetate of `scheme()` joined into one species. */
  function joinedScheme(): SketchDocument {
    const doc = scheme();
    return { ...doc, molecule: joinSpecies(doc.molecule, ["a13", "a9"]) };
  }

  function v1Of(doc: SketchDocument): Record<string, unknown> {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, unknown>;
    delete encoded.annotations;
    delete encoded.nextAnnotationId;
    encoded.schemaVersion = 1;
    return encoded;
  }

  it("opens a v1 document through the upgrade, gains annotations: [], and re-encodes as v2 with nothing lost", () => {
    const original = documentOf(racemate(), "racemate");
    const v1 = v1Of(original);
    // Unmigrated, it is refused by name rather than decoded short of fields.
    expect(safeDecodeDocument(v1).ok).toBe(false);
    const upgraded = DOCUMENT_UPGRADES[1]!(v1);
    const decoded = decodeDocument(upgraded);
    expect(decoded.annotations).toEqual([]);
    expect(decoded.nextAnnotationId).toBe(1);
    expect(decoded.schemaVersion).toBe(2);
    expect(decoded).toEqual(original);
    expect(JSON.stringify(encodeDocument(decoded))).toBe(JSON.stringify(encodeDocument(original)));
  });

  it("round-trips annotations and species joins, and a decoded document equals itself", () => {
    const doc = scheme();
    const joined = joinedScheme();
    expect(joined.molecule.speciesJoins).toEqual([{ atomIds: ["a9", "a13"] }]);
    for (const original of [doc, joined]) {
      const decoded = roundTrip(original);
      expect(decoded).toEqual(original);
      expect(roundTrip(decoded)).toEqual(decoded);
      expect(undefinedValuedPaths(decoded)).toEqual([]);
      expect(undefinedValuedPaths(encodeDocument(decoded))).toEqual([]);
    }
    const reaction = doc.annotations[1]!;
    expect(reaction.kind).toBe("reactionArrow");
    expect(Object.hasOwn(reaction, "row")).toBe(false);
  });

  it("mints ids from the document's counter, so a fixture with arrows is byte-stable", () => {
    const a = scheme();
    const b = scheme();
    expect(a.annotations.map((x) => x.id)).toEqual(["ann_1", "ann_2", "ann_3"]);
    expect(a.nextAnnotationId).toBe(4);
    expect(JSON.stringify(encodeDocument(a))).toBe(JSON.stringify(encodeDocument(b)));
    // Injected ids: the counter defaults to one past the highest.
    const injected = createDocument({
      id: "doc-injected",
      molecule: ethanol(),
      annotations: [{ id: "ann_7", kind: "bracket", species: ["a1"] }],
      now: NOW,
    });
    expect(injected.nextAnnotationId).toBe(8);
  });

  it("refuses a dangling annotation, including one naming a prototype member", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(scheme()))) as Record<string, any>;
    for (const ghost of ["a99", "constructor", "toString"]) {
      const copy = structuredClone(encoded);
      copy.annotations[1].to = [ghost];
      expect(safeDecodeDocument(copy).ok, ghost).toBe(false);
    }
    expect(() =>
      addSchemeAnnotation(scheme(), { kind: "plus", between: ["a1", "constructor"] }),
    ).toThrow(/constructor/);
  });

  it("refuses a duplicate annotation id and a counter that would reuse one", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(scheme()))) as Record<string, any>;
    const duplicate = structuredClone(encoded);
    duplicate.annotations[2].id = "ann_1";
    expect(safeDecodeDocument(duplicate).ok).toBe(false);
    const stale = structuredClone(encoded);
    stale.nextAnnotationId = 3;
    expect(safeDecodeDocument(stale).ok).toBe(false);
  });

  it("refuses a malformed annotation: empty text, a skew past the chord, an empty species list", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(scheme()))) as Record<string, any>;
    const cases: ((copy: Record<string, any>) => void)[] = [
      (copy) => (copy.annotations[2].text = ""),
      (copy) => (copy.annotations[0].skew = 0.75),
      (copy) => (copy.annotations[1].from = []),
      (copy) => (copy.annotations[1].row = -1),
      (copy) => (copy.annotations[0].electrons = "triple"),
    ];
    for (const breakIt of cases) {
      const copy = structuredClone(encoded);
      breakIt(copy);
      expect(safeDecodeDocument(copy).ok, String(breakIt)).toBe(false);
    }
  });

  it("refuses a malformed species join, and decodes a hand-ordered one canonically", () => {
    const joined = joinedScheme();
    const encoded = JSON.parse(JSON.stringify(encodeDocument(joined))) as Record<string, any>;
    const bad: ((copy: Record<string, any>) => void)[] = [
      (copy) => (copy.molecule.speciesJoins = []),
      (copy) => (copy.molecule.speciesJoins = [{ atomIds: ["a9"] }]),
      (copy) => (copy.molecule.speciesJoins = [{ atomIds: ["a9", "constructor"] }]),
      (copy) =>
        (copy.molecule.speciesJoins = [{ atomIds: ["a9", "a13"] }, { atomIds: ["a13", "a1"] }]),
    ];
    for (const breakIt of bad) {
      const copy = structuredClone(encoded);
      breakIt(copy);
      expect(safeDecodeDocument(copy).ok, String(breakIt)).toBe(false);
    }
    const reordered = structuredClone(encoded);
    reordered.molecule.speciesJoins = [{ atomIds: ["a13", "a9"] }];
    expect(decodeDocument(reordered)).toEqual(joined);
  });

  /** `scheme()` plus acetate's O- lone pair to a new O-Na bond: ann_4, index 3. */
  function schemeWithNewBond(): SketchDocument {
    return addSchemeAnnotation(scheme(), {
      kind: "curlyArrow",
      electrons: "pair",
      source: { kind: "lonePair", atomId: "a9" },
      sink: { kind: "newBond", atomIds: ["a9", "a13"] },
      bulge: -0.3,
      skew: 0,
    }).document;
  }

  it("round-trips a new-bond sink additively on v2, and refuses one naming an atom not there (decision 166)", () => {
    const doc = schemeWithNewBond();
    expect(doc.schemaVersion).toBe(2);
    expect(doc.annotations[3]).toMatchObject({ id: "ann_4", sink: { kind: "newBond", atomIds: ["a9", "a13"] } });
    const decoded = roundTrip(doc);
    expect(decoded).toEqual(doc);
    expect(undefinedValuedPaths(encodeDocument(decoded))).toEqual([]);

    const encoded = JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, any>;
    for (const ghost of ["a99", "constructor"]) {
      for (const at of [0, 1]) {
        const copy = structuredClone(encoded);
        copy.annotations[3].sink.atomIds[at] = ghost;
        expect(safeDecodeDocument(copy).ok, `${ghost} at ${at}`).toBe(false);
      }
    }
    expect(() =>
      addSchemeAnnotation(scheme(), {
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "lonePair", atomId: "a9" },
        sink: { kind: "newBond", atomIds: ["a9", "toString"] },
        bulge: 0.3,
        skew: 0,
      }),
    ).toThrow(/toString/);
  });

  it("calls an unknown curly-arrow endpoint kind a newer build's, and a malformed new bond damage", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(schemeWithNewBond()))) as Record<string, any>;
    const newer: ((copy: Record<string, any>) => void)[] = [
      (copy) => (copy.annotations[3].sink = { kind: "orbital", atomId: "a9" }),
      (copy) => (copy.annotations[0].source = { kind: "sigmaHole", atomId: "a3" }),
      (copy) => (copy.annotations[3].sink.order = 2),
    ];
    for (const add of newer) {
      const copy = structuredClone(encoded);
      add(copy);
      const result = safeDecodeDocument(copy);
      expect(result.ok, String(add)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(add)).toBe(true);
    }
    const damaged: ((copy: Record<string, any>) => void)[] = [
      (copy) => (copy.annotations[3].sink.atomIds = ["a9"]),
      (copy) => (copy.annotations[3].sink.atomIds = ["a9", "a13", "a1"]),
      (copy) => (copy.annotations[3].sink.atomIds = ["a9", ""]),
      (copy) => (copy.annotations[3].sink.atomIds = "a9 a13"),
    ];
    for (const breakIt of damaged) {
      const copy = structuredClone(encoded);
      breakIt(copy);
      const result = safeDecodeDocument(copy);
      expect(result.ok, String(breakIt)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(breakIt)).toBe(false);
    }
  });

  it("refuses any key this build does not know, at any depth, as a newer build's document", () => {
    const encoded = JSON.parse(JSON.stringify(encodeDocument(scheme()))) as Record<string, any>;
    const newer: ((copy: Record<string, any>) => void)[] = [
      (copy) => (copy.somethingNewer = 1),
      // `view` is known since decision 128; a newer build's panel key is not.
      (copy) => (copy.panels[0].layer = 2),
      (copy) => (copy.molecule.atoms.a1.mapNumber = 3),
      (copy) => (copy.annotations[1].style = "equilibrium"),
      (copy) => (copy.metadata.license = "CC-BY"),
    ];
    for (const add of newer) {
      const copy = structuredClone(encoded);
      add(copy);
      const result = safeDecodeDocument(copy);
      expect(result.ok, String(add)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(add)).toBe(true);
    }
    // A plain structural error is not mistaken for a newer build.
    const broken = structuredClone(encoded);
    broken.molecule.nextId = 1;
    const result = safeDecodeDocument(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(isFromNewerBuild(result.error)).toBe(false);
  });
});

describe("reaction arrows, conditions, brackets and TS marks (decisions 193, 194, 201, 202)", () => {
  /**
   * Methane burning, CH4 + 2 O2 -> CO2 + 2 H2O, beside the SN2 of hydroxide
   * on bromomethane drawn as its transition state, and the allyl cation's two
   * resonance forms: one molecule, ten species. Every new kind has a real
   * place to sit.
   */
  interface Scheme {
    readonly molecule: Molecule;
    readonly methane: string;
    readonly oxygen: string;
    readonly carbonDioxide: string;
    readonly water: string;
    readonly hydroxideO: string;
    readonly tsCarbon: string;
    readonly bromine: string;
    readonly allylA: string;
    readonly allylB: string;
  }

  function scheme(): Scheme {
    const ids: Record<string, string> = {};
    const molecule = buildMolecule((b) => {
      ids.methane = b.atom("C", { x: 0, y: 0 });
      const o1 = b.atom("O", { x: 2, y: 0 });
      ids.oxygen = o1;
      b.bond(o1, b.atom("O", { x: 3, y: 0 }), 2);
      const c = b.atom("C", { x: 7, y: 0 });
      ids.carbonDioxide = c;
      b.bond(c, b.atom("O", { x: 6, y: 0 }), 2);
      b.bond(c, b.atom("O", { x: 8, y: 0 }), 2);
      ids.water = b.atom("O", { x: 10, y: 0 });
      // The SN2 transition state, three fragments drawn unbonded with their
      // hydrogen counts pinned: HO, CH3, Br.
      ids.hydroxideO = b.atom("O", { x: 0, y: -4 }, { charge: -1, explicitHydrogenCount: 1 });
      ids.tsCarbon = b.atom("C", { x: 1.5, y: -4 }, { explicitHydrogenCount: 3 });
      ids.bromine = b.atom("Br", { x: 3, y: -4 }, { explicitHydrogenCount: 0 });
      // The allyl cation, CH2=CH-CH2+ and +CH2-CH=CH2.
      const a1 = b.atom("C", { x: 0, y: -8 });
      const a2 = b.atom("C", { x: 0.87, y: -7.5 });
      const a3 = b.atom("C", { x: 1.74, y: -8 }, { charge: 1 });
      b.bond(a1, a2, 2);
      b.bond(a2, a3, 1);
      ids.allylA = a1;
      const d1 = b.atom("C", { x: 4, y: -8 }, { charge: 1 });
      const d2 = b.atom("C", { x: 4.87, y: -7.5 });
      const d3 = b.atom("C", { x: 5.74, y: -8 });
      b.bond(d1, d2, 1);
      b.bond(d2, d3, 2);
      ids.allylB = d1;
    });
    return { molecule, ...ids } as unknown as Scheme;
  }

  function schemeDocument(): { doc: SketchDocument; s: Scheme } {
    const s = scheme();
    let doc = createDocument({ id: "doc-marks", title: "marks", molecule: s.molecule, now: NOW });
    const add = (draft: Parameters<typeof addSchemeAnnotation>[1]): void => {
      doc = addSchemeAnnotation(doc, draft).document;
    };
    add({ kind: "coefficient", species: s.oxygen, value: 2 });
    add({ kind: "plus", between: [s.methane, s.oxygen] });
    add({
      kind: "reactionArrow",
      from: [s.methane, s.oxygen],
      to: [s.carbonDioxide, s.water],
      row: undefined,
      equilibrium: undefined,
      conditions: {
        steps: [
          [
            { kind: "text", text: "spark" },
            { kind: "temperature", value: -78, unit: "C" },
            { kind: "time", value: 30, unit: "min" },
          ],
        ],
        numbered: false,
      },
    });
    add({ kind: "coefficient", species: s.water, value: 2 });
    add({ kind: "plus", between: [s.carbonDioxide, s.water] });
    add({ kind: "partialBond", atoms: [s.hydroxideO, s.tsCarbon] });
    add({ kind: "partialBond", atoms: [s.tsCarbon, s.bromine] });
    add({ kind: "partialCharge", atomId: s.hydroxideO, sign: "-" });
    add({ kind: "partialCharge", atomId: s.bromine, sign: "-" });
    add({
      kind: "bracket",
      species: [s.hydroxideO, s.tsCarbon, s.bromine],
      charge: -1,
      transitionState: true,
    });
    add({ kind: "resonanceArrow", between: [s.allylA, s.allylB] });
    add({ kind: "bracket", species: [s.allylA, s.allylB], charge: 1, transitionState: undefined });
    add({
      kind: "reactionArrow",
      from: [s.carbonDioxide],
      to: [s.methane],
      row: 1,
      equilibrium: { bias: "reverse" },
      conditions: {
        steps: [[{ kind: "reagent", text: "H2" }], [{ kind: "solvent", text: "CH2Cl2" }]],
        numbered: true,
      },
    });
    add({
      kind: "retrosynthesisArrow",
      target: [s.carbonDioxide],
      precursors: [s.methane, s.oxygen],
      row: undefined,
      conditions: { steps: [[{ kind: "text", text: "FGI" }]], numbered: false },
    });
    return { doc, s };
  }

  const encodedOf = (doc: SketchDocument): Record<string, any> =>
    JSON.parse(JSON.stringify(encodeDocument(doc))) as Record<string, any>;

  it("round-trips every new kind and key additively on v2, with no undefined-valued key", () => {
    const { doc } = schemeDocument();
    expect(doc.schemaVersion).toBe(2);
    expect(new Set(doc.annotations.map((a) => a.kind))).toEqual(
      new Set([
        "coefficient",
        "plus",
        "reactionArrow",
        "partialBond",
        "partialCharge",
        "bracket",
        "resonanceArrow",
        "retrosynthesisArrow",
      ]),
    );
    const decoded = roundTrip(doc);
    expect(decoded).toEqual(doc);
    expect(roundTrip(decoded)).toEqual(decoded);
    expect(undefinedValuedPaths(decoded)).toEqual([]);
    expect(undefinedValuedPaths(encodeDocument(decoded))).toEqual([]);
    // Omitted, never present holding undefined: the plain arrow has no
    // equilibrium, the resonance bracket no dagger, the retro arrow no row.
    expect(Object.keys(decoded.annotations[2]!)).toEqual(["id", "kind", "from", "to", "conditions"]);
    expect(Object.keys(decoded.annotations[11]!)).toEqual(["id", "kind", "species", "charge"]);
    expect(Object.keys(decoded.annotations[13]!)).toEqual(["id", "kind", "target", "precursors", "conditions"]);
    expect(decoded.annotations[12]).toMatchObject({ equilibrium: { bias: "reverse" }, row: 1 });
  });

  it("keeps a temperature and a time as numbers with a unit, and text exactly as typed", () => {
    const { doc } = schemeDocument();
    const burn = roundTrip(doc).annotations[2];
    if (burn?.kind !== "reactionArrow") throw new Error("expected the combustion arrow");
    expect(burn.conditions?.steps[0]).toEqual([
      { kind: "text", text: "spark" },
      { kind: "temperature", value: -78, unit: "C" },
      { kind: "time", value: 30, unit: "min" },
    ]);
  });

  it("refuses what no figure could mean, and calls none of it a newer build's", () => {
    const encoded = encodedOf(schemeDocument().doc);
    const cases: ((copy: Record<string, any>) => void)[] = [
      // A zero or fractional bracket charge; a dagger stored as false.
      (copy) => (copy.annotations[9].charge = 0),
      (copy) => (copy.annotations[9].charge = 0.5),
      (copy) => (copy.annotations[9].transitionState = false),
      // A partial bond from an atom to itself; a second delta on one atom.
      (copy) => (copy.annotations[5].atoms = [copy.annotations[5].atoms[0], copy.annotations[5].atoms[0]]),
      (copy) => (copy.annotations[8].atomId = copy.annotations[7].atomId),
      (copy) => (copy.annotations[7].sign = "±"),
      // A coefficient of zero or less.
      (copy) => (copy.annotations[0].value = 0),
      (copy) => (copy.annotations[0].value = -2),
      // Below absolute zero in either unit; a time of nothing; an unknown unit.
      (copy) => (copy.annotations[2].conditions.steps[0][1].value = -300),
      (copy) => (copy.annotations[2].conditions.steps[0][1] = { kind: "temperature", value: -1, unit: "K" }),
      (copy) => (copy.annotations[2].conditions.steps[0][2].value = 0),
      (copy) => (copy.annotations[2].conditions.steps[0][1].unit = "F"),
      // Empty lists and empty text: "no conditions" is written by omission.
      (copy) => (copy.annotations[2].conditions.steps = []),
      (copy) => (copy.annotations[2].conditions.steps[0] = []),
      (copy) => (copy.annotations[2].conditions.steps[0][0].text = ""),
      (copy) => delete copy.annotations[2].conditions.numbered,
      (copy) => (copy.annotations[12].equilibrium.bias = "sideways"),
      (copy) => (copy.annotations[13].target = []),
      (copy) => (copy.annotations[10].between = [copy.annotations[10].between[0]]),
    ];
    for (const breakIt of cases) {
      const copy = structuredClone(encoded);
      breakIt(copy);
      const result = safeDecodeDocument(copy);
      expect(result.ok, String(breakIt)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(breakIt)).toBe(false);
    }
  });

  it("throws from the writers on exactly what the codec refuses, so no document saves that will not reopen", () => {
    // Each draft is one the codec refuses in a file. Added through the one
    // minting site it must throw with the codec's reason, as `withLocants`
    // does, rather than save a document that then will not open.
    const { doc, s } = schemeDocument();
    const burn = (conditions: unknown) =>
      ({ kind: "reactionArrow", from: [s.methane, s.oxygen], to: [s.carbonDioxide, s.water], conditions }) as never;
    const step = (...items: unknown[]) => ({ steps: [items], numbered: false });
    const refused: readonly [string, Parameters<typeof addSchemeAnnotation>[1], RegExp][] = [
      ["a second delta on the hydroxide O", { kind: "partialCharge", atomId: s.hydroxideO, sign: "+" }, /both put a partial charge/],
      ["a partial bond from C to itself", { kind: "partialBond", atoms: [s.tsCarbon, s.tsCarbon] }, /two different atoms/],
      ["a delta signed ±", { kind: "partialCharge", atomId: s.tsCarbon, sign: "±" } as never, /sign/],
      ["a bracket charge of 0", { kind: "bracket", species: [s.allylA], charge: 0 }, /omitting it/],
      ["a bracket charge of 1/2", { kind: "bracket", species: [s.allylA], charge: 0.5 } as never, /int/i],
      ["a dagger stored as false", { kind: "bracket", species: [s.allylA], transitionState: false } as never, /true/],
      ["a coefficient of 0", { kind: "coefficient", species: s.water, value: 0 }, />0/],
      ["a coefficient of -2", { kind: "coefficient", species: s.water, value: -2 }, />0/],
      ["-300 °C", burn(step({ kind: "temperature", value: -300, unit: "C" })), /absolute zero/],
      ["-1 K", burn(step({ kind: "temperature", value: -1, unit: "K" })), /absolute zero/],
      ["a time of 0 min", burn(step({ kind: "time", value: 0, unit: "min" })), />0/],
      ["100 °F", burn(step({ kind: "temperature", value: 100, unit: "F" })), /unit/],
      ["no steps", burn({ steps: [], numbered: false }), /steps/],
      ["conditions with no numbered flag", burn({ steps: [[{ kind: "reagent", text: "H2O" }]] }), /numbered/],
      ["an empty step", burn({ steps: [[]], numbered: false }), /steps/],
      ["an empty reagent", burn(step({ kind: "reagent", text: "" })), /text/],
      ["an unknown bias", { kind: "reactionArrow", from: [s.methane], to: [s.water], equilibrium: { bias: "sideways" } } as never, /bias/],
      ["a retro arrow with no target", { kind: "retrosynthesisArrow", target: [], precursors: [s.methane] } as never, /target/],
      ["a resonance arrow with one side", { kind: "resonanceArrow", between: [s.allylA] } as never, /between/],
      ["empty text", { kind: "text", text: "", at: { x: 0, y: 0 } }, /text/],
      ["a curly arrow skewed past the chord", {
        kind: "curlyArrow",
        electrons: "pair",
        source: { kind: "lonePair", atomId: s.hydroxideO },
        sink: { kind: "atom", atomId: s.tsCarbon },
        bulge: 0.5,
        skew: 0.7,
      }, /skew/],
    ];
    const encoded = encodedOf(doc);
    for (const [name, draft, reason] of refused) {
      // The pairing: the codec refuses this very record in a file...
      const copy = structuredClone(encoded);
      copy.annotations.push({ ...(draft as object), id: `ann_${doc.nextAnnotationId}` });
      copy.nextAnnotationId = doc.nextAnnotationId + 1;
      expect(safeDecodeDocument(copy).ok, name).toBe(false);
      // ...and the writers throw on it, naming why.
      expect(() => addSchemeAnnotation(doc, draft), name).toThrow(reason);
      expect(
        () => createDocument({ molecule: s.molecule, annotations: [...doc.annotations, { ...(draft as object), id: "ann_99" } as never], now: NOW }),
        name,
      ).toThrow(reason);
    }
    // A counter that would reuse an id is refused in a file and by createDocument.
    expect(() => createDocument({ molecule: s.molecule, annotations: doc.annotations, nextAnnotationId: 3, now: NOW })).toThrow(
      /reuse the id/,
    );
    // Control: what the codec accepts, the writers accept, and it reopens.
    const fine = addSchemeAnnotation(doc, { kind: "coefficient", species: s.carbonDioxide, value: 0.5 }).document;
    expect(roundTrip(fine)).toEqual(fine);
    expect(roundTrip(createDocument({ molecule: s.molecule, annotations: fine.annotations, now: NOW })).annotations).toEqual(fine.annotations);
  });

  it("refuses a new kind that names an atom not in the molecule, including a prototype member", () => {
    const encoded = encodedOf(schemeDocument().doc);
    const ghosts: ((copy: Record<string, any>, ghost: string) => void)[] = [
      (copy, ghost) => (copy.annotations[0].species = ghost),
      (copy, ghost) => (copy.annotations[5].atoms[1] = ghost),
      (copy, ghost) => (copy.annotations[7].atomId = ghost),
      (copy, ghost) => (copy.annotations[10].between[1] = ghost),
      (copy, ghost) => (copy.annotations[13].precursors = [ghost]),
    ];
    for (const ghost of ["a999", "constructor"]) {
      for (const breakIt of ghosts) {
        const copy = structuredClone(encoded);
        breakIt(copy, ghost);
        expect(safeDecodeDocument(copy).ok, `${String(breakIt)} ${ghost}`).toBe(false);
      }
    }
    const { doc, s } = schemeDocument();
    expect(() => addSchemeAnnotation(doc, { kind: "partialBond", atoms: [s.tsCarbon, "toString"] })).toThrow(
      /toString/,
    );
  });

  it("keeps the e2e scheme fixtures what chem-render's scheme fixtures build", () => {
    // e2e/reaction-arrows.spec.ts drops these files; they were written once
    // through encodeDocument, and this is what stops them drifting.
    for (const [file, scheme] of [
      ["proline-aldol-scheme.json", prolineAldol()],
      ["sn2-transition-state-scheme.json", sn2TransitionState()],
    ] as const) {
      const text = readFileSync(new URL(`../../../e2e/fixtures/${file}`, import.meta.url), "utf8");
      const decoded = decodeDocument(JSON.parse(text));
      expect(decoded.molecule, file).toEqual(scheme.molecule);
      expect(decoded.annotations, file).toEqual(scheme.annotations);
      expect(JSON.stringify(encodeDocument(decoded), null, 2) + "\n", file).toBe(text);
    }
  });

  it("reads an unknown annotation kind, condition kind or key as a newer build's file", () => {
    const encoded = encodedOf(schemeDocument().doc);
    const newer: ((copy: Record<string, any>) => void)[] = [
      (copy) => {
        copy.annotations.push({ id: "ann_99", kind: "catalyticCycle", species: ["a1"] });
        copy.nextAnnotationId = 100;
      },
      (copy) => copy.annotations[2].conditions.steps[0].push({ kind: "pressure", value: 5, unit: "bar" }),
      (copy) => (copy.annotations[2].conditions.steps[0][0].note = "flame"),
      (copy) => (copy.annotations[12].equilibrium.ratio = 3),
      (copy) => (copy.annotations[9].style = "curly"),
    ];
    for (const add of newer) {
      const copy = structuredClone(encoded);
      add(copy);
      const result = safeDecodeDocument(copy);
      expect(result.ok, String(add)).toBe(false);
      if (!result.ok) expect(isFromNewerBuild(result.error), String(add)).toBe(true);
    }
  });
});

describe("a molecule rebuilt from a projection layout (decision 210)", () => {
  // The harness's layout-to-Molecule builder (chem-core's test tree) brands
  // what it returns exactly like this; its own test pins that it does.
  function testOnly(mol: Molecule): Molecule {
    const branded = { ...mol };
    Object.defineProperty(branded, TEST_ONLY_MOLECULE, { value: true, enumerable: false });
    return branded;
  }

  it("is refused by the document assembler and by the encoder, and an ordinary molecule is not", () => {
    const rebuilt = testOnly(ethanol());
    expect(isTestOnlyMolecule(rebuilt)).toBe(true);
    expect(() => createDocument({ molecule: rebuilt, now: NOW })).toThrow(TestOnlyMoleculeError);
    // A document that somehow came to hold one (a store write, a spread) is
    // still refused at the file boundary.
    const doc = createDocument({ molecule: ethanol(), now: NOW });
    expect(() => encodeDocument({ ...doc, molecule: rebuilt })).toThrow(TestOnlyMoleculeError);
    expect(isTestOnlyMolecule(ethanol())).toBe(false);
    expect(() => encodeDocument(doc)).not.toThrow();
  });

  it("never leaks the brand into JSON", () => {
    expect(JSON.stringify(testOnly(ethanol()))).toBe(JSON.stringify(ethanol()));
  });

  it("refuses what the harness's own builder makes of D-glucose's Fischer projection", () => {
    // The builder itself, from chem-core's test tree, not a copy of its brand.
    const molblock = readFileSync(
      join(import.meta.dirname, "..", "..", "chem-core", "test", "fixtures", "projection", "d-glucose-open.mol"),
      "utf8",
    );
    const glucose = readMolblock(molblock).molecule;
    const view: ProjectionView = {
      kind: "chain",
      template: "fischer",
      frame: { backbone: ["a2", "a3", "a5", "a7", "a9", "a11"] },
      params: { top: "first" },
    };
    const result = project(glucose, stereoConfig(glucose), view);
    if (result.kind !== "available") throw new Error(result.kind);
    const rebuilt = moleculeFromLayout(glucose, result.layout).molecule;
    expect(() => createDocument({ molecule: rebuilt, now: NOW })).toThrow(TestOnlyMoleculeError);
    const doc = createDocument({ molecule: glucose, now: NOW });
    expect(() => encodeDocument({ ...doc, molecule: rebuilt })).toThrow(TestOnlyMoleculeError);
  });
});
