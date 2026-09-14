/**
 * Stereochemistry perception: which atoms and bonds are stereogenic, and what
 * a chemist would call their configuration.
 *
 * THIS MODULE REFUSES RATHER THAN GUESSES, and that is its whole design, for
 * the same reason `exactMass()` throws instead of substituting an average
 * atomic weight. Every projection the editor will grow — Fischer, Haworth,
 * Newman, chair — is a depiction of a CONFIGURATION, and the only oracle that
 * a projection round-trips correctly is that the CIP descriptors survive it.
 * A descriptor that is silently a coin flip makes every one of those
 * assertions pass while depicting the wrong enantiomer. So an answer this
 * module cannot prove comes back as `{ kind: "undetermined", reason }` with
 * the reason named, never as a plausible letter.
 *
 * WHAT IS IMPLEMENTED, EXACTLY.
 *
 *   CIP RULE 1a — atomic number, compared outward SPHERE BY SPHERE over the
 *   hierarchical digraph. Breadth, not depth: the whole of sphere n is
 *   compared before anything in sphere n+1, so a difference near the centre
 *   settles the pair and a deeper atom never overturns it. Depth-first is the
 *   easy mistake and it returns a confident wrong letter on most ring
 *   stereocentres — see `compareBranches`.
 *
 *   CIP RULE 1b — DUPLICATED ATOMS. A bond of order n contributes n-1 phantom
 *   neighbours of the far element at BOTH ends, and a ring closure terminates
 *   in a duplicate of the atom already on the path. Both are required, not
 *   optional: without duplication a carbonyl carbon ranks below an ether
 *   carbon, and without ring-closure duplicates the traversal of a sugar does
 *   not terminate at all.
 *
 *   MAXIMUM SPHERE DEPTH IS `MAX_SPHERES` (64), and the digraph is additionally
 *   capped at `MAX_BRANCH_NODES` nodes per comparison. Two branches still tied
 *   when either cap is reached are reported `ranking-truncated` — never
 *   "identical", which is the failure that would silently delete a
 *   stereocentre. 64 spheres covers a steroid's whole ring system plus its
 *   side chain and every sugar the corpus contains; the node cap, not the
 *   depth, is what stops a pathological ring system. A molecule that needs
 *   more says so.
 *
 *   TRUNCATION IS NOT FREE, which is why the depth is generous. A truncated
 *   centre reports `undetermined`, and `stereocenterAtoms` counts an
 *   undetermined centre as a stereocentre — deliberately, so an undrawn wedge
 *   still shows up as a real centre. The cost of truncating too eagerly is
 *   therefore not just a missing letter: non-stereogenic atoms get listed as
 *   stereocentres, and `structuralIssues` then silently accepts a wedge drawn
 *   on any of them. At the old depth of 10 that made every atom in a steroid
 *   look stereogenic.
 *
 * WHAT IS NOT IMPLEMENTED, AND HOW IT SHOWS.
 *
 *   CIP RULE 2 (mass number) and rules 3-5 (the `Z`/`E`, `R`/`S` and
 *   like/unlike criteria that separate pseudoasymmetric centres) are not
 *   ordered correctly by this comparator. Rather than apply them in the wrong
 *   order, a pair of branches that ties under rule 1 is RE-COMPARED on an
 *   extended key (mass number, then formal charge): if that finds a
 *   difference, the pair is reported `ranking-unsupported` and the centre
 *   comes back undetermined. Only a pair that ties on both passes is treated
 *   as genuinely identical.
 *
 *   Consequence, stated rather than hidden: a PSEUDOASYMMETRIC centre — one
 *   whose two branches are constitutionally identical and differ only in their
 *   own descriptors — is reported as NOT stereogenic, and a wedge drawn on it
 *   is reported by `structuralIssues` as a wedge on a non-stereocentre. That
 *   is wrong for 2,3,4-trihydroxyglutaric acid and right for everything the
 *   corpus contains.
 *
 *   Trigonal-pyramidal centres (a sulfoxide's sulfur, a phosphine's
 *   phosphorus) are out of scope: `stereocenterAtoms` requires four sigma
 *   substituents, so a lone pair is never counted as one. Amine nitrogen is
 *   excluded by the same rule, which is also the right answer — it inverts.
 *
 *   Allenes, atropisomers, enhanced stereo groups (AND/OR) and anything read
 *   from a third dimension are out of scope entirely.
 *
 * KEKULE IS THE STORAGE FORM, so the digraph duplicates on `bond.order` and
 * ignores `bond.aromatic`. An importer's flagged molecule must go through
 * `kekulize()` first, exactly as it already must for hydrogen counting.
 *
 * ONLY MARKS THAT ARE DRAWN MAKE CLAIMS. `wedge`, `hash` and `wavy` describe a
 * SINGLE bond and `either` a double one, and chem-render's stereo pass skips
 * any other combination. An importer can hand you a wedge on a double bond —
 * `bondStereoFromCode` maps V2000 stereo code 1 without consulting the order —
 * and this module applies the identical `order === 1` filter, so it never
 * reads, nor complains about, a mark the reader cannot see.
 *
 * PARITY IS READ FROM THE DRAWING, never from a stored flag: the wedge and
 * hash marks on the bonds, with the narrow end at `from` as types.ts fixes it.
 * A bond whose `to` is the centre says nothing about that centre — it is the
 * wide end — which is the same test `revealsStereoHydrogen` in chem-render
 * already uses. The two must agree or the label and the descriptor would
 * disagree about which atom a backwards wedge belongs to.
 *
 * COST. Perception is a figure-scale operation, memoised LAZILY and PER ATOM
 * on the MOLECULE INSTANCE in a WeakMap, the way `adjacency()` is keyed. Lazy
 * because `structuralIssues` runs on every editor frame and only asks about
 * the ends of a wedge: a structure with no stereo marks must not pay for a
 * hierarchical-digraph walk per atom. It deliberately does NOT use the
 * topology-fingerprint cache in rings.ts and aromatic.ts — that fingerprint
 * excludes positions and `stereo` on purpose so a drag reuses the entry, and
 * both of those are inputs here, so a cached E/Z would survive the drag that
 * reversed it.
 */

import { requireElement } from "./elements.js";
import {
  bondsAt,
  getAtom,
  getBond,
  otherEnd,
  requireAtom,
  requireBond,
} from "./molecule.js";
import { isAromaticBond } from "./aromatic.js";
import { ringSize, ringsAtBond } from "./rings.js";
import type { AtomId, BondId, Bond, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

/**
 * Why a stereogenic unit has no letter.
 *
 * Every one of these is a different thing to tell a chemist, which is why they
 * are not collapsed into one "unknown":
 *
 *   `no-stereo-bond`      the unit IS stereogenic and the drawing simply does
 *                         not say which way — no wedge at the centre. Draw one.
 *   `unspecified`         the drawing says "deliberately unknown": a wavy bond
 *                         at the centre, or a crossed (`either`) double bond.
 *   `ambiguous-geometry`  the marks contradict each other or collapse — two
 *                         wedges and a hash on one centre, a substituent lying
 *                         exactly on the double-bond axis.
 *   `ranking-truncated`   the CIP comparison hit `MAX_SPHERES` or the node cap.
 *   `ranking-unsupported` the branches differ only by a criterion this module
 *                         does not rank (mass number, formal charge, or a
 *                         descriptor-based rule).
 */
export type UndeterminedReason =
  | "no-stereo-bond"
  | "unspecified"
  | "ambiguous-geometry"
  | "ranking-truncated"
  | "ranking-unsupported";

export type StereoDescriptor =
  | { readonly kind: "R" }
  | { readonly kind: "S" }
  | { readonly kind: "E" }
  | { readonly kind: "Z" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/**
 * `(R)`, `(S)`, `(E)`, `(Z)` — or undefined for an undetermined one.
 *
 * Undetermined deliberately renders as NOTHING rather than as "(?)": a
 * question mark beside a centre reads as a wavy bond, which is a different
 * chemical statement (this configuration is unknown) from "the software could
 * not work it out". The status bar is where the reason belongs.
 */
export function descriptorText(
  descriptor: StereoDescriptor | undefined,
): string | undefined {
  if (descriptor === undefined) return undefined;
  if (descriptor.kind === "undetermined") return undefined;
  return `(${descriptor.kind})`;
}

export type StructuralIssueKind =
  /** A wedge or hash whose narrow end is on an atom that is not stereogenic. */
  | "wedge-on-non-stereocenter"
  /** A wedge or hash drawn backwards: the WIDE end is the stereocentre. */
  | "wedge-drawn-backwards";

/**
 * A drawing problem that is not a valence problem.
 *
 * SAME SHAPE AS `ValenceIssue` on purpose, keyed on an ATOM: the canvas badge
 * in the editor renders from `atomCentre(issue.atomId)` and needs no change to
 * show one of these. `bondId` is the extra a bond-shaped finding wants, and it
 * is OMITTED rather than set to undefined — chem-core runs
 * `exactOptionalPropertyTypes`.
 *
 * It lives here rather than in `valenceIssues` because the check needs
 * `implicitHydrogenCount` to count substituents, and putting it in valence.ts
 * would make valence.ts import this module, which imports valence.ts.
 * Callers compose: `[...valenceIssues(m), ...structuralIssues(m)]`.
 */
export interface StructuralIssue {
  readonly atomId: AtomId;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly kind: StructuralIssueKind;
  readonly bondId?: BondId;
}

// ---------------------------------------------------------------------------
// The hierarchical digraph
// ---------------------------------------------------------------------------

/**
 * How many spheres out the comparison may look before giving up.
 *
 * A branch's digraph paths are SIMPLE paths through the molecule — a ring
 * closure terminates in a duplicate — so the depth a real molecule needs is
 * bounded by its longest chain, not by anything unbounded. Measured on the
 * corpus, sweeping this constant and counting truncations: at 10, which this
 * was, cholesterol truncates a centre and reports nine, vitamin D3 reports
 * twelve, and beta-carotene reports eight stereocentres where it has none. 16
 * clears every steroid; 24 is the first value that clears the whole corpus,
 * beta-carotene's 23-sphere polyene included. 64 is that with room to spare.
 *
 * Depth is NOT the number that governs work — `MAX_BRANCH_NODES` below is —
 * so buying the headroom costs nothing on a molecule that never needs it.
 */
const MAX_SPHERES = 64;

/**
 * How many digraph nodes one branch comparison may materialise.
 *
 * A ring system's hierarchical digraph grows with the number of distinct paths
 * rather than with the atom count, so a cap on depth alone is not a cap on
 * work. Exceeding this reports `ranking-truncated`, which is the honest
 * answer: the comparison did not finish.
 *
 * THIS, not the sphere depth, is the number that bounds the work, and it is
 * sized against measurement rather than intuition. Across cholesterol,
 * morphine, taxol, strychnine, sucrose, artemisinin, erythromycin, cortisol,
 * quinine, penicillin G and beta-carotene the largest single comparison
 * materialises 230 nodes, so 20000 leaves nearly two orders of magnitude of
 * headroom while still stopping a synthetic ring ladder — cost runs about a
 * microsecond per node — before it becomes a hang.
 */
const MAX_BRANCH_NODES = 20000;

/** Ordering outcomes. `2` means "cannot be decided", never "equal". */
const UNDECIDED = 2;
type Comparison = -1 | 0 | 1 | typeof UNDECIDED;

/**
 * Which ranking key a comparison context is running.
 *
 * It belongs to the CONTEXT rather than to the call because a context owns one
 * digraph and that digraph memoises a sorted child order per node — an order
 * that is only meaningful for the key it was produced under.
 */
type KeyKind = "rule1" | "extended";

interface BranchNode {
  /** Atomic number. 0 for the phantom that pads a short child list. */
  readonly z: number;
  /** Mass number where the atom pins one, else 0. Extended key only. */
  readonly mass: number;
  /** Formal charge. Extended key only. */
  readonly charge: number;
  /** A duplicate (phantom-substituted) node: it has no children of its own. */
  readonly duplicate: boolean;
  readonly atomId: AtomId | undefined;
  readonly parentBondId: BondId | undefined;
  /** Atoms already on the path from the stereo root, for ring closure. */
  readonly path: ReadonlySet<AtomId>;
  /** Spheres out from the branch root, which is itself sphere 0. */
  readonly depth: number;
  /** Lazily materialised and then reused; the tree is walked many times. */
  children: BranchNode[] | undefined;
  /**
   * `children` in descending priority, memoised.
   *
   * A node occupies exactly one place in the digraph, so the order of its
   * children is a property of the node alone and can be computed once. It has
   * to be: the sphere-by-sphere walk asks every node on a frontier for its
   * sorted children, and each of those sorts runs a full sub-comparison per
   * sibling pair. Without the memo the same subtree is re-ranked once per path
   * that reaches it. `"undecided"` is a cached failure, not an absent entry.
   */
  sorted: BranchNode[] | "undecided" | undefined;
}

interface BranchContext {
  readonly mol: Molecule;
  readonly keyKind: KeyKind;
  nodes: number;
  exhausted: boolean;
}

const PHANTOM: BranchNode = Object.freeze({
  z: 0,
  mass: 0,
  charge: 0,
  duplicate: true,
  atomId: undefined,
  parentBondId: undefined,
  path: new Set<AtomId>(),
  depth: 0,
  children: [],
  sorted: [],
});

function realNode(
  ctx: BranchContext,
  atomId: AtomId,
  parentBondId: BondId | undefined,
  path: ReadonlySet<AtomId>,
  depth: number,
): BranchNode {
  ctx.nodes++;
  if (ctx.nodes > MAX_BRANCH_NODES) ctx.exhausted = true;
  const atom = requireAtom(ctx.mol, atomId);
  return {
    z: requireElement(atom.element).z,
    mass: atom.isotope ?? 0,
    charge: atom.charge,
    duplicate: false,
    atomId,
    parentBondId,
    path,
    depth,
    children: undefined,
    sorted: undefined,
  };
}

/**
 * A duplicate of `atomId`: the same element, and no substituents at all.
 *
 * That absence is the whole content of the convention. A duplicate's implied
 * substituents are phantoms of atomic number 0, so a real carbon always
 * outranks a duplicate carbon one sphere later, and the ring closure that
 * emits one stops the walk without pretending the ring is a dead end.
 */
function duplicateNode(
  ctx: BranchContext,
  atomId: AtomId,
  depth: number,
): BranchNode {
  ctx.nodes++;
  if (ctx.nodes > MAX_BRANCH_NODES) ctx.exhausted = true;
  const atom = getAtom(ctx.mol, atomId);
  const z = atom === undefined ? 0 : requireElement(atom.element).z;
  return {
    z,
    mass: 0,
    charge: 0,
    duplicate: true,
    atomId: undefined,
    parentBondId: undefined,
    path: PHANTOM.path,
    depth,
    children: [],
    sorted: [],
  };
}

function hydrogenNode(ctx: BranchContext, depth: number): BranchNode {
  ctx.nodes++;
  if (ctx.nodes > MAX_BRANCH_NODES) ctx.exhausted = true;
  return {
    z: 1,
    mass: 0,
    charge: 0,
    duplicate: false,
    atomId: undefined,
    parentBondId: undefined,
    path: PHANTOM.path,
    depth,
    children: [],
    sorted: [],
  };
}

function childrenOf(ctx: BranchContext, node: BranchNode): BranchNode[] {
  if (node.children !== undefined) return node.children;
  const atomId = node.atomId;
  if (atomId === undefined) {
    node.children = [];
    return node.children;
  }

  const out: BranchNode[] = [];
  const nextPath = new Set(node.path);
  nextPath.add(atomId);
  const depth = node.depth + 1;

  for (const bond of bondsAt(ctx.mol, atomId)) {
    if (ctx.exhausted) break;
    const other = otherEnd(bond, atomId);
    // A multiple bond duplicates at BOTH ends, the parent end included: the
    // carbonyl carbon of an aldehyde has to see (O, O, H), not (O, H).
    const duplicates = bond.order - 1;
    if (bond.id === node.parentBondId) {
      for (let k = 0; k < duplicates; k++) {
        out.push(duplicateNode(ctx, other, depth));
      }
      continue;
    }
    if (node.path.has(other)) {
      // Ring closure: the atom is already on this path, so it enters as a
      // duplicate and the walk stops rather than circling forever.
      for (let k = 0; k <= duplicates; k++) {
        out.push(duplicateNode(ctx, other, depth));
      }
      continue;
    }
    out.push(realNode(ctx, other, bond.id, nextPath, depth));
    for (let k = 0; k < duplicates; k++) {
      out.push(duplicateNode(ctx, other, depth));
    }
  }

  const hydrogens = implicitHydrogenCount(ctx.mol, atomId);
  for (let k = 0; k < hydrogens; k++) out.push(hydrogenNode(ctx, depth));

  node.children = out;
  return out;
}

/**
 * A node's rank under the context's key.
 *
 * `rule1` is atomic number alone. `extended` also carries mass number and
 * formal charge — the criteria this module can DETECT but is not entitled to
 * ORDER. They are packed into one number rather than compared in sequence
 * because the caller only ever asks whether two of them are equal.
 */
function keyOf(ctx: BranchContext, node: BranchNode): number {
  if (ctx.keyKind === "rule1") return node.z;
  return node.z * 100000 + node.mass * 100 + (node.charge + 50);
}

/**
 * Ranks the subtree at `a` against the subtree at `b`, SPHERE BY SPHERE.
 *
 * The breadth is the correctness argument, not a style choice. CIP rule 1a
 * compares the whole of sphere n before anything in sphere n+1, so a
 * difference near the centre settles the pair and nothing further out gets a
 * vote. A depth-first walk — resolve the senior child to its leaves, then move
 * to the next — inverts that. In 1-bromo-3-fluoro-4-methylpentane the centre's
 * isopropyl branch beats its 2-bromoethyl branch at sphere 2, (C,C,H) against
 * (C,H,H); depth-first lets the bromine two spheres further out overturn it
 * and return the enantiomer's letter, confidently. Rings make it routine
 * rather than exotic: most stereocentres in a sugar or a terpene tie for
 * several spheres before they separate, so the deep atom nearly always got the
 * casting vote.
 *
 * The two frontiers stay index-aligned. Each pair of corresponding parents
 * pads its shorter child list with phantoms so the slots line up, which is
 * also how "fewer substituents" loses: a phantom's key is 0 and every real
 * atom's is at least 1.
 */
function compareBranches(
  ctx: BranchContext,
  a: BranchNode,
  b: BranchNode,
): Comparison {
  if (ctx.exhausted) return UNDECIDED;

  const rootA = keyOf(ctx, a);
  const rootB = keyOf(ctx, b);
  if (rootA !== rootB) return rootA > rootB ? 1 : -1;

  let frontierA: readonly BranchNode[] = [a];
  let frontierB: readonly BranchNode[] = [b];
  let depth = a.depth;

  while (frontierA.length > 0) {
    if (depth >= MAX_SPHERES) {
      // The cap has only actually bitten if something was left to look at.
      // Two frontiers of leaves are a finished comparison, not a truncated one.
      for (const node of frontierA) {
        if (childrenOf(ctx, node).length > 0) return UNDECIDED;
      }
      for (const node of frontierB) {
        if (childrenOf(ctx, node).length > 0) return UNDECIDED;
      }
      return 0;
    }

    const nextA: BranchNode[] = [];
    const nextB: BranchNode[] = [];
    for (let i = 0; i < frontierA.length; i++) {
      const childrenA = sortedChildren(ctx, frontierA[i]!);
      const childrenB = sortedChildren(ctx, frontierB[i] ?? PHANTOM);
      if (childrenA === undefined || childrenB === undefined) return UNDECIDED;
      const width = Math.max(childrenA.length, childrenB.length);
      for (let j = 0; j < width; j++) {
        nextA.push(childrenA[j] ?? PHANTOM);
        nextB.push(childrenB[j] ?? PHANTOM);
      }
    }
    if (ctx.exhausted) return UNDECIDED;

    for (let i = 0; i < nextA.length; i++) {
      const ka = keyOf(ctx, nextA[i]!);
      const kb = keyOf(ctx, nextB[i]!);
      if (ka !== kb) return ka > kb ? 1 : -1;
    }

    frontierA = nextA;
    frontierB = nextB;
    depth++;
  }
  return 0;
}

/**
 * A node's children in descending priority, or undefined when two of them
 * could not be ordered.
 *
 * The undefined case is conservative on purpose. Two siblings whose relative
 * order is undecided make the concatenated sphere sequence undecided too, and
 * a comparison run against a sequence that might be in the wrong order is
 * exactly the plausible-wrong-answer this module exists to refuse. Siblings
 * that compare EQUAL are not a problem: swapping two identical branches
 * cannot change the outcome.
 */
function sortedChildren(
  ctx: BranchContext,
  node: BranchNode,
): BranchNode[] | undefined {
  const cached = node.sorted;
  if (cached === "undecided") return undefined;
  if (cached !== undefined) return cached;

  const children = [...childrenOf(ctx, node)];
  if (ctx.exhausted) return undefined;
  let undecided = false;
  children.sort((x, y) => {
    const cmp = compareBranches(ctx, x, y);
    if (cmp === UNDECIDED) {
      undecided = true;
      return 0;
    }
    // Descending: the highest-priority branch first.
    return -cmp;
  });
  if (undecided) {
    node.sorted = "undecided";
    return undefined;
  }
  node.sorted = children;
  return children;
}

/** The result of ranking two substituent branches against each other. */
type BranchOrder =
  | { readonly kind: "ordered"; readonly aFirst: boolean }
  | { readonly kind: "identical" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

interface BranchRoot {
  readonly atomId: AtomId;
  readonly bondId: BondId;
}

/** One full comparison of two branches under one key, in a fresh digraph. */
function compareUnderKey(
  mol: Molecule,
  keyKind: KeyKind,
  centre: AtomId,
  a: BranchRoot,
  b: BranchRoot,
): Comparison {
  const root: ReadonlySet<AtomId> = new Set<AtomId>([centre]);
  const ctx: BranchContext = { mol, keyKind, nodes: 0, exhausted: false };
  const nodeA = realNode(ctx, a.atomId, a.bondId, root, 0);
  const nodeB = realNode(ctx, b.atomId, b.bondId, root, 0);
  return compareBranches(ctx, nodeA, nodeB);
}

/**
 * Ranks the branch reaching `a` against the branch reaching `b`, both seen
 * from `centre`.
 *
 * The two passes are the honesty mechanism. Pass one is rule 1 and produces a
 * letter. Pass two runs the identical walk on a key that also carries mass
 * number and formal charge, and its ONLY job is to notice that two branches
 * tying under rule 1 are nevertheless different — at which point the answer is
 * `ranking-unsupported`, not "identical".
 */
function rankBranches(
  mol: Molecule,
  centre: AtomId,
  a: BranchRoot,
  b: BranchRoot,
): BranchOrder {
  const first = compareUnderKey(mol, "rule1", centre, a, b);
  if (first === UNDECIDED) {
    return { kind: "undetermined", reason: "ranking-truncated" };
  }
  if (first !== 0) return { kind: "ordered", aFirst: first > 0 };

  const second = compareUnderKey(mol, "extended", centre, a, b);
  if (second === UNDECIDED) {
    return { kind: "undetermined", reason: "ranking-truncated" };
  }
  if (second !== 0) return { kind: "undetermined", reason: "ranking-unsupported" };
  return { kind: "identical" };
}

/**
 * The outcome of ranking two substituent branches seen from one centre.
 * Exported for stereo-config.ts, which ranks a phantom lone pair and treats an
 * explicit protium atom as an implicit hydrogen before it gets here.
 */
export type LigandPairOrder = BranchOrder;

/**
 * `rankBranches`, exported unchanged: rule 1, then the extended key whose only
 * job is to turn a false "identical" into `ranking-unsupported`. Both branch
 * roots must be real atoms bonded to `centre`.
 */
export function rankLigandPair(
  mol: Molecule,
  centre: AtomId,
  a: { readonly atomId: AtomId; readonly bondId: BondId },
  b: { readonly atomId: AtomId; readonly bondId: BondId },
): LigandPairOrder {
  return rankBranches(mol, centre, a, b);
}

// ---------------------------------------------------------------------------
// Tetrahedral centres
// ---------------------------------------------------------------------------

/** One substituent of a tetrahedral centre, drawn or implicit. */
interface Substituent {
  /** undefined for the implicit hydrogen, which is not an atom in the graph. */
  readonly atomId: AtomId | undefined;
  readonly bondId: BondId | undefined;
  /** +1 toward the reader, -1 away, 0 in the plane of the page. */
  readonly outOfPlane: number;
}

/**
 * The four sigma substituents of `atomId`, or undefined if it does not have
 * exactly four.
 *
 * A multiple bond disqualifies the atom outright rather than being counted as
 * one substituent: an sp2 carbon is not a tetrahedral centre, and letting one
 * through here would hand the parity reader three coplanar neighbours and a
 * phantom fourth.
 */
function tetrahedralSubstituents(
  mol: Molecule,
  atomId: AtomId,
): Substituent[] | undefined {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return undefined;

  const out: Substituent[] = [];
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.order !== 1) return undefined;
    out.push({
      atomId: otherEnd(bond, atomId),
      bondId: bond.id,
      outOfPlane: outOfPlaneAt(bond, atomId),
    });
  }

  const hydrogens = implicitHydrogenCount(mol, atomId);
  for (let k = 0; k < hydrogens; k++) {
    out.push({ atomId: undefined, bondId: undefined, outOfPlane: 0 });
  }

  return out.length === 4 ? out : undefined;
}

/**
 * What `bond` says about the atom at its NARROW end.
 *
 * Narrow end at `from`, as types.ts fixes it, so a bond arriving at `atomId`
 * as its `to` contributes nothing: that atom is the substituent being pointed
 * at and learns nothing about its own configuration. `revealsStereoHydrogen`
 * in chem-render applies the identical test, and the two have to agree.
 */
function outOfPlaneAt(bond: Bond, atomId: AtomId): number {
  if (bond.from !== atomId) return 0;
  if (bond.stereo === "wedge") return 1;
  if (bond.stereo === "hash") return -1;
  return 0;
}

/**
 * True when a wavy bond starts at this atom: configuration declined.
 *
 * SINGLE BONDS ONLY, matching what chem-render actually draws. `wavy` is a
 * single-bond mark (types.ts), and the scene builder skips it on a double or
 * triple bond — so honouring one there would let an invisible mark overrule a
 * geometry the reader CAN see.
 */
function hasWavyAt(mol: Molecule, atomId: AtomId): boolean {
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.order !== 1) continue;
    if (bond.from === atomId && bond.stereo === "wavy") return true;
  }
  return false;
}

/**
 * Sorts the four substituents into CIP priority order, highest first.
 *
 * Every one of the six pairs is compared, rather than handing a comparator to
 * `Array.sort`: a pair that comes back `identical` means the atom is NOT
 * stereogenic and a pair that comes back undetermined means no letter may be
 * issued, and both of those are answers about the atom rather than about the
 * sort.
 */
type PriorityResult =
  | { readonly kind: "ranked"; readonly order: readonly Substituent[] }
  | { readonly kind: "not-stereogenic" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

function prioritise(
  mol: Molecule,
  centre: AtomId,
  substituents: readonly Substituent[],
): PriorityResult {
  const score = new Map<number, number>();
  for (let i = 0; i < substituents.length; i++) score.set(i, 0);

  for (let i = 0; i < substituents.length; i++) {
    for (let j = i + 1; j < substituents.length; j++) {
      const a = substituents[i]!;
      const b = substituents[j]!;
      const order = compareSubstituents(mol, centre, a, b);
      if (order.kind === "identical") return { kind: "not-stereogenic" };
      if (order.kind === "undetermined") {
        return { kind: "undetermined", reason: order.reason };
      }
      const winner = order.aFirst ? i : j;
      score.set(winner, (score.get(winner) ?? 0) + 1);
    }
  }

  const indices = [...substituents.keys()].sort(
    (x, y) => (score.get(y) ?? 0) - (score.get(x) ?? 0),
  );
  return { kind: "ranked", order: indices.map((i) => substituents[i]!) };
}

function compareSubstituents(
  mol: Molecule,
  centre: AtomId,
  a: Substituent,
  b: Substituent,
): BranchOrder {
  // The implicit hydrogen is always the lowest-priority substituent an atom
  // can carry, and two of them are identical. Neither needs the digraph.
  if (a.atomId === undefined && b.atomId === undefined) return { kind: "identical" };
  if (a.atomId === undefined) return { kind: "ordered", aFirst: false };
  if (b.atomId === undefined) return { kind: "ordered", aFirst: true };
  return rankBranches(
    mol,
    centre,
    { atomId: a.atomId, bondId: a.bondId! },
    { atomId: b.atomId, bondId: b.bondId! },
  );
}

/**
 * Below this the signed volume of the four substituents carries no sign worth
 * reading: the drawing is flat, or its wedges cancel.
 *
 * In units of (bond length)^3, so it is scale-relative to the drawing rather
 * than to a pixel size — chem-core has no idea what a pixel is.
 */
const CHIRAL_VOLUME_EPSILON = 1e-6;

/**
 * The out-of-plane distance a wedge is read as, in bond lengths.
 *
 * Any positive number gives the same SIGN, which is the only thing read off
 * the volume, so the value is a readability choice rather than a calibration.
 */
const OUT_OF_PLANE_UNIT = 0.8;

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where a substituent sits in the reader's three dimensions.
 *
 * The implicit hydrogen has no position in the graph, so it is placed at the
 * centre in x and y and given whatever z the drawn marks leave for it — the
 * standard reading of a CH stereocentre, where the wedge to one substituent
 * puts the unlabelled hydrogen behind the page.
 */
function substituentPoint(
  mol: Molecule,
  centre: AtomId,
  s: Substituent,
  implicitZ: number,
): Point3 | undefined {
  const origin = requireAtom(mol, centre).pos;
  if (s.atomId === undefined) {
    return { x: origin.x, y: origin.y, z: implicitZ * OUT_OF_PLANE_UNIT };
  }
  const atom = getAtom(mol, s.atomId);
  if (atom === undefined) return undefined;
  return { x: atom.pos.x, y: atom.pos.y, z: s.outOfPlane * OUT_OF_PLANE_UNIT };
}

/**
 * R or S from the ranked substituents and the drawn marks.
 *
 * The volume `(p1 - p4) . [(p2 - p4) x (p3 - p4)]` is NEGATIVE for R in
 * chem-core's coordinate frame, which is right-handed: x to the right, y UP
 * (chem-core is y-up; only the SVG renderer flips), and z out of the page
 * toward the reader, which is where a wedge points. With the lowest-priority
 * substituent pointing away, 1 -> 2 -> 3 clockwise on the page is R, and that
 * arrangement makes the triple product negative. Getting the sign backwards
 * here is the one error that renders perfectly, so it is pinned by a test on
 * a hand-drawn bromochlorofluoromethane.
 */
function chiralityFrom(
  mol: Molecule,
  centre: AtomId,
  ranked: readonly Substituent[],
): StereoDescriptor {
  let drawnSum = 0;
  let marks = 0;
  for (const s of ranked) {
    if (s.atomId === undefined) continue;
    drawnSum += s.outOfPlane;
    if (s.outOfPlane !== 0) marks++;
  }
  if (marks === 0) return { kind: "undetermined", reason: "no-stereo-bond" };

  const hasImplicit = ranked.some((s) => s.atomId === undefined);
  // The unlabelled hydrogen goes opposite whatever the drawn marks say. When
  // they cancel — a wedge and a hash on the same centre — there is nothing
  // left for it to be opposite to, and the picture is contradictory rather
  // than merely silent.
  const implicitZ = drawnSum > 0 ? -1 : drawnSum < 0 ? 1 : 0;
  if (hasImplicit && implicitZ === 0) {
    return { kind: "undetermined", reason: "ambiguous-geometry" };
  }

  const points: Point3[] = [];
  for (const s of ranked) {
    const p = substituentPoint(mol, centre, s, implicitZ);
    if (p === undefined) return { kind: "undetermined", reason: "ambiguous-geometry" };
    points.push(p);
  }

  const [p1, p2, p3, p4] = points as [Point3, Point3, Point3, Point3];
  const ax = p1.x - p4.x;
  const ay = p1.y - p4.y;
  const az = p1.z - p4.z;
  const bx = p2.x - p4.x;
  const by = p2.y - p4.y;
  const bz = p2.z - p4.z;
  const cx = p3.x - p4.x;
  const cy = p3.y - p4.y;
  const cz = p3.z - p4.z;
  const volume =
    ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);

  if (Math.abs(volume) < CHIRAL_VOLUME_EPSILON) {
    return { kind: "undetermined", reason: "ambiguous-geometry" };
  }
  return volume < 0 ? { kind: "R" } : { kind: "S" };
}

/**
 * `atomId`'s configuration, or undefined when the atom is not a tetrahedral
 * stereocentre at all.
 *
 * THREE OUTCOMES, NOT TWO, and the distinction is the point of the module:
 *
 *   `undefined`      proven not stereogenic — fewer or more than four sigma
 *                    substituents, or two of them proven identical.
 *   `undetermined`   stereogenic (or possibly so) but no letter is warranted.
 *   `R` / `S`        proven.
 */
export function cipDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  return atomDescriptor(mol, atomId);
}

function computeCipDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  const substituents = tetrahedralSubstituents(mol, atomId);
  if (substituents === undefined) return undefined;

  const priority = prioritise(mol, atomId, substituents);
  if (priority.kind === "not-stereogenic") return undefined;
  if (priority.kind === "undetermined") {
    return { kind: "undetermined", reason: priority.reason };
  }

  // A wavy bond at the centre is the drawing declining to state a
  // configuration, and it outranks whatever wedges sit beside it: a centre
  // carrying both is at best contradictory, and "unspecified" is what the
  // author actually wrote.
  if (hasWavyAt(mol, atomId)) {
    return { kind: "undetermined", reason: "unspecified" };
  }

  return chiralityFrom(mol, atomId, priority.order);
}

/**
 * Every atom that is a tetrahedral stereocentre, in `mol.atomIds` order.
 *
 * INCLUDES the centres whose descriptor is undetermined — an unresolved
 * ranking and an undrawn wedge both leave a real stereocentre on the page, and
 * dropping them here is precisely how a wedge drawn on a genuine centre would
 * get reported as a drawing error. EXCLUDES an atom proven to carry two
 * identical substituents, which is not a stereocentre however it is drawn.
 */
export function stereocenterAtoms(mol: Molecule): readonly AtomId[] {
  const perception = perceptionOf(mol);
  if (!perception.atomsComplete) {
    for (const atomId of mol.atomIds) atomDescriptor(mol, atomId);
    perception.atomsComplete = true;
  }
  return mol.atomIds.filter((atomId) => perception.atoms.get(atomId) !== undefined);
}

export function isStereocenter(mol: Molecule, atomId: AtomId): boolean {
  return cipDescriptor(mol, atomId) !== undefined;
}

// ---------------------------------------------------------------------------
// Double bonds
// ---------------------------------------------------------------------------

/**
 * The largest ring a double bond may sit in and still be excluded from E/Z.
 *
 * A cyclohexene's double bond is cis because the ring holds it that way, and
 * assigning it Z states as a discovery what the drawing already forced. Eight
 * is where trans-cyclooctene becomes isolable and the descriptor starts
 * carrying information again.
 */
const SMALL_RING_LIMIT = 7;

interface DoubleBondEnd {
  readonly atomId: AtomId;
  /** The substituents other than the double-bond partner. */
  readonly branches: readonly { readonly atomId: AtomId; readonly bondId: BondId }[];
  readonly implicitHydrogens: number;
}

function doubleBondEnd(
  mol: Molecule,
  atomId: AtomId,
  doubleBondId: BondId,
): DoubleBondEnd | undefined {
  const branches: { atomId: AtomId; bondId: BondId }[] = [];
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.id === doubleBondId) continue;
    // A second multiple bond at this end is a cumulene or an sp centre.
    // Allenes have their own axial stereochemistry and are out of scope.
    if (bond.order !== 1) return undefined;
    branches.push({ atomId: otherEnd(bond, atomId), bondId: bond.id });
  }
  const implicitHydrogens = implicitHydrogenCount(mol, atomId);
  if (branches.length + implicitHydrogens !== 2) return undefined;
  return { atomId, branches, implicitHydrogens };
}

/**
 * The substituent at this end that outranks the other, or why there is none.
 *
 * Two implicit hydrogens, or two branches proven identical, mean the end is
 * not stereogenic — a terminal `=CH2` cannot be E or Z. One branch against one
 * implicit hydrogen never needs the digraph: hydrogen loses to everything.
 */
type EndChoice =
  | { readonly kind: "chosen"; readonly atomId: AtomId }
  | { readonly kind: "not-stereogenic" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

function chooseAtEnd(mol: Molecule, end: DoubleBondEnd): EndChoice {
  if (end.branches.length === 0) return { kind: "not-stereogenic" };
  if (end.branches.length === 1) {
    return { kind: "chosen", atomId: end.branches[0]!.atomId };
  }
  const [a, b] = end.branches as [
    { atomId: AtomId; bondId: BondId },
    { atomId: AtomId; bondId: BondId },
  ];
  const order = rankBranches(mol, end.atomId, a, b);
  if (order.kind === "identical") return { kind: "not-stereogenic" };
  if (order.kind === "undetermined") {
    return { kind: "undetermined", reason: order.reason };
  }
  return { kind: "chosen", atomId: order.aFirst ? a.atomId : b.atomId };
}

/**
 * Whether `bondId` is a double bond whose geometry is a real choice.
 *
 * THREE EXCLUSIONS THAT ARE EASY TO MISS, and every one of them would
 * otherwise produce a confident letter from coordinates that mean nothing:
 *
 *   AROMATIC. Kekule is the storage form, so every benzene ring bond is a
 *   genuine order-2 bond in the model. Perceived aromaticity is what tells
 *   them apart from an alkene.
 *
 *   IN A SMALL RING. A cyclohexene is cis because the ring says so.
 *
 *   NOT TRISUBSTITUTED AT BOTH ENDS. A terminal methylene, or an end whose two
 *   substituents rank equal, has no geometry to state.
 */
function computeIsStereogenicBond(mol: Molecule, bondId: BondId): boolean {
  const bond = getBond(mol, bondId);
  if (bond === undefined || bond.order !== 2) return false;
  if (isAromaticBond(mol, bondId)) return false;
  for (const ringIndex of ringsAtBond(mol, bondId)) {
    if (ringSize(mol, ringIndex) <= SMALL_RING_LIMIT) return false;
  }
  const endA = doubleBondEnd(mol, bond.from, bondId);
  const endB = doubleBondEnd(mol, bond.to, bondId);
  if (endA === undefined || endB === undefined) return false;
  const choiceA = chooseAtEnd(mol, endA);
  const choiceB = chooseAtEnd(mol, endB);
  return choiceA.kind !== "not-stereogenic" && choiceB.kind !== "not-stereogenic";
}

/** Every double bond with a real cis/trans choice, in `mol.bondIds` order. */
export function stereogenicBonds(mol: Molecule): readonly BondId[] {
  const perception = perceptionOf(mol);
  if (!perception.bondsComplete) {
    for (const bondId of mol.bondIds) bondDescriptor(mol, bondId);
    perception.bondsComplete = true;
  }
  return mol.bondIds.filter((bondId) => perception.bonds.get(bondId) !== undefined);
}

/**
 * `bondId`'s E/Z, or undefined when the bond has no geometry to state.
 *
 * Read from the COORDINATES, which is the only place the geometry is: the
 * model stores no cis/trans flag, and it should not — a drawing that says one
 * thing and a flag that says another is a document that cannot be trusted.
 */
export function doubleBondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  return bondDescriptor(mol, bondId);
}

function computeDoubleBondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  if (!computeIsStereogenicBond(mol, bondId)) return undefined;
  const bond = requireBond(mol, bondId);

  // The crossed double bond IS the statement "geometry unknown", and a wavy
  // single bond at either terminus says the same thing about the same double
  // bond. Reading the coordinates through either of them would overrule an
  // author who deliberately declined to commit.
  if (bond.stereo === "either") return { kind: "undetermined", reason: "unspecified" };
  if (hasWavyAt(mol, bond.from) || hasWavyAt(mol, bond.to)) {
    return { kind: "undetermined", reason: "unspecified" };
  }

  const endA = doubleBondEnd(mol, bond.from, bondId);
  const endB = doubleBondEnd(mol, bond.to, bondId);
  if (endA === undefined || endB === undefined) return undefined;
  const choiceA = chooseAtEnd(mol, endA);
  const choiceB = chooseAtEnd(mol, endB);
  if (choiceA.kind === "not-stereogenic" || choiceB.kind === "not-stereogenic") {
    return undefined;
  }
  if (choiceA.kind === "undetermined") {
    return { kind: "undetermined", reason: choiceA.reason };
  }
  if (choiceB.kind === "undetermined") {
    return { kind: "undetermined", reason: choiceB.reason };
  }

  const from = requireAtom(mol, bond.from).pos;
  const to = requireAtom(mol, bond.to).pos;
  const axisX = to.x - from.x;
  const axisY = to.y - from.y;

  const subA = getAtom(mol, choiceA.atomId);
  const subB = getAtom(mol, choiceB.atomId);
  if (subA === undefined || subB === undefined) return undefined;

  // Which side of the axis each chosen substituent falls on. Same side is cis,
  // and cis of the two SENIOR substituents is what Z means.
  const sideA = axisX * (subA.pos.y - from.y) - axisY * (subA.pos.x - from.x);
  const sideB = axisX * (subB.pos.y - to.y) - axisY * (subB.pos.x - to.x);

  // Scale-relative: the cross product grows with both bond lengths, so a bare
  // absolute floor would call a small drawing ambiguous and a large one clear.
  const axisLength = Math.sqrt(axisX * axisX + axisY * axisY);
  const floor = 1e-6 * axisLength;
  if (Math.abs(sideA) < floor || Math.abs(sideB) < floor) {
    return { kind: "undetermined", reason: "ambiguous-geometry" };
  }

  return sideA * sideB > 0 ? { kind: "Z" } : { kind: "E" };
}

// ---------------------------------------------------------------------------
// Structural issues
// ---------------------------------------------------------------------------

/**
 * Drawing errors stereochemistry can see, keyed on the atom to badge.
 *
 * REPORTED AND NEVER REPAIRED, the same rule the collision pass and
 * `valenceIssues` follow: stripping a wedge the author drew loses information,
 * and the author can see the badge.
 *
 * The narrow end is what is checked, because that is where a wedge's claim
 * lands. A wedge whose WIDE end turns out to be the stereocentre is the
 * commonest form of the error and gets its own message: the fix is to flip the
 * bond, not to delete it.
 */
export function structuralIssues(mol: Molecule): readonly StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const bondId of mol.bondIds) {
    const bond = getBond(mol, bondId);
    if (bond === undefined) continue;
    if (bond.stereo !== "wedge" && bond.stereo !== "hash") continue;
    // SINGLE BONDS ONLY, the same filter chem-render's stereo pass applies.
    // `bondStereoFromCode` maps V2000 stereo code 1 to `wedge` whatever the
    // bond order is, so an imported file can carry a wedge on a double bond —
    // and the scene builder deliberately draws that as an ordinary double.
    // Badging it would put a warning on the canvas about a mark that is not on
    // the canvas, which no edit to the drawing can clear.
    if (bond.order !== 1) continue;
    // Only the atoms a wedge actually touches are tested, so a structure with
    // no stereo marks costs one pass over the bond list and no CIP work at all.
    if (isStereocenter(mol, bond.from)) continue;

    const backwards = isStereocenter(mol, bond.to);
    issues.push({
      atomId: backwards ? bond.to : bond.from,
      severity: "warning",
      kind: backwards ? "wedge-drawn-backwards" : "wedge-on-non-stereocenter",
      bondId,
      message: backwards
        ? `the ${bond.stereo} bond points the wrong way: its narrow end must be ` +
          `at the stereocentre, which is the other atom`
        : `a ${bond.stereo} bond starts at an atom that is not a stereocentre, ` +
          `so it makes no claim a reader can use`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Memoisation
// ---------------------------------------------------------------------------

/**
 * Per-molecule perception, filled IN LAZILY.
 *
 * Laziness is not a micro-optimisation here. `structuralIssues` runs on every
 * editor frame and only ever asks about the two ends of a wedge, so a
 * structure with no stereo marks must cost one pass over the bond list and no
 * CIP work at all — a 300-atom drag cannot afford four hierarchical-digraph
 * walks per atom. `stereocenterAtoms` and `stereogenicBonds` are the callers
 * that genuinely want the whole answer, and they force it.
 *
 * `undefined` is a real, cached result ("not stereogenic"), so the maps are
 * probed with `has` rather than by testing the value.
 */
interface StereoPerception {
  readonly atoms: Map<AtomId, StereoDescriptor | undefined>;
  readonly bonds: Map<BondId, StereoDescriptor | undefined>;
  atomsComplete: boolean;
  bondsComplete: boolean;
}

/**
 * Keyed on the MOLECULE INSTANCE, the way `adjacency()` is, and deliberately
 * NOT on the topology fingerprint rings.ts and aromatic.ts share. That
 * fingerprint excludes positions and `bond.stereo` so a drag can reuse the
 * entry — which is exactly right for ring perception and exactly wrong here,
 * where both are inputs: a cached E/Z would survive the drag that reversed it.
 * Every edit mints a new Molecule, so instance identity is a sound key.
 */
const CACHE = new WeakMap<Molecule, StereoPerception>();

function perceptionOf(mol: Molecule): StereoPerception {
  const cached = CACHE.get(mol);
  if (cached !== undefined) return cached;
  const fresh: StereoPerception = {
    atoms: new Map(),
    bonds: new Map(),
    atomsComplete: false,
    bondsComplete: false,
  };
  CACHE.set(mol, fresh);
  return fresh;
}

function atomDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  const perception = perceptionOf(mol);
  if (perception.atoms.has(atomId)) return perception.atoms.get(atomId);
  const descriptor = computeCipDescriptor(mol, atomId);
  perception.atoms.set(atomId, descriptor);
  return descriptor;
}

function bondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  const perception = perceptionOf(mol);
  if (perception.bonds.has(bondId)) return perception.bonds.get(bondId);
  const descriptor = computeDoubleBondDescriptor(mol, bondId);
  perception.bonds.set(bondId, descriptor);
  return descriptor;
}
