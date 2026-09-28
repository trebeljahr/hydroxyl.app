/**
 * The registry commands and helpers the canvas context menu added, driven
 * against a REAL store and real molecules.
 *
 * Each command is also a palette row, so these are not menu tests: they pin
 * what the command does to the chemistry, what it refuses, and why it says it
 * refuses. The menu's own tests (`editor/context-menu.test.ts`) only check
 * that it reaches these.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  atomsCentroid,
  benzene,
  cipDescriptor,
  insertFragment,
  linearChain,
  requireAtom,
  requireBond,
} from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";
import { butan2olWedged } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import {
  applyHydrogenCount,
  applyIsotope,
  applyLonePairs,
  commandById,
  runCommand,
} from "./registry";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

/** Benzene at the origin and propane parked to its right and below it. */
function scheme(): { mol: Molecule; ring: readonly AtomId[]; chain: readonly AtomId[] } {
  const ring = benzene();
  const inserted = insertFragment(ring, linearChain(3), { offset: { x: 4, y: -3 } });
  return { mol: inserted.molecule, ring: ring.atomIds, chain: inserted.atomIds };
}

function pos(store: EditorStore, id: AtomId): Vec2 {
  return requireAtom(store.getState().document.molecule, id).pos;
}

function enabled(store: EditorStore, id: string): boolean {
  return commandById(id).enabled(store.getState());
}

function reason(store: EditorStore, id: string): string | undefined {
  return commandById(id).disabledReason?.(store.getState());
}

describe("flip and rotate the selection", () => {
  it("flips butan-2-ol left to right WITHOUT inverting its stereocentre", () => {
    const store = storeWith(butan2olWedged());
    const mol = store.getState().document.molecule;
    const before = cipDescriptor(mol, "a2");
    expect(before?.kind).toMatch(/^[RS]$/);
    store.getState().selectAll();
    const centre = atomsCentroid(mol, mol.atomIds);

    runCommand(store, "structure.flip-horizontal");

    for (const id of mol.atomIds) {
      expect(pos(store, id).x).toBeCloseTo(2 * centre.x - requireAtom(mol, id).pos.x, 12);
      expect(pos(store, id).y).toBeCloseTo(requireAtom(mol, id).pos.y, 12);
    }
    // A layout command: the drawing still names the same enantiomer.
    expect(cipDescriptor(store.getState().document.molecule, "a2")).toEqual(before);
    // One undo step puts it back.
    store.getState().undo();
    expect(store.getState().document.molecule).toBe(mol);
  });

  it("flips top to bottom about the selection's own centre", () => {
    const store = storeWith(benzene());
    const mol = store.getState().document.molecule;
    store.getState().selectAll();
    const centre = atomsCentroid(mol, mol.atomIds);
    runCommand(store, "structure.flip-vertical");
    for (const id of mol.atomIds) {
      expect(pos(store, id).y).toBeCloseTo(2 * centre.y - requireAtom(mol, id).pos.y, 12);
    }
  });

  it("turns clockwise ON THE PAGE, which is the negative angle in y-up model space", () => {
    const store = storeWith(linearChain(3));
    const mol = store.getState().document.molecule;
    store.getState().selectAll();
    const c = atomsCentroid(mol, mol.atomIds);
    runCommand(store, "structure.rotate-cw");
    // Clockwise by 90°: (dx, dy) -> (dy, -dx) about the centroid.
    for (const id of mol.atomIds) {
      const p = requireAtom(mol, id).pos;
      expect(pos(store, id).x).toBeCloseTo(c.x + (p.y - c.y), 12);
      expect(pos(store, id).y).toBeCloseTo(c.y - (p.x - c.x), 12);
    }
    runCommand(store, "structure.rotate-ccw");
    for (const id of mol.atomIds) {
      expect(pos(store, id).x).toBeCloseTo(requireAtom(mol, id).pos.x, 12);
      expect(pos(store, id).y).toBeCloseTo(requireAtom(mol, id).pos.y, 12);
    }
  });

  it("turns 180° as a half turn, and twice as nothing", () => {
    const store = storeWith(butan2olWedged());
    const mol = store.getState().document.molecule;
    store.getState().selectAll();
    runCommand(store, "structure.rotate-180");
    runCommand(store, "structure.rotate-180");
    for (const id of mol.atomIds) {
      expect(pos(store, id).x).toBeCloseTo(requireAtom(mol, id).pos.x, 12);
      expect(pos(store, id).y).toBeCloseTo(requireAtom(mol, id).pos.y, 12);
    }
  });

  it("moves the endpoints of a selected bond, as a drag would", () => {
    const store = storeWith(linearChain(3));
    const mol = store.getState().document.molecule;
    const bond = requireBond(mol, mol.bondIds[0]!);
    store.getState().selectBonds([bond.id]);
    expect(enabled(store, "structure.rotate-180")).toBe(true);
    runCommand(store, "structure.rotate-180");
    // A half turn about the bond's midpoint swaps its two ends.
    expect(pos(store, bond.from).x).toBeCloseTo(requireAtom(mol, bond.to).pos.x, 12);
    expect(pos(store, bond.to).y).toBeCloseTo(requireAtom(mol, bond.from).pos.y, 12);
  });

  it("refuses one atom, and says why", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1"]);
    for (const id of ["structure.flip-horizontal", "structure.rotate-cw"]) {
      expect(enabled(store, id), id).toBe(false);
      expect(reason(store, id), id).toMatch(/at least two atoms/);
    }
  });
});

describe("align structures", () => {
  it("puts benzene and propane on one top line, named by one atom each", () => {
    const { mol, ring, chain } = scheme();
    const store = storeWith(mol);
    store.getState().selectAtoms([ring[0]!, chain[1]!]);
    expect(enabled(store, "structure.align-top")).toBe(true);

    runCommand(store, "structure.align-top");

    const top = (ids: readonly AtomId[]): number => Math.max(...ids.map((id) => pos(store, id).y));
    expect(top(chain)).toBeCloseTo(top(ring), 12);
    // The whole of propane moved, not just the one atom that named it.
    expect(pos(store, chain[0]!).y - requireAtom(mol, chain[0]!).pos.y).toBeCloseTo(
      pos(store, chain[2]!).y - requireAtom(mol, chain[2]!).pos.y,
      12,
    );
  });

  it("refuses a selection inside one structure, and says why", () => {
    const { mol, ring } = scheme();
    const store = storeWith(mol);
    store.getState().selectAtoms([...ring]);
    expect(enabled(store, "structure.align-left")).toBe(false);
    expect(reason(store, "structure.align-left")).toMatch(/two or more separate structures/);
  });
});

describe("invert stereocentre", () => {
  it("turns the selected centre of butan-2-ol into its enantiomer's", () => {
    const store = storeWith(butan2olWedged());
    const before = cipDescriptor(store.getState().document.molecule, "a2");
    store.getState().selectAtoms(["a2"]);
    expect(enabled(store, "structure.invert-stereo")).toBe(true);
    runCommand(store, "structure.invert-stereo");
    const after = cipDescriptor(store.getState().document.molecule, "a2");
    expect(after?.kind).toMatch(/^[RS]$/);
    expect(after?.kind).not.toBe(before?.kind);
  });

  it("refuses the oxygen, whose wedge belongs to the carbon", () => {
    const store = storeWith(butan2olWedged());
    // a5: the fixture mints the four carbons first.
    store.getState().selectAtoms(["a5"]);
    expect(requireAtom(store.getState().document.molecule, "a5").element).toBe("O");
    expect(enabled(store, "structure.invert-stereo")).toBe(false);
    expect(reason(store, "structure.invert-stereo")).toMatch(/own wedge or hash/);
  });
});

describe("select connected / invert selection", () => {
  it("grows one propane atom to all of propane and none of benzene", () => {
    const { mol, chain } = scheme();
    const store = storeWith(mol);
    store.getState().selectAtoms([chain[1]!]);
    runCommand(store, "select.connected");
    const { atomIds, bondIds } = store.getState().selection;
    expect([...atomIds].sort()).toEqual([...chain].sort());
    expect(bondIds).toHaveLength(2);
  });

  it("inverts a selected propane into all of benzene", () => {
    const { mol, ring, chain } = scheme();
    const store = storeWith(mol);
    store.getState().selectAtoms([...chain]);
    runCommand(store, "select.invert");
    const { atomIds, bondIds } = store.getState().selection;
    expect([...atomIds].sort()).toEqual([...ring].sort());
    expect(bondIds).toHaveLength(6);
  });
});

describe("double-bond position", () => {
  it("pins the inner line on the selected DOUBLE bonds and leaves singles alone", () => {
    const store = storeWith(benzene());
    const mol = store.getState().document.molecule;
    const double = mol.bondIds.find((id) => requireBond(mol, id).order === 2)!;
    const single = mol.bondIds.find((id) => requireBond(mol, id).order === 1)!;
    store.getState().selectBonds([double, single]);
    runCommand(store, "bond.side.left");
    const after = store.getState().document.molecule;
    expect(requireBond(after, double).doubleBondSide).toBe("left");
    expect(requireBond(after, single).doubleBondSide).toBe(requireBond(mol, single).doubleBondSide);
  });

  it("refuses a selection with no double bond, and says why", () => {
    const store = storeWith(linearChain(3));
    store.getState().selectBonds([store.getState().document.molecule.bondIds[0]!]);
    expect(enabled(store, "bond.side.centered")).toBe(false);
    expect(reason(store, "bond.side.centered")).toMatch(/double bond/);
  });
});

describe("fuse ring onto the selected bond", () => {
  it("fuses benzene onto benzene: naphthalene, ten carbons and eleven bonds", () => {
    const store = storeWith(benzene());
    store.getState().selectBonds([store.getState().document.molecule.bondIds[0]!]);
    runCommand(store, "ring.fuse.benzene");
    const mol = store.getState().document.molecule;
    expect(mol.atomIds).toHaveLength(10);
    expect(mol.bondIds).toHaveLength(11);
  });

  it("refuses naphthalene's fusion bond with the ring tool's own words", () => {
    const store = storeWith(benzene());
    const first = store.getState().document.molecule.bondIds[0]!;
    store.getState().selectBonds([first]);
    runCommand(store, "ring.fuse.benzene");
    // The shared bond now has a ring on each side.
    store.getState().selectBonds([first]);
    expect(enabled(store, "ring.fuse.cyclohexane")).toBe(false);
    expect(reason(store, "ring.fuse.cyclohexane")).toBe("That bond already has a ring on each side");
  });

  it("refuses two bonds at once", () => {
    const store = storeWith(benzene());
    const [a, b] = store.getState().document.molecule.bondIds;
    store.getState().selectBonds([a!, b!]);
    expect(enabled(store, "ring.fuse.benzene")).toBe(false);
    expect(reason(store, "ring.fuse.benzene")).toMatch(/exactly one bond/);
  });
});

describe("per-atom helpers", () => {
  let store: EditorStore;
  beforeEach(() => {
    store = storeWith(butan2olWedged());
    store.getState().selectAtoms(["a1", "a2"]);
  });

  const atom = (id: AtomId) => requireAtom(store.getState().document.molecule, id);

  it("labels ¹³C and clears it back to natural abundance, one undo step each", () => {
    applyIsotope(store, 13);
    expect(atom("a1").isotope).toBe(13);
    expect(atom("a2").isotope).toBe(13);
    applyIsotope(store, undefined);
    expect(atom("a1").isotope).toBeUndefined();
    store.getState().undo();
    expect(atom("a1").isotope).toBe(13);
  });

  it("pins and releases the hydrogen count", () => {
    applyHydrogenCount(store, 2);
    expect(atom("a2").explicitHydrogenCount).toBe(2);
    applyHydrogenCount(store, undefined);
    expect(atom("a2").explicitHydrogenCount).toBeUndefined();
  });

  it("pins and releases the lone pairs", () => {
    store.getState().selectAtoms(["a5"]);
    applyLonePairs(store, 3);
    expect(atom("a5").lonePairs).toBe(3);
    applyLonePairs(store, undefined);
    expect(atom("a5").lonePairs).toBeUndefined();
  });

  it("does nothing with no atom selected", () => {
    store.getState().clearSelection();
    const before = store.getState().document.molecule;
    applyIsotope(store, 13);
    applyHydrogenCount(store, 1);
    applyLonePairs(store, 1);
    expect(store.getState().document.molecule).toBe(before);
  });
});
