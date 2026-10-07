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

import type { ElementSymbol } from "./elements.js";
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

/**
 * No `stereoGroups` or `speciesJoins` key, and that is not an omission. A
 * molecule with no atoms has no stereocentres to collect and no components to
 * join, and both fields' whole point is that ABSENT means "nothing was said" —
 * for groups, distinct from an explicit `abs` group (decision 91). Every other `Molecule` literal in the package goes
 * through `assembleMolecule`, which is what makes a field added later a compile
 * error rather than one that vanishes on the first atom delete; this one stays a
 * literal because a frozen singleton cannot be built from parts, and a new
 * REQUIRED field would still be a type error right here.
 */
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

// ---------------------------------------------------------------------------
// Atom assembly
//
// Every Atom record in the package is born here. Building one by hand is what
// silently loses data: each optional key has to be OMITTED rather than set to
// undefined (`exactOptionalPropertyTypes` forbids the assignment, and it keeps
// JSON and deep-equality clean), and because every one of them is optional,
// TypeScript cannot flag a hand-rolled copy that forgets a newly added field —
// it just compiles, and the field vanishes on every copy, paste and merge.
// ---------------------------------------------------------------------------

/** All of an atom's fields except its id, with the optional ones widened so a
 *  caller may pass `undefined` to mean "there is no such key". */
interface AtomFields {
  readonly element: ElementSymbol;
  readonly pos: Vec2;
  readonly charge: number;
  readonly radicalElectrons: number;
  readonly aromatic: boolean;
  readonly isotope?: number | undefined;
  readonly explicitHydrogenCount?: number | undefined;
  readonly lonePairs?: number | undefined;
  readonly label?: string | undefined;
}

/**
 * Compile-time guard: every optional key of `Atom` must be listed in
 * `AtomFields`. Adding one to types.ts without teaching `assembleAtom` about
 * it is then a type error here, rather than a field that quietly disappears
 * from every fragment copy and every merge survivor.
 */
type OptionalAtomKeys = {
  [K in keyof Atom]-?: undefined extends Atom[K] ? K : never;
}[keyof Atom];
type AtomFieldsAreComplete = OptionalAtomKeys extends keyof AtomFields
  ? true
  : never;
const ATOM_FIELDS_ARE_COMPLETE: AtomFieldsAreComplete = true;
void ATOM_FIELDS_ARE_COMPLETE;

/** The one place an Atom record is assembled. */
function assembleAtom(id: AtomId, fields: AtomFields): Atom {
  const atom: {
    -readonly [K in keyof Atom]: Atom[K];
  } = {
    id,
    element: fields.element,
    pos: fields.pos,
    charge: fields.charge,
    radicalElectrons: fields.radicalElectrons,
    aromatic: fields.aromatic,
  };
  if (fields.isotope !== undefined) atom.isotope = fields.isotope;
  if (fields.explicitHydrogenCount !== undefined) {
    atom.explicitHydrogenCount = fields.explicitHydrogenCount;
  }
  if (fields.lonePairs !== undefined) atom.lonePairs = fields.lonePairs;
  if (fields.label !== undefined) atom.label = fields.label;
  return atom;
}

/** Build an Atom from an `AtomInit`, filling in the defaults. */
export function makeAtom(id: AtomId, init: AtomInit): Atom {
  return assembleAtom(id, {
    element: init.element,
    pos: init.pos ?? ORIGIN,
    charge: init.charge ?? 0,
    radicalElectrons: init.radicalElectrons ?? 0,
    aromatic: init.aromatic ?? false,
    isotope: init.isotope,
    explicitHydrogenCount: init.explicitHydrogenCount,
    lonePairs: init.lonePairs,
    label: init.label,
  });
}

/**
 * Changes to apply while copying an atom.
 *
 * A key absent from the bag leaves the field alone. A key present with the
 * value `undefined` on an OPTIONAL field deletes it, so the copy is deep-equal
 * to an atom that never carried it. Telling those two cases apart needs
 * `Object.hasOwn`, never `x !== undefined` — which is why the patch layer in
 * ops.ts cannot express itself with a plain spread.
 */
export interface AtomOverrides {
  readonly id?: AtomId;
  readonly element?: ElementSymbol;
  readonly pos?: Vec2;
  readonly charge?: number;
  readonly radicalElectrons?: number;
  readonly aromatic?: boolean;
  readonly isotope?: number | undefined;
  readonly explicitHydrogenCount?: number | undefined;
  readonly lonePairs?: number | undefined;
  readonly label?: string | undefined;
}

/**
 * Copy an atom, applying `overrides`. Fields the overrides do not mention are
 * carried across verbatim — including optional ones, which is the whole point:
 * fragment extraction, paste and merge all copy atoms, and none of them should
 * have to know which optional fields exist this week.
 *
 * Required fields use `??` so an `undefined` that slipped through an `any`
 * boundary is ignored rather than written into the record.
 */
export function cloneAtomWith(source: Atom, overrides: AtomOverrides): Atom {
  return assembleAtom(overrides.id ?? source.id, {
    element: overrides.element ?? source.element,
    pos: overrides.pos ?? source.pos,
    charge: overrides.charge ?? source.charge,
    radicalElectrons: overrides.radicalElectrons ?? source.radicalElectrons,
    aromatic: overrides.aromatic ?? source.aromatic,
    isotope: Object.hasOwn(overrides, "isotope")
      ? overrides.isotope
      : source.isotope,
    explicitHydrogenCount: Object.hasOwn(overrides, "explicitHydrogenCount")
      ? overrides.explicitHydrogenCount
      : source.explicitHydrogenCount,
    lonePairs: Object.hasOwn(overrides, "lonePairs")
      ? overrides.lonePairs
      : source.lonePairs,
    label: Object.hasOwn(overrides, "label") ? overrides.label : source.label,
  });
}

/**
 * Field-wise equality, used to decide whether an edit actually changed
 * anything and so whether a new molecule needs allocating at all.
 *
 * Written over `Object.keys` rather than as a list of comparisons so that a
 * field added to `Atom` later is compared automatically; a forgotten field
 * would otherwise make an edit look like a no-op and be dropped. `pos` is
 * compared by value because a fresh Vec2 with the same coordinates has not
 * moved the atom anywhere.
 */
export function atomsEqual(a: Atom, b: Atom): boolean {
  const keys = Object.keys(a) as (keyof Atom)[];
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (key === "pos") {
      if (a.pos.x !== b.pos.x || a.pos.y !== b.pos.y) return false;
      continue;
    }
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function makeBond(id: BondId, init: BondInit): Bond {
  const order = init.order ?? 1;
  if (init.dative && order !== 1) {
    throw new Error(`A dative bond is a single bond, not order ${order}`);
  }
  return withBondFlags(
    {
      id,
      from: init.from,
      to: init.to,
      order,
      stereo: init.stereo ?? "none",
      doubleBondSide: init.doubleBondSide ?? "auto",
      aromatic: init.dative ? false : (init.aromatic ?? false),
    },
    { dative: init.dative ?? false, bold: init.bold ?? false },
  );
}

/** A bond's optional flags, as booleans. */
export interface BondFlags {
  readonly dative: boolean;
  readonly bold: boolean;
}

/**
 * `base` with the optional flag keys written only when true (decision 226).
 * The one place those keys are written, so `{}` and `{ dative: false }` can
 * never both appear — two spellings of one bond that no `toEqual` would match.
 */
export function withBondFlags(
  base: Omit<Bond, "dative" | "bold">,
  flags: BondFlags,
): Bond {
  const { dative: _d, bold: _b, ...rest } = base as Bond;
  void _d;
  void _b;
  if (!flags.dative && !flags.bold) return rest;
  return {
    ...rest,
    ...(flags.dative ? { dative: true as const } : {}),
    ...(flags.bold ? { bold: true as const } : {}),
  };
}

/** The flags a bond carries. */
export function bondFlags(bond: Bond): BondFlags {
  return { dative: bond.dative === true, bold: bond.bold === true };
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
