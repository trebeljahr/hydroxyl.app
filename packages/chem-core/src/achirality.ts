/**
 * Achirality, PROVED by an explicit atom mapping, never inferred from letters.
 *
 * WHY NOT DESCRIPTORS. Mirroring a molecule turns every R into S and every S
 * into R, so the descriptor multiset of meso-tartaric acid, {R, S}, is the
 * multiset of its mirror image — and so is the multiset of (2R,3S)-pentane-
 * 2,3-diol, which is chiral. The two compare equal on descriptors; the
 * criterion is neither necessary nor sufficient. What distinguishes them is
 * WHICH atom maps onto which: tartaric acid's C2 and C3 carry the same
 * substituents and can be exchanged, pentanediol's carry a methyl and an
 * ethyl and cannot.
 *
 * THE PROOF. A molecule is achiral when some automorphism σ of its heavy-atom
 * graph (symmetry.ts: explicit protium folded into hydrogen counts; element,
 * charge, isotope, radicals, hydrogen count and bond orders preserved) carries
 * the MIRROR IMAGE onto the molecule:
 *
 *   centre c        the parity σ(c) has against σ applied to c's ligand order
 *                   equals MINUS c's parity. A centre σ fixes needs only that
 *                   σ permutes its ligands oddly, whatever its parity.
 *   double bond b   σ(b) has, against σ applied to b's reference atoms, the
 *                   same cis/trans relation b has. A bond σ fixes needs only
 *                   that σ swaps its references an even number of times.
 *
 * The result carries σ as `mapping`, so a caller (the projection harness) can
 * check the claim atom by atom.
 *
 * UNDETERMINED, NOT GUESSED:
 *
 *   `unrepresentable-stereo`  the molecule has an axis or plane stereo-axes.ts
 *                             reports; its configuration is not in StereoConfig.
 *   `unspecified-unit`        no automorphism proves it achiral outright, and
 *                             some automorphism would if a unit whose reading
 *                             is missing (no wedge, a wavy bond, an ambiguous
 *                             drawing) had the right configuration.
 *   `search-truncated`        the automorphism search reached
 *                             `MAX_AUTOMORPHISM_SEARCH_NODES` (100000
 *                             candidate assignments) before finishing.
 *
 * `chiral` is returned only when the search finished and no automorphism,
 * under ANY configuration of the unread units, maps the mirror image onto the
 * molecule. An unwedged butan-2-ol is therefore `chiral`: it is chiral
 * whichever enantiomer it is.
 *
 * THE SEARCH is backtracking over colour-refinement classes, atoms taken in
 * breadth-first order from the stereogenic units so each new atom is a
 * neighbour of an assigned one and stereo constraints prune early. The bound
 * makes it total: a symmetric molecule with many interchangeable groups can
 * reach it, and then says so.
 */

import { isProtiumAtom } from "./cip.js";
import { requireBond } from "./molecule.js";
import { stereoConfig, type CentreConfig, type DoubleBondConfig } from "./stereo-config.js";
import { symmetryGraph } from "./symmetry.js";
import type { AtomId, Molecule } from "./types.js";

export type AchiralityResult =
  | { readonly kind: "achiral"; readonly mapping: ReadonlyMap<AtomId, AtomId> }
  | { readonly kind: "chiral" }
  | {
      readonly kind: "undetermined";
      readonly reason: "unrepresentable-stereo" | "unspecified-unit" | "search-truncated";
    };

/** Candidate assignments the automorphism search may try before it gives up. */
export const MAX_AUTOMORPHISM_SEARCH_NODES = 100000;

type Verdict = "ok" | "fail" | "unknown";

/** A ligand key: a heavy atom id, or "H" / "LP". */
function centreKeys(mol: Molecule, centre: CentreConfig): string[] {
  const keys = centre.order.map((id) => (isProtiumAtom(mol, id) ? "H" : id));
  if (centre.implicitHydrogen) keys.push("H");
  if (centre.lonePair) keys.push("LP");
  return keys;
}

function permutationSign(from: readonly string[], to: readonly string[]): 1 | -1 | undefined {
  if (from.length !== to.length) return undefined;
  const perm: number[] = [];
  for (const key of to) {
    const index = from.indexOf(key);
    if (index < 0 || perm.includes(index)) return undefined;
    perm.push(index);
  }
  let inversions = 0;
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) if (perm[i]! > perm[j]!) inversions++;
  }
  return inversions % 2 === 0 ? 1 : -1;
}

export interface AchiralityOptions {
  /** Lower the search bound; for tests of the bound. Never raised past the default. */
  readonly maxSearchNodes?: number;
}

export function isAchiral(mol: Molecule, options: AchiralityOptions = {}): AchiralityResult {
  const limit = Math.min(options.maxSearchNodes ?? MAX_AUTOMORPHISM_SEARCH_NODES, MAX_AUTOMORPHISM_SEARCH_NODES);
  const config = stereoConfig(mol);
  if (config.unrepresentable.length > 0) {
    return { kind: "undetermined", reason: "unrepresentable-stereo" };
  }
  const graph = symmetryGraph(mol);
  const centres = new Map(config.centres.map((c) => [c.atomId, c]));
  const bondsByAtoms = new Map<string, DoubleBondConfig>();
  const pairKey = (a: AtomId, b: AtomId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const unit of config.doubleBonds) {
    const bond = requireBond(mol, unit.bondId);
    bondsByAtoms.set(pairKey(bond.from, bond.to), unit);
  }

  const sigma = new Map<AtomId, AtomId>();
  const image = new Set<AtomId>();
  const mapKey = (key: string): string => (key === "H" || key === "LP" ? key : sigma.get(key) ?? "?");
  const mapped = (key: string): boolean => key === "H" || key === "LP" || sigma.has(key);

  const checkCentre = (c: CentreConfig): Verdict | undefined => {
    const keys = centreKeys(mol, c);
    if (!sigma.has(c.atomId) || !keys.every(mapped)) return undefined;
    const target = centres.get(sigma.get(c.atomId)!);
    if (target === undefined) return "fail";
    const permutation = permutationSign(centreKeys(mol, target), keys.map(mapKey));
    if (permutation === undefined) return "fail";
    if (target === c) return permutation === -1 ? "ok" : "fail";
    if (c.reading.kind !== "specified" || target.reading.kind !== "specified") return "unknown";
    return target.reading.parity * permutation === -c.reading.parity ? "ok" : "fail";
  };

  const refKey = (atomId: AtomId): string => (isProtiumAtom(mol, atomId) ? "H" : atomId);

  const checkBond = (b: DoubleBondConfig): Verdict | undefined => {
    const bond = requireBond(mol, b.bondId);
    const refFrom = refKey(b.refOnFrom);
    const refTo = refKey(b.refOnTo);
    if (![bond.from, bond.to, refFrom, refTo].every(mapped)) return undefined;
    const from = sigma.get(bond.from)!;
    const to = sigma.get(bond.to)!;
    const target = bondsByAtoms.get(pairKey(from, to));
    if (target === undefined) return "fail";
    const targetBond = requireBond(mol, target.bondId);
    const refAt = (atomId: AtomId): string =>
      refKey(atomId === targetBond.from ? target.refOnFrom : target.refOnTo);
    const flips =
      (mapKey(refFrom) === refAt(from) ? 0 : 1) + (mapKey(refTo) === refAt(to) ? 0 : 1);
    if (target === b) return flips % 2 === 0 ? "ok" : "fail";
    if (b.reading.kind !== "specified" || target.reading.kind !== "specified") return "unknown";
    const same = target.reading.relation === b.reading.relation;
    return same === (flips % 2 === 0) ? "ok" : "fail";
  };

  // Order: breadth first from the stereogenic atoms, then any remaining atoms.
  const unitAtoms = [
    ...config.centres.map((c) => c.atomId),
    ...config.doubleBonds.flatMap((b) => {
      const bond = requireBond(mol, b.bondId);
      return [bond.from, bond.to];
    }),
  ].filter((id) => graph.neighbours.has(id));
  const order: AtomId[] = [];
  const placed = new Set<AtomId>();
  const parentOf = new Map<AtomId, AtomId | undefined>();
  const visitFrom = (start: AtomId): void => {
    if (placed.has(start)) return;
    placed.add(start);
    parentOf.set(start, undefined);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const other of graph.neighbours.get(id)!.keys()) {
        if (placed.has(other)) continue;
        placed.add(other);
        parentOf.set(other, id);
        queue.push(other);
      }
    }
  };
  for (const id of unitAtoms) visitFrom(id);
  for (const id of graph.atomIds) visitFrom(id);

  // Units checked once every atom they read is assigned, keyed by that step.
  const dueAt = new Map<number, { centres: CentreConfig[]; bonds: DoubleBondConfig[] }>();
  const position = new Map(order.map((id, i) => [id, i]));
  const due = (ids: readonly string[]): number =>
    Math.max(...ids.filter((id) => id !== "H" && id !== "LP").map((id) => position.get(id) ?? 0));
  for (const c of config.centres) {
    const step = due([c.atomId, ...centreKeys(mol, c)]);
    const slot = dueAt.get(step) ?? { centres: [], bonds: [] };
    slot.centres.push(c);
    dueAt.set(step, slot);
  }
  for (const b of config.doubleBonds) {
    const bond = requireBond(mol, b.bondId);
    const step = due([bond.from, bond.to, refKey(b.refOnFrom), refKey(b.refOnTo)]);
    const slot = dueAt.get(step) ?? { centres: [], bonds: [] };
    slot.bonds.push(b);
    dueAt.set(step, slot);
  }

  let nodes = 0;
  let truncated = false;
  let sawUnknown = false;

  const consistent = (u: AtomId, v: AtomId): boolean => {
    if (graph.colour.get(u) !== graph.colour.get(v)) return false;
    const uN = graph.neighbours.get(u)!;
    const vN = graph.neighbours.get(v)!;
    for (const [w, order] of uN) {
      const sw = sigma.get(w);
      if (sw === undefined) continue;
      if (vN.get(sw) !== order) return false;
    }
    // No assigned neighbour of v may be the image of a non-neighbour of u.
    let assignedU = 0;
    for (const w of uN.keys()) if (sigma.has(w)) assignedU++;
    let assignedV = 0;
    for (const w of vN.keys()) if (image.has(w)) assignedV++;
    return assignedU === assignedV;
  };

  const search = (k: number, unknown: boolean): boolean => {
    if (k === order.length) {
      if (unknown) {
        sawUnknown = true;
        return false;
      }
      return true;
    }
    const u = order[k]!;
    const parent = parentOf.get(u);
    const candidates =
      parent === undefined
        ? graph.atomIds.filter((id) => !image.has(id))
        : [...graph.neighbours.get(sigma.get(parent)!)!.keys()].filter((id) => !image.has(id));
    for (const v of candidates) {
      if (++nodes > limit) {
        truncated = true;
        return false;
      }
      if (!consistent(u, v)) continue;
      sigma.set(u, v);
      image.add(v);
      let verdict: Verdict = "ok";
      const slot = dueAt.get(k);
      for (const c of slot?.centres ?? []) {
        const result = checkCentre(c) ?? "ok";
        if (result === "fail") verdict = "fail";
        else if (result === "unknown" && verdict === "ok") verdict = "unknown";
        if (verdict === "fail") break;
      }
      if (verdict !== "fail") {
        for (const b of slot?.bonds ?? []) {
          const result = checkBond(b) ?? "ok";
          if (result === "fail") verdict = "fail";
          else if (result === "unknown" && verdict === "ok") verdict = "unknown";
          if (verdict === "fail") break;
        }
      }
      if (verdict !== "fail" && search(k + 1, unknown || verdict === "unknown")) return true;
      sigma.delete(u);
      image.delete(v);
      if (truncated) return false;
    }
    return false;
  };

  if (search(0, false)) return { kind: "achiral", mapping: new Map(sigma) };
  if (truncated) return { kind: "undetermined", reason: "search-truncated" };
  if (sawUnknown) return { kind: "undetermined", reason: "unspecified-unit" };
  return { kind: "chiral" };
}
