import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, elementCounts, netCharge, vec } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import {
  COORDINATE_SCALE,
  diffMolecules,
  hasMeaningfulCoordinates,
  maxCoordinateDelta,
  moleculeToMolblock,
  molblockToMolecule,
} from "./translate.js";

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
