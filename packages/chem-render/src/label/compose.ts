/**
 * What an atom label SAYS: an ordered run of text spans, and nothing else.
 *
 * NO PIXELS LEAVE THIS FILE. There is not a coordinate, a font size or a
 * `RenderStyle` anywhere in it, and there must never be one. Composition is a
 * chemistry question — which symbol, how many hydrogens, which sign — and
 * geometry is a typography question, and keeping them apart is what lets the
 * placement pass be tested against strings and the composer be tested against
 * molecules. It is also what keeps the model-to-px scale in `style.ts`: a
 * composer that computed even one length would be a second place that knew
 * how big things are.
 *
 * A label is a sequence of BLOCKS — isotope, symbol, hydrogens, charge — each
 * a small array of spans, plus a radical-dot count. Orientation reorders the
 * blocks and never their contents; see `labelSpans`.
 */

import { getAtom, implicitHydrogenCount } from "@starter/chem-core";
import type { Atom, AtomId, ElementSymbol, Molecule } from "@starter/chem-core";

import type { StructuralRepresentation } from "../representation.js";
import type { TextSpan } from "../scene/types.js";
import {
  atomLabelReason,
  atomShowsHydrogens,
  drawnCharge,
  labelOverride,
  radicalDotCount,
} from "./visibility.js";
import type { LabelReason } from "./visibility.js";

/**
 * Which side of the symbol the hydrogen block sits on.
 *
 * Named for the PAGE, not for the model. "east" is to the right of the atom in
 * the finished picture — scene +x, after the y-flip — and calling it "right"
 * would invite reading it as a model-space direction on a y-up coordinate
 * system where the flip has not happened yet.
 */
export type LabelSide = "east" | "west";

/**
 * A composed label, as blocks.
 *
 * Blocks are plain span arrays and are empty rather than absent when they do
 * not apply. An optional block would make every consumer write the same
 * `?? []`, and a `LabelBlock` wrapper carrying a discriminator would be state
 * nothing reads: the run's order is decided by `labelSpans`, and the one index
 * anybody needs is `symbolSpanIndex`.
 */
export interface ComposedLabel {
  readonly atomId: AtomId;
  /**
   * The atom's element, carried through for exactly one purpose: the
   * placement pass's hydrogen-first test for a lone atom (H₂O, not OH₂). It is
   * the ELEMENT, not the override — an atom labelled "Ph" has no hydrogens to
   * order.
   */
  readonly element: ElementSymbol;
  readonly reason: LabelReason;
  /** Superscript mass-number digits, or []. Glued left of `symbol` both ways. */
  readonly isotope: readonly TextSpan[];
  /** THE ANCHOR: always exactly one plain span, centred on the atom. */
  readonly symbol: readonly TextSpan[];
  readonly hydrogens: readonly TextSpan[];
  readonly charge: readonly TextSpan[];
  /**
   * How many hydrogens are actually DRAWN — 0 when the override suppressed
   * them. A diagnostic for tests and debug overlays, deliberately not a
   * chemistry query: anything that wants the real count calls
   * `implicitHydrogenCount` on the molecule, as this file does.
   */
  readonly hydrogenCount: number;
  readonly radicalDotCount: number;
}

/**
 * Composes the label for `atomId`, or undefined if the atom is a bare vertex.
 *
 * Returning undefined rather than an empty label is what keeps the visibility
 * decision and the composition from drifting: the call site reads
 * `if (label === undefined) { draw a bare vertex }` and there is no second
 * condition anywhere that could disagree with `atomLabelReason`.
 *
 * Takes no `RenderStyle`, by construction — see the module header.
 *
 * The only path that throws is `implicitHydrogenCount` reaching an element
 * that is not in chem-core's table. That is left to propagate: a plausible
 * wrong hydrogen count renders perfectly and is far worse than a stack trace,
 * which is the same reason `exactMass()` throws rather than guessing.
 */
export function composeAtomLabel(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): ComposedLabel | undefined {
  const reason = atomLabelReason(mol, atomId, representation);
  if (reason === undefined) return undefined;
  const atom = getAtom(mol, atomId);
  // Unreachable: `atomLabelReason` returns undefined for an absent atom. The
  // check is here because the type says it can be, and coercing it away would
  // turn a real bug into a label reading "undefined".
  if (atom === undefined) return undefined;

  const override = labelOverride(atom);

  // An isotope prefix is dropped under an override for the same reason the
  // hydrogens are: "¹³Ph" claims an entire phenyl group is carbon-13, when the
  // mass number belongs to the one atom the symbol was standing for.
  const isotope: TextSpan[] =
    override === undefined &&
    atom.isotope !== undefined &&
    Number.isFinite(atom.isotope) &&
    atom.isotope > 0
      ? [{ text: String(atom.isotope), script: "super" }]
      : [];

  // Exactly one plain span, and the override is NOT parsed for digits to set
  // as subscripts: "SO3H" typed by a chemist is a fragment name they chose the
  // spelling of, and a renderer second-guessing it would make "Boc" and "R"
  // the only abbreviations it did not rewrite.
  const symbol: TextSpan[] = [{ text: override ?? atom.element }];

  const hydrogenCount = atomShowsHydrogens(mol, atomId, representation)
    ? implicitHydrogenCount(mol, atomId)
    : 0;
  // Never "H1" and never "H0": one hydrogen is written bare, none is written
  // not at all. The count sits to the RIGHT of the H inside the block even
  // when the block flips west, because chemists write "H₃C–" and never "₃HC".
  const hydrogens: TextSpan[] =
    hydrogenCount <= 0
      ? []
      : hydrogenCount === 1
        ? [{ text: "H" }]
        : [{ text: "H" }, { text: String(hydrogenCount), script: "sub" }];

  const charge = representation.flags.showCharges ? chargeSpans(atom) : [];

  return {
    atomId,
    element: atom.element,
    reason,
    isotope,
    symbol,
    hydrogens,
    charge,
    hydrogenCount,
    radicalDotCount: radicalDotCount(atom),
  };
}

/**
 * The charge block: one superscript span, or none.
 *
 * ONE span, not a magnitude and a sign: "2+" is a single typographic unit, and
 * splitting it invites a later pass to place, colour or reorder the sign
 * independently of the number it belongs to.
 *
 * The negative sign is U+2212 MINUS SIGN, not U+002D HYPHEN-MINUS. A hyphen is
 * drawn short and set low in every text face — beside a superscript it reads
 * as a bond, which is precisely the wrong thing for it to read as in a
 * structural drawing. chem-core's `formulaParts` uses ASCII "-" on purpose,
 * because it is producing a plain-text string a user pastes elsewhere; the
 * divergence between the two is intentional and neither should be "fixed" to
 * match the other.
 */
function chargeSpans(atom: Atom): TextSpan[] {
  const charge = drawnCharge(atom);
  if (charge === 0) return [];
  const sign = charge > 0 ? "+" : "−";
  const magnitude = Math.abs(charge);
  return [{ text: magnitude === 1 ? sign : `${magnitude}${sign}`, script: "super" }];
}

/**
 * The label's spans in drawing order, for a given orientation.
 *
 * east: isotope, symbol, hydrogens, charge — "¹³CH₃", "NH₄⁺".
 * west: hydrogens, isotope, symbol, charge — "H₃¹³C", "H₄N⁺".
 *
 * Two blocks do not move:
 *
 * The ISOTOPE stays glued to the symbol's left in both orientations, because
 * that is where a mass number goes in nuclide notation and nowhere else.
 *
 * The CHARGE terminates the run in both orientations, so a west-flipped
 * ammonium is "H₄N⁺" and not "⁺H₄N". The top-left corner of a label belongs to
 * the isotope and the top-right to the charge; a leading superscript reads as
 * a mass number, which makes "⁻O" say oxygen-minus-something rather than
 * oxide.
 *
 * Only whole blocks move. Reversing the span array instead would turn
 * "H" + subscript "3" into subscript "3" + "H", setting "₃HC".
 */
export function labelSpans(
  label: ComposedLabel,
  side: LabelSide,
): readonly TextSpan[] {
  return side === "east"
    ? [...label.isotope, ...label.symbol, ...label.hydrogens, ...label.charge]
    : [...label.hydrogens, ...label.isotope, ...label.symbol, ...label.charge];
}

/**
 * Where the symbol span sits within `labelSpans(label, side)`.
 *
 * THE seam the placement pass needs. The atom sits under the symbol's advance
 * midpoint, not the run's: centring the whole run puts the bond in the gap
 * between the O and the H of "OH", and puts a carbon-13's bond under its mass
 * number. Handing back an index rather than re-deriving one from the block
 * lengths at the call site keeps the run's order defined in exactly one place.
 */
export function symbolSpanIndex(label: ComposedLabel, side: LabelSide): number {
  return side === "east"
    ? label.isotope.length
    : label.hydrogens.length + label.isotope.length;
}

/**
 * The run as flat text, scripts collapsed: "OH", "HO", "CH3", "O−", "H313C".
 *
 * For tests and debug output only. It is lossy by design — a reader cannot
 * tell the "3" of "H313C" from the "13" — and nothing that draws may use it.
 */
export function labelPlainText(label: ComposedLabel, side: LabelSide): string {
  return labelSpans(label, side)
    .map((span) => span.text)
    .join("");
}

/** `atom:a2:label`. One run per label, so there is no part to distinguish. */
export function labelRunId(atomId: AtomId): string {
  return `atom:${atomId}:label`;
}

/**
 * `atom:a2:radical:0`. The index indexes ONE ATOM'S OWN cluster, so it is a
 * pure function of that atom exactly as `bond:b3:line` is of that bond — never
 * a counter that advances as iteration reaches atoms.
 *
 * WHY A DOT IS A CIRCLE PRIMITIVE AND NOT A "•" SPAN. U+2022 is in the
 * vendored subset (advance 717), so the lazy path is available; it is still
 * wrong, four times over:
 *
 *   1. An exported SVG's text can render with a substituted face, and a bullet
 *      that fails to substitute turns a radical into a closed-shell species
 *      without any other visible change.
 *   2. A glyph can only sit on the run's baseline, in run order. A dot belongs
 *      in the free space AROUND the atom, which is not on any baseline.
 *   3. A dot is a chemical mark. It must scale with the structure's line
 *      weight, not with whatever typeface the figure happens to be set in.
 *   4. `sceneBounds` measures a circle exactly, with no font metrics in the
 *      path at all.
 *
 * The Lewis pass's lone pairs are a different mark and must NOT reuse these
 * ids: a lone pair and a radical on the same atom would collide, and the
 * collision would silently drop one of them from the scene.
 */
export function radicalDotId(atomId: AtomId, index: number): string {
  return `atom:${atomId}:radical:${index}`;
}
