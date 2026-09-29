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
import type { AtomId, BondId, Molecule, Vec2 } from "@starter/chem-core";

import { assembleSchemeAnnotation, schemeAnnotationId } from "./scheme/annotation.js";
import type { CurlyArrowAnnotation } from "./scheme/annotation.js";

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
 * chem-core follows RDKit in reading a +1 carbon as boron, a valence of
 * three, all of it used by the three bonds.
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
 * chem-core now assigns R/S, and this drawing is (R)-butan-2-ol: the hydroxyl
 * is north on a wedge, the ethyl runs south-east and the methyl south-west, so
 * with the implicit hydrogen behind the page O -> ethyl -> methyl traces
 * clockwise. The name stays `butan2olWedged` rather than becoming
 * `rButan2ol` — the fixture is here to exercise the wedge, and a name carrying
 * a descriptor would have to be re-derived by hand every time the geometry
 * moved. `stereo.test.ts` in chem-core pins the letter instead, on the same
 * coordinates.
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
 * cis-2-butene: (Z)-but-2-ene, both methyls above a horizontal double bond.
 *
 * There is no stereo annotation anywhere on it, which is the point. The Z is
 * read out of the COORDINATES, so this fixture and its trans twin differ in
 * exactly one atom position and in nothing else — no flag, no wedge, no bond
 * property. A perception pass that leaned on a stored value would give both
 * the same answer and both would render identically.
 */
export function cis2Butene(): Molecule {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c3Pos: Vec2 = { x: 1, y: 0 };
    const c3 = b.atom("C", c3Pos);
    b.bond(c2, c3, 2);
    b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
    b.bond(c3, b.atom("C", step(c3Pos, 60)), 1);
  });
}

/**
 * trans-2-butene: (E)-but-2-ene. The cis fixture with one methyl reflected.
 *
 * Drawn as the ordinary zig-zag a chemist writes without thinking about it,
 * which is what makes the pair a fair test: the trans isomer is the DEFAULT
 * shape of a drawn alkene, so a perception pass that returned E for everything
 * would pass on this one alone.
 */
export function trans2Butene(): Molecule {
  return buildMolecule((b) => {
    const c2 = b.atom("C", ORIGIN);
    const c3Pos: Vec2 = { x: 1, y: 0 };
    const c3 = b.atom("C", c3Pos);
    b.bond(c2, c3, 2);
    b.bond(c2, b.atom("C", step(ORIGIN, 120)), 1);
    b.bond(c3, b.atom("C", step(c3Pos, -60)), 1);
  });
}

/**
 * Propan-2-ol with the hydroxyl on a wedge — a wedge on a NON-stereocentre.
 *
 * Deliberately wrong, in the way `unmergedDropOverlap` is deliberately wrong:
 * the carbinol carbon carries two methyls, so there is no configuration for
 * the wedge to state and the drawing asserts one anyway. It is the commonest
 * error in a hand sketch and the hardest to see, because it renders perfectly
 * — a crisp triangle pointing at an oxygen, on a molecule that is achiral.
 *
 * `structuralIssues` in chem-core reports it. The fixture exists so the report
 * has a picture beside it on the contact sheet, and so the mark itself keeps
 * being drawn: the pass REPORTS and never repairs, so the wedge must still
 * appear exactly as the author drew it.
 */
export function wedgeOnNonStereocentre(): Molecule {
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
 * Phenanthrene, C14H10: three benzo rings fused at an angle.
 *
 * Chrysene's first two fusions, stopped there: the second benzo lands on the
 * rightmost free double bond of naphthalene, which turns the chain, so the
 * result is the angular phenanthrene and never linear anthracene (whose middle
 * ring would need a fusion across a single bond — see `chrysene`).
 *
 * NOT IN `FIXTURES`: it would add goldens that say nothing chrysene does not.
 * It is here for the annotation measurements (decisions 44 and 54), where the bay
 * region's crowded inner vertices are the case that matters.
 */
export function phenanthrene(): Molecule {
  let mol = coreBenzene();
  for (let i = 0; i < 2; i++) {
    mol = fuseRingOnBond(mol, rightmostDoubleBond(mol), "benzene").molecule;
  }
  return mol;
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

/**
 * A steroid SKELETON — the C19 6-6-6-5 ring system with two angular methyls
 * and two hydroxyls — with its steroid locants: the fused-ring ANNOTATION
 * fixture.
 *
 * NAMED FOR WHAT IT DRAWS, NOT FOR A COMPOUND. A steroid parent name such as
 * "androstane" implies the ring-junction configuration (8β, 9α, 10β, 13β,
 * 14α), and "5α" asserts one more. This drawing puts wedges on C3, C10, C13
 * and C17 only. The junctions at C5, C8, C9 and C14 are conventionally drawn
 * with an H on a wedge or hash, which implicit hydrogens cannot carry, so
 * those centres are undrawn and the structure asserts nothing about them. Calling it
 * androstanediol would claim stereochemistry the figure does not show.
 *
 * Four fused rings (6-6-6-5) in the standard steroid orientation, the two
 * angular methyls C18 and C19 and both hydroxyls on solid wedges (β, toward
 * the viewer). Every ring atom is a fused or substituted vertex, so the free
 * direction the label pass computes points into a bond or a substituent on
 * almost every one of them: a placement pass that tried only that direction
 * collides nearly everywhere, which is exactly what this is here to catch.
 * The ring-junction hydrogens at C5, C8, C9 and C14 are not drawn (hydrogens
 * are implicit), so those four centres are honestly undetermined and carry no
 * descriptor; C3, C10, C13 and C17 carry wedges and do.
 *
 * VERTICALLY ASYMMETRIC — the methyls go up the page, the 3-OH down and to the
 * left — so an annotation offset taken from y-up model space without the flip
 * lands on the wrong side and shows.
 *
 * ATOMS ARE CREATED OUT OF NUMBERING ORDER (ring C first, then D, B, A), so an
 * atom's id is NOT its locant: a renderer that drew ids or `atomIds` positions
 * under `showLocants` would print a visibly wrong numbering on the contact
 * sheet. All atoms come before any bond, so `reverseBonds` changes bond ids
 * and neighbour order and nothing else.
 *
 * IT IS ALSO THE EXPLICIT-H CROWDING CASE, for the same reason it is the
 * annotation one: every ring atom is a fused or substituted vertex, so the
 * angular gaps its bonds leave are narrow and the derived hydrogens of two
 * adjacent carbons are fanned into the same pocket between them. Nothing in
 * `FIXTURES` reproduces that — a chain vertex has 240 degrees of empty page
 * and naphthalene's fused vertices carry no hydrogens at all — which is why
 * `hydrogen-separation.test.ts` names this fixture directly.
 *
 * NOT IN `FIXTURES`: it would add a golden per view and join the rotation
 * sweeps that are about other things. The contact sheet gives it its own
 * section, and the explicit-H crowding sweep in `representations.test.ts`
 * names it directly, beside `perhydrophenanthrene`.
 */
export function steroidSkeletonWithLocants(
  options: { readonly reverseBonds?: boolean } = {},
): { readonly molecule: Molecule; readonly locants: Readonly<Record<AtomId, string>> } {
  const locants: Record<AtomId, string> = {};
  const molecule = buildMolecule((b) => {
    const hexA: Vec2 = ORIGIN;
    const hexB: Vec2 = { x: Math.sqrt(3), y: 0 };
    const hexC: Vec2 = { x: 1.5 * Math.sqrt(3), y: 1.5 };
    const on = (centre: Vec2, degrees: number): Vec2 => step(centre, degrees);

    // One position per atom, computed ONCE even where two rings share it, so
    // a fused vertex is not two points a few ulps apart.
    const pos = new Map<string, Vec2>();
    pos.set("1", on(hexA, 90));
    pos.set("2", on(hexA, 150));
    pos.set("3", on(hexA, 210));
    pos.set("4", on(hexA, 270));
    pos.set("5", on(hexA, 330));
    pos.set("10", on(hexA, 30));
    pos.set("6", on(hexB, 270));
    pos.set("7", on(hexB, 330));
    pos.set("8", on(hexB, 30));
    pos.set("9", on(hexB, 90));
    pos.set("11", on(hexC, 150));
    pos.set("12", on(hexC, 90));
    pos.set("13", on(hexC, 30));
    pos.set("14", on(hexC, 330));
    // Ring D: a regular pentagon on the C13-C14 edge, which is vertical.
    const c13 = pos.get("13")!;
    const c14 = pos.get("14")!;
    const apothem = 0.5 / Math.tan(36 * DEG);
    const circumradius = 0.5 / Math.sin(36 * DEG);
    const hexD: Vec2 = { x: (c13.x + c14.x) / 2 + apothem, y: (c13.y + c14.y) / 2 };
    pos.set("17", add(hexD, fromPolar(72 * DEG, circumradius)));
    pos.set("16", add(hexD, fromPolar(0, circumradius)));
    pos.set("15", add(hexD, fromPolar(-72 * DEG, circumradius)));
    pos.set("18", step(c13, 90));
    pos.set("19", step(pos.get("10")!, 90));

    const ids = new Map<string, AtomId>();
    const carbon = (locant: string): void => {
      const id = b.atom("C", pos.get(locant)!);
      ids.set(locant, id);
      locants[id] = locant;
    };
    for (const locant of ["11", "12", "13", "14", "8", "9"]) carbon(locant);
    for (const locant of ["15", "16", "17"]) carbon(locant);
    for (const locant of ["5", "6", "7", "10"]) carbon(locant);
    for (const locant of ["1", "2", "3", "4"]) carbon(locant);
    for (const locant of ["18", "19"]) carbon(locant);
    // The hydroxyl oxygens carry no locant of their own.
    const o3 = b.atom("O", step(pos.get("3")!, 210));
    const o17 = b.atom("O", step(pos.get("17")!, 72));

    const id = (locant: string): AtomId => ids.get(locant)!;
    const bonds: Array<() => void> = [];
    const ring = (members: readonly string[]): void => {
      members.forEach((locant, index) => {
        const next = members[(index + 1) % members.length]!;
        bonds.push(() => b.bond(id(locant), id(next), 1));
      });
    };
    ring(["1", "2", "3", "4", "5", "10"]);
    // Ring B without its shared C5-C10 edge, and so on for C and D.
    for (const [from, to] of [
      ["5", "6"],
      ["6", "7"],
      ["7", "8"],
      ["8", "9"],
      ["9", "10"],
      ["9", "11"],
      ["11", "12"],
      ["12", "13"],
      ["13", "14"],
      ["14", "8"],
      ["13", "17"],
      ["17", "16"],
      ["16", "15"],
      ["15", "14"],
    ] as const) {
      bonds.push(() => b.bond(id(from), id(to), 1));
    }
    // Narrow end at the stereocentre: chem-core's wedge runs from `from`.
    bonds.push(() => b.bond(id("10"), id("19"), 1, "wedge"));
    bonds.push(() => b.bond(id("13"), id("18"), 1, "wedge"));
    bonds.push(() => b.bond(id("3"), o3, 1, "wedge"));
    bonds.push(() => b.bond(id("17"), o17, 1, "wedge"));

    for (const addBond of options.reverseBonds ? [...bonds].reverse() : bonds) addBond();
  });
  return { molecule, locants: Object.freeze(locants) };
}

/** The molecule of `steroidSkeletonWithLocants`, for callers that want only it. */
export function steroidSkeleton(): Molecule {
  return steroidSkeletonWithLocants().molecule;
}

/**
 * Perhydrophenanthrene, C14H24: phenanthrene's three rings with every carbon
 * saturated, drawn flat, with no wedge anywhere.
 *
 * THE sp3 FUSED-RING CROWDING CASE. Nothing aromatic can stand in for it: an
 * aromatic junction carries no hydrogen, and a benzo CH has the whole outside
 * of its ring to fan into. Here every carbon carries one or two. The four
 * junction CHs each have three gaps of 120 degrees, two of them ring insides,
 * and the CH2s either side of a junction fan into the same pockets. It is the
 * steroid's rings A, B and C without its methyls, hydroxyls and wedges, so a
 * crowding count on it is about the ring system alone.
 *
 * NAMED FOR WHAT IT DRAWS. Its four junction centres carry no wedge, so the
 * drawing asserts no configuration at any of them, and neither does the name.
 *
 * NOT IN `FIXTURES`, for the steroid's reason: it would add a golden per view
 * and join sweeps about other things. The explicit-H crowding sweep in
 * `representations.test.ts` and `hydrogen-separation.test.ts` name it
 * directly.
 */
export function perhydrophenanthrene(): Molecule {
  return buildMolecule((b) => {
    const ringA: Vec2 = ORIGIN;
    const ringB: Vec2 = { x: Math.sqrt(3), y: 0 };
    const ringC: Vec2 = { x: 1.5 * Math.sqrt(3), y: 1.5 };
    const carbon = (centre: Vec2, degrees: number): AtomId => b.atom("C", step(centre, degrees));
    // Each ring's vertices at 30, 90 ... 330 degrees round its centre. A
    // shared vertex is minted ONCE, by the first ring that has it, so a
    // fusion atom is not two points a few ulps apart: ring B's 150 and 210
    // are ring A's 30 and 330, and ring C's 210 and 270 are ring B's 90 and
    // 30.
    const a = [30, 90, 150, 210, 270, 330].map((degrees) => carbon(ringA, degrees));
    const b30 = carbon(ringB, 30);
    const b90 = carbon(ringB, 90);
    const bRing = [b30, b90, a[0]!, a[5]!, carbon(ringB, 270), carbon(ringB, 330)];
    const cRing = [
      carbon(ringC, 30),
      carbon(ringC, 90),
      carbon(ringC, 150),
      b90,
      b30,
      carbon(ringC, 330),
    ];
    // Round each ring, skipping the edge a fusion already drew.
    const drawn = new Set<string>();
    for (const ring of [a, bRing, cRing]) {
      ring.forEach((from, i) => {
        const to = ring[(i + 1) % ring.length]!;
        const key = from < to ? `${from}-${to}` : `${to}-${from}`;
        if (drawn.has(key)) return;
        drawn.add(key);
        b.bond(from, to, 1);
      });
    }
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
  Object.freeze({ name: "cis2Butene", molecule: cis2Butene() }),
  Object.freeze({ name: "trans2Butene", molecule: trans2Butene() }),
  Object.freeze({
    name: "wedgeOnNonStereocentre",
    molecule: wedgeOnNonStereocentre(),
  }),
  Object.freeze({ name: "naphthalene", molecule: naphthalene() }),
  Object.freeze({ name: "dimethylSulfone", molecule: dimethylSulfone() }),
  Object.freeze({ name: "chrysene", molecule: chrysene() }),
  Object.freeze({
    name: "unmergedDropOverlap",
    molecule: unmergedDropOverlap(),
  }),
]);


// ---------------------------------------------------------------------------
// Mechanisms: molecules with the curly arrows a textbook draws on them
// ---------------------------------------------------------------------------

/**
 * A molecule and the curly arrows drawn on it, as a document would hold them.
 *
 * Kept OUT of `FIXTURES`: the arrows are a document field the scene takes as
 * an option (`SceneBuildOptions.schemeAnnotations`), so these get a contact
 * sheet section and goldens of their own rather than riding along with every
 * plain molecule. The bulges are the stored shapes, chosen once as an author
 * would and pinned: `test/curly-arrows.test.ts` asserts each draws clear —
 * no label or bond crossed — at both presets and in both views the sheet
 * shows, which is what `defaultCurlyArrowShape` promises a NEW arrow.
 */
export interface MechanismFixture {
  readonly name: string;
  readonly molecule: Molecule;
  readonly annotations: readonly CurlyArrowAnnotation[];
}

function curlyArrow(
  n: number,
  electrons: CurlyArrowAnnotation["electrons"],
  source: CurlyArrowAnnotation["source"],
  sink: CurlyArrowAnnotation["sink"],
  bulge: number,
  skew = 0,
): CurlyArrowAnnotation {
  const arrow = assembleSchemeAnnotation({
    id: schemeAnnotationId(n),
    kind: "curlyArrow",
    electrons,
    source,
    sink,
    bulge,
    skew,
  });
  return arrow as CurlyArrowAnnotation;
}

/**
 * Cyanide adding to acetone: the carbonyl addition every mechanism course
 * starts with. Two double-barbed arrows — the cyanide carbon's lone pair into
 * the carbonyl carbon (an ATOM sink), and the C=O pi pair up onto the oxygen
 * (a BOND source, a LONE-PAIR sink).
 *
 * Acetone is drawn C=O up with its methyls level; cyanide stands below the
 * carbonyl carbon, C-N pointing down, the Bürgi-Dunitz side. The first arrow
 * rises from the cyanide carbon and bows WEST — positive bulge, LEFT of
 * tail-to-head in y-up model space — and the second curls EAST off the C=O
 * onto the oxygen: negative bulge, right of its upward chord.
 * That makes this the fixture the y-flip test reads handedness off: a
 * perpendicular taken in the wrong space bows the first arrow down through
 * the methyl and the second into the cyanide.
 */
export function cyanideAdditionToAcetone(): MechanismFixture & {
  readonly carbonylCarbon: AtomId;
  readonly oxygen: AtomId;
  readonly carbonyl: BondId;
  readonly cyanideCarbon: AtomId;
} {
  let carbonylCarbon = "";
  let oxygen = "";
  let carbonyl = "";
  let cyanideCarbon = "";
  // chem-core's own `acetoneAndCyanide` (mechanism.test.ts), atom for atom,
  // so the arrows drawn here are the ones `applyArrows` is tested on.
  const molecule = buildMolecule((b) => {
    const alpha = b.atom("C", { x: -1, y: 0 });
    carbonylCarbon = b.atom("C", ORIGIN);
    b.bond(alpha, carbonylCarbon, 1);
    oxygen = b.atom("O", { x: 0, y: 1 });
    carbonyl = b.bond(carbonylCarbon, oxygen, 2);
    b.bond(carbonylCarbon, b.atom("C", { x: 1, y: 0 }), 1);
    cyanideCarbon = b.atom("C", { x: 0, y: -2 }, { charge: -1 });
    b.bond(cyanideCarbon, b.atom("N", { x: 0, y: -3 }), 3);
  });
  return {
    name: "cyanideAdditionToAcetone",
    molecule,
    annotations: [
      curlyArrow(1, "pair", { kind: "lonePair", atomId: cyanideCarbon }, { kind: "atom", atomId: carbonylCarbon }, 0.25),
      curlyArrow(2, "pair", { kind: "bond", bondId: carbonyl }, { kind: "lonePair", atomId: oxygen }, -0.7),
    ],
    carbonylCarbon,
    oxygen,
    carbonyl,
    cyanideCarbon,
  };
}

/**
 * Acetate's two resonance forms, the arrows that interconvert them: the
 * alkoxide oxygen's lone pair into the C-O bond (a BOND sink, decision 172's
 * case: aimed at the bond's midpoint, stopped at the double-bond gap) and the
 * C=O pi pair onto the other oxygen.
 */
export function acetateResonance(): MechanismFixture & {
  readonly alkoxide: AtomId;
  readonly singleCO: BondId;
} {
  let alkoxide = "";
  let singleCO = "";
  let doubleCO = "";
  let carbonylOxygen = "";
  const molecule = buildMolecule((b) => {
    const methyl = b.atom("C", ORIGIN);
    const carboxylPos = step(ORIGIN, 30);
    const carboxyl = b.atom("C", carboxylPos);
    b.bond(methyl, carboxyl, 1);
    carbonylOxygen = b.atom("O", step(carboxylPos, 90));
    doubleCO = b.bond(carboxyl, carbonylOxygen, 2);
    alkoxide = b.atom("O", step(carboxylPos, -30), { charge: -1 });
    singleCO = b.bond(carboxyl, alkoxide, 1);
  });
  return {
    name: "acetateResonance",
    molecule,
    annotations: [
      curlyArrow(1, "pair", { kind: "lonePair", atomId: alkoxide }, { kind: "bond", bondId: singleCO }, -0.7),
      curlyArrow(2, "pair", { kind: "bond", bondId: doubleCO }, { kind: "atom", atomId: carbonylOxygen }, 0.7),
    ],
    alkoxide,
    singleCO,
  };
}

/**
 * Homolysis of bromine: two single-barbed fishhooks from the Br-Br bond, one
 * onto each bromine. Each is an arrow from a bond to one of its OWN ends —
 * the short-chord case, half a bond long with a wide "Br" at the head — so it
 * is where the head-only fallback would show if a stored bulge left no room.
 */
export function bromineHomolysis(): MechanismFixture & { readonly bond: BondId } {
  let bond = "";
  let left = "";
  let right = "";
  const molecule = buildMolecule((b) => {
    left = b.atom("Br", ORIGIN);
    right = b.atom("Br", step(ORIGIN, 0));
    bond = b.bond(left, right, 1);
  });
  return {
    name: "bromineHomolysis",
    molecule,
    annotations: [
      curlyArrow(1, "single", { kind: "bond", bondId: bond }, { kind: "atom", atomId: left }, -0.7),
      curlyArrow(2, "single", { kind: "bond", bondId: bond }, { kind: "atom", atomId: right }, 0.7),
    ],
    bond,
  };
}

/** The mechanism fixtures, in the order the contact sheet shows them. */
export const MECHANISM_FIXTURES: readonly MechanismFixture[] = Object.freeze([
  cyanideAdditionToAcetone(),
  acetateResonance(),
  bromineHomolysis(),
]);
