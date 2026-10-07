/**
 * Decision 225's two commands, driven through the real store, so "one undo
 * step each" is asserted where it can fail: at the seam.
 *
 * tert-Butyl phenylcarbamate, both groups stamped: a real carbamate, so a
 * regression reads as a chemistry error.
 */

import { describe, expect, it } from "vitest";

import { abbreviationsOf, attachGroupToAtom, benzene, linearChain, molecularFormula } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { buildContextMenu, menuItems } from "@/editor/context-menu";
import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import {
  canCollapse,
  canExpand,
  collapseMenuLabel,
  collapseSelection,
  expandSelection,
} from "./abbreviations";
import { commandById } from "./registry";

function bocAniline(): { mol: Molecule; nitrogen: AtomId; boc: readonly AtomId[] } {
  const ring = benzene();
  const amine = attachGroupToAtom(ring, ring.atomIds[0]!, "NH2");
  const boc = attachGroupToAtom(amine.molecule, amine.atomIds[0]!, "Boc");
  return { mol: boc.molecule, nitrogen: amine.atomIds[0]!, boc: boc.atomIds };
}

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

const never = (): string | null => {
  throw new Error("asked for a label it should have recognised");
};

describe("Collapse to abbreviation", () => {
  it("contracts the stamped group around one selected atom, in one undo step", () => {
    const { mol, boc } = bocAniline();
    const store = storeWith(mol);
    store.getState().selectAtoms([boc[4]!]);
    expect(canCollapse(store.getState())).toBe(true);
    expect(collapseMenuLabel(store.getState())).toBe("Collapse to Boc");

    const entries = store.getState().history.past.length;
    collapseSelection(store, never);
    const after = store.getState().document.molecule;
    expect(abbreviationsOf(after)).toEqual([{ label: "Boc", atomIds: [...boc] }]);
    expect(molecularFormula(after)).toBe("C11H15NO2");
    expect(store.getState().history.past.length).toBe(entries + 1);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.molecule).toBe(mol);
  });

  it("recognises a heteroatom carrying a group without asking", () => {
    const { mol, nitrogen, boc } = bocAniline();
    const store = storeWith(mol);
    store.getState().selectAtoms([nitrogen, ...boc]);
    collapseSelection(store, never);
    expect(abbreviationsOf(store.getState().document.molecule)[0]?.label).toBe("NHBoc");
  });

  it("asks for a label the table does not know, and a cancel is no edit", () => {
    const chain = linearChain(5);
    const store = storeWith(chain);
    store.getState().selectAtoms(chain.atomIds.slice(1));
    const entries = store.getState().history.past.length;
    collapseSelection(store, () => null);
    expect(store.getState().history.past.length).toBe(entries);

    collapseSelection(store, (count) => (count === 4 ? " nBu " : null));
    expect(abbreviationsOf(store.getState().document.molecule)).toEqual([
      { label: "nBu", atomIds: chain.atomIds.slice(1) },
    ]);
  });

  it("selecting part of a contracted label selects all of it", () => {
    const { mol, boc } = bocAniline();
    const store = storeWith(mol);
    store.getState().selectAtoms([boc[0]!]);
    collapseSelection(store, never);
    store.getState().clearSelection();
    store.getState().selectAtoms([boc[0]!]);
    expect([...store.getState().selection.atomIds].sort()).toEqual([...boc].sort());
  });
});

describe("Expand abbreviation", () => {
  it("removes the label in one undo step and keeps every atom", () => {
    const { mol, boc } = bocAniline();
    const store = storeWith(mol);
    store.getState().selectAtoms([boc[0]!]);
    collapseSelection(store, never);
    const contracted = store.getState().document.molecule;
    expect(canExpand(store.getState())).toBe(true);

    const entries = store.getState().history.past.length;
    expandSelection(store);
    expect(abbreviationsOf(store.getState().document.molecule)).toEqual([]);
    expect(store.getState().document.molecule.atomIds).toEqual(mol.atomIds);
    expect(store.getState().history.past.length).toBe(entries + 1);
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.molecule).toBe(contracted);
  });

  it("is offered on a contracted label's context menu, Collapse on a plain atom's", () => {
    const { mol, boc } = bocAniline();
    const store = storeWith(mol);
    store.getState().selectAtoms([boc[0]!]);
    const before = menuItems(buildContextMenu({ kind: "atom", atomId: boc[0]! }, store.getState()).entries);
    expect(before.find((item) => item.id === "structure.collapse-abbreviation")?.label).toBe("Collapse to Boc");
    expect(before.some((item) => item.id === "structure.expand-abbreviation")).toBe(false);

    collapseSelection(store, never);
    const after = menuItems(buildContextMenu({ kind: "selection" }, store.getState()).entries);
    expect(after.some((item) => item.id === "structure.expand-abbreviation")).toBe(true);
    expect(after.some((item) => item.id === "structure.collapse-abbreviation")).toBe(false);
    expect(commandById("structure.expand-abbreviation").enabled(store.getState())).toBe(true);
  });
});
