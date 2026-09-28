/**
 * The context menu's model, per target, against a real store and real
 * molecules — no DOM. The component tests render it; these pin what it says.
 */

import { describe, expect, it } from "vitest";

import { benzene, insertFragment, linearChain, requireBond } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";
import { butan2olWedged } from "@starter/chem-render";
import { createDocument } from "@starter/shared";

import { createEditorStore } from "@/state";
import type { EditorStore, Selection } from "@/state";

import { COMMAND_BY_ID, commandById, setClipboardForTest } from "./commands/registry";
import {
  FALLBACK_REASON,
  buildContextMenu,
  keyboardContextTarget,
  menuItems,
  resolveContextTarget,
  selectionFor,
} from "./context-menu";
import type { ContextTarget, MenuEntry, MenuItem } from "./context-menu";

function storeWith(molecule: Molecule): EditorStore {
  return createEditorStore({
    document: createDocument({ molecule, now: "2024-01-01T00:00:00.000Z" }),
    viewportSize: { width: 800, height: 600 },
    now: () => "2024-01-01T00:00:00.000Z",
  });
}

const NONE: Selection = { atomIds: [], bondIds: [], annotationIds: [] };

/** Aim the menu the way the canvas does: select the target, then build. */
function open(store: EditorStore, target: ContextTarget) {
  const state = store.getState();
  state.setSelection(selectionFor(target, state.selection));
  return buildContextMenu(target, store.getState());
}

function item(entries: readonly MenuEntry[], id: string): MenuItem {
  const found = menuItems(entries).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no entry ${id}`);
  return found;
}

function submenuIds(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === "submenu" ? [entry.id] : []));
}

describe("what a right-click is about", () => {
  const multi: Selection = { atomIds: ["a1", "a2"], bondIds: ["b7"], annotationIds: [] };

  it("is the atom or bond under the pointer when nothing bigger is selected", () => {
    expect(resolveContextTarget(NONE, { kind: "atom", atomId: "a1" })).toEqual({ kind: "atom", atomId: "a1" });
    expect(resolveContextTarget(NONE, { kind: "bond", bondId: "b7" })).toEqual({ kind: "bond", bondId: "b7" });
    // A lone selected atom is still "that atom", not "the selection".
    expect(resolveContextTarget({ atomIds: ["a1"], bondIds: [], annotationIds: [] }, { kind: "atom", atomId: "a1" })).toEqual({
      kind: "atom",
      atomId: "a1",
    });
  });

  it("is the whole selection when the pointer lands inside a multi-selection", () => {
    expect(resolveContextTarget(multi, { kind: "atom", atomId: "a2" })).toEqual({ kind: "selection" });
    expect(resolveContextTarget(multi, { kind: "bond", bondId: "b7" })).toEqual({ kind: "selection" });
  });

  it("is the thing under the pointer when it lies OUTSIDE the selection", () => {
    expect(resolveContextTarget(multi, { kind: "atom", atomId: "a4" })).toEqual({ kind: "atom", atomId: "a4" });
  });

  it("is the canvas on empty space, whatever is selected", () => {
    expect(resolveContextTarget(multi, { kind: "none" })).toEqual({ kind: "canvas" });
  });

  it("follows the keyboard's focused atom, then the selection, then the canvas", () => {
    const mol = benzene();
    expect(keyboardContextTarget(NONE, "a3", mol)).toEqual({ kind: "atom", atomId: "a3" });
    expect(keyboardContextTarget({ atomIds: ["a3", "a4"], bondIds: [], annotationIds: [] }, "a3", mol)).toEqual({ kind: "selection" });
    // A focus id the molecule no longer has is no target.
    expect(keyboardContextTarget({ atomIds: ["a1"], bondIds: [], annotationIds: [] }, "a99", mol)).toEqual({ kind: "selection" });
    expect(keyboardContextTarget(NONE, null, mol)).toEqual({ kind: "canvas" });
  });

  it("selects an atom or bond target, and keeps the selection otherwise, by reference", () => {
    expect(selectionFor({ kind: "atom", atomId: "a1" }, multi)).toEqual({ atomIds: ["a1"], bondIds: [], annotationIds: [] });
    expect(selectionFor({ kind: "bond", bondId: "b7" }, multi)).toEqual({ atomIds: [], bondIds: ["b7"], annotationIds: [] });
    expect(selectionFor({ kind: "selection" }, multi)).toBe(multi);
    expect(selectionFor({ kind: "canvas" }, multi)).toBe(multi);
    const one = { atomIds: ["a1"], bondIds: [], annotationIds: [] };
    expect(selectionFor({ kind: "atom", atomId: "a1" }, one)).toBe(one);
  });
});

describe("every menu, on every target", () => {
  /** Butan-2-ol (a wedge, a stereocentre, heteroatom) beside benzene. */
  function world(): EditorStore {
    const pasted = insertFragment(butan2olWedged(), benzene(), { offset: { x: 5, y: 0 } });
    return storeWith(pasted.molecule);
  }

  const targets: readonly [string, (store: EditorStore) => ContextTarget][] = [
    ["atom", () => ({ kind: "atom", atomId: "a2" })],
    ["bond", () => ({ kind: "bond", bondId: "b7" })],
    [
      "selection",
      (store) => {
        store.getState().selectAll();
        return { kind: "selection" };
      },
    ],
    ["canvas", () => ({ kind: "canvas" })],
  ];

  for (const [name, aim] of targets) {
    it(`${name}: every entry is a registry command or a known helper, once`, () => {
      const store = world();
      const menu = open(store, aim(store));
      const items = menuItems(menu.entries);
      expect(items.length).toBeGreaterThan(3);
      const ids = items.map((entry) => entry.id);
      expect(new Set(ids).size, "duplicate entry").toBe(ids.length);
      for (const entry of items) {
        const helper = /^(isotope|hydrogens|lone-pairs)\./.test(entry.id);
        expect(helper || COMMAND_BY_ID.has(entry.id), entry.id).toBe(true);
      }
    });

    it(`${name}: shows the registry's own shortcut, and a reason beside every greyed entry`, () => {
      const store = world();
      const menu = open(store, aim(store));
      for (const entry of menuItems(menu.entries)) {
        if (COMMAND_BY_ID.has(entry.id)) {
          expect(entry.shortcut, entry.id).toBe(commandById(entry.id).shortcut);
        }
        if (entry.enabled) {
          expect(entry.reason, entry.id).toBeUndefined();
        } else {
          // The fallback exists for a command added later without a reason;
          // nothing the menu reaches today may be relying on it.
          expect(entry.reason, entry.id).toBeDefined();
          expect(entry.reason, entry.id).not.toBe(FALLBACK_REASON);
        }
      }
    });
  }

  it("atom: offers element, charge, isotope, hydrogens, lone pairs, stereo and delete", () => {
    const store = world();
    const menu = open(store, { kind: "atom", atomId: "a2" });
    expect(menu.title).toMatch(/^C, 3 bonds/);
    expect(submenuIds(menu.entries)).toEqual(["element", "isotope", "hydrogens", "lone-pairs", "stereo"]);
    expect(item(menu.entries, "structure.charge-up").shortcut).toBe("+");
    expect(item(menu.entries, "edit.delete").shortcut).toBe("Delete");
    // C2 carries its own wedge, so inverting it is on offer.
    expect(item(menu.entries, "structure.invert-stereo").enabled).toBe(true);
  });

  it("atom: marks the current element, isotope and hydrogen setting", () => {
    const store = world();
    const menu = open(store, { kind: "atom", atomId: "a5" });
    expect(item(menu.entries, "element.O").checked).toBe(true);
    expect(item(menu.entries, "element.C").checked).toBe(false);
    expect(item(menu.entries, "element.O").keys).toBe("O");
    expect(item(menu.entries, "isotope.natural").checked).toBe(true);
    expect(item(menu.entries, "isotope.18").label).toBe("¹⁸O");
    expect(item(menu.entries, "hydrogens.auto").checked).toBe(true);
    // The oxygen has no wedge of its own: the carbon's wedge is not its.
    expect(item(menu.entries, "structure.invert-stereo").enabled).toBe(false);
  });

  it("atom: lists the recent row first, then the organic set, then the full table", () => {
    const store = world();
    // Only elements from OUTSIDE the organic set are recent: the organic set
    // is always listed below the row.
    store.getState().noteRecentElement("Mg");
    const menu = open(store, { kind: "atom", atomId: "a2" });
    const element = menu.entries.find((entry) => entry.kind === "submenu" && entry.id === "element");
    if (element?.kind !== "submenu") throw new Error("no element submenu");
    expect(element.entries[0]).toEqual({ kind: "heading", label: "Recent" });
    const recent = item(element.entries, "element.Mg");
    expect(recent.label).toBe("Magnesium");
    // No key hint: typed at the canvas, several recent symbols switch tools.
    expect(recent.keys).toBeUndefined();
    expect(menuItems(element.entries).at(-1)?.id).toBe("element.table");
    recent.run(store);
    expect(store.getState().document.molecule.atoms["a2"]!.element).toBe("Mg");
  });

  it("bond: marks the current order and runs the registry's own order command", () => {
    const store = world();
    const menu = open(store, { kind: "bond", bondId: "b7" });
    expect(menu.title).toBe("Single bond, C–O");
    expect(item(menu.entries, "bond.order.1").checked).toBe(true);
    expect(item(menu.entries, "bond.order.2").shortcut).toBe("2");
    expect(item(menu.entries, "bond.stereo.wedge").checked).toBe(true);
    // A single bond has no second line to place.
    expect(item(menu.entries, "bond.side.left").enabled).toBe(false);

    item(menu.entries, "bond.order.2").run(store);
    expect(requireBond(store.getState().document.molecule, "b7").order).toBe(2);
  });

  it("selection: arranges, aligns across structures, and copies the selection as text", () => {
    const store = world();
    store.getState().selectAll();
    const menu = open(store, { kind: "selection" });
    expect(menu.title).toMatch(/^\d+ atoms, \d+ bonds selected$/);
    for (const id of [
      "structure.flip-horizontal",
      "structure.rotate-cw",
      "structure.align-top",
      "edit.copy-selection-smiles",
      "edit.copy",
      "select.invert",
    ]) {
      expect(item(menu.entries, id).enabled, id).toBe(true);
    }
    expect(item(menu.entries, "edit.copy").shortcut).toBe("Mod+c");
  });

  it("selection: greys alignment inside one structure, with the reason", () => {
    const store = storeWith(linearChain(4));
    store.getState().selectAll();
    const align = item(open(store, { kind: "selection" }).entries, "structure.align-left");
    expect(align.enabled).toBe(false);
    expect(align.reason).toMatch(/two or more separate structures/);
  });

  it("canvas: greys paste until something is copied, and says where else paste comes from", () => {
    setClipboardForTest(null);
    const store = world();
    const paste = item(open(store, { kind: "canvas" }).entries, "edit.paste");
    expect(paste.enabled).toBe(false);
    expect(paste.reason).toMatch(/another app/);
    expect(paste.shortcut).toBe("Mod+v");
    // Undo is greyed on a fresh store too, and says so.
    expect(item(open(store, { kind: "canvas" }).entries, "edit.undo").reason).toBe("Nothing to undo");
  });
});

describe("an entry re-asks before it runs", () => {
  it("does nothing if the state moved on since the menu was built", () => {
    const store = storeWith(benzene());
    const menu = open(store, { kind: "atom", atomId: "a1" });
    const del = item(menu.entries, "edit.delete");
    expect(del.enabled).toBe(true);
    // The selection is gone by the time the click lands.
    store.getState().clearSelection();
    const before = store.getState().document.molecule;
    del.run(store);
    expect(store.getState().document.molecule).toBe(before);
  });
});
