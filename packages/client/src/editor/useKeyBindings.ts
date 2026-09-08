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
 *    `select`, anything contenteditable, and anything carrying a role that
 *    eats characters — `combobox` above all, because that is what a Radix
 *    Select's TRIGGER is and it has no popper wrapper while it is closed;
 *    then a popover or dialog Radix has focus inside, so Escape closes the
 *    layer without also putting the tool down.
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
 * stops.
 *
 * IT IS THE IDLE TIMER THAT DECIDES WHEN THAT IS, AND KEYUP MUST NOT.
 * Closing on keyup looked like a fifth safety net and was in fact a hole: a
 * chemist nudges by TAPPING, not by holding, so every tap released its own
 * key, committed its own transaction, and the 400 ms window never once got to
 * do its job — six taps of Mod+Right moved an atom 26.4 units and one undo
 * took back 4.4 of them. The remaining four closers are all events that mean
 * the run is genuinely over rather than merely paused: the idle timer, any
 * other command, a pointer press or window blur, and the effect's teardown.
 */

import { useEffect } from "react";

import {
  commandForEvent,
  nudgeDelta,
  nudgeSelection,
} from "@/editor/commands/registry";
import {
  ELEMENT_BUFFER_WINDOW_MS,
  isPendingPrefix,
  pressElementKey,
} from "@/editor/element-buffer";
import { applyElement } from "@/editor/commands/registry";
import { ARROW_VECTORS, describeAtom, nextFocusAtom } from "@/editor/traversal";
import type { ArrowDirection } from "@/editor/traversal";
import { COMMON_ORGANIC_ELEMENTS } from "@starter/chem-core";

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
 *
 * THE ROLES ARE NOT BELT-AND-BRACES, they are the whole point. The properties
 * panel's Order, Stereo and Isotope controls are Radix Selects, and a Radix
 * Select is NOT a `<select>` — it renders a `<button role="combobox">` whose
 * closed state has no popper wrapper for `isInsideOverlay` to find either. So
 * the one widget in the shell whose type-ahead really does eat letters fell
 * through both guards: with a ring bond selected and the Order combobox
 * focused, a single `d` switched to the bond tool AND retyped the bond as a
 * double, and `t` made it a triple with two valence errors, from one
 * keystroke and with no menu ever opened. Matching the ARIA role rather than
 * the tag name is what closes that, and it closes it for every future
 * headless widget too.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest(
      "input, textarea, select, [contenteditable]," +
        " [role='combobox'], [role='listbox'], [role='spinbutton']," +
        " [role='textbox'], [role='searchbox']",
    ) !== null
  );
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
      // bond, and `previousFocusedAtomId` is what stops the bonded walk
      // trading focus back and forth across one bond. See traversal.ts: the
      // bonded walk is complete on the rings a figure is made of but not on
      // every graph, and only the sequential mode guarantees it.
      const next = nextFocusAtom(
        mol,
        state.ui.focusedAtomId ?? undefined,
        arrow,
        event.shiftKey ? "sequential" : "bonded",
        state.ui.previousFocusedAtomId ?? undefined,
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

  const bareLetter =
    event.key.length === 1 &&
    /^[a-zA-Z]$/.test(event.key) &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey;

  // TWO KINDS OF HALF-TYPED SYMBOL OUTRANK A TOOL LETTER, and nothing else.
  //
  // (1) A PENDING PREFIX. "M" applies nothing and means nothing on its own,
  //     so the `g` that follows it inside the window can only have been meant
  //     as magnesium — nobody reaches for the pan tool one letter into a
  //     symbol. This buys back the whole class the old order silently lost:
  //     Al Ar Ag As At Au Ac Am, Li La Lr Lu Lv, Mg Mn Mo Md, Ti Te Tl Ta Th
  //     Tc Tb Tm and the rest. Before it, "Li" armed IODINE.
  //
  // (2) A PAIR THAT IS IN THE ORGANIC SET. Exactly two symbols need this —
  //     Br and Se — and they need it because `r` and `e` are tool letters, so
  //     bromine and selenium were unreachable from the keyboard while
  //     tools.ts promised the organic set was untouched. Keeping the promise
  //     is worth more than the sequence it costs (press B, then `r` within
  //     900 ms meaning the ring tool).
  //
  // Deliberately NOT every pair: "C" then `d` stays the draw-bond tool rather
  // than becoming cadmium, because retype-an-atom-then-draw-off-it is the
  // commonest sequence in the editor and cadmium appears in no figure.
  let elementBuffer = state.ui.elementInputBuffer;
  if (bareLetter && elementBuffer !== "") {
    const pending = isPendingPrefix(elementBuffer);
    const outcome = pressElementKey(elementBuffer, event.key);
    const completed = outcome.element;
    if (
      completed !== undefined &&
      completed.length === 2 &&
      (pending || COMMON_ORGANIC_ELEMENTS.includes(completed))
    ) {
      endNudge(store);
      armElementWindow(store, outcome.buffer);
      event.preventDefault();
      applyElement(store, completed);
      return true;
    }
    // A prefix that led nowhere is dead: drop it and read the key from
    // scratch below, registry first, so "Mq" is a dead M and then the charge
    // tool. An APPLIED single is left alone — whichever branch claims the key
    // closes the window itself.
    if (pending) {
      elementBuffer = "";
      armElementWindow(store, "");
    }
  }

  const command = commandForEvent(event);
  if (command !== undefined) {
    // A nudge run ends the moment anything else happens, so the entry it
    // recorded reads as one deliberate move rather than swallowing whatever
    // came next.
    endNudge(store);
    armElementWindow(store, "");
    const enabled = command.enabled(state);
    // A DISABLED command still swallows its key: letting Mod+Z fall through
    // when there is nothing to undo would hand the browser a shortcut the
    // editor has claimed.
    //
    // ONE EXCEPTION, and it is opted into per command rather than inferred.
    // `edit.paste` is disabled until something is on the EDITOR's clipboard,
    // and swallowing Mod+V in that state also suppresses the browser's own
    // `paste` event — which is the only route a SMILES or a molblock copied
    // out of a paper has onto the canvas. See `passThroughWhenDisabled`.
    if (enabled || command.passThroughWhenDisabled !== true) event.preventDefault();
    if (!enabled) return true;
    void command.run(store);
    return true;
  }

  // Bare letters, last: everything the registry did not claim is element
  // input. The tool letters therefore win, which costs exactly the elements
  // listed in the header of tools.ts and keeps the whole organic set typeable.
  if (bareLetter) {
    endNudge(store);
    const outcome = pressElementKey(elementBuffer, event.key);
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
    const onBlur = (): void => {
      endNudge(target);
    };
    // A POINTER PRESS ENDS BOTH TRANSIENT RUNS. The nudge, because whatever
    // the click is about is a new edit and should be its own history entry.
    // The half-typed element, because the 900 ms window was otherwise closed
    // ONLY by the clock, by Escape, or by another key — so "press N, click
    // somewhere, press O" still read the two letters as one symbol and wrote
    // nobelium.
    const onPointerDown = (): void => {
      endNudge(target);
      armElementWindow(target, "");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown, true);
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
