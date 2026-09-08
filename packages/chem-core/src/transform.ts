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
  move: (pos: Vec2) => Vec2,
): Molecule {
  if (ids.size === 0) return mol;
  let atoms: Record<AtomId, Atom> | undefined;
  for (const id of ids) {
    const atom = mol.atoms[id];
    if (!atom) continue;
    const pos = move(atom.pos);
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
