/**
 * Species: which atoms of the ONE molecule are one compound in a scheme.
 *
 * THE SCHEME MODEL (decisions 102-104, and the architectural ruling it came
 * from). A reaction scheme does not become a list of molecules. A document
 * keeps exactly one `Molecule`, and its species are that molecule's connected
 * components, with `Molecule.speciesJoins` (decision 102) saying that several
 * components are one species — the ion pair, the solvate. A list of placed
 * structures would have turned every `AtomId` into a (structure, atom) pair and
 * rewritten selection, hit-testing, scene ids and every id attribute in the
 * DOM, for no chemistry at all.
 *
 * WHAT THAT COSTS, recorded here because it is the bill every later task pays:
 *
 *   - formula and mass surfaces are per species. A sum formula over a whole
 *     scheme is a wrong fact shown prominently, and one exact mass over six
 *     compounds is a number that means nothing;
 *   - a molblock of a whole scheme is a salt: one CTAB with N components.
 *     `speciesJoins` does not travel through a molfile — a CTAB has no word for
 *     it — so a scheme's species reach a file only through an exporter that
 *     writes one record per species;
 *   - a compound that is the product of one step and the reactant of the next
 *     is drawn TWICE, as two disjoint subgraphs. There is no "same compound"
 *     link between them, and a stoichiometry or export pass must not assume
 *     one;
 *   - there is one undo timeline over the whole scheme, because there is one
 *     document.
 *
 * TWO OUTS, ruled now rather than discovered at export:
 *
 *   - a CIRCULAR CATALYTIC CYCLE is not expressible. Reaction arrows are
 *     straight and point from species to species; a cycle whose arrows bend
 *     round a centre and meet themselves is a different annotation model.
 *   - a scheme that WRAPS onto several lines is expressible: a reaction arrow
 *     carries the row it is drawn on (chem-render's scheme annotations), so a
 *     step whose product starts the next line is modelled, not guessed at
 *     export.
 *
 * Nothing here knows what an arrow is. Species are chemistry — which pieces
 * are one compound — and the annotations that point at them live in
 * chem-render, which may import this module; nothing here may import them.
 */

import { connectedComponents } from "./molecule.js";
import { compareIds } from "./selection.js";
import type { AtomId, Molecule, SpeciesJoin } from "./types.js";

/** One species: the atoms of one or more joined components. */
export interface Species {
  /** In the molecule's insertion order, like `connectedComponents`. */
  readonly atomIds: readonly AtomId[];
}

/** Joins in canonical order, or an empty array. Never `undefined`. */
export function speciesJoinsOf(mol: Molecule): readonly SpeciesJoin[] {
  return mol.speciesJoins ?? [];
}

/**
 * Thrown when a join cannot be honoured: it names an atom the molecule does
 * not have. A programming error, like `addBond` onto a missing atom — the
 * document codec reports the same thing in a file as a listed issue instead.
 */
export class SpeciesJoinError extends Error {
  readonly atomIds: readonly AtomId[];
  constructor(message: string, atomIds: readonly AtomId[]) {
    super(message);
    this.name = "SpeciesJoinError";
    this.atomIds = atomIds;
  }
}

/**
 * Union overlapping joins, drop any with fewer than two atoms, and sort.
 *
 * Overlapping joins are UNIONED because joining is transitive: {Na, Cl} and
 * {Cl, H2O} say all three are one species, and two records that share an atom
 * would be a second spelling of that. The single-atom case is dropped because
 * one atom joins nothing to anything.
 *
 * The one owner of the canonical order — `withSpeciesJoins`, the prune, the
 * remap and the graft all come through here, so a pasted join cannot land in
 * a different order from a loaded one and make two identical molecules differ
 * by `toEqual`.
 */
function canonicalJoins(lists: readonly (readonly AtomId[])[]): SpeciesJoin[] {
  const parent = new Map<AtomId, AtomId>();
  const find = (id: AtomId): AtomId => {
    let root = id;
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) {
      root = up;
    }
    // Path compression, so a long chain of overlapping joins stays linear.
    let node = id;
    while (node !== root) {
      const up = parent.get(node) ?? root;
      parent.set(node, root);
      node = up;
    }
    return root;
  };
  for (const list of lists) {
    const first = list[0];
    if (first === undefined) continue;
    if (!parent.has(first)) parent.set(first, first);
    for (const id of list) {
      if (!parent.has(id)) parent.set(id, id);
      const a = find(first);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    }
  }
  const byRoot = new Map<AtomId, AtomId[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const bucket = byRoot.get(root);
    if (bucket === undefined) byRoot.set(root, [id]);
    else bucket.push(id);
  }
  const joins: SpeciesJoin[] = [];
  for (const ids of byRoot.values()) {
    if (ids.length < 2) continue;
    joins.push({ atomIds: ids.sort(compareIds) });
  }
  joins.sort((a, b) => compareIds(a.atomIds[0]!, b.atomIds[0]!));
  return joins;
}

/** True when two canonical join lists say the same thing. */
function sameJoins(a: readonly SpeciesJoin[], b: readonly SpeciesJoin[]): boolean {
  return (
    a.length === b.length &&
    a.every((join, i) => {
      const other = b[i]!;
      return (
        join.atomIds.length === other.atomIds.length &&
        join.atomIds.every((id, j) => id === other.atomIds[j])
      );
    })
  );
}

/**
 * Validate `joins`, put them in canonical order and store them on `mol`.
 *
 * The key is OMITTED when nothing survives, so this is also how a caller
 * clears every join: hand it `[]`. Returns `mol` itself when the canonical
 * list is what it already holds, so re-joining the same atoms is not an edit
 * and does not become an undo step.
 *
 * @throws {SpeciesJoinError} if a join names an atom the molecule lacks.
 */
export function withSpeciesJoins(
  mol: Molecule,
  joins: readonly SpeciesJoin[],
): Molecule {
  for (const join of joins) {
    for (const atomId of join.atomIds) {
      // `Object.hasOwn`, not `requireAtom` alone: the error has to name the
      // join, and an id of "constructor" must not resolve up the prototype.
      if (!Object.hasOwn(mol.atoms, atomId)) {
        throw new SpeciesJoinError(
          `A species join names ${atomId}, which is not an atom of this ` +
            `molecule. A join that outlives its atoms is a document that ` +
            `cannot be saved; remap or prune it with the atoms.`,
          [atomId],
        );
      }
    }
  }
  const canonical = canonicalJoins(joins.map((join) => join.atomIds));
  if (sameJoins(canonical, speciesJoinsOf(mol))) return mol;
  if (canonical.length === 0) {
    const { speciesJoins: _dropped, ...rest } = mol;
    return rest;
  }
  return { ...mol, speciesJoins: canonical };
}

/**
 * Join the species containing `atomIds` into one — the "these are one
 * compound" gesture over a selection.
 *
 * A selection names many atoms of each piece and only WHICH species it touches
 * matters, so the join stores one atom per species: the lowest by `compareIds`
 * among the selected atoms in it. Touching fewer than two species joins
 * nothing and returns `mol` itself, so the gesture on one compound is not an
 * edit.
 *
 * @throws {SpeciesJoinError} if an id is not an atom of `mol`.
 */
export function joinSpecies(mol: Molecule, atomIds: readonly AtomId[]): Molecule {
  const representative = new Map<number, AtomId>();
  for (const atomId of atomIds) {
    const index = speciesIndexOf(mol, atomId);
    if (index === undefined) {
      throw new SpeciesJoinError(
        `Cannot join the species of ${atomId}: it is not an atom of this molecule.`,
        [atomId],
      );
    }
    const held = representative.get(index);
    if (held === undefined || compareIds(atomId, held) < 0) representative.set(index, atomId);
  }
  if (representative.size < 2) return mol;
  return withSpeciesJoins(mol, [
    ...speciesJoinsOf(mol),
    { atomIds: [...representative.values()] },
  ]);
}

/**
 * Take the species containing `atomId` apart again: every join that names an
 * atom of it is dropped. The components go back to being species of their own.
 */
export function separateSpecies(mol: Molecule, atomId: AtomId): Molecule {
  const own = speciesOf(mol, atomId);
  if (own === undefined) return mol;
  const members = new Set(own.atomIds);
  return withSpeciesJoins(
    mol,
    speciesJoinsOf(mol).filter((join) => !join.atomIds.some((id) => members.has(id))),
  );
}

/**
 * Drop every atom `keep` rejects, and every join left with fewer than two.
 *
 * The primitive behind atom deletion. Returns the SAME array when nothing
 * changed, so a caller can use identity to decide whether it has any work.
 */
export function prunedSpeciesJoins(
  joins: readonly SpeciesJoin[],
  keep: (atomId: AtomId) => boolean,
): readonly SpeciesJoin[] {
  let changed = false;
  const kept: (readonly AtomId[])[] = [];
  for (const join of joins) {
    const atomIds = join.atomIds.filter(keep);
    if (atomIds.length !== join.atomIds.length) changed = true;
    kept.push(atomIds);
  }
  return changed ? canonicalJoins(kept) : joins;
}

/**
 * Rewrite every atom id through `map`, DROPPING an id the map does not
 * mention — restrict and remap in one pass, as fragment extraction needs.
 * Re-canonicalised, because new ids do not sort like old ones.
 */
export function remappedSpeciesJoins(
  joins: readonly SpeciesJoin[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly SpeciesJoin[] {
  const lists: AtomId[][] = [];
  for (const join of joins) {
    const atomIds: AtomId[] = [];
    for (const atomId of join.atomIds) {
      const image = map.get(atomId);
      if (image !== undefined) atomIds.push(image);
    }
    lists.push(atomIds);
  }
  return canonicalJoins(lists);
}

/**
 * Merge a pasted fragment's joins into a target's. `map` is the insertion's
 * fragment-to-target map; every pasted id is fresh, so the two lists cannot
 * overlap and the union is only a concatenation put in canonical order.
 */
export function graftSpeciesJoins(
  targetJoins: readonly SpeciesJoin[],
  fragmentJoins: readonly SpeciesJoin[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly SpeciesJoin[] {
  const pasted = remappedSpeciesJoins(fragmentJoins, map);
  if (pasted.length === 0) return targetJoins;
  return canonicalJoins([...targetJoins, ...pasted].map((join) => join.atomIds));
}

/**
 * `from` renamed to `to` in every join — the atom-merge case. The dragged
 * atom's id disappears and the target's survives; renaming rather than
 * dropping keeps a join whose only atom on that component was the dragged one,
 * and a rename that lands the target in two joins unions them, which is what
 * merging two joined atoms means.
 */
export function renamedSpeciesJoins(
  joins: readonly SpeciesJoin[],
  from: AtomId,
  to: AtomId,
): readonly SpeciesJoin[] {
  if (!joins.some((join) => join.atomIds.includes(from))) return joins;
  return canonicalJoins(
    joins.map((join) => join.atomIds.map((id) => (id === from ? to : id))),
  );
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

interface SpeciesPerception {
  readonly list: readonly Species[];
  /** Atom id -> index into `list`. A Map, so "constructor" cannot resolve. */
  readonly indexByAtom: ReadonlyMap<AtomId, number>;
}

/**
 * Two levels, like rings.ts. The instance map answers repeated queries within
 * one render frame. The topology map answers across a DRAG: a position-only
 * edit (`setAtomPositions`, `translateAtoms`) returns a new molecule that
 * shares its `bonds` record, its `atomIds` array and its joins with the old
 * one by reference, and species depend on nothing else — so the answer is
 * reused without a traversal, and a drag does not cost a component search per
 * pointer frame. Keyed on the `bonds` object; the other two are compared by
 * identity on the entry, which makes a hit sound rather than merely likely.
 */
const BY_INSTANCE = new WeakMap<Molecule, SpeciesPerception>();
const BY_TOPOLOGY = new WeakMap<
  object,
  {
    readonly atomIds: readonly AtomId[];
    readonly joins: readonly SpeciesJoin[] | undefined;
    readonly perception: SpeciesPerception;
  }
>();

let computations = 0;

/** How many times the species of a molecule have actually been computed —
 *  the call counter the memoisation test reads, as rings.ts has. */
export function speciesComputationCount(): number {
  return computations;
}

function perceive(mol: Molecule): SpeciesPerception {
  const cached = BY_INSTANCE.get(mol);
  if (cached !== undefined) return cached;
  const shared = BY_TOPOLOGY.get(mol.bonds);
  if (
    shared !== undefined &&
    shared.atomIds === mol.atomIds &&
    shared.joins === mol.speciesJoins
  ) {
    BY_INSTANCE.set(mol, shared.perception);
    return shared.perception;
  }

  computations += 1;
  const components = connectedComponents(mol);
  const componentOf = new Map<AtomId, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });

  // Union the components each join touches. Plain array union-find: there
  // are as many entries as components, and joins are a handful.
  const parent = components.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      const up = parent[i]!;
      parent[i] = parent[up]!;
      i = up;
    }
    return i;
  };
  for (const join of speciesJoinsOf(mol)) {
    let first: number | undefined;
    for (const atomId of join.atomIds) {
      const component = componentOf.get(atomId);
      if (component === undefined) continue;
      if (first === undefined) {
        first = find(component);
        continue;
      }
      const root = find(component);
      // The lower index wins, so a species is numbered by its earliest
      // component and the list keeps connectedComponents' order.
      if (root < first) {
        parent[first] = root;
        first = root;
      } else if (root !== first) {
        parent[root] = first;
      }
    }
  }

  const rank = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => rank.set(id, index));
  const members = new Map<number, AtomId[]>();
  components.forEach((component, index) => {
    const root = find(index);
    const bucket = members.get(root);
    if (bucket === undefined) members.set(root, [...component]);
    else bucket.push(...component);
  });

  const list: Species[] = [];
  const indexByAtom = new Map<AtomId, number>();
  // Roots ascend with the first component they hold, so iterating the
  // component indices in order yields species in insertion order.
  for (let index = 0; index < components.length; index++) {
    const atomIds = members.get(index);
    if (atomIds === undefined) continue;
    atomIds.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    for (const id of atomIds) indexByAtom.set(id, list.length);
    list.push({ atomIds });
  }

  const perception: SpeciesPerception = { list, indexByAtom };
  BY_INSTANCE.set(mol, perception);
  BY_TOPOLOGY.set(mol.bonds, {
    atomIds: mol.atomIds,
    joins: mol.speciesJoins,
    perception,
  });
  return perception;
}

/**
 * The species of `mol`, in the insertion order of each one's first atom.
 * Memoised on the instance (and across position-only edits), never recomputed
 * per render frame or per store change.
 */
export function species(mol: Molecule): readonly Species[] {
  return perceive(mol).list;
}

/** Index into `species(mol)` of the species holding `atomId`, or `undefined`
 *  for an id the molecule does not have. */
export function speciesIndexOf(mol: Molecule, atomId: AtomId): number | undefined {
  return perceive(mol).indexByAtom.get(atomId);
}

/** The species holding `atomId`, or `undefined`. */
export function speciesOf(mol: Molecule, atomId: AtomId): Species | undefined {
  const index = speciesIndexOf(mol, atomId);
  return index === undefined ? undefined : perceive(mol).list[index];
}
