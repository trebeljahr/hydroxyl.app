/**
 * Picking: what is under the pointer.
 *
 * TOLERANCES ARE IN BOND-LENGTH UNITS, NOT PIXELS, DELIBERATELY. The client
 * converts its pixel grab radius to model units exactly once, using the
 * current zoom, and passes that in. Pick targets then stay the same size on
 * screen at every zoom level. Storing pixels here would invert that: a
 * fixed model-space tolerance grows on screen as you zoom in, so at 8x a
 * carbon would swallow the bonds around it and you could no longer click a
 * bond to promote it to a double.
 *
 * THE RENDERER SEAM. How big an atom's pick target is depends on how big its
 * label is drawn — a bare vertex carbon has no glyph at all, while "OCH3" or
 * a charged "NH3+" covers a real chunk of the bond leading into it. Only the
 * renderer knows those boxes, and chem-core must never depend on the
 * renderer. So the measurement arrives as an injected callback,
 * `labelRadius(atomId)`, in bond-length units; the client feeds it from the
 * render scene's measured label boxes. The numeric defaults below keep the
 * module usable and testable standalone.
 *
 * That radius is also what decides ATOM-OVER-BOND priority. It has to be:
 * with a single global radius you either make it small enough that clicking
 * the middle of a wide "OCH3" label grabs the bond underneath, or large
 * enough that a bare-vertex carbon eats the first third of every bond it
 * touches. The per-atom radius is the only thing that separates those cases.
 *
 * A per-atom radius is still not enough on its own, because a big label cuts
 * the bond INTO it short. At the publication preset "HC" trims butan-2-ol's
 * C1-C2 to under 0.4 of a bond, and the middle of that stub sits inside bare
 * C1's target: the line the user sees is not clickable as a bond. So the
 * renderer also reports each bond's DRAWN span, `drawnSpan(bondId)`, and the
 * middle of what is drawn belongs to the bond whatever its endpoints' radii
 * say (decision 198).
 */

import type { AtomId, BondId, Molecule } from "./types.js";
import { closestPointOnSegment, distance, type Vec2 } from "./vec.js";

/** Axis-aligned box, min/max componentwise. Marquee selection uses it. */
export interface Rect {
  readonly min: Vec2;
  readonly max: Vec2;
}

/**
 * Normalises the two corners of a marquee drag. A user dragging up-and-left
 * produces a "max" corner below and left of the "min" one, and every
 * containment test downstream would then reject every point.
 */
export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

/**
 * Radius of a bare vertex's pick target, bond-length units.
 *
 * Chosen so it stays well clear of a bond's midpoint: at 0.18 plus the atom
 * tolerance the target reaches 0.30 along a standard bond, leaving the whole
 * middle 40% of a bond between two bare vertices clickable. That is the
 * property the "click a bond to make it a double" gesture depends on. A bond
 * into a big label is drawn shorter than that, and `DRAWN_BOND_MIDDLE` is
 * what keeps the promise there.
 */
export const DEFAULT_LABEL_RADIUS = 0.18;

/**
 * The fraction of a bond's DRAWN span, centred on its middle, where the bond
 * beats both of its endpoint atoms.
 *
 * 0.4 is the figure `DEFAULT_LABEL_RADIUS` already gives a bond between bare
 * vertices, measured on the ink instead of the axis: a 0.39-bond stub into an
 * "HC" keeps its middle 40% too, where a bare vertex's fixed radius would
 * otherwise cover half of it.
 */
export const DRAWN_BOND_MIDDLE = 0.4;

/** Extra grab slack outside the label box, so a near miss still selects. */
export const DEFAULT_ATOM_TOLERANCE = 0.12;

/** Half-width of a bond's grab band, measured perpendicular to its axis. */
export const DEFAULT_BOND_TOLERANCE = 0.12;

/**
 * The part of a bond the renderer drew, as fractions of its axis from `from`
 * (0) to `to` (1). A bond into a label is trimmed back to clear the glyph, so
 * `end` is below 1 there.
 */
export interface BondSpan {
  readonly start: number;
  readonly end: number;
}

export interface HitOptions {
  readonly labelRadius?: (atomId: AtomId) => number;
  /**
   * The drawn span of a bond. Omitted, or `undefined` for a bond, the span is
   * estimated as the axis minus each endpoint's label radius, which is the
   * best a caller without a renderer can say about where a label trims.
   */
  readonly drawnSpan?: (bondId: BondId) => BondSpan | undefined;
  readonly atomTolerance?: number;
  readonly bondTolerance?: number;
}

export interface AtomHit {
  readonly kind: "atom";
  readonly atomId: AtomId;
  readonly distance: number;
}

export interface BondHit {
  readonly kind: "bond";
  readonly bondId: BondId;
  readonly distance: number;
  readonly t: number;
  /** Closest point on the bond axis — where a click lands for a split/insert. */
  readonly point: Vec2;
}

export interface NoHit {
  readonly kind: "none";
}

export type Hit = AtomHit | BondHit | NoHit;

export const NO_HIT: NoHit = Object.freeze({ kind: "none" });

function constantRadius(): number {
  return DEFAULT_LABEL_RADIUS;
}

/**
 * Nearest atom by centre distance, ignoring label size entirely.
 *
 * Distance-only on purpose: this is the primitive that snapping and
 * "continue drawing from the closest atom" want, where the drawn glyph is
 * irrelevant. `hitTest` is the one that layers label geometry on top.
 *
 * Ties go to the LATER atom in insertion order, which is the one drawn on
 * top — clicking a stack picks what you can actually see. Iteration follows
 * `mol.atomIds` rather than the record's keys because the ids are `a1`,
 * `a2` … `a10`, and any lexicographic ordering puts `a10` before `a9`.
 */
export function nearestAtom(
  mol: Molecule,
  point: Vec2,
  maxDistance?: number,
): AtomHit | undefined {
  let best: AtomHit | undefined;
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (!atom) continue;
    const d = distance(point, atom.pos);
    if (maxDistance !== undefined && d > maxDistance) continue;
    // `<=` so the last-drawn of two coincident atoms wins.
    if (best === undefined || d <= best.distance) {
      best = { kind: "atom", atomId, distance: d };
    }
  }
  return best;
}

/**
 * Nearest bond by perpendicular distance to its axis, clamped at the ends so
 * a point beyond an endpoint measures to that endpoint rather than to the
 * infinite line. Without the clamp every bond in a long chain would appear
 * equally close to a point far off the end of the chain.
 */
export function nearestBond(
  mol: Molecule,
  point: Vec2,
  maxDistance?: number,
): BondHit | undefined {
  let best: BondHit | undefined;
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (!bond) continue;
    const from = mol.atoms[bond.from];
    const to = mol.atoms[bond.to];
    if (!from || !to) continue;
    const closest = closestPointOnSegment(point, from.pos, to.pos);
    const d = distance(point, closest.point);
    if (maxDistance !== undefined && d > maxDistance) continue;
    if (best === undefined || d <= best.distance) {
      best = {
        kind: "bond",
        bondId,
        distance: d,
        t: closest.t,
        point: closest.point,
      };
    }
  }
  return best;
}

/**
 * What the pointer is over, with atoms beating bonds wherever both qualify —
 * except on the middle of a bond's drawn span, where that bond's two
 * endpoints drop out of the running (see `DRAWN_BOND_MIDDLE`).
 *
 * Atoms are scanned against their OWN radius rather than "nearest atom, then
 * check it" — with per-atom label sizes the nearest centre is not
 * necessarily the atom whose glyph the pointer is inside. A click just off
 * the end of a long "OCH3" label should select that oxygen even when a bare
 * carbon two-thirds of a bond away happens to be marginally closer.
 *
 * Which is also why the qualifiers are RANKED BY PENETRATION, `d - radius`,
 * not by `d`. Filtering per-atom and then ranking by raw centre distance
 * throws the per-atom information away again at the last step: the pointer
 * could sit a quarter of a bond inside the oxygen's measured glyph and still
 * lose to a bare carbon it merely grazes through the tolerance slack. The
 * signed distance to each atom's own glyph edge is the quantity that says
 * "this is the label you are on", and it is what a user reads off the screen.
 *
 * Signed difference rather than a scale-free ratio `d / radius` because a
 * renderer is entitled to report radius 0 for a vertex carbon it draws no
 * glyph for, and the ratio is Infinity or NaN there. The difference degrades
 * gracefully to pure distance in that case.
 */
export function hitTest(mol: Molecule, point: Vec2, options: HitOptions = {}): Hit {
  const labelRadius = options.labelRadius ?? constantRadius;
  const atomTolerance = options.atomTolerance ?? DEFAULT_ATOM_TOLERANCE;
  const bondTolerance = options.bondTolerance ?? DEFAULT_BOND_TOLERANCE;

  const yielding = atomsYieldingToBond(mol, point, labelRadius, options.drawnSpan, bondTolerance);

  let bestAtom: AtomHit | undefined;
  let bestPenetration = Infinity;
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (!atom || yielding.has(atomId)) continue;
    const d = distance(point, atom.pos);
    const radius = labelRadius(atomId);
    if (d > radius + atomTolerance) continue;
    const penetration = d - radius;
    // `<=` so the last-drawn of two equally-penetrated atoms wins, matching
    // `nearestAtom`: clicking a stack picks the one on top.
    if (bestAtom === undefined || penetration <= bestPenetration) {
      bestAtom = { kind: "atom", atomId, distance: d };
      bestPenetration = penetration;
    }
  }
  if (bestAtom !== undefined) return bestAtom;

  return nearestBond(mol, point, bondTolerance) ?? NO_HIT;
}

/**
 * The endpoints of every bond whose drawn middle the pointer is on.
 *
 * Only the bond's OWN endpoints yield. An unrelated atom whose label happens
 * to reach over the bond keeps its priority: the user is pointing at ink that
 * belongs to that label, and the endpoints are the only atoms whose target a
 * stub is cut short for.
 *
 * Skipped where the span is empty or inverted — two labels that overlap draw
 * no line between them, and there is nothing of the bond's to click.
 */
function atomsYieldingToBond(
  mol: Molecule,
  point: Vec2,
  labelRadius: (atomId: AtomId) => number,
  drawnSpan: ((bondId: BondId) => BondSpan | undefined) | undefined,
  bondTolerance: number,
): Set<AtomId> {
  const yielding = new Set<AtomId>();
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (!bond) continue;
    const from = mol.atoms[bond.from];
    const to = mol.atoms[bond.to];
    if (!from || !to) continue;
    const length = distance(from.pos, to.pos);
    if (!(length > 0)) continue;
    const closest = closestPointOnSegment(point, from.pos, to.pos);
    if (distance(point, closest.point) > bondTolerance) continue;
    const span = drawnSpan?.(bondId) ?? {
      start: labelRadius(bond.from) / length,
      end: 1 - labelRadius(bond.to) / length,
    };
    const drawn = span.end - span.start;
    if (!(drawn > 0)) continue;
    const margin = (drawn * (1 - DRAWN_BOND_MIDDLE)) / 2;
    if (closest.t >= span.start + margin && closest.t <= span.end - margin) {
      yielding.add(bond.from);
      yielding.add(bond.to);
    }
  }
  return yielding;
}

function containsPoint(rect: Rect, p: Vec2): boolean {
  // Inclusive: a marquee dragged flush against an atom centre is a deliberate
  // selection, not a near miss.
  return p.x >= rect.min.x && p.x <= rect.max.x && p.y >= rect.min.y && p.y <= rect.max.y;
}

/**
 * Atoms inside the marquee, in the molecule's insertion order.
 *
 * Insertion order rather than scan order so a selection can be compared and
 * serialised without depending on which way the user happened to drag.
 */
export function atomsInRect(mol: Molecule, rect: Rect): AtomId[] {
  const selected: AtomId[] = [];
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId];
    if (atom && containsPoint(rect, atom.pos)) selected.push(atomId);
  }
  return selected;
}

/**
 * Bonds with BOTH endpoints inside the marquee.
 *
 * Requiring both is what makes "select and delete" behave: a bond whose far
 * atom is outside the box would otherwise be deleted along with the box's
 * contents, leaving a dangling half-drawn structure the user never selected.
 */
export function bondsInRect(mol: Molecule, rect: Rect): BondId[] {
  const selected: BondId[] = [];
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (!bond) continue;
    const from = mol.atoms[bond.from];
    const to = mol.atoms[bond.to];
    if (!from || !to) continue;
    if (containsPoint(rect, from.pos) && containsPoint(rect, to.pos)) {
      selected.push(bondId);
    }
  }
  return selected;
}
