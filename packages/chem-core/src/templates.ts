/**
 * Ring and chain templates: the "stamp a ring here" gestures.
 *
 * Four gestures, distinguished only by how much of the new ring already
 * exists. Fusing shares an edge (naphthalene from benzene), attaching hangs
 * the ring off a new bond (biphenyl), spiro pins one shared vertex
 * (spiro[4.5]decane), and appending grows a plain zig-zag chain. Everything
 * here is layout: the structural edits are `addAtom`/`addBond` from
 * molecule.ts and `insertFragment` from fragment.ts, and the geometry is
 * vec.ts's.
 *
 * Four decisions are load-bearing, and each is a policy rather than an
 * implementation accident.
 *
 * KEKULE IS THE STORAGE FORM. A template with `kekule` lays alternating
 * single and double bonds and never sets an aromatic flag on anything —
 * that is `aromatic.ts`'s job, derived from the Kekule structure at
 * perception time. `builders.ts`'s `benzene` makes the same choice for the
 * same reason: Kekule is what journals print, what every export format
 * survives, and what perception can always turn into a delocalised ring,
 * while the reverse direction is lossy.
 *
 * VALENCE NEVER BLOCKS A PLACEMENT, exactly as it never blocks a sprout.
 * This file does not import valence.ts, so there is no second policy to keep
 * in step with `valenceIssues`'s "report rather than prevent". A ring fused
 * onto an already-saturated bond is drawn, and the badge appears afterwards.
 *
 * A REGULAR POLYGON IS BUILT ON THE EDGE IT IS FUSED TO. `options.bondLength`
 * is honoured by attach/spiro/append, which have no existing edge constraining
 * them, and deliberately ignored by `fuseRingOnBond` — see the note there.
 *
 * A VERTEX THAT LANDS ON AN EXISTING ATOM IS THAT ATOM. Regular polygons on a
 * shared lattice meet: fusing a hexagon onto the peripheral bond next to
 * naphthalene's ring fusion puts two of its vertices exactly on two carbons
 * that are already drawn, and phenalene — three hexagons round one atom — is
 * the structure that gesture asks for. Minting a second carbon on each of
 * those coordinates instead would draw a picture indistinguishable from
 * phenalene out of fourteen atoms, with nothing to surface: two superimposed
 * atoms are neither a valence error nor a visible one. So every ring gesture
 * reuses what is already at a vertex and skips a perimeter bond that already
 * exists, which is the same thing fusion does with the bond it is fused to,
 * generalised to the rest of the ring. `atomIds` and `bondIds` therefore report
 * what was MINTED, and `ringAtomIds` the whole perimeter — reused atoms
 * included.
 */

import { carbocycle, MoleculeBuilder } from "./builders.js";
import type { ElementSymbol } from "./elements.js";
import { insertFragment } from "./fragment.js";
import {
  addAtom,
  addBond,
  areBonded,
  bondsAt,
  otherEnd,
  requireAtom,
  requireBond,
} from "./molecule.js";
import { ringCentroid, ringsAtAtom, ringsAtBond } from "./rings.js";
import {
  bondDirections,
  DEFAULT_BOND_LENGTH,
  defaultSproutAngle,
  defaultSproutPosition,
  largestGapBisector,
} from "./sprout.js";
import type { AtomId, BondId, BondOrder, Molecule } from "./types.js";
import {
  add,
  angleOf,
  distanceSq,
  dot,
  fromPolar,
  length,
  midpoint,
  normalize,
  normalizeAngle,
  ORIGIN,
  perp,
  rotateAround,
  scale,
  sub,
  type Vec2,
} from "./vec.js";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface RingTemplate {
  readonly size: number;
  /** Element per vertex, starting at the attachment vertex. Shorter lists repeat the last
   *  entry; omitted means all carbon. */
  readonly elements?: readonly ElementSymbol[];
  /** Lay alternating single/double bonds around the ring (a Kekule arene). */
  readonly kekule?: boolean;
}

export type RingTemplateName =
  | "cyclopropane"
  | "cyclobutane"
  | "cyclopentane"
  | "cyclohexane"
  | "cycloheptane"
  | "cyclooctane"
  | "benzene"
  | "cyclopentadiene";

/**
 * The rings a drawing toolbar puts on its first row.
 *
 * `benzene` is a size-6 Kekule template rather than a distinct "aromatic
 * ring" kind, because there is no aromatic ring in the storage model to be
 * distinct from. `cyclopentadiene` is the same flag on a size-5 ring: an odd
 * ring cannot alternate all the way round, so the run stops short of a second
 * double bond on any one atom and leaves one sp3 carbon (decision 231).
 */
export const RING_TEMPLATES: Readonly<Record<RingTemplateName, RingTemplate>> =
  Object.freeze({
    cyclopropane: Object.freeze({ size: 3 }),
    cyclobutane: Object.freeze({ size: 4 }),
    cyclopentane: Object.freeze({ size: 5 }),
    cyclohexane: Object.freeze({ size: 6 }),
    cycloheptane: Object.freeze({ size: 7 }),
    cyclooctane: Object.freeze({ size: 8 }),
    benzene: Object.freeze({ size: 6, kekule: true }),
    cyclopentadiene: Object.freeze({ size: 5, kekule: true }),
  });

/** A template, or the name of one of the standard ones. */
export type RingTemplateSpec = RingTemplate | RingTemplateName;

export interface TemplateOptions {
  readonly bondLength?: number;
}

/** `appendChain` also chooses what element the chain is made of. */
export interface ChainOptions extends TemplateOptions {
  readonly element?: ElementSymbol;
}

export interface TemplateResult {
  readonly molecule: Molecule;
  /** Ids of atoms this call minted. Shared/reused existing atoms are NOT here. */
  readonly atomIds: readonly AtomId[];
  /** Ids of bonds this call minted. */
  readonly bondIds: readonly BondId[];
  /** Every atom of the placed ring in perimeter order, shared and reused
   *  atoms included. Empty for appendChain. */
  readonly ringAtomIds: readonly AtomId[];
}

/** Carbon, the element a bare template gesture means unless told otherwise. */
const DEFAULT_ELEMENT: ElementSymbol = "C";

/**
 * Below this a direction is noise rather than a side. sprout.ts guards the
 * same class of decision — "which side of this axis do the substituents lie
 * on" — at the same magnitude, and for the same reason: the inputs are unit
 * vectors, so anything this small is a collinear arrangement whose sign is
 * whatever the last rounding error said.
 */
const DEGENERATE_EPSILON = 1e-9;

function resolveTemplate(spec: RingTemplateSpec): RingTemplate {
  const template = typeof spec === "string" ? RING_TEMPLATES[spec] : spec;
  if (!template) throw new Error(`No such ring template: ${String(spec)}`);
  if (!Number.isInteger(template.size)) {
    throw new Error(`A ring needs a whole number of atoms, got ${template.size}`);
  }
  if (template.size < 3) {
    throw new Error(`A ring needs at least 3 atoms, got ${template.size}`);
  }
  return template;
}

/**
 * The element for vertex `index`, counting from the attachment vertex.
 *
 * A short list repeats its last entry, so `["N"]` is a nitrogen attachment
 * point on an otherwise all-carbon ring only if the caller writes
 * `["N", "C"]` — one entry means "every vertex is N". That reading is the
 * one that makes an all-carbon ring expressible as `["C"]`, and it is the
 * same rule a spreadsheet fill applies.
 */
function elementAt(template: RingTemplate, index: number): ElementSymbol {
  const list = template.elements;
  if (!list || list.length === 0) return DEFAULT_ELEMENT;
  return list[Math.min(index, list.length - 1)] ?? DEFAULT_ELEMENT;
}

/** Radius of the circle whose inscribed regular n-gon has edge `edge`. */
function circumradius(edge: number, size: number): number {
  return edge / (2 * Math.sin(Math.PI / size));
}

/**
 * The vertices of a regular `size`-gon with edge `edge` centred on `centre`:
 * the first at `startAngle` (radians, y-up), the rest CLOCKWISE on the page.
 *
 * For re-laying a ring whose atoms already exist, which the stamping
 * gestures below never do: `cycliseSugar` closes a chain onto itself and
 * needs the new ring as a polygon, not an open zig-zag with one long bond.
 */
export function regularRingVertices(
  size: number,
  centre: Vec2,
  edge: number,
  startAngle: number,
): Vec2[] {
  const radius = circumradius(edge, size);
  const out: Vec2[] = [];
  for (let k = 0; k < size; k++) {
    const angle = startAngle - (2 * Math.PI * k) / size;
    out.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
  }
  return out;
}

/** Distance from a regular n-gon's centre to the midpoint of one of its edges. */
function apothem(edge: number, size: number): number {
  return edge / (2 * Math.tan(Math.PI / size));
}

/**
 * Bond order for the `index`-th bond of an alternating run, given the order
 * the run starts on.
 *
 * Strict alternation, with no attempt to dodge a double that would over-fill
 * a shared atom. Dodging would silently draw a cyclohexadiene where the user
 * asked for an arene and hide the problem inside a picture that looks
 * deliberate; the honest outcome is the ring the gesture asked for plus a
 * `valenceIssues()` entry on the offending atom, which the UI can surface and
 * the user can fix in one click. Refusing the gesture outright is worse still
 * — a fixable drawing beats no drawing.
 *
 * An odd-membered Kekule ring cannot alternate all the way round, so the
 * alternation simply runs out where it meets itself. Usually that leaves the
 * last bond single — a cyclopentadiene rather than an impossible aromatic
 * pentagon — and where the phase does not work out it closes double onto
 * double instead, which is the same honest failure as above: the ring the
 * gesture asked for, plus a valence error the user can see and fix.
 */
function alternatingOrder(start: BondOrder, index: number): BondOrder {
  if (index % 2 === 0) return start;
  return start === 2 ? 1 : 2;
}

/** True when `atomId` already carries a double bond in `mol`. */
function hasDoubleBond(mol: Molecule, atomId: AtomId): boolean {
  return bondsAt(mol, atomId).some((bond) => bond.order === 2);
}

/**
 * The order of one perimeter bond of `spec`, laid between `from` and `to` onto
 * `mol` as it stands so far.
 *
 * Even Kekule rings alternate strictly, for the reason `alternatingOrder`
 * gives. An ODD one is a diene, not an arene (decision 231): it has no
 * alternation to be faithful to, only a choice of where its sp3 carbon goes,
 * so it never lays a double bond onto an atom that already has one. That puts
 * the sp3 carbon where the run meets itself — attached cyclopentadiene comes
 * out as cyclopenta-1,3-dien-1-yl, and a fusion onto a Kekule double bond as
 * indene — instead of an allene no chemist would draw in a five-membered ring.
 */
function perimeterOrder(
  spec: RingTemplate,
  mol: Molecule,
  from: AtomId,
  to: AtomId,
  alternated: BondOrder,
): BondOrder {
  if (!spec.kekule) return 1;
  if (spec.size % 2 === 0 || alternated !== 2) return alternated;
  return hasDoubleBond(mol, from) || hasDoubleBond(mol, to) ? 1 : 2;
}

/**
 * A template as a free-standing ring centred on `centre`, for a drop on empty
 * canvas, where there is nothing to fuse to or hang off.
 *
 * `carbocycle`'s layout, flat-bottomed, with a Kekule template alternating
 * from a SINGLE first bond: on benzene that is exactly `builders.ts`'s
 * `benzene`, and on an odd ring it is the phase that never meets itself
 * double onto double — bond 0 and the closing bond are both single, so
 * cyclopentadiene's sp3 carbon is vertex 0, at the bottom (decision 231).
 */
export function templateRing(
  template: RingTemplateSpec,
  bondLength = DEFAULT_BOND_LENGTH,
  centre: Vec2 = ORIGIN,
): Molecule {
  const spec = resolveTemplate(template);
  const ring = carbocycle(spec.size, elementAt(spec, 0), bondLength, centre);
  if (!spec.kekule) return ring;
  const bonds = { ...ring.bonds };
  ring.bondIds.forEach((id, index) => {
    bonds[id] = { ...bonds[id]!, order: alternatingOrder(1, index) };
  });
  return { ...ring, bonds };
}

// ---------------------------------------------------------------------------
// Placing vertices
// ---------------------------------------------------------------------------

/**
 * How close a computed vertex has to be to an existing atom before the ring
 * reuses that atom instead of minting a second one on the same coordinate.
 *
 * A fraction of the ring's own edge rather than an absolute distance, so a
 * structure drawn in picometres behaves like one drawn in bond-length units.
 * It is deliberately tiny: this asks "did the arithmetic land these two on the
 * same point", not "are these near each other". Sprouting's
 * `DEFAULT_MERGE_RADIUS` answers the second question — 0.4 bond lengths of
 * tolerance for a human aiming a pointer at an atom — and borrowing it here
 * would swallow atoms that are genuinely distinct: a hexagon fused across
 * indane's shared bond leaves atoms 0.21 bond lengths apart, and those are two
 * atoms, not one.
 */
const COINCIDENT_FRACTION = 1e-6;

/**
 * The atom already sitting on `point`, if there is one.
 *
 * The same shape as sprout.ts's `nearestAtomWithin` — nearest wins, ties fall
 * to the earlier atom in insertion order — but excluding a SET, because a
 * perimeter being laid out has to exclude every vertex it has already claimed
 * as well as the atoms it was handed.
 */
function coincidentAtom(
  mol: Molecule,
  point: Vec2,
  tolerance: number,
  exclude: ReadonlySet<AtomId>,
): AtomId | undefined {
  const limit = tolerance * tolerance;
  let bestId: AtomId | undefined;
  let bestDistanceSq = Infinity;
  for (const id of mol.atomIds) {
    if (exclude.has(id)) continue;
    const d = distanceSq(point, requireAtom(mol, id).pos);
    if (d <= limit && d < bestDistanceSq) {
      bestDistanceSq = d;
      bestId = id;
    }
  }
  return bestId;
}

interface PlacedVertices {
  readonly molecule: Molecule;
  /** One id per requested position, in order: reused or freshly minted. */
  readonly ids: readonly AtomId[];
  /** Only the minted ones, in the order they were minted. */
  readonly mintedIds: readonly AtomId[];
}

/**
 * Turn a run of ring vertex positions into atom ids, reusing whatever is
 * already drawn on each one.
 *
 * The minted vertices go in as a single fragment: `insertFragment` already
 * solves id remapping and allocates from the target's own counter, and one
 * splice keeps the minted ids contiguous and in vertex order. `taken` is the
 * atoms the gesture has already committed to — a fusion's two shared atoms, an
 * attachment's anchor — which must never be reused as a second vertex of the
 * same ring.
 */
function placeVertices(
  mol: Molecule,
  positions: readonly Vec2[],
  elements: readonly ElementSymbol[],
  taken: readonly AtomId[],
  tolerance: number,
): PlacedVertices {
  const claimed = new Set<AtomId>(taken);
  const ids: (AtomId | undefined)[] = [];
  const freshSlots: number[] = [];
  const fresh = new MoleculeBuilder();

  positions.forEach((pos, index) => {
    const existing = coincidentAtom(mol, pos, tolerance, claimed);
    if (existing !== undefined) {
      claimed.add(existing);
      ids.push(existing);
      return;
    }
    freshSlots.push(index);
    ids.push(undefined);
    fresh.atom(elements[index] ?? DEFAULT_ELEMENT, pos);
  });

  const inserted = insertFragment(mol, fresh.build());
  freshSlots.forEach((slot, n) => {
    ids[slot] = inserted.atomIds[n]!;
  });
  return {
    molecule: inserted.molecule,
    ids: ids as AtomId[],
    mintedIds: inserted.atomIds,
  };
}

interface ConnectResult {
  readonly molecule: Molecule;
  /** The minted bond's id, or undefined when the two were already joined. */
  readonly id: BondId | undefined;
}

/**
 * Join two perimeter atoms, unless they are already joined.
 *
 * A reused vertex often arrives with the bond to its perimeter neighbour
 * already in place — that is what made it coincident in the first place — and
 * `addBond` throws on a duplicate pair. An existing bond keeps its own order:
 * rewriting one to satisfy a template's alternation is the same mutation the
 * shared bond of a fusion is deliberately spared.
 */
function connect(
  mol: Molecule,
  from: AtomId,
  to: AtomId,
  order: BondOrder,
): ConnectResult {
  if (areBonded(mol, from, to)) return { molecule: mol, id: undefined };
  const added = addBond(mol, { from, to, order });
  return { molecule: added.molecule, id: added.id };
}

/**
 * Lay a run of perimeter bonds around `ring`, from `startIndex` to the closing
 * bond back at `ring[0]`.
 *
 * `orderAt` is asked per bond rather than handed a list so that the Kekule
 * phase stays the caller's decision: a fusion seeds it from the bond it
 * shares, attach and spiro from the first bond they draw. It also sees the
 * molecule laid so far, which an odd Kekule ring needs — see `perimeterOrder`.
 */
function connectPerimeter(
  mol: Molecule,
  ring: readonly AtomId[],
  startIndex: number,
  orderAt: (index: number, current: Molecule, from: AtomId, to: AtomId) => BondOrder,
): { readonly molecule: Molecule; readonly bondIds: BondId[] } {
  const size = ring.length;
  let current = mol;
  const bondIds: BondId[] = [];
  for (let i = startIndex; i < size; i++) {
    const from = ring[i]!;
    const to = ring[(i + 1) % size]!;
    const joined = connect(current, from, to, orderAt(i, current, from, to));
    current = joined.molecule;
    if (joined.id !== undefined) bondIds.push(joined.id);
  }
  return { molecule: current, bondIds };
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

interface OccupiedSide {
  /**
   * How far the existing structure leans to the `+perp` side of the bond,
   * averaged over UNIT contributions and so between -1 and 1. Zero means
   * there was nothing to lean away from, or that the evidence cancelled.
   */
  readonly lean: number;
  /** Rings on BOTH sides of the bond: there is no empty side to fuse across. */
  readonly bothSides: boolean;
}

/**
 * Which way the existing structure lies from the midpoint of the shared bond.
 *
 * Rings win over substituents because a fused ring is a much stronger signal
 * about where the paper is already full: the naphthalene gesture is "put the
 * second ring on the far side", and a stray methyl on the shared edge must
 * not out-vote the ring it is attached to.
 *
 * Every contribution is a UNIT direction, the way `terminalSproutAngle`
 * averages substituents. Raw offsets would let one long bond outvote two short
 * ones and pick the side by bond length, which has nothing to do with the
 * question being asked — and for the ring branch they would also scale with
 * the drawing, so the "is this lean big enough to trust" test below would mean
 * different things at different zoom levels.
 *
 * `bothSides` is what separates no evidence from evidence that CANCELS. The
 * central bond of naphthalene has a ring on each side and their leans sum to
 * zero; without the distinction that reads as "nothing here" and the fallback
 * stamps a third ring straight on top of one of them.
 */
function occupiedSide(
  mol: Molecule,
  bondId: BondId,
  a: AtomId,
  b: AtomId,
  m: Vec2,
  outward: Vec2,
): OccupiedSide {
  const ringIndices = ringsAtBond(mol, bondId);
  if (ringIndices.length > 0) {
    const leans = ringIndices.map((index) =>
      dot(normalize(sub(ringCentroid(mol, index), m)), outward),
    );
    const total = leans.reduce((sum, value) => sum + value, 0);
    return {
      lean: total / leans.length,
      bothSides:
        leans.some((value) => value > DEGENERATE_EPSILON) &&
        leans.some((value) => value < -DEGENERATE_EPSILON),
    };
  }

  let sum: Vec2 = ORIGIN;
  let count = 0;
  for (const [self, partner] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const bond of bondsAt(mol, self)) {
      const neighborId = otherEnd(bond, self);
      if (neighborId === partner) continue;
      sum = add(sum, normalize(sub(requireAtom(mol, neighborId).pos, m)));
      count++;
    }
  }
  // Substituents never make a side unusable the way a ring does: one atom in
  // the way is a vertex to reuse or a crowded drawing, not an impossible one.
  if (count === 0) return { lean: 0, bothSides: false };
  return { lean: dot(scale(sum, 1 / count), outward), bothSides: false };
}

/**
 * Whether a bond is too short to hang geometry off.
 *
 * The exact test `fuseRingOnBond` throws on, exported so a UI can refuse the
 * gesture in its own words rather than catch an exception out of a pointer
 * handler — the counterpart to `isFusionBond` for the other impossibility.
 * Keeping the predicate beside the throw is what stops the two answers
 * drifting: the throw is the authority and this is the same comparison rather
 * than an approximation of it.
 *
 * A bond the molecule does not have counts as degenerate. There is nothing to
 * fuse across either way, and a pre-flight question should not throw.
 */
export function isDegenerateBond(mol: Molecule, bondId: BondId): boolean {
  const bond = mol.bonds[bondId];
  if (bond === undefined) return true;
  const from = mol.atoms[bond.from];
  const to = mol.atoms[bond.to];
  if (from === undefined || to === undefined) return true;
  return length(sub(to.pos, from.pos)) <= DEGENERATE_EPSILON;
}

/**
 * Fuse a ring across an existing bond: the new ring shares that bond and both
 * its atoms, and mints `size - 2` atoms and `size - 1` bonds — fewer of each
 * where the rest of the ring lands on atoms that are already drawn.
 *
 * THE POLYGON IS BUILT ON THE SHARED EDGE, NOT ON `options.bondLength`. A
 * regular polygon has one edge length, and two of its vertices are already
 * placed; using any other length would make the new ring irregular and the
 * drawing visibly kink at the fusion. `options` is accepted for signature
 * symmetry with the other three gestures and is deliberately unused here.
 *
 * The new ring goes on the EMPTY side of the bond, decided in this order:
 * away from the rings the bond is already in, else away from the mean
 * direction of the substituents on its two atoms, else — an isolated,
 * substituent-free bond, where there is no "empty side" to find — the
 * +perp side, so that repeating the gesture on the same drawing keeps
 * producing the same picture.
 *
 * THROWS when the bond already has a ring on each side. A bond shared by two
 * rings has no empty side left: any third ring drawn across it overlaps one of
 * them, and in the symmetric case (naphthalene's central bond) it lands exactly
 * on top of one. That is the same kind of geometric impossibility as the
 * zero-length bond below, and refusing it is the only outcome that does not
 * leave the drawing quietly broken. The UI can ask `isFusionBond` and
 * `isDegenerateBond` before offering the gesture.
 */
export function fuseRingOnBond(
  mol: Molecule,
  bondId: BondId,
  template: RingTemplateSpec,
  options?: TemplateOptions,
): TemplateResult {
  const spec = resolveTemplate(template);
  const size = spec.size;
  const bond = requireBond(mol, bondId);
  const a = bond.from;
  const b = bond.to;
  const pa = requireAtom(mol, a).pos;
  const pb = requireAtom(mol, b).pos;

  const edge = sub(pb, pa);
  const edgeLength = length(edge);
  if (edgeLength <= DEGENERATE_EPSILON) {
    // Two atoms on the same coordinate — an import with duplicate positions,
    // or a merge that has not been laid out yet. The perpendicular bisector
    // is undefined, so there is no ring to place and no sensible fallback.
    throw new Error(
      `Bond ${bondId} has zero length; a ring cannot be fused across it`,
    );
  }

  const m = midpoint(pa, pb);
  const outward = normalize(perp(edge));
  const occupied = occupiedSide(mol, bondId, a, b, m, outward);
  if (occupied.bothSides) {
    throw new Error(
      `Bond ${bondId} already has a ring on each side; a further ring cannot ` +
        `be fused across it`,
    );
  }
  // A lean too small to trust — nothing incident at all, or substituents that
  // happen to sit along the bond axis, where the sign is whatever rounding
  // decided — falls through to the +perp default, so the gesture stays
  // reproducible instead of flickering between the two sides.
  const side = occupied.lean > DEGENERATE_EPSILON ? -1 : 1;
  const centre = add(m, scale(outward, side * apothem(edgeLength, size)));

  // The step that walks a -> b around the circumcircle and keeps going the
  // same way. Taking it from the two placed vertices rather than from a
  // hardcoded +2PI/size is what makes the walk follow the shared edge's own
  // orientation, whichever side the centre landed on.
  const delta = normalizeAngle(
    angleOf(sub(pb, centre)) - angleOf(sub(pa, centre)),
  );
  const vertices: Vec2[] = [pa, pb];
  for (let k = 2; k < size; k++) {
    vertices.push(rotateAround(vertices[k - 1]!, centre, delta));
  }

  // Vertices 0 and 1 are the shared atoms. `spec.elements` entries for them
  // are ignored rather than applied: retyping an atom the user only pointed
  // at is exactly what `sproutTo` refuses to do on a ring closure, and for
  // the same reason. Anything already sitting on one of the remaining
  // vertices is reused for the same reason again — see the header note.
  const placed = placeVertices(
    mol,
    vertices.slice(2),
    vertices.slice(2).map((_, k) => elementAt(spec, k + 2)),
    [a, b],
    edgeLength * COINCIDENT_FRACTION,
  );
  const perimeter: AtomId[] = [a, b, ...placed.ids];

  // The perimeter bonds are added one at a time rather than carried inside
  // the fragment so that the minted bond ids run in perimeter order, matching
  // the walk `rings()` reports and the order molfile export writes.
  //
  // Phase is seeded by the shared bond so alternation continues through it:
  // a single shared bond is followed by a double, a double by a single.
  // Anything else (a triple in a ring) is not part of an alternating run at
  // all, so treat it like a single and start the new run on a double. The
  // shared bond's own order is never rewritten: it may be carrying a stereo
  // annotation and a ring the user drew earlier.
  const start: BondOrder = bond.order === 2 ? 1 : 2;
  const wired = connectPerimeter(placed.molecule, perimeter, 1, (i, current, from, to) =>
    perimeterOrder(spec, current, from, to, alternatingOrder(start, i - 1)),
  );

  return {
    molecule: wired.molecule,
    atomIds: placed.mintedIds,
    bondIds: wired.bondIds,
    ringAtomIds: perimeter,
  };
}

// ---------------------------------------------------------------------------
// Attachment and spiro
// ---------------------------------------------------------------------------

/**
 * Lay out a whole ring around `centre`, given its first vertex.
 *
 * Counter-clockwise from `v0`, matching the y-up convention: increasing angle
 * turns the way it does in ordinary maths, so a ring reads the same here as
 * it does in `carbocycle`.
 */
function ringVertices(centre: Vec2, v0: Vec2, size: number): Vec2[] {
  const radius = length(sub(v0, centre));
  const base = angleOf(sub(v0, centre));
  const step = (2 * Math.PI) / size;
  const vertices: Vec2[] = [v0];
  for (let k = 1; k < size; k++) {
    vertices.push(add(centre, fromPolar(base + k * step, radius)));
  }
  return vertices;
}

/**
 * Which way a ring hangs off an atom.
 *
 * `defaultSproutAngle` is the answer wherever it points at empty paper, and
 * for a chain, an isolated atom or a bare ring vertex it always does — so it
 * is asked first and used unchanged, rather than a second direction rule
 * growing here to be kept in step with it.
 *
 * It is wrong for one shape, and that shape is the commonest substrate the app
 * has: a monosubstituted ring carbon. Its three bonds leave three gaps of
 * exactly 120 degrees, `largestGapBisector` breaks the tie by angle order, and
 * one of the three tied wedges is the existing ring's INSIDE. The sprout rule
 * is not at fault — it reasons about bonds, and a bond says nothing about
 * which side of it the paper is full. `fuseRingOnBond` already knows the
 * missing fact and leans away from `ringCentroid`; this is the same fact
 * applied at an atom.
 *
 * So: when the sprout direction points into a ring the atom belongs to, ask
 * again with those ring interiors added to the occupied directions. Counting
 * an interior as one more occupied direction is enough to break the tie the
 * right way — on a methylcyclohexane C1 the two remaining 120 degree gaps beat
 * the two 60 degree ones the ring has been split into — and it degrades the
 * way the sprout rule does at a centre with no room left, by picking the
 * widest gap there is.
 */
export function templateAngle(mol: Molecule, atomId: AtomId): number {
  const angle = defaultSproutAngle(mol, atomId);
  const ringIndices = ringsAtAtom(mol, atomId);
  if (ringIndices.length === 0) return angle;

  const pos = requireAtom(mol, atomId).pos;
  const inward = ringIndices.map((index) =>
    normalize(sub(ringCentroid(mol, index), pos)),
  );
  const heading = fromPolar(angle, 1);
  // Within 90 degrees of a ring's centroid is "into that ring".
  if (!inward.some((d) => dot(heading, d) > DEGENERATE_EPSILON)) return angle;
  return largestGapBisector([...bondDirections(mol, atomId), ...inward]);
}

/**
 * Attach a ring to an atom through a NEW bond. The clicked atom is not part
 * of the ring; the call mints `size` atoms and `size + 1` bonds — fewer of
 * each where the ring lands on atoms that are already drawn.
 *
 * The direction is `templateAngle`'s: `defaultSproutAngle` wherever that
 * points at empty paper, which is nearly always, and the widest gap that is
 * not an existing ring's interior when it does not.
 *
 * The ring centre sits one circumradius further along that same direction, so
 * the linking bond points straight at the centre through the attachment
 * vertex and the vertex's two ring bonds are symmetric about that axis — the
 * way biphenyl is drawn.
 */
export function attachRingToAtom(
  mol: Molecule,
  atomId: AtomId,
  template: RingTemplateSpec,
  options?: TemplateOptions,
): TemplateResult {
  const spec = resolveTemplate(template);
  const size = spec.size;
  const anchor = requireAtom(mol, atomId);
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;

  const angle = templateAngle(mol, atomId);
  const v0 = add(anchor.pos, fromPolar(angle, bondLength));
  const centre = add(v0, fromPolar(angle, circumradius(bondLength, size)));
  const vertices = ringVertices(centre, v0, size);

  // The anchor is `taken`: it is the one atom this gesture must NOT draw the
  // ring through, since a ring containing it would be a spiro ring and there
  // is a separate gesture for that.
  const placed = placeVertices(
    mol,
    vertices,
    vertices.map((_, k) => elementAt(spec, k)),
    [atomId],
    bondLength * COINCIDENT_FRACTION,
  );
  const ring = placed.ids;

  // The linking bond first, then the perimeter: that is the order the gesture
  // happens in, and it keeps the ring's own bond ids contiguous and in walk
  // order.
  const link = connect(
    placed.molecule,
    atomId,
    ring[0]!,
    // Always single. A template places a ring, not a double bond to it; the
    // user can cycle the order afterwards.
    1,
  );
  const bondIds: BondId[] = link.id === undefined ? [] : [link.id];

  // No existing ring bond constrains the phase here, so alternation starts on
  // the first ring bond.
  const wired = connectPerimeter(link.molecule, ring, 0, (i, current, from, to) =>
    perimeterOrder(spec, current, from, to, alternatingOrder(2, i)),
  );
  bondIds.push(...wired.bondIds);

  return {
    molecule: wired.molecule,
    atomIds: placed.mintedIds,
    bondIds,
    ringAtomIds: ring,
  };
}

/**
 * Grow a ring that INCLUDES the clicked atom as one of its vertices — a spiro
 * centre when that atom is already in a ring. Mints `size - 1` atoms and
 * `size` bonds, fewer of each where the ring lands on atoms that are already
 * drawn.
 *
 * The existing atom keeps its id and its position, so everything already
 * bonded to it stays valid and nothing on the page moves; the ring is placed
 * around it rather than the other way round.
 *
 * A CROWDED CENTRE GETS A CROWDED RING. Valence never blocks a placement, so a
 * gesture that leaves the clicked atom five- or six-coordinate is drawn, and
 * geometry cannot rescue it: a hexagon's 120 degree wedge does not fit in the
 * 120 degree gap left by three existing bonds, and no rotation of it would.
 * Where the ring lands exactly on atoms that are already there they are reused
 * rather than duplicated, so the drawing stays readable and the overfilled
 * atom surfaces through `valenceIssues` — but a ring squeezed into a gap 6
 * degrees too narrow simply looks squeezed, and that is the honest picture of
 * what was asked for.
 */
export function spiroRingAtAtom(
  mol: Molecule,
  atomId: AtomId,
  template: RingTemplateSpec,
  options?: TemplateOptions,
): TemplateResult {
  const spec = resolveTemplate(template);
  const size = spec.size;
  const anchor = requireAtom(mol, atomId);
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;

  const angle = templateAngle(mol, atomId);
  const centre = add(anchor.pos, fromPolar(angle, circumradius(bondLength, size)));
  const vertices = ringVertices(centre, anchor.pos, size);

  // Vertex 0 is the existing atom, so its `spec.elements` entry is ignored —
  // same rule as a fusion's shared atoms — and it is `taken`, so no other
  // vertex of the same ring can resolve back to it.
  const placed = placeVertices(
    mol,
    vertices.slice(1),
    vertices.slice(1).map((_, k) => elementAt(spec, k + 1)),
    [atomId],
    bondLength * COINCIDENT_FRACTION,
  );
  const ring: AtomId[] = [atomId, ...placed.ids];

  // An odd Kekule ring starts on a SINGLE bond here: a spiro centre has four
  // single bonds by definition, and starting on a double would put the one
  // bond the ring may not have on the one atom it shares (decision 231).
  // Even rings keep the phase every other gesture uses.
  const spiroStart: BondOrder = spec.size % 2 === 1 ? 1 : 2;
  const wired = connectPerimeter(placed.molecule, ring, 0, (i, current, from, to) =>
    perimeterOrder(spec, current, from, to, alternatingOrder(spiroStart, i)),
  );

  return {
    molecule: wired.molecule,
    atomIds: placed.mintedIds,
    bondIds: wired.bondIds,
    ringAtomIds: ring,
  };
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/**
 * Grow a zig-zag chain of `count` atoms out of an existing one.
 *
 * ONE ATOM AT A TIME, each step re-asking `defaultSproutPosition` where to go
 * on the molecule as it now stands. That is not a convenience: the +30/-30
 * alternation `linearChain` builds from scratch has a phase, and continuing a
 * chain in the wrong phase draws a visible kink at the join. Sprouting's
 * terminal case already places a new bond anti to the neighbour's other
 * substituents, which IS the zig-zag rule, so growing through it makes phase
 * continuity fall out of the geometry instead of out of a second copy of the
 * alternation logic here — one that would have to rediscover the parity of
 * whatever the chain was attached to.
 *
 * The FIRST step asks `templateAngle` instead, for the reason given there: at
 * a substituted ring carbon the widest gap can be the ring's own interior, and
 * a chain started into it is drawn straight through the ring. Every later step
 * grows from a terminal atom, where the sprout rule is exactly right.
 *
 * `addAtom`/`addBond` rather than a builder: `MoleculeBuilder` starts from
 * nothing and cannot append to an existing molecule, and `count` is a handful
 * of atoms, so the O(n) copy per call is irrelevant.
 */
export function appendChain(
  mol: Molecule,
  atomId: AtomId,
  count: number,
  options?: ChainOptions,
): TemplateResult {
  requireAtom(mol, atomId);
  if (!Number.isInteger(count)) {
    // The same guard `resolveTemplate` puts on a ring size, for the same
    // reason and so the file has one policy rather than two: a fractional
    // count silently rounds up, and `Infinity` never terminates.
    throw new Error(`A chain needs a whole number of atoms, got ${count}`);
  }
  if (count <= 0) {
    // Referential identity matters: an empty edit must not invalidate
    // memoised renders or look like a step to undo. `insertFragment` makes
    // the same promise for an empty paste.
    return { molecule: mol, atomIds: [], bondIds: [], ringAtomIds: [] };
  }

  const element = options?.element ?? DEFAULT_ELEMENT;
  const bondLength = options?.bondLength ?? DEFAULT_BOND_LENGTH;

  let current = mol;
  let previousId = atomId;
  const atomIds: AtomId[] = [];
  const bondIds: BondId[] = [];
  for (let i = 0; i < count; i++) {
    const pos =
      i === 0
        ? add(
            requireAtom(current, previousId).pos,
            fromPolar(templateAngle(current, previousId), bondLength),
          )
        : defaultSproutPosition(current, previousId, { bondLength });
    const grown = addAtom(current, { element, pos });
    const bonded = addBond(grown.molecule, {
      // `from` is the atom grown FROM, so a wedge applied later has its narrow
      // end at the existing structure — the same convention `sprout` uses.
      from: previousId,
      to: grown.id,
      order: 1,
    });
    current = bonded.molecule;
    previousId = grown.id;
    atomIds.push(grown.id);
    bondIds.push(bonded.id);
  }

  return { molecule: current, atomIds, bondIds, ringAtomIds: [] };
}
