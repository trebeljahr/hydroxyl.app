/**
 * The chemistry glyphs the tool rail draws, as inline React components.
 *
 * WHY INLINE AND NOT `<img src="/toolbar-icons/single-bond.svg">`. An external
 * SVG loaded through `<img>` is an isolated document: it cannot see the page's
 * CSS, so `currentColor` resolves to its own initial value (black) and the
 * icon stays black on a pressed dark button and invisible in a dark theme. The
 * active/inactive and light/dark states of this rail are exactly what the icon
 * has to answer to, so the markup has to be in the page.
 *
 * THE CONVERSION WAS A NORMALISATION PASS, NOT A WRAPPER. The salvaged files
 * in `public/toolbar-icons/` needed all of the following, and every one of
 * them is a real defect rather than a matter of taste:
 *
 * - hardcoded `#000` / `#000000` on every stroke and fill, which is the thing
 *   that has to become `currentColor`;
 * - seven of the thirteen carry NO `viewBox` at all, so they cannot scale;
 * - `single-bond.svg` and `hash-bond.svg` declare `viewBox="0 0 32 32"` while
 *   their geometry runs past 32, so they clip;
 * - five carry `transform="rotate(45)"` on the outermost `<svg>`, which is an
 *   SVG-2-only feature that rotates about (0,0) — throwing most of a 40x40
 *   icon off-canvas in the renderers that honour it at all. The rotations were
 *   dropped: the bond geometry is already diagonal without them;
 * - `wedge-bond.svg` carries the SAME `transform` attribute twice;
 * - `benzene.svg` and `circular-benzene.svg` are FILL-based outlines at
 *   `0 0 512 512`, three times the optical weight of the 4px strokes in the
 *   rest of the set. They are redrawn here on the same hexagon the salvaged
 *   `cyclohexane.svg` uses, so a rail of ring buttons reads as one family.
 *
 * `cyclopropane` and `cyclobutane` had no salvaged art at all, though
 * `RING_TEMPLATES` offers both; they are drawn to match.
 *
 * Everything is stroked in `currentColor` with `fill="none"` except the wedge,
 * which is a filled triangle by definition — a wedge that did not fill would
 * be a hollow quadrilateral, which means nothing in a structure drawing.
 */

import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ChemIconProps {
  readonly className?: string;
}

/**
 * The shared frame. `aria-hidden` on every one of them: an icon inside a
 * button whose accessible name comes from the button is decoration, and a
 * second announcement of "single bond" is noise for a screen-reader user.
 */
function Glyph({
  viewBox,
  strokeWidth,
  className,
  children,
}: {
  readonly viewBox: string;
  readonly strokeWidth: number;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <svg
      viewBox={viewBox}
      className={cn("size-5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------

export function SingleBondIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <path d="M1.5 27.2 38.5 12.4" />
    </Glyph>
  );
}

export function DoubleBondIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <path d="M3.5 29.5 38.5 15.5M1.5 24.5 36.5 10.5" />
    </Glyph>
  );
}

export function TripleBondIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={2.6} className={props.className}>
      <path d="M3.4 26.76 36.6 13.47M5.3 31.5 38.5 18.22M1.5 22.01 34.71 8.73" />
    </Glyph>
  );
}

/**
 * The narrow end is at the LEFT, matching the model's rule that a wedge
 * narrows at the bond's `from` atom — the atom it was drawn from.
 */
export function WedgeBondIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={1.5} className={props.className}>
      <path d="M2 29.2 38 20.44 34.11 10.71Z" fill="currentColor" />
    </Glyph>
  );
}

export function HashBondIcon(props: ChemIconProps): ReactElement {
  // Nine bars widening along the bond, which is the convention: the wide end
  // is the one coming towards the reader's near side of the page.
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={2} className={props.className}>
      <path
        d="M4.6 28.9 2.6 24.0M9.0 27.5 6.2 20.7M13.4 26.1 9.8 17.4
           M17.8 24.6 13.4 14.1M22.2 23.2 17.0 10.8M26.6 21.8 20.6 7.5
           M31.0 20.4 24.2 4.2M35.4 18.9 27.8 0.9"
      />
    </Glyph>
  );
}

export function WaveBondIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={2.6} className={props.className}>
      <g transform="rotate(-20 20 20)">
        <path d="M4 20q4.5-8 9 0t9 0 9 0 5 0" />
      </g>
    </Glyph>
  );
}

// ---------------------------------------------------------------------------
// Rings
//
// Every ring is drawn on the same circumscribed circle so a rail of them reads
// as one family, and the hexagon is the one salvaged from `cyclohexane.svg`.
// ---------------------------------------------------------------------------

const HEXAGON = "M20 2 35.59 11 35.59 29 20 38 4.41 29 4.41 11Z";

export function CyclopropaneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d="M20 4 33.86 28 6.14 28Z" />
    </Glyph>
  );
}

export function CyclobutaneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d="M7 7H33V33H7Z" />
    </Glyph>
  );
}

export function CyclopentaneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d="M20 3.44 37.12 15.88 30.58 36 9.42 36 2.88 15.88Z" />
    </Glyph>
  );
}

export function CyclohexaneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d={HEXAGON} />
    </Glyph>
  );
}

export function CycloheptaneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d="M20 2.78 34.07 9.56 37.55 24.79 27.81 37 12.19 37 2.45 24.79 5.93 9.56Z" />
    </Glyph>
  );
}

/** Kekule benzene: the hexagon plus three alternating inner lines. */
export function BenzeneIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <path d={HEXAGON} />
      <path d="M31.6 13.5V26.5M8.4 13.31 20 6.61M8.4 26.69 20 33.39" />
    </Glyph>
  );
}

/**
 * The aromatic circle. NOT a ring template — this is the per-panel
 * `aromaticCircles` display toggle, which is why it lives beside the rings but
 * is not one of them.
 */
export function AromaticCircleIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <path d={HEXAGON} />
      <circle cx="20" cy="20" r="8.5" />
    </Glyph>
  );
}

// ---------------------------------------------------------------------------
// Chains and representations
// ---------------------------------------------------------------------------

export function CarbonChainIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={4} className={props.className}>
      <path d="M2 16.54 14 23.46 26 16.54 38 23.46" />
    </Glyph>
  );
}

/**
 * The skeletal-mode switch, salvaged from `turn-on-skeletal-mode.svg`: an
 * "H" and a "C" with the bond between them dropped, i.e. the labels a skeletal
 * drawing stops writing.
 *
 * The glyph outlines are FILLED rather than stroked — they are letterforms,
 * and stroking a letterform outline draws its edge twice.
 */
export function SkeletalModeIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <path d="m19 22 2-3" />
      <g fill="currentColor" stroke="none">
        <path
          transform="matrix(1.181019 0 0 1.199529 -10 0)"
          d="m29.635 0h3.655v5.401h5.392v-5.401h3.654v14.172h-3.654v-6.009h-5.392v6.009h-3.655z"
        />
        <path
          transform="matrix(0.967559 0 0 0.991608 -5.92396 18.37759)"
          d="m21.626 21.513c-0.863 0.43-1.762 0.754-2.698 0.973-0.936 0.218-1.912 0.328-2.93 0.328-3.035 0-5.44-0.813-7.214-2.438-1.774-1.633-2.661-3.844-2.661-6.633 0-2.797 0.887-5.008 2.661-6.633 1.774-1.633 4.179-2.449 7.214-2.449 1.017 0 1.994 0.109 2.93 0.328 0.936 0.219 1.835 0.543 2.698 0.973v3.621c-0.871-0.592-1.73-1.01-2.576-1.276-0.846-0.265-1.737-0.398-2.673-0.398-1.677 0-2.995 0.516-3.955 1.547-0.96 1.031-1.44 2.453-1.44 4.266 0 1.805 0.48 3.223 1.44 4.254 0.96 1.031 2.278 1.547 3.955 1.547 0.936 0 1.827-0.133 2.673-0.399 0.846-0.265 1.705-0.683 2.576-1.253z"
        />
      </g>
    </Glyph>
  );
}

/** The charge tool: a plus and a minus, which is what one click of it does. */
export function ChargeIcon(props: ChemIconProps): ReactElement {
  return (
    <Glyph viewBox="0 0 40 40" strokeWidth={3} className={props.className}>
      <circle cx="13" cy="13" r="9" />
      <path d="M13 8.5v9M8.5 13h9" />
      <circle cx="27" cy="27" r="9" />
      <path d="M22.5 27h9" />
    </Glyph>
  );
}
