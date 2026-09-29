import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain, singleAtom } from "./builders.js";
import * as M from "./molecule.js";
import {
  angularGaps,
  bondDirections,
  DEFAULT_ANGLE_STEP,
  defaultSproutAngle,
  defaultSproutPosition,
  fanDirections,
  fanSectors,
  hydrogenFan,
  sprout,
  sproutDrag,
  sproutTo,
  type SproutTarget,
} from "./sprout.js";
import { ringCentroid, ringsAtAtom } from "./rings.js";
import { rotateAtoms } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount, valenceIssues } from "./valence.js";
import {
  angleOf,
  approxEqual,
  cross,
  DEG,
  distance,
  fromPolar,
  normalizeAngle,
  normalizeAnglePositive,
  ORIGIN,
  sub,
  toDegrees,
  vec,
  type Vec2,
} from "./vec.js";

/**
 * Coordinates are order 1 (one bond length), so a double resolves them to
 * about 2e-16 and the few trig calls behind a sprout accumulate no more than a
 * handful of ulps. 1e-9 is far tighter than any real defect here — picking the
 * wrong 120 degree branch or dropping the snap reference moves a point by 1e-1
 * or more, never 1e-9.
 */
const EPS = 1e-9;

/**
 * Ids interleave atoms and bonds — the builder mints both from one counter —
 * so a three-atom chain is a1, a2, a4, not a1, a2, a3, and lexicographic order
 * would put "a10" before "a9" besides. Positions in `atomIds` are the only
 * safe way to name an atom in a test.
 */
function lastAtomId(mol: Molecule): AtomId {
  return mol.atomIds[mol.atomIds.length - 1]!;
}

function posOf(mol: Molecule, id: AtomId): Vec2 {
  return M.requireAtom(mol, id).pos;
}

/** Offset to the first bonded neighbour: the reference a drag snaps against. */
function firstBondDirection(mol: Molecule, atomId: AtomId): Vec2 {
  const bond = M.bondsAt(mol, atomId)[0]!;
  return sub(posOf(mol, M.otherEnd(bond, atomId)), posOf(mol, atomId));
}

/** Unsigned separation of two bearings, in degrees. */
function degreesBetween(a: number, b: number): number {
  return Math.abs(toDegrees(normalizeAngle(a - b)));
}

function expectRingClosure(
  target: SproutTarget,
): Extract<SproutTarget, { kind: "ring-closure" }> {
  if (target.kind !== "ring-closure") {
    throw new Error(`expected a ring closure, got "${target.kind}"`);
  }
  return target;
}

/**
 * Cyclopentane with one bond left out: five carbons on a regular pentagon, so
 * the two open ends sit exactly one bond length apart. Dragging one end onto
 * the other is the ring-closing gesture, and the pentagon's 108 degree
 * interior angle is deliberately NOT on the 30 degree snap lattice, so the
 * snapped point and the atom it merges with are not the same point.
 */
function pentagonChain(): Molecule {
  const radius = 1 / (2 * Math.sin(Math.PI / 5));
  return buildMolecule((b) => {
    const ids: AtomId[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / 5;
      ids.push(b.atom("C", fromPolar(angle, radius)));
    }
    for (let i = 0; i < 4; i++) b.bond(ids[i]!, ids[i + 1]!, 1);
  });
}

/** Neopentane's quaternary carbon: four bonds already, no valence left over. */
function quaternaryCarbon(): Molecule {
  return buildMolecule((b) => {
    const centre = b.atom("C", ORIGIN);
    for (let i = 0; i < 4; i++) {
      b.bond(centre, b.atom("C", fromPolar((i * Math.PI) / 2)));
    }
  });
}

describe("defaultSproutAngle", () => {
  it("grows along +x from an isolated atom", () => {
    const mol = singleAtom("C", vec(2, -1));
    const id = mol.atomIds[0]!;
    expect(defaultSproutAngle(mol, id)).toBe(0);
    expect(approxEqual(defaultSproutPosition(mol, id), vec(3, -1), EPS)).toBe(
      true,
    );
  });

  it("turns 120 degrees off the single bond of a two-atom molecule", () => {
    const mol = buildMolecule((b) => {
      b.bond(b.atom("C", ORIGIN), b.atom("C", vec(1, 0)));
    });
    const [head, tail] = [mol.atomIds[0]!, mol.atomIds[1]!];

    // Neither end has another substituent to lean away from, so both take the
    // counter-clockwise convention off their own bond direction.
    expect(toDegrees(defaultSproutAngle(mol, head))).toBeCloseTo(120, 9);
    expect(
      degreesBetween(
        defaultSproutAngle(mol, tail),
        angleOf(firstBondDirection(mol, tail)),
      ),
    ).toBeCloseTo(120, 9);
  });

  it("continues a chain's zig-zag instead of doubling it back", () => {
    // Propane drawn the usual way: (0,0), (0.866,0.5), (1.732,0). The terminus
    // must grow up-and-right at +30 degrees, to (2.598, 0.5). The other 120
    // degree branch points straight down at -90 and would coil the chain.
    const propane = linearChain(3);
    const terminus = lastAtomId(propane);
    expect(approxEqual(posOf(propane, terminus), vec(1.7320508, 0), 1e-6)).toBe(
      true,
    );

    expect(toDegrees(defaultSproutAngle(propane, terminus))).toBeCloseTo(30, 9);
    expect(
      approxEqual(
        defaultSproutPosition(propane, terminus),
        vec(2.5980762, 0.5),
        1e-6,
      ),
    ).toBe(true);
  });

  it("puts the new bond opposite the neighbour's other substituent", () => {
    const butane = linearChain(4);
    const ids = butane.atomIds;
    const terminus = ids[3]!;
    const neighbor = ids[2]!;
    const nextNearest = ids[1]!;

    const axis = sub(posOf(butane, neighbor), posOf(butane, terminus));
    const grown = sub(
      defaultSproutPosition(butane, terminus),
      posOf(butane, terminus),
    );
    const toNextNearest = sub(
      posOf(butane, nextNearest),
      posOf(butane, terminus),
    );

    expect(degreesBetween(angleOf(grown), angleOf(axis))).toBeCloseTo(120, 9);

    // Opposite sides of the terminus->neighbour axis: that anti arrangement IS
    // the zig-zag, and it is what the sign test in sprout.ts is choosing.
    const grownSide = Math.sign(cross(axis, grown));
    const chainSide = Math.sign(cross(axis, toNextNearest));
    expect(grownSide).not.toBe(0);
    expect(grownSide).toBe(-chainSide);
  });

  it("continues the zig-zag past a branch point, where the average cancels", () => {
    // Propane with a methyl on the middle carbon — "draw a chain, add a
    // methyl, extend the chain", which is about as ordinary as this editor's
    // gestures get. The branched neighbour's two other substituents sit
    // SYMMETRICALLY about the terminus->neighbour axis (that is where `sprout`
    // put the methyl, at the free vertex), so their unit average cancels and
    // has no side. Turning counter-clockwise regardless would repeat the
    // previous turn and bend the backbone 60 degrees at the branch.
    const propane = linearChain(3);
    const branched = sprout(propane, propane.atomIds[1]!).molecule;
    const terminus = propane.atomIds[2]!;

    expect(toDegrees(defaultSproutAngle(branched, terminus))).toBeCloseTo(30, 9);

    // ...which is the far side of the axis from the backbone, exactly as at an
    // unbranched terminus: the tie is broken on the first substituent in bond
    // order, and for a chain that is the backbone being extended.
    const axis = sub(posOf(branched, propane.atomIds[1]!), posOf(branched, terminus));
    const grown = sub(defaultSproutPosition(branched, terminus), posOf(branched, terminus));
    const backbone = sub(posOf(branched, propane.atomIds[0]!), posOf(branched, terminus));
    expect(Math.sign(cross(axis, grown))).toBe(-Math.sign(cross(axis, backbone)));
  });

  it("sprouts into the free vertex of a trigonal centre", () => {
    // Two substituents 120 degrees apart, at 90 and 210: the sp2 skeleton of a
    // carbonyl carbon. Exactly one vertex is left, at -30 degrees.
    const mol = buildMolecule((b) => {
      const centre = b.atom("C", ORIGIN);
      b.bond(centre, b.atom("C", fromPolar(90 * DEG)));
      b.bond(centre, b.atom("C", fromPolar(210 * DEG)));
    });
    const centre = mol.atomIds[0]!;

    expect(toDegrees(defaultSproutAngle(mol, centre))).toBeCloseTo(-30, 9);
    expect(
      approxEqual(
        defaultSproutPosition(mol, centre),
        fromPolar(-30 * DEG),
        EPS,
      ),
    ).toBe(true);
  });

  it("breaks the tie at a linear centre the same way whatever the bond order", () => {
    // An allene's central carbon: two gaps of exactly 180 degrees, no vertex
    // more free than the other. The first gap in sorted-angle order wins, so
    // the answer does not depend on which bond was drawn first.
    const build = (leftFirst: boolean): Molecule =>
      buildMolecule((b) => {
        const centre = b.atom("C", ORIGIN);
        const ends: Vec2[] = leftFirst
          ? [vec(-1, 0), vec(1, 0)]
          : [vec(1, 0), vec(-1, 0)];
        for (const end of ends) b.bond(centre, b.atom("C", end), 2);
      });

    const forward = build(false);
    const reversed = build(true);
    expect(toDegrees(defaultSproutAngle(forward, forward.atomIds[0]!))).toBeCloseTo(
      90,
      9,
    );
    expect(defaultSproutAngle(reversed, reversed.atomIds[0]!)).toBeCloseTo(
      defaultSproutAngle(forward, forward.atomIds[0]!),
      12,
    );
  });
});

describe("sproutDrag", () => {
  it("snaps to the fragment's own bonds, not to the page", () => {
    // The headline case. A fragment rotated to 17 degrees to fit a figure must
    // keep growing bonds at 17 + 30k degrees so it stays internally clean.
    // Snapping the pointer's absolute bearing would give 30k instead and put
    // the new bond square with the page and crooked with the molecule.
    const upright = linearChain(4);
    const tilted = rotateAtoms(upright, upright.atomIds, ORIGIN, 17 * DEG);
    const terminus = lastAtomId(tilted);
    const reference = angleOf(firstBondDirection(tilted, terminus));

    const target = sproutDrag(tilted, terminus, vec(6, 1));
    expect(target.kind).toBe("new-atom");

    // Relative to the fragment: a whole number of 30 degree steps.
    const stepsFromReference =
      normalizeAngle(target.angle - reference) / DEFAULT_ANGLE_STEP;
    expect(stepsFromReference).toBeCloseTo(Math.round(stepsFromReference), 9);

    // Relative to the page: 17 degrees off every multiple of 30, i.e. exactly
    // the fragment's own tilt, carried through untouched.
    const degreesPastStep = ((toDegrees(target.angle) % 30) + 30) % 30;
    expect(degreesPastStep).toBeCloseTo(17, 6);
  });

  it("keeps the endpoint one bond length out however far the pointer is", () => {
    const mol = singleAtom("C", vec(-3, 4));
    const id = mol.atomIds[0]!;
    for (const pointer of [vec(97, 40), vec(-3.02, 4.01), vec(-9, -20)]) {
      expect(distance(posOf(mol, id), sproutDrag(mol, id, pointer).pos)).toBeCloseTo(
        1,
        9,
      );
    }
    const longer = sproutDrag(mol, id, vec(97, 40), { bondLength: 1.5 });
    expect(distance(posOf(mol, id), longer.pos)).toBeCloseTo(1.5, 9);
  });

  it("answers a pointer that has not moved with the click direction", () => {
    const propane = linearChain(3);
    const terminus = lastAtomId(propane);
    const target = sproutDrag(propane, terminus, posOf(propane, terminus));
    expect(target.angle).toBeCloseTo(defaultSproutAngle(propane, terminus), 12);
  });

  it("reports a ring closure when the drag lands on the far end of a chain", () => {
    const chain = pentagonChain();
    const head = chain.atomIds[0]!;
    const tail = chain.atomIds[4]!;
    expect(distance(posOf(chain, head), posOf(chain, tail))).toBeCloseTo(1, 9);
    expect(M.areBonded(chain, head, tail)).toBe(false);

    const target = expectRingClosure(
      sproutDrag(chain, head, posOf(chain, tail)),
    );
    expect(target.atomId).toBe(tail);
    expect(target.alreadyBonded).toBe(false);

    // The existing atom's position, NOT the snapped point — merging is
    // target-wins, so the structure must not jump under the cursor. The two
    // genuinely differ here: 108 degrees snaps to 120.
    expect(approxEqual(target.pos, posOf(chain, tail), EPS)).toBe(true);
    const trueBearing = angleOf(sub(posOf(chain, tail), posOf(chain, head)));
    expect(degreesBetween(target.angle, trueBearing)).toBeCloseTo(12, 6);
  });

  it("flags a drag onto an atom it is already bonded to", () => {
    // A benzene neighbour sits exactly one bond length away, so the gesture
    // lands on it perfectly — and merging it would collapse the bond between
    // them into a self-bond, which is why the flag exists.
    const ring = benzene();
    const start = ring.atomIds[0]!;
    const neighbor = M.neighborIds(ring, start)[0]!;

    const target = expectRingClosure(
      sproutDrag(ring, start, posOf(ring, neighbor)),
    );
    expect(target.atomId).toBe(neighbor);
    expect(target.alreadyBonded).toBe(true);
  });
});

describe("sprout and sproutTo", () => {
  it("mints an atom and a bond for a new-atom target", () => {
    const mol = singleAtom("C");
    const id = mol.atomIds[0]!;
    const target = sproutDrag(mol, id, vec(0.3, 0.6));

    const result = sproutTo(mol, id, target, { element: "O", order: 2 });
    expect(result.createdAtom).toBe(true);
    expect(M.atomCount(result.molecule)).toBe(2);
    expect(M.bondCount(result.molecule)).toBe(1);
    expect(M.requireAtom(result.molecule, result.atomId).element).toBe("O");
    const bond = M.requireBond(result.molecule, result.bondId);
    expect(bond.order).toBe(2);
    // Narrow end of any later wedge sits at the atom sprouted from.
    expect(bond.from).toBe(id);
    expect(bond.to).toBe(result.atomId);

    // The input is untouched: sprouting is pure like every other edit.
    expect(M.atomCount(mol)).toBe(1);
  });

  it("closes a ring by adding a bond and no atom", () => {
    const chain = pentagonChain();
    const head = chain.atomIds[0]!;
    const tail = chain.atomIds[4]!;
    const target = sproutDrag(chain, head, posOf(chain, tail));

    const result = sproutTo(chain, head, target);
    expect(result.createdAtom).toBe(false);
    expect(result.atomId).toBe(tail);
    expect(M.atomCount(result.molecule)).toBe(M.atomCount(chain));
    expect(M.bondCount(result.molecule)).toBe(M.bondCount(chain) + 1);
    expect(M.areBonded(result.molecule, head, tail)).toBe(true);
    expect(M.ringCount(result.molecule)).toBe(1);
    expect(M.bondCount(chain)).toBe(4);
  });

  it("throws rather than commit a ring closure onto a bonded atom", () => {
    const ring = benzene();
    const start = ring.atomIds[0]!;
    const neighbor = M.neighborIds(ring, start)[0]!;
    const target = sproutDrag(ring, start, posOf(ring, neighbor));

    // The UI is expected to have read `alreadyBonded` on the drag frame and
    // refused the gesture; getting here at all is a programming error.
    expect(() => sproutTo(ring, start, target)).toThrow(/already bonded/i);
  });

  it("grows a bond in the default direction on a bare click", () => {
    const propane = linearChain(3);
    const terminus = lastAtomId(propane);

    const result = sprout(propane, terminus);
    expect(result.createdAtom).toBe(true);
    expect(
      approxEqual(
        posOf(result.molecule, result.atomId),
        vec(2.5980762, 0.5),
        1e-6,
      ),
    ).toBe(true);
    expect(M.requireAtom(result.molecule, result.atomId).element).toBe("C");
    expect(distance(posOf(result.molecule, terminus), posOf(result.molecule, result.atomId))).toBeCloseTo(
      1,
      9,
    );
  });

  it("never blocks a sprout on valence", () => {
    // A quaternary carbon has no room by any valence rule, and the editor
    // still has to let the pen move: over-valence is reported by
    // `valenceIssues`, never prevented here. sprout.ts does not import
    // valence.ts at all — this test is the only place the two policies meet.
    const mol = quaternaryCarbon();
    const centre = mol.atomIds[0]!;

    const fifth = sprout(mol, centre);
    const sixth = sprout(fifth.molecule, centre);
    expect(fifth.createdAtom).toBe(true);
    expect(sixth.createdAtom).toBe(true);
    expect(M.degree(sixth.molecule, centre)).toBe(6);

    const issues = valenceIssues(sixth.molecule).filter(
      (issue) => issue.atomId === centre,
    );
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
  });
});

describe("fanDirections", () => {
  const degrees = (angles: readonly number[]): number[] =>
    angles.map((a) => Math.round(normalizeAnglePositive(a) / DEG)).sort((x, y) => x - y);

  it("spreads a free atom's hydrogens evenly round the whole circle", () => {
    // METHANE. Slotting four directions INTO the single 2PI gap the way a
    // bounded gap is slotted would leave a double-width hole where the wrap
    // is, and the four hydrogens would crowd into three quarters of the
    // circle. Dividing the circle by N is what gives methane its cross.
    expect(degrees(fanDirections([], 4))).toEqual([0, 90, 180, 270]);
    // Water, drawn as a bare oxygen: H–O–H, with the two lone pairs free to
    // take north and south.
    expect(degrees(fanDirections([], 2))).toEqual([0, 180]);
    expect(degrees(fanDirections([], 1))).toEqual([0]);
    expect(fanDirections([], 0)).toEqual([]);
  });

  it("puts a benzene CH's single hydrogen on the exocyclic bisector", () => {
    // Two ring bonds 120 degrees apart leave a 240-degree gap; its bisector is
    // the direction pointing straight out of the ring.
    const ringBonds = [fromPolar(60 * DEG), fromPolar(180 * DEG)];
    expect(degrees(fanDirections(ringBonds, 1))).toEqual([300]);
  });

  it("puts both of a CH2's hydrogens in the one big gap, not one each side", () => {
    // Allocation is widest-FIRST by the width each gap would give its own
    // slots, so the 240-degree gap takes both before the 120-degree one takes
    // any. Splitting them would put a hydrogen inside the chain's own angle.
    const chainBonds = [fromPolar(60 * DEG), fromPolar(180 * DEG)];
    expect(degrees(fanDirections(chainBonds, 2))).toEqual([260, 340]);
  });

  it("fans a terminal methyl's three hydrogens away from its one bond", () => {
    const single = [fromPolar(0)];
    expect(degrees(fanDirections(single, 3))).toEqual([90, 180, 270]);
  });

  it("is stable under repetition and under input order", () => {
    // The output is committed as coordinates in an exported figure, so the
    // same atom has to fan the same way every time — including when the bonds
    // arrive in a different order.
    const bonds = [fromPolar(10 * DEG), fromPolar(130 * DEG), fromPolar(250 * DEG)];
    const once = degrees(fanDirections(bonds, 2));
    expect(degrees(fanDirections(bonds, 2))).toEqual(once);
    expect(degrees(fanDirections([...bonds].reverse(), 2))).toEqual(once);
  });
});

describe("fanSectors", () => {
  const inDegrees = (angle: number): number => Math.round(normalizeAnglePositive(angle) / DEG);
  const sectorsOf = (mol: Molecule, atomId: AtomId) =>
    fanSectors(bondDirections(mol, atomId), implicitHydrogenCount(mol, atomId)).map((s) => ({
      angle: inDegrees(s.angle),
      start: inDegrees(s.start),
      width: Math.round(s.width / DEG),
    }));

  it("bounds each of ethanol's methylene hydrogens by the C–C and C–O bonds", () => {
    // The methylene's bonds are 120 degrees apart, so both hydrogens share
    // the one 240-degree gap, and the gap's two edges ARE those bonds: a
    // hydrogen turned past either edge would sit between a carbon and an
    // oxygen it was drawn outside of.
    let methylene: AtomId = "";
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", vec(0, 0));
      methylene = b.atom("C", vec(Math.cos(30 * DEG), Math.sin(30 * DEG)));
      const o = b.atom("O", vec(2 * Math.cos(30 * DEG), 0));
      b.bond(c1, methylene, 1);
      b.bond(methylene, o, 1);
    });
    const sectors = sectorsOf(mol, methylene);
    expect(sectors).toHaveLength(2);
    for (const sector of sectors) {
      // The bond to the oxygen points at 330 degrees and the bond back to C1
      // at 210, so the open side runs 330 -> 210 through north.
      expect(sector.start).toBe(330);
      expect(sector.width).toBe(240);
    }
    expect(sectors.map((s) => s.angle)).toEqual([50, 130]);
  });

  it("gives benzene's hydrogen the exocyclic gap and nothing inside the ring", () => {
    const mol = benzene();
    const atomId = mol.atomIds[0]!;
    const [sector] = sectorsOf(mol, atomId);
    expect(sector?.width).toBe(240);
    // The hydrogen is on the bisector, 120 degrees from either ring bond.
    expect(normalizeAnglePositive((sector!.angle - sector!.start) * DEG) / DEG).toBeCloseTo(120, 9);
  });

  it("agrees with fanDirections angle for angle", () => {
    const bonds = [fromPolar(10 * DEG), fromPolar(130 * DEG), fromPolar(250 * DEG)];
    expect(fanSectors(bonds, 2).map((s) => s.angle)).toEqual(fanDirections(bonds, 2));
  });

  it("leaves methane's hydrogens a whole turn each, since no bond bounds them", () => {
    const sectors = fanSectors([], 4);
    expect(sectors.map((s) => s.width)).toEqual([2 * Math.PI, 2 * Math.PI, 2 * Math.PI, 2 * Math.PI]);
    for (const sector of sectors) {
      expect(sector.start + Math.PI).toBeCloseTo(sector.angle, 12);
    }
  });
});

describe("hydrogenFan", () => {
  /** Decalin's carbon skeleton, flat: two hexagons sharing a vertical bond,
   *  with the two junction carbons returned by name. */
  function decalin(): { readonly mol: Molecule; readonly top: AtomId; readonly bottom: AtomId } {
    let top: AtomId = "";
    let bottom: AtomId = "";
    const mol = buildMolecule((b) => {
      const apothem = Math.cos(30 * DEG);
      const at = (cx: number, degrees: number): Vec2 =>
        vec(cx + Math.cos(degrees * DEG), Math.sin(degrees * DEG));
      // The shared edge is the left ring's 30- and 330-degree vertices, which
      // are the right ring's 150- and 210-degree ones.
      const left = [30, 90, 150, 210, 270, 330].map((d) => b.atom("C", at(-apothem, d)));
      top = left[0]!;
      bottom = left[5]!;
      const right = [top, ...[90, 30, 330, 270].map((d) => b.atom("C", at(apothem, d))), bottom];
      for (const ring of [left, right]) {
        for (let i = 0; i < 6; i++) {
          // The shared bond closes the left ring; the right ring must not
          // draw it a second time.
          if (ring === right && i === 5) continue;
          b.bond(ring[i]!, ring[(i + 1) % 6]!, 1);
        }
      }
    });
    return { mol, top, bottom };
  }

  it("puts a ring-fusion hydrogen outside both rings, at every rotation", () => {
    // Each junction has three bonds and three 120-degree gaps, two of them
    // ring interiors. Which one the bonds alone pick is a tie broken by start
    // angle, so it depends on how the drawing happens to sit on the page:
    // square to it the exterior wins, and at six of these nine rotations the
    // bonds alone put the top junction's hydrogen inside a ring. Nine
    // rotations, 40 degrees apart, as the renderer's crowding sweep uses.
    const outside = (mol: Molecule, atomId: AtomId, angle: number): boolean =>
      ringsAtAtom(mol, atomId).every((index) => {
        const towards = sub(ringCentroid(mol, index), mol.atoms[atomId]!.pos);
        return fromPolar(angle).x * towards.x + fromPolar(angle).y * towards.y < 0;
      });
    const base = decalin();
    let bondsAloneWentInside = 0;
    for (let step = 0; step < 9; step++) {
      const mol = rotateAtoms(base.mol, base.mol.atomIds, ORIGIN, step * 40 * DEG);
      for (const junction of [base.top, base.bottom]) {
        expect(implicitHydrogenCount(mol, junction)).toBe(1);
        const [sector] = hydrogenFan(mol, junction, 1);
        expect(outside(mol, junction, sector!.angle), `${junction} at ${step * 40}`).toBe(true);
        // The gap it may turn in is bounded by the two outer ring bonds, not
        // by the invented ring directions: 120 degrees wide.
        expect(sector!.width / DEG).toBeCloseTo(120, 9);
        const [alone] = fanSectors(bondDirections(mol, junction), 1);
        if (!outside(mol, junction, alone!.angle)) bondsAloneWentInside++;
      }
    }
    // The sweep reaches the case it is for.
    expect(bondsAloneWentInside).toBeGreaterThan(0);
  });

  it("fans a plain ring vertex exactly as the bonds alone would", () => {
    // Benzene's CH and decalin's CH2s already had their hydrogens in the
    // exterior gap; counting the interior as occupied must not move them by
    // so much as an ulp, or every explicit-H golden would re-bless.
    const ring = benzene();
    for (const atomId of ring.atomIds) {
      expect(hydrogenFan(ring, atomId, 1)).toEqual(fanSectors(bondDirections(ring, atomId), 1));
    }
    const { mol, top, bottom } = decalin();
    for (const atomId of mol.atomIds) {
      if (atomId === top || atomId === bottom) continue;
      expect(hydrogenFan(mol, atomId, 2)).toEqual(fanSectors(bondDirections(mol, atomId), 2));
    }
  });

  it("leaves an acyclic atom's fan alone", () => {
    const chain = linearChain(3);
    const middle = chain.atomIds[1]!;
    expect(hydrogenFan(chain, middle, 2)).toEqual(fanSectors(bondDirections(chain, middle), 2));
  });
});

describe("angularGaps", () => {
  it("lists every gap round a branch carbon, bisectors included", () => {
    // Isobutane's central carbon, drawn with its three bonds 120 degrees
    // apart: three gaps, whichever one a fan would pick.
    const bonds = [fromPolar(90 * DEG), fromPolar(210 * DEG), fromPolar(330 * DEG)];
    const gaps = angularGaps(bonds);
    expect(gaps.map((g) => Math.round(normalizeAnglePositive(g.angle) / DEG)).sort((a, b) => a - b)).toEqual([30, 150, 270]);
    for (const gap of gaps) expect(gap.width / DEG).toBeCloseTo(120, 9);
  });

  it("is the gap list fanSectors allocates among", () => {
    const bonds = [fromPolar(10 * DEG), fromPolar(130 * DEG), fromPolar(250 * DEG)];
    for (const sector of fanSectors(bonds, 2)) {
      expect(angularGaps(bonds).some((g) => g.start === sector.start && g.width === sector.width)).toBe(true);
    }
    expect(angularGaps([])).toEqual([]);
  });
});
