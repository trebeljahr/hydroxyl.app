import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, carbocycle, linearChain } from "./builders.js";
import * as M from "./molecule.js";
import * as R from "./rings.js";
import type { AtomId, Molecule } from "./types.js";
import { vec } from "./vec.js";

// ---------------------------------------------------------------------------
// Fixtures
//
// Local to this file on purpose: tsconfig includes `src` and excludes only
// `src/**/*.test.ts`, so a shared `ring-fixtures.ts` would be compiled into
// dist as dead shipped code.
// ---------------------------------------------------------------------------

/**
 * A linearly fused acene — naphthalene at 2, anthracene at 3, tetracene at 4.
 * Two parallel chains of 2n+1 carbons with a rung at every even index, which
 * is exactly how the rings share one bond each.
 */
function linearAcene(ringCount: number): Molecule {
  return buildMolecule((b) => {
    const span = 2 * ringCount + 1;
    const top: AtomId[] = [];
    const bottom: AtomId[] = [];
    for (let i = 0; i < span; i++) top.push(b.atom("C", vec(i, 1)));
    for (let i = 0; i < span; i++) bottom.push(b.atom("C", vec(i, 0)));
    for (let i = 0; i + 1 < span; i++) b.bond(top[i]!, top[i + 1]!);
    for (let i = 0; i + 1 < span; i++) b.bond(bottom[i]!, bottom[i + 1]!);
    for (let i = 0; i < span; i += 2) b.bond(top[i]!, bottom[i]!);
  });
}

function naphthalene(): Molecule {
  return linearAcene(2);
}

/**
 * The same naphthalene, with identical atoms but the bonds added in a
 * different order — rungs first, then each chain backwards.
 *
 * Exists so a determinism test can compare two molecules that MISS each
 * other's topology cache. `linearAcene(2)` built twice produces the identical
 * fingerprint and the second call is a cache hit, which makes any comparison
 * between them vacuous.
 */
function naphthaleneRungsFirst(): Molecule {
  return buildMolecule((b) => {
    const span = 5;
    const top: AtomId[] = [];
    const bottom: AtomId[] = [];
    for (let i = 0; i < span; i++) top.push(b.atom("C", vec(i, 1)));
    for (let i = 0; i < span; i++) bottom.push(b.atom("C", vec(i, 0)));
    for (let i = span - 1; i >= 0; i -= 2) b.bond(bottom[i]!, top[i]!);
    for (let i = span - 2; i >= 0; i--) b.bond(bottom[i + 1]!, bottom[i]!);
    for (let i = span - 2; i >= 0; i--) b.bond(top[i + 1]!, top[i]!);
  });
}

/** spiro[4.5]decane: a cyclopentane and a cyclohexane sharing ONE atom. */
function spiroDecane(): Molecule {
  return buildMolecule((b) => {
    const spiro = b.atom("C");
    const five: AtomId[] = [];
    const six: AtomId[] = [];
    for (let i = 0; i < 4; i++) five.push(b.atom("C"));
    for (let i = 0; i < 5; i++) six.push(b.atom("C"));
    for (const arm of [five, six]) {
      b.bond(spiro, arm[0]!);
      for (let i = 0; i + 1 < arm.length; i++) b.bond(arm[i]!, arm[i + 1]!);
      b.bond(arm[arm.length - 1]!, spiro);
    }
  });
}

/** Cubane: the Q3 cube graph, two vertices bonded when they differ in one bit. */
function cubane(): Molecule {
  return buildMolecule((b) => {
    const ids: AtomId[] = [];
    for (let i = 0; i < 8; i++) ids.push(b.atom("C"));
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        const j = i ^ bit;
        if (j > i) b.bond(ids[i]!, ids[j]!);
      }
    }
  });
}

/** Adamantane: four bridgehead CH, each pair joined through one CH2. */
function adamantane(): Molecule {
  return buildMolecule((b) => {
    const heads = [b.atom("C"), b.atom("C"), b.atom("C"), b.atom("C")];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const middle = b.atom("C");
        b.bond(heads[i]!, middle);
        b.bond(middle, heads[j]!);
      }
    }
  });
}

/** Two bridgeheads joined by `bridges` chains of the given lengths. */
function bicyclic(bridges: readonly number[]): Molecule {
  return buildMolecule((b) => {
    const head1 = b.atom("C");
    const head2 = b.atom("C");
    for (const length of bridges) {
      let previous = head1;
      for (let i = 0; i < length; i++) {
        const next = b.atom("C");
        b.bond(previous, next);
        previous = next;
      }
      b.bond(previous, head2);
    }
  });
}

/** bicyclo[2.2.2]octane — the classic Figueras counterexample. */
function bicyclooctane(): Molecule {
  return bicyclic([2, 2, 2]);
}

/** Norbornane, bicyclo[2.2.1]heptane. */
function norbornane(): Molecule {
  return bicyclic([2, 2, 1]);
}

/** Cyclododecane closed across the ring by a 1,7 bond. */
function transannularCyclododecane(): Molecule {
  return buildMolecule((b) => {
    const ids: AtomId[] = [];
    for (let i = 0; i < 12; i++) ids.push(b.atom("C"));
    for (let i = 0; i < 12; i++) b.bond(ids[i]!, ids[(i + 1) % 12]!);
    b.bond(ids[0]!, ids[6]!);
  });
}

/** Azulene: a 5-ring fused to a 7-ring across one bond. */
function azulene(): Molecule {
  return buildMolecule((b) => {
    const shared1 = b.atom("C");
    const shared2 = b.atom("C");
    let previous = shared1;
    for (let i = 0; i < 3; i++) {
      const next = b.atom("C");
      b.bond(previous, next);
      previous = next;
    }
    b.bond(previous, shared2);
    previous = shared1;
    for (let i = 0; i < 5; i++) {
      const next = b.atom("C");
      b.bond(previous, next);
      previous = next;
    }
    b.bond(previous, shared2);
    b.bond(shared1, shared2);
  });
}

/** Two benzene rings joined by a single C-C bond. */
function biphenyl(): Molecule {
  return buildMolecule((b) => {
    const first: AtomId[] = [];
    const second: AtomId[] = [];
    for (let i = 0; i < 6; i++) first.push(b.atom("C"));
    for (let i = 0; i < 6; i++) second.push(b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(first[i]!, first[(i + 1) % 6]!);
    for (let i = 0; i < 6; i++) b.bond(second[i]!, second[(i + 1) % 6]!);
    b.bond(first[0]!, second[0]!);
  });
}

/** Benzene ring with an ethyl tail: three bonds that lie on no ring. */
function ethylbenzene(): Molecule {
  return buildMolecule((b) => {
    const ring: AtomId[] = [];
    for (let i = 0; i < 6; i++) ring.push(b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!);
    const c1 = b.atom("C");
    const c2 = b.atom("C");
    b.bond(ring[0]!, c1);
    b.bond(c1, c2);
  });
}

/** Benzene and cyclohexane in one molecule, with no bond between them. */
function twoRingSystems(): Molecule {
  return buildMolecule((b) => {
    const first: AtomId[] = [];
    const second: AtomId[] = [];
    for (let i = 0; i < 6; i++) first.push(b.atom("C"));
    for (let i = 0; i < 6; i++) second.push(b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(first[i]!, first[(i + 1) % 6]!);
    for (let i = 0; i < 6; i++) b.bond(second[i]!, second[(i + 1) % 6]!);
  });
}

/** Coronene: an inner hexagon spoked to an 18-membered outer ring. */
function coronene(): Molecule {
  return buildMolecule((b) => {
    const inner: AtomId[] = [];
    const outer: AtomId[] = [];
    for (let i = 0; i < 6; i++) inner.push(b.atom("C"));
    for (let i = 0; i < 18; i++) outer.push(b.atom("C"));
    for (let i = 0; i < 6; i++) b.bond(inner[i]!, inner[(i + 1) % 6]!);
    for (let i = 0; i < 18; i++) b.bond(outer[i]!, outer[(i + 1) % 18]!);
    for (let i = 0; i < 6; i++) b.bond(inner[i]!, outer[3 * i]!);
  });
}

// ---------------------------------------------------------------------------
// Reusable structural assertion
// ---------------------------------------------------------------------------

/**
 * Every invariant a `Ring` promises, checked against the graph itself.
 *
 * The renderer walks a ring's perimeter to place the inner line of a ring
 * double bond, so "consecutive ids are bonded and the last closes back to the
 * first" is load-bearing rather than cosmetic — a set of ids sorted into
 * numeric order would satisfy a naive membership test and draw nonsense.
 *
 * Exported so every fixture in this file runs through the same check.
 */
export function expectValidRings(mol: Molecule, label: string): void {
  const perceived = R.rings(mol);
  const membership = R.ringMembership(mol);

  perceived.forEach((ring, index) => {
    const where = `${label} ring ${index}`;
    expect(ring.size, `${where}: size matches atom count`).toBe(
      ring.atomIds.length,
    );
    expect(ring.bondIds.length, `${where}: one bond per atom`).toBe(ring.size);
    expect(ring.size, `${where}: rings have at least three atoms`).toBeGreaterThanOrEqual(3);
    expect(new Set(ring.atomIds).size, `${where}: no repeated atom`).toBe(ring.size);
    expect(new Set(ring.bondIds).size, `${where}: no repeated bond`).toBe(ring.size);

    for (let i = 0; i < ring.size; i++) {
      const here = ring.atomIds[i]!;
      const next = ring.atomIds[(i + 1) % ring.size]!;
      const bond = M.bondBetween(mol, here, next);
      expect(bond, `${where}: ${here} and ${next} must be bonded`).toBeDefined();
      expect(bond!.id, `${where}: bondIds[${i}] joins the walk`).toBe(
        ring.bondIds[i],
      );
      expect(membership.atoms[here], `${where}: ${here} knows it is in the ring`)
        .toContain(index);
      expect(membership.bonds[bond!.id], `${where}: bond knows it is in the ring`)
        .toContain(index);
    }

    // Canonical form: lowest atom index first, then step towards the lower of
    // the two ring neighbours. Without this a rotation or a mirror of the
    // same ring would be a different array, and the ring would appear to move
    // between runs.
    const rank = (id: AtomId): number => mol.atomIds.indexOf(id);
    const ranks = ring.atomIds.map(rank);
    expect(ranks[0], `${where}: starts at the lowest atom index`).toBe(
      Math.min(...ranks),
    );
    expect(
      ranks[1]! < ranks[ranks.length - 1]!,
      `${where}: walks towards the lower neighbour`,
    ).toBe(true);
  });

  // Membership never invents an index, and covers every id in the molecule.
  for (const id of mol.atomIds) {
    expect(membership.atoms[id], `${label}: ${id} has a membership entry`).toBeDefined();
    for (const index of membership.atoms[id] ?? []) {
      expect(perceived[index]!.atomIds).toContain(id);
    }
  }
  for (const id of mol.bondIds) {
    expect(membership.bonds[id], `${label}: ${id} has a membership entry`).toBeDefined();
    for (const index of membership.bonds[id] ?? []) {
      expect(perceived[index]!.bondIds).toContain(id);
    }
  }
}

function sizes(mol: Molecule): number[] {
  return R.rings(mol).map((ring) => ring.size);
}

function fusionBondIds(mol: Molecule): string[] {
  return mol.bondIds.filter((id) => R.isFusionBond(mol, id));
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

describe("basic perception", () => {
  it("finds exactly one six-ring in benzene", () => {
    const mol = benzene();
    expect(sizes(mol)).toEqual([6]);
    expect(R.rings(mol)[0]!.atomIds).toHaveLength(6);
  });

  it("finds no rings in an acyclic chain", () => {
    const mol = linearChain(8);
    expect(R.rings(mol)).toHaveLength(0);
    for (const id of mol.bondIds) {
      expect(R.isRingBond(mol, id)).toBe(false);
      expect(R.ringsAtBond(mol, id)).toEqual([]);
    }
    for (const id of mol.atomIds) expect(R.isRingAtom(mol, id)).toBe(false);
  });

  it("finds no rings in an empty or single-atom molecule", () => {
    expect(R.rings(M.emptyMolecule())).toHaveLength(0);
    expect(R.rings(buildMolecule((b) => b.atom("C")))).toHaveLength(0);
  });

  it("gives naphthalene two six-rings sharing exactly one bond", () => {
    const mol = naphthalene();
    expect(sizes(mol)).toEqual([6, 6]);

    const shared = fusionBondIds(mol);
    expect(shared).toHaveLength(1);
    for (const id of mol.bondIds) {
      expect(R.isRingBond(mol, id)).toBe(true);
      expect(R.isFusionBond(mol, id)).toBe(id === shared[0]);
    }

    const [first, second] = R.rings(mol);
    const sharedAtoms = first!.atomIds.filter((id) =>
      second!.atomIds.includes(id),
    );
    expect(sharedAtoms).toHaveLength(2);
    // The 10-membered perimeter is a genuine cycle and exactly the GF(2) sum
    // of the two rings; it must be rejected by the strictly-smaller test.
    expect(sizes(mol)).not.toContain(10);
  });

  it("gives a fused tetracycle four six-rings", () => {
    const mol = linearAcene(4);
    expect(sizes(mol)).toEqual([6, 6, 6, 6]);
    expect(fusionBondIds(mol)).toHaveLength(3);
  });

  it("gives anthracene three six-rings", () => {
    expect(sizes(linearAcene(3))).toEqual([6, 6, 6]);
  });
});

describe("ringCount agreement", () => {
  // The circuit rank equals the perceived count for every ordinary structure.
  // It deliberately does NOT for cages — see the symmetrised-SSSR suite.
  const fixtures: ReadonlyArray<readonly [string, Molecule]> = [
    ["benzene", benzene()],
    ["cyclohexane", carbocycle(6)],
    ["naphthalene", naphthalene()],
    ["tetracene", linearAcene(4)],
    ["spiro[4.5]decane", spiroDecane()],
    ["norbornane", norbornane()],
    ["azulene", azulene()],
    ["biphenyl", biphenyl()],
    ["coronene", coronene()],
    ["ethylbenzene", ethylbenzene()],
    ["two ring systems", twoRingSystems()],
    ["chain", linearChain(8)],
    ["empty", M.emptyMolecule()],
  ];

  for (const [name, mol] of fixtures) {
    it(`agrees with ringCount for ${name}`, () => {
      expect(R.rings(mol).length).toBe(M.ringCount(mol));
    });
  }
});

describe("closed-walk validity", () => {
  const fixtures: ReadonlyArray<readonly [string, Molecule]> = [
    ["benzene", benzene()],
    ["cyclohexane", carbocycle(6)],
    ["naphthalene", naphthalene()],
    ["anthracene", linearAcene(3)],
    ["tetracene", linearAcene(4)],
    ["spiro[4.5]decane", spiroDecane()],
    ["cubane", cubane()],
    ["adamantane", adamantane()],
    ["bicyclo[2.2.2]octane", bicyclooctane()],
    ["norbornane", norbornane()],
    ["transannular cyclododecane", transannularCyclododecane()],
    ["azulene", azulene()],
    ["biphenyl", biphenyl()],
    ["ethylbenzene", ethylbenzene()],
    ["two ring systems", twoRingSystems()],
    ["coronene", coronene()],
    ["chain", linearChain(8)],
    ["cyclotriacontane", carbocycle(30)],
  ];

  for (const [name, mol] of fixtures) {
    it(`emits genuine closed walks for ${name}`, () => {
      expectValidRings(mol, name);
    });
  }
});

// ---------------------------------------------------------------------------
// Symmetrised SSSR: the cages, where the count exceeds the circuit rank
// ---------------------------------------------------------------------------

describe("symmetrised SSSR keeps symmetry-equivalent rings", () => {
  it("gives cubane six faces against a circuit rank of five", () => {
    const mol = cubane();
    expect(M.ringCount(mol)).toBe(5);
    expect(sizes(mol)).toEqual([4, 4, 4, 4, 4, 4]);
    // Every cube edge lies on exactly two faces.
    for (const id of mol.bondIds) expect(R.ringsAtBond(mol, id)).toHaveLength(2);
  });

  it("gives adamantane four chair faces against a rank of three", () => {
    const mol = adamantane();
    expect(M.ringCount(mol)).toBe(3);
    expect(sizes(mol)).toEqual([6, 6, 6, 6]);
    // Every one of the twelve bonds sits in exactly two of the four rings, so
    // every bond is a fusion bond.
    expect(fusionBondIds(mol)).toHaveLength(12);
  });

  it("gives bicyclo[2.2.2]octane three six-rings against a rank of two", () => {
    const mol = bicyclooctane();
    expect(M.ringCount(mol)).toBe(2);
    expect(sizes(mol)).toEqual([6, 6, 6]);
    // The third ring is the GF(2) sum of the other two and survives only
    // because nothing STRICTLY smaller than six exists here.
    for (const id of mol.bondIds) expect(R.ringsAtBond(mol, id)).toHaveLength(2);
  });
});

describe("larger cycles that are sums of smaller ones are rejected", () => {
  it("gives norbornane two five-rings and never the six-ring", () => {
    const mol = norbornane();
    expect(M.ringCount(mol)).toBe(2);
    expect(sizes(mol)).toEqual([5, 5]);
    expect(sizes(mol)).not.toContain(6);

    expect(mol.bondIds).toHaveLength(8);
    for (const id of mol.bondIds) expect(R.isRingBond(mol, id)).toBe(true);
    // Only the two bonds of the one-atom bridge are shared.
    expect(fusionBondIds(mol)).toHaveLength(2);
    expect(mol.bondIds.filter((id) => R.ringsAtBond(mol, id).length === 1))
      .toHaveLength(6);
  });

  it("gives a transannular cyclododecane two seven-rings, not the perimeter", () => {
    const mol = transannularCyclododecane();
    expect(M.ringCount(mol)).toBe(2);
    expect(sizes(mol)).toEqual([7, 7]);
    expect(sizes(mol)).not.toContain(12);
  });

  it("gives azulene a five-ring and a seven-ring sharing one bond", () => {
    const mol = azulene();
    expect(sizes(mol)).toEqual([5, 7]);
    expect(fusionBondIds(mol)).toHaveLength(1);
    expect(sizes(mol)).not.toContain(10);
    // Azulene is aromatic over its 10-electron perimeter, which aromatic.ts
    // reaches by counting the UNION of these two rings. That pass is indexed
    // by the ring set asserted here, so the 10-membered perimeter must stay
    // out of it: perceiving it as a third ring would count the same ten
    // electrons twice.
  });
});

// ---------------------------------------------------------------------------
// Fusion, spiro, bridges
// ---------------------------------------------------------------------------

describe("spiro junctions are not fusions", () => {
  it("gives spiro[4.5]decane a five-ring and a six-ring sharing one atom", () => {
    const mol = spiroDecane();
    expect(mol.atomIds).toHaveLength(10);
    expect(mol.bondIds).toHaveLength(11);
    expect(sizes(mol)).toEqual([5, 6]);

    const [five, six] = R.rings(mol);
    const sharedAtoms = five!.atomIds.filter((id) => six!.atomIds.includes(id));
    expect(sharedAtoms).toHaveLength(1);
    const sharedBonds = five!.bondIds.filter((id) => six!.bondIds.includes(id));
    expect(sharedBonds).toHaveLength(0);

    // Two rings sharing an ATOM are not fused: every bond belongs to exactly
    // one ring, and a renderer keying inner double-bond placement on shared
    // atoms would mis-draw this junction.
    for (const id of mol.bondIds) expect(R.isFusionBond(mol, id)).toBe(false);

    const spiroAtom = sharedAtoms[0]!;
    expect(R.isSpiroAtom(mol, spiroAtom)).toBe(true);
    expect(R.ringsAtAtom(mol, spiroAtom)).toEqual([0, 1]);
    expect(M.degree(mol, spiroAtom)).toBe(4);
  });

  it("does not call a naphthalene fusion carbon a spiro atom", () => {
    const mol = naphthalene();
    for (const id of mol.atomIds) expect(R.isSpiroAtom(mol, id)).toBe(false);
  });
});

describe("bridges lie on no ring", () => {
  it("keeps biphenyl's two rings apart", () => {
    const mol = biphenyl();
    expect(sizes(mol)).toEqual([6, 6]);

    const [first, second] = R.rings(mol);
    expect(first!.atomIds.filter((id) => second!.atomIds.includes(id))).toEqual([]);
    expect(first!.bondIds.filter((id) => second!.bondIds.includes(id))).toEqual([]);

    // The inter-ring bond is the last one added and lies on no ring at all.
    const interRing = mol.bondIds[mol.bondIds.length - 1]!;
    expect(R.ringsAtBond(mol, interRing)).toEqual([]);
    expect(R.isRingBond(mol, interRing)).toBe(false);
    expect(R.isFusionBond(mol, interRing)).toBe(false);
    expect(fusionBondIds(mol)).toEqual([]);
  });

  it("strips a pendant chain from ethylbenzene", () => {
    const mol = ethylbenzene();
    expect(sizes(mol)).toEqual([6]);
    const pendant = mol.bondIds.slice(-2);
    for (const id of pendant) {
      expect(R.ringsAtBond(mol, id)).toEqual([]);
      expect(R.isRingBond(mol, id)).toBe(false);
    }
    expect(mol.bondIds.filter((id) => R.isRingBond(mol, id))).toHaveLength(6);
    // The two chain carbons are in no ring; the ipso carbon still is.
    const chain = mol.atomIds.slice(-2);
    for (const id of chain) expect(R.isRingAtom(mol, id)).toBe(false);
    expect(R.isRingAtom(mol, mol.atomIds[0]!)).toBe(true);
  });
});

describe("disconnected ring systems", () => {
  it("perceives both systems, ordered by lowest atom index", () => {
    const mol = twoRingSystems();
    // ringCount is bonds - atoms + COMPONENTS. Computing the rank as
    // bonds - atoms + 1 gives 1 here and the search stops after one ring.
    expect(M.ringCount(mol)).toBe(2);
    expect(sizes(mol)).toEqual([6, 6]);

    // Same-size rings are ordered by their lowest atom index, so the first
    // ring is always the system that was drawn first.
    const [first, second] = R.rings(mol);
    expect([...first!.atomIds]).toEqual(mol.atomIds.slice(0, 6));
    expect([...second!.atomIds]).toEqual(mol.atomIds.slice(6));
  });
});

describe("fused polycyclics stay polynomial", () => {
  it("perceives coronene's seven rings", () => {
    const mol = coronene();
    expect(mol.atomIds).toHaveLength(24);
    expect(mol.bondIds).toHaveLength(30);
    expect(M.ringCount(mol)).toBe(7);
    // The assertion is really about the algorithm class: a depth-first
    // all-simple-cycles enumerator is exponential and never returns here.
    expect(sizes(mol)).toEqual([6, 6, 6, 6, 6, 6, 6]);
    expect(fusionBondIds(mol)).toHaveLength(12);
  });
});

describe("scale", () => {
  it("perceives a 20000-membered macrocycle without exhausting the heap", () => {
    // Every bond of one N-membered ring finds that same N-membered cycle, so
    // building a candidate per bond and deduplicating afterwards holds N full
    // copies of the ring — walk, sorted atom list and a key string listing all
    // N bonds — before a single one is discarded. That is Theta(N^2) in both
    // time and memory: this call used to take minutes and then die with
    // "JavaScript heap out of memory", killing the process rather than failing
    // the test. It is now one traced cycle.
    const mol = carbocycle(20000);
    const perceived = R.rings(mol);
    expect(perceived).toHaveLength(1);
    expect(perceived[0]!.size).toBe(20000);
    expect(M.ringCount(mol)).toBe(1);
    // Still a genuine closed walk, not a shortcut that skipped the invariant.
    const ring = perceived[0]!;
    for (let i = 0; i < 12; i++) {
      const here = ring.atomIds[i]!;
      const next = ring.atomIds[(i + 1) % ring.size]!;
      expect(M.bondBetween(mol, here, next)).toBeDefined();
    }
    expect(M.bondBetween(mol, ring.atomIds[ring.size - 1]!, ring.atomIds[0]!))
      .toBeDefined();
  });

  it("stays linear in the number of disconnected fragments", () => {
    // A multi-record SDF pasted as one molecule, or a solvated structure. Each
    // ring system used to allocate a whole-molecule array and rescan every
    // bond in the molecule, making perception quadratic in the fragment count.
    const fragments = 2000;
    const mol = buildMolecule((b) => {
      for (let f = 0; f < fragments; f++) {
        const ring: AtomId[] = [];
        for (let i = 0; i < 6; i++) ring.push(b.atom("C", vec(i, f)));
        for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!);
      }
    });
    expect(R.rings(mol)).toHaveLength(fragments);
    expect(M.ringCount(mol)).toBe(fragments);
    expect(sizes(mol).every((size) => size === 6)).toBe(true);
  });
});

describe("the Horton backstop is not gated on rank alone", () => {
  it("keeps a square whose every bond already sits on a triangle", () => {
    // An eight-vertex skeleton of four triangles and two squares. Its circuit
    // rank is 6 and those six rings reach it, so a rank-triggered backstop
    // never runs — but a seventh cycle, the square a2-a3-a5-a6, is a genuine
    // ring that is not the GF(2) sum of anything strictly smaller and belongs
    // in a symmetrised SSSR. The per-bond generator cannot see it: every one
    // of its four bonds has a THREE-membered cycle through it, so the "smallest
    // cycle through this bond" search never emits it. Horton's set does
    // contain it, which is why it now runs unconditionally for a component
    // this small.
    const mol = buildMolecule((b) => {
      const a: AtomId[] = [];
      for (let i = 0; i < 8; i++) a.push(b.atom("C"));
      const edges: ReadonlyArray<readonly [number, number]> = [
        [3, 8], [2, 8], [6, 2], [1, 6], [7, 6], [5, 7], [4, 1],
        [5, 3], [5, 4], [6, 5], [2, 1], [4, 3], [2, 3],
      ];
      for (const [x, y] of edges) b.bond(a[x - 1]!, a[y - 1]!);
    });

    expect(M.ringCount(mol)).toBe(6);
    expect(sizes(mol)).toEqual([3, 3, 3, 3, 4, 4, 4]);
    const atomSets = R.rings(mol).map((ring) => [...ring.atomIds].sort().join(""));
    expect(atomSets).toContain("a2a3a5a6");
    expectValidRings(mol, "four-triangle C8 skeleton");
  });
});

// ---------------------------------------------------------------------------
// Geometry and shape of the result
// ---------------------------------------------------------------------------

describe("ring geometry and accessors", () => {
  it("centroids a benzene at its own centre", () => {
    const mol = benzene(1, vec(3, -2));
    const centroid = R.ringCentroid(mol, 0);
    expect(centroid.x).toBeCloseTo(3, 10);
    expect(centroid.y).toBeCloseTo(-2, 10);
  });

  it("reports ring size and ids", () => {
    const mol = naphthalene();
    expect(R.ringSize(mol, 0)).toBe(6);
    expect(R.ringAtomIds(mol, 1)).toHaveLength(6);
    expect(R.ringBondIds(mol, 1)).toHaveLength(6);
  });

  it("throws on an out-of-range ring index", () => {
    const mol = benzene();
    expect(() => R.ringSize(mol, 1)).toThrow(/No such ring/);
    expect(() => R.ringCentroid(mol, -1)).toThrow(/No such ring/);
  });

  it("throws on an unknown atom or bond id", () => {
    const mol = benzene();
    expect(() => R.ringsAtAtom(mol, "nope")).toThrow(/No such atom/);
    expect(() => R.ringsAtBond(mol, "nope")).toThrow(/No such bond/);
  });

  it("freezes the shared result so one caller cannot corrupt the cache", () => {
    const mol = naphthalene();
    const perceived = R.rings(mol);
    expect(Object.isFrozen(perceived)).toBe(true);
    expect(Object.isFrozen(perceived[0])).toBe(true);
    expect(Object.isFrozen(perceived[0]!.atomIds)).toBe(true);
    expect(Object.isFrozen(R.ringMembership(mol).atoms)).toBe(true);
  });

  it("returns the same object for the same instance", () => {
    const mol = naphthalene();
    expect(R.ringPerception(mol)).toBe(R.ringPerception(mol));
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/** Moves one atom without touching a single bond. */
function moveAtom(mol: Molecule, atomId: AtomId, x: number, y: number): Molecule {
  const atom = M.requireAtom(mol, atomId);
  return {
    ...mol,
    atoms: { ...mol.atoms, [atomId]: { ...atom, pos: vec(x, y) } },
  };
}

describe("topology-keyed caching", () => {
  it("recomputes nothing when only a position changes", () => {
    // A ring size used by no other test in this file, so the topology
    // fingerprint cannot already be warm from another case.
    const mol = carbocycle(13);
    R.resetRingPerceptionComputationCount();

    expect(R.rings(mol)).toHaveLength(1);
    expect(R.ringPerceptionComputationCount()).toBe(1);

    const dragged = moveAtom(mol, mol.atomIds[0]!, 42, 17);
    expect(dragged).not.toBe(mol);

    expect(R.rings(dragged)).toHaveLength(1);
    // Dragging produces a fresh Molecule per pointer-move; an instance-keyed
    // cache alone would miss on every frame of exactly this interaction.
    expect(R.ringPerceptionComputationCount()).toBe(1);
    expect(R.rings(dragged)).toBe(R.rings(mol));

    // ...but the centroid is read live, so it must have moved. A centroid
    // cached inside the perception object would be stale for the whole drag.
    expect(R.ringCentroid(dragged, 0)).not.toEqual(R.ringCentroid(mol, 0));
  });

  it("does not recompute for repeated queries on one instance", () => {
    const mol = carbocycle(14);
    R.resetRingPerceptionComputationCount();
    R.rings(mol);
    R.ringMembership(mol);
    R.ringCentroid(mol, 0);
    R.isFusionBond(mol, mol.bondIds[0]!);
    expect(R.ringPerceptionComputationCount()).toBe(1);
  });

  it("does recompute when the topology actually changes", () => {
    const mol = carbocycle(15);
    R.resetRingPerceptionComputationCount();
    R.rings(mol);
    expect(R.ringPerceptionComputationCount()).toBe(1);

    const { molecule: opened } = M.addAtom(mol, { element: "C" });
    R.rings(opened);
    expect(R.ringPerceptionComputationCount()).toBe(2);
  });

  it("evicts the oldest entry once the bound is reached", () => {
    const cache = new R.LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // Reading "a" refreshes its recency, so "b" is the one that goes.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("determinism", () => {
  it("gives the same rings for the same structure built two different ways", () => {
    // Both molecules must reach the search independently, or this proves
    // nothing. `buildMolecule` mints ids deterministically, so naphthalene
    // built twice the same way has an identical topology fingerprint and the
    // second call is a cache HIT returning the very same frozen object — the
    // assertion would then be comparing that object with itself and would pass
    // however nondeterministic candidate ordering became. Adding the same
    // bonds in a different order changes the fingerprint without changing the
    // structure, which forces a real second computation.
    const a = naphthalene();
    const b = naphthaleneRungsFirst();
    expect(R.rings(a)).not.toBe(R.rings(b));

    const asSets = (mol: Molecule): string[] =>
      R.rings(mol)
        .map((ring) => [...ring.atomIds].sort().join(","))
        .sort();
    expect(asSets(a)).toEqual(asSets(b));
    expect(sizes(a)).toEqual(sizes(b));
  });

  it("is blind to which direction a ring was drawn", () => {
    const forward = carbocycle(7);
    const reversed = buildMolecule((b) => {
      const ids: AtomId[] = [];
      for (let i = 0; i < 7; i++) ids.push(b.atom("C"));
      // Same cycle, bonds added the other way round.
      for (let i = 6; i >= 0; i--) b.bond(ids[i]!, ids[(i + 6) % 7]!);
    });
    expect(R.rings(forward)[0]!.atomIds).toEqual(R.rings(reversed)[0]!.atomIds);
  });
});
