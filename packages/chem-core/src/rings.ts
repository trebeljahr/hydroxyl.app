/**
 * Ring perception.
 *
 * WHICH RINGS. This computes RDKit's *symmetrised* SSSR, not plain SSSR.
 * Plain SSSR is ambiguous for cage systems: cubane has six chemically real
 * faces but a circuit rank of five, so a plain SSSR arbitrarily discards one
 * face — and which one it discards depends on atom ordering, so the same
 * molecule rebuilt in a different order draws differently. Symmetrisation
 * adds back every smallest cycle that is not expressible as a combination of
 * rings STRICTLY SMALLER than itself. `rings(mol).length` may therefore
 * exceed `ringCount(mol)` (the circuit rank) for cages, and that is the
 * intended answer, not a defect: cubane gives 6 rings against a rank of 5,
 * adamantane 4 against 3, bicyclo[2.2.2]octane 3 against 2.
 *
 * ALGORITHM. For every non-bridge bond, enumerate the smallest cycles through
 * it (BFS in the graph with that bond removed, keeping every shortest-path
 * predecessor so symmetry-equivalent ties all surface), plus Horton's set for
 * any component small enough to afford it. Select from the candidates with
 * GF(2) elimination over bond sets. This is polynomial in every case;
 * enumerating all simple cycles with a DFS is exponential and hangs on a fused
 * polycyclic like coronene or a fullerene fragment.
 *
 * Candidates are deduplicated by bond set as they are generated, not after.
 * Every bond of one N-membered ring finds that same ring, so materialising a
 * candidate per bond costs Theta(N^2) memory — a 20k-membered macrocycle
 * exhausted the heap and killed the process. A component that is a single
 * cycle skips the per-bond search entirely and is traced once.
 *
 * The "strictly smaller" test is what makes both hard cases come out right at
 * once: naphthalene's 10-membered perimeter is the sum of two smaller 6-rings
 * and is rejected, while cubane's sixth face has nothing smaller than 4 to be
 * built from and is kept. A size cap rejects the perimeter too but also
 * throws away prismane's third square; a same-size-inclusive independence
 * test keeps the square but loses cubane's sixth face.
 *
 * CACHING. See `ringPerception` — the cache is keyed on topology, not on the
 * molecule instance, because dragging an atom produces a fresh `Molecule` per
 * pointer-move in which only a position changed.
 */

import { adjacency, requireAtom, requireBond } from "./molecule.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import type { Vec2 } from "./vec.js";

/**
 * One perceived ring, as an ordered closed walk.
 *
 * `atomIds` is a genuine walk: consecutive ids are bonded, and the last is
 * bonded back to the first. `bondIds[i]` joins `atomIds[i]` and
 * `atomIds[(i + 1) % size]`. The renderer walks this perimeter to place the
 * inner line of a ring double bond, so the walk invariant is load-bearing.
 *
 * The start atom and the walk direction are canonical, so a rotation or a
 * mirror of the same ring always comes back as the same array.
 */
export interface Ring {
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  readonly size: number;
}

/**
 * Ring indices into `rings(mol)`, per atom and per bond. Every id in the
 * molecule has an entry — empty for atoms and bonds in no ring — so a caller
 * never has to distinguish "in no ring" from "unknown id".
 */
export interface RingMembership {
  readonly atoms: Readonly<Record<AtomId, readonly number[]>>;
  readonly bonds: Readonly<Record<BondId, readonly number[]>>;
}

export interface RingPerception {
  readonly rings: readonly Ring[];
  readonly membership: RingMembership;
}

// ---------------------------------------------------------------------------
// Bounded cache
// ---------------------------------------------------------------------------

/**
 * A small string-keyed LRU.
 *
 * Exported only so `aromatic.ts` can share the implementation; it is not part
 * of the chemistry API.
 *
 * Bounded rather than a plain Map because the keys are topology fingerprints:
 * an unbounded map retains every topology the process has ever seen, each
 * entry holding its atom-id strings alive, so a long editing session is a
 * monotonic leak.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Re-insert to refresh recency: a Map iterates in insertion order, which
    // is what makes the oldest key the first one evicted. Without this, the
    // entry a long drag is actively using can be evicted out from under it.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      const oldest: string | undefined = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Fingerprint field separator. NUL cannot occur in an id, so the encoding
 *  stays injective even if an importer starts minting ids from an external
 *  source; a comma only happens to work for today's `a1`/`b2` ids. */
const SEP = "\u0000";

/** Bumped if the fingerprint contents ever change, so an entry cached under
 *  the old shape can never be mistaken for a match. */
const RING_FINGERPRINT_VERSION = "R1";

/**
 * Identifies the ring topology: atom ids in order, and bond ids with their
 * endpoints. Nothing else.
 *
 * Positions are excluded because that is the entire point — a drag changes
 * them on every frame without changing a single ring. Bond orders are
 * excluded too, which has a useful consequence: `kekulize(mol)` alters only
 * orders and flags, so it produces the identical fingerprint and reuses this
 * cache entry, and ring indices line up between the two molecules for free.
 */
function ringFingerprint(mol: Molecule): string {
  // One parts array and one join. A per-bond template literal would allocate
  // a string per bond for the same information, and this runs on the drag
  // path.
  const parts: string[] = [RING_FINGERPRINT_VERSION];
  for (const id of mol.atomIds) parts.push(id);
  // Section marker, so an id cannot migrate from the atom section into the
  // bond section and collide with a different topology.
  parts.push("|");
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id];
    if (!bond) continue; // unreachable; keeps the loop total
    parts.push(id, bond.from, bond.to);
  }
  return parts.join(SEP);
}

const RING_BY_INSTANCE = new WeakMap<Molecule, RingPerception>();
const RING_BY_TOPOLOGY = new LruCache<RingPerception>(32);
let ringComputations = 0;

/**
 * Perceived rings and membership, memoised.
 *
 * Two levels, and the ordering is the whole design. The instance `WeakMap`
 * is the hot path: the renderer asks for rings, then membership, then
 * centroids within one frame, and none of those should rebuild the
 * fingerprint string. The topology cache behind it is what makes a drag free:
 * dragging produces a fresh `Molecule` per pointer-move in which only one
 * atom's `pos` changed, so an instance-keyed cache alone — which is what
 * `adjacency()` in molecule.ts does — misses on every single frame of exactly
 * the interaction that needs it most.
 *
 * The `WeakMap` is deliberately unbounded: it is self-cleaning, since a
 * discarded undo frame's `Molecule` becomes unreachable and takes its entry
 * with it.
 */
export function ringPerception(mol: Molecule): RingPerception {
  const hit = RING_BY_INSTANCE.get(mol);
  if (hit) return hit;

  const key = ringFingerprint(mol);
  const shared = RING_BY_TOPOLOGY.get(key);
  if (shared) {
    // Promote, so the next query on this instance skips the fingerprint too.
    RING_BY_INSTANCE.set(mol, shared);
    return shared;
  }

  // Incremented here and nowhere else. Counting a cache hit as a computation
  // would make the drag test pass even with the topology layer deleted.
  ringComputations++;
  const built = computeRingPerception(mol);
  RING_BY_TOPOLOGY.set(key, built);
  RING_BY_INSTANCE.set(mol, built);
  return built;
}

/** Testing hook: how many times the ring search has actually run. A cache hit
 *  does not increment it. */
export function ringPerceptionComputationCount(): number {
  return ringComputations;
}

/** Testing hook. The counter is process-global because vitest shares a module
 *  registry across a file, so each assertion resets first. */
export function resetRingPerceptionComputationCount(): void {
  ringComputations = 0;
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export function rings(mol: Molecule): readonly Ring[] {
  return ringPerception(mol).rings;
}

export function ringMembership(mol: Molecule): RingMembership {
  return ringPerception(mol).membership;
}

export function ringsAtAtom(mol: Molecule, atomId: AtomId): readonly number[] {
  requireAtom(mol, atomId);
  return ringMembership(mol).atoms[atomId] ?? EMPTY_INDICES;
}

export function ringsAtBond(mol: Molecule, bondId: BondId): readonly number[] {
  requireBond(mol, bondId);
  return ringMembership(mol).bonds[bondId] ?? EMPTY_INDICES;
}

export function isRingAtom(mol: Molecule, atomId: AtomId): boolean {
  return ringsAtAtom(mol, atomId).length > 0;
}

/**
 * Whether the bond lies on any ring.
 *
 * Exact, with no separate bridge test at query time: the candidate set holds
 * the smallest cycle through every non-bridge bond, and if that cycle was
 * dropped it was the sum of strictly smaller accepted rings — in which case
 * the bond appears in an odd number of them, so it is still in at least one.
 */
export function isRingBond(mol: Molecule, bondId: BondId): boolean {
  return ringsAtBond(mol, bondId).length > 0;
}

/**
 * Shared by two or more rings.
 *
 * A property of the BOND's membership list and nothing else. "Both endpoints
 * are in two or more rings" is a different and wrong test: a spiro junction
 * has exactly that shape while its bonds each belong to one ring, and a
 * renderer keying inner double-bond placement on shared atoms mis-draws the
 * junction.
 */
export function isFusionBond(mol: Molecule, bondId: BondId): boolean {
  return ringsAtBond(mol, bondId).length >= 2;
}

/** In two or more rings, with no incident bond shared between them. */
export function isSpiroAtom(mol: Molecule, atomId: AtomId): boolean {
  if (ringsAtAtom(mol, atomId).length < 2) return false;
  for (const bondId of adjacency(mol).bondsAt[atomId] ?? []) {
    if (isFusionBond(mol, bondId)) return false;
  }
  return true;
}

/** Throws on an out-of-range index: ring indices come from `ringMembership`,
 *  so a bad one is a caller bug — same contract as `requireAtom`. */
export function ringAt(mol: Molecule, ringIndex: number): Ring {
  const all = rings(mol);
  const ring = all[ringIndex];
  if (!ring) {
    throw new Error(
      `No such ring: ${ringIndex} (molecule has ${all.length} rings)`,
    );
  }
  return ring;
}

export function ringSize(mol: Molecule, ringIndex: number): number {
  return ringAt(mol, ringIndex).size;
}

export function ringAtomIds(
  mol: Molecule,
  ringIndex: number,
): readonly AtomId[] {
  return ringAt(mol, ringIndex).atomIds;
}

export function ringBondIds(
  mol: Molecule,
  ringIndex: number,
): readonly BondId[] {
  return ringAt(mol, ringIndex).bondIds;
}

/**
 * Mean position of the ring's atoms, y-up.
 *
 * Read live from the molecule on every call, and deliberately NOT stored in
 * `RingPerception`. That object is cached against a fingerprint which is
 * blind to position by construction, so a centroid held inside it would be
 * stale for the entire duration of a drag — the one interaction it exists to
 * serve.
 */
export function ringCentroid(mol: Molecule, ringIndex: number): Vec2 {
  const ring = ringAt(mol, ringIndex);
  let x = 0;
  let y = 0;
  for (const id of ring.atomIds) {
    const pos = requireAtom(mol, id).pos;
    x += pos.x;
    y += pos.y;
  }
  return { x: x / ring.size, y: y / ring.size };
}

const EMPTY_INDICES: readonly number[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Integer graph
//
// Everything below works on dense integer indices derived from `atomIds` and
// `bondIds`. That is what makes the GF(2) vectors plain bitsets and what
// makes every tie-break deterministic: insertion order is the only intrinsic
// order the model has, and ring indices leak out to the renderer and the undo
// stack, so a reshuffle between runs would silently change a drawing.
// ---------------------------------------------------------------------------

interface IntEdge {
  readonly to: number;
  readonly bond: number;
}

interface IntGraph {
  readonly n: number;
  readonly m: number;
  /** Per atom, incident edges in bond insertion order. */
  readonly adj: readonly IntEdge[][];
  readonly edgeFrom: Int32Array;
  readonly edgeTo: Int32Array;
}

function buildIntGraph(mol: Molecule): IntGraph {
  const n = mol.atomIds.length;
  const m = mol.bondIds.length;
  const atomIndex = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => atomIndex.set(id, index));

  const adj: IntEdge[][] = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = [];
  const edgeFrom = new Int32Array(m).fill(-1);
  const edgeTo = new Int32Array(m).fill(-1);

  mol.bondIds.forEach((id, index) => {
    const bond = mol.bonds[id];
    if (!bond) return;
    const from = atomIndex.get(bond.from);
    const to = atomIndex.get(bond.to);
    if (from === undefined || to === undefined || from === to) return;
    edgeFrom[index] = from;
    edgeTo[index] = to;
    adj[from]!.push({ to, bond: index });
    adj[to]!.push({ to: from, bond: index });
  });

  return { n, m, adj, edgeFrom, edgeTo };
}

function bondIndexBetween(graph: IntGraph, u: number, v: number): number {
  for (const edge of graph.adj[u]!) {
    if (edge.to === v) return edge.bond;
  }
  throw new Error(`Internal: no bond between atom indices ${u} and ${v}`);
}

/**
 * Bridges, by Tarjan's lowlink.
 *
 * Iterative with an explicit stack, not recursive. molecule.ts documents that
 * a recursive `buildTree` blew the stack on a long polymer chain; a 20k-atom
 * chain must not reintroduce the bug on this code path, and a chain is
 * exactly the input that makes this DFS as deep as it gets.
 *
 * The walk skips the edge it arrived on by BOND index rather than by parent
 * vertex, so a duplicated bond between the same pair would still be seen as
 * a cycle rather than mistaken for the way back.
 */
function findBridges(graph: IntGraph): Uint8Array {
  const { n, adj } = graph;
  const isBridge = new Uint8Array(graph.m);
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  let timer = 0;

  const stackV: number[] = [];
  const stackI: number[] = [];
  const stackParentBond: number[] = [];

  for (let root = 0; root < n; root++) {
    if (disc[root]! >= 0) continue;
    disc[root] = timer;
    low[root] = timer;
    timer++;
    stackV.push(root);
    stackI.push(0);
    stackParentBond.push(-1);

    while (stackV.length > 0) {
      const top = stackV.length - 1;
      const v = stackV[top]!;
      const edges = adj[v]!;
      const i = stackI[top]!;
      if (i < edges.length) {
        stackI[top] = i + 1;
        const edge = edges[i]!;
        if (edge.bond === stackParentBond[top]!) continue;
        if (disc[edge.to]! >= 0) {
          if (disc[edge.to]! < low[v]!) low[v] = disc[edge.to]!;
        } else {
          disc[edge.to] = timer;
          low[edge.to] = timer;
          timer++;
          stackV.push(edge.to);
          stackI.push(0);
          stackParentBond.push(edge.bond);
        }
      } else {
        stackV.pop();
        stackI.pop();
        const parentBond = stackParentBond.pop()!;
        if (stackV.length > 0) {
          const parent = stackV[stackV.length - 1]!;
          if (low[v]! < low[parent]!) low[parent] = low[v]!;
          // Nothing under v reaches back past its parent, so the edge that
          // got here is the only route: it lies on no cycle.
          if (low[v]! > disc[parent]! && parentBond >= 0) isBridge[parentBond] = 1;
        }
      }
    }
  }
  return isBridge;
}

// ---------------------------------------------------------------------------
// GF(2) bitsets over bond indices
// ---------------------------------------------------------------------------

function wordCount(m: number): number {
  return Math.max(1, Math.ceil(m / 32));
}

function setBit(bits: Uint32Array, index: number): void {
  bits[index >>> 5] = bits[index >>> 5]! | (1 << (index & 31));
}

function xorInto(target: Uint32Array, source: Uint32Array): void {
  for (let i = 0; i < target.length; i++) target[i] = target[i]! ^ source[i]!;
}

function lowestSetBit(bits: Uint32Array, fromWord = 0): number {
  for (let w = fromWord; w < bits.length; w++) {
    const word = bits[w]!;
    if (word !== 0) return w * 32 + (31 - Math.clz32(word & -word));
  }
  return -1;
}

/**
 * Row-echelon basis, indexed by pivot (the lowest set bit of the row). A row
 * has no set bits below its own pivot, so XORing it can never re-set a bit
 * we have already passed — which is what makes a single ascending sweep a
 * complete reduction.
 */
type Basis = (Uint32Array | undefined)[];

/** Reduces `v` in place and returns its pivot, or -1 if it reduced to zero
 *  (i.e. `v` is a GF(2) sum of rows already in the basis). */
function reduceVector(basis: Basis, v: Uint32Array): number {
  let pivot = lowestSetBit(v);
  while (pivot >= 0) {
    const row = basis[pivot];
    if (!row) return pivot;
    xorInto(v, row);
    pivot = lowestSetBit(v, pivot >>> 5);
  }
  return -1;
}

/** True when the row was independent and has been added. */
function addRow(basis: Basis, v: Uint32Array): boolean {
  const pivot = reduceVector(basis, v);
  if (pivot < 0) return false;
  basis[pivot] = v;
  return true;
}

// ---------------------------------------------------------------------------
// Candidate cycles
// ---------------------------------------------------------------------------

/**
 * Cap on how many equally short cycles one bond may contribute.
 *
 * Far beyond anything chemical — a cubane edge has 2 ties, a fullerene edge
 * has 2 — so hitting it can only ever cost a symmetry extra, never a basis
 * ring: the Horton backstop still completes the rank.
 */
const MAX_TIES = 64;

interface Candidate {
  readonly bits: Uint32Array;
  /** Ordered closed walk, as atom indices. */
  readonly walk: number[];
  readonly sortedAtoms: number[];
  readonly key: string;
  readonly size: number;
}

function candidateFrom(
  graph: IntGraph,
  walk: number[],
  bits: Uint32Array,
  bondIndices: number[],
): Candidate {
  const sortedAtoms = [...walk].sort((a, b) => a - b);
  // Keyed on the BOND set, never the atom set: two distinct cycles can share
  // a vertex set when a ring has a chord, and an atom-set key silently
  // collapses them into one.
  const key = [...bondIndices].sort((a, b) => a - b).join(",");
  return { bits, walk, sortedAtoms, key, size: walk.length };
}

function makeCandidate(graph: IntGraph, walk: number[]): Candidate {
  const bits = new Uint32Array(wordCount(graph.m));
  const bondIndices: number[] = [];
  for (let i = 0; i < walk.length; i++) {
    const bond = bondIndexBetween(graph, walk[i]!, walk[(i + 1) % walk.length]!);
    bondIndices.push(bond);
    setBit(bits, bond);
  }
  return candidateFrom(graph, walk, bits, bondIndices);
}

/**
 * A bond set is identified by an order-independent hash of its bond indices,
 * so a duplicate can be recognised before anything of size O(ring) is
 * allocated. Collisions are resolved by comparing the bitsets outright, so the
 * hash is a filter and never an answer — a hash-only identity would silently
 * drop a real ring.
 */
function mix32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

function sameBits(a: Uint32Array, b: Uint32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Collects candidate cycles, rejecting duplicates BEFORE they are built.
 *
 * This is the whole reason the per-bond search stays linear in memory. Every
 * bond of a single N-membered ring finds that same N-membered cycle, so
 * materialising a candidate per bond and deduplicating afterwards costs
 * Theta(N^2) in both time and memory — a 20k-membered macrocycle exhausted the
 * heap and killed the process, which is the same class of blow-up CLAUDE.md
 * records for a 20k-atom chain. `bits` and `bondIndices` are scratch, reused
 * across every emission and always left zeroed, so a repeat costs one pass
 * over the walk and no allocation at all.
 */
interface CandidateSink {
  readonly graph: IntGraph;
  /** Scratch bitset, all-zero between emissions. */
  readonly bits: Uint32Array;
  /** Scratch bond-index list for the walk being considered. */
  readonly bondIndices: number[];
  /** Bond-set hash -> candidates already emitted with that hash. */
  readonly seen: Map<number, Candidate[]>;
  readonly out: Candidate[];
}

function makeSink(graph: IntGraph): CandidateSink {
  return {
    graph,
    bits: new Uint32Array(wordCount(graph.m)),
    bondIndices: [],
    seen: new Map(),
    out: [],
  };
}

/**
 * Emits the closed walk `path` (in either direction — `canonicaliseWalk`
 * normalises rotation and orientation later) unless its bond set has already
 * been seen.
 */
function emitCycle(sink: CandidateSink, path: readonly number[]): void {
  const { graph, bits, bondIndices, seen, out } = sink;
  const size = path.length;
  bondIndices.length = 0;
  let hash = 0;
  for (let i = 0; i < size; i++) {
    const bond = bondIndexBetween(graph, path[i]!, path[(i + 1) % size]!);
    bondIndices.push(bond);
    setBit(bits, bond);
    hash = (hash + mix32(bond)) | 0;
  }

  const clearScratch = (): void => {
    for (const bond of bondIndices) bits[bond >>> 5] = 0;
  };

  const bucket = seen.get(hash);
  if (bucket) {
    for (const candidate of bucket) {
      if (candidate.size === size && sameBits(candidate.bits, bits)) {
        clearScratch();
        return;
      }
    }
  }

  const owned = Uint32Array.from(bits);
  clearScratch();
  const candidate = candidateFrom(graph, [...path].reverse(), owned, bondIndices);
  out.push(candidate);
  if (bucket) bucket.push(candidate);
  else seen.set(hash, [candidate]);
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.size !== b.size) return a.size - b.size;
  for (let i = 0; i < a.sortedAtoms.length; i++) {
    const d = a.sortedAtoms[i]! - b.sortedAtoms[i]!;
    if (d !== 0) return d;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Scratch state for the per-bond BFS, allocated once per perception run so
 *  the search does not allocate an array per bond. */
interface BfsScratch {
  readonly dist: Int32Array;
  readonly stamp: Int32Array;
  readonly preds: number[][];
  visit: number;
}

/**
 * Every smallest cycle through one bond.
 *
 * BFS from one endpoint with the bond removed, recording ALL shortest-path
 * predecessors rather than a single parent — that is what makes the
 * symmetry-equivalent ties surface, and it is why cubane's six faces all
 * appear as candidates when a single-parent BFS would only find five.
 */
function smallestCyclesThroughBond(
  graph: IntGraph,
  bondIndex: number,
  componentIndex: Int32Array,
  componentId: number,
  scratch: BfsScratch,
  sink: CandidateSink,
): void {
  const x = graph.edgeFrom[bondIndex]!;
  const y = graph.edgeTo[bondIndex]!;
  if (x < 0 || y < 0) return;

  const { dist, stamp, preds } = scratch;
  const visit = ++scratch.visit;
  stamp[x] = visit;
  dist[x] = 0;
  preds[x] = [];

  const queue: number[] = [x];
  let head = 0;
  let target = -1;
  while (head < queue.length) {
    const v = queue[head++]!;
    // Nothing longer than the first path found can help.
    if (target >= 0 && dist[v]! >= target) continue;
    for (const edge of graph.adj[v]!) {
      if (edge.bond === bondIndex) continue;
      if (componentIndex[edge.to]! !== componentId) continue;
      if (stamp[edge.to]! !== visit) {
        stamp[edge.to] = visit;
        dist[edge.to] = dist[v]! + 1;
        preds[edge.to] = [v];
        queue.push(edge.to);
        if (edge.to === y && target < 0) target = dist[edge.to]!;
      } else if (dist[edge.to]! === dist[v]! + 1) {
        preds[edge.to]!.push(v);
      }
    }
  }

  // Unreachable means the bond is a bridge. Impossible after the bridge
  // strip, but the guard keeps the function total rather than reading an
  // undefined distance.
  if (stamp[y]! !== visit) return;

  // Walk the predecessor DAG iteratively. Recursion here would be as deep as
  // the ring is large, and a macrocycle is a perfectly ordinary drawing.
  const stackNode: number[] = [y];
  const stackIdx: number[] = [0];
  const path: number[] = [y];
  let found = 0;
  while (stackNode.length > 0 && found < MAX_TIES) {
    const top = stackNode.length - 1;
    const node = stackNode[top]!;
    if (node === x) {
      // `path` holds y..x; the emitted walk runs x..y and closes on the bond.
      // Length 2 would mean a second bond between the same pair, which the
      // model forbids; ignoring it keeps this total rather than emitting a
      // "ring" whose two bonds are the same bond.
      if (path.length >= 3) {
        emitCycle(sink, path);
        found++;
      }
      stackNode.pop();
      stackIdx.pop();
      path.pop();
      continue;
    }
    const ps = preds[node]!;
    const idx = stackIdx[top]!;
    if (idx >= ps.length) {
      stackNode.pop();
      stackIdx.pop();
      path.pop();
      continue;
    }
    stackIdx[top] = idx + 1;
    stackNode.push(ps[idx]!);
    stackIdx.push(0);
    path.push(ps[idx]!);
  }
}

/**
 * Horton's candidate set for one component: `SP(v,x) + (x,y) + SP(y,v)` for
 * every vertex v and edge (x,y).
 *
 * Provably rich enough to span a minimum cycle basis, so a graph the per-bond
 * generator cannot cover degrades to "correct, but without the symmetry
 * extras" instead of silently returning too few rings.
 *
 * WHY IT IS NOT GATED ON RANK ALONE. The per-bond generator only ever emits a
 * cycle that is SHORTEST through one of its own bonds, so a symmetry-equivalent
 * ring whose every bond already sits on a smaller cycle is invisible to it —
 * and the rank can already be complete without that ring, so a rank-only gate
 * never asks for help. An eight-vertex skeleton with four triangles and two
 * squares reaches rank 6 while dropping a genuine fourth square. Horton's set
 * contains it, so it runs unconditionally for any component small enough that
 * `|V|` BFS sweeps are free. Above that bound it stays a rank-triggered
 * backstop, and the residual limit is pinned by a test.
 */
const HORTON_ALWAYS_MAX_ATOMS = 32;

function hortonCandidates(
  graph: IntGraph,
  componentAtoms: number[],
  componentBonds: number[],
  componentIndex: Int32Array,
  componentId: number,
): Candidate[] {
  const out: Candidate[] = [];
  const n = graph.n;
  const dist = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);

  for (const root of componentAtoms) {
    dist.fill(-1);
    parent.fill(-1);
    dist[root] = 0;
    const queue: number[] = [root];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++]!;
      for (const edge of graph.adj[v]!) {
        if (componentIndex[edge.to]! !== componentId) continue;
        if (dist[edge.to]! < 0) {
          dist[edge.to] = dist[v]! + 1;
          parent[edge.to] = v;
          queue.push(edge.to);
        } else if (dist[edge.to]! === dist[v]! + 1 && v < parent[edge.to]!) {
          // Deterministic parent: the dist-1 neighbour with the lowest index.
          parent[edge.to] = v;
        }
      }
    }

    for (const bondIndex of componentBonds) {
      const x = graph.edgeFrom[bondIndex]!;
      const y = graph.edgeTo[bondIndex]!;
      if (dist[x]! < 0 || dist[y]! < 0) continue;
      const pathX = pathToRoot(parent, x);
      const pathY = pathToRoot(parent, y);
      const seen = new Set(pathX);
      let shared = 0;
      for (const node of pathY) if (seen.has(node)) shared++;
      // The two tree paths must meet only at the root, or the "cycle" is a
      // figure of eight rather than a simple cycle.
      if (shared !== 1) continue;
      // pathX runs x..root; pathY runs y..root. root..x then y..(before root)
      // is the closed walk.
      const walk = [...pathX].reverse();
      for (let i = 0; i < pathY.length - 1; i++) walk.push(pathY[i]!);
      if (walk.length < 3) continue;
      out.push(makeCandidate(graph, walk));
    }
  }
  return out;
}

function pathToRoot(parent: Int32Array, start: number): number[] {
  const path: number[] = [start];
  let current = start;
  while (parent[current]! >= 0) {
    current = parent[current]!;
    path.push(current);
  }
  return path;
}

/**
 * Selects rings from the sorted candidate set for one component.
 *
 * A candidate is kept when it is independent of everything accepted so far
 * (it extends the cycle basis), OR when it cannot be written as a GF(2) sum
 * of rings STRICTLY SMALLER than itself (it is a symmetry equivalent of a
 * ring the basis already has). The second clause is the symmetrisation, and
 * "strictly smaller" is doing precise work: cubane's sixth 4-ring has nothing
 * smaller than 4 to be built from and survives, while naphthalene's
 * 10-membered perimeter is the sum of two 6-rings and does not.
 */
function selectRings(candidates: Candidate[], rank: number, m: number): Candidate[] {
  const size = m + 1;
  const basis: Basis = new Array(size);
  const smaller: Basis = new Array(size);
  const accepted: Candidate[] = [];
  let pending: Candidate[] = [];
  let basisRank = 0;
  let currentSize = -1;

  for (const candidate of candidates) {
    if (candidate.size !== currentSize) {
      // Everything accepted at the previous size is now strictly smaller.
      for (const p of pending) addRow(smaller, Uint32Array.from(p.bits));
      pending = [];
      currentSize = candidate.size;
    }

    if (basisRank < rank && addRow(basis, Uint32Array.from(candidate.bits))) {
      basisRank++;
      accepted.push(candidate);
      pending.push(candidate);
      continue;
    }

    if (reduceVector(smaller, Uint32Array.from(candidate.bits)) >= 0) {
      accepted.push(candidate);
      pending.push(candidate);
    }
  }
  return accepted;
}

function selectionRank(candidates: Candidate[], rank: number, m: number): number {
  const basis: Basis = new Array(m + 1);
  let found = 0;
  for (const candidate of candidates) {
    if (found >= rank) break;
    if (addRow(basis, Uint32Array.from(candidate.bits))) found++;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Rotates and orients a closed walk so the same ring always comes back as the
 * same array: start at the lowest atom index, then step towards whichever
 * neighbour has the lower index. Without this, a rotation or a mirror of one
 * ring would be two different outputs and the renderer would see the ring
 * move when nothing changed.
 */
function canonicaliseWalk(walk: number[]): number[] {
  const size = walk.length;
  let start = 0;
  for (let i = 1; i < size; i++) if (walk[i]! < walk[start]!) start = i;
  const forward = walk[(start + 1) % size]!;
  const backward = walk[(start - 1 + size) % size]!;
  const step = forward <= backward ? 1 : -1;
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    out.push(walk[(((start + step * i) % size) + size) % size]!);
  }
  return out;
}

function computeRingPerception(mol: Molecule): RingPerception {
  const graph = buildIntGraph(mol);
  const accepted = searchRings(graph);

  const ringList: Ring[] = accepted.map((candidate) => {
    const walk = canonicaliseWalk(candidate.walk);
    const atomIds = walk.map((index) => mol.atomIds[index]!);
    const bondIds: BondId[] = [];
    for (let i = 0; i < walk.length; i++) {
      const bond = bondIndexBetween(graph, walk[i]!, walk[(i + 1) % walk.length]!);
      bondIds.push(mol.bondIds[bond]!);
    }
    return Object.freeze({
      atomIds: Object.freeze(atomIds),
      bondIds: Object.freeze(bondIds),
      size: walk.length,
    });
  });

  // Membership seeded for every id, so "in no ring" and "unknown id" are
  // distinguishable at the call site rather than both coming back undefined.
  const atomsRecord: Record<AtomId, number[]> = {};
  const bondsRecord: Record<BondId, number[]> = {};
  for (const id of mol.atomIds) atomsRecord[id] = [];
  for (const id of mol.bondIds) bondsRecord[id] = [];
  ringList.forEach((ring, index) => {
    for (const id of ring.atomIds) atomsRecord[id]?.push(index);
    for (const id of ring.bondIds) bondsRecord[id]?.push(index);
  });
  for (const id of mol.atomIds) Object.freeze(atomsRecord[id]);
  for (const id of mol.bondIds) Object.freeze(bondsRecord[id]);

  // Frozen because the same object is handed to every caller: one caller
  // sorting or splicing the array in place would corrupt the cache for all
  // the others.
  return Object.freeze({
    rings: Object.freeze(ringList),
    membership: Object.freeze({
      atoms: Object.freeze(atomsRecord),
      bonds: Object.freeze(bondsRecord),
    }),
  });
}

function searchRings(graph: IntGraph): Candidate[] {
  const { n, m } = graph;
  if (n === 0 || m === 0) return [];

  const isBridge = findBridges(graph);

  // Strip bridges (and with them every pendant chain, linker, and the
  // inter-ring bond of a biphenyl) before searching. A bridge can lie on no
  // cycle, so leaving it in only gives the per-bond BFS an unreachable target
  // to handle.
  const ringBond = new Uint8Array(m);
  const isRingAtomIndex = new Uint8Array(n);
  for (let b = 0; b < m; b++) {
    if (isBridge[b]! || graph.edgeFrom[b]! < 0) continue;
    ringBond[b] = 1;
    isRingAtomIndex[graph.edgeFrom[b]!] = 1;
    isRingAtomIndex[graph.edgeTo[b]!] = 1;
  }

  const scratch: BfsScratch = {
    dist: new Int32Array(n),
    stamp: new Int32Array(n),
    preds: new Array(n),
    visit: 0,
  };

  // Ring systems, each handled independently — which is what makes two
  // disconnected ring systems, a biphenyl and a spiro junction fall out for
  // free, and it is why the circuit rank must be computed per component. A
  // global `bonds - atoms + 1` gives rank 1 for two separate ring systems and
  // the selection loop then stops after the first ring.
  //
  // `componentIndex` doubles as the membership test the searches need, so no
  // per-component `Uint8Array` is allocated, and the bonds are bucketed in ONE
  // sweep over the molecule rather than one sweep per component. A multi-
  // fragment import — a solvated structure, or a multi-record SDF pasted as
  // one molecule — has thousands of components, and rescanning every bond for
  // each of them made perception quadratic in the fragment count: 8000 benzenes
  // took 1.4 s where the work is linear in the atoms.
  const componentIndex = new Int32Array(n).fill(-1);
  const componentAtomLists: number[][] = [];
  const componentBondLists: number[][] = [];

  for (let seed = 0; seed < n; seed++) {
    if (!isRingAtomIndex[seed]! || componentIndex[seed]! >= 0) continue;
    const id = componentAtomLists.length;
    const componentAtoms: number[] = [];
    componentIndex[seed] = id;
    const queue: number[] = [seed];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++]!;
      componentAtoms.push(v);
      for (const edge of graph.adj[v]!) {
        if (!ringBond[edge.bond]!) continue;
        if (componentIndex[edge.to]! >= 0) continue;
        componentIndex[edge.to] = id;
        queue.push(edge.to);
      }
    }
    componentAtoms.sort((a, b) => a - b);
    componentAtomLists.push(componentAtoms);
    componentBondLists.push([]);
  }

  for (let b = 0; b < m; b++) {
    if (!ringBond[b]!) continue;
    componentBondLists[componentIndex[graph.edgeFrom[b]!]!]!.push(b);
  }

  const results: Candidate[] = [];

  for (let id = 0; id < componentAtomLists.length; id++) {
    const componentAtoms = componentAtomLists[id]!;
    const componentBonds = componentBondLists[id]!;

    const rank = componentBonds.length - componentAtoms.length + 1;
    if (rank <= 0) continue;

    // A rank-1 component has as many ring bonds as ring atoms and no bridges
    // left, so every vertex has degree exactly two: the component IS one
    // cycle. Tracing it once is O(N) where the per-bond generator would run N
    // BFS sweeps and find the same cycle N times.
    if (rank === 1) {
      const cycle = traceSingleCycle(graph, componentAtoms, ringBond);
      if (cycle && cycle.length === componentAtoms.length) {
        results.push(makeCandidate(graph, cycle));
        continue;
      }
      // Unreachable for a simple graph; falling through keeps this total.
    }

    const sink = makeSink(graph);
    for (const bondIndex of componentBonds) {
      smallestCyclesThroughBond(graph, bondIndex, componentIndex, id, scratch, sink);
    }
    let candidates = sink.out;
    candidates.sort(compareCandidates);

    if (
      componentAtoms.length <= HORTON_ALWAYS_MAX_ATOMS ||
      selectionRank(candidates, rank, m) < rank
    ) {
      candidates = dedupe([
        ...candidates,
        ...hortonCandidates(graph, componentAtoms, componentBonds, componentIndex, id),
      ]);
      candidates.sort(compareCandidates);
    }

    results.push(...selectRings(candidates, rank, m));
  }

  // One final sort so ring indices are a property of the molecule rather than
  // of the order components happened to be discovered in.
  results.sort(compareCandidates);
  return results;
}

/**
 * Walks a component that is known to be a single cycle, returning it as a
 * closed walk. Returns `undefined` if the walk does not close cleanly, which
 * cannot happen for a rank-1 component of a simple graph but keeps the caller
 * from having to trust that argument.
 */
function traceSingleCycle(
  graph: IntGraph,
  componentAtoms: number[],
  ringBond: Uint8Array,
): number[] | undefined {
  const start = componentAtoms[0];
  if (start === undefined) return undefined;
  const walk: number[] = [start];
  let previousBond = -1;
  let current = start;
  // Bounded by the component size, so a malformed adjacency cannot spin here.
  for (let step = 0; step < componentAtoms.length; step++) {
    let next = -1;
    for (const edge of graph.adj[current]!) {
      if (!ringBond[edge.bond]! || edge.bond === previousBond) continue;
      previousBond = edge.bond;
      next = edge.to;
      break;
    }
    if (next < 0) return undefined;
    if (next === start) return walk;
    walk.push(next);
    current = next;
  }
  return undefined;
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    out.push(candidate);
  }
  return out;
}
