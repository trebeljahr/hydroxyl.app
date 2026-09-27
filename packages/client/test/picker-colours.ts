/**
 * What a rendered control DECLARES about its own colours — the shared reading
 * the two picker-state test files do.
 *
 * WHY A HELPER AND NOT AN EYEBALL. The defect these tests guard against was
 * never a wrong colour; it was a MISSING one. An idle picker entry declared no
 * ground and no ink, so it was legible only by inheriting from the popover, and
 * a half-applied cascade left the selected entry as the only visible row. The
 * property that fixes it is structural — "every state names both of its
 * colours" — and that is a property of the class list, which is the one thing
 * jsdom can read honestly. It runs no cascade and no layout, so nothing here
 * claims a contrast ratio; the real computed colours are measured in Chromium,
 * in e2e/shell.spec.ts.
 *
 * It lives here, next to `setup.ts`, rather than in either test file, because
 * two test files ask the same question of two different components and a second
 * copy of the reading would be free to drift into agreeing with whichever
 * markup it happened to be looking at. It is test scaffolding, so it is not
 * under src/.
 */

/** The theme's ink roles, as `globals.css` defines them. `text-xs` and
 *  `text-left` share the prefix and are not colours, so the set is named
 *  rather than matched loosely. */
const INK =
  /^text-(foreground|popover-foreground|primary-foreground|accent-foreground|secondary-foreground|muted-foreground|card-foreground|current)$/;

/** The theme's ground roles. */
const GROUND = /^bg-(background|popover|primary|accent|secondary|muted|card)$/;

function classesOf(el: Element): readonly string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c !== "");
}

export interface DeclaredColours {
  /** Always-on grounds: `bg-popover`, not `hover:bg-accent`. */
  readonly ground: readonly string[];
  /** Always-on inks. */
  readonly ink: readonly string[];
}

/** The colours an element paints with NO interaction — the state the reported
 *  bug erased. A variant (`hover:`, `focus-visible:`, `disabled:`) is excluded
 *  on purpose: it cannot make a resting entry legible. */
export function declaredColours(el: Element): DeclaredColours {
  const plain = classesOf(el).filter((c) => !c.includes(":"));
  return {
    ground: plain.filter((c) => GROUND.test(c)),
    ink: plain.filter((c) => INK.test(c)),
  };
}

/** The colours an element paints under `prefix`, e.g. "hover:". */
export function variantColours(el: Element, prefix: string): DeclaredColours {
  const scoped = classesOf(el)
    .filter((c) => c.startsWith(prefix))
    .map((c) => c.slice(prefix.length));
  return {
    ground: scoped.filter((c) => GROUND.test(c)),
    ink: scoped.filter((c) => INK.test(c)),
  };
}

export function hasFocusRing(el: Element): boolean {
  const classes = classesOf(el);
  return (
    classes.includes("focus-visible:ring-2") &&
    classes.some((c) => c.startsWith("focus-visible:ring-"))
  );
}
