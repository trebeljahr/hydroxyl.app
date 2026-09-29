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
 * The answer, in the order it is decided (decision 185, refining 181):
 *
 *   match                  exactly one core, in no larger carbocyclic system
 *   several-cores          two or more such cores: one acceptance holds one
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
 * a guess.
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
import type { StereoConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import {
  extraFusedCarbocycles,
  SKELETON_SEARCH_BUDGET,
  SkeletonSearchLimit,
  skeletonEmbeddings,
  skeletonFaces,
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

export type SkeletonSuggestion =
  | {
      readonly kind: "match";
      /** Ready to store as `PlanarParams.skeleton` once the user accepts. */
      readonly skeleton: AcceptedSkeleton;
      /** The numbering the acceptance would apply, core and beyond. */
      readonly locants: ReadonlyMap<AtomId, string>;
    }
  | {
      readonly kind: "refused";
      readonly name: SkeletonName;
      readonly reason: SkeletonRefusalReason;
      /** The atoms to look at, by `compareIds`. */
      readonly atomIds: readonly AtomId[];
      /** partial-core: the missing bond's two locants, lower first. */
      readonly missingBond?: readonly [string, string];
    }
  | { readonly kind: "none" };

/**
 * Whether `mol` holds a steroid core, and which atoms are which locant. Pure;
 * nothing is numbered until the user accepts the match (decision 163).
 */
export function suggestSteroidSkeleton(mol: Molecule): SkeletonSuggestion {
  const table = STEROID_SKELETON;
  const budget = { nodes: SKELETON_SEARCH_BUDGET };
  try {
    // A core inside a larger carbocyclic system (a pentacyclic triterpene)
    // is set aside, never matched (decision 185).
    const full = skeletonEmbeddings(mol, table, undefined, budget);
    const larger: AtomId[] = [];
    const cores = full.filter((core) => {
      const extra = extraFusedCarbocycles(mol, table, core);
      for (const ring of extra) larger.push(...ring);
      return extra.length === 0;
    });
    if (cores.length === 1) {
      const core = Object.freeze([...cores[0]!]);
      return Object.freeze({
        kind: "match",
        skeleton: Object.freeze({ name: table.name, core }),
        locants: steroidNumbering(mol, core),
      });
    }
    if (cores.length > 1) return refused("several-cores", cores.flat());
    if (full.length > 0) return refused("larger-ring-system", larger);
    // No core embeds: every 5-6-6-6 system found now has the wrong fusion.
    const wrong = fourRingSystems(mol);
    if (wrong.length > 0) return refused("wrong-fusion-topology", wrong);
    const membership = ringMembership(mol);
    const shareRing = (a: AtomId, b: AtomId): boolean => {
      const of = membership.atoms[b] ?? [];
      return (membership.atoms[a] ?? []).some((index) => of.includes(index));
    };
    for (let skip = 0; skip < table.bonds.length; skip++) {
      const [p, q] = table.bonds[skip]!;
      // Only a ring really left open is a seco-steroid: in a D-homo steroid
      // or an oleanane the "missing" 13-17 bond's atoms still share a ring.
      const partial = skeletonEmbeddings(mol, table, skip, budget).find(
        (core) => !shareRing(core[p]!, core[q]!) && extraFusedCarbocycles(mol, table, core).length === 0,
      );
      if (partial === undefined) continue;
      const pair = [table.locants[p]!, table.locants[q]!].sort((a, b) => Number(a) - Number(b));
      return Object.freeze({
        ...refused("partial-core", partial),
        missingBond: Object.freeze([pair[0]!, pair[1]!] as const),
      });
    }
    return Object.freeze({ kind: "none" });
  } catch (error) {
    if (error instanceof SkeletonSearchLimit) return refused("search-limit", []);
    throw error;
  }
}

function refused(reason: SkeletonRefusalReason, atoms: readonly AtomId[]): SkeletonSuggestion & { kind: "refused" } {
  return Object.freeze({
    kind: "refused",
    name: STEROID_SKELETON.name,
    reason,
    atomIds: Object.freeze([...new Set(atoms)].sort(compareIds)),
  });
}

/**
 * The atoms of every ring system made of exactly four rings of 6, 6, 6 and 5
 * atoms (rings joined by a shared atom). Only asked once the core itself has
 * failed to embed, so every one found has the wrong fusion.
 */
function fourRingSystems(mol: Molecule): AtomId[] {
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
  const out: AtomId[] = [];
  for (const members of systems.values()) {
    const sizes = members.map((i) => perceived[i]!.size).sort((a, b) => a - b);
    if (sizes.join(",") !== "5,6,6,6") continue;
    for (const i of members) out.push(...perceived[i]!.atomIds);
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
