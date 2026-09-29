/**
 * The command registry, driven against a REAL store.
 *
 * `createEditorStore` rather than the module singleton, so these tests do not
 * inherit each other's history — and so a failure here is about the command
 * rather than about test order.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ELEMENTS, alphaAminoAcids, benzene, buildMolecule, elementCounts, readMolblock } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { SCREEN_STYLE, cyanideAdditionToAcetone, serializeFigure } from "@starter/chem-render";
import { createDocument } from "@starter/shared";
import type { StylePresetId } from "@starter/shared";

import { buildCanvasScene } from "@/canvas/scene-bridge";
import { documentFigure } from "@/lib/export/figure";
import { createEditorStore, MAX_ZOOM, MIN_ZOOM } from "@/state";
import type { EditorStore } from "@/state";

import {
  COMMANDS,
  KEY_ZOOM_STEP,
  clipboardMolecule,
  commandById,
  commandForEvent,
  formatShortcut,
  matchesShortcut,
  setClipboardForTest,
} from "./registry";

function storeWith(molecule: Molecule, stylePreset?: StylePresetId): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, stylePreset, now: "2024-01-01T00:00:00.000Z" }),
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

  it("deletes a selected curly arrow, alone or with atoms, as ONE history entry", () => {
    const mechanism = cyanideAdditionToAcetone();
    const store = createEditorStore({
      document: createDocument({
        molecule: mechanism.molecule,
        annotations: mechanism.annotations,
        now: "2024-01-01T00:00:00.000Z",
      }),
      viewportSize: { width: 800, height: 600 },
      now: () => "2024-01-01T00:00:00.000Z",
    });
    const annotationIds = () => store.getState().document.annotations.map((a) => a.id);
    const past = () => store.getState().history.past.length;

    store.getState().setSelection({ atomIds: [], bondIds: [], annotationIds: ["ann_2"] });
    expect(commandById("edit.delete").enabled(store.getState())).toBe(true);
    const before = past();
    commandById("edit.delete").run(store);
    expect(annotationIds()).toEqual(["ann_1"]);
    expect(store.getState().document.molecule).toBe(mechanism.molecule);
    expect(store.getState().selection.annotationIds).toEqual([]);
    expect(past()).toBe(before + 1);

    // An arrow and an unrelated atom together: still one entry, one undo.
    store.getState().setSelection({
      atomIds: [mechanism.oxygen],
      bondIds: [],
      annotationIds: ["ann_1"],
    });
    commandById("edit.delete").run(store);
    expect(annotationIds()).toEqual([]);
    expect(store.getState().document.molecule.atomIds).not.toContain(mechanism.oxygen);
    expect(past()).toBe(before + 2);
    store.getState().undo();
    expect(annotationIds()).toEqual(["ann_1"]);
    expect(store.getState().document.molecule.atomIds).toContain(mechanism.oxygen);
    expect(store.getState().selection.annotationIds).toEqual(["ann_1"]);
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

  it("covers every element chem-core knows, not only the organic set", () => {
    // The full table dispatches these, so an element with no command would be
    // a cell that throws on click.
    for (const element of ELEMENTS) {
      const command = commandById(`element.${element.symbol}`);
      expect(command.group, element.symbol).toBe("element");
      // The NAME is a keyword: "vanadium" has to find `element.V`, whose
      // symbol is the select tool's letter and so unreachable by typing it.
      expect(command.keywords, element.symbol).toContain(element.name);
    }
  });

  it("puts a metal on a selected atom: platinum retypes, and gets no hydrogens", () => {
    const store = storeWith(benzene());
    store.getState().selectAtoms(["a1"]);
    commandById("element.Pt").run(store);
    const counts = elementCounts(store.getState().document.molecule);
    expect(counts["Pt"]).toBe(1);
    // Benzene lost one C-H; a metal carries no implicit hydrogens to replace it.
    expect(counts["H"]).toBe(5);
  });

  it("remembers a pick from outside the organic set for the quick picker", () => {
    const store = storeWith(benzene());
    commandById("element.Pt").run(store);
    commandById("element.N").run(store);
    commandById("element.Pd").run(store);
    expect(store.getState().recentElements).toEqual(["Pd", "Pt"]);
  });

  it("opens the full periodic table from the palette", () => {
    const store = storeWith(benzene());
    const command = commandById("element.table");
    expect(command.group).toBe("element");
    expect(command.keywords).toContain("periodic table");
    command.run(store);
    expect(store.getState().ui.periodicTableOpen).toBe(true);
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
    // Decisions 37 and 168. The command exists — a chemist searching "locant"
    // learns the feature is there — but over benzene, which no rule numbers, a
    // switch that draws nothing would read as broken, so it is off and says
    // why. showLocants itself defaults off.
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

  it("enables the locants toggle over a document that numbers an atom, and draws them (decision 168)", () => {
    // L-cysteine: C1 the carboxyl, C2 the alpha carbon, C3 the CH2SH. In
    // Screen: at Publication, where new documents open (decision 135), C2's
    // locant has no clear slot and is reported instead (decision 71).
    const cysteine = readMolblock(dictionaryEntryById("l-cysteine")!.molblock).molecule;
    const store = storeWith(cysteine, "screen");
    const command = commandById("view.show-locants");
    expect(command.enabled(store.getState())).toBe(true);
    expect(command.disabledReason?.(store.getState())).toBeUndefined();

    command.run(store);
    const shown = (): readonly string[] =>
      buildCanvasScene(store.getState().document, store.getState().ui.activePanelId)
        .primitives.flatMap((p) =>
          p.type === "textRun" && p.id.endsWith(":locant") ? [p.spans.map((s) => s.text).join("")] : [],
        );
    expect([...shown()].sort()).toEqual(["1", "2", "3"]);
    // The export draws the same three (decision 21).
    const svg = serializeFigure(documentFigure(store.getState().document, "canvas"));
    expect([...svg.matchAll(/:locant"[^>]*><tspan>([^<]*)</g)].map((m) => m[1]).sort()).toEqual(["1", "2", "3"]);

    // Still live once on, and switches back off.
    expect(command.enabled(store.getState())).toBe(true);
    command.run(store);
    expect(shown()).toEqual([]);
    expect(command.enabled(store.getState())).toBe(true);
  });

  it("keeps the toggle disabled when explicit empty locants hide every derived one", () => {
    const cysteine = readMolblock(dictionaryEntryById("l-cysteine")!.molblock).molecule;
    const hidden = Object.fromEntries(alphaAminoAcids(cysteine)[0]!.backbone.map((id) => [id, ""]));
    const store = createEditorStore({
      document: createDocument({ molecule: cysteine, locants: hidden, now: "2024-01-01T00:00:00.000Z" }),
      viewportSize: { width: 800, height: 600 },
      now: () => "2024-01-01T00:00:00.000Z",
    });
    const command = commandById("view.show-locants");
    expect(command.enabled(store.getState())).toBe(false);
    expect(command.disabledReason?.(store.getState())).toMatch(/numbering/i);
  });

  it("gives no other display toggle a disabled reason while it can be used", () => {
    // Asked of the STATE, not of whether the function exists: since the
    // context menu shows a reason beside every greyed entry, the toggles carry
    // one for the case where there is no structural panel to toggle on. What
    // must never happen is a reason beside a toggle that works.
    const store = storeWith(benzene());
    for (const command of COMMANDS.filter((c) => c.id.startsWith("view.") && c.id !== "view.show-locants")) {
      expect(command.disabledReason?.(store.getState()), command.id).toBeUndefined();
    }
    expect(commandById("view.aromatic-circles").enabled(store.getState())).toBe(true);
  });
});

describe("style preset commands (decision 21)", () => {
  it("switch the preset a canvas-style export draws with, as ONE undo step", () => {
    const store = storeWith(benzene());
    const state = () => store.getState();
    // New documents open in the publication style (decision 135).
    expect(state().document.stylePreset).toBe("publication");
    expect(commandById("view.style-publication").enabled(state())).toBe(false);
    expect(commandById("view.style-screen").enabled(state())).toBe(true);

    const publicationSvg = serializeFigure(documentFigure(state().document, "canvas"));
    const before = state().history.past.length;
    commandById("view.style-screen").run(store);

    expect(state().document.stylePreset).toBe("screen");
    expect(state().history.past.length).toBe(before + 1);
    expect(documentFigure(state().document, "canvas").style).toBe(SCREEN_STYLE);
    expect(serializeFigure(documentFigure(state().document, "canvas"))).not.toBe(publicationSvg);
    expect(commandById("view.style-screen").enabled(state())).toBe(false);

    state().undo();
    expect(state().document.stylePreset).toBe("publication");
    expect(serializeFigure(documentFigure(state().document, "canvas"))).toBe(publicationSvg);
  });

  it("records nothing when the preset is already in use", () => {
    const store = storeWith(benzene());
    const before = store.getState().history.past.length;
    commandById("view.style-publication").run(store);
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

  it("zooms in and out about the centre, one step each, and back exactly", () => {
    const store = storeWith(benzene());
    store.getState().setViewportSize({ width: 800, height: 600 });
    store.getState().resetViewport();
    const before = store.getState().viewport;

    commandById("view.zoom-in").run(store);
    const zoomed = store.getState().viewport;
    expect(zoomed.zoom).toBeCloseTo(before.zoom * KEY_ZOOM_STEP, 12);
    // About the centre, which is where `pan` points: nothing slides.
    expect(zoomed.pan).toEqual(before.pan);

    commandById("view.zoom-out").run(store);
    expect(store.getState().viewport.zoom).toBeCloseTo(before.zoom, 12);
  });

  it("claims Mod+= and Mod+- from the browser's page zoom, and + where it has its own key", () => {
    const plus = { key: "+", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false };
    const equals = { ...plus, key: "=", shiftKey: false };
    const minus = { ...plus, key: "-", shiftKey: false };
    const zoomIn = COMMANDS.filter((c) => c.shortcut !== undefined && matchesShortcut(c.shortcut, equals));
    expect(zoomIn.map((c) => c.id)).toEqual(["view.zoom-in"]);
    const zoomInPlus = COMMANDS.filter((c) => c.shortcut !== undefined && matchesShortcut(c.shortcut, plus));
    expect(zoomInPlus.map((c) => c.id)).toEqual(["view.zoom-in-plus"]);
    const zoomOut = COMMANDS.filter((c) => c.shortcut !== undefined && matchesShortcut(c.shortcut, minus));
    expect(zoomOut.map((c) => c.id)).toEqual(["view.zoom-out"]);
  });

  it("greys zoom in out at one zoom limit, and zoom out at the other", () => {
    const store = storeWith(benzene());
    store.getState().setZoom(MAX_ZOOM);
    expect(commandById("view.zoom-in").enabled(store.getState())).toBe(false);
    expect(commandById("view.zoom-out").enabled(store.getState())).toBe(true);
    store.getState().setZoom(MIN_ZOOM);
    expect(commandById("view.zoom-out").enabled(store.getState())).toBe(false);
  });

  it("resets to 100% as the status bar reads it, in either style (decision 107)", () => {
    const store = storeWith(benzene());
    store.getState().setViewportSize({ width: 800, height: 600 });
    // A new document is in Publication (decision 135), whose bond is 24 px, so
    // a viewport zoom of 1 would put a bond on screen at 55% of Screen's.
    // Reset lands on the zoom that shows the same 44 px bond Screen shows at
    // 100%.
    store.getState().panBy({ x: 40, y: 40 });
    commandById("view.reset").run(store);
    expect(store.getState().viewport.zoom).toBeCloseTo(44 / 24, 12);
    expect(store.getState().viewport.pan).toEqual({ x: 0, y: 0 });

    commandById("view.style-screen").run(store);
    store.getState().panBy({ x: 40, y: 40 });
    commandById("view.reset").run(store);
    expect(store.getState().viewport.zoom).toBe(1);
    expect(store.getState().viewport.pan).toEqual({ x: 0, y: 0 });
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
