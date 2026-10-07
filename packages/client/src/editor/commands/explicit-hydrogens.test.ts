/**
 * "Add explicit H" and "Remove explicit H", driven through the real store.
 *
 * The store and not the functions, for `stereo-groups.test.ts`'s reason: "one
 * undo step each" is a property of the seam, and only `undo()` checks it.
 * Ethanol, so a regression reads as C2H6O coming out wrong.
 */

import { describe, expect, it } from "vitest";

import { buildMolecule, elementCounts, implicitHydrogenCount, vec } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";
import { schemeAnnotationId } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { commandById } from "./registry";
import {
  NO_EXPLICIT_H_REASON,
  NO_IMPLICIT_H_REASON,
  addExplicitHydrogensToSelection,
  removeExplicitHydrogensFromSelection,
} from "./explicit-hydrogens";

/** CH3-CH2-OH; ids a1, a2, a4 (the counter is shared with bonds). */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(0.87, 0.5));
    b.bond(c1, c2);
    b.bond(c2, b.atom("O", vec(1.73, 0)));
  });
}

const O: AtomId = "a4";

function storeWith(
  molecule: Molecule,
  annotations: NonNullable<Parameters<typeof createDocument>[0]>["annotations"] = [],
): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, annotations, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

const drawnH = (mol: Molecule) => mol.atomIds.filter((id) => mol.atoms[id]!.element === "H");

describe("Add explicit H", () => {
  it("draws every hydrogen of the selection as one undo step", () => {
    const mol = ethanol();
    const store = storeWith(mol);
    store.getState().selectAtoms(mol.atomIds);
    addExplicitHydrogensToSelection(store);

    const after = store.getState().document.molecule;
    expect(drawnH(after)).toHaveLength(6);
    expect(elementCounts(after)).toEqual(elementCounts(mol));
    expect(store.getState().ui.statusMessage).toBe("Drew 6 hydrogens");
    // The new hydrogens are selected, so the inverse needs no reselection.
    expect(store.getState().selection.atomIds).toEqual(expect.arrayContaining(drawnH(after)));

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.molecule).toBe(mol);
    expect(store.getState().undo()).toBe(false);
  });

  it("is disabled, with the reason, when nothing selected has a hydrogen to draw", () => {
    const store = storeWith(ethanol());
    const command = commandById("structure.add-explicit-hydrogens")!;
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toBe("Select at least one atom first");

    store.getState().selectAtoms(store.getState().document.molecule.atomIds);
    addExplicitHydrogensToSelection(store);
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toBe(NO_IMPLICIT_H_REASON);
  });
});

describe("Remove explicit H", () => {
  it("puts the drawing back, as one undo step of its own", () => {
    const mol = ethanol();
    const store = storeWith(mol);
    store.getState().selectAtoms(mol.atomIds);
    addExplicitHydrogensToSelection(store);
    const drawn = store.getState().document.molecule;

    const command = commandById("structure.remove-explicit-hydrogens")!;
    expect(command.enabled(store.getState())).toBe(true);
    command.run(store);

    const after = store.getState().document.molecule;
    expect(drawnH(after)).toEqual([]);
    expect(implicitHydrogenCount(after, O)).toBe(1);
    expect(elementCounts(after)).toEqual(elementCounts(mol));
    expect(store.getState().ui.statusMessage).toBe("Folded 6 hydrogens into the implicit count");
    // The folded hydrogens leave the selection; the atoms they were on stay.
    expect(store.getState().selection.atomIds).toEqual(mol.atomIds);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.molecule).toBe(drawn);
  });

  it("keeps a hydrogen an annotation points at, and says so", () => {
    const mol = ethanol();
    const store = storeWith(mol);
    store.getState().selectAtoms([O]);
    addExplicitHydrogensToSelection(store);
    const drawn = store.getState().document.molecule;
    const [oh] = drawnH(drawn);

    const annotated = storeWith(drawn, [
      { id: schemeAnnotationId(1), kind: "partialCharge", atomId: oh!, sign: "+" },
    ]);
    annotated.getState().selectAtoms([O]);
    removeExplicitHydrogensFromSelection(annotated);
    expect(annotated.getState().document.molecule).toBe(drawn);
    expect(annotated.getState().document.annotations).toHaveLength(1);
    expect(annotated.getState().ui.statusMessage).toBe(
      "Kept 1 hydrogen that an arrow or annotation points at",
    );
    expect(annotated.getState().undo()).toBe(false);
  });

  it("is disabled, with the reason, when no drawn hydrogen is in reach", () => {
    const store = storeWith(ethanol());
    store.getState().selectAtoms([O]);
    const command = commandById("structure.remove-explicit-hydrogens")!;
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toBe(NO_EXPLICIT_H_REASON);
  });
});
