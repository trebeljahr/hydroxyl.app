import { describe, expect, it } from "vitest";
import { benzene, buildMolecule, linearChain } from "./builders.js";
import * as M from "./molecule.js";
import { removeAtom } from "./ops.js";
import {
  compareIds,
  EMPTY_SELECTION,
  expandToBonds,
  growSelection,
  invertSelection,
  isAtomSelected,
  isBondSelected,
  isEmptySelection,
  normalizeSelection,
  selectAll,
  selectFragment,
  selection,
  selectionBounds,
  selectionSize,
  selectionsEqual,
  shrinkSelection,
  subtractSelection,
  toggleAtom,
  toggleBond,
  unionSelections,
  type Selection,
} from "./selection.js";
import type { AtomId, BondId, Molecule } from "./types.js";
import { vec, type Vec2 } from "./vec.js";

/**
 * Hand-computed ring coordinates are exact in decimal but come out of
 * `Math.cos`/`Math.sin`, so cos(-PI/2) is 6e-17 rather than 0. 1e-9 is far
 * tighter than any real defect (a mis-centred box is off by a bond length)
 * while leaving eight orders of headroom over that.
 */
const EPS = 1e-9;

function bondId(mol: Molecule, a: AtomId, b: AtomId): BondId {
  const bond = M.bondBetween(mol, a, b);
  if (!bond) throw new Error(`Expected a bond between ${a} and ${b}`);
  return bond.id;
}

/** Every ring bond of a benzene built by `benzene()`, in ring order. */
function ringBondIds(mol: Molecule): BondId[] {
  const ids = mol.atomIds;
  return ids.map((id, i) => bondId(mol, id, ids[(i + 1) % ids.length]!));
}

/**
 * Ethanol and methylamine drawn side by side: two real fragments in one
 * document, which is what a scheme with a reagent off to the right looks
 * like. Atoms a1-a3 / bonds b4-b5 are the ethanol; a6-a7 / b8 the amine.
 */
function twoFragments(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1, 0));
    const o = b.atom("O", vec(2, 0));
    b.bond(c1, c2);
    b.bond(c2, o);
    const c3 = b.atom("C", vec(0, 3));
    const n = b.atom("N", vec(1, 3));
    b.bond(c3, n);
  });
}

/** Assert canonical form by rebuilding the same selection in a jumbled order. */
function expectSameSelection(
  actual: Selection,
  atomIds: readonly AtomId[],
  bondIds: readonly BondId[] = [],
): void {
  const shuffled = selection([...atomIds].reverse(), [...bondIds].reverse());
  expect(actual).toEqual(shuffled);
  expect(selectionsEqual(actual, shuffled)).toBe(true);
}

function expectVecClose(actual: Vec2, expected: Vec2): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(EPS);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(EPS);
}

describe("canonical form", () => {
  it("dedupes and sorts, so build order cannot be observed", () => {
    const a = selection(["a3", "a1", "a2"]);
    const b = selection(["a2", "a1", "a3", "a1"]);
    expect(a).toEqual(b);
    expect(selectionsEqual(a, b)).toBe(true);
    expect(a.atomIds).toEqual(["a1", "a2", "a3"]);
  });

  it("orders a9 before a10 rather than lexicographically", () => {
    const built = selection([
      "a10",
      "a2",
      "a11",
      "a9",
      "a1",
      "a12",
      "a3",
      "a20",
      "a4",
      "a5",
      "a100",
      "a6",
    ]);
    expect(built.atomIds).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
      "a9",
      "a10",
      "a11",
      "a12",
      "a20",
      "a100",
    ]);
  });

  it("keeps ids without a numeric tail comparable and stable", () => {
    // An importer may hand us anything ("R", "Cat", a UUID). Those have no
    // integer to compare, so they fall back to string order — the contract
    // that survives is that two shuffles still canonicalise identically.
    const ids = ["R", "a10", "a9", "Cat", "b2"];
    const forwards = selection(ids);
    const backwards = selection([...ids].reverse());
    expect(forwards).toEqual(backwards);
    expect(forwards.atomIds).toContain("R");
    expect(forwards.atomIds.indexOf("a9")).toBeLessThan(
      forwards.atomIds.indexOf("a10"),
    );
  });

  it("reports emptiness and size across atoms and bonds", () => {
    expect(isEmptySelection(EMPTY_SELECTION)).toBe(true);
    expect(selectionSize(EMPTY_SELECTION)).toBe(0);
    const s = selection(["a1", "a2"], ["b7"]);
    expect(isEmptySelection(s)).toBe(false);
    expect(selectionSize(s)).toBe(3);
    expect(isAtomSelected(s, "a1")).toBe(true);
    expect(isAtomSelected(s, "b7")).toBe(false);
    expect(isBondSelected(s, "b7")).toBe(true);
    expect(isBondSelected(s, "b8")).toBe(false);
  });

  it("distinguishes selections that differ only in bonds", () => {
    expect(
      selectionsEqual(selection(["a1"], ["b7"]), selection(["a1"], ["b8"])),
    ).toBe(false);
    expect(selectionsEqual(selection(["a1"]), selection(["a1", "a2"]))).toBe(
      false,
    );
  });
});

describe("expandToBonds", () => {
  it("picks up the bond between two adjacent benzene atoms and nothing else", () => {
    const mol = benzene();
    const [a1, a2] = [mol.atomIds[0]!, mol.atomIds[1]!];
    const expanded = expandToBonds(mol, selection([a2, a1]));
    expect(expanded.bondIds).toEqual([bondId(mol, a1, a2)]);
    expectSameSelection(expanded, [a1, a2], [bondId(mol, a1, a2)]);
  });

  it("adds no bond for two meta atoms, which share no bond", () => {
    const mol = benzene();
    const [a1, a3] = [mol.atomIds[0]!, mol.atomIds[2]!];
    const expanded = expandToBonds(mol, selection([a1, a3]));
    expect(expanded.bondIds).toEqual([]);
    expect(expanded.atomIds).toEqual([a1, a3]);
  });

  it("takes the whole ring when the whole ring is selected", () => {
    const mol = benzene();
    const expanded = expandToBonds(mol, selection(mol.atomIds));
    expect(expanded.bondIds).toHaveLength(6);
    expectSameSelection(expanded, mol.atomIds, ringBondIds(mol));
  });
});

describe("normalizeSelection", () => {
  it("drops an atom the molecule no longer has, and the bonds that went with it", () => {
    const mol = benzene();
    const [a1, a2, a3] = [mol.atomIds[0]!, mol.atomIds[1]!, mol.atomIds[2]!];
    const held = expandToBonds(mol, selection([a1, a2, a3]));
    expect(held.bondIds).toHaveLength(2);

    // Deleting a2 takes both of its ring bonds with it, so the held selection
    // now names one missing atom and two missing bonds.
    const edited = removeAtom(mol, a2);
    const normalized = normalizeSelection(edited, held);

    expect(normalized.atomIds).toEqual([a1, a3]);
    expect(normalized.bondIds).toEqual([]);
    expectSameSelection(normalized, [a1, a3]);
  });

  it("leaves a selection that is already canonical alone", () => {
    const mol = benzene();
    const all = selectAll(mol);
    expect(normalizeSelection(mol, all)).toEqual(all);
  });

  it("does not resurrect a bond the user deselected", () => {
    // The gesture: everything selected, then shift-drag over one ring bond to
    // drop that bond while keeping both its carbons. Normalising afterwards —
    // which happens after any unrelated edit — must not re-derive it from its
    // still-selected endpoints, or the deselection silently undoes itself.
    const mol = benzene();
    const [a1, a2] = [mol.atomIds[0]!, mol.atomIds[1]!];
    const b12 = bondId(mol, a1, a2);

    const deselected = subtractSelection(selectAll(mol), selection([], [b12]));
    expect(deselected.bondIds).toHaveLength(5);
    expect(isBondSelected(deselected, b12)).toBe(false);

    const normalized = normalizeSelection(mol, deselected);
    expect(isBondSelected(normalized, b12)).toBe(false);
    expect(normalized).toEqual(deselected);
  });

  it("keeps a clicked bond whose endpoints are not selected", () => {
    // A single clicked bond — the "promote it to a double" selection — has no
    // atoms in it at all. Normalise may only drop ids the molecule lacks, so
    // this must survive untouched rather than being cleaned up as dangling.
    const mol = benzene();
    const clicked = selection([], [bondId(mol, mol.atomIds[0]!, mol.atomIds[1]!)]);
    expect(normalizeSelection(mol, clicked)).toEqual(clicked);
  });

  it("still drops that bond once the molecule loses it", () => {
    const mol = benzene();
    const [a1, a2] = [mol.atomIds[0]!, mol.atomIds[1]!];
    const clicked = selection([], [bondId(mol, a1, a2)]);
    expect(normalizeSelection(removeAtom(mol, a1), clicked)).toEqual(
      EMPTY_SELECTION,
    );
  });
});

describe("selectAll and selectFragment", () => {
  it("selects every atom and bond of the molecule", () => {
    const mol = linearChain(5);
    const all = selectAll(mol);
    expect(all.atomIds).toHaveLength(5);
    expect(all.bondIds).toHaveLength(4);
    expectSameSelection(all, mol.atomIds, mol.bondIds);
  });

  it("takes exactly the clicked fragment, bonds included", () => {
    const mol = twoFragments();
    const ethanol = mol.atomIds.slice(0, 3);
    const amine = mol.atomIds.slice(3);

    const fromEthanol = selectFragment(mol, ethanol[1]!);
    expectSameSelection(fromEthanol, ethanol, mol.bondIds.slice(0, 2));

    const fromAmine = selectFragment(mol, amine[0]!);
    expectSameSelection(fromAmine, amine, [mol.bondIds[2]!]);
  });

  it("returns the empty selection for an atom that has been removed", () => {
    const mol = twoFragments();
    const gone = mol.atomIds[0]!;
    expect(selectFragment(removeAtom(mol, gone), gone)).toEqual(
      EMPTY_SELECTION,
    );
  });
});

describe("invertSelection", () => {
  it("swaps one fragment for the other, bonds included", () => {
    const mol = twoFragments();
    const ethanol = mol.atomIds.slice(0, 3);
    const amine = mol.atomIds.slice(3);

    const inverted = invertSelection(mol, selectFragment(mol, ethanol[0]!));
    expectSameSelection(inverted, amine, [mol.bondIds[2]!]);
  });

  it("never leaves a bond dangling between two unselected atoms", () => {
    const mol = benzene();
    // Invert a selection that literally names every bond: inverting the bond
    // set as written would keep all six, none of whose endpoints survive.
    const inverted = invertSelection(mol, selectAll(mol));
    expect(inverted).toEqual(EMPTY_SELECTION);
  });

  it("round-trips: inverting twice gives back the fragment", () => {
    const mol = twoFragments();
    const fragment = selectFragment(mol, mol.atomIds[0]!);
    expect(invertSelection(mol, invertSelection(mol, fragment))).toEqual(
      fragment,
    );
  });
});

describe("grow and shrink", () => {
  it("grows one shell: a benzene atom picks up its two ring neighbours", () => {
    const mol = benzene();
    const [a1, a2, a6] = [mol.atomIds[0]!, mol.atomIds[1]!, mol.atomIds[5]!];
    const grown = growSelection(mol, selection([a1]));
    expectSameSelection(
      grown,
      [a1, a2, a6],
      [bondId(mol, a1, a2), bondId(mol, a6, a1)],
    );
  });

  it("grows from a selected bond by way of its endpoints", () => {
    const mol = linearChain(5);
    const [a1, a2, a3] = [mol.atomIds[0]!, mol.atomIds[1]!, mol.atomIds[2]!];
    const grown = growSelection(mol, selection([], [bondId(mol, a1, a2)]));
    expect(grown.atomIds).toEqual([a1, a2, a3]);
  });

  it("shrinks a chain to its interior", () => {
    const mol = linearChain(5);
    const ids = mol.atomIds;
    // The two end atoms each have a neighbour outside the selection once the
    // selection is only part of the chain — here the whole chain is selected,
    // so nothing is outside and the ends survive.
    expect(shrinkSelection(mol, selectAll(mol))).toEqual(selectAll(mol));
    // Selecting the first four drops a4, whose neighbour a5 sits outside.
    const partial = expandToBonds(mol, selection(ids.slice(0, 4)));
    const shrunk = shrinkSelection(mol, partial);
    expectSameSelection(
      shrunk,
      ids.slice(0, 3),
      [bondId(mol, ids[0]!, ids[1]!), bondId(mol, ids[1]!, ids[2]!)],
    );
  });

  it("leaves a whole benzene ring untouched, because a ring has no boundary", () => {
    // Not empty: every ring atom's neighbours are both inside the selection,
    // so shrink finds no boundary atom to drop. Shrink erodes an edge; a
    // closed cycle has none until something outside it is deselected.
    const mol = benzene();
    const all = selectAll(mol);
    expect(shrinkSelection(mol, all)).toEqual(all);
  });

  it("drops a stale id instead of mistaking it for an interior atom", () => {
    // A selection held across an undo can name an atom the molecule no longer
    // has. Such an id has no neighbours, and "all my neighbours are selected"
    // is vacuously true for an empty neighbourhood — so the phantom would be
    // kept as interior while the real ring atom around it was correctly
    // dropped for having neighbours outside the selection.
    const mol = benzene();
    const shrunk = shrinkSelection(mol, selection([mol.atomIds[0]!, "a999"]));
    expect(shrunk).toEqual(EMPTY_SELECTION);
    expect(isEmptySelection(shrunk)).toBe(true);
    expect(selectionSize(shrunk)).toBe(0);
  });

  it("shrink undoes grow for a run in the middle of a chain", () => {
    // Grow and shrink are inverse shapes: the shell grow adds is exactly the
    // boundary shrink drops, as long as the selection has a boundary to begin
    // with (both ends of this run sit inside the chain).
    const mol = linearChain(7);
    const middle = expandToBonds(mol, selection(mol.atomIds.slice(2, 5)));
    const grown = growSelection(mol, middle);
    expect(grown.atomIds).toHaveLength(5);
    expect(shrinkSelection(mol, grown)).toEqual(middle);
  });
});

describe("set algebra and toggling", () => {
  it("unions and subtracts, staying canonical", () => {
    const mol = benzene();
    const [a1, a2, a3] = [mol.atomIds[0]!, mol.atomIds[1]!, mol.atomIds[2]!];
    const b12 = bondId(mol, a1, a2);
    const b23 = bondId(mol, a2, a3);

    const union = unionSelections(
      selection([a2, a1], [b12]),
      selection([a3, a2], [b23]),
    );
    expectSameSelection(union, [a1, a2, a3], [b12, b23]);

    const difference = subtractSelection(union, selection([a2], [b23]));
    expectSameSelection(difference, [a1, a3], [b12]);
  });

  it("subtracts a bond without disturbing its atoms", () => {
    const mol = benzene();
    const [a1, a2] = [mol.atomIds[0]!, mol.atomIds[1]!];
    const b12 = bondId(mol, a1, a2);
    const trimmed = subtractSelection(
      selection([a1, a2], [b12]),
      selection([], [b12]),
    );
    expectSameSelection(trimmed, [a1, a2]);
  });

  it("subtracts an atom without silently dropping the bonds that touched it", () => {
    // Shift-dragging one carbon out of a fully selected benzene removes that
    // atom and nothing else. Its two ring bonds stay selected with an
    // unselected endpoint, which is legal (the same shape a clicked bond has)
    // and is what keeps the gesture honest: the user deselected one atom, not
    // two bonds. Deleting this selection removes those bonds and keeps the
    // carbon; dragging it moves five atoms and lets the bonds follow.
    const mol = benzene();
    const a1 = mol.atomIds[0]!;
    const trimmed = subtractSelection(selectAll(mol), selection([a1]));

    expect(trimmed.atomIds).toHaveLength(5);
    expect(isAtomSelected(trimmed, a1)).toBe(false);
    expect(trimmed.bondIds).toEqual(selectAll(mol).bondIds);
    for (const id of [bondId(mol, a1, mol.atomIds[1]!), bondId(mol, mol.atomIds[5]!, a1)]) {
      expect(isBondSelected(trimmed, id)).toBe(true);
    }
    // And normalising against the unchanged molecule leaves it exactly so.
    expect(normalizeSelection(mol, trimmed)).toEqual(trimmed);
  });

  it("toggles an atom in and out, leaving bonds alone", () => {
    const start = selection(["a2"], ["b7"]);
    const added = toggleAtom(start, "a10");
    expectSameSelection(added, ["a2", "a10"], ["b7"]);
    expect(toggleAtom(added, "a10")).toEqual(start);
  });

  it("toggles a bond in and out, leaving atoms alone", () => {
    const start = selection(["a1", "a2"], []);
    const added = toggleBond(start, "b7");
    expectSameSelection(added, ["a1", "a2"], ["b7"]);
    expect(toggleBond(added, "b7")).toEqual(start);
  });
});

describe("selectionBounds", () => {
  it("boxes half a benzene", () => {
    // benzene() at the origin puts vertices on the unit circle starting at
    // -90 degrees: a1 (0, -1), a2 (sqrt3/2, -1/2), a3 (sqrt3/2, 1/2).
    const mol = benzene();
    const half = expandToBonds(mol, selection(mol.atomIds.slice(0, 3)));
    const box = selectionBounds(mol, half);
    const halfRoot3 = Math.sqrt(3) / 2;
    expectVecClose(box.min, vec(0, -1));
    expectVecClose(box.max, vec(halfRoot3, 0.5));
    expect(Math.abs(box.width - halfRoot3)).toBeLessThan(EPS);
    expect(Math.abs(box.height - 1.5)).toBeLessThan(EPS);
  });

  it("gives the zero box for an empty selection", () => {
    const mol = benzene();
    expect(selectionBounds(mol, EMPTY_SELECTION)).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 0, y: 0 },
      width: 0,
      height: 0,
    });
  });

  it("ignores ids the molecule no longer has", () => {
    const mol = twoFragments();
    const stale = selection([mol.atomIds[0]!, "a999"]);
    const box = selectionBounds(mol, stale);
    expectVecClose(box.min, vec(0, 0));
    expectVecClose(box.max, vec(0, 0));
  });
});

describe("compareIds", () => {
  it("is a total order that reads ids the way a human does", () => {
    const ids = ["b3", "a10", "a9", "a", "a01", "a1", "b10"];
    expect([...ids].sort(compareIds)).toEqual(["a", "a01", "a1", "a9", "a10", "b3", "b10"]);
    expect(compareIds("a9", "a10")).toBeLessThan(0);
    expect(compareIds("a10", "a9")).toBeGreaterThan(0);
    expect(compareIds("a7", "a7")).toBe(0);
  });
});
