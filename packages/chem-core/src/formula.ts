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
 * Average molecular weight, from IUPAC standard atomic weights, in g/mol.
 * This is the number that belongs on a synthesis scheme.
 */
export function molecularWeight(mol: Molecule): number {
  const counts = elementCounts(mol);
  let total = 0;
  for (const [symbol, n] of Object.entries(counts)) {
    total += requireElement(symbol).weight * n;
  }
  return total;
}

export class MissingIsotopeDataError extends Error {
  readonly symbol: ElementSymbol;
  constructor(symbol: ElementSymbol) {
    super(
      `No monoisotopic mass on record for ${symbol}, so the exact mass cannot ` +
        `be computed. Add a verified value to the element table rather than ` +
        `approximating it with the standard atomic weight.`,
    );
    this.name = "MissingIsotopeDataError";
    this.symbol = symbol;
  }
}

/**
 * Monoisotopic (exact) mass — the number a high-resolution MS is compared
 * against. Throws rather than substituting the average weight when an
 * element's isotope mass is not on record: silently mixing average and exact
 * masses produces a plausible-looking number that is simply wrong.
 */
export function exactMass(mol: Molecule): number {
  const counts = elementCounts(mol);
  let total = 0;
  for (const [symbol, n] of Object.entries(counts)) {
    const element = requireElement(symbol);
    if (element.monoisotopic === undefined) {
      throw new MissingIsotopeDataError(symbol);
    }
    total += element.monoisotopic * n;
  }
  return total;
}

/** Whether `exactMass` can be computed for this structure. */
export function canComputeExactMass(mol: Molecule): boolean {
  return Object.keys(elementCounts(mol)).every(
    (symbol) => requireElement(symbol).monoisotopic !== undefined,
  );
}

export interface MassSummary {
  readonly formula: string;
  readonly formulaUnicode: string;
  readonly parts: readonly FormulaPart[];
  readonly molecularWeight: number;
  readonly exactMass: number | undefined;
  readonly netCharge: number;
  readonly heavyAtomCount: number;
}

/** Everything the identifiers panel shows, in one pass. */
export function massSummary(mol: Molecule): MassSummary {
  const counts = elementCounts(mol);
  const heavy = mol.atomIds.filter(
    (id) => requireAtom(mol, id).element !== "H",
  ).length;
  const canExact = Object.keys(counts).every(
    (s) => requireElement(s).monoisotopic !== undefined,
  );
  return {
    formula: molecularFormula(mol),
    formulaUnicode: molecularFormulaUnicode(mol),
    parts: formulaParts(mol),
    molecularWeight: molecularWeight(mol),
    exactMass: canExact ? exactMass(mol) : undefined,
    netCharge: netCharge(mol),
    heavyAtomCount: heavy,
  };
}
