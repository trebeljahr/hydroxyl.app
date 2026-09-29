import { describe, expect, it } from "vitest";

import {
  benzene,
  bounds,
  emptyMolecule,
  medianBondLength,
  molecularFormula,
  positions,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { dictionaryEntryById, dictionaryMolecule } from "@starter/chem-core/dictionary";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { INSERT_GAP_BONDS, insertOffset, insertStructure } from "./insert";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

function caffeine(): Molecule {
  return dictionaryMolecule(dictionaryEntryById("caffeine")!);
}

describe("insertStructure", () => {
  it("centres a structure inserted into an empty sketch on the origin", () => {
    const store = storeWith(emptyMolecule());
    insertStructure(store, caffeine(), "caffeine");
    const mol = store.getState().document.molecule;
    expect(molecularFormula(mol)).toBe("C8H10N4O2");
    const box = bounds(positions(mol));
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 9);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(0, 9);
  });

  it("adds beside the drawing, clear of it, as ONE undo entry", () => {
    const drawn = benzene();
    const store = storeWith(drawn);
    const entries = store.getState().history.past.length;

    insertStructure(store, caffeine(), "caffeine");
    const mol = store.getState().document.molecule;
    // Benzene plus caffeine, as two components of one sketch.
    expect(molecularFormula(mol)).toBe("C14H16N4O2");
    expect(store.getState().history.past.length).toBe(entries + 1);
    expect(store.getState().history.past.at(-1)?.label).toBe("Insert caffeine");

    // Every inserted atom sits at least the gap to the right of the drawing.
    const drawnRight = bounds(positions(drawn)).max.x;
    const inserted = mol.atomIds.filter((id) => !drawn.atomIds.includes(id));
    for (const id of inserted) {
      expect(mol.atoms[id]!.pos.x).toBeGreaterThanOrEqual(drawnRight + INSERT_GAP_BONDS - 1e-9);
    }

    store.getState().undo();
    expect(store.getState().document.molecule).toBe(drawn);
  });

  it("selects what it inserted, so it can be dragged or deleted at once", () => {
    const store = storeWith(benzene());
    insertStructure(store, caffeine(), "caffeine");
    const { selection, document } = store.getState();
    expect(selection.atomIds).toHaveLength(14);
    for (const id of selection.atomIds) expect(benzene().atomIds).not.toContain(id);
    expect(selection.bondIds.every((id) => id in document.molecule.bonds)).toBe(true);
  });

  it("scales the structure to the drawing's own bond length", () => {
    // A sketch imported in Angstroms: caffeine must match its bonds.
    const store = storeWith(benzene(1.54));
    insertStructure(store, caffeine(), "caffeine");
    expect(medianBondLength(store.getState().document.molecule)).toBeCloseTo(1.54, 6);
  });

  it("reports what it inserted, formula included", () => {
    const store = storeWith(emptyMolecule());
    insertStructure(store, caffeine(), "caffeine");
    expect(store.getState().ui.statusMessage).toBe("Inserted caffeine (C₈H₁₀N₄O₂)");
  });

  it("inserts nothing for a structure with no atoms, and says so", () => {
    const store = storeWith(benzene());
    const before = store.getState().document.molecule;
    insertStructure(store, emptyMolecule(), "nothing");
    expect(store.getState().document.molecule).toBe(before);
    expect(store.getState().ui.statusMessage).toContain("has no atoms");
  });
});

describe("insertOffset", () => {
  it("centres the new structure vertically on the drawing", () => {
    const drawn = benzene();
    const incoming = caffeine();
    const offset = insertOffset(drawn, incoming, 1);
    const a = bounds(positions(drawn));
    const b = bounds(positions(incoming));
    expect((b.min.y + b.max.y) / 2 + offset.y).toBeCloseTo((a.min.y + a.max.y) / 2, 9);
    expect(b.min.x + offset.x).toBeCloseTo(a.max.x + INSERT_GAP_BONDS, 9);
  });
});
