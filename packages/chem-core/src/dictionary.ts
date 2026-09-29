/**
 * The structure dictionary: common compounds a chemist types by name.
 *
 * A curated, checked-in list — solvents, a few arenes and heterocycles, the
 * common sugars, the twenty proteinogenic amino acids, the nucleobases and a
 * handful of drugs — each stored as a molblock and read with chem-core's own
 * reader. Looking a name up needs no network, no server and no wasm.
 *
 * NOT RE-EXPORTED FROM THE PACKAGE ROOT. The data is ~80 kB of molblock text
 * that only the insert box needs, so it has its own entry point
 * (`@starter/chem-core/dictionary`) and the client loads it on demand instead
 * of every page carrying it.
 *
 * NAMES ONLY RESOLVE WHAT IS LISTED. There is no name parser here: "glucose"
 * works because it is a synonym on a row, and "2-methylpropan-1-ol" does not
 * because no row lists it. Resolving arbitrary IUPAC or trade names needs
 * either a server (OPSIN) or a third-party lookup (PubChem), and that choice
 * was deferred rather than made quietly here.
 *
 * A SUM FORMULA IS NOT A STRUCTURE. C6H12O6 is glucose, galactose, mannose,
 * fructose and dozens more; C2H6O is ethanol and dimethyl ether. So a formula
 * is only ever a filter over this list — `dictionaryEntriesWithFormula` returns
 * every listed compound with that composition and the caller has to let the
 * user pick. It never produces a structure on its own.
 */

import { DICTIONARY_ENTRIES } from "./dictionary-entries.js";
import { elementBySymbol } from "./elements.js";
import { elementCounts, netCharge, type ElementCounts } from "./formula.js";
import { readMolblock } from "./molblock-read.js";
import { normalizeBondLength } from "./transform.js";
import type { Molecule } from "./types.js";

export type DictionaryCategory =
  | "solvent"
  | "aromatic"
  | "sugar"
  | "amino-acid"
  | "nucleobase"
  | "biomolecule"
  | "drug";

export interface DictionaryEntry {
  /** Stable key, kebab-case. */
  readonly id: string;
  /** Display name, written the way a paper writes it: "β-D-glucopyranose". */
  readonly name: string;
  /** Other names that resolve to this entry exactly: "glucose", "Ala", "DMSO". */
  readonly synonyms: readonly string[];
  readonly category: DictionaryCategory;
  /** Provenance only. chem-core has no SMILES parser and never reads it. */
  readonly smiles: string;
  /** Provenance only, and what the client's fidelity test checks against. */
  readonly inchiKey: string;
  readonly molblock: string;
}

export const STRUCTURE_DICTIONARY: readonly DictionaryEntry[] = DICTIONARY_ENTRIES;

const BY_ID = new Map(STRUCTURE_DICTIONARY.map((entry) => [entry.id, entry]));

export function dictionaryEntryById(id: string): DictionaryEntry | undefined {
  return BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The key two spellings of one name share.
 *
 * Case, spaces, hyphens, commas and brackets are all dropped, and Greek α/β
 * are spelled out: "β-D-Glucose", "beta-d-glucose" and "Beta D glucose" are one
 * key. Digits are KEPT — "1,4-dioxane" and "1,3-dioxane" are different
 * compounds, and so are "2-propanol" and "1-propanol".
 */
export function normalizeStructureName(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/[^a-z0-9]/g, "");
}

/** Every key an entry answers to, with the spelling it came from. */
interface NameKey {
  readonly entry: DictionaryEntry;
  readonly key: string;
  readonly spelling: string;
  readonly isName: boolean;
}

const NAME_KEYS: readonly NameKey[] = STRUCTURE_DICTIONARY.flatMap((entry) => [
  { entry, key: normalizeStructureName(entry.name), spelling: entry.name, isName: true },
  ...entry.synonyms.map((synonym) => ({
    entry,
    key: normalizeStructureName(synonym),
    spelling: synonym,
    isName: false,
  })),
]);

/**
 * The entry this text names EXACTLY, after normalisation, or undefined.
 *
 * Exact only. "gluc" is not glucose here — a prefix is a suggestion, which is
 * `searchDictionary`'s job, and an insert box that silently completed a
 * half-typed name would insert something the user never asked for.
 */
export function findDictionaryEntryByName(text: string): DictionaryEntry | undefined {
  const key = normalizeStructureName(text);
  if (key === "") return undefined;
  return NAME_KEYS.find((candidate) => candidate.key === key)?.entry;
}

export type DictionaryMatchKind = "exact" | "prefix" | "substring";

export interface DictionaryMatch {
  readonly entry: DictionaryEntry;
  readonly kind: DictionaryMatchKind;
  /** The name or synonym that matched, as the list spells it. */
  readonly matched: string;
}

/** Below this many characters a substring match is noise: "c" is in half the list. */
const MIN_SEARCH_LENGTH = 2;

const KIND_RANK: Readonly<Record<DictionaryMatchKind, number>> = {
  exact: 0,
  prefix: 1,
  substring: 2,
};

/**
 * Entries whose name or a synonym contains the query, best first, one row per
 * entry.
 *
 * Ranked exact, then prefix, then substring; within a rank the entry's own name
 * beats a synonym and a shorter name beats a longer one ("glucose" should offer
 * β-D-glucopyranose before sucrose), with list order as the last tiebreak so
 * the ranking is stable.
 */
export function searchDictionary(text: string, limit = 8): readonly DictionaryMatch[] {
  const key = normalizeStructureName(text);
  if (key.length < MIN_SEARCH_LENGTH) {
    const exact = findDictionaryEntryByName(text);
    return exact === undefined ? [] : [{ entry: exact, kind: "exact", matched: exact.name }];
  }
  const best = new Map<string, { match: DictionaryMatch; order: readonly number[] }>();
  NAME_KEYS.forEach((candidate, index) => {
    const at = candidate.key.indexOf(key);
    if (at < 0) return;
    const kind: DictionaryMatchKind =
      candidate.key === key ? "exact" : at === 0 ? "prefix" : "substring";
    const order = [
      KIND_RANK[kind],
      candidate.isName ? 0 : 1,
      candidate.key.length,
      index,
    ];
    const previous = best.get(candidate.entry.id);
    if (previous !== undefined && compareOrder(previous.order, order) <= 0) return;
    best.set(candidate.entry.id, {
      match: { entry: candidate.entry, kind, matched: candidate.spelling },
      order,
    });
  });
  return [...best.values()]
    .sort((a, b) => compareOrder(a.order, b.order))
    .slice(0, limit)
    .map((ranked) => ranked.match);
}

function compareOrder(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

const MOLECULES = new Map<string, Molecule>();

/**
 * The entry as a molecule at the standard bond length (one model unit).
 *
 * RDKit's CoordGen lays structures out at a bond of 1.0 molfile units, which
 * the reader divides by the usual 1.5, so the length is normalised here
 * rather than trusted — the same step every import goes through.
 *
 * Cached per entry: a molecule is immutable, and the formula index below reads
 * every entry at once.
 *
 * @throws when the checked-in molblock no longer reads cleanly — a corrupt
 * generated file, not something a user can cause, and the test suite reads
 * every entry.
 */
export function dictionaryMolecule(entry: DictionaryEntry): Molecule {
  const cached = MOLECULES.get(entry.id);
  if (cached !== undefined) return cached;
  const read = readMolblock(entry.molblock);
  if (read.warnings.length > 0) {
    throw new Error(
      `Dictionary entry ${entry.id} did not read cleanly: ${read.warnings
        .map((warning) => warning.kind)
        .join(", ")}`,
    );
  }
  const molecule = normalizeBondLength(read.molecule);
  MOLECULES.set(entry.id, molecule);
  return molecule;
}

// ---------------------------------------------------------------------------
// Sum formulas
// ---------------------------------------------------------------------------

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Read a typed sum formula into element counts, or undefined when the text is
 * not one.
 *
 * Accepts element symbols with optional counts in any order, Unicode subscript
 * digits included ("C₆H₁₂O₆"). A symbol may repeat and the counts add, so a
 * condensed spelling like "CH3COOH" reads as the composition C2H4O2 — it is a
 * filter over the list, and the list shows which compound matched.
 *
 * Case matters, because it does in chemistry: "Co" is cobalt and "CO" is
 * carbon and oxygen. Brackets, charges, hydrates and isotopes are not read; a
 * formula that needs them names nothing in this list anyway.
 */
export function parseSumFormula(text: string): ElementCounts | undefined {
  const compact = text
    .trim()
    .replace(/[₀-₉]/g, (d) => String(SUBSCRIPT_DIGITS.indexOf(d)));
  if (!/^(?:[A-Z][a-z]?\d*)+$/.test(compact)) return undefined;
  const counts: Record<string, number> = {};
  for (const [, symbol, digits] of compact.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (symbol === undefined || elementBySymbol(symbol) === undefined) return undefined;
    const n = digits === undefined || digits === "" ? 1 : Number(digits);
    if (!Number.isSafeInteger(n) || n <= 0) return undefined;
    counts[symbol] = (counts[symbol] ?? 0) + n;
  }
  return counts;
}

function sameCounts(a: ElementCounts, b: ElementCounts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

let formulaIndex: readonly { readonly entry: DictionaryEntry; readonly counts: ElementCounts }[] | undefined;

/**
 * Every listed compound with exactly this composition, in list order.
 *
 * Neutral entries only are ever matched, since the typed formula carries no
 * charge — and every entry is neutral today. Built lazily on the first call:
 * it has to read every molblock once.
 */
export function dictionaryEntriesWithFormula(counts: ElementCounts): readonly DictionaryEntry[] {
  formulaIndex ??= STRUCTURE_DICTIONARY.map((entry) => {
    const molecule = dictionaryMolecule(entry);
    return { entry, counts: elementCounts(molecule), neutral: netCharge(molecule) === 0 };
  })
    .filter((row) => row.neutral)
    .map(({ entry, counts: c }) => ({ entry, counts: c }));
  return formulaIndex.filter((row) => sameCounts(row.counts, counts)).map((row) => row.entry);
}
