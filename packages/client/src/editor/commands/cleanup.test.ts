/**
 * "Clean up structure", with the layout function injected.
 *
 * NO RDKIT HERE, AND THAT IS THE DESIGN. `generate2DCoords` is a 6.9 MB wasm
 * behind a worker; the command's own behaviour — one undo entry, the
 * concurrent-edit guard, the failure path — is entirely about what it does
 * with the answer, and it is testable with a stub that returns one.
 */

import { describe, expect, it, vi } from "vitest";

import { benzene, elementCounts, netCharge, translateAtoms } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { buildCanvasScene } from "@/canvas/scene-bridge";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { CLEAN_UP_LABEL, cleanUpStructure } from "./cleanup";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

/** What RDKit really returns: a graph-identical molecule with FRESH ids. */
function relaidOut(mol: Molecule): Molecule {
  return translateAtoms(mol, mol.atomIds, { x: 3, y: -2 });
}

describe("cleanUpStructure", () => {
  it("records exactly ONE history entry, and one undo restores the layout", async () => {
    const store = storeWith(benzene());
    const before = store.getState().document.molecule;
    const entries = store.getState().history.past.length;

    await cleanUpStructure(store, async (mol) => ({
      ok: true,
      value: relaidOut(mol),
    }));

    expect(store.getState().history.past.length).toBe(entries + 1);
    expect(store.getState().history.past.at(-1)?.label).toBe(CLEAN_UP_LABEL);
    expect(store.getState().document.molecule).not.toBe(before);

    store.getState().undo();
    expect(store.getState().document.molecule).toBe(before);
  });

  it("keeps the CHEMISTRY, which is all a re-layout is allowed to keep", () => {
    // The acceptance line says "leaves the molecular graph unchanged", and
    // that is true only up to isomorphism: `generate2DCoords` round-trips
    // through a molblock, so every AtomId is re-minted from a1 and `nextId`
    // resets. Asserting on ids would be asserting on something the operation
    // does not promise.
    const before = benzene();
    const after = relaidOut(before);
    expect(elementCounts(after)).toEqual(elementCounts(before));
    expect(netCharge(after)).toBe(netCharge(before));
    expect(after.bondIds.map((id) => after.bonds[id]!.order).sort()).toEqual(
      before.bondIds.map((id) => before.bonds[id]!.order).sort(),
    );
  });

  it("declines rather than clobbers when the drawing changed during the await", async () => {
    // Loading the wasm takes long enough to draw another bond in. Writing the
    // result unconditionally would silently discard it.
    const store = storeWith(benzene());
    let drawnDuringAwait: Molecule | undefined;
    const layout = vi.fn(async (mol: Molecule) => {
      // The user draws while the worker is thinking.
      store
        .getState()
        .applyMoleculeEdit("Draw bond", (m) =>
          translateAtoms(m, [m.atomIds[0]!], { x: 1, y: 1 }),
        );
      drawnDuringAwait = store.getState().document.molecule;
      return { ok: true as const, value: relaidOut(mol) };
    });

    await cleanUpStructure(store, layout);

    expect(layout).toHaveBeenCalledOnce();
    expect(store.getState().ui.statusMessage).toContain("changed while");
    // The user's edit survived, by reference: nothing was written over it.
    expect(store.getState().document.molecule).toBe(drawnDuringAwait);
    expect(store.getState().history.past.at(-1)?.label).toBe("Draw bond");
  });

  it("surfaces a refusal verbatim and records nothing", async () => {
    // `moleculeToMolblock` fails by name on a cosmetic label (decision 8) and
    // on an unkekulizable aromatic-flagged structure. Flattening either to
    // "failed" would hide the one thing the user can act on.
    const store = storeWith(benzene());
    const entries = store.getState().history.past.length;

    await cleanUpStructure(store, async () => ({
      ok: false,
      error: { message: "Atoms a1, a2 carry a display label" },
    }));

    expect(store.getState().ui.statusMessage).toBe(
      "Atoms a1, a2 carry a display label",
    );
    expect(store.getState().history.past.length).toBe(entries);
  });

  it("points at the atom RDKit refused: held, selected and centred, until the next edit", async () => {
    // RDKit names the atom by INDEX, and the bridge maps it back to an id.
    // Shown bare, "atom # 3" was a number nobody could find on the drawing.
    const store = storeWith(benzene());
    const target = store.getState().document.molecule.atomIds[3]!;
    const message = "Explicit valence for atom # 3 C, 5, is greater than permitted";
    const entries = store.getState().history.past.length;

    await cleanUpStructure(store, async () => ({
      ok: false,
      error: { message, atomIds: [target] },
    }));

    const state = store.getState();
    expect(state.ui.refusal).toEqual({ source: "Clean up", atomIds: [target], message });
    expect(state.selection.atomIds).toEqual([target]);
    expect(state.ui.statusMessage).toBe(`Clean up stopped at the selected atom: ${message}`);
    expect(state.history.past.length).toBe(entries);
    const centre = modelToPx(
      buildCanvasScene(state.document, null).style,
      state.document.molecule.atoms[target]!.pos,
    );
    expect(state.viewport.pan).toEqual(centre);

    // Its ids describe the molecule that was refused, so the next edit — any
    // edit — takes it away.
    state.applyMoleculeEdit("Nudge", (m) => translateAtoms(m, [m.atomIds[0]!], { x: 1, y: 0 }));
    expect(store.getState().ui.refusal).toBeNull();
  });

  it("does not point at atoms of a drawing that changed during the await", async () => {
    const store = storeWith(benzene());
    const target = store.getState().document.molecule.atomIds[0]!;
    await cleanUpStructure(store, async () => {
      store
        .getState()
        .applyMoleculeEdit("Draw bond", (m) => translateAtoms(m, [m.atomIds[1]!], { x: 1, y: 1 }));
      return { ok: false, error: { message: "refused", atomIds: [target] } };
    });
    expect(store.getState().ui.refusal).toBeNull();
    expect(store.getState().ui.statusMessage).toBe("refused");
  });

  it("survives a throwing layout without leaving a transaction open", async () => {
    const store = storeWith(benzene());
    await cleanUpStructure(store, async () => {
      throw new Error("the worker died");
    });
    expect(store.getState().ui.statusMessage).toBe("the worker died");
    expect(store.getState().history.transaction).toBeNull();
  });

  it("says so rather than working on an empty sketch", async () => {
    const store = createEditorStore({ now: () => "2024-01-01T00:00:00.000Z" });
    const layout = vi.fn();
    await cleanUpStructure(store, layout as never);
    expect(layout).not.toHaveBeenCalled();
    expect(store.getState().ui.statusMessage).toContain("nothing to clean up");
  });
});
