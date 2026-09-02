/**
 * The shape of the editor's state, and the slice interfaces that compose it.
 *
 * WHAT IS UNDOABLE AND WHAT IS NOT is the organising decision here, and it is
 * the reason the state is split the way it is:
 *
 * - `UndoableState` is the document plus the selection, and nothing else. The
 *   document because it is what gets saved; the selection because deleting
 *   the selected atoms has to put them AND the selection back in one step —
 *   an undo that restored the atoms but left the selection empty would leave
 *   the user's next keystroke acting on nothing.
 * - The viewport, the current tool and the transient UI state are explicitly
 *   NOT undoable. Ctrl+Z after panning the canvas must undo the last chemical
 *   edit, not the pan: undo is for the drawing, not for where you were
 *   looking at it from or which button was pressed. That is why `Viewport`,
 *   `ToolId` and `UiState` appear nowhere in `UndoableState`.
 *
 * Every slice is a plain interface over readonly data plus its actions. The
 * store composes them into one flat object — zustand's slice pattern — so a
 * component subscribes to `state.tool` without knowing which file put it
 * there.
 */

import type {
  AtomId,
  BondId,
  BondStereo,
  ElementSymbol,
  Molecule,
  Vec2,
} from "@starter/chem-core";
import type {
  PanelId,
  RepresentationDisplay,
  RepresentationKind,
  SketchDocument,
  StylePresetId,
} from "@starter/shared";
import type { StateCreator } from "zustand/vanilla";
import type { History } from "./history";
import type { Bounds, Viewport, ViewportSize } from "./viewport";

// ---------------------------------------------------------------------------
// Undoable state
// ---------------------------------------------------------------------------

/**
 * What the user has picked out, as ids rather than as atom/bond objects.
 *
 * Ids and not references because ids survive an edit: `setAtomPositions`
 * returns a new molecule with new atom objects, and a selection holding the
 * old ones would point at a structure that no longer exists. Order is
 * insertion order, which the "chain" and "bond" tools read as "the atom I
 * touched first".
 */
export interface Selection {
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
}

/** A partial selection, for the additive operations (shift-click, rubber-band
 *  extend) that name only the half of the selection they touch. */
export interface SelectionPatch {
  readonly atomIds?: readonly AtomId[];
  readonly bondIds?: readonly BondId[];
}

export interface UndoableState {
  readonly document: SketchDocument;
  readonly selection: Selection;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolId =
  | "select"
  | "pan"
  | "bond"
  | "element"
  | "ring"
  | "chain"
  | "eraser"
  | "charge";

/**
 * The settings a tool carries between uses. They persist across a tool change
 * — switching to the eraser and back must not forget that the bond tool was
 * set to "double, wedge", because the alternative is re-picking it on every
 * bond of a steroid skeleton.
 */
export interface ToolOptions {
  readonly bondOrder: 1 | 2 | 3;
  readonly bondStereo: BondStereo;
  /** What the element tool stamps, and what a new chain is made of. */
  readonly element: ElementSymbol;
  /** Ring size in atoms. The ring tool owns what it is willing to draw; this
   *  slice only remembers the number the user last chose. */
  readonly ringSize: number;
  /** One click of the charge tool. Alt-click applies the opposite sign. */
  readonly chargeDelta: 1 | -1;
}

// ---------------------------------------------------------------------------
// Transient UI
// ---------------------------------------------------------------------------

/**
 * Everything that describes the moment rather than the drawing. All of it is
 * discarded on reload and none of it is undoable.
 */
export interface UiState {
  readonly hoveredAtomId: AtomId | null;
  readonly hoveredBondId: BondId | null;
  readonly commandPaletteOpen: boolean;
  /** One line of feedback ("Cannot merge bonded atoms"), or nothing. */
  readonly statusMessage: string | null;
  /**
   * Keystrokes typed at the canvas before they resolve to an element: "C",
   * then "l" makes Cl rather than replacing it with L. The element tool
   * flushes and clears it; Escape clears it unconditionally.
   */
  readonly elementInputBuffer: string;
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

/**
 * A pure molecule -> molecule edit, run OUTSIDE the immer recipe against the
 * real molecule from `get()`. chem-core ops have exactly this shape once
 * their extra arguments are bound, so a call site reads
 * `applyMoleculeEdit("Erase", (m) => guardedOps.removeAtoms(m, ids))`.
 */
export type MoleculeEdit = (molecule: Molecule) => Molecule;

/** What `updatePanel` may change. `caption` is deliberately absent — it has
 *  its own setter, because "no caption" is `null` there rather than a key the
 *  patch happens to omit. */
export interface PanelPatch {
  readonly kind?: RepresentationKind;
  readonly display?: Partial<RepresentationDisplay>;
}

export interface DocumentSlice {
  readonly document: SketchDocument;
  readonly history: History<UndoableState>;

  /** Replaces the whole document — a dropped .mol file, a new sketch. This IS
   *  undoable; see the note on the implementation. */
  openDocument(document: SketchDocument, label?: string): void;
  applyMoleculeEdit(label: string, edit: MoleculeEdit): void;
  setStylePreset(preset: StylePresetId): void;
  setDocumentTitle(title: string): void;

  /** Returns the id of the panel it added, so a caller can scroll to it. */
  addPanel(kind: RepresentationKind, caption?: string): PanelId;
  removePanel(id: PanelId): void;
  updatePanel(id: PanelId, patch: PanelPatch): void;
  /** `null` removes the caption; the key is omitted rather than set to
   *  `undefined`, because a saved document must never carry one. */
  setPanelCaption(id: PanelId, caption: string | null): void;
  /** `order` must be a permutation of the current panel ids. */
  reorderPanels(order: readonly PanelId[]): void;

  beginTransaction(label: string): void;
  commitTransaction(): void;
  abortTransaction(): void;
  /** `begin` / `fn` / `commit`, aborting and rethrowing if `fn` throws. */
  transact(label: string, fn: () => void): void;

  /** `true` when something was undone, so a key handler knows whether to
   *  swallow the event. */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
}

export interface SelectionSlice {
  readonly selection: Selection;

  setSelection(selection: Selection): void;
  /** Replaces the entire selection with these atoms — a plain click. */
  selectAtoms(ids: readonly AtomId[]): void;
  selectBonds(ids: readonly BondId[]): void;
  /** Shift-click and rubber-band extend: a union, not a replacement. */
  addToSelection(patch: SelectionPatch): void;
  toggleAtom(id: AtomId): void;
  toggleBond(id: BondId): void;
  clearSelection(): void;
  selectAll(): void;
  isAtomSelected(id: AtomId): boolean;
  isBondSelected(id: BondId): boolean;
}

export interface ToolSlice {
  readonly tool: ToolId;
  readonly toolOptions: ToolOptions;

  /** STICKY: the chosen tool stays chosen until another is picked. Drawing a
   *  bond does not drop you back into `select`. */
  setTool(id: ToolId): void;
  /** Escape: back to `select`, element buffer cleared, palette closed. */
  escape(): void;
  setToolOption<K extends keyof ToolOptions>(key: K, value: ToolOptions[K]): void;
}

export interface ViewportSlice {
  readonly viewport: Viewport;

  panBy(deltaScreen: Vec2): void;
  zoomAt(screenAnchor: Vec2, factor: number): void;
  setZoom(zoom: number): void;
  setViewportSize(size: ViewportSize): void;
  /** Takes explicit px bounds: the model-units-to-px scale belongs to
   *  chem-render's `RenderStyle`, so the store cannot derive the molecule's
   *  pixel extent on its own. */
  zoomToFit(bounds: Bounds, margin?: number): void;
  resetViewport(): void;
}

export interface UiSlice {
  readonly ui: UiState;

  setHoveredAtom(id: AtomId | null): void;
  setHoveredBond(id: BondId | null): void;
  setStatusMessage(message: string | null): void;
  setCommandPaletteOpen(open: boolean): void;
  toggleCommandPalette(): void;
  setElementInputBuffer(buffer: string): void;
  clearElementInputBuffer(): void;
}

export type EditorState = DocumentSlice &
  SelectionSlice &
  ToolSlice &
  ViewportSlice &
  UiSlice;

/**
 * The signature every slice creator has. The mutator tuple is what tells
 * zustand that `set` has already been wrapped by the immer middleware, so a
 * slice receives the recipe-taking `set` rather than the plain one.
 */
export type EditorSliceCreator<TSlice> = StateCreator<
  EditorState,
  [["zustand/immer", never]],
  [],
  TSlice
>;
