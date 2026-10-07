/**
 * Molecular formula, weight, and exact mass.
 *
 * Formulae use Hill notation, which is what journals expect: carbon first,
 * hydrogen second, everything else alphabetical — and when there is no
 * carbon, everything alphabetical including hydrogen. The old
 * `sumFormulaString` emitted symbols in graph-traversal order, so the same
 * molecule produced different strings depending on which atom you drew first.
 */

import { QUERY_ELEMENT, requireElement } from "./elements.js";
import type { ElementSymbol } from "./elements.js";
import { requireAtom } from "./molecule.js";
import { nuclideMass } from "./nuclides.js";
import { species } from "./species.js";
import type { Molecule } from "./types.js";
import { atomQueryLabel, isGenericStructure } from "./query.js";
import { implicitHydrogenCount } from "./valence.js";

export type ElementCounts = Readonly<Record<ElementSymbol, number>>;

/**
 * Atom counts per element, implicit hydrogens folded into H.
 *
 * Query and generic atoms (decision 238) are NOT elements and are not
 * counted here; `genericAtomCounts` lists them. Keeping them out is what lets
 * every consumer of this map go on treating its keys as element symbols.
 */
export function elementCounts(mol: Molecule): ElementCounts {
  const counts: Record<ElementSymbol, number> = {};
  const bump = (symbol: ElementSymbol, n: number) => {
    if (n === 0) return;
    counts[symbol] = (counts[symbol] ?? 0) + n;
  };
  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    if (atom.query === undefined) bump(atom.element, 1);
    bump("H", implicitHydrogenCount(mol, atomId));
  }
  return counts;
}

/**
 * The placeholders of a generic structure, by the label the canvas draws —
 * `[["R1", 1], ["[Cl,Br,I]", 1]]` — R-groups first, then label order, with
 * numbers compared numerically so R2 precedes R10. Empty for an ordinary
 * compound.
 */
export function genericAtomCounts(mol: Molecule): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  const rgroups = new Set<string>();
  for (const atomId of mol.atomIds) {
    const query = requireAtom(mol, atomId).query;
    if (query === undefined) continue;
    const label = atomQueryLabel(query);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (query.kind === "rgroup") rgroups.add(label);
  }
  // R-groups first, as a Markush formula writes them, then everything else.
  return [...counts.entries()].sort(([a], [b]) => {
    const rank = Number(!rgroups.has(a)) - Number(!rgroups.has(b));
    return rank !== 0 ? rank : a.localeCompare(b, "en", { numeric: true });
  });
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

/**
 * A generic structure's placeholders follow the Hill-ordered elements as
 * their own symbols — C6H4ClR1 — which is how ChemDraw and the patent
 * literature write a Markush core's formula: what is drawn, then what is
 * not. They are never folded into an element.
 */
export function formulaParts(mol: Molecule): FormulaPart[] {
  const counts = elementCounts(mol);
  const parts: FormulaPart[] = [];
  for (const symbol of hillOrder(counts)) {
    const n = counts[symbol] ?? 0;
    parts.push({ kind: "symbol", text: symbol });
    if (n > 1) parts.push({ kind: "count", text: String(n) });
  }
  for (const [label, n] of genericAtomCounts(mol)) {
    parts.push({ kind: "symbol", text: label });
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
  /** True when the structure is generic and has no one mass at all. */
  readonly generic?: true;
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
  // A generic structure is a family of compounds (decision 238). Weighing the
  // drawn scaffold would print the mass of a fragment as the compound's, so
  // there is no mass — under either basis, and including a query BOND, whose
  // order decides how many hydrogens the scaffold carries.
  if (isGenericStructure(mol)) {
    return { symbol: QUERY_ELEMENT, massNumber: undefined, generic: true };
  }
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

/**
 * Thrown by `molecularWeight` and `exactMass` for a generic structure — one
 * carrying an R-group, a query atom or a query bond (decision 238). A Markush
 * drawing names a family of compounds and has no single mass; a number here
 * would be the scaffold's, printed as if it were a compound's.
 */
export class GenericStructureError extends Error {
  constructor() {
    super(
      "This is a generic structure: it carries R-groups, query atoms or query " +
        "bonds, so it names a family of compounds and has no single mass. " +
        "Replace the placeholders with real atoms to compute one.",
    );
    this.name = "GenericStructureError";
  }
}

function massOrThrow(result: number | MissingMass): number {
  if (typeof result === "number") return result;
  if (result.generic) throw new GenericStructureError();
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
  /**
   * True for an R-group, query-atom or query-bond structure (decision 238):
   * the formula lists the placeholders as drawn and both masses are
   * undefined, and a panel should say why rather than show a blank.
   */
  readonly generic: boolean;
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
    generic: isGenericStructure(mol),
  };
}

/**
 * Mass percentage of each element, from the same per-atom masses as
 * `molecularWeight` (IUPAC standard atomic weights, a labelled atom at its
 * nuclide's mass). Keys are the elements present; the values sum to 100.
 *
 * Throws `MissingIsotopeDataError` where `molecularWeight` does. Empty for an
 * empty structure.
 */
export function elementalComposition(mol: Molecule): Readonly<Record<ElementSymbol, number>> {
  const hydrogenWeight = requireElement("H").weight;
  const byElement: Record<ElementSymbol, number> = {};
  const add = (symbol: ElementSymbol, mass: number) => {
    byElement[symbol] = (byElement[symbol] ?? 0) + mass;
  };
  for (const atomId of mol.atomIds) {
    const atom = requireAtom(mol, atomId);
    const mass =
      atom.isotope === undefined
        ? requireElement(atom.element).weight
        : nuclideMass(atom.element, atom.isotope);
    if (mass === undefined) throw new MissingIsotopeDataError(atom.element, atom.isotope);
    add(atom.element, mass);
    const hydrogens = implicitHydrogenCount(mol, atomId);
    if (hydrogens > 0) add("H", hydrogens * hydrogenWeight);
  }
  const total = Object.values(byElement).reduce((sum, mass) => sum + mass, 0);
  const percentages: Record<ElementSymbol, number> = {};
  for (const [symbol, mass] of Object.entries(byElement)) {
    percentages[symbol] = (100 * mass) / total;
  }
  return percentages;
}

/**
 * The elements a CHNS combustion analyser measures, in the order the
 * "Anal. Calcd" line lists them. Oxygen is not among them: CHNS combustion
 * does not measure it, and the Calcd line conventionally leaves it out.
 */
const COMBUSTION_ELEMENTS: readonly ElementSymbol[] = ["C", "H", "N", "S"];

export type ElementalAnalysisLine =
  | {
      readonly ok: true;
      /** "Anal. Calcd for C9H8O4: C, 60.00; H, 4.48." */
      readonly text: string;
      /** The same line with the formula's counts as `<sub>`, for a word processor. */
      readonly html: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The calculated half of an experimental-section elemental analysis, in the
 * ACS Guide to Scholarly Communication form the JOC author guidelines quote:
 * "Anal. Calcd for C13H17NO3: C, 66.36; H, 7.28; N, 5.95." Percentages to two
 * decimals, the formula in Hill order. The "Found:" half is the chemist's
 * measurement, so it is never written. Decision 233.
 *
 * Refused, with the reason as a sentence, for a structure an analysis cannot
 * describe: an empty one, one of several species (a reaction scheme has no
 * single composition), one with a net charge (an analysed bulk sample is
 * neutral — a salt is drawn with both ions), one with none of C, H, N, S,
 * and one whose isotope label has no mass on record.
 */
export function elementalAnalysisLine(mol: Molecule): ElementalAnalysisLine {
  if (mol.atomIds.length === 0) {
    return { ok: false, reason: "Nothing has been drawn yet, so there is nothing to analyse." };
  }
  if (species(mol).length > 1) {
    return {
      ok: false,
      reason:
        "The drawing holds more than one compound, and an elemental analysis describes one. " +
        "Select the compound and copy the selection's analysis.",
    };
  }
  const charge = netCharge(mol);
  if (charge !== 0) {
    return {
      ok: false,
      reason:
        `The structure has a net charge of ${charge > 0 ? "+" : ""}${String(charge)}, and an analysed ` +
        "sample is neutral. Draw the counter-ion too.",
    };
  }
  let percentages: Readonly<Record<ElementSymbol, number>>;
  try {
    percentages = elementalComposition(mol);
  } catch (error) {
    if (error instanceof MissingIsotopeDataError) return { ok: false, reason: error.message };
    throw error;
  }
  const listed = COMBUSTION_ELEMENTS.filter((symbol) => percentages[symbol] !== undefined);
  if (listed.length === 0) {
    return {
      ok: false,
      reason: "The structure has no carbon, hydrogen, nitrogen or sulfur, so a CHNS analysis has nothing to report.",
    };
  }
  const values = listed
    .map((symbol) => `${symbol}, ${(percentages[symbol] ?? 0).toFixed(2)}`)
    .join("; ");
  const parts = formulaParts(mol);
  const text = parts.map((p) => p.text).join("");
  const html = parts.map((p) => (p.kind === "count" ? `<sub>${p.text}</sub>` : p.text)).join("");
  return {
    ok: true,
    text: `Anal. Calcd for ${text}: ${values}.`,
    html: `Anal. Calcd for ${html}: ${values}.`,
  };
}
