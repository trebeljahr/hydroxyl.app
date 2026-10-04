/**
 * The steroid skeleton: the one table v1 ships (decision 165), its
 * recognition, its retained numbering and its alpha/beta faces.
 *
 * RECOGNITION IS A SUGGESTION (decision 163). `suggestSteroidSkeleton` is
 * pure and applies nothing: it returns a `match` the user may accept, a
 * `refused` that says why a steroid-like drawing is not numbered, or `none`.
 * A panel numbers a steroid and labels its faces only while its planar
 * params hold the accepted core (projection/types.ts, `PlanarParams`).
 *
 * ONE ANSWER PER SPECIES (decisions 195, 220). A reaction scheme is one
 * Molecule, and cholesterol beside cholest-4-en-3-one is two steroids, each
 * numbered on its own. Every species gets its own verdict in the order
 * below; a `match` offers one core per species that has one and carries the
 * other species' refusals beside it, so a refusal is never silent.
 *
 * THE MATCH IS THE FUSION TOPOLOGY, NOT THE RING SIZES (decision 181): the
 * gonane core — cyclopenta[a]phenanthrene, perhydro — embedded as a graph,
 *
 *        ring A  1-2-3-4-5-10        ring C  8-9-11-12-13-14
 *        ring B  5-6-7-8-9-10        ring D  13-14-15-16-17
 *
 * with every one of its 20 bonds present and no other bond between two of
 * its atoms. Any element (an aza-steroid keeps its numbering) and any bond
 * order (estradiol's aromatic ring A) match. The core has no symmetry, so one
 * embedding numbers it. Rings fused ONTO the core are allowed unless one is a
 * carbocycle of five or more atoms (decision 185): cyproterone's
 * 1,2-methylene, stanozolol's pyrazole and triamcinolone acetonide's
 * 16,17-acetonide are steroids, lupane and hopane are not.
 *
 * A species' verdict, in the order it is decided (decision 185, refining
 * 181):
 *
 *   match                  exactly one core, in no larger carbocyclic system
 *   several-cores          two or more such cores in the ONE species (a
 *                          bis-steroid, two steroids joined as one compound):
 *                          a species holds one accepted core
 *   larger-ring-system     every core found has a carbocycle of five or more
 *                          atoms fused onto it: a pentacyclic triterpene
 *                          (betulin, lupeol, hopane) has its own numbering;
 *                          the fused rings' atoms are named
 *   wrong-fusion-topology  no core embeds, and a ring system of exactly four
 *                          rings of 6, 6, 6 and 5 atoms exists: ring sizes
 *                          alone would claim ent-kaurene, whose C/D rings are
 *                          a bridged bicyclo[3.2.1]octane
 *   partial-core           the core with exactly ONE of its 20 bonds missing,
 *                          named by its locants, and that ring really open (no
 *                          ring holds both its atoms): cholecalciferol is
 *                          9,10-seco, and a ring not yet closed while drawing
 *                          is the same
 *   none                   anything else: a perhydrophenanthrene, an
 *                          all-six-membered pentacyclic triterpene (beta-
 *                          amyrin, friedelin) and a D-homo steroid are not
 *                          offered as a broken steroid
 *
 * and `search-limit` wherever the embedding search runs out of budget; never
 * a guess. The budget is the call's, not each species': out of it in the
 * whole-molecule search, everything is `search-limit`; out of it in the seco
 * search, which runs only on species with no verdict yet, the matches found
 * stand and one `search-limit` refusal covers the rest.
 *
 * THE NUMBERING IS A LOOKUP TABLE, NOT A SEARCH. A lowest-locant search gives
 * a different, defensible-looking, wrong answer. Locants 1-17 come from the
 * embedding (so ring D reads 13-14-15-16-17, not a perimeter walk's order);
 * 18 is the one carbon off the core at C13 and 19 the one at C10; 20 onward
 * only where C17's acyclic carbon side chain IS one of `SIDE_CHAIN_PARENTS`,
 * compared as rooted trees. Positions the carbon skeleton cannot tell apart —
 * cholestane's 26 and 27 — stay blank, as decision 142 leaves a tie, rather
 * than be chosen by id. A synthetic group at C17 (abiraterone's pyridyl), a
 * lone 17-methyl (a substituent of androstane, not a C20) and lanostane's
 * extra methyls are unnumbered: a partly numbered structure is a normal state.
 *
 * ALPHA AND BETA are `skeletonFaces` over this table: below or above the mean
 * plane of the whole fused system in the standard orientation, beta toward
 * the viewer. They are read from the configuration, never from the page, and
 * share no code with the anomeric alpha/beta of sugar.ts (skeleton/table.ts
 * says why).
 */

import { bondsAt, otherEnd, requireAtom } from "../molecule.js";
import { ringMembership, rings } from "../rings.js";
import { compareIds } from "../selection.js";
import { species, speciesIndexOf } from "../species.js";
import type { StereoConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import {
  extraFusedCarbocycles,
  SKELETON_SEARCH_BUDGET,
  SkeletonSearchLimit,
  skeletonEmbeddings,
  skeletonFaces,
  sortedSkeletons,
  type AcceptedSkeleton,
  type LigandFace,
  type SkeletonName,
  type SkeletonTable,
} from "./table.js";

const L = (locant: number): number => locant - 1;

/** The gonane core, locants 1-17 at indices 0-16. */
export const STEROID_SKELETON: SkeletonTable = Object.freeze({
  name: "steroid",
  locants: Object.freeze(Array.from({ length: 17 }, (_, i) => String(i + 1))),
  bonds: Object.freeze(
    (
      [
        [1, 2], [2, 3], [3, 4], [4, 5], [5, 10], [10, 1],
        [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
        [9, 11], [11, 12], [12, 13], [13, 14], [14, 8],
        [13, 17], [14, 15], [15, 16], [16, 17],
      ] as const
    ).map(([p, q]) => Object.freeze([L(p), L(q)] as const)),
  ),
  // Ring A first, C1 at the top and 1-2-3-4 counter-clockwise: the standard
  // drawing, rings A to D left to right.
  rings: Object.freeze(
    [
      [1, 2, 3, 4, 5, 10],
      [5, 6, 7, 8, 9, 10],
      [9, 11, 12, 13, 14, 8],
      [13, 14, 15, 16, 17],
    ].map((ring) => Object.freeze(ring.map(L))),
  ),
  meanPlane: Object.freeze(Array.from({ length: 17 }, (_, i) => i)),
  betaFace: "front",
});

export type SkeletonRefusalReason =
  | "larger-ring-system"
  | "several-cores"
  | "wrong-fusion-topology"
  | "partial-core"
  | "search-limit";

/** Why one species is not numbered. */
export interface SkeletonRefusal {
  readonly name: SkeletonName;
  readonly reason: SkeletonRefusalReason;
  /** The atoms to look at, by `compareIds`; empty for `search-limit`. */
  readonly atomIds: readonly AtomId[];
  /** partial-core: the missing bond's two locants, lower first. */
  readonly missingBond?: readonly [string, string];
}

export type SkeletonSuggestion =
  | {
      readonly kind: "match";
      /**
       * One core per species that holds exactly one, in `sortedSkeletons`
       * order: ready to store as `PlanarParams.skeletons` once the user
       * accepts.
       */
      readonly skeletons: readonly AcceptedSkeleton[];
      /** The numbering the acceptance would apply, every core and beyond. */
      readonly locants: ReadonlyMap<AtomId, string>;
      /** Every other steroid-like species, and why it is not offered, in species order. */
      readonly refusals: readonly SkeletonRefusal[];
    }
  | {
      readonly kind: "refused";
      /** One per steroid-like species, in species order; never empty. */
      readonly refusals: readonly SkeletonRefusal[];
    }
  | { readonly kind: "none" };

/** One species' answer: the core it offers, or why it offers none. */
type SpeciesVerdict = { readonly core: readonly AtomId[] } | SkeletonRefusal;

/**
 * Whether `mol` holds steroid cores, one per species, and which atoms are
 * which locant. Pure; nothing is numbered until the user accepts the match
 * (decision 163).
 */
export function suggestSteroidSkeleton(mol: Molecule): SkeletonSuggestion {
  const table = STEROID_SKELETON;
  const budget = { nodes: SKELETON_SEARCH_BUDGET };
  const all = species(mol);
  const speciesOfCore = (atoms: readonly AtomId[]): number => speciesIndexOf(mol, atoms[0]!)!;
  const verdicts = new Map<number, SpeciesVerdict>();
  let full: AtomId[][];
  try {
    full = skeletonEmbeddings(mol, table, undefined, budget);
  } catch (error) {
    if (error instanceof SkeletonSearchLimit) {
      return Object.freeze({ kind: "refused", refusals: Object.freeze([refused("search-limit", [])]) });
    }
    throw error;
  }
  // A core inside a larger carbocyclic system (a pentacyclic triterpene)
  // is set aside, never matched (decision 185).
  const kept = new Map<number, AtomId[][]>();
  const larger = new Map<number, AtomId[]>();
  for (const core of full) {
    const index = speciesOfCore(core);
    const extra = extraFusedCarbocycles(mol, table, core);
    if (extra.length === 0) kept.set(index, [...(kept.get(index) ?? []), core]);
    else larger.set(index, [...(larger.get(index) ?? []), ...extra.flat()]);
  }
  for (const [index, cores] of kept) {
    const only = cores.length === 1 ? cores[0]! : undefined;
    verdicts.set(index, only === undefined ? refused("several-cores", cores.flat()) : { core: Object.freeze([...only]) });
  }
  for (const [index, atoms] of larger) {
    if (!verdicts.has(index)) verdicts.set(index, refused("larger-ring-system", atoms));
  }
  // A species with no core: every 5-6-6-6 system in it has the wrong fusion.
  const wrong = new Map<number, AtomId[]>();
  for (const system of fourRingSystems(mol)) {
    const index = speciesOfCore(system);
    if (!verdicts.has(index)) wrong.set(index, [...(wrong.get(index) ?? []), ...system]);
  }
  for (const [index, atoms] of wrong) verdicts.set(index, refused("wrong-fusion-topology", atoms));

  let searchLimited = false;
  const open = new Set<AtomId>();
  all.forEach((one, index) => {
    if (!verdicts.has(index)) for (const id of one.atomIds) open.add(id);
  });
  if (open.size > 0) {
    const membership = ringMembership(mol);
    const shareRing = (a: AtomId, b: AtomId): boolean => {
      const of = membership.atoms[b] ?? [];
      return (membership.atoms[a] ?? []).some((index) => of.includes(index));
    };
    try {
      for (let skip = 0; skip < table.bonds.length && open.size > 0; skip++) {
        const [p, q] = table.bonds[skip]!;
        for (const partial of skeletonEmbeddings(mol, table, skip, budget, open)) {
          const index = speciesOfCore(partial);
          if (verdicts.has(index)) continue;
          // Only a ring really left open is a seco-steroid: in a D-homo
          // steroid or an oleanane the "missing" 13-17 bond's atoms still
          // share a ring.
          if (shareRing(partial[p]!, partial[q]!)) continue;
          if (extraFusedCarbocycles(mol, table, partial).length > 0) continue;
          const pair = [table.locants[p]!, table.locants[q]!].sort((a, b) => Number(a) - Number(b));
          verdicts.set(
            index,
            Object.freeze({
              ...refused("partial-core", partial),
              missingBond: Object.freeze([pair[0]!, pair[1]!] as const),
            }),
          );
          for (const id of all[index]!.atomIds) open.delete(id);
        }
      }
    } catch (error) {
      if (!(error instanceof SkeletonSearchLimit)) throw error;
      searchLimited = true;
    }
  }

  const matched: AcceptedSkeleton[] = [];
  const refusals: SkeletonRefusal[] = [];
  for (let index = 0; index < all.length; index++) {
    const verdict = verdicts.get(index);
    if (verdict === undefined) continue;
    if ("core" in verdict) matched.push(Object.freeze({ name: table.name, core: verdict.core }));
    else refusals.push(verdict);
  }
  if (searchLimited) refusals.push(refused("search-limit", []));
  if (matched.length > 0) {
    const skeletons = sortedSkeletons(matched);
    const locants = new Map<AtomId, string>();
    for (const { core } of skeletons) {
      for (const [atomId, locant] of steroidNumbering(mol, core)) locants.set(atomId, locant);
    }
    return Object.freeze({
      kind: "match",
      skeletons: Object.freeze(skeletons),
      locants,
      refusals: Object.freeze(refusals),
    });
  }
  if (refusals.length > 0) return Object.freeze({ kind: "refused", refusals: Object.freeze(refusals) });
  return Object.freeze({ kind: "none" });
}

function refused(reason: SkeletonRefusalReason, atoms: readonly AtomId[]): SkeletonRefusal {
  return Object.freeze({
    name: STEROID_SKELETON.name,
    reason,
    atomIds: Object.freeze([...new Set(atoms)].sort(compareIds)),
  });
}

/**
 * Every ring system made of exactly four rings of 6, 6, 6 and 5 atoms (rings
 * joined by a shared atom), as its atoms. Only read for a species whose core
 * has failed to embed, so every one found there has the wrong fusion.
 */
function fourRingSystems(mol: Molecule): AtomId[][] {
  const perceived = rings(mol);
  const membership = ringMembership(mol);
  const parent = perceived.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const atomId of mol.atomIds) {
    const indices = membership.atoms[atomId] ?? [];
    for (let k = 1; k < indices.length; k++) {
      const a = find(indices[0]!);
      const c = find(indices[k]!);
      if (a !== c) parent[Math.max(a, c)] = Math.min(a, c);
    }
  }
  const systems = new Map<number, number[]>();
  perceived.forEach((_, i) => {
    const root = find(i);
    const list = systems.get(root);
    if (list === undefined) systems.set(root, [i]);
    else list.push(i);
  });
  const out: AtomId[][] = [];
  for (const members of systems.values()) {
    const sizes = members.map((i) => perceived[i]!.size).sort((a, b) => a - b);
    if (sizes.join(",") !== "5,6,6,6") continue;
    out.push(members.flatMap((i) => perceived[i]!.atomIds));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export interface SideChainNode {
  readonly locant: string;
  /** Index of the parent node in the same list; -1 for C20, bonded to C17. */
  readonly parent: number;
}

const node = (locant: string, parent: number): SideChainNode => Object.freeze({ locant, parent });

const CHOLESTANE: readonly SideChainNode[] = Object.freeze([
  node("20", -1),
  node("21", 0),
  node("22", 0),
  node("23", 2),
  node("24", 3),
  node("25", 4),
  node("26", 5),
  node("27", 5),
]);

export interface SideChainParent {
  readonly name: string;
  readonly nodes: readonly SideChainNode[];
}

const sideChainParent = (name: string, nodes: readonly SideChainNode[]): SideChainParent =>
  Object.freeze({ name, nodes: Object.freeze([...nodes]) });

/**
 * The side-chain parents whose numbering the steroid rules retain, as carbon
 * trees rooted at C20. A side chain is numbered only when its carbon skeleton
 * IS one of these. Frozen all the way down: it is exported, and a caller
 * must not be able to renumber every steroid by editing it.
 */
export const SIDE_CHAIN_PARENTS: readonly SideChainParent[] = Object.freeze([
  sideChainParent("pregnane", [node("20", -1), node("21", 0)]),
  sideChainParent("cholane", CHOLESTANE.slice(0, 5)),
  sideChainParent("cholestane", CHOLESTANE),
  sideChainParent("ergostane", [...CHOLESTANE, node("28", 4)]),
  sideChainParent("stigmastane", [...CHOLESTANE, node("28", 4), node("29", 8)]),
]);

/**
 * The steroid numbering of `mol` given its core (locants 1-17 in order): the
 * core, then 18 and 19, then a side chain the table knows. By `mol.atomIds`
 * order; an atom with no locant has no entry.
 */
export function steroidNumbering(mol: Molecule, core: readonly AtomId[]): ReadonlyMap<AtomId, string> {
  const locants = new Map<AtomId, string>();
  core.forEach((atomId, index) => locants.set(atomId, STEROID_SKELETON.locants[index]!));
  const inCore = new Set(core);
  const carbonsOff = (atomId: AtomId): AtomId[] =>
    bondsAt(mol, atomId)
      .map((bond) => otherEnd(bond, atomId))
      .filter((id) => !inCore.has(id) && requireAtom(mol, id).element === "C");

  for (const [host, locant] of [
    [core[L(13)]!, "18"],
    [core[L(10)]!, "19"],
  ] as const) {
    const off = carbonsOff(host);
    if (off.length === 1) locants.set(off[0]!, locant);
  }

  const c17 = core[L(17)]!;
  const off17 = carbonsOff(c17);
  if (off17.length === 1) {
    const tree = carbonTree(mol, off17[0]!, c17, inCore);
    if (tree !== undefined) numberSideChain(tree, locants);
  }

  const ordered = new Map<AtomId, string>();
  for (const atomId of mol.atomIds) {
    const locant = locants.get(atomId);
    if (locant !== undefined) ordered.set(atomId, locant);
  }
  return ordered;
}

interface CarbonTree {
  readonly atomId: AtomId;
  readonly children: readonly CarbonTree[];
}

/** Carbon trees past C20 hold at most this many atoms; anything larger is no table parent. */
const SIDE_CHAIN_LIMIT = 16;

/**
 * The acyclic carbon tree hanging from C17 at `root`: carbons only, never
 * back into the core, and no ring atom anywhere in it — a pyridyl's five
 * carbons, the nitrogen left out, would otherwise read as cholane's side
 * chain. Undefined for any of those, or a tree larger than any parent.
 */
function carbonTree(
  mol: Molecule,
  root: AtomId,
  from: AtomId,
  inCore: ReadonlySet<AtomId>,
): CarbonTree | undefined {
  const membership = ringMembership(mol);
  const inRing = (id: AtomId): boolean => (membership.atoms[id] ?? []).length > 0;
  if (inRing(root)) return undefined;
  const seen = new Set<AtomId>([root]);
  let count = 1;
  const grow = (atomId: AtomId, parent: AtomId): CarbonTree | undefined => {
    const children: CarbonTree[] = [];
    const next = bondsAt(mol, atomId)
      .map((bond) => otherEnd(bond, atomId))
      .filter((id) => id !== parent && requireAtom(mol, id).element === "C")
      .sort(compareIds);
    for (const id of next) {
      if (inCore.has(id) || inRing(id) || seen.has(id) || ++count > SIDE_CHAIN_LIMIT) return undefined;
      seen.add(id);
      const child = grow(id, atomId);
      if (child === undefined) return undefined;
      children.push(child);
    }
    return { atomId, children };
  };
  return grow(root, from);
}

/** The AHU code of a rooted tree: equal codes, isomorphic trees. */
function code(children: readonly string[]): string {
  return `(${[...children].sort().join("")})`;
}

function treeCode(tree: CarbonTree): string {
  return code(tree.children.map(treeCode));
}

function numberSideChain(tree: CarbonTree, locants: Map<AtomId, string>): void {
  const target = treeCode(tree);
  for (const parent of SIDE_CHAIN_PARENTS) {
    const kids = parent.nodes.map((_, i) => parent.nodes.flatMap((n, j) => (n.parent === i ? [j] : [])));
    const nodeCode = (i: number): string => code(kids[i]!.map(nodeCode));
    if (nodeCode(0) !== target) continue;
    const assign = (node: number, at: CarbonTree): void => {
      locants.set(at.atomId, parent.nodes[node]!.locant);
      const byCode = new Map<string, { nodes: number[]; atoms: CarbonTree[] }>();
      for (const child of kids[node]!) {
        const key = nodeCode(child);
        const entry = byCode.get(key) ?? { nodes: [], atoms: [] };
        entry.nodes.push(child);
        byCode.set(key, entry);
      }
      for (const child of at.children) byCode.get(treeCode(child))!.atoms.push(child);
      // Two positions the carbon skeleton cannot tell apart (26 and 27) stay
      // blank: choosing between them by id would be a guess.
      for (const { nodes, atoms } of byCode.values()) {
        if (nodes.length === 1) assign(nodes[0]!, atoms[0]!);
      }
    };
    assign(0, tree);
    return;
  }
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/**
 * Alpha or beta for every ligand off the steroid core at every core
 * stereocentre `config` specifies (decision 182). `core` must fit.
 */
export function steroidFaces(mol: Molecule, config: StereoConfig, core: readonly AtomId[]): readonly LigandFace[] {
  return skeletonFaces(mol, config, STEROID_SKELETON, core);
}
