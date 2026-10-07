/**
 * Contracted abbreviations (decision 225): real atoms drawn as one label.
 *
 * A stamped Boc stays five carbons, two oxygens and their bonds (decision
 * 116). Contracting it adds an `Abbreviation` record naming those atoms and
 * the label "Boc"; nothing about the atoms changes, so formula, mass, valence,
 * issues and SMILES are exactly what they were. Only two readers look at the
 * record: drawing, through `contractedView`, and the molfile codec, which
 * writes and reads it as a `SUP` S-group.
 *
 * STORED VERSUS CONTRACTED (decision 240). The stored list keeps three
 * invariants on every write: each atom exists, each group is non-empty with a
 * non-blank label, and no atom is in two groups. Whether a group can be DRAWN
 * contracted is a fourth condition — at most one bond leaving it — and that
 * one is perceived, not enforced: a bond drawn onto a hidden atom later is an
 * ordinary `addBond`, and making every bond edit prune groups would put this
 * module into a dozen unrelated ops. A group with two bonds out simply draws
 * expanded, writes no S-group, and contracts again if the extra bond goes.
 *
 * WHAT DELETES A GROUP. Deleting any of its atoms, merging one of them into
 * another atom, or copying only part of it. Each leaves atoms the label no
 * longer describes, and a "Boc" over four carbons is a wrong label, which is
 * worse than an expanded drawing.
 */

import { assembleMolecule } from "./builders.js";
import { bondsAt, otherEnd } from "./molecule.js";
import { compareIds } from "./selection.js";
import { prunedSpeciesJoins, renamedSpeciesJoins, speciesJoinsOf } from "./species.js";
import { prunedStereoGroups, stereoGroupsOf } from "./stereo-groups.js";
import type { Abbreviation, Atom, AtomId, Bond, BondId, Molecule } from "./types.js";

/** Contracted abbreviations in canonical order, or `[]`. Never `undefined`. */
export function abbreviationsOf(mol: Molecule): readonly Abbreviation[] {
  return mol.abbreviations ?? [];
}

/**
 * Thrown when an abbreviation cannot be stored: an atom the molecule lacks, an
 * atom already in another group, an empty group or a blank label. Carries the
 * atoms so a caller can point at them.
 */
export class AbbreviationError extends Error {
  readonly atomIds: readonly AtomId[];

  constructor(message: string, atomIds: readonly AtomId[]) {
    super(message);
    this.name = "AbbreviationError";
    this.atomIds = atomIds;
  }
}

/** True when a label would draw nothing. */
function isBlank(label: string): boolean {
  return label.trim() === "";
}

/** One owner of the canonical order: atoms by `compareIds`, groups by their
 *  first atom. A pasted list and a loaded one then compare `toEqual`. */
function canonical(list: readonly Abbreviation[]): Abbreviation[] {
  return list
    .map((abbr) => ({ label: abbr.label, atomIds: [...new Set(abbr.atomIds)].sort(compareIds) }))
    .filter((abbr) => abbr.atomIds.length > 0)
    .sort((a, b) => compareIds(a.atomIds[0]!, b.atomIds[0]!));
}

function sameAbbreviations(a: readonly Abbreviation[], b: readonly Abbreviation[]): boolean {
  return (
    a.length === b.length &&
    a.every((abbr, i) => {
      const other = b[i]!;
      return (
        abbr.label === other.label &&
        abbr.atomIds.length === other.atomIds.length &&
        abbr.atomIds.every((id, j) => id === other.atomIds[j])
      );
    })
  );
}

/**
 * Validate `list`, put it in canonical order and store it on `mol`.
 *
 * The key is OMITTED when the list is empty, so `withAbbreviations(mol, [])`
 * expands everything. Returns `mol` itself when nothing changed, so a repeated
 * collapse is not an undo step.
 *
 * @throws {AbbreviationError} on a missing atom, an atom in two groups, an
 *   empty group or a blank label.
 */
export function withAbbreviations(mol: Molecule, list: readonly Abbreviation[]): Molecule {
  const owner = new Map<AtomId, number>();
  list.forEach((abbr, index) => {
    if (isBlank(abbr.label)) {
      throw new AbbreviationError(
        "An abbreviation needs a label: a blank one would draw the atoms as nothing at all.",
        abbr.atomIds,
      );
    }
    if (abbr.atomIds.length === 0) {
      throw new AbbreviationError(
        `The abbreviation "${abbr.label}" names no atoms. A label with nothing behind it is ` +
          `decision 8's cosmetic label, which cannot be exported.`,
        [],
      );
    }
    for (const atomId of abbr.atomIds) {
      if (!Object.hasOwn(mol.atoms, atomId)) {
        throw new AbbreviationError(
          `The abbreviation "${abbr.label}" names ${atomId}, which is not an atom of this molecule.`,
          [atomId],
        );
      }
      const held = owner.get(atomId);
      if (held !== undefined && held !== index) {
        throw new AbbreviationError(
          `${atomId} is in two abbreviations. An atom is drawn under one label at most.`,
          [atomId],
        );
      }
      owner.set(atomId, index);
    }
  });
  const next = canonical(list);
  if (sameAbbreviations(next, abbreviationsOf(mol))) return mol;
  if (next.length === 0) {
    const { abbreviations: _dropped, ...rest } = mol;
    return rest;
  }
  return { ...mol, abbreviations: next };
}

/** The stored abbreviation `atomId` belongs to, contracted or not. */
export function abbreviationAt(mol: Molecule, atomId: AtomId): Abbreviation | undefined {
  return abbreviationsOf(mol).find((abbr) => abbr.atomIds.includes(atomId));
}

/** Bonds with exactly one end in `inside`, in `bondIds` order. */
function crossingBonds(mol: Molecule, inside: ReadonlySet<AtomId>): Bond[] {
  const seen = new Set<BondId>();
  const out: Bond[] = [];
  for (const atomId of inside) {
    if (!Object.hasOwn(mol.atoms, atomId)) continue;
    for (const bond of bondsAt(mol, atomId)) {
      if (seen.has(bond.id)) continue;
      seen.add(bond.id);
      if (!inside.has(otherEnd(bond, atomId))) out.push(bond);
    }
  }
  const order = new Map(mol.bondIds.map((id, index) => [id, index]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** A stored abbreviation that can be drawn as one label right now. */
export interface ContractedAbbreviation {
  readonly abbreviation: Abbreviation;
  /**
   * The atom the label sits on: the inside end of the attachment bond, or the
   * group's first atom when nothing is attached (a lone "Ph").
   */
  readonly hostAtomId: AtomId;
  /** The one bond leaving the group, if there is one. */
  readonly bondId?: BondId;
  /** That bond's outside end. */
  readonly outsideAtomId?: AtomId;
}

const CONTRACTED = new WeakMap<Molecule, readonly ContractedAbbreviation[]>();

/**
 * Every stored abbreviation that can be drawn contracted: all its atoms exist
 * and at most one bond leaves it (decision 240). Memoised per molecule.
 */
export function contractedAbbreviations(mol: Molecule): readonly ContractedAbbreviation[] {
  const list = abbreviationsOf(mol);
  if (list.length === 0) return [];
  const cached = CONTRACTED.get(mol);
  if (cached !== undefined) return cached;
  const out: ContractedAbbreviation[] = [];
  for (const abbreviation of list) {
    if (!abbreviation.atomIds.every((id) => Object.hasOwn(mol.atoms, id))) continue;
    const inside = new Set(abbreviation.atomIds);
    const crossing = crossingBonds(mol, inside);
    if (crossing.length > 1) continue;
    const bond = crossing[0];
    if (bond === undefined) {
      out.push({ abbreviation, hostAtomId: abbreviation.atomIds[0]! });
      continue;
    }
    const hostAtomId = inside.has(bond.from) ? bond.from : bond.to;
    out.push({ abbreviation, hostAtomId, bondId: bond.id, outsideAtomId: otherEnd(bond, hostAtomId) });
  }
  CONTRACTED.set(mol, out);
  return out;
}

/** The contracted abbreviation `atomId` is drawn under, if any. */
export function contractedAbbreviationAt(
  mol: Molecule,
  atomId: AtomId,
): ContractedAbbreviation | undefined {
  return contractedAbbreviations(mol).find((c) => c.abbreviation.atomIds.includes(atomId));
}

/**
 * `atomIds` plus every atom of each contracted abbreviation it touches, in
 * the input's order with the additions after.
 *
 * What a click or a rubber band on a label means: the label IS those atoms,
 * so moving, copying or deleting it has to take all of them — deleting the
 * host alone would leave four invisible carbons and a group the delete then
 * prunes.
 */
export function closeOverAbbreviations(mol: Molecule, atomIds: readonly AtomId[]): readonly AtomId[] {
  const contracted = contractedAbbreviations(mol);
  if (contracted.length === 0) return atomIds;
  const out = [...atomIds];
  const present = new Set(atomIds);
  for (const { abbreviation } of contracted) {
    if (!abbreviation.atomIds.some((id) => present.has(id))) continue;
    for (const id of abbreviation.atomIds) {
      if (present.has(id)) continue;
      present.add(id);
      out.push(id);
    }
  }
  return out.length === atomIds.length ? atomIds : out;
}

/** Why a set of atoms cannot be contracted, or where its label would sit. */
export type CollapseCheck =
  | {
      readonly ok: true;
      readonly hostAtomId: AtomId;
      readonly bondId: BondId;
      /** Stored groups wholly inside the selection; collapsing absorbs them. */
      readonly absorbed: readonly Abbreviation[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether `atomIds` can be contracted to one label.
 *
 * EXACTLY ONE BOND OUT. A label stands for a substituent, and a substituent
 * hangs off the rest by one bond: with two, the label has no single place to
 * sit and the drawing cannot say which of its letters each bond reaches. With
 * none, the selection is a whole compound, and its name — not an
 * abbreviation — is what a figure prints.
 */
export function canCollapseAbbreviation(mol: Molecule, atomIds: readonly AtomId[]): CollapseCheck {
  const inside = new Set(atomIds);
  if (inside.size === 0) return { ok: false, reason: "Select the atoms to contract first." };
  for (const id of inside) {
    if (!Object.hasOwn(mol.atoms, id)) {
      return { ok: false, reason: `${id} is not an atom of this structure.` };
    }
  }
  const crossing = crossingBonds(mol, inside);
  if (crossing.length !== 1) {
    return {
      ok: false,
      reason:
        crossing.length === 0
          ? "The selection is not attached to anything. An abbreviation stands for a substituent joined by one bond."
          : `The selection is joined to the rest by ${crossing.length} bonds. An abbreviation needs exactly one.`,
    };
  }
  const absorbed: Abbreviation[] = [];
  for (const abbr of abbreviationsOf(mol)) {
    const within = abbr.atomIds.filter((id) => inside.has(id)).length;
    if (within === 0) continue;
    if (within !== abbr.atomIds.length) {
      return {
        ok: false,
        reason: `The selection cuts through "${abbr.label}". Expand it first, or select all of it.`,
      };
    }
    absorbed.push(abbr);
  }
  const bond = crossing[0]!;
  return { ok: true, hostAtomId: inside.has(bond.from) ? bond.from : bond.to, bondId: bond.id, absorbed };
}

/**
 * Contract `atomIds` to `label`: one edit, so one undo step.
 *
 * A group already inside the selection is absorbed — contracting "OTBS" over
 * an already-contracted "TBS" replaces it rather than nesting labels, which a
 * molfile could store and nothing could draw.
 *
 * @throws {AbbreviationError} when `canCollapseAbbreviation` says no, or the
 *   label is blank.
 */
export function collapseAbbreviation(mol: Molecule, atomIds: readonly AtomId[], label: string): Molecule {
  const check = canCollapseAbbreviation(mol, atomIds);
  if (!check.ok) throw new AbbreviationError(check.reason, atomIds);
  const absorbed = new Set(check.absorbed);
  return withAbbreviations(mol, [
    ...abbreviationsOf(mol).filter((abbr) => !absorbed.has(abbr)),
    { label, atomIds },
  ]);
}

/**
 * Expand the abbreviation `atomId` belongs to: the record goes, the atoms
 * were always there. Returns `mol` itself when the atom is in none.
 */
export function expandAbbreviation(mol: Molecule, atomId: AtomId): Molecule {
  const target = abbreviationAt(mol, atomId);
  if (target === undefined) return mol;
  return withAbbreviations(
    mol,
    abbreviationsOf(mol).filter((abbr) => abbr !== target),
  );
}

// ---------------------------------------------------------------------------
// Carrying the list through edits, as species.ts does for joins
// ---------------------------------------------------------------------------

/**
 * Drop every group with an atom `keep` rejects. A group that loses ANY atom
 * goes, not just one that loses all of them: see the header. Returns the same
 * array when nothing changed.
 */
export function prunedAbbreviations(
  list: readonly Abbreviation[],
  keep: (atomId: AtomId) => boolean,
): readonly Abbreviation[] {
  const kept = list.filter((abbr) => abbr.atomIds.every(keep));
  return kept.length === list.length ? list : kept;
}

/**
 * Rewrite every group through `map`, dropping a group any of whose atoms the
 * map does not mention — copying part of a "Boc" copies atoms, not a label.
 */
export function remappedAbbreviations(
  list: readonly Abbreviation[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly Abbreviation[] {
  const out: Abbreviation[] = [];
  for (const abbr of list) {
    const atomIds = abbr.atomIds.map((id) => map.get(id));
    if (atomIds.every((id): id is AtomId => id !== undefined)) out.push({ label: abbr.label, atomIds });
  }
  return canonical(out);
}

/** Merge a pasted fragment's groups into a target's. Every pasted id is
 *  fresh, so the lists cannot overlap. */
export function graftAbbreviations(
  target: readonly Abbreviation[],
  fragment: readonly Abbreviation[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly Abbreviation[] {
  const pasted = remappedAbbreviations(fragment, map);
  return pasted.length === 0 ? target : canonical([...target, ...pasted]);
}

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

/** The molecule as it is drawn with every abbreviation contracted. */
export interface ContractedView {
  /**
   * A copy without the hidden atoms and the bonds touching them, the host of
   * each group carrying its label. Same ids for everything that remains.
   * DRAWING ONLY: its hydrogens, formula and valence are not the chemistry's.
   */
  readonly molecule: Molecule;
  /** Atoms folded into a label, hosts excluded. */
  readonly hidden: ReadonlySet<AtomId>;
  /** Each contracted group, by the atom its label sits on. */
  readonly hosts: ReadonlyMap<AtomId, ContractedAbbreviation>;
}

const VIEWS = new WeakMap<Molecule, ContractedView>();
const NO_HIDDEN: ReadonlySet<AtomId> = new Set();
const NO_HOSTS: ReadonlyMap<AtomId, ContractedAbbreviation> = new Map();

/**
 * The molecule drawing reads: each contracted abbreviation reduced to its
 * host atom with the label on it, everything else untouched.
 *
 * REMOVED RATHER THAN HIDDEN. Every pass that draws a structure — label
 * placement, bond trimming, ring perception for double-bond sides and
 * aromatic circles, hit-testing — then sees one atom with one bond, which is
 * what is on the page. Hidden atoms left in the graph would pull a label's
 * placement towards neighbours nobody can see.
 *
 * The host is stripped to its element: no charge, radical, isotope, pinned
 * hydrogens or lone pairs, all of which belong to an atom the label replaces.
 * A contracted nitro is "NO₂", not "NO₂⁺".
 *
 * Returns `mol` itself as the view when nothing is contracted, so the common
 * case costs one array check. Memoised per molecule.
 */
export function contractedView(mol: Molecule): ContractedView {
  const contracted = contractedAbbreviations(mol);
  if (contracted.length === 0) return { molecule: mol, hidden: NO_HIDDEN, hosts: NO_HOSTS };
  const cached = VIEWS.get(mol);
  if (cached !== undefined) return cached;

  const hidden = new Set<AtomId>();
  const hosts = new Map<AtomId, ContractedAbbreviation>();
  for (const c of contracted) {
    hosts.set(c.hostAtomId, c);
    for (const id of c.abbreviation.atomIds) if (id !== c.hostAtomId) hidden.add(id);
  }

  const atoms: Record<AtomId, Atom> = {};
  const atomIds: AtomId[] = [];
  for (const id of mol.atomIds) {
    if (hidden.has(id)) continue;
    const atom = mol.atoms[id]!;
    const host = hosts.get(id);
    atoms[id] =
      host === undefined
        ? atom
        : {
            id: atom.id,
            element: atom.element,
            pos: atom.pos,
            charge: 0,
            radicalElectrons: 0,
            aromatic: false,
            label: host.abbreviation.label,
          };
    atomIds.push(id);
  }
  const bonds: Record<BondId, Bond> = {};
  const bondIds: BondId[] = [];
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id]!;
    if (hidden.has(bond.from) || hidden.has(bond.to)) continue;
    bonds[id] = bond;
    bondIds.push(id);
  }

  // A join that named a hidden atom names its host instead: the label is
  // still that component.
  let joins = speciesJoinsOf(mol);
  for (const [hostId, c] of hosts) {
    for (const id of c.abbreviation.atomIds) if (id !== hostId) joins = renamedSpeciesJoins(joins, id, hostId);
  }

  const view: ContractedView = {
    molecule: assembleMolecule({
      atoms,
      bonds,
      atomIds,
      bondIds,
      nextId: mol.nextId,
      stereoGroups: prunedStereoGroups(stereoGroupsOf(mol), (id) => !hidden.has(id)),
      speciesJoins: prunedSpeciesJoins(joins, (id) => !hidden.has(id)),
      abbreviations: undefined,
    }),
    hidden,
    hosts,
  };
  VIEWS.set(mol, view);
  return view;
}
