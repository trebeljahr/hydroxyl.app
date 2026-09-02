/**
 * The editing machine, driven by synthetic pointer facts.
 *
 * NO DOM ANYWHERE IN THIS FILE, and that is the point rather than a
 * convenience. jsdom's `getBoundingClientRect` returns zeros, so a drag driven
 * through a rendered canvas has no geometry in it — every point is the origin,
 * every angle is undefined, and a test that "passes" there proves only that
 * nothing threw. Facts carry model coordinates, so the assertions below are
 * about real angles and real positions.
 *
 * REAL MOLECULES, per the house rule: benzene where a ring closure has to be
 * refused, ethanol where a chain has to grow. A regression then reads as a
 * chemistry error rather than as a graph error.
 */

import { describe, expect, it } from "vitest";

import {
  areBonded,
  benzene,
  buildMolecule,
  requireAtom,
  linearChain,
  singleAtom,
} from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";

import { DEFAULT_TOOL_OPTIONS } from "@/state";
import type { Selection, ToolId } from "@/state";

import type {
  InteractionCommand,
  InteractionContext,
  InteractionState,
  PointerFact,
  PointerHit,
  PointerSample,
} from "./facts";
import { IDLE } from "./facts";
import { documentBondLength, movingAtomIds, reduce } from "./machine";

// ---------------------------------------------------------------------------
// A harness that behaves like the store, without being it
// ---------------------------------------------------------------------------

const EMPTY: Selection = { atomIds: [], bondIds: [] };

/**
 * Ethanol, drawn as a chemist would: a zig-zag C-C-O.
 *
 * Built here rather than taken from a fixture because the merge test needs to
 * know which atom is the oxygen and which carbon is far enough from it to be a
 * legal merge partner, and a named local says that in one place.
 */
function ethanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", { x: 0, y: 0 });
    const c2 = b.atom("C", { x: 0.866, y: 0.5 });
    const o = b.atom("O", { x: 1.732, y: 0 });
    b.bond(c1, c2);
    b.bond(c2, o);
  });
}

/**
 * Applies commands the way the document slice does, including the two
 * behaviours the machine depends on: `applyMoleculeEdit` ignores an edit that
 * returns the molecule by reference, and `record` is a no-op while a
 * transaction is in flight, so a whole drag is one entry.
 */
class Driver {
  state: InteractionState = IDLE;
  molecule: Molecule;
  selection: Selection = EMPTY;
  tool: ToolId = "select";
  status: string | null = null;

  /** Labels of the entries a real history would hold. */
  readonly entries: string[] = [];
  transaction: { label: string; base: Molecule; selection: Selection } | null = null;
  /** Every command, in order, for the "one transaction per gesture" counts. */
  readonly commands: InteractionCommand[] = [];

  constructor(molecule: Molecule) {
    this.molecule = molecule;
  }

  get context(): InteractionContext {
    return {
      molecule: this.molecule,
      tool: this.tool,
      toolOptions: DEFAULT_TOOL_OPTIONS,
      selection: this.selection,
    };
  }

  send(fact: PointerFact): this {
    const { state, commands } = reduce(this.state, fact, this.context);
    this.state = state;
    for (const command of commands) {
      this.commands.push(command);
      this.perform(command);
    }
    return this;
  }

  private perform(command: InteractionCommand): void {
    switch (command.kind) {
      case "beginTransaction":
        this.transaction ??= {
          label: command.label,
          base: this.molecule,
          selection: this.selection,
        };
        return;
      case "edit": {
        const next = command.edit(this.molecule);
        if (next === this.molecule) return;
        const before = this.molecule;
        this.molecule = next;
        if (this.transaction === null) this.entries.push(command.label);
        else void before;
        return;
      }
      case "commitTransaction": {
        const t = this.transaction;
        this.transaction = null;
        if (t === null) return;
        if (t.base === this.molecule) return;
        this.entries.push(t.label);
        return;
      }
      case "abortTransaction": {
        const t = this.transaction;
        this.transaction = null;
        if (t === null) return;
        this.molecule = t.base;
        this.selection = t.selection;
        return;
      }
      case "setSelection":
        this.selection = command.selection;
        return;
      case "setHover":
        return;
      case "status":
        this.status = command.message;
        return;
    }
  }

  count(kind: InteractionCommand["kind"]): number {
    return this.commands.filter((command) => command.kind === kind).length;
  }
}

function atomHit(atomId: AtomId): PointerHit {
  return { kind: "atom", atomId };
}

function sample(
  point: Vec2,
  hit: PointerHit = { kind: "none" },
  modifiers: { shift?: boolean; alt?: boolean } = {},
): PointerSample {
  return {
    point,
    hit,
    modifiers: { shift: modifiers.shift ?? false, alt: modifiers.alt ?? false },
  };
}

function pos(mol: Molecule, id: AtomId): Vec2 {
  return requireAtom(mol, id).pos;
}

/** The bearing of `bondId` measured from `atomId`, in degrees. */
function bearing(mol: Molecule, atomId: AtomId, other: AtomId): number {
  const a = pos(mol, atomId);
  const b = pos(mol, other);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Interpolates a straight drag as `steps` move facts, as a real drag arrives. */
function dragTo(
  driver: Driver,
  from: PointerSample,
  to: Vec2,
  steps: number,
  hitAt: (t: number) => PointerHit = () => ({ kind: "none" }),
): void {
  driver.send({ kind: "press", sample: from });
  const at = (t: number): Vec2 => ({
    x: from.point.x + (to.x - from.point.x) * t,
    y: from.point.y + (to.y - from.point.y) * t,
  });
  // The modifiers ride along with every frame, as a held key does in a
  // browser: they are sampled per event, not latched at pointerdown.
  const frame = (t: number): PointerSample => ({
    point: at(t),
    hit: hitAt(t),
    modifiers: from.modifiers,
  });
  driver.send({ kind: "dragStart", origin: from, sample: frame(1 / steps) });
  for (let i = 2; i <= steps; i += 1) {
    driver.send({ kind: "dragMove", sample: frame(i / steps) });
  }
}

// ---------------------------------------------------------------------------

describe("documentBondLength", () => {
  it("reads the drawing's own scale rather than assuming 1", () => {
    expect(documentBondLength(benzene())).toBeCloseTo(1, 10);
    // A molfile arrives in Angstroms. Everything chem-core defaults to — the
    // sprout length, the merge radius, every ring template — assumes 1, so a
    // bond drawn at 1 into a 1.5-scale drawing comes out visibly short.
    expect(documentBondLength(benzene(1.5))).toBeCloseTo(1.5, 10);
  });

  it("shrugs off a single degenerate bond, where a mean would not", () => {
    // Two atoms left coincident by a botched import. A mean would drag the
    // whole gesture scale towards zero; the median does not notice.
    const chain = linearChain(6, "C", 1);
    const collapsed = {
      ...chain,
      atoms: {
        ...chain.atoms,
        a1: { ...chain.atoms["a1"]!, pos: chain.atoms["a2"]!.pos },
      },
    };
    expect(documentBondLength(collapsed)).toBeCloseTo(1, 6);
  });

  it("falls back to 1 for a molecule with no bonds to measure", () => {
    expect(documentBondLength(singleAtom("C"))).toBe(1);
  });
});

describe("hover", () => {
  it("reports a change once and says nothing while the answer is the same", () => {
    const driver = new Driver(benzene());
    driver.send({ kind: "hover", sample: sample({ x: 0, y: -1 }, atomHit("a1")) });
    expect(driver.commands).toEqual([
      { kind: "setHover", atomId: "a1", bondId: null },
    ]);

    driver.send({ kind: "hover", sample: sample({ x: 0, y: -1 }, atomHit("a1")) });
    expect(driver.count("setHover")).toBe(1);

    driver.send({ kind: "hover", sample: sample({ x: 5, y: 5 }) });
    expect(driver.commands.at(-1)).toEqual({
      kind: "setHover",
      atomId: null,
      bondId: null,
    });
  });

  it("is suppressed outright while a gesture is in flight", () => {
    const driver = new Driver(benzene());
    dragTo(driver, sample(pos(benzene(), "a1"), atomHit("a1")), { x: 0, y: -3 }, 4);
    const before = driver.count("setHover");
    driver.send({ kind: "hover", sample: sample({ x: 0, y: -1 }, atomHit("a1")) });
    expect(driver.count("setHover")).toBe(before);
  });
});

describe("drawing a bond", () => {
  it("draws at a snapped angle and records ONE undo entry, not sixty", () => {
    const mol = benzene();
    const driver = new Driver(mol);

    // Sixty frames, straight down and away from the ring. a1 sits at the
    // bottom of the hexagon, so due south is the direction with nothing in it.
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.4, y: -3 }, 60);
    driver.send({ kind: "dragEnd", sample: sample({ x: 0.4, y: -3 }) });

    // ONE atom and ONE bond, not sixty of each. Every frame rebuilds from the
    // base rather than composing forward, which is what makes that true.
    expect(driver.molecule.atomIds).toHaveLength(7);
    expect(driver.molecule.bondIds).toHaveLength(7);
    expect(driver.entries).toEqual(["Draw bond"]);
    expect(driver.count("beginTransaction")).toBe(1);
    expect(driver.count("commitTransaction")).toBe(1);

    // The minted id is the SAME on every frame, because `addAtom` reads
    // `base.nextId` and the base never advances. A gesture that composed
    // forward would have burned sixty ids on a wobbling drag.
    const grown = driver.molecule.atomIds.at(-1)!;
    expect(grown).toBe("a13");

    // Snapped RELATIVE TO a1's own first bond, not to world angles. a1-a2
    // bears -30 degrees, so every legal endpoint is -30 + 30k.
    const drawn = bearing(driver.molecule, "a1", grown);
    const relative = drawn - bearing(driver.molecule, "a1", "a2");
    expect(Math.abs(relative / 30 - Math.round(relative / 30))).toBeLessThan(1e-9);

    // One bond long, whatever the pointer's distance: a drag chooses a
    // direction, not a length.
    expect(distance(pos(driver.molecule, "a1"), pos(driver.molecule, grown))).toBeCloseTo(
      1,
      10,
    );
  });

  it("closes a ring instead of leaving a duplicate atom on top of one", () => {
    const mol = benzene();
    const driver = new Driver(mol);

    // a1 to a4, across the ring: not bonded, so this is a legal closure.
    dragTo(
      driver,
      sample(pos(mol, "a1"), atomHit("a1")),
      pos(mol, "a4"),
      8,
      (t) => (t > 0.8 ? atomHit("a4") : { kind: "none" }),
    );
    driver.send({ kind: "dragEnd", sample: sample(pos(mol, "a4"), atomHit("a4")) });

    // No atom minted, one bond added — and crucially no seventh carbon sitting
    // exactly on top of a4, which is invisible on screen and wrong in the
    // formula.
    expect(driver.molecule.atomIds).toHaveLength(6);
    expect(driver.molecule.bondIds).toHaveLength(7);
    expect(areBonded(driver.molecule, "a1", "a4")).toBe(true);
    expect(driver.entries).toEqual(["Draw bond"]);
  });

  it("reaches an atom that is off the snap lattice, via the pointer's own hit", () => {
    // `sproutDrag` looks for a merge partner near the SNAPPED endpoint, so an
    // atom that is not on the 30-degree lattice is unreachable by that route —
    // and the user, who dragged the cursor squarely onto it, gets a duplicate
    // atom a fraction of a bond away instead.
    const mol = benzene();
    const offLattice = {
      ...mol,
      atoms: {
        ...mol.atoms,
        a4: { ...mol.atoms["a4"]!, pos: { x: 0.13, y: 2.37 } },
      },
    };
    const driver = new Driver(offLattice);
    dragTo(
      driver,
      sample(pos(offLattice, "a1"), atomHit("a1")),
      { x: 0.13, y: 2.37 },
      6,
      (t) => (t > 0.5 ? atomHit("a4") : { kind: "none" }),
    );
    driver.send({
      kind: "dragEnd",
      sample: sample({ x: 0.13, y: 2.37 }, atomHit("a4")),
    });

    expect(driver.molecule.atomIds).toHaveLength(6);
    expect(areBonded(driver.molecule, "a1", "a4")).toBe(true);
  });

  it("REFUSES a closure onto an atom that is already bonded, and says so", () => {
    const mol = benzene();
    const driver = new Driver(mol);

    dragTo(
      driver,
      sample(pos(mol, "a1"), atomHit("a1")),
      pos(mol, "a2"),
      6,
      () => atomHit("a2"),
    );
    expect(driver.status).toBe("These atoms are already bonded");
    expect(driver.molecule).toBe(mol);

    driver.send({ kind: "dragEnd", sample: sample(pos(mol, "a2"), atomHit("a2")) });
    // Nothing drawn, nothing to undo. `sproutTo` would have THROWN on this
    // target, and a throw out of a pointer handler takes the canvas down.
    expect(driver.molecule).toBe(mol);
    expect(driver.entries).toEqual([]);
    // And the message outlives the gesture: a refusal that vanished with the
    // button would leave the user with an absent bond and no explanation.
    expect(driver.status).toBe("These atoms are already bonded");
  });

  it("takes the refused bond back when the pointer wanders onto a bonded neighbour", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.4, y: -3 }, 4);
    expect(driver.molecule.atomIds).toHaveLength(7);

    // Now back onto a2, which a1 is already bonded to. The molecule has to
    // return to the base, or the status bar's formula would show a carbon the
    // refusal message says was not drawn.
    driver.send({ kind: "dragMove", sample: sample(pos(mol, "a2"), atomHit("a2")) });
    expect(driver.molecule).toBe(mol);
  });

  it("emits nothing for a frame that changes no target", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.4, y: -3 }, 4);
    const before = driver.commands.length;
    // Sub-snap wobble: a different pointer position, the same snapped target.
    driver.send({ kind: "dragMove", sample: sample({ x: 0.41, y: -2.99 }) });
    expect(driver.commands.length).toBe(before);
  });

  it("leaves the molecule byte-identical when Escape cancels mid-drag", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.4, y: -3 }, 30);
    expect(driver.molecule).not.toBe(mol);

    driver.send({ kind: "cancel" });

    // Reference identity, which is strictly stronger than "byte-identical":
    // `abortTransaction` restores the base snapshot verbatim.
    expect(driver.molecule).toBe(mol);
    expect(driver.entries).toEqual([]);
    expect(driver.count("commitTransaction")).toBe(0);
    expect(driver.count("abortTransaction")).toBe(1);
    expect(driver.state).toEqual(IDLE);
  });
});

describe("clicking to sprout", () => {
  it("grows a bond in the default direction with the bond tool", () => {
    const mol = ethanol();
    const driver = new Driver(mol);
    driver.tool = "bond";
    const terminal = mol.atomIds[0]!;
    driver.send({ kind: "click", sample: sample(pos(mol, terminal), atomHit(terminal)) });

    expect(driver.molecule.atomIds).toHaveLength(mol.atomIds.length + 1);
    expect(driver.entries).toEqual(["Draw bond"]);
  });

  it("selects rather than draws with the select tool", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });
    expect(driver.molecule).toBe(mol);
    expect(driver.selection.atomIds).toEqual(["a1"]);
  });
});

describe("selection by click", () => {
  it("replaces on a plain click and toggles on shift", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });
    driver.send({
      kind: "click",
      sample: sample(pos(mol, "a3"), atomHit("a3"), { shift: true }),
    });
    expect(driver.selection.atomIds).toEqual(["a1", "a3"]);

    driver.send({
      kind: "click",
      sample: sample(pos(mol, "a1"), atomHit("a1"), { shift: true }),
    });
    expect(driver.selection.atomIds).toEqual(["a3"]);
  });

  it("clears on an unmodified miss and keeps the selection on a shift miss", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });

    driver.send({ kind: "click", sample: sample({ x: 9, y: 9 }, undefined, { shift: true }) });
    expect(driver.selection.atomIds).toEqual(["a1"]);

    driver.send({ kind: "click", sample: sample({ x: 9, y: 9 }) });
    expect(driver.selection.atomIds).toEqual([]);
  });
});

describe("marquee", () => {
  it("selects the atoms it encloses AND the bonds between them", () => {
    const mol = benzene();
    const driver = new Driver(mol);

    // A box over the ring's right-hand edge: a2 and a3, and the bond between.
    dragTo(driver, sample({ x: 0.5, y: -0.9 }), { x: 1.4, y: 0.9 }, 5);
    driver.send({ kind: "dragEnd", sample: sample({ x: 1.4, y: 0.9 }) });

    expect(driver.selection.atomIds).toEqual(["a2", "a3"]);
    // `expandToBonds` explicitly. `normalizeSelection` is purely subtractive
    // and would never derive this back, so a marquee that skipped it would
    // look right and then delete a structure with no bonds in it.
    expect(driver.selection.bondIds).toEqual(["b8"]);
    // A selection change is not an edit.
    expect(driver.entries).toEqual([]);
    expect(driver.count("beginTransaction")).toBe(0);
  });

  it("normalises its corners, so sweeping up-left works as well as down-right", () => {
    const mol = benzene();
    const down = new Driver(mol);
    dragTo(down, sample({ x: 0.5, y: -0.9 }), { x: 1.4, y: 0.9 }, 3);
    const up = new Driver(mol);
    dragTo(up, sample({ x: 1.4, y: 0.9 }), { x: 0.5, y: -0.9 }, 3);
    expect(up.selection).toEqual(down.selection);
  });

  it("extends rather than replaces while shift is held", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a5"), atomHit("a5")) });

    dragTo(
      driver,
      sample({ x: 0.5, y: -0.9 }, undefined, { shift: true }),
      { x: 1.4, y: 0.9 },
      4,
    );
    driver.send({
      kind: "dragEnd",
      sample: sample({ x: 1.4, y: 0.9 }, undefined, { shift: true }),
    });
    expect(driver.selection.atomIds).toEqual(["a5", "a2", "a3"]);
  });

  it("puts the previous selection back when cancelled", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a5"), atomHit("a5")) });
    dragTo(driver, sample({ x: 0.5, y: -0.9 }), { x: 1.4, y: 0.9 }, 4);
    expect(driver.selection.atomIds).toEqual(["a2", "a3"]);

    driver.send({ kind: "cancel" });
    expect(driver.selection.atomIds).toEqual(["a5"]);
  });
});

describe("moving a selection", () => {
  it("moves a selected atom instead of drawing from it", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });

    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.5, y: -2 }, 20);
    driver.send({ kind: "dragEnd", sample: sample({ x: 0.5, y: -2 }) });

    // No atom minted: a selected atom moves, an unselected one sprouts.
    expect(driver.molecule.atomIds).toHaveLength(6);
    expect(pos(driver.molecule, "a1")).toEqual({ x: 0.5, y: -2 });
    expect(driver.entries).toEqual(["Move selection"]);
  });

  it("does not accumulate the displacement over the frames of a drag", () => {
    // The trap a per-move commit sets: a RELATIVE translate applied every frame
    // re-applies the whole drag each time, because the molecule already carries
    // the previous frame's move. Twenty frames would land twenty times too far.
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0, y: -2 }, 20);
    driver.send({ kind: "dragEnd", sample: sample({ x: 0, y: -2 }) });
    expect(pos(driver.molecule, "a1").y).toBeCloseTo(-2, 12);
  });

  it("takes the endpoints of a selected bond with it", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({
      kind: "click",
      sample: sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: "b8" }),
    });
    expect(driver.selection.bondIds).toEqual(["b8"]);

    const before2 = pos(mol, "a2");
    dragTo(
      driver,
      sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: "b8" }),
      { x: 1.87, y: 0 },
      5,
    );
    driver.send({ kind: "dragEnd", sample: sample({ x: 1.87, y: 0 }) });

    expect(pos(driver.molecule, "a2").x).toBeCloseTo(before2.x + 1, 10);
    expect(pos(driver.molecule, "a3").x).toBeCloseTo(pos(mol, "a3").x + 1, 10);
  });

  it("selects an unselected bond before moving it", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(
      driver,
      sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: "b8" }),
      { x: 1.87, y: 0 },
      4,
    );
    expect(driver.selection.bondIds).toEqual(["b8"]);
  });

  it("merges on a drop, with the DRAGGED atom's identity and the TARGET's id", () => {
    // Decision 1. Two separate ethanols; drag one's oxygen onto the other's
    // terminal carbon. The survivor keeps the target's id and position and the
    // dragged atom's element, so nothing jumps under the cursor and the user
    // gets the O they aimed with.
    const mol = ethanol();
    const oxygen = mol.atomIds.find((id) => requireAtom(mol, id).element === "O")!;
    const carbon = mol.atomIds.find(
      (id) => requireAtom(mol, id).element === "C" && !areBonded(mol, id, oxygen),
    )!;
    const targetPos = pos(mol, carbon);

    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, oxygen), atomHit(oxygen)) });
    dragTo(driver, sample(pos(mol, oxygen), atomHit(oxygen)), targetPos, 5, (t) =>
      t > 0.6 ? atomHit(carbon) : { kind: "none" },
    );
    driver.send({ kind: "dragEnd", sample: sample(targetPos, atomHit(carbon)) });

    expect(driver.molecule.atomIds).toHaveLength(mol.atomIds.length - 1);
    expect(driver.molecule.atoms[oxygen]).toBeUndefined();
    expect(requireAtom(driver.molecule, carbon).element).toBe("O");
    expect(requireAtom(driver.molecule, carbon).pos).toEqual(targetPos);
    // The survivor replaces the retired id in the selection, or the user is
    // left holding nothing after a gesture that visibly kept an atom.
    expect(driver.selection.atomIds).toEqual([carbon]);
  });

  it("REFUSES a merge of two atoms that are already bonded, and snaps back", () => {
    // Decision 2: never silently collapse a real bond into a self-bond.
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });

    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), pos(mol, "a2"), 5, () =>
      atomHit("a2"),
    );
    driver.send({ kind: "dragEnd", sample: sample(pos(mol, "a2"), atomHit("a2")) });

    expect(driver.molecule).toBe(mol);
    expect(driver.entries).toEqual([]);
    expect(driver.status).toBe("These atoms are already bonded");
  });

  it("never offers a merge for a multi-atom drag", () => {
    // Which of the five moving atoms would be the one merged? There is no
    // defensible answer, so the gesture is a plain move.
    const mol = benzene();
    const driver = new Driver(mol);
    driver.selection = { atomIds: ["a1", "a2"], bondIds: [] };
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), pos(mol, "a4"), 4, () =>
      atomHit("a4"),
    );
    driver.send({ kind: "dragEnd", sample: sample(pos(mol, "a4"), atomHit("a4")) });
    expect(driver.molecule.atomIds).toHaveLength(6);
  });
});

describe("rotating a selection", () => {
  it("turns the selection about its centroid, from the grab handle", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.selection = { atomIds: ["a1", "a2", "a3", "a4", "a5", "a6"], bondIds: [] };

    // The centroid of benzene is the origin. Grab at due east and drag to due
    // north: a quarter turn.
    const from = sample({ x: 2, y: 0 }, { kind: "handle" });
    dragTo(driver, from, { x: 0, y: 2 }, 12);
    driver.send({ kind: "dragEnd", sample: sample({ x: 0, y: 2 }) });

    // a1 was at (0, -1); a quarter turn anticlockwise puts it at (1, 0).
    expect(pos(driver.molecule, "a1").x).toBeCloseTo(1, 8);
    expect(pos(driver.molecule, "a1").y).toBeCloseTo(0, 8);
    expect(driver.entries).toEqual(["Rotate selection"]);
    expect(driver.count("beginTransaction")).toBe(1);
  });

  it("does not accumulate over frames, and cancels back to the base", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.selection = { atomIds: mol.atomIds, bondIds: [] };
    dragTo(driver, sample({ x: 2, y: 0 }, { kind: "handle" }), { x: 0, y: 2 }, 30);
    driver.send({ kind: "cancel" });
    expect(driver.molecule).toBe(mol);
  });

  it("falls through to the other gestures when nothing is selected", () => {
    // A handle hit with an empty selection is stale feedback, not a rotation.
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(driver, sample({ x: 3, y: 3 }, { kind: "handle" }), { x: 4, y: 4 }, 3);
    expect(driver.state.kind).toBe("marquee");
  });
});

describe("ring templates", () => {
  it("fuses over a bond", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.tool = "ring";
    driver.send({
      kind: "click",
      sample: sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: "b8" }),
    });
    // Two vertices are shared with the existing ring, so a six-ring adds four.
    expect(driver.molecule.atomIds).toHaveLength(10);
    expect(driver.entries).toEqual(["Add ring"]);
  });

  it("refuses to fuse onto a bond that already has a ring on each side", () => {
    // `fuseRingOnBond` THROWS there, and a throw out of a pointer handler
    // aborts the transaction and propagates — so it is pre-checked instead.
    const mol = benzene();
    const driver = new Driver(mol);
    driver.tool = "ring";
    driver.send({
      kind: "click",
      sample: sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: "b8" }),
    });
    const fused = driver.molecule;
    const shared = fused.bondIds.find((id) => {
      const bond = fused.bonds[id]!;
      return bond.from === "a2" && bond.to === "a3";
    })!;

    expect(() =>
      driver.send({
        kind: "click",
        sample: sample({ x: 0.87, y: 0 }, { kind: "bond", bondId: shared }),
      }),
    ).not.toThrow();
    expect(driver.molecule).toBe(fused);
    expect(driver.status).toBe("That bond already has a ring on each side");
  });

  it("refuses to fuse across a zero-length bond", () => {
    // The other geometry `fuseRingOnBond` throws on, and one `isFusionBond`
    // says nothing about. A drawing reaches it through an import with
    // duplicate coordinates or a fragment drag that parked an atom on its
    // neighbour, so it is pre-checked for the same reason as the fusion case:
    // a named refusal beats a rolled-back gesture with a stack trace behind it.
    const mol = buildMolecule((b) => {
      const a = b.atom("C", { x: 0, y: 0 });
      const c = b.atom("C", { x: 0, y: 0 });
      b.bond(a, c);
    });
    const driver = new Driver(mol);
    driver.tool = "ring";

    expect(() =>
      driver.send({
        kind: "click",
        sample: sample({ x: 0, y: 0 }, { kind: "bond", bondId: mol.bondIds[0]! }),
      }),
    ).not.toThrow();
    expect(driver.molecule).toBe(mol);
    expect(driver.status).toBe(
      "That bond has zero length; move its atoms apart first",
    );
    expect(driver.entries).toEqual([]);
  });

  it("attaches over an atom, and makes a spiro ring with alt", () => {
    const mol = benzene();
    const attach = new Driver(mol);
    attach.tool = "ring";
    attach.send({ kind: "click", sample: sample(pos(mol, "a1"), atomHit("a1")) });
    // The clicked atom is NOT in the new ring, so six are minted plus the link.
    expect(attach.molecule.atomIds).toHaveLength(12);

    const spiro = new Driver(mol);
    spiro.tool = "ring";
    spiro.send({
      kind: "click",
      sample: sample(pos(mol, "a1"), atomHit("a1"), { alt: true }),
    });
    // The clicked atom IS ring vertex 0, so only five are minted.
    expect(spiro.molecule.atomIds).toHaveLength(11);
  });

  it("places a free ring on empty canvas", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.tool = "ring";
    driver.send({ kind: "click", sample: sample({ x: 6, y: 6 }) });
    expect(driver.molecule.atomIds).toHaveLength(12);
    expect(driver.molecule.bondIds).toHaveLength(12);
  });
});

describe("panning", () => {
  it("is a state of its own and swallows the gestures that would fight it", () => {
    const driver = new Driver(benzene());
    driver.send({ kind: "panStart" });
    expect(driver.state.kind).toBe("panning");

    driver.send({ kind: "hover", sample: sample({ x: 0, y: -1 }, atomHit("a1")) });
    driver.send({ kind: "click", sample: sample({ x: 0, y: -1 }, atomHit("a1")) });
    expect(driver.selection).toBe(EMPTY);

    driver.send({ kind: "panEnd" });
    expect(driver.state).toEqual(IDLE);
  });
});

describe("movingAtomIds", () => {
  it("drops ids the molecule no longer has, because setAtomPositions throws on them", () => {
    const mol = benzene();
    expect(movingAtomIds(mol, { atomIds: ["a1", "a99"], bondIds: [] })).toEqual(["a1"]);
    // And it does not fall through Object.prototype on a hostile id.
    expect(
      movingAtomIds(mol, { atomIds: ["constructor" as AtomId], bondIds: [] }),
    ).toEqual([]);
  });

  it("adds the endpoints of a selected bond exactly once", () => {
    const mol = benzene();
    expect(movingAtomIds(mol, { atomIds: ["a2"], bondIds: ["b8"] })).toEqual([
      "a2",
      "a3",
    ]);
  });
});

describe("guarding against a leaked transaction", () => {
  it("aborts a gesture a previous one left open, rather than nesting", () => {
    // A transaction opened and never closed is the one failure this design
    // cannot survive quietly: undo goes dead, every later edit records against
    // a stale base, and the next Escape rolls back to whenever the leak was.
    // The gesture hook guarantees one gesture at a time; this is the net.
    const mol = benzene();
    const driver = new Driver(mol);
    dragTo(driver, sample(pos(mol, "a1"), atomHit("a1")), { x: 0.4, y: -3 }, 4);
    expect(driver.transaction).not.toBeNull();

    // A second dragStart with no end in between.
    driver.send({
      kind: "dragStart",
      origin: sample(pos(mol, "a4"), atomHit("a4")),
      sample: sample({ x: 0.4, y: 3 }),
    });
    driver.send({ kind: "dragEnd", sample: sample({ x: 0.4, y: 3 }) });

    // One bond, from the SECOND gesture: the first was rolled back rather than
    // left half-applied inside someone else's transaction.
    expect(driver.molecule.atomIds).toHaveLength(7);
    expect(driver.entries).toEqual(["Draw bond"]);
    expect(driver.transaction).toBeNull();
  });

  it("never lets a pan become an edit", () => {
    const mol = benzene();
    const driver = new Driver(mol);
    driver.send({ kind: "panStart" });
    driver.send({
      kind: "dragStart",
      origin: sample(pos(mol, "a1"), atomHit("a1")),
      sample: sample({ x: 0.4, y: -3 }),
    });
    expect(driver.state.kind).toBe("panning");
    expect(driver.molecule).toBe(mol);
    expect(driver.count("beginTransaction")).toBe(0);
  });
});
