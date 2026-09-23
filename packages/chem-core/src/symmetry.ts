/**
 * Constitutional symmetry: which atoms look alike, and whether a mapping of
 * atoms onto atoms is a graph automorphism.
 *
 * THE GRAPH is the heavy-atom graph. An explicit protium atom (cip.ts's
 * `isProtiumAtom`) is folded into its neighbour's hydrogen count, so a
 * molecule drawn with one hydrogen explicit and its mirror half implicit is
 * still symmetric. Deuterium, tritium and charged hydrogens stay atoms.
 *
 * `atomSymmetryClasses` is colour refinement (1-dimensional Weisfeiler-Leman):
 * atoms start coloured by element, charge, isotope, radicals, hydrogen count
 * and degree, and are recoloured by the multiset of (bond order, neighbour
 * colour) until the partition stops splitting. Atoms related by an
 * automorphism always share a colour. The converse does not hold in general,
 * so a caller that needs a real symmetry must check an explicit mapping, as
 * achirality.ts does.
 */

import { bondsAt, otherEnd, requireAtom } from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount, isProtiumAtom } from "./valence.js";

/** The heavy-atom graph symmetry works on. */
export interface SymmetryGraph {
  /** Atoms other than explicit protium, in `mol.atomIds` order. */
  readonly atomIds: readonly AtomId[];
  /** Neighbour id to bond order, per atom. Protium neighbours are omitted. */
  readonly neighbours: ReadonlyMap<AtomId, ReadonlyMap<AtomId, number>>;
  /** Implicit hydrogens plus explicit protium atoms, per atom. */
  readonly hydrogens: ReadonlyMap<AtomId, number>;
  /** Refined colour per atom; equal colours are a necessary condition for symmetry. */
  readonly colour: ReadonlyMap<AtomId, number>;
}

const GRAPH_CACHE = new WeakMap<Molecule, SymmetryGraph>();

export function symmetryGraph(mol: Molecule): SymmetryGraph {
  const hit = GRAPH_CACHE.get(mol);
  if (hit !== undefined) return hit;
  const atomIds = mol.atomIds.filter((id) => !isProtiumAtom(mol, id));
  const neighbours = new Map<AtomId, Map<AtomId, number>>();
  const hydrogens = new Map<AtomId, number>();
  for (const id of atomIds) {
    const own = new Map<AtomId, number>();
    let h = implicitHydrogenCount(mol, id);
    for (const bond of bondsAt(mol, id)) {
      const other = otherEnd(bond, id);
      if (isProtiumAtom(mol, other)) h++;
      else own.set(other, bond.order);
    }
    neighbours.set(id, own);
    hydrogens.set(id, h);
  }

  let colour = new Map<AtomId, number>();
  const initial = new Map<AtomId, string>();
  for (const id of atomIds) {
    const atom = requireAtom(mol, id);
    initial.set(
      id,
      [
        atom.element,
        atom.charge,
        atom.isotope ?? "",
        atom.radicalElectrons,
        hydrogens.get(id),
        neighbours.get(id)!.size,
      ].join(","),
    );
  }
  colour = renumber(initial);
  for (;;) {
    const signature = new Map<AtomId, string>();
    for (const id of atomIds) {
      const around = [...neighbours.get(id)!]
        .map(([other, order]) => `${order}:${colour.get(other)}`)
        .sort();
      signature.set(id, `${colour.get(id)}|${around.join(";")}`);
    }
    const next = renumber(signature);
    const before = new Set(colour.values()).size;
    const after = new Set(next.values()).size;
    colour = next;
    if (after === before) break;
  }

  const graph: SymmetryGraph = { atomIds, neighbours, hydrogens, colour };
  GRAPH_CACHE.set(mol, graph);
  return graph;
}

/** Dense colour numbers, assigned in sorted signature order so they are deterministic. */
function renumber(signatures: ReadonlyMap<AtomId, string>): Map<AtomId, number> {
  const distinct = [...new Set(signatures.values())].sort();
  const index = new Map(distinct.map((signature, i) => [signature, i]));
  const out = new Map<AtomId, number>();
  for (const [id, signature] of signatures) out.set(id, index.get(signature)!);
  return out;
}

/** Colour-refinement class per heavy atom. Explicit protium atoms get none. */
export function atomSymmetryClasses(mol: Molecule): ReadonlyMap<AtomId, number> {
  return symmetryGraph(mol).colour;
}
