/**
 * Stereochemistry perception, asserted on real compounds.
 *
 * Every fixture here is a molecule with a name and a known answer, because the
 * failure mode this module has to be protected from is a descriptor that is
 * confidently wrong. A synthetic graph can only tell you that the code did
 * something; (R)-bromochlorofluoromethane can tell you it did the right thing,
 * and the sign of the chiral volume is exactly the kind of mistake that
 * renders perfectly.
 */

import { describe, expect, it } from "vitest";

import { kekulize } from "./aromatic.js";
import { benzene, buildMolecule } from "./builders.js";
import { flipBond, setAtomPosition, setBondStereo } from "./ops.js";
import { requireAtom } from "./molecule.js";
import {
  cipDescriptor,
  descriptorText,
  doubleBondDescriptor,
  stereocenterAtoms,
  stereoGroupCoverage,
  stereogenicBonds,
  structuralIssues,
  wedgelessStereoGroupAtoms,
} from "./stereo.js";
import type { StereoDescriptor } from "./stereo.js";
import { ABS_STEREO_GROUP_INDEX, withStereoGroups } from "./stereo-groups.js";
import { flipAtoms, verticalMirror } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";
import { DEG, fromPolar, ORIGIN } from "./vec.js";
import type { Vec2 } from "./vec.js";

/** One unit-length step from `from`, at `degrees` counter-clockwise from +x. */
function step(from: Vec2, degrees: number): Vec2 {
  const d = fromPolar(degrees * DEG, 1);
  return { x: from.x + d.x, y: from.y + d.y };
}

function kindOf(descriptor: StereoDescriptor | undefined): string {
  return descriptor === undefined ? "none" : descriptor.kind;
}

/**
 * Bromochlorofluoromethane, drawn as the textbook picture of R.
 *
 * Br north on a WEDGE (so toward the reader), Cl to the lower right, F to the
 * lower left, and the implicit hydrogen therefore behind the page. Priorities
 * are Br > Cl > F > H by atomic number alone, needing no digraph at all, and
 * Br -> Cl -> F traced on the page runs clockwise. That is R, and it is the one
 * assertion in this file that pins the SIGN of the chiral volume: get it
 * backwards and every descriptor in the repo is the enantiomer's, drawn
 * perfectly.
 */
function bromochlorofluoromethaneR() {
  return buildMolecule((b) => {
    const carbon = b.atom("C", ORIGIN);
    b.bond(carbon, b.atom("Br", step(ORIGIN, 90)), 1, "wedge");
    b.bond(carbon, b.atom("Cl", step(ORIGIN, -30)), 1);
    b.bond(carbon, b.atom("F", step(ORIGIN, 210)), 1);
  });
}

/** Butan-2-ol, hydroxyl on a wedge from C2 — the chem-render fixture. */
function butan2olWedged() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", ORIGIN);
    const c2Pos = step(ORIGIN, 30);
    const c2 = b.atom("C", c2Pos);
    const c3Pos = step(c2Pos, -30);
    const c3 = b.atom("C", c3Pos);
    const c4 = b.atom("C", step(c3Pos, 30));
    const oxygen = b.atom("O", step(c2Pos, 90));
    b.bond(c1, c2, 1);
    b.bond(c2, oxygen, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
  });
}

/**
 * Propan-2-ol: the same skeleton with the ethyl cut back to a methyl.
 *
 * Two methyls on the carbinol carbon, so it is NOT a stereocentre however it
 * is drawn — the case the acceptance criteria name, and the one a coin-flip
 * implementation gets wrong by calling it R or S at random.
 */
function propan2olWedged() {
  return buildMolecule((b) => {
    const c1 = b.atom("C", ORIGIN);
    const c2Pos = step(ORIGIN, 30);
    const c2 = b.atom("C", c2Pos);
    const c3 = b.atom("C", step(c2Pos, -30));
    const oxygen = b.atom("O", step(c2Pos, 90));
    b.bond(c1, c2, 1);
    b.bond(c2, oxygen, 1, "wedge");
    b.bond(c2, c3, 1);
  });
}

/**
 * Glyceraldehyde with the hydroxyl on a wedge from C2.
 *
 * The smallest molecule whose ranking NEEDS the duplicated-atom convention: an
 * aldehyde carbon has one real oxygen and one duplicate of it, and only that
 * duplicate lifts it above a hydroxymethyl's single oxygen plus two hydrogens.
 *
 * C3 sits at −40°, not −30°. With C1 at 150° and C3 at −30° the chain runs
 * straight through C2, an exact T: which end leans toward the reader is not
 * drawn, so that drawing fits both enantiomers and reads `ambiguous-geometry`
 * (pinned in "the shared lift" below). Ten degrees off the line it is S, and
 * RDKit get_stereo_tags agrees.
 */
function glyceraldehydeWedged(c3Degrees = -40) {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c1 = b.atom("C", step(ORIGIN, 150));
    b.bond(c1, b.atom("O", step(step(ORIGIN, 150), 90)), 2);
    const c3 = b.atom("C", step(ORIGIN, c3Degrees));
    b.bond(c3, b.atom("O", step(step(ORIGIN, c3Degrees), -90)), 1);
    b.bond(c2, c1, 1);
    b.bond(c2, c3, 1);
    b.bond(c2, b.atom("O", step(ORIGIN, 90)), 1, "wedge");
  });
}

/**
 * 2-butene with both methyls on the SAME side of the double bond: cis, Z.
 *
 * Drawn as a chemist draws it — the double bond horizontal, both substituents
 * going up — so the only input to the answer is the coordinates, which is the
 * whole claim.
 */
function cis2Butene() {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c3 = b.atom("C", { x: 1, y: 0 });
    b.bond(c2, c3, 2);
    b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
    b.bond(c3, b.atom("C", step({ x: 1, y: 0 }, 60)), 1);
  });
}

/** 2-butene with the methyls on opposite sides: trans, E. */
function trans2Butene() {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c3 = b.atom("C", { x: 1, y: 0 });
    b.bond(c2, c3, 2);
    b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
    b.bond(c3, b.atom("C", step({ x: 1, y: 0 }, -60)), 1);
  });
}

/**
 * 1-bromo-3-fluoro-4-methylpentane, or its bromine-free control.
 *
 * The smallest acyclic molecule that separates a sphere-by-sphere CIP
 * comparison from a depth-first one. C3 carries F (on a wedge), an implicit H,
 * an isopropyl group and a 2-bromoethyl chain. Sphere 2 already decides the
 * two carbon branches — isopropyl is (C,C,H) against 2-bromoethyl's (C,H,H) —
 * so the bromine two spheres further out is never consulted, and swapping it
 * for a plain methyl must not move the letter.
 */
function bromofluoromethylpentane(terminal: "Br" | "C") {
  return buildMolecule((b) => {
    const centre = b.atom("C", ORIGIN);
    b.bond(centre, b.atom("F", step(ORIGIN, 90)), 1, "wedge");

    const isopropylPos = step(ORIGIN, 210);
    const isopropyl = b.atom("C", isopropylPos);
    b.bond(centre, isopropyl, 1);
    b.bond(isopropyl, b.atom("C", step(isopropylPos, 150)), 1);
    b.bond(isopropyl, b.atom("C", step(isopropylPos, 270)), 1);

    const c2Pos = step(ORIGIN, -30);
    const c2 = b.atom("C", c2Pos);
    b.bond(centre, c2, 1);
    const c1Pos = step(c2Pos, 30);
    const c1 = b.atom("C", c1Pos);
    b.bond(c2, c1, 1);
    b.bond(c1, b.atom(terminal, step(c1Pos, -30)), 1);
  });
}

/**
 * 2-methylcyclohexan-1-ol, hydroxyl on a wedge and the methyl as given.
 *
 * A ring pair whose two centres tie for several spheres before they separate.
 * `"wedge"` puts the OH and the methyl on wedges at adjacent ring atoms, so
 * both groups are on one face: the CIS diastereomer, C[C@@H]1CCCC[C@@H]1O as
 * RDKit reads the same picture. `"hash"` is the trans one.
 */
function methylcyclohexanol(methyl: "wedge" | "hash") {
  return buildMolecule((b) => {
    const ring: string[] = [];
    for (let i = 0; i < 6; i++) ring.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
    for (let i = 0; i < 6; i++) b.bond(ring[i]!, ring[(i + 1) % 6]!, 1);
    b.bond(ring[0]!, b.atom("O", fromPolar(0, 2)), 1, "wedge");
    b.bond(ring[1]!, b.atom("C", fromPolar(60 * DEG, 2)), 1, methyl);
  });
}

/**
 * `rings` cyclohexanes fused in a line: decalin at 2, perhydroanthracene at 3.
 *
 * Built by laying each hexagon down and reusing the two vertices its
 * predecessor already placed, so the shared edge is a real shared bond rather
 * than a coincident pair.
 */
function fusedAcene(rings: number) {
  const positions: Vec2[] = [];
  const edges: [number, number][] = [];
  const indexAt = (p: Vec2): number => {
    const found = positions.findIndex(
      (q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6,
    );
    if (found !== -1) return found;
    positions.push(p);
    return positions.length - 1;
  };
  for (let r = 0; r < rings; r++) {
    const centre = { x: r * Math.sqrt(3), y: 0 };
    const vertices: number[] = [];
    for (let k = 0; k < 6; k++) {
      const offset = fromPolar((30 + 60 * k) * DEG, 1);
      vertices.push(indexAt({ x: centre.x + offset.x, y: centre.y + offset.y }));
    }
    for (let k = 0; k < 6; k++) {
      const pair: [number, number] = [vertices[k]!, vertices[(k + 1) % 6]!];
      const already = edges.some(
        ([x, y]) =>
          (x === pair[0] && y === pair[1]) || (x === pair[1] && y === pair[0]),
      );
      if (!already) edges.push(pair);
    }
  }
  return buildMolecule((b) => {
    const ids = positions.map((p) => b.atom("C", p));
    for (const [x, y] of edges) b.bond(ids[x]!, ids[y]!, 1);
  });
}

describe("stereocenterAtoms", () => {
  it("finds the carbinol carbon of butan-2-ol and nothing else", () => {
    const mol = butan2olWedged();
    // C2: methyl, ethyl, hydroxyl, implicit H — four distinguishable
    // substituents, and telling the methyl from the ethyl already needs the
    // second sphere.
    expect(stereocenterAtoms(mol)).toEqual(["a2"]);
  });

  it("does not call propan-2-ol's carbinol carbon a stereocentre", () => {
    // Two methyls. Proven identical by the comparator, so this is `undefined`
    // — "not stereogenic" — rather than an undetermined descriptor.
    expect(stereocenterAtoms(propan2olWedged())).toEqual([]);
    expect(cipDescriptor(propan2olWedged(), "a2")).toBeUndefined();
  });

  it("counts the implicit hydrogen as the fourth substituent", () => {
    // A CH stereocentre has three drawn neighbours. Anything that required
    // four drawn bonds would find no stereocentre in the whole corpus.
    const mol = bromochlorofluoromethaneR();
    expect(stereocenterAtoms(mol)).toEqual(["a1"]);
  });

  it("ignores an sp2 carbon and an amine nitrogen", () => {
    // Acetaldehyde's carbonyl carbon has three substituents and a double bond;
    // the nitrogen of methylamine has three plus a lone pair, and inverts.
    const acetaldehyde = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      b.bond(c1, b.atom("O", step(ORIGIN, 90)), 2);
      b.bond(c1, b.atom("C", step(ORIGIN, -30)), 1);
    });
    expect(stereocenterAtoms(acetaldehyde)).toEqual([]);

    const methylamine = buildMolecule((b) => {
      const n = b.atom("N", ORIGIN);
      b.bond(n, b.atom("C", step(ORIGIN, 30)), 1);
    });
    expect(stereocenterAtoms(methylamine)).toEqual([]);
  });

  it("keeps a stereocentre nobody drew a wedge on", () => {
    // Flat butan-2-ol is still butan-2-ol: the centre exists, the drawing
    // simply declines to say which enantiomer. Dropping it here is how a
    // legitimate wedge would later get reported as a drawing error.
    const flat = setBondStereo(butan2olWedged(), "b7", "none");
    expect(stereocenterAtoms(flat)).toEqual(["a2"]);
    expect(cipDescriptor(flat, "a2")).toEqual({
      kind: "undetermined",
      reason: "no-stereo-bond",
    });
  });
});

describe("cipDescriptor", () => {
  it("reads R off the textbook drawing of R", () => {
    expect(cipDescriptor(bromochlorofluoromethaneR(), "a1")).toEqual({ kind: "R" });
  });

  it("calls the wedged butan-2-ol fixture R, which is what it depicts", () => {
    // Worth spelling the letter out rather than asserting "some letter": the
    // priorities are O > ethyl > methyl > H, the hydroxyl is north on a wedge
    // with the ethyl to the south-east and the methyl to the south-west, and
    // 1 -> 2 -> 3 traced with the hydrogen behind the page runs clockwise. The
    // chem-render fixture of the same name draws exactly this molecule, so its
    // contact-sheet descriptor has to read (R) too.
    expect(cipDescriptor(butan2olWedged(), "a2")).toEqual({ kind: "R" });
  });

  it("calls the wedged glyceraldehyde S, the other way round from butan-2-ol", () => {
    // Same wedge to the north, but the aldehyde outranks the hydroxymethyl and
    // sits to the north-west rather than the south-east, which reverses the
    // sense: 1 -> 2 -> 3 runs counter-clockwise. Two fixtures whose only real
    // difference is the arrangement, giving opposite letters, is what shows
    // the volume is being read rather than a constant returned.
    expect(cipDescriptor(glyceraldehydeWedged(), "a1")).toEqual({ kind: "S" });
  });

  it("gives the enantiomer when the drawing alone is mirrored", () => {
    // Pure geometry, with the marks left exactly as drawn: reflecting x while
    // a wedge still means "toward the reader" reflects the structure in three
    // dimensions, and a reflected chirality centre is the other enantiomer.
    // This is the assertion that catches a parity reader ignoring coordinates.
    let mol = bromochlorofluoromethaneR();
    for (const id of mol.atomIds) {
      const { x, y } = requireAtom(mol, id).pos;
      mol = setAtomPosition(mol, id, { x: -x, y });
    }
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "S" });
  });

  it("is preserved by flipAtoms, which mirrors the marks along with the page", () => {
    // `flipAtoms` reflects the positions AND exchanges wedge for hash. Negating
    // x and z together is a half turn about y — a rotation, not a reflection —
    // so the flipped drawing depicts the SAME enantiomer, laid out the other
    // way round. Recorded here rather than argued: this is the first code in
    // the repo that can tell the two apart, and transform.ts's own comment
    // reads the other way. See the escalation attached to this change.
    const mol = bromochlorofluoromethaneR();
    const flipped = flipAtoms(mol, mol.atomIds, verticalMirror(ORIGIN));
    expect(cipDescriptor(flipped, "a1")).toEqual({ kind: "R" });
  });

  it("inverts when the wedge is turned round", () => {
    // `flipBond` swaps from/to and deliberately leaves the stereo string
    // alone, so the same wedge now points out of the oxygen instead of out of
    // the carbon: the narrow end moves, and with it the whole claim.
    const mol = butan2olWedged();
    const before = cipDescriptor(mol, "a2");
    expect(kindOf(before)).toMatch(/^[RS]$/);

    const flipped = flipBond(mol, "b7");
    // The wedge now starts at the oxygen, so C2 has no mark of its own left.
    expect(cipDescriptor(flipped, "a2")).toEqual({
      kind: "undetermined",
      reason: "no-stereo-bond",
    });
  });

  it("swaps R for S when the wedge becomes a hash", () => {
    const wedged = butan2olWedged();
    const hashed = setBondStereo(wedged, "b7", "hash");
    const a = cipDescriptor(wedged, "a2");
    const b = cipDescriptor(hashed, "a2");
    expect(kindOf(a)).toMatch(/^[RS]$/);
    expect(kindOf(b)).toMatch(/^[RS]$/);
    expect(kindOf(a)).not.toBe(kindOf(b));
  });

  it("reads a wavy bond at a centre as a mixture of epimers, not as an undrawn wedge (decision 39)", () => {
    const wavy = setBondStereo(butan2olWedged(), "b7", "wavy");
    expect(cipDescriptor(wavy, "a2")).toEqual({ kind: "mixture", of: "epimers" });
    // Still a stereocentre, and distinct from "no stereo bond drawn".
    expect(stereocenterAtoms(wavy)).toContain("a2");
    const flat = setBondStereo(butan2olWedged(), "b7", "none");
    expect(cipDescriptor(flat, "a2")).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    // A mixture renders no letter: the wavy bond is the statement.
    expect(descriptorText(cipDescriptor(wavy, "a2"))).toBeUndefined();
  });

  it("refuses a centre whose marks contradict each other", () => {
    // A wedge to the hydroxyl and a hash to C1 leaves the implicit hydrogen
    // with no side to be on. Reading a letter out of that is inventing one.
    let mol = butan2olWedged();
    mol = setBondStereo(mol, "b6", "hash"); // C1-C2, narrow end at C1
    mol = flipBond(mol, "b6"); // now narrow end at C2, so the hash counts here
    expect(cipDescriptor(mol, "a2")).toEqual({
      kind: "undetermined",
      reason: "ambiguous-geometry",
    });
  });

  it("ranks a carbonyl branch above an ether branch, via duplicated atoms", () => {
    // Glyceraldehyde's C2: CHO, CH2OH, OH, H. Without the duplicate-atom
    // convention the aldehyde carbon reads (O, H) and loses to the
    // hydroxymethyl's (O, H, H) on count, which is the wrong way round — and
    // the wrong way round here flips the letter, not merely the ranking.
    const mol = glyceraldehydeWedged();
    expect(stereocenterAtoms(mol)).toContain("a1");
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "S" });
  });

  it("terminates on a ring and assigns a ring stereocentre", () => {
    // 1-methyl-2-chlorocyclohexane's C1. Ring traversal without ring-closure
    // duplicates does not terminate at all; this is the assertion that it does.
    const mol = buildMolecule((b) => {
      const ids = [];
      for (let i = 0; i < 6; i++) ids.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
      for (let i = 0; i < 6; i++) b.bond(ids[i]!, ids[(i + 1) % 6]!, 1);
      b.bond(ids[0]!, b.atom("C", fromPolar(0, 2)), 1, "wedge");
      b.bond(ids[1]!, b.atom("Cl", fromPolar(60 * DEG, 2)), 1);
    });
    expect(stereocenterAtoms(mol)).toEqual(["a1", "a2"]);
    // Pinned as a LETTER, not as /[RS]/. A ranking bug on a ring produces a
    // confident wrong letter and a regex that accepts either one waves it
    // through, which is how a depth-first comparator survived review here.
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "S" });
  });

  it("assigns both centres of cis-2-methylcyclohexan-1-ol", () => {
    // RDKit reads this drawing as C[C@@H]1CCCC[C@@H]1O — (1S,2R). Ring
    // stereocentres tie for several spheres before they separate, which is
    // exactly where a comparator that looks deep before it looks wide gets
    // the letter backwards.
    const mol = methylcyclohexanol("wedge");
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "S" });
    expect(cipDescriptor(mol, "a2")).toEqual({ kind: "R" });
  });

  it("assigns both centres of the trans diastereomer differently", () => {
    // The same skeleton with the methyl turned to a hash, trans, is
    // C[C@H]1CCCC[C@@H]1O — (1S,2S). Two diastereomers that share a
    // constitution have to come out different or the perception is not
    // reading the drawing at all.
    const mol = methylcyclohexanol("hash");
    expect(cipDescriptor(mol, "a1")).toEqual({ kind: "S" });
    expect(cipDescriptor(mol, "a2")).toEqual({ kind: "S" });
  });

  it("lets a near sphere settle the ranking before a far one votes", () => {
    // 1-bromo-3-fluoro-4-methylpentane, the smallest acyclic molecule that
    // separates a sphere-by-sphere comparison from a depth-first one.
    //
    // At the centre: F, H, isopropyl, and 2-bromoethyl. CIP rule 1 compares
    // the whole of sphere 2 first — isopropyl is (C,C,H), 2-bromoethyl is
    // (C,H,H) — so isopropyl outranks it and the bromine two spheres further
    // out never gets a vote. Priorities are F > iPr > CH2CH2Br > H, traced
    // counter-clockwise on the page with H behind it, which is S. RDKit reads
    // the same drawing as CC(C)[C@@H](F)CCBr and agrees.
    //
    // A depth-first walk resolves the senior child to its leaves first, finds
    // the bromine, and hands back R: a confident wrong letter, with nothing on
    // screen to suggest it. The control below removes the bromine and must not
    // change the answer.
    expect(cipDescriptor(bromofluoromethylpentane("Br"), "a1")).toEqual({ kind: "S" });
    expect(cipDescriptor(bromofluoromethylpentane("C"), "a1")).toEqual({ kind: "S" });
  });

  it("resolves a fused polycyclic instead of truncating it", () => {
    // Perhydroanthracene has exactly four stereogenic atoms, its ring-fusion
    // carbons, and RDKit reads the same four off the same structure. Decalin
    // has none: its two fusion carbons each see two constitutionally identical
    // ring branches.
    //
    // Paths through a fused system run far past a pyranose, and a sphere cap
    // tight enough to cut them off does not merely lose letters.
    // `stereocenterAtoms` counts an UNDETERMINED centre as a centre — so an
    // atom whose ranking was truncated is reported as stereogenic, and
    // `structuralIssues` then silently accepts a wedge drawn on it. At a cap
    // of ten spheres all fourteen of these carbons came back as truncated
    // stereocentres.
    //
    // Decalin's two fusion carbons ARE stereogenic: cis- and trans-decalin are
    // different compounds. Each sees two constitutionally identical ring
    // branches, so the pair is pseudoasymmetric, and RDKit labels a wedged
    // cis-decalin (4as,8as). Unwedged, both are undetermined, never dropped.
    const decalin = fusedAcene(2);
    expect(stereocenterAtoms(decalin)).toHaveLength(2);
    for (const id of stereocenterAtoms(decalin)) {
      expect(cipDescriptor(decalin, id)).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    }

    const mol = fusedAcene(3);
    const centres = stereocenterAtoms(mol);
    expect(centres).toHaveLength(4);
    for (const id of centres) {
      // No wedge is drawn on any of them, so the honest answer is that the
      // drawing does not say — NOT that the comparison ran out of road.
      expect(cipDescriptor(mol, id)).toEqual({
        kind: "undetermined",
        reason: "no-stereo-bond",
      });
    }
  });

  it("orders two branches that differ only by an isotope, by rule 2", () => {
    // 1-(13-C)-propan-2-ol: the two methyls differ by mass number alone. Rule
    // 2 ranks 13C (mass number 13) above natural C (standard weight 12.011).
    // RDKit get_stereo_tags reads this very drawing, written as a molblock, S.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN, { isotope: 13 });
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      const c3 = b.atom("C", step(c2Pos, -30));
      b.bond(c1, c2, 1);
      b.bond(c2, b.atom("O", step(c2Pos, 90)), 1, "wedge");
      b.bond(c2, c3, 1);
    });
    expect(cipDescriptor(mol, "a2")).toEqual({ kind: "S" });

    // A label within 0.5 of the standard weight is not ordered against an
    // unlabelled atom: 12C against C is refused, not guessed.
    const twelve = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN, { isotope: 12 });
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      b.bond(c1, c2, 1);
      b.bond(c2, b.atom("O", step(c2Pos, 90)), 1, "wedge");
      b.bond(c2, b.atom("C", step(c2Pos, -30)), 1);
    });
    expect(cipDescriptor(twelve, "a2")).toEqual({ kind: "undetermined", reason: "ranking-unsupported" });
  });
});

describe("stereogenicBonds and E/Z", () => {
  it("tells cis from trans 2-butene by coordinates alone", () => {
    // Neither molecule carries any stereo annotation: the answer comes out of
    // where the methyls were drawn, which is the acceptance criterion.
    expect(stereogenicBonds(cis2Butene())).toEqual(["b3"]);
    expect(doubleBondDescriptor(cis2Butene(), "b3")).toEqual({ kind: "Z" });
    expect(doubleBondDescriptor(trans2Butene(), "b3")).toEqual({ kind: "E" });
  });

  it("assigns E and Z by CIP priority, not by which substituent is drawn", () => {
    // 1-bromo-1-chloro-propene: at C1 the bromine outranks the chlorine, and
    // Z means the two SENIOR substituents are cis. Drawing the methyl cis to
    // the chlorine therefore gives Z, which a "cis means Z" shortcut misses.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", { x: 1, y: 0 });
      b.bond(c1, c2, 2);
      b.bond(c1, b.atom("Br", step(ORIGIN, 120)), 1);
      b.bond(c1, b.atom("Cl", step(ORIGIN, -120)), 1);
      b.bond(c2, b.atom("C", step({ x: 1, y: 0 }, 60)), 1);
    });
    // Br is up at C1, the methyl is up at C2: the two seniors are cis.
    expect(doubleBondDescriptor(mol, "b3")).toEqual({ kind: "Z" });
  });

  it("says nothing about a terminal alkene", () => {
    // Propene's =CH2 carries two identical hydrogens, so there is no geometry.
    const propene = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", { x: 1, y: 0 });
      b.bond(c1, c2, 2);
      b.bond(c2, b.atom("C", step({ x: 1, y: 0 }, 60)), 1);
    });
    expect(stereogenicBonds(propene)).toEqual([]);
    expect(doubleBondDescriptor(propene, "b3")).toBeUndefined();
  });

  it("says nothing about a benzene ring bond", () => {
    // Kekule is the storage form, so every ring bond here is a real order-2
    // bond with real coordinates. Only aromatic perception stops the pass
    // stamping E or Z on all three of them.
    expect(stereogenicBonds(benzene())).toEqual([]);
    expect(stereogenicBonds(kekulize(benzene()))).toEqual([]);
  });

  it("says nothing about a double bond inside a six-ring", () => {
    // Cyclohexene is cis because the ring holds it that way. Assigning Z
    // states as a finding what the drawing already forced.
    const cyclohexene = buildMolecule((b) => {
      const ids = [];
      for (let i = 0; i < 6; i++) ids.push(b.atom("C", fromPolar(i * 60 * DEG, 1)));
      b.bond(ids[0]!, ids[1]!, 2);
      for (let i = 1; i < 6; i++) b.bond(ids[i]!, ids[(i + 1) % 6]!, 1);
      b.bond(ids[2]!, b.atom("C", fromPolar(120 * DEG, 2)), 1);
      b.bond(ids[3]!, b.atom("Cl", fromPolar(180 * DEG, 2)), 1);
    });
    expect(stereogenicBonds(cyclohexene)).toEqual([]);
  });

  it("refuses a crossed double bond rather than reading its coordinates", () => {
    // `either` is V2000 code 3: the author is saying the geometry was never
    // determined. The atoms still sit somewhere, and believing them would
    // overrule an explicit refusal.
    const crossed = setBondStereo(cis2Butene(), "b3", "either");
    expect(stereogenicBonds(crossed)).toEqual(["b3"]);
    expect(doubleBondDescriptor(crossed, "b3")).toEqual({
      kind: "undetermined",
      reason: "unspecified",
    });
  });

  it("refuses when a wavy single bond hangs off a terminus", () => {
    const wavy = setBondStereo(cis2Butene(), "b5", "wavy");
    expect(doubleBondDescriptor(wavy, "b3")).toEqual({
      kind: "undetermined",
      reason: "unspecified",
    });
  });
});

describe("structuralIssues", () => {
  it("reports a wedge drawn on an atom that is not a stereocentre", () => {
    // Propan-2-ol's carbinol carbon bears two methyls: the wedge asserts a
    // configuration there is none of. This is the commonest drawing error in
    // a sketch, and it renders perfectly, so nothing but a report catches it.
    const issues = structuralIssues(propan2olWedged());
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("wedge-on-non-stereocenter");
    expect(issues[0]!.atomId).toBe("a2");
    expect(issues[0]!.bondId).toBe("b6");
    // AN ERROR since decision 77: the wedge names a configuration the
    // structure does not have, so the file would say what the author did not
    // draw. The axis report below is the warning — sound chemistry this build
    // cannot express — and the two are counted separately in the status bar.
    expect(issues[0]!.severity).toBe("error");
  });

  it("reports a wedge whose narrow end is at the wrong atom", () => {
    // Same molecule, same wedge, turned round: the stereocentre is now at the
    // WIDE end, which is the specific mistake and has its own fix.
    const backwards = flipBond(butan2olWedged(), "b7");
    const issues = structuralIssues(backwards);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("wedge-drawn-backwards");
    // Badged on the stereocentre, which is where the reader has to look.
    expect(issues[0]!.atomId).toBe("a2");
  });

  it("reports nothing on a correctly drawn stereocentre", () => {
    expect(structuralIssues(butan2olWedged())).toEqual([]);
    expect(structuralIssues(bromochlorofluoromethaneR())).toEqual([]);
  });

  it("says nothing about a wedge stored on a bond that is not single", () => {
    // `bondStereoFromCode` maps V2000 stereo code 1 to `wedge` whatever the
    // bond order is, so an imported file can carry one on a double bond.
    // chem-render deliberately draws that as an ordinary double — a triangle
    // there asserts a configuration nobody can read off it — and a badge for a
    // mark that is not on the canvas is one no edit to the drawing can clear.
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2 = b.atom("C", { x: 1, y: 0 });
      const c3 = b.atom("C", { x: 2, y: 0 });
      b.bond(c1, c2, 2, "wedge");
      b.bond(c2, c3, 1);
    });
    expect(structuralIssues(mol)).toEqual([]);
  });

  it("reports nothing at all on a structure with no stereo marks", () => {
    expect(structuralIssues(benzene())).toEqual([]);
    expect(structuralIssues(cis2Butene())).toEqual([]);
  });

  it("omits bondId rather than storing undefined where there is none", () => {
    // `exactOptionalPropertyTypes` is on in this package, and a key present
    // with an undefined value breaks JSON round-trips and deep equality.
    for (const issue of structuralIssues(propan2olWedged())) {
      expect(Object.hasOwn(issue, "bondId")).toBe(true);
      expect(issue.bondId).not.toBeUndefined();
    }
  });
});

describe("descriptorText", () => {
  it("parenthesises a letter and renders nothing for an undetermined one", () => {
    expect(descriptorText({ kind: "R" })).toBe("(R)");
    expect(descriptorText({ kind: "Z" })).toBe("(Z)");
    expect(descriptorText(undefined)).toBeUndefined();
    // Not "(?)": a question mark beside a centre reads as a wavy bond, which
    // is a chemical claim rather than a note about the software.
    expect(
      descriptorText({ kind: "undetermined", reason: "no-stereo-bond" }),
    ).toBeUndefined();
  });
});

describe("memoisation", () => {
  it("is keyed on the molecule instance, so an edit is never stale", () => {
    // The topology fingerprint rings.ts caches on excludes positions and
    // `stereo` on purpose. Reusing it here would hand back the E of a bond
    // whose substituent has since been dragged across the axis.
    const cis = cis2Butene();
    expect(doubleBondDescriptor(cis, "b3")).toEqual({ kind: "Z" });
    const trans = trans2Butene();
    expect(doubleBondDescriptor(trans, "b3")).toEqual({ kind: "E" });
    // And back, on the original instance.
    expect(doubleBondDescriptor(cis, "b3")).toEqual({ kind: "Z" });
  });
});

describe("the shared lift (decisions 28 and 29)", () => {
  /** C at the origin with Br, Cl, F (and I) at the given angles and marks. */
  function halomethane(angles: readonly number[], marks: readonly ("wedge" | "hash" | "none")[]) {
    return buildMolecule((b) => {
      const c = b.atom("C", ORIGIN);
      angles.forEach((degrees, i) => {
        b.bond(c, b.atom(["Br", "Cl", "F", "I"][i]!, step(ORIGIN, degrees)), 1, marks[i] ?? "none");
      });
    });
  }

  it("places the hydrogen of a fan opposite the fan, which fixes an enantiomer", () => {
    // Br 0° on a wedge, Cl +75°, F −75°. The hydrogen straight behind the
    // centre read S; the geometry and RDKit get_stereo_tags give R.
    expect(cipDescriptor(halomethane([0, 75, -75], ["wedge"]), "a1")).toEqual({ kind: "R" });
    // A regular-hexagon bridgehead read a false undetermined; RDKit gives R.
    expect(cipDescriptor(halomethane([0, 60, 120], ["none", "wedge"]), "a1")).toEqual({ kind: "R" });
    // Bonds at −80°, 0° (hash), +80°: RDKit gives S.
    expect(cipDescriptor(halomethane([-80, 0, 80], ["none", "hash"]), "a1")).toEqual({ kind: "S" });
  });

  it("keeps the letters of surrounded centres", () => {
    expect(cipDescriptor(bromochlorofluoromethaneR(), "a1")).toEqual({ kind: "R" });
    expect(cipDescriptor(halomethane([90, -30, 210], ["hash"]), "a1")).toEqual({ kind: "S" });
  });

  it("refuses, deliberately, an exact T, and passes through a refusal on either side of it", () => {
    // The chain drawn straight through the centre, OH wedged across it. The
    // letter used to be S at the T and R two degrees past it. Well clear of
    // the line both readers agree with RDKit get_stereo_tags: S at −40°, R at
    // −20°. Within about 5° of the line RDKit applies a tie-break of its own.
    const ambiguous = { kind: "undetermined", reason: "ambiguous-geometry" };
    expect(cipDescriptor(glyceraldehydeWedged(-30), "a1")).toEqual(ambiguous);
    expect(cipDescriptor(glyceraldehydeWedged(-29), "a1")).toEqual(ambiguous);
    expect(cipDescriptor(glyceraldehydeWedged(-31), "a1")).toEqual(ambiguous);
    expect(cipDescriptor(glyceraldehydeWedged(-40), "a1")).toEqual({ kind: "S" });
    expect(cipDescriptor(glyceraldehydeWedged(-20), "a1")).toEqual({ kind: "R" });
    // The symmetric stem-wedge T is its own mirror image.
    expect(cipDescriptor(halomethane([0, 90, -90], ["wedge"]), "a1")).toEqual(ambiguous);
    expect(cipDescriptor(halomethane([0, 80, -80], ["wedge"]), "a1")).toEqual({ kind: "R" });
    expect(cipDescriptor(halomethane([0, 100, -100], ["wedge"]), "a1")).toEqual({ kind: "S" });
  });

  it("refuses, deliberately, an X drawing whose letter flips under a half-degree nudge", () => {
    for (const nudge of [-0.5, 0, 0.5]) {
      expect(cipDescriptor(halomethane([135, 315, 225, 45 + nudge], ["wedge", "hash"]), "a1")).toEqual({
        kind: "undetermined",
        reason: "ambiguous-geometry",
      });
    }
  });
});

/**
 * Decision 40's coverage question, on threo/erythro 3-chlorobutan-2-ol
 * (`CC(O)C(C)Cl`).
 *
 * Two adjacent stereocentres is the smallest structure where "one AND group
 * holding both" (a racemate) and "two AND groups, one each" (a mixture of
 * diastereomers) are different compounds — so it is the only fixture that can
 * tell `rac-` from a per-centre answer.
 */
describe("decision 40: what the groups say about the whole molecule", () => {
  function chlorobutanol(): { readonly mol: Molecule; readonly c2: AtomId; readonly c3: AtomId } {
    let c2: AtomId = "";
    let c3: AtomId = "";
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2Pos = step(ORIGIN, 30);
      c2 = b.atom("C", c2Pos);
      const o = b.atom("O", step(c2Pos, 90));
      const c3Pos = step(c2Pos, -30);
      c3 = b.atom("C", c3Pos);
      const c4 = b.atom("C", step(c3Pos, 30));
      const cl = b.atom("Cl", step(c3Pos, -90));
      b.bond(c1, c2, 1);
      b.bond(c2, o, 1, "wedge");
      b.bond(c2, c3, 1);
      b.bond(c3, c4, 1);
      b.bond(c3, cl, 1, "hash");
    });
    return { mol, c2, c3 };
  }

  it("says nothing when the molecule says nothing (decision 91)", () => {
    const { mol } = chlorobutanol();
    expect(stereocenterAtoms(mol)).toHaveLength(2);
    expect(stereoGroupCoverage(mol)).toEqual({ kind: "none" });
  });

  it("reads rac- when ONE and group holds every stereocentre", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const coverage = stereoGroupCoverage(racemate);
    expect(coverage.kind).toBe("whole");
    expect(coverage).toMatchObject({ prefix: "rac-", group: { kind: "and", index: 1 } });
  });

  it("reads rel- when ONE or group holds every stereocentre", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const relative = withStereoGroups(mol, [{ kind: "or", index: 2, atomIds: [c2, c3] }]);
    expect(stereoGroupCoverage(relative)).toMatchObject({ kind: "whole", prefix: "rel-" });
  });

  it("falls to per-centre for TWO and groups: a diastereomer mixture is not a racemate", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const mixture = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2] },
      { kind: "and", index: 2, atomIds: [c3] },
    ]);
    const coverage = stereoGroupCoverage(mixture);
    expect(coverage.kind).toBe("perCentre");
    expect(coverage).toMatchObject({ groups: [{ index: 1 }, { index: 2 }] });
  });

  it("falls to per-centre when one and group holds only ONE of the two centres", () => {
    const { mol, c2 } = chlorobutanol();
    const half = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2] }]);
    expect(stereoGroupCoverage(half).kind).toBe("perCentre");
  });

  it("never reads a prefix off an abs group, whatever it covers (decision 40)", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const absolute = withStereoGroups(mol, [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [c2, c3] },
    ]);
    expect(stereoGroupCoverage(absolute).kind).toBe("perCentre");
  });

  it("names the case where a group resolves to no stereocentre at all (T14)", () => {
    const { mol } = chlorobutanol();
    // a1 is the terminal methyl: a legal collection member in a file, and not
    // a stereocentre. Vacuously "every stereocentre is in one AND group" would
    // print rac- on a structure whose centres the group never mentions.
    const stray = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: ["a1"] }]);
    const coverage = stereoGroupCoverage(stray);
    expect(coverage.kind).toBe("unresolved");
    expect(coverage).toMatchObject({ groups: [{ kind: "and", index: 1, atomIds: ["a1"] }] });
  });

  it("still reads rac- when the racemate is drawn FLAT, with no wedge to letter", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // `stereocenterAtoms` includes centres whose descriptor is undetermined, so
    // erasing the marks must not cost the molecule its prefix.
    const flat = mol.bondIds.reduce((m, bondId) => setBondStereo(m, bondId, "none"), mol);
    expect(cipDescriptor(flat, c2)).toEqual({ kind: "undetermined", reason: "no-stereo-bond" });
    expect(stereoGroupCoverage(withStereoGroups(flat, [
      { kind: "and", index: 1, atomIds: [c2, c3] },
    ]))).toMatchObject({ kind: "whole", prefix: "rac-" });
  });

  it("ignores a group that names extra atoms beside the centres it covers", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // A file may put a non-stereogenic atom in a collection. The prefix is
    // about the centres, so an extra member does not take it away.
    const padded = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2, c3, "a1"] },
    ]);
    expect(stereoGroupCoverage(padded)).toMatchObject({ kind: "whole", prefix: "rac-" });
  });

  it("counts DISTINCT centres, so a group naming one twice cannot print rac-", () => {
    // NOT reachable through `withStereoGroups`, which deduplicates — so the
    // group is set on the molecule directly, which is exactly what a decoded
    // document is before its refinement runs. Counting memberships made this
    // molecule read `whole` / `rac-`: one grouped centre plus one UNGROUPED one,
    // announced as a racemate when it is a mixture of diastereomers. The schema
    // refinement rejects such a document, and this makes the false prefix
    // impossible even if it did not.
    const { mol, c2, c3 } = chlorobutanol();
    expect(stereocenterAtoms(mol)).toEqual([c2, c3]);
    const forged: Molecule = { ...mol, stereoGroups: [{ kind: "and", index: 1, atomIds: [c2, c2] }] };
    expect(stereoGroupCoverage(forged)).toMatchObject({
      kind: "perCentre",
      groups: [{ kind: "and", index: 1 }],
    });
    // And the honest version of the same statement agrees with it, which is the
    // point: a duplicate must say no more than the id said once.
    expect(stereoGroupCoverage(withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2] }])).kind).toBe(
      "perCentre",
    );
  });
});

describe("decision 125: which grouped atoms an RDKit reader will drop", () => {
  function chlorobutanol(): { readonly mol: Molecule; readonly c2: AtomId; readonly c3: AtomId } {
    let c2: AtomId = "";
    let c3: AtomId = "";
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN);
      const c2Pos = step(ORIGIN, 30);
      c2 = b.atom("C", c2Pos);
      const o = b.atom("O", step(c2Pos, 90));
      const c3Pos = step(c2Pos, -30);
      c3 = b.atom("C", c3Pos);
      const c4 = b.atom("C", step(c3Pos, 30));
      const cl = b.atom("Cl", step(c3Pos, -90));
      b.bond(c1, c2, 1);
      b.bond(c2, o, 1, "wedge");
      b.bond(c2, c3, 1);
      b.bond(c3, c4, 1);
      b.bond(c3, cl, 1, "hash");
    });
    return { mol, c2, c3 };
  }

  it("says nothing about a molecule that states no group", () => {
    const { mol } = chlorobutanol();
    expect(wedgelessStereoGroupAtoms(mol)).toEqual([]);
    const flat = mol.bondIds.reduce((m, bondId) => setBondStereo(m, bondId, "none"), mol);
    expect(wedgelessStereoGroupAtoms(flat)).toEqual([]);
  });

  it("names every grouped centre of a racemate drawn with no wedge at all", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const flat = mol.bondIds.reduce((m, bondId) => setBondStereo(m, bondId, "none"), mol);
    const racemate = withStereoGroups(flat, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    // The molecule and the file are both right — this is the limit being
    // reported, not a defect being repaired.
    expect(stereoGroupCoverage(racemate)).toMatchObject({ kind: "whole", prefix: "rac-" });
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual([c2, c3]);
  });

  it("names only the centre that has no mark, not the one that has", () => {
    // RDKit's drop is PER ATOM, measured: it keeps the grouped atoms carrying a
    // chiral tag and drops the rest, so a warning naming the whole group would
    // be wrong about half of it.
    const { mol, c2, c3 } = chlorobutanol();
    const halfFlat = mol.bondIds.reduce(
      (m, bondId) => (m.bonds[bondId]?.stereo === "hash" ? setBondStereo(m, bondId, "none") : m),
      mol,
    );
    const racemate = withStereoGroups(halfFlat, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual([c3]);
  });

  it("counts a mark only where its NARROW END is, which is where the tag lands", () => {
    // The wedge on C2 written the other way round: same two atoms, same bond,
    // and the configuration now belongs to the oxygen. RDKit gives the tag to
    // the bond's first atom, so C2 is as bare as if nothing were drawn.
    const { mol, c2, c3 } = chlorobutanol();
    const wedge = mol.bondIds.find((id) => mol.bonds[id]?.stereo === "wedge")!;
    const reversed = flipBond(mol, wedge);
    expect(reversed.bonds[wedge]?.from).not.toBe(c2);
    const racemate = withStereoGroups(reversed, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual([c2]);
  });

  it("names a wavy bond's atom: 'unknown' is not a configuration", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const wavy = mol.bondIds.reduce(
      (m, bondId) => (m.bonds[bondId]?.stereo === "wedge" ? setBondStereo(m, bondId, "wavy") : m),
      mol,
    );
    const racemate = withStereoGroups(wavy, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual([c2]);
  });

  it("names an either bond's atom too: the other half of the same rule", () => {
    // `either` is the crossed DOUBLE bond and `wavy` the squiggly single one,
    // but for this question they are the same thing — neither states a
    // configuration, so neither earns a chiral tag and RDKit drops the atom
    // from the collection either way. Pinned separately because the `wavy` test
    // alone passes when the `either` arm of the guard is deleted.
    const { mol, c2, c3 } = chlorobutanol();
    const either = mol.bondIds.reduce(
      (m, bondId) => (m.bonds[bondId]?.stereo === "wedge" ? setBondStereo(m, bondId, "either") : m),
      mol,
    );
    const racemate = withStereoGroups(either, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    expect(wedgelessStereoGroupAtoms(racemate)).toEqual([c2]);
  });

  it("names a grouped atom that is no stereocentre at all", () => {
    // An imported collection may hold one, and it is lost on the way out for
    // exactly the same reason a wedgeless centre is.
    const { mol, c2, c3 } = chlorobutanol();
    const padded = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3, "a1"] }]);
    expect(wedgelessStereoGroupAtoms(padded)).toEqual(["a1"]);
  });
});
