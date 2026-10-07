/**
 * The condensed formula: "CH3CH2OH", not "C2H6O".
 *
 * A DIFFERENT THING FROM `formulaParts`, which sums the molecule and orders
 * the totals by Hill. A condensed formula is WALKED: it keeps the connectivity
 * a chemist reads a chain off, and that is the whole reason it is worth
 * having beside the sum formula. Ethanol and dimethyl ether are both C2H6O
 * and they are CH3CH2OH and CH3OCH3.
 *
 * It emits the same `FormulaPart` run the sum formula does, so both text views
 * set real subscripts and superscripts rather than a flat string a renderer
 * would have to parse digits back out of.
 *
 * MULTIPLE BONDS ARE SPELLED OUT, as "=" and the triple-bond "≡". They have
 * to be: the sum formula already gives the atom counts, so connectivity is the
 * whole of what this view adds, and bond order is half of connectivity. Left
 * out, but-2-ene and butane's own skeleton both read "CH3CHCHCH3"; worse,
 * "CH3CCH" for propyne states a divalent middle carbon that no chemist would
 * accept. The marker sits between the two atom blocks, and inside the bracket
 * for a branch, so acetone is CH3C(=O)CH3.
 *
 * IT REFUSES A RING, and the refusal is the point rather than a limitation
 * quietly worked around. There is no linear spelling of benzene: "C6H6" is the
 * sum formula and "CH:CH:CH:CH:CH:CH" is not a notation anybody uses. A view
 * that cannot be produced has to say so — see `representationAvailability` in
 * chem-render — because a panel silently exporting an empty cell is worse than
 * a panel saying why it is empty.
 */

import { contractedView } from "./abbreviations.js";
import { requireElement } from "./elements.js";
import type { FormulaPart } from "./formula.js";
import {
  bondBetween,
  bondsAt,
  connectedComponents,
  neighborIds,
  otherEnd,
  requireAtom,
  ringCount,
} from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

/** Separates the components of a mixture, as a hydrate's dot does. */
const COMPONENT_SEPARATOR = "·";

/**
 * How each bond order is written between two atom blocks.
 *
 * U+2261 IDENTICAL TO, not three hyphens and not "#". The triple bond has a
 * character, a condensed formula is set as text a reader reads rather than as
 * a machine format, and "#" is SMILES' spelling, which this file is not.
 * A single bond writes nothing at all — "CH3-CH2-OH" is a different notation,
 * and mixing the two would make the ordinary case the noisy one.
 */
const BOND_MARKERS: Readonly<Record<1 | 2 | 3, string>> = Object.freeze({
  1: "",
  2: "=",
  3: "≡",
});

/** The contracted view's label hosts, by view, for `atomParts`. */
const LABEL_HOSTS = new WeakMap<Molecule, ReadonlyMap<AtomId, unknown>>();

/** Whether a condensed formula exists for this molecule at all. */
export function canCondense(mol: Molecule): boolean {
  // Asked of the drawing: a contracted "Ph" is one label, not a ring
  // (decision 225), so PhCH2OH condenses where benzyl alcohol does not.
  return ringCount(contractedView(mol).molecule) === 0;
}

/**
 * The condensed formula of `mol`, as sub/superscript-aware parts.
 *
 * Throws on a cyclic molecule rather than returning a misleading string;
 * `canCondense` is the check, and the availability function makes it before
 * anything reaches a panel.
 */
export function condensedParts(mol: Molecule): FormulaPart[] {
  if (!canCondense(mol)) {
    throw new Error("A cyclic molecule has no condensed formula");
  }
  // Walked over the contracted view: a contracted abbreviation is one block
  // spelled as its label, and every other atom keeps its hydrogens, since the
  // view keeps the bond each label is attached by.
  const contracted = contractedView(mol);
  const view = contracted.molecule;
  LABEL_HOSTS.set(view, contracted.hosts);
  const parts: FormulaPart[] = [];
  for (const component of connectedComponents(view)) {
    if (parts.length > 0) {
      parts.push({ kind: "symbol", text: COMPONENT_SEPARATOR });
    }
    parts.push(...walkComponent(view, component));
  }
  return parts;
}

/** The condensed formula as flat text — "CH3CH2OH". Lossy; for tests and for
 *  a clipboard, never for drawing. */
export function condensedFormula(mol: Molecule): string {
  return condensedParts(mol)
    .map((part) => part.text)
    .join("");
}

/**
 * One connected, acyclic component, spelled along its longest path.
 *
 * THE MAIN CHAIN IS THE GRAPH'S DIAMETER, found by the standard two-sweep
 * walk: farthest atom from an arbitrary start, then farthest from that. On a
 * tree it is exact, and a tree is all this function ever sees because
 * `condensedParts` has already refused a ring. Choosing the longest path is
 * what makes isobutane read `CH3CH(CH3)CH3` rather than a three-branch star
 * hung off one carbon.
 *
 * Ties are broken by INSERTION ORDER — the sweeps visit `neighborIds` in
 * `bondsAt` order and keep the first atom at the greatest depth — so acetic
 * acid spells the same way every time it is rendered. Two spellings of one
 * molecule across two runs would make the exported figure non-deterministic,
 * which is the same argument the scene's primitive ids make.
 */
function walkComponent(mol: Molecule, component: readonly AtomId[]): FormulaPart[] {
  const start = component[0];
  if (start === undefined) return [];

  const chain = orient(mol, longestPath(mol, farthestFrom(mol, start)));
  const onChain = new Set(chain);
  const parts: FormulaPart[] = [];
  chain.forEach((atomId, index) => {
    const previous = index === 0 ? undefined : chain[index - 1];
    if (previous !== undefined) parts.push(...bondParts(mol, previous, atomId));
    parts.push(...atomParts(mol, atomId));
    for (const neighbourId of neighborIds(mol, atomId)) {
      if (onChain.has(neighbourId)) continue;
      // The marker goes INSIDE the bracket: "C(=O)" attaches the double bond
      // to the branch it belongs to, while "C=(O)" reads as a double bond to
      // the bracket itself and is not a notation anybody writes.
      parts.push({ kind: "symbol", text: "(" });
      parts.push(...bondParts(mol, atomId, neighbourId));
      parts.push(...subtreeParts(mol, neighbourId, atomId));
      parts.push({ kind: "symbol", text: ")" });
    }
  });
  return parts;
}

/**
 * The "=" or the triple-bond glyph between two bonded atoms, or nothing.
 *
 * AROMATICITY IS NOT CONSULTED, and cannot be: `condensedParts` has already
 * refused every ring, and chem-core stores Kekule bond orders anyway — the
 * aromatic flag is derived, never the storage form. What is written is the
 * order the model holds.
 */
function bondParts(mol: Molecule, from: AtomId, to: AtomId): FormulaPart[] {
  const bond = bondBetween(mol, from, to);
  if (bond === undefined) return [];
  const marker = BOND_MARKERS[bond.order];
  return marker === "" ? [] : [{ kind: "symbol", text: marker }];
}

/** A branch, spelled outward from `atomId` away from `cameFrom`. Branches of
 *  branches nest, which is the only way `CH(CH3)` stays unambiguous. */
function subtreeParts(
  mol: Molecule,
  atomId: AtomId,
  cameFrom: AtomId,
): FormulaPart[] {
  const parts = atomParts(mol, atomId);
  for (const neighbourId of neighborIds(mol, atomId)) {
    if (neighbourId === cameFrom) continue;
    const bond = bondParts(mol, atomId, neighbourId);
    const child = subtreeParts(mol, neighbourId, atomId);
    // A straight continuation needs no brackets: an ethyl branch is
    // "(CH2CH3)", not "(CH2(CH3))".
    if (neighborIds(mol, atomId).length === 2) {
      parts.push(...bond, ...child);
    } else {
      parts.push({ kind: "symbol", text: "(" }, ...bond, ...child, {
        kind: "symbol",
        text: ")",
      });
    }
  }
  return parts;
}

/**
 * One atom's block: its symbol, its hydrogens, and its own formal charge.
 *
 * THE CHARGE GOES ON THE ATOM THAT CARRIES IT, not on the end of the run.
 * Acetate is `CH3C(O)O⁻` and methylammonium is `CH3NH3⁺`; putting a net charge
 * at the end of a condensed formula loses which centre it sits on, which is
 * the one thing a condensed formula is for.
 *
 * A DISPLAY LABEL IS IGNORED here, exactly as `formulaParts` ignores it: an
 * abbreviation is a drawing convenience and the formula states the chemistry.
 */
function atomParts(mol: Molecule, atomId: AtomId): FormulaPart[] {
  const atom = requireAtom(mol, atomId);
  // `mol` is the contracted view, where only a superatom's host carries a
  // label. A plain `Atom.label` cannot reach here as anything else: the view
  // copies atoms unchanged, and decision 8's cosmetic label still reads as
  // its element, which is what the check below keeps.
  if (atom.label !== undefined && LABEL_HOSTS.get(mol)?.has(atomId) === true) {
    return [{ kind: "symbol", text: atom.label }];
  }
  // Throws on a symbol the table has not heard of, the same call
  // `implicitHydrogenCount` makes below. The availability check catches it
  // first for anything that reaches a panel.
  requireElement(atom.element);

  const parts: FormulaPart[] = [{ kind: "symbol", text: atom.element }];
  const hydrogens = implicitHydrogenCount(mol, atomId);
  if (hydrogens > 0) {
    parts.push({ kind: "symbol", text: "H" });
    if (hydrogens > 1) parts.push({ kind: "count", text: String(hydrogens) });
  }
  const charge = Number.isFinite(atom.charge) ? Math.round(atom.charge) : 0;
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
 * Orients a chain so it begins at whichever end comes first in the molecule's
 * insertion order.
 *
 * A diameter has two ends and the walk that found it has no opinion about
 * which is the head. Reading ethanol from the hydroxyl gives "OHCH2CH3", which
 * is the same molecule and not how anyone writes it; more importantly, which
 * end the sweep happens to stop on is an artefact of traversal order, and a
 * condensed formula that flips between two runs is a figure that does not
 * diff.
 */
function orient(mol: Molecule, chain: readonly AtomId[]): AtomId[] {
  const head = chain[0];
  const tail = chain[chain.length - 1];
  if (head === undefined || tail === undefined) return [...chain];
  return mol.atomIds.indexOf(tail) < mol.atomIds.indexOf(head)
    ? [...chain].reverse()
    : [...chain];
}

/** Breadth-first, returning the last atom reached — one end of a diameter. */
function farthestFrom(mol: Molecule, start: AtomId): AtomId {
  let farthest = start;
  const seen = new Set<AtomId>([start]);
  let frontier: AtomId[] = [start];
  while (frontier.length > 0) {
    const next: AtomId[] = [];
    for (const atomId of frontier) {
      farthest = atomId;
      for (const bond of bondsAt(mol, atomId)) {
        const neighbourId = otherEnd(bond, atomId);
        if (seen.has(neighbourId)) continue;
        seen.add(neighbourId);
        next.push(neighbourId);
      }
    }
    // The FIRST atom of the deepest layer, in insertion order, so the tie
    // break is stable rather than "whichever the loop reached last".
    if (next.length > 0) farthest = next[0]!;
    frontier = next;
  }
  return farthest;
}

/** The path from `start` to the atom farthest from it, in walk order. */
function longestPath(mol: Molecule, start: AtomId): AtomId[] {
  const parent = new Map<AtomId, AtomId>();
  const seen = new Set<AtomId>([start]);
  let frontier: AtomId[] = [start];
  let last = start;
  while (frontier.length > 0) {
    const next: AtomId[] = [];
    for (const atomId of frontier) {
      for (const bond of bondsAt(mol, atomId)) {
        const neighbourId = otherEnd(bond, atomId);
        if (seen.has(neighbourId)) continue;
        seen.add(neighbourId);
        parent.set(neighbourId, atomId);
        next.push(neighbourId);
      }
    }
    if (next.length > 0) last = next[0]!;
    frontier = next;
  }

  const path: AtomId[] = [];
  let cursor: AtomId | undefined = last;
  while (cursor !== undefined) {
    path.push(cursor);
    cursor = parent.get(cursor);
  }
  return path.reverse();
}
