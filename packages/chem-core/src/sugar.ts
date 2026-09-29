/**
 * Monosaccharides: sugar rings, the anomeric carbon, carbohydrate numbering,
 * D/L, alpha/beta, and the edit that links an open chain to its ring.
 *
 * ONE MODULE for the topology and the configuration, because they depend on
 * each other both ways: alpha/beta is referred to a NUMBERED atom, and the
 * numbering of a ring form starts at the anomeric carbon. Split in two, the
 * halves would import each other.
 *
 * WHAT THIS IS NOT. The numbering here is carbohydrate numbering (IUPAC-IUBMB
 * 2-Carb-2) for the recognised classes, and nothing else: a general IUPAC
 * locant needs principal-chain and characteristic-group selection, which is
 * most of a naming engine. Anything these rules do not number stays
 * unnumbered (numbering.ts). No figure should present these as IUPAC locants
 * of the whole molecule.
 *
 * SUGAR RINGS (topology only). A saturated ring of 5 (furanose) or 6
 * (pyranose) atoms with EXACTLY ONE ring heteroatom. The ANOMERIC CARBON is
 * the ring carbon bonded to BOTH that heteroatom and an exocyclic heteroatom:
 * a hemiacetal or acetal O, a glycosylamine or nucleoside N, a thioglycoside
 * S, or a glycosyl halide. Not "the ring carbon with an OH": C4 and C2 have
 * one too, and the discriminator is the bond to the ring heteroatom. The
 * anomeric carbon is sp3: a ring whose carbon next to the heteroatom carries
 * a C=O instead (glucono-1,5-lactone) is a LACTONE, reported undetermined,
 * never a pyranose (decision 158). Two cases are not guessed:
 *   - a ring with two heteroatoms (a 1,3-oxathiolane, a benzylidene acetal's
 *     dioxane) is `undetermined` until the ring heteroatom is designated;
 *   - a C-GLYCOSIDE's anomeric carbon carries a carbon, which by topology is
 *     indistinguishable from C5 carrying C6, so it is `needsChoice` with both
 *     candidates until one is designated.
 * The anomeric SUBSTITUENT is the exocyclic ATOM at the anomeric carbon — O,
 * N, S, a halogen, or for a designated C-glycoside a carbon — never "the
 * exocyclic oxygen". Defining alpha/beta over the oxygen would exclude every
 * nucleoside, and beta-D-ribofuranosyl adenine is the most-drawn furanose in
 * biochemistry.
 *
 * CARBOHYDRATE CHAINS. An open chain is anchored on its aldehyde or ketone
 * carbon; a ring form on its anomeric carbon, with the chain running through
 * the ring carbons to the ring-closing carbon and on through any exocyclic
 * carbons. Longest-chain-alone is indeterminate for an aldose (glucose would
 * number from either end depending on atom order); the anchor is what fixes
 * C1. An aldose numbers from the aldehyde, so the CHO is C1; a ketose from
 * the end nearer the carbonyl, which puts fructose's CH2OH above its C2. A
 * chain qualifies only with at least two carbons besides the anchor bearing a
 * heteroatom (the ring heteroatom counts for the ring-closing carbon), so
 * oxan-2-ol is a hemiacetal ring but not numbered 1 to 5 (decision 142).
 * Where the parent chain ties (two branches of one length, or a ketone equally
 * far from both ends) numbering stops rather than choosing by atom id. An
 * acyclic skeleton holding two carbonyls (an osone, a dialdose, streptose's
 * formyl branch) is not numbered at all: which one is C1 needs principal-chain
 * rules this module does not have (decision 156). A nucleoside's sugar is
 * primed, 1′ to 5′; other residues are not.
 *
 * TWO REFERENCE ATOMS. `configurationalAtom` — the highest-numbered
 * stereocentre of the chain — fixes D/L. `anomericReferenceAtom` is what
 * alpha/beta is referred to. Per IUPAC 2-Carb-6.2 they are the SAME atom
 * unless the name needs more than one configurational prefix, i.e. more than
 * four chain stereocentres: then the centres are grouped in fours from the
 * lowest-numbered one and the reference atom is the highest of that first
 * group (C5 against configurational C6 in L-glycero-D-manno-heptose, C7 against
 * C8 in N-acetylneuraminic acid). "For simple aldoses up to aldohexoses, and
 * ketoses up to hept-2-uloses, the anomeric reference atom and the
 * configurational atom are the same" — including every hexofuranose, whose
 * reference atom is C5 although C5 is outside the ring (decision 141).
 *
 * D/L AND ALPHA/BETA are read on a Fischer projection, from the configuration
 * and never from R/S or the drawing's orientation (fischer-side.ts, decisions
 * 132 and 144). D: the configurational atom's heteroatom substituent is on
 * the right with the chain vertical and C1 up. Alpha: the anomeric
 * substituent is formally CIS to the reference atom's oxygen in the Fischer
 * projection, i.e. on the same side. At the anomeric carbon that projection
 * is the Fischer-Tollens form, with the ring heteroatom on the UPPER vertical
 * bond (2-Carb-5: for ketoses "C-2 is rotated about the bond with C-3 to
 * accommodate the long bond"); put the heteroatom on a horizontal bond and
 * alpha-D-glucopyranose reads beta. Nothing here says which way an anomeric
 * substituent points in any drawing: that is a Haworth-orientation question
 * and depends on D/L.
 *
 * THE RING-CHAIN EDIT (decisions 104 and 143). `cycliseSugar` is an ordinary
 * pure edit: the carbonyl oxygen becomes the anomeric OH and the ring oxygen
 * comes from the chain's hydroxyl — swapping those gives the right formula,
 * the wrong molecule, and a ring that still draws. The anomer is a required
 * argument, and `mixture` (a wavy bond) is the honest answer to mutarotation;
 * nothing ever defaults to alpha. `openRing` inverts it; the generic
 * removeBond would leave a C–OH where the C=O belongs, a hemiacetal that
 * never re-opens. Every pre-existing centre keeps its parity against its own
 * ligand ORDER across the edit, but NOT necessarily its R/S letter: C5's
 * ligands go from (C4, C6, OH, H) to (C4, C6, ring O, H), so its CIP
 * priorities and letter may legitimately move.
 */

import {
  chainCarbonNeighbours,
  chainSkeletons,
  extendChain,
  isChainCarbon,
  type ChainExtension,
} from "./carbon-chain.js";
import { cipTopologyFingerprint } from "./cip.js";
import {
  fischerCrossParity,
  fischerSide,
  type DLConfiguration,
  type FischerArms,
  type FischerSideUndeterminedReason,
} from "./fischer-side.js";
import { addBond, bondBetween, bondsAt, getAtom, otherEnd, requireAtom } from "./molecule.js";
import { removeAtoms, removeBond, setAtomPositions, updateAtom, updateBond } from "./ops.js";
import type { TetrahedralParity } from "./parity.js";
import { isRingAtom, isRingBond, LruCache, rings } from "./rings.js";
import { compareIds } from "./selection.js";
import {
  ligandRefs,
  parityAgainst,
  readConfig,
  stereoConfig,
  stereoTopology,
  type StereoConfig,
} from "./stereo-config.js";
import {
  prunedStereoGroups,
  stereoGroupAt,
  stereoGroupsOf,
  withStereoGroups,
} from "./stereo-groups.js";
import { regularRingVertices } from "./templates.js";
import { medianBondLength } from "./transform.js";
import type { AtomId, Bond, BondId, Molecule } from "./types.js";
import { implicitHydrogenCount } from "./valence.js";
import { sub, type Vec2 } from "./vec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SugarRingForm = "pyranose" | "furanose";

export interface SugarRing {
  readonly form: SugarRingForm;
  /**
   * The ring walk: the ring heteroatom, the anomeric carbon, then round the
   * ring to the ring-closing carbon. `ringAtomIds[2]` is the ring carbon after
   * the anomeric one (C2 of an aldose, C3 of a 2-ketose).
   */
  readonly ringAtomIds: readonly AtomId[];
  readonly ringHeteroatom: AtomId;
  readonly anomericCarbon: AtomId;
  /** The exocyclic atom at the anomeric carbon: O, N, S, a halogen, or C. */
  readonly anomericSubstituent: AtomId;
  /** The other ring carbon bonded to the heteroatom: C5 of a pyranose. */
  readonly ringClosingCarbon: AtomId;
}

/** Explicit choices that settle what topology alone cannot. */
export interface SugarRingDesignation {
  readonly ringHeteroatom?: AtomId | undefined;
  readonly anomericCarbon?: AtomId | undefined;
  readonly anomericSubstituent?: AtomId | undefined;
}

export type SugarRingUndeterminedReason =
  | "not-a-ring"
  | "ring-size"
  | "unsaturated-ring"
  | "no-ring-heteroatom"
  /** More than one heteroatom in the ring: designate `ringHeteroatom`. */
  | "ring-heteroatoms"
  | "not-a-ring-heteroatom"
  /**
   * A carbon next to the ring heteroatom is double-bonded to a heteroatom out
   * of the ring: a lactone (glucono-1,5-lactone), lactam or thionolactone.
   * That carbon is at the oxidation level of an ester, not an anomeric centre,
   * and no designation makes it one (decision 158).
   */
  | "lactone"
  | "no-anomeric-carbon"
  | "not-an-anomeric-candidate"
  | "no-anomeric-substituent"
  | "not-an-anomeric-substituent";

export type SugarRingChoice = "anomericCarbon" | "anomericSubstituent";

export type SugarRingPerception =
  | { readonly kind: "sugarRing"; readonly ring: SugarRing }
  | {
      readonly kind: "needsChoice";
      readonly choice: SugarRingChoice;
      readonly ringAtomIds: readonly AtomId[];
      readonly candidates: readonly AtomId[];
    }
  | {
      readonly kind: "undetermined";
      readonly reason: SugarRingUndeterminedReason;
      readonly ringAtomIds: readonly AtomId[];
      /** What to look at or designate. */
      readonly atomIds: readonly AtomId[];
    };

export type CarbohydrateForm = "open" | SugarRingForm;

/**
 * A carbohydrate chain and its numbering.
 *
 * `backbone` lists the NUMBERED chain carbons in locant order, and
 * `backbone[i]` has locant `firstLocant + i`. It can start above 1 and can be
 * shorter than the chain: numbering stops before a tie (decision 142).
 */
export interface Carbohydrate {
  readonly form: CarbohydrateForm;
  /** The parent's class: the anchor is an aldehyde carbon, or a ketone's. */
  readonly parent: "aldose" | "ketose";
  /** The aldehyde or ketone carbon; in a ring form, the anomeric carbon. */
  readonly anchor: AtomId;
  readonly ring?: SugarRing;
  readonly backbone: readonly AtomId[];
  readonly firstLocant: number;
  /** A nucleoside's sugar: locants carry a prime, 1′ to 5′. */
  readonly primed: boolean;
  /** True when the chain reads the same from both ends: only the anchor is numbered. */
  readonly directionTied: boolean;
  /** Where the parent chain stopped because two branches tied. */
  readonly tiedAt?: AtomId;
  /** Chain carbons the numbering does not reach because of a tie. */
  readonly beyondTie: readonly AtomId[];
}

/** An anomeric configuration, read against the anomeric reference atom. */
export type AnomericConfiguration =
  | {
      readonly kind: "alpha" | "beta";
      readonly anomericCarbon: AtomId;
      readonly referenceAtom: AtomId;
      readonly substituent: AtomId;
    }
  /** A wavy bond at the anomeric carbon: both anomers, as after mutarotation. */
  | { readonly kind: "mixture"; readonly anomericCarbon: AtomId }
  | { readonly kind: "notApplicable"; readonly reason: "open-chain" }
  | {
      readonly kind: "undetermined";
      readonly reason: AnomericUndeterminedReason;
      readonly atomId?: AtomId;
    };

export type AnomericUndeterminedReason =
  | FischerSideUndeterminedReason
  | "no-reference-atom"
  /** The reference atom carries a wavy bond: nothing to be cis or trans to. */
  | "reference-mixture"
  | "no-side-substituent";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const PRIME = "′";

function isHetero(element: string | undefined): boolean {
  return element !== undefined && element !== "C" && element !== "H";
}

/** Neighbours that are not hydrogen atoms, drawn H and D included. */
function heavyNeighbours(mol: Molecule, atomId: AtomId): AtomId[] {
  return bondsAt(mol, atomId)
    .map((bond) => otherEnd(bond, atomId))
    .filter((id) => mol.atoms[id]?.element !== "H");
}

/** Every hydrogen on the atom, implicit or drawn. */
function hydrogenCount(mol: Molecule, atomId: AtomId): number {
  const drawn = bondsAt(mol, atomId).filter(
    (bond) => mol.atoms[otherEnd(bond, atomId)]?.element === "H",
  ).length;
  return implicitHydrogenCount(mol, atomId) + drawn;
}

function sortIds(ids: Iterable<AtomId>): AtomId[] {
  return [...ids].sort(compareIds);
}

/** `ids` as one simple cycle in walk order, or undefined. */
function simpleRingWalk(mol: Molecule, ids: readonly AtomId[]): AtomId[] | undefined {
  const set = new Set(ids);
  if (set.size < 3) return undefined;
  const inSet = new Map<AtomId, AtomId[]>();
  for (const id of set) {
    if (!Object.hasOwn(mol.atoms, id)) return undefined;
    const neighbours = bondsAt(mol, id)
      .map((bond) => otherEnd(bond, id))
      .filter((other) => set.has(other));
    if (neighbours.length !== 2) return undefined;
    inSet.set(id, neighbours);
  }
  const first = sortIds(set)[0]!;
  const walk = [first];
  let previous = first;
  let current = inSet.get(first)![0]!;
  while (current !== first) {
    if (walk.length >= set.size) return undefined;
    walk.push(current);
    const [x, y] = inSet.get(current)!;
    const next = x === previous ? y! : x!;
    previous = current;
    current = next;
  }
  return walk.length === set.size ? walk : undefined;
}

/** The bonds from `atomId` to atoms outside `ring`. */
function exocyclicBonds(mol: Molecule, atomId: AtomId, ring: ReadonlySet<AtomId>): Bond[] {
  return bondsAt(mol, atomId).filter((bond) => !ring.has(otherEnd(bond, atomId)));
}

function isSaturatedRing(mol: Molecule, walk: readonly AtomId[]): boolean {
  for (let i = 0; i < walk.length; i++) {
    const a = walk[i]!;
    const b = walk[(i + 1) % walk.length]!;
    const bond = bondBetween(mol, a, b);
    if (bond === undefined || bond.order !== 1 || bond.aromatic) return false;
    if (mol.atoms[a]!.aromatic) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sugar rings
// ---------------------------------------------------------------------------

function undeterminedRing(
  reason: SugarRingUndeterminedReason,
  ringAtomIds: readonly AtomId[],
  atomIds: readonly AtomId[],
): SugarRingPerception {
  return Object.freeze({
    kind: "undetermined",
    reason,
    ringAtomIds: Object.freeze([...ringAtomIds]),
    atomIds: Object.freeze(sortIds(atomIds)),
  });
}

function needsChoice(
  choice: SugarRingChoice,
  ringAtomIds: readonly AtomId[],
  candidates: readonly AtomId[],
): SugarRingPerception {
  return Object.freeze({
    kind: "needsChoice",
    choice,
    ringAtomIds: Object.freeze([...ringAtomIds]),
    candidates: Object.freeze(sortIds(candidates)),
  });
}

/**
 * Reads one ring, given as an atom-id SET, as a sugar ring.
 *
 * `designation` supplies what topology cannot decide: the ring heteroatom of
 * a ring with two, the anomeric carbon of a C-glycoside, the anomeric
 * substituent where the anomeric carbon carries two candidates. A designation
 * that names an impossible atom is `undetermined`, not ignored.
 */
export function perceiveSugarRing(
  mol: Molecule,
  ringAtomIds: readonly AtomId[],
  designation: SugarRingDesignation = {},
): SugarRingPerception {
  const walk = simpleRingWalk(mol, ringAtomIds);
  if (walk === undefined) return undeterminedRing("not-a-ring", ringAtomIds, ringAtomIds);
  const n = walk.length;
  if (n !== 5 && n !== 6) return undeterminedRing("ring-size", walk, walk);
  if (!isSaturatedRing(mol, walk)) return undeterminedRing("unsaturated-ring", walk, walk);

  const heteroatoms = walk.filter((id) => mol.atoms[id]!.element !== "C");
  let z: AtomId;
  if (designation.ringHeteroatom !== undefined) {
    if (!heteroatoms.includes(designation.ringHeteroatom)) {
      return undeterminedRing("not-a-ring-heteroatom", walk, [designation.ringHeteroatom]);
    }
    z = designation.ringHeteroatom;
  } else if (heteroatoms.length === 0) {
    return undeterminedRing("no-ring-heteroatom", walk, walk);
  } else if (heteroatoms.length > 1) {
    return undeterminedRing("ring-heteroatoms", walk, heteroatoms);
  } else {
    z = heteroatoms[0]!;
  }

  const ring = new Set(walk);
  const zi = walk.indexOf(z);
  const nextToZ = [walk[(zi + 1) % n]!, walk[(zi + n - 1) % n]!].filter(
    (id) => mol.atoms[id]!.element === "C",
  );
  // An anomeric carbon is sp3: every bond out of the ring is single. One
  // double-bonded to a heteroatom makes the ring a lactone, which is refused
  // whatever is designated; one double-bonded to a carbon (an exo-glycal) is
  // simply not a candidate.
  const lactone = nextToZ.filter((id) =>
    exocyclicBonds(mol, id, ring).some(
      (bond) => bond.order !== 1 && isHetero(mol.atoms[otherEnd(bond, id)]?.element),
    ),
  );
  if (lactone.length > 0) return undeterminedRing("lactone", walk, lactone);
  const alpha = nextToZ.filter((id) =>
    exocyclicBonds(mol, id, ring).every((bond) => bond.order === 1 && !bond.aromatic),
  );
  const exocyclic = (id: AtomId): AtomId[] => heavyNeighbours(mol, id).filter((o) => !ring.has(o));
  const exoHetero = (id: AtomId): AtomId[] =>
    exocyclic(id).filter((o) => isHetero(mol.atoms[o]?.element));
  const exoCarbon = (id: AtomId): AtomId[] =>
    exocyclic(id).filter((o) => mol.atoms[o]?.element === "C");

  let a: AtomId;
  if (designation.anomericCarbon !== undefined) {
    if (!alpha.includes(designation.anomericCarbon)) {
      return undeterminedRing("not-an-anomeric-candidate", walk, [designation.anomericCarbon]);
    }
    a = designation.anomericCarbon;
  } else {
    const withHetero = alpha.filter((id) => exoHetero(id).length > 0);
    if (withHetero.length === 1) {
      a = withHetero[0]!;
    } else if (withHetero.length > 1) {
      return needsChoice("anomericCarbon", walk, withHetero);
    } else {
      // A C-glycoside's anomeric carbon carries a carbon, exactly as C5
      // carries C6: topology cannot tell them apart.
      const withCarbon = alpha.filter((id) => exoCarbon(id).length > 0);
      if (withCarbon.length > 0) return needsChoice("anomericCarbon", walk, withCarbon);
      return undeterminedRing("no-anomeric-carbon", walk, alpha);
    }
  }

  let x: AtomId;
  const hetero = exoHetero(a);
  const carbons = exoCarbon(a);
  if (designation.anomericSubstituent !== undefined) {
    const named = designation.anomericSubstituent;
    if (!hetero.includes(named) && !carbons.includes(named)) {
      return undeterminedRing("not-an-anomeric-substituent", walk, [named]);
    }
    x = designation.anomericSubstituent;
  } else if (hetero.length === 1) {
    x = hetero[0]!;
  } else if (hetero.length > 1) {
    return needsChoice("anomericSubstituent", walk, hetero);
  } else if (carbons.length === 1) {
    x = carbons[0]!;
  } else if (carbons.length > 1) {
    return needsChoice("anomericSubstituent", walk, carbons);
  } else {
    return undeterminedRing("no-anomeric-substituent", walk, [a]);
  }

  // Heteroatom first, then the anomeric carbon, then on round the ring.
  const ai = walk.indexOf(a);
  const step = (ai - zi + n) % n === 1 ? 1 : -1;
  const ordered: AtomId[] = [];
  for (let k = 0; k < n; k++) ordered.push(walk[(zi + step * k + n * n) % n]!);
  return Object.freeze({
    kind: "sugarRing",
    ring: Object.freeze({
      form: n === 6 ? "pyranose" : "furanose",
      ringAtomIds: Object.freeze(ordered),
      ringHeteroatom: z,
      anomericCarbon: a,
      anomericSubstituent: x,
      ringClosingCarbon: ordered[n - 1]!,
    }),
  });
}

/**
 * Whether a perceived ring is worth reporting as a possible sugar ring:
 * saturated, 5 or 6 atoms, a heteroatom in it, and a ring carbon next to a
 * ring heteroatom carrying something exocyclic. Tetrahydrofuran, piperidine
 * and dioxane are not; a C-glycoside and a benzylidene acetal's dioxane are,
 * and come back as a choice or undetermined rather than silently dropped.
 */
function isCandidateRing(mol: Molecule, walk: readonly AtomId[]): boolean {
  if (walk.length !== 5 && walk.length !== 6) return false;
  if (!isSaturatedRing(mol, walk)) return false;
  const ring = new Set(walk);
  const n = walk.length;
  for (let i = 0; i < n; i++) {
    if (mol.atoms[walk[i]!]!.element === "C") continue;
    for (const neighbour of [walk[(i + 1) % n]!, walk[(i + n - 1) % n]!]) {
      if (mol.atoms[neighbour]!.element !== "C") continue;
      // Single bonds only: a lactone's C=O alone does not make gamma-
      // butyrolactone look like a sugar. A sugar lactone still qualifies by
      // its C5 and comes back undetermined as a lactone.
      const substituted = exocyclicBonds(mol, neighbour, ring).some(
        (bond) => bond.order === 1 && mol.atoms[otherEnd(bond, neighbour)]?.element !== "H",
      );
      if (substituted) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Carbohydrate chains
// ---------------------------------------------------------------------------

interface ChainSides {
  readonly anchor: AtomId;
  readonly left: ChainExtension;
  readonly right: ChainExtension;
}

/** Numbers a chain from the end nearer the anchor (decision 142). */
function numberChain(sides: ChainSides): {
  readonly backbone: readonly AtomId[];
  readonly firstLocant: number;
  readonly directionTied: boolean;
} {
  const { anchor, left, right } = sides;
  if (left.depth === right.depth) {
    return { backbone: [anchor], firstLocant: left.depth + 1, directionTied: true };
  }
  const [low, high] = left.depth < right.depth ? [left, right] : [right, left];
  return {
    backbone: [...[...low.path].reverse(), anchor, ...high.path],
    firstLocant: low.depth + 1 - low.path.length,
    directionTied: false,
  };
}

/**
 * At least two chain carbons besides the anchor carry a heteroatom that is
 * not itself part of the chain. What makes a chain a carbohydrate rather than
 * any hydroxy aldehyde (decision 142).
 */
function isPolyhydroxy(mol: Molecule, sides: ChainSides): boolean {
  const chain = new Set([sides.anchor, ...sides.left.path, ...sides.right.path]);
  let count = 0;
  for (const id of chain) {
    if (id === sides.anchor) continue;
    if (heavyNeighbours(mol, id).some((o) => !chain.has(o) && isHetero(mol.atoms[o]?.element))) count++;
  }
  return count >= 2;
}

function makeCarbohydrate(
  sides: ChainSides,
  form: CarbohydrateForm,
  parent: "aldose" | "ketose",
  ring: SugarRing | undefined,
  primed: boolean,
): Carbohydrate {
  const numbered = numberChain(sides);
  const tiedAt = sides.left.tiedAt ?? sides.right.tiedAt;
  return Object.freeze({
    form,
    parent,
    anchor: sides.anchor,
    ...(ring === undefined ? {} : { ring }),
    backbone: Object.freeze([...numbered.backbone]),
    firstLocant: numbered.firstLocant,
    primed,
    directionTied: numbered.directionTied,
    ...(tiedAt === undefined ? {} : { tiedAt }),
    beyondTie: Object.freeze([...sides.left.beyondTie, ...sides.right.beyondTie]),
  });
}

interface CarbonylAnchor {
  readonly carbon: AtomId;
  readonly oxygen: AtomId;
  readonly carbons: readonly AtomId[];
}

/** An aldehyde or ketone carbon on an acyclic carbon chain, or undefined. */
function carbonylAnchor(mol: Molecule, atomId: AtomId): CarbonylAnchor | undefined {
  const atom = getAtom(mol, atomId);
  if (atom === undefined || atom.element !== "C" || atom.aromatic || isRingAtom(mol, atomId)) {
    return undefined;
  }
  let oxygen: AtomId | undefined;
  const carbons: AtomId[] = [];
  for (const bond of bondsAt(mol, atomId)) {
    const other = otherEnd(bond, atomId);
    const partner = mol.atoms[other]!;
    if (bond.aromatic) return undefined;
    if (bond.order === 2) {
      if (oxygen !== undefined || partner.element !== "O" || partner.charge !== 0) return undefined;
      if (bondsAt(mol, other).length !== 1) return undefined;
      oxygen = other;
    } else if (bond.order !== 1) {
      return undefined;
    } else if (partner.element === "C") {
      if (!isChainCarbon(mol, other)) return undefined;
      carbons.push(other);
    } else if (partner.element !== "H") {
      // An acid, ester, amide or acyl halide carbon is not a sugar carbonyl.
      return undefined;
    }
  }
  if (oxygen === undefined || atom.charge !== 0) return undefined;
  if (carbons.length === 1 && hydrogenCount(mol, atomId) === 1) {
    return { carbon: atomId, oxygen, carbons };
  }
  if (carbons.length === 2) return { carbon: atomId, oxygen, carbons: sortIds(carbons) };
  return undefined;
}

const NO_EXTENSION: ChainExtension = Object.freeze({ path: [], depth: 0, beyondTie: [] });

function openChainSides(mol: Molecule, anchor: CarbonylAnchor): ChainSides {
  const k = anchor.carbon;
  if (anchor.carbons.length === 1) {
    return { anchor: k, left: NO_EXTENSION, right: extendChain(mol, k, anchor.carbons) };
  }
  return {
    anchor: k,
    left: extendChain(mol, k, [anchor.carbons[0]!]),
    right: extendChain(mol, k, [anchor.carbons[1]!]),
  };
}

/**
 * The carbohydrate chain of a sugar ring, or undefined when the ring's
 * carbons and their exocyclic carbons do not make one (a ring path through a
 * second heteroatom, a chain with too few heteroatom-bearing carbons).
 */
export function carbohydrateOfRing(mol: Molecule, ring: SugarRing): Carbohydrate | undefined {
  const path = ring.ringAtomIds.slice(1);
  if (path.some((id) => mol.atoms[id]?.element !== "C")) return undefined;
  const ringSet = new Set(ring.ringAtomIds);
  const blocked = new Set([...ringSet, ring.anomericSubstituent]);
  const a = ring.anomericCarbon;
  const r = ring.ringClosingCarbon;
  const prefixStarts = chainCarbonNeighbours(mol, a).filter((id) => !blocked.has(id));
  const left = extendChain(mol, a, prefixStarts, blocked);
  const suffixStarts = chainCarbonNeighbours(mol, r).filter((id) => !blocked.has(id));
  const suffix = extendChain(mol, r, suffixStarts, blocked);
  const right: ChainExtension = {
    path: [...path.slice(1), ...suffix.path],
    depth: path.length - 1 + suffix.depth,
    ...(suffix.tiedAt === undefined ? {} : { tiedAt: suffix.tiedAt }),
    beyondTie: suffix.beyondTie,
  };
  const sides: ChainSides = { anchor: a, left, right };
  if (!isPolyhydroxy(mol, sides)) return undefined;
  const x = ring.anomericSubstituent;
  const primed = mol.atoms[x]?.element === "N" && isRingAtom(mol, x);
  return makeCarbohydrate(
    sides,
    ring.form,
    left.depth === 0 ? "aldose" : "ketose",
    ring,
    primed,
  );
}

interface SugarPerception {
  readonly rings: readonly SugarRingPerception[];
  readonly carbohydrates: readonly Carbohydrate[];
}

let perceptionComputations = 0;

function computePerception(mol: Molecule): SugarPerception {
  perceptionComputations++;
  const ringResults: SugarRingPerception[] = [];
  const units: Carbohydrate[] = [];
  for (const ring of rings(mol)) {
    if (!isCandidateRing(mol, ring.atomIds)) continue;
    const perceived = perceiveSugarRing(mol, ring.atomIds);
    ringResults.push(perceived);
    if (perceived.kind !== "sugarRing") continue;
    const unit = carbohydrateOfRing(mol, perceived.ring);
    if (unit !== undefined) units.push(unit);
  }

  const anchors = mol.atomIds
    .map((id) => carbonylAnchor(mol, id))
    .filter((anchor): anchor is CarbonylAnchor => anchor !== undefined);
  // Two carbonyls in one acyclic skeleton (an osone, a dialdose, a 3-C-formyl
  // branched sugar) anchor it twice, and neither anchor is the one a name
  // would pick without the principal-chain rules this module does not have
  // (decision 156). Counted per skeleton BEFORE any chain is walked, so a
  // polyketone costs one walk, not one per carbonyl.
  const skeleton = chainSkeletons(
    mol,
    anchors.map((anchor) => anchor.carbon),
  );
  const perSkeleton = new Map<number, number>();
  for (const anchor of anchors) {
    const label = skeleton.get(anchor.carbon)!;
    perSkeleton.set(label, (perSkeleton.get(label) ?? 0) + 1);
  }
  for (const anchor of anchors) {
    if (perSkeleton.get(skeleton.get(anchor.carbon)!)! > 1) continue;
    const sides = openChainSides(mol, anchor);
    if (!isPolyhydroxy(mol, sides)) continue;
    units.push(
      makeCarbohydrate(
        sides,
        "open",
        anchor.carbons.length === 1 ? "aldose" : "ketose",
        undefined,
        false,
      ),
    );
  }
  units.sort((p, q) => compareIds(p.anchor, q.anchor));
  return Object.freeze({ rings: Object.freeze(ringResults), carbohydrates: Object.freeze(units) });
}

const PERCEPTION_BY_INSTANCE = new WeakMap<Molecule, SugarPerception>();
const PERCEPTION_BY_TOPOLOGY = new LruCache<SugarPerception>(32);

/**
 * Perception reads only topology — elements, charges, bonds, orders — so it
 * is memoised on cip.ts's topology fingerprint the way the stereo topology
 * is, and a drag recomputes nothing.
 */
function perception(mol: Molecule): SugarPerception {
  const hit = PERCEPTION_BY_INSTANCE.get(mol);
  if (hit) return hit;
  const key = cipTopologyFingerprint(mol);
  const shared = PERCEPTION_BY_TOPOLOGY.get(key);
  if (shared) {
    PERCEPTION_BY_INSTANCE.set(mol, shared);
    return shared;
  }
  const built = computePerception(mol);
  PERCEPTION_BY_TOPOLOGY.set(key, built);
  PERCEPTION_BY_INSTANCE.set(mol, built);
  return built;
}

/** Testing hook: how many times sugar perception has actually run. */
export function sugarPerceptionComputationCount(): number {
  return perceptionComputations;
}

/**
 * Every ring that could be a sugar ring, in `rings(mol)` order, read without
 * designations: a sugar ring, a choice to make, or undetermined with the
 * atoms to look at.
 */
export function sugarRings(mol: Molecule): readonly SugarRingPerception[] {
  return perception(mol).rings;
}

/**
 * Every carbohydrate chain in `mol`, open chains and ring forms alike, by
 * anchor atom in `compareIds` order. A ring that needs a choice is not here;
 * pass its designated `SugarRing` to `carbohydrateOfRing`.
 */
export function carbohydrates(mol: Molecule): readonly Carbohydrate[] {
  return perception(mol).carbohydrates;
}

/** `atomId`'s locant within `unit`, as drawn: "1", "2", "1′". */
export function carbohydrateLocant(unit: Carbohydrate, atomId: AtomId): string | undefined {
  const index = unit.backbone.indexOf(atomId);
  if (index < 0) return undefined;
  return `${unit.firstLocant + index}${unit.primed ? PRIME : ""}`;
}

// ---------------------------------------------------------------------------
// Reference atoms, D/L, alpha/beta
// ---------------------------------------------------------------------------

/**
 * The numbered chain stereocentres in locant order, the anomeric carbon
 * excluded, or undefined when a tie hides where the chain's stereocentres
 * are: a stereocentre past the tie could be the highest-numbered one.
 */
function chainCentres(mol: Molecule, unit: Carbohydrate): AtomId[] | undefined {
  const centres = new Set(stereoTopology(mol).centres.map((c) => c.atomId));
  if (unit.directionTied) return undefined;
  if (unit.beyondTie.some((id) => centres.has(id))) return undefined;
  return unit.backbone.filter((id) => centres.has(id) && !(unit.ring !== undefined && id === unit.anchor));
}

/**
 * The configurational atom: the highest-numbered stereocentre of the chain,
 * the atom D/L is read at (2-Carb-4). Undefined when the chain has no
 * stereocentre, or when a tie in the chain hides which one is highest.
 */
export function configurationalAtom(mol: Molecule, unit: Carbohydrate): AtomId | undefined {
  return chainCentres(mol, unit)?.at(-1);
}

/**
 * 2-Carb-6.2's rule on the chain's stereocentres in locant order: the last
 * one (the configurational atom), unless there are more than four and so
 * more than one configurational prefix, when it is the highest of the first
 * group of four. The ONE statement of the rule: `anomericReferenceAtom`
 * reads alpha/beta with it and `cycliseSugar` writes the anomer with it, so
 * the two cannot drift apart.
 */
function referenceFromCentres(centres: readonly AtomId[]): AtomId | undefined {
  return centres.length <= 4 ? centres.at(-1) : centres[3];
}

/**
 * The anomeric reference atom, what alpha/beta is referred to (2-Carb-6.2,
 * decision 141). The configurational atom, unless the chain has more than
 * four stereocentres and so more than one configurational prefix: then the
 * highest-numbered atom of the first group of four, counted from the
 * anomeric end. Undefined for an open chain.
 */
export function anomericReferenceAtom(mol: Molecule, unit: Carbohydrate): AtomId | undefined {
  if (unit.ring === undefined) return undefined;
  const centres = chainCentres(mol, unit);
  if (centres === undefined) return undefined;
  return referenceFromCentres(centres);
}

/**
 * The one substituent at a chain atom that is not the chain and not
 * hydrogen, preferring a heteroatom over a carbon branch; undefined when
 * there is no single candidate.
 */
function sideSubstituent(mol: Molecule, unit: Carbohydrate, atomId: AtomId): AtomId | undefined {
  const chain = new Set(unit.backbone);
  const candidates = heavyNeighbours(mol, atomId).filter((id) => !chain.has(id));
  if (candidates.length === 1) return candidates[0];
  const hetero = candidates.filter((id) => isHetero(mol.atoms[id]?.element));
  return hetero.length === 1 ? hetero[0] : undefined;
}

type ArmsResult = FischerArms | "tied-chain" | "no-side-substituent";

/** The Fischer arms at a numbered chain atom: C(n−1) up, C(n+1) down. */
function chainArms(mol: Molecule, unit: Carbohydrate, atomId: AtomId): ArmsResult {
  const index = unit.backbone.indexOf(atomId);
  const up = unit.backbone[index - 1];
  const down = unit.backbone[index + 1];
  if (index < 0 || up === undefined || down === undefined) return "tied-chain";
  const side = sideSubstituent(mol, unit, atomId);
  if (side === undefined) return "no-side-substituent";
  return { up, down, side };
}

/**
 * D or L for a carbohydrate: the configurational atom's heteroatom
 * substituent on the right, with the chain vertical and C1 at the top, is D.
 * Read from the configuration through a synthetic Fischer cross, never from
 * R/S and never from the orientation of any panel (decision 132).
 *
 * `config` defaults to the configuration the wedges state.
 */
export function carbohydrateSeries(
  mol: Molecule,
  unit: Carbohydrate,
  config?: StereoConfig,
): DLConfiguration {
  const centres = new Set(stereoTopology(mol).centres.map((c) => c.atomId));
  const chain = [...unit.backbone, ...unit.beyondTie].filter(
    (id) => !(unit.ring !== undefined && id === unit.anchor),
  );
  if (!chain.some((id) => centres.has(id))) return { kind: "notApplicable", reason: "no-stereocentre" };
  const atomId = configurationalAtom(mol, unit);
  if (atomId === undefined) return { kind: "undetermined", reason: "tied-chain" };
  const arms = chainArms(mol, unit, atomId);
  if (typeof arms === "string") return { kind: "undetermined", reason: arms, atomId };
  const side = fischerSide(mol, atomId, arms, config ?? stereoConfig(mol));
  switch (side.kind) {
    case "right":
      return { kind: "D", atomId };
    case "left":
      return { kind: "L", atomId };
    case "mixture":
      return { kind: "mixture", atomId };
    case "undetermined":
      return { kind: "undetermined", reason: side.reason, atomId };
  }
}

/** The Fischer-Tollens arms at the anomeric carbon: the ring heteroatom up. */
function anomericArms(ring: SugarRing): FischerArms {
  return { up: ring.ringHeteroatom, down: ring.ringAtomIds[2]!, side: ring.anomericSubstituent };
}

/**
 * Alpha or beta: the anomeric substituent formally cis (alpha) or trans
 * (beta) to the reference atom's heteroatom in the Fischer projection
 * (2-Carb-6.2). Relative, so it needs no D/L; a wavy bond at the anomeric
 * carbon is a mixture of anomers.
 */
export function anomericConfiguration(
  mol: Molecule,
  unit: Carbohydrate,
  config?: StereoConfig,
): AnomericConfiguration {
  const ring = unit.ring;
  if (ring === undefined) return { kind: "notApplicable", reason: "open-chain" };
  const a = ring.anomericCarbon;
  const reference = anomericReferenceAtom(mol, unit);
  if (reference === undefined) return { kind: "undetermined", reason: "no-reference-atom", atomId: a };
  const read = config ?? stereoConfig(mol);
  const anomeric = fischerSide(mol, a, anomericArms(ring), read);
  if (anomeric.kind === "mixture") return { kind: "mixture", anomericCarbon: a };
  if (anomeric.kind === "undetermined") return { kind: "undetermined", reason: anomeric.reason, atomId: a };
  const arms = chainArms(mol, unit, reference);
  if (typeof arms === "string") {
    const reason = arms === "tied-chain" ? "no-reference-atom" : arms;
    return { kind: "undetermined", reason, atomId: reference };
  }
  const referenceSide = fischerSide(mol, reference, arms, read);
  if (referenceSide.kind === "mixture") {
    return { kind: "undetermined", reason: "reference-mixture", atomId: reference };
  }
  if (referenceSide.kind === "undetermined") {
    return { kind: "undetermined", reason: referenceSide.reason, atomId: reference };
  }
  return {
    kind: anomeric.kind === referenceSide.kind ? "alpha" : "beta",
    anomericCarbon: a,
    referenceAtom: reference,
    substituent: ring.anomericSubstituent,
  };
}

// ---------------------------------------------------------------------------
// Writing configuration back as marks
// ---------------------------------------------------------------------------

const WEDGE_HASH = Object.freeze({ kind: "wedgeHash" as const });

function readingAt(mol: Molecule, centre: AtomId): TetrahedralParity | "other" {
  const read = readConfig({ mol }, WEDGE_HASH, { centres: [centre] });
  const reading =
    read.kind === "read" ? read.config.centres.find((c) => c.atomId === centre)?.reading : undefined;
  return reading?.kind === "specified" ? reading.parity : "other";
}

/** Clears the wedges and hashes whose narrow end is one of `atomIds`. */
function clearMarksAt(mol: Molecule, atomIds: ReadonlySet<AtomId>, includeWavy = false): Molecule {
  let next = mol;
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId]!;
    if (!atomIds.has(bond.from)) continue;
    const clear = bond.stereo === "wedge" || bond.stereo === "hash" || (includeWavy && bond.stereo === "wavy");
    if (clear && bond.order === 1) next = updateBond(next, bondId, { stereo: "none" });
  }
  return next;
}

/**
 * `mol` with ONE wedge or hash at `centre` so that it reads `target`, or
 * undefined when no bond can carry it.
 *
 * The mark policy is the minimum this edit needs, not the planar frame's
 * full one: a bond out of the ring before a ring bond, a partner that is not
 * a stereocentre before one that is (a mark between two centres reads as a
 * claim about both), a terminal partner first, then `compareIds`. A bond that
 * already carries another centre's mark is never touched.
 */
function markCentre(mol: Molecule, centre: AtomId, target: TetrahedralParity): Molecule | undefined {
  if (readingAt(mol, centre) === target) return mol;
  const base = clearMarksAt(mol, new Set([centre]));
  const centres = new Set(stereoTopology(base).centres.map((c) => c.atomId));
  const candidates = bondsAt(base, centre)
    .filter((bond) => bond.order === 1 && !bond.aromatic && bond.stereo === "none")
    .map((bond) => {
      const other = otherEnd(bond, centre);
      return {
        bond,
        other,
        rank: [
          isRingBond(base, bond.id) ? 1 : 0,
          centres.has(other) ? 1 : 0,
          bondsAt(base, other).length === 1 ? 0 : 1,
        ],
      };
    })
    .sort((p, q) => {
      for (let i = 0; i < p.rank.length; i++) {
        const d = p.rank[i]! - q.rank[i]!;
        if (d !== 0) return d;
      }
      return compareIds(p.other, q.other);
    });
  for (const { bond, other } of candidates) {
    for (const stereo of ["wedge", "hash"] as const) {
      const marked = updateBond(base, bond.id, { from: centre, to: other, stereo });
      if (readingAt(marked, centre) === target) return marked;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Layout of a new ring
// ---------------------------------------------------------------------------

/**
 * What a cyclisation's layout could not clear, in the ring's connected
 * piece: reported, never silently overlaid (decision 157).
 */
export interface RingLayoutCollisions {
  /** Atoms not bonded to each other and closer than half a bond, id-sorted pairs. */
  readonly atoms: readonly (readonly [AtomId, AtomId])[];
  /** Bonds sharing no atom whose segments cross, id-sorted pairs. */
  readonly bonds: readonly (readonly [BondId, BondId])[];
}

/** Below this fraction of a bond, two unbonded atoms are drawn on top of each other. */
const COLLISION = 0.5;
/** Below this fraction of a bond, two unbonded atoms read as crowded. */
const COMFORT = 1;
/**
 * The turns a pendant group may take about its root, in the order they are
 * preferred: unturned first, then small turns before large, clockwise before
 * counter-clockwise.
 */
const SPINS: readonly number[] = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180].map(
  (degrees) => (degrees * Math.PI) / 180,
);

/** Whether segments p1-p2 and q1-q2 cross at a point inside both. */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const side = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(q1, q2, p1);
  const d2 = side(q1, q2, p2);
  const d3 = side(p1, p2, q1);
  const d4 = side(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

interface PendantGroup {
  readonly ringAtom: AtomId;
  readonly root: AtomId;
  readonly atoms: readonly AtomId[];
  /** Where the group sits unturned: rotated rigidly so its root is on its slot. */
  readonly base: ReadonlyMap<AtomId, Vec2>;
}

/**
 * Positions for a ring just closed in `mol` (new bonds, old coordinates):
 * the ring as a regular polygon centred where its atoms were, heteroatom at
 * the upper right of a hexagon or the apex of a pentagon, the anomeric carbon
 * clockwise after it. A group bonded to the ring at two atoms is only
 * translated.
 *
 * Every other pendant group is moved RIGIDLY, so the configuration of every
 * centre inside it survives by construction: first turned with its
 * attachment bond so its root sits on its slot outside the ring, then, if
 * that leaves it crowding the ring or another group (Neu5Ac's C5 N-acetyl
 * and C6 glycerol tail, laid out that way, land atom on atom), turned about
 * its root to the first of `SPINS` that crowds least. A turn about the root
 * can change how the root's OWN mark reads, which is why the caller rewrites
 * every centre's mark from the configuration and reads it back. This is the
 * edit placing atoms it already moves, not a nudge of a drawn molecule
 * (decision 157); what no turn clears is returned, never hidden.
 */
function layoutRing(
  mol: Molecule,
  walk: readonly AtomId[],
  bondLength: number,
): { readonly molecule: Molecule; readonly piece: ReadonlySet<AtomId> } {
  const n = walk.length;
  const ring = new Set(walk);
  let cx = 0;
  let cy = 0;
  for (const id of walk) {
    cx += mol.atoms[id]!.pos.x;
    cy += mol.atoms[id]!.pos.y;
  }
  const centre: Vec2 = { x: cx / n, y: cy / n };
  const vertices = regularRingVertices(n, centre, bondLength, n === 6 ? Math.PI / 6 : Math.PI / 2);
  const next = new Map<AtomId, Vec2>();
  walk.forEach((id, k) => next.set(id, vertices[k]!));

  // Pendant groups: connected pieces outside the ring, with where they attach.
  const assigned = new Set<AtomId>(ring);
  const single = new Map<AtomId, { root: AtomId; atoms: AtomId[] }[]>();
  for (const a of walk) {
    for (const bond of bondsAt(mol, a)) {
      const p = otherEnd(bond, a);
      if (assigned.has(p)) continue;
      const atoms: AtomId[] = [p];
      assigned.add(p);
      const attachments: [AtomId, AtomId][] = [];
      for (let i = 0; i < atoms.length; i++) {
        const q = atoms[i]!;
        for (const b of bondsAt(mol, q)) {
          const o = otherEnd(b, q);
          if (ring.has(o)) attachments.push([o, q]);
          else if (!assigned.has(o)) {
            assigned.add(o);
            atoms.push(o);
          }
        }
      }
      if (attachments.length === 1) {
        const list = single.get(a) ?? [];
        list.push({ root: p, atoms });
        single.set(a, list);
      } else {
        let dx = 0;
        let dy = 0;
        for (const [ringAtom] of attachments) {
          dx += next.get(ringAtom)!.x - mol.atoms[ringAtom]!.pos.x;
          dy += next.get(ringAtom)!.y - mol.atoms[ringAtom]!.pos.y;
        }
        dx /= attachments.length;
        dy /= attachments.length;
        for (const q of atoms) {
          const pos = mol.atoms[q]!.pos;
          next.set(q, { x: pos.x + dx, y: pos.y + dy });
        }
      }
    }
  }

  const interior = (Math.PI * (n - 2)) / n;
  const free = 2 * Math.PI - interior;
  const groups: PendantGroup[] = [];
  for (const a of walk) {
    const list = (single.get(a) ?? []).sort((p, q) => compareIds(p.root, q.root));
    const at = next.get(a)!;
    const outward = Math.atan2(at.y - centre.y, at.x - centre.x);
    list.forEach((group, i) => {
      const direction = outward - (Math.PI - interior / 2) + ((i + 1) * free) / (list.length + 1);
      const oldRoot = mol.atoms[group.root]!.pos;
      const oldOffset = sub(oldRoot, mol.atoms[a]!.pos);
      const turn = direction - Math.atan2(oldOffset.y, oldOffset.x);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const root: Vec2 = {
        x: at.x + bondLength * Math.cos(direction),
        y: at.y + bondLength * Math.sin(direction),
      };
      const base = new Map<AtomId, Vec2>();
      for (const q of group.atoms) {
        const d = sub(mol.atoms[q]!.pos, oldRoot);
        base.set(q, { x: root.x + d.x * cos - d.y * sin, y: root.y + d.x * sin + d.y * cos });
      }
      groups.push({ ringAtom: a, root: group.root, atoms: group.atoms, base });
      for (const [q, pos] of base) next.set(q, pos);
    });
  }

  // Bonds of the piece, for the crossing test.
  const pieceBonds: [AtomId, AtomId][] = [];
  for (const id of mol.bondIds) {
    const bond = mol.bonds[id]!;
    if (assigned.has(bond.from) && assigned.has(bond.to)) pieceBonds.push([bond.from, bond.to]);
  }

  /** How badly `group`, at `placed`, crowds everything else in the piece. */
  const crowding = (group: PendantGroup, placed: ReadonlyMap<AtomId, Vec2>): [number, number] => {
    const inGroup = new Set(group.atoms);
    const at = (id: AtomId): Vec2 => placed.get(id) ?? next.get(id)!;
    let hard = 0;
    let soft = 0;
    for (const q of group.atoms) {
      const pq = at(q);
      for (const r of assigned) {
        if (inGroup.has(r) || (q === group.root && r === group.ringAtom)) continue;
        const pr = next.get(r)!;
        const d = Math.hypot(pq.x - pr.x, pq.y - pr.y) / bondLength;
        if (d < COLLISION) hard++;
        if (d < COMFORT) soft += COMFORT - d;
      }
    }
    for (const [u, v] of pieceBonds) {
      const uIn = inGroup.has(u);
      const vIn = inGroup.has(v);
      const attachment = (u === group.root && v === group.ringAtom) || (v === group.root && u === group.ringAtom);
      if (!uIn && !vIn && !attachment) continue;
      for (const [s, t] of pieceBonds) {
        if (inGroup.has(s) || inGroup.has(t)) continue;
        if (s === u || s === v || t === u || t === v) continue;
        if (segmentsCross(at(u), at(v), at(s), at(t))) hard++;
      }
    }
    return [hard, soft];
  };

  const spun = (group: PendantGroup, angle: number): Map<AtomId, Vec2> => {
    const root = group.base.get(group.root)!;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const out = new Map<AtomId, Vec2>();
    for (const [q, pos] of group.base) {
      const d = sub(pos, root);
      out.set(q, { x: root.x + d.x * cos - d.y * sin, y: root.y + d.x * sin + d.y * cos });
    }
    return out;
  };

  // A group that crowds nothing keeps its unturned place; one that does is
  // turned to the least crowded spin, and only for a strict improvement, so
  // the passes settle. Greedy over the groups in ring order, a few passes.
  const spin = new Map<PendantGroup, number>(groups.map((g) => [g, 0]));
  const current = (group: PendantGroup): Map<AtomId, Vec2> => spun(group, SPINS[spin.get(group)!]!);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const group of groups) {
      if (group.atoms.length < 2) continue;
      const [hard, soft] = crowding(group, current(group));
      if (hard === 0 && soft === 0) continue;
      let best = { index: spin.get(group)!, hard, soft };
      SPINS.forEach((angle, index) => {
        const [h, s] = crowding(group, spun(group, angle));
        if (h < best.hard || (h === best.hard && s < best.soft - 1e-9)) best = { index, hard: h, soft: s };
      });
      if (best.index !== spin.get(group)) {
        spin.set(group, best.index);
        for (const [q, pos] of current(group)) next.set(q, pos);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { molecule: setAtomPositions(mol, next), piece: assigned };
}

/** Every unbonded pair closer than half a bond, and every crossing, inside `piece`. */
function layoutCollisions(
  mol: Molecule,
  piece: ReadonlySet<AtomId>,
  bondLength: number,
): RingLayoutCollisions {
  const ids = sortIds(piece);
  const atoms: (readonly [AtomId, AtomId])[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const p = mol.atoms[ids[i]!]!.pos;
      const q = mol.atoms[ids[j]!]!.pos;
      if (bondBetween(mol, ids[i]!, ids[j]!) !== undefined) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < COLLISION * bondLength) atoms.push([ids[i]!, ids[j]!]);
    }
  }
  const bondIds = mol.bondIds
    .filter((id) => piece.has(mol.bonds[id]!.from) && piece.has(mol.bonds[id]!.to))
    .sort(compareIds);
  const bonds: (readonly [BondId, BondId])[] = [];
  for (let i = 0; i < bondIds.length; i++) {
    const b = mol.bonds[bondIds[i]!]!;
    for (let j = i + 1; j < bondIds.length; j++) {
      const c = mol.bonds[bondIds[j]!]!;
      if (b.from === c.from || b.from === c.to || b.to === c.from || b.to === c.to) continue;
      const at = (id: AtomId): Vec2 => mol.atoms[id]!.pos;
      if (segmentsCross(at(b.from), at(b.to), at(c.from), at(c.to))) bonds.push([bondIds[i]!, bondIds[j]!]);
    }
  }
  return Object.freeze({ atoms: Object.freeze(atoms), bonds: Object.freeze(bonds) });
}

// ---------------------------------------------------------------------------
// Cyclise and open
// ---------------------------------------------------------------------------

/** Which anomer to draw. Required: nothing here defaults to alpha. */
export type Anomer = "alpha" | "beta" | "mixture";

export interface CycliseSugarOptions {
  /** The aldehyde or ketone carbon: the anomeric carbon to be. */
  readonly carbonylCarbon: AtomId;
  /** The chain hydroxyl whose oxygen becomes the ring oxygen. */
  readonly hydroxylOxygen: AtomId;
  readonly anomer: Anomer;
}

export type CycliseRefusalReason =
  | "no-such-atom"
  /** Not an aldehyde or ketone carbon on an acyclic chain. */
  | "not-a-carbonyl"
  /** A carbonyl, but its chain is not a carbohydrate chain. */
  | "not-a-sugar"
  /** The chain reads the same from both ends, so no C1. */
  | "numbering-tied"
  /** Not an OH oxygen on a carbon: an ether, an ester, a ring oxygen. */
  | "not-a-hydroxyl"
  /** The hydroxyl's carbon is not on the carbonyl's numbered chain. */
  | "not-on-the-chain"
  | "ring-size"
  /** alpha/beta asked for, and the reference atom's configuration is not stated. */
  | "reference-undetermined";

export type CycliseSugarResult =
  | {
      readonly kind: "cyclised";
      readonly molecule: Molecule;
      readonly ring: SugarRing;
      /** Centres whose configuration could not be drawn back; empty for real sugars. */
      readonly unmarked: readonly AtomId[];
      /**
       * Overlaps and crossings the new layout could not clear, in the ring's
       * connected piece; both lists empty for the sugars tested (decision 157).
       */
      readonly collisions: RingLayoutCollisions;
    }
  | {
      readonly kind: "refused";
      readonly reason: CycliseRefusalReason;
      readonly atomIds: readonly AtomId[];
    };

function refuse(reason: CycliseRefusalReason, atomIds: readonly AtomId[]): CycliseSugarResult {
  return { kind: "refused", reason, atomIds: sortIds(atomIds) };
}

/**
 * The carbon of a hydroxyl that can become a ring oxygen: a neutral O singly
 * bonded to one carbon and carrying at least one hydrogen. Undefined for an
 * ether, an ester, a ring oxygen or an alkoxide.
 */
function hydroxylCarbon(mol: Molecule, oxygenId: AtomId): AtomId | undefined {
  const oxygen = mol.atoms[oxygenId];
  const heavy = heavyNeighbours(mol, oxygenId);
  const carbon = heavy[0];
  if (
    oxygen?.element !== "O" ||
    oxygen.charge !== 0 ||
    heavy.length !== 1 ||
    mol.atoms[carbon!]?.element !== "C" ||
    bondBetween(mol, oxygenId, carbon!)?.order !== 1 ||
    hydrogenCount(mol, oxygenId) < 1
  ) {
    return undefined;
  }
  return carbon;
}

/** A hydroxyl that closes an open-chain sugar onto its carbonyl carbon. */
export interface SugarRingClosure {
  readonly form: SugarRingForm;
  readonly carbonylCarbon: AtomId;
  /** The oxygen that becomes the ring oxygen. */
  readonly hydroxylOxygen: AtomId;
  /** The chain carbon carrying it: the ring-closing carbon to be. */
  readonly closingCarbon: AtomId;
}

const CLOSURE_SIZES: readonly (readonly [SugarRingForm, number])[] = [
  ["pyranose", 6],
  ["furanose", 5],
];

/**
 * Every hydroxyl `cycliseSugar` accepts for the open-chain sugar whose
 * carbonyl carbon is `carbonylCarbon`, pyranoses first, then by oxygen id.
 * Empty when that carbon anchors no open chain, or the chain numbers the same
 * from both ends (both of which `cycliseSugar` refuses).
 *
 * This is how "pyranose" and "furanose" become an oxygen, so no caller counts
 * chain positions itself: an aldose closes a pyranose on C5 and a furanose on
 * C4, a 2-ketose on C6 and C5. A carbonyl at C4 or beyond can reach a hydroxyl
 * of one ring size in both directions, and both are listed.
 */
export function sugarRingClosures(mol: Molecule, carbonylCarbon: AtomId): readonly SugarRingClosure[] {
  if (!Object.hasOwn(mol.atoms, carbonylCarbon)) return [];
  const unit = carbohydrates(mol).find((u) => u.form === "open" && u.anchor === carbonylCarbon);
  if (unit === undefined || unit.directionTied) return [];
  const ik = unit.backbone.indexOf(carbonylCarbon);
  if (ik < 0) return [];
  const closures: SugarRingClosure[] = [];
  for (const [form, size] of CLOSURE_SIZES) {
    const found: SugarRingClosure[] = [];
    for (const step of [-1, 1]) {
      const closingCarbon = unit.backbone[ik + step * (size - 2)];
      if (closingCarbon === undefined) continue;
      for (const oxygen of heavyNeighbours(mol, closingCarbon)) {
        if (hydroxylCarbon(mol, oxygen) !== closingCarbon) continue;
        found.push({ form, carbonylCarbon, hydroxylOxygen: oxygen, closingCarbon });
      }
    }
    found.sort((p, q) => compareIds(p.hydroxylOxygen, q.hydroxylOxygen));
    closures.push(...found);
  }
  return Object.freeze(closures);
}

/** A drawn hydrogen atom on `atomId`, protium first, then `compareIds`. */
function drawnHydrogen(mol: Molecule, atomId: AtomId): AtomId | undefined {
  const hydrogens = bondsAt(mol, atomId)
    .map((bond) => otherEnd(bond, atomId))
    .filter((id) => mol.atoms[id]!.element === "H");
  hydrogens.sort((p, q) => {
    const pi = mol.atoms[p]!.isotope === undefined ? 0 : 1;
    const qi = mol.atoms[q]!.isotope === undefined ? 0 : 1;
    return pi - qi || compareIds(p, q);
  });
  return hydrogens[0];
}

function clearHydrogenPins(mol: Molecule, atomIds: readonly AtomId[]): Molecule {
  let next = mol;
  for (const id of atomIds) {
    if (next.atoms[id]?.explicitHydrogenCount !== undefined) {
      next = updateAtom(next, id, { explicitHydrogenCount: undefined });
    }
  }
  return next;
}

/**
 * Closes an open-chain sugar onto one of its hydroxyls: the carbonyl carbon
 * becomes the anomeric carbon, its oxygen the anomeric OH, and the hydroxyl
 * oxygen the ring oxygen (decisions 104 and 143).
 *
 * The anomer is required. `alpha` and `beta` are drawn against the anomeric
 * reference atom, so they need its configuration stated; `mixture` draws a
 * wavy bond and needs nothing. D-glucose with its C5 hydroxyl gives the
 * pyranose, with its C4 hydroxyl the furanose.
 *
 * Every centre that existed before keeps its parity against its own ligand
 * order: the ring is re-laid, so each centre's mark is rewritten from the
 * configuration and read back. `unmarked` lists any centre that could not
 * be; `collisions` lists what the new layout could not clear (decision 157).
 * `explicitHydrogenCount` pins on the three atoms whose bonds changed are
 * dropped, and a drawn hydroxyl hydrogen is removed. An alpha or beta anomer
 * joins its reference atom's stereo group, since it is stated relative to it.
 */
export function cycliseSugar(mol: Molecule, options: CycliseSugarOptions): CycliseSugarResult {
  const { carbonylCarbon: k, hydroxylOxygen: o, anomer } = options;
  // A caller that forgot the anomer would otherwise get one silently. The
  // type already requires it; this is for callers the type does not reach.
  if (anomer !== "alpha" && anomer !== "beta" && anomer !== "mixture") {
    throw new TypeError(`cycliseSugar needs an anomer: alpha, beta or mixture (got ${String(anomer)})`);
  }
  if (!Object.hasOwn(mol.atoms, k) || !Object.hasOwn(mol.atoms, o)) {
    return refuse("no-such-atom", [k, o].filter((id) => !Object.hasOwn(mol.atoms, id)));
  }
  const anchor = carbonylAnchor(mol, k);
  if (anchor === undefined) return refuse("not-a-carbonyl", [k]);
  const unit = carbohydrates(mol).find((u) => u.form === "open" && u.anchor === k);
  if (unit === undefined) return refuse("not-a-sugar", [k]);
  if (unit.directionTied) return refuse("numbering-tied", [k]);

  const ch = hydroxylCarbon(mol, o);
  if (ch === undefined) return refuse("not-a-hydroxyl", [o]);
  const ik = unit.backbone.indexOf(k);
  const ic = unit.backbone.indexOf(ch);
  if (ic < 0) return refuse("not-on-the-chain", [o]);
  const size = Math.abs(ic - ik) + 2;
  if (size !== 5 && size !== 6) return refuse("ring-size", [k, o]);
  const step = ic > ik ? 1 : -1;
  const path: AtomId[] = [];
  for (let i = ik; i !== ic + step; i += step) path.push(unit.backbone[i]!);

  // The side the reference atom's heteroatom is on, before anything moves.
  let referenceSide: "right" | "left" | undefined;
  let reference: AtomId | undefined;
  if (anomer !== "mixture") {
    reference = referenceFromCentres(chainCentres(mol, unit) ?? []);
    if (reference === undefined) return refuse("reference-undetermined", [k]);
    const arms = chainArms(mol, unit, reference);
    if (typeof arms === "string") return refuse("reference-undetermined", [reference]);
    const side = fischerSide(mol, reference, arms);
    if (side.kind !== "right" && side.kind !== "left") {
      return refuse("reference-undetermined", [reference]);
    }
    referenceSide = side.kind;
  }

  // Constitution: C=O becomes C–OH, and the hydroxyl oxygen bonds to C1.
  const oc = anchor.oxygen;
  let next = updateBond(mol, bondBetween(mol, k, oc)!.id, { order: 1, stereo: "none" });
  const hydrogen = drawnHydrogen(next, o);
  if (hydrogen !== undefined) next = removeAtoms(next, [hydrogen]);
  next = addBond(next, { from: k, to: o, order: 1 }).molecule;
  next = clearHydrogenPins(next, [k, oc, o]);

  const walk = [o, ...path];
  const ringSet = new Set(walk);
  const bondLength = medianBondLength(mol) ?? 1;
  const laid = layoutRing(next, walk, bondLength);
  next = clearMarksAt(laid.molecule, ringSet);

  // What every centre must read afterwards: its parity before the edit,
  // restated against its (unchanged) ligands.
  const before = stereoConfig(mol);
  const targets = new Map<AtomId, TetrahedralParity>();
  for (const centre of stereoTopology(next).centres) {
    if (centre.atomId === k) continue;
    const old = before.centres.find((c) => c.atomId === centre.atomId);
    if (old === undefined) continue;
    const parity = parityAgainst(old, ligandRefs(centre));
    if (parity !== undefined) targets.set(centre.atomId, parity);
  }

  if (anomer === "mixture") {
    next = updateBond(next, bondBetween(next, k, oc)!.id, { from: k, to: oc, stereo: "wavy" });
  } else {
    const right = fischerCrossParity(next, k, { up: o, down: path[1]!, side: oc });
    if (right !== undefined) {
      const wantRight = anomer === "alpha" ? referenceSide === "right" : referenceSide === "left";
      targets.set(k, wantRight ? right : right === 1 ? -1 : 1);
    }
  }

  const unmarked: AtomId[] = [];
  for (const centre of sortIds(targets.keys())) {
    const marked = markCentre(next, centre, targets.get(centre)!);
    if (marked === undefined) unmarked.push(centre);
    else next = marked;
  }
  const anomerStated = targets.has(k) && !unmarked.includes(k);
  next = anomerIntoStereoGroups(next, k, anomerStated ? reference : undefined);

  const perceived = perceiveSugarRing(next, walk, {
    ringHeteroatom: o,
    anomericCarbon: k,
    anomericSubstituent: oc,
  });
  if (perceived.kind !== "sugarRing") throw new Error("cycliseSugar built a ring it cannot perceive");
  return {
    kind: "cyclised",
    molecule: next,
    ring: perceived.ring,
    unmarked: Object.freeze(unmarked),
    collisions: layoutCollisions(next, laid.piece, bondLength),
  };
}

/**
 * The new anomeric carbon's stereo-group membership (decision 157). Alpha and
 * beta are RELATIVE to the reference atom, so the anomeric centre states
 * exactly what the reference atom states: it joins the reference atom's
 * group, and a racemic chain gives a racemic anomer rather than an absolute
 * C1 on a racemic C2–C5. With no grouped reference (or a wavy mixture) it is
 * in no group. Any membership the carbonyl carbon had said nothing, since it
 * was no centre, and is dropped first.
 */
function anomerIntoStereoGroups(mol: Molecule, anomeric: AtomId, reference: AtomId | undefined): Molecule {
  const groups = stereoGroupsOf(mol);
  if (groups.length === 0) return mol;
  const home = reference === undefined ? undefined : stereoGroupAt(mol, reference);
  const pruned = prunedStereoGroups(groups, (id) => id !== anomeric);
  if (home === undefined) return pruned === groups ? mol : withStereoGroups(mol, pruned);
  return withStereoGroups(
    mol,
    pruned.map((group) =>
      group.kind === home.kind && group.index === home.index
        ? { ...group, atomIds: [...group.atomIds, anomeric] }
        : group,
    ),
  );
}

export type OpenRingRefusalReason =
  | "no-such-atom"
  /** No sugar ring has this atom as its anomeric carbon. */
  | "not-a-sugar-ring"
  /** Two sugar rings share this anomeric carbon. */
  | "ambiguous-ring"
  /** An acetal, a glycosylamine, a thio sugar: not a cyclised chain. */
  | "glycoside"
  /** A lactone's carbonyl carbon: an ester, which no ring-chain edit opens. */
  | "lactone";

export type OpenRingResult =
  | {
      readonly kind: "opened";
      readonly molecule: Molecule;
      /** The aldehyde or ketone carbon, formerly the anomeric carbon. */
      readonly carbonylCarbon: AtomId;
      /** The chain hydroxyl, formerly the ring oxygen. */
      readonly hydroxylOxygen: AtomId;
    }
  | {
      readonly kind: "refused";
      readonly reason: OpenRingRefusalReason;
      readonly atomIds: readonly AtomId[];
    };

/**
 * Opens a hemiacetal sugar ring at its anomeric carbon: the inverse of
 * `cycliseSugar` (decision 143). The ring bond goes, the anomeric OH becomes
 * the C=O and the ring oxygen a hydroxyl again. Coordinates are kept, so the
 * ring opens where it is drawn and every other centre keeps its reading; the
 * anomeric carbon, no longer a centre, loses its marks.
 *
 * A glycoside is refused: an acetal is not a cyclised chain, and opening one
 * would have to delete its aglycone. So is a lactone, an ester (decision 158).
 * The old anomeric carbon leaves its stereo group (decision 157).
 */
export function openRing(mol: Molecule, anomericCarbon: AtomId): OpenRingResult {
  const a = anomericCarbon;
  if (!Object.hasOwn(mol.atoms, a)) return { kind: "refused", reason: "no-such-atom", atomIds: [a] };
  const found: SugarRing[] = [];
  let lactone = false;
  for (const ring of rings(mol)) {
    if (!ring.atomIds.includes(a)) continue;
    const perceived = perceiveSugarRing(mol, ring.atomIds, { anomericCarbon: a });
    if (perceived.kind === "sugarRing") found.push(perceived.ring);
    else if (perceived.kind === "undetermined" && perceived.reason === "lactone") {
      lactone ||= perceived.atomIds.includes(a);
    }
  }
  if (found.length === 0) {
    return { kind: "refused", reason: lactone ? "lactone" : "not-a-sugar-ring", atomIds: [a] };
  }
  if (found.length > 1) return { kind: "refused", reason: "ambiguous-ring", atomIds: [a] };
  const ring = found[0]!;
  const z = ring.ringHeteroatom;
  const x = ring.anomericSubstituent;
  const xAtom = requireAtom(mol, x);
  if (
    requireAtom(mol, z).element !== "O" ||
    xAtom.element !== "O" ||
    xAtom.charge !== 0 ||
    heavyNeighbours(mol, x).length !== 1 ||
    hydrogenCount(mol, x) < 1
  ) {
    return { kind: "refused", reason: "glycoside", atomIds: [x] };
  }

  let next = removeBond(mol, bondBetween(mol, a, z)!.id);
  const hydrogen = drawnHydrogen(next, x);
  if (hydrogen !== undefined) next = removeAtoms(next, [hydrogen]);
  next = updateBond(next, bondBetween(next, a, x)!.id, { order: 2, stereo: "none" });
  next = clearHydrogenPins(next, [a, x, z]);
  next = clearMarksAt(next, new Set([a]), true);
  // The carbonyl carbon is no centre, so its stereo-group membership would
  // be a statement about nothing: dropped with the marks (decision 157).
  const groups = stereoGroupsOf(next);
  const pruned = prunedStereoGroups(groups, (id) => id !== a);
  if (pruned !== groups) next = withStereoGroups(next, pruned);
  return { kind: "opened", molecule: next, carbonylCarbon: a, hydroxylOxygen: z };
}
