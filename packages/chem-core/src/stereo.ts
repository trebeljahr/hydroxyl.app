/**
 * Stereochemistry perception from a drawing: which atoms and bonds are
 * stereogenic, and what a chemist would call their configuration.
 *
 * THIS MODULE REFUSES RATHER THAN GUESSES, and that is its whole design, for
 * the same reason `exactMass()` throws instead of substituting an average
 * atomic weight. Every projection the editor will grow is a depiction of a
 * CONFIGURATION, and the only oracle that a projection round-trips correctly is
 * that the CIP descriptors survive it. A descriptor that is silently a coin
 * flip makes every one of those assertions pass while depicting the wrong
 * enantiomer. So an answer this module cannot prove comes back as
 * `{ kind: "undetermined", reason }`, never as a plausible letter.
 *
 * THE SPLIT OF WORK.
 *
 *   cip.ts decides which units exist and ranks their ligands: rules 1a, 1b,
 *   2, 3, 4a-c and 5 of the IUPAC 2013 recommendations, duplicate atoms, the
 *   depth caps (`MAX_SPHERES` = 64 spheres, `MAX_BRANCH_NODES` = 20000 nodes
 *   per pairwise comparison, `ranking-truncated` past either, decision 22),
 *   and every refusal. Its header is the reference for the rules.
 *
 *   parity.ts turns the marks into a sign (`liftParity`, decision 28). This
 *   module calls it for its own centres and for the configurations rules 3-5
 *   need; it has no private lift.
 *
 *   stereo-axes.ts reports what no descriptor here can express: allenes,
 *   atropisomeric biaryls, spiranes, cyclophanes and helicenes, surfaced by
 *   `structuralIssues` as `unrepresentable-stereo` warnings.
 *
 * KNOWN BEHAVIOUR CHANGES in the CIP rewrite (cip-ranking-refusals), each a
 * correction:
 *
 *   - Rule 2 orders isotopes. 2-(13C)-propan-2-ol and CH3–CH(OH)–CH2D get
 *     letters where they were `ranking-unsupported`. A label within 0.5 of the
 *     standard weight (12C, 127I) still refuses.
 *   - An explicit protium atom ranks EQUAL to the implicit hydrogen, so
 *     CH3–CH(H)–OH with one H drawn is no longer a false stereocentre, and an
 *     =CH2 end drawn with one explicit H is not a stereogenic double bond.
 *   - Pseudoasymmetric centres exist and read lowercase `r` / `s`: C3 of
 *     ribitol, xylitol, the meso pentaric acids and tropine, and both ring
 *     carbons of a 1,4-disubstituted cyclohexane or a 1,3-disubstituted
 *     cyclobutane. Before, they were "not stereogenic" and a wedge on one was
 *     reported as a wedge on a non-stereocentre.
 *   - Centres that tie under rules 1-2 and are settled by rule 3 or 4 (an
 *     allylic alcohol between a Z and an E propenyl, myo-inositol's C1, C3,
 *     C4 and C6) are stereocentres with letters. They were silently dropped.
 *   - Heteroatom centres: sulfoxides drawn S=O, sulfinates, sulfilimines,
 *     selenoxides, phosphines, arsines, phosphine oxides, phosphinates,
 *     phosphonates, phosphates, phosphoramidates, sulfoximines and P ylides
 *     are centres here, with letters where the ranking allows (decisions 43
 *     and 47). The phosphate diester anion's P is listed without a letter.
 *   - C=N and N=N double bonds (oximes, hydrazones, imines with a substituent
 *     on N, azo compounds) have E/Z, the nitrogen lone pair being the lower
 *     ligand at its end.
 *   - A wavy bond at a stereocentre reads `{ kind: "mixture", of: "epimers" }`
 *     (decision 39), not `undetermined` / `unspecified`. A wavy bond at a
 *     double bond's end and a crossed double bond still read `unspecified`.
 *   - Ring-fusion carbons with constitutionally identical branches (both of
 *     decalin's, cis- and trans-decalin being different compounds) are
 *     stereocentres, lettered r/s when wedged. They were "not stereogenic".
 *   - A duplicate atom on a heteroaromatic ring bond carries the mean atomic
 *     number over the Kekulé structures (P-92.1.4.4), so no letter depends on
 *     which Kekulé form was drawn.
 *
 * KEKULE IS THE STORAGE FORM, so the digraph duplicates on `bond.order`. An
 * importer's flagged molecule must go through `kekulize()` first.
 *
 * ONLY MARKS THAT ARE DRAWN MAKE CLAIMS. `wedge`, `hash` and `wavy` describe a
 * SINGLE bond and `either` a double one, and chem-render's stereo pass skips
 * any other combination; this module applies the identical `order === 1`
 * filter. A wedge's claim lands on its NARROW end, `from`, the same test
 * `revealsStereoHydrogen` in chem-render uses.
 *
 * COST. Letters are memoised LAZILY and PER ATOM on the molecule instance in a
 * WeakMap, since positions and marks are inputs and a drag mints a new
 * instance. Which units exist and their rule 1-2 rankings are memoised on the
 * topology fingerprint in cip.ts, so a drag re-ranks nothing. `structuralIssues`
 * runs every editor frame and asks only about the ends of wedges.
 */

import {
  cipUnits,
  rankStereoCentre,
  rankStereoDoubleBond,
  type CipCentreRanking,
  type CipConfiguration,
  type CipDoubleBondRanking,
  type LigandRef,
  type UndeterminedReason,
} from "./cip.js";
import { bondsAt, getBond, requireAtom, requireBond } from "./molecule.js";
import { liftParity, type LiftLigand, type LiftOutcome } from "./parity.js";
import { unrepresentableStereo } from "./stereo-axes.js";
import { stereoGroupsOf } from "./stereo-groups.js";
import type { AtomId, BondId, Bond, Molecule, StereoGroup } from "./types.js";

export type StereoDescriptor =
  | { readonly kind: "R" }
  | { readonly kind: "S" }
  /** Pseudoasymmetric: reflection-invariant, decided by rule 5. */
  | { readonly kind: "r" }
  | { readonly kind: "s" }
  | { readonly kind: "E" }
  | { readonly kind: "Z" }
  /**
   * A wavy bond at the centre: the author states a mixture of both
   * configurations at this atom (decision 39). The sugar task specialises it
   * to an anomeric alpha/beta mixture.
   */
  | { readonly kind: "mixture"; readonly of: "epimers" }
  | { readonly kind: "undetermined"; readonly reason: UndeterminedReason };

/**
 * `(R)`, `(S)`, `(r)`, `(s)`, `(E)`, `(Z)` — or undefined.
 *
 * Undetermined deliberately renders as NOTHING rather than as "(?)": a
 * question mark beside a centre reads as a wavy bond, which is a different
 * chemical statement. A mixture renders as nothing too: the wavy bond is
 * already the drawn statement, and how a figure should label it is not ruled.
 */
export function descriptorText(
  descriptor: StereoDescriptor | undefined,
): string | undefined {
  if (descriptor === undefined) return undefined;
  if (descriptor.kind === "undetermined" || descriptor.kind === "mixture") return undefined;
  return `(${descriptor.kind})`;
}

export type StructuralIssueKind =
  /** A wedge or hash whose narrow end is on an atom that is not stereogenic. */
  | "wedge-on-non-stereocenter"
  /** A wedge or hash drawn backwards: the WIDE end is the stereocentre. */
  | "wedge-drawn-backwards"
  /** A stereogenic axis or plane (stereo-axes.ts) that no descriptor here expresses. */
  | "unrepresentable-stereo";

/**
 * A drawing problem that is not a valence problem.
 *
 * SAME SHAPE AS `ValenceIssue` on purpose, keyed on an ATOM: the canvas badge
 * in the editor renders from `atomCentre(issue.atomId)` and needs no change to
 * show one of these. `bondId` is OMITTED rather than set to undefined —
 * chem-core runs `exactOptionalPropertyTypes`.
 */
export interface StructuralIssue {
  readonly atomId: AtomId;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly kind: StructuralIssueKind;
  readonly bondId?: BondId;
}

// ---------------------------------------------------------------------------
// Reading the drawing
// ---------------------------------------------------------------------------

/**
 * What `bond` says about the atom at its NARROW end: +1 toward the reader,
 * −1 away, 0 in the page. A bond whose `to` is the atom says nothing.
 */
function outOfPlaneAt(bond: Bond, atomId: AtomId): number {
  if (bond.order !== 1 || bond.from !== atomId) return 0;
  if (bond.stereo === "wedge") return 1;
  if (bond.stereo === "hash") return -1;
  return 0;
}

/** True when a wavy single bond starts at this atom. */
function hasWavyAt(mol: Molecule, atomId: AtomId): boolean {
  return bondsAt(mol, atomId).some(
    (bond) => bond.order === 1 && bond.from === atomId && bond.stereo === "wavy",
  );
}

/**
 * The drawn parity of `centre` over `ligands` in the order given. The volume
 * is NEGATIVE for R with the ligands in CIP order (parity.ts). The lift, the
 * implicit-ligand placement and the ambiguity guard are parity.ts's.
 */
function drawnParity(mol: Molecule, centre: AtomId, ligands: readonly LigandRef[]): LiftOutcome {
  const origin = requireAtom(mol, centre).pos;
  const bonds = bondsAt(mol, centre);
  const lifted: LiftLigand[] = [];
  for (const ligand of ligands) {
    if (ligand.kind !== "atom") {
      lifted.push({ kind: "implicit" });
      continue;
    }
    const bond = bonds.find((b) => b.from === ligand.atomId || b.to === ligand.atomId);
    if (bond === undefined) return { kind: "ambiguous" };
    const at = requireAtom(mol, ligand.atomId).pos;
    lifted.push({
      kind: "drawn",
      offset: { x: at.x - origin.x, y: at.y - origin.y },
      depth: outOfPlaneAt(bond, centre),
    });
  }
  return liftParity(lifted, { refuseOpposedMarks: true });
}

/**
 * Same side (+1) or opposite sides (−1) of the double bond's axis for `a` on
 * `bond.from` and `b` on `bond.to`, or 0 when either lies on the axis.
 * Scale-relative: the cross product grows with both bond lengths.
 */
function sideRelation(mol: Molecule, bond: Bond, a: AtomId, b: AtomId): -1 | 0 | 1 {
  const from = requireAtom(mol, bond.from).pos;
  const to = requireAtom(mol, bond.to).pos;
  const axisX = to.x - from.x;
  const axisY = to.y - from.y;
  const pa = requireAtom(mol, a).pos;
  const pb = requireAtom(mol, b).pos;
  const sideA = axisX * (pa.y - from.y) - axisY * (pa.x - from.x);
  const sideB = axisX * (pb.y - to.y) - axisY * (pb.x - to.x);
  const floor = 1e-6 * Math.hypot(axisX, axisY);
  if (!(floor > 0) || !(Math.abs(sideA) >= floor) || !(Math.abs(sideB) >= floor)) return 0;
  return sideA * sideB > 0 ? 1 : -1;
}

function refsOf(mol: Molecule, atomId: AtomId): readonly LigandRef[] | undefined {
  const unit = cipUnits(mol).centreById.get(atomId);
  if (unit === undefined) return undefined;
  return unit.ligands.map((ligand): LigandRef =>
    ligand.kind === "atom" ? { kind: "atom", atomId: ligand.atomId } : ligand,
  );
}

const DRAWING_CONFIG = new WeakMap<Molecule, CipConfiguration>();

/** The configuration the wedges and coordinates state, as cip.ts's rules 3-5 read it. */
function drawingConfiguration(mol: Molecule): CipConfiguration {
  const hit = DRAWING_CONFIG.get(mol);
  if (hit !== undefined) return hit;
  const config: CipConfiguration = {
    centre(atomId) {
      const refs = refsOf(mol, atomId);
      if (refs === undefined) return undefined;
      if (hasWavyAt(mol, atomId)) return { kind: "undetermined", reason: "unspecified" };
      const lift = drawnParity(mol, atomId, refs);
      if (lift.kind === "flat") return { kind: "undetermined", reason: "no-stereo-bond" };
      if (lift.kind === "ambiguous") return { kind: "undetermined", reason: "ambiguous-geometry" };
      return { kind: "specified", order: refs, parity: lift.parity };
    },
    doubleBond(bondId) {
      const unit = cipUnits(mol).doubleBondById.get(bondId);
      if (unit === undefined) return undefined;
      const bond = requireBond(mol, bondId);
      if (bond.stereo === "either" || hasWavyAt(mol, bond.from) || hasWavyAt(mol, bond.to)) {
        return { kind: "undetermined", reason: "unspecified" };
      }
      const relation = sideRelation(mol, bond, unit.refOnFrom, unit.refOnTo);
      if (relation === 0) return { kind: "undetermined", reason: "ambiguous-geometry" };
      return {
        kind: "specified",
        refOnFrom: unit.refOnFrom,
        refOnTo: unit.refOnTo,
        relation: relation > 0 ? "cis" : "trans",
      };
    },
  };
  DRAWING_CONFIG.set(mol, config);
  return config;
}

// ---------------------------------------------------------------------------
// Tetrahedral centres
// ---------------------------------------------------------------------------

function centreRanking(mol: Molecule, atomId: AtomId): CipCentreRanking | undefined {
  const unit = cipUnits(mol).centreById.get(atomId);
  if (unit === undefined) return undefined;
  if (unit.constitution.kind === "tied") {
    return rankStereoCentre(mol, atomId, drawingConfiguration(mol));
  }
  return rankStereoCentre(mol, atomId);
}

/**
 * `atomId`'s configuration, or undefined when the atom is not a stereocentre.
 *
 * THREE OUTCOMES, NOT TWO:
 *
 *   `undefined`      proven not stereogenic: not a centre class at all, two
 *                    ligands proven identical, or — for a centre whose
 *                    stereogenicity rides on other units — identical in the
 *                    configuration this drawing states.
 *   `undetermined`   stereogenic (or possibly so) but no letter is warranted.
 *   a descriptor     R, S, r, s, or a wavy bond's mixture of epimers.
 */
export function cipDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  return atomDescriptor(mol, atomId);
}

function computeCipDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  const ranking = centreRanking(mol, atomId);
  if (ranking === undefined || ranking.kind === "not-stereogenic") return undefined;
  if (ranking.kind === "undetermined") return ranking;
  // A wavy bond at the centre outranks whatever wedges sit beside it: it is
  // what the author actually wrote about this atom (decision 39).
  if (hasWavyAt(mol, atomId)) return { kind: "mixture", of: "epimers" };
  const lift = drawnParity(mol, atomId, ranking.order);
  if (lift.kind === "flat") return { kind: "undetermined", reason: "no-stereo-bond" };
  if (lift.kind === "ambiguous") return { kind: "undetermined", reason: "ambiguous-geometry" };
  const rectus = lift.parity < 0;
  if (ranking.pseudoasymmetric) return rectus ? { kind: "r" } : { kind: "s" };
  return rectus ? { kind: "R" } : { kind: "S" };
}

/**
 * Every atom that is a stereocentre, in `mol.atomIds` order.
 *
 * INCLUDES the centres whose descriptor is undetermined: an unresolved ranking
 * and an undrawn wedge both leave a real stereocentre on the page, and
 * dropping them is how a wedge on a genuine centre would be reported as an
 * error.
 */
export function stereocenterAtoms(mol: Molecule): readonly AtomId[] {
  const perception = perceptionOf(mol);
  if (!perception.atomsComplete) {
    for (const atomId of mol.atomIds) atomDescriptor(mol, atomId);
    perception.atomsComplete = true;
  }
  return mol.atomIds.filter((atomId) => perception.atoms.get(atomId) !== undefined);
}

export function isStereocenter(mol: Molecule, atomId: AtomId): boolean {
  return cipDescriptor(mol, atomId) !== undefined;
}

// ---------------------------------------------------------------------------
// Enhanced stereochemistry: what the groups cover
// ---------------------------------------------------------------------------

/**
 * What a molecule's ABS/AND/OR groups say about it AS A WHOLE (decision 40).
 *
 * THE QUESTION LIVES HERE, not in chem-render. Deciding whether every
 * stereocentre sits in one AND group is perception plus record, and a renderer
 * that answered it itself would own a second definition of "stereocentre" —
 * which is the same mistake as a renderer formatting a group's number from its
 * array position (decision 92). chem-render asks and draws.
 *
 * FOUR OUTCOMES, AND `unresolved` IS THE ONE THAT MATTERS. An empty statement
 * reads as "this molecule is achiral" to everything downstream, so a molecule
 * whose groups name no stereocentre at all must not come back as
 * `whole`/`rac-`: with no stereocentres, "every stereocentre is in one AND
 * group" is vacuously true and the figure would claim a racemate on a structure
 * that has no configuration to racemise. That case is named instead.
 */
export type StereoGroupCoverage =
  /**
   * No group at all: nothing was said about configuration (decision 91). Not
   * the same as every centre being in an ABS group, which is an assertion.
   */
  | { readonly kind: "none" }
  /**
   * Every stereocentre is in ONE group, and that group is `and` or `or`.
   * `prefix` is the text a figure prints above the structure (decision 88), and
   * while it applies the per-centre tags are omitted (decision 40).
   *
   * The text is HERE for the reason `stereoGroupTag` is in stereo-groups.ts: a
   * renderer free to spell it would be free to spell it differently in the
   * status bar and in an exported figure.
   */
  | {
      readonly kind: "whole";
      readonly group: StereoGroup;
      readonly prefix: "rac-" | "rel-";
    }
  /**
   * Groups name stereocentres, but no single AND or OR group holds all of them
   * — several groups, or one ABS group. Each grouped centre carries its own tag.
   */
  | { readonly kind: "perCentre"; readonly groups: readonly StereoGroup[] }
  /**
   * Groups exist and not one atom they name is a stereocentre: a collection
   * imported onto atoms this build does not perceive as stereogenic, or onto a
   * centre a later edit flattened. Reported rather than passed off as either
   * "nothing said" or "racemate".
   */
  | { readonly kind: "unresolved"; readonly groups: readonly StereoGroup[] };

/**
 * Decision 40's question: does the molecule read `rac-`, `rel-`, or per centre?
 *
 * A group MAY name atoms that are not stereocentres — an imported file is
 * entitled to, and an edit can flatten a centre without touching the collection
 * — so coverage is judged over the stereocentres a group actually holds. Only
 * the groups that hold at least one are considered, and exactly one of them
 * holding every stereocentre is what earns a prefix.
 *
 * `stereocenterAtoms` is the set, deliberately: it INCLUDES centres whose
 * descriptor is undetermined, so a racemate drawn with no wedges at all still
 * reads `rac-` rather than losing its prefix for want of a letter. KNOWN LIMIT
 * on that case, decision 95: such a molecule reads `rac-` here and in the file,
 * but RDKit-based tools drop the collection back off it — see
 * `wedgelessStereoGroupAtoms` below, which is what the export dialog warns
 * from.
 */
export function stereoGroupCoverage(mol: Molecule): StereoGroupCoverage {
  const groups = stereoGroupsOf(mol);
  if (groups.length === 0) return { kind: "none" };

  const centres = new Set<AtomId>(stereocenterAtoms(mol));
  const holding: StereoGroup[] = [];
  // DISTINCT CENTRES, not memberships. `withStereoGroups` deduplicates, so a
  // molecule built through it cannot name one atom twice inside a group — but a
  // decoded document is only as good as the schema refinement that rejects one,
  // and counting memberships made a group holding `[a2, a2]` on a molecule with
  // two centres print `rac-`: a racemate claim about a mixture of
  // diastereomers. A set cannot be fooled that way whatever reaches it, so the
  // false prefix is impossible here rather than merely prevented upstream.
  const held = new Set<AtomId>();
  for (const group of groups) {
    let inside = 0;
    for (const atomId of group.atomIds) {
      if (!centres.has(atomId)) continue;
      inside += 1;
      held.add(atomId);
    }
    if (inside === 0) continue;
    holding.push(group);
  }
  // T14's case, named: the statement exists but resolves to nothing. The
  // figure still tags the grouped atoms — membership is what the document says
  // — but it must not print a prefix about centres it cannot find.
  if (holding.length === 0) return { kind: "unresolved", groups };

  const only = holding[0];
  if (
    holding.length === 1 &&
    only !== undefined &&
    only.kind !== "abs" &&
    // One holding group, and the centres it holds are every centre there is.
    held.size === centres.size
  ) {
    return { kind: "whole", group: only, prefix: only.kind === "and" ? "rac-" : "rel-" };
  }
  return { kind: "perCentre", groups: holding };
}

/**
 * Decision 95's KNOWN LIMIT, as a list of atoms: the grouped atoms that an
 * RDKit-based reader will silently drop out of their collection.
 *
 * WHY THIS EXISTS. A flat skeleton marked racemic is an ordinary thing to draw
 * for a scheme, and this build states it correctly: the model holds the group,
 * the V3000 writer emits the COLLECTION line, and chem-core reads it back
 * whole. RDKit does not. Measured against RDKit MinimalLib 2025.03.4: it builds
 * a collection out of the atoms that carry a CHIRAL TAG, and a molfile atom
 * only gets one from a wedge or hash whose NARROW END is that atom — so it
 * keeps the grouped atoms that have such a bond, drops the ones that do not,
 * and reports NO collection at all when none of them has one. Per atom, not
 * all-or-nothing, which is why this returns the atoms rather than a boolean:
 * the export dialog can then name exactly what will be lost.
 *
 * NOT A REFUSAL, and deliberately not a repair. Refusing the mark was rejected
 * (decision 95) and inventing a wedge would state a configuration the author
 * did not draw. The limit is RDKit's, so it is reported where the file leaves
 * this app and re-proved by a test every run — the `RDKIT_MOLFILE_STEREO_BLIND`
 * precedent — and the list comes back empty the day RDKit reads a collection
 * off the collection block.
 *
 * WEDGE AND HASH ONLY. `wavy` and `either` state that the configuration is
 * unknown, which is the opposite of a chiral tag, so an atom carrying one of
 * those is in the same position as an atom carrying nothing.
 *
 * Every grouped atom is considered, stereocentre or not: an imported collection
 * is entitled to name an atom this build does not perceive as stereogenic, and
 * that atom is lost on the way out for exactly the same reason.
 */
export function wedgelessStereoGroupAtoms(mol: Molecule): readonly AtomId[] {
  const groups = stereoGroupsOf(mol);
  if (groups.length === 0) return [];
  const tagged = new Set<AtomId>();
  for (const bondId of mol.bondIds) {
    const bond = getBond(mol, bondId);
    if (bond === undefined) continue;
    if (bond.stereo !== "wedge" && bond.stereo !== "hash") continue;
    tagged.add(bond.from);
  }
  const wedgeless: AtomId[] = [];
  // Group order then atom order inside it, both already canonical
  // (`withStereoGroups` sorts), so the list — and the sentence built from it —
  // is deterministic.
  for (const group of groups) {
    for (const atomId of group.atomIds) {
      if (!tagged.has(atomId)) wedgeless.push(atomId);
    }
  }
  return wedgeless;
}

// ---------------------------------------------------------------------------
// Double bonds
// ---------------------------------------------------------------------------

function doubleBondRanking(mol: Molecule, bondId: BondId): CipDoubleBondRanking | undefined {
  const unit = cipUnits(mol).doubleBondById.get(bondId);
  if (unit === undefined) return undefined;
  if (unit.constitution.kind === "tied") {
    return rankStereoDoubleBond(mol, bondId, drawingConfiguration(mol));
  }
  return rankStereoDoubleBond(mol, bondId);
}

/** Every double bond with a real E/Z choice, in `mol.bondIds` order. */
export function stereogenicBonds(mol: Molecule): readonly BondId[] {
  const perception = perceptionOf(mol);
  if (!perception.bondsComplete) {
    for (const bondId of mol.bondIds) bondDescriptor(mol, bondId);
    perception.bondsComplete = true;
  }
  return mol.bondIds.filter((bondId) => perception.bonds.get(bondId) !== undefined);
}

/**
 * `bondId`'s E/Z, or undefined when the bond has no geometry to state.
 *
 * Read from the COORDINATES: the model stores no cis/trans flag. Aromatic
 * bonds, bonds in rings of seven or fewer atoms, cumulated ends and ends with
 * two identical substituents are not units (cip.ts).
 */
export function doubleBondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  return bondDescriptor(mol, bondId);
}

function computeDoubleBondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  const ranking = doubleBondRanking(mol, bondId);
  if (ranking === undefined || ranking.kind === "not-stereogenic") return undefined;
  const bond = requireBond(mol, bondId);
  // The crossed double bond IS the statement "geometry unknown", and a wavy
  // single bond at either terminus says the same thing about it.
  if (bond.stereo === "either" || hasWavyAt(mol, bond.from) || hasWavyAt(mol, bond.to)) {
    return { kind: "undetermined", reason: "unspecified" };
  }
  if (ranking.kind === "undetermined") return ranking;
  const relation = sideRelation(mol, bond, ranking.topOnFrom, ranking.topOnTo);
  if (relation === 0) return { kind: "undetermined", reason: "ambiguous-geometry" };
  // Same side for the two SENIOR substituents is what Z means.
  return relation > 0 ? { kind: "Z" } : { kind: "E" };
}

// ---------------------------------------------------------------------------
// Structural issues
// ---------------------------------------------------------------------------

/**
 * Drawing problems stereochemistry can see, keyed on the atom to badge.
 *
 * REPORTED AND NEVER REPAIRED. A wedge whose WIDE end turns out to be the
 * stereocentre gets its own message: the fix is to flip the bond. A molecule
 * with a stereogenic axis or plane gets an `unrepresentable-stereo` warning on
 * that element's anchor atom, so an allene never reads as a molecule with
 * nothing to say about its configuration.
 */
export function structuralIssues(mol: Molecule): readonly StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const bondId of mol.bondIds) {
    const bond = getBond(mol, bondId);
    if (bond === undefined) continue;
    if (bond.stereo !== "wedge" && bond.stereo !== "hash") continue;
    // SINGLE BONDS ONLY, the same filter chem-render's stereo pass applies.
    if (bond.order !== 1) continue;
    if (isStereocenter(mol, bond.from)) continue;

    const backwards = isStereocenter(mol, bond.to);
    issues.push({
      atomId: backwards ? bond.to : bond.from,
      // AN ERROR, not a warning (decision 77). A wedge that names no
      // configuration, or that names it at the wrong end, makes the exported
      // file say something the author did not draw — the same kind of wrong
      // as an over-valent carbon. The axis warning below is different: that
      // drawing is CORRECT and this build simply cannot state its
      // configuration, so it must not be counted in red beside these.
      severity: "error",
      kind: backwards ? "wedge-drawn-backwards" : "wedge-on-non-stereocenter",
      bondId,
      message: backwards
        ? `the ${bond.stereo} bond points the wrong way: its narrow end must be ` +
          `at the stereocentre, which is the other atom`
        : `a ${bond.stereo} bond starts at an atom that is not a stereocentre, ` +
          `so it makes no claim a reader can use`,
    });
  }
  for (const element of unrepresentableStereo(mol)) {
    const issue: StructuralIssue = {
      atomId: element.anchorAtomId,
      severity: "warning",
      kind: "unrepresentable-stereo",
      message: `contains a stereogenic axis or plane this build cannot express: ${element.reason}`,
    };
    issues.push(element.bondIds[0] === undefined ? issue : { ...issue, bondId: element.bondIds[0] });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Memoisation
// ---------------------------------------------------------------------------

/**
 * Per-molecule letters, filled in LAZILY. `undefined` is a real, cached
 * result ("not stereogenic"), so the maps are probed with `has`.
 */
interface StereoPerception {
  readonly atoms: Map<AtomId, StereoDescriptor | undefined>;
  readonly bonds: Map<BondId, StereoDescriptor | undefined>;
  atomsComplete: boolean;
  bondsComplete: boolean;
}

/**
 * Keyed on the MOLECULE INSTANCE, deliberately not on the topology
 * fingerprint: positions and `bond.stereo` are inputs here, so a cached
 * letter would survive the drag that reversed it.
 */
const CACHE = new WeakMap<Molecule, StereoPerception>();

function perceptionOf(mol: Molecule): StereoPerception {
  const cached = CACHE.get(mol);
  if (cached !== undefined) return cached;
  const fresh: StereoPerception = {
    atoms: new Map(),
    bonds: new Map(),
    atomsComplete: false,
    bondsComplete: false,
  };
  CACHE.set(mol, fresh);
  return fresh;
}

function atomDescriptor(
  mol: Molecule,
  atomId: AtomId,
): StereoDescriptor | undefined {
  const perception = perceptionOf(mol);
  if (perception.atoms.has(atomId)) return perception.atoms.get(atomId);
  const descriptor = computeCipDescriptor(mol, atomId);
  perception.atoms.set(atomId, descriptor);
  return descriptor;
}

function bondDescriptor(
  mol: Molecule,
  bondId: BondId,
): StereoDescriptor | undefined {
  const perception = perceptionOf(mol);
  if (perception.bonds.has(bondId)) return perception.bonds.get(bondId);
  const descriptor = computeDoubleBondDescriptor(mol, bondId);
  perception.bonds.set(bondId, descriptor);
  return descriptor;
}
