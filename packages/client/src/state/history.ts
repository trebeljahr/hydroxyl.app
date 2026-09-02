/**
 * Snapshot undo/redo over an arbitrary undoable state `S`.
 *
 * SNAPSHOTS, NOT PATCHES. The undoable state is a document holding one
 * immutable Molecule plus the selection, and every chem-core edit already
 * returns a structurally-shared new molecule — an entry is therefore a pointer
 * to a value that exists anyway, and the marginal cost of remembering it is a
 * word. Immer patches would buy nothing back and would tie the history to the
 * one library that produced them, which is precisely what makes an edit
 * performed outside a recipe (see chem-guard.ts) unrecordable.
 *
 * TRANSACTIONS EXIST BECAUSE A DRAG IS ONE EDIT. Dragging an atom fires a
 * `setAtomPositions` per pointer-move frame; without a transaction, letting go
 * leaves thirty entries and thirty undos to get back where you started. A
 * transaction captures the state at `begin` and pushes exactly that one
 * snapshot at `commit`, so the whole gesture collapses to a single step.
 *
 * Pure functions over an immutable `History<S>`: no zustand, no immer, no
 * knowledge of what `S` is. Equality is always the caller's `equal` predicate,
 * because only the caller knows whether reference identity is enough (it is,
 * for chem-core values) or whether a field needs comparing by value.
 */

export interface HistoryEntry<S> {
  /** Describes the edit that MOVED AWAY from `state` — i.e. what an undo of
   *  this entry would undo. Shown as "Undo <label>". */
  readonly label: string;
  readonly state: S;
}

export interface Transaction<S> {
  readonly label: string;
  readonly base: S;
  /** Nesting count. 1 is the outermost `beginTransaction`. */
  readonly depth: number;
}

export interface History<S> {
  /** Oldest first; the newest entry — the one an undo pops — is last. */
  readonly past: readonly HistoryEntry<S>[];
  /** Same orientation: the entry a redo pops is last. */
  readonly future: readonly HistoryEntry<S>[];
  readonly transaction: Transaction<S> | null;
  readonly limit: number;
}

/** 100 steps of a drawing session is far more than anyone scrolls back
 *  through, and bounds the retained molecule graphs. */
export const DEFAULT_HISTORY_LIMIT = 100;

export type EqualFn<S> = (a: S, b: S) => boolean;

export function createHistory<S>(limit: number = DEFAULT_HISTORY_LIMIT): History<S> {
  // A limit below 1 would mean "record, then immediately drop", which reads as
  // a broken undo rather than as a disabled one. Callers who want no history
  // simply never call `record`.
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_HISTORY_LIMIT;
  return { past: [], future: [], transaction: null, limit: safeLimit };
}

/** Drops the OLDEST entries. The far end of the stack is the one nobody
 *  reaches; truncating the recent end would break the next undo. */
function capped<S>(
  entries: readonly HistoryEntry<S>[],
  limit: number,
): readonly HistoryEntry<S>[] {
  return entries.length <= limit ? entries : entries.slice(entries.length - limit);
}

/**
 * Opens a transaction, or joins one already in flight.
 *
 * A NESTED BEGIN KEEPS THE OUTERMOST BASE AND LABEL and only bumps the depth.
 * That is what makes composite actions safe to write: an action that calls
 * `transact("Delete selection", ...)` internally must not split the user's
 * "Draw ring" gesture into two undo steps just because it happened to be
 * called from inside one. The outermost caller named the gesture; the inner
 * one is an implementation detail of it.
 */
export function beginTransaction<S>(
  h: History<S>,
  label: string,
  current: S,
): History<S> {
  if (h.transaction) {
    return { ...h, transaction: { ...h.transaction, depth: h.transaction.depth + 1 } };
  }
  return { ...h, transaction: { label, base: current, depth: 1 } };
}

/**
 * Closes one nesting level. Only the outermost close pushes an entry, and only
 * when `equal` says the state moved — a transaction whose body performed no
 * effective edit leaves no step to undo.
 *
 * WHAT "MOVED" MEANS IS THE CALLER'S, and the store's answer is reference
 * identity, so a drag that returns the atom to the pixel it started on DOES
 * record a step: chem-core mints a new molecule per frame, and the document's
 * `modifiedAt` has been re-stamped besides. Calling that pair equal would mean
 * comparing molecules by value on every commit AND deciding that a re-stamped
 * `modifiedAt` is not a change — a judgement about documents that a module
 * which does not know what `S` is has no business making. A gesture the user
 * actually cancels goes through `abortTransaction`, which is exact.
 */
export function commitTransaction<S>(
  h: History<S>,
  current: S,
  equal: EqualFn<S>,
): History<S> {
  const t = h.transaction;
  // Committing with nothing in flight is a caller bug, but throwing here would
  // take the editor down mid-gesture over bookkeeping. Ignore it.
  if (!t) return h;

  const depth = t.depth - 1;
  if (depth > 0) return { ...h, transaction: { ...t, depth } };

  if (equal(t.base, current)) return { ...h, transaction: null };

  return {
    ...h,
    past: capped([...h.past, { label: t.label, state: t.base }], h.limit),
    // A new edit invalidates the redo branch: the states in `future` were
    // reached from a past that no longer exists.
    future: [],
    transaction: null,
  };
}

/**
 * Abandons the transaction and hands back the state to restore, or `null` when
 * none was in flight.
 *
 * ABORT UNWINDS EVERY NESTING LEVEL, not just one. An abort means the gesture
 * failed — a drag cancelled with Escape, an op that threw halfway — and the
 * base is the only state known to be consistent. Unwinding one level would
 * leave the outer transaction holding a base it can no longer reach.
 */
export function abortTransaction<S>(
  h: History<S>,
): { history: History<S>; state: S | null } {
  const t = h.transaction;
  if (!t) return { history: h, state: null };
  return { history: { ...h, transaction: null }, state: t.base };
}

/**
 * Records one completed edit: `before` becomes the state an undo returns to.
 *
 * Two cases record nothing:
 *
 * - `equal(before, after)` — a no-op edit. chem-core returns the input
 *   molecule by reference when an op changes nothing, so this is the ordinary
 *   outcome of clicking an atom that is already carbon, and an undo step for
 *   it would be a step that does nothing visible.
 * - a transaction is in flight — the transaction's own `base` is the single
 *   entry that will be pushed at commit, so per-frame calls inside a drag must
 *   not accumulate.
 */
export function record<S>(
  h: History<S>,
  label: string,
  before: S,
  after: S,
  equal: EqualFn<S>,
): History<S> {
  if (h.transaction) return h;
  if (equal(before, after)) return h;
  return {
    ...h,
    past: capped([...h.past, { label, state: before }], h.limit),
    future: [],
  };
}

/**
 * Pops the newest past entry and returns the state to restore, pushing
 * `current` onto `future` under the same label so a redo comes back here.
 *
 * `null` when there is nothing to undo — INCLUDING MID-TRANSACTION. Undoing
 * out from under a drag in progress would restore a state the gesture's next
 * pointer-move frame immediately overwrites, and the transaction's base would
 * then describe a document nobody ever saw.
 */
export function undo<S>(
  h: History<S>,
  current: S,
): { history: History<S>; state: S } | null {
  if (!canUndo(h)) return null;
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: {
      ...h,
      past: h.past.slice(0, -1),
      future: capped([...h.future, { label: entry.label, state: current }], h.limit),
    },
    state: entry.state,
  };
}

/** The mirror of `undo`. */
export function redo<S>(
  h: History<S>,
  current: S,
): { history: History<S>; state: S } | null {
  if (!canRedo(h)) return null;
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: {
      ...h,
      past: capped([...h.past, { label: entry.label, state: current }], h.limit),
      future: h.future.slice(0, -1),
    },
    state: entry.state,
  };
}

export function canUndo<S>(h: History<S>): boolean {
  return h.transaction === null && h.past.length > 0;
}

export function canRedo<S>(h: History<S>): boolean {
  return h.transaction === null && h.future.length > 0;
}

/** For the menu item text; `undefined` when the action is unavailable, so a
 *  disabled item shows a bare "Undo" rather than a stale label. */
export function undoLabel<S>(h: History<S>): string | undefined {
  return canUndo(h) ? h.past[h.past.length - 1]?.label : undefined;
}

export function redoLabel<S>(h: History<S>): string | undefined {
  return canRedo(h) ? h.future[h.future.length - 1]?.label : undefined;
}
