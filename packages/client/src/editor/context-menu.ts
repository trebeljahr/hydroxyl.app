/**
 * What the canvas context menu offers, per thing right-clicked. A pure
 * function of the editor state: no React, no DOM, so every decision about the
 * menu is testable without rendering one.
 *
 * ── EVERY ENTRY IS A REGISTRY COMMAND, OR A REGISTRY HELPER ────────────────
 *
 * The menu holds no chemistry and no list of actions of its own. An entry is
 * either `commandById(id)` — its title, its shortcut, its `enabled` and its
 * `disabledReason`, exactly as the palette shows them — or one of the
 * registry's parameterised helpers (`applyIsotope`, …) where
 * the value is a parameter and a command per value would flood the palette.
 * So a command added to the registry is one line here, and nothing can be
 * enabled in the menu that the keyboard would refuse.
 *
 * ── THE MENU ACTS ON THE SELECTION, SO OPENING IT SETS ONE ─────────────────
 *
 * Every command in the registry reads `state.selection`. Right-clicking an
 * atom that is not selected therefore selects it first (`selectionFor`), as
 * ChemDraw, Ketcher and MarvinJS all do: the highlight doubles as the answer
 * to "what will this menu change". Right-clicking inside a multi-selection
 * keeps it and offers the selection menu. Empty canvas leaves the selection
 * alone. Selection changes record no undo step, so this costs no history.
 *
 * ── WHAT THE FOUR MENUS HOLD, AND WHAT THEY LEAVE OUT ──────────────────────
 *
 * Planned against ChemDraw, Ketcher and MarvinJS; the plan and its omissions
 * are in the commit that introduced this file. In short:
 *
 *   atom       element (recent, organic set, the full table), charge,
 *              isotope, hydrogens, lone pairs, stereo, select connected,
 *              delete
 *   bond       order, stereo, flip direction, double-bond side, fuse ring,
 *              select connected, delete
 *   selection  cut / copy / duplicate, copy as SMILES or molfile, flip,
 *              rotate, align, clean up, element, charge, bond order, stereo,
 *              select connected / invert / clear, delete
 *   canvas     paste, select all, undo, redo, fit, reset view, clean up,
 *              all commands
 */

import {
  elementBySymbol,
  labellingIsotopes,
  requireAtom,
  requireBond,
  COMMON_ORGANIC_ELEMENTS,
} from "@starter/chem-core";
import type {
  AtomId,
  BondId,
  BondStereo,
  DoubleBondSide,
  ElementSymbol,
  Molecule,
  RingTemplateName,
} from "@starter/chem-core";
import type { DisplayFlagKey } from "@starter/shared";

import { canvasPanelFor } from "@/canvas/scene-bridge";
import {
  applyHydrogenCount,
  applyIsotope,
  applyLonePairs,
  commandById,
  displayFlagCommandId,
} from "@/editor/commands/registry";
import { describeAtom } from "@/editor/traversal";
import type { EditorState, EditorStore, Selection } from "@/state";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type ContextTarget =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "selection" }
  | { readonly kind: "canvas" };

/** What was under the pointer. chem-core's `Hit` is one of these. */
export type ContextHit =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "none" };

function selectionSize(selection: Selection): number {
  return selection.atomIds.length + selection.bondIds.length;
}

/**
 * What a right-click at `hit` is about.
 *
 * Inside a selection of more than one thing, the selection: the user built it
 * to act on it together, and replacing it with the one atom under the pointer
 * would throw that work away. Otherwise whatever was hit, and empty canvas
 * when nothing was.
 */
export function resolveContextTarget(selection: Selection, hit: ContextHit): ContextTarget {
  const multi = selectionSize(selection) > 1;
  if (hit.kind === "atom") {
    return multi && selection.atomIds.includes(hit.atomId)
      ? { kind: "selection" }
      : { kind: "atom", atomId: hit.atomId };
  }
  if (hit.kind === "bond") {
    return multi && selection.bondIds.includes(hit.bondId)
      ? { kind: "selection" }
      : { kind: "bond", bondId: hit.bondId };
  }
  return { kind: "canvas" };
}

/**
 * The target of a KEYBOARD-opened menu (the context-menu key, Shift+F10).
 *
 * The arrow keys already walk a focus from atom to atom, so that atom is what
 * the keyboard is pointing at, exactly as the pointer would be. With no
 * focused atom, a selection made with Mod+A is still something to act on.
 */
export function keyboardContextTarget(
  selection: Selection,
  focusedAtomId: AtomId | null,
  mol: Molecule,
): ContextTarget {
  if (focusedAtomId !== null && Object.hasOwn(mol.atoms, focusedAtomId)) {
    return resolveContextTarget(selection, { kind: "atom", atomId: focusedAtomId });
  }
  return selectionSize(selection) > 0 ? { kind: "selection" } : { kind: "canvas" };
}

/** The selection the menu should act on, or `current` when it is already that. */
export function selectionFor(target: ContextTarget, current: Selection): Selection {
  switch (target.kind) {
    case "atom":
      return current.atomIds.length === 1 &&
        current.bondIds.length === 0 &&
        current.annotationIds.length === 0 &&
        current.atomIds[0] === target.atomId
        ? current
        : { atomIds: [target.atomId], bondIds: [], annotationIds: [] };
    case "bond":
      return current.bondIds.length === 1 &&
        current.atomIds.length === 0 &&
        current.annotationIds.length === 0 &&
        current.bondIds[0] === target.bondId
        ? current
        : { atomIds: [], bondIds: [target.bondId], annotationIds: [] };
    case "selection":
    case "canvas":
      return current;
  }
}

// ---------------------------------------------------------------------------
// The menu model
// ---------------------------------------------------------------------------

export interface MenuItem {
  readonly kind: "item";
  /** The command id, or `<helper>.<value>` for a helper entry. Unique per menu. */
  readonly id: string;
  readonly label: string;
  /** The registry's spelling ("Mod+Shift+z"); the component formats it. */
  readonly shortcut?: string;
  /** A literal key sequence to show instead — an element's typed symbol. */
  readonly keys?: string;
  readonly enabled: boolean;
  /** Only while `enabled` is false: why, in a sentence. */
  readonly reason?: string;
  /** Set on checkbox and radio entries; absent on plain ones. */
  readonly checked?: boolean;
  readonly role?: "checkbox" | "radio";
  /**
   * Runs the entry — after asking again whether it may. The menu was built
   * from one snapshot and the click lands on another; a stale "enabled" must
   * not be what lets an edit through.
   */
  readonly run: (store: EditorStore) => void;
}

export interface MenuSubmenu {
  readonly kind: "submenu";
  readonly id: string;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

export interface MenuHeading {
  readonly kind: "heading";
  readonly label: string;
}

export interface MenuSeparator {
  readonly kind: "separator";
}

export type MenuEntry = MenuItem | MenuSubmenu | MenuHeading | MenuSeparator;

export interface ContextMenuModel {
  /** One line naming what the menu acts on: "N, 2 bonds, atom 3 of 6". */
  readonly title: string;
  readonly entries: readonly MenuEntry[];
}

const SEPARATOR: MenuSeparator = Object.freeze({ kind: "separator" });

/**
 * Said beside a greyed entry whose command gives no reason. The menu tests
 * assert it never appears — every command the menu reaches carries its own —
 * so this is a guard against a future command, not wording anyone should see.
 */
export const FALLBACK_REASON = "Not available for this selection";

interface CommandOptions {
  readonly label?: string;
  readonly checked?: boolean;
  readonly role?: "checkbox" | "radio";
}

function command(state: EditorState, id: string, options: CommandOptions = {}): MenuItem {
  const found = commandById(id);
  const enabled = found.enabled(state);
  return {
    kind: "item",
    id,
    label: options.label ?? found.title,
    ...(found.shortcut === undefined ? {} : { shortcut: found.shortcut }),
    enabled,
    ...(enabled ? {} : { reason: found.disabledReason?.(state) ?? FALLBACK_REASON }),
    ...(options.checked === undefined ? {} : { checked: options.checked }),
    ...(options.role === undefined ? {} : { role: options.role }),
    run: (store) => {
      if (!found.enabled(store.getState())) return;
      void found.run(store);
    },
  };
}

interface HelperOptions {
  readonly id: string;
  readonly label: string;
  readonly enabled: (state: EditorState) => boolean;
  readonly reason: string;
  readonly run: (store: EditorStore) => void;
  readonly keys?: string;
  readonly checked?: boolean;
}

function helper(state: EditorState, options: HelperOptions): MenuItem {
  const enabled = options.enabled(state);
  return {
    kind: "item",
    id: options.id,
    label: options.label,
    ...(options.keys === undefined ? {} : { keys: options.keys }),
    enabled,
    ...(enabled ? {} : { reason: options.reason }),
    ...(options.checked === undefined ? {} : { checked: options.checked, role: "radio" as const }),
    run: (store) => {
      if (!options.enabled(store.getState())) return;
      options.run(store);
    },
  };
}

function submenu(id: string, label: string, entries: readonly MenuEntry[]): MenuSubmenu {
  return { kind: "submenu", id, label, entries };
}

// ---------------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------------

function selectedAtoms(state: EditorState) {
  const mol = state.document.molecule;
  return state.selection.atomIds
    .filter((id) => Object.hasOwn(mol.atoms, id))
    .map((id) => requireAtom(mol, id));
}

function selectedBonds(state: EditorState) {
  const mol = state.document.molecule;
  return state.selection.bondIds
    .filter((id) => Object.hasOwn(mol.bonds, id))
    .map((id) => requireBond(mol, id));
}

/** True when there is at least one item and every one of them agrees. */
function every<T>(items: readonly T[], test: (item: T) => boolean): boolean {
  return items.length > 0 && items.every(test);
}

const hasAtoms = (state: EditorState): boolean => selectedAtoms(state).length > 0;
const NO_ATOM_REASON = "Select at least one atom first";

function displayFlag(state: EditorState, key: DisplayFlagKey): boolean {
  return canvasPanelFor(state.document, state.ui.activePanelId)?.representation.display[key] === true;
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

/**
 * The recent row, then the organic set, then the full table.
 *
 * RECENT is the tool slice's `recentElements`: the elements reached for from
 * OUTSIDE the organic set, the same row the quick picker pins under its grid.
 * The organic set is always listed in full below it, so repeating carbon in a
 * "recent" row would say nothing.
 *
 * The organic set is listed by NAME with the typed symbol as its key hint,
 * because typing the symbol at the canvas is exactly what applies it —
 * tools.ts pins that every one of the thirteen is reachable that way. A
 * recent element gets no key hint: several are tool-letter casualties there,
 * and a hint that switches tools instead would be a lie.
 */
function elementSection(state: EditorState): MenuSubmenu {
  const atoms = selectedAtoms(state);
  const isAll = (element: ElementSymbol): boolean => every(atoms, (atom) => atom.element === element);
  const entry = (element: ElementSymbol): MenuItem =>
    command(state, `element.${element}`, {
      label: elementBySymbol(element)?.name ?? element,
      checked: isAll(element),
      role: "radio",
    });
  const recent = state.recentElements.map(entry);
  const organic = COMMON_ORGANIC_ELEMENTS.map((element) => ({ ...entry(element), keys: element }));
  return submenu("element", "Element", [
    ...(recent.length > 0 ? [{ kind: "heading", label: "Recent" } as const, ...recent, SEPARATOR] : []),
    ...organic,
    SEPARATOR,
    command(state, "element.table", { label: "Other element…" }),
  ]);
}

function chargeEntries(state: EditorState): MenuEntry[] {
  return [
    command(state, "structure.charge-up", { label: "Increase charge" }),
    command(state, "structure.charge-down", { label: "Decrease charge" }),
  ];
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 13 → "¹³", the way an isotope label is written in a figure. */
function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]!);
}

/**
 * Natural abundance, then the curated labels for the element, plus whatever
 * mass the atom already carries if that is not among them — the menu must be
 * able to show the current value, not only the suggested ones.
 *
 * Offered only when every selected atom is ONE element: "¹³C" on a selection
 * holding an oxygen would write a mass number no oxygen has.
 */
function isotopeSection(state: EditorState): MenuSubmenu {
  const atoms = selectedAtoms(state);
  const element = atoms[0]?.element;
  const uniform = element !== undefined && atoms.every((atom) => atom.element === element);
  const mixed = "Select atoms of one element to label an isotope";
  const oneElement = (s: EditorState): boolean => {
    const now = selectedAtoms(s);
    return now.length > 0 && now.every((atom) => atom.element === now[0]!.element);
  };
  const masses = uniform ? labellingIsotopes(element) : [];
  const carried = uniform
    ? atoms.flatMap((atom) =>
        atom.isotope !== undefined && !masses.includes(atom.isotope) ? [atom.isotope] : [],
      )
    : [];
  const offered = [...new Set([...masses, ...carried])].sort((a, b) => a - b);
  return submenu("isotope", "Isotope", [
    helper(state, {
      id: "isotope.natural",
      label: "Natural abundance",
      enabled: oneElement,
      reason: mixed,
      checked: every(atoms, (atom) => atom.isotope === undefined),
      run: (store) => {
        applyIsotope(store, undefined);
      },
    }),
    ...offered.map((mass) =>
      helper(state, {
        id: `isotope.${String(mass)}`,
        label: `${superscript(mass)}${element ?? ""}`,
        enabled: oneElement,
        reason: mixed,
        checked: every(atoms, (atom) => atom.isotope === mass),
        run: (store) => {
          applyIsotope(store, mass);
        },
      }),
    ),
  ]);
}

/**
 * A pinned count per atom, and the panel-wide switch that draws them.
 *
 * Both halves belong here. The pin decides WHAT is drawn — three hydrogens on
 * an ammonium nitrogen, two lone pairs on a sulfone's sulfur in its
 * charge-separated reading — and the switch decides WHETHER. A chemist who
 * pins lone pairs with the switch off sees nothing happen, so the switch sits
 * one row below the pins rather than in another menu.
 */
function countSection(
  state: EditorState,
  options: {
    readonly id: string;
    readonly label: string;
    readonly unit: string;
    readonly read: (atom: ReturnType<typeof selectedAtoms>[number]) => number | undefined;
    readonly apply: (store: EditorStore, value: number | undefined) => void;
    readonly flag: DisplayFlagKey;
    readonly flagLabel: string;
  },
): MenuSubmenu {
  const atoms = selectedAtoms(state);
  const values: readonly (number | undefined)[] = [undefined, 0, 1, 2, 3];
  return submenu(options.id, options.label, [
    ...values.map((value) =>
      helper(state, {
        id: `${options.id}.${value === undefined ? "auto" : String(value)}`,
        label: value === undefined ? "Automatic (from valence)" : `${String(value)} ${options.unit}`,
        enabled: hasAtoms,
        reason: NO_ATOM_REASON,
        checked: every(atoms, (atom) => options.read(atom) === value),
        run: (store) => {
          options.apply(store, value);
        },
      }),
    ),
    SEPARATOR,
    command(state, displayFlagCommandId(options.flag), {
      label: options.flagLabel,
      checked: displayFlag(state, options.flag),
      role: "checkbox",
    }),
  ]);
}

function hydrogenSection(state: EditorState): MenuSubmenu {
  return countSection(state, {
    id: "hydrogens",
    label: "Hydrogens",
    unit: "H",
    read: (atom) => atom.explicitHydrogenCount,
    apply: applyHydrogenCount,
    flag: "showImplicitHydrogens",
    flagLabel: "Show hydrogens",
  });
}

function lonePairSection(state: EditorState): MenuSubmenu {
  return countSection(state, {
    id: "lone-pairs",
    label: "Lone pairs",
    unit: "pairs",
    read: (atom) => atom.lonePairs,
    apply: applyLonePairs,
    flag: "showLonePairs",
    flagLabel: "Show lone pairs",
  });
}

function stereoSection(state: EditorState): MenuSubmenu {
  return submenu("stereo", "Stereo", [
    command(state, "structure.invert-stereo", { label: "Invert configuration (R ⇄ S)" }),
    SEPARATOR,
    { kind: "heading", label: "Enhanced stereo" },
    command(state, "structure.stereo-group-abs", { label: "Mark absolute" }),
    command(state, "structure.stereo-group-and", { label: "Mark racemic" }),
    command(state, "structure.stereo-group-or", { label: "Mark relative" }),
    command(state, "structure.stereo-group-clear", { label: "Clear stereo group" }),
  ]);
}

const ORDER_LABELS = { 1: "Single", 2: "Double", 3: "Triple" } as const;

function bondOrderEntries(state: EditorState): MenuItem[] {
  const bonds = selectedBonds(state);
  return ([1, 2, 3] as const).map((order) =>
    command(state, `bond.order.${String(order)}`, {
      label: ORDER_LABELS[order],
      checked: every(bonds, (bond) => bond.order === order),
      role: "radio",
    }),
  );
}

const STEREO_LABELS = {
  none: "Plain",
  wedge: "Wedge",
  hash: "Hash",
  wavy: "Wavy",
  either: "Either (crossed)",
} as const satisfies Record<BondStereo, string>;

function bondStereoSection(state: EditorState): MenuSubmenu {
  const bonds = selectedBonds(state);
  return submenu(
    "bond-stereo",
    "Stereo",
    (Object.keys(STEREO_LABELS) as (keyof typeof STEREO_LABELS)[]).map((stereo) =>
      command(state, `bond.stereo.${stereo}`, {
        label: STEREO_LABELS[stereo],
        checked: every(bonds, (bond) => bond.stereo === stereo),
        role: "radio",
      }),
    ),
  );
}

const SIDE_LABELS = {
  auto: "Automatic",
  centered: "Centred",
  left: "Left",
  right: "Right",
} as const satisfies Record<DoubleBondSide, string>;

function bondSideSection(state: EditorState): MenuSubmenu {
  const doubles = selectedBonds(state).filter((bond) => bond.order === 2);
  return submenu(
    "bond-side",
    "Double-bond position",
    (Object.keys(SIDE_LABELS) as (keyof typeof SIDE_LABELS)[]).map((side) =>
      command(state, `bond.side.${side}`, {
        label: SIDE_LABELS[side],
        checked: every(doubles, (bond) => bond.doubleBondSide === side),
        role: "radio",
      }),
    ),
  );
}

const RING_LABELS = {
  benzene: "Benzene",
  cyclopropane: "Cyclopropane",
  cyclobutane: "Cyclobutane",
  cyclopentane: "Cyclopentane",
  cyclohexane: "Cyclohexane",
  cycloheptane: "Cycloheptane",
} as const satisfies Record<RingTemplateName, string>;

function fuseRingSection(state: EditorState): MenuSubmenu {
  return submenu(
    "fuse-ring",
    "Fuse ring",
    (Object.keys(RING_LABELS) as (keyof typeof RING_LABELS)[]).map((name) =>
      command(state, `ring.fuse.${name}`, { label: RING_LABELS[name] }),
    ),
  );
}

// ---------------------------------------------------------------------------
// The four menus
// ---------------------------------------------------------------------------

function atomMenu(state: EditorState, atomId: AtomId): ContextMenuModel {
  return {
    title: describeAtom(state.document.molecule, atomId),
    entries: [
      elementSection(state),
      ...chargeEntries(state),
      isotopeSection(state),
      hydrogenSection(state),
      lonePairSection(state),
      stereoSection(state),
      SEPARATOR,
      command(state, "select.connected"),
      command(state, "edit.delete", { label: "Delete atom" }),
    ],
  };
}

function bondTitle(state: EditorState, bondId: BondId): string {
  const mol = state.document.molecule;
  if (!Object.hasOwn(mol.bonds, bondId)) return "No bond";
  const bond = requireBond(mol, bondId);
  const order = ORDER_LABELS[bond.order];
  const ends = `${requireAtom(mol, bond.from).element}–${requireAtom(mol, bond.to).element}`;
  return `${order} bond, ${ends}`;
}

function bondMenu(state: EditorState, bondId: BondId): ContextMenuModel {
  return {
    title: bondTitle(state, bondId),
    entries: [
      ...bondOrderEntries(state),
      bondStereoSection(state),
      command(state, "structure.flip-bond", { label: "Flip direction" }),
      bondSideSection(state),
      fuseRingSection(state),
      SEPARATOR,
      command(state, "select.connected"),
      command(state, "edit.delete", { label: "Delete bond" }),
    ],
  };
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function selectionMenu(state: EditorState): ContextMenuModel {
  const atoms = selectedAtoms(state).length;
  const bonds = selectedBonds(state).length;
  return {
    title: `${plural(atoms, "atom")}, ${plural(bonds, "bond")} selected`,
    entries: [
      command(state, "edit.cut", { label: "Cut" }),
      command(state, "edit.copy", { label: "Copy" }),
      command(state, "edit.duplicate", { label: "Duplicate" }),
      submenu("copy-as", "Copy as", [
        command(state, "edit.copy-selection-smiles", { label: "SMILES" }),
        command(state, "edit.copy-selection-molfile", { label: "Molfile" }),
        // The whole figure, and the title says so: an SVG of the selection
        // alone would need the figure pipeline to run on a fragment whose ids
        // it re-mints, and every per-panel override is keyed on those ids.
        command(state, "figure.copy", { label: "Whole figure (SVG and PNG)" }),
      ]),
      SEPARATOR,
      command(state, "structure.flip-horizontal"),
      command(state, "structure.flip-vertical"),
      submenu("rotate", "Rotate", [
        command(state, "structure.rotate-cw", { label: "90° clockwise" }),
        command(state, "structure.rotate-ccw", { label: "90° counter-clockwise" }),
        command(state, "structure.rotate-180", { label: "180°" }),
      ]),
      submenu("align", "Align structures", [
        command(state, "structure.align-left", { label: "Left edges" }),
        command(state, "structure.align-centre", { label: "Centres" }),
        command(state, "structure.align-right", { label: "Right edges" }),
        SEPARATOR,
        command(state, "structure.align-top", { label: "Tops" }),
        command(state, "structure.align-middle", { label: "Middles" }),
        command(state, "structure.align-bottom", { label: "Bottoms" }),
      ]),
      // CoordGen lays out the whole molecule and re-mints every id, so there
      // is no selection-only clean-up to offer; the label says what it does.
      command(state, "structure.clean-up", { label: "Clean up whole structure" }),
      SEPARATOR,
      elementSection(state),
      ...chargeEntries(state),
      submenu("bond-order", "Bond order", bondOrderEntries(state)),
      stereoSection(state),
      SEPARATOR,
      command(state, "select.connected"),
      command(state, "select.invert"),
      command(state, "select.none"),
      command(state, "edit.delete", { label: "Delete" }),
    ],
  };
}

function canvasMenu(state: EditorState): ContextMenuModel {
  return {
    title: "Canvas",
    entries: [
      command(state, "edit.paste"),
      command(state, "select.all"),
      SEPARATOR,
      command(state, "edit.undo"),
      command(state, "edit.redo"),
      SEPARATOR,
      command(state, "view.fit"),
      command(state, "view.reset", { label: "Reset zoom" }),
      command(state, "structure.clean-up"),
      SEPARATOR,
      command(state, "view.command-palette", { label: "All commands…" }),
    ],
  };
}

/**
 * The menu for `target`, judged against ONE state snapshot.
 *
 * `state.selection` must already be `selectionFor(target, …)`: the checked
 * marks and every `enabled` read it, and a menu built before the selection
 * moved would describe the previous one.
 */
export function buildContextMenu(target: ContextTarget, state: EditorState): ContextMenuModel {
  switch (target.kind) {
    case "atom":
      return atomMenu(state, target.atomId);
    case "bond":
      return bondMenu(state, target.bondId);
    case "selection":
      return selectionMenu(state);
    case "canvas":
      return canvasMenu(state);
  }
}

/** Every item in a menu, submenus flattened. For tests and the e2e spec. */
export function menuItems(entries: readonly MenuEntry[]): MenuItem[] {
  return entries.flatMap((entry) =>
    entry.kind === "item" ? [entry] : entry.kind === "submenu" ? menuItems(entry.entries) : [],
  );
}
