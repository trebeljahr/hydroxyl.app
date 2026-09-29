/**
 * Atomic masses of individual nuclides, for isotope-labelled atoms.
 *
 * An atom carrying `isotope: 13` is carbon-13, and it weighs 13.0034 u, not
 * the 12.0000 of the carbon-12 that `ElementInfo.monoisotopic` records. The
 * element table answers "what does a carbon weigh"; this answers "what does
 * THIS carbon weigh", which is the question a labelled figure asks. Before it
 * existed, `exactMass` bucketed atoms by element alone, so [1-¹³C]benzene
 * reported benzene's 78.0470 instead of 79.0503 (decision 118).
 *
 * SOURCE. Every value below is the atomic mass from AME2020 — W.J. Huang,
 * M. Wang, F.G. Kondev, G. Audi and S. Naimi, "The Ame2020 atomic mass
 * evaluation (I)", Chinese Physics C 45, 030002 (2021), with part (II) in
 * the same volume, 030003 — taken from the unrounded file `mass_1.mas20.txt`
 * the IAEA AMDC distributes, converted from micro-u and not rounded further.
 * The rows were generated from that file, not typed, and none of them is an
 * estimated (#) value. The client's `nuclide-masses.node.test.ts` checks each
 * one against the pinned RDKit's own table, whose NIST values agree to the
 * five decimals RDKit reports.
 *
 * COVERAGE: every mass number `labellingIsotopes` offers, less each element's
 * most abundant isotope. That one is already `monoisotopic` in the element
 * table, and `nuclideMass` reads it from there, so a label naming it (¹²C,
 * ¹H, ³⁵Cl, and ⁵⁶Fe on an element with no curated labels at all) can never
 * move a mass, even in the ninth decimal. Checked when this table was
 * written: those `monoisotopic` values agree with AME2020 to within 5×10⁻⁶ u
 * for every element here, below the four decimals a mass is quoted to.
 *
 * ANY OTHER LABEL HAS NO MASS HERE, and `nuclideMass` says so with
 * `undefined` rather than guessing. The mass number is not a stand-in: it is
 * 0.094 u off for ¹³¹I, which shows at the fourth decimal. Nor is the
 * element's weight, which was the bug. A nuclide someone needs (⁶⁴Cu, ⁶⁸Ga,
 * ⁸⁹Zr for a radiometal complex) is added as a row from the same file.
 */

import { requireElement } from "./elements.js";
import type { ElementSymbol } from "./elements.js";

/** Atomic mass in u, keyed by element symbol, then by mass number. */
const NUCLIDE_MASSES: Readonly<Record<ElementSymbol, Readonly<Record<number, number>>>> =
  Object.freeze({
    H: Object.freeze({ 2: 2.014101777844, 3: 3.01604928132 }),
    B: Object.freeze({ 10: 10.012936862 }),
    C: Object.freeze({ 11: 11.011432597, 13: 13.00335483534, 14: 14.00324198862 }),
    N: Object.freeze({ 13: 13.005738609, 15: 15.00010889827 }),
    O: Object.freeze({ 15: 15.003065636, 17: 16.99913175595, 18: 17.99915961214 }),
    F: Object.freeze({ 18: 18.000937324 }),
    Si: Object.freeze({ 29: 28.97649466434, 30: 29.973770137 }),
    P: Object.freeze({ 32: 31.973907643, 33: 32.971725692 }),
    S: Object.freeze({ 33: 32.97145890862, 34: 33.967867011, 35: 34.969032321 }),
    Cl: Object.freeze({ 36: 35.968306822, 37: 36.965902573 }),
    Se: Object.freeze({ 75: 74.92252287, 77: 76.91991415 }),
    Br: Object.freeze({ 76: 75.924541574, 81: 80.916288197 }),
    I: Object.freeze({
      123: 122.905589753,
      124: 123.906210297,
      125: 124.90463061,
      131: 130.906126375,
    }),
  });

/**
 * Atomic mass of the nuclide `massNumber` of `symbol`, in u, or undefined when
 * it is not on record. Throws only for an unknown element symbol, as
 * `requireElement` does.
 */
export function nuclideMass(symbol: ElementSymbol, massNumber: number): number | undefined {
  // The element's own reference nuclide first. Rounding its mass recovers its
  // mass number exactly, since no stable nuclide sits more than about 0.1 u
  // from one; molblock-read.ts takes the same reference for a V2000 `dd`.
  const mono = requireElement(symbol).monoisotopic;
  if (mono !== undefined && Math.round(mono) === massNumber) return mono;
  const row = Object.hasOwn(NUCLIDE_MASSES, symbol) ? NUCLIDE_MASSES[symbol] : undefined;
  return row !== undefined && Object.hasOwn(row, massNumber) ? row[massNumber] : undefined;
}
