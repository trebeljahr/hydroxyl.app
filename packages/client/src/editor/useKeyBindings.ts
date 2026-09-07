"use client";

/**
 * The one keyboard layer. Every shortcut in the editor is dispatched here and
 * resolved against the command registry — there is no second `keydown`
 * listener anywhere in the shell.
 *
 * ── THE ORDER OF THE GUARDS IS THE DESIGN ──────────────────────────────────
 *
 * 1. `event.defaultPrevented`. The canvas's gesture hook listens for Escape on
 *    `window` too, and cancels the drag in flight — but it calls
 *    `stopPropagation`, which does NOT stop another listener on the SAME
 *    target, so this handler still runs for that event. Without this check the
 *    first Escape of a two-Escape sequence would both cancel the drag AND put
 *    the tool down, and the deliberate "two Escapes mean two things" design
 *    would collapse into one.
 *
 * 2. THE PALETTE. While it is open, cmdk owns the keyboard — arrows move its
 *    highlight, Escape closes it, letters type into its filter. A tool letter
 *    reaching the editor from inside the palette's own search field is exactly
 *    the bug the acceptance criterion names.
 *
 * 3. TEXT ENTRY, and then any other Radix overlay. `input`, `textarea`,
 *    `select` and anything contenteditable; then a popover or dialog Radix has
 *    focus inside, so Escape closes the layer without also putting the tool
 *    down.
 *    Note this is NOT the canvas's `consumesSpace`, which deliberately also
 *    matches `button`, `a` and `[role=button]` so that space activates a
 *    focused button instead of panning. Reusing it here would make Delete,
 *    undo and 1/2/3 inert for as long as a tool button had focus — which is
 *    the state the user is in immediately after clicking a tool.
 *
 * ── ARROWS MEAN TWO DIFFERENT THINGS, AND WHERE FOCUS IS DECIDES WHICH ─────
 *
 * With the canvas focused they walk the roving atom focus along bonds, and
 * with shift held they walk the document's atom order instead — see
 * traversal.ts for why one key cannot do both. Anywhere else, and on the
 * canvas with the platform modifier held, they nudge the selection. Both
 * meanings are wanted, they cannot both be the bare arrow in the same place,
 * and focus is the only signal that is already unambiguous.
 *
 * ── AND WHY THE NUDGE OPENS A TRANSACTION ──────────────────────────────────
 *
 * A held arrow key auto-repeats at ~30 Hz, and one history entry per repeat
 * would bury the last real edit under a second of nudges. The session below
 * opens ONE transaction on the first nudge and commits it when the nudging
 * stops. That is the failure mode this codebase fears most, so it is closed
 * from five directions: the idle timer, the keyup, any other command, a window
 * blur, and the effect's own teardown.
 */

import { useEffect } from "react";

import {
  commandForEvent,
  nudgeDelta,
  nudgeSelection,
} from "@/editor/commands/registry";
import {
  ELEMENT_BUFFER_WINDOW_MS,
  pressElementKey,
} from "@/editor/element-buffer";
import { applyElement } from "@/editor/commands/registry";
import { ARROW_VECTORS, describeAtom, nextFocusAtom } from "@/editor/traversal";
import type { ArrowDirection } from "@/editor/traversal";
import { editorStore } from "@/state";
import type { EditorStore } from "@/state";

/** How long the nudge transaction stays open after the last arrow press. */
export const NUDGE_IDLE_MS = 400;

const ARROW_KEYS: Readonly<Record<string, ArrowDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Is the event aimed at something that eats characters?
 *
 * Narrower than the canvas's `consumesSpace` on purpose — see guard 3 in the
 * header. A `<select>` counts: its type-ahead consumes letters.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}

function isOnCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("[data-canvas-root]") !== null;
}

/**
 * Is focus inside a Radix overlay — a popover, a select menu, a dialog?
 *
 * Radix portals its content into a wrapper it marks itself, and it moves focus
 * in when the layer opens. Without this guard Escape would be handled TWICE:
 * Radix closes the popover, and `ToolSlice.escape()` also puts the tool down —
 * so a chemist who opened the ring menu and changed their mind would lose the
 * ring tool as well as the menu. The arrow keys have the same problem: they
 * move a Select's highlight AND would nudge the selection underneath.
 */
function isInsideOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest("[data-radix-popper-content-wrapper], [role='dialog']") !== null
  );
}

/**
 * The open nudge transaction, if any.
 *
 * Module scope rather than a ref because the window listeners that have to
 * close it (blur) are registered once and because there is only ever one
 * editor on a page — the store is a module singleton for the same reason.
 */
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * The store the open transaction belongs to, or null.
 *
 * The STORE and not a bare boolean. The app has exactly one, but the tests
 * build a fresh one per case, and a boolean left `true` by the previous case
 * would make the next one skip its `beginTransaction` and record every nudge
 * as its own history entry — a false green for the coalescing this exists to
 * provide. Keying on identity makes the leak impossible rather than merely
 * unlikely.
 */
let nudgeStore: EditorStore | null = null;

function endNudge(store: EditorStore): void {
  if (nudgeTimer !== undefined) {
    clearTimeout(nudgeTimer);
    nudgeTimer = undefined;
  }
  if (nudgeStore === null) return;
  const open = nudgeStore;
  nudgeStore = null;
  // Committed on the store that OPENED it, whatever store asked us to close.
  void store;
  open.getState().commitTransaction();
}

function beginOrExtendNudge(store: EditorStore): void {
  if (nudgeStore !== null && nudgeStore !== store) endNudge(nudgeStore);
  if (nudgeStore === null) {
    nudgeStore = store;
    store.getState().beginTransaction("Nudge selection");
  }
  if (nudgeTimer !== undefined) clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    nudgeTimer = undefined;
    endNudge(store);
  }, NUDGE_IDLE_MS);
}

/** Test seam: whether a nudge transaction is currently open. */
export function nudgeTransactionOpen(): boolean {
  return nudgeStore !== null;
}

/**
 * The element-buffer window. Cleared on a timer rather than carried forever,
 * so "C" typed twice a second apart is carbon twice rather than an attempt at
 * "Cc".
 */
let elementTimer: ReturnType<typeof setTimeout> | undefined;

function armElementWindow(store: EditorStore, buffer: string): void {
  if (elementTimer !== undefined) clearTimeout(elementTimer);
  elementTimer = undefined;
  store.getState().setElementInputBuffer(buffer);
  if (buffer === "") return;
  elementTimer = setTimeout(() => {
    elementTimer = undefined;
    store.getState().clearElementInputBuffer();
  }, ELEMENT_BUFFER_WINDOW_MS);
}

export interface KeyBindingsOptions {
  /** Announce a traversal to the live region. */
  readonly onAnnounce?: ((message: string) => void) | undefined;
  /** Injectable for tests; defaults to the app's singleton store. */
  readonly store?: EditorStore | undefined;
}

/**
 * Handle one keydown. Exported so a unit test can drive the whole layer
 * without a DOM listener, and so the shell can register it once.
 *
 * Returns whether the key was claimed, which is only used by the tests — the
 * handler calls `preventDefault` itself for the keys it takes.
 */
export function handleEditorKeyDown(
  event: KeyboardEvent,
  options: KeyBindingsOptions = {},
): boolean {
  const store = options.store ?? editorStore;

  if (event.defaultPrevented) return false;
  const state = store.getState();
  if (state.ui.commandPaletteOpen) return false;
  if (isTextEntryTarget(event.target)) return false;
  if (isInsideOverlay(event.target)) return false;

  // Escape: the tool goes down, the half-typed element is dropped, the palette
  // closes. `ToolSlice.escape()` does all three in one `set` so no subscriber
  // ever sees a half-reverted state.
  if (event.key === "Escape") {
    endNudge(store);
    armElementWindow(store, "");
    state.escape();
    return true;
  }

  const arrow = ARROW_KEYS[event.key];
  if (arrow !== undefined) {
    const mod = event.metaKey || event.ctrlKey;
    if (isOnCanvas(event.target) && !mod) {
      event.preventDefault();
      endNudge(store);
      const mol = state.document.molecule;
      // Shift steps through the document's atom order instead of following a
      // bond. See traversal.ts: a bonded walk cannot reach every atom, and
      // reaching every atom is the accessibility guarantee.
      const next = nextFocusAtom(
        mol,
        state.ui.focusedAtomId ?? undefined,
        arrow,
        event.shiftKey ? "sequential" : "bonded",
      );
      if (next === undefined) return true;
      state.setFocusedAtom(next);
      options.onAnnounce?.(describeAtom(mol, next));
      return true;
    }
    if (state.selection.atomIds.length === 0) return false;
    event.preventDefault();
    beginOrExtendNudge(store);
    nudgeSelection(
      store,
      nudgeDelta(state.document.molecule, ARROW_VECTORS[arrow], event.shiftKey),
    );
    return true;
  }

  const command = commandForEvent(event);
  if (command !== undefined) {
    // A nudge run ends the moment anything else happens, so the entry it
    // recorded reads as one deliberate move rather than swallowing whatever
    // came next.
    endNudge(store);
    armElementWindow(store, "");
    // A DISABLED command still swallows its key: letting Mod+Z fall through
    // when there is nothing to undo would hand the browser a shortcut the
    // editor has claimed.
    event.preventDefault();
    if (!command.enabled(state)) return true;
    void command.run(store);
    return true;
  }

  // Bare letters, last: everything the registry did not claim is element
  // input. The tool letters therefore win, which costs exactly the elements
  // listed in the header of tools.ts and keeps the whole organic set typeable.
  if (
    event.key.length === 1 &&
    /^[a-zA-Z]$/.test(event.key) &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    endNudge(store);
    const outcome = pressElementKey(state.ui.elementInputBuffer, event.key);
    armElementWindow(store, outcome.buffer);
    if (outcome.element === undefined) return false;
    event.preventDefault();
    applyElement(store, outcome.element);
    return true;
  }

  return false;
}

/**
 * Register the layer for the life of the mount.
 *
 * On `window` rather than on a container, for the same reason the canvas
 * tracks space there: the user's hand is on the mouse and nothing in the
 * editor need have focus for Mod+Z to mean undo.
 */
export function useKeyBindings(options: KeyBindingsOptions = {}): void {
  const { onAnnounce, store } = options;
  useEffect(() => {
    const target = store ?? editorStore;
    const onKeyDown = (event: KeyboardEvent): void => {
      handleEditorKeyDown(event, { onAnnounce, store: target });
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (ARROW_KEYS[event.key] !== undefined) endNudge(target);
    };
    const onBlur = (): void => {
      endNudge(target);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      // The teardown is the last of the five ways the transaction closes. An
      // unmount mid-nudge — a route change, a Fast Refresh — would otherwise
      // leave it open, and an open transaction kills undo for the session.
      endNudge(target);
      if (elementTimer !== undefined) {
        clearTimeout(elementTimer);
        elementTimer = undefined;
      }
    };
  }, [onAnnounce, store]);
}
