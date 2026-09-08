"use client";

/**
 * The command palette. It lists `COMMANDS` and nothing else.
 *
 * THAT IS THE WHOLE POINT OF THE REGISTRY. A palette with its own array would
 * be a second list of actions, and the two would part company on the first
 * command anyone added to the toolbar without remembering this file. Here the
 * only thing the palette knows how to do is read the array, ask each entry
 * `enabled(state)`, and call `run(store)`.
 *
 * DISABLED ENTRIES ARE SHOWN, GREYED — not filtered out. A user searching for
 * "paste" with an empty clipboard needs to be told the command exists and is
 * unavailable; a palette that simply had no result for it reads as a missing
 * feature.
 *
 * FILTERING IS cmdk's, over title + keywords. The keywords are what make
 * "arene" and "aromatic" both find the benzene template, which is the one
 * search an organic chemist actually types.
 *
 * IT IS SPLIT IN TWO, and that split is a performance requirement rather than
 * tidiness. `enabled(state)` takes a whole state, so the list has to subscribe
 * to the whole store — and a whole-store subscription re-renders on every
 * pointer-move frame of a drag, which is the one thing `useEditorStore`'s
 * required selector exists to prevent. The outer component subscribes to one
 * boolean; the inner one, which only exists while the palette is open, is the
 * only thing that watches everything.
 */

import { useMemo } from "react";
import type { ReactElement } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { COMMANDS, formatShortcut } from "@/editor/commands/registry";
import type {
  Command,
  CommandGroup as Group,
} from "@/editor/commands/registry";
import { editorStore, useEditorStore } from "@/state";

const GROUP_TITLES: Readonly<Record<Group, string>> = {
  file: "File",
  tool: "Tools",
  edit: "Edit",
  select: "Selection",
  structure: "Structure",
  view: "View",
  bond: "Bonds",
  element: "Elements",
  ring: "Ring templates",
  chain: "Chains",
};

/**
 * Exported for the test that asserts it covers every group `COMMANDS` uses.
 *
 * A group missing from this array is not a type error — the palette iterates
 * the ARRAY and asks each group for its entries, so an uncovered group means
 * those commands render nowhere at all, silently. That is how a whole
 * namespace could be added to the registry and still be absent from the one
 * surface that is supposed to list everything.
 */
export const GROUP_ORDER: readonly Group[] = [
  "file",
  "tool",
  "edit",
  "select",
  "structure",
  "bond",
  "ring",
  "chain",
  "element",
  "view",
];

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

export function CommandPalette(): ReactElement {
  const open = useEditorStore((state) => state.ui.commandPaletteOpen);
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) =>
        editorStore.getState().setCommandPaletteOpen(next)
      }
      title="Command palette"
    >
      <CommandInput placeholder="Search commands…" />
      {open ? <PaletteList /> : null}
    </CommandDialog>
  );
}

function PaletteList(): ReactElement {
  // The whole state, on purpose, and only from inside an open palette:
  // `enabled` takes a state and every entry has to be judged against ONE
  // snapshot.
  const state = useEditorStore((s) => s);

  const grouped = useMemo(() => {
    const byGroup = new Map<Group, Command[]>();
    for (const command of COMMANDS) {
      if (command.hidden === true) continue;
      const bucket = byGroup.get(command.group);
      if (bucket === undefined) byGroup.set(command.group, [command]);
      else bucket.push(command);
    }
    return GROUP_ORDER.flatMap((group) => {
      const commands = byGroup.get(group);
      return commands === undefined ? [] : [{ group, commands }];
    });
  }, []);

  const apple = isApplePlatform();

  return (
    <CommandList>
      <CommandEmpty>No matching command.</CommandEmpty>
      {grouped.map(({ group, commands }) => (
        <CommandGroup key={group} heading={GROUP_TITLES[group]}>
          {commands.map((command) => {
            const enabled = command.enabled(state);
            return (
              <CommandItem
                key={command.id}
                value={command.title}
                keywords={[...command.keywords]}
                data-palette-command={command.id}
                disabled={!enabled}
                onSelect={() => {
                  if (!enabled) return;
                  // Closed FIRST. Several commands read the palette flag —
                  // the keyboard layer refuses every shortcut while it is
                  // open — and one of them is the palette toggle itself,
                  // which would immediately reopen what it just closed.
                  editorStore.getState().setCommandPaletteOpen(false);
                  void command.run(editorStore);
                }}
              >
                <span>{command.title}</span>
                {command.shortcut === undefined ? null : (
                  <CommandShortcut>
                    {formatShortcut(command.shortcut, apple)}
                  </CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
