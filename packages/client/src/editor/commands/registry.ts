/**
 * THE command registry. One array, three surfaces.
 *
 * The tool rail renders `TOOLS` and dispatches `tool.<id>`; the keyboard layer
 * matches `shortcut`; the palette lists the whole array and greys what
 * `enabled(state)` says no to. None of the three holds a list of its own, so
 * they cannot drift — a command added here appears in all three at once, and a
 * command removed disappears from all three. `registry.test.ts` pins that:
 * every `ToolDef` has a `tool.<id>` entry, every shortcut is unique, and every
 * id is unique.
 *
 * `run` TAKES THE STORE, not a bare dispatch, for two reasons that both come
 * up immediately: a command has to read `getState()` for its own precondition
 * (paste needs the current molecule to compute an offset), and one of them —
 * "Clean up structure" — is async and has to re-read the state after an await.
 *
 * `enabled` TAKES A STATE rather than reading the store, so the palette can
 * evaluate every entry against one consistent snapshot instead of calling
 * `getState()` sixty times mid-render.
 *
 * ── THE CLIPBOARD IS A MODULE-LEVEL BINDING, NOT STORE STATE ───────────────
 *
 * It holds a `Molecule`, and `UiState` is the one slice edited THROUGH the
 * immer draft — so a molecule parked there would be read back as a Proxy, and
 * chem-guard would (correctly) throw the first time it reached chem-core. It
 * is also not undoable, not persisted and not rendered, which is the whole
 * definition of something that does not belong in the store.
 */

import {
  DEFAULT_BOND_LENGTH,
  isEmpty,
  RING_TEMPLATES,
} from "@starter/chem-core";
import type {
  BondOrder,
  BondStereo,
  ElementSymbol,
  Molecule,
  RingTemplateName,
  Vec2,
} from "@starter/chem-core";
import { COMMON_ORGANIC_ELEMENTS } from "@starter/chem-core";

import { fitBounds } from "@/canvas/metrics";
import { buildDocumentScene, panelToDraw } from "@/canvas/scene-bridge";
// From `machine`, not from the `@/editor/interaction` barrel: the barrel
// re-exports the React adapter, and this registry has to stay importable by a
// plain-node test.
import { documentBondLength } from "@/editor/interaction/machine";
import { TOOLS } from "@/editor/tools";
import { toggleTheme } from "@/shell/theme";
import { guardedOps } from "@/state/chem-guard";
import type { EditorState, EditorStore, Selection } from "@/state";

import { cleanUpStructure } from "./cleanup";

export type CommandGroup =
  | "tool"
  | "edit"
  | "select"
  | "structure"
  | "view"
  | "bond"
  | "element"
  | "ring"
  | "chain";

export interface Command {
  readonly id: string;
  readonly title: string;
  /** Extra words the palette's fuzzy filter should match on. */
  readonly keywords: readonly string[];
  /**
   * Display AND matcher, in one string: "Mod+Z", "Delete", "1". `Mod` is
   * Command on a Mac and Control everywhere else, resolved once by
   * `matchesShortcut`. A command with no shortcut is palette-only.
   */
  readonly shortcut?: string;
  readonly group: CommandGroup;
  /**
   * Keyboard-only. A second binding for a command the palette already lists
   * (Mod+Y for redo, Backspace for delete) would otherwise show up as a
   * duplicate row with a different key beside the same title.
   */
  readonly hidden?: boolean;
  enabled(state: EditorState): boolean;
  run(store: EditorStore): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Shortcut matching
// ---------------------------------------------------------------------------

interface ParsedShortcut {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

const MODIFIER_NAMES = ["Mod", "Shift", "Alt"] as const;

/**
 * Peel modifiers off the FRONT rather than splitting on "+" and taking the
 * last part.
 *
 * `"+".split("+")` is `["", ""]`, so the split reading turns the
 * increase-charge shortcut into the empty key and it can never match. Every
 * modifier is a known prefix, so consuming them from the left leaves the key
 * intact whatever character it is.
 */
function parseShortcut(shortcut: string): ParsedShortcut {
  let rest = shortcut;
  const mods = new Set<string>();
  for (;;) {
    const found = MODIFIER_NAMES.find((name) => rest.startsWith(`${name}+`));
    if (found === undefined) break;
    mods.add(found);
    rest = rest.slice(found.length + 1);
  }
  return {
    key: rest.toLowerCase(),
    mod: mods.has("Mod"),
    shift: mods.has("Shift"),
    alt: mods.has("Alt"),
  };
}

/**
 * Whether a keyboard event is this shortcut.
 *
 * SHIFT IS COMPARED STRICTLY, EXCEPT ON PUNCTUATION. Strictly, because
 * Mod+Shift+A (clear selection) and Mod+A (select all) are different commands
 * and a loose comparison would let the first fire the second. Except on
 * punctuation, because there the shifted character IS the key: `event.key` for
 * shift-equals is "+", and demanding `shiftKey === false` would make the
 * charge shortcut unpressable on every layout that puts + over =.
 */
export function matchesShortcut(
  shortcut: string,
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
  },
): boolean {
  const parsed = parseShortcut(shortcut);
  if (event.key.toLowerCase() !== parsed.key) return false;
  const mod = event.metaKey || event.ctrlKey;
  if (mod !== parsed.mod) return false;
  if (event.altKey !== parsed.alt) return false;
  const shiftMatters = parsed.key.length > 1 || /^[a-z0-9]$/.test(parsed.key);
  if (shiftMatters && event.shiftKey !== parsed.shift) return false;
  if (!shiftMatters && parsed.shift && !event.shiftKey) return false;
  return true;
}

const KEY_GLYPHS: Readonly<Record<string, string>> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** "Mod+Shift+Z" as the running platform writes it. */
export function formatShortcut(shortcut: string, isApple: boolean): string {
  const parsed = parseShortcut(shortcut);
  const parts: string[] = [];
  if (parsed.mod) parts.push(isApple ? "⌘" : "Ctrl");
  if (parsed.shift) parts.push(isApple ? "⇧" : "Shift");
  if (parsed.alt) parts.push(isApple ? "⌥" : "Alt");
  const glyph = KEY_GLYPHS[parsed.key];
  parts.push(
    glyph ??
      (parsed.key.length === 1
        ? parsed.key.toUpperCase()
        : parsed.key[0]!.toUpperCase() + parsed.key.slice(1)),
  );
  return parts.join(isApple ? "" : "+");
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

const EMPTY_SELECTION: Selection = Object.freeze({
  atomIds: Object.freeze([]),
  bondIds: Object.freeze([]),
});

function hasSelection(state: EditorState): boolean {
  return state.selection.atomIds.length > 0 || state.selection.bondIds.length > 0;
}

function selectedBondIds(state: EditorState): readonly string[] {
  return state.selection.bondIds;
}

// ---------------------------------------------------------------------------
// The clipboard
// ---------------------------------------------------------------------------

let clipboard: Molecule | null = null;

/** Test seam. Nothing in the app calls this. */
export function setClipboardForTest(molecule: Molecule | null): void {
  clipboard = molecule;
}

export function clipboardMolecule(): Molecule | null {
  return clipboard;
}

/**
 * Where a paste or a duplicate lands, relative to the original.
 *
 * Half a bond length down and to the right of the source, in MODEL units —
 * `y` is negative because model coordinates are y-up and the copy should
 * appear BELOW the original on screen. Offsetting at all is what keeps the
 * copy from hiding exactly behind what it was copied from, which reads as
 * nothing having happened.
 */
function pasteOffset(mol: Molecule): Vec2 {
  const bondLength = isEmpty(mol) ? DEFAULT_BOND_LENGTH : documentBondLength(mol);
  return { x: bondLength * 0.5, y: -bondLength * 0.5 };
}

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

/** One arrow press, as a fraction of the drawing's own bond length. */
export const NUDGE_FRACTION = 0.1;
/** With shift held. Fine positioning for a label that is nearly clear. */
export const FINE_NUDGE_FRACTION = 0.02;

export function nudgeSelection(store: EditorStore, delta: Vec2): void {
  const state = store.getState();
  const ids = state.selection.atomIds;
  if (ids.length === 0) return;
  state.applyMoleculeEdit("Nudge selection", (mol) =>
    guardedOps.translateAtoms(mol, ids, delta),
  );
}

/** The model-unit displacement one arrow press means for this drawing. */
export function nudgeDelta(
  mol: Molecule,
  direction: Vec2,
  fine: boolean,
): Vec2 {
  const step =
    documentBondLength(mol) * (fine ? FINE_NUDGE_FRACTION : NUDGE_FRACTION);
  return { x: direction.x * step, y: direction.y * step };
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

const always = (): boolean => true;

function toolCommands(): Command[] {
  return TOOLS.map((tool) => ({
    id: `tool.${tool.id}`,
    title: tool.title,
    keywords: ["tool", tool.id, ...tool.keywords],
    shortcut: tool.hotkey,
    group: "tool" as const,
    enabled: always,
    run: (store: EditorStore) => {
      store.getState().setTool(tool.id);
    },
  }));
}

const BOND_ORDERS: readonly BondOrder[] = [1, 2, 3];
const ORDER_NAMES: Readonly<Record<BondOrder, string>> = {
  1: "single",
  2: "double",
  3: "triple",
};

function bondOrderCommands(): Command[] {
  return BOND_ORDERS.map((order) => ({
    id: `bond.order.${order}`,
    title: `Bond order: ${ORDER_NAMES[order]}`,
    keywords: ["bond", "order", ORDER_NAMES[order], String(order)],
    shortcut: String(order),
    group: "bond" as const,
    enabled: always,
    run: (store: EditorStore) => {
      const state = store.getState();
      state.setToolOption("bondOrder", order);
      // Apply to what is selected as well as to the tool. A chemist who has
      // picked a bond and presses 2 means "make that one double"; a chemist
      // with nothing selected means "draw doubles from now on". Doing both is
      // the only reading under which neither is a surprise.
      const bondIds = selectedBondIds(state);
      if (bondIds.length === 0) return;
      state.applyMoleculeEdit(`Set ${ORDER_NAMES[order]} bond`, (mol) =>
        bondIds.reduce((m, id) => guardedOps.setBondOrder(m, id, order), mol),
      );
    },
  }));
}

const STEREO_TITLES: Readonly<Record<BondStereo, string>> = {
  none: "plain",
  wedge: "wedge",
  hash: "hash",
  wavy: "wavy",
  either: "either (crossed)",
};

function bondStereoCommands(): Command[] {
  return (Object.keys(STEREO_TITLES) as BondStereo[]).map((stereo) => ({
    id: `bond.stereo.${stereo}`,
    title: `Bond stereo: ${STEREO_TITLES[stereo]}`,
    keywords: ["bond", "stereo", "wedge", "hash", "wavy", STEREO_TITLES[stereo]],
    group: "bond" as const,
    enabled: always,
    run: (store: EditorStore) => {
      const state = store.getState();
      state.setToolOption("bondStereo", stereo);
      const bondIds = selectedBondIds(state);
      if (bondIds.length === 0) return;
      state.applyMoleculeEdit(`Set ${STEREO_TITLES[stereo]} bond`, (mol) =>
        bondIds.reduce((m, id) => guardedOps.setBondStereo(m, id, stereo), mol),
      );
    },
  }));
}

function ringTemplateCommands(): Command[] {
  return (Object.keys(RING_TEMPLATES) as RingTemplateName[]).map((name) => ({
    id: `ring.${name}`,
    title: `Ring template: ${name}`,
    keywords: [
      "ring",
      "template",
      name,
      // The one that matters most: an organic chemist looks for "benzene",
      // "arene" or "aromatic", and only benzene answers all three.
      ...(RING_TEMPLATES[name].kekule ? ["arene", "aromatic", "phenyl"] : []),
      String(RING_TEMPLATES[name].size),
    ],
    group: "ring" as const,
    enabled: always,
    run: (store: EditorStore) => {
      const state = store.getState();
      state.setToolOption("ringTemplate", name);
      state.setTool("ring");
    },
  }));
}

/**
 * The chain lengths the rail offers, and the only list of them.
 *
 * A command per length rather than a bare `setToolOption` on the rail button:
 * chain length was the last option in the shell reachable from exactly one
 * surface, so it had no palette row, no `enabled` and no shortcut, while its
 * three sibling popovers (bond order, ring, element) all dispatched commands.
 */
export const CHAIN_LENGTHS: readonly number[] = Object.freeze([
  2, 3, 4, 5, 6, 8, 10, 12,
]);

function chainLengthCommands(): Command[] {
  return CHAIN_LENGTHS.map((length) => ({
    id: `chain.length.${String(length)}`,
    title: `Chain length: ${String(length)} atoms`,
    keywords: ["chain", "length", "alkyl", "zigzag", String(length)],
    group: "chain" as const,
    enabled: always,
    run: (store: EditorStore) => {
      const state = store.getState();
      state.setToolOption("chainLength", length);
      state.setTool("chain");
    },
  }));
}

function elementCommands(): Command[] {
  return COMMON_ORGANIC_ELEMENTS.map((element: ElementSymbol) => ({
    id: `element.${element}`,
    title: `Element: ${element}`,
    keywords: ["element", "atom", element],
    group: "element" as const,
    enabled: always,
    run: (store: EditorStore) => {
      applyElement(store, element);
    },
  }));
}

/**
 * Set the element: on the selected atoms if there are any, on the tool
 * otherwise — and pick the element tool up either way, so the next click
 * stamps the same atom.
 *
 * Shared by the palette's element commands and by the keyboard layer's
 * multi-character buffer, so the two cannot disagree about what pressing "N"
 * does.
 */
export function applyElement(store: EditorStore, element: ElementSymbol): void {
  const state = store.getState();
  state.setToolOption("element", element);
  const atomIds = state.selection.atomIds;
  if (atomIds.length === 0) {
    state.setTool("element");
    return;
  }
  state.applyMoleculeEdit(`Set element to ${element}`, (mol) =>
    atomIds.reduce((m, id) => guardedOps.setElement(m, id, element), mol),
  );
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const EDIT_COMMANDS: readonly Command[] = [
  {
    id: "edit.undo",
    title: "Undo",
    keywords: ["undo", "back", "revert"],
    shortcut: "Mod+z",
    group: "edit",
    enabled: (state) => state.canUndo(),
    run: (store) => {
      store.getState().undo();
    },
  },
  {
    id: "edit.redo",
    title: "Redo",
    keywords: ["redo", "forward"],
    shortcut: "Mod+Shift+z",
    group: "edit",
    enabled: (state) => state.canRedo(),
    run: (store) => {
      store.getState().redo();
    },
  },
  {
    id: "edit.redo-alt",
    title: "Redo",
    keywords: ["redo", "forward"],
    shortcut: "Mod+y",
    group: "edit",
    hidden: true,
    enabled: (state) => state.canRedo(),
    run: (store) => {
      store.getState().redo();
    },
  },
  {
    id: "edit.delete",
    title: "Delete selection",
    keywords: ["delete", "erase", "remove", "backspace"],
    shortcut: "Delete",
    group: "edit",
    enabled: hasSelection,
    run: (store) => {
      const state = store.getState();
      const { atomIds, bondIds } = state.selection;
      if (atomIds.length === 0 && bondIds.length === 0) return;
      state.transact("Delete selection", () => {
        // Bonds first: removing an atom takes its bonds with it, so a bond id
        // gathered before the atom removal may already be gone by the time it
        // is reached. `removeBonds` ignores ids it does not have, but doing
        // the narrower edit first keeps the intent legible in the diff.
        state.applyMoleculeEdit("Delete selection", (mol) =>
          guardedOps.removeAtoms(guardedOps.removeBonds(mol, bondIds), atomIds),
        );
        state.setSelection(EMPTY_SELECTION);
      });
    },
  },
  {
    id: "edit.delete-backspace",
    title: "Delete selection",
    keywords: ["delete", "erase", "remove"],
    shortcut: "Backspace",
    group: "edit",
    hidden: true,
    enabled: hasSelection,
    run: (store) => {
      runCommand(store, "edit.delete");
    },
  },
  {
    id: "edit.copy",
    title: "Copy",
    keywords: ["copy", "clipboard", "fragment"],
    shortcut: "Mod+c",
    group: "edit",
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      const state = store.getState();
      const ids = state.selection.atomIds;
      if (ids.length === 0) return;
      clipboard = guardedOps.extractFragment(state.document.molecule, ids).molecule;
      state.setStatusMessage(`Copied ${clipboard.atomIds.length} atoms`);
    },
  },
  {
    id: "edit.cut",
    title: "Cut",
    keywords: ["cut", "clipboard", "fragment"],
    shortcut: "Mod+x",
    group: "edit",
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      const state = store.getState();
      const ids = state.selection.atomIds;
      if (ids.length === 0) return;
      clipboard = guardedOps.extractFragment(state.document.molecule, ids).molecule;
      state.transact("Cut", () => {
        state.applyMoleculeEdit("Cut", (mol) => guardedOps.removeAtoms(mol, ids));
        state.setSelection(EMPTY_SELECTION);
      });
    },
  },
  {
    id: "edit.paste",
    title: "Paste",
    keywords: ["paste", "clipboard"],
    shortcut: "Mod+v",
    group: "edit",
    enabled: () => clipboard !== null && clipboard.atomIds.length > 0,
    run: (store) => {
      const fragment = clipboard;
      if (fragment === null || fragment.atomIds.length === 0) return;
      const state = store.getState();
      const offset = pasteOffset(state.document.molecule);
      // The pasted ids are only knowable from the insert's own result, so the
      // molecule is built ONCE outside the edit and the closure returns it.
      // Running `insertFragment` inside the closure and reading its ids
      // afterwards would insert twice.
      const inserted = guardedOps.insertFragment(state.document.molecule, fragment, {
        offset,
      });
      state.transact("Paste", () => {
        state.applyMoleculeEdit("Paste", () => inserted.molecule);
        state.setSelection({
          atomIds: inserted.atomIds,
          bondIds: inserted.bondIds,
        });
      });
    },
  },
  {
    id: "edit.duplicate",
    title: "Duplicate",
    keywords: ["duplicate", "copy", "clone"],
    shortcut: "Mod+d",
    group: "edit",
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      const state = store.getState();
      const ids = state.selection.atomIds;
      if (ids.length === 0) return;
      const copy = guardedOps.duplicateFragment(state.document.molecule, ids, {
        offset: pasteOffset(state.document.molecule),
      });
      state.transact("Duplicate", () => {
        state.applyMoleculeEdit("Duplicate", () => copy.molecule);
        // Onto the COPIES, so the next drag moves what was just made rather
        // than the original. `duplicateFragment` keys its map by SOURCE id
        // precisely so this is possible.
        state.setSelection({ atomIds: copy.atomIds, bondIds: copy.bondIds });
      });
    },
  },
];

const SELECT_COMMANDS: readonly Command[] = [
  {
    id: "select.all",
    title: "Select all",
    keywords: ["select", "all", "everything"],
    shortcut: "Mod+a",
    group: "select",
    enabled: (state) => !isEmpty(state.document.molecule),
    run: (store) => {
      store.getState().selectAll();
    },
  },
  {
    id: "select.none",
    title: "Clear selection",
    keywords: ["deselect", "clear", "none"],
    shortcut: "Mod+Shift+a",
    group: "select",
    enabled: hasSelection,
    run: (store) => {
      store.getState().clearSelection();
    },
  },
];

const STRUCTURE_COMMANDS: readonly Command[] = [
  {
    id: "structure.clean-up",
    title: "Clean up structure",
    keywords: ["clean", "tidy", "layout", "coordinates", "rdkit", "overlap"],
    shortcut: "Mod+Shift+l",
    group: "structure",
    enabled: (state) => !isEmpty(state.document.molecule),
    run: (store) => cleanUpStructure(store),
  },
  {
    id: "structure.charge-up",
    title: "Increase charge",
    keywords: ["charge", "cation", "plus", "positive"],
    shortcut: "+",
    group: "structure",
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      changeCharge(store, 1);
    },
  },
  {
    id: "structure.charge-up-equals",
    title: "Increase charge",
    keywords: ["charge", "cation", "plus", "positive"],
    shortcut: "=",
    group: "structure",
    hidden: true,
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      changeCharge(store, 1);
    },
  },
  {
    id: "structure.charge-down",
    title: "Decrease charge",
    keywords: ["charge", "anion", "minus", "negative"],
    shortcut: "-",
    group: "structure",
    enabled: (state) => state.selection.atomIds.length > 0,
    run: (store) => {
      changeCharge(store, -1);
    },
  },
  {
    id: "structure.cycle-bond-order",
    title: "Cycle bond order",
    keywords: ["bond", "order", "cycle", "single", "double", "triple"],
    group: "structure",
    enabled: (state) => state.selection.bondIds.length > 0,
    run: (store) => {
      const state = store.getState();
      const bondIds = state.selection.bondIds;
      if (bondIds.length === 0) return;
      state.applyMoleculeEdit("Cycle bond order", (mol) =>
        bondIds.reduce((m, id) => guardedOps.cycleBondOrder(m, id), mol),
      );
    },
  },
  {
    id: "structure.flip-bond",
    title: "Flip wedge direction",
    keywords: ["flip", "wedge", "hash", "narrow", "stereo", "reverse"],
    group: "structure",
    enabled: (state) => state.selection.bondIds.length > 0,
    run: (store) => {
      const state = store.getState();
      const bondIds = state.selection.bondIds;
      if (bondIds.length === 0) return;
      // `flipBond` swaps `from` and `to`. The stereo STRING is unchanged — a
      // wedge stays a "wedge" — but the narrow end is at `from`, so the
      // drawing inverts, which is what "flip" means to whoever asked.
      state.applyMoleculeEdit("Flip bond", (mol) =>
        bondIds.reduce((m, id) => guardedOps.flipBond(m, id), mol),
      );
    },
  },
];

const VIEW_COMMANDS: readonly Command[] = [
  {
    id: "view.reset",
    title: "Reset view",
    keywords: ["view", "reset", "zoom", "centre", "center"],
    shortcut: "Mod+0",
    group: "view",
    enabled: always,
    run: (store) => {
      store.getState().resetViewport();
    },
  },
  {
    id: "view.fit",
    title: "Fit to view",
    keywords: ["fit", "zoom", "view", "all", "frame"],
    shortcut: "Mod+Shift+f",
    group: "view",
    enabled: (state) => !isEmpty(state.document.molecule),
    run: (store) => {
      const state = store.getState();
      // The scene is built ON DEMAND rather than memoised on the document:
      // the canvas commits on every pointer-move frame of a drag, and a memo
      // keyed on the document would rebuild a scene per frame for a command
      // nobody is running. `buildDocumentScene` costs 0.037 ms on a 300-atom
      // structure, so paying it on the keystroke is free.
      state.zoomToFit(fitBounds(buildDocumentScene(state.document)), 0);
    },
  },
  {
    id: "view.theme",
    title: "Toggle light / dark theme",
    keywords: ["theme", "dark", "light", "appearance", "mode"],
    group: "view",
    enabled: always,
    run: () => {
      // The CHROME only. The canvas keeps its publication-white ground in
      // both themes — see shell/theme.ts.
      toggleTheme();
    },
  },
  {
    id: "view.aromatic-circles",
    title: "Toggle aromatic circles",
    keywords: ["aromatic", "circle", "benzene", "ring", "display"],
    shortcut: "Mod+Shift+o",
    group: "view",
    enabled: (state) => panelToDraw(state.document) !== undefined,
    run: (store) => {
      const state = store.getState();
      // The panel the CANVAS draws, resolved the same way the canvas resolves
      // it. Hardcoding "panel-skeletal" would silently target nothing in a
      // document whose panels were reordered.
      const panel = panelToDraw(state.document);
      if (panel === undefined) return;
      const next = !panel.representation.display.aromaticCircles;
      state.updatePanel(panel.id, { display: { aromaticCircles: next } });
    },
  },
  {
    id: "view.command-palette",
    title: "Command palette",
    keywords: ["command", "palette", "search", "actions"],
    shortcut: "Mod+k",
    group: "view",
    enabled: always,
    run: (store) => {
      store.getState().toggleCommandPalette();
    },
  },
];

function changeCharge(store: EditorStore, delta: number): void {
  const state = store.getState();
  const ids = state.selection.atomIds;
  if (ids.length === 0) return;
  const mol = state.document.molecule;
  state.applyMoleculeEdit(delta > 0 ? "Increase charge" : "Decrease charge", (m) =>
    ids.reduce((acc, id) => {
      const atom = Object.hasOwn(mol.atoms, id) ? mol.atoms[id] : undefined;
      if (atom === undefined) return acc;
      return guardedOps.setCharge(acc, id, atom.charge + delta);
    }, m),
  );
}

export const COMMANDS: readonly Command[] = Object.freeze([
  ...toolCommands(),
  ...bondOrderCommands(),
  ...bondStereoCommands(),
  ...ringTemplateCommands(),
  ...chainLengthCommands(),
  ...elementCommands(),
  ...EDIT_COMMANDS,
  ...SELECT_COMMANDS,
  ...STRUCTURE_COMMANDS,
  ...VIEW_COMMANDS,
]);

export const COMMAND_BY_ID: ReadonlyMap<string, Command> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

export function commandById(id: string): Command {
  const found = COMMAND_BY_ID.get(id);
  if (found === undefined) throw new Error(`No command registered as "${id}"`);
  return found;
}

/** Run a command by id, ignoring its `enabled` — the caller has already asked. */
export function runCommand(store: EditorStore, id: string): void {
  void commandById(id).run(store);
}

/**
 * The command a keyboard event fires, or undefined.
 *
 * FIRST MATCH WINS and the order of `COMMANDS` therefore matters in exactly
 * one place: `Mod+Shift+z` (redo) must be tried before `Mod+z` (undo) would
 * be, or a redo would undo. It is, because `matchesShortcut` compares Shift
 * strictly when the shortcut asks for it — `Mod+z` does not match a shifted
 * Z — so the two are mutually exclusive rather than ordered. The uniqueness
 * test pins that no two entries can both match.
 */
export function commandForEvent(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): Command | undefined {
  for (const command of COMMANDS) {
    if (command.shortcut === undefined) continue;
    if (!matchesShortcut(command.shortcut, event)) continue;
    // A DISABLED command still CLAIMS the key. Falling through to the next
    // match would make Mod+Z type a "z" into nothing once history ran out.
    return command;
  }
  return undefined;
}
