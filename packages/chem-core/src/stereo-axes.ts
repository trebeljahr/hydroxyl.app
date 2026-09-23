/**
 * Stereogenic axes and planes: configuration that neither a tetrahedral
 * parity nor a cis/trans relation can state, REPORTED so it is never mistaken
 * for "nothing to say".
 *
 * WHY. StereoConfig records centres and double bonds. An allene, an
 * atropisomeric biaryl, a spirane, a planar-chiral cyclophane and a helicene
 * are chiral with none of those, so their StereoConfig is empty and would read
 * as achiral. A natural-products author meets one on the first day. This module
 * names the element and the reason; stereo.ts surfaces it through
 * `structuralIssues` as an `unrepresentable-stereo` warning, stereo-config.ts
 * carries it on every topology and config, and achirality.ts refuses to decide
 * a molecule that has one.
 *
 * CONSERVATIVE, DOCUMENTED CRITERIA. Graph-only: nothing here reads a
 * coordinate, so a drawing cannot move a molecule in or out of the report.
 * Each criterion states its threshold, and the thresholds marked ESCALATED are
 * choices awaiting a ruling.
 *
 *   ALLENE AXIS / CUMULENE. A maximal chain of k ≥ 2 cumulated double bonds
 *   whose two terminal atoms each carry exactly two substituents (atoms or
 *   implicit hydrogens) that are not proven identical by CIP rules 1-2. Even k
 *   (penta-2,3-diene) is an axis; odd k (hexa-2,3,4-triene) is cis/trans across
 *   the chain, which the double-bond units in cip.ts do not cover either.
 *   1,1-dimethylallene is not reported: one terminal's substituents tie.
 *
 *   BIARYL AXIS. An acyclic single bond joining two aromatic ring atoms that
 *   each have three heavy neighbours, with at least
 *   `BIARYL_MIN_ORTHO_SUBSTITUENTS` (2, ESCALATED) ortho positions occupied
 *   across both rings, and on EACH side the two ortho branches not proven
 *   identical. An ortho position is occupied when that ring neighbour has a
 *   heavy atom outside the ring, a ring-fusion atom included. BINOL and BINAP
 *   count 4 and are reported; plain 1,1'-binaphthyl counts 2 (its two fusion
 *   atoms) and is reported too, which is the reason the threshold is 2 and not
 *   3 — 1,1'-binaphthyl racemises slowly enough to be resolved, and its axis is
 *   exactly what this build cannot express. Biphenyl (0) and 2-methylbiphenyl
 *   (1) are not reported, and 2,2',6,6'-tetramethylbiphenyl, though it counts
 *   4, is symmetric on both sides and is not reported either. The cost of 2 is
 *   the other direction: a freely rotating 2,2'-disubstituted biphenyl is
 *   reported although it is not resolvable at room temperature. A warning that
 *   names an axis nobody can isolate is the cheaper error, since the other
 *   error is an empty config read as achiral.
 *
 *   SPIRO AXIS. A spiro atom (rings.ts) in exactly two rings, with the two
 *   ring neighbours in EACH ring not proven identical, that is not already a
 *   ranked tetrahedral centre. 1,1'-spirobiindane is reported. Spiro[4.4]nonane
 *   is not. KNOWN LIMIT: Fecht's acid (spiro[3.3]heptane-2,6-dicarboxylic
 *   acid) is axially chiral but its spiro atom's ring neighbours are identical
 *   CH2 groups, and it is not reported.
 *
 *   PLANAR CYCLOPHANE. A benzene-like aromatic six-ring whose meta or para
 *   ring atoms are joined, outside the ring, by a bridge of at most
 *   `CYCLOPHANE_MAX_BRIDGE_ATOMS` (10, ESCALATED) atoms, and whose atoms are
 *   not symmetric (by colour refinement, symmetry.ts) under the reflections
 *   that keep the bridge's attachment. Unsubstituted [2.2]paracyclophane is not
 *   reported; 4-bromo[2.2]paracyclophane is.
 *
 *   HELICENE. A run of ortho-fused aromatic six-rings, every inner ring fused
 *   angularly (its two fusion bonds one bond apart, that bond fused to nothing
 *   else) and every turn the same way (the inner rim is one continuous path),
 *   of at least `HELICENE_MIN_RINGS` (6, ESCALATED) rings. [6]helicene is
 *   reported; phenanthrene, chrysene and picene (zigzag) and [5]helicene
 *   (under the threshold) are not. Coronene-like closed rims are excluded by
 *   the "fused to nothing else" condition.
 *
 * COST. `structuralIssues` runs every editor frame, so the result is memoised
 * on cip.ts's topology fingerprint (a drag reuses it) and each criterion is
 * skipped outright when the molecule has no cumulated atom, no aromatic ring
 * or no spiro atom.
 */

import { cipTopologyFingerprint, cipUnits, rankSubstituentPair } from "./cip.js";
import { aromaticRings, isAromaticAtom } from "./aromatic.js";
import { bondBetween, bondsAt, otherEnd } from "./molecule.js";
import { isRingBond, isSpiroAtom, LruCache, rings, ringsAtAtom, ringsAtBond } from "./rings.js";
import { compareIds } from "./selection.js";
import { atomSymmetryClasses } from "./symmetry.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount, isProtiumAtom } from "./valence.js";

export type UnrepresentableStereoKind =
  | "allene-axis"
  | "cumulene-cis-trans"
  | "biaryl-axis"
  | "spiro-axis"
  | "planar-cyclophane"
  | "helicene";

export interface UnrepresentableStereoElement {
  readonly kind: UnrepresentableStereoKind;
  /** The atom to badge: the allene's centre, a biaryl axis atom, the spiro atom, a ring atom. */
  readonly anchorAtomId: AtomId;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  /** A sentence for a chemist naming what was found. */
  readonly reason: string;
}

/** Occupied ortho positions, across both rings, at which a biaryl bond is reported. */
export const BIARYL_MIN_ORTHO_SUBSTITUENTS = 2;

/** The longest bridge, in atoms, that still holds a cyclophane's ring in place. */
export const CYCLOPHANE_MAX_BRIDGE_ATOMS = 10;

/** The shortest helicene reported, in rings. */
export const HELICENE_MIN_RINGS = 6;

function notIdentical(mol: Molecule, centre: AtomId, a: AtomId, b: AtomId): boolean {
  return rankSubstituentPair(mol, centre, a, b).kind !== "identical";
}

// ---------------------------------------------------------------------------
// Allenes and cumulenes
// ---------------------------------------------------------------------------

function isCumulatedCentre(mol: Molecule, atomId: AtomId): boolean {
  const bonds = bondsAt(mol, atomId);
  return bonds.length === 2 && bonds.every((bond) => bond.order === 2);
}

/** Two non-identical substituents at a cumulene terminal, reached over `chainBond`. */
function stereogenicTerminal(mol: Molecule, atomId: AtomId, chainBond: BondId): boolean {
  const others = bondsAt(mol, atomId).filter((bond) => bond.id !== chainBond);
  if (others.some((bond) => bond.order !== 1)) return false;
  const heavy = others.map((bond) => otherEnd(bond, atomId)).filter((id) => !isProtiumAtom(mol, id));
  const hydrogens = implicitHydrogenCount(mol, atomId) + (others.length - heavy.length);
  if (heavy.length + hydrogens !== 2) return false;
  if (heavy.length === 2) return notIdentical(mol, atomId, heavy[0]!, heavy[1]!);
  return heavy.length === 1;
}

function cumulenes(mol: Molecule): UnrepresentableStereoElement[] {
  const out: UnrepresentableStereoElement[] = [];
  const seen = new Set<string>();
  for (const centre of mol.atomIds) {
    if (!isCumulatedCentre(mol, centre)) continue;
    // Walk both ways to the terminals.
    const walk = (from: AtomId, bondId: BondId): { atoms: AtomId[]; bonds: BondId[] } => {
      const atoms: AtomId[] = [];
      const bonds: BondId[] = [bondId];
      let previous = from;
      let bond = bondsAt(mol, from).find((b) => b.id === bondId)!;
      let current = otherEnd(bond, previous);
      while (isCumulatedCentre(mol, current) && current !== centre) {
        atoms.push(current);
        bond = bondsAt(mol, current).find((b) => b.id !== bond.id)!;
        bonds.push(bond.id);
        previous = current;
        current = otherEnd(bond, previous);
      }
      atoms.push(current);
      return { atoms, bonds };
    };
    const [left, right] = bondsAt(mol, centre);
    const a = walk(centre, left!.id);
    const b = walk(centre, right!.id);
    const terminalA = a.atoms[a.atoms.length - 1]!;
    const terminalB = b.atoms[b.atoms.length - 1]!;
    if (terminalA === centre || terminalB === centre || terminalA === terminalB) continue;
    const chainAtoms = [...a.atoms.slice(0, -1).reverse(), centre, ...b.atoms.slice(0, -1)];
    const key = [terminalA, terminalB].sort(compareIds).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const bondsA = a.bonds;
    const bondsB = b.bonds;
    if (!stereogenicTerminal(mol, terminalA, bondsA[bondsA.length - 1]!)) continue;
    if (!stereogenicTerminal(mol, terminalB, bondsB[bondsB.length - 1]!)) continue;
    const k = bondsA.length + bondsB.length;
    const even = k % 2 === 0;
    const middle = chainAtoms[Math.floor(chainAtoms.length / 2)]!;
    out.push({
      kind: even ? "allene-axis" : "cumulene-cis-trans",
      anchorAtomId: even ? middle : centre,
      atomIds: [terminalA, ...chainAtoms, terminalB],
      bondIds: [...[...bondsA].reverse(), ...bondsB],
      reason: even
        ? `${k} cumulated double bonds with unlike substituents at both ends make a stereogenic axis (allene)`
        : `${k} cumulated double bonds with unlike substituents at both ends have cis/trans isomers across the chain (cumulene)`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Biaryls
// ---------------------------------------------------------------------------

function orthoOccupied(mol: Molecule, axisAtom: AtomId, neighbour: AtomId): boolean {
  const bond = bondBetween(mol, axisAtom, neighbour);
  if (bond === undefined) return false;
  const ring = new Set<AtomId>();
  for (const index of ringsAtBond(mol, bond.id)) {
    for (const id of rings(mol)[index]!.atomIds) ring.add(id);
  }
  return bondsAt(mol, neighbour).some((b) => {
    const other = otherEnd(b, neighbour);
    return !ring.has(other) && !isProtiumAtom(mol, other);
  });
}

function heavyNeighbours(mol: Molecule, atomId: AtomId): AtomId[] {
  return bondsAt(mol, atomId)
    .map((bond) => otherEnd(bond, atomId))
    .filter((id) => !isProtiumAtom(mol, id));
}

function biaryls(mol: Molecule): UnrepresentableStereoElement[] {
  const out: UnrepresentableStereoElement[] = [];
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined || bond.order !== 1 || isRingBond(mol, bondId)) continue;
    const ends = [bond.from, bond.to] as const;
    if (!ends.every((id) => isAromaticAtom(mol, id))) continue;
    if (!ends.every((id) => heavyNeighbours(mol, id).length === 3 && implicitHydrogenCount(mol, id) === 0)) {
      continue;
    }
    let occupied = 0;
    let unsymmetric = true;
    for (const end of ends) {
      const ortho = heavyNeighbours(mol, end).filter((id) => id !== otherEnd(bond, end));
      if (ortho.length !== 2) {
        unsymmetric = false;
        break;
      }
      for (const id of ortho) if (orthoOccupied(mol, end, id)) occupied++;
      if (!notIdentical(mol, end, ortho[0]!, ortho[1]!)) unsymmetric = false;
    }
    if (!unsymmetric || occupied < BIARYL_MIN_ORTHO_SUBSTITUENTS) continue;
    out.push({
      kind: "biaryl-axis",
      anchorAtomId: bond.from,
      atomIds: [bond.from, bond.to],
      bondIds: [bondId],
      reason:
        `a biaryl bond with ${occupied} occupied ortho positions (threshold ` +
        `${BIARYL_MIN_ORTHO_SUBSTITUENTS}) and unsymmetric rings is a stereogenic axis (atropisomerism)`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spiranes
// ---------------------------------------------------------------------------

function spiranes(mol: Molecule): UnrepresentableStereoElement[] {
  const out: UnrepresentableStereoElement[] = [];
  let units: ReturnType<typeof cipUnits> | undefined;
  for (const atomId of mol.atomIds) {
    if (!isSpiroAtom(mol, atomId)) continue;
    const ringIndices = ringsAtAtom(mol, atomId);
    if (ringIndices.length !== 2) continue;
    const bonds = bondsAt(mol, atomId);
    if (bonds.length !== 4 || bonds.some((bond) => bond.order !== 1)) continue;
    let unsymmetric = true;
    for (const index of ringIndices) {
      const ring = rings(mol)[index]!;
      const at = ring.atomIds.indexOf(atomId);
      const previous = ring.atomIds[(at + ring.size - 1) % ring.size]!;
      const next = ring.atomIds[(at + 1) % ring.size]!;
      if (!notIdentical(mol, atomId, previous, next)) unsymmetric = false;
    }
    if (!unsymmetric) continue;
    units ??= cipUnits(mol);
    const unit = units.centreById.get(atomId);
    if (unit !== undefined && unit.constitution.kind !== "tied") continue;
    out.push({
      kind: "spiro-axis",
      anchorAtomId: atomId,
      atomIds: [atomId],
      bondIds: [],
      reason: "a spiro atom whose two rings are each unsymmetric about it is a stereogenic axis (spirane)",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cyclophanes
// ---------------------------------------------------------------------------

/** Atoms on the shortest path between `starts` and `goals` that avoids `blocked`, or undefined. */
function bridgeLength(
  mol: Molecule,
  starts: readonly AtomId[],
  goals: ReadonlySet<AtomId>,
  blocked: ReadonlySet<AtomId>,
): number | undefined {
  const distance = new Map<AtomId, number>();
  let frontier: AtomId[] = [];
  for (const id of starts) {
    if (blocked.has(id) || distance.has(id)) continue;
    distance.set(id, 1);
    frontier.push(id);
  }
  while (frontier.length > 0) {
    const next: AtomId[] = [];
    for (const id of frontier) {
      const d = distance.get(id)!;
      if (goals.has(id)) return d;
      if (d >= CYCLOPHANE_MAX_BRIDGE_ATOMS) continue;
      for (const bond of bondsAt(mol, id)) {
        const other = otherEnd(bond, id);
        if (blocked.has(other) || distance.has(other)) continue;
        distance.set(other, d + 1);
        next.push(other);
      }
    }
    frontier = next;
  }
  return undefined;
}

/**
 * The largest ring counted as fused rather than as a bridge. The smallest
 * cyclophane macrocycle, [1.1]paracyclophane's, has 10 atoms.
 */
const FUSED_RING_MAX_SIZE = 8;

/** Every atom of the fused ring system (rings of at most 8 atoms sharing a bond, transitively) that holds `ringIndex`. */
function fusedSystemAtoms(mol: Molecule, ringIndex: number): Set<AtomId> {
  const all = rings(mol);
  const seen = new Set<number>([ringIndex]);
  const stack = [ringIndex];
  const atoms = new Set<AtomId>();
  while (stack.length > 0) {
    const index = stack.pop()!;
    const ring = all[index]!;
    for (const id of ring.atomIds) atoms.add(id);
    for (const bondId of ring.bondIds) {
      for (const other of ringsAtBond(mol, bondId)) {
        // A cyclophane's own macrocycle shares bonds with its decks; it is
        // what a bridge closes, not a fused ring.
        if (seen.has(other) || all[other]!.size > FUSED_RING_MAX_SIZE) continue;
        seen.add(other);
        stack.push(other);
      }
    }
  }
  return atoms;
}

function componentOf(mol: Molecule, start: AtomId): Set<AtomId> {
  const seen = new Set<AtomId>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const bond of bondsAt(mol, id)) {
      const other = otherEnd(bond, id);
      if (seen.has(other)) continue;
      seen.add(other);
      stack.push(other);
    }
  }
  return seen;
}

function cyclophanes(mol: Molecule): UnrepresentableStereoElement[] {
  const all = rings(mol);
  const colour = atomSymmetryClasses(mol);
  const found: { atoms: readonly AtomId[]; anchor: AtomId; gap: 2 | 3; length: number }[] = [];
  for (const index of aromaticRings(mol)) {
    const ring = all[index]!;
    if (ring.size !== 6) continue;
    const atoms = ring.atomIds;
    // The bridge must leave the whole fused system: a path through a ring
    // fused to this one (coronene's rim) is not a bridge over its face.
    const system = fusedSystemAtoms(mol, index);
    const exo = atoms.map((id) =>
      bondsAt(mol, id)
        .map((bond) => otherEnd(bond, id))
        .filter((other) => !system.has(other) && !isProtiumAtom(mol, other)),
    );
    let reported = false;
    for (let i = 0; i < 6 && !reported; i++) {
      for (const gap of [2, 3] as const) {
        const j = (i + gap) % 6;
        if (gap === 3 && j < i) continue;
        if (exo[i]!.length === 0 || exo[j]!.length === 0) continue;
        const length = bridgeLength(mol, exo[i]!, new Set(exo[j]!), system);
        if (length === undefined) continue;
        const c = (k: number): number | undefined => colour.get(atoms[(i + k) % 6]!);
        let symmetric: boolean;
        if (gap === 3) {
          // Mirror through the two anchors, or across the anchor pair.
          const through = c(1) === c(5) && c(2) === c(4);
          const across = c(0) === c(3) && c(1) === c(2) && c(4) === c(5);
          symmetric = through || across;
        } else {
          symmetric = c(0) === c(2) && c(3) === c(5);
        }
        if (symmetric) continue;
        found.push({ atoms, anchor: atoms[i]!, gap, length });
        reported = true;
        break;
      }
    }
  }
  // One element per molecule component: a desymmetrising substituent on one
  // deck also splits the colours of the other deck, and a reader wants to be
  // told about the cyclophane once.
  const out: UnrepresentableStereoElement[] = [];
  const claimed = new Set<AtomId>();
  for (const hit of found) {
    if (claimed.has(hit.anchor)) continue;
    const component = componentOf(mol, hit.anchor);
    for (const id of component) claimed.add(id);
    const decks = found.filter((other) => component.has(other.anchor));
    out.push({
      kind: "planar-cyclophane",
      anchorAtomId: hit.anchor,
      atomIds: [...new Set(decks.flatMap((deck) => deck.atoms))],
      bondIds: [],
      reason:
        `an unsymmetric aromatic ring bridged ${hit.gap === 3 ? "para" : "meta"} by ${hit.length} ` +
        `atoms (threshold ${CYCLOPHANE_MAX_BRIDGE_ATOMS}) is a stereogenic plane (cyclophane)`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helicenes
// ---------------------------------------------------------------------------

function helicenes(mol: Molecule): UnrepresentableStereoElement[] {
  const all = rings(mol);
  const six = new Set(
    aromaticRings(mol).filter((index) => all[index]!.size === 6 && all[index]!.atomIds.every((id) => isAromaticAtom(mol, id))),
  );
  if (six.size < HELICENE_MIN_RINGS) return [];

  /** The other aromatic six-ring sharing exactly `bondId` with `ring`. */
  const across = (ring: number, bondId: BondId): number | undefined => {
    const others = ringsAtBond(mol, bondId).filter((index) => index !== ring && six.has(index));
    return others.length === 1 ? others[0] : undefined;
  };
  const bondAtomsShared = (bondA: BondId, bondB: BondId): AtomId | undefined => {
    const a = mol.bonds[bondA]!;
    const b = mol.bonds[bondB]!;
    if (a.from === b.from || a.from === b.to) return a.from;
    if (a.to === b.from || a.to === b.to) return a.to;
    return undefined;
  };

  const out: UnrepresentableStereoElement[] = [];
  const seen = new Set<string>();
  for (const first of six) {
    for (const fusion of all[first]!.bondIds) {
      const second = across(first, fusion);
      if (second === undefined) continue;
      for (const turn of [2, -2]) {
        const path = [first, second];
        const fusions = [fusion];
        let ring = second;
        let previousFusion = fusion;
        let innerAtom: AtomId | undefined;
        let direction = turn;
        for (;;) {
          const bondIds = all[ring]!.bondIds;
          const p = bondIds.indexOf(previousFusion);
          let chosen: { q: BondId; e: BondId; x: AtomId } | undefined;
          for (const d of innerAtom === undefined ? [direction] : [2, -2]) {
            const q = bondIds[(p + d + 6) % 6]!;
            const e = bondIds[(p + d / 2 + 6) % 6]!;
            const y = bondAtomsShared(e, previousFusion);
            const x = bondAtomsShared(e, q);
            if (y === undefined || x === undefined) continue;
            if (innerAtom !== undefined && y !== innerAtom) continue;
            chosen = { q, e, x };
            direction = d;
            break;
          }
          if (chosen === undefined) break;
          // The inner (bay/fjord) bond must be fused to nothing else.
          if (ringsAtBond(mol, chosen.e).length !== 1) break;
          const next = across(ring, chosen.q);
          if (next === undefined || path.includes(next)) break;
          path.push(next);
          fusions.push(chosen.q);
          previousFusion = chosen.q;
          innerAtom = chosen.x;
          ring = next;
        }
        if (path.length < HELICENE_MIN_RINGS) continue;
        const key = [...path].sort((x, y) => x - y).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const atomIds = [...new Set(path.flatMap((index) => all[index]!.atomIds))];
        out.push({
          kind: "helicene",
          anchorAtomId: all[path[Math.floor(path.length / 2)]!]!.atomIds[0]!,
          atomIds,
          bondIds: fusions,
          reason:
            `${path.length} ortho-fused aromatic rings turning the same way (threshold ` +
            `${HELICENE_MIN_RINGS}) make a helix (helicene)`,
        });
      }
    }
  }
  // A longer run found from one start contains the shorter runs found from others.
  return out.filter(
    (element) =>
      !out.some(
        (other) =>
          other !== element &&
          other.atomIds.length > element.atomIds.length &&
          element.atomIds.every((id) => other.atomIds.includes(id)),
      ),
  );
}

// ---------------------------------------------------------------------------
// Entry point and cache
// ---------------------------------------------------------------------------

function computeUnrepresentable(mol: Molecule): readonly UnrepresentableStereoElement[] {
  const out: UnrepresentableStereoElement[] = [];
  if (mol.atomIds.some((id) => isCumulatedCentre(mol, id))) out.push(...cumulenes(mol));
  if (aromaticRings(mol).length > 0) {
    out.push(...biaryls(mol), ...cyclophanes(mol), ...helicenes(mol));
  }
  if (mol.atomIds.some((id) => ringsAtAtom(mol, id).length >= 2)) out.push(...spiranes(mol));
  return Object.freeze(out.map((element) => Object.freeze(element)));
}

const BY_INSTANCE = new WeakMap<Molecule, readonly UnrepresentableStereoElement[]>();
const BY_FINGERPRINT = new LruCache<readonly UnrepresentableStereoElement[]>(32);

/**
 * Every stereogenic axis or plane in `mol` that no StereoConfig can express,
 * empty when there is none. Memoised on the topology.
 */
export function unrepresentableStereo(mol: Molecule): readonly UnrepresentableStereoElement[] {
  const hit = BY_INSTANCE.get(mol);
  if (hit !== undefined) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = BY_FINGERPRINT.get(key);
  if (shared !== undefined) {
    BY_INSTANCE.set(mol, shared);
    return shared;
  }
  const built = computeUnrepresentable(mol);
  BY_FINGERPRINT.set(key, built);
  BY_INSTANCE.set(mol, built);
  return built;
}
