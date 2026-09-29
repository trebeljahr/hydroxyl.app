/**
 * The planar frame's Mills template: every ring system re-laid as regular
 * polygons, and the marks written AFTER the layout (decision 164).
 *
 * THE ONE PLANAR POLICY THAT GENERATES COORDINATES. Wedge-dash and the
 * steroid panel move the author's drawing as a rigid piece; Mills builds its
 * rings afresh, because a perspective or hand-skewed ring is exactly what a
 * Mills panel exists to straighten. The result is a `ProjectedLayout` value:
 * the document's geometry is never touched (decisions 12, 129).
 *
 * THE RINGS (decision 180). A ring system is the rings joined by a shared
 * bond or a spiro atom. Each is built from regular polygons of edge `b`, ring
 * by ring in `rings(mol)` order: the first as a regular polygon, each next one
 * on an edge it shares with the built part, on the far side from the ring
 * that owns that edge; a peri-fused ring, sharing two edges, keeps the atoms
 * already placed; a spiro ring hangs off its shared atom, pointing away from
 * the built part. The finished system is then turned, reflected when that
 * fits better, and moved as ONE rigid piece onto the author's drawing by least
 * squares. Nothing is bent to fit, and the reflection states nothing: the
 * marks are written afterwards, from the configuration.
 *
 * A BRIDGED SYSTEM HAS NO SUCH LAYOUT. Two rings sharing two or more bonds
 * (norbornane, adamantane, a kaurane's C/D rings) cannot both be regular
 * polygons in one plane, so Mills refuses the panel as
 * `bridged-ring-system`, naming those rings' atoms, rather than draw a
 * distorted one that claims to be regular.
 *
 * EVERYTHING ELSE KEEPS ITS DRAWN DIRECTION. Only ring atoms get template
 * coordinates. Each connected piece of non-ring atoms moves by the mean
 * displacement of the ring atoms it hangs from: for a substituent that is one
 * atom, so its drawn direction and length are kept; a chain linking two ring
 * systems moves by the average of both; a piece touching no ring does not
 * move. What that leaves crowded is REPORTED as a collision by the engine,
 * never nudged.
 *
 * THEN THE PAGE, THEN THE MARKS. The panel's own rotation and mirror apply
 * to the re-laid positions, and only then are the marks written: every
 * author mark at a centre is dropped and each centre gets one mark by the
 * wedge-placement policy (marks.ts, decision 178), read back and exchanged to
 * state the configuration. A double bond whose drawn geometry the re-layout
 * changed is listed `drawn-geometry-disagrees`, as in wedge-dash.
 */

import { bondsAt, otherEnd } from "../molecule.js";
import { rings, ringMembership, type Ring } from "../rings.js";
import { compareIds } from "../selection.js";
import { readConfig } from "../stereo-config.js";
import type { AtomId, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
import { projectionUnavailable } from "./frames.js";
import { writeCentreMarks } from "./marks.js";
import {
  correctDoubleBonds,
  pageMotion,
  placeSourceBonds,
  resolvePlanar,
  setDepthFromMarks,
  WEDGE_HASH,
  type PlanarSkeleton,
} from "./planar.js";
import { attachSkeletonLabels } from "./skeleton-labels.js";
import {
  draftLayoutAccess,
  emptyPlacedLayout,
  placeLayoutAtom,
  placementOfLayout,
  projectionBondLength,
  type ProjectionTemplateImplementation,
  type ProjectionTemplateResolution,
} from "./template.js";
import type { PlanarView } from "./types.js";

/** A ring system laid out at unit edge, in a frame of its own. */
interface SystemLayout {
  readonly atomIds: readonly AtomId[];
  readonly local: ReadonlyMap<AtomId, Vec2>;
}

/** A connected piece of non-ring atoms and the ring atoms it hangs from. */
interface Piece {
  readonly atomIds: readonly AtomId[];
  readonly anchors: readonly AtomId[];
}

export interface MillsSkeleton extends PlanarSkeleton {
  readonly systems: readonly SystemLayout[];
  readonly pieces: readonly Piece[];
}

export const planarMillsTemplate: ProjectionTemplateImplementation<PlanarView, MillsSkeleton> = {
  resolve(mol, view) {
    const planar = resolvePlanar(mol, view);
    if (planar.kind !== "available") return planar;
    const mills = resolveMills(mol);
    if (mills.kind !== "available") return mills;
    return { kind: "available", skeleton: { ...mills.skeleton, ...planar.skeleton } };
  },
  place(mol, config, view, skeleton, toPlace, reach) {
    const b = projectionBondLength(mol);
    const positions = relaid(mol, skeleton, b);
    const move = pageMotion([...positions.values()], view.params.rotationDeg, view.params.mirror);
    const draft = emptyPlacedLayout(WEDGE_HASH, b);
    for (const atomId of mol.atomIds) {
      const pos = positions.get(atomId);
      if (pos !== undefined) placeLayoutAtom(draft, atomId, move(pos));
    }
    placeSourceBonds(mol, draft);
    writeCentreMarks(mol, config, draft, toPlace.centres);
    const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), WEDGE_HASH, {
      centres: [],
      doubleBonds: reach.doubleBonds,
    });
    if (read.kind === "read") correctDoubleBonds(mol, config, toPlace, read.config, draft);
    setDepthFromMarks(draft);
    if (skeleton.labels !== undefined) attachSkeletonLabels(mol, config, skeleton.labels, draft);
    return draft;
  },
};

// ---------------------------------------------------------------------------
// Topology: the systems and their unit layouts
// ---------------------------------------------------------------------------

export function resolveMills(mol: Molecule): ProjectionTemplateResolution<Omit<MillsSkeleton, "labels">> {
  const perceived = rings(mol);
  const membership = ringMembership(mol);

  // Bridged: a pair of rings sharing two or more bonds.
  const shared = new Map<string, number>();
  for (const bondId of mol.bondIds) {
    const indices = membership.bonds[bondId] ?? [];
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const key = `${Math.min(indices[i]!, indices[j]!)},${Math.max(indices[i]!, indices[j]!)}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const bridged = new Set<AtomId>();
  for (const [key, count] of shared) {
    if (count < 2) continue;
    for (const index of key.split(",").map(Number)) for (const id of perceived[index]!.atomIds) bridged.add(id);
  }
  if (bridged.size > 0) return projectionUnavailable("bridged-ring-system", [...bridged].sort(compareIds));

  // Systems: rings joined by a shared atom (fused or spiro), by union-find.
  const parent = perceived.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const atomId of mol.atomIds) {
    const indices = membership.atoms[atomId] ?? [];
    for (let k = 1; k < indices.length; k++) {
      const a = find(indices[0]!);
      const c = find(indices[k]!);
      if (a !== c) parent[Math.max(a, c)] = Math.min(a, c);
    }
  }
  const groups = new Map<number, Ring[]>();
  perceived.forEach((ring, index) => {
    const root = find(index);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [ring]);
    else list.push(ring);
  });
  const systems: SystemLayout[] = [];
  for (const group of groups.values()) {
    const local = layoutSystem(group);
    systems.push({ atomIds: mol.atomIds.filter((id) => local.has(id)), local });
  }

  // Pieces of non-ring atoms, by breadth-first search that never enters a ring.
  const ringAtom = (id: AtomId): boolean => (membership.atoms[id] ?? []).length > 0;
  const seen = new Set<AtomId>();
  const pieces: Piece[] = [];
  for (const start of mol.atomIds) {
    if (seen.has(start) || ringAtom(start)) continue;
    const atoms: AtomId[] = [start];
    const anchors = new Set<AtomId>();
    seen.add(start);
    for (let i = 0; i < atoms.length; i++) {
      for (const bond of bondsAt(mol, atoms[i]!)) {
        const next = otherEnd(bond, atoms[i]!);
        if (ringAtom(next)) anchors.add(next);
        else if (!seen.has(next)) {
          seen.add(next);
          atoms.push(next);
        }
      }
    }
    pieces.push({ atomIds: atoms, anchors: [...anchors].sort(compareIds) });
  }
  return { kind: "available", skeleton: { systems, pieces } };
}

/** Circumradius and apothem of a regular n-gon of unit edge. */
function radius(n: number): number {
  return 1 / (2 * Math.sin(Math.PI / n));
}

function apothem(n: number): number {
  return 1 / (2 * Math.tan(Math.PI / n));
}

function rotate(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function centroidOf(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * One ring system at unit edge: ring by ring, each regular polygon built on
 * what is already placed. The rings arrive in `rings(mol)` order, which is
 * fixed by the atom ids, so the layout is too.
 */
function layoutSystem(system: readonly Ring[]): Map<AtomId, Vec2> {
  const pos = new Map<AtomId, Vec2>();
  const placed: Ring[] = [];
  const first = system[0]!;
  const n0 = first.size;
  first.atomIds.forEach((id, k) => {
    const angle = Math.PI / 2 + (2 * Math.PI * k) / n0;
    pos.set(id, { x: radius(n0) * Math.cos(angle), y: radius(n0) * Math.sin(angle) });
  });
  placed.push(first);
  const remaining = system.slice(1);

  while (remaining.length > 0) {
    let index = remaining.findIndex((ring) => sharedEdge(ring, pos) !== undefined);
    const byEdge = index >= 0;
    if (!byEdge) index = remaining.findIndex((ring) => ring.atomIds.some((id) => pos.has(id)));
    // A system is connected by construction; this guards the loop only.
    if (index < 0) break;
    const ring = remaining.splice(index, 1)[0]!;
    if (byEdge) buildOnEdge(ring, sharedEdge(ring, pos)!, placed, pos);
    else buildOnAtom(ring, pos);
    placed.push(ring);
  }
  return pos;
}

/** The first walk index `i` whose edge (i, i+1) has both atoms placed. */
function sharedEdge(ring: Ring, pos: ReadonlyMap<AtomId, Vec2>): number | undefined {
  const n = ring.size;
  for (let i = 0; i < n; i++) {
    if (pos.has(ring.atomIds[i]!) && pos.has(ring.atomIds[(i + 1) % n]!)) return i;
  }
  return undefined;
}

function buildOnEdge(ring: Ring, i: number, placed: readonly Ring[], pos: Map<AtomId, Vec2>): void {
  const n = ring.size;
  const u = ring.atomIds[i]!;
  const v = ring.atomIds[(i + 1) % n]!;
  const a = pos.get(u)!;
  const b = pos.get(v)!;
  // The ring that already owns the edge: the new one goes on its far side.
  const owner = placed.find((r) => r.bondIds.some((id) => ring.bondIds[i] === id)) ?? placed[0]!;
  const ownerCentre = centroidOf(owner.atomIds.map((id) => pos.get(id)!));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const length = Math.hypot(edge.x, edge.y) || 1;
  // One of the edge's two normals; `side` turns it away from the owner.
  const normal = { x: edge.y / length, y: edge.x / -length };
  const side = (ownerCentre.x - mid.x) * normal.x + (ownerCentre.y - mid.y) * normal.y > 0 ? -1 : 1;
  const out = apothem(n) * side;
  const centre = { x: mid.x + normal.x * out, y: mid.y + normal.y * out };
  const fromCentre = { x: a.x - centre.x, y: a.y - centre.y };
  const toB = { x: b.x - centre.x, y: b.y - centre.y };
  const step = Math.atan2(fromCentre.x * toB.y - fromCentre.y * toB.x, fromCentre.x * toB.x + fromCentre.y * toB.y);
  for (let k = 0; k < n; k++) {
    const id = ring.atomIds[(i + k) % n]!;
    if (pos.has(id)) continue;
    const r = rotate(fromCentre, k * step);
    pos.set(id, { x: centre.x + r.x, y: centre.y + r.y });
  }
}

function buildOnAtom(ring: Ring, pos: Map<AtomId, Vec2>): void {
  const n = ring.size;
  const j = ring.atomIds.findIndex((id) => pos.has(id));
  const s = pos.get(ring.atomIds[j]!)!;
  const built = centroidOf([...pos.values()]);
  let away = { x: s.x - built.x, y: s.y - built.y };
  const length = Math.hypot(away.x, away.y);
  away = length > 1e-12 ? { x: away.x / length, y: away.y / length } : { x: 1, y: 0 };
  const centre = { x: s.x + away.x * radius(n), y: s.y + away.y * radius(n) };
  const fromCentre = { x: s.x - centre.x, y: s.y - centre.y };
  for (let k = 1; k < n; k++) {
    const id = ring.atomIds[(j + k) % n]!;
    if (pos.has(id)) continue;
    const r = rotate(fromCentre, (2 * Math.PI * k) / n);
    pos.set(id, { x: centre.x + r.x, y: centre.y + r.y });
  }
}

// ---------------------------------------------------------------------------
// Placement: fit each system onto the drawing, carry the pieces
// ---------------------------------------------------------------------------

/**
 * The re-laid position of every atom: ring atoms from their system's unit
 * layout scaled to `b` and fitted onto the drawing, non-ring atoms moved with
 * the ring atoms they hang from.
 */
function relaid(mol: Molecule, skeleton: MillsSkeleton, b: number): Map<AtomId, Vec2> {
  const out = new Map<AtomId, Vec2>();
  for (const system of skeleton.systems) {
    const fitted = fitOnto(
      system.atomIds.map((id) => scaled(system.local.get(id)!, b)),
      system.atomIds.map((id) => mol.atoms[id]!.pos),
    );
    system.atomIds.forEach((id, k) => out.set(id, fitted[k]!));
  }
  for (const piece of skeleton.pieces) {
    let dx = 0;
    let dy = 0;
    for (const anchor of piece.anchors) {
      const now = out.get(anchor)!;
      const was = mol.atoms[anchor]!.pos;
      dx += now.x - was.x;
      dy += now.y - was.y;
    }
    const count = piece.anchors.length;
    const shift = count === 0 ? { x: 0, y: 0 } : { x: dx / count, y: dy / count };
    for (const id of piece.atomIds) {
      const was = mol.atoms[id]!.pos;
      out.set(id, { x: was.x + shift.x, y: was.y + shift.y });
    }
  }
  return out;
}

function scaled(p: Vec2, b: number): Vec2 {
  return { x: p.x * b, y: p.y * b };
}

/**
 * `model` moved by the rigid motion (a rotation, and a reflection when that
 * fits better) that best lays it onto `target` by least squares: the 2D
 * Kabsch fit. Rotation and centroid are both fitted, so a drawing already
 * made of regular polygons comes back where it was.
 */
export function fitOnto(model: readonly Vec2[], target: readonly Vec2[]): Vec2[] {
  return model.map(rigidMotion(model, target));
}

/**
 * The rigid motion that best lays `model` onto `target`, as a function any
 * point can be put through: centroid onto centroid, then the rotation — with
 * a reflection first, only when that fits strictly better — minimising the
 * summed squared distance. Degenerate input (every point on one spot) gives
 * the pure translation.
 */
export function rigidMotion(model: readonly Vec2[], target: readonly Vec2[]): (p: Vec2) => Vec2 {
  const m = centroidOf(model);
  const t = centroidOf(target);
  let best: { reflect: boolean; angle: number; score: number } | undefined;
  for (const reflect of [false, true]) {
    let dot = 0;
    let cross = 0;
    model.forEach((p, k) => {
      const px = reflect ? m.x - p.x : p.x - m.x;
      const py = p.y - m.y;
      const qx = target[k]!.x - t.x;
      const qy = target[k]!.y - t.y;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
    });
    const score = Math.hypot(dot, cross);
    // A reflection must fit strictly better to be taken.
    if (best === undefined || score > best.score * (1 + 1e-9) + 1e-12) {
      best = { reflect, angle: Math.atan2(cross, dot), score };
    }
  }
  const { reflect, angle } = best!;
  return (p) => {
    const r = rotate({ x: reflect ? m.x - p.x : p.x - m.x, y: p.y - m.y }, angle);
    return { x: t.x + r.x, y: t.y + r.y };
  };
}
