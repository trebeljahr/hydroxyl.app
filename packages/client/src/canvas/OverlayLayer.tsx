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
 * the point: the renderer trims bond lines back to clear an atom label, so a
 * highlight drawn over the untrimmed model geometry sticks out past both ends
 * of the line it is meant to be highlighting. No `modelToPx`
 * call of our own, no scaling, no flip — those live in chem-render's style.ts
 * and nowhere else, and the index has already been through them.
 *
 * The values are SCENE PX, exactly as the scene layer's are, so this group is
 * a sibling of `[data-layer="scene"]` under the same pan/zoom transform.
 */

import type { ReactElement } from "react";

import type { AtomId, BondId, ValenceIssue, Vec2 } from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";
import type { ScenePoint } from "@starter/chem-render";

import type { Selection } from "@/state";
import type { InteractionOverlayState } from "@/editor/interaction";

import { ROTATE_HANDLE_RADIUS_PX } from "./handles";
import type { RotateHandleGeometry } from "./handles";
import type { SceneIndex } from "./metrics";
import { bondScale } from "./view-scale";

export interface OverlayLayerProps {
  readonly index: SceneIndex;
  readonly selection: Selection;
  readonly hoveredAtomId: AtomId | null;
  readonly hoveredBondId: BondId | null;
  /** The gesture in flight, in MODEL units. Converted here, with `modelToPx`. */
  readonly interaction?: InteractionOverlayState | undefined;
  /** Atoms to badge. Never a refusal — see the note on `valenceBadge`. */
  readonly issues?: readonly ValenceIssue[] | undefined;
  /**
   * The rotate handle, from `rotateHandleGeometry` — computed by the caller
   * because the adapter's hit test needs the very same value, and the two
   * computing it apart is how a handle ends up drawn in one place and
   * grabbable in another. `undefined` draws none.
   */
  readonly rotateHandle?: RotateHandleGeometry | undefined;
  /**
   * The view's zoom. Only the rotate handle's marks read it: they are UI
   * sized in screen px, where everything else here is sized with the drawing.
   */
  readonly zoom?: number | undefined;
  /**
   * The atom the canvas's roving keyboard focus is on.
   *
   * A THIRD mark, distinct from hover and selection, because it answers a
   * third question — "where is the keyboard" — and the three are routinely on
   * three different atoms at once. Drawn as a dashed ring so it is
   * distinguishable from the solid selection ring without colour, which is
   * the point of a focus indicator.
   */
  readonly focusedAtomId?: AtomId | null | undefined;
}

/*
 * EVERY SCENE-SIZED MARK BELOW IS IN PX AT THE REFERENCE BOND — Screen's
 * 44 px — and is drawn at `bondScale(style)` times that (decision 107). The
 * marks were tuned on Screen and used to be drawn at those px whatever the
 * style, so at Publication's 24 px bond a selection ring reached past half a
 * bond and covered its neighbours. Scaled, each mark is the same fraction of
 * a bond in every style, and with the viewport rescaled on a style switch it
 * is the same size on screen too. `u` below is that factor. The rotate
 * handle, its preview and the pivot are UI in SCREEN px and take the zoom
 * instead, so they need no factor.
 */

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

/**
 * The gesture palette.
 *
 * Green for a target the gesture will accept, red for one it refuses, and the
 * same blue as the selection for everything neutral. The refusal colour is the
 * only place the overlay says "no" — decision 2 makes an already-bonded merge
 * or ring closure a refused gesture, and the user has to see that while the
 * button is still down rather than discover it when nothing happens on
 * release.
 *
 * The issue badge takes its colour from the issue's SEVERITY (decision 77),
 * not from the fact that it is a badge: red for a drawing that states
 * something wrong, amber for sound chemistry this build cannot express. Both
 * are reports and neither is a refusal — the gesture colours above are the
 * only place the overlay says "no".
 */
const ACCEPT_COLOR = "#16a34a";
const REFUSE_COLOR = "#dc2626";
const GHOST_COLOR = "#2563eb";
const BADGE_COLOR = "#dc2626";
/**
 * A WARNING badge is not the error badge (decision 77). An allene's atom
 * carries a mark because this build cannot state its configuration, not
 * because the drawing is wrong, and a badge in the error colour says the
 * opposite. Amber, as the status bar's notice and the export dialog's
 * warnings are.
 */
const BADGE_WARNING_COLOR = "#d97706";
const FOCUS_COLOR = "#7c3aed";
/** Clear of the selection ring so both are legible on the same atom. */
const FOCUS_RING_PAD_PX = 5;
const GHOST_WIDTH_PX = 2;
const MARQUEE_WIDTH_PX = 1;
const TARGET_RADIUS_PX = 14;
const BADGE_RADIUS_PX = 5;
const BADGE_OFFSET_PX = 12;

export function OverlayLayer({
  index,
  selection,
  hoveredAtomId,
  hoveredBondId,
  interaction,
  issues,
  rotateHandle: handle,
  zoom: zoomProp,
  focusedAtomId,
}: OverlayLayerProps): ReactElement {
  const style = index.scene.style;
  const u = bondScale(style);
  const zoom =
    zoomProp !== undefined && Number.isFinite(zoomProp) && zoomProp > 0 ? zoomProp : 1;
  const showHandle = handle !== undefined && interaction?.marquee == null;
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
      {selection.bondIds.map((id) => bondHighlight(index, u, id, "selected-bond"))}
      {selection.atomIds.map((id) => atomHalo(index, u, id, "selected-atom"))}
      {hoveredBondId === null
        ? null
        : bondHighlight(index, u, hoveredBondId, "hover-bond")}
      {hoveredAtomId === null
        ? null
        : atomHalo(index, u, hoveredAtomId, "hover-atom")}

      {/*
        The gesture marks, drawn last so they sit over both. A drag is the
        most recent statement of intent on the canvas and has to win.
      */}
      {focusedAtomId == null ? null : focusRing(index, u, focusedAtomId)}
      {(issues ?? []).map((issue, at) => valenceBadge(index, u, issue, at))}
      {showHandle && interaction?.handleHovered === true
        ? rotatePreview(handle, zoom)
        : null}
      {showHandle ? rotateHandle(handle, interaction?.angle ?? 0, zoom) : null}
      {interaction?.target == null
        ? null
        : targetRing(index, u, interaction.target.atomId, interaction.target.refused)}
      {interaction?.ghost == null
        ? null
        : ghostBond(style, u, interaction.ghost.from, interaction.ghost.to)}
      {interaction?.marquee == null
        ? null
        : marqueeRect(style, u, interaction.marquee.a, interaction.marquee.b)}
      {interaction?.pivot == null ? null : pivotMark(style, interaction.pivot, zoom)}
    </g>
  );
}

/**
 * The bond being drawn, from the source atom to wherever the drag currently
 * ends.
 *
 * MODEL UNITS IN, `modelToPx` OUT. This is the one overlay mark whose far end
 * has no index entry to read a position from — while the drag is over empty
 * canvas the atom exists in the store's molecule but the mark is about where
 * the gesture is pointing, not about the ink. `modelToPx` is chem-render's and
 * is the only sanctioned crossing; spelling the multiply and the negation out
 * here would be the second site the render invariant exists to prevent.
 *
 * Dashed, so it never reads as a bond that has been committed even though —
 * per the per-move-commit decision — it has.
 */
function ghostBond(
  style: Parameters<typeof modelToPx>[0],
  u: number,
  from: Vec2,
  to: Vec2,
): ReactElement | null {
  const a = modelToPx(style, from);
  const b = modelToPx(style, to);
  if (!isFinitePoint(a) || !isFinitePoint(b)) return null;
  return (
    <line
      key="ghost-bond"
      data-overlay="ghost-bond"
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={GHOST_COLOR}
      strokeWidth={GHOST_WIDTH_PX * u}
      strokeOpacity={0.7}
      strokeDasharray={dashes(u, 5, 4)}
      strokeLinecap="round"
    />
  );
}

/**
 * The atom a ring closure or a merge would land on.
 *
 * Green accepts, red refuses. Both are drawn: a refusal the user cannot see is
 * a gesture that mysteriously does nothing.
 */
function targetRing(
  index: SceneIndex,
  u: number,
  atomId: AtomId,
  refused: boolean,
): ReactElement | null {
  const centre = index.atomCentre(atomId);
  if (centre === undefined || !isFinitePoint(centre)) return null;
  return (
    <circle
      key="gesture-target"
      data-overlay={refused ? "target-refused" : "target-accepted"}
      data-overlay-target={atomId}
      cx={centre.x}
      cy={centre.y}
      r={TARGET_RADIUS_PX * u}
      fill="none"
      stroke={refused ? REFUSE_COLOR : ACCEPT_COLOR}
      strokeWidth={2.5 * u}
      strokeDasharray={refused ? dashes(u, 4, 3) : undefined}
    />
  );
}

/**
 * The marquee, normalised HERE rather than in model space.
 *
 * The two corners arrive exactly as the pointer produced them, and the y-flip
 * means a sweep DOWN the screen is a DECREASING model y — so a rect normalised
 * in model units comes back through `modelToPx` inverted, and an SVG `<rect>`
 * with a negative height renders nothing at all, silently. Converting first
 * and taking min/max after is the only order that cannot get it wrong. The
 * chem-core side normalises separately, with `rectFromCorners`, in the space
 * `atomsInRect` actually reads.
 */
function marqueeRect(
  style: Parameters<typeof modelToPx>[0],
  u: number,
  a: Vec2,
  b: Vec2,
): ReactElement | null {
  const pa = modelToPx(style, a);
  const pb = modelToPx(style, b);
  if (!isFinitePoint(pa) || !isFinitePoint(pb)) return null;
  const x = Math.min(pa.x, pb.x);
  const y = Math.min(pa.y, pb.y);
  return (
    <rect
      key="marquee"
      data-overlay="marquee"
      x={x}
      y={y}
      width={Math.abs(pb.x - pa.x)}
      height={Math.abs(pb.y - pa.y)}
      fill={SELECTED_COLOR}
      fillOpacity={0.08}
      stroke={SELECTED_COLOR}
      strokeWidth={MARQUEE_WIDTH_PX * u}
      strokeDasharray={dashes(u, 4, 3)}
    />
  );
}

/**
 * `translate(p) scale(1/zoom)`: a local frame whose origin is `p` and whose
 * unit is one SCREEN px. Everything the rotate handle draws is UI rather than
 * drawing, so it is built in that frame and keeps its size as the view zooms
 * — see the header of handles.ts for what the scene-sized version did.
 */
function screenFrame(p: ScenePoint, zoom: number): string {
  return `translate(${p.x} ${p.y}) scale(${1 / zoom})`;
}

/**
 * The grab handle, wearing a rotate arrow.
 *
 * THE GLYPH IS THE POINT. The handle used to be a bare white disc with a blue
 * ring, and a plain dot above a selection reads as a status light or a stray
 * atom, not as a control (manual notes 3). The circular arrow is the rotate
 * icon every drawing program uses, so it says what dragging the dot does
 * before anyone tries — which matters most on touch, where there is no hover
 * to reveal the preview below.
 *
 * `angle` is the rotation in flight, model-anticlockwise. The handle rides its
 * orbit by that much, so it stays with the pointer dragging it instead of
 * sitting still while the structure spins beneath it. Scene px are y-down,
 * which turns a model-anticlockwise turn into a DECREASING scene angle.
 */
function rotateHandle(
  geometry: RotateHandleGeometry,
  angle: number,
  zoom: number,
): ReactElement | null {
  const bearing = geometry.bearing - angle;
  const centre = {
    x: geometry.pivot.x + geometry.orbit * Math.cos(bearing),
    y: geometry.pivot.y + geometry.orbit * Math.sin(bearing),
  };
  if (!isFinitePoint(centre)) return null;
  return (
    <g key="rotate-handle" data-overlay="rotate-handle" transform={screenFrame(centre, zoom)}>
      <circle r={ROTATE_HANDLE_RADIUS_PX} fill="#ffffff" stroke={SELECTED_COLOR} strokeWidth={2} />
      <path
        data-overlay-glyph="rotate"
        d={ROTATE_GLYPH.arc}
        fill="none"
        stroke={SELECTED_COLOR}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path d={ROTATE_GLYPH.head} fill={SELECTED_COLOR} />
    </g>
  );
}

/**
 * The rotate glyph, in the handle's own frame (origin at its centre, y-down,
 * screen px): 280 degrees of arc, clockwise from just right of twelve
 * o'clock, with a filled arrowhead on the trailing end. Built once — it never
 * changes.
 */
const GLYPH_ARC_RADIUS_PX = ROTATE_HANDLE_RADIUS_PX * 0.5;
const GLYPH_HEAD_PX = GLYPH_ARC_RADIUS_PX * 0.55;
const ROTATE_GLYPH = buildRotateGlyph();

function buildRotateGlyph(): { readonly arc: string; readonly head: string } {
  const r = GLYPH_ARC_RADIUS_PX;
  const start = (-80 * Math.PI) / 180;
  const end = (200 * Math.PI) / 180;
  const at = (t: number, radius: number): ScenePoint => ({
    x: radius * Math.cos(t),
    y: radius * Math.sin(t),
  });
  const a = at(start, r);
  const b = at(end, r);
  // Tangent of travel at the end (increasing angle), and the arrowhead's
  // three corners: two across the stroke, one ahead of it.
  const tx = -Math.sin(end);
  const ty = Math.cos(end);
  const inner = at(end, r - GLYPH_HEAD_PX);
  const outer = at(end, r + GLYPH_HEAD_PX);
  const tip = { x: b.x + tx * GLYPH_HEAD_PX * 1.3, y: b.y + ty * GLYPH_HEAD_PX * 1.3 };
  const n = (v: number): string => v.toFixed(2);
  return {
    arc: `M ${n(a.x)} ${n(a.y)} A ${n(r)} ${n(r)} 0 1 1 ${n(b.x)} ${n(b.y)}`,
    head:
      `M ${n(inner.x)} ${n(inner.y)} L ${n(outer.x)} ${n(outer.y)} ` +
      `L ${n(tip.x)} ${n(tip.y)} Z`,
  };
}

/**
 * What dragging the handle will do, shown while the pointer rests on it.
 *
 * A HOVER PREVIEW, NOT A LABEL. Two marks: the pivot the selection will turn
 * about, and a stretch of the orbit the handle will travel, arrowed both ways.
 * Together they answer "what is this" and "which way does it go" without a
 * word, and the words — "Drag to rotate", in `RotateHandleHint` — sit beside
 * them in screen space, where text stays legible at any zoom.
 *
 * Dashed and translucent, like the ghost bond, so it never reads as ink.
 * Built in the pivot's screen frame, so the orbit's radius there is
 * `orbit * zoom` and every stroke and arrowhead is screen px.
 */
const PREVIEW_ARC_HALF_SPAN = (35 * Math.PI) / 180;
const PREVIEW_HEAD_PX = 5;

function rotatePreview(geometry: RotateHandleGeometry, zoom: number): ReactElement | null {
  const { pivot, bearing } = geometry;
  const radius = geometry.orbit * zoom;
  if (!isFinitePoint(pivot) || !Number.isFinite(radius)) return null;
  const at = (t: number): ScenePoint => ({
    x: radius * Math.cos(t),
    y: radius * Math.sin(t),
  });
  const first = bearing - PREVIEW_ARC_HALF_SPAN;
  const last = bearing + PREVIEW_ARC_HALF_SPAN;
  const from = at(first);
  const to = at(last);
  // An arrowhead at each end, pointing on along the circle: two short strokes
  // back from the end, one to each side of the tangent.
  const head = (t: number, direction: 1 | -1): string => {
    const end = at(t);
    const tx = -Math.sin(t) * direction;
    const ty = Math.cos(t) * direction;
    const back = { x: end.x - tx * PREVIEW_HEAD_PX, y: end.y - ty * PREVIEW_HEAD_PX };
    const nx = Math.cos(t) * PREVIEW_HEAD_PX * 0.7;
    const ny = Math.sin(t) * PREVIEW_HEAD_PX * 0.7;
    return (
      `M ${back.x + nx} ${back.y + ny} L ${end.x} ${end.y} ` +
      `L ${back.x - nx} ${back.y - ny}`
    );
  };
  return (
    <g key="rotate-preview" data-overlay="rotate-preview" transform={screenFrame(pivot, zoom)}>
      <path
        d={`M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`}
        fill="none"
        stroke={SELECTED_COLOR}
        strokeWidth={1.5}
        strokeOpacity={0.7}
        strokeDasharray="5 4"
      />
      <path
        d={`${head(first, -1)} ${head(last, 1)}`}
        fill="none"
        stroke={SELECTED_COLOR}
        strokeWidth={1.5}
        strokeOpacity={0.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle r={PIVOT_RADIUS_PX} fill={SELECTED_COLOR} />
    </g>
  );
}

/** The pivot dot, screen px, in the preview and during the turn alike. */
const PIVOT_RADIUS_PX = 3;

/** Where a rotation in progress is turning about. */
function pivotMark(
  style: Parameters<typeof modelToPx>[0],
  pivot: Vec2,
  zoom: number,
): ReactElement | null {
  const point = modelToPx(style, pivot);
  if (!isFinitePoint(point)) return null;
  return (
    <circle
      key="rotate-pivot"
      data-overlay="rotate-pivot"
      cx={point.x}
      cy={point.y}
      r={PIVOT_RADIUS_PX / zoom}
      fill={SELECTED_COLOR}
    />
  );
}

/**
 * A dot beside an atom `valenceIssues()` flagged.
 *
 * A BADGE AND NEVER A REFUSAL. Sprouting and template placement are never
 * blocked by valence — drawing something briefly over-valent is a normal step
 * in sketching an intermediate — so the editor reports it and carries on. The
 * mark is offset up and to the right so it clears both the atom's own label
 * and any selection halo around it.
 */
function valenceBadge(
  index: SceneIndex,
  u: number,
  issue: ValenceIssue,
  at: number,
): ReactElement | null {
  const centre = index.atomCentre(issue.atomId);
  if (centre === undefined || !isFinitePoint(centre)) return null;
  const reach = Math.max(index.atomRadiusPx(issue.atomId), MIN_ATOM_HALO_RADIUS_PX * u);
  return (
    <circle
      // The position in the list, not the atom id alone: an atom can carry
      // both a valence error and a structural one — a wedge on an over-valent
      // carbon is one edit away — and two badges under one key make React drop
      // the second silently.
      key={`issue:${at}:${issue.atomId}`}
      data-overlay="valence-issue"
      data-overlay-target={issue.atomId}
      data-overlay-severity={issue.severity}
      cx={centre.x + reach + BADGE_OFFSET_PX * 0.5 * u}
      cy={centre.y - reach - BADGE_OFFSET_PX * 0.5 * u}
      r={BADGE_RADIUS_PX * u}
      fill={issue.severity === "error" ? BADGE_COLOR : BADGE_WARNING_COLOR}
      stroke="#ffffff"
      strokeWidth={1.5 * u}
    >
      <title>{issue.message}</title>
    </circle>
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
  u: number,
  id: AtomId,
  role: AtomRole,
): ReactElement | null {
  const centre = index.atomCentre(id);
  if (centre === undefined || !isFinitePoint(centre)) return null;

  const radius =
    Math.max(index.atomRadiusPx(id), MIN_ATOM_HALO_RADIUS_PX * u) +
    ATOM_HALO_PAD_PX * u;
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
      strokeWidth={(hovered ? 1.5 : 2.5) * u}
      strokeOpacity={hovered ? 0.55 : 1}
    />
  );
}

/**
 * The keyboard focus ring.
 *
 * Outside the selection halo rather than instead of it: an atom can be
 * focused, selected and hovered at once, and a focus indicator that replaced
 * one of the other two would make the keyboard user lose track of what an
 * edit is about to act on.
 */
function focusRing(index: SceneIndex, u: number, id: AtomId): ReactElement | null {
  const centre = index.atomCentre(id);
  if (centre === undefined || !isFinitePoint(centre)) return null;
  const radius =
    Math.max(index.atomRadiusPx(id), MIN_ATOM_HALO_RADIUS_PX * u) +
    (ATOM_HALO_PAD_PX + FOCUS_RING_PAD_PX) * u;
  return (
    <circle
      key={`focus-atom:${id}`}
      data-overlay="focus-atom"
      data-overlay-target={id}
      cx={centre.x}
      cy={centre.y}
      r={radius}
      fill="none"
      stroke={FOCUS_COLOR}
      strokeWidth={2 * u}
      strokeDasharray={dashes(u, 4, 3)}
    />
  );
}

/** A thick translucent line along the bond, or nothing. Same staleness rule. */
function bondHighlight(
  index: SceneIndex,
  u: number,
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
      strokeWidth={(hovered ? HOVER_BOND_WIDTH_PX : SELECTED_BOND_WIDTH_PX) * u}
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
 * A dash pattern at the reference bond, scaled like every other size here.
 * At `u` 1 it is spelled exactly as the literal was, so a Screen canvas
 * carries the same attribute it always did.
 */
function dashes(u: number, dash: number, gap: number): string {
  return `${String(dash * u)} ${String(gap * u)}`;
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
