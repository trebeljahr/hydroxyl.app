/**
 * The command registry, driven against a REAL store.
 *
 * `createEditorStore` rather than the module singleton, so these tests do not
 * inherit each other's history — and so a failure here is about the command
 * rather than about test order.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { benzene, buildMolecule, elementCounts } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { PUBLICATION_STYLE, serializeFigure } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { documentFigure } from "@/lib/export/figure";
import { createEditorStore } from "@/state";
import type { EditorStore } from "@/state";

import {
  COMMANDS,
  clipboardMolecule,
  commandById,
  commandForEvent,
  formatShortcut,
  matchesShortcut,
  setClipboardForTest,
} from "./registry";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

function key(
  k: string,
  modifiers: Partial<{ mod: boolean; shift: boolean; alt: boolean }> = {},
): {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
} {
  return {
    key: k,
    ctrlKey: modifiers.mod === true,
    metaKey: false,
    shiftKey: modifiers.shift === true,
    altKey: modifiers.alt === true,
  };
}

beforeEach(() => {
  setClipboardForTest(null);
});

describe("the registry's shape", () => {
  it("has unique ids", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets one keystroke match two commands", () => {
    // The one that nearly went wrong: `Mod+A` (select all) and `Mod+Shift+A`
    // (clear selection) differ only in Shift, and a loose shift comparison
    // made the first swallow the second.
    const shortcuts = COMMANDS.flatMap((command) =>
      command.shortcut === undefined ? [] : [command.shortcut],
    );
    for (const shortcut of shortcuts) {
      // Peeled from the front, not split: `"+".split("+")` is `["", ""]`, and
      // a test helper that got that wrong would silently assert nothing about
      // the increase-charge shortcut.
      let rest = shortcut;
      const mods = new Set<string>();
      for (;;) {
        const found = ["Mod", "Shift", "Alt"].find((name) =>
          rest.startsWith(`${name}+`),
        );
        if (found === undefined) break;
        mods.add(found);
        rest = rest.slice(found.length + 1);
      }
      const event = key(rest, {
        mod: mods.has("Mod"),
        shift: mods.has("Shift"),
        alt: mods.has("Alt"),
      });
      const matched = COMMANDS.filter(
        (command) =>
          command.shortcut !== undefined &&
          matchesShortcut(command.shortcut, event),
      );
      expect(
        matched.map((command) => command.id),
        `"${shortcut}" matched more than one command`,
      ).toHaveLength(1);
    }
  });

  it("never fires a bare letter for a Mod shortcut, or the reverse", () => {
    expect(matchesShortcut("Mod+z", key("z"))).toBe(false);
    expect(matchesShortcut("Mod+z", key("z", { mod: true }))).toBe(true);
    expect(matchesShortcut("v", key("v", { mod: true }))).toBe(false);
    expect(matchesShortcut("Mod+a", key("a", { mod: true, shift: true }))).toBe(false);
    expect(matchesShortcut("Mod+Shift+a", key("a", { mod: true, shift: true }))).toBe(
      true,
    );
  });

  it("ignores Shift on punctuation, because the shifted character IS the key", () => {
    // `event.key` for shift-equals is "+", so demanding shiftKey === false
    // would make the charge shortcut unpressable.
    expect(matchesShortcut("+", key("+", { shift: true }))).toBe(true);
    expect(matchesShortcut("-", key("-"))).toBe(true);
  });

  it("writes shortcuts the way the platform does", () => {
    expect(formatShortcut("Mod+Shift+z", true)).toBe("⌘⇧Z");
    expect(formatShortcut("Mod+Shift+z", false)).toBe("Ctrl+Shift+Z");
  });
});

describe("edit commands", () => {
  it("deletes the selection as ONE history entry and clears it", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1", "a2"]);
    const before = store.getState().history.past.length;

    commandById("edit.delete").run(store);

    expect(store.getState().document.molecule.atomIds).toHaveLength(4);
    expect(store.getState().selection.atomIds).toEqual([]);
    expect(store.getState().history.past.length).toBe(before + 1);

    // And one undo brings both back.
    store.getState().undo();
    expect(store.getState().document.molecule.atomIds).toHaveLength(6);
    expect(store.getState().selection.atomIds).toEqual(["a1", "a2"]);
  });

  it("copies a fragment and pastes it offset, selecting the copies", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1", "a2"]);
    commandById("edit.copy").run(store);
    expect(clipboardMolecule()?.atomIds).toHaveLength(2);
    // Copy is not an edit.
    expect(store.getState().document.molecule.atomIds).toHaveLength(6);

    commandById("edit.paste").run(store);
    const after = store.getState().document.molecule;
    expect(after.atomIds).toHaveLength(8);
    expect(store.getState().selection.atomIds).toHaveLength(2);
    // The pasted atoms are NOT the originals, and they moved.
    for (const id of store.getState().selection.atomIds) {
      expect(["a1", "a2"]).not.toContain(id);
    }
    expect(after.atoms[store.getState().selection.atomIds[0]!]!.pos).not.toEqual(
      after.atoms["a1"]!.pos,
    );
  });

  it("cuts in one entry, and paste is disabled until something is copied", () => {
    const store = storeWith(benzene());
    expect(commandById("edit.paste").enabled(store.getState())).toBe(false);

    store.getState().selectAtoms(["a1"]);
    const before = store.getState().history.past.length;
    commandById("edit.cut").run(store);

    expect(store.getState().document.molecule.atomIds).toHaveLength(5);
    expect(store.getState().history.past.length).toBe(before + 1);
    expect(commandById("edit.paste").enabled(store.getState())).toBe(true);
  });

  it("duplicates onto the copies rather than the originals", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1", "a2", "a3"]);
    commandById("edit.duplicate").run(store);
    expect(store.getState().document.molecule.atomIds).toHaveLength(9);
    for (const id of store.getState().selection.atomIds) {
      expect(["a1", "a2", "a3"]).not.toContain(id);
    }
  });
});

describe("structure commands", () => {
  it("changes the charge of every selected atom, in one entry", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1", "a2"]);
    const before = store.getState().history.past.length;

    commandById("structure.charge-up").run(store);
    expect(store.getState().document.molecule.atoms["a1"]!.charge).toBe(1);
    expect(store.getState().document.molecule.atoms["a2"]!.charge).toBe(1);
    expect(store.getState().history.past.length).toBe(before + 1);

    commandById("structure.charge-down").run(store);
    commandById("structure.charge-down").run(store);
    expect(store.getState().document.molecule.atoms["a1"]!.charge).toBe(-1);
  });

  it("cycles a selected bond's order 1 -> 2 -> 3 -> 1", () => {
    const store = storeWith(
      buildMolecule((b) => {
        const a = b.atom("C", { x: 0, y: 0 });
        const c = b.atom("C", { x: 1, y: 0 });
        b.bond(a, c, 1);
      }),
    );
    const bondId = store.getState().document.molecule.bondIds[0]!;
    store.getState().selectBonds([bondId]);
    const cycle = commandById("structure.cycle-bond-order");

    cycle.run(store);
    expect(store.getState().document.molecule.bonds[bondId]!.order).toBe(2);
    cycle.run(store);
    expect(store.getState().document.molecule.bonds[bondId]!.order).toBe(3);
    cycle.run(store);
    expect(store.getState().document.molecule.bonds[bondId]!.order).toBe(1);
  });

  it("flips a wedge by swapping its endpoints, not by renaming the stereo", () => {
    const store = storeWith(
      buildMolecule((b) => {
        const a = b.atom("C", { x: 0, y: 0 });
        const c = b.atom("C", { x: 1, y: 0 });
        b.bond(a, c, 1);
      }),
    );
    const mol = store.getState().document.molecule;
    const bondId = mol.bondIds[0]!;
    const { from, to } = mol.bonds[bondId]!;
    store.getState().applyMoleculeEdit("stereo", (m) => ({
      ...m,
      bonds: { ...m.bonds, [bondId]: { ...m.bonds[bondId]!, stereo: "wedge" } },
    }));
    store.getState().selectBonds([bondId]);

    commandById("structure.flip-bond").run(store);
    const flipped = store.getState().document.molecule.bonds[bondId]!;
    expect(flipped.from).toBe(to);
    expect(flipped.to).toBe(from);
    // The STRING is unchanged; the narrow end moved because it is at `from`.
    expect(flipped.stereo).toBe("wedge");
  });

  it("sets the bond order of the selection AND the tool from 1/2/3", () => {
    const store = storeWith(benzene());
    const bondId = store.getState().document.molecule.bondIds[0]!;
    store.getState().selectBonds([bondId]);

    commandById("bond.order.2").run(store);
    expect(store.getState().toolOptions.bondOrder).toBe(2);
    expect(store.getState().document.molecule.bonds[bondId]!.order).toBe(2);
  });
});

describe("element commands", () => {
  it("retypes the selected atoms and leaves the formula consistent", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1"]);
    commandById("element.N").run(store);

    const counts = elementCounts(store.getState().document.molecule);
    expect(counts["N"]).toBe(1);
    expect(counts["C"]).toBe(5);
    expect(store.getState().toolOptions.element).toBe("N");
  });

  it("with nothing selected, arms the element tool instead of editing", () => {
    const store = storeWith(benzene());
    commandById("element.O").run(store);
    expect(store.getState().tool).toBe("element");
    expect(store.getState().toolOptions.element).toBe("O");
    expect(elementCounts(store.getState().document.molecule)["O"]).toBeUndefined();
  });
});

describe("ring template commands", () => {
  it("offers benzene and cyclohexane as separate templates", () => {
    // The gap this task closed: both are size 6, so a numeric ring option
    // could only ever reach one of them.
    const store = storeWith(benzene());
    commandById("ring.benzene").run(store);
    expect(store.getState().toolOptions.ringTemplate).toBe("benzene");
    expect(store.getState().tool).toBe("ring");

    commandById("ring.cyclohexane").run(store);
    expect(store.getState().toolOptions.ringTemplate).toBe("cyclohexane");
  });
});

describe("view commands", () => {
  it("toggles aromatic circles on the panel the canvas actually draws", () => {
    const store = storeWith(benzene());
    const panelId = store.getState().document.panels[0]!.id;
    const before =
      store.getState().document.panels[0]!.representation.display.aromaticCircles;

    commandById("view.aromatic-circles").run(store);
    const after = store
      .getState()
      .document.panels.find((panel) => panel.id === panelId)!;
    expect(after.representation.display.aromaticCircles).toBe(!before);
  });

  it("lists the locants toggle disabled, with its reason, while nothing numbers the atoms", () => {
    // Decision 37. The command exists — a chemist searching "locant" learns
    // the feature is coming — but a switch that draws nothing would read as
    // broken, so it is off and says why. showLocants itself defaults off.
    const store = storeWith(benzene());
    const command = commandById("view.show-locants");
    expect(command.title).toBe("Toggle locants");
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toMatch(/numbering/i);
    for (const panel of store.getState().document.panels) {
      expect(panel.representation.display.showLocants, panel.id).toBe(false);
    }
    // The old id is gone, not aliased.
    expect(COMMANDS.some((c) => c.id === "view.show-atom-indices")).toBe(false);
  });

  it("lets a document that already has locants on switch them off, and only off (decision 56)", () => {
    // A document from a newer build that numbers atoms can carry
    // showLocants: true. No control may leave it stuck on.
    const store = storeWith(benzene());
    for (const panel of store.getState().document.panels) {
      store.getState().updatePanel(panel.id, { display: { showLocants: true } });
    }
    const command = commandById("view.show-locants");
    expect(command.enabled(store.getState())).toBe(true);
    expect(command.disabledReason?.(store.getState())).toBeUndefined();

    command.run(store);
    const canvas = (): boolean =>
      store.getState().document.panels.some((panel) => panel.representation.display.showLocants === false);
    expect(canvas()).toBe(true);
    // Off, it disables again with the reason — and cannot switch back on,
    // even when run directly.
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toMatch(/numbering/i);
    const before = JSON.stringify(store.getState().document.panels);
    command.run(store);
    expect(JSON.stringify(store.getState().document.panels)).toBe(before);
  });

  it("gives no other display toggle a disabled reason", () => {
    const store = storeWith(benzene());
    for (const command of COMMANDS.filter((c) => c.id.startsWith("view.") && c.id !== "view.show-locants")) {
      expect(command.disabledReason, command.id).toBeUndefined();
    }
    expect(commandById("view.aromatic-circles").enabled(store.getState())).toBe(true);
  });
});

describe("style preset commands (decision 21)", () => {
  it("switch the preset a canvas-style export draws with, as ONE undo step", () => {
    const store = storeWith(benzene());
    const state = () => store.getState();
    // New documents still open in the screen style.
    expect(state().document.stylePreset).toBe("screen");
    expect(commandById("view.style-screen").enabled(state())).toBe(false);
    expect(commandById("view.style-publication").enabled(state())).toBe(true);

    const screenSvg = serializeFigure(documentFigure(state().document, "canvas"));
    const before = state().history.past.length;
    commandById("view.style-publication").run(store);

    expect(state().document.stylePreset).toBe("publication");
    expect(state().history.past.length).toBe(before + 1);
    expect(documentFigure(state().document, "canvas").style).toBe(PUBLICATION_STYLE);
    expect(serializeFigure(documentFigure(state().document, "canvas"))).not.toBe(screenSvg);
    expect(commandById("view.style-publication").enabled(state())).toBe(false);

    state().undo();
    expect(state().document.stylePreset).toBe("screen");
    expect(serializeFigure(documentFigure(state().document, "canvas"))).toBe(screenSvg);
  });

  it("records nothing when the preset is already in use", () => {
    const store = storeWith(benzene());
    const before = store.getState().history.past.length;
    commandById("view.style-screen").run(store);
    expect(store.getState().history.past.length).toBe(before);
  });
});

describe("commandForEvent", () => {
  it("resolves a keystroke to the one command that claims it", () => {
    expect(commandForEvent(key("v"))?.id).toBe("tool.select");
    expect(commandForEvent(key("2"))?.id).toBe("bond.order.2");
    expect(commandForEvent(key("z", { mod: true }))?.id).toBe("edit.undo");
    expect(commandForEvent(key("z", { mod: true, shift: true }))?.id).toBe("edit.redo");
    expect(commandForEvent(key("Delete"))?.id).toBe("edit.delete");
  });

  it("claims nothing for a plain element letter, so the buffer can have it", () => {
    for (const letter of ["c", "n", "o", "s", "h", "f", "p", "b", "i"]) {
      expect(commandForEvent(key(letter))).toBeUndefined();
    }
  });
});

describe("the surfaces the registry has to cover", () => {
  it("has a command for every viewport action the status bar offers", () => {
    // Fit used to be inline in StatusBar.tsx: no command, no palette row, no
    // shortcut, reachable from that one strip and nowhere else. Reset had a
    // command AND a second code path beside it. Both are the seam the "one
    // registry" criterion exists to close.
    for (const id of ["view.fit", "view.reset", "view.theme"]) {
      expect(commandById(id), id).toBeDefined();
    }
  });

  it("fits the view to the structure", () => {
    const store = storeWith(benzene());
    store.getState().setViewportSize({ width: 800, height: 600 });
    store.getState().resetViewport();
    const before = store.getState().viewport.zoom;
    commandById("view.fit").run(store);
    expect(store.getState().viewport.zoom).not.toBe(before);
  });

  it("cannot fit an empty sketch", () => {
    const store = storeWith(buildMolecule(() => undefined));
    expect(commandById("view.fit").enabled(store.getState())).toBe(false);
  });

  it("sets the chain length through a command, like every other tool option", () => {
    const store = storeWith(benzene());
    commandById("chain.length.8").run(store);
    expect(store.getState().toolOptions.chainLength).toBe(8);
    expect(store.getState().tool).toBe("chain");
  });

  it("gives every command in the array a group the palette can title", () => {
    // A group added to `CommandGroup` without a title is a runtime hole in
    // the palette rather than a type error, because the palette groups by
    // whatever the entries carry.
    const groups = new Set(COMMANDS.map((command) => command.group));
    expect(groups).toContain("chain");
    expect(groups).toContain("view");
  });
});
