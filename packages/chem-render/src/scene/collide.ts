/**
 * What is sitting on top of what — REPORTED, never repaired.
 *
 * A figure author would rather see an overlap than see the exported drawing
 * disagree with the coordinates they drew. Auto-nudging a label out of a bond's
 * way moves an atom the author placed, and the move survives into the SVG, the
 * molfile and the next person's reading of the geometry. So this pass mutates
 * nothing: not the molecule, not the scene, not one coordinate. The fix belongs
 * to the editor's "Clean up structure" command, which re-lays-out the whole
 * structure as one undoable transaction and says so.
 *
 * It is a FREE FUNCTION over an assembled scene, deliberately not a field on
 * `RenderScene`:
 *
 *   - every scene build would pay for the scan, including the ones inside a
 *     drag loop, and
 *   - a report hanging off the scene is a field somebody eventually
 *     serialises, at which point the byte-determinism argument would have to
 *     cover the report's own float ordering too.
 *
 * The molecule is needed as well as the scene, because "unrelated" is a
 * chemistry question: a bond's own label sits on it by construction and is
 * trimmed clear of it, so an overlap there means the TRIMMING regressed, and
 * that is a different finding from a label lying across a bond three rings
 * away.
 *
 * COMPLEXITY. The scan is O(atoms x bonds + bonds^2) with an axis-aligned
 * reject in front of every real test. That is a deliberate figure-scale limit,
 * the same call `hitTest`'s linear scan makes in chem-core: it is fine for the
 * few dozen atoms a publication figure holds and is not meant for a 20k-atom
 * import. `maxFindings` bounds the output so a pathological structure cannot
 * produce a million-entry report.
 */

import { aromaticRings, getAtom, ringAt } from "@starter/chem-core";
import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import { aromaticCircleId } from "../bond/aromatic.js";
import type { LabelBox, LabelObstacle } from "../label/placement.js";
import { isStructural } from "../representation.js";
import { modelToPx, pxPerModelUnit } from "../style.js";
import { atomLabelPlacement } from "./build.js";
import type { LinePrimitive, RenderScene, ScenePoint, SceneSource } from "./types.js";

export type CollisionKind =
  /** A label lying across a bond it is not an endpoint of. The fused-ring case. */
  | "label-over-bond"
  /** A label lying across its OWN bond. Trimming regressed; this must never fire. */
  | "label-over-own-bond"
  | "label-over-label"
  /** Two atoms drawn on the same spot — a template drop that did not merge. */
  | "coincident-atoms"
  /** Two non-adjacent bonds crossing. A fragment dropped onto another. */
  | "bond-crosses-bond"
  /** Both labels' clear space met, so the bond between them drew nothing. */
  | "bond-swallowed-by-labels"
  /** An aromatic ring too distorted for a circle, so none was drawn. */
  | "degenerate-aromatic-ring";

export interface Collision {
  readonly kind: CollisionKind;
  readonly a: SceneSource;
  readonly b?: SceneSource;
  /** Roughly how deep the overlap is, px. For ranking a UI, never a sort key. */
  readonly overlapPx: number;
  /** Where to point a marker, scene px. */
  readonly at: ScenePoint;
}

export interface CollisionReport {
  readonly collisions: readonly Collision[];
  /** True when `maxFindings` cut the list short. */
  readonly truncated: boolean;
}

export interface CollisionOptions {
  readonly maxFindings?: number;
  /**
   * How close two atom centres have to be to count as stacked, in MODEL
   * units (bond lengths).
   *
   * Well under chem-core's `DEFAULT_MERGE_RADIUS` of 0.4: anything inside that
   * would have merged on the gesture, so a pair still separate at 0.4 was
   * separated on purpose. 0.1 is the "the drop did not merge and they are on
   * top of each other" signal.
   */
  readonly coincidentToleranceModelUnits?: number;
}

const DEFAULTS = Object.freeze({
  maxFindings: 200,
  coincidentToleranceModelUnits: 0.1,
});

/**
 * Every overlap `scene` contains, in the molecule's own insertion order.
 *
 * The order is a walk of `mol.atomIds` and `mol.bondIds`, never a sort by
 * `overlapPx` — a report that reshuffles itself between two runs of the same
 * molecule is as worthless as a scene that does, and float ties reorder.
 */
export function detectCollisions(
  scene: RenderScene,
  mol: Molecule,
  options?: CollisionOptions,
): CollisionReport {
  const maxFindings = options?.maxFindings ?? DEFAULTS.maxFindings;
  const tolerance =
    options?.coincidentToleranceModelUnits ??
    DEFAULTS.coincidentToleranceModelUnits;

  const collisions: Collision[] = [];
  let truncated = false;
  const report = (collision: Collision): void => {
    if (collisions.length >= maxFindings) {
      truncated = true;
      return;
    }
    collisions.push(collision);
  };

  if (!isStructural(scene.representation)) return { collisions, truncated };
  const style = scene.style;
  const representation = scene.representation;

  // Read off the SCENE, so what is checked is what was drawn.
  const lines = new Map<BondId, LinePrimitive[]>();
  const ringCircleIds = new Set<string>();
  for (const primitive of scene.primitives) {
    if (primitive.type === "line" && primitive.source.kind === "bond") {
      const existing = lines.get(primitive.source.bondId);
      if (existing === undefined) lines.set(primitive.source.bondId, [primitive]);
      else existing.push(primitive);
    }
    if (primitive.type === "circle" && primitive.source.kind === "ring") {
      ringCircleIds.add(primitive.id);
    }
  }

  const centres = new Map<AtomId, ScenePoint>();
  const obstacles = new Map<AtomId, readonly LabelObstacle[]>();
  const boxes = new Map<AtomId, LabelBox>();
  for (const atomId of mol.atomIds) {
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;
    centres.set(atomId, modelToPx(style, atom.pos));
    const placement = atomLabelPlacement(mol, atomId, style, representation);
    if (placement === undefined) continue;
    obstacles.set(atomId, placement.obstacles);
    boxes.set(atomId, placement.clearBox);
  }

  // --- a bond that drew nothing -------------------------------------------
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined) continue;
    const from = centres.get(bond.from);
    const to = centres.get(bond.to);
    if (from === undefined || to === undefined) continue;
    if (lines.has(bondId)) continue;
    report({
      kind: "bond-swallowed-by-labels",
      a: { kind: "bond", bondId },
      overlapPx: distance(from, to),
      at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    });
  }

  // --- labels against bonds -----------------------------------------------
  for (const atomId of mol.atomIds) {
    const shapes = obstacles.get(atomId);
    const box = boxes.get(atomId);
    if (shapes === undefined || box === undefined) continue;
    for (const bondId of mol.bondIds) {
      const bond = mol.bonds[bondId];
      if (bond === undefined) continue;
      const incident = bond.from === atomId || bond.to === atomId;
      for (const line of lines.get(bondId) ?? []) {
        if (!boxMeetsSegment(box, line.a, line.b)) continue;
        const depth = segmentDepthInObstacles(shapes, line.a, line.b);
        if (depth <= 0) continue;
        report({
          // An incident hit is a DIFFERENT finding, not one to exempt.
          // Exempting it would hide the only signal that bond trimming broke.
          kind: incident ? "label-over-own-bond" : "label-over-bond",
          a: { kind: "atom", atomId },
          b: { kind: "bond", bondId },
          overlapPx: depth,
          at: { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 },
        });
      }
    }
  }

  // --- labels against each other ------------------------------------------
  for (let i = 0; i < mol.atomIds.length; i++) {
    const a = mol.atomIds[i]!;
    const boxA = boxes.get(a);
    if (boxA === undefined) continue;
    for (let j = i + 1; j < mol.atomIds.length; j++) {
      const b = mol.atomIds[j]!;
      const boxB = boxes.get(b);
      if (boxB === undefined) continue;
      const overlap = boxOverlap(boxA, boxB);
      if (overlap === undefined) continue;
      // The bounding boxes are the quick reject; the obstacle UNIONS decide.
      // A charged label's box is mostly empty air, and every acetate in the
      // figure would report a false positive against it.
      const shapesA = obstacles.get(a) ?? [];
      const shapesB = obstacles.get(b) ?? [];
      const depth = obstaclesOverlap(shapesA, shapesB);
      if (depth <= 0) continue;
      report({
        kind: "label-over-label",
        a: { kind: "atom", atomId: a },
        b: { kind: "atom", atomId: b },
        overlapPx: depth,
        at: overlap,
      });
    }
  }

  // --- atoms on top of each other -----------------------------------------
  // Through `pxPerModelUnit`, never `style.bondLengthPx` directly: the scale
  // has exactly one owner and this is the sanctioned way to borrow it.
  const coincidentPx = tolerance * pxPerModelUnit(style);
  for (let i = 0; i < mol.atomIds.length; i++) {
    const a = mol.atomIds[i]!;
    const pa = centres.get(a);
    if (pa === undefined) continue;
    for (let j = i + 1; j < mol.atomIds.length; j++) {
      const b = mol.atomIds[j]!;
      const pb = centres.get(b);
      if (pb === undefined) continue;
      const d = distance(pa, pb);
      if (d > coincidentPx) continue;
      report({
        kind: "coincident-atoms",
        a: { kind: "atom", atomId: a },
        b: { kind: "atom", atomId: b },
        overlapPx: coincidentPx - d,
        at: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      });
    }
  }

  // --- bonds crossing bonds -----------------------------------------------
  for (let i = 0; i < mol.bondIds.length; i++) {
    const idA = mol.bondIds[i]!;
    const bondA = mol.bonds[idA];
    const lineA = lines.get(idA)?.[0];
    if (bondA === undefined || lineA === undefined) continue;
    for (let j = i + 1; j < mol.bondIds.length; j++) {
      const idB = mol.bondIds[j]!;
      const bondB = mol.bonds[idB];
      const lineB = lines.get(idB)?.[0];
      if (bondB === undefined || lineB === undefined) continue;
      // Adjacent bonds share a vertex and therefore "cross" at it by
      // construction. Only a genuine crossing of two unrelated bonds is news.
      if (
        bondA.from === bondB.from ||
        bondA.from === bondB.to ||
        bondA.to === bondB.from ||
        bondA.to === bondB.to
      ) {
        continue;
      }
      const at = segmentIntersection(lineA.a, lineA.b, lineB.a, lineB.b);
      if (at === undefined) continue;
      report({
        kind: "bond-crosses-bond",
        a: { kind: "bond", bondId: idA },
        b: { kind: "bond", bondId: idB },
        overlapPx: style.bondLineWidthPx,
        at,
      });
    }
  }

  // --- an aromatic ring too distorted to draw a circle in ------------------
  if (representation.flags.aromaticCircles) {
    for (const [atomIds, centre] of expectedRingCircles(mol, centres)) {
      if (ringCircleIds.has(aromaticCircleId(atomIds))) continue;
      report({
        kind: "degenerate-aromatic-ring",
        a: { kind: "ring", atomIds },
        overlapPx: 0,
        at: centre,
      });
    }
  }

  return { collisions, truncated };
}

/**
 * The aromatic rings a circle was ASKED for, paired with their centroids.
 *
 * Imported lazily through the same helpers `buildStructural` uses, so the two
 * cannot disagree about which rings are aromatic.
 */
function expectedRingCircles(
  mol: Molecule,
  centres: ReadonlyMap<AtomId, ScenePoint>,
): readonly (readonly [readonly AtomId[], ScenePoint])[] {
  const order = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => order.set(id, index));

  const out: (readonly [readonly AtomId[], ScenePoint])[] = [];
  for (const ringIndex of aromaticRings(mol)) {
    const ring = ringAt(mol, ringIndex);
    let x = 0;
    let y = 0;
    let seen = 0;
    for (const atomId of ring.atomIds) {
      const centre = centres.get(atomId);
      if (centre === undefined) continue;
      x += centre.x;
      y += centre.y;
      seen++;
    }
    if (seen !== ring.atomIds.length || seen === 0) continue;
    const atomIds = [...ring.atomIds].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
    out.push([atomIds, { x: x / seen, y: y / seen }]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry. Local, and `Math.sqrt` only — never `Math.hypot`, for the reason
// in the header of label/placement.ts.
// ---------------------------------------------------------------------------

function distance(a: ScenePoint, b: ScenePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function boxOf(obstacle: LabelObstacle): LabelBox {
  if (obstacle.kind === "rect") return obstacle.box;
  return {
    minX: obstacle.centre.x - obstacle.radius,
    minY: obstacle.centre.y - obstacle.radius,
    maxX: obstacle.centre.x + obstacle.radius,
    maxY: obstacle.centre.y + obstacle.radius,
  };
}

function boxOverlap(a: LabelBox, b: LabelBox): ScenePoint | undefined {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX >= maxX || minY >= maxY) return undefined;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The deepest box-on-box penetration between the two obstacle unions. */
function obstaclesOverlap(
  a: readonly LabelObstacle[],
  b: readonly LabelObstacle[],
): number {
  let deepest = 0;
  for (const one of a) {
    const boxA = boxOf(one);
    for (const other of b) {
      const boxB = boxOf(other);
      const x = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
      const y = Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY);
      if (x <= 0 || y <= 0) continue;
      const depth = Math.min(x, y);
      if (depth > deepest) deepest = depth;
    }
  }
  return deepest;
}

/** Cheap reject: does the segment's own bounding box meet `box` at all. */
function boxMeetsSegment(box: LabelBox, a: ScenePoint, b: ScenePoint): boolean {
  return (
    Math.min(a.x, b.x) <= box.maxX &&
    Math.max(a.x, b.x) >= box.minX &&
    Math.min(a.y, b.y) <= box.maxY &&
    Math.max(a.y, b.y) >= box.minY
  );
}

/**
 * How much of the segment lies inside the obstacle union, px.
 *
 * Sampled rather than clipped analytically: the answer only has to be positive
 * and roughly proportional, since it ranks a warning list and never orders it.
 * The sample count is fixed, so the answer is a pure function of its inputs.
 */
const OVERLAP_SAMPLES = 32;

function segmentDepthInObstacles(
  obstacles: readonly LabelObstacle[],
  a: ScenePoint,
  b: ScenePoint,
): number {
  const length = distance(a, b);
  if (length === 0) return 0;
  let inside = 0;
  for (let k = 0; k <= OVERLAP_SAMPLES; k++) {
    const t = k / OVERLAP_SAMPLES;
    const p: ScenePoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (obstacles.some((obstacle) => contains(obstacle, p))) inside++;
  }
  return (inside / (OVERLAP_SAMPLES + 1)) * length;
}

/**
 * STRICTLY inside, by a hairline.
 *
 * A correctly trimmed bond ends exactly ON the far edge of the obstacle it
 * exited — that is what an exact ray-exit means — so an inclusive test reports
 * every trimmed bond in the figure as lying on its own label. The margin is
 * far below any overlap a reader could see and far above the rounding in the
 * trim.
 */
const TOUCHING_EPSILON_PX = 1e-6;

function contains(obstacle: LabelObstacle, p: ScenePoint): boolean {
  if (obstacle.kind === "rect") {
    return (
      p.x > obstacle.box.minX + TOUCHING_EPSILON_PX &&
      p.x < obstacle.box.maxX - TOUCHING_EPSILON_PX &&
      p.y > obstacle.box.minY + TOUCHING_EPSILON_PX &&
      p.y < obstacle.box.maxY - TOUCHING_EPSILON_PX
    );
  }
  const dx = p.x - obstacle.centre.x;
  const dy = p.y - obstacle.centre.y;
  const radius = obstacle.radius - TOUCHING_EPSILON_PX;
  return dx * dx + dy * dy < radius * radius;
}

/** Proper crossing of two open segments, or undefined. */
function segmentIntersection(
  p1: ScenePoint,
  p2: ScenePoint,
  q1: ScenePoint,
  q2: ScenePoint,
): ScenePoint | undefined {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / denominator;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined;
  return { x: p1.x + rx * t, y: p1.y + ry * t };
}
