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
 * parity.ts, which stereo.ts's `chiralityFrom` calls too (decision 28). The
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
 * PHANTOM LONE-PAIR CENTRES are three-coordinate atoms whose lone pair is a
 * configurationally stable fourth ligand. It ranks lowest, below hydrogen, so
 * they are not dismissed for want of a fourth neighbour id. Exactly these,
 * decided STRUCTURALLY:
 *
 *   sulfoxide S    neutral, three neighbours, one of them =O, no hydrogen
 *   sulfonium S+   charge +1, three single bonds, no hydrogen (this includes
 *                  the charge-separated S+–O− drawing of a sulfoxide)
 *   P(III)         neutral phosphorus with three single-bonded ligands
 *   nitrogen       neutral, three single bonds, no hydrogen, NOT aromatic and
 *                  NOT conjugated, and either in a three-membered ring
 *                  (aziridine) or a BRIDGED bridgehead (decision 30)
 *
 * The nitrogen rule matches RDKit 2025.03's `get_stereo_tags`, the
 * import/export oracle, so a nitrogen centre neither appears nor vanishes
 * across a round trip. Its terms, precisely:
 *
 *   BRIDGED BRIDGEHEAD  all three bonds are ring bonds, and two perceived rings
 *                       (rings.ts's symmetrised SSSR, the set RDKit uses) share
 *                       TWO OR MORE bonds, at least one of them a bond of this
 *                       nitrogen. RDKit's `queryIsAtomBridgehead` is the same
 *                       test. 1-azabicyclo[3.2.1]octane's N qualifies: its five-
 *                       and six-membered rings share the two bonds of the
 *                       one-carbon bridge. A FUSED bridgehead does not: the two
 *                       rings of 1-methylpyrrolizidine or indolizidine share
 *                       one bond, and such a nitrogen inverts.
 *   CONJUGATED          a neighbour is aromatic, or carries a double or triple
 *                       bond, unless that neighbour is S or P. This excludes
 *                       amides (a fused beta-lactam, penicillin's N4, a bridged
 *                       2-quinuclidone), enamines, N-aryl, N-nitroso and
 *                       N-cyano. A sulfonyl, sulfinyl or phosphoryl neighbour
 *                       does not conjugate in RDKit's model, and an
 *                       N-tosylaziridine keeps its centre there too.
 *   AROMATIC            a member of a perceived aromatic ring (indolizine,
 *                       imidazo[1,2-a]pyridine), which is planar.
 *
 * EXCLUDED: plain acyclic amines, fused bridgehead amines, NH aziridines, and
 * carbanions. A QUATERNARY AMMONIUM N+ is not a phantom centre at all. It has
 * four ligands and no lone pair, and it is read as an ordinary four-ligand
 * centre. `lonePairCount` is consulted as a sanity check only. A PINNED
 * lone-pair count is a display override (types.ts) and can neither create nor
 * remove a centre.
 *
 * FOUR-COORDINATE P AND S WITH A DOUBLE BOND are four-ligand centres
 * (decision 31): phosphine oxides, phosphonates, phosphates and
 * phosphoramidates (P with one double bond to O, S or N and three other
 * sigma ligands), and sulfoximines (S with double bonds to O and N and two
 * other ligands). The doubly bonded atom counts once. Their parity is read like
 * any four-ligand centre, and the ranking decides stereogenicity, so a sulfone
 * or a symmetric phosphate is not a centre. Their CIP letters are NOT issued
 * here: `descriptorFromConfig` reports `ranking-unsupported` for them until
 * the CIP task settles how a P=O or S=O is duplicated. A phosphorus ylide
 * (P=C) is not in the list.
 *
 * THE SAME QUESTION REACHES A SULFINYL CENTRE, but not always. A lone-pair
 * centre drawn with S=O is ranked twice: as drawn, where the duplicate S on
 * the oxygen counts, and with every double bond at the centre written
 * charge-separated (S+–O−), where it does not. The letter is issued only when
 * both orders agree. Methyl p-tolyl sulfoxide agrees (rule 1 settles O, aryl
 * C, methyl C before a duplicate is compared) and keeps its letter. Methyl
 * methanesulfinate does not: drawn S=O the oxo outranks OMe, drawn S+–O− OMe
 * outranks O−, so one molecule would get two letters, and the S=O drawing
 * reports `ranking-unsupported`. The sulfinate anion's oxygens are one ligand
 * charge-separated and it refuses too. A centre already drawn charge-separated
 * has no duplicate to disagree about and is ranked as drawn.
 *
 * DEFERRED to cip-ranking-refusals-and-enhanced-stereo (decision 32):
 * pseudoasymmetric centres, ring cis/trans at constitutionally symmetric
 * centres (1,4-disubstituted cyclohexanes), and C=N / N=N units. Their absence
 * here is a known limit, not a statement about the chemistry.
 *
 * AN EXPLICIT PROTIUM ATOM IS AN IMPLICIT HYDROGEN for ranking. Two of them on
 * one carbon make it non-stereogenic however they are drawn. Deuterium and
 * tritium differ by mass number, so CH3–CHD–OH is a stereocentre. (stereo.ts
 * ranks an implicit H below an explicit protium atom and so reports a false
 * centre for CH3–CH(H)–OH drawn with one H explicit; that is left for the CIP
 * rewrite that owns stereo.ts.)
 *
 * CACHING (decision 19), split by what each half reads:
 *
 *   TOPOLOGY means which units are stereogenic, their ligand orders, their
 *   reference atoms and their CIP rankings. It is memoised on a topology
 *   fingerprint in the two-level shape rings.ts and aromatic.ts use, so a drag
 *   reuses it. The key REFINES the ring fingerprint with element, charge,
 *   isotope, radicals, hydrogen and lone-pair pins, bond orders and aromatic
 *   flags, because the ring key alone would keep a stale stereogenic set after
 *   C→N or single→double. Positions, `stereo` and `doubleBondSide` are out.
 *
 *   PARITY, read from positions and marks, is memoised per MOLECULE INSTANCE
 *   in a WeakMap as stereo.ts does. A parity cached on the topology key would
 *   survive the drag that reversed it.
 */

import { isAromaticAtom } from "./aromatic.js";
import { lonePairCount } from "./lewis.js";
import { bondsAt, getAtom, otherEnd, requireAtom, requireBond } from "./molecule.js";
import { updateAtom, updateBond } from "./ops.js";
import {
  liftParity,
  pointsParity,
  PSEUDO_3D_DEPTH,
  type LiftedPoint,
  type LiftLigand,
  type LiftOutcome,
  type TetrahedralParity,
} from "./parity.js";
import { isRingBond, LruCache, rings, ringsAtAtom, ringSize } from "./rings.js";
import { compareIds } from "./selection.js";
import {
  rankLigandPair,
  stereogenicBonds,
  type LigandPairOrder,
  type UndeterminedReason,
} from "./stereo.js";
import type { AtomId, Bond, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import type { Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One ligand of a centre: a real neighbour, the implicit H, or the lone pair. */
export type LigandRef =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "implicitHydrogen" }
  | { readonly kind: "lonePair" };

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
 *                  under fischer or haworth, a centre outside the Haworth ring.
 *
 * The rest are stereo.ts's reasons, with stereo.ts's meanings.
 */
export type ConfigUndeterminedReason = UndeterminedReason | "coplanar" | "not-covered";

export type CentreReading =
  | { readonly kind: "specified"; readonly parity: TetrahedralParity }
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
}

/** The position-independent half of a `StereoConfig`. */
export interface StereoTopology {
  readonly centres: readonly CentreLigands[];
  readonly doubleBonds: readonly DoubleBondTopology[];
}

/** How a placement encodes depth. See the module header. */
export type DepthConvention =
  | { readonly kind: "wedgeHash" }
  | { readonly kind: "fischer" }
  | { readonly kind: "haworth"; readonly ringAtomIds: readonly AtomId[] }
  | { readonly kind: "pseudo3d"; readonly depth: Readonly<Record<AtomId, number>> };

/**
 * A molecule and where its atoms are drawn. `positions` overrides `atom.pos`
 * per atom, so a projection layout can be read without writing it into the
 * model. Atoms it omits keep their own positions. Marks always come from the
 * molecule's bonds.
 */
export interface Placement {
  readonly mol: Molecule;
  readonly positions?: Readonly<Record<AtomId, Vec2>> | undefined;
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

type AtomLigand = { readonly kind: "atom"; readonly atomId: AtomId; readonly bondId: BondId };
type Ligand = AtomLigand | { readonly kind: "implicitHydrogen" } | { readonly kind: "lonePair" };

type Ranking =
  | { readonly kind: "ranked"; readonly order: readonly LigandRef[] }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

interface TopologyRecord {
  readonly topology: StereoTopology;
  readonly centresById: ReadonlyMap<AtomId, CentreLigands>;
  /** CIP priority, highest first. Topology-only, so it lives in this cache. */
  readonly rankings: ReadonlyMap<AtomId, Ranking>;
}

/**
 * An explicit hydrogen atom that is chemically an implicit one: natural
 * isotope, uncharged, not a radical, bonded to nothing but its one neighbour.
 */
function isProtiumAtom(mol: Molecule, atomId: AtomId): boolean {
  const atom = getAtom(mol, atomId);
  if (atom === undefined || atom.element !== "H") return false;
  if (atom.isotope !== undefined && atom.isotope !== 1) return false;
  if (atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  if (implicitHydrogenCount(mol, atomId) !== 0) return false;
  return bondsAt(mol, atomId).length === 1;
}

function isHydrogenLike(mol: Molecule, ligand: Ligand): boolean {
  if (ligand.kind === "implicitHydrogen") return true;
  return ligand.kind === "atom" && isProtiumAtom(mol, ligand.atomId);
}

/**
 * CIP order of two ligands. The two cases stereo.ts's digraph does not know
 * about come first: the lone pair ranks below everything (atomic number 0),
 * and an explicit protium atom is the same ligand as an implicit hydrogen.
 */
function compareLigands(
  mol: Molecule,
  centre: AtomId,
  a: Ligand,
  b: Ligand,
): LigandPairOrder {
  if (a.kind === "lonePair" && b.kind === "lonePair") return { kind: "identical" };
  if (a.kind === "lonePair") return { kind: "ordered", aFirst: false };
  if (b.kind === "lonePair") return { kind: "ordered", aFirst: true };

  const aH = isHydrogenLike(mol, a);
  const bH = isHydrogenLike(mol, b);
  if (aH && bH) return { kind: "identical" };
  if (aH || bH) {
    const other = (aH ? b : a) as AtomLigand;
    const atom = requireAtom(mol, other.atomId);
    // A heavier element outranks hydrogen on rule 1, and deuterium or tritium
    // outranks protium on rule 2 (mass number). Any other atomic-number-1
    // ligand is a charged or radical hydrogen this module will not order.
    if (atom.element === "H" && !(atom.isotope !== undefined && atom.isotope > 1)) {
      return { kind: "undetermined", reason: "ranking-unsupported" };
    }
    return { kind: "ordered", aFirst: !aH };
  }
  return rankLigandPair(mol, centre, a as AtomLigand, b as AtomLigand);
}

/**
 * A neighbour that is aromatic, or that carries a multiple bond, conjugates
 * with the nitrogen's lone pair and flattens it. S and P neighbours are the
 * exception, as in RDKit: a sulfonyl or phosphoryl group does not conjugate.
 */
function isConjugatedNitrogen(mol: Molecule, atomId: AtomId, bonds: readonly Bond[]): boolean {
  for (const bond of bonds) {
    const neighbour = otherEnd(bond, atomId);
    if (isAromaticAtom(mol, neighbour)) return true;
    const element = requireAtom(mol, neighbour).element;
    if (element === "S" || element === "P") continue;
    if (bondsAt(mol, neighbour).some((other) => other.order > 1)) return true;
  }
  return false;
}

function inThreeMemberedRing(mol: Molecule, atomId: AtomId): boolean {
  return ringsAtAtom(mol, atomId).some((index) => ringSize(mol, index) === 3);
}

/**
 * RDKit's `queryIsAtomBridgehead`: every bond a ring bond, and two perceived
 * rings sharing two or more bonds, one of which is a bond of this atom. Rings
 * that share exactly one bond are FUSED, and their shared atoms are not
 * bridgeheads in this sense.
 */
function isBridgedBridgehead(mol: Molecule, atomId: AtomId, bonds: readonly Bond[]): boolean {
  if (!bonds.every((bond) => isRingBond(mol, bond.id))) return false;
  const own = new Set(bonds.map((bond) => bond.id));
  const all = rings(mol);
  const mine = ringsAtAtom(mol, atomId);
  for (let i = 0; i < mine.length; i++) {
    const first = new Set(all[mine[i]!]!.bondIds);
    for (let j = i + 1; j < mine.length; j++) {
      const shared = all[mine[j]!]!.bondIds.filter((id) => first.has(id));
      if (shared.length >= 2 && shared.some((id) => own.has(id))) return true;
    }
  }
  return false;
}

/**
 * A four-coordinate P or S whose sigma ligands include a doubly bonded
 * heteroatom (decision 31): P with exactly one double bond, to O, S or N;
 * S with exactly two, one to O and one to N or both to O (a sulfone, which the
 * ranking then drops as two identical ligands). Neutral only.
 */
function isMultiplyBondedFourLigandCentre(
  mol: Molecule,
  atomId: AtomId,
  bonds: readonly Bond[],
  implicitHydrogens: number,
): boolean {
  const atom = requireAtom(mol, atomId);
  if (atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  if (bonds.length + implicitHydrogens !== 4) return false;
  if (bonds.some((bond) => bond.order !== 1 && bond.order !== 2)) return false;
  const doubles = bonds.filter((bond) => bond.order === 2);
  const partners = doubles.map((bond) => requireAtom(mol, otherEnd(bond, atomId)).element);
  if (atom.element === "P") {
    return doubles.length === 1 && ["O", "S", "N"].includes(partners[0]!);
  }
  if (atom.element === "S") {
    return (
      doubles.length === 2 &&
      implicitHydrogens === 0 &&
      partners.includes("O") &&
      partners.every((element) => element === "O" || element === "N")
    );
  }
  return false;
}

/**
 * The three-coordinate atoms whose lone pair is a configurationally stable
 * fourth ligand. The module header lists them and what they exclude.
 */
function isPhantomLonePairCentre(
  mol: Molecule,
  atomId: AtomId,
  bonds: readonly Bond[],
  implicitHydrogens: number,
): boolean {
  const atom = requireAtom(mol, atomId);
  if (atom.radicalElectrons !== 0) return false;
  if (bonds.length + implicitHydrogens !== 3) return false;
  const allSingle = bonds.every((bond) => bond.order === 1);
  const hasHydrogen =
    implicitHydrogens > 0 || bonds.some((bond) => isProtiumAtom(mol, otherEnd(bond, atomId)));

  let structural = false;
  if (atom.element === "S" && atom.charge === 0) {
    const doubles = bonds.filter((bond) => bond.order === 2);
    const singles = bonds.filter((bond) => bond.order === 1);
    structural =
      bonds.length === 3 &&
      doubles.length === 1 &&
      singles.length === 2 &&
      requireAtom(mol, otherEnd(doubles[0]!, atomId)).element === "O" &&
      !hasHydrogen;
  } else if (atom.element === "S" && atom.charge === 1) {
    structural = allSingle && !hasHydrogen;
  } else if (atom.element === "P" && atom.charge === 0) {
    structural = allSingle;
  } else if (atom.element === "N" && atom.charge === 0) {
    structural =
      allSingle &&
      !hasHydrogen &&
      bonds.length === 3 &&
      !isAromaticAtom(mol, atomId) &&
      !isConjugatedNitrogen(mol, atomId, bonds) &&
      (inThreeMemberedRing(mol, atomId) || isBridgedBridgehead(mol, atomId, bonds));
  }
  if (!structural) return false;

  // A sanity check against the electron count. A pin is display-only and gets
  // no vote; the structural test above already fixes the real count at one.
  const pairs = lonePairCount(mol, atomId);
  if (pairs.kind === "unknown") return false;
  return pairs.kind === "pinned" || pairs.pairs >= 1;
}

/**
 * `mol` with every multiple bond at `centre` written as a charge-separated
 * single bond: order 1, the centre's charge raised and the partner's lowered
 * by the orders removed. Ids are untouched, so ligand records still apply.
 * Only ever used for ranking, never returned.
 */
function chargeSeparatedAt(mol: Molecule, centre: AtomId): Molecule {
  let out = mol;
  for (const bond of bondsAt(mol, centre)) {
    const shift = bond.order - 1;
    if (shift === 0) continue;
    const partner = otherEnd(bond, centre);
    out = updateBond(out, bond.id, { order: 1 });
    out = updateAtom(out, centre, { charge: requireAtom(out, centre).charge + shift });
    out = updateAtom(out, partner, { charge: requireAtom(out, partner).charge - shift });
  }
  return out;
}

function sameRanking(a: Ranking | "not-stereogenic", b: Ranking | "not-stereogenic"): boolean {
  if (a === "not-stereogenic" || b === "not-stereogenic") return a === b;
  if (a.kind !== "ranked" || b.kind !== "ranked") return false;
  return a.order.length === b.order.length && a.order.every((ref, i) => sameRef(ref, b.order[i]!));
}

/**
 * Pairwise ranking of a centre's ligands. Every pair is compared, so an
 * `identical` pair anywhere proves the atom non-stereogenic even when some
 * other pair could not be ordered.
 */
function rankCentre(
  mol: Molecule,
  centre: AtomId,
  ligands: readonly Ligand[],
): Ranking | "not-stereogenic" {
  const wins = ligands.map(() => 0);
  let undetermined: UndeterminedReason | undefined;
  for (let i = 0; i < ligands.length; i++) {
    for (let j = i + 1; j < ligands.length; j++) {
      const order = compareLigands(mol, centre, ligands[i]!, ligands[j]!);
      if (order.kind === "identical") return "not-stereogenic";
      if (order.kind === "undetermined") {
        undetermined ??= order.reason;
        continue;
      }
      const winner = order.aFirst ? i : j;
      wins[winner] = wins[winner]! + 1;
    }
  }
  if (undetermined !== undefined) return { kind: "undetermined", reason: undetermined };
  const indices = [...ligands.keys()].sort((x, y) => wins[y]! - wins[x]!);
  return {
    kind: "ranked",
    order: Object.freeze(
      indices.map((index): LigandRef => {
        const ligand = ligands[index]!;
        return ligand.kind === "atom" ? { kind: "atom", atomId: ligand.atomId } : ligand;
      }),
    ),
  };
}

/**
 * The reference atom at one end of a stereogenic double bond, or undefined when
 * that end is not stereogenic after all.
 *
 * stereo.ts ranks an implicit hydrogen below an explicit protium atom, so it
 * reports `=CH2` drawn with one hydrogen explicit as stereogenic. Such an end
 * carries two hydrogens and is dropped here.
 */
function endReference(mol: Molecule, atomId: AtomId, doubleBondId: BondId): AtomId | undefined {
  const others = bondsAt(mol, atomId)
    .filter((bond) => bond.id !== doubleBondId)
    .map((bond) => otherEnd(bond, atomId))
    .sort(compareIds);
  if (others.length === 0) return undefined;
  const hydrogens =
    implicitHydrogenCount(mol, atomId) + others.filter((id) => isProtiumAtom(mol, id)).length;
  if (hydrogens >= 2) return undefined;
  return others[0];
}

function computeTopology(mol: Molecule): TopologyRecord {
  const centres: CentreLigands[] = [];
  const rankings = new Map<AtomId, Ranking>();

  for (const atomId of [...mol.atomIds].sort(compareIds)) {
    const bonds = bondsAt(mol, atomId);
    const implicitHydrogens = implicitHydrogenCount(mol, atomId);
    if (implicitHydrogens > 1) continue;

    let lonePair: boolean;
    if (bonds.length + implicitHydrogens === 4 && bonds.every((bond) => bond.order === 1)) {
      lonePair = false;
    } else if (isMultiplyBondedFourLigandCentre(mol, atomId, bonds, implicitHydrogens)) {
      lonePair = false;
    } else if (isPhantomLonePairCentre(mol, atomId, bonds, implicitHydrogens)) {
      lonePair = true;
    } else {
      continue;
    }

    // The neighbour id and its bond travel together in one record and are
    // sorted once, so no second, parallel list can end up in another order.
    const explicit: AtomLigand[] = bonds
      .map((bond): AtomLigand => ({ kind: "atom", atomId: otherEnd(bond, atomId), bondId: bond.id }))
      .sort((x, y) => compareIds(x.atomId, y.atomId));
    const ligands: Ligand[] = [...explicit];
    if (implicitHydrogens === 1) ligands.push({ kind: "implicitHydrogen" });
    if (lonePair) ligands.push({ kind: "lonePair" });

    let ranking = rankCentre(mol, atomId, ligands);
    if (ranking === "not-stereogenic") continue;
    // A sulfinyl letter must not depend on S=O versus S+–O− (module header).
    if (
      lonePair &&
      ranking.kind === "ranked" &&
      bonds.some((bond) => bond.order !== 1) &&
      !sameRanking(ranking, rankCentre(chargeSeparatedAt(mol, atomId), atomId, ligands))
    ) {
      ranking = { kind: "undetermined", reason: "ranking-unsupported" };
    }

    centres.push(
      Object.freeze({
        atomId,
        order: Object.freeze(explicit.map((ligand) => ligand.atomId)),
        implicitHydrogen: implicitHydrogens === 1,
        lonePair,
      }),
    );
    rankings.set(atomId, ranking);
  }

  const doubleBonds: DoubleBondTopology[] = [];
  for (const bondId of [...stereogenicBonds(mol)].sort(compareIds)) {
    const bond = requireBond(mol, bondId);
    const refOnFrom = endReference(mol, bond.from, bondId);
    const refOnTo = endReference(mol, bond.to, bondId);
    if (refOnFrom === undefined || refOnTo === undefined) continue;
    doubleBonds.push(Object.freeze({ bondId, refOnFrom, refOnTo }));
  }

  return {
    topology: Object.freeze({
      centres: Object.freeze(centres),
      doubleBonds: Object.freeze(doubleBonds),
    }),
    centresById: new Map(centres.map((centre) => [centre.atomId, centre])),
    rankings,
  };
}

/** NUL cannot occur in an id, so the encoding stays injective (as rings.ts). */
const SEP = "\u0000";

/** Bumped if the fingerprint contents change, so an old entry never matches. */
const STEREO_TOPOLOGY_FINGERPRINT_VERSION = "S1";

/**
 * Everything the topology half reads, and nothing it does not: a strict
 * refinement of rings.ts's key, built in one pass like `aromaticFingerprint`.
 */
function stereoTopologyFingerprint(mol: Molecule): string {
  const parts: string[] = [STEREO_TOPOLOGY_FINGERPRINT_VERSION];
  for (const id of mol.atomIds) {
    const atom = mol.atoms[id];
    if (!atom) continue;
    parts.push(
      id,
      atom.element,
      String(atom.charge),
      String(atom.radicalElectrons),
      atom.isotope === undefined ? "" : String(atom.isotope),
      atom.explicitHydrogenCount === undefined ? "" : String(atom.explicitHydrogenCount),
      atom.lonePairs === undefined ? "" : String(atom.lonePairs),
      atom.aromatic ? "1" : "0",
    );
  }
  parts.push("|");
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id];
    if (!bond) continue;
    parts.push(id, bond.from, bond.to, String(bond.order), bond.aromatic ? "1" : "0");
  }
  return parts.join(SEP);
}

const TOPOLOGY_BY_INSTANCE = new WeakMap<Molecule, TopologyRecord>();
const TOPOLOGY_BY_FINGERPRINT = new LruCache<TopologyRecord>(32);
let topologyComputations = 0;

function topologyRecord(mol: Molecule): TopologyRecord {
  const hit = TOPOLOGY_BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = stereoTopologyFingerprint(mol);
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

/** +1 toward, −1 away, 0 silent. Narrow end only, single bonds only. */
function markAt(bond: Bond, centre: AtomId): number {
  if (bond.order !== 1 || bond.from !== centre) return 0;
  if (bond.stereo === "wedge") return 1;
  if (bond.stereo === "hash") return -1;
  return 0;
}

function hasWavyAt(mol: Molecule, atomId: AtomId): boolean {
  return bondsAt(mol, atomId).some(
    (bond) => bond.order === 1 && bond.from === atomId && bond.stereo === "wavy",
  );
}

function implicitCount(centre: CentreLigands): number {
  return (centre.implicitHydrogen ? 1 : 0) + (centre.lonePair ? 1 : 0);
}

/**
 * wedgeHash and pseudo3d: raw offsets and a depth sign per explicit ligand,
 * handed to parity.ts with the implicit ligands, which places them and
 * applies the ambiguity guard. Returns the reading directly.
 */
function readDrawn(
  ctx: ReadContext,
  centre: CentreLigands,
  depthOf: (neighbour: AtomId, bond: Bond) => number,
  silentReason: ConfigUndeterminedReason,
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
  for (let k = 0; k < implicitCount(centre); k++) ligands.push({ kind: "implicit" });
  return fromLift(liftParity(ligands), silentReason);
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
  if (ambiguous) return { kind: "undetermined", reason: "ambiguous-geometry" };
  const implicit = implicitCount(centre);
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
  if (ambiguous) return { kind: "undetermined", reason: "ambiguous-geometry" };
  const implicit = implicitCount(centre);
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
      lift = readDrawn(ctx, centre, (_, bond) => markAt(bond, centre.atomId), "no-stereo-bond");
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
  if (hasWavyAt(ctx.mol, centre.atomId)) return { kind: "undetermined", reason: "unspecified" };
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
  if (bond.stereo === "either") return { kind: "undetermined", reason: "unspecified" };
  if (hasWavyAt(ctx.mol, bond.from) || hasWavyAt(ctx.mol, bond.to)) {
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

function computeRead(ctx: ReadContext, convention: DepthConvention): ConfigRead {
  const { topology } = topologyRecord(ctx.mol);

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
      Object.freeze({ ...unit, reading: Object.freeze(readDoubleBond(ctx, unit, convention)) }),
  );
  return Object.freeze({
    kind: "read",
    config: Object.freeze({
      centres: Object.freeze(centres),
      doubleBonds: Object.freeze(doubleBonds),
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
 */
export function readConfig(placement: Placement, convention: DepthConvention): ConfigRead {
  const mol = placement.mol;
  const cacheable =
    placement.positions === undefined &&
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
  const result = computeRead({ mol, positions: placement.positions }, convention);
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
 * R or S for `centre`, from its parity and the CIP ranking stereo.ts computes,
 * with the lone pair lowest and an explicit protium atom equal to an implicit
 * hydrogen. Undefined when the atom is not a stereocentre of `mol`.
 *
 * Throws when `centre` lists different ligands from `mol`'s own topology: a
 * config from another molecule would otherwise be ranked against the wrong
 * neighbours and come back with a confident letter.
 */
export function descriptorFromConfig(
  mol: Molecule,
  centre: CentreConfig,
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
  if (centre.reading.kind === "undetermined") {
    return { kind: "undetermined", reason: centre.reading.reason };
  }
  // A four-coordinate P=O, P=S, P=N or sulfoximine centre (decision 31). Its
  // parity is real, but whether its double bond is duplicated or read as a
  // charge-separated single bond decides the letter, and that is the CIP task's
  // ruling to make, not a default to slip in here.
  if (!centre.lonePair && bondsAt(mol, centre.atomId).some((bond) => bond.order !== 1)) {
    return { kind: "undetermined", reason: "ranking-unsupported" };
  }
  const ranking = record.rankings.get(centre.atomId);
  if (ranking === undefined) return undefined;
  if (ranking.kind === "undetermined") return { kind: "undetermined", reason: ranking.reason };
  const parity = parityAgainst(centre, ranking.order);
  if (parity === undefined) return undefined;
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
    ]);
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
