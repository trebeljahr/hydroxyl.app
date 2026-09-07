/**
 * The three surfaces agree, by construction.
 *
 * "Every keyboard shortcut and every toolbar button resolves to a registry
 * entry — no second list of actions exists anywhere" is an acceptance
 * criterion, and it is the kind that decays silently: someone adds a tool, the
 * rail grows a button, and the palette and the hotkey quietly do not. These
 * assertions are what make it a build failure instead.
 */

import { describe, expect, it } from "vitest";

import { COMMANDS, COMMAND_BY_ID } from "./commands/registry";
import { TOOLS, toolByHotkey, toolDef } from "./tools";

const TOOL_IDS = [
  "select",
  "pan",
  "bond",
  "element",
  "ring",
  "chain",
  "eraser",
  "charge",
] as const;

describe("the tool registry", () => {
  it("has exactly one entry per ToolId", () => {
    expect([...TOOLS].map((tool) => tool.id).sort()).toEqual(
      [...TOOL_IDS].sort(),
    );
    for (const id of TOOL_IDS) expect(toolDef(id).id).toBe(id);
  });

  it("gives every tool a unique hotkey, and finds it by that key", () => {
    const keys = TOOLS.map((tool) => tool.hotkey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tool of TOOLS) {
      expect(toolByHotkey(tool.hotkey)?.id).toBe(tool.id);
      // Case-insensitively: the layer matches on `event.key.toLowerCase()`,
      // and a shifted letter is still that tool.
      expect(toolByHotkey(tool.hotkey.toUpperCase())?.id).toBe(tool.id);
    }
  });

  it("keeps the organic set typeable by never taking a one-letter element", () => {
    // The tool letters and the element hotkeys share the bare keystrokes and
    // the tool wins, so a tool letter that WAS an element symbol would make
    // that element unreachable. H B C N O F P S I are the ones a figure is
    // made of; losing any of them would be a real regression.
    const organic = ["h", "b", "c", "n", "o", "f", "p", "s", "i"];
    for (const tool of TOOLS) {
      expect(organic).not.toContain(tool.hotkey);
    }
  });

  it("has a `tool.<id>` command for every tool, carrying the same hotkey", () => {
    for (const tool of TOOLS) {
      const command = COMMAND_BY_ID.get(`tool.${tool.id}`);
      expect(command, `tool.${tool.id} is missing from the command registry`).toBeDefined();
      expect(command?.title).toBe(tool.title);
      expect(command?.shortcut).toBe(tool.hotkey);
    }
  });

  it("registers no tool command for a tool that does not exist", () => {
    const toolCommands = COMMANDS.filter((c) => c.group === "tool");
    expect(toolCommands).toHaveLength(TOOLS.length);
  });
});
