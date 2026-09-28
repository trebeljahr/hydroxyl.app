/**
 * Shared by every picker in the shell — the rail's option popovers and the
 * full periodic table behind the element picker's "Show all" — so "selected",
 * "unavailable" and "idle" are the same picture wherever an element can be
 * chosen, and the contrast the e2e measures on one holds for the other.
 */

import { cn } from "@/lib/utils";

/**
 * THE FOUR STATES A PICKER ENTRY CAN BE IN, EACH NAMING BOTH OF ITS COLOURS.
 *
 * WHY AN IDLE ENTRY STATES A GROUND AND AN INK IT APPEARS NOT TO NEED. It used
 * to state neither: the inactive branch was `hover:bg-accent
 * hover:text-accent-foreground` and nothing else, so an idle entry had no
 * background of its own and was legible only by INHERITING
 * `text-popover-foreground` from `PopoverContent`. The selected entry was the
 * one entry that named both a background and a foreground. So any hiccup in the
 * cascade — a stylesheet applied half-way, a token that failed to resolve, a
 * stale chunk served after a deploy — erased every entry EXCEPT the selected
 * one, which is exactly the "the pickers are weirdly transparent and the chain
 * numbers do not show" report this function answers. An entry that names its own
 * ground can lose only the token it names; it cannot take its siblings with it.
 *
 * NO STATE IS THE ABSENCE OF A CLASS. `bg-popover` on an entry inside a popover
 * paints the colour the entry would have inherited anyway, and that is the
 * point: the declaration IS the repair.
 *
 * DISABLED WINS OVER SELECTED. An armed option that has become unavailable has
 * to read as unavailable; painting it `bg-primary` would invite a click that
 * does nothing.
 */
export const PICKER_ENTRY_BASE = cn(
  "rounded transition-colors",
  // The element grid had no focus ring at all, so a keyboard user could not see
  // where they stood among thirteen identical cells.
  "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
);

export function pickerEntryClasses({
  active,
  disabled,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
}): string {
  if (disabled) {
    // Deliberately no hover pair: an entry that lights up under the cursor and
    // then refuses the click is worse than one that never lights up.
    //
    // THE GROUND IS `bg-popover` AND NOT `bg-muted`, WHICH IS WHY IT LOOKS LIKE
    // THE IDLE GROUND. `text-muted-foreground` on `bg-muted` measures 4.35:1 in
    // light mode (hsl 45.1% ink on hsl 96.1% ground), under the 4.5:1 floor the
    // e2e holds every other state to; on `bg-popover` the same ink measures
    // 4.74:1. WCAG 1.4.3 would exempt an inactive control from the floor
    // altogether, but "the one state we let fall below the bar is the one no
    // test can reach" is how a bar stops meaning anything. It also lands the
    // disabled entry on exactly the ink-and-ground pair this app already uses
    // for a genuinely disabled control — the `showLocants` label in
    // `RepresentationSwitcher` — so "refused" reads the same wherever it
    // appears. The ground is still NAMED rather than inherited, which is the
    // property that matters here.
    return cn(
      PICKER_ENTRY_BASE,
      "bg-popover text-muted-foreground cursor-not-allowed",
    );
  }
  if (active) {
    return cn(PICKER_ENTRY_BASE, "bg-primary text-primary-foreground");
  }
  return cn(
    PICKER_ENTRY_BASE,
    "bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground",
  );
}
