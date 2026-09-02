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
  fromPolar,
  ORIGIN,
} from "@starter/chem-core";
import type { Molecule, Vec2 } from "@starter/chem-core";

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
  Object.freeze({ name: "acetate", molecule: acetate() }),
]);

