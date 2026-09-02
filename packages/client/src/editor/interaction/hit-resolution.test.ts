/**
 * The gesture loop driven through the REAL hit resolution.
 *
 * machine.test.ts feeds the reducer synthetic facts, which is the right shape
 * for enumerating what a gesture MEANS — but a synthetic fact names its target
 * atom, so no test built that way can ever ask the question this file exists
 * for: WHAT DOES THE PICK ACTUALLY ANSWER MID-GESTURE?
 *
 * It is a real question because the machine commits on every pointer-move. The
 * live molecule half-way through a drag already holds the gesture's own work —
 * the dragged atom sitting exactly under the pointer — so a pick against it
 * answers "the atom in your hand" and the merge target underneath is invisible.
 * The symptom is silent: the drop completes as a plain move and leaves two
 * unbonded atoms on identical coordinates, one blob on screen and two atoms in
 * the export. `resolveSample` picks against the gesture's base to avoid it, and
 * these tests are what hold that.
 *
 * Everything below runs the production path — `buildDocumentScene`,
 * `createSceneIndex`, `pickAt`, a real `createEditorStore` — with the pick
 * context rebuilt after every committed frame, exactly as EditorCanvas's
 * `useMemo` plus `useLayoutEffect` do. No DOM: none of those need layout.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { buildMolecule, isEmpty } from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { createSceneIndex } from "@/canvas/metrics";
import { buildDocumentScene } from "@/canvas/scene-bridge";
import type { PickContext } from "@/canvas/pick";
import { createEditorStore, toScreen } from "@/state";
import type { EditorStore, Selection } from "@/state";

import { resolveSample } from "./adapter";
import { IDLE } from "./facts";
import type { InteractionCommand, InteractionState, PointerFact } from "./facts";
import { reduce } from "./machine";

const NO_KEYS = { shift: false, alt: false } as const;

/**
 * A miniature of the adapter: pick, reduce, perform, keep the state.
 *
 * Deliberately NOT a mock of it. The two things this has to share with the
 * real adapter are that the sample comes from `resolveSample` and that the
 * pick context is rebuilt from the store after every command batch; everything
 * else here is scaffolding.
 */
class Harness {
  state: InteractionState = IDLE;

  constructor(readonly store: EditorStore) {}

  private context(): PickContext {
    const { document: doc, viewport } = this.store.getState();
    const scene = buildDocumentScene(doc);
    return {
      molecule: doc.molecule,
      viewport,
      index: createSceneIndex(scene, doc.molecule),
    };
  }

  /** Where a model point lands in canvas-local px, forwards through the chain. */
  canvasPointFor(model: Vec2): Vec2 {
    const ctx = this.context();
    return toScreen(ctx.viewport, modelToPx(ctx.index.scene.style, model));
  }

  private sampleAt(canvasPoint: Vec2, modifiers = NO_KEYS) {
    return resolveSample(
      this.context(),
      this.state,
      this.store.getState().selection,
      canvasPoint,
      modifiers,
    );
  }

  /** The hit the adapter would resolve right now, for assertions. */
  hitAt(canvasPoint: Vec2) {
    return this.sampleAt(canvasPoint).hit;
  }

  private dispatch(fact: PointerFact): void {
    const ctx = this.store.getState();
    const { state, commands } = reduce(this.state, fact, {
      molecule: ctx.document.molecule,
      tool: ctx.tool,
      toolOptions: ctx.toolOptions,
      selection: ctx.selection,
    });
    this.state = state;
    for (const command of commands) this.perform(command);
  }

  private perform(command: InteractionCommand): void {
    const store = this.store.getState();
    switch (command.kind) {
      case "beginTransaction":
        return store.beginTransaction(command.label);
      case "edit":
        return store.applyMoleculeEdit(command.label, command.edit);
      case "commitTransaction":
        return store.commitTransaction();
      case "abortTransaction":
        return store.abortTransaction();
      case "setSelection":
        return store.setSelection(command.selection);
      case "setHover":
        store.setHoveredAtom(command.atomId);
        return store.setHoveredBond(command.bondId);
      case "status":
        return store.setStatusMessage(command.message);
    }
  }

  press(model: Vec2, modifiers = NO_KEYS): void {
    this.dispatch({ kind: "press", sample: this.sampleAt(this.canvasPointFor(model), modifiers) });
  }

  dragStart(originModel: Vec2, model: Vec2, modifiers = NO_KEYS): void {
    const origin = this.sampleAt(this.canvasPointFor(originModel), modifiers);
    this.dispatch({
      kind: "dragStart",
      origin,
      sample: this.sampleAt(this.canvasPointFor(model), modifiers),
    });
  }

  dragMove(model: Vec2, modifiers = NO_KEYS): void {
    this.dispatch({ kind: "dragMove", sample: this.sampleAt(this.canvasPointFor(model), modifiers) });
  }

  dragEnd(model: Vec2, modifiers = NO_KEYS): void {
    this.dispatch({ kind: "dragEnd", sample: this.sampleAt(this.canvasPointFor(model), modifiers) });
  }

  /**
   * A whole drag: press, threshold crossing, `steps` moves, release.
   *
   * The last move and the release are at the SAME point, which is what a real
   * pointerup does — a mouse button is let go without moving the mouse. It
   * also happens to be the strictest case for the pick: by the release frame
   * the dragged atom is already committed exactly under the pointer, so a hit
   * test against the live molecule can only answer with the atom in hand.
   */
  drag(from: Vec2, to: Vec2, steps = 8): void {
    this.press(from);
    this.dragStart(from, lerp(from, to, 1 / steps));
    for (let i = 2; i <= steps; i += 1) {
      this.dragMove(lerp(from, to, i / steps));
    }
    this.dragEnd(to);
  }

  get molecule(): Molecule {
    return this.store.getState().document.molecule;
  }

  positionOf(id: AtomId): Vec2 | undefined {
    return this.molecule.atoms[id]?.pos;
  }
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Two bonded carbons and one free oxygen, at a unit bond length.
 *
 * Small on purpose: every coordinate below is a whole number of bond lengths
 * from the origin, so a failure reads as "the drop landed on the wrong atom"
 * rather than as arithmetic.
 */
function threeAtoms(): { molecule: Molecule; a1: AtomId; a2: AtomId; a3: AtomId } {
  let ids: [AtomId, AtomId, AtomId] | undefined;
  const molecule = buildMolecule((b) => {
    const a1 = b.atom("C", { x: 0, y: 0 });
    const a2 = b.atom("C", { x: 1, y: 0 });
    const a3 = b.atom("O", { x: 0, y: 2 });
    b.bond(a1, a2);
    ids = [a1, a2, a3];
  });
  const [a1, a2, a3] = ids!;
  return { molecule, a1, a2, a3 };
}

function storeWith(molecule: Molecule, selection?: Selection): EditorStore {
  const store = createEditorStore();
  store.getState().openDocument(
    createDocument({ molecule, title: "Probe", stylePreset: "screen" }),
    "Open probe",
  );
  store.getState().setViewportSize({ width: 800, height: 600 });
  if (selection) store.getState().setSelection(selection);
  return store;
}

describe("hit resolution mid-gesture", () => {
  let atoms: ReturnType<typeof threeAtoms>;

  beforeEach(() => {
    atoms = threeAtoms();
  });

  it("still sees the target atom under a dragged atom sitting on top of it", () => {
    const { molecule, a1, a3 } = atoms;
    const h = new Harness(storeWith(molecule, { atomIds: [a3], bondIds: [] }));

    h.press({ x: 0, y: 2 });
    h.dragStart({ x: 0, y: 2 }, { x: 0, y: 1.5 });
    h.dragMove({ x: 0, y: 0 });

    // The dragged atom is now sitting exactly on a1. The pick must answer a1,
    // not a3 — this is the regression.
    expect(h.hitAt(h.canvasPointFor({ x: 0, y: 0 }))).toEqual({ kind: "atom", atomId: a1 });
  });

  it("merges a dragged atom onto the atom it is dropped dead-on", () => {
    const { molecule, a1, a2, a3 } = atoms;
    const h = new Harness(storeWith(molecule, { atomIds: [a3], bondIds: [] }));

    h.drag({ x: 0, y: 2 }, { x: 0, y: 0 });

    // Decision 1: the survivor keeps the TARGET's id and position and the
    // DRAGGED atom's chemical identity.
    expect(h.molecule.atomIds).toEqual([a1, a2]);
    expect(h.molecule.atoms[a1]?.element).toBe("O");
    expect(h.positionOf(a1)).toEqual({ x: 0, y: 0 });
    expect(h.molecule.bondIds).toHaveLength(1);
    expect(h.store.getState().selection.atomIds).toEqual([a1]);
  });

  it("merges from a sloppy grab as well as a dead-on one", () => {
    // The failing sweep in the report succeeded only when the GRAB was
    // sloppier than the DROP, because a sloppy grab left the dragged atom
    // slightly off the pointer. Both offsets small is the case that used to
    // fail and the case a chemist actually produces.
    const { molecule, a1, a3 } = atoms;
    const h = new Harness(storeWith(molecule, { atomIds: [a3], bondIds: [] }));

    h.press({ x: 0.02, y: 2.01 });
    h.dragStart({ x: 0.02, y: 2.01 }, { x: 0.02, y: 1.5 });
    h.dragMove({ x: 0.01, y: 0.5 });
    h.dragMove({ x: 0.01, y: 0.02 });
    h.dragEnd({ x: 0.01, y: 0.02 });

    expect(h.molecule.atomIds).toEqual([a1, atoms.a2]);
    expect(h.molecule.atoms[a1]?.element).toBe("O");
  });

  it("refuses to merge two atoms that are already bonded, and puts the atom back", () => {
    const { molecule, a1, a2 } = atoms;
    const h = new Harness(storeWith(molecule, { atomIds: [a2], bondIds: [] }));
    const before = h.store.getState().document;
    const entriesBefore = h.store.getState().history.past.length;

    h.drag({ x: 1, y: 0 }, { x: 0, y: 0 });

    // Decision 2. The abort restores the transaction's base VERBATIM, so the
    // document is the same object — no zero-length bond, no history entry.
    expect(h.store.getState().document).toBe(before);
    expect(h.positionOf(a2)).toEqual({ x: 1, y: 0 });
    expect(h.store.getState().ui.statusMessage).toBe("These atoms are already bonded");
    expect(h.store.getState().history.past).toHaveLength(entriesBefore);
    // a1 is untouched: still carbon, still bonded to exactly one atom.
    expect(h.molecule.atoms[a1]?.element).toBe("C");
  });

  it("marks the refusal on the overlay while the button is still down", () => {
    const { molecule, a1, a2 } = atoms;
    const h = new Harness(storeWith(molecule, { atomIds: [a2], bondIds: [] }));

    h.press({ x: 1, y: 0 });
    h.dragStart({ x: 1, y: 0 }, { x: 0.8, y: 0 });
    h.dragMove({ x: 0, y: 0 });

    expect(h.state).toMatchObject({
      kind: "movingSelection",
      merge: { atomId: a1, refused: true },
    });
  });

  it("closes a ring onto an OFF-LATTICE atom the pointer is squarely on", () => {
    // The atom sits at 40 degrees, nowhere near the 30-degree lattice a
    // sprout snaps to, so `sproutDrag` alone cannot find it. Only the direct
    // pick under the pointer can — and only if the atom the drag itself just
    // minted is not shadowing it.
    const angle = (40 * Math.PI) / 180;
    const off = { x: Math.cos(angle) * 1.6, y: Math.sin(angle) * 1.6 };
    const molecule = buildMolecule((b) => {
      b.atom("C", { x: 0, y: 0 });
      b.atom("C", off);
    });
    const [a1, a2] = molecule.atomIds as [AtomId, AtomId];
    const h = new Harness(storeWith(molecule));

    h.drag({ x: 0, y: 0 }, off);

    expect(h.molecule.atomIds).toEqual([a1, a2]);
    expect(h.molecule.bondIds).toHaveLength(1);
    const bond = h.molecule.bonds[h.molecule.bondIds[0]!]!;
    expect([bond.from, bond.to].sort()).toEqual([a1, a2].sort());
  });

  it("draws exactly one new atom and one undo entry over sixty frames", () => {
    const { molecule, a3 } = atoms;
    const h = new Harness(storeWith(molecule));
    const atomsBefore = h.molecule.atomIds.length;
    const entriesBefore = h.store.getState().history.past.length;

    h.press({ x: 0, y: 2 });
    h.dragStart({ x: 0, y: 2 }, { x: 0.1, y: 2.1 });
    for (let i = 0; i < 60; i += 1) {
      h.dragMove({ x: 0.5 + i * 0.005, y: 2.5 + i * 0.005 });
    }
    h.dragEnd({ x: 0.8, y: 2.8 });

    expect(h.molecule.atomIds).toHaveLength(atomsBefore + 1);
    expect(h.store.getState().history.past).toHaveLength(entriesBefore + 1);
    // The sprout hangs off the atom the drag started on.
    const bond = h.molecule.bondIds
      .map((id) => h.molecule.bonds[id]!)
      .find((b) => b.from === a3 || b.to === a3);
    expect(bond).toBeDefined();
  });

  it("leaves the document reference-identical when a gesture is cancelled", () => {
    const { molecule } = atoms;
    const h = new Harness(storeWith(molecule));
    const before = h.store.getState().document;

    h.press({ x: 0, y: 2 });
    h.dragStart({ x: 0, y: 2 }, { x: 0.5, y: 2.5 });
    h.dragMove({ x: 1, y: 3 });
    h.state = reduceCancel(h);

    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().history.transaction).toBeNull();
  });

  it("does not leave the probe fixture empty", () => {
    // Guards the harness itself: `openDocument` on an empty molecule would
    // make every assertion above vacuous.
    expect(isEmpty(threeAtoms().molecule)).toBe(false);
  });
});

/** Escape, driven through the same perform loop. */
function reduceCancel(h: Harness): InteractionState {
  const store = h.store.getState();
  const { state, commands } = reduce(
    h.state,
    { kind: "cancel" },
    {
      molecule: store.document.molecule,
      tool: store.tool,
      toolOptions: store.toolOptions,
      selection: store.selection,
    },
  );
  for (const command of commands) {
    const s = h.store.getState();
    if (command.kind === "abortTransaction") s.abortTransaction();
    if (command.kind === "status") s.setStatusMessage(command.message);
    if (command.kind === "setSelection") s.setSelection(command.selection);
  }
  return state;
}
