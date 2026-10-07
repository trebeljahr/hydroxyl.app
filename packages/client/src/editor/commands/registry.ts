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
  ALIGN_EDGES,
  DEFAULT_BOND_LENGTH,
  DEG,
  FUNCTIONAL_GROUP_NAMES,
  FUNCTIONAL_GROUPS,
  atomsCentroid,
  bounds,
  horizontalMirror,
  invertSelection,
  invertStereocentre,
  isEmpty,
  reachableFrom,
  RING_TEMPLATES,
  selectFragment,
  selection as coreSelection,
  unionSelections,
  verticalMirror,
} from "@starter/chem-core";
import type {
  AlignEdge,
  AtomId,
  BondOrder,
  BondQuery,
  BondStereo,
  DoubleBondSide,
  ElementSymbol,
  Molecule,
  RingTemplateName,
  Vec2,
} from "@starter/chem-core";
import { BOND_QUERY_VALUES, ELEMENTS } from "@starter/chem-core";
import { RGROUP_ENTRY, isRGroupEntry } from "@/editor/rgroup-entry";
import {
  DISPLAY_FLAG_KEYS,
  DOUBLE_BOND_SIDE_VALUES,
  STEREO_GROUP_KIND_VALUES,
  VIEW_KINDS,
} from "@starter/shared";
import {
  VIEW_KIND_TITLES,
  panelLetter,
  pxToModel,
  representationAvailability,
} from "@starter/chem-render";
import type { DisplayFlagKey, SketchDocument } from "@starter/shared";

import { fitBounds } from "@/canvas/metrics";
import { canvasPointer } from "@/canvas/pointer-anchor";
import {
  STYLE_PRESETS,
  STYLE_PRESET_IN_SENTENCE,
  buildCanvasScene,
  canvasPanelFor,
  documentNumbersAtoms,
  renderStyleFor,
} from "@/canvas/scene-bridge";
import { referenceZoom } from "@/canvas/view-scale";
// From `machine`, not from the `@/editor/interaction` barrel: the barrel
// re-exports the React adapter, and this registry has to stay importable by a
// plain-node test.
import {
  documentBondLength,
  movingAtomIds,
  ringFuseRefusal,
} from "@/editor/interaction/machine";
import { TOOLS } from "@/editor/tools";
import { toggleTheme } from "@/shell/theme";
import { guardedOps } from "@/state/chem-guard";
import { MAX_ZOOM, MIN_ZOOM, toModel } from "@/state/viewport";
import type { EditorState, EditorStore, Selection } from "@/state";

import {
  COLLAPSE_ABBREVIATION_KEYWORDS,
  COLLAPSE_ABBREVIATION_TITLE,
  EXPAND_ABBREVIATION_KEYWORDS,
  EXPAND_ABBREVIATION_TITLE,
  NOTHING_TO_EXPAND_REASON,
  canCollapse,
  canExpand,
  collapseDisabledReason,
  collapseSelection,
  expandSelection,
} from "./abbreviations";
import { cleanUpStructure } from "./cleanup";
import {
  ADD_EXPLICIT_H_KEYWORDS,
  ADD_EXPLICIT_H_TITLE,
  NO_EXPLICIT_H_REASON,
  NO_IMPLICIT_H_REASON,
  REMOVE_EXPLICIT_H_KEYWORDS,
  REMOVE_EXPLICIT_H_TITLE,
  addExplicitHydrogensToSelection,
  canAddExplicitHydrogens,
  canRemoveExplicitHydrogens,
  removeExplicitHydrogensFromSelection,
} from "./explicit-hydrogens";
import { clearOfDrawingOffset, revealAtoms } from "./insert";
import {
  copyElementalAnalysis,
  copyFigure,
  copyMolblock,
  copyInchi,
  copySmiles,
  exportCdxml,
  exportFigurePdf,
  exportFigurePng,
  exportFigureSvg,
} from "./figure";
import {
  exportCurrent,
  leaveToRecents,
  newSketch,
  openFromDisk,
  saveNow,
} from "./file";
import {
  CLEAR_STEREO_GROUP_KEYWORDS,
  CLEAR_STEREO_GROUP_TITLE,
  NOTHING_TO_CLEAR_REASON,
  NO_STEREOCENTER_REASON,
  STEREO_GROUP_COMMANDS,
  canClearStereoGroup,
  canMarkStereoGroup,
  clearStereoGroup,
  markStereoGroup,
} from "./stereo-groups";
import {
  ANOMERS,
  OPEN_RING_ID,
  OPEN_RING_KEYWORDS,
  OPEN_RING_TITLE,
  SUGAR_RING_FORMS,
  canCyclise,
  canOpenRing,
  cycliseCommandId,
  cycliseDisabledReason,
  cycliseKeywords,
  cycliseSelectedSugar,
  cycliseTitle,
  openRingDisabledReason,
  openSelectedSugarRing,
} from "./sugar";

export type CommandGroup =
  | "file"
  | "tool"
  | "edit"
  | "select"
  | "structure"
  | "view"
  | "bond"
  | "element"
  | "ring"
  | "chain"
  | "group"
  | "figure";

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
  /**
   * Let the BROWSER have this key when the command is disabled.
   *
   * The key layer's default is the opposite and is right almost everywhere: a
   * disabled command still swallows its shortcut, or Mod+Z would type a "z"
   * into nothing once history ran out. Paste is the exception, and it is a
   * real one. `edit.paste` is disabled until something has been copied INSIDE
   * the editor, and swallowing Mod+V in that state also suppresses the
   * browser's own `paste` event — which is the only way a SMILES or a molblock
   * copied out of a paper reaches the canvas at all. There is nothing to
   * swallow the key for: with no internal clipboard the command does nothing,
   * so letting the platform paste is strictly better than nothing happening.
   */
  readonly passThroughWhenDisabled?: boolean;
  /**
   * Why the command is disabled, for a tooltip beside the greyed-out entry.
   * Only consulted while `enabled(state)` is false. A command that is off for
   * a reason the user cannot see from the canvas says so here, rather than
   * looking broken.
   */
  disabledReason?(state: EditorState): string | undefined;
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
  annotationIds: Object.freeze([]),
});

function hasSelection(state: EditorState): boolean {
  return state.selection.atomIds.length > 0 || state.selection.bondIds.length > 0;
}

/**
 * `hasSelection`, plus a selected scheme annotation: what Delete can act on.
 * Only Delete widens so far; copy, cut and select-all stay molecule-only until
 * the arrow tools give an annotation a clipboard form.
 */
function hasDeletableSelection(state: EditorState): boolean {
  return hasSelection(state) || state.selection.annotationIds.length > 0;
}

function selectedBondIds(state: EditorState): readonly string[] {
  return state.selection.bondIds;
}

/**
 * The reasons a greyed-out entry gives, shared so the palette and the context
 * menu say the same thing about the same refusal. Decision 37: a command that
 * is off for a reason the canvas does not make obvious says why rather than
 * looking broken — and "why" is worth a sentence even when it is obvious,
 * because the context menu shows it beside the entry, where a touch user has
 * no tooltip to hover for.
 */
export const REASONS = Object.freeze({
  nothingSelected: "Nothing is selected",
  noAtomSelected: "Select at least one atom first",
  noBondSelected: "Select a bond first",
  emptyDrawing: "Nothing has been drawn yet",
  nothingToUndo: "Nothing to undo",
  nothingToRedo: "Nothing to redo",
  nothingCopied:
    "Nothing has been copied in the editor yet. The paste shortcut still takes a SMILES or molfile copied from another app",
  noCanvasPanel: "The figure has no structural panel for the canvas to draw on",
});

/** `disabledReason` for a command whose only precondition is `enabled`. */
function whenOff(
  enabled: (state: EditorState) => boolean,
  reason: string,
): (state: EditorState) => string | undefined {
  return (state) => (enabled(state) ? undefined : reason);
}

const hasAtoms = (state: EditorState): boolean => state.selection.atomIds.length > 0;
const hasBonds = (state: EditorState): boolean => state.selection.bondIds.length > 0;
const hasDrawing = (state: EditorState): boolean => !isEmpty(state.document.molecule);

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
 * Where a paste or a duplicate lands: beside its source, never on anything
 * (decision 200). `clearOfDrawingOffset` holds the rule, beside the insert's
 * own placement, so all three ways a structure arrives share one gap.
 */
function copyOffset(mol: Molecule, source: Molecule, sourceIds: readonly AtomId[]): Vec2 {
  const bondLength = isEmpty(mol) ? DEFAULT_BOND_LENGTH : documentBondLength(mol);
  const box = bounds(sourceIds.map((id) => source.atoms[id]!.pos));
  return clearOfDrawingOffset(mol, box, bondLength);
}

/**
 * Where a paste lands: centred on the pointer when a mouse or pen is resting
 * over the canvas, which is where a user who points before pressing Mod+V is
 * asking for it (PubChem's sketcher does the same); beside its source
 * otherwise, as `copyOffset` places it. An aimed paste may overlap what is
 * there: the user chose the spot, and the copy arrives selected, so one drag
 * moves it.
 */
function pasteOffset(state: EditorState, fragment: Molecule): Vec2 {
  const mol = state.document.molecule;
  const pointer = canvasPointer();
  if (pointer === null) return copyOffset(mol, fragment, fragment.atomIds);
  const style = buildCanvasScene(state.document, state.ui.activePanelId).style;
  const target = pxToModel(style, toModel(state.viewport, pointer));
  const box = bounds(fragment.atomIds.map((id) => fragment.atoms[id]!.pos));
  return {
    x: target.x - (box.min.x + box.max.x) / 2,
    y: target.y - (box.min.y + box.max.y) / 2,
  };
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

const QUERY_TITLES: Readonly<Record<BondQuery, string>> = {
  any: "any bond",
  "single-or-double": "single or double (S/D)",
  "single-or-aromatic": "single or aromatic (S/A)",
  "double-or-aromatic": "double or aromatic (D/A)",
};

/**
 * Decision 238's query bonds, plus `bond.query.none` to make one an ordinary
 * bond again. They act on the selection only: a query bond is a statement
 * about one bond of a Markush core, never something to draw a run of.
 */
function bondQueryCommands(): Command[] {
  const set = (query: BondQuery | undefined, title: string, id: string): Command => ({
    id: `bond.query.${id}`,
    title: `Query bond: ${title}`,
    keywords: ["bond", "query", "markush", "generic", title],
    group: "bond" as const,
    enabled: (state) => selectedBondIds(state).length > 0,
    disabledReason: whenOff((state) => selectedBondIds(state).length > 0, "Select a bond first"),
    run: (store: EditorStore) => {
      const state = store.getState();
      const bondIds = selectedBondIds(state);
      if (bondIds.length === 0) return;
      state.applyMoleculeEdit(`Set ${title} bond`, (mol) =>
        bondIds.reduce((m, bondId) => guardedOps.setBondQuery(m, bondId, query), mol),
      );
    },
  });
  return [
    ...BOND_QUERY_VALUES.map((query) => set(query, QUERY_TITLES[query], query)),
    set(undefined, "none (ordinary bond)", "none"),
  ];
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

const SIDE_TITLES: Readonly<Record<DoubleBondSide, string>> = {
  auto: "automatic",
  centered: "centred",
  left: "left",
  right: "right",
};

const selectedDoubleBonds = (state: EditorState): readonly string[] => {
  const mol = state.document.molecule;
  return state.selection.bondIds.filter(
    (id) => Object.hasOwn(mol.bonds, id) && mol.bonds[id]!.order === 2,
  );
};

/**
 * Where a double bond's second line goes: ChemDraw's Double ▸ Left / Centre /
 * Right, which a figure needs whenever the automatic side puts the inner line
 * outside a ring or across a label.
 *
 * `left` and `right` are relative to the bond's own from→to direction (see
 * `mirrorDoubleBondSide` in chem-core), which is why the menu pairs these
 * with "Flip direction" rather than calling them page sides.
 *
 * Only DOUBLE bonds in the selection are touched. The field is meaningless on
 * a single or a triple, and writing it there would leave a hidden setting that
 * springs back into effect the moment the bond is retyped.
 */
function bondSideCommands(): Command[] {
  return DOUBLE_BOND_SIDE_VALUES.map((side) => {
    const enabled = (state: EditorState): boolean => selectedDoubleBonds(state).length > 0;
    return {
      id: `bond.side.${side}`,
      title: `Double bond position: ${SIDE_TITLES[side]}`,
      keywords: ["double", "bond", "side", "position", "inner", "line", SIDE_TITLES[side]],
      group: "bond" as const,
      enabled,
      disabledReason: whenOff(enabled, "Select a double bond first"),
      run: (store: EditorStore) => {
        const state = store.getState();
        const bondIds = selectedDoubleBonds(state);
        if (bondIds.length === 0) return;
        state.applyMoleculeEdit(`Set double bond ${SIDE_TITLES[side]}`, (mol) =>
          bondIds.reduce((m, id) => guardedOps.setDoubleBondSide(m, id, side), mol),
        );
      },
    };
  });
}

const selectedBondRecords = (state: EditorState) => {
  const mol = state.document.molecule;
  return state.selection.bondIds.filter((id) => Object.hasOwn(mol.bonds, id)).map((id) => mol.bonds[id]!);
};

/**
 * Bold and dative (decision 226), each a toggle over the selected bonds: on
 * for all of them unless every one already has it, which is how a checked
 * menu row reads.
 *
 * Bold is display only and goes on any bond. Dative goes only on single
 * bonds — chem-core refuses a dative double — and points from each bond's
 * `from` atom; "Flip direction" turns the arrow round.
 */
function bondFlagCommands(): Command[] {
  const anyBond = (state: EditorState): boolean => selectedBondRecords(state).length > 0;
  const singles = (state: EditorState) => selectedBondRecords(state).filter((bond) => bond.order === 1);
  const anySingle = (state: EditorState): boolean => singles(state).length > 0;
  return [
    {
      id: "bond.style.bold",
      title: "Bold bond",
      keywords: ["bond", "bold", "wide", "thick", "haworth", "front", "style"],
      group: "bond" as const,
      enabled: anyBond,
      disabledReason: whenOff(anyBond, REASONS.noBondSelected),
      run: (store: EditorStore) => {
        const state = store.getState();
        const bonds = selectedBondRecords(state);
        if (bonds.length === 0) return;
        const bold = !bonds.every((bond) => bond.bold === true);
        state.applyMoleculeEdit(bold ? "Make bond bold" : "Make bond plain", (mol) =>
          bonds.reduce((m, bond) => guardedOps.setBondBold(m, bond.id, bold), mol),
        );
      },
    },
    {
      id: "bond.dative",
      title: "Dative bond (→)",
      keywords: ["bond", "dative", "coordinate", "coordination", "arrow", "donor", "acceptor", "ligand"],
      group: "bond" as const,
      enabled: anySingle,
      disabledReason: whenOff(anySingle, "Select a single bond first"),
      run: (store: EditorStore) => {
        const state = store.getState();
        const bonds = singles(state);
        if (bonds.length === 0) return;
        const dative = !bonds.every((bond) => bond.dative === true);
        state.applyMoleculeEdit(dative ? "Make bond dative" : "Make bond covalent", (mol) =>
          bonds.reduce((m, bond) => guardedOps.setBondDative(m, bond.id, dative), mol),
        );
      },
    },
  ];
}

/**
 * Fuse a template ring onto the ONE selected bond — the ring tool's
 * click-a-bond gesture, reachable without changing tools.
 *
 * Exactly one bond, because a fusion is placed across a single bond's
 * perpendicular bisector and there is no reading of "fuse a benzene onto
 * these four bonds" that is not four separate edits. The refusals are the
 * ring tool's own, through `ringFuseRefusal`, so both surfaces decline the
 * same bonds in the same words.
 */
function ringFuseCommands(): Command[] {
  return (Object.keys(RING_TEMPLATES) as RingTemplateName[]).map((name) => {
    const reason = (state: EditorState): string | undefined => {
      const bondIds = state.selection.bondIds;
      if (bondIds.length !== 1) return "Select exactly one bond to fuse a ring onto";
      const mol = state.document.molecule;
      if (!Object.hasOwn(mol.bonds, bondIds[0]!)) return REASONS.noBondSelected;
      return ringFuseRefusal(mol, bondIds[0]!);
    };
    return {
      id: `ring.fuse.${name}`,
      title: `Fuse ${name} onto bond`,
      keywords: ["fuse", "ring", "annulate", "template", name],
      group: "ring" as const,
      enabled: (state: EditorState) => reason(state) === undefined,
      disabledReason: reason,
      run: (store: EditorStore) => {
        const state = store.getState();
        if (reason(state) !== undefined) return;
        const bondId = state.selection.bondIds[0]!;
        state.applyMoleculeEdit(`Fuse ${name}`, (mol) =>
          guardedOps.fuseRingOnBond(mol, bondId, RING_TEMPLATES[name], {
            bondLength: documentBondLength(mol),
          }).molecule,
        );
      },
    };
  });
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
      // "arene" or "aromatic", and only benzene answers all three. An odd
      // Kekule ring is a diene, not an arene (decision 231).
      ...(RING_TEMPLATES[name].kekule
        ? RING_TEMPLATES[name].size % 2 === 0
          ? ["arene", "aromatic", "phenyl"]
          : ["diene", "cp"]
        : []),
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

/**
 * One command per functional group, so the palette finds "Boc" or "nitrile"
 * and the rail's group popover dispatches through the registry like its
 * siblings. Picking one arms the group tool as well, the way picking a ring
 * template arms the ring tool.
 */
function functionalGroupCommands(): Command[] {
  return FUNCTIONAL_GROUP_NAMES.map((name) => {
    const group = FUNCTIONAL_GROUPS[name];
    return {
      id: `group.${name}`,
      title: `Functional group: ${group.label} (${group.title.toLowerCase()})`,
      keywords: ["group", "functional group", "substituent", name, group.title, ...group.keywords],
      group: "group" as const,
      enabled: always,
      run: (store: EditorStore) => {
        const state = store.getState();
        state.setToolOption("functionalGroup", name);
        state.setTool("group");
      },
    };
  });
}

/**
 * One command per element chem-core knows — all 118, not only the organic set
 * the quick picker shows.
 *
 * The full periodic table dispatches these, exactly as the quick picker's grid
 * does, so a cell is a command like every other entry on the rail. They are
 * also what makes the tool-letter casualties in tools.ts reachable from the
 * keyboard: vanadium's `v` is the select tool, but "vanadium" typed into the
 * palette finds `element.V`. The NAME is a keyword for exactly that reason;
 * nobody searches for a metal by its symbol when its symbol is a tool letter.
 */
function elementCommands(): Command[] {
  return [
    ...ELEMENTS.map(({ symbol, name }) => ({
      id: `element.${symbol}`,
      title: `Element: ${symbol}`,
      keywords: ["element", "atom", symbol, name],
      group: "element" as const,
      enabled: always,
      run: (store: EditorStore) => {
        applyElement(store, symbol);
      },
    })),
    // Decision 238's "R" entry. Not an element, so not in ELEMENTS; `R` is
    // free as an id because no element symbol is a bare R.
    {
      id: `element.${RGROUP_ENTRY}`,
      title: "R-group (numbered R1, R2…)",
      keywords: ["r-group", "rgroup", "markush", "substituent", "placeholder", "generic", RGROUP_ENTRY],
      group: "element" as const,
      enabled: always,
      run: (store: EditorStore) => {
        applyElement(store, RGROUP_ENTRY);
      },
    },
  ];
}

/**
 * The quick picker's "Show all" entry, and the palette's way to the same
 * table. A command rather than a local `useState` in the rail so the table is
 * reachable without the pointer, and so the popover that launches it can close
 * without taking the dialog with it.
 */
const ELEMENT_TABLE_COMMAND: Command = {
  id: "element.table",
  title: "Show all elements…",
  keywords: ["periodic table", "element", "atom", "metal", "show all", "more"],
  group: "element",
  enabled: always,
  run: (store) => {
    store.getState().setPeriodicTableOpen(true);
  },
};

/**
 * One toggle per display flag, all of them saved.
 *
 * Every flag chem-render honours is stored on the panel since decision 10, so
 * there is no longer a class of switch the user can set and not keep. The
 * table is written out rather than generated from `DISPLAY_FLAG_KEYS` because
 * a command needs a human title, a set of palette keywords and sometimes a
 * shortcut, and none of those can be derived from a key name — but the
 * `satisfies` below makes a flag with no command a compile error, so the two
 * cannot fall out of step.
 */
const DISPLAY_FLAG_LABELS = {
  aromaticCircles: {
    title: "Toggle aromatic circles",
    keywords: ["aromatic", "circle", "benzene", "ring", "display"],
    shortcut: "Mod+Shift+o",
  },
  showCarbonLabels: {
    title: "Toggle carbon labels",
    keywords: ["carbon", "label", "vertex", "skeletal", "display"],
  },
  showImplicitHydrogens: {
    title: "Toggle explicit hydrogens",
    keywords: ["hydrogen", "explicit", "implicit", "H", "display"],
  },
  showLonePairs: {
    title: "Toggle lone pairs",
    keywords: ["lone", "pair", "electron", "lewis", "dot", "display"],
  },
  showCharges: {
    title: "Toggle formal charges",
    keywords: ["charge", "formal", "cation", "anion", "display"],
  },
  showStereoBonds: {
    title: "Toggle wedge and hash bonds",
    keywords: ["wedge", "hash", "stereo", "bond", "display"],
  },
  // Chemical locants only (decision 18): with no numbering for an atom it
  // draws nothing, and it never shows an atom's id or position. Over a
  // document that numbers nothing — no sugar, no alpha-amino acid, no locant
  // typed — the toggle would be a switch that does nothing, so it is listed,
  // disabled and says why (decision 37), and it is live as soon as ANY atom
  // has a locant (decision 168). Whatever the document, it stays live while
  // the flag is on (decision 56): a document can carry showLocants: true
  // after its numbered atoms are deleted, and it must not be stuck with a
  // flag no control can clear.
  showLocants: {
    title: "Toggle locants",
    keywords: ["locant", "numbering", "number", "display"],
    needs: {
      met: documentNumbersAtoms,
      reason: "No atom here is numbered: numbering covers sugars and alpha-amino acids",
    },
  },
  showStereoDescriptors: {
    title: "Toggle R/S and E/Z descriptors",
    keywords: ["descriptor", "stereo", "cip", "R", "S", "E", "Z", "display"],
  },
} as const satisfies Record<
  DisplayFlagKey,
  {
    readonly title: string;
    readonly keywords: readonly string[];
    readonly shortcut?: string;
    /**
     * Set: the command can switch the flag ON only over a document for which
     * `met` holds, and is otherwise disabled with `reason` while the flag is
     * off. While the flag is on it stays enabled, so it can always be
     * switched off (decision 56).
     */
    readonly needs?: {
      readonly met: (doc: SketchDocument) => boolean;
      readonly reason: string;
    };
  }
>;

/**
 * The command id that toggles `key`: `showLocants` → `view.show-locants`.
 *
 * Kebab-cased from the flag key, so the id is derived from the thing it
 * toggles rather than invented alongside it. Exported so the representation
 * switcher's checkboxes resolve the SAME command as the palette, and with it
 * the same enabled state and the same disabled reason (decision 37).
 */
export function displayFlagCommandId(key: DisplayFlagKey): string {
  return `view.${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

const DISPLAY_FLAG_COMMANDS: readonly Command[] = DISPLAY_FLAG_KEYS.map((key) => {
  const label = DISPLAY_FLAG_LABELS[key];
  const command: { -readonly [K in keyof Command]: Command[K] } = {
    id: displayFlagCommandId(key),
    title: label.title,
    keywords: [...label.keywords],
    group: "view",
    enabled: (state) => canvasPanelFor(state.document, state.ui.activePanelId) !== undefined,
    disabledReason: (state) =>
      canvasPanelFor(state.document, state.ui.activePanelId) === undefined
        ? REASONS.noCanvasPanel
        : undefined,
    run: (store) => {
      const state = store.getState();
      // The panel the CANVAS draws, resolved the same way the canvas resolves
      // it — including the switcher's active panel. Hardcoding
      // "panel-skeletal" would silently target nothing in a document whose
      // panels were reordered, and ignoring the active panel would toggle a
      // flag on a panel that is not on screen.
      const panel = canvasPanelFor(state.document, state.ui.activePanelId);
      if (panel === undefined) return;
      state.updatePanel(panel.id, {
        display: { [key]: !panel.representation.display[key] },
      });
    },
  };
  if ("shortcut" in label) command.shortcut = label.shortcut;
  if ("needs" in label) {
    const { met, reason } = label.needs;
    const panelOf = (state: EditorState) => canvasPanelFor(state.document, state.ui.activePanelId);
    // The flag first: it is a field read, and while it is on the answer is
    // yes whatever the document numbers.
    const enabled = (state: EditorState): boolean => {
      const panel = panelOf(state);
      if (panel === undefined) return false;
      return panel.representation.display[key] || met(state.document);
    };
    command.enabled = enabled;
    command.disabledReason = (state) =>
      panelOf(state) === undefined ? REASONS.noCanvasPanel : enabled(state) ? undefined : reason;
    const toggle = command.run;
    // `enabled` already says so, but a shortcut or a caller that skips the
    // check must not be able to switch on what nothing can draw.
    command.run = (store) => {
      if (enabled(store.getState())) toggle(store);
    };
  }
  return command;
});

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
  // Every route to an element — table, palette, typed symbol, the canvas
  // context menu — passes here, so this is the one place the recent rows
  // (the quick picker's and the context menu's) can learn of it.
  state.noteRecentElement(element);
  const atomIds = state.selection.atomIds;
  if (atomIds.length === 0) {
    state.setTool("element");
    return;
  }
  if (isRGroupEntry(element)) {
    // Decision 238: each selected atom becomes the next R-group, numbered in
    // selection order by chem-core.
    state.applyMoleculeEdit("Make R-group", (mol) =>
      atomIds.reduce((m, id) => guardedOps.makeRGroup(m, id), mol),
    );
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
    disabledReason: whenOff((state) => state.canUndo(), REASONS.nothingToUndo),
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
    disabledReason: whenOff((state) => state.canRedo(), REASONS.nothingToRedo),
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
    enabled: hasDeletableSelection,
    disabledReason: whenOff(hasDeletableSelection, REASONS.nothingSelected),
    run: (store) => {
      const state = store.getState();
      const { atomIds, bondIds, annotationIds } = state.selection;
      if (atomIds.length === 0 && bondIds.length === 0 && annotationIds.length === 0) return;
      state.transact("Delete selection", () => {
        // A selected arrow goes in the same entry as the atoms: one undo
        // brings the whole selection back.
        if (annotationIds.length > 0) {
          state.removeSchemeAnnotations("Delete selection", annotationIds);
        }
        // Bonds first: removing an atom takes its bonds with it, so a bond id
        // gathered before the atom removal may already be gone by the time it
        // is reached. `removeBonds` ignores ids it does not have, but doing
        // the narrower edit first keeps the intent legible in the diff.
        if (atomIds.length > 0 || bondIds.length > 0) {
          state.applyMoleculeEdit("Delete selection", (mol) =>
            guardedOps.removeAtoms(guardedOps.removeBonds(mol, bondIds), atomIds),
          );
        }
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
    enabled: hasDeletableSelection,
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
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
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
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
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
    // See `passThroughWhenDisabled`: with nothing on the internal clipboard,
    // Mod+V has to reach the browser so the window `paste` listener can read
    // a structure someone copied out of a paper.
    passThroughWhenDisabled: true,
    enabled: () => clipboard !== null && clipboard.atomIds.length > 0,
    disabledReason: () =>
      clipboard !== null && clipboard.atomIds.length > 0 ? undefined : REASONS.nothingCopied,
    run: (store) => {
      const fragment = clipboard;
      if (fragment === null || fragment.atomIds.length === 0) return;
      const state = store.getState();
      const offset = pasteOffset(state, fragment);
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
          annotationIds: [],
        });
      });
      revealAtoms(store, inserted.atomIds);
    },
  },
  {
    id: "edit.duplicate",
    title: "Duplicate",
    keywords: ["duplicate", "copy", "clone"],
    shortcut: "Mod+d",
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => {
      const state = store.getState();
      const ids = state.selection.atomIds;
      if (ids.length === 0) return;
      const mol = state.document.molecule;
      const copy = guardedOps.duplicateFragment(mol, ids, {
        offset: copyOffset(mol, mol, ids.filter((id) => Object.hasOwn(mol.atoms, id))),
      });
      state.transact("Duplicate", () => {
        state.applyMoleculeEdit("Duplicate", () => copy.molecule);
        // Onto the COPIES, so the next drag moves what was just made rather
        // than the original. `duplicateFragment` keys its map by SOURCE id
        // precisely so this is possible.
        state.setSelection({ atomIds: copy.atomIds, bondIds: copy.bondIds, annotationIds: [] });
      });
      revealAtoms(store, copy.atomIds);
    },
  },
  // The selection as text another program can read. The whole-structure pair
  // lives under Figure; these cut the selected atoms out first, so a chemist
  // can lift one reactant out of a scheme without deleting the rest.
  {
    id: "edit.copy-selection-smiles",
    title: "Copy selection as SMILES",
    keywords: ["copy", "clipboard", "smiles", "selection", "fragment", "text"],
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => copySmiles(store, "selection"),
  },
  {
    id: "edit.copy-selection-inchi",
    title: "Copy selection as InChI",
    keywords: ["copy", "clipboard", "inchi", "identifier", "selection", "fragment", "text"],
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => copyInchi(store, "selection", "inchi"),
  },
  {
    id: "edit.copy-selection-inchikey",
    title: "Copy selection as InChIKey",
    keywords: ["copy", "clipboard", "inchikey", "inchi", "key", "selection", "fragment"],
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => copyInchi(store, "selection", "inchikey"),
  },
  {
    id: "edit.copy-selection-molfile",
    title: "Copy selection as molfile",
    keywords: ["copy", "clipboard", "molfile", "molblock", "mol", "selection", "fragment"],
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => copyMolblock(store, "selection"),
  },
  {
    id: "edit.copy-selection-elemental-analysis",
    title: "Copy selection's elemental analysis",
    keywords: ["copy", "clipboard", "elemental", "analysis", "anal", "calcd", "chn", "chns", "combustion", "percent", "selection"],
    group: "edit",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => copyElementalAnalysis(store, "selection"),
  },
];

const SELECT_COMMANDS: readonly Command[] = [
  {
    id: "select.all",
    title: "Select all",
    keywords: ["select", "all", "everything"],
    shortcut: "Mod+a",
    group: "select",
    enabled: hasDrawing,
    disabledReason: whenOff(hasDrawing, REASONS.emptyDrawing),
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
    disabledReason: whenOff(hasSelection, REASONS.nothingSelected),
    run: (store) => {
      store.getState().clearSelection();
    },
  },
  {
    id: "select.connected",
    title: "Select connected structure",
    keywords: ["select", "fragment", "connected", "molecule", "whole", "structure"],
    group: "select",
    // "Group" in ChemDraw's sense has no counterpart here: the document is one
    // graph, and a connected structure is already the unit a drag moves. This
    // is the handle on that unit — the whole molecule an atom belongs to.
    enabled: hasSelection,
    disabledReason: whenOff(hasSelection, REASONS.nothingSelected),
    run: (store) => {
      const state = store.getState();
      const mol = state.document.molecule;
      const grown = movingAtomIds(mol, state.selection).reduce(
        (acc, id) => unionSelections(acc, selectFragment(mol, id)),
        coreSelection(state.selection.atomIds, state.selection.bondIds),
      );
      // Any selected annotations stay selected: growing the molecule part
      // says nothing about the arrows beside it.
      state.setSelection({
        atomIds: grown.atomIds,
        bondIds: grown.bondIds,
        annotationIds: state.selection.annotationIds,
      });
    },
  },
  {
    id: "select.invert",
    title: "Invert selection",
    keywords: ["select", "invert", "inverse", "others", "rest"],
    group: "select",
    enabled: hasDrawing,
    disabledReason: whenOff(hasDrawing, REASONS.emptyDrawing),
    run: (store) => {
      const state = store.getState();
      const inverted = invertSelection(
        state.document.molecule,
        coreSelection(state.selection.atomIds, state.selection.bondIds),
      );
      // The molecule only, like `selectAll`: no command acts on an annotation
      // yet, so inverting into one would select something nothing can use.
      state.setSelection({
        atomIds: inverted.atomIds,
        bondIds: inverted.bondIds,
        annotationIds: [],
      });
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
    enabled: hasDrawing,
    disabledReason: whenOff(hasDrawing, REASONS.emptyDrawing),
    run: (store) => cleanUpStructure(store),
  },
  {
    id: "structure.insert",
    title: "Insert a structure by name, formula, SMILES or molfile…",
    keywords: [
      "insert",
      "add",
      "molecule",
      "compound",
      "name",
      "smiles",
      "molfile",
      "formula",
      "glucose",
      "caffeine",
      "amino acid",
      "sugar",
      "solvent",
    ],
    group: "structure",
    // Always: inserting into an empty sketch is the commonest way to start one.
    enabled: always,
    run: (store) => {
      store.getState().setInsertDialogOpen(true);
    },
  },
  {
    id: "structure.charge-up",
    title: "Increase charge",
    keywords: ["charge", "cation", "plus", "positive"],
    shortcut: "+",
    group: "structure",
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
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
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
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
    enabled: hasAtoms,
    disabledReason: whenOff(hasAtoms, REASONS.noAtomSelected),
    run: (store) => {
      changeCharge(store, -1);
    },
  },
  {
    id: "structure.cycle-bond-order",
    title: "Cycle bond order",
    keywords: ["bond", "order", "cycle", "single", "double", "triple"],
    group: "structure",
    enabled: hasBonds,
    disabledReason: whenOff(hasBonds, REASONS.noBondSelected),
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
    enabled: hasBonds,
    disabledReason: whenOff(hasBonds, REASONS.noBondSelected),
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
  // Drawing or folding the selection's hydrogens. Palette and context menu
  // only, for decision 89's reason: a free letter is worth more to a tool.
  // The behaviour and its messages live in `./explicit-hydrogens`.
  {
    id: "structure.add-explicit-hydrogens",
    title: ADD_EXPLICIT_H_TITLE,
    keywords: [...ADD_EXPLICIT_H_KEYWORDS],
    group: "structure",
    enabled: canAddExplicitHydrogens,
    disabledReason: (state) =>
      !hasAtoms(state)
        ? REASONS.noAtomSelected
        : canAddExplicitHydrogens(state)
          ? undefined
          : NO_IMPLICIT_H_REASON,
    run: (store) => {
      addExplicitHydrogensToSelection(store);
    },
  },
  {
    id: "structure.remove-explicit-hydrogens",
    title: REMOVE_EXPLICIT_H_TITLE,
    keywords: [...REMOVE_EXPLICIT_H_KEYWORDS],
    group: "structure",
    enabled: canRemoveExplicitHydrogens,
    disabledReason: (state) =>
      !hasAtoms(state)
        ? REASONS.noAtomSelected
        : canRemoveExplicitHydrogens(state)
          ? undefined
          : NO_EXPLICIT_H_REASON,
    run: (store) => {
      removeExplicitHydrogensFromSelection(store);
    },
  },
  // Enhanced stereochemistry, decision 89: one minimal set, three marks and a
  // clear. Palette-only on purpose — every free letter is worth more to a tool
  // or an element than to a command a figure needs once, and a shortcut here
  // would have to be taken from one of them.
  //
  // Generated from `STEREO_GROUP_KIND_VALUES`, the shared package's one list of
  // the kinds, so a fourth kind cannot arrive with no way to create it. The
  // titles and keywords come from the table in `./stereo-groups`, which is
  // `Record`-total over the same union.
  ...STEREO_GROUP_KIND_VALUES.map(
    (kind): Command => ({
      id: `structure.stereo-group-${kind}`,
      title: STEREO_GROUP_COMMANDS[kind].title,
      keywords: [...STEREO_GROUP_COMMANDS[kind].keywords],
      group: "structure",
      enabled: canMarkStereoGroup,
      // Decision 37: "this atom is a stereocentre" is a perception, not
      // something the canvas draws, so a greyed-out row has to say why.
      disabledReason: (state) =>
        canMarkStereoGroup(state) ? undefined : NO_STEREOCENTER_REASON,
      run: (store) => {
        markStereoGroup(store, kind);
      },
    }),
  ),
  // Contracted abbreviations, decision 225. Palette and context menu only,
  // for decision 89's reason: no free letter is worth spending on them.
  {
    id: "structure.collapse-abbreviation",
    title: COLLAPSE_ABBREVIATION_TITLE,
    keywords: [...COLLAPSE_ABBREVIATION_KEYWORDS],
    group: "structure",
    enabled: canCollapse,
    disabledReason: collapseDisabledReason,
    run: (store) => {
      collapseSelection(store);
    },
  },
  {
    id: "structure.expand-abbreviation",
    title: EXPAND_ABBREVIATION_TITLE,
    keywords: [...EXPAND_ABBREVIATION_KEYWORDS],
    group: "structure",
    enabled: canExpand,
    disabledReason: (state) => (canExpand(state) ? undefined : NOTHING_TO_EXPAND_REASON),
    run: (store) => {
      expandSelection(store);
    },
  },
  {
    id: "structure.stereo-group-clear",
    title: CLEAR_STEREO_GROUP_TITLE,
    keywords: [...CLEAR_STEREO_GROUP_KEYWORDS],
    group: "structure",
    // Wider than the three above: a group imported onto atoms this build does
    // not perceive as stereogenic must still be removable. See the module
    // header in `./stereo-groups`.
    enabled: canClearStereoGroup,
    disabledReason: (state) =>
      canClearStereoGroup(state) ? undefined : NOTHING_TO_CLEAR_REASON,
    run: (store) => {
      clearStereoGroup(store);
    },
  },
  // The ring-chain edit, decision 169: one row per ring form and anomer, since
  // chem-core requires the anomer (decision 143) and a row is how it is stated
  // without a default, plus the inverse. Palette-only for decision 89's reason.
  // Generated from the two lists in `./sugar`, whose word tables are
  // `Record`-total over the same unions.
  ...SUGAR_RING_FORMS.flatMap((form) =>
    ANOMERS.map(
      (anomer): Command => ({
        id: cycliseCommandId(form, anomer),
        title: cycliseTitle(form, anomer),
        keywords: [...cycliseKeywords(form, anomer)],
        group: "structure",
        enabled: (state) => canCyclise(state, form),
        disabledReason: (state) => cycliseDisabledReason(state, form),
        run: (store) => {
          cycliseSelectedSugar(store, form, anomer);
        },
      }),
    ),
  ),
  {
    id: OPEN_RING_ID,
    title: OPEN_RING_TITLE,
    keywords: [...OPEN_RING_KEYWORDS],
    group: "structure",
    enabled: canOpenRing,
    disabledReason: openRingDisabledReason,
    run: (store) => {
      openSelectedSugarRing(store);
    },
  },
];

/**
 * One keyboard or button zoom step: two presses double the scale.
 *
 * Coarser than a wheel notch (x1.22) because a key press is a deliberate,
 * countable act — nobody wants to press Mod+= seven times to get to 400% —
 * and finer than Figma's x2, which jumps past the scale a crowded ring needed.
 */
export const KEY_ZOOM_STEP = Math.SQRT2;

/**
 * Zoom about the centre of the canvas. A key press has no cursor to anchor
 * on, and the centre is where `pan` already points, so nothing slides.
 */
function zoomAboutCentre(store: EditorStore, factor: number): void {
  const state = store.getState();
  const { width, height } = state.viewport.size;
  state.zoomAt({ x: width / 2, y: height / 2 }, factor);
}

const canZoomIn = (state: EditorState): boolean => state.viewport.zoom < MAX_ZOOM;
const canZoomOut = (state: EditorState): boolean => state.viewport.zoom > MIN_ZOOM;

// ---------------------------------------------------------------------------
// Arranging the selection: flip, rotate, align
//
// Layout commands. None of them changes what the drawing says — flipAtoms
// swaps wedge and hash along with the positions precisely so the enantiomer
// is preserved (see transform.ts) — so a figure can be re-posed to read left
// to right without a stereocentre silently inverting.
// ---------------------------------------------------------------------------

/** What an arrangement moves: exactly what a drag over the selection would. */
function arrangedAtomIds(state: EditorState): readonly AtomId[] {
  return movingAtomIds(state.document.molecule, state.selection);
}

/** One atom has no shape to flip or turn about its own centroid. */
const canArrange = (state: EditorState): boolean => arrangedAtomIds(state).length >= 2;
const ARRANGE_REASON = "Select at least two atoms to move";

function arrangeCommand(
  id: string,
  title: string,
  keywords: readonly string[],
  edit: (mol: Molecule, ids: readonly AtomId[], pivot: Vec2) => Molecule,
): Command {
  return {
    id,
    title,
    keywords,
    group: "structure",
    enabled: canArrange,
    disabledReason: whenOff(canArrange, ARRANGE_REASON),
    run: (store) => {
      const state = store.getState();
      const ids = arrangedAtomIds(state);
      if (ids.length < 2) return;
      // About the selection's own centroid, so the structure turns in place
      // rather than swinging round the page origin.
      state.applyMoleculeEdit(title, (mol) => edit(mol, ids, atomsCentroid(mol, ids)));
    },
  };
}

/**
 * How many separate structures `ids` touch, counting no further than `stop`.
 * Stopping early keeps the enabled check cheap on a large drawing: the
 * answer the commands need is only "fewer than two or not".
 */
function structuresTouched(mol: Molecule, ids: readonly AtomId[], stop: number): number {
  const seen = new Set<AtomId>();
  let count = 0;
  for (const id of ids) {
    if (seen.has(id) || !Object.hasOwn(mol.atoms, id)) continue;
    count += 1;
    if (count >= stop) return count;
    for (const member of reachableFrom(mol, id)) seen.add(member);
  }
  return count;
}

const canAlign = (state: EditorState): boolean =>
  structuresTouched(state.document.molecule, arrangedAtomIds(state), 2) >= 2;

const ALIGN_TITLES: Readonly<Record<AlignEdge, string>> = {
  left: "Align left edges",
  centre: "Align centres",
  right: "Align right edges",
  top: "Align tops",
  middle: "Align middles",
  bottom: "Align bottoms",
};

/** The selected atoms carrying a wedge or hash of their own to invert. */
function invertibleCentres(state: EditorState): readonly AtomId[] {
  const mol = state.document.molecule;
  // `invertStereocentre` returns its input when there is nothing to invert,
  // so asking it IS the precondition — no second definition of "has a mark
  // of its own" to drift from the op's.
  return state.selection.atomIds.filter(
    (id) => Object.hasOwn(mol.atoms, id) && invertStereocentre(mol, id) !== mol,
  );
}

const ARRANGE_COMMANDS: readonly Command[] = [
  arrangeCommand(
    "structure.flip-horizontal",
    "Flip horizontally",
    ["flip", "mirror", "horizontal", "left", "right", "reflect"],
    (mol, ids, pivot) => guardedOps.flipAtoms(mol, ids, verticalMirror(pivot)),
  ),
  arrangeCommand(
    "structure.flip-vertical",
    "Flip vertically",
    ["flip", "mirror", "vertical", "up", "down", "reflect"],
    (mol, ids, pivot) => guardedOps.flipAtoms(mol, ids, horizontalMirror(pivot)),
  ),
  // Model space is y-up, so a POSITIVE angle turns counter-clockwise on the
  // page and clockwise is the negative one.
  arrangeCommand(
    "structure.rotate-cw",
    "Rotate 90° clockwise",
    ["rotate", "turn", "clockwise", "90"],
    (mol, ids, pivot) => guardedOps.rotateAtoms(mol, ids, pivot, -90 * DEG),
  ),
  arrangeCommand(
    "structure.rotate-ccw",
    "Rotate 90° counter-clockwise",
    ["rotate", "turn", "counterclockwise", "anticlockwise", "90"],
    (mol, ids, pivot) => guardedOps.rotateAtoms(mol, ids, pivot, 90 * DEG),
  ),
  arrangeCommand(
    "structure.rotate-180",
    "Rotate 180°",
    ["rotate", "turn", "180", "upside"],
    (mol, ids, pivot) => guardedOps.rotateAtoms(mol, ids, pivot, 180 * DEG),
  ),
  ...ALIGN_EDGES.map(
    (edge): Command => ({
      id: `structure.align-${edge}`,
      title: ALIGN_TITLES[edge],
      keywords: ["align", "arrange", "line", "up", "scheme", edge],
      group: "structure",
      enabled: canAlign,
      disabledReason: whenOff(canAlign, "Select atoms in two or more separate structures"),
      run: (store) => {
        const state = store.getState();
        if (!canAlign(state)) return;
        const ids = arrangedAtomIds(state);
        state.applyMoleculeEdit(ALIGN_TITLES[edge], (mol) =>
          guardedOps.alignFragments(mol, ids, edge),
        );
      },
    }),
  ),
  {
    id: "structure.invert-stereo",
    title: "Invert stereocentre (R ⇄ S)",
    keywords: ["invert", "configuration", "R", "S", "enantiomer", "epimer", "stereo", "wedge", "hash"],
    group: "structure",
    enabled: (state) => invertibleCentres(state).length > 0,
    disabledReason: (state) =>
      invertibleCentres(state).length > 0
        ? undefined
        : "Select a stereocentre drawn with its own wedge or hash bond",
    run: (store) => {
      const state = store.getState();
      const ids = invertibleCentres(state);
      if (ids.length === 0) return;
      state.applyMoleculeEdit("Invert stereocentre", (mol) =>
        ids.reduce((m, id) => guardedOps.invertStereocentre(m, id), mol),
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Per-atom values the context menu sets
//
// Functions rather than commands, for the reason `applyElement` is one: the
// value is a parameter (which isotope, how many hydrogens), and a command per
// value would put a dozen rows into the palette for settings the properties
// panel already takes as a number. Each writes to every selected atom, as one
// undo step, and does nothing with no atom selected.
// ---------------------------------------------------------------------------

function applyToSelectedAtoms(
  store: EditorStore,
  label: string,
  edit: (mol: Molecule, id: AtomId) => Molecule,
): void {
  const state = store.getState();
  const ids = state.selection.atomIds;
  if (ids.length === 0) return;
  state.applyMoleculeEdit(label, (mol) => ids.reduce(edit, mol));
}

/** `undefined` returns the atoms to natural isotopic abundance. */
export function applyIsotope(store: EditorStore, mass: number | undefined): void {
  applyToSelectedAtoms(store, "Set isotope", (m, id) => guardedOps.setIsotope(m, id, mass));
}

/** `undefined` hands the count back to valence to derive. */
export function applyHydrogenCount(store: EditorStore, count: number | undefined): void {
  applyToSelectedAtoms(store, "Set hydrogen count", (m, id) =>
    guardedOps.setExplicitHydrogenCount(m, id, count),
  );
}

/** `undefined` hands the count back to `lonePairCount` to derive (decision 4). */
export function applyLonePairs(store: EditorStore, pairs: number | undefined): void {
  applyToSelectedAtoms(store, "Set lone pairs", (m, id) => guardedOps.setLonePairs(m, id, pairs));
}

const VIEW_COMMANDS: readonly Command[] = [
  // Mod+= and Mod+- are the browser's page zoom, and are claimed here the way
  // Figma, tldraw and Excalidraw claim them: page zoom rescales the tool rail
  // and panels along with the drawing, and is never what someone looking at a
  // structure means.
  {
    id: "view.zoom-in",
    title: "Zoom in",
    keywords: ["zoom", "in", "magnify", "enlarge", "bigger"],
    shortcut: "Mod+=",
    group: "view",
    enabled: canZoomIn,
    run: (store) => {
      zoomAboutCentre(store, KEY_ZOOM_STEP);
    },
  },
  {
    // Where + is shift-= (US, UK) the event's key is "+", and where + has a
    // key of its own (German, Nordic) it is "+" with no shift at all.
    id: "view.zoom-in-plus",
    title: "Zoom in",
    keywords: ["zoom", "in"],
    shortcut: "Mod++",
    group: "view",
    hidden: true,
    enabled: canZoomIn,
    run: (store) => {
      zoomAboutCentre(store, KEY_ZOOM_STEP);
    },
  },
  {
    id: "view.zoom-out",
    title: "Zoom out",
    keywords: ["zoom", "out", "shrink", "smaller"],
    shortcut: "Mod+-",
    group: "view",
    enabled: canZoomOut,
    run: (store) => {
      zoomAboutCentre(store, 1 / KEY_ZOOM_STEP);
    },
  },
  {
    id: "view.reset",
    title: "Reset view",
    keywords: ["view", "reset", "zoom", "centre", "center"],
    shortcut: "Mod+0",
    group: "view",
    enabled: always,
    run: (store) => {
      // 100% as the status bar reads it, which is a reference bond on screen
      // in every style (decision 107). The viewport's own zoom 1 would be
      // Screen's 100% but only 55% at Publication.
      const state = store.getState();
      state.resetViewport(referenceZoom(renderStyleFor(state.document)));
    },
  },
  {
    id: "view.fit",
    title: "Fit to view",
    keywords: ["fit", "zoom", "view", "all", "frame"],
    shortcut: "Mod+Shift+f",
    group: "view",
    enabled: hasDrawing,
    disabledReason: whenOff(hasDrawing, REASONS.emptyDrawing),
    run: (store) => {
      const state = store.getState();
      // The scene is built ON DEMAND rather than memoised on the document:
      // the canvas commits on every pointer-move frame of a drag, and a memo
      // keyed on the document would rebuild a scene per frame for a command
      // nobody is running. `buildDocumentScene` costs 0.037 ms on a 300-atom
      // structure, so paying it on the keystroke is free.
      state.zoomToFit(
        fitBounds(buildCanvasScene(state.document, state.ui.activePanelId)),
        0,
      );
    },
  },
  {
    id: "view.3d",
    title: "Show or hide the 3D view",
    keywords: ["3d", "three", "conformer", "ball", "stick", "space", "fill", "cpk", "mmff", "geometry", "rotate"],
    group: "view",
    enabled: always,
    run: (store) => {
      const state = store.getState();
      state.setThreeDViewOpen(!state.ui.threeDViewOpen);
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
  ...DISPLAY_FLAG_COMMANDS,
  // The document's style preset, which the canvas draws with and a
  // canvas-style export follows (decisions 21 and 50). Through `setStylePreset`, so a switch is one undo step and
  // is saved with the document. Disabled for the preset already in use, so
  // the palette shows which one that is.
  ...STYLE_PRESETS.map(
    (preset): Command => ({
      id: `view.style-${preset}`,
      title: `Use ${STYLE_PRESET_IN_SENTENCE[preset]} style`,
      keywords: ["style", "preset", preset, "line", "weight", "figure"],
      group: "view",
      enabled: (state) => state.document.stylePreset !== preset,
      run: (store) => {
        const state = store.getState();
        if (state.document.stylePreset === preset) return;
        state.setStylePreset(preset);
        state.setStatusMessage(`Switched to the ${STYLE_PRESET_IN_SENTENCE[preset]} style`);
      },
    }),
  ),
  {
    // Decision 237: drops the current preset's figure-style edits, one undo
    // step. The style panel's "Reset to preset" button runs this.
    id: "view.style-reset",
    title: "Reset style to preset",
    keywords: ["style", "preset", "reset", "default", "figure", "line", "font"],
    group: "view",
    enabled: (state) => state.document.styleOverrides?.[state.document.stylePreset] !== undefined,
    run: (store) => {
      const state = store.getState();
      const preset = state.document.stylePreset;
      if (state.document.styleOverrides?.[preset] === undefined) return;
      state.setStyleOverrides(null);
      state.setStatusMessage(`Reset to the ${STYLE_PRESET_IN_SENTENCE[preset]} style`);
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

// ---------------------------------------------------------------------------
// File
//
// The behaviour lives in `./file.ts`, which is async and touches storage and
// the file system; this file stays importable by a plain-node test.
//
// SHORTCUTS ARE ONLY CLAIMED WHERE THE BROWSER WILL GIVE THEM UP. Mod+S and
// Mod+O are preventable in every engine. Mod+N is NOT — Chrome opens a new
// window before a page script sees the event — so "New sketch" is
// palette-only rather than advertising a key that does something else.
// "Back to my sketches" is palette-only for the same reason: the one
// convention for "go home" is Mod+Shift+H in Safari and Chrome on a Mac and
// Alt+Home elsewhere, and both are the browser's own Home page.
// ---------------------------------------------------------------------------

const FILE_COMMANDS: readonly Command[] = [
  {
    id: "file.new",
    title: "New sketch",
    keywords: ["new", "blank", "empty", "create"],
    group: "file",
    enabled: () => true,
    run: (store) => newSketch(store),
  },
  {
    id: "file.open",
    title: "Open a file…",
    keywords: ["open", "import", "mol", "molfile", "sdf", "smiles", "file"],
    shortcut: "Mod+o",
    group: "file",
    enabled: () => true,
    run: (store) => openFromDisk(store),
  },
  {
    id: "file.save",
    title: "Save",
    keywords: ["save", "store", "persist"],
    shortcut: "Mod+s",
    group: "file",
    enabled: () => true,
    run: (store) => saveNow(store),
  },
  {
    id: "file.export-sketch",
    title: "Export as a sketch file",
    keywords: ["export", "download", "json", "backup", "sketch"],
    shortcut: "Mod+Shift+s",
    group: "file",
    enabled: () => true,
    run: (store) => exportCurrent(store, "sketch"),
  },
  {
    id: "file.export-mol",
    title: "Export as a molfile",
    keywords: ["export", "download", "mol", "molfile", "v2000", "mdl"],
    group: "file",
    // An empty sketch writes a molblock with no atoms, which no other program
    // will do anything useful with.
    enabled: (state) => !isEmpty(state.document.molecule),
    run: (store) => exportCurrent(store, "mol"),
  },
  {
    // The top bar's link runs this too, so a click and the palette take the
    // same save-then-leave path. See `leaveToRecents`.
    id: "file.recents",
    title: "Back to my sketches",
    keywords: ["home", "back", "sketches", "recents", "library", "leave", "close", "exit"],
    group: "file",
    enabled: () => true,
    run: (store) => leaveToRecents(store),
  },
];

// ---------------------------------------------------------------------------
// Figure: panels, export and the structure clipboard
// ---------------------------------------------------------------------------

const hasPanels = (state: EditorState): boolean =>
  state.document.panels.length > 0 && !isEmpty(state.document.molecule);

const hasStructure = (state: EditorState): boolean => !isEmpty(state.document.molecule);

const FIGURE_COMMANDS: readonly Command[] = [
  {
    id: "figure.export-dialog",
    title: "Export figure…",
    keywords: ["export", "figure", "svg", "pdf", "png", "publication", "journal", "dpi", "panels"],
    shortcut: "Mod+Shift+e",
    group: "figure",
    enabled: always,
    run: (store) => {
      store.getState().setExportDialogOpen(true);
    },
  },
  {
    id: "figure.export-svg",
    title: "Export figure as SVG",
    keywords: ["export", "figure", "svg", "vector", "illustrator", "inkscape"],
    group: "figure",
    enabled: hasPanels,
    run: (store) => exportFigureSvg(store),
  },
  {
    id: "figure.export-pdf",
    title: "Export figure as PDF",
    keywords: ["export", "figure", "pdf", "vector", "print", "manuscript"],
    group: "figure",
    enabled: hasPanels,
    run: (store) => exportFigurePdf(store),
  },
  {
    id: "figure.export-png",
    title: "Export figure as PNG",
    keywords: ["export", "figure", "png", "raster", "image", "dpi"],
    group: "figure",
    enabled: hasPanels,
    run: (store) => exportFigurePng(store),
  },
  {
    id: "figure.copy",
    title: "Copy figure",
    keywords: ["copy", "clipboard", "figure", "svg", "png", "image"],
    group: "figure",
    enabled: hasPanels,
    disabledReason: (state) =>
      isEmpty(state.document.molecule)
        ? REASONS.emptyDrawing
        : state.document.panels.length === 0
          ? "The figure has no panels. Add one in the Figure panels list"
          : undefined,
    run: (store) => copyFigure(store),
  },
  {
    id: "figure.copy-smiles",
    title: "Copy as SMILES",
    keywords: ["copy", "clipboard", "smiles", "rdkit", "text"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => copySmiles(store),
  },
  {
    id: "figure.copy-inchi",
    title: "Copy as InChI",
    keywords: ["copy", "clipboard", "inchi", "identifier", "iupac", "text"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => copyInchi(store, "structure", "inchi"),
  },
  {
    id: "figure.copy-inchikey",
    title: "Copy as InChIKey",
    keywords: ["copy", "clipboard", "inchikey", "inchi", "key", "pubchem", "search"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => copyInchi(store, "structure", "inchikey"),
  },
  {
    id: "figure.export-cdxml",
    title: "Download structure as CDXML",
    keywords: ["export", "download", "cdxml", "chemdraw", "cdx", "structure"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => exportCdxml(store),
  },
  {
    id: "figure.copy-molblock",
    title: "Copy as molfile",
    keywords: ["copy", "clipboard", "molfile", "molblock", "mol", "v2000", "mdl"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => copyMolblock(store),
  },
  {
    id: "figure.copy-elemental-analysis",
    title: "Copy elemental analysis",
    keywords: ["copy", "clipboard", "elemental", "analysis", "anal", "calcd", "chn", "chns", "combustion", "percent", "experimental"],
    group: "figure",
    enabled: hasStructure,
    disabledReason: whenOff(hasStructure, REASONS.emptyDrawing),
    run: (store) => copyElementalAnalysis(store),
  },
  // One per view kind, gated by the availability function — the palette shows
  // the kinds this molecule cannot be drawn as disabled rather than hiding
  // them, so the choice is visible and the panel list says why.
  ...VIEW_KINDS.map(
    (kind): Command => ({
      id: `figure.add-panel.${kind}`,
      title: `Add panel: ${VIEW_KIND_TITLES[kind]}`,
      keywords: ["add", "panel", "figure", "view", "representation", kind, VIEW_KIND_TITLES[kind]],
      group: "figure",
      enabled: (state) =>
        isEmpty(state.document.molecule) ||
        representationAvailability(state.document.molecule, kind).available,
      run: (store) => {
        const state = store.getState();
        state.addPanel(kind);
        const index = store.getState().document.panels.length - 1;
        state.setStatusMessage(`Added panel (${panelLetter(index)}): ${VIEW_KIND_TITLES[kind]}`);
      },
    }),
  ),
];

export const COMMANDS: readonly Command[] = Object.freeze([
  ...FILE_COMMANDS,
  ...FIGURE_COMMANDS,
  ...toolCommands(),
  ...bondOrderCommands(),
  ...bondStereoCommands(),
  ...bondQueryCommands(),
  ...bondSideCommands(),
  ...bondFlagCommands(),
  ...ringTemplateCommands(),
  ...ringFuseCommands(),
  ...chainLengthCommands(),
  ELEMENT_TABLE_COMMAND,
  ...functionalGroupCommands(),
  ...elementCommands(),
  ...EDIT_COMMANDS,
  ...SELECT_COMMANDS,
  ...STRUCTURE_COMMANDS,
  ...ARRANGE_COMMANDS,
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
