import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyIssueFix,
  benzene,
  buildMolecule,
  chemistryIssues,
  elementCounts,
  issueFixes,
  netCharge,
  requireAtom,
  requireBond,
  vec,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import {
  inchiAndMolblock,
  molLifecycleCounts,
  normalizeMolblock,
  resetMolLifecycleCounts,
  smilesAndMolblock,
  type RDKitLogLike,
  type RDKitModuleLike,
} from "./ops";
import {
  atomIdsNamedByRdkit,
  hasMeaningfulCoordinates,
  maxCoordinateDelta,
  moleculeToMolblock,
  molblockToMolecule,
} from "./translate";

/**
 * The fidelity harness: real RDKit, real chem-core, no Worker.
 *
 * WHY IT NEVER ASSERTS ON A SMILES STRING. RDKit canonicalises the right and
 * the wrong answer to the same string, so a string comparison passes while
 * the molecule is wrong. Everything below is asserted on chem-core's own
 * queries over the molecule that came back.
 *
 * WHY IT ASSERTS MORE THAN elementCounts AND netCharge. Those two are
 * necessary and demonstrably insufficient. Measured, with both identical on
 * each side: dimethyl sulfone vs its charge-separated form, glycine neutral
 * vs zwitterion, 2-pyridone vs 2-hydroxypyridine, 13-C methane vs 12-C, a
 * wedged stereocentre vs a flat one, and implicit hydrogens vs four real H
 * atoms. So the multisets of formal charges, bond orders, isotopes and
 * stereo kinds are compared too, along with the atom and bond counts.
 *
 * WHY IT DOES NOT GO THROUGH THE WORKER. The worker is a transport shell; the
 * chemistry is all in ops.ts and translate.ts, and neither needs one. In node
 * the same emscripten glue takes its ENVIRONMENT_IS_NODE branch and reads the
 * wasm straight off disk with no configuration.
 */

const require = createRequire(import.meta.url);

let RDKit: RDKitModuleLike;
/** One handle for the whole file, exactly as the worker holds one for its
 *  whole life: `set_log_capture` takes a global exclusive lock inside the
 *  wasm instance and only `.delete()` releases it. */
let log: RDKitLogLike | null = null;

beforeAll(async () => {
  const initRDKitModule = require("@rdkit/rdkit") as () => Promise<RDKitModuleLike>;
  RDKit = await initRDKitModule();
  log = RDKit.set_log_capture?.("rdApp.*") ?? null;
  expect(log, "the log capture API is what separates a refused structure from unreadable text").not.toBeNull();
}, 60_000);

// ---------------------------------------------------------------------------
// Fixtures. Real molecules, so a failure reads as a chemistry error.
// ---------------------------------------------------------------------------

/** Pyrrole in Kekule form. The N-H is the whole reason hydrogens are asserted. */
function pyrrole(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", vec(0, 1));
    const c2 = b.atom("C", vec(0.95, 0.31));
    const c3 = b.atom("C", vec(0.59, -0.81));
    const c4 = b.atom("C", vec(-0.59, -0.81));
    const c5 = b.atom("C", vec(-0.95, 0.31));
    b.bond(n, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, n, 1);
  });
}

/** Thiophene, Kekule. Sulfur's valence list is [2,4] — the case that bites. */
function thiophene(): Molecule {
  return buildMolecule((b) => {
    const s = b.atom("S", vec(0, 1));
    const c2 = b.atom("C", vec(0.95, 0.31));
    const c3 = b.atom("C", vec(0.59, -0.81));
    const c4 = b.atom("C", vec(-0.59, -0.81));
    const c5 = b.atom("C", vec(-0.95, 0.31));
    b.bond(s, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, s, 1);
  });
}

/** CH3-CO-O(-) */
function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", vec(0, 0));
    const carbonyl = b.atom("C", vec(0.87, 0.5));
    const doubleO = b.atom("O", vec(0.87, 1.5));
    const anionO = b.atom("O", vec(1.73, 0), { charge: -1 });
    b.bond(methyl, carbonyl, 1);
    b.bond(carbonyl, doubleO, 2);
    b.bond(carbonyl, anionO, 1);
  });
}

/** (CH3)2SO2 — hypervalent S, no formal charges anywhere. */
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

function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const o = b.atom("O", vec(1.73, 0));
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1);
  });
}

/** Nitromethane in the charge-separated form RDKit insists on. */
function nitromethane(): Molecule {
  return buildMolecule((b) => {
    const c = b.atom("C", vec(0, 0));
    const n = b.atom("N", vec(1, 0), { charge: 1 });
    const o1 = b.atom("O", vec(1.87, 0.5));
    const o2 = b.atom("O", vec(1.87, -0.5), { charge: -1 });
    b.bond(c, n, 1);
    b.bond(n, o1, 2);
    b.bond(n, o2, 1);
  });
}

/** 13-C methane. Every formula function is blind to the label. */
function isotopeMethane(): Molecule {
  return buildMolecule((b) => void b.atom("C", vec(0, 0), { isotope: 13 }));
}

/** A methyl radical, which travels as `M  RAD`. */
function ethylRadical(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0), { radicalElectrons: 1 });
    const c2 = b.atom("C", vec(1, 0));
    b.bond(c1, c2, 1);
  });
}

function pyridine(): Molecule {
  return buildMolecule((b) => {
    const ids = ["N", "C", "C", "C", "C", "C"].map((el, i) =>
      b.atom(el, vec(Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3))),
    );
    const at = (i: number) => ids[i] as string;
    b.bond(at(0), at(1), 1);
    b.bond(at(1), at(2), 2);
    b.bond(at(2), at(3), 1);
    b.bond(at(3), at(4), 2);
    b.bond(at(4), at(5), 1);
    b.bond(at(5), at(0), 2);
  });
}

/** Bromochlorofluoromethane: one wedge, one hash, a genuine stereocentre. */
function bromochlorofluoromethane(): Molecule {
  return buildMolecule((b) => {
    const br = b.atom("Br", vec(0, 1));
    const c = b.atom("C", vec(0, 0));
    const f = b.atom("F", vec(-0.87, -0.5));
    const cl = b.atom("Cl", vec(0.87, -0.5));
    b.bond(c, br, 1, "wedge");
    b.bond(c, f, 1, "hash");
    b.bond(c, cl, 1);
  });
}

const FIXTURES: ReadonlyArray<readonly [string, Molecule]> = [
  ["benzene", benzene()],
  ["pyrrole", pyrrole()],
  ["thiophene", thiophene()],
  ["pyridine", pyridine()],
  ["ethanol", ethanol()],
  ["acetate", acetate()],
  ["dimethyl sulfone", dimethylSulfone()],
  ["nitromethane", nitromethane()],
  ["13-C methane", isotopeMethane()],
  ["ethyl radical", ethylRadical()],
  ["bromochlorofluoromethane", bromochlorofluoromethane()],
];

// ---------------------------------------------------------------------------
// Order-insensitive comparisons
// ---------------------------------------------------------------------------

const formalCharges = (m: Molecule) =>
  m.atomIds.map((id) => requireAtom(m, id).charge).filter((c) => c !== 0).sort((a, b) => a - b);
const bondOrders = (m: Molecule) =>
  m.bondIds.map((id) => requireBond(m, id).order).sort((a, b) => a - b);
const isotopes = (m: Molecule) =>
  m.atomIds.map((id) => requireAtom(m, id).isotope ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
const radicals = (m: Molecule) =>
  m.atomIds.reduce((n, id) => n + requireAtom(m, id).radicalElectrons, 0);
const stereoCounts = (m: Molecule) => {
  const counts: Record<string, number> = {};
  for (const id of m.bondIds) {
    const s = requireBond(m, id).stereo;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
};

/** molecule -> molblock -> RDKit -> molblock -> molecule, coordinates kept. */
function roundTrip(mol: Molecule): Molecule {
  const written = moleculeToMolblock(mol, "fidelity");
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error("unreachable");
  const op = normalizeMolblock(RDKit, written.value, "preserve");
  expect(op).toMatchObject({ ok: true });
  if (!op.ok) throw new Error("unreachable");
  const read = molblockToMolecule(op.value.molblock);
  expect(read.ok).toBe(true);
  if (!read.ok) throw new Error("unreachable");
  return read.value.molecule;
}

describe("molecule -> RDKit -> molecule", () => {
  it.each(FIXTURES)("%s keeps every property chem-core can see", (name, mol) => {
    const back = roundTrip(mol);

    // toEqual, never JSON.stringify: elementCounts is a plain object whose
    // KEY ORDER varies between chemically identical molecules.
    expect(elementCounts(back), `${name} formula`).toEqual(elementCounts(mol));
    expect(netCharge(back), `${name} net charge`).toBe(netCharge(mol));
    // The multiset, not the sum. netCharge is blind to a balanced +/- pair
    // appearing out of nothing, which is exactly what a charge separation is.
    expect(formalCharges(back), `${name} formal charges`).toEqual(formalCharges(mol));
    expect(bondOrders(back), `${name} bond orders`).toEqual(bondOrders(mol));
    expect(stereoCounts(back), `${name} stereo`).toEqual(stereoCounts(mol));
    expect(isotopes(back), `${name} isotopes`).toEqual(isotopes(mol));
    expect(radicals(back), `${name} radical electrons`).toBe(radicals(mol));
    // Catches implicit hydrogens silently becoming real atoms.
    expect(back.atomIds.length, `${name} atom count`).toBe(mol.atomIds.length);
    expect(back.bondIds.length, `${name} bond count`).toBe(mol.bondIds.length);
    // Catches a coordinate-scale mismatch and a y-flip, both of which every
    // assertion above is blind to.
    expect(maxCoordinateDelta(mol, back), `${name} layout`).toBeLessThan(1e-3);
  });

  it("gives benzene back as C6H6, not C6H12 and not C6", () => {
    // The named acceptance criterion. What actually goes wrong here is
    // neither doubling nor halving: writing the hydrogen count into the
    // V2000 `hhh` field makes RDKit treat the atom as a QUERY atom and drop
    // every hydrogen, so the failure mode is C6, silently, with an empty log.
    expect(elementCounts(roundTrip(benzene()))).toEqual({ C: 6, H: 6 });
  });

  it("keeps pyrrole's N-H", () => {
    expect(elementCounts(roundTrip(pyrrole()))).toEqual({ C: 4, H: 5, N: 1 });
  });

  it("keeps thiophene at C4H4S, which is not pyrrole's answer", () => {
    // Sulfur's valence list is [2,4] and its aromatic form used to acquire a
    // phantom hydrogen. Both sides are Kekule here, so this is asserting that
    // the two five-rings are told apart rather than normalised together.
    expect(elementCounts(roundTrip(thiophene()))).toEqual({ C: 4, H: 4, S: 1 });
  });

  it("keeps acetate's charge on the same atom, not merely in the sum", () => {
    const back = roundTrip(acetate());
    expect(netCharge(back)).toBe(-1);
    expect(formalCharges(back)).toEqual([-1]);
    const anion = back.atomIds
      .map((id) => requireAtom(back, id))
      .find((atom) => atom.charge === -1);
    expect(anion?.element).toBe("O");
  });

  it("leaves the sulfone alone rather than separating its charges", () => {
    const before = dimethylSulfone();
    const back = roundTrip(before);
    // Both of these pass for the charge-separated form too, which is why the
    // two lines after them are the ones doing the work.
    expect(elementCounts(back)).toEqual(elementCounts(before));
    expect(netCharge(back)).toBe(0);
    expect(formalCharges(back)).toEqual([]);
    expect(bondOrders(back)).toEqual([1, 1, 2, 2]);
  });

  it("proves RDKit actually ran, so a pass-through fallback cannot fake it", () => {
    // Every assertion above would also pass if some catch path returned the
    // input molecule unchanged.
    const written = moleculeToMolblock(benzene());
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const op = smilesAndMolblock(RDKit, written.value, "preserve");
    expect(op).toMatchObject({ ok: true });
    if (!op.ok) return;
    expect(op.value.smiles).toBe("c1ccccc1");
    expect(op.value.molblock).toContain("RDKit");
  });
});

describe("coordinates", () => {
  it("leaves an imported layout exactly where the file put it", () => {
    const source = [
      "coords",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    3.1416    5.7397    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    4.6416    5.7397    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
      "",
    ].join("\n");

    const op = normalizeMolblock(RDKit, source, "preserve");
    expect(op).toMatchObject({ ok: true, value: { hadCoords: 2, coordsGenerated: false } });
    if (!op.ok) return;

    const before = molblockToMolecule(source);
    const after = molblockToMolecule(op.value.molblock);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    // In MODEL units and with a tolerance: the file is quantised to four
    // decimals in FILE units, so two conversions cannot be bit-exact.
    expect(maxCoordinateDelta(before.value.molecule, after.value.molecule)).toBeLessThan(1e-4);
    // And absolutely, so a mutual re-layout could not satisfy the line above.
    const first = requireAtom(after.value.molecule, after.value.molecule.atomIds[0] as string);
    expect(first.pos.x).toBeCloseTo(3.1416 / 1.5, 6);
    expect(first.pos.y).toBeCloseTo(5.7397 / 1.5, 6);
  });

  it("computes a layout when the source has no conformer", () => {
    // A SMILES never carries one. `get_molblock()` INVENTS coordinates in
    // that case, so the returned text cannot be the signal — has_coords() is.
    const op = normalizeMolblock(RDKit, "c1ccccc1", "preserve");
    expect(op).toMatchObject({ ok: true, value: { hadCoords: 0, coordsGenerated: true } });
    if (!op.ok) return;
    const read = molblockToMolecule(op.value.molblock);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const positions = read.value.molecule.atomIds.map(
      (id) => requireAtom(read.value.molecule, id).pos,
    );
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(6);
  });

  it("cannot tell an all-zero conformer from a real one, which is why the caller must", () => {
    // The measurement behind `fromMolblock` reading the source with chem-core
    // BEFORE it asks RDKit for anything. A conformer that is present and
    // entirely on the origin carries no layout, but `has_coords()` answers 2
    // for it exactly as it does for a drawing, so "preserve" here would
    // import every atom stacked on one point and call it preserved. Nothing
    // on this side of the boundary can distinguish the two.
    const zero = [
      "stacked",
      "  chemcore          2D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
      "",
    ].join("\n");
    const preserved = normalizeMolblock(RDKit, zero, "preserve");
    expect(preserved).toMatchObject({ ok: true, value: { hadCoords: 2, coordsGenerated: false } });
    if (!preserved.ok) return;
    const stacked = molblockToMolecule(preserved.value.molblock);
    expect(stacked.ok).toBe(true);
    if (!stacked.ok) return;
    expect(hasMeaningfulCoordinates(stacked.value.molecule)).toBe(false);

    // And that "generate" — which is what the boundary now asks for — fixes it.
    const generated = normalizeMolblock(RDKit, zero, "generate");
    expect(generated).toMatchObject({ ok: true, value: { coordsGenerated: true } });
    if (!generated.ok) return;
    const laidOut = molblockToMolecule(generated.value.molblock);
    expect(laidOut.ok).toBe(true);
    if (!laidOut.ok) return;
    expect(hasMeaningfulCoordinates(laidOut.value.molecule)).toBe(true);
  });

  it("re-lays-out a 3D conformer instead of flattening it onto itself", () => {
    const threeD = [
      "3d",
      "  chemcore          3D",
      "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.5000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    0.0000    1.5000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "  2  3  1  0  0  0  0",
      "M  END",
      "",
    ].join("\n");
    const op = normalizeMolblock(RDKit, threeD, "preserve");
    expect(op).toMatchObject({ ok: true, value: { hadCoords: 3, coordsGenerated: true } });
  });
});

describe("failures are results, not exceptions", () => {
  it("reports a malformed SMILES without throwing", () => {
    for (const bad of ["C1CC", "%%%not a molecule%%%", "C(((", "[Xz]"]) {
      const op = normalizeMolblock(RDKit, bad, "preserve", log);
      expect(op.ok, bad).toBe(false);
      if (op.ok) continue;
      expect(op.kind, bad).toBe("parse-failed");
    }
  });

  it("reports a structure RDKit refuses to sanitize as a chemistry problem", () => {
    // A pentavalent neutral nitrogen — an ordinary mid-sketch state, and one
    // chem-core happily holds because sprouting is never blocked by valence.
    const op = normalizeMolblock(RDKit, "CN(C)(C)(C)C", "preserve", log);
    expect(op.ok).toBe(false);
    if (op.ok) return;
    expect(op.kind).toBe("sanitize-failed");
    expect(op.message).toMatch(/valence/i);
  });

  it("refuses empty input rather than returning a zero-atom molecule", () => {
    expect(normalizeMolblock(RDKit, "  \n ", "preserve")).toMatchObject({
      ok: false,
      kind: "empty-input",
    });
  });

  it("deletes every JSMol it made, including the ones whose parse failed", () => {
    resetMolLifecycleCounts();
    for (const [, mol] of FIXTURES) roundTrip(mol);
    normalizeMolblock(RDKit, "C1CC", "preserve");
    normalizeMolblock(RDKit, "CN(C)(C)(C)C", "preserve");
    const { created, deleted } = molLifecycleCounts();
    expect(created).toBeGreaterThan(0);
    expect(deleted).toBe(created);
  });
});

describe("InChI", () => {
  it("returns an InChI and its key together", () => {
    const written = moleculeToMolblock(pyrrole());
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const op = inchiAndMolblock(RDKit, written.value);
    expect(op).toMatchObject({ ok: true });
    if (!op.ok) return;
    expect(op.value.inchi).toBe("InChI=1S/C4H5N/c1-2-4-5-3-1/h1-5H");
    expect(op.value.inchiKey).toMatch(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/);
  });
});

// ---------------------------------------------------------------------------
// InChI out, checked against published identifiers
//
// The expected strings are PubChem's, not a snapshot of whatever RDKit said:
// an InChIKey is a hash, so the only way to know one is right is to compare
// it with a key someone else computed for the same compound. The stereo and
// charge cases are the ones "Copy as InChI" is most likely to get wrong
// silently: a lost wedge drops the /t layer and turns the key's second block
// into UHFFFAOYSA, and a lost charge changes the layer and the final letter.
// ---------------------------------------------------------------------------

/** Butan-2-ol with C2's oxygen drawn wedged, hashed, or plain. */
function butan2ol(stereo: "wedge" | "hash" | "none"): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    const c3 = b.atom("C", vec(1.73, 0));
    const c4 = b.atom("C", vec(2.6, 0.5));
    const o = b.atom("O", vec(0.87, 1.5));
    b.bond(c1, c2, 1);
    if (stereo === "none") b.bond(c2, o, 1);
    else b.bond(c2, o, 1, stereo);
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
  });
}

/** (CH3)4N(+): a cation with no counter-ion, so the charge layer is /q, not /p. */
function tetramethylammonium(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", vec(0, 0), { charge: 1 });
    for (const at of [vec(1, 0), vec(-1, 0), vec(0, 1), vec(0, -1)]) {
      b.bond(n, b.atom("C", at), 1);
    }
  });
}

function inchiOf(mol: Molecule): { inchi: string; inchiKey: string } {
  const written = moleculeToMolblock(mol);
  if (!written.ok) throw new Error(written.error.message);
  const op = inchiAndMolblock(RDKit, written.value);
  if (!op.ok) throw new Error(op.message);
  return { inchi: op.value.inchi, inchiKey: op.value.inchiKey };
}

describe("InChI out", () => {
  it.each([
    ["ethanol", ethanol, "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3", "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"],
    ["pyrrole", pyrrole, "InChI=1S/C4H5N/c1-2-4-5-3-1/h1-5H", "KAESVJOAVNADME-UHFFFAOYSA-N"],
    // Acetate: the charge goes into a mobile-H /p-1 layer, and the key's last
    // letter is M (one proton removed) rather than N.
    [
      "acetate",
      acetate,
      "InChI=1S/C2H4O2/c1-2(3)4/h1H3,(H,3,4)/p-1",
      "QTBSBXVTEAMEQO-UHFFFAOYSA-M",
    ],
    [
      "tetramethylammonium",
      tetramethylammonium,
      "InChI=1S/C4H12N/c1-5(2,3)4/h1-4H3/q+1",
      "QEMXHQIAXOOASZ-UHFFFAOYSA-N",
    ],
    // The sulfone is the case a charge-separating writer would get wrong.
    [
      "dimethyl sulfone",
      dimethylSulfone,
      "InChI=1S/C2H6O2S/c1-5(2,3)4/h1-2H3",
      "HHVIBTZHLRERCL-UHFFFAOYSA-N",
    ],
  ])("writes %s as PubChem does", (_name, build, inchi, key) => {
    expect(inchiOf(build())).toEqual({ inchi, inchiKey: key });
  });

  it("carries a drawn stereocentre into the /t layer and the key", () => {
    // Oxygen up the page, ethyl to the right, methyl to the left: a wedged
    // OH is (R)-butan-2-ol, a hashed one (S).
    expect(inchiOf(butan2ol("wedge"))).toEqual({
      inchi: "InChI=1S/C4H10O/c1-3-4(2)5/h4-5H,3H2,1-2H3/t4-/m1/s1",
      inchiKey: "BTANRVKWQNVYAZ-SCSAIBSYSA-N",
    });
    expect(inchiOf(butan2ol("hash"))).toEqual({
      inchi: "InChI=1S/C4H10O/c1-3-4(2)5/h4-5H,3H2,1-2H3/t4-/m0/s1",
      inchiKey: "BTANRVKWQNVYAZ-BYPYZUCNSA-N",
    });
    // Undrawn stereo is undefined stereo, not a guess: no /t layer at all.
    expect(inchiOf(butan2ol("none"))).toEqual({
      inchi: "InChI=1S/C4H10O/c1-3-4(2)5/h4-5H,3H2,1-2H3",
      inchiKey: "BTANRVKWQNVYAZ-UHFFFAOYSA-N",
    });
  });
});

// ---------------------------------------------------------------------------
// A refused "Clean up" names an atom the user can find
//
// Cleanup is `normalizeMolblock(..., "generate")`. When RDKit's sanitizer
// refuses, all it says is an index; `atomIdsNamedByRdkit` is what turns that
// into the id the overlay rings. Asserted against the real wasm, because the
// wording being parsed is RDKit's and only RDKit can say it has not changed.
// ---------------------------------------------------------------------------

describe("a refused Clean up names the atom", () => {
  /** CH3-NH3, three hydrogens PINNED on a nitrogen left uncharged. */
  function unchargedMethylammonium() {
    return buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      b.bond(c, b.atom("N", vec(1, 0), { explicitHydrogenCount: 3 }), 1);
    });
  }

  function cleanUp(mol: Parameters<typeof moleculeToMolblock>[0]) {
    const written = moleculeToMolblock(mol);
    if (!written.ok) throw new Error(written.error.message);
    return normalizeMolblock(RDKit, written.value, "generate", log);
  }

  it("lands on the atom chem-core marks, for a pinned hydrogen count that overflows", () => {
    // The regression: chem-core used to call this clean while RDKit refused
    // it, so the status line named "atom # 1" and the canvas showed nothing.
    const mol = unchargedMethylammonium();
    const nitrogen = mol.atomIds[1]!;
    expect(chemistryIssues(mol).map((issue) => issue.atomId)).toEqual([nitrogen]);

    const op = cleanUp(mol);
    expect(op.ok).toBe(false);
    if (op.ok) return;
    expect(op.kind).toBe("sanitize-failed");
    expect(atomIdsNamedByRdkit(mol, [op.message, ...op.notes].join("\n"))).toEqual([nitrogen]);
  });

  it("cleans up once the offered fix is taken", () => {
    const mol = unchargedMethylammonium();
    const [issue] = chemistryIssues(mol);
    for (const fix of issueFixes(mol, issue!)) {
      const fixed = applyIssueFix(mol, fix);
      expect(chemistryIssues(fixed), fix.title).toEqual([]);
      expect(cleanUp(fixed).ok, fix.title).toBe(true);
    }
  });

  it("lands on the right atom when that atom is not the first one written", () => {
    // Iodine heptafluoride drawn after an ethane, so RDKit names the iodine as
    // "atom # 2": a mapping that ignored the offset would ring a carbon.
    // chem-core and RDKit agree it is over-valent — both stop iodine at 5 —
    // and the refusal has to land on the same atom chem-core marks.
    const mol = buildMolecule((b) => {
      b.bond(b.atom("C", vec(-2.7, 0)), b.atom("C", vec(-1.9, 0.5)), 1);
      const iodine = b.atom("I", vec(0, 0));
      for (let i = 0; i < 7; i++) {
        const angle = (2 * Math.PI * i) / 7;
        b.bond(iodine, b.atom("F", vec(Math.cos(angle), Math.sin(angle))), 1);
      }
    });
    const iodine = mol.atomIds[2]!;
    expect(requireAtom(mol, iodine).element).toBe("I");
    expect(chemistryIssues(mol).map((issue) => issue.atomId)).toEqual([iodine]);

    const op = cleanUp(mol);
    expect(op.ok).toBe(false);
    if (op.ok) return;
    expect(op.kind).toBe("sanitize-failed");
    expect(op.message).toContain("atom # 2");
    expect(atomIdsNamedByRdkit(mol, [op.message, ...op.notes].join("\n"))).toEqual([iodine]);
  });
});
