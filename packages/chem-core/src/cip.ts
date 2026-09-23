/**
 * CIP ranking: which ligands of a stereogenic unit outrank which, by the
 * Sequence Rules of the IUPAC 2013 recommendations (P-92), and which atoms
 * and double bonds are stereogenic units at all.
 *
 * stereo.ts (letters from a wedge drawing) and stereo-config.ts (letters from
 * a coordinate-free configuration) both rank through this module, so the two
 * readers cannot disagree about a priority or about which atoms are centres.
 * This module never reads a coordinate or a wedge. Where a rule needs a
 * configuration (rules 3 to 5), the caller hands one in as a
 * `CipConfiguration`.
 *
 * REFUSE RATHER THAN GUESS (decision 48). A comparison this module cannot
 * prove comes back undetermined with its reason, never as a letter. That is
 * why every rule below names what it refuses.
 *
 * WHAT IS IMPLEMENTED
 *
 *   THE HIERARCHICAL DIGRAPH (P-92.1.4). Rooted at the stereogenic atom (for a
 *   double bond, at `bond.from`). Every other atom enters once per simple path.
 *   A bond of order n adds n−1 duplicate atoms at both of its ends. A ring
 *   closure ends in a duplicate of the atom already on the path. A duplicate
 *   has no substituents; the phantoms that pad a short sphere have atomic
 *   number 0, and so does the phantom lone pair of a sulfoxide, sulfilimine,
 *   selenoxide, P(III), As(III) or aziridine/bridgehead nitrogen centre.
 *
 *   NO DUPLICATES AT THE ROOT (decision 47). A multiple bond incident to the
 *   stereogenic atom itself is not duplicated at either end. Cited from the
 *   2013 text (https://iupac.qmul.ac.uk/BlueBook/P9.html), read, not recalled:
 *     - P-93.2.4: "The 'P=O' bond, as conventionally written in phosphates,
 *       phosphonates and related compounds, is considered as a single bond,
 *       as there are already four atoms or groups in the tetrahedral
 *       configuration. Similarly, the formal arrangement of charges is not
 *       considered when determining the configuration of a chiral molecule."
 *     - P-93.2.5: sulfates, sulfonates and related anions "are treated in the
 *       same way as phosphate anions"; selenates and tellurates likewise.
 *     - P-93.2.3: in phosphane oxides "the oxygen atom is treated as the
 *       fourth atom. The nature of the bonding to this oxygen atom is not
 *       relevant."
 *     - P-93.3.4.1: a trigonal pyramidal centre takes "a phantom atom of low
 *       priority, and not a pair of electrons". Its figure for ethyl
 *       (R)-4-nitrobenzene-1-sulfinate ranks OEt above =O, which holds only
 *       without a duplicate S on the oxygen; P-93.2.4's methyl
 *       phenylphosphinate figure ranks OMe above =O the same way.
 *   RDKit's CIPLabeler (`Digraph::expand`, "duplicate nodes for bond orders
 *   (except for root atoms...) for example >S=O") does the same. S=O and
 *   S⁺–O⁻ drawings of one sulfoxide therefore rank alike by construction
 *   (decision 43's sulfinyl rule).
 *
 *   HYPERVALENT DOUBLE BONDS AWAY FROM THE ROOT are not addressed by that text
 *   in digraph terms, and RDKit duplicates them as drawn, so its letter can
 *   depend on whether a branch P=O was drawn P⁺–O⁻. Every molecule carrying a
 *   double bond at a neutral P, As, S, Se or Te above its lowest valence is
 *   therefore ranked twice, as drawn and with each such bond written
 *   charge-separated, and a ranking the two forms disagree on is
 *   `ranking-unsupported` (escalated).
 *
 *   RULE 1a, atomic number, SPHERE BY SPHERE (P-92.1.5): the whole of sphere n
 *   is compared before anything in sphere n+1, and within a sphere the atoms
 *   are taken in the order their branches rank. Depth-first is the classic
 *   mistake; it returns the enantiomer's letter on most ring centres.
 *   A duplicate on a mancude (perceived aromatic) ring bond takes the MEAN
 *   atomic number of its bearer's double-bond partner over every Kekulé
 *   structure of the ring system (P-92.1.4.4), found by enumerating perfect
 *   matchings, so a letter never depends on which Kekulé form was drawn. A
 *   system with more than `MAX_KEKULE_STRUCTURES` structures, or with a
 *   charged atom outside the matching (cyclopentadienide, whose IUPAC mean
 *   counts the anion's pair), gives its duplicates no number, and a comparison
 *   that reaches one is `ranking-unsupported`.
 *
 *   RULE 1b, duplicates by distance. IUPAC 2013 (P-92.1.3.1(b)) ranks any
 *   duplicate whose original is nearer the root higher. Hanson et al. (J.
 *   Chem. Inf. Model. 2018, 58, 1755) and RDKit apply the distance rule only
 *   between ring-closure duplicates and rank a ring-closure duplicate above
 *   any other node. Both are computed where a duplicate reaches rule 1b; a
 *   ranking they disagree on is `ranking-unsupported`. In the IUPAC reading a
 *   mancude duplicate takes part in no distance order: where it sits is a
 *   Kekulé artefact, and ordering on it ranked toluene's two ortho branches
 *   apart.
 *
 *   RULE 2, mass number (P-92.3: "81Br > Br > 79Br"). An unlabelled atom ranks
 *   at its standard atomic weight, a labelled one at its mass number, and 1H
 *   is H. A labelled atom within 0.5 of the standard weight (12C against C,
 *   127I against I) is not ordered against an unlabelled one, and a duplicate
 *   of a labelled atom is not ordered at all (IUPAC gives it its original's
 *   mass, RDKit none): both `ranking-unsupported`.
 *
 *   FORMAL CHARGE is not a CIP criterion. Two branches that tie on rules 1
 *   and 2 and differ in charge are neither ordered nor identical:
 *   `ranking-unsupported`. That is the phosphate diester anion's =O against
 *   O⁻, listed as a centre with no letter (decision 43, escalated).
 *
 *   RULES 3 TO 5 need a configuration. Auxiliary descriptors are assigned
 *   INSIDE the digraph (P-92.4.2.2, "considering the ligands as they appear in
 *   the digraph"): a stereogenic atom met at node N is ranked over N's
 *   neighbours in the digraph re-rooted at N, and its parity comes from the
 *   caller's `CipConfiguration`. A double bond's auxiliary descriptor sits on
 *   its end nearer the root.
 *     Rule 3   seqcis (Z) > seqtrans (E) > anything else.
 *     Rule 4a  chiral (R, S) > pseudoasymmetric (r, s) and E/Z > none.
 *     Rule 4b  like before unlike (P-92.5.2.1, Mata and Lobo). Each ligand's
 *              reference descriptor is that of its highest-ranked R/S node,
 *              or the majority among equally ranked highest ones (criterion
 *              (b)); an even split (criterion (c)) is refused. Each R/S node
 *              is keyed like or unlike its ligand's reference, and the
 *              branches are compared sphere by sphere with likes sorted first.
 *     Rule 4c  r > s.
 *     Rule 5   R > S. A centre whose ranking needed rule 5 for exactly one
 *              pair is PSEUDOASYMMETRIC and gets lowercase r or s. Two pairs
 *              decided by rule 5 are refused. A double bond whose end needed
 *              rule 5 would be seqCis/seqTrans, and is refused (E12).
 *   Two refusals keep the auxiliary assignment finite and independent of
 *   evaluation order: a rule 3-5 comparison that reaches a node through its
 *   PARENT side (back toward the root) is `ranking-unsupported`, and so is a
 *   rule 1b decision between the ligands of a re-rooted node, where distance
 *   from the root and distance from the node disagree.
 *
 * DEPTH (decision 22). At most `MAX_SPHERES` (64) spheres, and at most
 * `MAX_BRANCH_NODES` (20000) digraph nodes materialised per pairwise
 * comparison, auxiliary descriptors included. Two branches still tied at
 * either cap are `ranking-truncated`, never identical and never approximated.
 *
 * WHICH UNITS ARE STEREOGENIC. A centre whose ligands rank pairwise distinct
 * under rules 1-2 is a unit. A centre with two constitutionally identical
 * ligands is a unit only if those branches reach another unit (the
 * pseudoasymmetric C3 of a pentitol, both ring carbons of a
 * 1,4-dimethylcyclohexane). This is iterated to the greatest fixed point, as
 * RDKit's potential-stereo perception does, so two centres that make only each
 * other stereogenic both stay. Three or more identical ligands, or two
 * hydrogens or lone pairs, never make a unit. Whether such a "tied" unit is
 * stereogenic in a given configuration is decided with that configuration by
 * `rankStereoCentre`. An explicit protium atom is the same ligand as an
 * implicit hydrogen.
 *
 * The centre classes (four single-bonded ligands, phantom lone-pair atoms,
 * four-coordinate P/S with a double bond) are stereo-config.ts's, widened by
 * decision 43 to a phosphorus ylide P=C, a sulfilimine S=N, a selenoxide Se=O
 * and an arsine As(III). The double-bond units are C=C, C=N and N=N (both ends C or N;
 * a sulfilimine S=N or ylide P=C is a pyramidal centre, not an E/Z unit); a
 * neutral nitrogen end with one substituent takes its lone pair as the second,
 * lowest ligand. An imine N–H end is excluded (RDKit tags one only when the H
 * is drawn, E11). Aromatic bonds, bonds in rings of seven or fewer atoms and
 * cumulated ends are excluded; stereo-axes.ts reports allenes.
 */

import { requireElement } from "./elements.js";
import { isAromaticAtom, isAromaticBond } from "./aromatic.js";
import { lonePairCount } from "./lewis.js";
import { bondsAt, getAtom, otherEnd, requireAtom, requireBond } from "./molecule.js";
import { updateAtom, updateBond } from "./ops.js";
import type { TetrahedralParity } from "./parity.js";
import { isRingBond, LruCache, rings, ringsAtAtom, ringsAtBond, ringSize } from "./rings.js";
import { compareIds } from "./selection.js";
import type { AtomId, Bond, BondId, Molecule } from "./types.js";
import { explicitValence, implicitHydrogenCount } from "./valence.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Why a stereogenic unit has no letter.
 *
 *   `no-stereo-bond`      the unit IS stereogenic and the drawing does not say
 *                         which way. Also a centre whose ranking needs another
 *                         unit's configuration that is not drawn.
 *   `unspecified`         the drawing says "deliberately unknown": a crossed
 *                         (`either`) double bond, a wavy bond at a double
 *                         bond's end, or a wavy unit another ranking needs.
 *   `ambiguous-geometry`  the marks contradict each other or collapse.
 *   `ranking-truncated`   the comparison hit `MAX_SPHERES` or the node cap.
 *   `ranking-unsupported` the comparison needs something cip.ts refuses.
 */
export type UndeterminedReason =
  | "no-stereo-bond"
  | "unspecified"
  | "ambiguous-geometry"
  | "ranking-truncated"
  | "ranking-unsupported";

/** One ligand of a centre: a real neighbour, the implicit H, or the lone pair. */
export type LigandRef =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "implicitHydrogen" }
  | { readonly kind: "lonePair" };

/** A ligand with the bond that reaches it. */
export type CipLigand =
  | { readonly kind: "atom"; readonly atomId: AtomId; readonly bondId: BondId }
  | { readonly kind: "implicitHydrogen" }
  | { readonly kind: "lonePair" };

/** A centre's configuration as rules 3-5 need it: a parity against named ligands. */
export type CipCentreState =
  | {
      readonly kind: "specified";
      readonly order: readonly LigandRef[];
      readonly parity: TetrahedralParity;
    }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/** A double bond's configuration: cis or trans between one atom at each end. */
export type CipBondState =
  | {
      readonly kind: "specified";
      /** A substituent atom of `bond.from`. */
      readonly refOnFrom: AtomId;
      /** A substituent atom of `bond.to`. */
      readonly refOnTo: AtomId;
      readonly relation: "cis" | "trans";
    }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/**
 * The configuration oracle rules 3-5 read. `undefined` means "not a unit of
 * this molecule"; the ranking then refuses rather than inventing one.
 */
export interface CipConfiguration {
  centre(atomId: AtomId): CipCentreState | undefined;
  doubleBond(bondId: BondId): CipBondState | undefined;
}

/** A centre's full ranking under one configuration. */
export type CipCentreRanking =
  | {
      readonly kind: "ranked";
      /** Highest priority first. */
      readonly order: readonly LigandRef[];
      /** Rule 5 decided the ranking: the descriptor is lowercase r or s. */
      readonly pseudoasymmetric: boolean;
    }
  | { readonly kind: "not-stereogenic" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/** A double bond's senior substituent atom at each end, under one configuration. */
export type CipDoubleBondRanking =
  | { readonly kind: "ranked"; readonly topOnFrom: AtomId; readonly topOnTo: AtomId }
  | { readonly kind: "not-stereogenic" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/**
 * What rules 1 and 2 alone say. `tied` means two ligands are constitutionally
 * identical and their branches reach other units: only a configuration decides.
 */
export type CipConstitution =
  | { readonly kind: "ranked"; readonly order: readonly LigandRef[] }
  | { readonly kind: "tied" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

export type CipDoubleBondConstitution =
  | { readonly kind: "ranked"; readonly topOnFrom: AtomId; readonly topOnTo: AtomId }
  | { readonly kind: "tied" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

export interface CipCentreUnit {
  readonly atomId: AtomId;
  /** Explicit neighbours by `compareIds`, then the implicit H, then the lone pair (decision 15). */
  readonly ligands: readonly CipLigand[];
  readonly implicitHydrogen: boolean;
  readonly lonePair: boolean;
  readonly constitution: CipConstitution;
}

export interface CipDoubleBondUnit {
  readonly bondId: BondId;
  /** Lowest-`compareIds` substituent atom of `bond.from`. */
  readonly refOnFrom: AtomId;
  /** Lowest-`compareIds` substituent atom of `bond.to`. */
  readonly refOnTo: AtomId;
  readonly constitution: CipDoubleBondConstitution;
}

/** Every stereogenic unit, each list in `compareIds` order. */
export interface CipUnits {
  readonly centres: readonly CipCentreUnit[];
  readonly doubleBonds: readonly CipDoubleBondUnit[];
  readonly centreById: ReadonlyMap<AtomId, CipCentreUnit>;
  readonly doubleBondById: ReadonlyMap<BondId, CipDoubleBondUnit>;
}

export type CipPairOrder =
  | { readonly kind: "ordered"; readonly aFirst: boolean }
  | { readonly kind: "identical" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

// ---------------------------------------------------------------------------
// Limits and outcome codes
// ---------------------------------------------------------------------------

/**
 * How many spheres one comparison may look out. Paths are simple, so a real
 * molecule needs at most its longest chain: beta-carotene's 23-sphere polyene
 * is the deepest in the corpus this was measured on, and 64 is that with room
 * to spare. `MAX_BRANCH_NODES`, not the depth, is what bounds the work.
 */
const MAX_SPHERES = 64;

/**
 * How many digraph nodes one pairwise comparison may materialise. The largest
 * single rule-1 comparison measured across cholesterol, morphine, taxol,
 * strychnine, sucrose, artemisinin, erythromycin, cortisol, quinine,
 * penicillin G and beta-carotene materialises 230 nodes.
 */
const MAX_BRANCH_NODES = 20000;

/** Kekulé structures enumerated per aromatic system before giving up. */
const MAX_KEKULE_STRUCTURES = 2000;

const TRUNCATED = 2;
const UNSUPPORTED = 3;
const NO_STEREO_BOND = 4;
const UNSPECIFIED = 5;
const AMBIGUOUS = 6;
type Undecided = 2 | 3 | 4 | 5 | 6;
type Cmp = -1 | 0 | 1 | Undecided;

function isUndecided(value: number): value is Undecided {
  return value >= TRUNCATED;
}

function reasonOf(code: Undecided): UndeterminedReason {
  switch (code) {
    case TRUNCATED:
      return "ranking-truncated";
    case UNSUPPORTED:
      return "ranking-unsupported";
    case NO_STEREO_BOND:
      return "no-stereo-bond";
    case UNSPECIFIED:
      return "unspecified";
    case AMBIGUOUS:
      return "ambiguous-geometry";
  }
}

function codeOf(reason: UndeterminedReason): Undecided {
  switch (reason) {
    case "ranking-truncated":
      return TRUNCATED;
    case "ranking-unsupported":
      return UNSUPPORTED;
    case "no-stereo-bond":
      return NO_STEREO_BOND;
    case "unspecified":
      return UNSPECIFIED;
    case "ambiguous-geometry":
      return AMBIGUOUS;
  }
}

/** Rule levels, each applied exhaustively before the next (P-92.1.6). */
const RULE_1A = 0;
const RULE_1B = 1;
const RULE_2 = 2;
/** Refusal only: a difference here is `ranking-unsupported`, never an order. */
const CHARGE = 3;
const RULE_3 = 4;
const RULE_4A = 5;
const RULE_4B = 6;
const RULE_4C = 7;
const RULE_5 = 8;

const CONSTITUTIONAL = CHARGE;
const ALL_RULES = RULE_5;

// ---------------------------------------------------------------------------
// The digraph
// ---------------------------------------------------------------------------

type NodeKind = "atom" | "duplicate" | "hydrogen" | "lonePair" | "phantom";
type Aux = "R" | "S" | "r" | "s" | "E" | "Z" | "none" | Undecided;

interface DNode {
  readonly id: number;
  readonly kind: NodeKind;
  /** The atom itself, or for a duplicate the atom it copies. */
  readonly atomId: AtomId | undefined;
  readonly parent: DNode | undefined;
  /** Atom nodes: the bond from the parent. Duplicates: the bond duplicated. */
  readonly bondId: BondId | undefined;
  readonly depth: number;
  /** Duplicates: depth of the node they copy. Others: `depth`. */
  readonly origDepth: number;
  readonly ringDuplicate: boolean;
  /** A duplicate on a perceived aromatic ring bond, whose place is a Kekulé artefact. */
  readonly mancudeDuplicate: boolean;
  /** Atomic number; a mancude duplicate's may be a mean. */
  readonly z: number;
  /** A mancude duplicate whose mean atomic number is unknown. */
  readonly fuzzy: boolean;
  /** Mass number if labelled, else standard atomic weight. */
  readonly mass: number;
  readonly labelled: boolean;
  readonly charge: number;
  children: DNode[] | undefined;
  aux: Aux | undefined;
  sorts: Map<string, DNode[] | Undecided> | undefined;
}

/** A node reached from `from`; downward exactly when `from` is its parent. */
type Dir = readonly [DNode, DNode | undefined];

const NO_CHILDREN: DNode[] = [];

const PHANTOM: DNode = Object.freeze({
  id: -2,
  kind: "phantom",
  atomId: undefined,
  parent: undefined,
  bondId: undefined,
  depth: 0,
  origDepth: 0,
  ringDuplicate: false,
  mancudeDuplicate: false,
  z: 0,
  fuzzy: false,
  mass: 0,
  labelled: false,
  charge: 0,
  children: NO_CHILDREN,
  aux: "none",
  sorts: undefined,
}) as DNode;

const PHANTOM_DIR: Dir = [PHANTOM, undefined];

interface RankContext {
  readonly units: CipUnits | undefined;
  readonly config: CipConfiguration | undefined;
  readonly mancude: ReadonlyMap<AtomId, number | "fuzzy">;
  /**
   * Duplicate multiple bonds at the root as everywhere else. Off for a
   * stereogenic unit (decision 47); on for `rankSubstituentPair`, whose root is
   * an aromatic ring atom and would otherwise rank its two ortho branches by
   * which of them the Kekulé form happened to double-bond to it.
   */
  readonly rootDuplicates?: boolean;
}

interface Digraph {
  /** The molecule being walked: the drawing, or its charge-separated form. */
  readonly mol: Molecule;
  /** Units of the drawing, for auxiliary descriptors. */
  readonly units: CipUnits | undefined;
  readonly config: CipConfiguration | undefined;
  readonly variant: "iupac" | "hanson";
  readonly mancude: ReadonlyMap<AtomId, number | "fuzzy">;
  readonly rootLonePair: boolean;
  readonly rootDuplicates: boolean;
  nextId: number;
  nodes: number;
  exhausted: boolean;
  /** A duplicate took part in a rule-1b key, so the two variants may differ. */
  dupAt1b: boolean;
}

function newDigraph(
  mol: Molecule,
  context: RankContext,
  variant: "iupac" | "hanson",
  rootLonePair: boolean,
): Digraph {
  return {
    mol,
    units: context.units,
    config: context.config,
    variant,
    mancude: context.mancude,
    rootLonePair,
    rootDuplicates: context.rootDuplicates === true,
    nextId: 0,
    nodes: 0,
    exhausted: false,
    dupAt1b: false,
  };
}

function nextNodeId(g: Digraph): number {
  g.nodes++;
  if (g.nodes > MAX_BRANCH_NODES) g.exhausted = true;
  return g.nextId++;
}

function isLabelled(z: number, isotope: number | undefined): boolean {
  return isotope !== undefined && !(z === 1 && isotope === 1);
}

function atomNode(
  g: Digraph,
  atomId: AtomId,
  parent: DNode | undefined,
  bondId: BondId | undefined,
  depth: number,
): DNode {
  const atom = requireAtom(g.mol, atomId);
  const element = requireElement(atom.element);
  const labelled = isLabelled(element.z, atom.isotope);
  return {
    id: nextNodeId(g),
    kind: "atom",
    atomId,
    parent,
    bondId,
    depth,
    origDepth: depth,
    ringDuplicate: false,
    mancudeDuplicate: false,
    z: element.z,
    fuzzy: false,
    mass: labelled ? atom.isotope! : element.weight,
    labelled,
    charge: atom.charge,
    children: undefined,
    aux: undefined,
    sorts: undefined,
  };
}

function duplicateNode(
  g: Digraph,
  of: AtomId,
  bearer: AtomId,
  bond: Bond,
  parent: DNode,
  origDepth: number,
  ringClosure: boolean,
): DNode {
  const atom = requireAtom(g.mol, of);
  const element = requireElement(atom.element);
  const labelled = isLabelled(element.z, atom.isotope);
  let z = element.z;
  let fuzzy = false;
  const mancude = !ringClosure && bond.order >= 2 && isAromaticBond(g.mol, bond.id);
  if (mancude) {
    const mean = g.mancude.get(bearer);
    if (mean === "fuzzy") fuzzy = true;
    else if (mean !== undefined) z = mean;
  }
  return {
    id: nextNodeId(g),
    kind: "duplicate",
    atomId: of,
    parent,
    bondId: bond.id,
    depth: parent.depth + 1,
    origDepth,
    ringDuplicate: ringClosure,
    mancudeDuplicate: mancude,
    z,
    fuzzy,
    mass: labelled ? atom.isotope! : element.weight,
    labelled,
    charge: atom.charge,
    children: NO_CHILDREN,
    aux: "none",
    sorts: undefined,
  };
}

function leafNode(g: Digraph, kind: "hydrogen" | "lonePair", parent: DNode): DNode {
  const hydrogen = kind === "hydrogen";
  return {
    id: nextNodeId(g),
    kind,
    atomId: undefined,
    parent,
    bondId: undefined,
    depth: parent.depth + 1,
    origDepth: parent.depth + 1,
    ringDuplicate: false,
    mancudeDuplicate: false,
    z: hydrogen ? 1 : 0,
    fuzzy: false,
    mass: hydrogen ? requireElement("H").weight : 0,
    labelled: false,
    charge: 0,
    children: NO_CHILDREN,
    aux: "none",
    sorts: undefined,
  };
}

function ancestorWithAtom(node: DNode, atomId: AtomId): DNode | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (at.atomId === atomId) return at;
  }
  return undefined;
}

function childrenOf(g: Digraph, node: DNode): DNode[] {
  if (node.children !== undefined) return node.children;
  if (node.kind !== "atom" || node.atomId === undefined) {
    node.children = NO_CHILDREN;
    return node.children;
  }
  const atomId = node.atomId;
  const isRoot = node.parent === undefined;
  const out: DNode[] = [];
  for (const bond of bondsAt(g.mol, atomId)) {
    if (g.exhausted) break;
    const other = otherEnd(bond, atomId);
    const extra = bond.order - 1;
    if (node.parent !== undefined && bond.id === node.bondId) {
      // Back along the parent bond: only its duplicates, and none when the
      // parent is the root (decision 47).
      if (node.parent.parent !== undefined || g.rootDuplicates) {
        for (let k = 0; k < extra; k++) {
          out.push(duplicateNode(g, other, atomId, bond, node, node.depth - 1, false));
        }
      }
      continue;
    }
    const ancestor = ancestorWithAtom(node, other);
    if (ancestor !== undefined) {
      out.push(duplicateNode(g, other, atomId, bond, node, ancestor.depth, true));
      for (let k = 0; k < extra; k++) {
        out.push(duplicateNode(g, other, atomId, bond, node, ancestor.depth, false));
      }
      continue;
    }
    out.push(atomNode(g, other, node, bond.id, node.depth + 1));
    if (!isRoot || g.rootDuplicates) {
      for (let k = 0; k < extra; k++) {
        out.push(duplicateNode(g, other, atomId, bond, node, node.depth + 1, false));
      }
    }
  }
  const hydrogens = implicitHydrogenCount(g.mol, atomId);
  for (let k = 0; k < hydrogens; k++) out.push(leafNode(g, "hydrogen", node));
  if (isRoot && g.rootLonePair) out.push(leafNode(g, "lonePair", node));
  node.children = out;
  return out;
}

function neighbours(g: Digraph, node: DNode, from: DNode | undefined): DNode[] {
  const kids = childrenOf(g, node);
  if (from === node.parent) return kids;
  const out = kids.filter((kid) => kid !== from);
  if (node.parent !== undefined) out.push(node.parent);
  return out;
}

function isDown(dir: Dir): boolean {
  return dir[1] === dir[0].parent;
}

function sign(value: number): -1 | 0 | 1 {
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function ord3(aux: Aux): number {
  return aux === "Z" ? 2 : aux === "E" ? 1 : 0;
}

function ord4a(aux: Aux): number {
  if (aux === "R" || aux === "S") return 2;
  if (aux === "r" || aux === "s" || aux === "E" || aux === "Z") return 1;
  return 0;
}

function ord4c(aux: Aux): number {
  return aux === "r" ? 2 : aux === "s" ? 1 : 0;
}

function ord5(aux: Aux): number {
  return aux === "R" ? 2 : aux === "S" ? 1 : 0;
}

type Reference = "R" | "S" | "none";

function keyCompare(
  g: Digraph,
  level: number,
  x: Dir,
  y: Dir,
  refX: Reference | undefined,
  refY: Reference | undefined,
): Cmp {
  const a = x[0];
  const b = y[0];
  switch (level) {
    case RULE_1A:
      if (a.fuzzy || b.fuzzy) return UNSUPPORTED;
      return sign(a.z - b.z);
    case RULE_1B: {
      const aDup = a.kind === "duplicate";
      const bDup = b.kind === "duplicate";
      if (!aDup && !bDup) return 0;
      g.dupAt1b = true;
      if (g.variant === "iupac") {
        // A mancude duplicate sits wherever the drawn Kekulé form put a double
        // bond, so its distance says nothing about the molecule: toluene's two
        // ortho branches would rank apart. It takes part in no distance order.
        if (a.mancudeDuplicate || b.mancudeDuplicate) return 0;
        return aDup && bDup ? sign(b.origDepth - a.origDepth) : 0;
      }
      const aRing = aDup && a.ringDuplicate;
      const bRing = bDup && b.ringDuplicate;
      if (aRing && bRing) return sign(b.origDepth - a.origDepth);
      if (aRing) return 1;
      if (bRing) return -1;
      return 0;
    }
    case RULE_2: {
      if (a.z === 0 || b.z === 0) return 0;
      const aDupLabel = a.kind === "duplicate" && a.labelled;
      const bDupLabel = b.kind === "duplicate" && b.labelled;
      if (aDupLabel || bDupLabel) {
        return aDupLabel && bDupLabel && a.mass === b.mass ? 0 : UNSUPPORTED;
      }
      if (!a.labelled && !b.labelled) return 0;
      const diff = a.mass - b.mass;
      if (a.labelled && b.labelled) return sign(diff);
      if (Math.abs(diff) < 0.5) return UNSUPPORTED;
      return sign(diff);
    }
    case CHARGE:
      return a.charge === b.charge ? 0 : UNSUPPORTED;
    default: {
      if (!isDown(x) || !isDown(y)) return UNSUPPORTED;
      const auxA = auxOf(g, a);
      if (typeof auxA === "number") return auxA;
      const auxB = auxOf(g, b);
      if (typeof auxB === "number") return auxB;
      switch (level) {
        case RULE_3:
          return sign(ord3(auxA) - ord3(auxB));
        case RULE_4A:
          return sign(ord4a(auxA) - ord4a(auxB));
        case RULE_4B: {
          const keyA = auxA === "R" || auxA === "S" ? (auxA === refX ? 2 : 1) : 0;
          const keyB = auxB === "R" || auxB === "S" ? (auxB === refY ? 2 : 1) : 0;
          return sign(keyA - keyB);
        }
        case RULE_4C:
          return sign(ord4c(auxA) - ord4c(auxB));
        default:
          return sign(ord5(auxA) - ord5(auxB));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Two branches under one rule, sphere by sphere. */
function compareAtLevel(
  g: Digraph,
  a: Dir,
  b: Dir,
  level: number,
  refA: Reference | undefined,
  refB: Reference | undefined,
): Cmp {
  if (g.exhausted) return TRUNCATED;
  const first = keyCompare(g, level, a, b, refA, refB);
  if (first !== 0) return first;

  let frontierA: Dir[] = [a];
  let frontierB: Dir[] = [b];
  let sphere = 0;
  while (frontierA.length > 0) {
    if (sphere >= MAX_SPHERES) {
      // The cap has only bitten if something was left to look at.
      for (const [node, from] of [...frontierA, ...frontierB]) {
        if (neighbours(g, node, from).length > 0) return TRUNCATED;
      }
      return 0;
    }
    const nextA: Dir[] = [];
    const nextB: Dir[] = [];
    for (let i = 0; i < frontierA.length; i++) {
      const childrenA = sortedNeighbours(g, frontierA[i]!, level, refA);
      if (typeof childrenA === "number") return childrenA;
      const childrenB = sortedNeighbours(g, frontierB[i] ?? PHANTOM_DIR, level, refB);
      if (typeof childrenB === "number") return childrenB;
      const width = Math.max(childrenA.length, childrenB.length);
      for (let j = 0; j < width; j++) {
        nextA.push(childrenA[j] ?? PHANTOM_DIR);
        nextB.push(childrenB[j] ?? PHANTOM_DIR);
      }
    }
    if (g.exhausted) return TRUNCATED;
    for (let i = 0; i < nextA.length; i++) {
      const c = keyCompare(g, level, nextA[i]!, nextB[i]!, refA, refB);
      if (c !== 0) return c;
    }
    frontierA = nextA;
    frontierB = nextB;
    sphere++;
  }
  return 0;
}

function compareUpTo(
  g: Digraph,
  a: Dir,
  b: Dir,
  top: number,
  refA: Reference | undefined,
  refB: Reference | undefined,
): Cmp {
  for (let level = 0; level <= top; level++) {
    const c = compareAtLevel(g, a, b, level, refA, refB);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * A node's neighbours away from where it was reached, in descending priority
 * under every rule up to `level`. Memoised per direction, level and rule-4b
 * reference, because the sphere walk asks every frontier node for its order.
 */
function sortedNeighbours(
  g: Digraph,
  dir: Dir,
  level: number,
  ref: Reference | undefined,
): Dir[] | Undecided {
  const [node, from] = dir;
  if (node.kind !== "atom") return [];
  const key = `${from === undefined ? -1 : from.id}:${level}:${level >= RULE_4B ? (ref ?? "") : ""}`;
  const memo: Map<string, DNode[] | Undecided> = (node.sorts ??= new Map<string, DNode[] | Undecided>());
  const cached = memo.get(key);
  if (cached !== undefined) {
    if (typeof cached === "number") return cached;
    return cached.map((n): Dir => [n, node]);
  }
  const list = [...neighbours(g, node, from)];
  if (g.exhausted) return TRUNCATED;
  let failure: Undecided | undefined;
  list.sort((p, q) => {
    if (failure !== undefined) return 0;
    const c = compareUpTo(g, [p, node], [q, node], level, ref, ref);
    if (isUndecided(c)) {
      failure = c;
      return 0;
    }
    return -c;
  });
  if (failure !== undefined) {
    // A truncation belongs to one comparison's budget, not to the node.
    if (failure !== TRUNCATED) memo.set(key, failure);
    return failure;
  }
  memo.set(key, list);
  return list.map((n): Dir => [n, node]);
}

/**
 * Rule 4b's reference descriptor for the branch at `dir` (P-92.5.2.1): that of
 * its highest-ranked R/S node, or the majority among the equally ranked
 * highest ones. An even split is criterion (c), refused.
 */
function referenceOf(g: Digraph, dir: Dir): Reference | Undecided {
  interface Entry {
    readonly dir: Dir;
    readonly rank: readonly number[];
  }
  const lexical = (p: readonly number[], q: readonly number[]): number => {
    for (let i = 0; i < Math.min(p.length, q.length); i++) {
      if (p[i] !== q[i]) return p[i]! - q[i]!;
    }
    return p.length - q.length;
  };
  let frontier: Entry[] = [{ dir, rank: [] }];
  for (let sphere = 0; frontier.length > 0; sphere++) {
    if (sphere >= MAX_SPHERES) return TRUNCATED;
    const chiral: { rank: readonly number[]; aux: "R" | "S" }[] = [];
    for (const entry of frontier) {
      if (!isDown(entry.dir)) return UNSUPPORTED;
      const aux = auxOf(g, entry.dir[0]);
      if (typeof aux === "number") return aux;
      if (aux === "R" || aux === "S") chiral.push({ rank: entry.rank, aux });
    }
    if (chiral.length > 0) {
      let best = chiral[0]!.rank;
      for (const c of chiral) if (lexical(c.rank, best) < 0) best = c.rank;
      let r = 0;
      let s = 0;
      for (const c of chiral) {
        if (lexical(c.rank, best) !== 0) continue;
        if (c.aux === "R") r++;
        else s++;
      }
      if (r === s) return UNSUPPORTED;
      return r > s ? "R" : "S";
    }
    const next: Entry[] = [];
    for (const entry of frontier) {
      const sorted = sortedNeighbours(g, entry.dir, RULE_4A, undefined);
      if (typeof sorted === "number") return sorted;
      let rank = 0;
      for (let j = 0; j < sorted.length; j++) {
        if (j > 0) {
          const c = compareUpTo(g, sorted[j - 1]!, sorted[j]!, RULE_4A, undefined, undefined);
          if (isUndecided(c)) return c;
          if (c !== 0) rank = j;
        }
        next.push({ dir: sorted[j]!, rank: [...entry.rank, rank] });
      }
    }
    if (g.exhausted) return TRUNCATED;
    frontier = next;
  }
  return "none";
}

interface PairResult {
  readonly cmp: Cmp;
  readonly level: number;
}

/**
 * Two ligand branches of one unit under every rule up to `top`. `fresh`
 * starts a new node budget; a nested (re-rooted) comparison shares its
 * caller's.
 */
function comparePair(g: Digraph, a: Dir, b: Dir, top: number, fresh: boolean): PairResult {
  if (fresh) {
    g.nodes = 0;
    g.exhausted = false;
  }
  let refA: Reference | undefined;
  let refB: Reference | undefined;
  for (let level = 0; level <= top; level++) {
    if (level === RULE_4B) {
      const ra = referenceOf(g, a);
      if (typeof ra === "number") return { cmp: ra, level };
      const rb = referenceOf(g, b);
      if (typeof rb === "number") return { cmp: rb, level };
      refA = ra;
      refB = rb;
    }
    const c = compareAtLevel(g, a, b, level, refA, refB);
    if (c === 0) continue;
    if (isUndecided(c)) return { cmp: c, level };
    if (level === RULE_1B && !fresh) return { cmp: UNSUPPORTED, level };
    if (level === RULE_5 && refA !== "none" && refB !== "none" && refA !== refB) {
      // Rule 5 read through the reference descriptors (P-92.6 example 6)
      // must agree with the node-by-node reading.
      if ((refA === "R" ? 1 : -1) !== c) return { cmp: UNSUPPORTED, level };
    }
    return { cmp: c, level };
  }
  return { cmp: 0, level: top };
}

// ---------------------------------------------------------------------------
// Auxiliary descriptors
// ---------------------------------------------------------------------------

function auxOf(g: Digraph, node: DNode): Aux {
  if (node.aux !== undefined) return node.aux;
  if (node.kind !== "atom" || node.parent === undefined) {
    node.aux = "none";
    return node.aux;
  }
  node.aux = UNSUPPORTED; // re-entry guard, overwritten below
  node.aux = computeAux(g, node);
  return node.aux;
}

interface Ligand {
  /** Undefined for a phantom lone pair that has no node. */
  readonly dir: Dir | undefined;
  readonly ref: LigandRef;
}

function computeAux(g: Digraph, node: DNode): Aux {
  const units = g.units;
  if (units === undefined || node.atomId === undefined) return UNSUPPORTED;
  const centre = units.centreById.get(node.atomId);
  if (centre !== undefined) return auxCentre(g, node, node.atomId, centre);
  for (const child of childrenOf(g, node)) {
    if (child.kind !== "atom" || child.bondId === undefined) continue;
    const unit = units.doubleBondById.get(child.bondId);
    if (unit !== undefined) return auxDoubleBond(g, node, child, unit);
  }
  return "none";
}

function auxCentre(g: Digraph, node: DNode, atomId: AtomId, centre: CipCentreUnit): Aux {
  if (g.config === undefined) return UNSUPPORTED;
  const parent = node.parent!;
  const ligands: Ligand[] = [{ dir: [parent, node], ref: { kind: "atom", atomId: parent.atomId! } }];
  for (const child of childrenOf(g, node)) {
    if (child.kind === "atom" || (child.kind === "duplicate" && child.ringDuplicate)) {
      ligands.push({ dir: [child, node], ref: { kind: "atom", atomId: child.atomId! } });
    } else if (child.kind === "hydrogen") {
      ligands.push({ dir: [child, node], ref: { kind: "implicitHydrogen" } });
    }
  }
  if (centre.lonePair) ligands.push({ dir: undefined, ref: { kind: "lonePair" } });
  if (ligands.length !== 4) return UNSUPPORTED;

  const ranked = rankNested(g, ligands);
  if (ranked === "none" || typeof ranked === "number") return ranked;
  if (ranked.rule5 > 1) return UNSUPPORTED;
  const state = g.config.centre(atomId);
  if (state === undefined) return UNSUPPORTED;
  if (state.kind === "undetermined") return codeOf(state.reason);
  const permutation = permutationSign(state.order, ranked.order);
  if (permutation === undefined) return UNSUPPORTED;
  const upper = state.parity * permutation < 0 ? "R" : "S";
  if (ranked.rule5 === 1) return upper === "R" ? "r" : "s";
  return upper;
}

/** Pairwise ranking of a re-rooted node's ligands. */
function rankNested(
  g: Digraph,
  ligands: readonly Ligand[],
): { order: LigandRef[]; rule5: number } | "none" | Undecided {
  const wins = ligands.map(() => 0);
  let undecided: Undecided | undefined;
  let tie = false;
  let rule5 = 0;
  for (let i = 0; i < ligands.length; i++) {
    for (let j = i + 1; j < ligands.length; j++) {
      const a = ligands[i]!;
      const b = ligands[j]!;
      if (a.dir === undefined || b.dir === undefined) {
        if (a.dir === undefined && b.dir === undefined) tie = true;
        else wins[a.dir === undefined ? j : i]!++;
        continue;
      }
      const result = comparePair(g, a.dir, b.dir, ALL_RULES, false);
      if (result.cmp === 0) tie = true;
      else if (isUndecided(result.cmp)) undecided ??= result.cmp;
      else {
        wins[result.cmp > 0 ? i : j]!++;
        if (result.level === RULE_5) rule5++;
      }
    }
  }
  if (tie) return "none";
  if (undecided !== undefined) return undecided;
  const order = [...ligands.keys()].sort((x, y) => wins[y]! - wins[x]!).map((k) => ligands[k]!.ref);
  return { order, rule5 };
}

function auxDoubleBond(g: Digraph, near: DNode, far: DNode, unit: CipDoubleBondUnit): Aux {
  if (g.config === undefined) return UNSUPPORTED;
  const bond = requireBond(g.mol, unit.bondId);
  const nearAtom = near.atomId!;
  const farAtom = far.atomId!;
  const parent = near.parent!;
  const nearLigands: Ligand[] = [{ dir: [parent, near], ref: { kind: "atom", atomId: parent.atomId! } }];
  for (const child of childrenOf(g, near)) {
    if (child === far || (child.kind === "duplicate" && child.bondId === unit.bondId)) continue;
    nearLigands.push(childLigand(child, near));
  }
  const farLigands: Ligand[] = [];
  for (const child of childrenOf(g, far)) {
    if (child.kind === "duplicate" && child.bondId === unit.bondId) continue;
    farLigands.push(childLigand(child, far));
  }
  if (endHasLonePair(g.mol, nearAtom, unit.bondId)) {
    nearLigands.push({ dir: undefined, ref: { kind: "lonePair" } });
  }
  if (endHasLonePair(g.mol, farAtom, unit.bondId)) {
    farLigands.push({ dir: undefined, ref: { kind: "lonePair" } });
  }
  const topNear = chooseNested(g, nearLigands);
  if (topNear === "none" || typeof topNear === "number") return topNear;
  const topFar = chooseNested(g, farLigands);
  if (topFar === "none" || typeof topFar === "number") return topFar;
  if (topNear.rule5 || topFar.rule5) return UNSUPPORTED;
  const state = g.config.doubleBond(unit.bondId);
  if (state === undefined) return UNSUPPORTED;
  if (state.kind === "undetermined") return codeOf(state.reason);
  if (topNear.ref.kind !== "atom" || topFar.ref.kind !== "atom") return UNSUPPORTED;
  const nearIsFrom = bond.from === nearAtom;
  const topFrom = nearIsFrom ? topNear.ref.atomId : topFar.ref.atomId;
  const topTo = nearIsFrom ? topFar.ref.atomId : topNear.ref.atomId;
  const flips = (topFrom === state.refOnFrom ? 0 : 1) + (topTo === state.refOnTo ? 0 : 1);
  return (state.relation === "cis") === (flips % 2 === 0) ? "Z" : "E";
}

function childLigand(child: DNode, from: DNode): Ligand {
  if (child.kind === "hydrogen") return { dir: [child, from], ref: { kind: "implicitHydrogen" } };
  return { dir: [child, from], ref: { kind: "atom", atomId: child.atomId! } };
}

function chooseNested(
  g: Digraph,
  ligands: readonly Ligand[],
): { ref: LigandRef; rule5: boolean } | "none" | Undecided {
  if (ligands.length === 1) return { ref: ligands[0]!.ref, rule5: false };
  if (ligands.length !== 2) return UNSUPPORTED;
  const [a, b] = ligands as [Ligand, Ligand];
  if (a.dir === undefined && b.dir === undefined) return "none";
  if (a.dir === undefined) return { ref: b.ref, rule5: false };
  if (b.dir === undefined) return { ref: a.ref, rule5: false };
  const result = comparePair(g, a.dir, b.dir, ALL_RULES, false);
  if (result.cmp === 0) return "none";
  if (isUndecided(result.cmp)) return result.cmp;
  return { ref: result.cmp > 0 ? a.ref : b.ref, rule5: result.level === RULE_5 };
}

function sameRef(a: LigandRef, b: LigandRef): boolean {
  if (a.kind === "atom" || b.kind === "atom") {
    return a.kind === "atom" && b.kind === "atom" && a.atomId === b.atomId;
  }
  return a.kind === b.kind;
}

/**
 * The sign of the permutation that reorders `from` into `to`, or undefined
 * when the two lists do not hold the same ligands.
 */
export function permutationSign(
  from: readonly LigandRef[],
  to: readonly LigandRef[],
): TetrahedralParity | undefined {
  if (from.length !== to.length) return undefined;
  const perm: number[] = [];
  for (const ref of to) {
    const index = from.findIndex((c) => sameRef(c, ref));
    if (index < 0 || perm.includes(index)) return undefined;
    perm.push(index);
  }
  let inversions = 0;
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) {
      if (perm[i]! > perm[j]!) inversions++;
    }
  }
  return inversions % 2 === 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Mancude duplicates (P-92.1.4.4)
// ---------------------------------------------------------------------------

const MANCUDE_CACHE = new WeakMap<Molecule, ReadonlyMap<AtomId, number | "fuzzy">>();

/**
 * For each atom carrying an aromatic double bond, the mean atomic number of
 * its double-bond partner over every Kekulé structure of its aromatic system.
 */
function mancudeTable(mol: Molecule): ReadonlyMap<AtomId, number | "fuzzy"> {
  const hit = MANCUDE_CACHE.get(mol);
  if (hit !== undefined) return hit;
  const out = new Map<AtomId, number | "fuzzy">();
  const seen = new Set<AtomId>();
  const zOf = (id: AtomId): number => requireElement(requireAtom(mol, id).element).z;
  for (const start of mol.atomIds) {
    if (seen.has(start) || !isAromaticAtom(mol, start)) continue;
    const system: AtomId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      system.push(id);
      for (const bond of bondsAt(mol, id)) {
        if (!isAromaticBond(mol, bond.id)) continue;
        const other = otherEnd(bond, id);
        if (seen.has(other)) continue;
        seen.add(other);
        stack.push(other);
      }
    }
    const matched = system.filter((id) =>
      bondsAt(mol, id).some((bond) => bond.order === 2 && isAromaticBond(mol, bond.id)),
    );
    if (matched.length === 0) continue;
    const inMatched = new Set(matched);
    const fuzzy = system.some((id) => !inMatched.has(id) && requireAtom(mol, id).charge !== 0);
    if (fuzzy) {
      for (const id of matched) out.set(id, "fuzzy");
      continue;
    }
    const partners = new Map<AtomId, AtomId[]>();
    for (const id of matched) {
      partners.set(
        id,
        bondsAt(mol, id)
          .filter((bond) => isAromaticBond(mol, bond.id) && inMatched.has(otherEnd(bond, id)))
          .map((bond) => otherEnd(bond, id))
          .sort(compareIds),
      );
    }
    const uniform = matched.every((id) => new Set(partners.get(id)!.map(zOf)).size <= 1);
    if (uniform) {
      for (const id of matched) {
        const first = partners.get(id)![0];
        if (first !== undefined) out.set(id, zOf(first));
      }
      continue;
    }
    const sums = new Map<AtomId, number>(matched.map((id) => [id, 0]));
    const order = [...matched].sort(compareIds);
    const mate = new Map<AtomId, AtomId>();
    let structures = 0;
    let overflow = false;
    const search = (index: number): void => {
      while (index < order.length && mate.has(order[index]!)) index++;
      if (index === order.length) {
        structures++;
        if (structures > MAX_KEKULE_STRUCTURES) {
          overflow = true;
          return;
        }
        for (const [id, other] of mate) sums.set(id, sums.get(id)! + zOf(other));
        return;
      }
      const id = order[index]!;
      for (const other of partners.get(id)!) {
        if (mate.has(other)) continue;
        mate.set(id, other);
        mate.set(other, id);
        search(index + 1);
        mate.delete(id);
        mate.delete(other);
        if (overflow) return;
      }
    };
    search(0);
    for (const id of matched) {
      out.set(id, overflow || structures === 0 ? "fuzzy" : sums.get(id)! / structures);
    }
  }
  MANCUDE_CACHE.set(mol, out);
  return out;
}

// ---------------------------------------------------------------------------
// Drawing forms
// ---------------------------------------------------------------------------

const HYPERVALENT_CAPABLE = new Set(["P", "As", "S", "Se", "Te"]);

/** The expanded-octet end of a hypervalent double bond, if exactly one end is. */
function hypervalentEnd(mol: Molecule, bond: Bond): AtomId | undefined {
  if (bond.order !== 2) return undefined;
  const ends = [bond.from, bond.to].filter((id) => {
    const atom = requireAtom(mol, id);
    if (atom.charge !== 0 || !HYPERVALENT_CAPABLE.has(atom.element)) return false;
    const lowest = requireElement(atom.element).valences[0];
    return lowest !== undefined && explicitValence(mol, id) > lowest;
  });
  return ends.length === 1 ? ends[0] : undefined;
}

const SEPARATED_CACHE = new WeakMap<Molecule, Molecule | null>();

/**
 * `mol` with every hypervalent double bond written charge-separated, or
 * undefined when it has none. Ids are untouched. Only ever used for ranking.
 */
function chargeSeparatedForm(mol: Molecule): Molecule | undefined {
  const hit = SEPARATED_CACHE.get(mol);
  if (hit !== undefined) return hit ?? undefined;
  let out: Molecule | undefined;
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined) continue;
    const centre = hypervalentEnd(mol, bond);
    if (centre === undefined) continue;
    const partner = otherEnd(bond, centre);
    let next = out ?? mol;
    next = updateBond(next, bondId, { order: 1 });
    next = updateAtom(next, centre, { charge: requireAtom(next, centre).charge + 1 });
    next = updateAtom(next, partner, { charge: requireAtom(next, partner).charge - 1 });
    out = next;
  }
  SEPARATED_CACHE.set(mol, out ?? null);
  return out;
}

// ---------------------------------------------------------------------------
// Ranking a unit's ligands
// ---------------------------------------------------------------------------

interface RawPair {
  readonly i: number;
  readonly j: number;
  readonly cmp: Cmp;
  readonly rule5: boolean;
}

/**
 * Every requested pair of ligands, ranked in each drawing form and rule-1b
 * variant and merged: a pair they disagree on is `ranking-unsupported`.
 */
function rankPairs(
  mol: Molecule,
  context: RankContext,
  top: number,
  build: (g: Digraph) => (Ligand | undefined)[],
  rootLonePair: boolean,
  pairs: readonly (readonly [number, number])[],
): RawPair[] {
  const forms = [mol];
  const separated = chargeSeparatedForm(mol);
  if (separated !== undefined) forms.push(separated);
  let merged: RawPair[] | undefined;
  for (const form of forms) {
    for (const variant of ["hanson", "iupac"] as const) {
      const g = newDigraph(form, context, variant, rootLonePair);
      const ligands = build(g);
      const results = pairs.map(([i, j]): RawPair => {
        const a = ligands[i];
        const b = ligands[j];
        if (a === undefined || b === undefined) return { i, j, cmp: UNSUPPORTED, rule5: false };
        if (a.dir === undefined || b.dir === undefined) {
          if (a.dir === undefined && b.dir === undefined) return { i, j, cmp: 0, rule5: false };
          return { i, j, cmp: a.dir === undefined ? -1 : 1, rule5: false };
        }
        const result = comparePair(g, a.dir, b.dir, top, true);
        return { i, j, cmp: result.cmp, rule5: result.level === RULE_5 && !isUndecided(result.cmp) };
      });
      merged = merged === undefined ? results : merged.map((m, k) => mergePair(m, results[k]!));
      // The IUPAC variant can only differ where a duplicate reached rule 1b.
      if (!g.dupAt1b) break;
    }
  }
  return merged ?? [];
}

function mergePair(a: RawPair, b: RawPair): RawPair {
  if (a.cmp === b.cmp && a.rule5 === b.rule5) return a;
  if (isUndecided(a.cmp)) return a;
  if (isUndecided(b.cmp)) return b;
  return { ...a, cmp: UNSUPPORTED, rule5: false };
}

const PAIRS_OF_FOUR: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

interface CentreCandidate {
  readonly atomId: AtomId;
  readonly ligands: readonly CipLigand[];
  readonly implicitHydrogen: boolean;
  readonly lonePair: boolean;
}

function centreLigands(g: Digraph, unit: CentreCandidate): (Ligand | undefined)[] {
  const root = atomNode(g, unit.atomId, undefined, undefined, 0);
  const kids = childrenOf(g, root);
  return unit.ligands.map((ligand): Ligand | undefined => {
    let kid: DNode | undefined;
    if (ligand.kind === "atom") {
      kid = kids.find((k) => k.kind === "atom" && k.atomId === ligand.atomId);
    } else {
      kid = kids.find((k) => k.kind === (ligand.kind === "implicitHydrogen" ? "hydrogen" : "lonePair"));
    }
    return kid === undefined ? undefined : { dir: [kid, root], ref: refOf(ligand) };
  });
}

function refOf(ligand: CipLigand): LigandRef {
  return ligand.kind === "atom" ? { kind: "atom", atomId: ligand.atomId } : ligand;
}

function rankCentrePairs(
  mol: Molecule,
  unit: CentreCandidate,
  context: RankContext,
  top: number,
): RawPair[] {
  return rankPairs(mol, context, top, (g) => centreLigands(g, unit), unit.lonePair, PAIRS_OF_FOUR);
}

function orderFromPairs(ligands: readonly CipLigand[], pairs: readonly RawPair[]): LigandRef[] {
  const wins = ligands.map(() => 0);
  for (const pair of pairs) {
    if (pair.cmp === 1) wins[pair.i]!++;
    else if (pair.cmp === -1) wins[pair.j]!++;
  }
  return [...ligands.keys()].sort((x, y) => wins[y]! - wins[x]!).map((k) => refOf(ligands[k]!));
}

/**
 * `atomId`'s ligands ranked under every rule, with `config` supplying the
 * configurations rules 3-5 read. A centre that needs them and gets no
 * `config` is `ranking-unsupported`. Undefined when the atom is not a unit.
 */
export function rankStereoCentre(
  mol: Molecule,
  atomId: AtomId,
  config?: CipConfiguration,
): CipCentreRanking | undefined {
  const units = cipUnits(mol);
  const unit = units.centreById.get(atomId);
  if (unit === undefined) return undefined;
  const constitution = unit.constitution;
  if (constitution.kind === "ranked") {
    return { kind: "ranked", order: constitution.order, pseudoasymmetric: false };
  }
  if (constitution.kind === "undetermined") return constitution;
  if (config === undefined) return { kind: "undetermined", reason: "ranking-unsupported" };
  const context: RankContext = { units, config, mancude: mancudeTable(mol) };
  const pairs = rankCentrePairs(mol, unit, context, ALL_RULES);
  if (pairs.some((pair) => pair.cmp === 0)) return { kind: "not-stereogenic" };
  const undecided = pairs.find((pair) => isUndecided(pair.cmp));
  if (undecided !== undefined) {
    return { kind: "undetermined", reason: reasonOf(undecided.cmp as Undecided) };
  }
  const rule5 = pairs.filter((pair) => pair.rule5).length;
  if (rule5 > 1) return { kind: "undetermined", reason: "ranking-unsupported" };
  return {
    kind: "ranked",
    order: orderFromPairs(unit.ligands, pairs),
    pseudoasymmetric: rule5 === 1,
  };
}

interface EndCandidate {
  readonly atomId: AtomId;
  /** Substituents other than the double-bond partner: atoms, implicit H, lone pair. */
  readonly ligands: readonly CipLigand[];
}

interface DoubleBondCandidate {
  readonly bondId: BondId;
  readonly from: EndCandidate;
  readonly to: EndCandidate;
}

function doubleBondLigands(g: Digraph, unit: DoubleBondCandidate): (Ligand | undefined)[] {
  const bond = requireBond(g.mol, unit.bondId);
  const root = atomNode(g, bond.from, undefined, undefined, 0);
  const rootKids = childrenOf(g, root);
  const far = rootKids.find((kid) => kid.kind === "atom" && kid.atomId === bond.to);
  const out: (Ligand | undefined)[] = [];
  const place = (end: EndCandidate, node: DNode | undefined): void => {
    const kids = node === undefined ? [] : childrenOf(g, node);
    const hydrogens = kids.filter((kid) => kid.kind === "hydrogen");
    let h = 0;
    for (const ligand of end.ligands) {
      if (ligand.kind === "lonePair") {
        out.push({ dir: undefined, ref: ligand });
        continue;
      }
      const kid =
        ligand.kind === "atom"
          ? kids.find((k) => k.kind === "atom" && k.atomId === ligand.atomId)
          : hydrogens[h++];
      out.push(node === undefined || kid === undefined ? undefined : { dir: [kid, node], ref: refOf(ligand) });
    }
  };
  place(unit.from, root);
  place(unit.to, far);
  return out;
}

function rankDoubleBondPairs(
  mol: Molecule,
  unit: DoubleBondCandidate,
  context: RankContext,
  top: number,
): { fromPair: RawPair | undefined; toPair: RawPair | undefined } {
  // Both ends always carry two ligands (classifyEnd), so the pairs are fixed.
  const raw = rankPairs(mol, context, top, (g) => doubleBondLigands(g, unit), false, [
    [0, 1],
    [2, 3],
  ]);
  const local = (pair: RawPair | undefined): RawPair | undefined =>
    pair === undefined ? undefined : { ...pair, i: 0, j: 1 };
  return { fromPair: local(raw[0]), toPair: local(raw[1]) };
}

function topOfEnd(end: EndCandidate, pair: RawPair | undefined): AtomId | "tie" | Undecided {
  if (pair === undefined) return UNSUPPORTED;
  if (pair.cmp === 0) return "tie";
  if (isUndecided(pair.cmp)) return pair.cmp;
  const winner = end.ligands[pair.cmp > 0 ? 0 : 1]!;
  return winner.kind === "atom" ? winner.atomId : UNSUPPORTED;
}

/**
 * The senior substituent atom at each end of `bondId` under every rule, with
 * `config` for rules 3-5. Undefined when the bond is not a unit.
 */
export function rankStereoDoubleBond(
  mol: Molecule,
  bondId: BondId,
  config?: CipConfiguration,
): CipDoubleBondRanking | undefined {
  const units = cipUnits(mol);
  const unit = units.doubleBondById.get(bondId);
  if (unit === undefined) return undefined;
  const constitution = unit.constitution;
  if (constitution.kind !== "tied") return constitution;
  if (config === undefined) return { kind: "undetermined", reason: "ranking-unsupported" };
  const candidate = DOUBLE_BOND_CANDIDATES.get(unit);
  if (candidate === undefined) return { kind: "undetermined", reason: "ranking-unsupported" };
  const context: RankContext = { units, config, mancude: mancudeTable(mol) };
  const { fromPair, toPair } = rankDoubleBondPairs(mol, candidate, context, ALL_RULES);
  const topFrom = topOfEnd(candidate.from, fromPair);
  const topTo = topOfEnd(candidate.to, toPair);
  if (topFrom === "tie" || topTo === "tie") return { kind: "not-stereogenic" };
  if (typeof topFrom === "number") return { kind: "undetermined", reason: reasonOf(topFrom) };
  if (typeof topTo === "number") return { kind: "undetermined", reason: reasonOf(topTo) };
  // A rule-5 decision at an end is seqCis/seqTrans, refused (E12).
  if (fromPair?.rule5 === true || toPair?.rule5 === true) {
    return { kind: "undetermined", reason: "ranking-unsupported" };
  }
  return { kind: "ranked", topOnFrom: topFrom, topOnTo: topTo };
}

/**
 * Rules 1-2 order of two neighbours `a` and `b` of `centre`, for callers that
 * need "are these two groups the same" without a unit, such as stereo-axes.ts.
 */
export function rankSubstituentPair(
  mol: Molecule,
  centre: AtomId,
  a: AtomId,
  b: AtomId,
): CipPairOrder {
  const context: RankContext = {
    units: undefined,
    config: undefined,
    mancude: mancudeTable(mol),
    rootDuplicates: true,
  };
  const build = (g: Digraph): (Ligand | undefined)[] => {
    const root = atomNode(g, centre, undefined, undefined, 0);
    const kids = childrenOf(g, root);
    return [a, b].map((id): Ligand | undefined => {
      const kid = kids.find((k) => k.kind === "atom" && k.atomId === id);
      return kid === undefined ? undefined : { dir: [kid, root], ref: { kind: "atom", atomId: id } };
    });
  };
  const [pair] = rankPairs(mol, context, CONSTITUTIONAL, build, false, [[0, 1]]);
  if (pair === undefined) return { kind: "undetermined", reason: "ranking-unsupported" };
  if (isUndecided(pair.cmp)) return { kind: "undetermined", reason: reasonOf(pair.cmp) };
  if (pair.cmp === 0) return { kind: "identical" };
  return { kind: "ordered", aFirst: pair.cmp > 0 };
}

// ---------------------------------------------------------------------------
// Unit classification
// ---------------------------------------------------------------------------

/**
 * An explicit hydrogen atom that is chemically an implicit one: natural
 * isotope, uncharged, not a radical, bonded to nothing but its one neighbour.
 */
export function isProtiumAtom(mol: Molecule, atomId: AtomId): boolean {
  const atom = getAtom(mol, atomId);
  if (atom === undefined || atom.element !== "H") return false;
  if (atom.isotope !== undefined && atom.isotope !== 1) return false;
  if (atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  if (implicitHydrogenCount(mol, atomId) !== 0) return false;
  return bondsAt(mol, atomId).length === 1;
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
 * rings sharing two or more bonds, one of which is a bond of this atom.
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
 * A neutral four-coordinate P or S whose sigma ligands include a doubly
 * bonded atom (decisions 31 and 43): P with exactly one double bond, to O, S,
 * N or C (the ylide); S with exactly two, one to O and one to N or both to O.
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
    return doubles.length === 1 && ["O", "S", "N", "C"].includes(partners[0]!);
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
 * Three-coordinate atoms whose lone pair is a configurationally stable fourth
 * ligand: sulfoxide S=O and sulfilimine S=N, selenoxide Se=O, sulfonium S⁺,
 * P(III) and As(III), and nitrogen in an aziridine or at a bridged bridgehead.
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
  const oneDoubleTo = (elements: readonly string[]): boolean => {
    const doubles = bonds.filter((bond) => bond.order === 2);
    return (
      bonds.length === 3 &&
      doubles.length === 1 &&
      bonds.filter((bond) => bond.order === 1).length === 2 &&
      elements.includes(requireAtom(mol, otherEnd(doubles[0]!, atomId)).element)
    );
  };

  let structural = false;
  if (atom.element === "S" && atom.charge === 0) {
    structural = oneDoubleTo(["O", "N"]) && !hasHydrogen;
  } else if (atom.element === "Se" && atom.charge === 0) {
    structural = oneDoubleTo(["O"]) && !hasHydrogen;
  } else if (atom.element === "S" && atom.charge === 1) {
    structural = allSingle && !hasHydrogen;
  } else if ((atom.element === "P" || atom.element === "As") && atom.charge === 0) {
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
  // A sanity check against the electron count. A pin is display-only.
  const pairs = lonePairCount(mol, atomId);
  if (pairs.kind === "unknown") return false;
  return pairs.kind === "pinned" || pairs.pairs >= 1;
}

function byAtomId(x: CipLigand, y: CipLigand): number {
  return compareIds(x.kind === "atom" ? x.atomId : "", y.kind === "atom" ? y.atomId : "");
}

function classifyCentre(mol: Molecule, atomId: AtomId): CentreCandidate | undefined {
  const bonds = bondsAt(mol, atomId);
  const implicitHydrogens = implicitHydrogenCount(mol, atomId);
  if (implicitHydrogens > 1) return undefined;
  let lonePair: boolean;
  if (bonds.length + implicitHydrogens === 4 && bonds.every((bond) => bond.order === 1)) {
    lonePair = false;
  } else if (isMultiplyBondedFourLigandCentre(mol, atomId, bonds, implicitHydrogens)) {
    lonePair = false;
  } else if (isPhantomLonePairCentre(mol, atomId, bonds, implicitHydrogens)) {
    lonePair = true;
  } else {
    return undefined;
  }
  const ligands: CipLigand[] = bonds
    .map((bond): CipLigand => ({ kind: "atom", atomId: otherEnd(bond, atomId), bondId: bond.id }))
    .sort(byAtomId);
  if (implicitHydrogens === 1) ligands.push({ kind: "implicitHydrogen" });
  if (lonePair) ligands.push({ kind: "lonePair" });
  return { atomId, ligands, implicitHydrogen: implicitHydrogens === 1, lonePair };
}

/** The largest ring a double bond may sit in and still be excluded from E/Z. */
const SMALL_RING_LIMIT = 7;

/** Whether a double-bond end at `atomId` takes a lone pair as its second ligand. */
function endHasLonePair(mol: Molecule, atomId: AtomId, doubleBondId: BondId): boolean {
  const atom = requireAtom(mol, atomId);
  if (atom.element !== "N" || atom.charge !== 0 || atom.radicalElectrons !== 0) return false;
  const others = bondsAt(mol, atomId).filter((bond) => bond.id !== doubleBondId);
  if (others.length + implicitHydrogenCount(mol, atomId) !== 1) return false;
  const pairs = lonePairCount(mol, atomId);
  return pairs.kind !== "unknown" && pairs.pairs >= 1;
}

/**
 * The double-bond ends that are planar: carbon and nitrogen, as in RDKit's
 * C=C, C=N and N=N units. A sulfilimine S=N or an ylide P=C is pyramidal at
 * the heteroatom, which is a centre (classifyCentre), not an E/Z end.
 */
const PLANAR_END_ELEMENTS: ReadonlySet<string> = new Set(["C", "N"]);

function classifyEnd(mol: Molecule, atomId: AtomId, doubleBondId: BondId): EndCandidate | undefined {
  if (!PLANAR_END_ELEMENTS.has(requireAtom(mol, atomId).element)) return undefined;
  const ligands: CipLigand[] = [];
  for (const bond of bondsAt(mol, atomId)) {
    if (bond.id === doubleBondId) continue;
    // A second multiple bond at this end is a cumulene or an sp centre.
    if (bond.order !== 1) return undefined;
    ligands.push({ kind: "atom", atomId: otherEnd(bond, atomId), bondId: bond.id });
  }
  ligands.sort(byAtomId);
  const hydrogens = implicitHydrogenCount(mol, atomId);
  for (let k = 0; k < hydrogens; k++) ligands.push({ kind: "implicitHydrogen" });
  if (endHasLonePair(mol, atomId, doubleBondId)) ligands.push({ kind: "lonePair" });
  if (ligands.length !== 2) return undefined;
  const heavy = ligands.filter((ligand) => ligand.kind === "atom" && !isProtiumAtom(mol, ligand.atomId));
  if (heavy.length === 0) {
    // Two hydrogens (=CH2), or an N–H imine end with only its lone pair left.
    return undefined;
  }
  return { atomId, ligands };
}

function classifyDoubleBond(mol: Molecule, bondId: BondId): DoubleBondCandidate | undefined {
  const bond = mol.bonds[bondId];
  if (bond === undefined || bond.order !== 2) return undefined;
  if (isAromaticBond(mol, bondId)) return undefined;
  for (const ringIndex of ringsAtBond(mol, bondId)) {
    if (ringSize(mol, ringIndex) <= SMALL_RING_LIMIT) return undefined;
  }
  const from = classifyEnd(mol, bond.from, bondId);
  const to = classifyEnd(mol, bond.to, bondId);
  if (from === undefined || to === undefined) return undefined;
  return { bondId, from, to };
}

// ---------------------------------------------------------------------------
// Units, perceived to the greatest fixed point
// ---------------------------------------------------------------------------

const DOUBLE_BOND_CANDIDATES = new WeakMap<CipDoubleBondUnit, DoubleBondCandidate>();

/** Classes of ligand indices tied under rules 1-2. */
function tieClasses(n: number, pairs: readonly RawPair[]): number[][] {
  const parent = [...Array(n).keys()];
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x]!;
    return x;
  };
  for (const pair of pairs) {
    if (pair.cmp === 0) parent[find(pair.i)] = find(pair.j);
  }
  const groups = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), k]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function reachAvoiding(mol: Molecule, starts: readonly AtomId[], avoid: AtomId): Set<AtomId> {
  const seen = new Set<AtomId>(starts);
  const stack = [...starts];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const bond of bondsAt(mol, id)) {
      const other = otherEnd(bond, id);
      if (other === avoid || seen.has(other)) continue;
      seen.add(other);
      stack.push(other);
    }
  }
  return seen;
}

/**
 * Each tie class of a unit as the atoms its branches reach, or undefined when
 * a tie rules the unit out by itself: three identical ligands, or two
 * hydrogens or lone pairs.
 */
function tieReaches(
  mol: Molecule,
  anchor: AtomId,
  ligands: readonly CipLigand[],
  pairs: readonly RawPair[],
): ReadonlySet<AtomId>[] | undefined {
  const reaches: ReadonlySet<AtomId>[] = [];
  for (const group of tieClasses(ligands.length, pairs)) {
    if (group.length > 2) return undefined;
    const starts: AtomId[] = [];
    for (const k of group) {
      const ligand = ligands[k]!;
      if (ligand.kind !== "atom" || isProtiumAtom(mol, ligand.atomId)) return undefined;
      starts.push(ligand.atomId);
    }
    reaches.push(reachAvoiding(mol, starts, anchor));
  }
  return reaches;
}

interface Pending {
  readonly key: string;
  readonly atoms: readonly AtomId[];
  readonly reaches: readonly ReadonlySet<AtomId>[];
}

function computeUnits(mol: Molecule): CipUnits {
  const context: RankContext = { units: undefined, config: undefined, mancude: mancudeTable(mol) };
  const centreRaw = new Map<AtomId, { candidate: CentreCandidate; pairs: RawPair[] }>();
  const bondRaw = new Map<
    BondId,
    { candidate: DoubleBondCandidate; fromPair: RawPair | undefined; toPair: RawPair | undefined }
  >();
  const pending: Pending[] = [];

  for (const atomId of [...mol.atomIds].sort(compareIds)) {
    const candidate = classifyCentre(mol, atomId);
    if (candidate === undefined) continue;
    const pairs = rankCentrePairs(mol, candidate, context, CONSTITUTIONAL);
    const reaches = tieReaches(mol, atomId, candidate.ligands, pairs);
    if (reaches === undefined) continue;
    centreRaw.set(atomId, { candidate, pairs });
    pending.push({ key: `c:${atomId}`, atoms: [atomId], reaches });
  }

  for (const bondId of [...mol.bondIds].sort(compareIds)) {
    const candidate = classifyDoubleBond(mol, bondId);
    if (candidate === undefined) continue;
    const { fromPair, toPair } = rankDoubleBondPairs(mol, candidate, context, CONSTITUTIONAL);
    const reaches: ReadonlySet<AtomId>[] = [];
    let excluded = false;
    for (const [end, pair] of [
      [candidate.from, fromPair],
      [candidate.to, toPair],
    ] as const) {
      if (pair === undefined) continue;
      const found = tieReaches(mol, end.atomId, end.ligands, [pair]);
      if (found === undefined) excluded = true;
      else reaches.push(...found);
    }
    if (excluded) continue;
    bondRaw.set(bondId, { candidate, fromPair, toPair });
    const bond = requireBond(mol, bondId);
    pending.push({ key: `b:${bondId}`, atoms: [bond.from, bond.to], reaches });
  }

  // Greatest fixed point: drop a unit whose tied branches reach no survivor.
  const alive = new Map(pending.map((unit) => [unit.key, unit]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of [...alive.values()]) {
      if (unit.reaches.length === 0) continue;
      const satisfied = unit.reaches.every((reach) => {
        for (const other of alive.values()) {
          if (other.key === unit.key) continue;
          if (other.atoms.some((id) => reach.has(id) && !unit.atoms.includes(id))) return true;
        }
        return false;
      });
      if (!satisfied) {
        alive.delete(unit.key);
        changed = true;
      }
    }
  }

  const centres: CipCentreUnit[] = [];
  for (const [atomId, { candidate, pairs }] of centreRaw) {
    if (!alive.has(`c:${atomId}`)) continue;
    let constitution: CipConstitution;
    const undecided = pairs.find((pair) => isUndecided(pair.cmp));
    if (pairs.some((pair) => pair.cmp === 0)) constitution = { kind: "tied" };
    else if (undecided !== undefined) {
      constitution = { kind: "undetermined", reason: reasonOf(undecided.cmp as Undecided) };
    } else {
      constitution = { kind: "ranked", order: Object.freeze(orderFromPairs(candidate.ligands, pairs)) };
    }
    centres.push(
      Object.freeze({
        atomId,
        ligands: Object.freeze([...candidate.ligands]),
        implicitHydrogen: candidate.implicitHydrogen,
        lonePair: candidate.lonePair,
        constitution: Object.freeze(constitution),
      }),
    );
  }

  const doubleBonds: CipDoubleBondUnit[] = [];
  for (const [bondId, { candidate, fromPair, toPair }] of bondRaw) {
    if (!alive.has(`b:${bondId}`)) continue;
    const refOnFrom = firstHeavyAtom(mol, candidate.from);
    const refOnTo = firstHeavyAtom(mol, candidate.to);
    if (refOnFrom === undefined || refOnTo === undefined) continue;
    const topFrom = topOfEnd(candidate.from, fromPair);
    const topTo = topOfEnd(candidate.to, toPair);
    let constitution: CipDoubleBondConstitution;
    if (topFrom === "tie" || topTo === "tie") constitution = { kind: "tied" };
    else if (typeof topFrom === "number") constitution = { kind: "undetermined", reason: reasonOf(topFrom) };
    else if (typeof topTo === "number") constitution = { kind: "undetermined", reason: reasonOf(topTo) };
    else constitution = { kind: "ranked", topOnFrom: topFrom, topOnTo: topTo };
    const unit: CipDoubleBondUnit = Object.freeze({
      bondId,
      refOnFrom,
      refOnTo,
      constitution: Object.freeze(constitution),
    });
    DOUBLE_BOND_CANDIDATES.set(unit, candidate);
    doubleBonds.push(unit);
  }

  return Object.freeze({
    centres: Object.freeze(centres),
    doubleBonds: Object.freeze(doubleBonds),
    centreById: new Map(centres.map((unit) => [unit.atomId, unit])),
    doubleBondById: new Map(doubleBonds.map((unit) => [unit.bondId, unit])),
  });
}

/** The reference atom at one end: its lowest-id atom substituent. */
function firstHeavyAtom(mol: Molecule, end: EndCandidate): AtomId | undefined {
  for (const ligand of end.ligands) {
    if (ligand.kind === "atom") return ligand.atomId;
  }
  void mol;
  return undefined;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** NUL cannot occur in an id, so the encoding stays injective (as rings.ts). */
const SEP = String.fromCharCode(0);

/** Bumped if the fingerprint contents change, so an old entry never matches. */
const FINGERPRINT_VERSION = "C1";

/**
 * Everything unit perception reads and nothing it does not: rings.ts's key
 * refined with element, charge, radicals, isotope, hydrogen and lone-pair
 * pins, bond orders and aromatic flags (decision 33d). Positions, `stereo`
 * and `doubleBondSide` are out, so a drag reuses the entry.
 */
export function cipTopologyFingerprint(mol: Molecule): string {
  const parts: string[] = [FINGERPRINT_VERSION];
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

const UNITS_BY_INSTANCE = new WeakMap<Molecule, CipUnits>();
const UNITS_BY_FINGERPRINT = new LruCache<CipUnits>(32);

/** Every stereogenic unit of `mol`, memoised on the topology so a drag reuses it. */
export function cipUnits(mol: Molecule): CipUnits {
  const hit = UNITS_BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = UNITS_BY_FINGERPRINT.get(key);
  if (shared) {
    UNITS_BY_INSTANCE.set(mol, shared);
    return shared;
  }
  const built = computeUnits(mol);
  UNITS_BY_FINGERPRINT.set(key, built);
  UNITS_BY_INSTANCE.set(mol, built);
  return built;
}
