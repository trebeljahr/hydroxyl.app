/**
 * Where a curly arrow's two ends are, in one panel.
 *
 * THE GEOMETRY IS INJECTED (the architectural ruling). The resolver never
 * reads `mol.atoms[id].pos`: it asks a `SchemeAnchorGeometry` where the panel
 * put an atom, a bond and a label, the way chem-core's `hitTest` takes an
 * injected `labelRadius`. That one seam is what makes re-projection a no-op
 * for arrows — a Fischer or a turned planar panel answers `positionOf` from
 * its own layout, and the arrow follows it with no code of its own. Built
 * against the molecule's coordinates instead, the first Newman panel would
 * force a rewrite.
 *
 * VISIBILITY FALLS OUT OF IT. An end whose atom or bond the panel does not
 * place resolves to nothing, so the whole arrow resolves to nothing and is not
 * drawn there — "an annotation renders in a panel iff every anchor resolves",
 * with no flag to say so. `buildScene` gates `positionOf` and `bondEnds` on
 * `schemeAnnotationResolves`, so the two answers cannot disagree.
 *
 * WHAT AN END IS. A nominal POINT, which the stored bulge and skew are
 * measured against, and a CLEARANCE, where the drawn curve must stop short of
 * it. The two are kept apart on purpose: the chord runs between points that do
 * not depend on the preset (atom centres, bond midpoints), so switching from
 * Screen to Publication cannot change the curve's shape, only how much of each
 * end the labels hide.
 *
 *   - An ATOM (a sink atom or lone pair; the atom of a lone-pair or radical
 *     source with no dots drawn): its centre, stopping outside its label's
 *     clear space — the obstacle UNION the bond trimmer uses, not the label's
 *     bounding box, for the reason geometry.ts gives: the box of a charged "O"
 *     is mostly air. A bare vertex has no label; the curve stops a label
 *     padding outside its dot.
 *   - A DRAWN LONE PAIR (the Lewis view): the midpoint of the pair facing the
 *     other end. A DRAWN RADICAL DOT: the dot nearest the other end. Either
 *     way the curve leaves from the electrons, through the label's clear space.
 *   - A BOND SOURCE: its midpoint, and the tail starts ON it (decision 172).
 *   - A BOND SINK: aimed at its midpoint; the tip stops where the curve enters
 *     a band `doubleBondGapPx` either side of the bond, which is on the side
 *     it arrives from and where a new line would be drawn (decision 172).
 *
 * Everything is scene px, y-down, as `positionOf` returns it.
 */

import type { AtomId, BondId } from "@starter/chem-core";

import type { AtomLabelPlacement, LabelObstacle, PlacedDot } from "../label/placement.js";
import type { ScenePoint } from "../scene/types.js";
import type { CurlyArrowSink, CurlyArrowSource } from "../scheme/annotation.js";
import type { RenderStyle } from "../style.js";

/** The part of an atom's label an arrow end needs: where not to draw, and its electrons. */
export type AnchorLabel = Pick<AtomLabelPlacement, "obstacles" | "lonePairs" | "dots">;

/** A drawn bond's two atom centres, scene px, `from` then `to`. */
export interface AnchorBondEnds {
  readonly from: ScenePoint;
  readonly to: ScenePoint;
}

/**
 * What one panel has drawn, as an arrow asks it. Scene px, y-down.
 *
 * Each answer is `undefined` for something the panel does not place.
 */
export interface SchemeAnchorGeometry {
  positionOf(atomId: AtomId): ScenePoint | undefined;
  bondEnds(bondId: BondId): AnchorBondEnds | undefined;
  /** The label the panel set on the atom; undefined for a bare vertex. */
  labelOf(atomId: AtomId): AnchorLabel | undefined;
}

/** Where a drawn curve must stop short of its end. */
export type EndClearance =
  /** Nowhere: the curve reaches the point itself (a tail on a bond). */
  | { readonly kind: "none" }
  /** Outside every one of these: a label's clear space, or a bare vertex's disc. */
  | { readonly kind: "obstacles"; readonly obstacles: readonly LabelObstacle[] }
  /** Outside the rectangle `halfWidth` either side of a bond's axis. */
  | {
      readonly kind: "band";
      readonly centre: ScenePoint;
      /** Unit, along the bond. */
      readonly unit: ScenePoint;
      readonly halfLength: number;
      readonly halfWidth: number;
    };

export interface ResolvedEnd {
  /** The nominal point the chord runs to. */
  readonly point: ScenePoint;
  readonly clearance: EndClearance;
  /** The atom the end sits on, if it sits on one. Its own label is not crowding. */
  readonly atomId?: AtomId;
  /** The bond the end sits on, if it sits on one. */
  readonly bondId?: BondId;
  /** A bond end's unit axis, `from` to `to`: a fallback chord direction. */
  readonly axis?: ScenePoint;
}

export interface ResolvedCurlyArrowEnds {
  readonly tail: ResolvedEnd;
  readonly head: ResolvedEnd;
}

type End = CurlyArrowSource | CurlyArrowSink;

interface Base {
  readonly point: ScenePoint;
  readonly bond?: { readonly bondId: BondId; readonly ends: AnchorBondEnds };
}

function midpoint(a: ScenePoint, b: ScenePoint): ScenePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function squaredDistance(a: ScenePoint, b: ScenePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function baseOf(end: End, geometry: SchemeAnchorGeometry): Base | undefined {
  if (end.kind === "bond") {
    const ends = geometry.bondEnds(end.bondId);
    if (ends === undefined) return undefined;
    return { point: midpoint(ends.from, ends.to), bond: { bondId: end.bondId, ends } };
  }
  const point = geometry.positionOf(end.atomId);
  return point === undefined ? undefined : { point };
}

/** The index of the point nearest `target`; the first wins a tie. */
function nearest(points: readonly ScenePoint[], target: ScenePoint): number {
  let best = 0;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const d = squaredDistance(point, target);
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * The electrons the end starts from, when the panel draws them: the pair or
 * the dot nearest the other end. `undefined` when none are drawn, and the end
 * then starts at the atom.
 */
function drawnElectrons(
  kind: End["kind"],
  label: AnchorLabel | undefined,
  other: ScenePoint,
): ScenePoint | undefined {
  if (label === undefined) return undefined;
  if (kind === "lonePair" && label.lonePairs.length >= 2) {
    // Two dots per pair, in pair order (placement.ts).
    const pairs: ScenePoint[] = [];
    for (let i = 0; i + 1 < label.lonePairs.length; i += 2) {
      const a: PlacedDot = label.lonePairs[i]!;
      const b: PlacedDot = label.lonePairs[i + 1]!;
      pairs.push(midpoint(a.centre, b.centre));
    }
    return pairs[nearest(pairs, other)];
  }
  if (kind === "radical" && label.dots.length > 0) {
    const dots = label.dots.map((dot) => dot.centre);
    return dots[nearest(dots, other)];
  }
  return undefined;
}

function atomEnd(
  end: Exclude<End, { kind: "bond" }>,
  base: Base,
  other: ScenePoint,
  isSource: boolean,
  geometry: SchemeAnchorGeometry,
  style: RenderStyle,
): ResolvedEnd {
  const label = geometry.labelOf(end.atomId);
  // A lone pair or a radical dot the panel draws is where a SOURCE's electrons
  // are. A sink lone pair does not exist yet, so the head aims at the atom.
  const electrons = isSource ? drawnElectrons(end.kind, label, other) : undefined;
  const obstacles: readonly LabelObstacle[] =
    label !== undefined
      ? label.obstacles
      : [
          {
            kind: "disc",
            centre: base.point,
            radius: style.atomDotRadiusPx + style.labelPaddingPx,
          },
        ];
  return {
    point: electrons ?? base.point,
    clearance: { kind: "obstacles", obstacles },
    atomId: end.atomId,
  };
}

function bondEnd(base: Base, isSource: boolean, style: RenderStyle): ResolvedEnd {
  const bond = base.bond!;
  const { from, to } = bond.ends;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const unit: ScenePoint = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  return {
    point: base.point,
    // Decision 172: a tail starts on the bond; a head stops at the double-bond
    // gap, where the line its electrons make would be drawn.
    clearance: isSource
      ? { kind: "none" }
      : {
          kind: "band",
          centre: base.point,
          unit,
          halfLength: length / 2,
          halfWidth: style.doubleBondGapPx,
        },
    bondId: bond.bondId,
    axis: unit,
  };
}

/**
 * Both ends of an arrow in the panel `geometry` describes, or undefined when
 * the panel does not place one of them.
 */
export function resolveCurlyArrowEnds(
  arrow: { readonly source: CurlyArrowSource; readonly sink: CurlyArrowSink },
  geometry: SchemeAnchorGeometry,
  style: RenderStyle,
): ResolvedCurlyArrowEnds | undefined {
  const tailBase = baseOf(arrow.source, geometry);
  const headBase = baseOf(arrow.sink, geometry);
  if (tailBase === undefined || headBase === undefined) return undefined;
  const resolve = (end: End, base: Base, other: Base, isSource: boolean): ResolvedEnd =>
    end.kind === "bond"
      ? bondEnd(base, isSource, style)
      : atomEnd(end, base, other.point, isSource, geometry, style);
  return {
    tail: resolve(arrow.source, tailBase, headBase, true),
    head: resolve(arrow.sink, headBase, tailBase, false),
  };
}

/** True when `p` is strictly inside the clearance: the curve must not end there. */
export function insideClearance(clearance: EndClearance, p: ScenePoint): boolean {
  switch (clearance.kind) {
    case "none":
      return false;
    case "obstacles":
      return clearance.obstacles.some((obstacle) =>
        obstacle.kind === "rect"
          ? p.x > obstacle.box.minX &&
            p.x < obstacle.box.maxX &&
            p.y > obstacle.box.minY &&
            p.y < obstacle.box.maxY
          : squaredDistance(p, obstacle.centre) < obstacle.radius * obstacle.radius,
      );
    case "band": {
      const ox = p.x - clearance.centre.x;
      const oy = p.y - clearance.centre.y;
      const along = ox * clearance.unit.x + oy * clearance.unit.y;
      const across = -ox * clearance.unit.y + oy * clearance.unit.x;
      return Math.abs(along) < clearance.halfLength && Math.abs(across) < clearance.halfWidth;
    }
    default: {
      const unreachable: never = clearance;
      return unreachable;
    }
  }
}
