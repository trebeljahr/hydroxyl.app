/**
 * The multi-character element hotkey buffer: C vs Cl vs Ca.
 *
 * WHY `normalizeElementInput` IS NOT ENOUGH ON ITS OWN, despite parsing the
 * string. It answers "is this a complete element?" — and it also accepts full
 * NAMES, so feeding it a buffer that grows one keystroke at a time walks
 * C -> Ca -> Car(nothing) -> Carb(nothing) while the user is typing "carbon"
 * and means "C". More importantly it cannot answer the question the buffer
 * actually has to ask on every keystroke: COULD A FURTHER CHARACTER STILL MAKE
 * A LONGER SYMBOL? "C" is a complete element AND a prefix of eleven others
 * (Ca Cd Ce Cf Cl Cm Cn Co Cr Cs Cu), and without a prefix test the editor
 * either commits to carbon and can never reach chlorine, or waits forever on
 * a letter that can never grow.
 *
 * THE ANSWER IS OPTIMISTIC-THEN-CORRECTED, not a wait. Pressing C sets carbon
 * IMMEDIATELY — the common case must not be laggy — and a following 'l' inside
 * the window REPLACES it with chlorine. Nothing is ever pending, so a user who
 * stops typing gets the element they asked for with no timeout to sit through,
 * and the timer only exists to close the window so that "C" typed twice means
 * carbon twice rather than carbon then Cc.
 *
 * The buffer is capped at TWO characters because no element symbol in
 * `ELEMENTS` is longer than three and the three-character ones are all
 * placeholder names for unnamed superheavies (Uue and friends) that no figure
 * contains. Two is the whole real ambiguity.
 */

import { ELEMENTS, normalizeElementInput } from "@starter/chem-core";
import type { ElementSymbol } from "@starter/chem-core";

/** How long a partial symbol stays open to a second character, in ms. */
export const ELEMENT_BUFFER_WINDOW_MS = 900;

/** The longest buffer worth keeping. See the header. */
export const MAX_ELEMENT_BUFFER = 2;

/**
 * Could `buffer` still grow into a longer symbol?
 *
 * Over `ELEMENTS` rather than a hardcoded list, so a symbol added to the table
 * is answered for here without anyone remembering to come back.
 */
export function couldExtendElement(buffer: string): boolean {
  if (buffer.length >= MAX_ELEMENT_BUFFER) return false;
  const prefix = buffer[0]!.toUpperCase() + buffer.slice(1).toLowerCase();
  return ELEMENTS.some(
    (element) =>
      element.symbol.length > prefix.length && element.symbol.startsWith(prefix),
  );
}

export interface ElementKeyResult {
  /** The buffer to carry into the next keystroke; "" closes the window. */
  readonly buffer: string;
  /** The element to apply now, or `undefined` when this key resolved nothing. */
  readonly element: ElementSymbol | undefined;
}

/**
 * One letter, against the buffer standing when it arrived.
 *
 * `previous` is the buffer only if the window is still open; the caller
 * clears it on the timer, so this function needs no clock of its own and is
 * a pure function a test can drive one character at a time.
 */
export function pressElementKey(
  previous: string,
  key: string,
): ElementKeyResult {
  if (!/^[a-zA-Z]$/.test(key)) return { buffer: "", element: undefined };

  // Two characters first: a letter arriving on an open one-character buffer is
  // far more likely to be completing it ("Cl") than starting a fresh symbol,
  // and if the pair is not an element we fall back to reading it as a start.
  if (previous.length === 1) {
    const pair = normalizeElementInput(previous + key.toLowerCase());
    // A NAME is not a hotkey. `normalizeElementInput("no")` is nobelium, but
    // two letters typed at a canvas mean a two-letter SYMBOL — anything whose
    // resolved symbol is not the two characters themselves came from the name
    // table and is not what the keystrokes said.
    if (pair !== undefined && pair.length === 2) {
      return { buffer: "", element: pair };
    }
  }

  const single = normalizeElementInput(key);
  if (single === undefined || single.length !== 1) {
    // Not an element start at all — B, C, N and the rest are, but J is not.
    // Closing the buffer rather than keeping it stops a stray letter from
    // silently making the NEXT letter a two-character attempt.
    return { buffer: "", element: undefined };
  }
  return {
    buffer: couldExtendElement(single) ? single : "",
    element: single,
  };
}
