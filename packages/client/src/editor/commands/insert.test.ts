import { describe, expect, it } from "vitest";

import {
  benzene,
  bounds,
  emptyMolecule,
  insertFragment,
  medianBondLength,
  molecularFormula,
  positions,
  species,
} from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { dictionaryEntryById, dictionaryMolecule } from "@starter/chem-core/dictionary";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { INSERT_GAP_BONDS, clearOfDrawingOffset, insertOffset, insertStructure } from "./insert";
import { commandById } from "./registry";

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

describe("clearOfDrawingOffset (decision 200)", () => {
  const GAP = INSERT_GAP_BONDS;

  it("keeps a copy where it is when nothing is in the way", () => {
    // Cut and pasted back: the drawing no longer holds the source.
    const ring = benzene();
    expect(clearOfDrawingOffset(emptyMolecule(), bounds(positions(ring)), 1)).toEqual({ x: 0, y: 0 });
  });

  it("puts a duplicate the gap to the right of its whole source, level with it", () => {
    const ring = benzene();
    const box = bounds(positions(ring));
    const offset = clearOfDrawingOffset(ring, box, 1);
    expect(offset.y).toBe(0);
    expect(box.min.x + offset.x).toBeCloseTo(box.max.x + GAP, 12);
  });

  it("jumps past every structure already in the row, and only those", () => {
    // Three benzenes in a row, and one far below them that is not in the way.
    const ring = benzene();
    const box = bounds(positions(ring));
    const step = box.width + GAP;
    let row = ring;
    for (const k of [1, 2]) row = insertFragment(row, ring, { offset: { x: k * step, y: 0 } }).molecule;
    row = insertFragment(row, ring, { offset: { x: 10 * step, y: -10 * box.height } }).molecule;
    const offset = clearOfDrawingOffset(row, box, 1);
    expect(offset.y).toBe(0);
    expect(box.min.x + offset.x).toBeCloseTo(box.max.x + 2 * step + GAP, 12);
  });
});

describe("paste and duplicate land clear of the drawing (decision 200)", () => {
  /** Each structure's atom box. */
  function speciesBoxes(mol: Molecule): ReturnType<typeof bounds>[] {
    return species(mol).map((unit) => bounds(unit.atomIds.map((id) => mol.atoms[id]!.pos)));
  }

  it("duplicates the open-chain glucose twice into one row of three clear structures", () => {
    const glucose = dictionaryMolecule(dictionaryEntryById("aldehydo-d-glucose")!);
    const store = storeWith(glucose);
    store.getState().selectAll();
    commandById("edit.duplicate").run(store);
    commandById("edit.duplicate").run(store);

    const boxes = speciesBoxes(store.getState().document.molecule).sort((a, b) => a.min.x - b.min.x);
    expect(boxes).toHaveLength(3);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.min.x - boxes[i - 1]!.max.x).toBeCloseTo(GAP_OF(glucose), 9);
      expect(boxes[i]!.min.y).toBeCloseTo(boxes[0]!.min.y, 9);
    }
  });

  it("pastes beside the structure it was copied from, and back in place after a cut", () => {
    const store = storeWith(benzene());
    store.getState().selectAll();
    commandById("edit.copy").run(store);
    commandById("edit.paste").run(store);
    const [left, right] = speciesBoxes(store.getState().document.molecule).sort((a, b) => a.min.x - b.min.x);
    expect(right!.min.x - left!.max.x).toBeCloseTo(GAP_OF(benzene()), 9);

    const cut = storeWith(benzene());
    const before = cut.getState().document.molecule;
    cut.getState().selectAll();
    commandById("edit.cut").run(cut);
    commandById("edit.paste").run(cut);
    const back = cut.getState().document.molecule;
    expect(bounds(positions(back))).toEqual(bounds(positions(before)));
  });

  it("fits the view to a copy that lands outside it, and leaves it alone otherwise", () => {
    const store = storeWith(benzene());
    store.getState().selectAll();
    commandById("view.fit").run(store);
    const fitted = store.getState().viewport;
    commandById("edit.duplicate").run(store);
    // The fitted view held one ring; the copy two gaps to its right is outside it.
    expect(store.getState().viewport).not.toBe(fitted);

    // Zoomed right out, the next copy lands in view and the view stays put.
    store.getState().selectAtoms([store.getState().document.molecule.atomIds[0]!]);
    store.getState().setZoom(0.05);
    const zoomedOut = store.getState().viewport;
    commandById("edit.duplicate").run(store);
    expect(store.getState().viewport).toBe(zoomedOut);
  });
});

/** The gap in model units at the drawing's own bond length. */
function GAP_OF(mol: Molecule): number {
  return INSERT_GAP_BONDS * (medianBondLength(mol) ?? 1);
}
