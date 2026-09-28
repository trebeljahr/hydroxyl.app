import { describe, expect, it } from "vitest";

import {
  COMMON_ORGANIC_ELEMENTS,
  elementBySymbol,
  labellingIsotopes,
} from "./elements.js";

describe("labellingIsotopes", () => {
  it("offers the labels a scheme actually carries", () => {
    // Deuterium and tritium; the NMR carbon and the radiocarbon; the PET
    // fluorine. If any of these went missing, the menu would stop offering
    // the label a chemist is most likely to be reaching for.
    expect(labellingIsotopes("H")).toEqual([2, 3]);
    expect(labellingIsotopes("C")).toContain(13);
    expect(labellingIsotopes("C")).toContain(14);
    expect(labellingIsotopes("N")).toContain(15);
    expect(labellingIsotopes("O")).toContain(18);
    expect(labellingIsotopes("F")).toEqual([18]);
    // Both halves of the natural pairs a mass spectrum is annotated with.
    expect(labellingIsotopes("Cl")).toEqual(expect.arrayContaining([35, 37]));
    expect(labellingIsotopes("Br")).toEqual(expect.arrayContaining([79, 81]));
  });

  it("leaves out the bare most-abundant isotope where nothing pairs with it", () => {
    // ¹²C on a carbon says nothing the symbol does not.
    expect(labellingIsotopes("C")).not.toContain(12);
    expect(labellingIsotopes("H")).not.toContain(1);
  });

  it("covers every element of the organic set, lightest first, all physically possible", () => {
    for (const symbol of COMMON_ORGANIC_ELEMENTS) {
      const masses = labellingIsotopes(symbol);
      expect(masses.length, symbol).toBeGreaterThan(0);
      expect([...masses].sort((a, b) => a - b), symbol).toEqual(masses);
      // A mass number below the proton count is not a nucleus, and one far
      // from the standard weight is a typo in the table rather than a label.
      const element = elementBySymbol(symbol)!;
      for (const mass of masses) {
        expect(mass, symbol).toBeGreaterThanOrEqual(element.z);
        expect(Math.abs(mass - element.weight), symbol).toBeLessThan(10);
      }
    }
  });

  it("answers an element outside the table with an empty list, not an error", () => {
    expect(labellingIsotopes("Pt")).toEqual([]);
    expect(labellingIsotopes("Xx")).toEqual([]);
    // `Object.hasOwn`, not `in`: an inherited key is not an element.
    expect(labellingIsotopes("constructor")).toEqual([]);
  });
});
