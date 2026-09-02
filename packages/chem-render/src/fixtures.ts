/**
 * Named molecules for the goldens, the contact sheet and the benchmark.
 *
 * They live in `src` rather than `test` on purpose: a golden SVG committed
 * next to a fixture is only meaningful if the fixture itself is stable and
 * reviewable, and the contact sheet has to be buildable from the published
 * package without reaching into a test folder.
 *
 * Real molecules, not synthetic graphs. When a regression fires on "benzene
 * has six lines" or "acetate's charge is a superscript", the failure reads as
 * a chemistry error and points at the rule that broke. A fixture called
 * `threeAtomsInATriangle` would fail just as loudly and tell you nothing.
 *
 * Geometry follows the way a chemist draws: bonds of unit length (1.0 is one
 * standard bond in chem-core's units) at 30-degree zig-zags, so successive
 * bonds subtend the 120 degrees of an sp3 or sp2 centre. That matters here
 * because the goldens freeze the resulting pixel coordinates.
 */

// chem-core already exports `benzene`; it is aliased rather than re-exported
// from here, so nothing depending on both packages sees two symbols of that
// name. Benzene is not re-drawn locally either — it is the ring the whole
// model is calibrated against, and a second copy of its geometry would be the
// first thing to drift.
import {
  add,
  benzene as coreBenzene,
  buildMolecule,
  DEG,
  flipAtoms,
  fromPolar,
  fuseRingOnBond,
  isFusionBond,
  ORIGIN,
  singleAtom,
  verticalMirror,
} from "@starter/chem-core";
import type { BondId, Molecule, Vec2 } from "@starter/chem-core";

/** One unit-length step from `from`, at `degrees` counter-clockwise from +x. */
function step(from: Vec2, degrees: number): Vec2 {
  return add(from, fromPolar(degrees * DEG, 1));
}

/**
 * Ethanol, CH3CH2OH, drawn as the standard two-bond zig-zag.
 *
 * The smallest fixture that still has a heteroatom, so it is the one that
 * catches a formula or valence regression (C2H6O: three hydrogens on the
 * methyl, two on the methylene, one on the hydroxyl) without any ring
 * geometry in the way. It also puts an atom exactly on the origin, which is
 * what exercises the -0 normalisation in the serialiser: the y-flip turns
 * that 0 into a -0.
 */
export function ethanol(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const methylenePos = step(ORIGIN, 30);
    const methylene = b.atom("C", methylenePos);
    const hydroxyl = b.atom("O", step(methylenePos, -30));
    b.bond(methyl, methylene, 1);
    b.bond(methylene, hydroxyl, 1);
  });
}

/**
 * Acetate, CH3COO-, as the discrete anion rather than acetic acid.
 *
 * Carries the two things no neutral fixture can: a bond order above one and a
 * formal charge. The charge is what makes the text views worth testing —
 * `formulaParts` appends a superscript part for it, so a sum-formula scene of
 * acetate is the only fixture whose glyph run mixes subscripts and
 * superscripts.
 *
 * The carboxyl oxygens sit 120 degrees apart around the carboxyl carbon,
 * which is the trigonal-planar geometry the group actually has.
 */
export function acetate(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const carboxylPos = step(ORIGIN, 30);
    const carboxyl = b.atom("C", carboxylPos);
    // 90 and -30 degrees are the two directions 120 degrees off the bond back
    // to the methyl carbon (which points at 210 degrees from here).
    const carbonyl = b.atom("O", step(carboxylPos, 90));
    // The negative charge is localised on one oxygen in the drawn Kekule
    // form; delocalising it is a later representation, not a different model.
    const anion = b.atom("O", step(carboxylPos, -30), { charge: -1 });
    b.bond(methyl, carboxyl, 1);
    b.bond(carboxyl, carbonyl, 2);
    b.bond(carboxyl, anion, 1);
  });
}

/**
 * An unbranched primary alcohol with `heavyAtoms` heavy atoms:
 * CH3(CH2)n-2OH, drawn as one long zig-zag.
 *
 * The benchmark subject. Long-chain fatty alcohols are real compounds, and a
 * structure that makes a drawing tool sweat is far more likely to be long
 * than exotic — a polymer fragment, a lipid, a pasted-in peptide backbone.
 * The terminal oxygen is not decoration: it keeps `elementCounts` from
 * collapsing to a single entry, so the text views are measuring real work
 * too.
 */
export function heavyChain(heavyAtoms = 300): Molecule {
  if (heavyAtoms < 2) {
    throw new Error(`A chain needs at least 2 heavy atoms, got ${heavyAtoms}`);
  }
  return buildMolecule((b) => {
    let pos: Vec2 = ORIGIN;
    let previous = b.atom("C", pos);
    for (let i = 1; i < heavyAtoms; i++) {
      pos = step(pos, i % 2 === 1 ? 30 : -30);
      const next = b.atom(i === heavyAtoms - 1 ? "O" : "C", pos);
      b.bond(previous, next, 1);
      previous = next;
    }
  });
}

/**
 * Ethanol reflected left-to-right about the origin.
 *
 * The second half of the "hydrogens sit on the free side" claim. The hydroxyl
 * of `ethanol` has its free space to the east and sets "OH"; mirrored, the free
 * space is to the west and the same label must set "HO". A renderer that
 * centred the whole run instead of the symbol, or that took its bond directions
 * from y-up model space, passes one of those two and fails the other.
 *
 * Ethanol is achiral and carries no wedges, so the mirror makes no
 * stereochemical claim — this is a reflected drawing of the same compound, not
 * an enantiomer.
 */
export function ethanolMirrored(): Molecule {
  const mol = ethanol();
  return flipAtoms(mol, mol.atomIds, verticalMirror(ORIGIN));
}

/**
 * Methane, as a lone carbon.
 *
 * The isolated-atom rule: a vertex with no bonds is invisible, so carbon draws
 * its symbol here and only here in a skeletal view. It is also the control for
 * `methylRadical` — the two differ by one electron, and the drawing has to show
 * it in more than one way.
 */
export function methane(): Molecule {
  return singleAtom("C");
}

/**
 * The methyl radical, CH3•.
 *
 * The unpaired electron is modelled, so `implicitHydrogenCount` already gives
 * three rather than four: the picture and the formula panel must agree, which
 * is why the dot cannot be a Lewis-only decoration. Against `methane` it
 * differs twice over — one fewer hydrogen in the run, and a dot beside it.
 */
export function methylRadical(): Molecule {
  return buildMolecule((b) => {
    b.atom("C", ORIGIN, { radicalElectrons: 1 });
  });
}

/**
 * Methylene, :CH2 — the only two-dot fixture.
 *
 * `radicalElectrons` is one integer, so the model cannot distinguish the
 * singlet carbene (a lone pair) from the triplet (two unpaired electrons). Two
 * dots is what it can honestly draw; the distinction belongs to the Lewis pass,
 * which has lone pairs of its own.
 */
export function methyleneCarbene(): Molecule {
  return buildMolecule((b) => {
    b.atom("C", ORIGIN, { radicalElectrons: 2 });
  });
}

/**
 * The tert-butyl cation, (CH3)3C+.
 *
 * Both halves of the charged-carbon rule in one picture: the central carbon
 * draws "C+" because a charge needs something to sit on, while its three methyl
 * carbons stay bare vertices. The central carbon carries no hydrogens —
 * chem-core mirrors RDKit's carbon special case, which gives a +1 carbon a
 * target valence of three, all of it used by the three bonds.
 */
export function tertButylCation(): Molecule {
  return buildMolecule((b) => {
    const centre = b.atom("C", ORIGIN, { charge: 1 });
    for (const degrees of [90, 210, 330]) {
      b.bond(centre, b.atom("C", step(ORIGIN, degrees)), 1);
    }
  });
}

/**
 * Bromomethane, CH3Br. Half of the label-extent pair.
 *
 * Paired with `iodomethane`, which has IDENTICAL geometry and differs only in
 * the halogen. "Br" is exactly one em wide in the vendored face and "I" is a
 * little over a quarter of one, so the only thing that can move the two
 * scenes' bounds apart is the label — by half that difference, since the
 * halogen carries no hydrogen and its symbol is therefore centred on its atom
 * while the methyl lies to its left. An estimator that charged a flat width
 * per character would make them differ by a factor of two instead, from the
 * character count alone.
 */
export function bromomethane(): Molecule {
  return halomethane("Br");
}

/** Iodomethane, CH3I. See `bromomethane` — same geometry, narrower label. */
export function iodomethane(): Molecule {
  return halomethane("I");
}

function halomethane(halogen: string): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    b.bond(methyl, b.atom(halogen, step(ORIGIN, 30)), 1);
  });
}

/**
 * Benzyl alcohol drawn with the phenyl ring abbreviated: Ph-CH2-OH.
 *
 * The display-override rule. "Ph" replaces the symbol and suppresses the
 * hydrogens with it, because a phenyl group's hydrogens are inside the
 * abbreviation and "PhH3" is nonsense.
 *
 * WARNING, and it is the whole reason this fixture is named "abbreviated":
 * `Atom.label` is a DISPLAY override and changes no chemistry whatsoever. The
 * model here is three heavy atoms, so `molecularFormula` reports C3H8O — not
 * benzyl alcohol's C7H8O. The tests assert what the model actually contains.
 */
export function benzylAlcoholAbbreviated(): Molecule {
  return buildMolecule((b) => {
    const phenyl = b.atom("C", ORIGIN, { label: "Ph" });
    const methylenePos = step(ORIGIN, 30);
    const methylene = b.atom("C", methylenePos);
    const hydroxyl = b.atom("O", step(methylenePos, -30));
    b.bond(phenyl, methylene, 1);
    b.bond(methylene, hydroxyl, 1);
  });
}

/**
 * Methanol with a carbon-13, drawn on a deliberately HORIZONTAL bond.
 *
 * Two rules at once. The mass number is a superscript glued to the left of the
 * symbol in either orientation, and it is a satellite: the bond meets the C,
 * not the 13. And the horizontal bond blocks exactly one side for each atom, so
 * the carbon sets "H3(13)C" with its hydrogens west and the oxygen sets "OH"
 * with its hydrogen east — the branch a 30-degree zig-zag never reaches.
 */
export function methanol13C(): Molecule {
  return buildMolecule((b) => {
    const carbon = b.atom("C", ORIGIN, { isotope: 13 });
    b.bond(carbon, b.atom("O", { x: 1, y: 0 }), 1);
  });
}

/**
 * Butan-2-ol with the hydroxyl drawn on a wedge from C2.
 *
 * The stereocentre rule: a wedge or hash makes the implicit hydrogen at its
 * NARROW end load-bearing, because that hydrogen is the fourth substituent the
 * reader has to place. C2 therefore draws "CH" while C1, at the wide end,
 * learns nothing about its own configuration and stays a bare vertex.
 *
 * No CIP descriptor appears in this name or these comments on purpose: nothing
 * in this repo assigns R/S, and a fixture called (S)-butan-2-ol that depicted
 * the R enantiomer would be wrong in the one way that renders perfectly.
 */
export function butan2olWedged(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", ORIGIN);
    const c2Pos = step(ORIGIN, 30);
    const c2 = b.atom("C", c2Pos);
    const c3Pos = step(c2Pos, -30);
    const c3 = b.atom("C", c3Pos);
    const c4 = b.atom("C", step(c3Pos, 30));
    // Narrow end at C2: chem-core fixes the wedge convention as narrow-at-
    // `from`, so C2 is the stereocentre and the oxygen is what it points at.
    const oxygen = b.atom("O", step(c2Pos, 90));
    b.bond(c1, c2, 1);
    b.bond(c2, oxygen, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
  });
}

/**
 * Naphthalene, drawn the sanctioned way: a benzene fused onto one of benzene's
 * own DOUBLE bonds.
 *
 * The flagship double-bond fixture, and the hard case rather than mere
 * coverage. `fuseRingOnBond` across a double bond leaves the SHARED bond a
 * double sitting in TWO rings, each pulling the second line the opposite way —
 * the ambiguous fusion that any tiebreak keyed on a ring index, a walk
 * direction or a centroid DISTANCE gets wrong. Both rings are aromatic
 * six-rings, so the topological key ties and the fusion bond draws centred,
 * while the four peripheral double bonds each lean into their own ring.
 *
 * Fusing across a SINGLE bond would draw the ring and put the two shared
 * carbons in `valenceIssues()` — Kekule alternation is strict and never dodges
 * — so the choice of bond here is chemistry, not convenience.
 */
export function naphthalene(): Molecule {
  return fuseRingOnBond(coreBenzene(), rightmostDoubleBond(coreBenzene()), "benzene")
    .molecule;
}

/**
 * Chrysene, C18H12: four benzo rings fused in a zig-zag.
 *
 * The fused tetracycle. Built by fusing three more rings onto benzene, each on
 * the rightmost double bond still free, which turns the chain twice in
 * opposite directions — the angular arrangement that distinguishes chrysene
 * from linear tetracene and from one-turn benz[a]anthracene. All four rings
 * perceive as aromatic and the structure carries no valence issue.
 *
 * A LINEAR acene cannot be built this way at all, and the reason is chemistry
 * rather than an API gap: naphthalene's Kekule structure leaves its far edge
 * SINGLE, and fusing a benzo across a single bond puts the two shared carbons
 * in `valenceIssues()`. That is the strictness working, not a defect.
 *
 * What it is here to catch: four rings means four centroids and five fusion
 * bonds, so almost every double bond has a neighbour on both sides, and an
 * inner line inset that gets the vertex half-angle wrong produces lines poking
 * through the ring edges everywhere at once.
 */
export function chrysene(): Molecule {
  let mol = coreBenzene();
  for (let i = 0; i < 3; i++) {
    mol = fuseRingOnBond(mol, rightmostDoubleBond(mol), "benzene").molecule;
  }
  return mol;
}

/**
 * The free double bond whose midpoint is furthest EAST, ties going SOUTH.
 *
 * A total order over positions, deliberately: `bondIds` order is insertion
 * order and would make this fixture's shape depend on how the previous fusion
 * happened to mint its bonds. Two of chrysene's fusions land on a genuine tie
 * in x, and without the second key the ring would go up or down depending on
 * nothing.
 */
function rightmostDoubleBond(mol: Molecule): BondId {
  let best: BondId | undefined;
  let bestX = -Infinity;
  let bestY = Infinity;
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined || bond.order !== 2) continue;
    if (isFusionBond(mol, bondId)) continue;
    const from = mol.atoms[bond.from];
    const to = mol.atoms[bond.to];
    if (from === undefined || to === undefined) continue;
    const x = (from.pos.x + to.pos.x) / 2;
    const y = (from.pos.y + to.pos.y) / 2;
    if (x > bestX + 1e-9 || (Math.abs(x - bestX) < 1e-9 && y < bestY - 1e-9)) {
      bestX = x;
      bestY = y;
      best = bondId;
    }
  }
  if (best === undefined) throw new Error("no free double bond to fuse onto");
  return best;
}

/**
 * Dimethyl sulfone, (CH3)2SO2 — the hypervalent fixture.
 *
 * Sulfur's valence list is [2, 4, 6], and here all six are used: two S-C and
 * two S=O, so the sulfur carries no hydrogen and the label is a bare "S" that
 * all four bonds have to stop short of. Both S=O go down the substituent
 * branch of the double-bond rule and both come out CENTRED, because the oxygen
 * end is terminal — which is what a sulfone, and every carbonyl, should draw.
 *
 * A cross rather than a zig-zag: the two S=O straight up and down, the two
 * methyls straight out to the sides. It is how the group is drawn, and it puts
 * a double bond on a perfectly vertical axis, where a trimmer with a divide-
 * by-zero in its slab test would show up.
 */
export function dimethylSulfone(): Molecule {
  return buildMolecule((b) => {
    const sulfur = b.atom("S", ORIGIN);
    b.bond(sulfur, b.atom("O", step(ORIGIN, 90)), 2);
    b.bond(sulfur, b.atom("O", step(ORIGIN, -90)), 2);
    b.bond(sulfur, b.atom("C", step(ORIGIN, 180)), 1);
    b.bond(sulfur, b.atom("C", step(ORIGIN, 0)), 1);
  });
}

/**
 * A methanol dropped onto an ethanol's hydroxyl and never merged.
 *
 * NOT a molecule anyone would draw on purpose — it is the drawing state the
 * collision pass exists to name: a template or a paste landed on an existing
 * fragment, the merge radius was missed, and two atoms now sit on the same
 * spot with a bond running through a label that belongs to neither of its
 * ends.
 *
 * It is a fixture rather than a test-local graph because the whole point of
 * the collision pass is that it REPORTS and never repairs, and the only
 * convincing evidence of that is the picture: the contact sheet shows the
 * overlap exactly as drawn, coordinates untouched.
 *
 * The offset is 0.03 bond lengths — well inside chem-core's
 * `DEFAULT_MERGE_RADIUS` of 0.4, so a gesture that had merged would have, and
 * two atoms still this close were left this close by a bug.
 */
export function unmergedDropOverlap(): Molecule {
  return buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const methylenePos = step(ORIGIN, 30);
    const methylene = b.atom("C", methylenePos);
    const hydroxylPos = step(methylenePos, -30);
    const hydroxyl = b.atom("O", hydroxylPos);
    b.bond(methyl, methylene, 1);
    b.bond(methylene, hydroxyl, 1);

    // The dropped fragment. Its carbon lands on the hydroxyl oxygen, and its
    // own C-O bond then leaves straight through that oxygen's label.
    const droppedPos: Vec2 = { x: hydroxylPos.x, y: hydroxylPos.y + 0.03 };
    const dropped = b.atom("C", droppedPos);
    b.bond(dropped, b.atom("O", step(droppedPos, 90)), 1);
  });
}

export interface Fixture {
  readonly name: string;
  readonly molecule: Molecule;
}

/**
 * The fixture set the goldens and the contact sheet both iterate, in a fixed
 * order so a new golden file and a new contact-sheet row appear in the same
 * place.
 *
 * `heavyChain` is deliberately absent. It is a benchmark subject, and putting
 * three hundred atoms into every cell of a contact sheet meant for eyeballing
 * would only make the sheet slow and unreadable.
 */
export const FIXTURES: readonly Fixture[] = Object.freeze([
  Object.freeze({ name: "benzene", molecule: coreBenzene() }),
  Object.freeze({ name: "ethanol", molecule: ethanol() }),
  Object.freeze({ name: "ethanolMirrored", molecule: ethanolMirrored() }),
  Object.freeze({ name: "acetate", molecule: acetate() }),
  Object.freeze({ name: "methane", molecule: methane() }),
  Object.freeze({ name: "methylRadical", molecule: methylRadical() }),
  Object.freeze({ name: "methyleneCarbene", molecule: methyleneCarbene() }),
  Object.freeze({ name: "tertButylCation", molecule: tertButylCation() }),
  Object.freeze({ name: "bromomethane", molecule: bromomethane() }),
  Object.freeze({ name: "iodomethane", molecule: iodomethane() }),
  Object.freeze({
    name: "benzylAlcoholAbbreviated",
    molecule: benzylAlcoholAbbreviated(),
  }),
  Object.freeze({ name: "methanol13C", molecule: methanol13C() }),
  Object.freeze({ name: "butan2olWedged", molecule: butan2olWedged() }),
  Object.freeze({ name: "naphthalene", molecule: naphthalene() }),
  Object.freeze({ name: "dimethylSulfone", molecule: dimethylSulfone() }),
  Object.freeze({ name: "chrysene", molecule: chrysene() }),
  Object.freeze({
    name: "unmergedDropOverlap",
    molecule: unmergedDropOverlap(),
  }),
]);

