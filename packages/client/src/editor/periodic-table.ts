/**
 * The full periodic table behind the element picker's "Show all" entry:
 * where each element sits, which ones can be placed, how a search narrows the
 * table, and where an arrow key goes. Pure, so every rule here is tested
 * without a DOM.
 *
 * ── THE GEOMETRY COMES FROM THE ATOMIC NUMBER, NOT FROM chem-core ─────────
 *
 * `tablePosition` computes a cell from Z alone — period lengths 2, 8, 8, 18,
 * 18, 32, 32, with the f-block lifted out into two rows of its own. That is
 * deliberate: the table's job is to show the WHOLE periodic system and then
 * ask chem-core which of it the editor can handle. Laying the table out from
 * `ELEMENTS` instead would make an element chem-core lacks vanish without a
 * trace, when what the picker owes the chemist is a cell that says why it
 * cannot be placed. Today chem-core knows all 118 and nothing is refused; the
 * refusal path is here so the day that changes, the table says so rather than
 * silently shrinking. The test checks the computed geometry against
 * chem-core's own `group` and `period` for every element, so the two cannot
 * disagree about where anything is.
 *
 * ── ROWS ──────────────────────────────────────────────────────────────────
 *
 * Rows 1-7 are the periods. Rows 8 and 9 are the lanthanides and actinides,
 * drawn under the main table the way nearly every printed table draws them,
 * starting under group 3 so lanthanum sits below the gap it was lifted from.
 * Group 3 of periods 6 and 7 holds a marker pointing down at them.
 */

import { elementByZ } from "@starter/chem-core";
import type { ElementCategory, ElementInfo } from "@starter/chem-core";

export const TABLE_COLUMNS = 18;
/** Seven periods plus the two f-block rows. */
export const TABLE_ROWS = 9;
export const LANTHANIDE_ROW = 8;
export const ACTINIDE_ROW = 9;
/** The heaviest element with an IUPAC name; the geometry stops here. */
export const LAST_ELEMENT_Z = 118;

export interface TablePosition {
  /** 1-9: the seven periods, then the lanthanide and actinide rows. */
  readonly row: number;
  /** 1-18. */
  readonly column: number;
}

/** The last atomic number in each period. */
const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118] as const;

/**
 * Where element `z` sits in the 18-column table.
 *
 * Throws outside 1-118: there is no agreed cell for element 119, and a
 * guessed one would be a drawing of chemistry nobody has done.
 */
export function tablePosition(z: number): TablePosition {
  if (!Number.isInteger(z) || z < 1 || z > LAST_ELEMENT_Z) {
    throw new RangeError(`No periodic-table cell for atomic number ${String(z)}`);
  }
  const periodIndex = PERIOD_ENDS.findIndex((end) => z <= end);
  const period = periodIndex + 1;
  const start = periodIndex === 0 ? 1 : PERIOD_ENDS[periodIndex - 1]! + 1;
  const k = z - start; // 0-based index within the period

  if (period === 1) return { row: 1, column: k === 0 ? 1 : 18 };
  if (period <= 3) return { row: period, column: k < 2 ? k + 1 : k + 11 };
  if (period <= 5) return { row: period, column: k + 1 };
  // Periods 6 and 7: s-block, then fifteen f-block elements (La-Lu, Ac-Lr)
  // lifted into their own row under group 3, then the d- and p-blocks
  // resuming at group 4.
  if (k < 2) return { row: period, column: k + 1 };
  if (k < 17) {
    return { row: period === 6 ? LANTHANIDE_ROW : ACTINIDE_ROW, column: k + 1 };
  }
  return { row: period, column: k - 13 };
}

/** The group-3 markers standing in for the lifted f-block rows. */
export interface FBlockMarker {
  readonly row: 6 | 7;
  readonly column: 3;
  /** What the cell shows: the atomic-number range it stands for. */
  readonly text: string;
  /** What a screen reader hears. */
  readonly label: string;
}

export const F_BLOCK_MARKERS: readonly FBlockMarker[] = Object.freeze([
  Object.freeze<FBlockMarker>({
    row: 6,
    column: 3,
    text: "57–71",
    label: "Lanthanides, 57 to 71: the first row below the table",
  }),
  Object.freeze<FBlockMarker>({
    row: 7,
    column: 3,
    text: "89–103",
    label: "Actinides, 89 to 103: the second row below the table",
  }),
]);

export interface PeriodicCell extends TablePosition {
  readonly z: number;
  /** Undefined when chem-core has no row for this atomic number. */
  readonly element: ElementInfo | undefined;
  readonly placeable: boolean;
  /** Why the cell is refused. Present exactly when `placeable` is false. */
  readonly reason?: string;
}

/**
 * Every cell, in atomic-number order, each asked of chem-core.
 *
 * `lookup` is injectable so a test can hand the table a chem-core that lacks
 * an element and watch the refusal render — with the real one, every lookup
 * succeeds.
 */
export function buildPeriodicTable(
  lookup: (z: number) => ElementInfo | undefined = elementByZ,
): readonly PeriodicCell[] {
  const cells: PeriodicCell[] = [];
  for (let z = 1; z <= LAST_ELEMENT_Z; z++) {
    const element = lookup(z);
    const position = tablePosition(z);
    cells.push(
      element === undefined
        ? {
            z,
            ...position,
            element,
            placeable: false,
            reason:
              `chem-core has no data for element ${String(z)}, so its hydrogens, ` +
              "formula and mass cannot be worked out.",
          }
        : { z, ...position, element, placeable: true },
    );
  }
  return cells;
}

const CATEGORY_TITLES: Readonly<Record<ElementCategory, string>> = {
  nonmetal: "nonmetal",
  noble: "noble gas",
  alkali: "alkali metal",
  alkaline: "alkaline earth metal",
  metalloid: "metalloid",
  halogen: "halogen",
  transition: "transition metal",
  "post-transition": "post-transition metal",
  lanthanide: "lanthanide",
  actinide: "actinide",
};

export function categoryTitle(category: ElementCategory): string {
  return CATEGORY_TITLES[category];
}

/** "Platinum (Pt)" — the same name the quick picker gives an element. */
export function elementLabel(element: ElementInfo): string {
  return `${element.name} (${element.symbol})`;
}

/**
 * What placing this element will and will not give the chemist, read off the
 * data chem-core actually holds. None of these refuse the element; each is a
 * thing the drawing will visibly lack, said before rather than discovered.
 */
export function elementNotes(element: ElementInfo): readonly string[] {
  const notes: string[] = [];
  if (element.valences.length === 0) {
    notes.push(
      "No hydrogens are added to it automatically. Draw them, or set Explicit H in the properties panel.",
    );
  } else if (element.valences.every((valence) => valence === 0)) {
    notes.push("It takes no bonds. A bond drawn to it is reported as over-valent.");
  }
  if (element.monoisotopic === undefined) {
    notes.push("No exact mass: chem-core holds no verified monoisotopic value for it.");
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * How well `query` names `element`, lower is better, or undefined for no
 * match. An exact symbol beats an exact name beats an atomic number beats a
 * prefix of either, so Enter on "s" picks sulfur ahead of scandium, silicon
 * and sodium, all of which the search still shows. A number only ever matches
 * exactly: "7" is nitrogen, not every element from 70 to 79.
 */
function matchRank(element: ElementInfo, query: string): number | undefined {
  const q = query.trim().toLowerCase();
  if (q === "") return undefined;
  const symbol = element.symbol.toLowerCase();
  const name = element.name.toLowerCase();
  if (symbol === q) return 0;
  if (name === q) return 1;
  if (/^\d+$/.test(q)) return String(element.z) === q ? 2 : undefined;
  if (symbol.startsWith(q)) return 3;
  if (name.startsWith(q)) return 4;
  return undefined;
}

/**
 * The atomic numbers of every cell `query` matches, by symbol, by name or by
 * atomic number. An empty query matches everything. A refused cell with no
 * element data can only be found by its number, since it has no name.
 */
export function matchingCells(
  cells: readonly PeriodicCell[],
  query: string,
): ReadonlySet<number> {
  if (query.trim() === "") return new Set(cells.map((cell) => cell.z));
  const q = query.trim();
  const out = new Set<number>();
  for (const cell of cells) {
    if (cell.element === undefined) {
      if (String(cell.z) === q) out.add(cell.z);
      continue;
    }
    if (matchRank(cell.element, q) !== undefined) out.add(cell.z);
  }
  return out;
}

/**
 * The cell Enter in the search box picks: the best-ranked PLACEABLE match,
 * ties to the lower atomic number. Undefined when nothing placeable matches,
 * so Enter over a refused-only result does nothing rather than something
 * surprising.
 */
export function bestMatch(
  cells: readonly PeriodicCell[],
  query: string,
): PeriodicCell | undefined {
  let best: PeriodicCell | undefined;
  let bestRank = Infinity;
  for (const cell of cells) {
    if (!cell.placeable || cell.element === undefined) continue;
    const rank = matchRank(cell.element, query);
    if (rank === undefined || rank >= bestRank) continue;
    best = cell;
    bestRank = rank;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Keyboard movement
// ---------------------------------------------------------------------------

export type TableKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "CtrlHome"
  | "CtrlEnd";

/**
 * Where `key` moves the focus from cell `fromZ`, among `cells` (the ones
 * currently shown — a search narrows what the arrows can reach). Returns
 * `fromZ` when there is nowhere to go; the focus never wraps, because a
 * right arrow at argon landing on potassium reads as a jump, not a step.
 *
 * Left and right stay in the row and skip the gaps. Up and down go to the
 * nearest shown cell in the next row that has one, measured by column, ties
 * to the left; the gap rows of the first three periods are simply stepped
 * over, which is what makes down from hydrogen land on lithium.
 */
export function moveInTable(
  cells: readonly PeriodicCell[],
  fromZ: number,
  key: TableKey,
): number {
  const from = cells.find((cell) => cell.z === fromZ);
  if (from === undefined) return cells[0]?.z ?? fromZ;
  const byPosition = [...cells].sort((a, b) => a.row - b.row || a.column - b.column);

  switch (key) {
    case "CtrlHome":
      return byPosition[0]?.z ?? fromZ;
    case "CtrlEnd":
      return byPosition[byPosition.length - 1]?.z ?? fromZ;
    case "Home":
    case "End": {
      const row = byPosition.filter((cell) => cell.row === from.row);
      const target = key === "Home" ? row[0] : row[row.length - 1];
      return target?.z ?? fromZ;
    }
    case "ArrowLeft":
    case "ArrowRight": {
      const row = byPosition.filter((cell) => cell.row === from.row);
      const index = row.findIndex((cell) => cell.z === fromZ);
      const target = row[index + (key === "ArrowLeft" ? -1 : 1)];
      return target?.z ?? fromZ;
    }
    case "ArrowUp":
    case "ArrowDown": {
      const step = key === "ArrowUp" ? -1 : 1;
      for (let row = from.row + step; row >= 1 && row <= TABLE_ROWS; row += step) {
        const candidates = byPosition.filter((cell) => cell.row === row);
        if (candidates.length === 0) continue;
        let best = candidates[0]!;
        for (const cell of candidates) {
          if (Math.abs(cell.column - from.column) < Math.abs(best.column - from.column)) {
            best = cell;
          }
        }
        return best.z;
      }
      return fromZ;
    }
  }
}
