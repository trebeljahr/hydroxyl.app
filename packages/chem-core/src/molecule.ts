/**
 * Molecule construction and graph queries.
 *
 * Every function here is pure: molecules are never mutated, and each builder
 * returns a fresh structure. That is what makes patch-based undo/redo and
 * cheap referential-equality checks in React possible.
 *
 * COST MODEL. `addAtom` and `addBond` copy the atom/bond records, so each is
 * O(n). That is the right trade for interactive editing, where n is small and
 * structural sharing matters more than raw speed. It is the wrong trade for
 * bulk construction: calling them in a loop is O(n^2), and `addBond` is worse
 * still because its duplicate check rebuilds the adjacency index every time.
 * Use `MoleculeBuilder` for anything bulk — importers, templates, tests.
 */

import type {
  Atom,
  AtomId,
  AtomInit,
  Bond,
  BondId,
  BondInit,
  Molecule,
} from "./types.js";
import { ORIGIN, type Vec2 } from "./vec.js";

export const EMPTY_MOLECULE: Molecule = Object.freeze({
  atoms: Object.freeze({}),
  bonds: Object.freeze({}),
  atomIds: Object.freeze([]),
  bondIds: Object.freeze([]),
  nextId: 1,
});

export function emptyMolecule(): Molecule {
  return EMPTY_MOLECULE;
}

export function isEmpty(mol: Molecule): boolean {
  return mol.atomIds.length === 0;
}

export function atomCount(mol: Molecule): number {
  return mol.atomIds.length;
}

export function bondCount(mol: Molecule): number {
  return mol.bondIds.length;
}

/** Atoms in insertion order. */
export function atoms(mol: Molecule): Atom[] {
  return mol.atomIds.map((id) => requireAtom(mol, id));
}

/** Bonds in insertion order. */
export function bonds(mol: Molecule): Bond[] {
  return mol.bondIds.map((id) => requireBond(mol, id));
}

export function getAtom(mol: Molecule, id: AtomId): Atom | undefined {
  return mol.atoms[id];
}

export function getBond(mol: Molecule, id: BondId): Bond | undefined {
  return mol.bonds[id];
}

export function requireAtom(mol: Molecule, id: AtomId): Atom {
  const atom = mol.atoms[id];
  if (!atom) throw new Error(`No such atom: ${id}`);
  return atom;
}

export function requireBond(mol: Molecule, id: BondId): Bond {
  const bond = mol.bonds[id];
  if (!bond) throw new Error(`No such bond: ${id}`);
  return bond;
}

export function hasAtom(mol: Molecule, id: AtomId): boolean {
  return id in mol.atoms;
}

/** Build an Atom record, omitting optional keys rather than setting them
 *  to undefined (exactOptionalPropertyTypes, and it keeps JSON clean). */
function makeAtom(id: AtomId, init: AtomInit): Atom {
  const atom: {
    -readonly [K in keyof Atom]: Atom[K];
  } = {
    id,
    element: init.element,
    pos: init.pos ?? ORIGIN,
    charge: init.charge ?? 0,
    radicalElectrons: init.radicalElectrons ?? 0,
    aromatic: init.aromatic ?? false,
  };
  if (init.isotope !== undefined) atom.isotope = init.isotope;
  if (init.explicitHydrogenCount !== undefined) {
    atom.explicitHydrogenCount = init.explicitHydrogenCount;
  }
  if (init.label !== undefined) atom.label = init.label;
  return atom;
}

function makeBond(id: BondId, init: BondInit): Bond {
  return {
    id,
    from: init.from,
    to: init.to,
    order: init.order ?? 1,
    stereo: init.stereo ?? "none",
    doubleBondSide: init.doubleBondSide ?? "auto",
    aromatic: init.aromatic ?? false,
  };
}

export interface AddAtomResult {
  readonly molecule: Molecule;
  readonly id: AtomId;
}

export function addAtom(mol: Molecule, init: AtomInit): AddAtomResult {
  const id = `a${mol.nextId}`;
  return {
    id,
    molecule: {
      ...mol,
      atoms: { ...mol.atoms, [id]: makeAtom(id, init) },
      atomIds: [...mol.atomIds, id],
      nextId: mol.nextId + 1,
    },
  };
}

export interface AddBondResult {
  readonly molecule: Molecule;
  readonly id: BondId;
}

/**
 * Adds a bond. Throws on a self-bond, a missing endpoint, or a duplicate —
 * those are all programming errors rather than user-recoverable states. Use
 * `bondBetween` first if a duplicate is a real possibility.
 */
export function addBond(mol: Molecule, init: BondInit): AddBondResult {
  if (init.from === init.to) {
    throw new Error(`Cannot bond atom ${init.from} to itself`);
  }
  requireAtom(mol, init.from);
  requireAtom(mol, init.to);
  const existing = bondBetween(mol, init.from, init.to);
  if (existing) {
    throw new Error(
      `Atoms ${init.from} and ${init.to} are already bonded (${existing.id})`,
    );
  }
  const id = `b${mol.nextId}`;
  return {
    id,
    molecule: {
      ...mol,
      bonds: { ...mol.bonds, [id]: makeBond(id, init) },
      bondIds: [...mol.bondIds, id],
      nextId: mol.nextId + 1,
    },
  };
}

/** The atom at the other end of a bond. Throws if `atomId` is not an endpoint. */
export function otherEnd(bond: Bond, atomId: AtomId): AtomId {
  if (bond.from === atomId) return bond.to;
  if (bond.to === atomId) return bond.from;
  throw new Error(`Atom ${atomId} is not an endpoint of bond ${bond.id}`);
}

export function bondEndpoints(bond: Bond): [AtomId, AtomId] {
  return [bond.from, bond.to];
}

// ---------------------------------------------------------------------------
// Adjacency
//
// Derived, never stored. Memoised per molecule object: molecules are
// immutable, so a WeakMap keyed on the instance can never go stale, and it
// lets hot paths (valence, rendering, traversal) share one index.
// ---------------------------------------------------------------------------

export interface Adjacency {
  /** atom id -> ids of bonds incident on it, in bond insertion order. */
  readonly bondsAt: Readonly<Record<AtomId, readonly BondId[]>>;
  /** atom id -> ids of bonded neighbours, parallel to bondsAt. */
  readonly neighbors: Readonly<Record<AtomId, readonly AtomId[]>>;
}

const ADJACENCY_CACHE = new WeakMap<Molecule, Adjacency>();

export function adjacency(mol: Molecule): Adjacency {
  const cached = ADJACENCY_CACHE.get(mol);
  if (cached) return cached;

  const bondsAt: Record<AtomId, BondId[]> = {};
  const neighbors: Record<AtomId, AtomId[]> = {};
  for (const id of mol.atomIds) {
    bondsAt[id] = [];
    neighbors[id] = [];
  }
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    bondsAt[bond.from]?.push(bondId);
    bondsAt[bond.to]?.push(bondId);
    neighbors[bond.from]?.push(bond.to);
    neighbors[bond.to]?.push(bond.from);
  }
  const built: Adjacency = { bondsAt, neighbors };
  ADJACENCY_CACHE.set(mol, built);
  return built;
}

export function bondsAt(mol: Molecule, atomId: AtomId): Bond[] {
  const ids = adjacency(mol).bondsAt[atomId] ?? [];
  return ids.map((id) => requireBond(mol, id));
}

export function neighborIds(mol: Molecule, atomId: AtomId): readonly AtomId[] {
  return adjacency(mol).neighbors[atomId] ?? [];
}

export function neighbors(mol: Molecule, atomId: AtomId): Atom[] {
  return neighborIds(mol, atomId).map((id) => requireAtom(mol, id));
}

/** Number of bonded neighbours, ignoring bond order. */
export function degree(mol: Molecule, atomId: AtomId): number {
  return (adjacency(mol).bondsAt[atomId] ?? []).length;
}

export function bondBetween(
  mol: Molecule,
  a: AtomId,
  b: AtomId,
): Bond | undefined {
  for (const bondId of adjacency(mol).bondsAt[a] ?? []) {
    const bond = requireBond(mol, bondId);
    if (bond.from === b || bond.to === b) return bond;
  }
  return undefined;
}

export function areBonded(mol: Molecule, a: AtomId, b: AtomId): boolean {
  return bondBetween(mol, a, b) !== undefined;
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Atom ids reachable from `start`, in breadth-first order, `start` first.
 *
 * Iterative rather than recursive: a long polymer chain would blow the stack,
 * which is exactly what the old recursive `buildTree` did.
 */
export function reachableFrom(mol: Molecule, start: AtomId): AtomId[] {
  requireAtom(mol, start);
  const seen = new Set<AtomId>([start]);
  const order: AtomId[] = [start];
  const queue: AtomId[] = [start];
  const adj = adjacency(mol);
  // Index pointer rather than queue.shift(): shift() is O(n) on a large
  // array, which would quietly make this whole traversal quadratic.
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    for (const next of adj.neighbors[current] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return order;
}

/** Disconnected fragments, each a list of atom ids in insertion order. */
export function connectedComponents(mol: Molecule): AtomId[][] {
  // Rank lookup built once. Calling atomIds.indexOf inside the comparator
  // instead would make this O(n^2 log n).
  const rank = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => rank.set(id, index));

  const seen = new Set<AtomId>();
  const components: AtomId[][] = [];
  for (const id of mol.atomIds) {
    if (seen.has(id)) continue;
    const component = reachableFrom(mol, id);
    for (const member of component) seen.add(member);
    component.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    components.push(component);
  }
  return components;
}

export function isConnected(mol: Molecule): boolean {
  return mol.atomIds.length === 0 || connectedComponents(mol).length === 1;
}

/**
 * Number of independent rings (the circuit rank / SSSR size):
 * bonds - atoms + components. Cheap and exact; the actual ring perception
 * that the renderer needs is a separate, more expensive job.
 */
export function ringCount(mol: Molecule): number {
  if (mol.atomIds.length === 0) return 0;
  return mol.bondIds.length - mol.atomIds.length + connectedComponents(mol).length;
}

/** Positions of every atom, for bounds and fitting. */
export function positions(mol: Molecule): Vec2[] {
  return mol.atomIds.map((id) => requireAtom(mol, id).pos);
}
