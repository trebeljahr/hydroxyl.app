/**
 * Query atoms, generic atoms, R-groups and query bonds (decisions 228, 238).
 *
 * A Markush figure draws placeholders where a real structure would draw
 * atoms: R1 on a ring, X for "a halogen", `[Cl,Br,I]` for an element list, a
 * dashed "any" bond. chem-core holds each as an ordinary atom or bond with a
 * `query` record beside it, so every traversal, layout pass, selection and
 * copy keeps working on them with no special case. What changes is only what
 * the chemistry queries are willing to say:
 *
 *   - A query atom's `element` is `QUERY_ELEMENT`, which has no valence list.
 *     It takes no implicit hydrogens and is never over-valent, because what
 *     it stands for is not drawn.
 *   - Formula and mass say the structure is generic rather than counting the
 *     placeholder as something (formula.ts). `exactMass()` throws.
 *   - A query bond counts at the lowest order it admits (`BOND_QUERY_ORDER`).
 *
 * Imports nothing that knows about a Molecule's helpers, so molecule.ts can
 * read `atomQueriesEqual` without a cycle.
 */

import { isKnownElement } from "./elements.js";
import type { ElementSymbol } from "./elements.js";
import type { Atom, AtomQuery, Bond, BondOrder, BondQuery, Molecule } from "./types.js";

/** True when the atom is a placeholder rather than an element. */
export function isQueryAtom(atom: Atom): boolean {
  return atom.query !== undefined;
}

/** Value equality; query records are data, never compared by reference. */
export function atomQueriesEqual(a: AtomQuery | undefined, b: AtomQuery | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  switch (a.kind) {
    case "rgroup":
      return b.kind === "rgroup" && a.index === b.index;
    case "any":
      return b.kind === "any" && a.symbol === b.symbol;
    case "generic":
      return b.kind === "generic" && a.label === b.label;
    case "list":
      return (
        b.kind === "list" &&
        a.negated === b.negated &&
        a.elements.length === b.elements.length &&
        a.elements.every((symbol, i) => symbol === b.elements[i])
      );
  }
}

/**
 * The query in canonical form, or an Error saying why it is not one.
 *
 * An element list keeps the author's ORDER (`[Cl,Br,I]` is how the figure
 * reads, and sorting it would rewrite their label) but loses duplicates; it
 * must name at least one real element, and only real ones — a list holding
 * "R1" or "*" is not a list the molfile can carry. An R-group index is a
 * positive integer; a generic label is non-empty after trimming.
 */
export function normalizeAtomQuery(query: AtomQuery): AtomQuery | Error {
  switch (query.kind) {
    case "rgroup":
      if (query.index === undefined) return Object.freeze({ kind: "rgroup" });
      if (!Number.isInteger(query.index) || query.index < 1) {
        return new Error(`An R-group number is a positive integer, not ${query.index}.`);
      }
      return Object.freeze({ kind: "rgroup", index: query.index });
    case "any":
      return Object.freeze({ kind: "any", symbol: query.symbol });
    case "generic": {
      const label = query.label.trim();
      if (label === "") return new Error("A generic atom needs a label.");
      return Object.freeze({ kind: "generic", label });
    }
    case "list": {
      const elements: ElementSymbol[] = [];
      for (const symbol of query.elements) {
        if (!isKnownElement(symbol)) {
          return new Error(`"${symbol}" is not an element, so it cannot be in an element list.`);
        }
        if (!elements.includes(symbol)) elements.push(symbol);
      }
      if (elements.length === 0) return new Error("An element list needs at least one element.");
      return Object.freeze({
        kind: "list",
        elements: Object.freeze(elements),
        negated: query.negated,
      });
    }
  }
}

/**
 * What the canvas draws in place of an element symbol: "R", "R1", "A", "*",
 * "X", "[Cl,Br,I]", "![N,O]".
 *
 * The NOT-list is "!" before the bracket, Ketcher's and SMARTS' spelling, and
 * compact on purpose: "NOT [N,O]" beside a ring atom reads as two labels.
 */
export function atomQueryLabel(query: AtomQuery): string {
  switch (query.kind) {
    case "rgroup":
      return query.index === undefined ? "R" : `R${query.index}`;
    case "any":
      return query.symbol;
    case "generic":
      return query.label;
    case "list":
      return `${query.negated ? "!" : ""}[${query.elements.join(",")}]`;
  }
}

/**
 * The inverse of `atomQueryLabel`, for a typed label: "R" and "R2" are
 * R-groups, "A" and "*" any atom, "[Cl,Br,I]" an element list and "![N,O]"
 * or "NOT [N,O]" a NOT-list. Anything else non-empty is a generic label —
 * "X", "Ar", "Hal" — kept as typed. An Error when a list names a non-element
 * or the text is empty.
 */
export function parseAtomQuery(text: string): AtomQuery | Error {
  const trimmed = text.trim();
  const rgroup = /^R(\d+)?$/.exec(trimmed);
  if (rgroup !== null) {
    return normalizeAtomQuery(
      rgroup[1] === undefined ? { kind: "rgroup" } : { kind: "rgroup", index: Number(rgroup[1]) },
    );
  }
  if (trimmed === "A" || trimmed === "*") return normalizeAtomQuery({ kind: "any", symbol: trimmed });
  const list = /^(!|NOT\s*)?\[([^\]]*)\]$/i.exec(trimmed);
  if (list !== null) {
    const elements = (list[2] ?? "")
      .split(",")
      .map((symbol) => symbol.trim())
      .filter((symbol) => symbol !== "");
    return normalizeAtomQuery({ kind: "list", elements, negated: list[1] !== undefined });
  }
  return normalizeAtomQuery({ kind: "generic", label: trimmed });
}

/**
 * The next free R-group number: one past the highest already drawn, so the
 * element tool's "R" entry places R1, then R2, and a deleted R1 is not reused
 * under a still-drawn R2's legend line.
 */
export function nextRGroupIndex(mol: Molecule): number {
  let highest = 0;
  for (const id of mol.atomIds) {
    const query = mol.atoms[id]?.query;
    if (query?.kind === "rgroup" && query.index !== undefined) {
      highest = Math.max(highest, query.index);
    }
  }
  return highest + 1;
}

/** Every query or generic atom, in document order. */
export function queryAtomIds(mol: Molecule): string[] {
  return mol.atomIds.filter((id) => mol.atoms[id]?.query !== undefined);
}

/** Every query bond, in document order. */
export function queryBondIds(mol: Molecule): string[] {
  return mol.bondIds.filter((id) => mol.bonds[id]?.query !== undefined);
}

/**
 * Whether the drawing is a generic (Markush) structure rather than one
 * compound: any query atom or query bond. Formula and mass ask this before
 * they claim a number belongs to a compound.
 */
export function isGenericStructure(mol: Molecule): boolean {
  return queryAtomIds(mol).length > 0 || queryBondIds(mol).length > 0;
}

/**
 * The integer order a query bond is counted at: the LOWEST it admits.
 * Aromatic is 1.5, so `double-or-aromatic` would be 1.5 at its lowest; it is
 * stored as 2 because `order` is an integer and, around a six-ring drawn with
 * alternating D/A and single bonds, 2 gives each carbon the hydrogen count
 * both readings agree on.
 */
export const BOND_QUERY_ORDER: Readonly<Record<BondQuery, BondOrder>> = Object.freeze({
  any: 1,
  "single-or-double": 1,
  "single-or-aromatic": 1,
  "double-or-aromatic": 2,
});

/** The short text a figure sets at a query bond's midpoint. */
export const BOND_QUERY_LABEL: Readonly<Record<BondQuery, string>> = Object.freeze({
  any: "any",
  "single-or-double": "S/D",
  "single-or-aromatic": "S/A",
  "double-or-aromatic": "D/A",
});

/** Every `BondQuery`, in the order a menu offers them. */
export const BOND_QUERY_VALUES: readonly BondQuery[] = Object.freeze([
  "any",
  "single-or-double",
  "single-or-aromatic",
  "double-or-aromatic",
]);

/** True when the bond is a query bond. */
export function isQueryBond(bond: Bond): boolean {
  return bond.query !== undefined;
}
