/**
 * The planar frame's MARK WRITER: which bond carries the wedge that states a
 * centre, when the drawing has none to carry it (decision 178). Internal: a
 * template calls it on its draft, and `project` reads the result back.
 *
 * THE POLICY, IUPAC 2006's (Brecher, Pure Appl. Chem. 78, 1897):
 *
 *   ONE MARK PER CENTRE, narrow end AT the centre (ST-0.3). A second mark
 *   states nothing more and is one more thing to misread.
 *
 *   NEVER A BOND BETWEEN TWO STEREOCENTRES (ST-0.5: "avoided at all costs").
 *   A mark states the configuration of its narrow end only, but a reader, and
 *   more than one program, reads it at both.
 *
 *   NEVER A SECOND MARK AT ONE ATOM: a bond already marked, or one whose far
 *   atom another mark already touches, is not a candidate. So a
 *   gem-disubstituted ring carbon (17α-methyltestosterone's C17, OH and CH3)
 *   gets one wedge, and no atom sits at the wide end of two.
 *
 *   BY RANK, then by `compareIds` of the far atom:
 *     1  a bond to a TERMINAL atom that is not a centre: the graphically
 *        smallest substituent (ST-1.1.2), an OH, a methyl, a halogen;
 *     2  any other acyclic bond to an atom that is not a centre;
 *     3  the centre's implicit hydrogen, REVEALED as a derived node: what a
 *        ring-fusion centre carries (ST-1.3.2), a steroid's 5α-H or 8β-H;
 *     4  a bond of a ring that is not fused;
 *     5  a bond of a fused ring system, last (ST-0.2: in rings "those bonds
 *        should be restricted to acyclic substituents").
 *
 * WEDGE OR HASH IS NEVER A RULE. Each candidate is marked with a wedge and the
 * draft is read back through the wedge/hash convention, scoped to the centres
 * being marked: a centre that reads its configuration keeps the wedge, one
 * that reads the opposite parity gets a hash instead — with one mark and the
 * implicit ligand opposite it, exchanging the mark negates the one signed
 * volume exactly — and one whose geometry reads ambiguous (the bond collinear
 * with another, a T) loses the mark and tries its next candidate. A mixture
 * gets a wavy line by the same ranking. A centre no candidate can state is
 * listed `no-mark-to-carry`, never marked on a bond the policy forbids.
 *
 * A REVEALED HYDROGEN is the node `<centre>.H` joined by `<centre>.H.bond`
 * (decision 147), ONE bond length out (`CHARACTERISTIC_LENGTHS.planar`), on
 * the bisector of the widest angular gap between the centre's drawn bonds.
 * Gaps within ten degrees of the widest are equals — every gap of a ring-
 * fusion atom, however the rings were drawn — and go to the most nearly
 * vertical bisector and then the upward one: where a steroid's 5α-H, 8β-H,
 * 9α-H and 14α-H are printed. A bisector that would put the H within half a
 * bond of another node is passed over while another is clear. That is a
 * choice of where on the page, never of which face: the face is the
 * read-back's. The hydrogen is read where it is drawn (decision 179). An id a
 * hand-edited document already uses is skipped.
 */

import { bondsAt, otherEnd } from "../molecule.js";
import { rings, ringMembership } from "../rings.js";
import { compareIds } from "../selection.js";
import {
  readConfig,
  stereoTopology,
  type CentreReading,
  type StereoConfig,
} from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
import { derivedBondId, hydrogenNodeId } from "./nodes.js";
import {
  draftLayoutAccess,
  placeLayoutBond,
  placeLayoutDerivedNode,
  placementOfLayout,
  type PlacedLayout,
} from "./template.js";
import { CHARACTERISTIC_LENGTHS, type LayoutMark } from "./types.js";

const WEDGE_HASH = Object.freeze({ kind: "wedgeHash" as const });

export const HYDROGEN_LABEL = Object.freeze([Object.freeze({ kind: "symbol" as const, text: "H" })]);

type Candidate =
  | { readonly kind: "bond"; readonly bondId: BondId; readonly far: AtomId; readonly rank: number }
  | { readonly kind: "hydrogen"; readonly rank: number };

/**
 * Writes one mark at each of `centres` that the configuration states
 * (specified or a mixture), into `draft`, whose positions must be final.
 *
 * The caller has removed any mark whose narrow end is one of `centres`;
 * marks elsewhere in the draft are kept and respected (never doubled up on).
 */
export function writeCentreMarks(
  mol: Molecule,
  config: StereoConfig,
  draft: PlacedLayout,
  centres: readonly AtomId[],
): void {
  const wanted = new Map(config.centres.map((c) => [c.atomId, c]));
  const topology = stereoTopology(mol);
  const allCentres = new Set(topology.centres.map((c) => c.atomId));
  const fusedBond = fusedRingBonds(mol);

  const order = [...new Set(centres)].sort(compareIds);
  const candidates = new Map<AtomId, readonly Candidate[]>();
  const cursor = new Map<AtomId, number>();
  let pending: AtomId[] = [];
  for (const atomId of order) {
    const centre = wanted.get(atomId);
    const reading = centre?.reading;
    if (centre === undefined || reading === undefined || reading.kind === "undetermined") continue;
    candidates.set(atomId, candidatesAt(mol, draft, atomId, centre.implicitHydrogen, allCentres, fusedBond));
    cursor.set(atomId, 0);
    pending.push(atomId);
  }

  // Rounds: every pending centre takes its next open candidate, one scoped
  // read judges them all, and a centre whose candidate read ambiguous moves
  // on. At most one round per candidate, and each round is one read.
  while (pending.length > 0) {
    const tried = new Map<AtomId, Candidate>();
    for (const atomId of pending) {
      const list = candidates.get(atomId)!;
      let k = cursor.get(atomId)!;
      while (k < list.length && blocked(draft, list[k]!, atomId)) k++;
      cursor.set(atomId, k);
      if (k >= list.length) {
        draft.unplaced.push({ unit: { kind: "centre", atomId }, reason: "no-mark-to-carry" });
        continue;
      }
      const candidate = list[k]!;
      const mixture = wanted.get(atomId)!.reading.kind === "mixture";
      apply(mol, draft, atomId, candidate, mixture ? "wavy" : "wedge");
      tried.set(atomId, candidate);
    }
    if (tried.size === 0) break;

    const read = readConfig(placementOfLayout(mol, draftLayoutAccess(draft)), WEDGE_HASH, {
      centres: [...tried.keys()],
    });
    const got = new Map<AtomId, CentreReading>();
    if (read.kind === "read") for (const c of read.config.centres) got.set(c.atomId, c.reading);

    const next: AtomId[] = [];
    for (const [atomId, candidate] of tried) {
      const want = wanted.get(atomId)!.reading;
      const reading = got.get(atomId);
      if (want.kind === "mixture" && reading?.kind === "mixture") continue;
      if (want.kind === "specified" && reading?.kind === "specified") {
        if (reading.parity !== want.parity) exchange(draft, atomId, candidate);
        continue;
      }
      undo(draft, atomId, candidate);
      cursor.set(atomId, cursor.get(atomId)! + 1);
      next.push(atomId);
    }
    pending = next;
  }
}

/**
 * Every bond of a ring that shares a bond with another ring: a fused system.
 * Computed from one perception, and never kept past this call.
 */
function fusedRingBonds(mol: Molecule): ReadonlySet<BondId> {
  const all = rings(mol);
  const membership = ringMembership(mol);
  const fusedRing = new Set<number>();
  for (const bondId of mol.bondIds) {
    const indices = membership.bonds[bondId] ?? [];
    if (indices.length >= 2) for (const index of indices) fusedRing.add(index);
  }
  const out = new Set<BondId>();
  all.forEach((ring, index) => {
    if (fusedRing.has(index)) for (const bondId of ring.bondIds) out.add(bondId);
  });
  return out;
}

function candidatesAt(
  mol: Molecule,
  draft: PlacedLayout,
  centre: AtomId,
  implicitHydrogen: boolean,
  allCentres: ReadonlySet<AtomId>,
  fusedBond: ReadonlySet<BondId>,
): Candidate[] {
  const membership = ringMembership(mol);
  const out: Candidate[] = [];
  for (const bond of bondsAt(mol, centre)) {
    // Wedge and hash describe a single bond; an aromatic-flagged one has no
    // order to carry them.
    if (bond.order !== 1 || bond.aromatic === true) continue;
    const far = otherEnd(bond, centre);
    if (allCentres.has(far)) continue;
    // The layout must draw the bond, between the two atoms themselves.
    if (!draft.bonds.has(bond.id) || draft.drawnAs.get(far) !== far || draft.drawnAs.get(centre) !== centre) continue;
    const inRing = (membership.bonds[bond.id] ?? []).length > 0;
    const terminal = bondsAt(mol, far).length === 1;
    const rank = inRing ? (fusedBond.has(bond.id) ? 5 : 4) : terminal ? 1 : 2;
    out.push({ kind: "bond", bondId: bond.id, far, rank });
  }
  if (implicitHydrogen) {
    const nodeId = hydrogenNodeId(centre, 0);
    const lineId = derivedBondId(nodeId);
    const free =
      !Object.hasOwn(mol.atoms, nodeId) &&
      !Object.hasOwn(mol.bonds, nodeId) &&
      !Object.hasOwn(mol.atoms, lineId) &&
      !Object.hasOwn(mol.bonds, lineId);
    if (free) out.push({ kind: "hydrogen", rank: 3 });
  }
  return out.sort((p, q) => {
    if (p.rank !== q.rank) return p.rank - q.rank;
    if (p.kind === "bond" && q.kind === "bond") return compareIds(p.far, q.far);
    return 0;
  });
}

/** Whether the draft already rules `candidate` out at `centre`. */
function blocked(draft: PlacedLayout, candidate: Candidate, centre: AtomId): boolean {
  if (candidate.kind === "hydrogen") return draft.positions.has(hydrogenNodeId(centre, 0));
  if (draft.marks.has(candidate.bondId)) return true;
  return touched(draft).has(candidate.far);
}

/** Every layout node at either end of a marked line. */
function touched(draft: PlacedLayout): Set<string> {
  const out = new Set<string>();
  for (const [lineId, mark] of draft.marks) {
    const line = draft.bonds.get(lineId);
    if (line === undefined || mark.stereo === "either") continue;
    out.add(line.from);
    out.add(line.to);
  }
  return out;
}

function apply(
  mol: Molecule,
  draft: PlacedLayout,
  centre: AtomId,
  candidate: Candidate,
  stereo: LayoutMark["stereo"],
): void {
  if (candidate.kind === "bond") {
    draft.marks.set(candidate.bondId, { stereo, narrowEnd: centre });
    return;
  }
  const nodeId = hydrogenNodeId(centre, 0);
  placeLayoutDerivedNode(
    draft,
    { id: nodeId, kind: "hydrogen", host: centre, label: HYDROGEN_LABEL, anchor: 0 },
    revealedHydrogenPosition(mol, draft, centre),
    [centre],
  );
  const lineId = derivedBondId(nodeId);
  placeLayoutBond(draft, { id: lineId, from: centre, to: nodeId, order: 1 }, "inPlane");
  draft.marks.set(lineId, { stereo, narrowEnd: centre });
}

function lineOf(centre: AtomId, candidate: Candidate): string {
  return candidate.kind === "bond" ? candidate.bondId : derivedBondId(hydrogenNodeId(centre, 0));
}

/** Wedge for hash: the reverse depth, and so the other parity. */
function exchange(draft: PlacedLayout, centre: AtomId, candidate: Candidate): void {
  const lineId = lineOf(centre, candidate);
  const mark = draft.marks.get(lineId);
  if (mark === undefined) return;
  if (mark.stereo === "wedge") draft.marks.set(lineId, { ...mark, stereo: "hash" });
  else if (mark.stereo === "hash") draft.marks.set(lineId, { ...mark, stereo: "wedge" });
}

function undo(draft: PlacedLayout, centre: AtomId, candidate: Candidate): void {
  const lineId = lineOf(centre, candidate);
  draft.marks.delete(lineId);
  if (candidate.kind === "bond") return;
  const nodeId = hydrogenNodeId(centre, 0);
  draft.bonds.delete(lineId);
  draft.depth.delete(lineId);
  draft.positions.delete(nodeId);
  draft.derivedNodes.delete(nodeId);
  draft.provenance.delete(nodeId);
}

/**
 * Gaps whose widths differ by less than this count as equally wide: a
 * drawing's own irregularity (RDKit's steroid has 118 and 122 degree angles)
 * must not decide which side of a ring-fusion atom its hydrogen goes.
 */
const EQUAL_GAP = Math.PI / 18;

/** A candidate place nearer than this many `b` to another node is crowded (decision 157's half bond). */
const CROWDED = 0.5;

/**
 * One bond length from the centre, on the bisector of the widest angular gap
 * between its drawn bonds. Gaps within ten degrees of the widest are equals,
 * taken most nearly vertical first, then upward, then counter-clockwise from
 * +x. A bisector whose hydrogen would land within half a bond of another node
 * is passed over for the next, while any other is clear: choosing where a new
 * node goes, which is not moving an atom the author drew.
 */
function revealedHydrogenPosition(mol: Molecule, draft: PlacedLayout, centre: AtomId): Vec2 {
  const origin = draft.positions.get(centre)!;
  const length = CHARACTERISTIC_LENGTHS.planar.revealedHydrogen * draft.bondLength;
  const angles: number[] = [];
  for (const bond of bondsAt(mol, centre)) {
    const node = draft.drawnAs.get(otherEnd(bond, centre));
    const at = node === undefined ? undefined : draft.positions.get(node);
    if (at === undefined) continue;
    const dx = at.x - origin.x;
    const dy = at.y - origin.y;
    if (dx === 0 && dy === 0) continue;
    angles.push(Math.atan2(dy, dx));
  }
  if (angles.length === 0) return { x: origin.x, y: origin.y + length };
  angles.sort((a, b) => a - b);
  const gaps = angles.map((from, i) => {
    const to = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    return { width: to - from, bisector: from + (to - from) / 2 };
  });
  const widest = Math.max(...gaps.map((g) => g.width));
  const byPlace = (p: { bisector: number }, q: { bisector: number }): number => {
    const vertical = Math.abs(Math.sin(q.bisector)) - Math.abs(Math.sin(p.bisector));
    if (Math.abs(vertical) > 1e-9) return vertical;
    const up = Math.sin(q.bisector) - Math.sin(p.bisector);
    if (Math.abs(up) > 1e-9) return up;
    return normalAngle(p.bisector) - normalAngle(q.bisector);
  };
  const equals = gaps.filter((g) => g.width >= widest - EQUAL_GAP).sort(byPlace);
  const rest = gaps.filter((g) => g.width < widest - EQUAL_GAP).sort((p, q) => q.width - p.width || byPlace(p, q));
  const places = [...equals, ...rest].map((g) => ({
    x: origin.x + length * Math.cos(g.bisector),
    y: origin.y + length * Math.sin(g.bisector),
  }));
  const limit = CROWDED * draft.bondLength;
  const clear = places.find((place) => {
    for (const [node, at] of draft.positions) {
      if (node === centre) continue;
      if (Math.hypot(at.x - place.x, at.y - place.y) < limit) return false;
    }
    return true;
  });
  return clear ?? places[0]!;
}

function normalAngle(angle: number): number {
  const turned = angle % (2 * Math.PI);
  return turned < 0 ? turned + 2 * Math.PI : turned;
}
