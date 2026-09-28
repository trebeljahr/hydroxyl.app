/**
 * Rigid transforms of a set of atoms: move, rotate, mirror.
 *
 * Geometry only. Nothing here adds, removes or rewires a bond — a transform
 * changes where a structure sits on the page, never what it is connected to.
 * The only non-geometric effects are in `flipAtoms`, which swaps wedge/hash
 * and the manual double-bond side; both are consequences of mirroring — one
 * chemical, one about how the drawing is read — rather than topology edits.
 *
 * SELECTION IS NOT A CHEM-CORE CONCEPT. These functions take a plain
 * `readonly AtomId[]` on purpose. A `Selection` type — with its anchor, its
 * mode, its hover state — belongs to the pointer layer, which is a later task
 * and lives outside this package. Do not "improve" these signatures by
 * introducing one here; chem-core would then depend on an editor concept it
 * has no business knowing about.
 *
 * Ids that are not in the molecule are skipped rather than thrown on. A
 * selection outliving the atoms it points at is an ordinary UI race (undo
 * lands while a drag is in flight), not a programming error.
 *
 * COST MODEL. Each transform is a single linear pass that produces one new
 * atoms record, matching the rule in molecule.ts: `addAtom`/`updateAtom` copy
 * the whole record per call, so driving them from a loop is quadratic.
 */

import type {
  Atom,
  AtomId,
  Bond,
  BondId,
  BondStereo,
  DoubleBondSide,
  Molecule,
} from "./types.js";
import { reachableFrom } from "./molecule.js";
import {
  add,
  dot,
  normalize,
  ORIGIN,
  rotateAround,
  scale,
  snapAngle,
  sub,
  type Vec2,
} from "./vec.js";

/**
 * A mirror line, given as a point on it plus a direction along it. The
 * direction need not be unit length; it is normalised here.
 */
export interface MirrorLine {
  readonly point: Vec2;
  readonly direction: Vec2;
}

/**
 * The listed ids that actually exist, deduplicated.
 *
 * Deduplication matters: a UI selection list can repeat an id (rubber-band
 * over an already-clicked atom), and translating such an atom twice would
 * tear it out of the fragment.
 */
function resolveIds(mol: Molecule, ids: Iterable<AtomId>): Set<AtomId> {
  const present = new Set<AtomId>();
  for (const id of ids) {
    if (mol.atoms[id]) present.add(id);
  }
  return present;
}

/**
 * One linear pass: copy the atoms record once, replace only the listed atoms.
 * Atoms outside the set keep their exact object identity, which is what lets
 * the renderer skip them on a re-render.
 *
 * Returns the input molecule unchanged when nothing moved — not just when the
 * id set is empty, but whenever every new position equals the old one. That
 * covers the cases the editor actually generates: a drag that has not yet
 * crossed a pixel, a rotation whose angle has not yet reached the first snap
 * step, an atom sitting exactly on the mirror axis. Allocating a molecule and
 * a fresh Atom per selected atom for those would repaint the canvas on every
 * pointer-move frame; `setAtomPositions` in ops.ts declines the same work for
 * the same reason.
 */
function repositionAtoms(
  mol: Molecule,
  ids: ReadonlySet<AtomId>,
  move: (pos: Vec2, id: AtomId) => Vec2,
): Molecule {
  if (ids.size === 0) return mol;
  let atoms: Record<AtomId, Atom> | undefined;
  for (const id of ids) {
    const atom = mol.atoms[id];
    if (!atom) continue;
    const pos = move(atom.pos, id);
    if (pos.x === atom.pos.x && pos.y === atom.pos.y) continue;
    atoms ??= { ...mol.atoms };
    atoms[id] = { ...atom, pos };
  }
  if (!atoms) return mol;
  return { ...mol, atoms };
}

/** Move the listed atoms by `delta`. Stereo is untouched: sliding a fragment
 *  across the page cannot change which enantiomer it depicts. */
export function translateAtoms(
  mol: Molecule,
  ids: readonly AtomId[],
  delta: Vec2,
): Molecule {
  return repositionAtoms(mol, resolveIds(mol, ids), (pos) => add(pos, delta));
}

/**
 * Rotate the listed atoms about `pivot` by `angle` radians (counter-clockwise,
 * y-up).
 *
 * With `options.snap` the REQUESTED ANGLE is snapped to the nearest multiple
 * of that increment — not each atom's resulting bearing about the pivot. The
 * distinction is the whole point: snapping per-atom bearings would move each
 * atom by a different amount and shear the structure out of shape, whereas
 * snapping the single rotation keeps it rigid. A snap increment of 0 or less
 * means "no snapping"; that is `snapAngle`'s own contract and is relied on
 * here rather than re-tested.
 *
 * `snap` admits an explicit `undefined` for "no snapping", so a caller wiring
 * it to a modifier key can write `{ snap: shiftHeld ? 15 * DEG : undefined }`
 * rather than assembling the options bag conditionally to satisfy
 * `exactOptionalPropertyTypes`.
 *
 * Stereo is untouched: a rotation in the plane is orientation-preserving, so
 * a wedge still points out of the page afterwards.
 */
export function rotateAtoms(
  mol: Molecule,
  ids: readonly AtomId[],
  pivot: Vec2,
  angle: number,
  options?: { readonly snap?: number | undefined },
): Molecule {
  const applied = snapAngle(angle, options?.snap ?? 0);
  // A zero rotation is the identity, but `rotateAround` cannot see that: its
  // `centre + (v - centre)` round trip perturbs a coordinate by an ulp, which
  // is enough to make every selected atom look moved. Snapping turns this into
  // the common case rather than a curiosity — every pointer-move frame before
  // the first snap step arrives here — so it is worth naming.
  if (applied === 0) return mol;
  return repositionAtoms(mol, resolveIds(mol, ids), (pos) =>
    rotateAround(pos, pivot, applied),
  );
}

/** Wedge and hash are the two out-of-plane directions, so a mirror exchanges
 *  them. `wavy` (undefined configuration) and `none` have nothing to mirror. */
function mirrorStereo(stereo: BondStereo): BondStereo {
  if (stereo === "wedge") return "hash";
  if (stereo === "hash") return "wedge";
  return stereo;
}

/**
 * `left` and `right` name a side of the BOND AXIS, not a side of the page — a
 * horizontal bond has no absolute left. The side is reached by turning the
 * from->to direction ninety degrees one way (`perp` in vec.ts turns
 * counter-clockwise), and a reflection reverses handedness, so the same stored
 * word points at the opposite side of the mirrored drawing. Exchanging them
 * keeps the flipped figure a true mirror image of the one the chemist drew.
 *
 * `auto` and `centered` are symmetric and so survive a mirror untouched.
 */
function mirrorDoubleBondSide(side: DoubleBondSide): DoubleBondSide {
  if (side === "left") return "right";
  if (side === "right") return "left";
  return side;
}

/**
 * Mirror the listed atoms across `axis`.
 *
 * Reflection of a point about a unit direction d, in coordinates relative to
 * a point on the line: v' = 2*(v . d)*d - v.
 *
 * STEREO IS SWAPPED, and the effect is to PRESERVE configuration, not to
 * invert it. This comment used to claim the opposite; the claim was wrong and
 * nothing could catch it until stereo.ts could assign R/S.
 *
 * The geometry: reflecting x negates x, and exchanging wedge for hash negates
 * z. Negating x and z together is a half turn about y — a proper rotation, not
 * a reflection — so the flipped drawing depicts the SAME enantiomer, re-posed
 * facing the other way. Mirroring the positions while leaving the marks as
 * drawn is what would give the opposite enantiomer.
 *
 * That is the intended behaviour, ruled by the repo owner: flip is a LAYOUT
 * operation, for re-posing a fragment so a scheme reads left to right, and it
 * must never silently change which enantiomer the drawing states. Two tests in
 * stereo.test.ts pin both halves — the mirror-positions-only case gives S, and
 * flipAtoms gives back R.
 *
 * So every bond with BOTH endpoints in the mirrored set has wedge and hash
 * exchanged.
 *
 * A MANUAL `doubleBondSide` IS SWAPPED for the same reason, on the same
 * both-endpoints gate: `left`/`right` are relative to the bond's own
 * direction, so a reflection reverses which physical side they name and the
 * inner line of a double bond would come out on the wrong side of the
 * mirrored figure. See `mirrorDoubleBondSide`.
 *
 * A bond with only one endpoint in the set is not being mirrored at all — it
 * is being stretched, because one end moved and the other did not. Its stereo
 * is left alone: there is no enantiomer statement to invert, and guessing
 * would corrupt the part of the drawing the user did not select.
 */
export function flipAtoms(
  mol: Molecule,
  ids: readonly AtomId[],
  axis: MirrorLine,
): Molecule {
  const mirrored = resolveIds(mol, ids);
  if (mirrored.size === 0) return mol;

  // `normalize` yields ORIGIN for a zero-length vector rather than NaN, so a
  // degenerate axis is detectable here instead of poisoning every coordinate
  // downstream. A line with no direction is not a mirror; leave the molecule be.
  const d = normalize(axis.direction);
  if (d.x === 0 && d.y === 0) return mol;

  const moved = repositionAtoms(mol, mirrored, (pos) => {
    const rel = sub(pos, axis.point);
    return add(axis.point, sub(scale(d, 2 * dot(rel, d)), rel));
  });

  let bonds: Record<BondId, Bond> | undefined;
  for (const bondId of moved.bondIds) {
    const bond = moved.bonds[bondId];
    if (!bond) continue;
    if (!mirrored.has(bond.from) || !mirrored.has(bond.to)) continue;
    const stereo = mirrorStereo(bond.stereo);
    const doubleBondSide = mirrorDoubleBondSide(bond.doubleBondSide);
    if (stereo === bond.stereo && doubleBondSide === bond.doubleBondSide) {
      continue;
    }
    bonds ??= { ...moved.bonds };
    bonds[bondId] = { ...bond, stereo, doubleBondSide };
  }
  return bonds ? { ...moved, bonds } : moved;
}

/**
 * Mean position of the listed atoms; ORIGIN when none of them exist.
 *
 * This is the pivot the editor passes for "rotate the selection" and "flip the
 * selection", so it deduplicates for the same reason the transforms do: a
 * repeated id would drag the centroid towards that atom.
 */
export function atomsCentroid(mol: Molecule, ids: readonly AtomId[]): Vec2 {
  const present = resolveIds(mol, ids);
  if (present.size === 0) return ORIGIN;
  let x = 0;
  let y = 0;
  for (const id of present) {
    const atom = mol.atoms[id];
    if (!atom) continue;
    x += atom.pos.x;
    y += atom.pos.y;
  }
  return { x: x / present.size, y: y / present.size };
}

// ---------------------------------------------------------------------------
// Aligning separate structures
// ---------------------------------------------------------------------------

/**
 * The six edges a set of structures can be lined up on, named for the PAGE:
 * `top` is the top of the drawing as a reader sees it.
 */
export type AlignEdge = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** Below this, in bond lengths, two edges already coincide. */
const ALIGN_TOLERANCE = 1e-9;

export const ALIGN_EDGES: readonly AlignEdge[] = Object.freeze([
  "left",
  "centre",
  "right",
  "top",
  "middle",
  "bottom",
]);

/**
 * Line up the separate structures that `ids` touch on one edge of their
 * common bounding box — the reaction-scheme chore of making three molecules
 * sit on one baseline.
 *
 * THE UNIT IS THE CONNECTED STRUCTURE, NOT THE LISTED ATOM. Each structure any
 * listed atom belongs to moves as a whole, rigidly, including atoms that were
 * not listed. Moving only the listed atoms of a half-selected structure would
 * stretch the bonds to the other half, which is a distortion, not an
 * alignment. So one atom of each molecule is enough to name it, and a
 * rubber band over three molecules names all three.
 *
 * `top` IS THE LARGEST y. Model coordinates are y-up (see the package
 * notes), so the top of the page is `max.y` and the bottom is `min.y`; only
 * the SVG renderer flips. `centre` and `middle` are the midpoints of the
 * common box, which is where a chemist expects a column of structures to
 * centre on.
 *
 * ATOM CENTRES, NOT GLYPH EXTENTS. A label's width is chem-render's to know,
 * and chem-core has no fonts; aligning on atom positions puts every
 * skeleton's outermost atom on the line, which is what the eye reads on a
 * skeletal drawing.
 *
 * Fewer than two structures is nothing to align against, and the input comes
 * back unchanged. So does a set that is already aligned. Unknown ids are
 * skipped, as everywhere in this file.
 */
export function alignFragments(
  mol: Molecule,
  ids: readonly AtomId[],
  edge: AlignEdge,
): Molecule {
  const fragmentOf = new Map<AtomId, number>();
  const fragments: AtomId[][] = [];
  for (const id of resolveIds(mol, ids)) {
    if (fragmentOf.has(id)) continue;
    const members = reachableFrom(mol, id);
    for (const member of members) fragmentOf.set(member, fragments.length);
    fragments.push(members);
  }
  if (fragments.length < 2) return mol;

  const horizontal = edge === "left" || edge === "centre" || edge === "right";
  const coord = (pos: Vec2): number => (horizontal ? pos.x : pos.y);
  const extents = fragments.map((members) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of members) {
      const value = coord(mol.atoms[id]!.pos);
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    return { lo, hi };
  });
  const lo = Math.min(...extents.map((e) => e.lo));
  const hi = Math.max(...extents.map((e) => e.hi));
  const pick = (e: { readonly lo: number; readonly hi: number }): number =>
    edge === "left" || edge === "bottom"
      ? e.lo
      : edge === "right" || edge === "top"
        ? e.hi
        : (e.lo + e.hi) / 2;
  const target = pick({ lo, hi });
  // A shift of an ulp is float noise from the midpoint arithmetic, not a
  // misalignment. Treating it as a move would make a second "align" on an
  // aligned scheme hand back a new molecule — and with it an undo entry for
  // nothing.
  const shifts = extents.map((e) => {
    const shift = target - pick(e);
    return Math.abs(shift) < ALIGN_TOLERANCE ? 0 : shift;
  });

  return repositionAtoms(mol, new Set(fragmentOf.keys()), (pos, id) => {
    const shift = shifts[fragmentOf.get(id)!]!;
    return horizontal ? { x: pos.x + shift, y: pos.y } : { x: pos.x, y: pos.y + shift };
  });
}

/**
 * NAMING, because this is exactly the pair that gets used backwards: both are
 * named for the axis of the MIRROR LINE, while a user thinks in terms of the
 * direction things move.
 *
 * `verticalMirror` is a vertical line (along +y). Reflecting across it negates
 * x, so it is the LEFT/RIGHT flip — the one a "flip horizontally" button does.
 */
export function verticalMirror(point: Vec2): MirrorLine {
  return { point, direction: { x: 0, y: 1 } };
}

/**
 * A horizontal line (along +x). Reflecting across it negates y, so it is the
 * TOP/BOTTOM flip — what a "flip vertically" button does. See `verticalMirror`
 * for why the names read inverted to the flip direction.
 */
export function horizontalMirror(point: Vec2): MirrorLine {
  return { point, direction: { x: 1, y: 0 } };
}

// ---------------------------------------------------------------------------
// Bond-length normalisation
// ---------------------------------------------------------------------------

/**
 * The median length of the molecule's drawn bonds, in model units, or
 * undefined when it has no bond of non-zero length.
 *
 * 1.0 is one standard bond, and everything downstream assumes the drawing
 * honours it: `modelToPx` gives one model unit its px size, and the export
 * prints one model unit at the house bond length. A file from another tool
 * need not honour it — molfiles in the wild use 1.5, 1.54, 0.825 and more —
 * so this is how an importer finds out what scale a structure was drawn at.
 *
 * THE MEDIAN, NOT THE MEAN. A drawing has a few deliberately long or short
 * bonds (a macrocycle closure, a bond stretched to clear a label, two atoms
 * dropped on top of each other); the median reads the length the author
 * actually drew with and ignores those. Zero-length bonds are excluded, since
 * they say nothing about scale.
 *
 * Squared lengths are ranked and the square root is taken only of the chosen
 * one(s), so the answer is exactly `Math.sqrt` of a sum of two products —
 * correctly rounded, and the same on every engine (unlike `Math.hypot`).
 */
export function medianBondLength(mol: Molecule): number | undefined {
  const squared: number[] = [];
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (!bond) continue;
    const a = mol.atoms[bond.from];
    const b = mol.atoms[bond.to];
    if (!a || !b) continue;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const sq = dx * dx + dy * dy;
    if (sq > 0) squared.push(sq);
  }
  if (squared.length === 0) return undefined;
  squared.sort((p, q) => p - q);
  const mid = squared.length >> 1;
  const upper = Math.sqrt(squared[mid] as number);
  if (squared.length % 2 === 1) return upper;
  return (Math.sqrt(squared[mid - 1] as number) + upper) / 2;
}

/**
 * Relative slack below which `normalizeBondLength` leaves a molecule alone.
 *
 * A molfile stores coordinates to four decimals, so a structure drawn at
 * exactly the standard bond reads back a few parts in 10^4 off it. Rescaling
 * that would rewrite every coordinate of a file that was already right, for
 * no visible change.
 */
export const BOND_LENGTH_NORMALIZE_TOLERANCE = 1e-3;

/**
 * The molecule uniformly scaled about the origin so its median bond is
 * `target` model units long (default 1, the standard bond).
 *
 * Returned BY REFERENCE when there is nothing to do: no bonds to measure, or
 * a median already within `BOND_LENGTH_NORMALIZE_TOLERANCE` of the target.
 *
 * A uniform scale by a positive factor is a similarity, so the shape, every
 * angle and every stereo mark keep their meaning; ids and topology are
 * untouched. It is a LAYOUT change, on the same footing as `translateAtoms`.
 */
export function normalizeBondLength(mol: Molecule, target = 1): Molecule {
  if (!(target > 0) || !Number.isFinite(target)) {
    throw new RangeError(`normalizeBondLength: target must be a positive length, got ${target}`);
  }
  const median = medianBondLength(mol);
  if (median === undefined) return mol;
  if (Math.abs(median - target) <= target * BOND_LENGTH_NORMALIZE_TOLERANCE) return mol;
  const k = target / median;
  return repositionAtoms(mol, new Set(mol.atomIds), (pos) => ({ x: pos.x * k, y: pos.y * k }));
}
