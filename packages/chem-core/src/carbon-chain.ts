/**
 * Parent-chain selection for the numbering rules in sugar.ts and
 * amino-acid.ts: the longest run of acyclic carbons, and an honest refusal
 * where two runs tie.
 *
 * Exported from the package root only because the export audit
 * (stereo-config.test.ts, "chem-core exports") requires every module in the
 * barrel. The names are helpers of those two numbering rules, not chemistry
 * queries of their own; nothing outside sugar.ts and amino-acid.ts calls them.
 *
 * A CHAIN CARBON is a carbon that is in no ring and not aromatic, reached over
 * a single, non-aromatic bond. Ring atoms end a chain (phenylalanine's chain
 * is C1–C3, the phenyl is a substituent), and so does any heteroatom
 * (methionine's chain stops at the sulfur).
 *
 * A TIE STOPS THE CHAIN before it, rather than choosing a branch by atom id
 * (decision 142). Valine's C3 carries two methyls of equal length, and which
 * of them is "C4" is not something the constitution says, so neither is
 * numbered. Choosing by id would give the same molecule drawn twice two
 * different numberings. Recursion is avoided so a 20k-atom chain does not
 * blow the stack.
 *
 * ONE ANCHOR PER SKELETON (decision 156). `extendChain` walks the whole
 * acyclic skeleton it starts in, so calling it once per carbonyl or alpha
 * carbon is quadratic when one skeleton holds many (a 4000-carbon polyketone
 * took two seconds). `chainSkeletons` labels every skeleton once, and a
 * numbering rule skips a skeleton holding more than one of its anchors before
 * it walks anything: which of two carbonyls is C1, or which of two carboxyls,
 * needs principal-chain rules these modules do not have.
 */

import { isRingAtom } from "./rings.js";
import { bondsAt, getAtom, otherEnd } from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";

/** A carbon that can be part of a parent chain. */
export function isChainCarbon(mol: Molecule, atomId: AtomId): boolean {
  const atom = getAtom(mol, atomId);
  return atom !== undefined && atom.element === "C" && !atom.aromatic && !isRingAtom(mol, atomId);
}

/** Chain carbons bonded to `atomId` by a single, non-aromatic bond. */
export function chainCarbonNeighbours(mol: Molecule, atomId: AtomId): AtomId[] {
  const out: AtomId[] = [];
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.order !== 1 || bond.aromatic) continue;
    const other = otherEnd(bond, atomId);
    if (isChainCarbon(mol, other)) out.push(other);
  }
  return out;
}

let chainVisits = 0;

/**
 * Testing hook: how many chain carbons `extendChain` and `chainSkeletons`
 * have visited, in total. What pins the numbering rules as linear.
 */
export function chainCarbonVisitCount(): number {
  return chainVisits;
}

/**
 * Which acyclic carbon skeleton each of `seeds` lies in, as a small integer
 * label: two seeds share a label when chain carbons joined by single,
 * non-aromatic bonds connect them. Every chain carbon of a skeleton holding a
 * seed is labelled; a seed that is not a chain carbon (proline's ring alpha
 * carbon) is not. Linear in the atoms reached: each skeleton is walked once.
 */
export function chainSkeletons(
  mol: Molecule,
  seeds: Iterable<AtomId>,
): ReadonlyMap<AtomId, number> {
  const label = new Map<AtomId, number>();
  let next = 0;
  for (const seed of seeds) {
    if (label.has(seed) || !isChainCarbon(mol, seed)) continue;
    const id = next++;
    label.set(seed, id);
    const queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      chainVisits++;
      for (const other of chainCarbonNeighbours(mol, queue[i]!)) {
        if (label.has(other)) continue;
        label.set(other, id);
        queue.push(other);
      }
    }
  }
  return label;
}

export interface ChainExtension {
  /** The chosen carbons, nearest first. Empty when there is nothing to extend into. */
  readonly path: readonly AtomId[];
  /**
   * The longest extension's length, INCLUDING what lies past a tie. It is what
   * "the end nearer the carbonyl" compares, and a tie further out does not
   * make the chain shorter.
   */
  readonly depth: number;
  /** The atom whose branches tied, where the path stopped. */
  readonly tiedAt?: AtomId;
  /** Chain carbons past the tie, which the path does not number. */
  readonly beyondTie: readonly AtomId[];
}

/**
 * The longest chain of chain carbons that starts at one of `starts` and never
 * goes back through `from` or into `blocked`.
 *
 * `from` is the atom the chain grows out of (a carbonyl carbon, an alpha
 * carbon, a ring atom). It is not part of the path; when two of `starts` tie,
 * the path is empty and `tiedAt` is `from`.
 */
export function extendChain(
  mol: Molecule,
  from: AtomId,
  starts: readonly AtomId[],
  blocked: ReadonlySet<AtomId> = new Set(),
): ChainExtension {
  // Breadth-first discovery from the virtual root `from`, with parents, so
  // depths can be accumulated leaf-first without recursion.
  const parent = new Map<AtomId, AtomId>();
  const order: AtomId[] = [];
  const seen = new Set<AtomId>([from, ...blocked]);
  for (const start of starts) {
    if (seen.has(start) || !isChainCarbon(mol, start)) continue;
    seen.add(start);
    parent.set(start, from);
    order.push(start);
  }
  for (let i = 0; i < order.length; i++) {
    const atom = order[i]!;
    chainVisits++;
    for (const next of chainCarbonNeighbours(mol, atom)) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, atom);
      order.push(next);
    }
  }
  const depth = new Map<AtomId, number>();
  const children = new Map<AtomId, AtomId[]>();
  for (let i = order.length - 1; i >= 0; i--) {
    const atom = order[i]!;
    const kids = children.get(atom) ?? [];
    let best = 0;
    for (const kid of kids) best = Math.max(best, depth.get(kid)!);
    depth.set(atom, best + 1);
    const up = parent.get(atom)!;
    const siblings = children.get(up);
    if (siblings) siblings.push(atom);
    else children.set(up, [atom]);
  }

  const path: AtomId[] = [];
  let at = from;
  let total = 0;
  for (;;) {
    const kids = children.get(at) ?? [];
    if (kids.length === 0) break;
    let best = 0;
    for (const kid of kids) best = Math.max(best, depth.get(kid)!);
    const deepest = kids.filter((kid) => depth.get(kid) === best);
    if (at === from) total = best;
    if (deepest.length > 1) {
      const beyond: AtomId[] = [];
      const stack = [...kids];
      while (stack.length > 0) {
        const atom = stack.pop()!;
        beyond.push(atom);
        stack.push(...(children.get(atom) ?? []));
      }
      return { path, depth: total, tiedAt: at, beyondTie: beyond };
    }
    at = deepest[0]!;
    path.push(at);
  }
  return { path, depth: total, beyondTie: [] };
}
