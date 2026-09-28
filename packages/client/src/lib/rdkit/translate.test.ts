import { describe, expect, it } from "vitest";
import {
  benzene,
  buildMolecule,
  elementCounts,
  MolblockStereoGroupError,
  netCharge,
  vec,
  withStereoGroups,
  writeMolblock,
} from "@starter/chem-core";
import type { MolblockWarning, Molecule } from "@starter/chem-core";

import {
  classifyWarnings,
  COORDINATE_SCALE,
  diffMolecules,
  hasMeaningfulCoordinates,
  maxCoordinateDelta,
  moleculeToMolblock,
  molblockToMolecule,
  molblockVersionFor,
  molblockVersionNotice,
} from "./translate";

/** Butan-2-ol with a wedge to the OH: one real stereocentre, and it is `a2`. */
function butan2ol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1, 0.6));
    const o = b.atom("O", vec(1, 2));
    const c3 = b.atom("C", vec(2, 0));
    const c4 = b.atom("C", vec(3, 0.6));
    b.bond(c1, c2);
    b.bond(c2, o, 1, "wedge");
    b.bond(c2, c3);
    b.bond(c3, c4);
  });
}

/** (CH3)2SO2 — hypervalent sulfur, two S=O, no formal charges. */
function dimethylSulfone(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 0));
    const o1 = b.atom("O", vec(0, 1));
    const o2 = b.atom("O", vec(0, -1));
    const c1 = b.atom("C", vec(-1, 0));
    const c2 = b.atom("C", vec(1, 0));
    b.bond(s, o1, 2);
    b.bond(s, o2, 2);
    b.bond(s, c1, 1);
    b.bond(s, c2, 1);
  });
}

/** The same sulfone written as S(2+) with two single bonds to two O(-). */
function chargeSeparatedSulfone(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 0), { charge: 2 });
    const o1 = b.atom("O", vec(0, 1), { charge: -1 });
    const o2 = b.atom("O", vec(0, -1), { charge: -1 });
    const c1 = b.atom("C", vec(-1, 0));
    const c2 = b.atom("C", vec(1, 0));
    b.bond(s, o1, 1);
    b.bond(s, o2, 1);
    b.bond(s, c1, 1);
    b.bond(s, c2, 1);
  });
}

/**
 * A five-carbon ring, every bond single, every atom and bond flagged
 * aromatic. There is no perfect matching over an odd cycle, so `kekulize`
 * gives up and hands the molecule back exactly as it arrived — flags intact.
 */
function unkekulizableRing(): Molecule {
  const flagged = buildMolecule((b) => {
    const ids = Array.from({ length: 5 }, (_, i) =>
      b.atom("C", vec(Math.cos((i * 2 * Math.PI) / 5), Math.sin((i * 2 * Math.PI) / 5))),
    );
    for (let i = 0; i < 5; i++) b.bond(ids[i] as string, ids[(i + 1) % 5] as string, 1);
  });
  return {
    ...flagged,
    atoms: Object.fromEntries(
      Object.entries(flagged.atoms).map(([id, atom]) => [id, { ...atom, aromatic: true }]),
    ),
    bonds: Object.fromEntries(
      Object.entries(flagged.bonds).map(([id, bond]) => [id, { ...bond, aromatic: true }]),
    ),
  };
}

/** Benzene with every atom and bond carrying an importer's aromatic flags. */
function flaggedBenzene(): Molecule {
  const kekule = benzene();
  return {
    ...kekule,
    atoms: Object.fromEntries(
      Object.entries(kekule.atoms).map(([id, atom]) => [id, { ...atom, aromatic: true }]),
    ),
    bonds: Object.fromEntries(
      Object.entries(kekule.bonds).map(([id, bond]) => [id, { ...bond, aromatic: true }]),
    ),
  };
}

describe("moleculeToMolblock", () => {
  it("writes the Kekule form even when the model carries aromatic flags", () => {
    // Bond type 4 is a REQUEST that the reader kekulise, and RDKit refuses a
    // type-4 pyrrole outright (returns null) because it cannot know where the
    // N-H is. Kekulising here means exactly one representation crosses the
    // boundary, which is the storage decision.
    const written = moleculeToMolblock(flaggedBenzene());
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const bondLines = written.value.split("\n").slice(4 + 6, 4 + 12);
    expect(bondLines.every((line) => line.slice(6, 9) !== "  4")).toBe(true);
  });

  it("refuses a structure kekulisation could not resolve, rather than emitting bond type 4", () => {
    // `kekulize` returns the molecule UNCHANGED when a component has no
    // perfect matching, so calling it is not the same as enforcing it.
    // Unchecked, this writes five type-4 bond rows and RDKit answers
    // "Can't kekulize mol" — and on the way back the flags would be stored,
    // which the storage form does not permit at all.
    const written = moleculeToMolblock(unkekulizableRing());
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.kind).toBe("unkekulizable");
    expect(written.error.atomIds).toHaveLength(5);
  });

  it("says nothing about hydrogens a valence table can derive", () => {
    // The `hhh` field is a QUERY field per the CTfile spec: RDKit turns the
    // atom into a query atom and sets no real hydrogen count, so benzene
    // written with it arrives as C6 rather than C6H6.
    const written = moleculeToMolblock(benzene());
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    for (const line of written.value.split("\n").slice(4, 10)) {
      expect(line.slice(42, 45)).toBe("  0");
    }
  });

  it("refuses a cosmetic label with the offending atom ids", () => {
    // Decision 8. Writing the underlying element would export a methyl where
    // the user drew a phenyl, and the file would look perfectly valid.
    const withLabel = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const ph = b.atom("C", vec(1, 0), { label: "Ph" });
      b.bond(c, ph, 1);
    });
    const written = moleculeToMolblock(withLabel);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.kind).toBe("labelled-atoms");
    expect(written.error.atomIds).toHaveLength(1);
  });

  it("round-trips through chem-core alone at the shared coordinate scale", () => {
    // The writer multiplies by COORDINATE_SCALE and the reader divides. Set
    // it on one side only and everything comes back 2.25x too big, with
    // identical counts, identical charge and no warnings — invisible to every
    // assertion the fidelity harness makes.
    const written = moleculeToMolblock(benzene());
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = molblockToMolecule(written.value);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(elementCounts(read.value.molecule)).toEqual({ C: 6, H: 6 });
    expect(maxCoordinateDelta(benzene(), read.value.molecule)).toBeLessThan(1e-4);
    expect(COORDINATE_SCALE).toBe(1.5);
  });
});

/**
 * Decision 49: the APP picks the generation, chem-core only obeys. These are the
 * policy's own tests; `stereo-groups.node.test.ts` checks the real wasm reads
 * what the policy produced.
 */
describe("molblockVersionFor and its notice (decision 49)", () => {
  /** Butan-2-ol with its one centre in an AND group. */
  function racemate(): Molecule {
    return withStereoGroups(butan2ol(), [{ kind: "and", index: 1, atomIds: ["a2"] }]);
  }

  it("is V2000 with no group and V3000 with one", () => {
    expect(molblockVersionFor(butan2ol())).toBe("V2000");
    expect(molblockVersionFor(racemate())).toBe("V3000");
  });

  it("writes the COLLECTION block, and only for the grouped molecule", () => {
    const plain = moleculeToMolblock(butan2ol());
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.value).toContain("V2000");
    expect(plain.value).not.toContain("COLLECTION");

    const grouped = moleculeToMolblock(racemate());
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.value).toContain("V3000");
    expect(grouped.value).toContain("MDLV30/STERAC1 ATOMS=(1 2)");
  });

  it("is silent about the generation unless it changed", () => {
    expect(molblockVersionNotice(butan2ol())).toBeNull();
    const notice = molblockVersionNotice(racemate());
    expect(notice).not.toBeNull();
    // Names the group the way the FIGURE prints it (decision 40's tag), so the
    // sentence and the drawing need no translating between them.
    expect(notice).toContain("(and1)");
    expect(notice).toContain("V3000");
  });

  it("measures the three-character counts fields only against V2000", () => {
    // The gate is a V2000 limit and nothing else: V3000 states its counts in
    // `M  V30 COUNTS` with no column width at all, so applying it to a molecule
    // that goes out as V3000 would refuse a large structure for a reason that
    // does not apply to the file being written.
    const wide = buildMolecule((b) => {
      for (let i = 0; i < 1000; i++) b.atom("C", vec(i * 0.1, 0));
    });
    const refused = moleculeToMolblock(wide);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.kind).toBe("too-large");

    const grouped = moleculeToMolblock(
      withStereoGroups(wide, [{ kind: "abs", index: 1, atomIds: ["a1"] }]),
    );
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.value).toContain("M  V30 COUNTS 1000 0 0 0");
  });

  it("maps chem-core's named V2000 refusal rather than flattening it", () => {
    // Unreachable through `molblockVersionFor`, which is the point of decision
    // 49 — but decision 25's refusal is still the only thing that says the file
    // was NOT written rather than written wrongly, so it keeps its sentence.
    expect(() => writeMolblock(racemate(), { version: "V2000" })).toThrow(
      MolblockStereoGroupError,
    );
  });
});

describe("molblockToMolecule", () => {
  it("refuses an import that dropped an atom rather than warning about it", () => {
    // A '*' dummy is not an element chem-core has; the atom vanishes and its
    // bond goes with it. Left as a warning, a scaffold silently becomes a
    // different compound.
    const withDummy = [
      "dummy",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 *   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
      "",
    ].join("\n");
    const read = molblockToMolecule(withDummy);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe("lossy-import");
    expect(read.error.warnings?.map((w) => w.kind)).toContain("unknown-element");
  });

  it("refuses a file whose aromatic flags survive the reader's own kekulisation", () => {
    // A type-4 bond on an ACYCLIC bond: chem-core reads it, fails to
    // kekulise it and keeps the flags. Returning that molecule would store an
    // importer's perception permanently, and a flagged system genuinely
    // derives a different formula from its Kekule reading.
    const acyclicAromatic = [
      "acyclic aromatic",
      "  chemcore          2D",
      "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    2.2500    1.2990    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  4  0  0  0  0",
      "  2  3  2  0  0  0  0",
      "M  END",
      "",
    ].join("\n");
    const read = molblockToMolecule(acyclicAromatic);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe("unkekulizable");
    expect(read.error.atomIds).toEqual(["a1", "a2"]);
  });

  it("reports text that is not a molblock at all as a parse failure", () => {
    expect(molblockToMolecule("this is not a molfile")).toMatchObject({
      ok: false,
      error: { kind: "parse-failed" },
    });
  });
});

describe("hasMeaningfulCoordinates", () => {
  it("is false when every atom sits on the same point", () => {
    // What a molecule parsed from a conformer-less molblock looks like.
    const stacked = buildMolecule((b) => {
      const a = b.atom("C", vec(0, 0));
      const c = b.atom("C", vec(0, 0));
      b.bond(a, c, 1);
    });
    expect(hasMeaningfulCoordinates(stacked)).toBe(false);
    expect(hasMeaningfulCoordinates(benzene())).toBe(true);
  });

  it("treats a single atom as having a layout, because it cannot not have one", () => {
    expect(hasMeaningfulCoordinates(buildMolecule((b) => void b.atom("C", vec(0, 0))))).toBe(true);
  });
});

describe("diffMolecules", () => {
  it("catches a charge separation that elementCounts and netCharge cannot", () => {
    // The acceptance criterion "a sulfone round-trips without a silent
    // charge-separation change" is unprovable with those two alone: both
    // forms give {S:1,O:2,C:2,H:6} and netCharge 0.
    const plain = dimethylSulfone();
    const separated = chargeSeparatedSulfone();
    expect(elementCounts(plain)).toEqual(elementCounts(separated));
    expect(netCharge(plain)).toBe(netCharge(separated));

    const kinds = diffMolecules(plain, separated).map((d) => d.kind);
    expect(kinds).toContain("formal-charges");
    expect(kinds).toContain("bond-orders");
  });

  it("catches a lost wedge", () => {
    const wedged = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const br = b.atom("Br", vec(0, 1));
      b.bond(c, br, 1, "wedge");
    });
    const flat = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const br = b.atom("Br", vec(0, 1));
      b.bond(c, br, 1);
    });
    expect(elementCounts(wedged)).toEqual(elementCounts(flat));
    expect(diffMolecules(wedged, flat).map((d) => d.kind)).toContain("stereo");
  });

  it("catches a lost isotope label, which no formula function can see", () => {
    // elementCounts buckets by element and exactMass is computed FROM it, so
    // 13-C and 12-C methane agree on formula, weight and exact mass alike.
    const labelled = buildMolecule((b) => void b.atom("C", vec(0, 0), { isotope: 13 }));
    const plain = buildMolecule((b) => void b.atom("C", vec(0, 0)));
    expect(elementCounts(labelled)).toEqual(elementCounts(plain));
    expect(diffMolecules(labelled, plain).map((d) => d.kind)).toContain("isotopes");
  });

  it("catches implicit hydrogens becoming real atoms", () => {
    const implicit = buildMolecule((b) => void b.atom("C", vec(0, 0)));
    const explicit = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      for (let i = 0; i < 4; i++) b.bond(c, b.atom("H", vec(i, 1)), 1);
    });
    expect(elementCounts(implicit)).toEqual(elementCounts(explicit));
    expect(diffMolecules(implicit, explicit).map((d) => d.kind)).toContain("atom-count");
  });

  it("reports aromatic flags surviving into the model as a storage-form breach", () => {
    expect(diffMolecules(benzene(), flaggedBenzene()).map((d) => d.kind)).toContain(
      "aromatic-flags-survived",
    );
  });

  it("says nothing when nothing changed", () => {
    expect(diffMolecules(benzene(), benzene())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `classifyWarnings` is the whole of import triage: `lossy` refuses the import,
// `changed` shows a banner, `info` a footnote. Nothing tested it. Measured:
// deleting "collection-count-mismatch" from CHANGED_WARNINGS, or
// "three-dimensional", or "unknown-element" from LOSSY_WARNINGS, each left the
// client dom project 626/626 green — a warning silently demoted a tier with no
// test to notice.
//
// So the table is pinned as a TABLE, over every `MolblockWarning` kind rather
// than the handful this branch added. The record is typed by kind, so a kind
// added to chem-core is a compile error here until someone decides what it
// costs an import.
// ---------------------------------------------------------------------------
type Severity = "clean" | "info" | "changed" | "lossy";

interface WarningCase {
  readonly warning: MolblockWarning;
  readonly severity: Severity;
  /** Why it sits in that tier, in the words a reviewer would need. */
  readonly because: string;
}

const WARNING_TIERS: Readonly<Record<MolblockWarning["kind"], WarningCase>> = {
  // ── lossy: an atom or a bond is not in the molecule that came back ──────
  "truncated-block": {
    warning: { kind: "truncated-block", message: "", block: "atom", expected: 3, found: 2 },
    severity: "lossy",
    because: "the file ran short, so the missing rows are missing atoms",
  },
  "surplus-block": {
    warning: { kind: "surplus-block", message: "", block: "atom", expected: 2, found: 3 },
    severity: "lossy",
    because: "the surplus rows were skipped to keep the bond block aligned",
  },
  "unknown-element": {
    warning: { kind: "unknown-element", message: "", line: 5, row: 2, symbol: "*" },
    severity: "lossy",
    because: "a dummy atom or an R-group vanishing turns a scaffold into another compound",
  },
  "bad-bond-endpoint": {
    warning: { kind: "bad-bond-endpoint", message: "", line: 9, row: 1, index: 7 },
    severity: "lossy",
    because: "the bond is dropped, so two fragments come back where one was drawn",
  },
  "self-bond": {
    warning: { kind: "self-bond", message: "", line: 9, row: 1 },
    severity: "lossy",
    because: "dropped, and the bond the author meant is not there",
  },
  "duplicate-bond": {
    warning: { kind: "duplicate-bond", message: "", line: 9, row: 2 },
    severity: "lossy",
    because: "the later row is dropped, and it may have carried the higher order",
  },
  "property-index-out-of-range": {
    warning: { kind: "property-index-out-of-range", message: "", line: 12, index: 99 },
    severity: "lossy",
    because: "a charge or an isotope named for an atom that is not there is lost",
  },
  "dropped-v3000-row": {
    warning: {
      kind: "dropped-v3000-row",
      message: "",
      line: 8,
      block: "ATOM",
      text: "M  V30 x C 0 0 0 0",
    },
    severity: "lossy",
    because: "the V3000 twin of unknown-element: the row is skipped and the atom is gone",
  },
  // ── changed: the graph is the file's, but it reads differently ──────────
  "unsupported-bond-type": {
    warning: { kind: "unsupported-bond-type", message: "", line: 9, row: 1, type: 8 },
    severity: "changed",
    because: "the bond is kept as single, which is a different bond",
  },
  "unsupported-bond-stereo": {
    warning: { kind: "unsupported-bond-stereo", message: "", line: 9, row: 1, stereo: 7 },
    severity: "changed",
    because: "the bond is kept flat, so a stated configuration is no longer stated",
  },
  unkekulized: {
    warning: { kind: "unkekulized", message: "", atomIds: ["a1"] },
    severity: "changed",
    because: "aromatic flags survived, and a flagged system derives another formula",
  },
  "three-dimensional": {
    warning: { kind: "three-dimensional", message: "", rows: [1, 2] },
    severity: "changed",
    because: "z was dropped, so the atoms kept a flat projection that may overlap",
  },
  "collection-count-mismatch": {
    warning: {
      kind: "collection-count-mismatch",
      message: "",
      line: 20,
      name: "MDLV30/STERAC1",
      declared: 18,
      found: 17,
    },
    severity: "changed",
    because: "measured on an 18-centre racemate: coverage fell from rac- to per-centre tags",
  },
  // ── info: the file said something this app does not model ──────────────
  "bad-property-line": {
    warning: { kind: "bad-property-line", message: "", line: 12 },
    severity: "info",
    because: "an unreadable property line asserted nothing that was kept",
  },
  "unsupported-v3000-block": {
    warning: { kind: "unsupported-v3000-block", message: "", line: 8, block: "SGROUP" },
    severity: "info",
    because: "an Sgroup or a template is an annotation on the graph, not the graph",
  },
  "unsupported-collection": {
    warning: { kind: "unsupported-collection", message: "", line: 20, name: "HILITE" },
    severity: "info",
    because: "a HILITE or a user collection carries no chemistry",
  },
  "bad-v3000-row": {
    warning: {
      kind: "bad-v3000-row",
      message: "",
      line: 8,
      block: "CTAB",
      text: "M  V30 LINKNODE 1 2 1 1 2 1 3",
    },
    severity: "info",
    because: "its arms all keep the graph: a stray CTAB line, a coordinate read as 0",
  },
  "stereo-group-conflict": {
    warning: { kind: "stereo-group-conflict", message: "", line: 21, atomIds: ["a2"] },
    severity: "info",
    because: "the later mention is dropped and the atom keeps the first collection",
  },
  // ── field-dependent: see the two cases below ───────────────────────────
  "bad-numeric-field": {
    warning: { kind: "bad-numeric-field", message: "", line: 5, field: "x", text: "abc" },
    severity: "lossy",
    because: "an unreadable x or y defaults to 0, stacking the atom on the origin",
  },
};

describe("classifyWarnings (the import triage table)", () => {
  it("gives every warning kind the tier its consequence earns", () => {
    for (const [kind, spec] of Object.entries(WARNING_TIERS)) {
      // The record's key and its sample must agree, or a copy-paste would pin
      // one kind twice and leave another unpinned.
      expect(spec.warning.kind, kind).toBe(kind);
      expect(classifyWarnings([spec.warning]), `${kind}: ${spec.because}`).toBe(spec.severity);
    }
  });

  it("reads no warnings as clean, and takes the WORST of several", () => {
    expect(classifyWarnings([])).toBe("clean");
    const info = WARNING_TIERS["unsupported-collection"].warning;
    const changed = WARNING_TIERS["three-dimensional"].warning;
    const lossy = WARNING_TIERS["unknown-element"].warning;
    expect(classifyWarnings([info, changed])).toBe("changed");
    expect(classifyWarnings([info, changed, lossy])).toBe("lossy");
    // Order cannot matter: an import is as bad as its worst warning.
    expect(classifyWarnings([lossy, changed, info])).toBe("lossy");
  });

  it("splits bad-numeric-field by the field, because only x and y lose a position", () => {
    // A bad x or y defaults the coordinate to 0 and stacks the atom on the
    // origin — the drawing is not the file. A bad charge or mass field is read
    // as 0, which is the format's own default and no loss.
    const field = (name: string): MolblockWarning => ({
      kind: "bad-numeric-field",
      message: "",
      line: 5,
      field: name,
      text: "abc",
    });
    expect(classifyWarnings([field("x")])).toBe("lossy");
    expect(classifyWarnings([field("y")])).toBe("lossy");
    expect(classifyWarnings([field("charge")])).toBe("info");
    expect(classifyWarnings([field("stereo")])).toBe("info");
  });
});

describe("a V3000 row the reader had to drop (decision 90's tolerance, priced)", () => {
  function v3000(...body: string[]): string {
    return [
      "dropped row",
      "  chemcore          2D",
      "",
      "  0  0  0  0  0  0  0  0  0  0999 V3000",
      "M  V30 BEGIN CTAB",
      ...body,
      "M  V30 END CTAB",
      "M  END",
      "",
    ].join("\n");
  }

  it("refuses an atom row it could not read, exactly as the V2000 file that loses an atom does", () => {
    // Measured before the split: this returned ok with severity `info` — a
    // footnote — while the V2000 file losing the same atom refused as `lossy`.
    // Same loss, three tiers apart, and drag-and-drop import reaches both.
    const read = molblockToMolecule(
      v3000(
        "M  V30 COUNTS 3 1 0 0 0",
        "M  V30 BEGIN ATOM",
        "M  V30 1 C 0.000000 0.000000 0.000000 0",
        "M  V30 x C 9.000000 9.000000 0.000000 0",
        "M  V30 2 O 1.500000 0.000000 0.000000 0",
        "M  V30 END ATOM",
        "M  V30 BEGIN BOND",
        "M  V30 1 1 1 2",
        "M  V30 END BOND",
      ),
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe("lossy-import");
    expect(read.error.warnings?.map((w) => w.kind)).toEqual(["dropped-v3000-row"]);
  });

  it("refuses a bond row it could not read: two fragments came back where one was drawn", () => {
    const read = molblockToMolecule(
      v3000(
        "M  V30 COUNTS 2 1 0 0 0",
        "M  V30 BEGIN ATOM",
        "M  V30 1 C 0.000000 0.000000 0.000000 0",
        "M  V30 2 O 1.500000 0.000000 0.000000 0",
        "M  V30 END ATOM",
        "M  V30 BEGIN BOND",
        "M  V30 1 1 1",
        "M  V30 END BOND",
      ),
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe("lossy-import");
  });

  it("keeps an import whose V3000 row was only read generously", () => {
    // The other side of the split, and the reason it is a split rather than the
    // coarse kind added to the lossy table: the row stops before z, the spec's
    // own default fills it, and the molecule IS the file's graph. Still a
    // warning — still `info` — and still imported.
    const read = molblockToMolecule(
      v3000(
        "M  V30 COUNTS 2 1 0 0 0",
        "M  V30 BEGIN ATOM",
        "M  V30 1 C 0.000000 0.000000 0.000000 0",
        "M  V30 2 O 1.500000",
        "M  V30 END ATOM",
        "M  V30 BEGIN BOND",
        "M  V30 1 1 1 2",
        "M  V30 END BOND",
      ),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.report.severity).toBe("info");
    expect(read.report.warnings.map((w) => w.kind)).toEqual(["bad-v3000-row"]);
    expect(read.value.molecule.atomIds).toHaveLength(2);
  });
});
