import { describe, expect, it } from "vitest";
import {
  benzene,
  buildMolecule,
  carbocycle,
  linearChain,
  singleAtom,
} from "./builders.js";
import * as M from "./molecule.js";
import { isFusionBond, isSpiroAtom, rings, ringsAtBond } from "./rings.js";
import { molecularFormula } from "./formula.js";
import { sprout } from "./sprout.js";
import {
  appendChain,
  attachRingToAtom,
  fuseRingOnBond,
  isDegenerateBond,
  RING_TEMPLATES,
  spiroRingAtAtom,
  templateRing,
  type RingTemplateName,
  type TemplateResult,
} from "./templates.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { valenceIssues } from "./valence.js";
import {
  add,
  angleOf,
  cross,
  distance,
  dot,
  normalizeAngle,
  ORIGIN,
  scale,
  sub,
  toDegrees,
  vec,
  type Vec2,
} from "./vec.js";

/**
 * Coordinates are order 1 (one bond length) and every template is a handful of
 * trig calls deep, so a double resolves the polygons to a few ulps. 1e-9 is
 * far tighter than any real defect: a ring built on the wrong edge length, a
 * fusion walked the wrong way round or a chain continued in the wrong phase
 * all move a point by 1e-1 or more, never by 1e-9.
 */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function posOf(mol: Molecule, id: AtomId): Vec2 {
  return M.requireAtom(mol, id).pos;
}

function bondLengthOf(mol: Molecule, id: BondId): number {
  const bond = M.requireBond(mol, id);
  return distance(posOf(mol, bond.from), posOf(mol, bond.to));
}

function centroidOf(mol: Molecule, ids: readonly AtomId[]): Vec2 {
  let sum: Vec2 = ORIGIN;
  for (const id of ids) sum = add(sum, posOf(mol, id));
  return scale(sum, 1 / ids.length);
}

/** Unsigned angle subtended at `b` by the path a -> b -> c, in degrees. */
function angleAt(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs(toDegrees(normalizeAngle(angleOf(sub(a, b)) - angleOf(sub(c, b)))));
}

/**
 * Every ring template claims to place a REGULAR polygon, and connectivity
 * alone cannot see the difference: a hexagon whose vertices are right but
 * whose angles are wrong is still a six-ring to `rings()` and still reads as
 * broken to a chemist. So every ring assertion goes through here, checking
 * both the edge length and the interior angle at each vertex.
 */
function expectRegularPolygon(
  mol: Molecule,
  ringIds: readonly AtomId[],
  edge: number,
): void {
  const size = ringIds.length;
  const interior = ((size - 2) * 180) / size;
  for (let i = 0; i < size; i++) {
    const previous = posOf(mol, ringIds[(i + size - 1) % size]!);
    const here = posOf(mol, ringIds[i]!);
    const next = posOf(mol, ringIds[(i + 1) % size]!);
    expect(distance(here, next)).toBeCloseTo(edge, 9);
    expect(angleAt(previous, here, next)).toBeCloseTo(interior, 9);
  }
}

/** Closest approach between any two atoms in the molecule. */
function minAtomSeparation(mol: Molecule): number {
  let best = Infinity;
  for (let i = 0; i < mol.atomIds.length; i++) {
    for (let j = i + 1; j < mol.atomIds.length; j++) {
      best = Math.min(best, distance(posOf(mol, mol.atomIds[i]!), posOf(mol, mol.atomIds[j]!)));
    }
  }
  return best;
}

/** Which side of the directed line a->b the point p lies on. */
function sideOfLine(a: Vec2, b: Vec2, p: Vec2): number {
  return Math.sign(cross(sub(b, a), sub(p, a)));
}

function doubleBondCount(mol: Molecule): number {
  return M.bonds(mol).filter((bond) => bond.order === 2).length;
}

/**
 * Every gesture mints ids from the target's own counter and touches nothing
 * that was already there. Checked after every call rather than in one place,
 * because a template that quietly reuses an id produces a molecule that looks
 * right and corrupts the first undo step that references the old atom.
 */
function expectFreshIds(before: Molecule, result: TemplateResult): void {
  const mol = result.molecule;
  for (const id of result.atomIds) {
    expect(M.hasAtom(before, id)).toBe(false);
    expect(M.getAtom(mol, id)).toBeDefined();
  }
  for (const id of result.bondIds) {
    expect(M.getBond(before, id)).toBeUndefined();
    expect(M.getBond(mol, id)).toBeDefined();
  }
  // The originals survive untouched and in order, with the new ids appended.
  expect(mol.atomIds.slice(0, before.atomIds.length)).toEqual(before.atomIds);
  expect(mol.bondIds.slice(0, before.bondIds.length)).toEqual(before.bondIds);
  expect(mol.atomIds.length).toBe(before.atomIds.length + result.atomIds.length);
  expect(mol.bondIds.length).toBe(before.bondIds.length + result.bondIds.length);
  expect(mol.nextId).toBeGreaterThan(before.nextId);
}

// ---------------------------------------------------------------------------
// Fixtures
//
// Local to this file on purpose, exactly as in rings.test.ts: tsconfig
// includes `src` and excludes only `src/**/*.test.ts`, so a shared fixture
// module would be compiled into dist as dead shipped code.
// ---------------------------------------------------------------------------

/**
 * (Z)-2-butene, drawn flat with both methyls above the double bond.
 *
 * The point of the fixture is the substituent pattern: the C=C has a
 * neighbour on each end and both are on the same side, so a fusion across it
 * has an unambiguous occupied side to lean away from and no ring to consult.
 */
function cisButene(): Molecule {
  return buildMolecule((b) => {
    const c2 = b.atom("C", vec(0, 0));
    const c3 = b.atom("C", vec(1, 0));
    const me1 = b.atom("C", vec(-0.5, Math.sqrt(3) / 2));
    const me2 = b.atom("C", vec(1.5, Math.sqrt(3) / 2));
    b.bond(c2, c3, 2);
    b.bond(c2, me1, 1);
    b.bond(c3, me2, 1);
  });
}

/**
 * Naphthalene, drawn the way the editor draws it: a hexagon with a second one
 * fused across a shared edge. Its central bond is the one bond in the molecule
 * with a ring on each side, which is the input every "no empty side left"
 * assertion needs.
 */
function naphthalene(): Molecule {
  const start = carbocycle(6);
  return fuseRingOnBond(start, start.bondIds[0]!, "cyclohexane").molecule;
}

function fusionBondOf(mol: Molecule): BondId {
  const id = mol.bondIds.find((candidate) => isFusionBond(mol, candidate));
  if (id === undefined) throw new Error("fixture has no fusion bond");
  return id;
}

/**
 * Methylcyclohexane, built by the app's own two gestures.
 *
 * C1 is the substrate that separates "point away from the bonds" from "point
 * at empty paper": its three bonds leave three gaps of exactly 120 degrees,
 * and one of those three tied gaps is the ring's own inside.
 */
function methylcyclohexane(): Molecule {
  return sprout(carbocycle(6), "a1").molecule;
}

const ALL_SIZES = [3, 4, 5, 6, 7] as const;

// ---------------------------------------------------------------------------
// The template table
// ---------------------------------------------------------------------------

describe("RING_TEMPLATES", () => {
  it("carries the eight toolbar rings at their named sizes", () => {
    const expected: Record<RingTemplateName, number> = {
      cyclopropane: 3,
      cyclobutane: 4,
      cyclopentane: 5,
      cyclohexane: 6,
      cycloheptane: 7,
      cyclooctane: 8,
      benzene: 6,
      cyclopentadiene: 5,
    };
    expect(Object.keys(RING_TEMPLATES).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, size] of Object.entries(expected)) {
      expect(RING_TEMPLATES[name as RingTemplateName].size).toBe(size);
    }
  });

  it("makes benzene and cyclopentadiene the only Kekule templates", () => {
    expect(RING_TEMPLATES.benzene.kekule).toBe(true);
    expect(RING_TEMPLATES.cyclopentadiene.kekule).toBe(true);
    expect(RING_TEMPLATES.cyclooctane.kekule).toBeUndefined();
    // The saturated rings must not carry the flag: a cyclohexane template that
    // quietly alternated would draw cyclohexatriene.
    expect(RING_TEMPLATES.cyclohexane.kekule).toBeUndefined();
    expect(RING_TEMPLATES.cyclopentane.kekule).toBeUndefined();
  });

  it("names no aromatic flags anywhere — Kekule is the storage form", () => {
    const mol = attachRingToAtom(singleAtom("C"), "a1", "benzene").molecule;
    expect(M.bonds(mol).some((bond) => bond.aromatic)).toBe(false);
    expect(M.atoms(mol).some((atom) => atom.aromatic)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

describe("fuseRingOnBond", () => {
  it("turns a cyclohexane into a naphthalene-shaped bicycle", () => {
    const start = carbocycle(6);
    const sharedId = start.bondIds[0]!;
    const result = fuseRingOnBond(start, sharedId, "benzene");
    const mol = result.molecule;

    expect(M.atomCount(mol)).toBe(10);
    expect(M.bondCount(mol)).toBe(11);
    expect(M.isConnected(mol)).toBe(true);
    expect(result.atomIds).toHaveLength(4);
    expect(result.bondIds).toHaveLength(5);
    expect(result.ringAtomIds).toHaveLength(6);

    const perceived = rings(mol);
    expect(perceived).toHaveLength(2);
    expect(perceived.map((ring) => ring.size)).toEqual([6, 6]);

    // Exactly one shared bond — the one clicked — and no other.
    expect(ringsAtBond(mol, sharedId)).toHaveLength(2);
    expect(isFusionBond(mol, sharedId)).toBe(true);
    const fusionBonds = mol.bondIds.filter((id) => isFusionBond(mol, id));
    expect(fusionBonds).toEqual([sharedId]);

    // Two regular hexagons of edge 1 sharing an edge sit 2 * apothem apart.
    const shared = M.requireBond(mol, sharedId);
    const oldRing = start.atomIds;
    expect(distance(centroidOf(mol, oldRing), centroidOf(mol, result.ringAtomIds))).toBeCloseTo(
      Math.sqrt(3),
      9,
    );
    expect(shared.order).toBe(1);
  });

  it("builds the new ring on the shared edge, not on options.bondLength", () => {
    // A regular polygon has ONE edge length and two of its vertices are
    // already placed. Honouring a different bondLength here would kink the
    // drawing at the fusion, so options is deliberately ignored.
    const start = carbocycle(6, "C", 1.3);
    const result = fuseRingOnBond(start, start.bondIds[0]!, "cyclohexane", {
      bondLength: 2.5,
    });
    for (const id of result.bondIds) {
      expect(bondLengthOf(result.molecule, id)).toBeCloseTo(1.3, 9);
    }
    expectRegularPolygon(result.molecule, result.ringAtomIds, 1.3);
  });

  it.each(ALL_SIZES)("fuses a regular %i-ring onto an existing edge", (size) => {
    const edge = 1.3;
    const start = carbocycle(6, "C", edge);
    const result = fuseRingOnBond(start, start.bondIds[0]!, { size });
    expect(result.atomIds).toHaveLength(size - 2);
    expect(result.bondIds).toHaveLength(size - 1);
    expect(result.ringAtomIds).toHaveLength(size);
    for (const id of result.bondIds) {
      expect(bondLengthOf(result.molecule, id)).toBeCloseTo(edge, 9);
    }
    expectRegularPolygon(result.molecule, result.ringAtomIds, edge);
  });

  it("shares the clicked bond's two atoms rather than duplicating them", () => {
    const start = carbocycle(6);
    const sharedId = start.bondIds[0]!;
    const shared = M.requireBond(start, sharedId);
    const result = fuseRingOnBond(start, sharedId, "cyclohexane");
    expect(result.ringAtomIds[0]).toBe(shared.from);
    expect(result.ringAtomIds[1]).toBe(shared.to);
    expect(result.atomIds).not.toContain(shared.from);
    expect(result.atomIds).not.toContain(shared.to);
    expectFreshIds(start, result);
  });
});

describe("fuseRingOnBond side selection", () => {
  it("puts the second ring on the far side of the shared bond from the first", () => {
    const start = carbocycle(6);
    const sharedId = start.bondIds[0]!;
    const shared = M.requireBond(start, sharedId);
    const pa = posOf(start, shared.from);
    const pb = posOf(start, shared.to);

    const result = fuseRingOnBond(start, sharedId, "cyclohexane");
    const oldSide = sideOfLine(pa, pb, centroidOf(start, start.atomIds));
    const newSide = sideOfLine(pa, pb, centroidOf(result.molecule, result.ringAtomIds));
    expect(oldSide).not.toBe(0);
    expect(newSide).toBe(-oldSide);
  });

  it("leans away from substituents when the bond is in no ring", () => {
    // Both methyls of cis-2-butene sit above the C=C, so the ring must go
    // below it.
    const start = cisButene();
    const result = fuseRingOnBond(start, start.bondIds[0]!, "cyclopentane");
    const centroid = centroidOf(result.molecule, result.ringAtomIds);
    expect(centroid.y).toBeLessThan(0);
  });

  it("falls back to the +perp side for an isolated, bare bond", () => {
    // Nothing to lean away from, so the choice is arbitrary — but it must be
    // the SAME arbitrary choice every time, or repeating the gesture on the
    // same drawing gives a different picture.
    const start = linearChain(2);
    const bondId = start.bondIds[0]!;
    const bond = M.requireBond(start, bondId);
    const pa = posOf(start, bond.from);
    const pb = posOf(start, bond.to);

    const result = fuseRingOnBond(start, bondId, "cyclohexane");
    const centroid = centroidOf(result.molecule, result.ringAtomIds);
    expect(sideOfLine(pa, pb, centroid)).toBe(1);

    const again = fuseRingOnBond(start, bondId, "cyclohexane");
    expect(centroidOf(again.molecule, again.ringAtomIds)).toEqual(centroid);
  });

  it("refuses a bond that already has a ring on each side", () => {
    // Naphthalene's central bond. The two ring centroids are mirror images
    // across it, so the evidence for a side CANCELS — which is not the same
    // thing as there being no evidence, and reading it that way falls through
    // to the +perp default and stamps a third hexagon exactly on top of one of
    // the two that are already there. A bond in two rings has no empty side
    // left at all, so the honest answer is to refuse, as for a zero-length
    // bond: the UI can ask isFusionBond before offering the gesture.
    const mol = naphthalene();
    const sharedId = fusionBondOf(mol);
    expect(ringsAtBond(mol, sharedId)).toHaveLength(2);
    expect(() => fuseRingOnBond(mol, sharedId, "cyclohexane")).toThrow(
      /ring on each side/,
    );

    // Only that one bond is spent: every peripheral bond still fuses, which is
    // how anthracene and phenanthrene get drawn.
    for (const id of mol.bondIds) {
      if (id === sharedId) continue;
      expect(() => fuseRingOnBond(mol, id, "cyclohexane")).not.toThrow();
    }
  });

  it("picks the side the same way at any scale", () => {
    // The lean is averaged over UNIT directions, so "is this lean big enough
    // to trust" means the same thing on a drawing in bond-length units as on
    // one imported in picometres. Measuring raw offsets instead shrinks the
    // occupied direction with the drawing until it reads as rounding noise and
    // the new ring goes back on the side it came from.
    for (const edge of [1, 1e-4, 1.05e-9]) {
      const start = carbocycle(6, "C", edge);
      const sharedId = start.bondIds[0]!;
      const shared = M.requireBond(start, sharedId);
      const pa = posOf(start, shared.from);
      const pb = posOf(start, shared.to);

      const result = fuseRingOnBond(start, sharedId, "cyclohexane");
      const oldSide = sideOfLine(pa, pb, centroidOf(start, start.atomIds));
      const newSide = sideOfLine(pa, pb, centroidOf(result.molecule, result.ringAtomIds));
      expect(newSide).toBe(-oldSide);
      // ...and the two hexagons stay a whole edge apart rather than merging.
      expect(minAtomSeparation(result.molecule) / edge).toBeCloseTo(1, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Vertices that land on atoms which are already drawn
// ---------------------------------------------------------------------------

describe("fuseRingOnBond and atoms that are already there", () => {
  it("reuses the atom a vertex lands on instead of stacking a second one on it", () => {
    // Butane with a hexagon fused across its middle bond. 120 degrees off the
    // shared bond is both where the chain's own terminal carbon sits and where
    // the hexagon's next vertex goes, so they are the same point — and the
    // structure at those coordinates is methylcyclohexane, not
    // methylcyclohexane with a seventh carbon hidden inside a drawn one.
    const start = linearChain(4);
    const reused = start.atomIds[3]!;
    const result = fuseRingOnBond(start, start.bondIds[1]!, "cyclohexane");
    const mol = result.molecule;

    expect(M.atomCount(mol)).toBe(7);
    expect(M.bondCount(mol)).toBe(7);
    expect(rings(mol).map((ring) => ring.size)).toEqual([6]);
    expect(M.isConnected(mol)).toBe(true);

    // Three minted atoms and four minted bonds, not four and five: one vertex
    // and one perimeter bond were already drawn.
    expect(result.atomIds).toHaveLength(3);
    expect(result.bondIds).toHaveLength(4);
    expect(result.ringAtomIds).toHaveLength(6);
    expect(result.ringAtomIds).toContain(reused);
    expect(result.atomIds).not.toContain(reused);

    expectRegularPolygon(mol, result.ringAtomIds, 1);
    expect(minAtomSeparation(mol)).toBeGreaterThanOrEqual(0.8);
    expect(valenceIssues(mol)).toEqual([]);
    expectFreshIds(start, result);
  });

  it("fuses naphthalene's bay bond into phenalene", () => {
    // The peripheral bond next to the ring fusion. A regular hexagon there
    // shares a vertex with the ring on the far side of the fusion — three
    // hexagons around one carbon is phenalene, C13, and it is the only
    // structure those coordinates can be. Minting the duplicate instead draws
    // a picture indistinguishable from phenalene out of fourteen atoms, with
    // no valence error and nothing else to surface it.
    const mol = naphthalene();
    const sharedId = fusionBondOf(mol);
    const shared = M.bondEndpoints(M.requireBond(mol, sharedId));
    const bayId = mol.bondIds.find((id) => {
      if (id === sharedId) return false;
      const ends = M.bondEndpoints(M.requireBond(mol, id));
      return ends.some((end) => shared.includes(end));
    })!;

    const result = fuseRingOnBond(mol, bayId, "cyclohexane");
    const after = result.molecule;

    expect(M.atomCount(after)).toBe(13);
    expect(M.bondCount(after)).toBe(15);
    expect(rings(after).map((ring) => ring.size)).toEqual([6, 6, 6]);
    expect(result.ringAtomIds).toHaveLength(6);
    expect(result.atomIds).toHaveLength(3);
    expectRegularPolygon(after, result.ringAtomIds, 1);
    expect(minAtomSeparation(after)).toBeGreaterThanOrEqual(0.8);
    expect(valenceIssues(after)).toEqual([]);
    // Three rings around one carbon: every one of the three bonds at the
    // central atom is shared by two of them.
    expect(after.bondIds.filter((id) => isFusionBond(after, id))).toHaveLength(3);
  });
});

describe("fuseRingOnBond and Kekule alternation", () => {
  it("gives real naphthalene when benzene is fused across a double bond", () => {
    const start = benzene();
    // carbocycle alternates from index 1, so bondIds[1] is one of the doubles.
    const sharedId = start.bondIds[1]!;
    expect(M.requireBond(start, sharedId).order).toBe(2);

    const result = fuseRingOnBond(start, sharedId, "benzene");
    const mol = result.molecule;

    expect(M.atomCount(mol)).toBe(10);
    expect(M.bondCount(mol)).toBe(11);
    expect(M.isConnected(mol)).toBe(true);
    expect(rings(mol)).toHaveLength(2);
    // Naphthalene's Kekule structure: five doubles across eleven bonds.
    expect(doubleBondCount(mol)).toBe(5);
    // Alternation continued through the shared bond, so nothing is over-filled.
    expect(valenceIssues(mol)).toEqual([]);
    expectRegularPolygon(mol, result.ringAtomIds, 1);
  });

  it("draws the ring anyway when alternation cannot be satisfied, and reports it", () => {
    // Fusing an arene across a SINGLE bond of benzene: both shared carbons
    // already carry a double, and strict alternation hands each of them a
    // second one. Dodging would silently draw a cyclohexadiene where the user
    // asked for an arene; the contract is to draw the requested ring and let
    // valenceIssues surface the problem.
    const start = benzene();
    const sharedId = start.bondIds[0]!;
    expect(M.requireBond(start, sharedId).order).toBe(1);
    const shared = M.requireBond(start, sharedId);

    const result = fuseRingOnBond(start, sharedId, "benzene");
    const mol = result.molecule;

    expect(M.isConnected(mol)).toBe(true);
    expect(M.atomCount(mol)).toBe(10);
    expect(M.bondCount(mol)).toBe(11);
    expect(rings(mol)).toHaveLength(2);
    expectRegularPolygon(mol, result.ringAtomIds, 1);

    const errors = valenceIssues(mol).filter((issue) => issue.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    const flagged = new Set(errors.map((issue) => issue.atomId));
    expect(flagged.has(shared.from) || flagged.has(shared.to)).toBe(true);

    // The existing bond's own order is never rewritten to make room.
    expect(M.requireBond(mol, sharedId).order).toBe(1);
  });

  it("leaves a saturated template's bonds all single", () => {
    const start = carbocycle(6);
    const result = fuseRingOnBond(start, start.bondIds[0]!, "cyclohexane");
    for (const id of result.bondIds) {
      expect(M.requireBond(result.molecule, id).order).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

describe("attachRingToAtom", () => {
  it.each(ALL_SIZES)("hangs a regular %i-ring off a new bond", (size) => {
    const bondLength = 1.2;
    const start = linearChain(3);
    const result = attachRingToAtom(start, start.atomIds[2]!, { size }, { bondLength });
    expect(result.atomIds).toHaveLength(size);
    expect(result.bondIds).toHaveLength(size + 1);
    expect(result.ringAtomIds).toEqual(result.atomIds);
    for (const id of result.bondIds) {
      expect(bondLengthOf(result.molecule, id)).toBeCloseTo(bondLength, 9);
    }
    expectRegularPolygon(result.molecule, result.ringAtomIds, bondLength);
    expect(M.isConnected(result.molecule)).toBe(true);
    expect(rings(result.molecule)).toHaveLength(1);
  });

  it("keeps the clicked atom out of the ring and links it with a single bond", () => {
    const start = benzene();
    const anchor = start.atomIds[0]!;
    const result = attachRingToAtom(start, anchor, "benzene");
    const mol = result.molecule;

    // Biphenyl: twelve carbons, two rings, one bridge between them.
    expect(M.atomCount(mol)).toBe(12);
    expect(M.bondCount(mol)).toBe(13);
    expect(rings(mol)).toHaveLength(2);
    expect(result.ringAtomIds).not.toContain(anchor);

    const link = M.requireBond(mol, result.bondIds[0]!);
    expect(link.order).toBe(1);
    expect(link.from).toBe(anchor);
    expect(link.to).toBe(result.ringAtomIds[0]);
    // A bridge lies on no ring, which is what makes this biphenyl and not a
    // fused bicycle.
    expect(ringsAtBond(mol, link.id)).toEqual([]);
    expect(valenceIssues(mol)).toEqual([]);
    expect(doubleBondCount(mol)).toBe(6);
  });

  it("points the linking bond straight at the ring centre", () => {
    // The attachment vertex's two ring bonds are then symmetric about the
    // link, which is how biphenyl is drawn by hand.
    const start = linearChain(3);
    const anchor = start.atomIds[2]!;
    const result = attachRingToAtom(start, anchor, "cyclohexane");
    const centre = centroidOf(result.molecule, result.ringAtomIds);
    const v0 = posOf(result.molecule, result.ringAtomIds[0]!);
    const link = sub(v0, posOf(result.molecule, anchor));
    expect(Math.abs(cross(link, sub(centre, v0)))).toBeLessThan(EPS);
    // ...and pointing outward, not back through the anchor.
    expect(angleAt(posOf(result.molecule, anchor), v0, centre)).toBeCloseTo(180, 9);
  });

  it("walks the ring counter-clockwise from the attachment vertex", () => {
    // y is up here, so counter-clockwise is the positive direction and a
    // template laid out the other way is the mirror image of the one every
    // other builder produces. Invisible in a plain carbocycle, but it reverses
    // `ringAtomIds`, the perimeter bond ids and therefore where an element
    // list puts its heteroatoms.
    const result = attachRingToAtom(singleAtom("C"), "a1", "cyclohexane");
    const centre = centroidOf(result.molecule, result.ringAtomIds);
    const v0 = sub(posOf(result.molecule, result.ringAtomIds[0]!), centre);
    const v1 = sub(posOf(result.molecule, result.ringAtomIds[1]!), centre);
    expect(cross(v0, v1)).toBeGreaterThan(0);
  });

  it("does not crowd the atom's existing neighbours", () => {
    const start = linearChain(5);
    const middle = start.atomIds[2]!;
    const result = attachRingToAtom(start, middle, "cyclohexane");
    const mol = result.molecule;

    for (const fresh of result.atomIds) {
      for (const old of start.atomIds) {
        expect(distance(posOf(mol, fresh), posOf(mol, old))).toBeGreaterThanOrEqual(0.8);
      }
    }
    expect(minAtomSeparation(mol)).toBeGreaterThanOrEqual(0.8);
  });

  it("starts Kekule alternation on the first ring bond", () => {
    // No existing ring bond constrains the phase, so v0-v1 is the double.
    const result = attachRingToAtom(singleAtom("C"), "a1", "benzene");
    const ringBondIds = result.bondIds.slice(1);
    expect(ringBondIds.map((id) => M.requireBond(result.molecule, id).order)).toEqual([
      2, 1, 2, 1, 2, 1,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Spiro
// ---------------------------------------------------------------------------

describe("spiroRingAtAtom", () => {
  it("builds spiro[4.5]decane from a cyclohexane", () => {
    const start = carbocycle(6);
    const anchor = start.atomIds[0]!;
    const result = spiroRingAtAtom(start, anchor, "cyclopentane");
    const mol = result.molecule;

    expect(M.atomCount(mol)).toBe(10);
    expect(M.bondCount(mol)).toBe(11);
    expect(M.isConnected(mol)).toBe(true);
    expect(result.atomIds).toHaveLength(4);
    expect(result.bondIds).toHaveLength(5);

    const perceived = rings(mol);
    expect(perceived).toHaveLength(2);
    expect(perceived.map((ring) => ring.size).sort()).toEqual([5, 6]);

    // One shared ATOM and no shared bond: that is what separates a spiro
    // junction from a fusion.
    expect(isSpiroAtom(mol, anchor)).toBe(true);
    expect(mol.bondIds.some((id) => isFusionBond(mol, id))).toBe(false);
    const shared = perceived[0]!.atomIds.filter((id) =>
      perceived[1]!.atomIds.includes(id),
    );
    expect(shared).toEqual([anchor]);

    const centroids = [0, 1].map((index) =>
      centroidOf(mol, perceived[index]!.atomIds),
    );
    expect(distance(centroids[0]!, centroids[1]!)).toBeGreaterThan(1e-6);
    expect(valenceIssues(mol)).toEqual([]);
  });

  it.each(ALL_SIZES)("grows a regular %i-ring through the clicked atom", (size) => {
    const bondLength = 1.4;
    const start = linearChain(3);
    const anchor = start.atomIds[2]!;
    const result = spiroRingAtAtom(start, anchor, { size }, { bondLength });
    expect(result.atomIds).toHaveLength(size - 1);
    expect(result.bondIds).toHaveLength(size);
    expect(result.ringAtomIds[0]).toBe(anchor);
    for (const id of result.bondIds) {
      expect(bondLengthOf(result.molecule, id)).toBeCloseTo(bondLength, 9);
    }
    expectRegularPolygon(result.molecule, result.ringAtomIds, bondLength);
  });

  it("walks the ring counter-clockwise from the clicked atom", () => {
    const start = linearChain(3);
    const result = spiroRingAtAtom(start, start.atomIds[2]!, "cyclopentane");
    const centre = centroidOf(result.molecule, result.ringAtomIds);
    const v0 = sub(posOf(result.molecule, result.ringAtomIds[0]!), centre);
    const v1 = sub(posOf(result.molecule, result.ringAtomIds[1]!), centre);
    expect(cross(v0, v1)).toBeGreaterThan(0);
  });

  it("leaves the clicked atom where it was, with its bonds intact", () => {
    const start = carbocycle(6);
    const anchor = start.atomIds[0]!;
    const before = M.requireAtom(start, anchor);
    const result = spiroRingAtAtom(start, anchor, "cyclopentane");
    // Nothing on the page moves: the ring is laid out around the atom, not
    // the atom moved into the ring.
    expect(M.requireAtom(result.molecule, anchor)).toEqual(before);
    for (const bond of M.bondsAt(start, anchor)) {
      expect(M.requireBond(result.molecule, bond.id)).toEqual(bond);
    }
    expectFreshIds(start, result);
  });
});

// ---------------------------------------------------------------------------
// Direction at an atom that is already in a ring
// ---------------------------------------------------------------------------

describe("ring templates at a substituted ring atom", () => {
  /** Where the ring the anchor already belongs to lies, seen from the anchor. */
  function inwardFrom(mol: Molecule, anchor: AtomId, ringIds: readonly AtomId[]): Vec2 {
    return sub(centroidOf(mol, ringIds), posOf(mol, anchor));
  }

  it.each(ALL_SIZES)("hangs a %i-ring outside the ring the atom is in", (size) => {
    // C1 of methylcyclohexane has three bonds and therefore three gaps of
    // exactly 120 degrees. The widest-gap rule breaks that tie by angle order,
    // which knows about bonds but not about which side of them the paper is
    // full, and one of the three tied gaps is the ring's own inside — so the
    // attached ring used to be laid out straight on top of the existing one,
    // atom for atom, with no valence error to show for it.
    const start = methylcyclohexane();
    const ringIds = start.atomIds.slice(0, 6);
    const anchor = "a1";
    const result = attachRingToAtom(start, anchor, { size });
    const mol = result.molecule;

    const outward = sub(posOf(mol, result.ringAtomIds[0]!), posOf(mol, anchor));
    expect(dot(outward, inwardFrom(start, anchor, ringIds))).toBeLessThan(0);

    // Nothing minted lands on anything drawn — the assertion the plain-chain
    // case already makes, on the substrate that used to fail it by fifteen
    // orders of magnitude.
    for (const fresh of result.atomIds) {
      for (const old of start.atomIds) {
        expect(distance(posOf(mol, fresh), posOf(mol, old))).toBeGreaterThanOrEqual(0.8);
      }
    }
    expect(result.atomIds).toHaveLength(size);
    expect(rings(mol).map((ring) => ring.size).sort()).toEqual([6, size].sort());
    expectRegularPolygon(mol, result.ringAtomIds, 1);
  });

  it("grows a spiro ring outward, through atoms that are already there", () => {
    const start = methylcyclohexane();
    const ringIds = start.atomIds.slice(0, 6);
    const anchor = "a1";
    const result = spiroRingAtAtom(start, anchor, "cyclohexane");
    const mol = result.molecule;

    expect(result.ringAtomIds[0]).toBe(anchor);
    expect(result.ringAtomIds).toHaveLength(6);
    expectRegularPolygon(mol, result.ringAtomIds, 1);
    expect(minAtomSeparation(mol)).toBeGreaterThanOrEqual(0.8);
    expect(
      dot(
        sub(centroidOf(mol, result.ringAtomIds), posOf(mol, anchor)),
        inwardFrom(start, anchor, ringIds),
      ),
    ).toBeLessThan(0);

    // A fully substituted centre has no free 120 degree wedge left, so the
    // hexagon can only be drawn through carbons that are already on the page —
    // and reusing them is what keeps this a decalin-shaped bicycle instead of
    // five atoms hidden under five others. It is no longer a spiro junction,
    // which is the truth about the geometry rather than a failure of it.
    expect(M.atomCount(mol)).toBe(10);
    expect(rings(mol).map((ring) => ring.size)).toEqual([6, 6]);
    expect(valenceIssues(mol)).toEqual([]);
    expect(M.requireAtom(mol, anchor)).toEqual(M.requireAtom(start, anchor));
  });

  it("draws a crowded ring at a centre with no room, without stacking atoms", () => {
    // Three sprouts off one carbon: neighbours at 0, 120 and 240 degrees. A
    // pentagon's 108 degree wedge does not fit the 120 degree gap they leave,
    // and no rotation of it would — so the ring comes out squeezed and the
    // clicked atom five-coordinate. Valence never blocks a placement, so the
    // badge is what tells the user; what must not happen is two atoms sharing
    // a coordinate, which no badge would ever mention.
    let start = singleAtom("C");
    for (let i = 0; i < 3; i++) start = sprout(start, "a1").molecule;

    const squeezed = spiroRingAtAtom(start, "a1", "cyclopentane");
    expectRegularPolygon(squeezed.molecule, squeezed.ringAtomIds, 1);
    expect(minAtomSeparation(squeezed.molecule)).toBeGreaterThan(0.05);
    expect(
      valenceIssues(squeezed.molecule).some((issue) => issue.severity === "error"),
    ).toBe(true);

    // The hexagon at the same centre fits exactly, because its 120 degree
    // wedge is the gap: two of its vertices ARE two of the existing
    // substituents, so they are reused and nothing is over-filled.
    const exact = spiroRingAtAtom(start, "a1", "cyclohexane");
    expect(M.atomCount(exact.molecule)).toBe(7);
    expect(exact.atomIds).toHaveLength(3);
    expect(minAtomSeparation(exact.molecule)).toBeCloseTo(1, 9);
    expect(valenceIssues(exact.molecule)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

describe("appendChain", () => {
  it("continues linearChain's zig-zag in the same phase", () => {
    const start = linearChain(4);
    const terminus = start.atomIds[3]!;
    const result = appendChain(start, terminus, 4);
    const mol = result.molecule;

    expect(M.atomCount(mol)).toBe(8);
    expect(M.bondCount(mol)).toBe(7);
    expect(M.isConnected(mol)).toBe(true);
    expect(rings(mol)).toHaveLength(0);
    expect(result.ringAtomIds).toEqual([]);

    // The chain grown in two halves must be the chain grown in one. Both
    // start at the origin with the same start angle, so this is an exact
    // comparison and needs no rigid transform.
    const reference = linearChain(8);
    const chain = [...start.atomIds, ...result.atomIds];
    chain.forEach((id, index) => {
      const expected = posOf(reference, reference.atomIds[index]!);
      expect(posOf(mol, id).x).toBeCloseTo(expected.x, 9);
      expect(posOf(mol, id).y).toBeCloseTo(expected.y, 9);
    });

    // Independently of the reference: an sp3 zig-zag subtends 120 degrees at
    // every interior atom, and a kink at the join would show as a 180 or a 60.
    for (let i = 1; i + 1 < chain.length; i++) {
      expect(
        angleAt(posOf(mol, chain[i - 1]!), posOf(mol, chain[i]!), posOf(mol, chain[i + 1]!)),
      ).toBeCloseTo(120, 9);
    }

    // ...and the turns alternate. A doubled sign is a chain that coils instead
    // of zig-zagging, which a bond-angle check alone cannot see.
    const turns: number[] = [];
    for (let i = 0; i + 2 < chain.length; i++) {
      const first = sub(posOf(mol, chain[i + 1]!), posOf(mol, chain[i]!));
      const second = sub(posOf(mol, chain[i + 2]!), posOf(mol, chain[i + 1]!));
      turns.push(Math.sign(cross(first, second)));
    }
    expect(turns).toHaveLength(6);
    for (let i = 0; i + 1 < turns.length; i++) {
      expect(turns[i]).not.toBe(0);
      expect(turns[i + 1]).toBe(-turns[i]!);
    }
  });

  it("continues the zig-zag past a branch point", () => {
    // "Draw a chain, add a methyl, extend the chain" — three ordinary gestures
    // in a row. The methyl lands at the free vertex, which is symmetric about
    // the chain axis, so the branched neighbour's substituents average to
    // nothing and the terminal sprout rule has no side to lean off. Falling
    // through to a blanket counter-clockwise turn there repeats the previous
    // turn: every bond angle stays 120 degrees and the backbone still bends 60
    // degrees at the join, which is exactly the kink this gesture exists to
    // avoid.
    const propane = linearChain(3);
    const branched = sprout(propane, propane.atomIds[1]!).molecule;
    const result = appendChain(branched, propane.atomIds[2]!, 5);
    const mol = result.molecule;

    // The backbone of the result IS octane's: same origin, same start angle,
    // so a kink anywhere along it moves a point by 0.5 or more.
    const reference = linearChain(8);
    const backbone = [...propane.atomIds, ...result.atomIds];
    backbone.forEach((id, index) => {
      const expected = posOf(reference, reference.atomIds[index]!);
      expect(posOf(mol, id).x).toBeCloseTo(expected.x, 9);
      expect(posOf(mol, id).y).toBeCloseTo(expected.y, 9);
    });
    for (let i = 1; i + 1 < backbone.length; i++) {
      expect(
        angleAt(
          posOf(mol, backbone[i - 1]!),
          posOf(mol, backbone[i]!),
          posOf(mol, backbone[i + 1]!),
        ),
      ).toBeCloseTo(120, 9);
    }
    expect(minAtomSeparation(mol)).toBeGreaterThanOrEqual(0.8);
  });

  it("leaves the ring it starts from instead of running through it", () => {
    // The same tied-gap trap the ring templates hit: the widest gap at a
    // monosubstituted ring carbon can be the ring's inside, and a chain
    // started into it is drawn straight across the ring, first atom on the
    // centre.
    const start = methylcyclohexane();
    const result = appendChain(start, "a1", 4);
    expect(minAtomSeparation(result.molecule)).toBeGreaterThanOrEqual(0.8);
    expect(rings(result.molecule)).toHaveLength(1);
  });

  it("honours the bond length and mints one bond per atom", () => {
    const start = linearChain(3);
    const result = appendChain(start, start.atomIds[2]!, 5, { bondLength: 1.45 });
    expect(result.atomIds).toHaveLength(5);
    expect(result.bondIds).toHaveLength(5);
    for (const id of result.bondIds) {
      expect(bondLengthOf(result.molecule, id)).toBeCloseTo(1.45, 9);
      expect(M.requireBond(result.molecule, id).order).toBe(1);
    }
    expectFreshIds(start, result);
  });

  it("grows the element it is asked for", () => {
    // Methyl hydroperoxide: two oxygens hung off a carbon.
    const result = appendChain(singleAtom("C"), "a1", 2, { element: "O" });
    for (const id of result.atomIds) {
      expect(M.requireAtom(result.molecule, id).element).toBe("O");
    }
    expect(valenceIssues(result.molecule)).toEqual([]);
  });

  it("returns the molecule by reference for a zero-length append", () => {
    // An empty edit must not invalidate memoised renders or look like a step
    // to undo — the same promise insertFragment makes for an empty paste.
    const start = linearChain(3);
    const result = appendChain(start, start.atomIds[0]!, 0);
    expect(result.molecule).toBe(start);
    expect(result.atomIds).toEqual([]);
    expect(result.bondIds).toEqual([]);
    expect(result.ringAtomIds).toEqual([]);
    expect(appendChain(start, start.atomIds[0]!, -3).molecule).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// Heteroatoms
// ---------------------------------------------------------------------------

describe("element lists", () => {
  it("places the heteroatom at the attachment vertex of an attached ring", () => {
    // N-phenylpiperidine: the ring joins the arene through its nitrogen.
    const start = benzene();
    const result = attachRingToAtom(start, start.atomIds[0]!, {
      size: 6,
      elements: ["N", "C"],
    });
    const elements = result.ringAtomIds.map(
      (id) => M.requireAtom(result.molecule, id).element,
    );
    expect(elements).toEqual(["N", "C", "C", "C", "C", "C"]);
    // Three bonds on the nitrogen, which is exactly its valence.
    expect(valenceIssues(result.molecule)).toEqual([]);
  });

  it("repeats the last entry of a short list", () => {
    const result = attachRingToAtom(singleAtom("C"), "a1", {
      size: 6,
      elements: ["N"],
    });
    const elements = result.ringAtomIds.map(
      (id) => M.requireAtom(result.molecule, id).element,
    );
    expect(elements).toEqual(["N", "N", "N", "N", "N", "N"]);
  });

  it("numbers a fused ring's vertices from the shared bond and keeps the shared atoms' elements", () => {
    // Indole's skeleton: a five-ring fused to benzene with the nitrogen next
    // to a fusion carbon, i.e. at vertex 2 of the new ring.
    const start = benzene();
    const sharedId = start.bondIds[1]!;
    const shared = M.requireBond(start, sharedId);
    const result = fuseRingOnBond(start, sharedId, {
      size: 5,
      // Entries 0 and 1 name the SHARED atoms and are ignored: retyping an
      // atom the user only pointed at is not part of the gesture.
      elements: ["N", "N", "N", "C", "C"],
    });
    const elements = result.ringAtomIds.map(
      (id) => M.requireAtom(result.molecule, id).element,
    );
    expect(elements).toEqual(["C", "C", "N", "C", "C"]);
    expect(M.requireAtom(result.molecule, shared.from).element).toBe("C");
    expect(M.requireAtom(result.molecule, shared.to).element).toBe("C");
  });

  it("numbers a spiro ring's vertices from the clicked atom, which keeps its element", () => {
    // 1-oxaspiro[4.5]decane: the oxygen sits next to the spiro carbon.
    const start = carbocycle(6);
    const anchor = start.atomIds[0]!;
    const result = spiroRingAtAtom(start, anchor, {
      size: 5,
      elements: ["N", "O", "C"],
    });
    const elements = result.ringAtomIds.map(
      (id) => M.requireAtom(result.molecule, id).element,
    );
    expect(elements).toEqual(["C", "O", "C", "C", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Immutability and ids
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("never mutates the input molecule", () => {
    const start = carbocycle(6);
    const snapshot = JSON.parse(JSON.stringify(start)) as unknown;
    fuseRingOnBond(start, start.bondIds[0]!, "benzene");
    attachRingToAtom(start, start.atomIds[0]!, "cyclopentane");
    spiroRingAtAtom(start, start.atomIds[0]!, "cyclopropane");
    appendChain(start, start.atomIds[0]!, 3);
    expect(JSON.parse(JSON.stringify(start))).toEqual(snapshot);
    expect(M.atomCount(start)).toBe(6);
    expect(M.bondCount(start)).toBe(6);
  });

  it("mints ids from the target's own counter and never reuses one", () => {
    const start = carbocycle(6);
    const fused = fuseRingOnBond(start, start.bondIds[0]!, "benzene");
    expectFreshIds(start, fused);
    const attached = attachRingToAtom(fused.molecule, start.atomIds[3]!, "cyclopentane");
    expectFreshIds(fused.molecule, attached);
    const spiro = spiroRingAtAtom(attached.molecule, start.atomIds[4]!, "cyclopropane");
    expectFreshIds(attached.molecule, spiro);
    const chain = appendChain(spiro.molecule, start.atomIds[5]!, 3);
    expectFreshIds(spiro.molecule, chain);

    // Across the whole sequence every id is distinct.
    const mol = chain.molecule;
    expect(new Set(mol.atomIds).size).toBe(mol.atomIds.length);
    expect(new Set(mol.bondIds).size).toBe(mol.bondIds.length);
    expect(new Set([...mol.atomIds, ...mol.bondIds]).size).toBe(
      mol.atomIds.length + mol.bondIds.length,
    );
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("caller errors throw", () => {
  const start = carbocycle(6);

  it("rejects an unknown bond id", () => {
    expect(() => fuseRingOnBond(start, "b999", "benzene")).toThrow(/b999/);
  });

  it("rejects an unknown atom id", () => {
    expect(() => attachRingToAtom(start, "a999", "benzene")).toThrow(/a999/);
    expect(() => spiroRingAtAtom(start, "a999", "benzene")).toThrow(/a999/);
    expect(() => appendChain(start, "a999", 2)).toThrow(/a999/);
  });

  it("rejects a ring smaller than three atoms", () => {
    expect(() => fuseRingOnBond(start, start.bondIds[0]!, { size: 2 })).toThrow(
      /at least 3/,
    );
    expect(() => attachRingToAtom(start, start.atomIds[0]!, { size: 0 })).toThrow(
      /at least 3/,
    );
  });

  it("rejects a non-integer ring size", () => {
    expect(() => attachRingToAtom(start, start.atomIds[0]!, { size: 5.5 })).toThrow(
      /whole number/,
    );
  });

  it("rejects a fractional chain length", () => {
    // The same guard the ring path puts on `size`, so the module has one
    // policy rather than two: `for (i < 2.5)` silently rounds up to three
    // atoms, and `Infinity` never comes back at all.
    expect(() => appendChain(start, start.atomIds[0]!, 2.5)).toThrow(/whole number/);
    expect(() => appendChain(start, start.atomIds[0]!, Infinity)).toThrow(
      /whole number/,
    );
  });

  it("rejects an unknown template name", () => {
    expect(() =>
      attachRingToAtom(start, start.atomIds[0]!, "cyclononane" as RingTemplateName),
    ).toThrow(/template/);
  });

  it("rejects a fusion across a zero-length bond", () => {
    // Two atoms on the same coordinate — an import with duplicate positions.
    // The perpendicular bisector is undefined, so there is no ring to place.
    const degenerate = buildMolecule((b) => {
      const a = b.atom("C", ORIGIN);
      const c = b.atom("C", ORIGIN);
      b.bond(a, c, 1);
    });
    expect(() => fuseRingOnBond(degenerate, degenerate.bondIds[0]!, "benzene")).toThrow(
      /zero length/,
    );
  });

  it("answers isDegenerateBond exactly where fuseRingOnBond throws", () => {
    // The predicate exists so a UI can refuse the gesture in its own words
    // instead of catching an exception out of a pointer handler, which is only
    // worth anything if the two agree. Asserted as agreement rather than as
    // two independent expectations, so a change to the epsilon on one side
    // cannot pass.
    const coincident = buildMolecule((b) => {
      const a = b.atom("C", ORIGIN);
      const c = b.atom("C", ORIGIN);
      b.bond(a, c, 1);
    });
    const real = benzene();

    for (const mol of [coincident, real]) {
      for (const bondId of mol.bondIds) {
        let threw = false;
        try {
          fuseRingOnBond(mol, bondId, "cyclohexane");
        } catch (error) {
          threw = /zero length/.test(String(error));
        }
        expect(isDegenerateBond(mol, bondId)).toBe(threw);
      }
    }

    // A bond the molecule does not have: degenerate rather than a throw, so a
    // pre-flight question about a stale id is answerable.
    expect(isDegenerateBond(real, "b999")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Odd Kekule rings: cyclopentadiene (decision 231)
// ---------------------------------------------------------------------------

/** Atoms of `ringAtomIds` that carry more than one double bond. */
function cumulatedAtoms(mol: Molecule, ringAtomIds: readonly AtomId[]): AtomId[] {
  return ringAtomIds.filter(
    (id) => M.bondsAt(mol, id).filter((bond) => bond.order === 2).length > 1,
  );
}

describe("cyclopentadiene", () => {
  it("draws free cyclopentadiene, C5H6, with its sp3 carbon at vertex 0", () => {
    const mol = templateRing("cyclopentadiene");
    expect(molecularFormula(mol)).toBe("C5H6");
    expect(doubleBondCount(mol)).toBe(2);
    expect(valenceIssues(mol)).toEqual([]);
    expect(M.bondsAt(mol, mol.atomIds[0]!).every((bond) => bond.order === 1)).toBe(true);
  });

  it("draws a free benzene identical to the builder's", () => {
    const fromTemplate = templateRing("benzene", 1.5, vec(2, 3));
    const built = benzene(1.5, vec(2, 3));
    expect(M.bonds(fromTemplate).map((bond) => bond.order)).toEqual(
      M.bonds(built).map((bond) => bond.order),
    );
    expect(M.atoms(fromTemplate).map((atom) => atom.pos)).toEqual(
      M.atoms(built).map((atom) => atom.pos),
    );
  });

  it("attaches as cyclopenta-1,3-dien-1-yl: methylcyclopentadiene, C6H8", () => {
    const result = attachRingToAtom(singleAtom("C"), "a1", "cyclopentadiene");
    const mol = result.molecule;
    expect(molecularFormula(mol)).toBe("C6H8");
    expect(cumulatedAtoms(mol, result.ringAtomIds)).toEqual([]);
    expect(valenceIssues(mol)).toEqual([]);
    // The attachment carbon is sp2: the diene starts at it.
    const attached = result.ringAtomIds[0]!;
    expect(M.bondsAt(mol, attached).some((bond) => bond.order === 2)).toBe(true);
  });

  it("fused onto a Kekule double bond of benzene gives indene, C9H8", () => {
    const start = benzene();
    const doubleId = start.bondIds.find((id) => M.requireBond(start, id).order === 2)!;
    const result = fuseRingOnBond(start, doubleId, "cyclopentadiene");
    const mol = result.molecule;
    expect(molecularFormula(mol)).toBe("C9H8");
    expect(cumulatedAtoms(mol, result.ringAtomIds)).toEqual([]);
    expect(valenceIssues(mol)).toEqual([]);
    // Benzene's three doubles plus ONE in the new ring.
    expect(doubleBondCount(mol)).toBe(4);
  });

  it("fused onto a Kekule single bond of benzene still gives indene", () => {
    const start = benzene();
    const singleId = start.bondIds.find((id) => M.requireBond(start, id).order === 1)!;
    const result = fuseRingOnBond(start, singleId, "cyclopentadiene");
    expect(molecularFormula(result.molecule)).toBe("C9H8");
    expect(valenceIssues(result.molecule)).toEqual([]);
  });

  it("makes a spiro centre with four single bonds: spiro[4.4]nona-1,3-diene", () => {
    const start = carbocycle(5);
    const result = spiroRingAtAtom(start, start.atomIds[0]!, "cyclopentadiene");
    const mol = result.molecule;
    expect(molecularFormula(mol)).toBe("C9H12");
    expect(valenceIssues(mol)).toEqual([]);
    expect(M.bondsAt(mol, start.atomIds[0]!).every((bond) => bond.order === 1)).toBe(true);
    expect(doubleBondCount(mol)).toBe(2);
  });

  it("leaves even Kekule rings strictly alternating", () => {
    // The guard is for odd rings only: benzene keeps its three doubles.
    const result = attachRingToAtom(singleAtom("C"), "a1", "benzene");
    expect(doubleBondCount(result.molecule)).toBe(3);
  });
});

describe("cyclooctane", () => {
  it("attaches a saturated eight-membered ring: methylcyclooctane, C9H18", () => {
    const result = attachRingToAtom(singleAtom("C"), "a1", "cyclooctane");
    expect(result.ringAtomIds).toHaveLength(8);
    expect(molecularFormula(result.molecule)).toBe("C9H18");
    expect(doubleBondCount(result.molecule)).toBe(0);
  });
});
