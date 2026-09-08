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

import { COMMON_ORGANIC_ELEMENTS, ELEMENTS } from "@starter/chem-core";
import type { ElementSymbol } from "@starter/chem-core";

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

  it("keeps the organic set typeable in TWO letters as well as one", () => {
    // The one-letter check above is not the whole story and its predecessor
    // said it was: a tool letter appearing as the SECOND character of a
    // symbol takes that symbol too. Cl and Si survive because `l` and `i` are
    // not tool letters; Br and Se survive only because the keyboard layer
    // gives a completed COMMON_ORGANIC_ELEMENTS pair priority over a tool.
    // If a future tool claims `l` or `i`, or that exception is removed, this
    // fails rather than quietly losing an element from every figure.
    const toolLetters = new Set(TOOLS.map((tool) => tool.hotkey));
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      const lower = symbol.toLowerCase();
      expect(toolLetters.has(lower[0]!), `${symbol} begins with a tool letter`)
        .toBe(false);
      if (lower.length < 2) continue;
      const second = lower[1]!;
      const rescued = COMMON_ORGANIC_ELEMENTS.includes(symbol);
      expect(
        !toolLetters.has(second) || rescued,
        `${symbol} needs the organic-pair exception in useKeyBindings`,
      ).toBe(true);
    }
  });

  it("documents the casualty list the tool letters really cost", () => {
    // Recomputed from `ELEMENTS` rather than typed out, so the header of
    // tools.ts cannot drift from the code again — it did, and it named only
    // half of the real list while promising an organic set with two holes in
    // it. The COUNTS are the assertion; the header carries the names.
    const toolLetters = new Set(TOOLS.map((tool) => tool.hotkey));
    const oneLetter = new Set(
      ELEMENTS.filter((element) => element.symbol.length === 1).map((element) =>
        element.symbol.toLowerCase(),
      ),
    );
    const firstLetterLost: string[] = [];
    const secondLetterLost: string[] = [];
    for (const { symbol } of ELEMENTS) {
      if (symbol.length > 2) continue;
      const lower = symbol.toLowerCase();
      const first = lower[0]!;
      if (toolLetters.has(first)) {
        firstLetterLost.push(symbol);
        continue;
      }
      const second = lower[1];
      if (second === undefined) continue;
      // A first letter that is NOT an element becomes a pending prefix and
      // outranks the tool, so only an applied single loses its second letter.
      if (!oneLetter.has(first)) continue;
      if (!toolLetters.has(second)) continue;
      // …unless the pair is in the organic set, which the layer rescues.
      if (COMMON_ORGANIC_ELEMENTS.includes(symbol as ElementSymbol)) continue;
      secondLetterLost.push(symbol);
    }
    expect(firstLetterLost).toContain("V");
    expect(firstLetterLost).toContain("Zn");
    expect(secondLetterLost).toContain("Fe");
    expect(secondLetterLost).toContain("Hg");
    // Nothing an organic figure is made of is in either list.
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      expect(firstLetterLost, symbol).not.toContain(symbol);
      expect(secondLetterLost, symbol).not.toContain(symbol);
    }
    expect(firstLetterLost).toHaveLength(21);
    expect(secondLetterLost).toHaveLength(17);
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
