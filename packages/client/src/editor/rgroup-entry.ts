/**
 * The element tool's "R" entry (decision 238).
 *
 * Not an element: `toolOptions.element` holds this string so the rail, the
 * popover and the periodic table can show it as one more symbol to pick, and
 * every place that turns the option into an atom asks `isRGroupEntry` first.
 * An atom placed with it becomes the NEXT numbered R-group — R1, then R2 —
 * through chem-core's `makeRGroup`, which owns the numbering.
 */
export const RGROUP_ENTRY = "R";

export function isRGroupEntry(symbol: string): boolean {
  return symbol === RGROUP_ENTRY;
}

/**
 * The element to mint a new atom as before it is made an R-group, or the
 * symbol itself for a real element. A chain drawn with "R" armed is drawn in
 * carbon: a run of R-groups bonded to one another is not a Markush drawing.
 */
export function elementForNewAtom(symbol: string): string {
  return isRGroupEntry(symbol) ? "C" : symbol;
}
