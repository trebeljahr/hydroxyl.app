import { describe, expect, it } from "vitest";
import { kekulize } from "./aromatic.js";
import { benzene, buildMolecule, carbocycle, linearChain, singleAtom } from "./builders.js";
import { elementCounts, exactMass, molecularWeight } from "./formula.js";
import * as M from "./molecule.js";
import { isRingBond } from "./rings.js";
import type { AtomId, AtomInit, Molecule } from "./types.js";
import * as V from "./valence.js";
import { fromPolar, vec } from "./vec.js";

const first = (mol: ReturnType<typeof singleAtom>) => mol.atomIds[0]!;

describe("implicit hydrogens on neutral atoms", () => {
  it("saturates a lone atom", () => {
    expect(V.implicitHydrogenCount(singleAtom("C"), first(singleAtom("C")))).toBe(4);
    expect(V.implicitHydrogenCount(singleAtom("N"), first(singleAtom("N")))).toBe(3);
    expect(V.implicitHydrogenCount(singleAtom("O"), first(singleAtom("O")))).toBe(2);
    expect(V.implicitHydrogenCount(singleAtom("Cl"), first(singleAtom("Cl")))).toBe(1);
  });

  it("counts down as bonds are drawn", () => {
    const ethane = linearChain(2);
    for (const id of ethane.atomIds) {
      expect(V.implicitHydrogenCount(ethane, id)).toBe(3);
    }
    const propane = linearChain(3);
    expect(V.implicitHydrogenCount(propane, propane.atomIds[1]!)).toBe(2);
  });

  it("accounts for bond order", () => {
    // Ethene: each carbon carries two hydrogens.
    const ethene = buildMolecule((b) => {
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(c1, c2, 2);
    });
    for (const id of ethene.atomIds) {
      expect(V.implicitHydrogenCount(ethene, id)).toBe(2);
    }
    // Ethyne: one each.
    const ethyne = buildMolecule((b) => {
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(c1, c2, 3);
    });
    for (const id of ethyne.atomIds) {
      expect(V.implicitHydrogenCount(ethyne, id)).toBe(1);
    }
  });

  it("gives no hydrogens to a noble gas or a metal", () => {
    expect(V.implicitHydrogenCount(singleAtom("He"), first(singleAtom("He")))).toBe(0);
    expect(V.implicitHydrogenCount(singleAtom("Fe"), first(singleAtom("Fe")))).toBe(0);
  });
});

describe("variable valence", () => {
  it("picks the smallest valence that fits — sulfur", () => {
    // Thiol sulfur: 2 bonds used of valence 2, so no room left.
    const thiol = buildMolecule((b) => {
      const c = b.atom("C");
      const s = b.atom("S");
      b.bond(c, s, 1);
    });
    expect(V.implicitHydrogenCount(thiol, thiol.atomIds[1]!)).toBe(1);

    // Sulfone sulfur: four bond-order units used, so valence 6 applies and
    // there is no hydrogen. A single maxBonds number cannot express this.
    const sulfone = buildMolecule((b) => {
      const s = b.atom("S");
      const o1 = b.atom("O");
      const o2 = b.atom("O");
      const c1 = b.atom("C");
      const c2 = b.atom("C");
      b.bond(s, o1, 2);
      b.bond(s, o2, 2);
      b.bond(s, c1, 1);
      b.bond(s, c2, 1);
    });
    expect(V.bondOrderSum(sulfone, sulfone.atomIds[0]!)).toBe(6);
    expect(V.implicitHydrogenCount(sulfone, sulfone.atomIds[0]!)).toBe(0);
    expect(V.isOverValent(sulfone, sulfone.atomIds[0]!)).toBe(false);
  });

  it("picks the smallest valence that fits — phosphorus", () => {
    // Phosphine PH3 vs a five-coordinate phosphorane.
    expect(V.implicitHydrogenCount(singleAtom("P"), first(singleAtom("P")))).toBe(3);
    const phosphate = buildMolecule((b) => {
      const p = b.atom("P");
      const o1 = b.atom("O");
      const o2 = b.atom("O");
      const o3 = b.atom("O");
      const o4 = b.atom("O");
      b.bond(p, o1, 2);
      b.bond(p, o2, 1);
      b.bond(p, o3, 1);
      b.bond(p, o4, 1);
    });
    expect(V.implicitHydrogenCount(phosphate, phosphate.atomIds[0]!)).toBe(0);
  });

  it("exposes the whole charge-adjusted valence list, not just its maximum", () => {
    // `maxValence` alone cannot answer "how much room does this atom have",
    // because for sulfur the answer depends on which of its three valences the
    // bonding actually reaches. Kekulisation needs the list: thiopyrylium's S+
    // settles at 3 with one double bond, and measuring it against the 7 at the
    // top of the same list says it needs no double bond at all.
    const thiophene = buildMolecule((b) => b.atom("S"));
    expect(V.chargeAdjustedValences(thiophene, thiophene.atomIds[0]!)).toEqual([2, 4, 6]);

    const sulfonium = buildMolecule((b) => b.atom("S", undefined, { charge: 1 }));
    expect(V.chargeAdjustedValences(sulfonium, sulfonium.atomIds[0]!)).toEqual([3, 5, 7]);
    expect(V.maxValence(sulfonium, sulfonium.atomIds[0]!)).toBe(7);

    // Carbon's positive-charge inversion carries through, as it must: the list
    // and `maxValence` are two readings of one adjustment, never two rules.
    const cation = buildMolecule((b) => b.atom("C", undefined, { charge: 1 }));
    expect(V.chargeAdjustedValences(cation, cation.atomIds[0]!)).toEqual([3]);

    // A metal carries no default valence, so there is nothing to adjust.
    const iron = buildMolecule((b) => b.atom("Fe"));
    expect(V.chargeAdjustedValences(iron, iron.atomIds[0]!)).toEqual([]);
  });
});

describe("charge", () => {
  it("lets ammonium take a fourth bond", () => {
    const ammonium = buildMolecule((b) => b.atom("N", undefined, { charge: 1 }));
    expect(V.implicitHydrogenCount(ammonium, ammonium.atomIds[0]!)).toBe(4);
    expect(V.maxValence(ammonium, ammonium.atomIds[0]!)).toBe(4);
  });

  it("shrinks alkoxide oxygen to one bond", () => {
    const alkoxide = buildMolecule((b) => {
      const c = b.atom("C");
      const o = b.atom("O", undefined, { charge: -1 });
      b.bond(c, o, 1);
    });
    expect(V.implicitHydrogenCount(alkoxide, alkoxide.atomIds[1]!)).toBe(0);
  });

  it("gives a carbocation three hydrogens, not five", () => {
    // Without carbon's special case a positive charge would add capacity
    // rather than remove it, and CH3+ would come out as CH5+.
    const cation = buildMolecule((b) => b.atom("C", undefined, { charge: 1 }));
    expect(V.implicitHydrogenCount(cation, cation.atomIds[0]!)).toBe(3);
  });

  it("gives a carbanion three hydrogens", () => {
    const anion = buildMolecule((b) => b.atom("C", undefined, { charge: -1 }));
    expect(V.implicitHydrogenCount(anion, anion.atomIds[0]!)).toBe(3);
  });

  it("inverts for electropositive elements", () => {
    // Borohydride: B- reaches four bonds where neutral boron manages three.
    const borohydride = buildMolecule((b) => b.atom("B", undefined, { charge: -1 }));
    expect(V.maxValence(borohydride, borohydride.atomIds[0]!)).toBe(4);
    expect(V.implicitHydrogenCount(borohydride, borohydride.atomIds[0]!)).toBe(4);
  });
});

describe("radicals", () => {
  it("consume valence", () => {
    const methyl = buildMolecule((b) =>
      b.atom("C", undefined, { radicalElectrons: 1 }),
    );
    expect(V.implicitHydrogenCount(methyl, methyl.atomIds[0]!)).toBe(3);
    expect(V.explicitValence(methyl, methyl.atomIds[0]!)).toBe(1);
  });
});

describe("explicitHydrogenCount override", () => {
  it("wins over the derived count", () => {
    const pinned = buildMolecule((b) =>
      b.atom("C", undefined, { explicitHydrogenCount: 0 }),
    );
    expect(V.implicitHydrogenCount(pinned, pinned.atomIds[0]!)).toBe(0);
  });

  it("is how pyrrole's N-H is expressed", () => {
    // Pyrrole and pyridine nitrogens both see a bond-order sum of 3 from two
    // aromatic ring bonds, so valence alone cannot tell them apart.
    const ring = carbocycle(5);
    const atoms = { ...ring.atoms };
    const nId = ring.atomIds[0]!;
    atoms[nId] = { ...atoms[nId]!, element: "N", explicitHydrogenCount: 1 };
    const pyrrole = { ...ring, atoms };
    expect(V.implicitHydrogenCount(pyrrole, nId)).toBe(1);
  });
});

describe("aromatic bonds", () => {
  it("count as one and a half so a benzene carbon still gets one hydrogen", () => {
    const kekule = benzene();
    const bonds = Object.fromEntries(
      Object.entries(kekule.bonds).map(([id, b]) => [
        id,
        { ...b, order: 1 as const, aromatic: true },
      ]),
    );
    const aromatic = { ...kekule, bonds };
    for (const id of aromatic.atomIds) {
      expect(V.bondOrderSum(aromatic, id)).toBe(3);
      expect(V.implicitHydrogenCount(aromatic, id)).toBe(1);
    }
  });

  it("agrees with the Kekule form", () => {
    const kekule = benzene();
    for (const id of kekule.atomIds) {
      expect(V.implicitHydrogenCount(kekule, id)).toBe(1);
    }
  });
});

describe("free valence and over-valence", () => {
  it("reports remaining capacity", () => {
    const methane = singleAtom("C");
    expect(V.freeValence(methane, methane.atomIds[0]!)).toBe(4);
    const propane = linearChain(3);
    expect(V.freeValence(propane, propane.atomIds[1]!)).toBe(2);
    expect(V.canAcceptBond(propane, propane.atomIds[1]!, 2)).toBe(true);
    expect(V.canAcceptBond(propane, propane.atomIds[1]!, 3)).toBe(false);
  });

  it("treats metals as never saturated", () => {
    const iron = singleAtom("Fe");
    expect(V.freeValence(iron, iron.atomIds[0]!)).toBe(Infinity);
    expect(V.canAcceptBond(iron, iron.atomIds[0]!, 6)).toBe(true);
  });

  it("flags a pentavalent carbon as an error but still returns a count", () => {
    const bad = buildMolecule((b) => {
      const c = b.atom("C");
      for (let i = 0; i < 5; i++) b.bond(c, b.atom("Cl"), 1);
    });
    const carbon = bad.atomIds[0]!;
    expect(V.isOverValent(bad, carbon)).toBe(true);
    expect(V.implicitHydrogenCount(bad, carbon)).toBe(0);

    const issues = V.valenceIssues(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.atomId).toBe(carbon);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toMatch(/5 bonds/);
  });

  it("reports nothing for a clean structure", () => {
    expect(V.valenceIssues(benzene())).toEqual([]);
    expect(V.valenceIssues(linearChain(8))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rows RDKit 2025.03 moved
//
// Each of these used to disagree with the pinned RDKit, which is the import
// and export oracle, so each disagreement was a round trip that gained or lost
// hydrogens. The client's valence-table.node.test.ts checks every element
// against the real wasm; these pin the chemistry by name.
// ---------------------------------------------------------------------------

/** `centre` with `n` single-bonded `ligand` atoms around it. */
function star(centre: string, ligand: string, n: number, order: 1 | 2 = 1): Molecule {
  return buildMolecule((b) => {
    const c = b.atom(centre, vec(0, 0));
    for (let i = 0; i < n; i++) b.bond(c, b.atom(ligand, fromPolar((2 * Math.PI * i) / n, 1)), order);
  });
}

describe("the heavier main-group rows follow RDKit 2025.03", () => {
  it("gives a lone gallium or indium three hydrogens: gallane and indigane", () => {
    for (const metal of ["Ga", "In"]) {
      const lone = singleAtom(metal);
      expect(V.implicitHydrogenCount(lone, first(lone)), metal).toBe(3);
      expect(elementCounts(lone), metal).toEqual({ [metal]: 1, H: 3 });
    }
  });

  it("saturates trimethylgallium's gallium with its three methyls", () => {
    const gaMe3 = star("Ga", "C", 3);
    const gallium = gaMe3.atomIds[0]!;
    expect(V.implicitHydrogenCount(gaMe3, gallium)).toBe(0);
    expect(V.valenceIssues(gaMe3)).toEqual([]);
  });

  it("reads polonium like the chalcogen above it: H2Po", () => {
    const polane = singleAtom("Po");
    expect(V.implicitHydrogenCount(polane, first(polane))).toBe(2);
    expect(V.chargeAdjustedValences(polane, first(polane))).toEqual([2, 4, 6]);
  });

  it("draws the xenon fluorides and xenon trioxide without a hydrogen or a warning", () => {
    for (const [name, mol] of [
      ["XeF2", star("Xe", "F", 2)],
      ["XeF4", star("Xe", "F", 4)],
      ["XeF6", star("Xe", "F", 6)],
      ["XeO3", star("Xe", "O", 3, 2)],
    ] as const) {
      expect(V.implicitHydrogenCount(mol, mol.atomIds[0]!), name).toBe(0);
      expect(V.valenceIssues(mol), name).toEqual([]);
    }
  });

  it("gives xenon with one bond the hydrogen of HXeCl", () => {
    // The matrix-isolated noble-gas hydride, and the case that proves the list
    // is [0, 2, 4, 6] rather than [] — with no valences xenon would take the
    // chlorine and nothing else.
    const hxecl = star("Xe", "Cl", 1);
    expect(V.implicitHydrogenCount(hxecl, hxecl.atomIds[0]!)).toBe(1);
  });

  it("stops iodine at five: IF5 is clean and IF7 is over-valent", () => {
    // RDKit 2025.03 refuses IF7 outright ("Explicit valence for atom # 1 I,
    // 7, is greater than permitted"). Drawing it is still allowed — an
    // over-valence is reported, never prevented — but the badge now warns
    // before an export does.
    const if5 = star("I", "F", 5);
    expect(V.valenceIssues(if5)).toEqual([]);
    const if7 = star("I", "F", 7);
    expect(V.isOverValent(if7, if7.atomIds[0]!)).toBe(true);
    // The old seventh valence used to hand six fluorines a hydrogen.
    const if6 = star("I", "F", 6);
    expect(V.implicitHydrogenCount(if6, if6.atomIds[0]!)).toBe(0);
    expect(V.isOverValent(if6, if6.atomIds[0]!)).toBe(true);
  });

  it("treats astatine exactly as iodine", () => {
    expect(V.implicitHydrogenCount(singleAtom("At"), first(singleAtom("At")))).toBe(1);
    const at6 = star("At", "F", 6);
    expect(V.isOverValent(at6, at6.atomIds[0]!)).toBe(true);
  });

  it("refuses a bond to a noble gas but keeps a lone one hydrogen-free", () => {
    for (const gas of ["He", "Ne", "Ar", "Kr", "Rn"]) {
      const lone = singleAtom(gas);
      expect(V.implicitHydrogenCount(lone, first(lone)), gas).toBe(0);
      expect(V.valenceIssues(lone), gas).toEqual([]);
      const bonded = star(gas, "C", 1);
      expect(V.isOverValent(bonded, bonded.atomIds[0]!), gas).toBe(true);
    }
  });

  it("gives the helium cation the hydrogen of HeH+", () => {
    // The helium hydride ion, and RDKit's answer for [He+] too.
    const cation = buildMolecule((b) => {
      b.atom("He", vec(0, 0), { charge: 1 });
    });
    expect(V.implicitHydrogenCount(cation, first(cation))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Imported aromatic flags
//
// The regression suite for the half-integer defect. An aromatic-flagged bond
// weighs 1.5, so a heteroatom with two of them sums to 3 — and picking the
// smallest valence AT OR ABOVE 3 skipped sulfur's 2 for its 4 and invented a
// hydrogen. Every fixture below is asserted twice, once carrying flags and
// once Kekulised, because the two forms describe the same molecule and the
// only defensible test is that they agree. Benzene hid the bug for 367 tests
// precisely because carbon has a single valence and so has no wrong entry to
// pick.
// ---------------------------------------------------------------------------

/** A ring on a circle. `doubleAt` holds the index `i` of each bond joining
 *  atom `i` to atom `i + 1`, so a Kekule structure is written as the positions
 *  of its double bonds. Local to this file for the reason the header of
 *  aromatic.test.ts gives: a shared fixture module would ship in dist. */
function monocycle(
  elements: readonly string[],
  doubleAt: readonly number[] = [],
  extras: Readonly<Record<number, Partial<AtomInit>>> = {},
): Molecule {
  const n = elements.length;
  const radius = 1 / (2 * Math.sin(Math.PI / n));
  return buildMolecule((b) => {
    const ids: AtomId[] = [];
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      ids.push(b.atom(elements[i]!, fromPolar(angle, radius), extras[i] ?? {}));
    }
    const doubles = new Set(doubleAt);
    for (let i = 0; i < n; i++) {
      b.bond(ids[i]!, ids[(i + 1) % n]!, doubles.has(i) ? 2 : 1);
    }
  });
}

/**
 * Benzothiophene, in the Kekule storage form. Present so the fixtures are not
 * all monocycles: a fusion carbon carries THREE aromatic bonds and so sums to
 * 4.5 rather than 3, which is the other half-integer the resolution has to
 * handle — and the one that used to make every flagged fused carbon report as
 * over-valent.
 */
function benzothiophene(): Molecule {
  return buildMolecule((b) => {
    // Five-ring S1 C2 C3 C3a C7a, six-ring C3a C4 C5 C6 C7 C7a, fused on
    // C3a-C7a. Positions are schematic; valence does not read them.
    const s1 = b.atom("S", vec(0, 0));
    const c2 = b.atom("C", vec(1, 0.3));
    const c3 = b.atom("C", vec(1.6, 1.2));
    const c3a = b.atom("C", vec(1, 2));
    const c7a = b.atom("C", vec(0.1, 1.5));
    const c4 = b.atom("C", vec(1.2, 3));
    const c5 = b.atom("C", vec(0.5, 3.8));
    const c6 = b.atom("C", vec(-0.4, 3.6));
    const c7 = b.atom("C", vec(-0.6, 2.4));
    b.bond(s1, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c3a, 1);
    b.bond(c3a, c7a, 2);
    b.bond(c7a, s1, 1);
    b.bond(c3a, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, c6, 1);
    b.bond(c6, c7, 2);
    b.bond(c7, c7a, 1);
  });
}

/** What an importer hands over: every ring bond flagged aromatic, its order
 *  discarded, and both endpoints marked. Mirrors the molblock and SMILES
 *  paths, which carry perception and no Kekule structure. */
function importAromatic(mol: Molecule): Molecule {
  const atoms = { ...mol.atoms };
  const bonds = { ...mol.bonds };
  for (const id of mol.bondIds) {
    if (!isRingBond(mol, id)) continue;
    const bond = bonds[id]!;
    bonds[id] = { ...bond, order: 1, aromatic: true };
    atoms[bond.from] = { ...atoms[bond.from]!, aromatic: true };
    atoms[bond.to] = { ...atoms[bond.to]!, aromatic: true };
  }
  return { ...mol, atoms, bonds };
}

/**
 * The fixtures, with the heteroatom always at `a1`.
 *
 * Pyrrole and phosphole pin their N-H and P-H, and must: two aromatic bonds
 * give their nitrogen and phosphorus the same sum of 3 that pyridine's
 * nitrogen sees, so valence alone cannot tell a donor from a non-donor. That
 * is why RDKit writes them `[nH]1cccc1` and `[pH]1cccc1`, and pinning here is
 * modelling the importer faithfully rather than papering over the defect —
 * thiophene, which is the defect, pins nothing.
 */
const AROMATIC_FIXTURES: ReadonlyArray<
  readonly [string, Molecule, Readonly<Record<string, number>>]
> = [
  ["benzene", monocycle(["C", "C", "C", "C", "C", "C"], [0, 2, 4]), { C: 6, H: 6 }],
  ["pyridine", monocycle(["N", "C", "C", "C", "C", "C"], [0, 2, 4]), { C: 5, H: 5, N: 1 }],
  [
    "pyrrole",
    monocycle(["N", "C", "C", "C", "C"], [1, 3], { 0: { explicitHydrogenCount: 1 } }),
    { C: 4, H: 5, N: 1 },
  ],
  ["furan", monocycle(["O", "C", "C", "C", "C"], [1, 3]), { C: 4, H: 4, O: 1 }],
  ["thiophene", monocycle(["S", "C", "C", "C", "C"], [1, 3]), { C: 4, H: 4, S: 1 }],
  ["selenophene", monocycle(["Se", "C", "C", "C", "C"], [1, 3]), { C: 4, H: 4, Se: 1 }],
  [
    "phosphole",
    monocycle(["P", "C", "C", "C", "C"], [1, 3], { 0: { explicitHydrogenCount: 1 } }),
    { C: 4, H: 5, P: 1 },
  ],
  ["benzothiophene", benzothiophene(), { C: 8, H: 6, S: 1 }],
  // Charged heteroatoms. Pyridinium sits BELOW its charge-adjusted valence and
  // pyrylium and thiopyrylium sit exactly ON theirs, which is the boundary the
  // resolution must not cross: snapping an at-the-limit centre would change
  // tropylium and the Cp anion, which read correctly today.
  [
    "pyridinium",
    monocycle(["N", "C", "C", "C", "C", "C"], [0, 2, 4], { 0: { charge: 1 } }),
    { C: 5, H: 6, N: 1 },
  ],
  [
    "pyrylium",
    monocycle(["O", "C", "C", "C", "C", "C"], [0, 2, 4], { 0: { charge: 1 } }),
    { C: 5, H: 5, O: 1 },
  ],
  [
    "pyrrolide",
    monocycle(["N", "C", "C", "C", "C"], [1, 3], { 0: { charge: -1 } }),
    { C: 4, H: 4, N: 1 },
  ],
  // Stannole is thiophene's defect on a group-14 element: tin's valences are
  // 2 and 4, the flagged ring sums to 3, and the old search picked the 4.
  ["stannole", monocycle(["Sn", "C", "C", "C", "C"], [1, 3]), { C: 4, H: 4, Sn: 1 }],
  // Stannabenzene pins its hydrogen for the same reason pyrrole pins its N-H,
  // and it is the case that proves the rule is a reading rather than a
  // derivation: tin's valences are 2 and 4, exactly sulfur's shape, but here
  // the metal takes a ring DOUBLE BOND where thiophene's sulfur donates a lone
  // pair. Two aromatic bonds look identical in both, so the pin is the only
  // thing that can tell them apart. See `resolveAromaticValence`.
  [
    "stannabenzene",
    monocycle(["Sn", "C", "C", "C", "C", "C"], [0, 2, 4], {
      0: { explicitHydrogenCount: 1 },
    }),
    { C: 5, H: 6, Sn: 1 },
  ],
];

describe("imported aromatic flags derive the Kekule hydrogen count", () => {
  it("gives every fixture the same formula flagged and Kekulised", () => {
    for (const [label, kekule, formula] of AROMATIC_FIXTURES) {
      const flagged = importAromatic(kekule);
      expect(elementCounts(kekule), `${label}: Kekule form`).toEqual(formula);
      expect(elementCounts(flagged), `${label}: flagged form`).toEqual(formula);
      expect(elementCounts(flagged), `${label}: forms agree`).toEqual(
        elementCounts(kekule),
      );
    }
  });

  it("survives a round trip through kekulize", () => {
    // The mitigation importers were told to apply until this landed. It must
    // still hold, and must now be redundant rather than load-bearing.
    for (const [label, kekule, formula] of AROMATIC_FIXTURES) {
      const flagged = importAromatic(kekule);
      expect(elementCounts(kekulize(flagged)), `${label}: kekulized`).toEqual(
        formula,
      );
    }
  });

  it("reads thiophene's sulfur as divalent, which is the defect itself", () => {
    // The specific number the bug turned on. Sulfur's valences are 2, 4, 6;
    // two aromatic bonds sum to 3; the old code found no entry at or above 3
    // before 4 and handed back one hydrogen.
    const flagged = importAromatic(monocycle(["S", "C", "C", "C", "C"], [1, 3]));
    expect(V.implicitHydrogenCount(flagged, "a1")).toBe(0);
    expect(V.explicitValence(flagged, "a1")).toBe(2);
    // `bondOrderSum` is deliberately NOT snapped: it reports what is drawn,
    // and Kekulisation's tests use its half-integers to detect a ring that was
    // only partly assigned.
    expect(V.bondOrderSum(flagged, "a1")).toBe(3);
  });

  it("resolves a fused carbon's 4.5 rather than calling it over-valent", () => {
    const flagged = importAromatic(benzothiophene());
    const fusion = flagged.atomIds.filter((id) => M.degree(flagged, id) === 3);
    expect(fusion).toHaveLength(2);
    for (const id of fusion) {
      expect(V.bondOrderSum(flagged, id), `${id}: raw sum`).toBe(4.5);
      expect(V.explicitValence(flagged, id), `${id}: resolved`).toBe(4);
      expect(V.isOverValent(flagged, id), `${id}: not over-valent`).toBe(false);
      expect(V.implicitHydrogenCount(flagged, id)).toBe(0);
    }
  });

  it("reports no valence issue on any flagged fixture", () => {
    // Furan's oxygen and the pyrrolide nitrogen used to fail this: their raw
    // sum of 3 exceeded a charge-adjusted maximum of 2, so an imported furan
    // arrived with a valence error against an atom that is perfectly ordinary.
    for (const [label, kekule] of AROMATIC_FIXTURES) {
      expect(V.valenceIssues(kekule), `${label}: Kekule form`).toEqual([]);
      expect(V.valenceIssues(importAromatic(kekule)), `${label}: flagged`).toEqual(
        [],
      );
    }
  });

  it("keeps free valence and mass in step across the two forms", () => {
    // Everything downstream of implicitHydrogenCount: the status-bar readout,
    // and the two mass functions formula.ts derives from the same count.
    for (const [label, kekule] of AROMATIC_FIXTURES) {
      const flagged = importAromatic(kekule);
      for (const id of kekule.atomIds) {
        // A pinned hydrogen is the one place the two forms genuinely differ,
        // and it is not this defect. Pyrrole's N and phosphole's P sit exactly
        // ON their valence once their two aromatic bonds are counted at 1.5 —
        // the 3 that already stands in for the pinned H — so their remaining
        // capacity reads 0 flagged and 1 Kekulised. Resolving that would mean
        // snapping an at-the-limit centre, which is precisely what tropylium
        // and the Cp anion depend on NOT happening. The formula, which is what
        // this task is about, agrees either way because the pin short-circuits
        // the derivation entirely.
        if (M.requireAtom(kekule, id).explicitHydrogenCount !== undefined) continue;
        expect(
          V.freeValence(flagged, id),
          `${label}/${id}: free valence`,
        ).toBe(V.freeValence(kekule, id));
      }
      expect(molecularWeight(flagged), `${label}: weight`).toBeCloseTo(
        molecularWeight(kekule),
        9,
      );
      expect(exactMass(flagged), `${label}: exact mass`).toBeCloseTo(
        exactMass(kekule),
        9,
      );
    }
  });

  it("still reports an atom no amount of perception could explain", () => {
    // The clamp, and its limit. Snapping down must not become a way to silence
    // a real error — but it can only tell the two apart by size. A flag adds at
    // most half a bond order, over at most three ring bonds, so a sum that
    // overshoots the valence list by more than 1.5 cannot be flag noise.
    //
    // A neutral ring nitrogen bearing an exocyclic double bond — how an
    // importer writes pyridine N-oxide when it loses the charge-separated form
    // — sums to 1.5 + 1.5 + 2 = 5 against nitrogen's valence of 3. The gap of 2
    // is past the slack, so the sum is left where it is and the error survives
    // into the flagged form exactly as it does in the Kekule one.
    const badNOxide = buildMolecule((b) => {
      const ring: AtomId[] = [];
      for (let i = 0; i < 6; i++) {
        ring.push(b.atom(i === 0 ? "N" : "C", fromPolar(i, 1)));
      }
      for (let i = 0; i < 6; i++) {
        b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
      }
      b.bond(ring[0]!, b.atom("O", vec(0, 2)), 2);
    });
    const flaggedNOxide = importAromatic(badNOxide);
    expect(V.bondOrderSum(flaggedNOxide, "a1")).toBe(5);
    expect(V.explicitValence(flaggedNOxide, "a1")).toBe(5);
    expect(V.isOverValent(flaggedNOxide, "a1")).toBe(true);
    expect(V.isOverValent(badNOxide, "a1")).toBe(true);

    // The other side of the same coin, asserted so nobody reads the clamp as
    // stronger than it is: a ring carbon carrying two extra substituents sums
    // to 5 against a valence of 4, a gap of 1, which is INSIDE the slack. It is
    // resolved to 4 and stops being reported for as long as the flags stand.
    // That is the price of not calling every fused carbon at 4.5 over-valent,
    // and RDKit pays it the same way. The Kekule form of the same structure
    // reports it, which is where a chemist would see it.
    const overloaded = buildMolecule((b) => {
      const ring: AtomId[] = [];
      for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(i, 1)));
      for (let i = 0; i < 6; i++) {
        b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 0 ? 2 : 1);
      }
      b.bond(ring[0]!, b.atom("C"), 1);
      b.bond(ring[0]!, b.atom("C"), 1);
    });
    const flagged = importAromatic(overloaded);
    expect(V.bondOrderSum(flagged, "a1")).toBe(5);
    expect(V.explicitValence(flagged, "a1")).toBe(4);
    expect(V.isOverValent(flagged, "a1")).toBe(false);
    expect(V.isOverValent(overloaded, "a1")).toBe(true);
  });

  it("needs stannabenzene's hydrogen pinned, as it needs pyrrole's", () => {
    // The residue, pinned so it is a known limit rather than a surprise.
    // Stannole's tin donates a lone pair and takes no hydrogen; stannabenzene's
    // takes a ring double bond and one hydrogen. Both are neutral tin with two
    // aromatic bonds, so the flagged forms are byte-identical apart from the
    // ring size and no valence rule can separate them. Resolution reads them
    // both as the donor, which is right for the five-ring and one hydrogen
    // short for the six — so the six-ring pins, exactly as RDKit writes [snH].
    const bare = monocycle(["Sn", "C", "C", "C", "C", "C"], [0, 2, 4]);
    expect(elementCounts(bare)).toEqual({ C: 5, H: 6, Sn: 1 });
    expect(elementCounts(importAromatic(bare))).toEqual({ C: 5, H: 5, Sn: 1 });

    const pinned = monocycle(["Sn", "C", "C", "C", "C", "C"], [0, 2, 4], {
      0: { explicitHydrogenCount: 1 },
    });
    expect(elementCounts(importAromatic(pinned))).toEqual(elementCounts(pinned));
  });

  it("leaves the Kekule storage form untouched", () => {
    // The safety property that bounds the blast radius: the resolution is
    // keyed off aromatic flags, and the storage form carries none, so nothing
    // the editor produces can reach it. A sulfur with three plain single bonds
    // still gets its hydrogen from the 4 in its valence list.
    const sulfonium = buildMolecule((b) => {
      const s = b.atom("S");
      for (let i = 0; i < 3; i++) b.bond(s, b.atom("C"), 1);
    });
    expect(V.explicitValence(sulfonium, "a1")).toBe(3);
    expect(V.implicitHydrogenCount(sulfonium, "a1")).toBe(1);
  });
});
