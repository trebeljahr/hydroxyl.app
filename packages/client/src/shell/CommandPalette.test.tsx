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

import { benzene } from "@starter/chem-core";
import { createDocument } from "@starter/shared";

import { COMMANDS } from "@/editor/commands/registry";
import { editorStore } from "@/state";

import { CommandPalette } from "./CommandPalette";

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

function items(): HTMLElement[] {
  return [...document.querySelectorAll("[data-command]")] as HTMLElement[];
}

describe("CommandPalette", () => {
  it("renders nothing until it is opened", () => {
    render(<CommandPalette />);
    expect(items()).toHaveLength(0);
  });

  it("lists ONLY registry commands, and every unhidden one", () => {
    open();
    const shown = items().map((node) => node.getAttribute("data-command"));
    const expected = COMMANDS.filter((c) => c.hidden !== true).map((c) => c.id);
    expect([...shown].sort()).toEqual([...expected].sort());
  });

  it("shows every tool from the rail, from the same registry", () => {
    open();
    const shown = new Set(items().map((node) => node.getAttribute("data-command")));
    for (const command of COMMANDS.filter((c) => c.group === "tool")) {
      expect(shown.has(command.id), command.id).toBe(true);
    }
  });

  it("greys out a command whose enabled(state) is false, rather than hiding it", () => {
    // A user searching for "paste" with an empty clipboard has to be told the
    // command exists and is unavailable; no result at all reads as a missing
    // feature.
    open();
    const paste = document.querySelector('[data-command="edit.paste"]');
    expect(paste).not.toBeNull();
    expect(paste?.getAttribute("data-disabled")).toBe("true");
  });

  it("runs a command and closes itself", () => {
    open();
    const ring = document.querySelector('[data-command="tool.ring"]');
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
    const undo = document.querySelector('[data-command="edit.undo"]');
    expect(undo?.textContent).toContain("Undo");
    expect(undo?.textContent).toMatch(/Z/);
  });
});
