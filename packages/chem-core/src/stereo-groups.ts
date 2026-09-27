/**
 * Enhanced stereochemistry: the RECORD layer over `Molecule.stereoGroups`.
 *
 * WHAT THIS MODULE IS. The one place an ABS/AND/OR collection is validated,
 * put in canonical order and written onto a molecule, plus the maintenance
 * primitives every id-rewriting operation needs. It answers "which group is
 * this centre in?" (decision 23 requires that to be queryable per centre) and
 * nothing else.
 *
 * WHAT THIS MODULE IS NOT. It asks no perception questions. It never decides
 * whether an atom IS a stereocentre, and it never computes whether a molecule
 * reads `rac-` or `rel-`. That has to stay out of here: cip.ts imports ops.ts,
 * so a module ops.ts depends on cannot reach stereo.ts without closing the
 * cycle ops -> stereo-groups -> stereo -> cip -> ops. The coverage question
 * therefore belongs in stereo.ts, which may import this module.
 *
 * THE INVARIANTS, all enforced by `withStereoGroups` and re-enforced by the
 * document schema on decode:
 *
 *   - every atom id in a group exists in the molecule;
 *   - no group is empty;
 *   - an atom belongs to AT MOST ONE group (MDL collection semantics, and what
 *     makes a figure's per-centre tag single-valued);
 *   - no two groups share a kind and an index;
 *   - an `abs` group's index is always `ABS_STEREO_GROUP_INDEX`.
 *
 * CANONICAL ORDER IS PART OF THE CONTRACT, not a nicety. Two writes of the
 * same molecule have to be byte-identical (the V3000 writer's determinism
 * promise), and a group built by dragging a selection arrives in click order.
 * So the groups come out ordered by kind then stored index, and the atom ids
 * inside each come out sorted by `compareIds` — the package's one total id
 * order, borrowed from selection.ts rather than copied, so it cannot disagree
 * about `a01` versus `a1`.
 */

import { requireAtom } from "./molecule.js";
import { compareIds } from "./selection.js";
import type { AtomId, Molecule, StereoGroup, StereoGroupKind } from "./types.js";

/**
 * The index an `abs` group always carries.
 *
 * V3000 writes the absolute collection as `MDLV30/STEABS`, with NO number,
 * while the other two are `MDLV30/STERACn` and `MDLV30/STERELn` with `n > 0`
 * (verified against the CTfile specification's collection-names table and
 * against what RDKit MinimalLib emits). So there is exactly one absolute
 * collection per structure and a second one could not be written distinctly.
 * A file may still carry several `STEABS` lines — the spec says collections
 * sharing a name are pieces of the same collection — and giving them all this
 * one index is what makes `withStereoGroups` union them.
 *
 * Decision 92 numbers AND and OR groups and is silent on ABS; this constant is
 * that silence resolved, and the reason is the file format rather than taste.
 */
export const ABS_STEREO_GROUP_INDEX = 1;

/**
 * Kind order for the canonical sort.
 *
 * A total `Record` rather than an array so a fourth `StereoGroupKind` is a
 * compile error here instead of a group that sorts to position `undefined` and
 * makes the writer non-deterministic. NOT exported: the shared package owns the
 * one enumerated list of the kind values, the same way it owns
 * `BOND_STEREO_VALUES`, and a second exported list here is exactly the drift
 * that made a widened `BondStereo` unopenable.
 *
 * The order itself is arbitrary but fixed. It is alphabetical, which is easy to
 * confirm by eye in a diff of a written file.
 */
const KIND_RANK: Record<StereoGroupKind, number> = { abs: 0, and: 1, or: 2 };

/** Groups in canonical order, or an empty array. Never `undefined`, so a
 *  caller can iterate without testing first. */
export function stereoGroupsOf(mol: Molecule): readonly StereoGroup[] {
  return mol.stereoGroups ?? [];
}

/**
 * The group `atomId` belongs to, or `undefined`.
 *
 * Linear in the number of GROUPS, not atoms, and a molecule has a handful at
 * most. Decision 23's projection oracle asserts group membership per centre and
 * this is the query it asks; decision 40's per-centre tag reads it too.
 */
export function stereoGroupAt(mol: Molecule, atomId: AtomId): StereoGroup | undefined {
  for (const group of stereoGroupsOf(mol)) {
    if (group.atomIds.includes(atomId)) return group;
  }
  return undefined;
}

/**
 * The label a figure prints for a group: `abs`, `and1`, `or1`, ... (decision
 * 40).
 *
 * HERE rather than in chem-render because the number is the group's STORED
 * index (decision 92) and a renderer that formatted it itself would be free to
 * use the array position instead — which is the renumbering bug decision 92
 * exists to prevent. `abs` carries no number because there is only ever one
 * absolute collection; see `ABS_STEREO_GROUP_INDEX`.
 */
export function stereoGroupTag(group: StereoGroup): string {
  return group.kind === "abs" ? "abs" : `${group.kind}${group.index}`;
}

/**
 * The next free index for a new group of `kind`.
 *
 * MAX PLUS ONE, not count plus one: deleting AND group 1 must not hand the next
 * group the number an undo entry still refers to, and a gap in the numbering is
 * something a V3000 file is entitled to contain anyway.
 */
export function nextStereoGroupIndex(mol: Molecule, kind: StereoGroupKind): number {
  if (kind === "abs") return ABS_STEREO_GROUP_INDEX;
  let max = 0;
  for (const group of stereoGroupsOf(mol)) {
    if (group.kind === kind && group.index > max) max = group.index;
  }
  return max + 1;
}

/**
 * Thrown when a group statement cannot be honoured at all.
 *
 * `withStereoGroups` is the editor-facing constructor, so it treats a violated
 * invariant the way `addBond` treats a duplicate bond: as a programming error,
 * not a user-recoverable one. A FILE that puts one atom in two collections is a
 * different situation — the reader detects that itself and skips the later
 * collection with a structured warning, exactly as it skips a malformed bond
 * row, rather than letting an imported file throw.
 */
export class StereoGroupError extends Error {
  readonly atomIds: readonly AtomId[];
  constructor(message: string, atomIds: readonly AtomId[]) {
    super(message);
    this.name = "StereoGroupError";
    this.atomIds = atomIds;
  }
}

/**
 * Canonical group order, IN PLACE: kind then stored index.
 *
 * Shared by every producer, because the V3000 writer's byte-identity promise
 * rests on it. A writer that sorted for itself would be the second owner of the
 * order, and the two would be free to disagree about a molecule that had been
 * pasted into rather than loaded — which is exactly the case that breaks a
 * round-trip comparison while every individual write stays deterministic.
 */
function sortStereoGroups(groups: StereoGroup[]): void {
  groups.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.index - b.index);
}

/** Sorted, deduplicated atom ids. */
function canonicalAtomIds(ids: readonly AtomId[]): AtomId[] {
  return [...new Set(ids)].sort(compareIds);
}

/** `kind` and `index` as one map key. The separator is written as an ESCAPE,
 *  never as a literal control byte: a NUL in the source makes every grep treat
 *  this file as binary and skip it, so a repo-wide search for a symbol declared
 *  here comes back empty. Same reason molblock-read.ts writes its `pairKey`
 *  separator that way. */
function groupKey(kind: StereoGroupKind, index: number): string {
  return `${kind}\u0000${index}`;
}

/**
 * Validate `groups`, put them in canonical order and store them on `mol`.
 *
 * THE KEY IS OMITTED when nothing survives, never present holding an empty
 * array — see the field comment on `Molecule.stereoGroups`. So this is also how
 * a caller clears every group: hand it `[]`.
 *
 * Groups sharing a kind and an index are UNIONED rather than rejected. That is
 * what the CTfile spec asks for ("all collections of the same name are presumed
 * to indicate various pieces of the same collection"), and it is what lets the
 * V3000 reader hand over one entry per `MDLV30/...` line without first
 * coalescing them.
 *
 * @throws {StereoGroupError} if an atom id is not in the molecule, or if one
 *   atom would end up in two different groups.
 */
export function withStereoGroups(
  mol: Molecule,
  groups: readonly StereoGroup[],
): Molecule {
  const byKey = new Map<string, { kind: StereoGroupKind; index: number; ids: AtomId[] }>();
  const owner = new Map<AtomId, string>();

  for (const group of groups) {
    // An abs group is normalised rather than refused: `STEABS` carries no
    // number, so a caller that had to invent one had no way to get it right.
    const index = group.kind === "abs" ? ABS_STEREO_GROUP_INDEX : Math.trunc(group.index);
    if (group.kind !== "abs" && index < 1) {
      throw new StereoGroupError(
        `A ${group.kind} stereo group's index must be a positive integer; got ` +
          `${group.index}. The index is the number a V3000 file states and the ` +
          `number a figure tag prints, so it is stored, never derived.`,
        group.atomIds,
      );
    }
    const key = groupKey(group.kind, index);
    const bucket = byKey.get(key) ?? { kind: group.kind, index, ids: [] };
    for (const atomId of group.atomIds) {
      // `requireAtom` throws with the id in the message. Doing it here rather
      // than trusting the caller is what keeps an unremapped group — the
      // copy-and-paste failure — from reaching a save, where it would be a
      // document that cannot be decoded.
      requireAtom(mol, atomId);
      const held = owner.get(atomId);
      if (held !== undefined && held !== key) {
        throw new StereoGroupError(
          `Atom ${atomId} is in two stereo groups at once. An atom belongs to ` +
            `at most one ABS/AND/OR collection — that is MDL semantics, and it ` +
            `is what makes the per-centre tag on a figure single-valued. Clear ` +
            `its current group before assigning another.`,
          [atomId],
        );
      }
      owner.set(atomId, key);
      bucket.ids.push(atomId);
    }
    byKey.set(key, bucket);
  }

  const canonical: StereoGroup[] = [];
  for (const bucket of byKey.values()) {
    const atomIds = canonicalAtomIds(bucket.ids);
    // An empty group says nothing and would be a second spelling of "no
    // statement", which the field comment rules out.
    if (atomIds.length === 0) continue;
    canonical.push({ kind: bucket.kind, index: bucket.index, atomIds });
  }
  sortStereoGroups(canonical);

  if (canonical.length === 0) {
    if (mol.stereoGroups === undefined) return mol;
    const { stereoGroups: _dropped, ...rest } = mol;
    return rest;
  }
  return { ...mol, stereoGroups: canonical };
}

/**
 * Drop every atom `keep` rejects, and every group that empties as a result.
 *
 * The primitive behind atom deletion and atom merging. Kinds and stored indices
 * survive untouched: a group that loses one of three centres is still group
 * `&1`, and renumbering it here would change what the next written file says
 * about an unrelated group.
 *
 * Returns the SAME array when nothing changed, so a caller can use identity to
 * decide whether it has any work to do.
 */
export function prunedStereoGroups(
  groups: readonly StereoGroup[],
  keep: (atomId: AtomId) => boolean,
): readonly StereoGroup[] {
  let changed = false;
  const kept: StereoGroup[] = [];
  for (const group of groups) {
    const atomIds = group.atomIds.filter(keep);
    if (atomIds.length !== group.atomIds.length) changed = true;
    if (atomIds.length === 0) continue;
    kept.push(atomIds.length === group.atomIds.length ? group : { ...group, atomIds });
  }
  return changed ? kept : groups;
}

/**
 * Rewrite every atom id through `map`, DROPPING an id the map does not mention.
 *
 * This is restrict-and-remap in one pass, because fragment extraction needs
 * both at once: the map it produces covers exactly the extracted atoms, so an
 * id with no image is an atom that did not come along. Carrying it across
 * unremapped is the copy-and-paste failure mode — a group naming ids that are
 * not in the molecule, which is a document that cannot be saved.
 *
 * The result is re-sorted, because new ids do not sort like the old ones.
 */
export function remappedStereoGroups(
  groups: readonly StereoGroup[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly StereoGroup[] {
  const remapped: StereoGroup[] = [];
  for (const group of groups) {
    const atomIds: AtomId[] = [];
    for (const atomId of group.atomIds) {
      const image = map.get(atomId);
      if (image !== undefined) atomIds.push(image);
    }
    if (atomIds.length === 0) continue;
    remapped.push({ ...group, atomIds: canonicalAtomIds(atomIds) });
  }
  return remapped;
}

/**
 * Merge a pasted fragment's groups into a target's.
 *
 * The fragment's AND and OR groups are RENUMBERED past the target's, because
 * the two numberings are independent statements: pasting a racemate into a
 * molecule that already has AND group 1 must not silently claim the pasted
 * centres invert together with the existing ones. Its `abs` group is UNIONED
 * into the target's instead, since there is only one absolute collection per
 * structure.
 *
 * `map` is the fragment-to-target id map the insertion produced; ids it does
 * not mention are dropped, as in `remappedStereoGroups`.
 *
 * THE RESULT IS ALREADY VALID, and has to be: `insertFragment` hands it
 * straight to `assembleMolecule`, which deliberately validates nothing. So the
 * abs union happens HERE rather than being left to `withStereoGroups` — two abs
 * entries reaching a molecule would be a document the schema rejects, and the
 * user would lose the file rather than the paste. `map` is injective (every
 * pasted id is freshly minted), so no target id can land in two groups.
 */
export function graftStereoGroups(
  targetGroups: readonly StereoGroup[],
  fragmentGroups: readonly StereoGroup[],
  map: ReadonlyMap<AtomId, AtomId>,
): readonly StereoGroup[] {
  const pasted = remappedStereoGroups(fragmentGroups, map);
  if (pasted.length === 0) return targetGroups;

  const offset: Record<StereoGroupKind, number> = { abs: 0, and: 0, or: 0 };
  for (const group of targetGroups) {
    if (group.kind === "abs") continue;
    if (group.index > offset[group.kind]) offset[group.kind] = group.index;
  }

  const grafted: StereoGroup[] = [];
  const absAtomIds: AtomId[] = [];
  for (const group of [...targetGroups, ...pasted]) {
    if (group.kind === "abs") {
      absAtomIds.push(...group.atomIds);
      continue;
    }
    // The target's own groups keep their numbers; only the pasted ones move,
    // and `pasted` is the second half of the list above.
    const shift = targetGroups.includes(group) ? 0 : offset[group.kind];
    grafted.push(shift === 0 ? group : { ...group, index: group.index + shift });
  }
  if (absAtomIds.length > 0) {
    grafted.push({
      kind: "abs",
      index: ABS_STEREO_GROUP_INDEX,
      atomIds: canonicalAtomIds(absAtomIds),
    });
  }
  // Sorted, not appended: `insertFragment` hands this straight to
  // `assembleMolecule`, which validates and reorders nothing, so appending would
  // leave a pasted `and2` sitting after the target's `or1`. Every individual
  // write would still be deterministic and the round trip would still lose —
  // loading the written file gives the canonical order back, and the two files
  // would differ by nothing but the order of two lines.
  sortStereoGroups(grafted);
  return grafted;
}
