/**
 * Which label a selection gets when it is contracted (decision 225).
 *
 * The atoms a stamp makes carry no memory of the stamp (decision 116 keeps
 * them ordinary atoms), so the label is recognised from the STRUCTURE: the
 * selection is matched against the functional-group table with its
 * attachment atom fixed. A Boc drawn bond by bond is recognised exactly like
 * a stamped one, which is the point — the label describes the atoms, never
 * how they got there.
 *
 * Two shapes are recognised:
 *
 *   - a table group itself: "Boc", "Ph", "TBS", "CO₂Me";
 *   - a heteroatom carrying one, which is how a scheme writes a protected
 *     alcohol or amine: "OTBS", "OBn", "NHBoc", "SPh". The heteroatom's own
 *     hydrogens are spelled out, so a carbamate nitrogen with one H reads
 *     "NHBoc" and a di-Boc nitrogen is not a single label at all.
 *
 * Anything else returns `undefined` and the caller asks the user for a label.
 */

import { canCollapseAbbreviation } from "./abbreviations.js";
import { FUNCTIONAL_GROUPS, FUNCTIONAL_GROUP_NAMES } from "./groups.js";
import type { FunctionalGroup } from "./groups.js";
import { bondsAt, otherEnd, requireAtom } from "./molecule.js";
import type { AtomId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";

/** The `FunctionalGroup` atoms as an adjacency list with bond orders. */
function specBonds(spec: FunctionalGroup): Map<number, Map<number, number>> {
  const adj = new Map<number, Map<number, number>>();
  const link = (a: number, b: number, order: number): void => {
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a)!.set(b, order);
    adj.get(b)!.set(a, order);
  };
  spec.atoms.forEach((atom, index) => {
    if (!adj.has(index)) adj.set(index, new Map());
    if (atom.from !== undefined) link(atom.from, index, atom.order ?? 1);
  });
  for (const [a, b, order] of spec.closures) link(a, b, order);
  return adj;
}

/** Bonds inside `inside`, by atom: neighbour -> order. */
function insideBonds(mol: Molecule, inside: ReadonlySet<AtomId>): Map<AtomId, Map<AtomId, number>> {
  const adj = new Map<AtomId, Map<AtomId, number>>();
  for (const id of inside) {
    const row = new Map<AtomId, number>();
    for (const bond of bondsAt(mol, id)) {
      const other = otherEnd(bond, id);
      if (inside.has(other)) row.set(other, bond.order);
    }
    adj.set(id, row);
  }
  return adj;
}

/** True when an atom is plain enough to be the table's atom of this element:
 *  same element and charge, nothing pinned, no radical, no isotope. */
function sameAtom(mol: Molecule, atomId: AtomId, spec: FunctionalGroup, index: number): boolean {
  const atom = requireAtom(mol, atomId);
  const want = spec.atoms[index]!;
  return (
    atom.element === want.element &&
    atom.charge === (want.charge ?? 0) &&
    atom.radicalElectrons === 0 &&
    atom.isotope === undefined &&
    atom.explicitHydrogenCount === undefined
  );
}

/**
 * Whether the atoms `inside` are exactly `spec`, with spec atom 0 on
 * `attachment`. Spec atoms are listed parent-first (every `from` is earlier),
 * so a depth-first assignment in index order only ever extends along a bond.
 */
function matches(
  mol: Molecule,
  inside: ReadonlySet<AtomId>,
  attachment: AtomId,
  spec: FunctionalGroup,
): boolean {
  if (spec.atoms.length !== inside.size) return false;
  const want = specBonds(spec);
  const have = insideBonds(mol, inside);
  let wantBonds = 0;
  for (const row of want.values()) wantBonds += row.size;
  let haveBonds = 0;
  for (const row of have.values()) haveBonds += row.size;
  if (wantBonds !== haveBonds) return false;

  const assigned: AtomId[] = [];
  const used = new Set<AtomId>();
  const consistent = (index: number, atomId: AtomId): boolean => {
    if (!sameAtom(mol, atomId, spec, index)) return false;
    // Every bond to an atom already placed must exist with the same order.
    for (const [other, order] of want.get(index) ?? []) {
      if (other >= index) continue;
      if (have.get(atomId)?.get(assigned[other]!) !== order) return false;
    }
    return true;
  };
  const place = (index: number): boolean => {
    if (index === spec.atoms.length) return true;
    const parent = spec.atoms[index]!.from;
    const candidates =
      parent === undefined ? [attachment] : [...(have.get(assigned[parent]!)?.keys() ?? [])];
    for (const atomId of candidates) {
      if (used.has(atomId) || !consistent(index, atomId)) continue;
      assigned[index] = atomId;
      used.add(atomId);
      if (place(index + 1)) return true;
      used.delete(atomId);
    }
    return false;
  };
  return place(0);
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** The table group these atoms are, attached at `attachment`. */
function tableLabel(mol: Molecule, inside: ReadonlySet<AtomId>, attachment: AtomId): string | undefined {
  for (const name of FUNCTIONAL_GROUP_NAMES) {
    const spec = FUNCTIONAL_GROUPS[name];
    if (matches(mol, inside, attachment, spec)) return spec.label;
  }
  return undefined;
}

/**
 * The label a scheme would print for `atomIds`, or `undefined` when the
 * selection is not one the table knows or cannot be contracted at all.
 */
export function suggestAbbreviationLabel(mol: Molecule, atomIds: readonly AtomId[]): string | undefined {
  return recognise(mol, atomIds)?.label;
}

/** A recognised label, and whether it is a table group itself ("Boc") rather
 *  than a heteroatom carrying one ("NHBoc"). */
function recognise(
  mol: Molecule,
  atomIds: readonly AtomId[],
): { readonly label: string; readonly direct: boolean } | undefined {
  const check = canCollapseAbbreviation(mol, atomIds);
  if (!check.ok) return undefined;
  const inside = new Set(atomIds);
  const direct = tableLabel(mol, inside, check.hostAtomId);
  if (direct !== undefined) return { label: direct, direct: true };

  // A heteroatom carrying a table group: the host's only inside neighbour is
  // that group's attachment atom.
  const host = requireAtom(mol, check.hostAtomId);
  if (host.element === "C" || host.charge !== 0 || host.isotope !== undefined) return undefined;
  const inner = bondsAt(mol, host.id)
    .filter((bond) => bond.order === 1 && inside.has(otherEnd(bond, host.id)))
    .map((bond) => otherEnd(bond, host.id));
  const innerBonds = bondsAt(mol, host.id).filter((bond) => inside.has(otherEnd(bond, host.id)));
  if (inner.length !== 1 || innerBonds.length !== 1) return undefined;
  const rest = new Set(inside);
  rest.delete(host.id);
  const carried = tableLabel(mol, rest, inner[0]!);
  if (carried === undefined) return undefined;
  const hydrogens = implicitHydrogenCount(mol, host.id);
  const h = hydrogens === 0 ? "" : hydrogens === 1 ? "H" : `H${[...String(hydrogens)].map((d) => SUBSCRIPT[Number(d)]).join("")}`;
  return { label: `${host.element}${h}${carried}`, direct: false };
}

/** Larger than any table group with a heteroatom on it (NHCbz is twelve). */
const MAX_CANDIDATE_ATOMS = 24;

/**
 * The atoms on `start`'s side of `bond`, or `undefined` when the bond is in a
 * ring (the walk comes back round) or the side outgrows any table group.
 */
function sideOf(mol: Molecule, start: AtomId, across: AtomId): AtomId[] | undefined {
  const seen = new Set<AtomId>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const bond of bondsAt(mol, id)) {
      const next = otherEnd(bond, id);
      if (id === start && next === across) continue;
      if (next === across) return undefined;
      if (seen.has(next)) continue;
      seen.add(next);
      if (seen.size > MAX_CANDIDATE_ATOMS) return undefined;
      queue.push(next);
    }
  }
  return [...seen];
}

/**
 * The group a click on `atomId` would contract — the "Collapse to Boc" on a
 * stamped group's context menu, with nothing selected but the atom.
 *
 * Every substituent containing the atom is a candidate: the far side of each
 * acyclic bond. A table group itself beats a heteroatom carrying one, and the
 * largest of those wins, so a click anywhere on a stamped Boc offers "Boc"
 * rather than the tert-butyl inside it or the "NHBoc" around it. Bounded by
 * `MAX_CANDIDATE_ATOMS` per side, so a right-click costs the same on a
 * twenty-thousand-atom polymer as on a small molecule.
 */
export function abbreviationCandidateAt(
  mol: Molecule,
  atomId: AtomId,
): { readonly atomIds: readonly AtomId[]; readonly label: string } | undefined {
  if (!Object.hasOwn(mol.atoms, atomId)) return undefined;
  let best: { atomIds: AtomId[]; label: string; direct: boolean } | undefined;
  const consider = (side: AtomId[] | undefined): void => {
    if (side === undefined || !side.includes(atomId)) return;
    const found = recognise(mol, side);
    if (found === undefined) return;
    const better =
      best === undefined ||
      (found.direct && !best.direct) ||
      (found.direct === best.direct && side.length > best.atomIds.length);
    if (better) best = { atomIds: side, label: found.label, direct: found.direct };
  };
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id]!;
    consider(sideOf(mol, bond.from, bond.to));
    consider(sideOf(mol, bond.to, bond.from));
  }
  if (best === undefined) return undefined;
  const order = new Map(mol.atomIds.map((id, index) => [id, index]));
  return {
    atomIds: [...best.atomIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    label: best.label,
  };
}
