/**
 * The palette lists the registry, and the registry only.
 *
 * "The palette lists commands by name with live shortcuts and greys out those
 * whose enabled(state) is false" is the acceptance line; the assertion that
 * matters most is the one right after it, that every visible entry is a
 * registry id.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { benzene, readMolblock } from "@starter/chem-core";
import { dictionaryEntryById } from "@starter/chem-core/dictionary";
import { createDocument } from "@starter/shared";

import { COMMANDS, commandById } from "@/editor/commands/registry";
import { editorStore } from "@/state";

import { CommandPalette, GROUP_ORDER } from "./CommandPalette";

beforeEach(() => {
  const state = editorStore.getState();
  state.openDocument(
    createDocument({ molecule: benzene(), now: "2024-01-01T00:00:00.000Z" }),
  );
  state.clearSelection();
  state.setTool("select");
  state.setCommandPaletteOpen(false);
});

function open(): void {
  render(<CommandPalette />);
  act(() => {
    editorStore.getState().setCommandPaletteOpen(true);
  });
}

/**
 * `data-palette-command`, NOT `data-command`: the top bar's buttons carry
 * `data-command` too, and a selector that matched both would report the
 * palette as populated while it was shut.
 */
function items(): HTMLElement[] {
  return [...document.querySelectorAll("[data-palette-command]")] as HTMLElement[];
}

describe("CommandPalette", () => {
  it("renders nothing until it is opened", () => {
    render(<CommandPalette />);
    expect(items()).toHaveLength(0);
  });

  it("lists ONLY registry commands, and every unhidden one", () => {
    open();
    const shown = items().map((node) => node.getAttribute("data-palette-command"));
    const expected = COMMANDS.filter((c) => c.hidden !== true).map((c) => c.id);
    expect([...shown].sort()).toEqual([...expected].sort());
  });

  it("shows every tool from the rail, from the same registry", () => {
    open();
    const shown = new Set(items().map((node) => node.getAttribute("data-palette-command")));
    for (const command of COMMANDS.filter((c) => c.group === "tool")) {
      expect(shown.has(command.id), command.id).toBe(true);
    }
  });

  it("greys out a command whose enabled(state) is false, rather than hiding it", () => {
    // A user searching for "paste" with an empty clipboard has to be told the
    // command exists and is unavailable; no result at all reads as a missing
    // feature.
    open();
    const paste = document.querySelector('[data-palette-command="edit.paste"]');
    expect(paste).not.toBeNull();
    expect(paste?.getAttribute("data-disabled")).toBe("true");
  });

  it("greys out the locants toggle over benzene, which nothing numbers, and shows why (decision 37)", () => {
    open();
    const locants = document.querySelector<HTMLElement>('[data-palette-command="view.show-locants"]');
    expect(locants).not.toBeNull();
    expect(locants!.getAttribute("data-disabled")).toBe("true");
    const reason = commandById("view.show-locants").disabledReason?.(editorStore.getState());
    expect(reason).toMatch(/numbering/i);
    expect(locants!.getAttribute("title")).toBe(reason);
    expect(locants!.querySelector("[data-disabled-reason]")?.textContent).toBe(reason);
    // An enabled entry carries no reason.
    const circles = document.querySelector('[data-palette-command="view.aromatic-circles"]');
    expect(circles?.getAttribute("title")).toBeNull();
    expect(circles?.querySelector("[data-disabled-reason]")).toBeNull();
  });

  it("enables the locants toggle while locants are on, so it can switch them off (decision 56)", () => {
    act(() => {
      const state = editorStore.getState();
      for (const panel of state.document.panels) {
        state.updatePanel(panel.id, { display: { showLocants: true } });
      }
    });
    open();
    const locants = document.querySelector<HTMLElement>('[data-palette-command="view.show-locants"]');
    expect(locants).not.toBeNull();
    expect(locants!.getAttribute("data-disabled")).not.toBe("true");
    expect(locants!.getAttribute("title")).toBeNull();
    expect(locants!.querySelector("[data-disabled-reason]")).toBeNull();
    act(() => {
      fireEvent.click(locants!);
    });
    expect(
      editorStore.getState().document.panels.some((p) => !p.representation.display.showLocants),
    ).toBe(true);
    // Off again: back to disabled, with the reason.
    act(() => {
      editorStore.getState().setCommandPaletteOpen(true);
    });
    const again = document.querySelector<HTMLElement>('[data-palette-command="view.show-locants"]');
    expect(again!.getAttribute("data-disabled")).toBe("true");
    expect(again!.querySelector("[data-disabled-reason]")?.textContent).toMatch(/numbering/i);
  });

  it("offers the locants toggle over a numbered document, and switches them on (decision 168)", () => {
    act(() => {
      editorStore.getState().openDocument(
        createDocument({
          molecule: readMolblock(dictionaryEntryById("aldehydo-d-glucose")!.molblock).molecule,
          now: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    open();
    const locants = document.querySelector<HTMLElement>('[data-palette-command="view.show-locants"]');
    expect(locants!.getAttribute("data-disabled")).not.toBe("true");
    expect(locants!.querySelector("[data-disabled-reason]")).toBeNull();
    act(() => {
      fireEvent.click(locants!);
    });
    expect(
      editorStore.getState().document.panels.some((p) => p.representation.display.showLocants),
    ).toBe(true);
  });

  it("runs a command and closes itself", () => {
    open();
    const ring = document.querySelector('[data-palette-command="tool.ring"]');
    expect(ring).not.toBeNull();
    act(() => {
      fireEvent.click(ring!);
    });
    expect(editorStore.getState().tool).toBe("ring");
    expect(editorStore.getState().ui.commandPaletteOpen).toBe(false);
  });

  it("offers benzene as a ring template a chemist can search for", () => {
    open();
    expect(screen.getByText("Ring template: benzene")).toBeTruthy();
    expect(screen.getByText("Ring template: cyclohexane")).toBeTruthy();
  });

  it("shows a shortcut beside the commands that have one", () => {
    open();
    const undo = document.querySelector('[data-palette-command="edit.undo"]');
    expect(undo?.textContent).toContain("Undo");
    expect(undo?.textContent).toMatch(/Z/);
  });
});

describe("the palette leaves nothing out", () => {
  it("orders every group the registry actually uses", () => {
    // Not a type error if one is missing: the palette iterates GROUP_ORDER
    // and pulls each group's entries out of COMMANDS, so an uncovered group
    // renders nowhere — a whole namespace can be added to the registry and
    // still be invisible on the one surface meant to list everything.
    const used = new Set(COMMANDS.map((command) => command.group));
    for (const group of used) expect(GROUP_ORDER).toContain(group);
  });

  it("lists every non-hidden command exactly once", () => {
    open();
    const ids = items().map((node) => node.dataset["paletteCommand"]);
    const expected = COMMANDS.filter((command) => command.hidden !== true).map(
      (command) => command.id,
    );
    expect([...ids].sort()).toEqual([...expected].sort());
  });
});
