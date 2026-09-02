/**
 * Hover and selection feedback, drawn over the scene.
 *
 * THE OVERLAY IS NOT PART OF THE SCENE, and that is the whole design of this
 * file. Nothing here is ever pushed into `scene.primitives`: it is a React-only
 * sibling group, built from the `SceneIndex`, so `serializeScene(scene)` of
 * the very same scene contains none of it. An exported figure carrying the
 * editor's hover ring is not a subtle defect — it is a blue halo baked into a
 * manuscript — and the cheap-looking alternative (append a highlight primitive
 * and filter it back out at export time) puts the correctness of every export
 * path on remembering to filter. There is an acceptance test on this.
 *
 * GEOMETRY COMES FROM THE INDEX, never from the molecule. `atomCentre`,
 * `atomRadiusPx` and `bondSegment` report where the ink actually is, which is
 * the point: once a later rendering pass trims bond lines back to clear an
 * atom label, a highlight drawn over the untrimmed model geometry sticks out
 * past both ends of the line it is meant to be highlighting. No `modelToPx`
 * call of our own, no scaling, no flip — those live in chem-render's style.ts
 * and nowhere else, and the index has already been through them.
 *
 * The values are SCENE PX, exactly as the scene layer's are, so this group is
 * a sibling of `[data-layer="scene"]` under the same pan/zoom transform.
 */

import type { ReactElement } from "react";

import type { AtomId, BondId } from "@starter/chem-core";
import type { ScenePoint } from "@starter/chem-render";

import type { Selection } from "@/state";

import type { SceneIndex } from "./metrics";

export interface OverlayLayerProps {
  readonly index: SceneIndex;
  readonly selection: Selection;
  readonly hoveredAtomId: AtomId | null;
  readonly hoveredBondId: BondId | null;
}

/**
 * Halo geometry, in scene px at SCREEN_STYLE (44px bonds, a 2px atom dot).
 *
 * The floor is what matters. A placeholder dot measures about 2.8px of
 * circumscribed ink, so a halo sized off the drawing alone would be a speck.
 * 9px is chem-core's bare-vertex pick target (`DEFAULT_LABEL_RADIUS`, 0.18
 * bond lengths) expressed at this preset — 0.18 x 44 ≈ 7.9, rounded up — and
 * the 4px pad clears the ring of the glyph it surrounds. Two halos at 13px
 * still leave 18px of clear bond between adjacent vertices.
 *
 * The ring is a fixed size in SCENE space, so it matches the pick reach at
 * unit zoom and overstates it as you zoom in: the label half of that reach
 * (`labelRadius * bondLengthPx`) is fixed in scene space too, but the grab
 * tolerance is 6 SCREEN px and therefore shrinks to `6 / zoom` scene px. A
 * halo that told the exact truth would have to take the zoom as a prop and
 * size itself `labelRadius(id) * pxPerModelUnit(style) + tolerancePx / zoom`.
 * That is the honest fix if the discrepancy ever misleads anyone; it is not
 * worth the extra coupling while every atom has the same radius.
 *
 * When real atom labels land, the measured radius overtakes the floor on its
 * own and nothing here changes.
 */
const MIN_ATOM_HALO_RADIUS_PX = 9;
const ATOM_HALO_PAD_PX = 4;

/**
 * Bond highlights are wide and translucent, atom rings narrow and opaque.
 *
 * Both are blue against SCREEN_STYLE's white background and its near-black
 * (#1f2937) bonds, so neither reads as part of the structure. Hover is soft —
 * a wash and a thin ring; selection is stronger and heavier. The pair has to
 * be tellable apart at a glance because they stack: hovering an already
 * selected atom draws both.
 */
const HOVER_COLOR = "#3b82f6";
const SELECTED_COLOR = "#2563eb";
const HOVER_BOND_WIDTH_PX = 10;
const SELECTED_BOND_WIDTH_PX = 12;

export function OverlayLayer({
  index,
  selection,
  hoveredAtomId,
  hoveredBondId,
}: OverlayLayerProps): ReactElement {
  return (
    // Pointer-events off, as on the scene layer: the root <svg> is the only
    // element that handles pointers. A halo that ate its own clicks would make
    // the atom unpickable the moment it became hoverable.
    <g data-layer="overlay" style={{ pointerEvents: "none" }}>
      {/*
        Draw order is bonds under atoms, and selection under hover. Hover on
        top because it answers "what do I get if I click here", which has to
        win over "what did I already have" at the moment the two overlap.
      */}
      {selection.bondIds.map((id) => bondHighlight(index, id, "selected-bond"))}
      {selection.atomIds.map((id) => atomHalo(index, id, "selected-atom"))}
      {hoveredBondId === null
        ? null
        : bondHighlight(index, hoveredBondId, "hover-bond")}
      {hoveredAtomId === null
        ? null
        : atomHalo(index, hoveredAtomId, "hover-atom")}
    </g>
  );
}

type AtomRole = "hover-atom" | "selected-atom";
type BondRole = "hover-bond" | "selected-bond";

/**
 * A ring around an atom, or nothing.
 *
 * An id the index does not know renders NOTHING rather than throwing. That is
 * not defensive padding: undo restores a selection alongside the document it
 * belonged to, and for the render between the two the selection legitimately
 * names atoms the current molecule no longer has. The overlay is feedback, and
 * feedback that crashes the canvas is worse than feedback that is briefly
 * missing.
 */
function atomHalo(
  index: SceneIndex,
  id: AtomId,
  role: AtomRole,
): ReactElement | null {
  const centre = index.atomCentre(id);
  if (centre === undefined || !isFinitePoint(centre)) return null;

  const radius =
    Math.max(index.atomRadiusPx(id), MIN_ATOM_HALO_RADIUS_PX) +
    ATOM_HALO_PAD_PX;
  const hovered = role === "hover-atom";

  return (
    <circle
      // Keyed by role and id, never by index: the two lists are filtered and
      // reordered as the selection changes, and the same atom may appear in
      // both a selection ring and a hover ring at once.
      key={`${role}:${id}`}
      {...overlayAttrs(role, id)}
      cx={centre.x}
      cy={centre.y}
      r={radius}
      fill={hovered ? HOVER_COLOR : "none"}
      fillOpacity={hovered ? 0.12 : undefined}
      stroke={hovered ? HOVER_COLOR : SELECTED_COLOR}
      strokeWidth={hovered ? 1.5 : 2.5}
      strokeOpacity={hovered ? 0.55 : 1}
    />
  );
}

/** A thick translucent line along the bond, or nothing. Same staleness rule. */
function bondHighlight(
  index: SceneIndex,
  id: BondId,
  role: BondRole,
): ReactElement | null {
  const segment = index.bondSegment(id);
  if (segment === undefined) return null;
  if (!isFinitePoint(segment.a) || !isFinitePoint(segment.b)) return null;

  const hovered = role === "hover-bond";

  return (
    <line
      key={`${role}:${id}`}
      {...overlayAttrs(role, id)}
      x1={segment.a.x}
      y1={segment.a.y}
      x2={segment.b.x}
      y2={segment.b.y}
      stroke={hovered ? HOVER_COLOR : SELECTED_COLOR}
      strokeWidth={hovered ? HOVER_BOND_WIDTH_PX : SELECTED_BOND_WIDTH_PX}
      strokeOpacity={hovered ? 0.22 : 0.35}
      // Round caps so the band ends in line with the atom halos instead of
      // cutting a square corner across them.
      strokeLinecap="round"
    />
  );
}

/**
 * The overlay's own attributes. NEVER `data-atom-id` or `data-bond-id`.
 *
 * Those two selectors count drawn model entities — the e2e spec asserts
 * benzene renders exactly six of each — and an overlay element wearing one
 * would inflate the count by however many things happen to be hovered or
 * selected at the moment the page is inspected, turning a structural
 * assertion into a stateful one. `data-overlay` says what the mark is,
 * `data-overlay-target` says which id it points at, and neither collides.
 */
function overlayAttrs(
  role: AtomRole | BondRole,
  target: string,
): { readonly "data-overlay": string; readonly "data-overlay-target": string } {
  return { "data-overlay": role, "data-overlay-target": target };
}

/**
 * A NaN reaching an SVG coordinate takes the whole element out with no error
 * anywhere near the cause. The scene layer gets this for free — `formatNumber`
 * throws on non-finite input — and the overlay writes raw numbers (it is never
 * exported, so it owes nothing to byte-determinism), so it checks by hand.
 */
function isFinitePoint(p: ScenePoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}
