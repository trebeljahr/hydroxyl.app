/**
 * The planar frame's wedge-dash template: the author's own drawing, rotated
 * or mirrored on the page, with its marks carried and corrected to the
 * configuration. The reference frame every other projection is checked
 * against (decision 148). Also the helpers the other planar templates (Mills,
 * the steroid panel) share with it.
 *
 * WHAT MOVES. Positions only, by one proper motion of the page: a mirror
 * across the vertical axis through the drawing's centre (the middle of its
 * bounding box), then a counter-clockwise rotation about the same point. With
 * no rotation and no mirror every position is the atom's own, exactly, not a
 * rounded copy of it.
 *
 * A MIRROR EXCHANGES WEDGE AND HASH. Mirroring positions alone would draw the
 * other enantiomer; with the marks exchanged the panel is a half-turn of the
 * molecule about the page's y axis, the same enantiomer seen from behind —
 * the rule `flipAtoms` follows, for the same reason: a panel is a view, and a
 * view never changes which compound is stated (decision 12). `wavy` and
 * `either` state no handedness and stay as drawn.
 *
 * CORRECTED, AND WRITTEN ONLY WHERE THE DRAWING SAYS NOTHING. After the
 * motion the draft is read back through the wedge/hash convention and
 * compared with the configuration it was asked to state, one unit at a time:
 *
 *   the opposite parity   every wedge and hash whose NARROW END is this
 *                         centre is exchanged. Marks only count at their
 *                         narrow end, so this touches no other centre, and
 *                         reversing every depth sign — the implicit ligand's
 *                         included, which sits opposite the marks — negates
 *                         the one signed volume exactly.
 *   a mixture             a wedge or hash at the centre becomes wavy.
 *   not specified         the marks at the centre are removed: a layout never
 *                         states more than its configuration (decision 146).
 *   nothing, or nothing   the centre's own marks (if any) are removed and ONE
 *   readable, drawn       new mark is written by the wedge-placement policy
 *                         (marks.ts, decision 178). The author's marks
 *                         everywhere else are kept as drawn (decision 148);
 *                         a centre no candidate can state is listed
 *                         `no-mark-to-carry`.
 *   a double bond         drawn with the other geometry is listed
 *                         `drawn-geometry-disagrees` (no mark can move it); one
 *                         the configuration leaves unspecified gets the
 *                         crossed `either` mark.
 */

import { requireBond } from "../molecule.js";
import { readConfig, type CentreReading, type StereoConfig } from "../stereo-config.js";
import type { AtomId, BondStereo, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
import { writeCentreMarks } from "./marks.js";
import {
  draftLayoutAccess,
  emptyPlacedLayout,
  placeLayoutAtom,
  placeLayoutBond,
  placementOfLayout,
  projectionBondLength,
  type PlacedLayout,
  type ProjectionTemplateImplementation,
} from "./template.js";
import type { BondDepth, LayoutMark, PlanarView, ProjectionCoverage } from "./types.js";

export const WEDGE_HASH = Object.freeze({ kind: "wedgeHash" as const });

type Skeleton = Readonly<Record<never, never>>;

export const planarWedgeDashTemplate: ProjectionTemplateImplementation<PlanarView, Skeleton> = {
  resolve() {
    return { kind: "available", skeleton: {} };
  },
  place(mol, config, view, _skeleton, toPlace, reach) {
    const draft = emptyPlacedLayout(WEDGE_HASH, projectionBondLength(mol));
    const move = pageMotion(drawnPositions(mol), view.params.rotationDeg, view.params.mirror);
    for (const atomId of mol.atomIds) {
      const atom = mol.atoms[atomId];
      if (atom !== undefined) placeLayoutAtom(draft, atomId, move(atom.pos));
    }
    placeSourceBonds(mol, draft);
    for (const bondId of mol.bondIds) {
      const bond = requireBond(mol, bondId);
      if (bond.stereo !== "none") {
        draft.marks.set(bondId, {
          stereo: view.params.mirror ? mirroredStereo(bond.stereo) : bond.stereo,
          narrowEnd: bond.from,
        });
      }
    }
    correctMarks(mol, config, toPlace, reach, draft);
    setDepthFromMarks(draft);
    return draft;
  },
};

/** Every source bond as a plain line between its own two atoms. */
export function placeSourceBonds(mol: Molecule, draft: PlacedLayout): void {
  for (const bondId of mol.bondIds) {
    const bond = requireBond(mol, bondId);
    placeLayoutBond(
      draft,
      { id: bondId, from: bond.from, to: bond.to, order: bond.order, sourceBondId: bondId },
      "inPlane",
    );
  }
}

/**
 * Depth from the marks the layout FINALLY draws, after any correction has
 * exchanged, blurred, removed or written some: a wedge comes toward the
 * viewer, a hash goes away, and everything else lies on the page.
 */
export function setDepthFromMarks(draft: PlacedLayout): void {
  for (const lineId of draft.bonds.keys()) draft.depth.set(lineId, depthOfMark(draft.marks.get(lineId)));
}

function depthOfMark(mark: LayoutMark | undefined): BondDepth {
  if (mark?.stereo === "wedge") return "front";
  if (mark?.stereo === "hash") return "back";
  return "inPlane";
}

function mirroredStereo(stereo: Exclude<BondStereo, "none">): Exclude<BondStereo, "none"> {
  if (stereo === "wedge") return "hash";
  if (stereo === "hash") return "wedge";
  return stereo;
}

/** The atoms' own positions, in `mol.atomIds` order. */
export function drawnPositions(mol: Molecule): Vec2[] {
  const out: Vec2[] = [];
  for (const atomId of mol.atomIds) {
    const pos = mol.atoms[atomId]?.pos;
    if (pos !== undefined) out.push(pos);
  }
  return out;
}

/**
 * The page motion: mirror across the vertical line through the bounding-box
 * centre of `points` (if asked), then rotate counter-clockwise about that
 * centre. Quarter turns use exact 0 and ±1, so a Fischer-like drawing turned
 * 90 degrees stays exactly on the page axes rather than 6e-17 off them.
 */
export function pageMotion(points: readonly Vec2[], rotationDeg: number, mirror: boolean): (p: Vec2) => Vec2 {
  if (rotationDeg === 0 && !mirror) return (p) => p;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pos of points) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const [cos, sin] = quarterExact(rotationDeg);
  return (p) => {
    const dx = mirror ? cx - p.x : p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
}

function quarterExact(degrees: number): readonly [number, number] {
  if (degrees === 0) return [1, 0];
  if (degrees === 90) return [0, 1];
  if (degrees === 180) return [-1, 0];
  if (degrees === 270) return [0, -1];
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

const NOT_STATED = Object.freeze({ kind: "undetermined" as const, reason: "no-stereo-bond" as const });

/** The marks whose narrow end is `centre`, by layout bond id. */
function marksAt(draft: PlacedLayout, centre: AtomId): [string, LayoutMark][] {
  return [...draft.marks].filter(([, mark]) => mark.narrowEnd === centre);
}

function correctMarks(
  mol: Molecule,
  config: StereoConfig,
  toPlace: ProjectionCoverage,
  reach: ProjectionCoverage,
  draft: PlacedLayout,
): void {
  // Scoped to the frame's REACH, not to `toPlace` (decision 171): a unit the
  // configuration does not mention is outside `toPlace`, and its marks must
  // still be read so they can be stripped below.
  const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), WEDGE_HASH, reach);
  // The wedge/hash convention never refuses a placement; the engine's own
  // read-back reports it if that ever changes.
  if (read.kind !== "read") return;
  // A unit the configuration does not mention is not stated either: its
  // marks go, exactly as for a unit the configuration leaves undetermined.
  const centresToPlace = new Set(toPlace.centres);
  const wantedCentres = new Map(config.centres.map((c) => [c.atomId, c.reading]));
  const toWrite: AtomId[] = [];
  for (const { atomId, reading: got } of read.config.centres) {
    const want = wantedCentres.get(atomId);
    if (want === undefined) correctCentre(draft, atomId, NOT_STATED, got);
    else if (centresToPlace.has(atomId) && correctCentre(draft, atomId, want, got) === "write") toWrite.push(atomId);
  }
  // Written after every author mark has been settled, so the policy sees
  // which atoms those marks already touch.
  writeCentreMarks(mol, config, draft, toWrite);
  correctDoubleBonds(mol, config, toPlace, read.config, draft);
}

/**
 * Double bonds against the configuration, from a read of the draft: one drawn
 * with the other geometry is `drawn-geometry-disagrees` (no mark can move
 * it), and one the configuration leaves unspecified that the geometry
 * specifies gets the crossed `either` mark.
 */
export function correctDoubleBonds(
  mol: Molecule,
  config: StereoConfig,
  toPlace: ProjectionCoverage,
  read: StereoConfig,
  draft: PlacedLayout,
): void {
  const bondsToPlace = new Set(toPlace.doubleBonds);
  const wantedBonds = new Map(config.doubleBonds.map((b) => [b.bondId, b.reading]));
  for (const { bondId, reading: got } of read.doubleBonds) {
    const want = wantedBonds.get(bondId) ?? NOT_STATED;
    if (wantedBonds.has(bondId) && !bondsToPlace.has(bondId)) continue;
    if (want.kind === "specified") {
      if (got.kind !== "specified" || got.relation !== want.relation) {
        draft.unplaced.push({ unit: { kind: "doubleBond", bondId }, reason: "drawn-geometry-disagrees" });
      }
    } else if (got.kind === "specified") {
      draft.marks.set(bondId, { stereo: "either", narrowEnd: requireBond(mol, bondId).from });
    }
  }
}

/**
 * Settles one centre's author marks against the configuration, or says it
 * needs a mark written: its drawing states nothing, or nothing readable
 * (ambiguous geometry, opposed marks), where the configuration states
 * something. Its own marks are then removed first, so the written one is the
 * only one (decision 178).
 */
function correctCentre(
  draft: PlacedLayout,
  atomId: AtomId,
  want: CentreReading,
  got: CentreReading,
): "done" | "write" {
  const own = marksAt(draft, atomId);
  const rewrite = (): "write" => {
    for (const [lineId] of own) draft.marks.delete(lineId);
    return "write";
  };
  switch (want.kind) {
    case "undetermined":
      if (got.kind !== "undetermined") for (const [lineId] of own) draft.marks.delete(lineId);
      return "done";
    case "mixture": {
      if (got.kind === "mixture") return "done";
      const handed = own.filter(([, mark]) => mark.stereo === "wedge" || mark.stereo === "hash");
      if (handed.length === 0) return rewrite();
      for (const [lineId, mark] of handed) draft.marks.set(lineId, { ...mark, stereo: "wavy" });
      return "done";
    }
    case "specified":
      if (got.kind !== "specified") return rewrite();
      if (got.parity === want.parity) return "done";
      for (const [lineId, mark] of own) {
        if (mark.stereo === "wedge" || mark.stereo === "hash") {
          draft.marks.set(lineId, { ...mark, stereo: mark.stereo === "wedge" ? "hash" : "wedge" });
        }
      }
      return "done";
  }
}
