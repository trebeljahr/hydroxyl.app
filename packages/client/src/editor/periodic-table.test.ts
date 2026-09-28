import { describe, expect, it } from "vitest";
import { ELEMENTS, elementBySymbol, elementByZ } from "@starter/chem-core";

import {
  ACTINIDE_ROW,
  F_BLOCK_MARKERS,
  LANTHANIDE_ROW,
  bestMatch,
  buildPeriodicTable,
  elementNotes,
  matchingCells,
  moveInTable,
  tablePosition,
} from "./periodic-table";
import type { PeriodicCell, TableKey } from "./periodic-table";

const TABLE = buildPeriodicTable();

function z(symbol: string): number {
  const element = elementBySymbol(symbol);
  if (element === undefined) throw new Error(`no element ${symbol}`);
  return element.z;
}

function symbolAt(cells: readonly PeriodicCell[], atomicNumber: number): string {
  return cells.find((cell) => cell.z === atomicNumber)?.element?.symbol ?? "?";
}

function move(from: string, ...keys: TableKey[]): string {
  let at = z(from);
  for (const key of keys) at = moveInTable(TABLE, at, key);
  return symbolAt(TABLE, at);
}

describe("tablePosition", () => {
  it("agrees with chem-core's own group and period for every element", () => {
    // The geometry is computed from Z alone, so it can place an element
    // chem-core lacks; this is what stops the two from disagreeing about the
    // ones it has.
    for (const element of ELEMENTS) {
      const { row, column } = tablePosition(element.z);
      if (element.group === 0) {
        expect(row, element.symbol).toBe(element.period === 6 ? LANTHANIDE_ROW : ACTINIDE_ROW);
      } else {
        expect(row, element.symbol).toBe(element.period);
        expect(column, element.symbol).toBe(element.group);
      }
    }
  });

  it("puts lanthanum and actinium under group 3, and lutetium and lawrencium under group 17", () => {
    expect(tablePosition(z("La"))).toEqual({ row: LANTHANIDE_ROW, column: 3 });
    expect(tablePosition(z("Lu"))).toEqual({ row: LANTHANIDE_ROW, column: 17 });
    expect(tablePosition(z("Ac"))).toEqual({ row: ACTINIDE_ROW, column: 3 });
    expect(tablePosition(z("Lr"))).toEqual({ row: ACTINIDE_ROW, column: 17 });
  });

  it("gives every element its own cell, clear of the f-block markers", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 118; n++) {
      const { row, column } = tablePosition(n);
      const key = `${String(row)}:${String(column)}`;
      expect(seen.has(key), `element ${String(n)} collides at ${key}`).toBe(false);
      seen.add(key);
    }
    for (const marker of F_BLOCK_MARKERS) {
      expect(seen.has(`${String(marker.row)}:${String(marker.column)}`)).toBe(false);
    }
  });

  it("refuses an atomic number with no agreed cell", () => {
    expect(() => tablePosition(0)).toThrow(RangeError);
    expect(() => tablePosition(119)).toThrow(RangeError);
    expect(() => tablePosition(1.5)).toThrow(RangeError);
  });
});

describe("buildPeriodicTable", () => {
  it("places all 118 elements, because chem-core knows all of them", () => {
    expect(TABLE).toHaveLength(118);
    expect(TABLE.every((cell) => cell.placeable)).toBe(true);
    expect(TABLE.every((cell) => cell.reason === undefined)).toBe(true);
  });

  it("refuses, with a reason, an element chem-core has no data for", () => {
    const withoutPlatinum = buildPeriodicTable((n) => (n === 78 ? undefined : elementByZ(n)));
    const platinum = withoutPlatinum.find((cell) => cell.z === 78)!;
    expect(platinum.placeable).toBe(false);
    expect(platinum.element).toBeUndefined();
    expect(platinum.reason).toMatch(/chem-core has no data for element 78/);
    // Still in the table, in its own cell: a missing element is shown, not
    // silently dropped.
    expect(platinum.row).toBe(6);
    expect(platinum.column).toBe(10);
  });
});

describe("search", () => {
  const symbols = (query: string): string[] =>
    [...matchingCells(TABLE, query)].map((n) => symbolAt(TABLE, n));

  it("matches by symbol, by name and by atomic number, ignoring case", () => {
    expect(symbols("Pt")).toEqual(["Pt"]);
    expect(symbols("PLATINUM")).toEqual(["Pt"]);
    expect(symbols("78")).toEqual(["Pt"]);
    expect(symbols("sel")).toEqual(["Se"]);
  });

  it("treats a number as exact, not as a prefix", () => {
    expect(symbols("7")).toEqual(["N"]);
  });

  it("shows every prefix match and lets Enter take the best one", () => {
    const s = symbols("s");
    for (const expected of ["S", "Si", "Se", "Sc", "Na", "Ag"]) {
      // Sodium and silver come in by NAME, which is the point of searching by
      // name: nobody guesses "Na" and "Ag" from "s".
      expect(s, expected).toContain(expected);
    }
    expect(bestMatch(TABLE, "s")?.element?.symbol).toBe("S");
    expect(bestMatch(TABLE, "sodium")?.element?.symbol).toBe("Na");
    expect(bestMatch(TABLE, "in")?.element?.symbol).toBe("In");
  });

  it("matches everything on an empty query and nothing on nonsense", () => {
    expect(matchingCells(TABLE, "  ").size).toBe(118);
    expect(matchingCells(TABLE, "xyz").size).toBe(0);
    expect(bestMatch(TABLE, "xyz")).toBeUndefined();
  });

  it("never picks a refused cell, and finds one only by number", () => {
    const withoutPlatinum = buildPeriodicTable((n) => (n === 78 ? undefined : elementByZ(n)));
    expect([...matchingCells(withoutPlatinum, "78")]).toEqual([78]);
    expect(bestMatch(withoutPlatinum, "78")).toBeUndefined();
  });
});

describe("moveInTable", () => {
  it("steps along a row and over its gaps", () => {
    expect(move("H", "ArrowRight")).toBe("He");
    expect(move("Be", "ArrowRight")).toBe("B");
    expect(move("B", "ArrowLeft")).toBe("Be");
  });

  it("does not wrap at the end of a row", () => {
    expect(move("Ar", "ArrowRight")).toBe("Ar");
    expect(move("K", "ArrowLeft")).toBe("K");
  });

  it("goes down a group, stepping over the gap rows", () => {
    expect(move("H", "ArrowDown")).toBe("Li");
    expect(move("He", "ArrowDown")).toBe("Ne");
    expect(move("Ni", "ArrowDown", "ArrowDown")).toBe("Pt");
    expect(move("Pt", "ArrowUp")).toBe("Pd");
  });

  it("moves between the main table and the f-block rows", () => {
    expect(move("La", "ArrowDown")).toBe("Ac");
    // Down from oganesson reaches the lanthanide row's nearest column.
    expect(move("Og", "ArrowDown")).toBe("Lu");
    // Up from lanthanum passes the group-3 marker, which is not a cell, and
    // lands on the nearest element, ties to the left.
    expect(move("La", "ArrowUp")).toBe("Ra");
  });

  it("jumps to the ends of a row and of the table", () => {
    expect(move("Fe", "Home")).toBe("K");
    expect(move("Fe", "End")).toBe("Kr");
    expect(move("Fe", "CtrlHome")).toBe("H");
    expect(move("Fe", "CtrlEnd")).toBe("Lr");
  });

  it("only reaches the cells a search left on screen", () => {
    const shown = matchingCells(TABLE, "s");
    const visible = TABLE.filter((cell) => shown.has(cell.z));
    // Sulfur's row keeps sodium and silicon, so the arrows step between those.
    expect(symbolAt(TABLE, moveInTable(visible, z("S"), "ArrowLeft"))).toBe("Si");
    expect(symbolAt(TABLE, moveInTable(visible, z("Si"), "ArrowLeft"))).toBe("Na");
  });
});

describe("elementNotes", () => {
  it("says nothing about carbon, which the drawing handles completely", () => {
    expect(elementNotes(elementBySymbol("C")!)).toEqual([]);
  });

  it("warns that a metal gets no automatic hydrogens", () => {
    expect(elementNotes(elementBySymbol("Pt")!).join(" ")).toMatch(/No hydrogens are added/);
  });

  it("warns that a noble gas takes no bonds", () => {
    expect(elementNotes(elementBySymbol("Ne")!).join(" ")).toMatch(/takes no bonds/);
    // Xenon carries real valences and so gets no such warning.
    expect(elementNotes(elementBySymbol("Xe")!).join(" ")).not.toMatch(/takes no bonds/);
  });

  it("warns when there is no verified exact mass", () => {
    expect(elementNotes(elementBySymbol("Sc")!).join(" ")).toMatch(/No exact mass/);
    expect(elementNotes(elementBySymbol("Se")!).join(" ")).not.toMatch(/No exact mass/);
  });
});
