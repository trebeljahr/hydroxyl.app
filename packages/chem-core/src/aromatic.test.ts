import { describe, expect, it } from "vitest";
import * as A from "./aromatic.js";
import { benzene, buildMolecule, carbocycle, linearChain } from "./builders.js";
import { elementCounts } from "./formula.js";
import * as M from "./molecule.js";
import * as R from "./rings.js";
import type { AtomId, AtomInit, Molecule } from "./types.js";
import { bondOrderSum } from "./valence.js";
import { fromPolar, vec } from "./vec.js";

// ---------------------------------------------------------------------------
// Fixtures
//
// Local to this file on purpose: tsconfig includes `src` and excludes only
// `src/**/*.test.ts`, so a shared `aromatic-fixtures.ts` would be compiled
// into dist as dead shipped code. Everything here is in the Kekule STORAGE
// form — real bond orders, every aromatic flag false — because that is the
// normal case perception has to work on.
// ---------------------------------------------------------------------------

/**
 * A single ring laid out on a circle. `doubleAt` holds the indices `i` of the
 * bonds joining atom `i` to atom `i + 1`, so a Kekule structure is written as
 * the positions of its double bonds.
 */
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

const pyridine = (): Molecule => monocycle(["N", "C", "C", "C", "C", "C"], [0, 2, 4]);

/** Pyrrole. The N-H must be pinned: valence alone cannot tell this nitrogen
 *  from pyridine's, since both see a bond-order sum of 3. */
const pyrrole = (): Molecule =>
  monocycle(["N", "C", "C", "C", "C"], [1, 3], { 0: { explicitHydrogenCount: 1 } });

/** Pyrrole with the N-H left off — the documented `kekulize` failure case. */
const pyrroleWithoutNH = (): Molecule =>
  monocycle(["N", "C", "C", "C", "C"], [1, 3]);

const furan = (): Molecule => monocycle(["O", "C", "C", "C", "C"], [1, 3]);
const thiophene = (): Molecule => monocycle(["S", "C", "C", "C", "C"], [1, 3]);

const cyclooctatetraene = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C", "C", "C", "C"], [0, 2, 4, 6]);

const cyclohexane = (): Molecule => carbocycle(6);

/** Cyclopenta-1,3-diene: atom 0 is the sp3 CH2 that breaks the ring. */
const cyclopentadiene = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C"], [1, 3]);

const cyclopentadienyl = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C"], [1, 3], { 0: { charge: -1 } });

const cyclopentadienylRadical = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C"], [1, 3], { 0: { radicalElectrons: 1 } });

const tropylium = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C", "C", "C"], [1, 3, 5], { 0: { charge: 1 } });

const cyclopropenylCation = (): Molecule =>
  monocycle(["C", "C", "C"], [1], { 0: { charge: 1 } });

/** Cycloheptatriene: three C=C and one sp3 CH2. Six electrons on a naive
 *  count, and not aromatic — only the sigma guard rejects it. */
const cycloheptatriene = (): Molecule =>
  monocycle(["C", "C", "C", "C", "C", "C", "C"], [1, 3, 5]);

/** Cyclopentadienone: two ring C=C and one exocyclic C=O. */
function cyclopentadienone(): Molecule {
  return buildMolecule((b) => {
    const c: AtomId[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / 5;
      c.push(b.atom("C", fromPolar(angle, 0.85)));
    }
    b.bond(c[0]!, c[1]!, 1);
    b.bond(c[1]!, c[2]!, 2);
    b.bond(c[2]!, c[3]!, 1);
    b.bond(c[3]!, c[4]!, 2);
    b.bond(c[4]!, c[0]!, 1);
    b.bond(c[0]!, b.atom("O", vec(0, -2)), 2);
  });
}

/** 2-Pyridone: the same exocyclic carbonyl as cyclopentadienone, but with an
 *  N-H donating two electrons. The rule must give opposite answers. */
function pyridone(): Molecule {
  return buildMolecule((b) => {
    const n = b.atom("N", vec(0, 0), { explicitHydrogenCount: 1 });
    const c1 = b.atom("C", vec(1, 0));
    const c2 = b.atom("C", vec(1.5, 0.9));
    const c3 = b.atom("C", vec(1, 1.8));
    const c4 = b.atom("C", vec(0, 1.8));
    const c5 = b.atom("C", vec(-0.5, 0.9));
    b.bond(n, c1, 1);
    b.bond(c1, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c4, 1);
    b.bond(c4, c5, 2);
    b.bond(c5, n, 1);
    b.bond(c1, b.atom("O", vec(2, -0.8)), 2);
  });
}

/**
 * Naphthalene, in either of two of its three Kekule structures.
 *
 * "symmetric" makes the shared bond the double one, which is the only form
 * that puts three ring double bonds in EACH ring. "shifted" moves one arm's
 * doubles along by one, leaving the shared bond single — an equally valid
 * structure of the same molecule, and the one the per-ring rule cannot read.
 */
function naphthalene(variant: "symmetric" | "shifted" = "symmetric"): Molecule {
  return buildMolecule((b) => {
    const f1 = b.atom("C", vec(0, 0));
    const f2 = b.atom("C", vec(0, 1));
    const left: AtomId[] = [
      b.atom("C", vec(-0.87, -0.5)),
      b.atom("C", vec(-1.73, 0)),
      b.atom("C", vec(-1.73, 1)),
      b.atom("C", vec(-0.87, 1.5)),
    ];
    const right: AtomId[] = [
      b.atom("C", vec(0.87, -0.5)),
      b.atom("C", vec(1.73, 0)),
      b.atom("C", vec(1.73, 1)),
      b.atom("C", vec(0.87, 1.5)),
    ];
    if (variant === "symmetric") {
      b.bond(f1, f2, 2);
      for (const arm of [left, right]) {
        b.bond(f1, arm[0]!, 1);
        b.bond(arm[0]!, arm[1]!, 2);
        b.bond(arm[1]!, arm[2]!, 1);
        b.bond(arm[2]!, arm[3]!, 2);
        b.bond(arm[3]!, f2, 1);
      }
      return;
    }
    b.bond(f1, f2, 1);
    // The left arm carries both fusion carbons' double bonds; the right arm
    // pairs up internally.
    b.bond(f1, left[0]!, 2);
    b.bond(left[0]!, left[1]!, 1);
    b.bond(left[1]!, left[2]!, 2);
    b.bond(left[2]!, left[3]!, 1);
    b.bond(left[3]!, f2, 2);
    b.bond(f1, right[0]!, 1);
    b.bond(right[0]!, right[1]!, 2);
    b.bond(right[1]!, right[2]!, 1);
    b.bond(right[2]!, right[3]!, 2);
    b.bond(right[3]!, f2, 1);
  });
}

/** Anthracene: three linearly fused six-rings, built as two parallel chains
 *  with a rung at every even index. Bond orders are left at 1 — the test that
 *  uses it goes through the importer path. */
function anthraceneSkeleton(): Molecule {
  return buildMolecule((b) => {
    const span = 7;
    const top: AtomId[] = [];
    const bottom: AtomId[] = [];
    for (let i = 0; i < span; i++) top.push(b.atom("C", vec(i, 1)));
    for (let i = 0; i < span; i++) bottom.push(b.atom("C", vec(i, 0)));
    for (let i = 0; i + 1 < span; i++) b.bond(top[i]!, top[i + 1]!);
    for (let i = 0; i + 1 < span; i++) b.bond(bottom[i]!, bottom[i + 1]!);
    for (let i = 0; i < span; i += 2) b.bond(top[i]!, bottom[i]!);
  });
}

/** Azulene: a 5-ring fused to a 7-ring. Only one perfect matching shape
 *  exists up to symmetry, and it always leaves one ring's double bond
 *  pointing out of the other. */
function azulene(): Molecule {
  return buildMolecule((b) => {
    const f1 = b.atom("C", vec(0, 0));
    const f2 = b.atom("C", vec(0, 1));
    const p: AtomId[] = [
      b.atom("C", vec(-0.95, -0.31)),
      b.atom("C", vec(-1.54, 0.5)),
      b.atom("C", vec(-0.95, 1.31)),
    ];
    const q: AtomId[] = [
      b.atom("C", vec(0.9, -0.43)),
      b.atom("C", vec(1.8, -0.1)),
      b.atom("C", vec(2.1, 0.5)),
      b.atom("C", vec(1.8, 1.1)),
      b.atom("C", vec(0.9, 1.43)),
    ];
    b.bond(f1, f2, 1);
    b.bond(f1, p[0]!, 2);
    b.bond(p[0]!, p[1]!, 1);
    b.bond(p[1]!, p[2]!, 2);
    b.bond(p[2]!, f2, 1);
    b.bond(f1, q[0]!, 1);
    b.bond(q[0]!, q[1]!, 2);
    b.bond(q[1]!, q[2]!, 1);
    b.bond(q[2]!, q[3]!, 2);
    b.bond(q[3]!, q[4]!, 1);
    b.bond(q[4]!, f2, 2);
  });
}

/**
 * Indole in the form a chemist draws it: N1-C2 single, C2=C3, C3-C3a single,
 * then the benzo ring alternating from C3a, and the C3a-C7a fusion bond
 * single. Both fusion carbons therefore spend their double bond in the
 * six-ring, which is what leaves the five-ring counting four on its own.
 */
function indole(): Molecule {
  return buildMolecule((b) => {
    const n1 = b.atom("N", vec(0, 0), { explicitHydrogenCount: 1 });
    const c2 = b.atom("C", vec(1, 0));
    const c3 = b.atom("C", vec(1.5, 0.9));
    const c3a = b.atom("C", vec(0.7, 1.7));
    const c4 = b.atom("C", vec(0.7, 2.7));
    const c5 = b.atom("C", vec(-0.2, 3.2));
    const c6 = b.atom("C", vec(-1.1, 2.7));
    const c7 = b.atom("C", vec(-1.1, 1.7));
    const c7a = b.atom("C", vec(-0.2, 1.2));
    b.bond(n1, c2, 1);
    b.bond(c2, c3, 2);
    b.bond(c3, c3a, 1);
    b.bond(c3a, c4, 2);
    b.bond(c4, c5, 1);
    b.bond(c5, c6, 2);
    b.bond(c6, c7, 1);
    b.bond(c7, c7a, 2);
    b.bond(c7a, n1, 1);
    b.bond(c3a, c7a, 1);
  });
}

/** Decalin: two saturated six-rings sharing one bond. Fused by the same test
 *  naphthalene passes, and aromatic by none of them. */
function decalin(): Molecule {
  return buildMolecule((b) => {
    const top: AtomId[] = [];
    const bottom: AtomId[] = [];
    for (let i = 0; i < 5; i++) top.push(b.atom("C", vec(i, 1)));
    for (let i = 0; i < 5; i++) bottom.push(b.atom("C", vec(i, 0)));
    for (let i = 0; i + 1 < 5; i++) b.bond(top[i]!, top[i + 1]!, 1);
    for (let i = 0; i + 1 < 5; i++) b.bond(bottom[i]!, bottom[i + 1]!, 1);
    for (let i = 0; i < 5; i += 2) b.bond(top[i]!, bottom[i]!, 1);
  });
}

/** Tropone: a seven-ring with three ring C=C and one exocyclic C=O. */
function tropone(): Molecule {
  return buildMolecule((b) => {
    const c: AtomId[] = [];
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / 7;
      c.push(b.atom("C", fromPolar(angle, 1.15)));
    }
    for (let i = 0; i < 7; i++) {
      b.bond(c[i]!, c[(i + 1) % 7]!, i % 2 === 1 ? 2 : 1);
    }
    b.bond(c[0]!, b.atom("O", vec(0, -2.5)), 2);
  });
}

/** Two Kekule benzenes joined by a single C-C bond. */
function biphenyl(): Molecule {
  return buildMolecule((b) => {
    const ring = (dx: number): AtomId[] => {
      const ids: AtomId[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / 6;
        ids.push(b.atom("C", { x: dx + Math.cos(angle), y: Math.sin(angle) }));
      }
      for (let i = 0; i < 6; i++) {
        b.bond(ids[i]!, ids[(i + 1) % 6]!, i % 2 === 1 ? 2 : 1);
      }
      return ids;
    };
    const first = ring(0);
    const second = ring(3);
    b.bond(first[0]!, second[3]!, 1);
  });
}

/** spiro[4.5]decane: a cyclopentane and a cyclohexane sharing one atom. */
function spiroDecane(): Molecule {
  return buildMolecule((b) => {
    const spiro = b.atom("C");
    for (const size of [4, 5]) {
      const arm: AtomId[] = [];
      for (let i = 0; i < size; i++) arm.push(b.atom("C"));
      b.bond(spiro, arm[0]!, 1);
      for (let i = 0; i + 1 < arm.length; i++) b.bond(arm[i]!, arm[i + 1]!, 1);
      b.bond(arm[arm.length - 1]!, spiro, 1);
    }
  });
}

/**
 * Hands the molecule over the way an importer does: every RING bond marked
 * aromatic at order 1, its endpoints flagged. `MoleculeBuilder.bond()` has no
 * aromatic parameter, so this post-processes the built structure the way
 * `builders.benzene()` post-processes `carbocycle`.
 *
 * Ring bonds only, so biphenyl's inter-ring bond stays untouched — which is
 * what splits the aromatic subgraph into two independent components.
 */
function importAromatic(mol: Molecule): Molecule {
  const atoms = { ...mol.atoms };
  const bonds = { ...mol.bonds };
  for (const id of mol.bondIds) {
    if (!R.isRingBond(mol, id)) continue;
    const bond = bonds[id]!;
    bonds[id] = { ...bond, order: 1, aromatic: true };
    atoms[bond.from] = { ...atoms[bond.from]!, aromatic: true };
    atoms[bond.to] = { ...atoms[bond.to]!, aromatic: true };
  }
  return { ...mol, atoms, bonds };
}

// ---------------------------------------------------------------------------
// Reusable assertions
// ---------------------------------------------------------------------------

function ascending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Ring sizes that perceive as aromatic, ascending. */
function aromaticSizes(mol: Molecule): number[] {
  return ascending(A.aromaticRings(mol).map((index) => R.ringSize(mol, index)));
}

function electronCounts(mol: Molecule): number[] {
  return R.rings(mol).map((_, index) => A.piElectronCount(mol, index));
}

/**
 * Every atom's bond orders sum to a whole number.
 *
 * `bondOrderSum` stays raw on purpose — an aromatic-flagged bond counts 1.5
 * there — so a molecule still carrying flags, or one where only half a ring
 * was assigned, leaves half-integers behind. That makes this the assertion
 * that catches a partial assignment. It is NOT a hydrogen-count check any
 * more: `explicitValence` resolves those halves against the valence list, so
 * the formula is right either side of Kekulisation.
 */
function expectIntegralBondOrderSums(mol: Molecule, label: string): void {
  for (const id of mol.atomIds) {
    const sum = bondOrderSum(mol, id);
    expect(Number.isInteger(sum), `${label}: ${id} sums to ${sum}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

describe("perception on Kekule storage form", () => {
  it("perceives benzene, pyridine, pyrrole and furan as aromatic", () => {
    for (const [label, mol] of [
      ["benzene", benzene()],
      ["pyridine", pyridine()],
      ["pyrrole", pyrrole()],
      ["furan", furan()],
    ] as const) {
      expect(R.rings(mol), `${label}: one ring`).toHaveLength(1);
      expect(A.piElectronCount(mol, 0), `${label}: six pi electrons`).toBe(6);
      expect(A.isAromaticRing(mol, 0), `${label} is aromatic`).toBe(true);
      expect(A.aromaticRings(mol)).toEqual([0]);
      for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(true);
      for (const id of mol.bondIds) expect(A.isAromaticBond(mol, id)).toBe(true);
      // Perception reads bond orders, never flags: the storage form has none.
      expect(A.hasAromaticFlags(mol), `${label} carries no flags`).toBe(false);
    }
  });

  it("does not perceive cyclooctatetraene as aromatic", () => {
    const mol = cyclooctatetraene();
    expect(R.rings(mol)).toHaveLength(1);
    // Eight electrons pass a `count >= 6 && count % 2 === 0` test, and every
    // bond alternates, so only `count % 4 === 2` rejects this. Planarity is
    // not modelled, so nothing else can.
    expect(A.piElectronCount(mol, 0)).toBe(8);
    expect(A.isAromaticRing(mol, 0)).toBe(false);
    expect(A.aromaticRings(mol)).toEqual([]);
  });

  it("does not perceive cyclohexane as aromatic", () => {
    const mol = cyclohexane();
    expect(R.rings(mol)).toHaveLength(1);
    // -1, not 0: every CH2 is sp3 and cannot take part at all.
    expect(A.piElectronCount(mol, 0)).toBe(-1);
    expect(A.isAromaticRing(mol, 0)).toBe(false);
    for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(false);
    for (const id of mol.bondIds) expect(A.isAromaticBond(mol, id)).toBe(false);
  });

  it("finds nothing aromatic in an acyclic chain", () => {
    const mol = linearChain(8);
    expect(A.aromaticRings(mol)).toEqual([]);
    for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(false);
    for (const id of mol.bondIds) expect(A.isAromaticBond(mol, id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The contribution table, case by case
// ---------------------------------------------------------------------------

describe("pi-electron contributions", () => {
  it("distinguishes pyridine's nitrogen from pyrrole's", () => {
    // Both nitrogens see a bond-order sum of 3, so valence alone cannot tell
    // them apart — which is why pyrrole's N-H is pinned. Pyridine's N has a
    // ring C=N and gives 1, its lone pair staying in the sp2 plane; pyrrole's
    // has no ring double bond and donates the pair, giving 2. Treating every
    // neutral N as a donor would give pyridine 7, an odd count that reads as
    // an arithmetic bug when it is a table bug.
    expect(A.piElectronCount(pyridine(), 0)).toBe(6);
    expect(A.piElectronCount(pyrrole(), 0)).toBe(6);

    // In the Kekule storage form the ring double bond tells the two apart on
    // its own. It is the IMPORTED form that cannot: an aromatic bond counts
    // 1.5, so both nitrogens see a sum of 3 there, and only the pinned N-H
    // stops pyrrole's from being read as pyridine's. That is the case
    // `explicitHydrogenCount` exists for, and the one `kekulize` depends on.
    expect(bondOrderSum(pyridine(), "a1")).toBe(3);
    expect(bondOrderSum(pyrrole(), "a1")).toBe(2);
    expect(bondOrderSum(importAromatic(pyridine()), "a1")).toBe(3);
    expect(bondOrderSum(importAromatic(pyrroleWithoutNH()), "a1")).toBe(3);
  });

  it("perceives thiophene, where sulfur donates a lone pair", () => {
    const mol = thiophene();
    expect(A.piElectronCount(mol, 0)).toBe(6);
    expect(A.isAromaticRing(mol, 0)).toBe(true);
  });

  it("perceives the cyclopentadienyl anion but not the neutral diene", () => {
    const anion = cyclopentadienyl();
    expect(A.piElectronCount(anion, 0)).toBe(6);
    expect(A.isAromaticRing(anion, 0)).toBe(true);

    // Cyclopentadiene's sp3 CH2 has two bonds and two hydrogens, so the sigma
    // guard rejects it before any electron is counted.
    const diene = cyclopentadiene();
    expect(A.piElectronCount(diene, 0)).toBe(-1);
    expect(A.isAromaticRing(diene, 0)).toBe(false);
  });

  it("counts five for the cyclopentadienyl radical, so it is not aromatic", () => {
    const mol = cyclopentadienylRadical();
    expect(A.piElectronCount(mol, 0)).toBe(5);
    expect(A.isAromaticRing(mol, 0)).toBe(false);
  });

  it("perceives tropylium and the cyclopropenyl cation", () => {
    // Six electrons in a seven-ring (n = 1) and two in a three-ring (n = 0).
    // Both would fail a `count >= 6` floor or a ring-size cap.
    const seven = tropylium();
    expect(A.piElectronCount(seven, 0)).toBe(6);
    expect(A.isAromaticRing(seven, 0)).toBe(true);

    const three = cyclopropenylCation();
    expect(A.piElectronCount(three, 0)).toBe(2);
    expect(A.isAromaticRing(three, 0)).toBe(true);
  });

  it("rejects cycloheptatriene despite its three ring double bonds", () => {
    // The sp3 CH2 is the only difference from tropylium, and the sigma guard
    // is the only thing that catches it — a bare count would say six.
    const mol = cycloheptatriene();
    expect(A.piElectronCount(mol, 0)).toBe(-1);
    expect(A.isAromaticRing(mol, 0)).toBe(false);
  });

  it("gives opposite answers for cyclopentadienone and 2-pyridone", () => {
    // The same exocyclic carbonyl in both: its carbon's p orbital is spent on
    // the C=O, so it contributes 0. Cyclopentadienone is left with 4 and is
    // not aromatic; 2-pyridone's N-H donates 2 for a total of 6 and is. That
    // the one rule produces both is what proves it is about the p orbital and
    // not about "ignore atoms next to a heteroatom".
    const ketone = cyclopentadienone();
    expect(R.rings(ketone)).toHaveLength(1);
    expect(A.piElectronCount(ketone, 0)).toBe(4);
    expect(A.isAromaticRing(ketone, 0)).toBe(false);

    const amide = pyridone();
    expect(R.rings(amide)).toHaveLength(1);
    expect(A.piElectronCount(amide, 0)).toBe(6);
    expect(A.isAromaticRing(amide, 0)).toBe(true);
  });

  it("rejects a ring of donors with no pi bond anywhere in it", () => {
    // The sigma guard is not enough on its own. Every atom of cyclotriazane is
    // a two-coordinate N-H: sigma is 3, so it clears the guard, and each one
    // donates a lone pair for a total of six — 4n+2, on a molecule containing
    // no double bond at all. Six electrons in three p orbitals is a closed
    // shell with nothing left to delocalise, which is what the
    // `count >= 2 * size` guard says. Carbocycles never reached this only
    // because an sp3 CH2 has sigma 4.
    for (const [label, elements] of [
      ["cyclotriazane N3H3", ["N", "N", "N"]],
      ["ozone-like O3 ring", ["O", "O", "O"]],
      ["cyclo-S5", ["S", "S", "S", "S", "S"]],
      ["pentazolidine N5H5", ["N", "N", "N", "N", "N"]],
      ["cyclo-S7", ["S", "S", "S", "S", "S", "S", "S"]],
    ] as const) {
      const mol = monocycle(elements);
      const count = A.piElectronCount(mol, 0);
      // The count itself is 4n+2 — that is exactly why the modulo alone lets
      // these through — and it fills every orbital the ring has.
      expect(count % 4, `${label} counts 4n+2`).toBe(2);
      expect(count, `${label} fills its manifold`).toBe(2 * elements.length);
      expect(A.isAromaticRing(mol, 0), `${label} is not aromatic`).toBe(false);
    }
  });

  it("still perceives borazine, where the same guard must not fire", () => {
    // The other side of the closed-shell guard, and the reason it is written
    // against the orbital count rather than "must contain a double bond".
    // Borazine has no ring pi bond either: its three nitrogens donate a lone
    // pair each and its three borons take them into empty p orbitals. Six
    // electrons across SIX orbitals is benzene's own configuration.
    const mol = monocycle(["B", "N", "B", "N", "B", "N"]);
    expect(A.piElectronCount(mol, 0)).toBe(6);
    expect(A.isAromaticRing(mol, 0)).toBe(true);
  });

  it("perceives tropone, which the exocyclic rule does not decline", () => {
    // Pins what the exocyclic branch actually does. Zeroing the carbonyl
    // carbon leaves six electrons on the other six carbons of the seven-ring,
    // so tropone IS aromatic here — as it is in RDKit's default model. Only
    // the five-membered case, cyclopentadienone, falls below 4n+2.
    const mol = tropone();
    expect(R.rings(mol)).toHaveLength(1);
    expect(R.ringSize(mol, 0)).toBe(7);
    expect(A.piElectronCount(mol, 0)).toBe(6);
    expect(A.isAromaticRing(mol, 0)).toBe(true);
  });

  it("rejects a spiro junction, whose carbon has four sigma bonds", () => {
    const mol = spiroDecane();
    expect(R.rings(mol)).toHaveLength(2);
    expect(electronCounts(mol)).toEqual([-1, -1]);
    expect(A.aromaticRings(mol)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fused and multi-ring systems
// ---------------------------------------------------------------------------

describe("fused systems", () => {
  it("perceives both rings of naphthalene", () => {
    const mol = naphthalene();
    expect(R.rings(mol)).toHaveLength(2);
    expect(electronCounts(mol)).toEqual([6, 6]);
    expect(A.aromaticRings(mol)).toEqual([0, 1]);
    for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(true);
    for (const id of mol.bondIds) expect(A.isAromaticBond(mol, id)).toBe(true);
  });

  it("gives naphthalene the same answer whichever Kekule structure is drawn", () => {
    // THE POINT OF THE FUSED PASS. Naphthalene has three Kekule structures;
    // only the symmetric one puts three ring double bonds in each ring. Move
    // one double bond off the shared edge and the second ring is left with two
    // ring doubles and two carbons whose pi bond points into the other ring,
    // so ON ITS OWN it counts 4. A per-ring rule would call that ring
    // aliphatic — and would therefore give two different answers for one
    // molecule depending on which arrangement of lines happened to be saved.
    //
    // The union of the two rings counts ten either way, so both rings are
    // aromatic in both drawings. The per-ring numbers still differ, and that
    // is what `ringPiElectrons` reports; `ringIsAromatic` is the answer.
    const symmetric = naphthalene("symmetric");
    const shifted = naphthalene("shifted");
    expect(elementCounts(shifted)).toEqual(elementCounts(symmetric));

    expect(ascending(electronCounts(symmetric))).toEqual([6, 6]);
    expect(ascending(electronCounts(shifted))).toEqual([4, 6]);

    expect(A.aromaticRings(shifted)).toEqual(A.aromaticRings(symmetric));
    expect(A.aromaticRings(shifted)).toEqual([0, 1]);
    for (const id of shifted.atomIds) expect(A.isAromaticAtom(shifted, id)).toBe(true);
    for (const id of shifted.bondIds) expect(A.isAromaticBond(shifted, id)).toBe(true);
  });

  it("perceives all three of anthracene's rings after import", () => {
    // Anthracene has four Kekule structures and NONE of them puts three ring
    // double bonds in all three rings; each outer ring always has one carbon
    // whose double bond points into the ring next door, so the per-ring counts
    // read 4, 4, 6 for a molecule that is aromatic throughout. The union of all
    // three counts fourteen — 4n+2 with n = 3 — so every ring is aromatic and
    // this ordinary importer path stops under-reporting.
    const imported = importAromatic(anthraceneSkeleton());
    const mol = A.kekulize(imported);
    expect(A.hasAromaticFlags(mol)).toBe(false);
    expectIntegralBondOrderSums(mol, "kekulized anthracene");
    expect(elementCounts(mol)).toEqual(elementCounts(imported));
    expect(elementCounts(mol)).toEqual({ C: 14, H: 10 });

    expect(R.rings(mol)).toHaveLength(3);
    expect(ascending(electronCounts(mol))).toEqual([4, 4, 6]);
    expect(A.aromaticRings(mol)).toEqual([0, 1, 2]);
    for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(true);
  });

  it("perceives both of azulene's rings over its ten-electron perimeter", () => {
    // Azulene is genuinely aromatic — ten pi electrons around the perimeter —
    // but no Kekule structure of it puts an even number of ring double bonds
    // in both rings at once, so no per-ring count can ever see more than one
    // of them. The union of the five- and seven-ring counts ten and both come
    // out aromatic, which is the right answer and the one RDKit gives.
    const mol = azulene();
    expect(ascending(R.rings(mol).map((ring) => ring.size))).toEqual([5, 7]);
    expect(ascending(electronCounts(mol))).toEqual([4, 6]);
    expect(aromaticSizes(mol)).toEqual([5, 7]);
    for (const id of mol.atomIds) expect(A.isAromaticAtom(mol, id)).toBe(true);
  });

  it("perceives all nine atoms of indole, in the conventional Kekule form", () => {
    // The common fused heteroaromatic, and the case a per-ring rule gets
    // visibly wrong: both fusion carbons put their double bond in the
    // six-ring, so the five-ring counts 4 on its own. RDKit marks all nine
    // atoms aromatic, and RDKit is the import/export oracle — reading C3a and
    // C7a as aliphatic writes `C` where RDKit writes `c`.
    const mol = indole();
    expect(R.rings(mol).map((ring) => ring.size)).toEqual([5, 6]);
    expect(electronCounts(mol)).toEqual([4, 6]);
    expect(A.aromaticRings(mol)).toEqual([0, 1]);
    expect(mol.atomIds.filter((id) => A.isAromaticAtom(mol, id))).toHaveLength(9);
    // Including the fusion bond, which belongs to both rings.
    for (const id of mol.bondIds) expect(A.isAromaticBond(mol, id)).toBe(true);
  });

  it("gives indole the same answer through the importer", () => {
    // The sharpest form of the Kekule-dependence complaint: `kekulize` is free
    // to pick the structure with the fusion bond double, which reads 6/6 per
    // ring, where the conventional drawing reads 4/6. One molecule must not
    // have two aromaticities.
    const viaImport = A.kekulize(importAromatic(indole()));
    expect(A.aromaticRings(viaImport)).toEqual(A.aromaticRings(indole()));
    expect(A.aromaticRings(viaImport)).toEqual([0, 1]);
    expect(elementCounts(viaImport)).toEqual({ C: 8, H: 7, N: 1 });
  });

  it("does not let the fused pass rescue a saturated polycyclic", () => {
    // The guard on the relaxation. Decalin's two rings share a bond, so they
    // are a fused system by the same test naphthalene passes — but every
    // carbon is sp3, every ring counts -1, and no union of them can count
    // anything else. A fused pass that summed contributions without the
    // "cannot participate" veto would start reporting alkanes as aromatic.
    const mol = decalin();
    expect(R.rings(mol)).toHaveLength(2);
    expect(electronCounts(mol)).toEqual([-1, -1]);
    expect(A.aromaticRings(mol)).toEqual([]);
  });

  it("does not make biphenyl's inter-ring bond aromatic", () => {
    // The trap: "both endpoints are aromatic atoms" is true of this bond and
    // wrong. It lies on no ring at all.
    const mol = biphenyl();
    expect(R.rings(mol)).toHaveLength(2);
    expect(A.aromaticRings(mol)).toEqual([0, 1]);

    const linker = mol.bondIds.filter((id) => !R.isRingBond(mol, id));
    expect(linker).toHaveLength(1);
    const bond = M.requireBond(mol, linker[0]!);
    expect(A.isAromaticAtom(mol, bond.from)).toBe(true);
    expect(A.isAromaticAtom(mol, bond.to)).toBe(true);
    expect(A.isAromaticBond(mol, bond.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kekulisation
// ---------------------------------------------------------------------------

describe("kekulize", () => {
  it("returns the same molecule when there is nothing to convert", () => {
    const mol = benzene();
    expect(A.hasAromaticFlags(mol)).toBe(false);
    expect(A.kekulize(mol)).toBe(mol);
  });

  it("converts an imported aromatic benzene to alternating orders", () => {
    const imported = importAromatic(benzene());
    expect(A.hasAromaticFlags(imported)).toBe(true);

    const kekulized = A.kekulize(imported);
    expect(A.hasAromaticFlags(kekulized)).toBe(false);
    expect(
      M.bonds(kekulized).map((bond) => bond.order).sort(),
    ).toEqual([1, 1, 1, 2, 2, 2]);
    expectIntegralBondOrderSums(kekulized, "kekulized benzene");
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 6, H: 6 });
    // Alternating: every carbon ends up with exactly one double bond.
    for (const id of kekulized.atomIds) {
      const doubles = M.bondsAt(kekulized, id).filter((b) => b.order === 2);
      expect(doubles).toHaveLength(1);
    }
    expect(A.aromaticRings(kekulized)).toEqual([0]);
  });

  it("converts an imported aromatic pyrrole with its N-H pinned", () => {
    const imported = importAromatic(pyrrole());
    const result = A.kekulizeWithReport(imported);
    expect(result.unkekulizedAtomIds).toEqual([]);

    const kekulized = result.molecule;
    expect(A.hasAromaticFlags(kekulized)).toBe(false);
    expectIntegralBondOrderSums(kekulized, "kekulized pyrrole");
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 4, H: 5, N: 1 });
    // Two ring double bonds and three singles — the nitrogen takes neither,
    // because it donates its lone pair instead.
    expect(
      M.bonds(kekulized).map((bond) => bond.order).sort(),
    ).toEqual([1, 1, 1, 2, 2]);
    const nitrogen = M.requireAtom(kekulized, "a1");
    expect(M.bondsAt(kekulized, nitrogen.id).every((b) => b.order === 1)).toBe(true);
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("leaves furan's oxygen out of the matching", () => {
    // The heteroatom case for `needsRingDouble`: oxygen's max valence of 2 is
    // already met by its two sigma bonds, so it takes no double bond and the
    // four carbons pair up among themselves.
    const imported = importAromatic(furan());
    const kekulized = A.kekulize(imported);
    expectIntegralBondOrderSums(kekulized, "kekulized furan");
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 4, H: 4, O: 1 });
    expect(M.bondsAt(kekulized, "a1").every((b) => b.order === 1)).toBe(true);
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("preserves thiophene's formula across Kekulisation", () => {
    // This fixture used to be the documented exception: sulfur sees
    // 1.5 + 1.5 = 3 on the flagged form, which falls between S's valences of 2
    // and 4, and `implicitHydrogenCount` used to pick the 4 and invent a fifth
    // hydrogen — so an imported thiophene read C4H5S and only became C4H4S
    // after kekulize. valence.ts now resolves that half-integer the way RDKit
    // does, snapping the sum down to sulfur's 2, so the flagged and Kekule
    // readings agree and elementCounts() is a real invariance check here.
    const imported = importAromatic(thiophene());
    expect(elementCounts(imported)).toEqual({ C: 4, H: 4, S: 1 });
    const kekulized = A.kekulize(imported);
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 4, H: 4, S: 1 });
    expectIntegralBondOrderSums(kekulized, "kekulized thiophene");
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("Kekulises an imported tropylium, Cp anion and cyclopropenyl cation", () => {
    // The charged-centre ambiguity, and the case that made all three of these
    // ions fail through the plain importer path while working perfectly in the
    // Kekule storage form. On the flagged molecule tropylium's C+ sums to
    // 1.5 + 1.5 = 3, which already meets the 3 its charge-adjusted valence
    // allows, so `implicitHydrogenCount` reports no hydrogen and the centre is
    // told it needs a ring double bond. All seven carbons then "need" one, the
    // odd-parity prune fires, and the whole ring was returned unconverted with
    // its flags intact — after which perception read the still-flagged
    // molecule and reported NOT aromatic.
    //
    // Both readings are valence-consistent ([c+] with a double bond, or [cH+]
    // with a hydrogen), and a molfile carries no hydrogen-count field to
    // settle it. It is settled by outcome: the strict reading admits no Kekule
    // structure at all, so the relaxed one wins.
    for (const [label, mol, formula] of [
      ["tropylium", tropylium(), { C: 7, H: 7 }],
      ["cyclopentadienide", cyclopentadienyl(), { C: 5, H: 5 }],
      ["cyclopropenyl cation", cyclopropenylCation(), { C: 3, H: 3 }],
    ] as const) {
      const imported = importAromatic(mol);
      const result = A.kekulizeWithReport(imported);
      expect(result.unkekulizedAtomIds, `${label} Kekulises`).toEqual([]);

      const kekulized = result.molecule;
      expect(A.hasAromaticFlags(kekulized), `${label}: flags cleared`).toBe(false);
      expectIntegralBondOrderSums(kekulized, `kekulized ${label}`);
      // The formula matches the Kekule storage form, which is the correct one.
      // It does NOT match the flagged input: an aromatic bond weighing 1.5
      // saturates the charged carbon's valence and loses its hydrogen, the
      // same representation defect kekulize fixes for thiophene.
      expect(elementCounts(kekulized), `${label}: formula`).toEqual(formula);
      expect(elementCounts(kekulized)).toEqual(elementCounts(mol));
      expect(A.isAromaticRing(kekulized, 0), `${label} is aromatic`).toBe(true);
      expect(A.piElectronCount(kekulized, 0)).toBe(
        A.piElectronCount(mol, 0),
      );
    }
  });

  it("does not relax a charged centre that genuinely needs a double bond", () => {
    // The guard on that relaxation. Pyrylium's O+ also sums to exactly its
    // charge-adjusted maximum, so it looks equally ambiguous — but its five
    // carbons cannot pair among themselves, the strict reading DOES admit a
    // Kekule structure with an O+=C, and the relaxation must never be reached.
    const imported = importAromatic(
      monocycle(["O", "C", "C", "C", "C", "C"], [0, 2, 4], { 0: { charge: 1 } }),
    );
    const kekulized = A.kekulize(imported);
    expect(A.hasAromaticFlags(kekulized)).toBe(false);
    expectIntegralBondOrderSums(kekulized, "kekulized pyrylium");
    expect(elementCounts(kekulized)).toEqual({ C: 5, H: 5, O: 1 });
    // The oxygen took the double bond rather than being excused from one.
    expect(M.bondsAt(kekulized, "a1").some((b) => b.order === 2)).toBe(true);
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("Kekulises thiopyrylium, where sulfur's LOWER valence is the operative one", () => {
    // Pyrylium with S+ where the O+ is, and the case that showed reading
    // `maxValence` was wrong for a multi-valence heteroatom. Sulfur allows 2, 4
    // and 6, so its charge-adjusted maximum is 7; measured against that, a
    // two-connected sulfur has five units of room rather than the one that says
    // "take a double bond", and the sulfur was left out of the matching
    // entirely. The five carbons left over could not pair among themselves, the
    // odd-parity prune fired, and the whole ring came back unconverted — while
    // pyrylium, whose oxygen has only one valence to read, was fine.
    const imported = importAromatic(
      monocycle(["S", "C", "C", "C", "C", "C"], [0, 2, 4], { 0: { charge: 1 } }),
    );
    const result = A.kekulizeWithReport(imported);
    expect(result.unkekulizedAtomIds).toEqual([]);

    const kekulized = result.molecule;
    expect(A.hasAromaticFlags(kekulized)).toBe(false);
    expectIntegralBondOrderSums(kekulized, "kekulized thiopyrylium");
    expect(elementCounts(kekulized)).toEqual({ C: 5, H: 5, S: 1 });
    // The sulfur took the S+=C double bond, exactly as pyrylium's oxygen does.
    expect(M.bondsAt(kekulized, "a1").some((b) => b.order === 2)).toBe(true);
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("still leaves neutral thiophene's sulfur out of the matching", () => {
    // The other half of the same rule, and the reason it is stated as "the
    // smallest valence at or above the sigma framework" rather than "the
    // smallest one above it". Thiophene's neutral sulfur has a framework of 2
    // which IS a sulfur valence, so it has no room, needs no double bond and
    // donates its lone pair instead. Charging it is the only difference between
    // this and thiopyrylium.
    const imported = importAromatic(thiophene());
    const kekulized = A.kekulize(imported);
    expect(M.bondsAt(kekulized, "a1").every((b) => b.order === 1)).toBe(true);
    expect(elementCounts(kekulized)).toEqual({ C: 4, H: 4, S: 1 });
  });

  it("still reports a failure when nothing charged explains it", () => {
    // Un-pinned pyrrole again, from the other direction: its nitrogen is
    // neutral, so the charged-centre relaxation finds nothing to relax and the
    // documented failure behaviour is unchanged. The retry must not become a
    // general "try again without some atoms" escape hatch.
    const imported = importAromatic(pyrroleWithoutNH());
    const result = A.kekulizeWithReport(imported);
    expect(result.unkekulizedAtomIds).toHaveLength(5);
    expect(result.molecule).toBe(imported);
  });

  it("preserves selenophene's formula too, on a second element", () => {
    // Thiophene's case on a second element, so the rule reads as "any
    // multi-valence heteroatom" rather than a sulfur quirk: selenium's
    // valences are also 2, 4, 6 and the flagged ring also sums to 3.
    const imported = importAromatic(monocycle(["Se", "C", "C", "C", "C"], [1, 3]));
    expect(elementCounts(imported)).toEqual({ C: 4, H: 4, Se: 1 });
    const kekulized = A.kekulize(imported);
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 4, H: 4, Se: 1 });
    expectIntegralBondOrderSums(kekulized, "kekulized selenophene");
    expect(A.isAromaticRing(kekulized, 0)).toBe(true);
  });

  it("backtracks rather than stranding a naphthalene fusion carbon", () => {
    // Greedy pairing can pick a first double bond that leaves a degree-3
    // fusion carbon with both eligible neighbours already matched.
    const imported = importAromatic(naphthalene());
    const kekulized = A.kekulize(imported);
    expect(A.hasAromaticFlags(kekulized)).toBe(false);
    expectIntegralBondOrderSums(kekulized, "kekulized naphthalene");
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(elementCounts(kekulized)).toEqual({ C: 10, H: 8 });
    for (const id of kekulized.atomIds) {
      const doubles = M.bondsAt(kekulized, id).filter((b) => b.order === 2);
      expect(doubles, `${id} takes exactly one double bond`).toHaveLength(1);
    }
  });

  it("splits biphenyl's aromatic subgraph across the unflagged linker", () => {
    const imported = importAromatic(biphenyl());
    const kekulized = A.kekulize(imported);
    expectIntegralBondOrderSums(kekulized, "kekulized biphenyl");
    expect(elementCounts(kekulized)).toEqual(elementCounts(imported));
    expect(A.aromaticRings(kekulized)).toEqual([0, 1]);
    const linker = kekulized.bondIds.filter((id) => !R.isRingBond(kekulized, id));
    expect(M.requireBond(kekulized, linker[0]!).order).toBe(1);
  });

  it("leaves an un-Kekulisable ring exactly as it arrived", () => {
    // Pyrrole without the pinned N-H: valence derives zero hydrogens on the
    // nitrogen, so it looks like it needs a ring double bond too, and five
    // atoms needing one admits no perfect matching.
    const imported = importAromatic(pyrroleWithoutNH());
    const result = A.kekulizeWithReport(imported);

    expect([...result.unkekulizedAtomIds].sort()).toEqual(
      [...imported.atomIds].sort(),
    );
    // Byte-for-byte: not a partial assignment, which would change the formula.
    expect(result.molecule).toBe(imported);
    expect(A.hasAromaticFlags(result.molecule)).toBe(true);
    expect(elementCounts(result.molecule)).toEqual(elementCounts(imported));
  });

  it("Kekulises the sound half of a molecule with one bad ring", () => {
    // A good benzene and an un-Kekulisable pyrrole in one structure. Matching
    // each aromatic component independently is what keeps an importer from
    // losing the whole file over one ambiguous ring.
    const mixed = importAromatic(
      buildMolecule((b) => {
        const ring: AtomId[] = [];
        for (let i = 0; i < 6; i++) ring.push(b.atom("C", vec(i, 0)));
        for (let i = 0; i < 6; i++) {
          b.bond(ring[i]!, ring[(i + 1) % 6]!, i % 2 === 1 ? 2 : 1);
        }
        const five: AtomId[] = [b.atom("N", vec(0, 5))];
        for (let i = 1; i < 5; i++) five.push(b.atom("C", vec(i, 5)));
        for (let i = 0; i < 5; i++) {
          b.bond(five[i]!, five[(i + 1) % 5]!, i === 1 || i === 3 ? 2 : 1);
        }
      }),
    );
    const result = A.kekulizeWithReport(mixed);
    expect(result.unkekulizedAtomIds).toHaveLength(5);

    const carbonRing = result.molecule.atomIds.slice(0, 6);
    for (const id of carbonRing) {
      expect(M.requireAtom(result.molecule, id).aromatic).toBe(false);
      expect(M.bondsAt(result.molecule, id).some((b) => b.order === 2)).toBe(true);
    }
    for (const id of result.unkekulizedAtomIds) {
      expect(M.requireAtom(result.molecule, id).aromatic).toBe(true);
    }
  });

  it("reuses the ring perception across kekulization", () => {
    // The ring fingerprint excludes bond orders and aromatic flags, so the
    // kekulized molecule hits the same cache entry. That is what makes ring
    // INDICES line up between the two, which `aromaticPerception` relies on
    // when it perceives on the kekulized form but reports against `mol`.
    const imported = importAromatic(carbocycle(10));
    const kekulized = A.kekulize(imported);
    expect(kekulized).not.toBe(imported);
    expect(R.rings(kekulized)).toBe(R.rings(imported));
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe("caching", () => {
  it("recomputes nothing when only a position changes", () => {
    // A topology no other test in this file warms, so the counter starts from
    // a known state. Dragging an atom produces a fresh Molecule per frame in
    // which only `pos` changed; an instance-keyed cache alone would miss on
    // every single one of them.
    // [12]annulene: twelve electrons, so 12 % 4 === 0 and it is not aromatic.
    const mol = monocycle(new Array<string>(12).fill("C"), [0, 2, 4, 6, 8, 10]);
    A.resetAromaticPerceptionComputationCount();
    expect(A.aromaticRings(mol)).toEqual([]);
    expect(A.aromaticPerceptionComputationCount()).toBe(1);

    const moved: Molecule = {
      ...mol,
      atoms: {
        ...mol.atoms,
        a1: { ...M.requireAtom(mol, "a1"), pos: vec(99, 99) },
      },
    };
    expect(moved).not.toBe(mol);
    expect(A.aromaticRings(moved)).toEqual([]);
    expect(A.aromaticPerceptionComputationCount()).toBe(1);
  });

  it("does recompute when a bond order changes", () => {
    // The trap this guards: bond orders are deliberately absent from the RING
    // fingerprint, so reusing that key for aromaticity would return a stale
    // answer here with no visible error.
    const kekule = monocycle(new Array<string>(9).fill("C"), [0, 2, 4]);
    A.resetAromaticPerceptionComputationCount();
    A.aromaticRings(kekule);
    expect(A.aromaticPerceptionComputationCount()).toBe(1);

    const saturated: Molecule = {
      ...kekule,
      bonds: { ...kekule.bonds, b10: { ...M.requireBond(kekule, "b10"), order: 1 } },
    };
    A.aromaticRings(saturated);
    expect(A.aromaticPerceptionComputationCount()).toBe(2);
    // And the ring perception is shared, since the topology never changed.
    expect(R.rings(saturated)).toBe(R.rings(kekule));
  });

  it("does recompute when a charge changes", () => {
    // A 13-ring with an sp3 CH2 at atom 0. Deprotonating it turns twelve ring
    // electrons plus a donated lone pair into fourteen — 4n+2 with n = 3.
    const neutral = monocycle(new Array<string>(13).fill("C"), [1, 3, 5, 7, 9, 11]);
    A.resetAromaticPerceptionComputationCount();
    expect(A.aromaticRings(neutral)).toEqual([]);
    expect(A.aromaticPerceptionComputationCount()).toBe(1);

    const anion: Molecule = {
      ...neutral,
      atoms: { ...neutral.atoms, a1: { ...M.requireAtom(neutral, "a1"), charge: -1 } },
    };
    expect(A.piElectronCount(anion, 0)).toBe(14);
    expect(A.aromaticRings(anion)).toEqual([0]);
    expect(A.aromaticPerceptionComputationCount()).toBe(2);
  });

  it("shares one computation across every query on the same molecule", () => {
    const mol = monocycle(new Array<string>(10).fill("C"), [0, 2, 4, 6]);
    A.resetAromaticPerceptionComputationCount();
    A.aromaticRings(mol);
    A.isAromaticRing(mol, 0);
    A.piElectronCount(mol, 0);
    A.isAromaticAtom(mol, "a1");
    A.isAromaticBond(mol, mol.bondIds[0]!);
    expect(A.aromaticPerceptionComputationCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Contract edges
// ---------------------------------------------------------------------------

describe("contract", () => {
  it("throws on an out-of-range ring index", () => {
    const mol = benzene();
    expect(() => A.isAromaticRing(mol, 1)).toThrow(/No such ring/);
    expect(() => A.piElectronCount(mol, -1)).toThrow(/No such ring/);
  });

  it("throws on an unknown atom or bond id", () => {
    const mol = benzene();
    expect(() => A.isAromaticAtom(mol, "nope")).toThrow(/No such atom/);
    expect(() => A.isAromaticBond(mol, "nope")).toThrow(/No such bond/);
  });

  it("never mutates the molecule it is given", () => {
    const imported = importAromatic(benzene());
    const before = JSON.stringify(imported);
    A.aromaticPerception(imported);
    A.kekulize(imported);
    expect(JSON.stringify(imported)).toBe(before);
  });

  it("freezes every field of the cached result, not just the wrapper", () => {
    // The membership lists used to be Sets, and `Object.freeze` does not stop
    // `Set.prototype.add` — so the two fields the freeze existed to protect
    // were the two it did not protect, and one caller could poison the shared
    // cache entry for every later caller with an atom id that is not even in
    // the molecule.
    const perception = A.aromaticPerception(benzene());
    expect(Object.isFrozen(perception)).toBe(true);
    expect(Object.isFrozen(perception.ringIsAromatic)).toBe(true);
    expect(Object.isFrozen(perception.ringPiElectrons)).toBe(true);
    expect(Object.isFrozen(perception.aromaticAtomIds)).toBe(true);
    expect(Object.isFrozen(perception.aromaticBondIds)).toBe(true);

    const mol = benzene();
    expect([...A.aromaticPerception(mol).aromaticAtomIds].sort()).toEqual(
      [...mol.atomIds].sort(),
    );
    expect(A.isAromaticAtom(mol, "a1")).toBe(true);
  });
});
