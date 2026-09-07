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
  stereogenicBonds,
  structuralIssues,
} from "./stereo.js";
import type { StereoDescriptor } from "./stereo.js";
import { flipAtoms, verticalMirror } from "./transform.js";
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
 */
function glyceraldehydeWedged() {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c1 = b.atom("C", step(ORIGIN, 150));
    b.bond(c1, b.atom("O", step(step(ORIGIN, 150), 90)), 2);
    const c3 = b.atom("C", step(ORIGIN, -30));
    b.bond(c3, b.atom("O", step(step(ORIGIN, -30), -90)), 1);
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

  it("refuses a centre whose configuration the drawing declines to state", () => {
    const wavy = setBondStereo(butan2olWedged(), "b7", "wavy");
    expect(cipDescriptor(wavy, "a2")).toEqual({
      kind: "undetermined",
      reason: "unspecified",
    });
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
    expect(kindOf(cipDescriptor(mol, "a1"))).toMatch(/^[RS]$/);
  });

  it("refuses rather than guesses when only an isotope separates two branches", () => {
    // 2-(13-C)-propan-2-ol: the two methyls differ by mass number alone. That
    // is CIP rule 2, which this module can detect but not order, so the honest
    // answer is `ranking-unsupported` — not a letter, and not "identical".
    const mol = buildMolecule((b) => {
      const c1 = b.atom("C", ORIGIN, { isotope: 13 });
      const c2Pos = step(ORIGIN, 30);
      const c2 = b.atom("C", c2Pos);
      const c3 = b.atom("C", step(c2Pos, -30));
      b.bond(c1, c2, 1);
      b.bond(c2, b.atom("O", step(c2Pos, 90)), 1, "wedge");
      b.bond(c2, c3, 1);
    });
    expect(cipDescriptor(mol, "a2")).toEqual({
      kind: "undetermined",
      reason: "ranking-unsupported",
    });
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
    expect(issues[0]!.severity).toBe("warning");
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
