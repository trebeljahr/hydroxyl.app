/**
 * Aromaticity perception, and Kekulisation of imported aromatic flags.
 *
 * PERCEPTION IS A QUERY, NOT A FLAG. Kekule is the storage form: a benzene in
 * this model has alternating single and double bonds, and every `aromatic`
 * flag is false. Aromaticity is derived from those bond orders on demand.
 * `Atom.aromatic` / `Bond.aromatic` survive only as a carrier for perception
 * an importer brings in from outside, and `kekulize` converts such a molecule
 * into the storage form. Nothing here reads a flag to decide whether a ring is
 * aromatic — it reads the orders.
 *
 * THE RULE. Huckel's 4n+2, from a per-atom pi-electron contribution (see
 * `piContribution`). The test is `count % 4 === 2` and not
 * `count >= 6 && count % 2 === 0`: planarity is not modelled, so the electron
 * count is the only thing standing between cyclooctatetraene and a wrong
 * answer, and COT's eight electrons pass the looser test. The modulo also
 * accepts the cyclopropenyl cation at 2 and [18]annulene at 18, which a
 * ring-size cap bolted on to reject COT would break while treating the
 * symptom.
 *
 * A second guard rejects a count that FILLS the pi manifold — `count` at or
 * above twice the number of participating atoms. A ring of three N-H
 * nitrogens has no pi bond anywhere in it, yet every nitrogen donates a lone
 * pair for a total of six, and 4n+2 alone calls cyclotriazane aromatic. Six
 * electrons in three p orbitals is a closed shell with nothing left to
 * delocalise; the same arithmetic wrongly rescued cyclo-S5 and an all-single
 * N5H5. Borazine survives it, as it should: six electrons across six orbitals.
 *
 * TWO PASSES, PER RING AND PER FUSED SYSTEM. A per-SSSR-ring count alone gets
 * every fused system wrong, and — worse — gets it wrong DIFFERENTLY depending
 * on which Kekule structure happens to be stored. Indole's five-ring reads
 * four in the conventional drawing because both fusion carbons put their
 * double bond in the six-ring; redraw the same molecule with the fusion bond
 * double and it reads six. Aromaticity is a property of the molecule, not of
 * the arrangement of lines someone saved, so the per-ring pass is followed by
 * a pass over connected UNIONS of SSSR rings within each fused system: if the
 * union satisfies the same rule, every ring in it is aromatic. Naphthalene
 * counts ten across both rings whichever Kekule structure is drawn, anthracene
 * fourteen across three, indole and purine ten, and azulene — genuinely
 * aromatic over its ten-electron perimeter — finally comes out right.
 *
 * This is what RDKit's default model does, and RDKit is the import/export
 * oracle: perceiving indole's five-ring as aliphatic writes `C` where RDKit
 * writes `c` and the difference survives a SMILES round-trip. Unions are
 * checked, not just the whole system, because pyrene's sixteen perimeter
 * electrons are 4n while its constituent rings are not.
 *
 * COT is untouched by any of this: it is a single ring with nothing to fuse
 * to, and eight electrons stay 4n.
 */

import {
  adjacency,
  bondsAt,
  degree,
  otherEnd,
  requireAtom,
  requireBond,
} from "./molecule.js";
import { LruCache, ringMembership, rings, type Ring } from "./rings.js";
import type {
  Atom,
  AtomId,
  Bond,
  BondId,
  BondOrder,
  Molecule,
} from "./types.js";
import {
  bondOrderSum,
  chargeAdjustedValences,
  implicitHydrogenCount,
  maxValence,
} from "./valence.js";

export interface AromaticPerception {
  /** Parallel to `rings(mol)`. A ring is aromatic when it satisfies the rule
   *  on its own OR through a fused union it belongs to, so this can be true
   *  where `ringPiElectrons` alone would not explain it. */
  readonly ringIsAromatic: readonly boolean[];
  /**
   * Parallel to `rings(mol)`: pi electrons counted for that SSSR ring ALONE,
   * or -1 where an atom in it cannot take part at all.
   *
   * Deliberately not the fused-union count. Indole's five-ring contributes
   * four of the ten electrons its ring system holds, and reporting ten against
   * both of its rings would double-count them for a caller adding the numbers
   * up. `ringIsAromatic` is the answer to "is this ring aromatic"; this is the
   * arithmetic behind the per-ring pass.
   */
  readonly ringPiElectrons: readonly number[];
  /** Frozen, not a Set: `Object.freeze` does not stop `Set.prototype.add`, and
   *  this object is shared with every caller through the cache. */
  readonly aromaticAtomIds: readonly AtomId[];
  readonly aromaticBondIds: readonly BondId[];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Fingerprint field separator, matching rings.ts: NUL cannot occur in an id,
 *  so the encoding stays injective whatever an importer mints ids from. */
const SEP = "\u0000";

/** Bumped if the fingerprint contents ever change, so an entry cached under
 *  the old shape can never be mistaken for a match. */
const AROMATIC_FINGERPRINT_VERSION = "A1";

/**
 * Identifies everything aromaticity perception reads.
 *
 * A strict refinement of the ring fingerprint, and emphatically NOT that
 * fingerprint reused: charging an atom or changing a bond order leaves the
 * ring topology — and therefore the ring fingerprint — identical, so sharing
 * the key would hand back a stale answer with no visible error.
 *
 * Built in one pass rather than as `ringFingerprint(mol) + extras`, which
 * would be two traversals and two joins for one string.
 *
 * Positions are excluded, so a drag reuses the entry; `stereo`,
 * `doubleBondSide`, `isotope` and `label` are excluded because a wedge edit
 * or a relabelling cannot change which rings are aromatic.
 */
function aromaticFingerprint(mol: Molecule): string {
  const parts: string[] = [AROMATIC_FINGERPRINT_VERSION];
  for (const id of mol.atomIds) {
    const atom = mol.atoms[id];
    if (!atom) continue; // unreachable; keeps the loop total
    parts.push(
      id,
      atom.element,
      String(atom.charge),
      String(atom.radicalElectrons),
      // "" for absent is a distinct field under NUL delimiting, so an atom
      // that pins zero hydrogens is not confused with one that derives them.
      atom.explicitHydrogenCount === undefined
        ? ""
        : String(atom.explicitHydrogenCount),
      atom.aromatic ? "1" : "0",
    );
  }
  // Section marker, so an id cannot migrate between the two sections.
  parts.push("|");
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id];
    if (!bond) continue;
    parts.push(id, bond.from, bond.to, String(bond.order), bond.aromatic ? "1" : "0");
  }
  return parts.join(SEP);
}

const AROMATIC_BY_INSTANCE = new WeakMap<Molecule, AromaticPerception>();
const AROMATIC_BY_TOPOLOGY = new LruCache<AromaticPerception>(32);
let aromaticComputations = 0;

/**
 * Perceived aromaticity, memoised.
 *
 * Same two-level shape as `ringPerception`, and for the same reason: the
 * instance `WeakMap` keeps repeated queries within one render frame from
 * rebuilding the fingerprint string, and the topology cache behind it is what
 * makes a drag free, since dragging produces a fresh `Molecule` per
 * pointer-move in which only a position changed.
 */
export function aromaticPerception(mol: Molecule): AromaticPerception {
  const hit = AROMATIC_BY_INSTANCE.get(mol);
  if (hit) return hit;

  const key = aromaticFingerprint(mol);
  const shared = AROMATIC_BY_TOPOLOGY.get(key);
  if (shared) {
    AROMATIC_BY_INSTANCE.set(mol, shared);
    return shared;
  }

  // Incremented here and nowhere else. Counting a cache hit as a computation
  // would make the drag test pass even with the topology layer deleted.
  aromaticComputations++;
  const built = computeAromaticPerception(mol);
  AROMATIC_BY_TOPOLOGY.set(key, built);
  AROMATIC_BY_INSTANCE.set(mol, built);
  return built;
}

/** Testing hook: how many times perception has actually run. A cache hit does
 *  not increment it. */
export function aromaticPerceptionComputationCount(): number {
  return aromaticComputations;
}

/** Testing hook. The counter is process-global because vitest shares a module
 *  registry across a file, so each assertion resets first. */
export function resetAromaticPerceptionComputationCount(): void {
  aromaticComputations = 0;
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/** Indices into `rings(mol)` of the rings that perceive as aromatic. */
export function aromaticRings(mol: Molecule): readonly number[] {
  const flags = aromaticPerception(mol).ringIsAromatic;
  const indices: number[] = [];
  flags.forEach((aromatic, index) => {
    if (aromatic) indices.push(index);
  });
  return indices;
}

export function isAromaticRing(mol: Molecule, ringIndex: number): boolean {
  return requireRingFlag(mol, ringIndex).ringIsAromatic[ringIndex]!;
}

/** Pi electrons counted for a ring, or -1 if it cannot be counted. */
export function piElectronCount(mol: Molecule, ringIndex: number): number {
  return requireRingFlag(mol, ringIndex).ringPiElectrons[ringIndex]!;
}

/** Throws on an out-of-range index, matching `ringAt`: ring indices come from
 *  `ringMembership`, so a bad one is a caller bug rather than a state. */
function requireRingFlag(mol: Molecule, ringIndex: number): AromaticPerception {
  const perception = aromaticPerception(mol);
  if (
    !Number.isInteger(ringIndex) ||
    ringIndex < 0 ||
    ringIndex >= perception.ringIsAromatic.length
  ) {
    throw new Error(
      `No such ring: ${ringIndex} (molecule has ` +
        `${perception.ringIsAromatic.length} rings)`,
    );
  }
  return perception;
}

/**
 * Member of at least one aromatic ring.
 *
 * Answered from ring membership rather than from a prebuilt Set, so nothing
 * mutable has to be handed out of the cache. An atom sits in at most a handful
 * of rings, so this is a two-element scan in practice.
 */
export function isAromaticAtom(mol: Molecule, atomId: AtomId): boolean {
  requireAtom(mol, atomId);
  const { ringIsAromatic } = aromaticPerception(mol);
  for (const index of ringMembership(mol).atoms[atomId] ?? []) {
    if (ringIsAromatic[index]) return true;
  }
  return false;
}

/**
 * Member of an aromatic ring — NOT "joins two aromatic atoms".
 *
 * Biphenyl's inter-ring bond joins two aromatic carbons, lies on no ring at
 * all, and is not aromatic; the endpoint test gets it wrong and a renderer
 * would draw a delocalisation arc across it.
 */
export function isAromaticBond(mol: Molecule, bondId: BondId): boolean {
  requireBond(mol, bondId);
  const { ringIsAromatic } = aromaticPerception(mol);
  for (const index of ringMembership(mol).bonds[bondId] ?? []) {
    if (ringIsAromatic[index]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

function computeAromaticPerception(mol: Molecule): AromaticPerception {
  // Perception runs on bond orders. A molecule carrying imported flags has
  // no orders to read yet, so it is converted once, here, and everything
  // downstream sees the Kekule form. Not re-entrant: `kekulize` never calls
  // back into perception. Because the RING fingerprint excludes bond orders
  // and flags, `rings(work)` is the very same cached object as `rings(mol)`,
  // so ring indices line up between the two molecules for free.
  const work = hasAromaticFlags(mol) ? kekulize(mol) : mol;

  const perceived = rings(work);
  const ringIsAromatic: boolean[] = [];
  const ringPiElectrons: number[] = [];

  for (const ring of perceived) {
    const count = countPiElectrons(work, ring.atomIds, new Set(ring.bondIds));
    ringPiElectrons.push(count);
    ringIsAromatic.push(satisfiesHuckel(count, ring.size));
  }

  markFusedSystems(work, perceived, ringPiElectrons, ringIsAromatic);

  const membership = ringMembership(work);
  const aromaticAtomIds: AtomId[] = [];
  for (const id of work.atomIds) {
    for (const index of membership.atoms[id] ?? []) {
      if (ringIsAromatic[index]) {
        aromaticAtomIds.push(id);
        break;
      }
    }
  }
  const aromaticBondIds: BondId[] = [];
  for (const id of work.bondIds) {
    for (const index of membership.bonds[id] ?? []) {
      if (ringIsAromatic[index]) {
        aromaticBondIds.push(id);
        break;
      }
    }
  }

  // Every field frozen, not just the wrapper: the object is shared with every
  // caller through the cache, and one caller sorting an array — or adding to a
  // Set, which `Object.freeze` on the wrapper would NOT have prevented —
  // corrupts the answer for everyone else.
  return Object.freeze({
    ringIsAromatic: Object.freeze(ringIsAromatic),
    ringPiElectrons: Object.freeze(ringPiElectrons),
    aromaticAtomIds: Object.freeze(aromaticAtomIds),
    aromaticBondIds: Object.freeze(aromaticBondIds),
  });
}

/**
 * Huckel's 4n+2, plus the closed-shell guard.
 *
 * `orbitals` is the number of participating atoms, one p orbital each. A count
 * that reaches `2 * orbitals` fills every one of them and there is nothing
 * left to delocalise — that is what separates borazine (six electrons, six
 * orbitals) from cyclotriazane (six electrons, three orbitals), which has no
 * pi bond in it at all yet passes 4n+2 on three donated lone pairs.
 */
function satisfiesHuckel(count: number, orbitals: number): boolean {
  // The count is -1 when some atom cannot participate, and -1 % 4 is -1 in JS,
  // but the explicit guard says what it means.
  if (count < 0) return false;
  if (count >= 2 * orbitals) return false;
  return count % 4 === 2;
}

/** Total pi electrons over `atomIds`, or -1 if any of them cannot take part.
 *  `ringBonds` is the bond set the electrons are being counted INTO — one SSSR
 *  ring for the per-ring pass, a union of them for the fused pass. */
function countPiElectrons(
  mol: Molecule,
  atomIds: readonly AtomId[],
  ringBonds: ReadonlySet<BondId>,
): number {
  let total = 0;
  for (const id of atomIds) {
    const contribution = piContribution(mol, id, ringBonds);
    if (contribution === undefined) return -1;
    total += contribution;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Fused ring systems
// ---------------------------------------------------------------------------

/**
 * Largest number of SSSR rings considered as one unit, matching RDKit's
 * default. Bounded because the subsets of a fused system are exponential in
 * its ring count and a fullerene has thirty-two rings; six is comfortably past
 * anything a figure needs — coronene's whole core is seven and each of its
 * rings is already aromatic on its own.
 */
const MAX_FUSED_RINGS = 6;

/** Total subsets examined per molecule. A large graphene flake has thousands
 *  of connected six-ring subsets and none of them changes the answer, so the
 *  budget bounds the work rather than the chemistry. */
const MAX_FUSED_SUBSETS = 4096;

/**
 * Marks every ring that is aromatic through a fused union it belongs to.
 *
 * Rings are adjacent when they SHARE A BOND. Sharing an atom is not enough: a
 * spiro junction is a single sp3 carbon with no p orbital, so its two rings
 * have no pi system in common and unioning them would be meaningless.
 */
function markFusedSystems(
  mol: Molecule,
  perceived: readonly Ring[],
  ringPiElectrons: readonly number[],
  ringIsAromatic: boolean[],
): void {
  if (perceived.length < 2) return;

  // Whether `piContribution` returns "cannot participate" does not depend on
  // which bond set it is asked about: an atom with more than three sigma
  // connections, or two pi bonds, is out however the rings around it are
  // grouped. So a ring that counted -1 poisons every union containing it, and
  // dropping those rings from the search up front is exact rather than a
  // heuristic. It also does the heavy lifting for cost: a saturated polycyclic
  // — decalin, a steroid, a 450-atom sp3 cage — is pruned to nothing instead
  // of walking thousands of subsets to reach the same answer.
  const blocked = ringPiElectrons.map((count) => count < 0);
  if (blocked.every(Boolean)) return;

  const owners = new Map<BondId, number[]>();
  perceived.forEach((ring, index) => {
    for (const id of ring.bondIds) {
      const list = owners.get(id);
      if (list) list.push(index);
      else owners.set(id, [index]);
    }
  });

  const neighbours: Set<number>[] = perceived.map(() => new Set<number>());
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    for (const a of list) {
      for (const b of list) if (a !== b) neighbours[a]!.add(b);
    }
  }

  // Grow connected subsets one ring at a time, keyed by their sorted member
  // list so each subset is examined once however many orders reach it.
  let frontier: number[][] = perceived
    .map((_, index) => index)
    .filter((index) => !blocked[index])
    .map((index) => [index]);
  const seen = new Set<string>();
  let budget = MAX_FUSED_SUBSETS;

  for (let size = 2; size <= MAX_FUSED_RINGS && budget > 0; size++) {
    const next: number[][] = [];
    for (const subset of frontier) {
      for (const member of subset) {
        for (const candidate of neighbours[member]!) {
          if (blocked[candidate] || subset.includes(candidate)) continue;
          const grown = [...subset, candidate].sort((a, b) => a - b);
          const key = grown.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          if (budget-- <= 0) break;
          next.push(grown);
          // Nothing to learn from a union whose rings are all aromatic
          // already, and skipping it keeps the common fully-aromatic PAH from
          // paying for the union arithmetic on every subset.
          if (grown.every((index) => ringIsAromatic[index])) continue;
          if (unionIsAromatic(mol, perceived, grown)) {
            for (const index of grown) ringIsAromatic[index] = true;
          }
        }
      }
    }
    frontier = next;
  }
}

function unionIsAromatic(
  mol: Molecule,
  perceived: readonly Ring[],
  subset: readonly number[],
): boolean {
  const unionBonds = new Set<BondId>();
  const unionAtoms: AtomId[] = [];
  const seenAtoms = new Set<AtomId>();
  for (const index of subset) {
    const ring = perceived[index]!;
    for (const id of ring.bondIds) unionBonds.add(id);
    for (const id of ring.atomIds) {
      if (seenAtoms.has(id)) continue;
      seenAtoms.add(id);
      unionAtoms.push(id);
    }
  }
  const count = countPiElectrons(mol, unionAtoms, unionBonds);
  return satisfiesHuckel(count, unionAtoms.length);
}

/** Elements that keep a lone pair to donate when they carry a negative
 *  charge. Boron is absent on purpose: B- has no spare pair. */
const ANIONIC_DONORS = new Set(["C", "N", "O", "S", "Se", "P"]);

/**
 * Pi electrons this atom puts into this ring, or `undefined` for "cannot
 * participate", which makes the whole ring non-aromatic.
 *
 * The branches are ordered and the first match wins. `undefined` rather than
 * a default of 0 for an unrecognised atom is deliberate: a silent 0 would
 * make the rule read as arithmetic instead of chemistry, and would let a
 * genuinely non-participating atom sit inside a ring that happens to total
 * 4n+2.
 */
function piContribution(
  mol: Molecule,
  atomId: AtomId,
  ringBonds: ReadonlySet<BondId>,
): number | undefined {
  const atom = requireAtom(mol, atomId);

  // 1. Sigma saturation. An sp2 atom has at most three sigma connections; the
  // fourth valence is the p orbital that would carry the ring pi system. A
  // cyclohexane CH2 has two bonds plus two hydrogens and is rejected here,
  // which is the cleanest expression of "this ring is saturated". It is also
  // the only thing that rejects a quaternary ring N+, a spiro junction
  // carbon, and cycloheptatriene's sp3 CH2 — the last of which would
  // otherwise count six from its three C=C and wrongly perceive as aromatic.
  const sigma = degree(mol, atomId) + implicitHydrogenCount(mol, atomId);
  if (sigma > 3) return undefined;

  let piBonds = 0;
  let ringDoubles = 0;
  let exoPi = 0;
  for (const bond of bondsAt(mol, atomId)) {
    const pi = bond.order === 3 ? 2 : bond.order === 2 ? 1 : 0;
    piBonds += pi;
    if (ringBonds.has(bond.id)) {
      if (bond.order === 2) ringDoubles++;
    } else {
      exoPi += pi;
    }
  }

  // 2. Cumulation. Two pi bonds at one atom means two orthogonal p orbitals —
  // an allene-type centre, or a ring sulfone S with two exocyclic oxygens.
  // Neither can join a single ring pi system.
  if (piBonds > 1) return undefined;

  // 3. The p orbital is spent on a bond pointing out of the ring, so the atom
  // contributes an empty orbital and no electrons. This is why
  // cyclopentadienone counts four and is not aromatic, while 2-pyridone —
  // same carbonyl, but an N-H donating two — counts six and is. The partner's
  // electronegativity is deliberately not consulted: the p-orbital argument
  // is identical for an exocyclic C=O and an exocyclic C=CH2, which is what
  // also declines fulvene.
  //
  // It does NOT decline tropone: zeroing the one carbonyl carbon still leaves
  // six electrons on the other six carbons of the seven-ring, so tropone
  // perceives as aromatic — as it does in RDKit's default model, and as
  // 4H-pyran-4-one likewise does. Only the five-membered case comes out below
  // 4n+2.
  if (exoPi === 1) return 0;

  // 4. One ring double bond: the atom donates the one electron it puts into
  // it. This is the whole pyridine/pyrrole distinction. Pyridine's nitrogen
  // has a ring C=N and contributes 1, its lone pair sitting in an sp2 orbital
  // in the ring plane where it cannot reach the pi system — which is exactly
  // why pyridine is basic and pyrrole is not. Treating every neutral N as a
  // two-electron donor gives pyridine seven, an odd count that reads as a
  // rule bug when it is a table bug.
  if (ringDoubles === 1) return 1;

  // Past this point the atom has no pi bond at all.
  const element = atom.element;

  // 5. An anion with a lone pair to donate: cyclopentadienyl.
  if (atom.charge < 0 && ANIONIC_DONORS.has(element)) return 2;

  // 6. Pyrrole-type N (and phosphole P): the lone pair sits in the p orbital
  // and joins the ring. Requires `explicitHydrogenCount` on pyrrole's N —
  // valence alone cannot tell it from pyridine's, since both see a bond-order
  // sum of 3.
  if (atom.charge === 0 && (element === "N" || element === "P")) return 2;

  // 7. Furan O, thiophene S, selenophene Se: one lone pair enters the pi
  // system, the other stays in the sp2 plane.
  if (
    atom.charge === 0 &&
    (element === "O" || element === "S" || element === "Se")
  ) {
    return 2;
  }

  // 8. A cation with an empty p orbital: tropylium, cyclopropenyl.
  if (atom.charge > 0 && (element === "C" || element === "B")) return 0;

  // 9. Neutral boron, likewise empty. Borazine's three B and three N give six.
  if (atom.charge === 0 && element === "B") return 0;

  // 10. A radical carbon donates its single unpaired electron. Falls out
  // without a special case: cyclopentadienyl radical counts five and is
  // correctly not aromatic.
  if (atom.charge === 0 && element === "C" && atom.radicalElectrons === 1) {
    return 1;
  }

  // 11. A plain saturated carbon, a metal, anything the table does not name.
  return undefined;
}

// ---------------------------------------------------------------------------
// Kekulisation
// ---------------------------------------------------------------------------

/** Whether any atom or bond carries perception brought in from outside. */
export function hasAromaticFlags(mol: Molecule): boolean {
  for (const id of mol.atomIds) if (mol.atoms[id]?.aromatic) return true;
  for (const id of mol.bondIds) if (mol.bonds[id]?.aromatic) return true;
  return false;
}

export interface KekulizeResult {
  readonly molecule: Molecule;
  /** Atoms in aromatic systems that could not be Kekulised. Those systems
   *  are returned untouched rather than partially assigned. */
  readonly unkekulizedAtomIds: readonly AtomId[];
}

/**
 * Converts imported aromatic flags to the Kekule storage form.
 *
 * Never throws, and returns `mol` itself when there is nothing to convert, so
 * it is free to call defensively.
 */
export function kekulize(mol: Molecule): Molecule {
  return kekulizeWithReport(mol).molecule;
}

/**
 * `kekulize` plus a diagnostic.
 *
 * ELEMENT COUNTS. Kekulisation preserves `elementCounts()` for every molecule
 * whose flagged form was readable in the first place, and that is the contract
 * to hold it to. Thiophene and selenophene were the documented exceptions
 * until `valence.ts` learned RDKit's rule for resolving the half-integer an
 * aromatic bond leaves at a multi-valence heteroatom; both now read the same
 * formula either side of the call, and an importer no longer has to kekulise
 * first to get the hydrogens right.
 *
 * A component that FAILS is returned untouched, flags intact, so its formula
 * does not move either. What still moves is a component that succeeds through
 * the ambiguous-charged-centre second reading below: tropylium goes C7H6+
 * flagged to C7H7+ Kekulised, and cyclopentadienide C5H4- to C5H5-. Those
 * centres sit exactly ON their charge-adjusted valence, where two aromatic
 * bonds already account for the 3 they are allowed, so the flagged form cannot
 * say whether the atom wants a hydrogen or a double bond and Kekulisation is
 * what settles it. A caller comparing formulas across this call should expect
 * those, and only those, to change.
 *
 * FAILURE BEHAVIOUR. The aromatic subgraph is split into connected components
 * and each is matched independently; a component with no perfect matching is
 * left byte-for-byte as it arrived, flags intact and orders untouched, and its
 * atoms are reported. Nothing partial is ever written — a half-assigned ring
 * changes `elementCounts()`, which is strictly worse than leaving the molecule
 * in the form it came in. The diagnostic is returned rather than thrown so an
 * importer chewing through a large SDF can warn about one ambiguous ring
 * instead of losing the whole structure.
 */
export function kekulizeWithReport(mol: Molecule): KekulizeResult {
  if (!hasAromaticFlags(mol)) return { molecule: mol, unkekulizedAtomIds: [] };

  const adj = adjacency(mol);
  const matchedBondIds = new Set<BondId>();
  const failedBondIds = new Set<BondId>();
  const unkekulizedAtomIds: AtomId[] = [];

  for (const component of aromaticComponents(mol)) {
    const matched = matchComponent(mol, component);
    if (matched) {
      for (const id of matched) matchedBondIds.add(id);
    } else {
      for (const id of component.bondIds) failedBondIds.add(id);
      for (const id of component.atomIds) unkekulizedAtomIds.push(id);
    }
  }

  let changed = false;
  const nextBonds: Record<BondId, Bond> = {};
  for (const id of mol.bondIds) {
    const bond = requireBond(mol, id);
    if (!bond.aromatic || failedBondIds.has(id)) {
      // Reused by reference so structural sharing survives.
      nextBonds[id] = bond;
      continue;
    }
    const order: BondOrder = matchedBondIds.has(id) ? 2 : 1;
    // Spread rather than assignment: molecules are immutable and shared with
    // the undo stack, and spreading is also the only copy that preserves an
    // absent optional key under exactOptionalPropertyTypes.
    nextBonds[id] = { ...bond, order, aromatic: false };
    changed = true;
  }

  const nextAtoms: Record<AtomId, Atom> = {};
  for (const id of mol.atomIds) {
    const atom = requireAtom(mol, id);
    // An atom keeps its flag exactly while it still has an aromatic bond, so
    // atoms in a failed component keep theirs and the rest are cleared.
    let stillAromatic = false;
    if (atom.aromatic) {
      for (const bondId of adj.bondsAt[id] ?? []) {
        if (nextBonds[bondId]?.aromatic) {
          stillAromatic = true;
          break;
        }
      }
    }
    if (atom.aromatic && !stillAromatic) {
      nextAtoms[id] = { ...atom, aromatic: false };
      changed = true;
    } else {
      nextAtoms[id] = atom;
    }
  }

  if (!changed) return { molecule: mol, unkekulizedAtomIds };
  return {
    molecule: { ...mol, atoms: nextAtoms, bonds: nextBonds },
    unkekulizedAtomIds,
  };
}

interface AromaticComponent {
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
}

/**
 * Connected components of the aromatic-flagged subgraph, in `mol.atomIds`
 * order.
 *
 * Splitting first is what localises failure: biphenyl gives two components
 * because its inter-ring bond is not flagged, so one un-Kekulisable
 * heterocycle in an imported file cannot stop the rest of the molecule from
 * being written out. Iterative for the same reason `reachableFrom` is.
 */
function aromaticComponents(mol: Molecule): AromaticComponent[] {
  const adj = adjacency(mol);
  const seen = new Set<AtomId>();
  const components: AromaticComponent[] = [];

  for (const start of mol.atomIds) {
    if (seen.has(start)) continue;
    const incident = adj.bondsAt[start] ?? [];
    let hasAromaticBond = false;
    for (const id of incident) {
      if (mol.bonds[id]?.aromatic) {
        hasAromaticBond = true;
        break;
      }
    }
    if (!hasAromaticBond) continue;

    const atomIds: AtomId[] = [start];
    const bondIds: BondId[] = [];
    const bondSeen = new Set<BondId>();
    seen.add(start);
    let head = 0;
    while (head < atomIds.length) {
      const current = atomIds[head++]!;
      for (const bondId of adj.bondsAt[current] ?? []) {
        const bond = mol.bonds[bondId];
        if (!bond?.aromatic) continue;
        if (!bondSeen.has(bondId)) {
          bondSeen.add(bondId);
          bondIds.push(bondId);
        }
        const next = otherEnd(bond, current);
        if (seen.has(next)) continue;
        seen.add(next);
        atomIds.push(next);
      }
    }
    components.push({ atomIds, bondIds });
  }
  return components;
}

/**
 * Whether this atom must be given one ring double bond for its valence to
 * come out right.
 *
 * THE SIGMA FRAMEWORK IS COUNTED DIRECTLY, not through
 * `implicitHydrogenCount`. Every aromatic bond is read as the single bond it
 * becomes if this atom is NOT the one given the double, and a hydrogen counts
 * only where the importer pinned it. Deriving hydrogens instead reads the
 * flagged molecule through valence.ts's 1.5-per-aromatic-bond sum, which
 * invents one on thiophene's sulfur — a phantom that has no business deciding
 * the bond orders that then determine the real hydrogen count.
 *
 * THE OPERATIVE VALENCE IS THE SMALLEST ONE AT OR ABOVE THE FRAMEWORK, not
 * `maxValence`. Reading the maximum is what failed thiopyrylium: S+ allows 3,
 * 5 or 7, and against 7 a two-connected sulfur looks like it has five units of
 * room rather than the one that says "take a double bond", so it was left out
 * of the matching and the five carbons left over had odd parity. Sulfur's
 * lower valence is the operative one there, exactly as oxygen's only valence
 * is in pyrylium. Thiophene's neutral sulfur is unaffected and for a better
 * reason than before: its framework of 2 already IS a sulfur valence, so there
 * is no room at all and it donates a lone pair instead.
 *
 * ANY room means a double bond, not exactly one unit of it — a benzene carbon
 * has a framework of 2 against a valence of 4, since its hydrogen is not
 * pinned either. What forces the atom to actually take one is `matchComponent`
 * demanding a PERFECT matching over everything this returns true for, which is
 * how RDKit reads a flagged ring too.
 *
 * NOT RELIABLE FOR A CHARGED CENTRE. Tropylium's C+ has a framework of 2
 * against the 3 its charge-adjusted valence allows, so this returns true where
 * the truth is [cH+] with no double bond at all. `matchComponent` handles the
 * resulting failure; see the comment there.
 */
function needsRingDouble(mol: Molecule, atomId: AtomId): boolean {
  // A pi bond outside the aromatic subgraph has already spent this atom's p
  // orbital: an aromatic ring carbon bearing an exocyclic C=O must not also
  // be handed a ring double bond, or the formula changes.
  for (const bond of bondsAt(mol, atomId)) {
    if (!bond.aromatic && bond.order >= 2) return false;
  }
  const atom = requireAtom(mol, atomId);
  let sigma = atom.radicalElectrons + (atom.explicitHydrogenCount ?? 0);
  for (const bond of bondsAt(mol, atomId)) sigma += bond.aromatic ? 1 : bond.order;

  for (const valence of chargeAdjustedValences(mol, atomId)) {
    if (valence >= sigma) return valence > sigma;
  }
  // Fell off the end: a metal, which carries no default valence, or an atom
  // already past its highest one. Neither is treated as needing anything.
  return false;
}

/** Bounds the backtracking search. Aromatic systems have degree <= 3 and few
 *  Kekule structures, so a real molecule finds one in near-linear time;
 *  exhausting the budget is treated exactly like "no matching exists". */
const MAX_MATCH_STEPS = 200_000;

/**
 * The bond ids to promote to double bonds, or `undefined` when the component
 * admits no perfect matching over the atoms that need one.
 *
 * A perfect matching by backtracking, not general-graph Blossom: molecular
 * aromatic systems are sparse enough that the search terminates immediately,
 * and this is what RDKit does too. Greedy pairing is NOT sufficient — in
 * naphthalene a locally fine first choice strands a fusion carbon with both
 * of its eligible neighbours already taken.
 *
 * Atoms are visited in `mol.atomIds` order and partners in bond order, so the
 * chosen Kekule structure is deterministic. That matters because the
 * double-bond placement is visible in the drawing.
 */
function matchComponent(
  mol: Molecule,
  component: AromaticComponent,
): BondId[] | undefined {
  const needing = component.atomIds.filter((id) => needsRingDouble(mol, id));
  const direct = matchNeeding(mol, component, needing);
  if (direct) return direct;

  // Second reading for the charged centres `needsRingDouble` cannot resolve.
  // Tropylium's C+ has a sigma framework of 2 against the 3 its charge-adjusted
  // valence allows, so it is told it needs a ring double bond with no way of
  // knowing a hydrogen would fill the gap. Both readings are valence-consistent
  // ([c+] taking the double bond, or [cH+] taking a hydrogen), which is the
  // same ambiguity pyrrole's N-H has, and molfiles carry no hydrogen-count
  // field to settle it. It is settled here by outcome instead: the strict
  // reading has just failed, and for tropylium, cyclopentadienide and the
  // cyclopropenyl cation it fails by making the count odd, so prefer the
  // reading that admits a Kekule structure at all over returning none.
  const ambiguous = new Set(
    needing.filter((id) => isAmbiguousChargedCentre(mol, id)),
  );
  if (ambiguous.size === 0) return undefined;
  return matchNeeding(
    mol,
    component,
    needing.filter((id) => !ambiguous.has(id)),
  );
}

/**
 * A charged ring atom whose flagged bond-order sum already saturates its
 * charge-adjusted valence, so `implicitHydrogenCount` reports zero hydrogens
 * and cannot say whether the atom wants one instead of a double bond. A pinned
 * `explicitHydrogenCount` removes the ambiguity, so an atom that has one is
 * never treated as ambiguous.
 */
function isAmbiguousChargedCentre(mol: Molecule, atomId: AtomId): boolean {
  const atom = requireAtom(mol, atomId);
  if (atom.charge === 0 || atom.explicitHydrogenCount !== undefined) {
    return false;
  }
  const max = maxValence(mol, atomId);
  return max !== Infinity && bondOrderSum(mol, atomId) === max;
}

function matchNeeding(
  mol: Molecule,
  component: AromaticComponent,
  needing: readonly AtomId[],
): BondId[] | undefined {
  const inNeed = new Set<AtomId>(needing);
  if (needing.length === 0) return [];

  // Two O(1) prunes that catch every real failure before a single bond order
  // is written. An odd count is the unmarked-pyrrole case: its nitrogen is
  // mistaken for one that needs a double bond, so all five ring atoms do.
  if (needing.length % 2 === 1) return undefined;

  const eligible = new Map<AtomId, Bond[]>();
  for (const id of needing) eligible.set(id, []);
  for (const bondId of component.bondIds) {
    const bond = requireBond(mol, bondId);
    if (!inNeed.has(bond.from) || !inNeed.has(bond.to)) continue;
    eligible.get(bond.from)!.push(bond);
    eligible.get(bond.to)!.push(bond);
  }
  for (const id of needing) {
    if ((eligible.get(id) ?? []).length === 0) return undefined;
  }

  const partner = new Map<AtomId, AtomId>();
  const bondOf = new Map<AtomId, BondId>();
  const unpair = (atom: AtomId): void => {
    const other = partner.get(atom);
    if (other === undefined) return;
    partner.delete(atom);
    partner.delete(other);
    bondOf.delete(atom);
    bondOf.delete(other);
  };

  // Every atom before the current frame's is matched, so the scan for the
  // next open atom can start just past it rather than at zero — otherwise
  // the walk down a successful path is quadratic in the component size.
  const nextOpen = (from: number): number => {
    for (let i = from; i < needing.length; i++) {
      if (!partner.has(needing[i]!)) return i;
    }
    return -1;
  };

  // Iterative with an explicit frame stack. Recursion depth here is half the
  // component size, and a large fused aromatic system from an SDF is exactly
  // the input that would blow the stack — the same trap molecule.ts documents
  // for its old recursive `buildTree`.
  const frames: { readonly index: number; choice: number }[] = [
    { index: 0, choice: 0 },
  ];
  let steps = 0;

  while (frames.length > 0) {
    if (++steps > MAX_MATCH_STEPS) return undefined;
    const frame = frames[frames.length - 1]!;
    const atom = needing[frame.index]!;
    // Undo whatever this frame chose last time before trying the next option.
    unpair(atom);

    const options = eligible.get(atom) ?? [];
    if (frame.choice >= options.length) {
      frames.pop();
      continue;
    }
    const bond = options[frame.choice++]!;
    const other = otherEnd(bond, atom);
    if (partner.has(other)) continue;

    partner.set(atom, other);
    partner.set(other, atom);
    bondOf.set(atom, bond.id);
    bondOf.set(other, bond.id);

    const open = nextOpen(frame.index + 1);
    if (open === -1) {
      const chosen = new Set<BondId>();
      for (const id of bondOf.values()) chosen.add(id);
      return [...chosen];
    }
    frames.push({ index: open, choice: 0 });
  }
  return undefined;
}
