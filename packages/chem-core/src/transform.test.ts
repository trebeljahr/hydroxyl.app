import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, carbocycle, linearChain } from "./builders.js";
import * as M from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import {
  atomsCentroid,
  flipAtoms,
  horizontalMirror,
  rotateAtoms,
  translateAtoms,
  verticalMirror,
} from "./transform.js";
import { setDoubleBondSide } from "./ops.js";
import { approxEqual, DEG, distance, ORIGIN, vec, type Vec2 } from "./vec.js";

/**
 * Coordinates here are order 1 (one bond length), so a double's resolution is
 * about 2e-16. Twelve chained rotations, each a handful of multiply-adds,
 * accumulate at most a few times 1e-15. 1e-12 leaves three orders of headroom
 * for that while still being far tighter than any real defect: a shear or a
 * per-atom-bearing snap moves atoms by 1e-2 or more, not 1e-12.
 */
const ROUND_TRIP_EPS = 1e-12;

function posOf(mol: Molecule, id: AtomId): Vec2 {
  return M.requireAtom(mol, id).pos;
}

function positionsOf(mol: Molecule, ids: readonly AtomId[]): Vec2[] {
  return ids.map((id) => posOf(mol, id));
}

/** Sorted point list, so two drawings can be compared as point SETS. */
function sortedPositions(points: readonly Vec2[]): Vec2[] {
  return [...points].sort((a, b) => a.x - b.x || a.y - b.y);
}

function expectSamePointSet(
  actual: readonly Vec2[],
  expected: readonly Vec2[],
  eps = ROUND_TRIP_EPS,
): void {
  const a = sortedPositions(actual);
  const b = sortedPositions(expected);
  expect(a.length).toBe(b.length);
  a.forEach((point, index) => {
    expect(approxEqual(point, b[index]!, eps)).toBe(true);
  });
}

function bondLengths(mol: Molecule): number[] {
  return M.bonds(mol).map((bond) =>
    distance(posOf(mol, bond.from), posOf(mol, bond.to)),
  );
}

/**
 * Bromochlorofluoromethane: a genuine stereocentre with all three heavy
 * substituents explicit, so both wedge and hash are present to mirror.
 * Hydrogen stays implicit, as everywhere in chem-core.
 */
function bromochlorofluoromethane(): {
  mol: Molecule;
  c: AtomId;
  f: AtomId;
  cl: AtomId;
  br: AtomId;
} {
  let c = "";
  let f = "";
  let cl = "";
  let br = "";
  const mol = buildMolecule((b) => {
    c = b.atom("C", ORIGIN);
    f = b.atom("F", vec(1, 0));
    cl = b.atom("Cl", vec(-0.5, 0.866));
    br = b.atom("Br", vec(-0.5, -0.866));
    b.bond(c, f, 1);
    b.bond(c, cl, 1, "hash");
    b.bond(c, br, 1, "wedge");
  });
  return { mol, c, f, cl, br };
}

function stereoOf(mol: Molecule, a: AtomId, b: AtomId): string {
  const bond = M.bondBetween(mol, a, b);
  if (!bond) throw new Error(`no bond between ${a} and ${b}`);
  return bond.stereo;
}

/** Every transform is a pure geometry edit: topology must be byte-identical. */
function expectTopologyPreserved(before: Molecule, after: Molecule): void {
  expect(after.atomIds).toEqual(before.atomIds);
  expect(after.bondIds).toEqual(before.bondIds);
  expect(after.nextId).toBe(before.nextId);
  for (const id of before.bondIds) {
    const b = M.requireBond(before, id);
    const a = M.requireBond(after, id);
    expect(a.from).toBe(b.from);
    expect(a.to).toBe(b.to);
    expect(a.order).toBe(b.order);
  }
}

describe("atomsCentroid", () => {
  it("finds the ring centre of benzene", () => {
    const mol = benzene(1, vec(3, -2));
    expect(approxEqual(atomsCentroid(mol, mol.atomIds), vec(3, -2))).toBe(true);
  });

  it("is ORIGIN for an empty or fully stale list", () => {
    const mol = benzene();
    expect(atomsCentroid(mol, [])).toEqual(ORIGIN);
    expect(atomsCentroid(mol, ["a999", "a1000"])).toEqual(ORIGIN);
  });

  it("ignores repeated ids rather than weighting them", () => {
    const mol = benzene();
    const [a, b] = mol.atomIds as [AtomId, AtomId];
    expect(atomsCentroid(mol, [a, b, a, b])).toEqual(atomsCentroid(mol, [a, b]));
  });
});

describe("rotateAtoms", () => {
  it("returns benzene to its original coordinates after twelve 30 degree steps", () => {
    const mol = benzene();
    const pivot = atomsCentroid(mol, mol.atomIds);
    let rotated = mol;
    for (let i = 0; i < 12; i++) {
      rotated = rotateAtoms(rotated, rotated.atomIds, pivot, 30 * DEG);
    }
    mol.atomIds.forEach((id) => {
      expect(approxEqual(posOf(rotated, id), posOf(mol, id), ROUND_TRIP_EPS)).toBe(
        true,
      );
    });
  });

  it("maps benzene onto itself as a point set under a 60 degree rotation", () => {
    const mol = benzene();
    const pivot = atomsCentroid(mol, mol.atomIds);
    const rotated = rotateAtoms(mol, mol.atomIds, pivot, 60 * DEG);
    expectSamePointSet(
      positionsOf(rotated, rotated.atomIds),
      positionsOf(mol, mol.atomIds),
    );
    // The individual atoms did move; it is the ring as a whole that is invariant.
    expect(approxEqual(posOf(rotated, mol.atomIds[0]!), posOf(mol, mol.atomIds[0]!)))
      .toBe(false);
  });

  it("preserves every bond length in cyclohexane", () => {
    const mol = carbocycle(6);
    const before = bondLengths(mol);
    const rotated = rotateAtoms(mol, mol.atomIds, vec(0.7, -1.3), 37 * DEG);
    bondLengths(rotated).forEach((len, index) => {
      expect(Math.abs(len - before[index]!)).toBeLessThan(ROUND_TRIP_EPS);
    });
  });

  it("snaps the requested angle down to 15 degrees, not each atom's bearing", () => {
    const mol = benzene();
    const pivot = atomsCentroid(mol, mol.atomIds);
    const snapped = rotateAtoms(mol, mol.atomIds, pivot, 17 * DEG, {
      snap: 15 * DEG,
    });
    const exact = rotateAtoms(mol, mol.atomIds, pivot, 15 * DEG);
    expect(positionsOf(snapped, mol.atomIds)).toEqual(positionsOf(exact, mol.atomIds));
  });

  it("snaps a 23 degree request up to 30 degrees", () => {
    const mol = benzene();
    const pivot = atomsCentroid(mol, mol.atomIds);
    const snapped = rotateAtoms(mol, mol.atomIds, pivot, 23 * DEG, {
      snap: 15 * DEG,
    });
    const exact = rotateAtoms(mol, mol.atomIds, pivot, 30 * DEG);
    expect(positionsOf(snapped, mol.atomIds)).toEqual(positionsOf(exact, mol.atomIds));
  });

  it("leaves the structure rigid when snapping a partial selection", () => {
    // A per-atom bearing snap would move the two ring atoms by different
    // amounts and change the C-C distance between them.
    const mol = benzene();
    const [a, b] = mol.atomIds as [AtomId, AtomId];
    const rotated = rotateAtoms(mol, [a, b], ORIGIN, 17 * DEG, { snap: 15 * DEG });
    expect(
      Math.abs(
        distance(posOf(rotated, a), posOf(rotated, b)) -
          distance(posOf(mol, a), posOf(mol, b)),
      ),
    ).toBeLessThan(ROUND_TRIP_EPS);
  });

  it("does not touch bond stereo: an in-plane rotation preserves chirality", () => {
    const { mol, c, br, cl } = bromochlorofluoromethane();
    const rotated = rotateAtoms(mol, mol.atomIds, ORIGIN, 90 * DEG);
    expect(stereoOf(rotated, c, br)).toBe("wedge");
    expect(stereoOf(rotated, c, cl)).toBe("hash");
  });

  it("preserves topology", () => {
    const mol = benzene();
    expectTopologyPreserved(mol, rotateAtoms(mol, mol.atomIds, ORIGIN, 42 * DEG));
  });
});

describe("translateAtoms", () => {
  it("moves exactly the listed atoms and shares the rest by identity", () => {
    const mol = linearChain(6);
    const [c1, c2, c3, c4, c5, c6] = mol.atomIds as [
      AtomId,
      AtomId,
      AtomId,
      AtomId,
      AtomId,
      AtomId,
    ];
    const delta = vec(2, -3);
    const moved = translateAtoms(mol, [c1, c2, c3], delta);

    for (const id of [c1, c2, c3]) {
      expect(posOf(moved, id)).toEqual({
        x: posOf(mol, id).x + delta.x,
        y: posOf(mol, id).y + delta.y,
      });
    }
    // Structural sharing: untouched atoms are the very same objects.
    for (const id of [c4, c5, c6]) {
      expect(M.requireAtom(moved, id)).toBe(M.requireAtom(mol, id));
    }
  });

  it("does not touch bond stereo", () => {
    const { mol, c, br, cl } = bromochlorofluoromethane();
    const moved = translateAtoms(mol, mol.atomIds, vec(5, 5));
    expect(stereoOf(moved, c, br)).toBe("wedge");
    expect(stereoOf(moved, c, cl)).toBe("hash");
  });

  it("preserves topology", () => {
    const mol = benzene();
    expectTopologyPreserved(mol, translateAtoms(mol, mol.atomIds, vec(1, 1)));
  });
});

describe("no-op transforms", () => {
  it("returns the input molecule when nothing actually moves", () => {
    // These are the frames the editor generates constantly: a drag that has
    // not crossed a pixel yet, and a rotation still short of the first snap
    // step. Rebuilding every selected atom for them repaints the canvas for
    // nothing, which is the cost setAtomPositions in ops.ts also declines.
    const mol = benzene();
    const pivot = atomsCentroid(mol, mol.atomIds);
    expect(translateAtoms(mol, mol.atomIds, vec(0, 0))).toBe(mol);
    expect(rotateAtoms(mol, mol.atomIds, pivot, 0)).toBe(mol);
    expect(
      rotateAtoms(mol, mol.atomIds, pivot, 3 * DEG, { snap: 15 * DEG }),
    ).toBe(mol);
  });

  it("leaves an atom sitting exactly on the mirror axis untouched", () => {
    // Hydrogen cyanide drawn straight up the y axis: a vertical mirror through
    // the origin maps every atom to itself, so there is nothing to allocate.
    const hcn = buildMolecule((b) => {
      const c = b.atom("C", vec(0, 0));
      const n = b.atom("N", vec(0, 1));
      b.bond(c, n, 3);
    });
    expect(flipAtoms(hcn, hcn.atomIds, verticalMirror(ORIGIN))).toBe(hcn);
  });
});

describe("flipAtoms", () => {
  it("negates x offsets about the centroid and leaves y alone", () => {
    const mol = benzene(1, vec(4, 1));
    const centre = atomsCentroid(mol, mol.atomIds);
    const flipped = flipAtoms(mol, mol.atomIds, verticalMirror(centre));
    mol.atomIds.forEach((id) => {
      const before = posOf(mol, id);
      const after = posOf(flipped, id);
      expect(after.x).toBeCloseTo(2 * centre.x - before.x, 12);
      expect(after.y).toBeCloseTo(before.y, 12);
    });
  });

  it("negates y offsets across the horizontal mirror", () => {
    const mol = carbocycle(6);
    const flipped = flipAtoms(mol, mol.atomIds, horizontalMirror(ORIGIN));
    mol.atomIds.forEach((id) => {
      expect(approxEqual(posOf(flipped, id), {
        x: posOf(mol, id).x,
        y: -posOf(mol, id).y,
      })).toBe(true);
    });
  });

  it("swaps wedge and hash on a fully mirrored bond", () => {
    const { mol, c, f, cl, br } = bromochlorofluoromethane();
    const flipped = flipAtoms(mol, [c, f, cl, br], verticalMirror(ORIGIN));
    expect(stereoOf(flipped, c, br)).toBe("hash");
    expect(stereoOf(flipped, c, cl)).toBe("wedge");
    expect(stereoOf(flipped, c, f)).toBe("none");
  });

  it("swaps a manual double-bond side on a fully mirrored bond", () => {
    // `left` and `right` name a side of the bond's own axis, not of the page,
    // so a reflection reverses which physical side they mean. Leaving the word
    // as drawn would put the inner line of the C=O on the wrong side of the
    // mirror image — a figure that renders perfectly and is not the mirror of
    // what the chemist drew.
    const acid = buildMolecule((b) => {
      const methyl = b.atom("C", vec(0, 0));
      const carboxyl = b.atom("C", vec(0.87, 0.5));
      const carbonyl = b.atom("O", vec(0.87, 1.5));
      const hydroxyl = b.atom("O", vec(1.73, 0));
      b.bond(methyl, carboxyl);
      b.bond(carboxyl, carbonyl, 2);
      b.bond(carboxyl, hydroxyl);
    });
    const carbonylBond = acid.bondIds[1]!;
    const sided = setDoubleBondSide(acid, carbonylBond, "left");
    const axis = verticalMirror(atomsCentroid(sided, sided.atomIds));

    const flipped = flipAtoms(sided, sided.atomIds, axis);
    expect(M.requireBond(flipped, carbonylBond).doubleBondSide).toBe("right");

    // Two mirrors about the same axis are the identity, for the side as much
    // as for the coordinates.
    const back = flipAtoms(flipped, flipped.atomIds, axis);
    expect(M.requireBond(back, carbonylBond).doubleBondSide).toBe("left");

    // `auto` is symmetric: there is no side stored to reverse.
    expect(M.requireBond(flipped, acid.bondIds[0]!).doubleBondSide).toBe("auto");
  });

  it("leaves a half-mirrored bond's double-bond side alone", () => {
    // Only one endpoint moves, so the bond is stretched rather than mirrored
    // and there is nothing to reverse — the same rule as for stereo.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      const c2 = b.atom("C", vec(1, 0));
      b.bond(c1, c2, 2);
    });
    const sided = setDoubleBondSide(mol, mol.bondIds[0]!, "left");
    const flipped = flipAtoms(sided, [mol.atomIds[0]!], verticalMirror(ORIGIN));
    expect(M.requireBond(flipped, mol.bondIds[0]!).doubleBondSide).toBe("left");
  });

  it("leaves a half-mirrored bond's stereo alone", () => {
    // Only the carbon and the bromine move, so C-Br is mirrored but C-Cl is
    // merely stretched — there is no enantiomer statement to invert on it.
    const { mol, c, cl, br } = bromochlorofluoromethane();
    const flipped = flipAtoms(mol, [c, br], verticalMirror(ORIGIN));
    expect(stereoOf(flipped, c, br)).toBe("hash");
    expect(stereoOf(flipped, c, cl)).toBe("hash");
  });

  it("restores coordinates and stereo when applied twice about the same axis", () => {
    const { mol, c, f, cl, br } = bromochlorofluoromethane();
    const axis = verticalMirror(vec(0.25, -0.75));
    const there = flipAtoms(mol, mol.atomIds, axis);
    const back = flipAtoms(there, there.atomIds, axis);
    mol.atomIds.forEach((id) => {
      expect(approxEqual(posOf(back, id), posOf(mol, id), ROUND_TRIP_EPS)).toBe(true);
    });
    expect(stereoOf(back, c, br)).toBe("wedge");
    expect(stereoOf(back, c, cl)).toBe("hash");
    expect(stereoOf(back, c, f)).toBe("none");
  });

  it("mirrors across a slanted axis without changing bond lengths", () => {
    const mol = benzene();
    const before = bondLengths(mol);
    const flipped = flipAtoms(mol, mol.atomIds, {
      point: vec(0.4, 0.9),
      direction: vec(2, 1),
    });
    bondLengths(flipped).forEach((len, index) => {
      expect(Math.abs(len - before[index]!)).toBeLessThan(ROUND_TRIP_EPS);
    });
  });

  it("returns the molecule unchanged for a zero-length axis direction", () => {
    const mol = benzene();
    const flipped = flipAtoms(mol, mol.atomIds, {
      point: ORIGIN,
      direction: ORIGIN,
    });
    expect(flipped).toBe(mol);
    // And emphatically no NaN coordinates.
    M.positions(flipped).forEach((p) => {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    });
  });

  it("preserves topology", () => {
    const mol = benzene();
    expectTopologyPreserved(mol, flipAtoms(mol, mol.atomIds, verticalMirror(ORIGIN)));
  });
});

describe("stale and empty selections", () => {
  const mol = benzene();

  it("returns the same molecule object for an empty id list", () => {
    expect(translateAtoms(mol, [], vec(1, 1))).toBe(mol);
    expect(rotateAtoms(mol, [], ORIGIN, 45 * DEG)).toBe(mol);
    expect(flipAtoms(mol, [], verticalMirror(ORIGIN))).toBe(mol);
  });

  it("returns the same molecule object when no id exists", () => {
    const ghosts = ["a900", "b901"];
    expect(translateAtoms(mol, ghosts, vec(1, 1))).toBe(mol);
    expect(rotateAtoms(mol, ghosts, ORIGIN, 45 * DEG)).toBe(mol);
    expect(flipAtoms(mol, ghosts, verticalMirror(ORIGIN))).toBe(mol);
  });

  it("still moves the live ids in a partly stale list", () => {
    const [first] = mol.atomIds as [AtomId];
    const moved = translateAtoms(mol, [first, "a900"], vec(1, 0));
    expect(posOf(moved, first).x).toBeCloseTo(posOf(mol, first).x + 1, 12);
    expect(M.atomCount(moved)).toBe(M.atomCount(mol));
  });

  it("never mutates the input molecule", () => {
    const ethanol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", vec(0.87, 0.5));
      const o = b.atom("O", vec(1.73, 0));
      b.bond(c1, c2, 1);
      b.bond(c2, o, 1);
    });
    const snapshot = M.positions(ethanol).map((p) => ({ ...p }));
    translateAtoms(ethanol, ethanol.atomIds, vec(9, 9));
    rotateAtoms(ethanol, ethanol.atomIds, ORIGIN, 90 * DEG);
    flipAtoms(ethanol, ethanol.atomIds, horizontalMirror(ORIGIN));
    expect(M.positions(ethanol)).toEqual(snapshot);
  });
});
