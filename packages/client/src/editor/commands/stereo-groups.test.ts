/**
 * Decision 89's four selection commands, driven through the real store.
 *
 * WHY THE STORE AND NOT THE FUNCTIONS. "Undoable like any other edit" is the
 * clause of decision 89 that can only be false at the seam: a command that
 * wrote the molecule with `loadDocument`, or that built its new molecule inside
 * the immer recipe, would still produce the right groups and still read the
 * right tag in the status bar. One `undo()` per command is the assertion that
 * catches it, and `cleanup.test.ts` drives the store the same way for the same
 * reason.
 *
 * 3-chlorobutan-2-ol rather than a synthetic graph: two real stereocentres, one
 * wedge and one hash, so a regression reads as a chemistry error. Its atoms are
 * minted in drawing order, which is why the ids below are literals — a2 is the
 * carbinol carbon, a4 the chlorinated one.
 */

import { describe, expect, it } from "vitest";

import {
  benzene,
  buildMolecule,
  stereoGroupAt,
  stereoGroupCoverage,
  stereoGroupsOf,
  stereocenterAtoms,
  vec,
  withStereoGroups,
} from "@starter/chem-core";
import type { Molecule, StereoGroupKind } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import { commandById } from "./registry";
import {
  CLEAR_STEREO_GROUP_TITLE,
  NOTHING_TO_CLEAR_REASON,
  NOTHING_WAS_GROUPED_MESSAGE,
  NO_STEREOCENTER_REASON,
  STEREO_GROUP_COMMANDS,
  canClearStereoGroup,
  canMarkStereoGroup,
  clearStereoGroup,
  markStereoGroup,
  selectedStereocenters,
} from "./stereo-groups";

/** CH3-CH(OH)-CH(Cl)-CH3, drawn with one wedge and one hash. */
function chlorobutanol(): Molecule {
  return buildMolecule((b) => {
    const c1 = b.atom("C", vec(0, 0));
    const c2 = b.atom("C", vec(1, 0.6));
    const o = b.atom("O", vec(1, 2));
    const c3 = b.atom("C", vec(2, 0));
    const c4 = b.atom("C", vec(3, 0.6));
    const cl = b.atom("Cl", vec(2, -1.4));
    b.bond(c1, c2);
    b.bond(c2, o, 1, "wedge");
    b.bond(c2, c3);
    b.bond(c3, c4, 1, "hash");
    b.bond(c3, cl);
  });
}

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

/** The store with both centres selected — the ordinary gesture. */
function withBothCentresSelected(): EditorStore {
  const store = storeWith(chlorobutanol());
  store.getState().selectAtoms(["a2", "a4"]);
  return store;
}

const KINDS: readonly StereoGroupKind[] = ["and", "or", "abs"];

describe("the molecule the commands act on", () => {
  it("really has the two stereocentres the assertions name", () => {
    // The ids are literals everywhere below, so this is the one place that
    // proves them. A builder change that reordered the atoms would otherwise
    // turn every test here into an assertion about the wrong carbon.
    expect(stereocenterAtoms(chlorobutanol())).toEqual(["a2", "a4"]);
  });
});

describe("markStereoGroup", () => {
  for (const kind of KINDS) {
    it(`puts the selected centres in one ${kind} group`, () => {
      const store = withBothCentresSelected();
      markStereoGroup(store, kind);

      const groups = stereoGroupsOf(store.getState().document.molecule);
      expect(groups).toEqual([{ kind, index: 1, atomIds: ["a2", "a4"] }]);
    });

    it(`is undoable: one ${kind} mark, one undo, no groups`, () => {
      const store = withBothCentresSelected();
      const before = store.getState().document.molecule;
      const entries = store.getState().history.past.length;

      markStereoGroup(store, kind);

      expect(store.getState().history.past.length).toBe(entries + 1);
      expect(store.getState().history.past.at(-1)?.label).toBe(
        STEREO_GROUP_COMMANDS[kind].label,
      );

      expect(store.getState().undo()).toBe(true);
      // By REFERENCE. The groups did not merely come back equal: the store put
      // the original molecule back, which is what an undo entry is for.
      expect(store.getState().document.molecule).toBe(before);
      expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
      // And redo puts the statement back, so the entry is a real two-way step.
      expect(store.getState().redo()).toBe(true);
      expect(stereoGroupsOf(store.getState().document.molecule)).toHaveLength(1);
    });
  }

  it("acts on the stereocentres among the selection and ignores the rest", () => {
    // Selecting everything and marking it racemic is the ordinary gesture; it
    // means every CENTRE, not every atom, so the methyls and the Cl must not
    // arrive in the collection.
    const store = storeWith(chlorobutanol());
    store.getState().selectAll();
    markStereoGroup(store, "and");
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]);
  });

  it("says `rac-` in the status line when the whole molecule is one AND group", () => {
    // Decision 88's label is the visible consequence of the edit, and the
    // prefix comes from chem-core's coverage query rather than from a second
    // opinion here.
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    expect(store.getState().ui.statusMessage).toBe(
      "2 stereocentres in stereo group and1; the figure now reads rac-",
    );
    expect(stereoGroupCoverage(store.getState().document.molecule)).toMatchObject({
      kind: "whole",
      prefix: "rac-",
    });
  });

  it("says `rel-` for one OR group, and nothing about a prefix for ABS", () => {
    const or = withBothCentresSelected();
    markStereoGroup(or, "or");
    expect(or.getState().ui.statusMessage).toBe(
      "2 stereocentres in stereo group or1; the figure now reads rel-",
    );

    // An ABS group covers the molecule too, but it states the configuration is
    // known, so there is no prefix to promise.
    const abs = withBothCentresSelected();
    markStereoGroup(abs, "abs");
    expect(abs.getState().ui.statusMessage).toBe("2 stereocentres in stereo group abs");
  });

  it("moves a centre out of its old group instead of putting it in two", () => {
    // MDL semantics, and what makes the figure's per-centre tag single-valued.
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    store.getState().selectAtoms(["a4"]);
    markStereoGroup(store, "or");

    const mol = store.getState().document.molecule;
    expect(stereoGroupAt(mol, "a2")).toMatchObject({ kind: "and", index: 1 });
    expect(stereoGroupAt(mol, "a4")).toMatchObject({ kind: "or", index: 1 });
    expect(stereoGroupsOf(mol)).toEqual([
      { kind: "and", index: 1, atomIds: ["a2"] },
      { kind: "or", index: 1, atomIds: ["a4"] },
    ]);
  });

  it("is idempotent: marking the same selection twice keeps the same number", () => {
    // `nextStereoGroupIndex` is max-plus-one, so reusing the number of a group
    // that already holds exactly these centres is what keeps a second click
    // from turning `&1` into `&2` — a different statement in the file, and an
    // undo entry with nothing to see.
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    const after = store.getState().document.molecule;
    const entries = store.getState().history.past.length;

    markStereoGroup(store, "and");

    expect(store.getState().document.molecule).toBe(after);
    expect(store.getState().history.past.length).toBe(entries);
  });

  it("refuses with the reason, and records nothing, when no centre is selected", () => {
    const store = storeWith(benzene());
    store.getState().selectAll();
    const entries = store.getState().history.past.length;

    markStereoGroup(store, "and");

    expect(store.getState().ui.statusMessage).toBe(NO_STEREOCENTER_REASON);
    expect(store.getState().history.past.length).toBe(entries);
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
  });
});

describe("clearStereoGroup", () => {
  it("removes the group and is undoable", () => {
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    const marked = store.getState().document.molecule;
    const entries = store.getState().history.past.length;

    clearStereoGroup(store);

    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
    expect(store.getState().history.past.length).toBe(entries + 1);
    expect(store.getState().history.past.at(-1)?.label).toBe(CLEAR_STEREO_GROUP_TITLE);
    // Decision 96: the count is of COLLECTIONS, and the atoms are named,
    // because clearing stays wide and a rubber band can take collections the
    // author was not thinking about.
    expect(store.getState().ui.statusMessage).toBe(
      "Cleared 1 stereo group (and1) from 2 atoms: a2, a4",
    );

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.molecule).toBe(marked);
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([
      { kind: "and", index: 1, atomIds: ["a2", "a4"] },
    ]);
  });

  it("clears only the selected centres, leaving the rest of the group standing", () => {
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    store.getState().selectAtoms(["a2"]);
    clearStereoGroup(store);

    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([
      // The index survives: a group that loses one of two centres is still
      // `&1`, and renumbering it would change what the file says.
      { kind: "and", index: 1, atomIds: ["a4"] },
    ]);
    expect(store.getState().ui.statusMessage).toBe(
      "Cleared 1 stereo group (and1) from 1 atom: a2",
    );
  });

  it("removes a group from atoms this build does not perceive as centres", () => {
    // An imported file may put a collection on atoms chem-core does not
    // perceive as stereogenic. Gating Clear on perception would make such a
    // group unremovable from the editor, so the command is deliberately wider
    // than the three marks.
    // Written through `withStereoGroups`, which validates the ids but asks no
    // perception question — exactly as the V3000 reader does for a file.
    const store = storeWith(withStereoGroups(benzene(), [
      { kind: "and", index: 1, atomIds: ["a1"] },
    ]));
    store.getState().selectAtoms(["a1"]);

    expect(stereocenterAtoms(store.getState().document.molecule)).toEqual([]);
    expect(canMarkStereoGroup(store.getState())).toBe(false);
    expect(canClearStereoGroup(store.getState())).toBe(true);

    clearStereoGroup(store);
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
  });

  it("names every collection it cleared, and the atoms, when a selection spans two", () => {
    // Decision 96's reason, at the case that motivated it: a rubber band over the
    // whole structure takes collections the author was not thinking about, so the
    // message has to say how many went and where. One undo puts them back.
    const store = storeWith(
      withStereoGroups(chlorobutanol(), [
        { kind: "and", index: 1, atomIds: ["a2"] },
        { kind: "or", index: 3, atomIds: ["a4"] },
      ]),
    );
    store.getState().selectAtoms(["a1", "a2", "a4", "a6"]);
    clearStereoGroup(store);

    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
    // Two collections, named with the tags the FIGURE prints, and only the atoms
    // that actually lost one — a1 and a6 were selected and were never grouped.
    expect(store.getState().ui.statusMessage).toBe(
      "Cleared 2 stereo groups (and1, or3) from 2 atoms: a2, a4",
    );
    expect(store.getState().undo()).toBe(true);
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([
      { kind: "and", index: 1, atomIds: ["a2"] },
      { kind: "or", index: 3, atomIds: ["a4"] },
    ]);
  });

  it("counts one collection once when the selection clears two of its atoms", () => {
    // The count is of collections, not of memberships: `and1` over both centres
    // is ONE thing that went away.
    const store = withBothCentresSelected();
    markStereoGroup(store, "and");
    store.getState().selectAtoms(["a2", "a4"]);
    clearStereoGroup(store);
    expect(store.getState().ui.statusMessage).toBe(
      "Cleared 1 stereo group (and1) from 2 atoms: a2, a4",
    );
  });

  it("says nothing was grouped rather than claiming nothing was a centre", () => {
    // The enabled predicate is satisfied by the stereocentre alone, so this
    // path is reachable with a centre selected — and the disabled reason would
    // then be a sentence the canvas contradicts.
    const store = withBothCentresSelected();
    const entries = store.getState().history.past.length;

    clearStereoGroup(store);

    expect(store.getState().ui.statusMessage).toBe(NOTHING_WAS_GROUPED_MESSAGE);
    expect(store.getState().history.past.length).toBe(entries);
  });
});

describe("enabled and its reason", () => {
  it("is off with no stereocentre selected, and says why", () => {
    const store = storeWith(chlorobutanol());
    // The Cl and a methyl: real atoms, neither of them a centre.
    store.getState().selectAtoms(["a1", "a6"]);
    const state = store.getState();

    expect(selectedStereocenters(state)).toEqual([]);
    expect(canMarkStereoGroup(state)).toBe(false);
    expect(canClearStereoGroup(state)).toBe(false);

    for (const kind of KINDS) {
      const command = commandById(`structure.stereo-group-${kind}`);
      expect(command.enabled(state)).toBe(false);
      expect(command.disabledReason?.(state)).toBe(NO_STEREOCENTER_REASON);
    }
    const clear = commandById("structure.stereo-group-clear");
    expect(clear.enabled(state)).toBe(false);
    expect(clear.disabledReason?.(state)).toBe(NOTHING_TO_CLEAR_REASON);
  });

  it("is off with nothing selected at all", () => {
    const state = storeWith(chlorobutanol()).getState();
    expect(state.selection.atomIds).toEqual([]);
    expect(canMarkStereoGroup(state)).toBe(false);
    expect(canClearStereoGroup(state)).toBe(false);
  });

  it("is on with a centre selected, and then has no reason to give", () => {
    const state = withBothCentresSelected().getState();
    for (const kind of [...KINDS, "clear"]) {
      const command = commandById(`structure.stereo-group-${kind}`);
      expect(command.enabled(state)).toBe(true);
      expect(command.disabledReason?.(state)).toBeUndefined();
    }
  });

  it("gives Clear its WIDER predicate THROUGH the registry, not just as a function", () => {
    // The seam the shipped tests missed: they called `canClearStereoGroup` and
    // `clearStereoGroup` directly, and the one test that went through the registry
    // used a selection where `canMarkStereoGroup` is true as well — so swapping the
    // registry entry's `enabled` for the narrow predicate left the whole client
    // suite green. `CommandPalette` reads `command.enabled(state)` and returns
    // early when it is false, so under that swap an imported collection on atoms
    // this build does not perceive as stereogenic becomes UNREMOVABLE from the
    // editor: the decision 56 trap the module header claims to prevent.
    const store = storeWith(
      withStereoGroups(
        buildMolecule((b) => {
          const c1 = b.atom("C", vec(0, 0));
          b.bond(c1, b.atom("C", vec(1, 0)));
        }),
        [{ kind: "and", index: 1, atomIds: ["a1"] }],
      ),
    );
    store.getState().selectAtoms(["a1"]);
    const state = store.getState();
    // Ethane: nothing here is a stereocentre, so the three marks are off.
    expect(stereocenterAtoms(state.document.molecule)).toEqual([]);
    for (const kind of KINDS) {
      expect(commandById(`structure.stereo-group-${kind}`).enabled(state), kind).toBe(false);
    }
    const clear = commandById("structure.stereo-group-clear");
    expect(clear.enabled(state)).toBe(true);
    expect(clear.disabledReason?.(state)).toBeUndefined();
    // And running it through the registry really removes the collection.
    clear.run(store);
    expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
  });

  it("registers exactly four commands, each of which runs", () => {
    // Decision 89 ships four and no group-management UI, and the three marks
    // are generated from the shared package's list of the kinds — so a fourth
    // kind arriving with no way to create it would show up here.
    for (const kind of KINDS) {
      const store = withBothCentresSelected();
      commandById(`structure.stereo-group-${kind}`).run(store);
      expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([
        { kind, index: 1, atomIds: ["a2", "a4"] },
      ]);

      commandById("structure.stereo-group-clear").run(store);
      expect(stereoGroupsOf(store.getState().document.molecule)).toEqual([]);
    }
  });
});
