/**
 * A retained ring skeleton as DATA: its numbering, its rings, the atoms of
 * its reference plane, and which face of that plane is beta (decision 165).
 *
 * Only the steroid table ships in v1 (skeleton/steroid.ts), but nothing here
 * knows it is a steroid: a triterpene or an alkaloid is a second table, not a
 * second reader. This module does three things with a table:
 *
 *   EMBED it in a molecule, as a graph: which atoms are its core, by locant.
 *   CHECK a stored acceptance still fits (decision 163's stale case).
 *   READ THE FACE of every ligand off the core, against ONE reference plane.
 *
 * THE FACE IS READ FROM THE CONFIGURATION, NEVER FROM THE PAGE (decision
 * 182). The table's standard orientation is built from its rings as regular
 * polygons, and its reference plane is the mean plane of `meanPlane`'s atoms
 * there — the page itself, since the standard drawing is flat. Beta is the
 * table's `betaFace` of that plane: `front`, toward the viewer of the
 * standard drawing, which is why a beta substituent is drawn as a bold wedge
 * and never "up the page". For each core stereocentre and each ligand off the
 * core, ONE synthetic placement puts the centre and its core neighbours at
 * their standard positions and that ligand on the exterior side carrying a
 * wedge — the hypothesis "this ligand is beta" — and `readConfig` reads it
 * with the wedge/hash convention scoped to that centre, the pattern decision
 * 144 set for D/L. Its parity equals the configuration's exactly when the
 * hypothesis holds. So no second lift exists, no scene y is consulted, and
 * the drawing the author made plays no part: turning it, or `flipAtoms`,
 * changes no face, and its mirror image (the enantiomer) inverts every one.
 *
 * ONE PLANE FOR THE WHOLE SYSTEM. Every core atom is judged against the same
 * plane. Judging ring C against the plane of ring A would put the C-11 and
 * C-12 substituents on the wrong side; with one plane that cannot happen.
 *
 * A ring-fusion hydrogen (a steroid's 5-, 8-, 9- and 14-H) is the hypothesis
 * ligand through decision 179's drawn hydrogen, since the model stores none.
 *
 * NOT THE ANOMERIC RULE. Carbohydrate alpha/beta (sugar.ts, decision 141) is
 * a RELATIVE configuration with no reference plane in it, read on a Fischer
 * cross. This module imports nothing from sugar.ts, and sugar.ts nothing
 * from here: the two share a Greek letter and no code.
 */

import { bondBetween, bondsAt, neighborIds, otherEnd } from "../molecule.js";
import { rings } from "../rings.js";
import { compareIds } from "../selection.js";
import {
  readConfig,
  type CentreConfig,
  type PlacedMark,
  type StereoConfig,
} from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";

/** The skeleton tables this build has. Stored in documents, so never renamed. */
export const SKELETON_NAMES = Object.freeze(["steroid"] as const);
export type SkeletonName = (typeof SKELETON_NAMES)[number];

/**
 * What a panel stores once the user has ACCEPTED a suggested skeleton
 * (decision 163): the table's name and the atom at each core locant, in the
 * table's locant order. Plain JSON. Everything else — the numbering past the
 * core, the faces — is derived again at project time.
 */
export interface AcceptedSkeleton {
  readonly name: SkeletonName;
  readonly core: readonly AtomId[];
}

export interface SkeletonTable {
  readonly name: SkeletonName;
  /** The core's locants, in the order `AcceptedSkeleton.core` lists atoms. */
  readonly locants: readonly string[];
  /** The core's bonds, as pairs of indices into `locants`. */
  readonly bonds: readonly (readonly [number, number])[];
  /**
   * The core's rings as walks of indices into `locants`, in the order the
   * standard orientation builds them. The first ring's first atom is at the
   * top of its regular polygon and its walk runs counter-clockwise; each later
   * ring is fused on an edge already built, on the far side.
   */
  readonly rings: readonly (readonly number[])[];
  /** The core atoms whose mean plane is the reference plane, and that get a face. */
  readonly meanPlane: readonly number[];
  /** The face of the reference plane that is beta, in the standard orientation. */
  readonly betaFace: "front";
}

// ---------------------------------------------------------------------------
// The standard orientation
// ---------------------------------------------------------------------------

const ORIENTATIONS = new WeakMap<SkeletonTable, readonly Vec2[]>();

/**
 * The core in its standard orientation, at unit edge, y up: the table's rings
 * built as regular polygons, the first with its first atom at the top and its
 * walk counter-clockwise, each next one on its shared edge on the far side.
 * Computed, not typed in, so a wrong coordinate cannot hide in the table.
 */
export function standardOrientation(table: SkeletonTable): readonly Vec2[] {
  const hit = ORIENTATIONS.get(table);
  if (hit !== undefined) return hit;
  const pos = new Map<number, Vec2>();
  const built: (readonly number[])[] = [];
  table.rings.forEach((ring, r) => {
    const n = ring.length;
    const radius = 1 / (2 * Math.sin(Math.PI / n));
    if (r === 0) {
      ring.forEach((index, k) => {
        const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
        pos.set(index, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      });
      built.push(ring);
      return;
    }
    const i = ring.findIndex((index, k) => pos.has(index) && pos.has(ring[(k + 1) % n]!));
    if (i < 0) throw new Error(`skeleton ${table.name}: ring ${r} shares no built edge`);
    const a = pos.get(ring[i]!)!;
    const b = pos.get(ring[(i + 1) % n]!)!;
    const owner = built.find((other) => other.includes(ring[i]!) && other.includes(ring[(i + 1) % n]!))!;
    let ox = 0;
    let oy = 0;
    for (const index of owner) {
      ox += pos.get(index)!.x;
      oy += pos.get(index)!.y;
    }
    ox /= owner.length;
    oy /= owner.length;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
    const side = (ox - mid.x) * normal.x + (oy - mid.y) * normal.y > 0 ? -1 : 1;
    const apothem = (side * 1) / (2 * Math.tan(Math.PI / n));
    const centre = { x: mid.x + normal.x * apothem, y: mid.y + normal.y * apothem };
    const from = { x: a.x - centre.x, y: a.y - centre.y };
    const to = { x: b.x - centre.x, y: b.y - centre.y };
    const step = Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
    for (let k = 0; k < n; k++) {
      const index = ring[(i + k) % n]!;
      if (pos.has(index)) continue;
      const cos = Math.cos(k * step);
      const sin = Math.sin(k * step);
      pos.set(index, { x: centre.x + from.x * cos - from.y * sin, y: centre.y + from.x * sin + from.y * cos });
    }
    built.push(ring);
  });
  const out = Object.freeze(
    table.locants.map((_, index) => {
      const p = pos.get(index);
      if (p === undefined) throw new Error(`skeleton ${table.name}: locant ${table.locants[index]} is in no ring`);
      return Object.freeze(p);
    }),
  );
  ORIENTATIONS.set(table, out);
  return out;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/** How many partial maps one suggestion may try before it gives up and says so. */
export const SKELETON_SEARCH_BUDGET = 500_000;

export class SkeletonSearchLimit extends Error {
  constructor() {
    super("skeleton search budget exceeded");
  }
}

/**
 * Every embedding of the table's core in `mol`, as atom lists in locant
 * order, one per distinct atom set. `skip` names one core bond (an index into
 * `table.bonds`) that must be ABSENT: the seco-steroid search.
 *
 * Any element and any bond order match; what must hold is the graph: every
 * core bond present (bar `skip`), and NO other bond between two core atoms,
 * so a bridged system does not pass for the table's. A ring fused ONTO the
 * core is not seen here; `extraFusedCarbocycles` is the caller's check.
 *
 * Throws `SkeletonSearchLimit` when `budget.nodes` runs out.
 */
export function skeletonEmbeddings(
  mol: Molecule,
  table: SkeletonTable,
  skip: number | undefined,
  budget: { nodes: number },
): AtomId[][] {
  const size = table.locants.length;
  const adjacent: Set<number>[] = table.locants.map(() => new Set());
  table.bonds.forEach(([p, q], index) => {
    if (index === skip) return;
    adjacent[p]!.add(q);
    adjacent[q]!.add(p);
  });
  // Breadth-first from the highest-degree locant, so every later locant has
  // an already-placed neighbour to grow from.
  let root = 0;
  for (let i = 1; i < size; i++) if (adjacent[i]!.size > adjacent[root]!.size) root = i;
  const order: number[] = [root];
  const via: number[] = new Array<number>(size).fill(-1);
  const seen = new Set([root]);
  for (let k = 0; k < order.length; k++) {
    for (const next of [...adjacent[order[k]!]!].sort((a, b) => a - b)) {
      if (seen.has(next)) continue;
      seen.add(next);
      via[next] = order[k]!;
      order.push(next);
    }
  }
  if (order.length !== size) return [];
  const skipped = skip === undefined ? undefined : table.bonds[skip];

  const image: (AtomId | undefined)[] = new Array<AtomId | undefined>(size).fill(undefined);
  const used = new Set<AtomId>();
  const found = new Map<string, AtomId[]>();
  const degree = (atomId: AtomId): number => bondsAt(mol, atomId).length;

  const fits = (locant: number, atomId: AtomId): boolean => {
    if (used.has(atomId) || degree(atomId) < adjacent[locant]!.size) return false;
    for (let other = 0; other < size; other++) {
      const at = image[other];
      if (at === undefined) continue;
      const bonded = bondBetween(mol, atomId, at) !== undefined;
      if (bonded !== adjacent[locant]!.has(other)) return false;
    }
    return true;
  };

  const extend = (k: number): void => {
    if (--budget.nodes < 0) throw new SkeletonSearchLimit();
    if (k === size) {
      if (skipped !== undefined && bondBetween(mol, image[skipped[0]]!, image[skipped[1]]!) !== undefined) return;
      const atoms = image as AtomId[];
      const key = [...atoms].sort(compareIds).join("\u0000");
      if (!found.has(key)) found.set(key, [...atoms]);
      return;
    }
    const locant = order[k]!;
    const candidates = k === 0 ? mol.atomIds : neighborIds(mol, image[via[locant]!]!);
    for (const atomId of candidates) {
      if (!fits(locant, atomId)) continue;
      image[locant] = atomId;
      used.add(atomId);
      extend(k + 1);
      used.delete(atomId);
      image[locant] = undefined;
    }
  };
  extend(0);
  return [...found.values()];
}

/**
 * A fused carbocycle this large or larger makes the core part of another
 * retained skeleton (decision 185): lupane's and hopane's ring A.
 */
export const FUSED_CARBOCYCLE_MIN_SIZE = 5;

/**
 * The rings fused onto an embedded core that make it part of a LARGER
 * carbocyclic system (decision 185), each as its atoms in walk order: a
 * perceived ring that shares a bond between two core atoms, is not one of the
 * table's rings, has `FUSED_CARBOCYCLE_MIN_SIZE` atoms or more, and holds
 * only carbon.
 *
 * The embedding already forbids an extra bond between two core atoms, but
 * not a ring fused onto them: a pentacyclic triterpene embeds four of its
 * five rings as a steroid's A-D (betulin's B-E), and steroid numbering on it
 * is wrong. A small carbocycle and any ring with a heteroatom are left alone:
 * cyproterone's 1,2-methylene, drospirenone's 6,7- and 15,16-methylenes,
 * stanozolol's pyrazole and triamcinolone acetonide's 16,17-acetonide are
 * fused onto a steroid and keep its numbering.
 */
export function extraFusedCarbocycles(
  mol: Molecule,
  table: SkeletonTable,
  core: readonly AtomId[],
): readonly (readonly AtomId[])[] {
  const inCore = new Set(core);
  const tableRings = new Set(table.rings.map((ring) => setKey(ring.map((index) => core[index]!))));
  const out: (readonly AtomId[])[] = [];
  for (const ring of rings(mol)) {
    if (ring.size < FUSED_CARBOCYCLE_MIN_SIZE || tableRings.has(setKey(ring.atomIds))) continue;
    if (!ring.atomIds.every((id) => mol.atoms[id]!.element === "C")) continue;
    const fused = ring.bondIds.some((bondId) => {
      const bond = mol.bonds[bondId]!;
      return inCore.has(bond.from) && inCore.has(bond.to);
    });
    if (fused) out.push(ring.atomIds);
  }
  return out;
}

function setKey(atomIds: readonly AtomId[]): string {
  return [...atomIds].sort(compareIds).join("\u0000");
}

/**
 * The atoms that keep a stored acceptance from fitting `mol` any more, or
 * undefined when it fits: an id the molecule no longer has, an atom named
 * twice, a core bond gone, a new bond between two core atoms, or a carbocycle
 * fused onto the core since (decision 185), so an acceptance never outlives
 * what the suggestion would still match. Ids are read with `Object.hasOwn`,
 * so "constructor" is simply missing.
 */
export function acceptedSkeletonMisfit(
  mol: Molecule,
  table: SkeletonTable,
  accepted: AcceptedSkeleton,
): readonly AtomId[] | undefined {
  const core = accepted.core;
  if (accepted.name !== table.name || core.length !== table.locants.length) {
    return [...new Set(core.filter((id) => Object.hasOwn(mol.atoms, id)))].sort(compareIds);
  }
  const bad = new Set<AtomId>();
  const seen = new Set<AtomId>();
  for (const id of core) {
    if (!Object.hasOwn(mol.atoms, id) || seen.has(id)) bad.add(id);
    seen.add(id);
  }
  if (bad.size > 0) return [...bad].sort(compareIds);
  const wanted = new Set(table.bonds.map(([p, q]) => (p < q ? `${p},${q}` : `${q},${p}`)));
  for (let p = 0; p < core.length; p++) {
    for (let q = p + 1; q < core.length; q++) {
      const bonded = bondBetween(mol, core[p]!, core[q]!) !== undefined;
      if (bonded !== wanted.has(`${p},${q}`)) {
        bad.add(core[p]!);
        bad.add(core[q]!);
      }
    }
  }
  if (bad.size > 0) return [...bad].sort(compareIds);
  for (const ring of extraFusedCarbocycles(mol, table, core)) for (const id of ring) bad.add(id);
  return bad.size > 0 ? [...bad].sort(compareIds) : undefined;
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

export type SkeletonFace = "alpha" | "beta";

/** A ligand off the core: an atom, or the centre's implicit hydrogen. */
export type FaceLigand =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "implicitHydrogen" };

export interface LigandFace {
  /** The core atom. */
  readonly atomId: AtomId;
  /** Its locant in the table. */
  readonly locant: string;
  readonly ligand: FaceLigand;
  readonly face: SkeletonFace;
}

const WEDGE_HASH = Object.freeze({ kind: "wedgeHash" as const });

/**
 * The face of every ligand off the core at every core stereocentre the
 * configuration specifies, in locant order, atom ligands by `compareIds`
 * then the implicit hydrogen. `core` must fit (`acceptedSkeletonMisfit`).
 * A centre the configuration does not specify has no face, and neither does
 * a lone pair.
 */
export function skeletonFaces(
  mol: Molecule,
  config: StereoConfig,
  table: SkeletonTable,
  core: readonly AtomId[],
): readonly LigandFace[] {
  const standard = standardOrientation(table);
  const centres = new Map(config.centres.map((c) => [c.atomId, c]));
  const out: LigandFace[] = [];
  for (const index of [...table.meanPlane].sort((a, b) => a - b)) {
    const atomId = core[index]!;
    const centre = centres.get(atomId);
    if (centre === undefined || centre.reading.kind !== "specified") continue;
    const coreNeighbours = table.bonds.flatMap(([p, q]) => (p === index ? [q] : q === index ? [p] : []));
    const off = neighborIds(mol, atomId)
      .filter((id) => !coreNeighbours.some((k) => core[k] === id))
      .sort(compareIds);
    const ligands: FaceLigand[] = off.map((id) => ({ kind: "atom", atomId: id }));
    if (centre.implicitHydrogen) ligands.push({ kind: "implicitHydrogen" });
    for (const ligand of ligands) {
      const face = faceOf(mol, table, centre, standard, index, coreNeighbours, core, off, ligand);
      if (face !== undefined) out.push({ atomId, locant: table.locants[index]!, ligand, face });
    }
  }
  return out;
}

/**
 * One ligand's face: the centre and its core neighbours at their standard
 * positions, every ligand off the core on the exterior side, THIS one carrying
 * a wedge, read by the wedge/hash convention scoped to the centre. The wedge
 * says "toward the viewer of the standard drawing"; the parity it reads
 * matches the configuration's exactly when that is where the ligand is.
 */
function faceOf(
  mol: Molecule,
  table: SkeletonTable,
  centre: CentreConfig,
  standard: readonly Vec2[],
  index: number,
  coreNeighbours: readonly number[],
  core: readonly AtomId[],
  off: readonly AtomId[],
  ligand: FaceLigand,
): SkeletonFace | undefined {
  if (centre.reading.kind !== "specified") return undefined;
  const origin = standard[index]!;
  // The exterior side: away from the core neighbours. A regular fusion atom's
  // three neighbours cancel; any in-plane direction then gives the same
  // volume, because the three form a triangle round the centre.
  let ex = 0;
  let ey = 0;
  for (const k of coreNeighbours) {
    const p = standard[k]!;
    const length = Math.hypot(p.x - origin.x, p.y - origin.y);
    ex -= (p.x - origin.x) / length;
    ey -= (p.y - origin.y) / length;
  }
  const length = Math.hypot(ex, ey);
  const exterior = length > 1e-6 ? { x: origin.x + ex / length, y: origin.y + ey / length } : { x: origin.x, y: origin.y + 1 };

  const positions: Record<AtomId, Vec2> = { [centre.atomId]: origin };
  for (const k of coreNeighbours) positions[core[k]!] = standard[k]!;
  for (const id of off) positions[id] = exterior;
  const marks: Record<BondId, PlacedMark> = {};
  for (const bond of bondsAt(mol, centre.atomId)) {
    const far = otherEnd(bond, centre.atomId);
    const hypothesis = ligand.kind === "atom" && ligand.atomId === far;
    marks[bond.id] = { stereo: hypothesis ? "wedge" : "none", narrowEnd: centre.atomId };
  }
  const hydrogens =
    ligand.kind === "implicitHydrogen"
      ? { [centre.atomId]: { position: exterior, stereo: "wedge" as const } }
      : undefined;
  const read = readConfig({ mol, positions, marks, hydrogens }, WEDGE_HASH, { centres: [centre.atomId] });
  if (read.kind !== "read") return undefined;
  const reading = read.config.centres.find((c) => c.atomId === centre.atomId)?.reading;
  if (reading?.kind !== "specified") return undefined;
  const toward = reading.parity === centre.reading.parity;
  // The hypothesis wedge is the FRONT face; beta is whichever face the table says.
  return toward === (table.betaFace === "front") ? "beta" : "alpha";
}
