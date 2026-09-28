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
  RingTemplateName,
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
  /**
   * WHICH TEMPLATE the ring tool drops, by NAME rather than by size.
   *
   * A size cannot express the ring an organic chemist draws most often:
   * `RING_TEMPLATES.cyclohexane` and `RING_TEMPLATES.benzene` are BOTH size 6
   * and differ only in `kekule`, so a numeric option can reach one of them
   * and never the other. Which one it reached depended on the call site —
   * the fuse/attach/spiro paths built `{ size }` and so could only ever make
   * cyclohexane, while free placement on empty canvas branched on
   * `size === 6` and so could only ever make benzene. The name is what
   * `RING_TEMPLATES` is keyed by, it survives a future hetero ring, and it
   * makes both paths read the same value.
   */
  readonly ringTemplate: RingTemplateName;
  /** How many atoms one click of the chain tool appends. */
  readonly chainLength: number;
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
  /**
   * The atom the CANVAS KEYBOARD FOCUS is on, which is a different thing from
   * both hover and selection.
   *
   * The `<svg>` is one tab stop — a thousand tab stops in a fused polycyclic
   * would be unusable — so it is a roving-focus widget: focus lands on the
   * canvas, and the arrow keys walk this id along bonds. Hover is where the
   * pointer is and selection is what an edit would act on; neither answers
   * "where is the keyboard", and reusing either would mean an arrow key
   * silently changed what Delete would remove.
   */
  readonly focusedAtomId: AtomId | null;
  /**
   * WHERE THE ROVING FOCUS CAME FROM, and nothing else.
   *
   * The bonded arrow walk rejects it as a destination, which is what stops
   * the focus trading back and forth across one bond — see traversal.ts. It
   * is kept here rather than in the key layer because the canvas also moves
   * the focus (a click, a tab into the widget), and a "previous" that only
   * the keyboard updated would go stale the moment a pointer touched an atom
   * and then block a legitimate arrow press.
   */
  readonly previousFocusedAtomId: AtomId | null;
  readonly commandPaletteOpen: boolean;
  /** One line of feedback ("Cannot merge bonded atoms"), or nothing. */
  readonly statusMessage: string | null;
  /**
   * Keystrokes typed at the canvas before they resolve to an element: "C",
   * then "l" makes Cl rather than replacing it with L. The element tool
   * flushes and clears it; Escape clears it unconditionally.
   */
  readonly elementInputBuffer: string;
  /**
   * The panel the canvas shows and the view options act on. NOT persisted and
   * not undoable: which panel you are looking at is a viewing choice, like
   * the viewport, and an undo that flipped the canvas to another view would
   * look like the edit had been lost. `null` means the default panel.
   */
  readonly activePanelId: PanelId | null;
  readonly exportDialogOpen: boolean;
  /** The full periodic table behind the element picker's "Show all". */
  readonly periodicTableOpen: boolean;
  readonly figureExport: FigureExportSettings;
}

/**
 * The physical size a figure is exported at. A journal specifies a figure as
 * a printed width and a resolution, so that is what is chosen; pixels are
 * derived. Session-only for now — see the report on whether it belongs in
 * the document.
 */
export interface FigureExportSettings {
  readonly width: "single" | "double" | "custom";
  /** Used when `width` is "custom". */
  readonly customWidthCm: number;
  readonly dpi: 300 | 600;
  /**
   * Which render style the export draws with (decision 50). "publication" is
   * the default whatever the canvas shows, because Screen at the fixed
   * printed bond sets 5.2 pt labels; "canvas" is the document's own preset.
   * A per-export choice: it never touches the document or the undo history.
   */
  readonly style: FigureStyleChoice;
}

export type FigureStyleChoice = "publication" | "canvas";

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
  /**
   * Replaces the document AND RESETS THE HISTORY, without recording a step.
   *
   * This is the RESTORE path, not the import path, and the difference matters:
   * a saved sketch read back out of IndexedDB on page load is not an edit the
   * user made, so it must not be undoable. Routing it through `openDocument`
   * would push an entry whose base is the empty startup document, and the
   * first Ctrl+Z after a reload would wipe the canvas — which autosave would
   * then persist over the good copy.
   *
   * The history is cleared rather than kept because the entries that were in
   * it describe a document that is no longer loaded.
   */
  loadDocument(document: SketchDocument): void;
  applyMoleculeEdit(label: string, edit: MoleculeEdit): void;
  setStylePreset(preset: StylePresetId): void;
  setDocumentTitle(title: string): void;
  /**
   * Take on a title that was set OUTSIDE this editor — renamed in another tab
   * — as a fact about the document rather than as an edit.
   *
   * Not undoable, and not merely unrecorded: the title is rewritten into every
   * snapshot in the history too, so no undo, redo or aborted gesture can bring
   * the old title back. Title-only steps that this leaves doing nothing are
   * dropped. `modifiedAt` is left alone, as a rename in storage leaves it.
   */
  adoptDocumentTitle(title: string): void;

  /** Returns the id of the panel it added, so a caller can scroll to it. */
  addPanel(kind: RepresentationKind, caption?: string): PanelId;
  removePanel(id: PanelId): void;
  updatePanel(id: PanelId, patch: PanelPatch): void;
  /** `null` removes the caption; the key is omitted rather than set to
   *  `undefined`, because a saved document must never carry one. */
  setPanelCaption(id: PanelId, caption: string | null): void;
  /** `order` must be a permutation of the current panel ids. */
  reorderPanels(order: readonly PanelId[]): void;
  /** Move one panel up (-1) or down (+1) in the figure order. */
  movePanel(id: PanelId, delta: -1 | 1): void;
  /** Panels per row in the exported figure; null returns to the default. */
  setFigureColumns(columns: number | null): void;

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
  /**
   * Elements picked from OUTSIDE the quick picker's organic set, newest
   * first, capped at one row. The quick picker pins them under its grid, so a
   * chemist who reached for platinum through the full table finds it one
   * click away the next time. Not undoable, like every other tool setting;
   * kept across reloads by `usePersistedRecentElements`.
   */
  readonly recentElements: readonly ElementSymbol[];

  /** STICKY: the chosen tool stays chosen until another is picked. Drawing a
   *  bond does not drop you back into `select`. */
  setTool(id: ToolId): void;
  /** Escape: back to `select`, element buffer cleared, palette closed. */
  escape(): void;
  setToolOption<K extends keyof ToolOptions>(key: K, value: ToolOptions[K]): void;
  /** Move `symbol` to the front of `recentElements`. See `withRecentElement`. */
  noteRecentElement(symbol: ElementSymbol): void;
  /** Replace the list wholesale — how a stored list is restored on mount. */
  setRecentElements(symbols: readonly ElementSymbol[]): void;
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
  /** Back to the origin at `zoom`, 1 when omitted. The view command passes
   *  the zoom that reads 100% for the document's style (decision 107). */
  resetViewport(zoom?: number): void;
  /** The scene was redrawn `factor` times larger; keep it where it was on
   *  screen. See `rescaleScene`. */
  rescaleViewport(factor: number): void;
}

export interface UiSlice {
  readonly ui: UiState;

  setHoveredAtom(id: AtomId | null): void;
  setHoveredBond(id: BondId | null): void;
  setFocusedAtom(id: AtomId | null): void;
  setStatusMessage(message: string | null): void;
  setCommandPaletteOpen(open: boolean): void;
  toggleCommandPalette(): void;
  setElementInputBuffer(buffer: string): void;
  setActivePanel(id: PanelId | null): void;
  setExportDialogOpen(open: boolean): void;
  setPeriodicTableOpen(open: boolean): void;
  setFigureExport(patch: Partial<FigureExportSettings>): void;
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
