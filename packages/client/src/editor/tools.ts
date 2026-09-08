/**
 * The tool registry: one entry per `ToolId`, and the only list of them.
 *
 * The rail renders this array in order, the command registry derives a
 * `tool.<id>` command from every entry, and the keyboard layer matches
 * `hotkey`. There is deliberately no second list anywhere — the acceptance
 * criterion "no second list of actions exists" is a property of the code, not
 * a promise, and `tools.test.ts` asserts the three surfaces agree.
 *
 * ── TOOLS ARE STICKY (decision 3) ──────────────────────────────────────────
 *
 * A chosen tool stays chosen until another is picked; Escape puts it down.
 * Nothing in the store resets `tool` after an edit and that absence is the
 * feature — a chemist drawing a steroid draws thirty bonds in a row.
 *
 * ── WHY THE HOTKEYS ARE THE LETTERS THEY ARE, AND WHAT THEY COST ──────────
 *
 * Tool letters and ELEMENT letters compete for the same bare keystrokes, and
 * the tool usually wins. The casualty list is worth stating exactly rather
 * than discovering, and an earlier version of this comment got it wrong in
 * both directions — it named only symbols BEGINNING with a tool letter, and
 * it promised an organic set that in fact had two holes in it. The real list
 * has two classes, and `tools.test.ts` recomputes both from `ELEMENTS` so it
 * cannot go stale again.
 *
 * CLASS ONE — the symbol BEGINS with a tool letter, so the first keystroke is
 * the tool and no element input ever starts:
 *
 *     V; Ga Ge Gd; Db Ds Dy; Er Es Eu; Rb Ru Rh Re Ra Rn Rf Rg; Xe; Zn Zr
 *
 * CLASS TWO — the FIRST letter is itself a one-letter element, so it applies
 * immediately, and the SECOND letter is a tool letter, which the registry
 * claims before the buffer can complete the pair:
 *
 *     He Be Ne Cr Fe Kr Sr Pd Cd Ce Pr Nd Ir Hg Fr Sg Og
 *
 * Every one of them remains reachable through the element popover on the
 * rail, the properties panel, and the palette's `element.*` commands.
 *
 * WHAT IS NOT A CASUALTY, and why. A symbol whose first letter is NOT an
 * element (Al, Ar, Ag, Li, Mg, Mn, Ti, Te…) is safe: that letter applies
 * nothing, so the key layer holds it as a pending prefix and lets it claim
 * the next keystroke ahead of any tool. And the organic set — H B C N O F P
 * S Cl Br I Si Se — is genuinely untouched, but Br and Se are untouched only
 * because the key layer gives a completed COMMON_ORGANIC_ELEMENTS pair
 * priority over a tool letter as well; without that exception `r` and `e`
 * would take them. Not one of `d e g q r v x z` is a one-letter symbol except
 * `v` (vanadium), and `q` costs nothing at all: no element begins with it.
 */

import type { ComponentType } from "react";
import {
  EraserIcon,
  HandIcon,
  MousePointer2Icon,
  TypeIcon,
} from "lucide-react";

import {
  CarbonChainIcon,
  ChargeIcon,
  CyclohexaneIcon,
  SingleBondIcon,
} from "@/chem-icons";
import type { ToolId } from "@/state";

export interface ToolDef {
  readonly id: ToolId;
  /** Tooltip, palette title and accessible name. */
  readonly title: string;
  /** One sentence for the tooltip's second line — what the gesture does. */
  readonly hint: string;
  /**
   * Search terms for the palette, BEYOND the title.
   *
   * Curated rather than derived from `hint`. Splitting the hint into words
   * was the first attempt and it made the palette's fuzzy filter useless:
   * every tool then carried a dozen common words ("click", "an", "atom",
   * "to"), so almost any query matched almost every tool and the entry the
   * user was actually looking for sank below the fold.
   */
  readonly keywords: readonly string[];
  /** A single bare letter, matched on `event.key.toLowerCase()`. */
  readonly hotkey: string;
  /** CSS cursor for the canvas while this tool is held. */
  readonly cursor: string;
  /** A `ComponentType` and not a plain function, because lucide's icons are
   *  `forwardRef` components and the chemistry glyphs are plain functions;
   *  the rail has to be able to hold either. */
  readonly Icon: ComponentType<{ readonly className?: string }>;
  /**
   * WHICH REDUCER PATHS THIS TOOL CHANGES, named honestly.
   *
   * `select` and `pan` change none: `select` IS the fall-through, and the pan
   * tool is handled by the gesture hook (a left drag becomes a view pan)
   * rather than by the reducer, which never sees a pixel. Recording that here
   * rather than implying eight symmetrical branches keeps the next reader from
   * looking for code that does not exist.
   */
  readonly branches: readonly ("click" | "dragStart" | "gesture")[];
}

export const TOOLS: readonly ToolDef[] = Object.freeze([
  Object.freeze<ToolDef>({
    id: "select",
    keywords: ["pointer", "arrow", "marquee", "move"],
    title: "Select",
    hint: "Click to select, drag to draw or move, drag empty space to marquee",
    hotkey: "v",
    cursor: "default",
    Icon: MousePointer2Icon,
    branches: [],
  }),
  Object.freeze<ToolDef>({
    id: "bond",
    keywords: ["draw", "line", "single", "double", "triple", "wedge"],
    title: "Draw bond",
    hint: "Drag from an atom to draw; click an existing bond to retype it",
    hotkey: "d",
    cursor: "crosshair",
    Icon: SingleBondIcon,
    branches: ["click", "dragStart"],
  }),
  Object.freeze<ToolDef>({
    id: "element",
    keywords: ["atom", "symbol", "heteroatom", "label"],
    title: "Element",
    hint: "Click an atom to retype it, or empty canvas to place one",
    hotkey: "e",
    cursor: "text",
    Icon: TypeIcon,
    branches: ["click", "dragStart"],
  }),
  Object.freeze<ToolDef>({
    id: "ring",
    keywords: ["cycle", "cyclohexane", "benzene", "template"],
    title: "Ring template",
    hint: "Click a bond to fuse, an atom to attach, alt-click for spiro",
    hotkey: "r",
    cursor: "copy",
    Icon: CyclohexaneIcon,
    branches: ["click"],
  }),
  Object.freeze<ToolDef>({
    id: "chain",
    keywords: ["alkyl", "zigzag", "backbone"],
    title: "Chain",
    hint: "Click an atom to grow a zig-zag chain off it",
    hotkey: "z",
    cursor: "copy",
    Icon: CarbonChainIcon,
    branches: ["click"],
  }),
  Object.freeze<ToolDef>({
    id: "charge",
    keywords: ["cation", "anion", "plus", "minus", "formal"],
    title: "Charge",
    hint: "Click an atom to add a charge, alt-click to subtract",
    hotkey: "q",
    cursor: "cell",
    Icon: ChargeIcon,
    branches: ["click"],
  }),
  Object.freeze<ToolDef>({
    id: "eraser",
    keywords: ["delete", "remove", "rub out"],
    title: "Eraser",
    hint: "Click an atom or a bond to remove it",
    hotkey: "x",
    cursor: "crosshair",
    Icon: EraserIcon,
    branches: ["click"],
  }),
  Object.freeze<ToolDef>({
    id: "pan",
    keywords: ["scroll", "move view", "hand", "grab"],
    title: "Pan",
    hint: "Drag to move the view — the same as holding space",
    hotkey: "g",
    cursor: "grab",
    Icon: HandIcon,
    branches: ["gesture"],
  }),
]);

const BY_ID = new Map<ToolId, ToolDef>(TOOLS.map((tool) => [tool.id, tool]));

/**
 * Total over `ToolId` by construction: the map is built from `TOOLS` and the
 * test asserts every member of the union appears there, so this never returns
 * undefined for a real tool and callers need no fallback.
 */
export function toolDef(id: ToolId): ToolDef {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`No tool registered for "${id}"`);
  return found;
}

export function toolByHotkey(key: string): ToolDef | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((tool) => tool.hotkey === lower);
}
