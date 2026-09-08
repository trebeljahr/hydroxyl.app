/**
 * C vs Cl vs Ca, one keystroke at a time.
 *
 * The buffer is a pure function of (previous buffer, key), so the whole
 * ambiguity is testable without a clock, a store or a DOM — the caller owns
 * the window that decides when `previous` is still live.
 */

import { describe, expect, it } from "vitest";

import {
  couldExtendElement,
  isPendingPrefix,
  pressElementKey,
} from "./element-buffer";

/** Type a run of letters and report what each one resolved to. */
function type(keys: string): {
  readonly elements: (string | undefined)[];
  readonly buffer: string;
} {
  let buffer = "";
  const elements: (string | undefined)[] = [];
  for (const key of keys) {
    const outcome = pressElementKey(buffer, key);
    buffer = outcome.buffer;
    elements.push(outcome.element);
  }
  return { elements, buffer };
}

describe("the element hotkey buffer", () => {
  it("resolves C, Cl and Ca from the same first keystroke", () => {
    expect(type("c").elements).toEqual(["C"]);
    expect(type("cl").elements).toEqual(["C", "Cl"]);
    expect(type("ca").elements).toEqual(["C", "Ca"]);
  });

  it("applies the one-letter element IMMEDIATELY rather than waiting", () => {
    // The common case must not be laggy: a chemist pressing C wants carbon
    // now, and the second character corrects it if one arrives.
    const first = pressElementKey("", "c");
    expect(first.element).toBe("C");
    expect(first.buffer).toBe("C");
  });

  it("closes the window when no longer symbol could follow", () => {
    // No element symbol begins with K except K and Kr — Kr can follow, so K
    // stays open. F has Fe/Fr/Fl/Fm, also open. But once two characters are
    // in, nothing longer is worth waiting for.
    expect(pressElementKey("F", "e").buffer).toBe("");
    expect(pressElementKey("F", "e").element).toBe("Fe");
  });

  it("reads a second letter that makes no symbol as a fresh start", () => {
    // "Nn" is not an element, so the second N means nitrogen again rather
    // than swallowing the keystroke.
    expect(type("nn").elements).toEqual(["N", "N"]);
    expect(type("cc").elements).toEqual(["C", "C"]);
  });

  it("never resolves a NAME, only a symbol", () => {
    // `normalizeElementInput("no")` is nobelium BY NAME. Two letters typed at
    // a canvas mean a two-letter SYMBOL, and "No" happens to be one — but
    // "he" must be helium the symbol, not something the name table invented.
    expect(pressElementKey("H", "e").element).toBe("He");
    // "Ir" is iridium the symbol.
    expect(pressElementKey("I", "r").element).toBe("Ir");
  });

  it("ignores a letter that starts no element at all", () => {
    // No symbol begins with J, so it resolves nothing and leaves no buffer to
    // make the NEXT letter a two-character attempt.
    const outcome = pressElementKey("", "j");
    expect(outcome.element).toBeUndefined();
    expect(outcome.buffer).toBe("");
  });

  it("ignores anything that is not a letter", () => {
    expect(pressElementKey("C", "1").element).toBeUndefined();
    expect(pressElementKey("C", "1").buffer).toBe("");
  });

  it("knows which single letters can still grow", () => {
    expect(couldExtendElement("C")).toBe(true);
    expect(couldExtendElement("N")).toBe(true);
    // Nothing begins with "Cl" but "Cl" itself.
    expect(couldExtendElement("Cl")).toBe(false);
  });
});

describe("a first letter that is not an element on its own", () => {
  it("is held as a pending prefix instead of being thrown away", () => {
    // The hole this closes: "Li" used to arm IODINE. `l` resolved to nothing,
    // the buffer was cleared, and `i` was then read as a fresh start — so
    // every two-letter symbol whose first letter is not itself an element was
    // either unreachable or silently the wrong element.
    const first = pressElementKey("", "l");
    expect(first.element).toBeUndefined();
    expect(first.buffer).toBe("L");
    expect(pressElementKey(first.buffer, "i").element).toBe("Li");
  });

  it("reaches the whole class the old buffer could not", () => {
    for (const [keys, symbol] of [
      ["li", "Li"],
      ["al", "Al"],
      ["ar", "Ar"],
      ["ag", "Ag"],
      ["au", "Au"],
      ["mg", "Mg"],
      ["mn", "Mn"],
      ["ti", "Ti"],
      ["te", "Te"],
      ["as", "As"],
    ] as const) {
      expect(type(keys).elements.at(-1), keys).toBe(symbol);
    }
  });

  it("holds nothing for a letter that begins no symbol at all", () => {
    // J and Q start nothing. Keeping them would make the NEXT letter a
    // two-character attempt against a prefix that can never complete.
    for (const key of ["j", "q"]) {
      expect(pressElementKey("", key)).toEqual({
        buffer: "",
        element: undefined,
      });
    }
  });

  it("tells a pending prefix apart from an applied one", () => {
    // The distinction the key layer needs: "L" has applied nothing and so may
    // claim the next keystroke ahead of a tool letter; "C" has already put
    // carbon on the atom and may not.
    expect(isPendingPrefix("L")).toBe(true);
    expect(isPendingPrefix("M")).toBe(true);
    expect(isPendingPrefix("C")).toBe(false);
    expect(isPendingPrefix("S")).toBe(false);
    expect(isPendingPrefix("")).toBe(false);
  });
});
