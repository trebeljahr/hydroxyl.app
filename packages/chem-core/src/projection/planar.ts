/**
 * The planar frame's wedge-dash template: the author's own drawing, rotated
 * or mirrored on the page, with its marks carried and corrected to the
 * configuration. The reference frame every other projection is checked
 * against (decision 148).
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
 * CORRECTED, NEVER INVENTED. After the motion the draft is read back through
 * the wedge/hash convention and compared with the configuration it was asked
 * to state, one unit at a time:
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
 *   no mark to carry it   listed `no-mark-to-carry`. Choosing a bond for a
 *                         NEW mark needs the wedge-placement policy (never a
 *                         bond between two centres, prefer a terminal atom,
 *                         avoid ring bonds in a fused system), which is
 *                         `planar-frame-marks-mills-and-steroid`'s.
 *   a double bond         drawn with the other geometry is listed
 *                         `drawn-geometry-disagrees` (no mark can move it); one
 *                         the configuration leaves unspecified gets the
 *                         crossed `either` mark.
 */

import { requireBond } from "../molecule.js";
import { readConfig, type CentreReading, type StereoConfig } from "../stereo-config.js";
import type { AtomId, BondStereo, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
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

const WEDGE_HASH = Object.freeze({ kind: "wedgeHash" as const });

type Skeleton = Readonly<Record<never, never>>;

export const planarWedgeDashTemplate: ProjectionTemplateImplementation<PlanarView, Skeleton> = {
  resolve() {
    return { kind: "available", skeleton: {} };
  },
  place(mol, config, view, _skeleton, toPlace) {
    const draft = emptyPlacedLayout(WEDGE_HASH, projectionBondLength(mol));
    const move = pageMotion(mol, view.params.rotationDeg, view.params.mirror);
    for (const atomId of mol.atomIds) {
      const atom = mol.atoms[atomId];
      if (atom !== undefined) placeLayoutAtom(draft, atomId, move(atom.pos));
    }
    for (const bondId of mol.bondIds) {
      const bond = requireBond(mol, bondId);
      placeLayoutBond(
        draft,
        { id: bondId, from: bond.from, to: bond.to, order: bond.order, sourceBondId: bondId },
        "inPlane",
      );
      if (bond.stereo !== "none") {
        draft.marks.set(bondId, {
          stereo: view.params.mirror ? mirroredStereo(bond.stereo) : bond.stereo,
          narrowEnd: bond.from,
        });
      }
    }
    correctMarks(mol, config, toPlace, draft);
    // Depth from the marks the layout FINALLY draws, after the correction
    // above may have exchanged, blurred or removed some: a wedge comes toward
    // the viewer, a hash goes away, and everything else lies on the page.
    for (const bondId of draft.bonds.keys()) draft.depth.set(bondId, depthOfMark(draft.marks.get(bondId)));
    return draft;
  },
};

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

/**
 * The page motion: mirror across the vertical line through the bounding-box
 * centre (if asked), then rotate counter-clockwise about that centre. Quarter
 * turns use exact 0 and ±1, so a Fischer-like drawing turned 90 degrees stays
 * exactly on the page axes rather than 6e-17 off them.
 */
function pageMotion(mol: Molecule, rotationDeg: number, mirror: boolean): (p: Vec2) => Vec2 {
  if (rotationDeg === 0 && !mirror) return (p) => p;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const atomId of mol.atomIds) {
    const pos = mol.atoms[atomId]?.pos;
    if (pos === undefined) continue;
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
  draft: PlacedLayout,
): void {
  const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), WEDGE_HASH);
  // The wedge/hash convention never refuses a placement; the engine's own
  // read-back reports it if that ever changes.
  if (read.kind !== "read") return;
  // A unit the configuration does not mention is not stated either: its
  // marks go, exactly as for a unit the configuration leaves undetermined.
  const centresToPlace = new Set(toPlace.centres);
  const wantedCentres = new Map(config.centres.map((c) => [c.atomId, c.reading]));
  for (const { atomId, reading: got } of read.config.centres) {
    const want = wantedCentres.get(atomId);
    if (want === undefined) correctCentre(draft, atomId, NOT_STATED, got);
    else if (centresToPlace.has(atomId)) correctCentre(draft, atomId, want, got);
  }

  const bondsToPlace = new Set(toPlace.doubleBonds);
  const wantedBonds = new Map(config.doubleBonds.map((b) => [b.bondId, b.reading]));
  for (const { bondId, reading: got } of read.config.doubleBonds) {
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

function correctCentre(draft: PlacedLayout, atomId: AtomId, want: CentreReading, got: CentreReading): void {
  const own = marksAt(draft, atomId);
  const unplaced = (): void => {
    draft.unplaced.push({ unit: { kind: "centre", atomId }, reason: "no-mark-to-carry" });
  };
  switch (want.kind) {
    case "undetermined":
      if (got.kind !== "undetermined") for (const [bondId] of own) draft.marks.delete(bondId);
      return;
    case "mixture": {
      if (got.kind === "mixture") return;
      const handed = own.filter(([, mark]) => mark.stereo === "wedge" || mark.stereo === "hash");
      if (handed.length === 0) return unplaced();
      for (const [bondId, mark] of handed) draft.marks.set(bondId, { ...mark, stereo: "wavy" });
      return;
    }
    case "specified":
      if (got.kind !== "specified") return unplaced();
      if (got.parity === want.parity) return;
      for (const [bondId, mark] of own) {
        if (mark.stereo === "wedge" || mark.stereo === "hash") {
          draft.marks.set(bondId, { ...mark, stereo: mark.stereo === "wedge" ? "hash" : "wedge" });
        }
      }
      return;
  }
}
