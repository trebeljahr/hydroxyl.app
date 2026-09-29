/**
 * Configuration as a coordinate-free record: which way round each stereogenic
 * unit is, stated against ATOM IDS rather than against a drawing.
 *
 * WHY THIS EXISTS BESIDE stereo.ts. stereo.ts answers "what would a chemist
 * call this drawing": R, S, E, Z. Those letters are CIP-derived, so they change
 * when a substituent five bonds away changes, and they are the wrong thing to
 * carry through a projection. A Fischer, a Haworth and a wedge drawing of one
 * molecule must be comparable without re-ranking anything. So this module
 * states configuration the way a molfile parity does:
 *
 *   A TETRAHEDRAL CENTRE is a sign (+1 / -1) relative to an explicit, named
 *   ligand list, never relative to a positional slot. `bondsAt` order is not a
 *   stable name: `removeBond` compacts incident lists and `mergeAtoms` keeps an
 *   old slot for a new neighbour, so "slot 2" silently means a different atom
 *   after an unrelated edit.
 *
 *   A STEREOGENIC DOUBLE BOND is `cis` / `trans` between two named reference
 *   atoms, one per end. Deliberately not E/Z.
 *
 * Both are DERIVED from coordinates plus marks and never stored on the
 * Molecule. The molblock writer writes atom parity 0 and re-derives from wedges
 * for the same reason: a stored parity and a drawing that disagree make a
 * document nobody can trust.
 *
 * CANONICAL LIGAND ORDER (decision 15). The explicit neighbours ascending by
 * `compareIds` (numeric: a9 before a10), then the implicit hydrogen, then the
 * phantom lone pair LAST. P(H)(Me)(Et) lists Me, Et, H, LP. An explicit
 * hydrogen or deuterium atom counts as an explicit neighbour: it has an id, and
 * ids are what the order is made of.
 *
 * ONE PARITY FUNCTION, SEVERAL READING CONVENTIONS. `readConfig` lifts the 2D
 * placement into pseudo-3D and takes the sign of one signed volume, in
 * parity.ts, which stereo.ts calls too (decision 28). The
 * conventions differ ONLY in which ligands they lift toward the viewer and
 * which away (decision 16); the magnitude is always `PSEUDO_3D_DEPTH`.
 *
 *   wedgeHash  a wedge whose NARROW end is the centre points toward the viewer,
 *              a hash away. A bond whose `to` is the centre says nothing about
 *              that centre, the same test stereo.ts and chem-render apply.
 *   fischer    horizontal bonds toward the viewer, vertical bonds away. A bond
 *              at a centre that is not within `AXIS_EPSILON` of a page axis
 *              makes the whole placement unavailable. It is never classified
 *              by nearest axis. Wedge marks are ignored: the axes are the marks.
 *   haworth    the named ring lies in a horizontal plane seen from the front
 *              and slightly above, so a ring bond running DOWN the page runs
 *              toward the viewer. Exocyclic bonds at ring centres must be
 *              vertical and point up or down in that frame.
 *   pseudo3d   an explicit per-atom depth. Only the sign of a neighbour's depth
 *              relative to the centre is read.
 *
 * Because everything goes through the one volume, "a Fischer rotated 90
 * degrees inverts every centre, 180 inverts none" is a PREDICTION of the
 * geometry, not a rule written anywhere here. A convention-blind reader that
 * gave the toward-viewer depth to the vertical Fischer bonds would derive the
 * enantiomer at every centre; a wedge reader on a Fischer sees no marks at all.
 *
 * wedgeHash and pseudo3d lift RAW bond vectors and refuse, as
 * `ambiguous-geometry`, a volume under the relative floor or a sign that
 * differs from the unit-direction reading (decision 29). An undrawn hydrogen
 * or a lone pair sits opposite the in-plane resultant of the drawn bonds
 * (decision 28), so an exact T reads `ambiguous-geometry`. parity.ts states
 * both rules. Two implicit ligands, P(H)(Me)(Et) with the H undrawn, cannot
 * both be placed and read `ambiguous-geometry` (decision 33).
 *
 * MIRRORS. `flipAtoms` mirrors positions AND exchanges wedge with hash, which is
 * a half-turn about the page's y axis (a proper rotation), so it derives
 * IDENTICAL parities. Mirroring positions with the marks left alone derives the
 * INVERTED parity. cis/trans survives both. A reader that sees mirrored
 * positions plus swapped marks and derives the original parity is correct.
 *
 * WHICH UNITS EXIST, AND HOW THEY RANK, IS cip.ts's (the one classification
 * both readers use, so stereo.ts and this module cannot disagree about which
 * atoms are centres). In summary:
 *
 *   PHANTOM LONE-PAIR CENTRES are three-coordinate atoms whose lone pair is a
 *   configurationally stable fourth ligand, ranked lowest: sulfoxide S=O and
 *   sulfilimine S=N (neutral, no H), selenoxide Se=O, sulfonium S+, P(III) and
 *   As(III), and nitrogen that is neutral, three single bonds, no H, NOT
 *   aromatic, NOT conjugated (no aromatic or multiply bonded neighbour except
 *   S/P), and in an aziridine or at a BRIDGED bridgehead (two perceived rings
 *   sharing two or more bonds, one of them the nitrogen's; decision 30, RDKit's
 *   `queryIsAtomBridgehead`). Fused bridgehead N, amides, N-aryl, indolizine
 *   and Tröger's base N are not centres (Tröger's base is a known limit). A
 *   pinned lone-pair count is a display override and never creates a centre.
 *
 *   FOUR-COORDINATE P AND S WITH A DOUBLE BOND (decisions 31 and 43):
 *   phosphine oxides, phosphinates, phosphonates, phosphates,
 *   phosphoramidates, P=S, P=N and the P=C ylide (one double bond, the doubly
 *   bonded atom counts once), and sulfoximines. Their letters follow decision
 *   47: a multiple bond at the stereogenic atom is not duplicated, as the
 *   IUPAC 2013 text cited in cip.ts's header prescribes, so S=O and S+–O−
 *   drawings of one sulfoxide get one letter by construction. The phosphate
 *   diester anion's P, whose =O and O− differ only by formal charge, is listed
 *   and gets `ranking-unsupported` (escalated).
 *
 *   PSEUDOASYMMETRIC CENTRES AND RING cis/trans (decision 32). A centre with
 *   two constitutionally identical ligands whose branches contain other units
 *   is a centre here: pentitol C3, tropine C3, and both ring carbons of cis-
 *   and trans-1,4-dimethylcyclohexane, whose parities make the two isomers
 *   DISTINCT configs. Following IUPAC P-92.6 example 2 and RDKit, ring
 *   cis/trans at such centres is expressed as their pseudoasymmetric r/s
 *   parity, not as a separate unit kind. Whether one is stereogenic in a given
 *   configuration is decided by `descriptorFromConfig` with that config.
 *
 *   C=N AND N=N DOUBLE BONDS (oximes, hydrazones, azo compounds), with the
 *   nitrogen lone pair as the implicit second substituent, are cis/trans units
 *   like C=C. An N–H imine end is not.
 *
 *   AN EXPLICIT PROTIUM ATOM IS AN IMPLICIT HYDROGEN for ranking, in both
 *   readers. Deuterium and tritium differ by mass number, so CH3–CHD–OH is a
 *   stereocentre and CH3–CH(H)–OH is not.
 *
 *   AXES AND PLANES that no parity or cis/trans relation expresses (allenes,
 *   atropisomeric biaryls, spiranes, cyclophanes, helicenes) are listed in
 *   `unrepresentable` on every topology and config (stereo-axes.ts).
 *
 * A WAVY BOND at a centre reads `{ kind: "mixture", of: "epimers" }` under
 * every convention (decision 39). A crossed or wavy-ended double bond stays
 * `unspecified`.
 *
 * A DRAWN HYDROGEN (`Placement.hydrogens`, decision 179) is a centre's
 * implicit hydrogen given a position and a mark by the placement: a steroid
 * panel's hashed 5α-H, a Fischer's synthetic H arm. Every convention reads it
 * as an explicit ligand in the implicit hydrogen's slot; the model still
 * stores no hydrogen atom.
 *
 * CACHING (decision 19), split by what each half reads:
 *
 *   TOPOLOGY means which units are stereogenic, their ligand orders and their
 *   reference atoms, plus cip.ts's rule 1-2 rankings. It is memoised on
 *   cip.ts's topology fingerprint in the two-level shape rings.ts and
 *   aromatic.ts use, so a drag reuses it. The key REFINES the ring fingerprint
 *   with element, charge, isotope, radicals, hydrogen and lone-pair pins, bond
 *   orders and aromatic flags (decision 33d). Positions, `stereo` and
 *   `doubleBondSide` are out. Rankings that need rules 3-5 depend on the
 *   configuration, so they are computed per call and never cached here.
 *
 *   PARITY, read from positions and marks, is memoised per MOLECULE INSTANCE
 *   in a WeakMap as stereo.ts does. A parity cached on the topology key would
 *   survive the drag that reversed it.
 */

import {
  cipTopologyFingerprint,
  cipUnits,
  rankStereoCentre,
  type CipConfiguration,
  type LigandRef,
  type UndeterminedReason,
} from "./cip.js";
import { bondsAt, otherEnd, requireAtom, requireBond } from "./molecule.js";
import {
  liftParity,
  type LiftOptions,
  pointsParity,
  PSEUDO_3D_DEPTH,
  type LiftedPoint,
  type LiftLigand,
  type LiftOutcome,
  type TetrahedralParity,
} from "./parity.js";
import { LruCache } from "./rings.js";
import { unrepresentableStereo, type UnrepresentableStereoElement } from "./stereo-axes.js";
import type { AtomId, Bond, BondId, BondStereo, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import type { Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A stereogenic centre's ligands, in canonical order (decision 15). */
export interface CentreLigands {
  readonly atomId: AtomId;
  /** Explicit neighbours, ascending by `compareIds`. */
  readonly order: readonly AtomId[];
  /** One implicit hydrogen, listed after `order`. */
  readonly implicitHydrogen: boolean;
  /** The phantom lone pair, listed last. */
  readonly lonePair: boolean;
}

/**
 * Why a unit has no reading.
 *
 *   `coplanar`     pseudo3d only: no neighbour has a depth different from
 *                  the centre's, so nothing was claimed. A lift that has depth
 *                  but a volume under parity.ts's floor is
 *                  `ambiguous-geometry`, never a guessed sign.
 *   `not-covered`  the convention cannot state this unit at all: a double bond
 *                  under fischer or haworth, a centre outside the Haworth ring,
 *                  or any unit outside the read's `ReadScope`.
 *
 * The rest are stereo.ts's reasons, with stereo.ts's meanings.
 */
export type ConfigUndeterminedReason = UndeterminedReason | "coplanar" | "not-covered";

export type CentreReading =
  | { readonly kind: "specified"; readonly parity: TetrahedralParity }
  /** A wavy bond at the centre: a mixture of both configurations here (decision 39). */
  | { readonly kind: "mixture"; readonly of: "epimers" }
  | { readonly kind: "undetermined"; readonly reason: ConfigUndeterminedReason };

export interface CentreConfig extends CentreLigands {
  /** Parity relative to the canonical ligand order. */
  readonly reading: CentreReading;
}

export interface DoubleBondTopology {
  readonly bondId: BondId;
  /** Lowest-`compareIds` neighbour of `bond.from`, other than `bond.to`. */
  readonly refOnFrom: AtomId;
  /** Lowest-`compareIds` neighbour of `bond.to`, other than `bond.from`. */
  readonly refOnTo: AtomId;
}

export type DoubleBondRelation = "cis" | "trans";

export type DoubleBondReading =
  | { readonly kind: "specified"; readonly relation: DoubleBondRelation }
  | { readonly kind: "undetermined"; readonly reason: ConfigUndeterminedReason };

export interface DoubleBondConfig extends DoubleBondTopology {
  readonly reading: DoubleBondReading;
}

/** Every stereogenic unit and its reading, each list in `compareIds` order. */
export interface StereoConfig {
  readonly centres: readonly CentreConfig[];
  readonly doubleBonds: readonly DoubleBondConfig[];
  /**
   * Stereogenic axes and planes this record cannot express (stereo-axes.ts).
   * Non-empty means an empty `centres` and `doubleBonds` do NOT say the
   * molecule has no configuration to state.
   */
  readonly unrepresentable: readonly UnrepresentableStereoElement[];
}

/** The position-independent half of a `StereoConfig`. */
export interface StereoTopology {
  readonly centres: readonly CentreLigands[];
  readonly doubleBonds: readonly DoubleBondTopology[];
  readonly unrepresentable: readonly UnrepresentableStereoElement[];
}

/** How a placement encodes depth. See the module header. */
export type DepthConvention =
  | { readonly kind: "wedgeHash" }
  | { readonly kind: "fischer" }
  | { readonly kind: "haworth"; readonly ringAtomIds: readonly AtomId[] }
  | { readonly kind: "pseudo3d"; readonly depth: Readonly<Record<AtomId, number>> };

/**
 * A mark as a layout drew it: the stereo code and which END is narrow.
 *
 * The narrow end is NAMED rather than implied by `bond.from`, because a
 * projection moves marks without editing bonds: a mirrored panel exchanges
 * wedge and hash, and a panel re-marking a centre may put the narrow end at
 * the bond's `to`. Rewriting `from`/`to` to say that would be minting a bond,
 * which a view must never do (decision 12).
 */
export interface PlacedMark {
  readonly stereo: BondStereo;
  readonly narrowEnd: AtomId;
}

/**
 * A molecule and where its atoms are drawn. `positions` overrides `atom.pos`
 * per atom, so a projection layout can be read without writing it into the
 * model. Atoms it omits keep their own positions.
 *
 * `marks` does the same for the bonds' stereo marks, keyed by bond id. A bond
 * it omits keeps the molecule's own mark, so a caller reading a layout that
 * drew NO mark on a bond says so with `stereo: "none"` rather than leaving it
 * out — otherwise the author's wedge would leak into the reading of a Fischer
 * that never drew it.
 *
 * `hydrogens` is the ATOM-PLUS-DIRECTION SEAM (decision 179): a centre's
 * implicit hydrogen drawn at a position, keyed by the centre. See
 * `PlacedHydrogen`. A centre with no entry reads exactly as it always has.
 */
export interface Placement {
  readonly mol: Molecule;
  readonly positions?: Readonly<Record<AtomId, Vec2>> | undefined;
  readonly marks?: Readonly<Record<BondId, PlacedMark>> | undefined;
  readonly hydrogens?: Readonly<Record<AtomId, PlacedHydrogen>> | undefined;
}

/**
 * A centre's IMPLICIT hydrogen, drawn: where its line ends, and the mark on
 * that line, whose narrow end is the centre by definition (decision 179).
 *
 * The model stores no hydrogen atom, so a mark on a C–H direction has no bond
 * to live on: a steroid's 5α-H is drawn as a hashed line to an "H" that exists
 * only in the picture, and a Fischer's synthetic H sits on one arm of the
 * cross. Readers take a drawn hydrogen as an explicit ligand in the implicit
 * hydrogen's slot of decision 15's order: the wedge/hash and pseudo3d readers
 * read its offset and its mark (a wedge toward the viewer, a hash away), the
 * Fischer reader its axis slot, the Haworth reader its vertical, and a wavy
 * mark on it is a mixture as on any bond. An entry for an atom that is not a
 * centre, or has no implicit hydrogen, is ignored.
 */
export interface PlacedHydrogen {
  readonly position: Vec2;
  readonly stereo: BondStereo;
}

/**
 * Which units a read covers (decision 144). A unit outside the scope reads
 * `not-covered` and can never refuse the placement, so one centre can be put
 * on a synthetic Fischer cross while every other centre keeps bonds that are
 * nowhere near the page axes. Absent means every unit.
 *
 * A double bond is in scope only when `doubleBonds` names it (decision 171):
 * a synthetic cross names one centre and reads no double bond, while a
 * projection layout's coverage, which has this same shape, names the double
 * bonds a planar panel states. Naming one never lets another unit refuse,
 * because a double bond's reading never refuses a placement.
 */
export interface ReadScope {
  readonly centres: readonly AtomId[];
  readonly doubleBonds?: readonly BondId[] | undefined;
}

export type ConfigUnavailableReason =
  /** fischer: a bond at a centre is not within epsilon of a page axis. */
  | "off-axis"
  /** haworth: `ringAtomIds` is not one simple ring of the molecule. */
  | "not-a-ring"
  /** haworth: an exocyclic bond at a ring centre is not vertical. */
  | "non-vertical-substituent";

/**
 * Either every unit's reading, or a refusal of the placement as a whole, as
 * opposed to one unit being undetermined. `atomIds` names what to fix.
 */
export type ConfigRead =
  | { readonly kind: "read"; readonly config: StereoConfig }
  | {
      readonly kind: "unavailable";
      readonly reason: ConfigUnavailableReason;
      readonly atomIds: readonly AtomId[];
    };

export type ConfigDescriptor =
  | { readonly kind: "R" }
  | { readonly kind: "S" }
  | { readonly kind: "r" }
  | { readonly kind: "s" }
  | { readonly kind: "mixture"; readonly of: "epimers" }
  | { readonly kind: "undetermined"; readonly reason: ConfigUndeterminedReason };

export type RingFaceReason =
  | "not-a-ring"
  | "not-a-substituent"
  | "degenerate-polygon"
  | "self-intersecting-polygon"
  | "no-stereo-bond"
  | "unspecified"
  | "ambiguous-geometry";

/**
 * Which side of a ring a substituent is on. `front` is the side the ring's
 * reference normal points to. Never named up/down: beta on a steroid means
 * toward the viewer, and up on a Haworth means up the page.
 */
export type RingFace =
  | { readonly kind: "front" }
  | { readonly kind: "back" }
  | { readonly kind: "undetermined"; readonly reason: RingFaceReason };

// ---------------------------------------------------------------------------
// Ligands and parity arithmetic
// ---------------------------------------------------------------------------

const IMPLICIT_H: LigandRef = Object.freeze({ kind: "implicitHydrogen" });
const LONE_PAIR: LigandRef = Object.freeze({ kind: "lonePair" });

/** A centre's ligands as refs, in canonical order. */
export function ligandRefs(centre: CentreLigands): readonly LigandRef[] {
  const out: LigandRef[] = centre.order.map((atomId) => ({ kind: "atom", atomId }));
  if (centre.implicitHydrogen) out.push(IMPLICIT_H);
  if (centre.lonePair) out.push(LONE_PAIR);
  return out;
}

function sameRef(a: LigandRef, b: LigandRef): boolean {
  if (a.kind === "atom" || b.kind === "atom") {
    return a.kind === "atom" && b.kind === "atom" && a.atomId === b.atomId;
  }
  return a.kind === b.kind;
}

/**
 * `centre`'s parity restated against another ordering of the same ligands, or
 * undefined when the centre has no reading or `order` is not a permutation of
 * its ligands.
 *
 * The volume is alternating in its four points, so the answer is the canonical
 * parity times the sign of the permutation.
 */
export function parityAgainst(
  centre: CentreConfig,
  order: readonly LigandRef[],
): TetrahedralParity | undefined {
  if (centre.reading.kind !== "specified") return undefined;
  const canonical = ligandRefs(centre);
  if (order.length !== canonical.length) return undefined;
  const perm: number[] = [];
  for (const ref of order) {
    const index = canonical.findIndex((c) => sameRef(c, ref));
    if (index < 0 || perm.includes(index)) return undefined;
    perm.push(index);
  }
  let inversions = 0;
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) {
      if (perm[i]! > perm[j]!) inversions++;
    }
  }
  const parity = centre.reading.parity;
  return inversions % 2 === 0 ? parity : parity === 1 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

interface TopologyRecord {
  readonly topology: StereoTopology;
  readonly centresById: ReadonlyMap<AtomId, CentreLigands>;
}

function computeTopology(mol: Molecule): TopologyRecord {
  const units = cipUnits(mol);
  const centres: CentreLigands[] = units.centres.map((unit) =>
    Object.freeze({
      atomId: unit.atomId,
      order: Object.freeze(
        unit.ligands.flatMap((ligand) => (ligand.kind === "atom" ? [ligand.atomId] : [])),
      ),
      implicitHydrogen: unit.implicitHydrogen,
      lonePair: unit.lonePair,
    }),
  );
  const doubleBonds: DoubleBondTopology[] = units.doubleBonds.map((unit) =>
    Object.freeze({ bondId: unit.bondId, refOnFrom: unit.refOnFrom, refOnTo: unit.refOnTo }),
  );
  return {
    topology: Object.freeze({
      centres: Object.freeze(centres),
      doubleBonds: Object.freeze(doubleBonds),
      unrepresentable: unrepresentableStereo(mol),
    }),
    centresById: new Map(centres.map((centre) => [centre.atomId, centre])),
  };
}

const TOPOLOGY_BY_INSTANCE = new WeakMap<Molecule, TopologyRecord>();
const TOPOLOGY_BY_FINGERPRINT = new LruCache<TopologyRecord>(32);
let topologyComputations = 0;

function topologyRecord(mol: Molecule): TopologyRecord {
  const hit = TOPOLOGY_BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = TOPOLOGY_BY_FINGERPRINT.get(key);
  if (shared) {
    TOPOLOGY_BY_INSTANCE.set(mol, shared);
    return shared;
  }
  // Incremented here and nowhere else, so a cache hit never looks like work.
  topologyComputations++;
  const built = computeTopology(mol);
  TOPOLOGY_BY_FINGERPRINT.set(key, built);
  TOPOLOGY_BY_INSTANCE.set(mol, built);
  return built;
}

/** Which units are stereogenic, with their ligand orders. A drag reuses it. */
export function stereoTopology(mol: Molecule): StereoTopology {
  return topologyRecord(mol).topology;
}

/** Testing hook: how many times the topology half has actually run. */
export function stereoTopologyComputationCount(): number {
  return topologyComputations;
}

/** Testing hook. The counter is process-global, so each assertion resets. */
export function resetStereoTopologyComputationCount(): void {
  topologyComputations = 0;
}

// ---------------------------------------------------------------------------
// The lift and the one parity function
// ---------------------------------------------------------------------------

/**
 * How far a unit bond direction may stray from a page axis and still count as
 * on it. `rotateAtoms` by a right angle leaves residues near 1e-16; a tilt of a
 * hundredth of a degree does not pass.
 */
const AXIS_EPSILON = 1e-6;

type Unavailable = { readonly kind: "unavailable"; readonly reason: ConfigUnavailableReason };
type Undetermined = { readonly kind: "undetermined"; readonly reason: ConfigUndeterminedReason };
type Lift = { readonly kind: "points"; readonly points: readonly LiftedPoint[] } | Undetermined | Unavailable;

interface ReadContext {
  readonly mol: Molecule;
  readonly positions: Readonly<Record<AtomId, Vec2>> | undefined;
  readonly marks: Readonly<Record<BondId, PlacedMark>> | undefined;
  readonly hydrogens: Readonly<Record<AtomId, PlacedHydrogen>> | undefined;
}

/** The centre's implicit hydrogen as the placement draws it, if it does (decision 179). */
function drawnHydrogen(ctx: ReadContext, centre: CentreLigands): PlacedHydrogen | undefined {
  const hydrogens = ctx.hydrogens;
  if (!centre.implicitHydrogen || hydrogens === undefined || !Object.hasOwn(hydrogens, centre.atomId)) {
    return undefined;
  }
  return hydrogens[centre.atomId];
}

/** A drawn hydrogen's depth: its mark's, narrow end at the centre by definition. */
function hydrogenDepth(hydrogen: PlacedHydrogen): number {
  if (hydrogen.stereo === "wedge") return 1;
  if (hydrogen.stereo === "hash") return -1;
  return 0;
}

/** The unit direction from the centre to its drawn hydrogen, undefined if it has no length. */
function hydrogenDirection(ctx: ReadContext, centre: AtomId, hydrogen: PlacedHydrogen): Vec2 | undefined {
  const a = positionOf(ctx, centre);
  const dx = hydrogen.position.x - a.x;
  const dy = hydrogen.position.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return undefined;
  return { x: dx / length, y: dy / length };
}

function positionOf(ctx: ReadContext, atomId: AtomId): Vec2 {
  const positions = ctx.positions;
  if (positions !== undefined && Object.hasOwn(positions, atomId)) return positions[atomId]!;
  return requireAtom(ctx.mol, atomId).pos;
}

function unitDirection(ctx: ReadContext, from: AtomId, to: AtomId): Vec2 | undefined {
  const a = positionOf(ctx, from);
  const b = positionOf(ctx, to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return undefined;
  return { x: dx / length, y: dy / length };
}

/** The bond from `centre` to each explicit ligand, looked up by neighbour id. */
function bondsByNeighbour(mol: Molecule, centre: AtomId): Map<AtomId, Bond> {
  const out = new Map<AtomId, Bond>();
  for (const bond of bondsAt(mol, centre)) out.set(otherEnd(bond, centre), bond);
  return out;
}

/** The bond's own mark: narrow end at `from`, the model's convention. */
function ownMark(bond: Bond): PlacedMark {
  return { stereo: bond.stereo, narrowEnd: bond.from };
}

/** The mark the placement drew on `bond`: its override, else the bond's own. */
function drawnMark(ctx: ReadContext, bond: Bond): PlacedMark {
  const marks = ctx.marks;
  if (marks !== undefined && Object.hasOwn(marks, bond.id)) return marks[bond.id]!;
  return ownMark(bond);
}

/** +1 toward, −1 away, 0 silent. Narrow end only, single bonds only. */
function markValue(bond: Bond, mark: PlacedMark, centre: AtomId): number {
  if (bond.order !== 1 || mark.narrowEnd !== centre) return 0;
  if (mark.stereo === "wedge") return 1;
  if (mark.stereo === "hash") return -1;
  return 0;
}

/** `markValue` against the bond's own mark, for a reader with no placement. */
function markAt(bond: Bond, centre: AtomId): number {
  return markValue(bond, ownMark(bond), centre);
}

function hasWavyAt(ctx: ReadContext, atomId: AtomId): boolean {
  // A wavy line to a drawn hydrogen blurs its atom like any other wavy line
  // at it (decision 179).
  const hydrogens = ctx.hydrogens;
  if (hydrogens !== undefined && Object.hasOwn(hydrogens, atomId) && hydrogens[atomId]!.stereo === "wavy") {
    return true;
  }
  return bondsAt(ctx.mol, atomId).some((bond) => {
    const mark = drawnMark(ctx, bond);
    return bond.order === 1 && mark.narrowEnd === atomId && mark.stereo === "wavy";
  });
}

function implicitCount(centre: CentreLigands): number {
  return (centre.implicitHydrogen ? 1 : 0) + (centre.lonePair ? 1 : 0);
}

/**
 * wedgeHash and pseudo3d: raw offsets and a depth sign per explicit ligand,
 * handed to parity.ts with the implicit ligands, which places them and
 * applies the ambiguity guard. Returns the reading directly.
 *
 * A DRAWN hydrogen (decision 179) takes the implicit hydrogen's slot as a
 * drawn ligand, at its offset and with its mark's depth, so the lift places
 * only what is still undrawn (a lone pair).
 */
function readDrawn(
  ctx: ReadContext,
  centre: CentreLigands,
  depthOf: (neighbour: AtomId, bond: Bond) => number,
  silentReason: ConfigUndeterminedReason,
  options: LiftOptions = {},
): CentreReading {
  const bonds = bondsByNeighbour(ctx.mol, centre.atomId);
  const origin = positionOf(ctx, centre.atomId);
  const ligands: LiftLigand[] = [];
  for (const neighbour of centre.order) {
    const bond = bonds.get(neighbour);
    if (bond === undefined) return { kind: "undetermined", reason: "ambiguous-geometry" };
    const at = positionOf(ctx, neighbour);
    ligands.push({
      kind: "drawn",
      offset: { x: at.x - origin.x, y: at.y - origin.y },
      depth: depthOf(neighbour, bond),
    });
  }
  const hydrogen = drawnHydrogen(ctx, centre);
  if (hydrogen !== undefined) {
    ligands.push({
      kind: "drawn",
      offset: { x: hydrogen.position.x - origin.x, y: hydrogen.position.y - origin.y },
      depth: hydrogenDepth(hydrogen),
    });
  }
  const undrawn = implicitCount(centre) - (hydrogen === undefined ? 0 : 1);
  for (let k = 0; k < undrawn; k++) ligands.push({ kind: "implicit" });
  return fromLift(liftParity(ligands, options), silentReason);
}

function fromLift(
  outcome: LiftOutcome,
  silentReason: ConfigUndeterminedReason,
): CentreReading {
  if (outcome.kind === "flat") return { kind: "undetermined", reason: silentReason };
  if (outcome.kind === "ambiguous") return { kind: "undetermined", reason: "ambiguous-geometry" };
  return { kind: "specified", parity: outcome.parity };
}

type AxisSlot = "E" | "N" | "W" | "S";
const AXIS_SLOTS: readonly AxisSlot[] = ["E", "N", "W", "S"];

/** Horizontals toward the viewer, verticals away: the Fischer convention. */
const FISCHER_POINT: Readonly<Record<AxisSlot, LiftedPoint>> = {
  E: { x: 1, y: 0, z: PSEUDO_3D_DEPTH },
  W: { x: -1, y: 0, z: PSEUDO_3D_DEPTH },
  N: { x: 0, y: 1, z: -PSEUDO_3D_DEPTH },
  S: { x: 0, y: -1, z: -PSEUDO_3D_DEPTH },
};

function axisSlot(dir: Vec2): AxisSlot | undefined {
  if (Math.abs(dir.y) <= AXIS_EPSILON) return dir.x > 0 ? "E" : "W";
  if (Math.abs(dir.x) <= AXIS_EPSILON) return dir.y > 0 ? "N" : "S";
  return undefined;
}

function liftFischer(ctx: ReadContext, centre: CentreLigands): Lift {
  const used = new Set<AxisSlot>();
  const points: LiftedPoint[] = [];
  let ambiguous = false;
  for (const neighbour of centre.order) {
    const dir = unitDirection(ctx, centre.atomId, neighbour);
    if (dir === undefined) {
      ambiguous = true;
      continue;
    }
    const slot = axisSlot(dir);
    // Checked for every bond before any other verdict, so an off-axis bond is
    // a refusal even at a centre that is also ambiguous for another reason.
    if (slot === undefined) return { kind: "unavailable", reason: "off-axis" };
    if (used.has(slot)) ambiguous = true;
    used.add(slot);
    points.push(FISCHER_POINT[slot]);
  }
  // A drawn hydrogen (decision 179) is read on the arm it is drawn on, under
  // the same axis rule as a bond: a synthetic H off the axes refuses the
  // placement exactly as an off-axis bond does.
  const hydrogen = drawnHydrogen(ctx, centre);
  if (hydrogen !== undefined) {
    const dir = hydrogenDirection(ctx, centre.atomId, hydrogen);
    if (dir === undefined) {
      ambiguous = true;
    } else {
      const slot = axisSlot(dir);
      if (slot === undefined) return { kind: "unavailable", reason: "off-axis" };
      if (used.has(slot)) ambiguous = true;
      used.add(slot);
      points.push(FISCHER_POINT[slot]);
    }
  }
  if (ambiguous) return { kind: "undetermined", reason: "ambiguous-geometry" };
  const implicit = implicitCount(centre) - (hydrogen === undefined ? 0 : 1);
  if (implicit > 0) {
    // The implicit hydrogen sits in the one empty arm of the cross.
    const vacant = AXIS_SLOTS.filter((slot) => !used.has(slot));
    if (implicit !== 1 || vacant.length !== 1) {
      return { kind: "undetermined", reason: "ambiguous-geometry" };
    }
    points.push(FISCHER_POINT[vacant[0]!]);
  }
  return { kind: "points", points };
}

function liftHaworth(ctx: ReadContext, centre: CentreLigands, ring: ReadonlySet<AtomId>): Lift {
  if (!ring.has(centre.atomId)) return { kind: "undetermined", reason: "not-covered" };
  const points: LiftedPoint[] = [];
  let verticalSum = 0;
  let ambiguous = false;
  for (const neighbour of centre.order) {
    const dir = unitDirection(ctx, centre.atomId, neighbour);
    if (dir === undefined) {
      ambiguous = true;
      continue;
    }
    if (ring.has(neighbour)) {
      // The ring plane is the 3D x–z plane; lower on the page is nearer.
      const toward = Math.abs(dir.y) <= AXIS_EPSILON ? 0 : -Math.sign(dir.y);
      points.push({ x: dir.x, y: 0, z: toward * PSEUDO_3D_DEPTH });
    } else {
      if (Math.abs(dir.x) > AXIS_EPSILON) {
        return { kind: "unavailable", reason: "non-vertical-substituent" };
      }
      const up = Math.sign(dir.y);
      verticalSum += up;
      points.push({ x: 0, y: up, z: 0 });
    }
  }
  // A drawn hydrogen (decision 179) is an exocyclic substituent like any
  // other, and must be vertical.
  const hydrogen = drawnHydrogen(ctx, centre);
  if (hydrogen !== undefined) {
    const dir = hydrogenDirection(ctx, centre.atomId, hydrogen);
    if (dir === undefined) {
      ambiguous = true;
    } else {
      if (Math.abs(dir.x) > AXIS_EPSILON) {
        return { kind: "unavailable", reason: "non-vertical-substituent" };
      }
      const up = Math.sign(dir.y);
      verticalSum += up;
      points.push({ x: 0, y: up, z: 0 });
    }
  }
  if (ambiguous) return { kind: "undetermined", reason: "ambiguous-geometry" };
  const implicit = implicitCount(centre) - (hydrogen === undefined ? 0 : 1);
  if (implicit > 0) {
    if (implicit !== 1 || verticalSum === 0) {
      return { kind: "undetermined", reason: "ambiguous-geometry" };
    }
    points.push({ x: 0, y: -Math.sign(verticalSum), z: 0 });
  }
  return { kind: "points", points };
}

function readCentre(
  ctx: ReadContext,
  centre: CentreLigands,
  convention: DepthConvention,
  ring: ReadonlySet<AtomId>,
): CentreReading | Unavailable {
  let lift: Lift | CentreReading;
  switch (convention.kind) {
    case "wedgeHash":
      lift = readDrawn(
        ctx,
        centre,
        (_, bond) => markValue(bond, drawnMark(ctx, bond), centre.atomId),
        "no-stereo-bond",
        { refuseOpposedMarks: true },
      );
      break;
    case "pseudo3d": {
      const depth = convention.depth;
      const zOf = (id: AtomId): number => {
        const value = Object.hasOwn(depth, id) ? depth[id] : undefined;
        return value !== undefined && Number.isFinite(value) ? value : 0;
      };
      const own = zOf(centre.atomId);
      lift = readDrawn(ctx, centre, (id) => zOf(id) - own, "coplanar");
      break;
    }
    case "fischer":
      lift = liftFischer(ctx, centre);
      break;
    case "haworth":
      lift = liftHaworth(ctx, centre, ring);
      break;
  }
  if (lift.kind === "unavailable") return lift;
  // A wavy bond is the author declining to state a configuration, under every
  // convention. It is checked after the placement test so a refusal still
  // names every off-axis centre.
  if (hasWavyAt(ctx, centre.atomId)) return { kind: "mixture", of: "epimers" };
  if (lift.kind !== "points") return lift;
  // Fischer and Haworth points are unit directions built from the convention,
  // so the floor applies at the depth constant's own scale.
  const parity = pointsParity(lift.points, PSEUDO_3D_DEPTH);
  if (parity === undefined) return { kind: "undetermined", reason: "ambiguous-geometry" };
  return { kind: "specified", parity };
}

function readDoubleBond(
  ctx: ReadContext,
  unit: DoubleBondTopology,
  convention: DepthConvention,
): DoubleBondReading {
  if (convention.kind === "fischer" || convention.kind === "haworth") {
    return { kind: "undetermined", reason: "not-covered" };
  }
  const bond = requireBond(ctx.mol, unit.bondId);
  if (drawnMark(ctx, bond).stereo === "either") {
    return { kind: "undetermined", reason: "unspecified" };
  }
  if (hasWavyAt(ctx, bond.from) || hasWavyAt(ctx, bond.to)) {
    return { kind: "undetermined", reason: "unspecified" };
  }
  const from = positionOf(ctx, bond.from);
  const to = positionOf(ctx, bond.to);
  const refFrom = positionOf(ctx, unit.refOnFrom);
  const refTo = positionOf(ctx, unit.refOnTo);
  const axisX = to.x - from.x;
  const axisY = to.y - from.y;
  const sideFrom = axisX * (refFrom.y - from.y) - axisY * (refFrom.x - from.x);
  const sideTo = axisX * (refTo.y - to.y) - axisY * (refTo.x - to.x);
  // Scale-relative, as in stereo.ts: the cross product grows with bond length.
  const floor = 1e-6 * Math.hypot(axisX, axisY);
  if (!(floor > 0) || !(Math.abs(sideFrom) >= floor) || !(Math.abs(sideTo) >= floor)) {
    return { kind: "undetermined", reason: "ambiguous-geometry" };
  }
  return { kind: "specified", relation: sideFrom * sideTo > 0 ? "cis" : "trans" };
}

const NOT_COVERED: CentreReading = Object.freeze({ kind: "undetermined", reason: "not-covered" });

function computeRead(
  ctx: ReadContext,
  convention: DepthConvention,
  scope: ReadScope | undefined,
): ConfigRead {
  const { topology } = topologyRecord(ctx.mol);
  const inScope = scope === undefined ? undefined : new Set(scope.centres);
  const bondsInScope = scope === undefined ? undefined : new Set(scope.doubleBonds ?? []);

  let ring: ReadonlySet<AtomId> = new Set();
  if (convention.kind === "haworth") {
    const walk = canonicalRingWalk(ctx.mol, convention.ringAtomIds);
    if (walk === undefined) {
      return Object.freeze({
        kind: "unavailable",
        reason: "not-a-ring",
        atomIds: Object.freeze([...convention.ringAtomIds]),
      });
    }
    ring = new Set(walk);
  }

  const centres: CentreConfig[] = [];
  const refused: AtomId[] = [];
  let refusal: ConfigUnavailableReason | undefined;
  for (const centre of topology.centres) {
    if (inScope !== undefined && !inScope.has(centre.atomId)) {
      centres.push(Object.freeze({ ...centre, reading: NOT_COVERED }));
      continue;
    }
    const reading = readCentre(ctx, centre, convention, ring);
    if (reading.kind === "unavailable") {
      refusal ??= reading.reason;
      refused.push(centre.atomId);
      continue;
    }
    centres.push(Object.freeze({ ...centre, reading: Object.freeze(reading) }));
  }
  if (refusal !== undefined) {
    return Object.freeze({ kind: "unavailable", reason: refusal, atomIds: Object.freeze(refused) });
  }

  const doubleBonds = topology.doubleBonds.map(
    (unit): DoubleBondConfig =>
      Object.freeze({
        ...unit,
        reading: Object.freeze(
          bondsInScope === undefined || bondsInScope.has(unit.bondId)
            ? readDoubleBond(ctx, unit, convention)
            : { kind: "undetermined" as const, reason: "not-covered" as const },
        ),
      }),
  );
  return Object.freeze({
    kind: "read",
    config: Object.freeze({
      centres: Object.freeze(centres),
      doubleBonds: Object.freeze(doubleBonds),
      unrepresentable: topology.unrepresentable,
    }),
  });
}

/**
 * Per-instance cache of parity reads, for the two conventions that take no
 * parameters. Positions and marks are inputs here, so the topology fingerprint
 * is the wrong key (decision 19); instance identity is sound because every
 * edit mints a new Molecule.
 */
const READS_BY_INSTANCE = new WeakMap<Molecule, Map<string, ConfigRead>>();

/**
 * Reads every stereogenic unit of `placement` under `convention`.
 *
 * `unavailable` when the placement as a whole does not follow the convention:
 * a Fischer bond off the page axes, a Haworth ring that is not a ring. Every
 * other failure is per unit, an `undetermined` reading with its reason.
 *
 * `scope` restricts the read to some centres (decision 144) and the double
 * bonds it names (decision 171): everything else reads `not-covered`, and
 * only a centre in scope can refuse the placement.
 */
export function readConfig(
  placement: Placement,
  convention: DepthConvention,
  scope?: ReadScope,
): ConfigRead {
  const mol = placement.mol;
  const cacheable =
    placement.positions === undefined &&
    placement.marks === undefined &&
    placement.hydrogens === undefined &&
    scope === undefined &&
    (convention.kind === "wedgeHash" || convention.kind === "fischer");
  let reads: Map<string, ConfigRead> | undefined;
  if (cacheable) {
    reads = READS_BY_INSTANCE.get(mol);
    if (reads === undefined) {
      reads = new Map();
      READS_BY_INSTANCE.set(mol, reads);
    }
    const cached = reads.get(convention.kind);
    if (cached !== undefined) return cached;
  }
  const result = computeRead(
    { mol, positions: placement.positions, marks: placement.marks, hydrogens: placement.hydrogens },
    convention,
    scope,
  );
  reads?.set(convention.kind, result);
  return result;
}

const WEDGE_HASH: DepthConvention = Object.freeze({ kind: "wedgeHash" });

/** The configuration a wedge-and-hash drawing states, memoised per instance. */
export function stereoConfig(mol: Molecule): StereoConfig {
  const read = readConfig({ mol }, WEDGE_HASH);
  // wedgeHash never refuses a placement; the branch keeps the type honest.
  if (read.kind !== "read") throw new Error("wedge/hash reading refused a placement");
  return read.config;
}

// ---------------------------------------------------------------------------
// R/S from a configuration
// ---------------------------------------------------------------------------

/**
 * The configuration a `StereoConfig` states, in the form cip.ts's rules 3-5
 * read. A mixture reads as `unspecified` there: the ranking of a centre that
 * depends on a wavy unit is not known.
 */
export function cipConfiguration(config: StereoConfig): CipConfiguration {
  const centres = new Map(config.centres.map((c) => [c.atomId, c]));
  const bonds = new Map(config.doubleBonds.map((b) => [b.bondId, b]));
  return {
    centre(atomId) {
      const c = centres.get(atomId);
      if (c === undefined) return undefined;
      if (c.reading.kind === "specified") {
        return { kind: "specified", order: ligandRefs(c), parity: c.reading.parity };
      }
      if (c.reading.kind === "mixture") return { kind: "undetermined", reason: "unspecified" };
      return { kind: "undetermined", reason: cipReason(c.reading.reason) };
    },
    doubleBond(bondId) {
      const b = bonds.get(bondId);
      if (b === undefined) return undefined;
      if (b.reading.kind === "specified") {
        return { kind: "specified", refOnFrom: b.refOnFrom, refOnTo: b.refOnTo, relation: b.reading.relation };
      }
      return { kind: "undetermined", reason: cipReason(b.reading.reason) };
    },
  };
}

/** `coplanar` and `not-covered` both mean "no reading" to the ranking. */
function cipReason(reason: ConfigUndeterminedReason): UndeterminedReason {
  return reason === "coplanar" || reason === "not-covered" ? "no-stereo-bond" : reason;
}

/**
 * The CIP descriptor for `centre`: R or S, lowercase r or s at a
 * pseudoasymmetric centre, or the mixture a wavy bond states. Undefined when
 * the atom is not a stereocentre of `mol`, or when `config` shows that a
 * centre whose stereogenicity rides on other units is not stereogenic here.
 *
 * `config` supplies the other units' configurations that rules 3-5 need (the
 * branches of a pseudoasymmetric centre). A centre that needs them and gets no
 * `config` is `ranking-unsupported`; pass the config `centre` came from.
 *
 * Throws when `centre` lists different ligands from `mol`'s own topology: a
 * config from another molecule would otherwise be ranked against the wrong
 * neighbours and come back with a confident letter.
 */
export function descriptorFromConfig(
  mol: Molecule,
  centre: CentreConfig,
  config?: StereoConfig,
): ConfigDescriptor | undefined {
  const record = topologyRecord(mol);
  const own = record.centresById.get(centre.atomId);
  if (own === undefined) return undefined;
  if (
    own.implicitHydrogen !== centre.implicitHydrogen ||
    own.lonePair !== centre.lonePair ||
    own.order.length !== centre.order.length ||
    own.order.some((id, i) => id !== centre.order[i])
  ) {
    throw new Error(`Centre ${centre.atomId} does not match this molecule's ligands`);
  }
  const ranking = rankStereoCentre(
    mol,
    centre.atomId,
    config === undefined ? undefined : cipConfiguration(config),
  );
  if (ranking === undefined || ranking.kind === "not-stereogenic") return undefined;
  if (ranking.kind === "undetermined") return ranking;
  if (centre.reading.kind !== "specified") return centre.reading;
  const parity = parityAgainst(centre, ranking.order);
  if (parity === undefined) return undefined;
  if (ranking.pseudoasymmetric) return parity < 0 ? { kind: "r" } : { kind: "s" };
  return parity < 0 ? { kind: "R" } : { kind: "S" };
}

// ---------------------------------------------------------------------------
// Ring faces
// ---------------------------------------------------------------------------

/**
 * `ringAtomIds` as the canonical closed walk, or undefined when they are not
 * one simple ring. The rule is rings.ts's `canonicaliseWalk`: start at the
 * lowest `mol.atomIds` index and step toward the lower-index neighbour, so a
 * perceived ring comes back as the identical array.
 *
 * Rebuilt from the set rather than looked up in `rings(mol)`, so any simple
 * cycle qualifies while a set whose induced graph has a chord (a naphthalene
 * perimeter) does not.
 */
function canonicalRingWalk(mol: Molecule, ringAtomIds: readonly AtomId[]): AtomId[] | undefined {
  const set = new Set(ringAtomIds);
  if (set.size < 3) return undefined;
  const index = new Map<AtomId, number>();
  mol.atomIds.forEach((id, i) => index.set(id, i));
  const inSet = new Map<AtomId, readonly [AtomId, AtomId]>();
  let start: AtomId | undefined;
  for (const id of set) {
    if (!index.has(id)) return undefined;
    const neighbours = bondsAt(mol, id)
      .map((bond) => otherEnd(bond, id))
      .filter((other) => set.has(other));
    if (neighbours.length !== 2) return undefined;
    inSet.set(id, [neighbours[0]!, neighbours[1]!]);
    if (start === undefined || index.get(id)! < index.get(start)!) start = id;
  }
  const first = start!;
  const [n1, n2] = inSet.get(first)!;
  const walk: AtomId[] = [first];
  let previous = first;
  let current = index.get(n1)! <= index.get(n2)! ? n1 : n2;
  while (current !== first) {
    if (walk.length >= set.size) return undefined;
    walk.push(current);
    const [x, y] = inSet.get(current)!;
    const next = x === previous ? y : x;
    previous = current;
    current = next;
  }
  return walk.length === set.size ? walk : undefined;
}

function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps: number): boolean {
  const orient = (p: Vec2, q: Vec2, r: Vec2): number => {
    const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return Math.abs(v) <= eps ? 0 : Math.sign(v);
  };
  const within = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    Math.min(p.x, q.x) <= r.x + 1e-12 &&
    r.x <= Math.max(p.x, q.x) + 1e-12 &&
    Math.min(p.y, q.y) <= r.y + 1e-12 &&
    r.y <= Math.max(p.y, q.y) + 1e-12;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && within(a, b, c)) return true;
  if (o2 === 0 && within(a, b, d)) return true;
  if (o3 === 0 && within(c, d, a)) return true;
  if (o4 === 0 && within(c, d, b)) return true;
  return false;
}

/**
 * Which face of the ring `substituentId` sits on, at ring atom `atomId`.
 *
 * THE REFERENCE NORMAL is the right-hand normal of the DRAWN polygon walked in
 * canonical order: toward the viewer when that walk runs counter-clockwise on
 * the page, away when it runs clockwise. It is never the graph walk direction
 * alone, which rings.ts canonicalises for identity and which knows nothing
 * about the page. The walk order is fixed by the atoms and the winding by the
 * drawing, so `flipAtoms` (winding and marks both reversed) leaves the face
 * alone, while mirroring positions alone reverses it. `front` is the side the
 * normal points to.
 *
 * AT A FOUR-LIGAND RING ATOM (four single-bonded sigma ligands, at most one
 * of them an implicit hydrogen) the face comes from the same lift as the
 * atom's parity, over (previous ring atom, next ring atom, substituent, fourth
 * ligand) in walk order. Every mark at the atom votes, a wedge drawn on a RING
 * bond included, so ringFace and `stereoConfig` never disagree about whether
 * the drawing states the face, and the placement and ambiguity rules of
 * parity.ts apply unchanged. For an ideal tetrahedron that volume has the sign of
 * `((prev − A) × (next − A)) · (S − A)`, so the substituent is on the side of
 * the local ring normal the volume's sign says, and the local normal is
 * compared with the reference normal through the drawn turn at A. A straight
 * turn at A has no local normal and reads `ambiguous-geometry`.
 *
 * At any other ring atom (a double bond, a lone pair, two implicit
 * hydrogens) the substituent's depth comes from its own wedge or hash with the
 * ring atom at the narrow end, otherwise from the opposite of the ring atom's
 * other marked exocyclic bonds.
 *
 * A degenerate or self-intersecting polygon has no winding and is reported,
 * never divided by or read.
 */
export function ringFace(
  mol: Molecule,
  ringAtomIds: readonly AtomId[],
  atomId: AtomId,
  substituentId: AtomId,
): RingFace {
  const walk = canonicalRingWalk(mol, ringAtomIds);
  if (walk === undefined || !walk.includes(atomId)) {
    return { kind: "undetermined", reason: "not-a-ring" };
  }
  const ring = new Set(walk);
  const exocyclic = bondsAt(mol, atomId).filter((bond) => !ring.has(otherEnd(bond, atomId)));
  const own = exocyclic.find((bond) => otherEnd(bond, atomId) === substituentId);
  if (own === undefined) return { kind: "undetermined", reason: "not-a-substituent" };

  const points = walk.map((id) => requireAtom(mol, id).pos);
  const n = points.length;
  let twiceArea = 0;
  let longest = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    twiceArea += p.x * q.y - q.x * p.y;
    longest = Math.max(longest, Math.hypot(q.x - p.x, q.y - p.y));
  }
  const scale = longest * longest;
  if (!(scale > 0) || !(Math.abs(twiceArea) > 1e-6 * scale)) {
    return { kind: "undetermined", reason: "degenerate-polygon" };
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const c = points[j]!;
      const d = points[(j + 1) % n]!;
      if (segmentsTouch(a, b, c, d, 1e-9 * scale)) {
        return { kind: "undetermined", reason: "self-intersecting-polygon" };
      }
    }
  }

  if (exocyclic.some((bond) => bond.order === 1 && bond.from === atomId && bond.stereo === "wavy")) {
    return { kind: "undetermined", reason: "unspecified" };
  }
  const here = bondsAt(mol, atomId);
  const implicitHydrogens = implicitHydrogenCount(mol, atomId);
  if (
    implicitHydrogens <= 1 &&
    here.length + implicitHydrogens === 4 &&
    here.every((bond) => bond.order === 1)
  ) {
    const index = walk.indexOf(atomId);
    const previous = walk[(index + n - 1) % n]!;
    const next = walk[(index + 1) % n]!;
    const origin = points[index]!;
    const offsetTo = (id: AtomId): Vec2 => {
      const at = requireAtom(mol, id).pos;
      return { x: at.x - origin.x, y: at.y - origin.y };
    };
    const byNeighbour = bondsByNeighbour(mol, atomId);
    const drawn = (id: AtomId): LiftLigand => ({
      kind: "drawn",
      offset: offsetTo(id),
      depth: markAt(byNeighbour.get(id)!, atomId),
    });
    const fourth = exocyclic.find((bond) => bond !== own);
    const lifted = liftParity([
      drawn(previous),
      drawn(next),
      drawn(substituentId),
      fourth === undefined ? { kind: "implicit" } : drawn(otherEnd(fourth, atomId)),
    ], { refuseOpposedMarks: true });
    if (lifted.kind === "flat") return { kind: "undetermined", reason: "no-stereo-bond" };
    if (lifted.kind === "ambiguous") return { kind: "undetermined", reason: "ambiguous-geometry" };
    const p = offsetTo(previous);
    const q = offsetTo(next);
    const turn = p.x * q.y - p.y * q.x;
    if (!(Math.abs(turn) > 1e-6 * Math.hypot(p.x, p.y) * Math.hypot(q.x, q.y))) {
      return { kind: "undetermined", reason: "ambiguous-geometry" };
    }
    return lifted.parity * Math.sign(turn) * Math.sign(twiceArea) > 0
      ? { kind: "front" }
      : { kind: "back" };
  }

  let z = markAt(own, atomId);
  if (z === 0) {
    let others = 0;
    let marked = 0;
    for (const bond of exocyclic) {
      if (bond === own) continue;
      const mark = markAt(bond, atomId);
      others += mark;
      if (mark !== 0) marked++;
    }
    if (marked === 0) return { kind: "undetermined", reason: "no-stereo-bond" };
    if (others === 0) return { kind: "undetermined", reason: "ambiguous-geometry" };
    z = -Math.sign(others);
  }
  return Math.sign(twiceArea) * z > 0 ? { kind: "front" } : { kind: "back" };
}
