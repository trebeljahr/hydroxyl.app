/**
 * Molecular formula, weight, and exact mass.
 *
 * Formulae use Hill notation, which is what journals expect: carbon first,
 * hydrogen second, everything else alphabetical — and when there is no
 * carbon, everything alphabetical including hydrogen. The old
 * `sumFormulaString` emitted symbols in graph-traversal order, so the same
 * molecule produced different strings depending on which atom you drew first.
 */

import { requireElement } from "./elements.js";
import type { ElementSymbol } from "./elements.js";
import { requireAtom } from "./molecule.js";
import { nuclideMass } from "./nuclides.js";
import type { Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

export type ElementCounts = Readonly<Record<ElementSymbol, number>>;

/**
 * Atom counts per element, implicit hydrogens folded into H.
 */
export function elementCounts(mol: Molecule): ElementCounts {
  const counts: Record<ElementSymbol, number> = {};
  const bump = (symbol: ElementSymbol, n: number) => {
    if (n === 0) return;
    counts[symbol] = (counts[symbol] ?? 0) + n;
  };
  for (const atomId of mol.atomIds) {
    bump(requireAtom(mol, atomId).element, 1);
    bump("H", implicitHydrogenCount(mol, atomId));
  }
  return counts;
}

/** Net formal charge across the structure. */
export function netCharge(mol: Molecule): number {
  let total = 0;
  for (const atomId of mol.atomIds) total += requireAtom(mol, atomId).charge;
  return total;
}

/** Element symbols ordered by Hill convention. */
export function hillOrder(counts: ElementCounts): ElementSymbol[] {
  const symbols = Object.keys(counts).filter((s) => (counts[s] ?? 0) > 0);
  const hasCarbon = symbols.includes("C");
  const rest = symbols
    .filter((s) => !(hasCarbon && (s === "C" || s === "H")))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (!hasCarbon) return rest;
  return ["C", ...(counts["H"] ? ["H"] : []), ...rest];
}

/**
 * A formula broken into renderable pieces, so the SVG and HTML renderers can
 * set counts as real subscripts and charges as superscripts instead of
 * hand-parsing a flat string.
 */
export type FormulaPart =
  | { readonly kind: "symbol"; readonly text: string }
  | { readonly kind: "count"; readonly text: string }
  | { readonly kind: "charge"; readonly text: string };

export function formulaParts(mol: Molecule): FormulaPart[] {
  const counts = elementCounts(mol);
  const parts: FormulaPart[] = [];
  for (const symbol of hillOrder(counts)) {
    const n = counts[symbol] ?? 0;
    parts.push({ kind: "symbol", text: symbol });
    if (n > 1) parts.push({ kind: "count", text: String(n) });
  }
  const charge = netCharge(mol);
  if (charge !== 0) {
    const magnitude = Math.abs(charge);
    parts.push({
      kind: "charge",
      text: `${magnitude > 1 ? magnitude : ""}${charge > 0 ? "+" : "-"}`,
    });
  }
  return parts;
}

/**
 * Plain-text formula, e.g. "C6H6", "C2H6O", "[C2H3O2]-".
 *
 * Charged species are bracketed. In flat ASCII a trailing count and a charge
 * magnitude run together — "Mg2" plus "2+" reads as "Mg22+", which could be
 * either two Mg with charge 2+ or twenty-two Mg with charge +. Brackets are
 * the standard fix and remove the ambiguity entirely.
 *
 * Subscripts are plain digits; use `formulaParts` where you can render real
 * sub- and superscripts, which need no brackets.
 */
export function molecularFormula(mol: Molecule): string {
  const parts = formulaParts(mol);
  const body = parts
    .filter((p) => p.kind !== "charge")
    .map((p) => p.text)
    .join("");
  const charge = parts.find((p) => p.kind === "charge");
  if (!charge) return body;
  return `[${body}]${charge.text}`;
}

/** Unicode-subscript formula, e.g. "C₆H₆". Handy for plain-text contexts. */
export function molecularFormulaUnicode(mol: Molecule): string {
  const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
  const SUPERSCRIPTS: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻",
  };
  return formulaParts(mol)
    .map((part) => {
      if (part.kind === "symbol") return part.text;
      if (part.kind === "count") {
        return [...part.text].map((d) => SUBSCRIPTS[Number(d)] ?? d).join("");
      }
      return [...part.text].map((c) => SUPERSCRIPTS[c] ?? c).join("");
    })
    .join("");
}

/**
 * Which mass an unlabelled atom is counted at: the IUPAC standard atomic
 * weight for an average molecular weight, the most abundant isotope's mass
 * for an exact one. A labelled atom is its nuclide's mass under either.
 */
type MassBasis = "average" | "monoisotopic";

/** The first mass `sumMasses` could not find. */
interface MissingMass {
  readonly symbol: ElementSymbol;
  /** The labelled mass number, or undefined for an unlabelled atom. */
  readonly massNumber: number | undefined;
}

/**
 * Every atom's mass plus its hydrogens', or the first mass not on record. The
 * throwing functions, the `canCompute…` predicates and `massSummary` all read
 * this one walk, so they cannot disagree about what is computable.
 *
 * PER ATOM, NOT PER ELEMENT. `elementCounts` buckets by element and has to,
 * for the formula; a mass computed from it cannot tell ¹³C from ¹²C, which
 * left [1-¹³C]benzene at benzene's 78.0470 (decision 118). An atom carrying
 * `isotope` is counted at `nuclideMass` under both bases — the average weight
 * of a specifically labelled compound holds that position at its nuclide too,
 * which is what RDKit's `MolWt` does and what a CDCl3 bottle's 120.38 means.
 * A nuclide with no mass on record is missing, never replaced by the element's
 * mass or by the mass number.
 *
 * Implicit and pinned hydrogens are natural hydrogen: a label needs an atom to
 * sit on, so deuterium is always a drawn H with `isotope: 2`.
 */
function sumMasses(mol: Molecule, basis: MassBasis): number | MissingMass {
  const hydrogen = requireElement("H");
  const hydrogenMass = basis === "average" ? hydrogen.weight : hydrogen.monoisotopic;
  let total = 0;
  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    let mass: number | undefined;
    if (atom.isotope === undefined) {
      const element = requireElement(atom.element);
      mass = basis === "average" ? element.weight : element.monoisotopic;
    } else {
      mass = nuclideMass(atom.element, atom.isotope);
    }
    if (mass === undefined) return { symbol: atom.element, massNumber: atom.isotope };
    total += mass;
    const hydrogens = implicitHydrogenCount(mol, atomId);
    if (hydrogens === 0) continue;
    if (hydrogenMass === undefined) return { symbol: "H", massNumber: undefined };
    total += hydrogens * hydrogenMass;
  }
  return total;
}

export class MissingIsotopeDataError extends Error {
  readonly symbol: ElementSymbol;
  /**
   * The mass number of the labelled atom whose nuclide mass is missing, or
   * undefined when it is the element's own monoisotopic mass.
   */
  readonly massNumber: number | undefined;
  constructor(symbol: ElementSymbol, massNumber: number | undefined = undefined) {
    super(
      massNumber === undefined
        ? `No monoisotopic mass on record for ${symbol}, so the exact mass cannot ` +
            `be computed. Add a verified value to the element table rather than ` +
            `approximating it with the standard atomic weight.`
        : `No atomic mass on record for the nuclide ${String(massNumber)}${symbol}, so ` +
            `no mass that counts this isotope label can be computed. Add a verified ` +
            `AME2020 value to nuclides.ts rather than approximating it with the mass ` +
            `number or the element's weight.`,
    );
    this.name = "MissingIsotopeDataError";
    this.symbol = symbol;
    this.massNumber = massNumber;
  }
}

function massOrThrow(result: number | MissingMass): number {
  if (typeof result === "number") return result;
  throw new MissingIsotopeDataError(result.symbol, result.massNumber);
}

/**
 * Average molecular weight, from IUPAC standard atomic weights, in g/mol.
 * This is the number that belongs on a synthesis scheme.
 *
 * An isotope-labelled atom counts at its nuclide's mass, so [¹³C]methanol is
 * 33.034 rather than methanol's 32.042. Throws `MissingIsotopeDataError` for a
 * label whose nuclide mass is not on record, for the reason `exactMass` does.
 */
export function molecularWeight(mol: Molecule): number {
  return massOrThrow(sumMasses(mol, "average"));
}

/** Whether `molecularWeight` can be computed for this structure. */
export function canComputeMolecularWeight(mol: Molecule): boolean {
  return typeof sumMasses(mol, "average") === "number";
}

/**
 * Monoisotopic (exact) mass — the number a high-resolution MS is compared
 * against. Throws rather than substituting the average weight when an
 * element's isotope mass is not on record: silently mixing average and exact
 * masses produces a plausible-looking number that is simply wrong.
 *
 * An isotope-labelled atom counts at its nuclide's mass, not the element's
 * most abundant one: [1-¹³C]benzene is 79.0503, not 78.0470. A label whose
 * nuclide mass is not on record throws too.
 */
export function exactMass(mol: Molecule): number {
  return massOrThrow(sumMasses(mol, "monoisotopic"));
}

/** Whether `exactMass` can be computed for this structure. */
export function canComputeExactMass(mol: Molecule): boolean {
  return typeof sumMasses(mol, "monoisotopic") === "number";
}

export interface MassSummary {
  readonly formula: string;
  readonly formulaUnicode: string;
  readonly parts: readonly FormulaPart[];
  /** Undefined when an isotope label's nuclide mass is not on record. */
  readonly molecularWeight: number | undefined;
  /** Undefined when an element's or a label's exact mass is not on record. */
  readonly exactMass: number | undefined;
  readonly netCharge: number;
  readonly heavyAtomCount: number;
}

/** Everything the identifiers panel shows, in one pass. */
export function massSummary(mol: Molecule): MassSummary {
  const heavy = mol.atomIds.filter(
    (id) => requireAtom(mol, id).element !== "H",
  ).length;
  const weight = sumMasses(mol, "average");
  const exact = sumMasses(mol, "monoisotopic");
  return {
    formula: molecularFormula(mol),
    formulaUnicode: molecularFormulaUnicode(mol),
    parts: formulaParts(mol),
    molecularWeight: typeof weight === "number" ? weight : undefined,
    exactMass: typeof exact === "number" ? exact : undefined,
    netCharge: netCharge(mol),
    heavyAtomCount: heavy,
  };
}
