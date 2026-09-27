import { describe, expect, it } from "vitest";

import { buildMolecule } from "./builders.js";
import { extractFragment, insertFragment, duplicateFragment } from "./fragment.js";
import { emptyMolecule } from "./molecule.js";
import { mergeAtoms, removeAtoms, removeBonds, updateAtom } from "./ops.js";
import {
  ABS_STEREO_GROUP_INDEX,
  StereoGroupError,
  graftStereoGroups,
  nextStereoGroupIndex,
  prunedStereoGroups,
  remappedStereoGroups,
  stereoGroupAt,
  stereoGroupTag,
  stereoGroupsOf,
  withStereoGroups,
} from "./stereo-groups.js";
import { translateAtoms } from "./transform.js";
import type { AtomId, Molecule } from "./types.js";

/**
 * Real molecules, so a regression reads as a chemistry error rather than a
 * graph error.
 *
 * Threo/erythro 3-chlorobutan-2-ol, `CC(O)C(C)Cl`: two adjacent stereocentres,
 * which is the smallest structure where a racemate (one AND group holding both)
 * and a mixture of diastereomers (two AND groups, one each) are different
 * compounds. That distinction is the whole reason a group is a SET of ids and
 * not a per-atom tag.
 */
function chlorobutanol(): {
  readonly mol: Molecule;
  readonly c2: AtomId;
  readonly c3: AtomId;
} {
  let c2: AtomId = "";
  let c3: AtomId = "";
  const mol = buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    c2 = b.atom("C", { x: 0.87, y: 0.5 });
    const o = b.atom("O", { x: 0.87, y: 1.5 });
    c3 = b.atom("C", { x: 1.74, y: 0 });
    const c4 = b.atom("C", { x: 2.61, y: 0.5 });
    const cl = b.atom("Cl", { x: 1.74, y: -1 });
    b.bond(c1, c2, 1);
    b.bond(c2, o, 1, "wedge");
    b.bond(c2, c3, 1);
    b.bond(c3, c4, 1);
    b.bond(c3, cl, 1, "hash");
  });
  return { mol, c2, c3 };
}

describe("stereo group records", () => {
  it("omits the key rather than storing an empty list", () => {
    const { mol } = chlorobutanol();
    // Two spellings of "nothing was said" would make `toEqual` and
    // `JSON.stringify` disagree about two identical molecules.
    expect(Object.hasOwn(mol, "stereoGroups")).toBe(false);
    expect(Object.hasOwn(withStereoGroups(mol, []), "stereoGroups")).toBe(false);
    expect(stereoGroupsOf(mol)).toEqual([]);
  });

  it("distinguishes no groups from an explicit abs group (decision 91)", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const asserted = withStereoGroups(mol, [
      { kind: "abs", index: ABS_STEREO_GROUP_INDEX, atomIds: [c2, c3] },
    ]);
    // "Nothing was said about configuration" versus "these centres were
    // asserted absolute". Folding the two together would normalise a file's own
    // statement away on a round trip.
    expect(stereoGroupsOf(mol)).toEqual([]);
    expect(stereoGroupsOf(asserted)).toHaveLength(1);
    expect(stereoGroupAt(asserted, c2)?.kind).toBe("abs");
  });

  it("keeps one racemic group distinct from two independent ones", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const racemate = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const diastereomers = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2] },
      { kind: "and", index: 2, atomIds: [c3] },
    ]);
    // One group: the two centres invert together, so the sample holds two
    // species. Two groups: they invert independently, which is four.
    expect(stereoGroupsOf(racemate)).toHaveLength(1);
    expect(stereoGroupsOf(diastereomers)).toHaveLength(2);
    expect(stereoGroupAt(racemate, c2)).toBe(stereoGroupAt(racemate, c3));
    expect(stereoGroupAt(diastereomers, c2)).not.toBe(stereoGroupAt(diastereomers, c3));
  });

  it("puts groups and their atom ids in a canonical order", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const a = withStereoGroups(mol, [
      { kind: "or", index: 1, atomIds: [c3] },
      { kind: "and", index: 2, atomIds: [c2] },
    ]);
    const b = withStereoGroups(mol, [
      { kind: "and", index: 2, atomIds: [c2] },
      { kind: "or", index: 1, atomIds: [c3] },
    ]);
    // Insertion order is click order; a canonical order is what makes two
    // writes of the same molecule byte-identical.
    expect(a.stereoGroups).toEqual(b.stereoGroups);
    expect(a.stereoGroups?.map((g) => g.kind)).toEqual(["and", "or"]);

    const unsorted = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c3, c2, c3] },
    ]);
    expect(unsorted.stereoGroups?.[0]?.atomIds).toEqual([c2, c3]);
  });

  it("unions two entries that share a kind and an index", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // The CTfile spec says collections sharing a name are pieces of one
    // collection, which is what lets the V3000 reader hand over one entry per
    // line without coalescing them first.
    const merged = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c3] },
      { kind: "and", index: 1, atomIds: [c2] },
    ]);
    expect(merged.stereoGroups).toEqual([{ kind: "and", index: 1, atomIds: [c2, c3] }]);
  });

  it("refuses an atom in two groups at once, naming the atom", () => {
    const { mol, c2, c3 } = chlorobutanol();
    expect(() =>
      withStereoGroups(mol, [
        { kind: "and", index: 1, atomIds: [c2, c3] },
        { kind: "or", index: 1, atomIds: [c2] },
      ]),
    ).toThrow(StereoGroupError);
    expect(() =>
      withStereoGroups(mol, [
        { kind: "and", index: 1, atomIds: [c2] },
        { kind: "or", index: 1, atomIds: [c2] },
      ]),
    ).toThrow(new RegExp(c2));
  });

  it("refuses an atom that is not in the molecule", () => {
    const { mol, c2 } = chlorobutanol();
    // This is the copy-and-paste failure: an unremapped group naming a
    // clipboard id would be a document that cannot be saved.
    expect(() => withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: ["a99"] }])).toThrow(
      /a99/,
    );
    expect(() => withStereoGroups(mol, [{ kind: "and", index: 0, atomIds: [c2] }])).toThrow(
      StereoGroupError,
    );
  });

  it("normalises an abs group's index to 1 and refuses a bad and/or index", () => {
    const { mol, c2 } = chlorobutanol();
    // STEABS carries no number, so a caller that had to invent one had no way
    // of getting it right.
    const abs = withStereoGroups(mol, [{ kind: "abs", index: 7, atomIds: [c2] }]);
    expect(abs.stereoGroups?.[0]?.index).toBe(ABS_STEREO_GROUP_INDEX);
    expect(nextStereoGroupIndex(abs, "abs")).toBe(ABS_STEREO_GROUP_INDEX);
  });

  it("tags a group the way a figure prints it (decision 40)", () => {
    expect(stereoGroupTag({ kind: "abs", index: 1, atomIds: ["a1"] })).toBe("abs");
    expect(stereoGroupTag({ kind: "and", index: 1, atomIds: ["a1"] })).toBe("and1");
    expect(stereoGroupTag({ kind: "or", index: 2, atomIds: ["a1"] })).toBe("or2");
  });

  it("hands out max-plus-one, so an undo cannot collide with a live group", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const two = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2] },
      { kind: "and", index: 4, atomIds: [c3] },
    ]);
    expect(nextStereoGroupIndex(two, "and")).toBe(5);
    expect(nextStereoGroupIndex(two, "or")).toBe(1);
    // A gap survives a delete: count-plus-one would hand group 1's number back
    // out while an undo entry still refers to it.
    const shrunk = withStereoGroups(two, [{ kind: "and", index: 4, atomIds: [c3] }]);
    expect(nextStereoGroupIndex(shrunk, "and")).toBe(5);
  });
});

describe("stereo groups survive an edit", () => {
  it("prunes a deleted atom and drops a group that empties", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const grouped = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2, c3] },
      { kind: "or", index: 1, atomIds: [c2] },
    ].slice(0, 1));
    const shrunk = removeAtoms(grouped, [c3]);
    // Still `&1`: renumbering a group that merely lost a centre would change
    // what an unrelated group's written label says.
    expect(shrunk.stereoGroups).toEqual([{ kind: "and", index: 1, atomIds: [c2] }]);
    expect(Object.hasOwn(removeAtoms(grouped, [c2, c3]), "stereoGroups")).toBe(false);
  });

  it("carries a group across edits that touch no atom id", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const grouped = withStereoGroups(mol, [{ kind: "or", index: 3, atomIds: [c2, c3] }]);
    // Each of these builds a new molecule by spreading, so the field rides
    // along for free — pinned here because "it spreads today" is a fact about
    // today's code.
    expect(removeBonds(grouped, [grouped.bondIds[0] ?? ""]).stereoGroups).toEqual(
      grouped.stereoGroups,
    );
    expect(updateAtom(grouped, c2, { charge: 1 }).stereoGroups).toEqual(grouped.stereoGroups);
    expect(translateAtoms(grouped, [c2], { x: 5, y: 5 }).stereoGroups).toEqual(
      grouped.stereoGroups,
    );
  });

  it("drops the dragged atom on a merge and keeps the target's membership (O2)", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // C1 is the terminal methyl; dragging C3 onto it closes the chain into a
    // ring, which is the gesture `mergeAtoms` exists for. Already-bonded atoms
    // are refused, so it cannot be C2.
    const c1 = mol.atomIds[0] ?? "";
    const grouped = withStereoGroups(mol, [
      { kind: "and", index: 1, atomIds: [c2] },
      { kind: "or", index: 1, atomIds: [c3] },
    ]);
    // The survivor keeps C1's id and position (decision 1), and this is the
    // same choice one field on: merging destroys the ligand set at that
    // position, so C3's OR statement describes a centre that no longer exists
    // and must not be transferred onto the survivor.
    const merged = mergeAtoms(grouped, c1, c3);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.molecule.stereoGroups).toEqual([
      { kind: "and", index: 1, atomIds: [c2] },
    ]);
    expect(stereoGroupAt(merged.molecule, c1)).toBeUndefined();
  });

  it("restricts and remaps a group on extraction (T3)", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const grouped = withStereoGroups(mol, [{ kind: "and", index: 2, atomIds: [c2, c3] }]);
    const { molecule: fragment, atomIdMap } = extractFragment(
      grouped,
      grouped.atomIds.filter((id) => id !== c3),
    );
    const group = fragment.stereoGroups?.[0];
    expect(group?.kind).toBe("and");
    // Kind and index survive; the centre left behind does not, and every
    // surviving id is one the fragment actually holds.
    expect(group?.index).toBe(2);
    expect(group?.atomIds).toEqual([atomIdMap.get(c2)]);
    for (const id of group?.atomIds ?? []) expect(Object.hasOwn(fragment.atoms, id)).toBe(true);
  });

  it("drops a group whose every centre stayed behind", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const grouped = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const { molecule: fragment } = extractFragment(
      grouped,
      grouped.atomIds.filter((id) => id !== c2 && id !== c3),
    );
    expect(Object.hasOwn(fragment, "stereoGroups")).toBe(false);
  });

  it("renumbers a pasted and/or group past the target's and unions abs", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const target = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const { molecule: fragment } = extractFragment(target, [c2, c3]);
    const pasted = insertFragment(target, fragment, { offset: { x: 5, y: 0 } });
    // Pasting a racemate into a molecule that already has AND group 1 must not
    // claim the pasted centres invert together with the existing ones.
    expect(pasted.molecule.stereoGroups?.map((g) => [g.kind, g.index])).toEqual([
      ["and", 1],
      ["and", 2],
    ]);
    for (const group of pasted.molecule.stereoGroups ?? []) {
      for (const id of group.atomIds) {
        expect(Object.hasOwn(pasted.molecule.atoms, id)).toBe(true);
      }
    }

    const absTarget = withStereoGroups(mol, [{ kind: "abs", index: 1, atomIds: [c2] }]);
    const { molecule: absFragment } = extractFragment(absTarget, [c2, c3]);
    const absPasted = insertFragment(absTarget, absFragment);
    // One absolute collection per structure, so the pasted centre joins it.
    expect(absPasted.molecule.stereoGroups).toHaveLength(1);
    expect(absPasted.molecule.stereoGroups?.[0]?.atomIds).toHaveLength(2);
  });

  it("gives a duplicate its own group rather than widening the original's", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const grouped = withStereoGroups(mol, [{ kind: "and", index: 1, atomIds: [c2, c3] }]);
    const copy = duplicateFragment(grouped, [c2, c3], { offset: { x: 5, y: 0 } });
    // Two racemates, not one four-centre racemate: the copy is a separate
    // sample statement.
    expect(copy.molecule.stereoGroups?.map((g) => g.atomIds.length)).toEqual([2, 2]);
    expect(copy.molecule.stereoGroups?.map((g) => g.index)).toEqual([1, 2]);
  });

  it("leaves a groupless molecule untouched by every id-rewriting op", () => {
    const { mol, c2, c3 } = chlorobutanol();
    // The regression guard for "a new optional field must cost the common case
    // nothing": every one of these builds a fresh record.
    expect(Object.hasOwn(removeAtoms(mol, [c3]), "stereoGroups")).toBe(false);
    const merged = mergeAtoms(mol, mol.atomIds[0] ?? "", c3);
    expect(merged.ok && Object.hasOwn(merged.molecule, "stereoGroups")).toBe(false);
    expect(Object.hasOwn(extractFragment(mol, [c2, c3]).molecule, "stereoGroups")).toBe(false);
    expect(
      Object.hasOwn(insertFragment(mol, extractFragment(mol, [c2]).molecule).molecule, "stereoGroups"),
    ).toBe(false);
    expect(Object.hasOwn(emptyMolecule(), "stereoGroups")).toBe(false);
  });
});

describe("the group maintenance primitives", () => {
  it("returns the same array when a prune changes nothing", () => {
    const groups = [{ kind: "and", index: 1, atomIds: ["a1", "a2"] }] as const;
    expect(prunedStereoGroups(groups, () => true)).toBe(groups);
    expect(prunedStereoGroups(groups, (id) => id !== "a1")).toEqual([
      { kind: "and", index: 1, atomIds: ["a2"] },
    ]);
    expect(prunedStereoGroups(groups, () => false)).toEqual([]);
  });

  it("re-sorts after a remap, because new ids do not sort like old ones", () => {
    const groups = [{ kind: "or", index: 1, atomIds: ["a2", "a3"] }] as const;
    const map = new Map([
      ["a2", "a9"],
      ["a3", "a4"],
    ]);
    expect(remappedStereoGroups(groups, map)).toEqual([
      { kind: "or", index: 1, atomIds: ["a4", "a9"] },
    ]);
    expect(remappedStereoGroups(groups, new Map())).toEqual([]);
  });

  it("offsets grafted indices per kind, independently", () => {
    const target = [
      { kind: "and", index: 3, atomIds: ["a1"] },
      { kind: "or", index: 1, atomIds: ["a2"] },
    ] as const;
    const fragment = [
      { kind: "and", index: 1, atomIds: ["f1"] },
      { kind: "or", index: 2, atomIds: ["f2"] },
    ] as const;
    const map = new Map([
      ["f1", "a7"],
      ["f2", "a8"],
    ]);
    // Canonical order, not append order: the result goes straight onto a
    // molecule, and a pasted `and4` sitting after the target's `or1` would make
    // a written file differ from the same file loaded back.
    expect(graftStereoGroups(target, fragment, map).map((g) => [g.kind, g.index])).toEqual([
      ["and", 3],
      ["and", 4],
      ["or", 1],
      ["or", 3],
    ]);
    expect(graftStereoGroups(target, fragment, new Map())).toBe(target);
  });
});

describe("a pasted molecule still writes the file it reads back", () => {
  it("keeps the group order canonical across a paste", () => {
    const { mol, c2, c3 } = chlorobutanol();
    const target = withStereoGroups(mol, [{ kind: "or", index: 1, atomIds: [c2, c3] }]);
    const { molecule: fragment } = extractFragment(target, [c2, c3]);
    const pasted = insertFragment(
      withStereoGroups(target, [
        { kind: "or", index: 1, atomIds: [c2] },
        { kind: "and", index: 1, atomIds: [c3] },
      ]),
      withStereoGroups(fragment, [
        { kind: "and", index: 1, atomIds: [fragment.atomIds[1] ?? ""] },
      ]),
    );
    expect(pasted.molecule.stereoGroups?.map((g) => [g.kind, g.index])).toEqual([
      ["and", 1],
      ["and", 2],
      ["or", 1],
    ]);
    // The property that matters downstream: putting the same list through the
    // validator changes nothing, so the writer sees one order either way.
    expect(withStereoGroups(pasted.molecule, pasted.molecule.stereoGroups ?? []).stereoGroups).toEqual(
      pasted.molecule.stereoGroups,
    );
  });
});
