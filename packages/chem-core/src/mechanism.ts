/**
 * Curly arrows as pure electron bookkeeping: apply a mechanism step, report
 * what is wrong with it, and reverse it.
 *
 * NO GEOMETRY. Nothing here reads a coordinate. An arrow is electrons moving
 * from one PLACE to another, and a place is either the non-bonding shell of an
 * atom (its lone pairs and unpaired electrons) or a bond between two atoms.
 * Where the arrow is drawn, how it bows and which way its head points are the
 * drawing's business, in chem-render.
 *
 * VOCABULARY, fixed before any code by the architectural ruling:
 *
 *   - DOUBLE-BARBED is the two-electron curly arrow, `electrons: "pair"`.
 *   - SINGLE-BARBED, or FISHHOOK, is the one-electron arrow, `"single"`.
 *   - The RESONANCE arrow is a straight DOUBLE-HEADED arrow between two
 *     structures. It is not a curly arrow, moves no electrons, and does not
 *     live here. Calling the two-electron curly arrow "double-headed" is the
 *     collision this paragraph exists to prevent.
 *
 * ONE VOCABULARY, NOT TWO (decision 149). `ElectronSource`, `ElectronSink` and
 * `ElectronMove` below are the electron-movement TOPOLOGY. chem-render's scheme
 * model aliases them as `CurlyArrowSource`/`CurlyArrowSink`, and its drawn
 * `CurlyArrowAnnotation` (id, bulge, skew) is assignable to `ElectronMove`, so
 * a document's arrows go straight into `applyArrows`. chem-core still never
 * learns what a DRAWN arrow is: no id, no shape, no anchor, no visibility, no
 * straight arrow. Issues name atoms, bonds and the arrow's INDEX in the list
 * this module was given; the caller maps an index back to its own record.
 *
 * A SOURCE IS ELECTRONS, NEVER A NUCLEUS: a lone pair on an atom, a bond, or an
 * unpaired electron on an atom. There is no "from atom" member, because an
 * arrow from a bare carbon would silently read as a carbanion. A SINK is an
 * atom, a bond, a lone pair on a named atom, or a NEW BOND between two named
 * atoms (decision 166), and never "nothing": a pair that leaves always lands
 * on some atom, and a sink with no source to mirror it would make the reverse
 * of every ionisation undefined.
 *
 * THE SOURCE-TO-SINK RESOLUTION TABLE (decision 150). Every cell has a fixture
 * in mechanism.test.ts. "Forms" makes a new single bond (or adds to one);
 * "promotes" raises an existing bond by one; a bond's pair LEAVING it lowers
 * it by one, and a bond at order zero is removed.
 *
 *   lone pair on A  -> atom C       C bonded to A: PROMOTES A-C. Otherwise
 *                                   FORMS A-C. C = A: aimed at itself.
 *   lone pair on A  -> bond C-D     A an end: PROMOTES C-D. Otherwise the
 *                                   pair would jump: not applied.
 *   lone pair on A  -> lone pair C  electron TRANSFER to C, no bond involved
 *                                   (a fishhook here is a SET; a pair is
 *                                   applied and warned). C = A: itself.
 *   lone pair on A  -> new bond A-C as the atom sink C: forms A-C, or
 *                                   promotes it when already bonded.
 *   bond A-B        -> atom C       C = A or B: HETEROLYSIS, the pair becomes
 *                                   a lone pair on C (a fishhook: C's half of
 *                                   a homolysis). C a third atom: the pair
 *                                   forms (or promotes) a bond X-C, X one end
 *                                   of A-B, chosen by FLOW, then ADJACENCY —
 *                                   see `resolveThirdAtom`, which never lets
 *                                   adjacency read a 1,2-shift. Neither
 *                                   decides: not applied, `ambiguous-bond-end`.
 *   bond A-B        -> bond C-D     sharing one atom: the pair SHIFTS, A-B
 *                                   goes down, C-D goes up. Sharing none: a
 *                                   jump, not applied. The same bond: itself.
 *   bond A-B        -> lone pair C  C = A or B: heterolysis, as the atom
 *                                   sink. A third atom: a jump, not applied.
 *   bond A-B        -> new bond X-C X = A or B, C a third atom: the pair
 *                                   forms (or promotes) X-C, the end STATED
 *                                   rather than found by flow or adjacency.
 *                                   The Markovnikov proton, a 1,2-shift.
 *   radical on A    -> atom C       as the lone-pair row, one electron: half
 *                                   of a new bond (radical recombination).
 *   radical on A    -> bond C-D     A an end: one electron into C-D (half of
 *                                   a pi bond, as in a beta-scission).
 *   radical on A    -> lone pair C  one electron handed to C (a SET).
 *   radical on A    -> new bond A-C as the atom sink C, one electron.
 *
 * A NEW-BOND SINK `[end, atom]` (decision 199) names a bond PLACE: `end` must
 * be where the electrons start — the atom of a lone pair or radical, one end
 * of a bond — and a bond already there is promoted, exactly as a lone pair
 * aimed at a bonded atom promotes it. Written backwards (`atom` on the source,
 * `end` not) it is `new-bond-end`; neither on the source is a jump, and a new
 * bond that is the source bond itself is an arrow at itself.
 *
 * THE WHOLE STEP AT ONCE (decision 130). `applyArrows` does not fold one
 * arrow at a time: an SN2 applied that way has a five-valent carbon as its
 * intermediate in either order. It sums every move into ONE electron delta
 * per atom and per bond, and writes each once. The formal charge follows from
 * the bookkeeping and from nothing else:
 *
 *     charge change = -(non-bonding electrons gained) - (bond orders gained)
 *
 * so an atom donating a lone pair into a new bond goes +1, an atom taking a
 * bond's pair as a lone pair goes -1, and the far end of a bond that lost its
 * pair goes +1. Charges on atoms no arrow touches stay exactly as drawn, and
 * nothing is recomputed from valence — a deliberately drawn charge-separated
 * form survives. Fishhooks follow the same bookkeeping with one electron, so
 * a homolysis changes radical counts and leaves charges alone.
 *
 * NEVER REFUSE THE SET. A teaching figure shows a wrong mechanism on purpose,
 * so like `sprout` and `valenceIssues` a bad arrow set APPLIES AND REPORTS: a
 * pentavalent carbon draws and is reported. What an arrow cannot do is ask
 * for a state the model cannot hold, or leave unsaid where its electrons go.
 * Such an arrow is skipped, reported, and the rest of the step still applies:
 *
 *   - electrons that are not there: a lone pair the atom does not have (the
 *     "push from the carbon" arrow), an unpaired electron it does not have, or
 *     a pair another arrow of the step already moves. Availability is judged
 *     over the WHOLE step, deliveries included, so a pair that arrives by one
 *     arrow may leave by another; the later claimant is the conflict.
 *   - an aromatic-FLAGGED bond: it has no order to consume or raise, and
 *     kekulising a copy first would change WHICH ring bonds are double, so the
 *     arrow the author drew could land on a single bond. Judged on the bond
 *     the arrow CHANGES, not the one it names: a lone pair aimed at a ring
 *     neighbour's atom reaches the ring bond between them just the same.
 *   - a bond's pair aimed at a third atom where nothing in the drawing says
 *     which end bonds to it, including a 1,2-shift adjacency would otherwise
 *     misread as an elimination (decision 153).
 *   - a bond past triple, a single electron left alone in a bond, a double-
 *     barbed arrow from an unpaired electron, a jump between places that share
 *     no atom, an arrow aimed at where it starts, and a new bond named from
 *     the atom the electrons are going to rather than the one they leave.
 *
 * SATURATION IS NEVER ASKED OF `bondOrderSum`. Lone pairs come from
 * `lonePairCount` and over-valence from `isOverValent`, both on
 * `explicitValence`, which is what keeps an importer's aromatic flags from
 * inventing a half-filled atom.
 *
 * WHAT THE STEP LEAVES ALONE. Atoms are never created or deleted, so heavy
 * atoms and drawn hydrogens are conserved by construction. IMPLICIT hydrogens
 * are derived and are NOT: an arrow that changes an atom's valence silently
 * changes its derived count — the one-arrow SN2 loses two hydrogens from its
 * carbon while the valence badge stays quiet. `mechanismIssues` compares every
 * touched atom's derived count across the step and reports a change. Bond
 * marks (wedge, hash, either, double-bond side) stay as drawn when a bond's
 * order changes; `structuralIssues` reports a mark that no longer means
 * anything. A formed bond is unmarked, and takes its id from the reactant's
 * counter in arrow order. Stereo groups and species joins name atoms and are
 * carried unchanged.
 *
 * REVERSAL (decision 151). `reverseArrows(reactant, arrows)` spells, in the
 * PRODUCT's vocabulary, the arrows that take the product back. It needs the
 * reactant because a bond the step forms is named by an id minted from the
 * reactant's counter. It is total: every applied move has a reverse, and each
 * resolves on its own, with no flow or adjacency: a shift whose bond the step
 * broke goes back as a shift into a new bond (decision 199). The reactant
 * comes back STRUCTURALLY:
 * every atom field for field and every bond by its unordered atom pair, bond
 * ids excluded, since a bond the step broke is re-formed with a fresh id and
 * no mark (which face re-forms is geometry, and for an SN1 ion pair it is
 * genuinely both).
 *
 * TWO KNOWN RESIDUALS, both pinned by tests:
 *
 *   - Where the forward step itself CHANGED A DERIVED HYDROGEN COUNT — which
 *     `mechanismIssues` reports — valence reads part of a delivered pair as
 *     hydrogens: t-butyl bromide's central carbon keeping one methyl's pair
 *     and losing another's is a carbene by bookkeeping and a CH2 to valence.
 *     The reverse arrow that should take that pair back then finds no lone
 *     pair and is skipped. Every step that keeps its derived counts reverses
 *     exactly; a randomised test holds that over hundreds of steps.
 *   - A fishhook moved through space OUT of an atom that keeps an unpaired
 *     electron afterwards (a triplet carbene handing one electron to a lone
 *     pair) reverses into a pairing at that atom, because a lone-pair sink
 *     pairs with an unpaired electron when there is one. The vocabulary has
 *     no "arrive unpaired" sink for a through-space electron.
 *
 * WHAT ONLY THE NEW-BOND SINK CAN SAY. An ATOM sink says which atom a bond's
 * electrons reach but not which end of their own bond goes with them. Flow
 * and adjacency recover most drawings; three common ones they cannot, and
 * aimed at the atom each is reported rather than guessed. Aimed at the new
 * bond (decision 166), each applies and reverses:
 *
 *   - Markovnikov protonation, propene's pi pair to HBr's proton: which
 *     carbon takes the proton. `newBond [C1, H]` says it.
 *   - a 1,2-shift (hydride, Wagner-Meerwein, ring expansion), the migrating
 *     bond's pair to the cation: at the atom, `ambiguous-bond-end` (decision
 *     153); at `newBond [migrant, cation]`, the shift.
 *   - hydrogen-atom abstraction drawn as the textbook's three fishhooks, with
 *     the C-H electron aimed at the H it leaves with: at the H ATOM that reads
 *     as the H's half of a C-H homolysis, and the Br radical's electron is
 *     then half a bond, `unpaired-bond-electron`. At `newBond [H, Br]` it is
 *     the abstraction, and so is the C-H electron aimed at the Br atom, which
 *     flow resolves.
 *
 * HYDROGENS ARE DERIVED, NOT FORBIDDEN (decision 131). Protonation and
 * deprotonation are the two commonest arrows in organic chemistry, and an
 * arrow cannot anchor to a derived hydrogen. `promoteImplicitHydrogen`, in its
 * own module, turns one into a real atom first; it is never called from here.
 */

import type { ElementSymbol } from "./elements.js";
import { assembleMolecule } from "./builders.js";
import { hillOrder } from "./formula.js";
import { lonePairCount } from "./lewis.js";
import { bondBetween, cloneAtomWith } from "./molecule.js";
import { speciesOf } from "./species.js";
import type { Atom, AtomId, Bond, BondId, BondOrder, Molecule } from "./types.js";
import { implicitHydrogenCount, isOverValent } from "./valence.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** `pair`: double-barbed, two electrons. `single`: single-barbed fishhook. */
export const ELECTRON_COUNTS = ["pair", "single"] as const;
export type ElectronCount = (typeof ELECTRON_COUNTS)[number];

/**
 * Where an arrow's electrons come from: a lone pair on an atom, a bond, or an
 * unpaired electron on an atom. Never a bare atom.
 */
export type ElectronSource =
  | { readonly kind: "lonePair"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "radical"; readonly atomId: AtomId };

/**
 * Where they go: an atom, a bond, a lone pair on a named atom, or the new
 * bond between `end` — where the electrons start — and `atom`. Never
 * "nothing". See the table in the header for what each combination does.
 */
export type ElectronSink =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "lonePair"; readonly atomId: AtomId }
  | { readonly kind: "newBond"; readonly atomIds: readonly [end: AtomId, atom: AtomId] };

/** One curly arrow's chemistry: how many electrons move, from where, to where. */
export interface ElectronMove {
  readonly electrons: ElectronCount;
  readonly source: ElectronSource;
  readonly sink: ElectronSink;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type MechanismIssueKind =
  /** An arrow names an atom or bond the structure does not have. */
  | "unknown-reference"
  /** An arrow ends where it starts. */
  | "self-target"
  /** An arrow's electrons would have to jump to a place sharing no atom. */
  | "disconnected"
  /** A bond's pair is aimed at a third atom and nothing says which end bonds. */
  | "ambiguous-bond-end"
  /** A new-bond sink names first the atom the electrons go to, not the one they leave. */
  | "new-bond-end"
  /** An arrow starts or ends on an aromatic-flagged bond. */
  | "aromatic-bond"
  /** A double-barbed arrow starts at an unpaired electron. */
  | "pair-from-radical"
  /** An arrow starts at a lone pair the atom does not have. */
  | "no-lone-pair"
  /** A fishhook starts at an unpaired electron the atom does not have. */
  | "no-radical"
  /** An arrow claims electrons another arrow of the step already moves. */
  | "electron-conflict"
  /** The step would raise a bond past a triple bond. */
  | "bond-order-overflow"
  /** The step would leave a single electron alone in a bond. */
  | "unpaired-bond-electron"
  /** A pair moves from one atom's lone pairs to another's, through no bond. Applied. */
  | "electron-transfer"
  /** A touched atom's derived hydrogen count changed across the step. */
  | "hydrogens-changed"
  /** A touched atom is over-valent after the step and was not before. */
  | "product-over-valent"
  /** Two structures joined as resonance forms differ in formula. */
  | "resonance-formula-differs"
  /** Two structures joined as resonance forms differ in net charge. */
  | "resonance-charge-differs";

/**
 * A mechanism problem, located, in the shape of `ValenceIssue`: `atomId` is
 * the ANCHOR a UI centres on, `atomIds` and `bondIds` everything concerned,
 * `message` the sentence and `label` the few words beside the atom.
 *
 * `arrowIndices` are positions in the arrow list the issue was computed
 * from — never annotation ids, which chem-core does not know — the arrow at
 * fault first, then any earlier arrow it conflicts with.
 */
export interface MechanismIssue {
  readonly kind: MechanismIssueKind;
  readonly atomId: AtomId;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  readonly arrowIndices: readonly number[];
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Places and moves
// ---------------------------------------------------------------------------

/** The non-bonding shell of one atom, or the bond between two. */
type Place =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly ends: readonly [AtomId, AtomId] };

function atomPlace(atomId: AtomId): Place {
  return { kind: "atom", atomId };
}

/** Ends sorted, so one bond is one place whichever way it is named. */
function bondPlace(x: AtomId, y: AtomId): Place {
  return { kind: "bond", ends: x < y ? [x, y] : [y, x] };
}

function placeKey(place: Place): string {
  return place.kind === "atom"
    ? `atom\u0000${place.atomId}`
    : `bond\u0000${place.ends[0]}\u0000${place.ends[1]}`;
}

function samePlace(p: Place, q: Place): boolean {
  return placeKey(p) === placeKey(q);
}

/** One arrow, resolved to the electrons it moves between two places. */
interface Move {
  readonly index: number;
  readonly electrons: 1 | 2;
  readonly from: Place;
  readonly to: Place;
  /** For an atom `from`: whether they leave its lone pairs or its unpaired
   *  electrons. `bond` for a bond `from`. */
  readonly takes: "lonePair" | "radical" | "bond";
  /** A single electron reaching an atom `to` may pair with an unpaired
   *  electron there: true for a lone-pair sink, false for a heterolysis end. */
  readonly mayPair: boolean;
  /** For a bond `to`: the end the electrons come from, which a NEW bond is
   *  drawn from. */
  readonly donor: AtomId;
}

interface Refusal {
  readonly index: number;
  readonly kind: MechanismIssueKind;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  /** Earlier arrows this one conflicts with. */
  readonly others: readonly number[];
}

/** A bond's pair aimed at a third atom, waiting for the whole step's flow. */
interface PendingThirdAtom {
  readonly index: number;
  readonly electrons: 1 | 2;
  readonly bond: Bond;
  readonly target: AtomId;
}

type Local =
  | { readonly kind: "move"; readonly move: Move }
  | { readonly kind: "refused"; readonly refusal: Refusal }
  | { readonly kind: "pending"; readonly pending: PendingThirdAtom };

function ownAtom(mol: Molecule, atomId: AtomId): Atom | undefined {
  return Object.hasOwn(mol.atoms, atomId) ? mol.atoms[atomId] : undefined;
}

function ownBond(mol: Molecule, bondId: BondId): Bond | undefined {
  return Object.hasOwn(mol.bonds, bondId) ? mol.bonds[bondId] : undefined;
}

function refused(
  index: number,
  kind: MechanismIssueKind,
  atomIds: readonly AtomId[],
  bondIds: readonly BondId[] = [],
  others: readonly number[] = [],
): Local {
  return { kind: "refused", refusal: { index, kind, atomIds, bondIds, others } };
}

/**
 * Phase one: resolve an arrow on its own, as far as it can be without the
 * rest of the step. Only a bond's pair aimed at a third atom needs the others.
 */
function resolveLocal(mol: Molecule, arrow: ElectronMove, index: number): Local {
  const electrons: 1 | 2 = arrow.electrons === "pair" ? 2 : 1;
  const { source, sink } = arrow;

  // Every reference must exist. `Object.hasOwn`, so an id of "constructor"
  // does not find a function up Object.prototype.
  const missingAtoms: AtomId[] = [];
  const missingBonds: BondId[] = [];
  const presentAtoms: AtomId[] = [];
  const presentBonds: BondId[] = [];
  for (const end of [source, sink]) {
    if (end.kind === "bond") {
      (ownBond(mol, end.bondId) ? presentBonds : missingBonds).push(end.bondId);
    } else {
      for (const atomId of end.kind === "newBond" ? end.atomIds : [end.atomId]) {
        (ownAtom(mol, atomId) ? presentAtoms : missingAtoms).push(atomId);
      }
    }
  }
  if (missingAtoms.length > 0 || missingBonds.length > 0) {
    const ends = presentBonds.flatMap((id) => {
      const bond = ownBond(mol, id)!;
      return [bond.from, bond.to];
    });
    return refused(index, "unknown-reference", unique([...presentAtoms, ...ends]), presentBonds);
  }

  const sourceBond = source.kind === "bond" ? ownBond(mol, source.bondId) : undefined;
  const sinkBond = sink.kind === "bond" ? ownBond(mol, sink.bondId) : undefined;
  // A NAMED aromatic bond is refused here, before a third-atom arrow could
  // wait on it. A flagged bond an arrow reaches WITHOUT naming it is refused
  // once its place is resolved, in `refuseAromatic`.
  for (const bond of [sourceBond, sinkBond]) {
    if (bond?.aromatic) return refused(index, "aromatic-bond", [bond.from, bond.to], [bond.id]);
  }

  if (source.kind === "lonePair" || source.kind === "radical") {
    const a = source.atomId;
    if (source.kind === "radical" && electrons === 2) {
      return refused(index, "pair-from-radical", [a]);
    }
    const move = (to: Place, mayPair: boolean): Local => ({
      kind: "move",
      move: { index, electrons, from: atomPlace(a), to, takes: source.kind, mayPair, donor: a },
    });
    switch (sink.kind) {
      case "atom":
        if (sink.atomId === a) return refused(index, "self-target", [a]);
        return move(bondPlace(a, sink.atomId), false);
      case "bond": {
        const bond = sinkBond!;
        if (bond.from !== a && bond.to !== a) {
          return refused(index, "disconnected", [a, bond.from, bond.to], [bond.id]);
        }
        return move(bondPlace(bond.from, bond.to), false);
      }
      case "lonePair":
        if (sink.atomId === a) return refused(index, "self-target", [a]);
        return move(atomPlace(sink.atomId), true);
      case "newBond": {
        const [end, c] = sink.atomIds;
        if (end !== a) {
          return c === a
            ? refused(index, "new-bond-end", [a, end])
            : refused(index, "disconnected", unique([a, end, c]));
        }
        if (c === a) return refused(index, "self-target", [a]);
        // As the atom sink: forms A-C, or promotes it when already bonded.
        return move(bondPlace(a, c), false);
      }
    }
  }

  const bond = sourceBond!;
  const from = bondPlace(bond.from, bond.to);
  const move = (to: Place, mayPair: boolean, donor: AtomId): Local => ({
    kind: "move",
    move: { index, electrons, from, to, takes: "bond", mayPair, donor },
  });
  switch (sink.kind) {
    case "atom": {
      const c = sink.atomId;
      if (c === bond.from || c === bond.to) return move(atomPlace(c), false, c);
      return { kind: "pending", pending: { index, electrons, bond, target: c } };
    }
    case "bond": {
      const target = sinkBond!;
      if (target.id === bond.id) return refused(index, "self-target", [bond.from, bond.to], [bond.id]);
      const shared = [target.from, target.to].filter((x) => x === bond.from || x === bond.to);
      const pivot = shared[0];
      if (pivot === undefined) {
        return refused(
          index,
          "disconnected",
          [bond.from, bond.to, target.from, target.to],
          [bond.id, target.id],
        );
      }
      return move(bondPlace(target.from, target.to), false, pivot);
    }
    case "lonePair": {
      const c = sink.atomId;
      if (c === bond.from || c === bond.to) return move(atomPlace(c), true, c);
      return refused(index, "disconnected", [bond.from, bond.to, c], [bond.id]);
    }
    case "newBond": {
      // The third-atom cell with the forming end STATED: no flow, no
      // adjacency, so decision 153's guard is never asked (decision 199).
      const [end, c] = sink.atomIds;
      const onSource = (x: AtomId): boolean => x === bond.from || x === bond.to;
      if (!onSource(end)) {
        return onSource(c)
          ? refused(index, "new-bond-end", [c, end], [bond.id])
          : refused(index, "disconnected", unique([bond.from, bond.to, end, c]), [bond.id]);
      }
      // `end` itself, or the other end: the new bond is the source bond.
      if (onSource(c)) return refused(index, "self-target", [bond.from, bond.to], [bond.id]);
      return move(bondPlace(end, c), false, end);
    }
  }
}

/**
 * Phase two: the bond A-B whose pair is aimed at a third atom C. The pair
 * forms (or promotes) X-C for ONE end X, and the drawing does not say which,
 * so two rules are tried in order:
 *
 *   1. FLOW. An end that RECEIVES electrons from another arrow of the step,
 *      into any place other than X-C itself, is not the end that also takes
 *      C. In a Diels-Alder the diene's inner carbon receives the first
 *      arrow's pair, so the second arrow's pair bonds its outer carbon to the
 *      dienophile; in a radical addition the pi bond's other electron goes to
 *      the far carbon, so the near one pairs with the radical. Every
 *      pericyclic arrow cycle resolves this way.
 *   2. ADJACENCY. Failing that, the one end already bonded to C promotes that
 *      bond — the allyl shift, or an elimination drawn to the cation whose
 *      proton another arrow takes (scope's rule: a sink already bonded to the
 *      source promotes rather than forms).
 *
 * ADJACENCY NEVER READS A 1,2-SHIFT AS AN ELIMINATION. When A-B is a SINGLE
 * bond, this arrow breaks it, and if no other arrow of the step touches the
 * end Y that adjacency would leave behind, the drawing is exactly a 1,2-shift
 * aimed at the cation: a hydride shift (C-H to C+), a Wagner-Meerwein alkyl
 * shift, a ring expansion. Adjacency would instead promote X-C and strand Y
 * as a cation no arrow receives — a bare H+ or a free methyl cation — and
 * report nothing, which is a different reaction presented as the drawn one.
 * So the arrow is reported `ambiguous-bond-end`; the shift itself is spelled
 * by aiming it at the NEW bond, which never comes through here. A pi pair
 * (A-B double or triple) leaves A-B standing, and its only other reading is a
 * three-membered ring, so the allyl shift keeps the adjacency rule; so does
 * any arrow whose Y another arrow speaks for. The elimination is spelled
 * unambiguously as the C-H pair into the C-C bond, the shift cell.
 *
 * Neither: the arrow is not applied. Propene plus HBr drawn pi-to-H is the
 * honest example: which carbon takes the proton is not in the drawing until
 * the arrow is aimed at the new C-H bond.
 */
function resolveThirdAtom(
  mol: Molecule,
  pending: PendingThirdAtom,
  moves: readonly Move[],
  others: readonly PendingThirdAtom[],
): Local {
  const { index, electrons, bond, target } = pending;
  const ends: readonly AtomId[] = [bond.from, bond.to];

  const receivesElsewhere = (end: AtomId): boolean => {
    const forming = bondPlace(end, target);
    for (const move of moves) {
      if (move.index === index) continue;
      const to = move.to;
      const receives = to.kind === "atom" ? to.atomId === end : to.ends.includes(end);
      if (receives && !samePlace(to, forming)) return true;
    }
    for (const other of others) {
      if (other.index === index || other.target !== end) continue;
      // It forms a bond from `end` to one end of ITS source bond. That can be
      // the very bond this one forms only if our target is among those ends.
      if (other.bond.from !== target && other.bond.to !== target) return true;
    }
    return false;
  };

  /** Whether any OTHER arrow of the step names `atomId`, as an end or a target. */
  const touchedElsewhere = (atomId: AtomId): boolean =>
    moves.some(
      (move) =>
        move.index !== index &&
        (placeAtoms(move.from).includes(atomId) || placeAtoms(move.to).includes(atomId)),
    ) ||
    others.some(
      (other) =>
        other.index !== index &&
        (other.target === atomId || other.bond.from === atomId || other.bond.to === atomId),
    );

  const byFlow = ends.filter((end) => !receivesElsewhere(end));
  let forming: AtomId | undefined = byFlow.length === 1 ? byFlow[0] : undefined;
  if (forming === undefined) {
    const bonded = ends.filter((end) => bondBetween(mol, end, target) !== undefined);
    const candidate = bonded.length === 1 ? bonded[0]! : undefined;
    const stranded = candidate === bond.from ? bond.to : bond.from;
    const drawnAsShift = bond.order === 1 && !touchedElsewhere(stranded);
    if (candidate !== undefined && !drawnAsShift) forming = candidate;
  }
  if (forming === undefined) {
    return refused(index, "ambiguous-bond-end", [bond.from, bond.to, target], [bond.id]);
  }
  return {
    kind: "move",
    move: {
      index,
      electrons,
      from: bondPlace(bond.from, bond.to),
      to: bondPlace(forming, target),
      takes: "bond",
      mayPair: false,
      donor: forming,
    },
  };
}

/**
 * Refuses a resolved move that takes electrons from, or adds them to, a bond
 * carrying an aromatic flag. Judged on the RESOLVED places, not the spelling:
 * a lone pair aimed at a neighbouring ATOM promotes the bond between them, and
 * a bond's pair aimed at a third atom can land on a ring bond by the adjacency
 * rule, and neither arrow names the bond it would change.
 */
function refuseAromatic(mol: Molecule, local: Local): Local {
  if (local.kind !== "move") return local;
  for (const place of [local.move.from, local.move.to]) {
    if (place.kind !== "bond") continue;
    const bond = bondBetween(mol, place.ends[0], place.ends[1]);
    if (bond?.aromatic) {
      return refused(local.move.index, "aromatic-bond", [bond.from, bond.to], [bond.id]);
    }
  }
  return local;
}

/** Phases one and two: every arrow as a move or a refusal, in arrow order. */
function resolveAll(
  mol: Molecule,
  arrows: readonly ElectronMove[],
): { readonly moves: readonly Move[]; readonly refusals: readonly Refusal[] } {
  const locals = arrows.map((arrow, index) => refuseAromatic(mol, resolveLocal(mol, arrow, index)));
  const moves: Move[] = [];
  const pendings: PendingThirdAtom[] = [];
  for (const local of locals) {
    if (local.kind === "move") moves.push(local.move);
    if (local.kind === "pending") pendings.push(local.pending);
  }
  const resolved = new Map<number, Local>();
  for (const pending of pendings) {
    resolved.set(pending.index, refuseAromatic(mol, resolveThirdAtom(mol, pending, moves, pendings)));
  }
  const allMoves: Move[] = [];
  const refusals: Refusal[] = [];
  locals.forEach((local, index) => {
    const final = local.kind === "pending" ? resolved.get(index)! : local;
    if (final.kind === "move") allMoves.push(final.move);
    else if (final.kind === "refused") refusals.push(final.refusal);
  });
  return { moves: allMoves, refusals };
}

// ---------------------------------------------------------------------------
// Availability: electrons that are not there are not moved
// ---------------------------------------------------------------------------

/** Lone-pair electrons an atom starts the step with. */
function lonePairElectrons(mol: Molecule, atomId: AtomId): number {
  const count = lonePairCount(mol, atomId);
  switch (count.kind) {
    case "counted":
    case "pinned":
      return 2 * count.pairs;
    case "unknown":
      // A metal carries no valence data: its electrons cannot be counted, so
      // they cannot be proved absent either. An over-subscribed atom has
      // spent more than it owns and has none.
      return count.reason === "no-valence-data" ? Infinity : 0;
  }
}

/** Bond electrons at a place before the step: two per order, none if unbonded. */
function initialBondElectrons(mol: Molecule, place: Place): number {
  if (place.kind !== "bond") return 0;
  const bond = bondBetween(mol, place.ends[0], place.ends[1]);
  return bond === undefined ? 0 : 2 * bond.order;
}

const MAX_BOND_ELECTRONS = 6;

/**
 * Phase three: drop every move asking for electrons that are not there, or
 * for a state the model cannot hold. Iterated, because dropping a move takes
 * its deliveries away and can starve a later one; each round only drops, so
 * it ends.
 */
function admit(
  mol: Molecule,
  moves: readonly Move[],
): { readonly admitted: readonly Move[]; readonly refusals: readonly Refusal[] } {
  const dropped = new Map<number, Refusal>();
  for (;;) {
    const live = moves.filter((move) => !dropped.has(move.index));
    let changed = false;

    // Deliveries into each pool, from every live move. The pools mirror
    // `computeStep`'s bookkeeping exactly, so what is admitted here is what
    // that applies:
    //   - lone pairs, counted in PAIRS: an arriving pair adds one; a single
    //     electron that pairs with an unpaired one adds one; an arrow from a
    //     lone pair takes one whole pair, one or two electrons of it;
    //   - unpaired electrons: an arriving single that does not pair adds one,
    //     and so does the partner left behind when one electron leaves a pair;
    //   - bond electrons, two per order.
    const pairArrivals = new Map<AtomId, number>();
    const unpairedArrivals = new Map<AtomId, number>();
    const pairingArrivals = new Map<AtomId, number>();
    const bondArrivals = new Map<string, number>();
    for (const move of live) {
      const to = move.to;
      if (to.kind === "atom") {
        if (move.electrons === 2) bump(pairArrivals, to.atomId, 1);
        else if (move.mayPair) bump(pairingArrivals, to.atomId, 1);
        else bump(unpairedArrivals, to.atomId, 1);
      } else {
        bump(bondArrivals, placeKey(to), move.electrons);
      }
      if (move.from.kind === "atom" && move.takes === "lonePair" && move.electrons === 1) {
        bump(unpairedArrivals, move.from.atomId, 1);
      }
    }

    const consumed = new Map<string, number>();
    const claimants = new Map<string, number[]>();
    const claim = (move: Move, pool: string, need: number, available: number, none: MechanismIssueKind) => {
      const used = consumed.get(pool) ?? 0;
      if (used + need > available) {
        const earlier = claimants.get(pool) ?? [];
        const kind = earlier.length > 0 ? "electron-conflict" : none;
        dropped.set(move.index, placeRefusal(mol, move, kind, earlier));
        changed = true;
        return;
      }
      consumed.set(pool, used + need);
      claimants.set(pool, [...(claimants.get(pool) ?? []), move.index]);
    };

    // Unpaired electrons first: a single electron reaching a lone-pair sink
    // pairs only with what the step's radical arrows leave behind.
    const radicalsLeft = new Map<AtomId, number>();
    const radicalsAvailable = (atomId: AtomId): number =>
      ownAtom(mol, atomId)!.radicalElectrons + (unpairedArrivals.get(atomId) ?? 0);
    for (const move of live) {
      if (move.from.kind !== "atom" || move.takes !== "radical") continue;
      const a = move.from.atomId;
      claim(move, `radical\u0000${a}`, move.electrons, radicalsAvailable(a), "no-radical");
    }
    if (changed) continue;
    for (const atomId of pairingArrivals.keys()) {
      const spent = consumed.get(`radical\u0000${atomId}`) ?? 0;
      radicalsLeft.set(atomId, Math.max(0, radicalsAvailable(atomId) - spent));
    }

    for (const move of live) {
      const from = move.from;
      if (from.kind === "bond") {
        const pool = placeKey(from);
        const available = initialBondElectrons(mol, from) + (bondArrivals.get(pool) ?? 0);
        claim(move, pool, move.electrons, available, "electron-conflict");
      } else if (move.takes === "lonePair") {
        const a = from.atomId;
        const pairing = Math.min(pairingArrivals.get(a) ?? 0, radicalsLeft.get(a) ?? 0);
        const available = lonePairElectrons(mol, a) / 2 + (pairArrivals.get(a) ?? 0) + pairing;
        claim(move, `pair\u0000${a}`, 1, available, "no-lone-pair");
      }
    }
    if (changed) continue;

    // The bond places a live move reaches: past triple, or an odd electron.
    const net = new Map<string, number>();
    for (const move of live) {
      if (move.from.kind === "bond") bump(net, placeKey(move.from), -move.electrons);
      if (move.to.kind === "bond") bump(net, placeKey(move.to), move.electrons);
    }
    for (const move of live) {
      for (const place of [move.from, move.to]) {
        if (place.kind !== "bond") continue;
        const final = initialBondElectrons(mol, place) + (net.get(placeKey(place)) ?? 0);
        if (final > MAX_BOND_ELECTRONS && move.to.kind === "bond" && samePlace(move.to, place)) {
          // Drop the LAST arrow raising it: the earlier ones were drawn first.
          const raisers = live.filter((m) => m.to.kind === "bond" && samePlace(m.to, place));
          const last = raisers[raisers.length - 1]!;
          dropped.set(last.index, placeRefusal(mol, last, "bond-order-overflow", []));
          changed = true;
        } else if (final % 2 !== 0 && move.electrons === 1) {
          dropped.set(move.index, placeRefusal(mol, move, "unpaired-bond-electron", []));
          changed = true;
        }
        if (changed) break;
      }
      if (changed) break;
    }
    if (changed) continue;

    // A bond that RECEIVES electrons must survive the step: a pair passed
    // through a bond that the same step empties leaves the bond's reverse
    // arrow nothing to start from. The last arrow draining it is the one
    // that asks too much.
    for (const move of live) {
      const to = move.to;
      if (to.kind !== "bond") continue;
      const key = placeKey(to);
      if (initialBondElectrons(mol, to) + (net.get(key) ?? 0) > 0) continue;
      const drainers = live.filter((m) => m.from.kind === "bond" && placeKey(m.from) === key);
      const arrivers = live.filter((m) => m.to.kind === "bond" && placeKey(m.to) === key);
      const last = drainers[drainers.length - 1]!;
      dropped.set(
        last.index,
        placeRefusal(mol, last, "electron-conflict", arrivers.map((m) => m.index)),
      );
      changed = true;
      break;
    }
    if (!changed) {
      return { admitted: live, refusals: [...dropped.values()] };
    }
  }
}

function bump<K>(map: Map<K, number>, key: K, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function placeAtoms(place: Place): readonly AtomId[] {
  return place.kind === "atom" ? [place.atomId] : place.ends;
}

function placeRefusal(
  mol: Molecule,
  move: Move,
  kind: MechanismIssueKind,
  others: readonly number[],
): Refusal {
  const atomIds = unique([...placeAtoms(move.from), ...placeAtoms(move.to)]);
  const bondIds: BondId[] = [];
  for (const place of [move.from, move.to]) {
    if (place.kind !== "bond") continue;
    const bond = bondBetween(mol, place.ends[0], place.ends[1]);
    if (bond !== undefined) bondIds.push(bond.id);
  }
  return { index: move.index, kind, atomIds, bondIds: unique(bondIds), others };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Applying the step
// ---------------------------------------------------------------------------

/** Everything one step computes, memoised per (molecule, arrow list). */
interface Step {
  readonly product: Molecule;
  readonly admitted: readonly Move[];
  readonly refusals: readonly Refusal[];
  /** Whether each admitted single electron reaching an atom paired there. */
  readonly paired: ReadonlyMap<number, boolean>;
  /** The product's bond at a place, including a bond the step formed. */
  bondAt(place: Place): BondId | undefined;
  /** Atoms whose charge, radicals or bonds the step changed. */
  readonly touched: readonly AtomId[];
}

const STEPS = new WeakMap<Molecule, WeakMap<readonly ElectronMove[], Step>>();

function step(mol: Molecule, arrows: readonly ElectronMove[]): Step {
  let perMolecule = STEPS.get(mol);
  if (perMolecule === undefined) {
    perMolecule = new WeakMap();
    STEPS.set(mol, perMolecule);
  }
  const hit = perMolecule.get(arrows);
  if (hit !== undefined) return hit;
  const built = computeStep(mol, arrows);
  perMolecule.set(arrows, built);
  return built;
}

function computeStep(mol: Molecule, arrows: readonly ElectronMove[]): Step {
  const resolved = resolveAll(mol, arrows);
  const { admitted, refusals: dropped } = admit(mol, resolved.moves);
  const refusals = [...resolved.refusals, ...dropped].sort((p, q) => p.index - q.index);

  // Per-atom electron deltas: non-bonding electrons, unpaired electrons, and
  // bond orders gained. Per-bond-place electron deltas.
  const nonBonding = new Map<AtomId, number>();
  const unpaired = new Map<AtomId, number>();
  const bondElectrons = new Map<string, number>();
  const placesByKey = new Map<string, Place>();
  const donorByKey = new Map<string, AtomId>();

  // The unpaired electrons a lone-pair sink may pair with: what the atom had,
  // plus what the step leaves unpaired there, minus what it takes away.
  const pool = new Map<AtomId, number>();
  for (const move of admitted) {
    if (move.from.kind === "atom") {
      const a = move.from.atomId;
      if (move.takes === "radical") bump(pool, a, -move.electrons);
      else if (move.electrons === 1) bump(pool, a, 1);
    }
    if (move.to.kind === "atom" && move.electrons === 1 && !move.mayPair) {
      bump(pool, move.to.atomId, 1);
    }
  }
  const available = (atomId: AtomId): number =>
    ownAtom(mol, atomId)!.radicalElectrons + (pool.get(atomId) ?? 0);
  const pairings = new Map<AtomId, number>();

  const paired = new Map<number, boolean>();
  for (const move of admitted) {
    const e = move.electrons;
    if (move.from.kind === "atom") {
      const a = move.from.atomId;
      bump(nonBonding, a, -e);
      if (move.takes === "radical") bump(unpaired, a, -e);
      else if (e === 1) bump(unpaired, a, 1);
    } else {
      const key = placeKey(move.from);
      placesByKey.set(key, move.from);
      bump(bondElectrons, key, -e);
    }
    if (move.to.kind === "atom") {
      const c = move.to.atomId;
      bump(nonBonding, c, e);
      if (e === 1) {
        const canPair = move.mayPair && available(c) - (pairings.get(c) ?? 0) > 0;
        if (canPair) {
          bump(pairings, c, 1);
          bump(unpaired, c, -1);
        } else {
          bump(unpaired, c, 1);
        }
        paired.set(move.index, canPair);
      }
    } else {
      const key = placeKey(move.to);
      placesByKey.set(key, move.to);
      bump(bondElectrons, key, e);
      if (!donorByKey.has(key)) donorByKey.set(key, move.donor);
    }
  }

  // Bond orders gained per atom, and the new bond records.
  const orderGain = new Map<AtomId, number>();
  const changedBonds = new Map<BondId, Bond | null>();
  const formed: Bond[] = [];
  const formedByKey = new Map<string, BondId>();
  let nextId = mol.nextId;
  for (const [key, delta] of bondElectrons) {
    if (delta === 0) continue;
    const place = placesByKey.get(key)!;
    if (place.kind !== "bond") continue;
    const [x, y] = place.ends;
    bump(orderGain, x, delta / 2);
    bump(orderGain, y, delta / 2);
    const existing = bondBetween(mol, x, y);
    if (existing !== undefined) {
      const order = existing.order + delta / 2;
      changedBonds.set(
        existing.id,
        order === 0 ? null : { ...existing, order: order as BondOrder },
      );
    }
  }
  // New bonds in arrow order, so their ids are reproducible from the reactant.
  for (const move of admitted) {
    if (move.to.kind !== "bond") continue;
    const key = placeKey(move.to);
    if (formedByKey.has(key)) continue;
    const [x, y] = move.to.ends;
    if (bondBetween(mol, x, y) !== undefined) continue;
    const delta = bondElectrons.get(key) ?? 0;
    if (delta <= 0) continue;
    const donor = donorByKey.get(key)!;
    const id = `b${nextId++}`;
    formedByKey.set(key, id);
    formed.push({
      id,
      from: donor,
      to: donor === x ? y : x,
      order: (delta / 2) as BondOrder,
      stereo: "none",
      doubleBondSide: "auto",
      aromatic: false,
    });
  }

  // Atom records: one charge, radical and lone-pair-pin delta each.
  const touchedSet = new Set<AtomId>();
  const nextAtoms: Record<AtomId, Atom> = {};
  let atomsChanged = false;
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId]!;
    const dN = nonBonding.get(atomId) ?? 0;
    const dRad = unpaired.get(atomId) ?? 0;
    const dOrder = orderGain.get(atomId) ?? 0;
    const dCharge = -dN - dOrder;
    if (dN !== 0 || dRad !== 0 || dOrder !== 0) touchedSet.add(atomId);
    if (dCharge === 0 && dRad === 0 && (atom.lonePairs === undefined || dN === dRad)) {
      nextAtoms[atomId] = atom;
      continue;
    }
    atomsChanged = true;
    nextAtoms[atomId] = cloneAtomWith(atom, {
      charge: atom.charge + dCharge,
      radicalElectrons: atom.radicalElectrons + dRad,
      ...(atom.lonePairs === undefined ? {} : { lonePairs: atom.lonePairs + (dN - dRad) / 2 }),
    });
  }
  for (const [bondId] of changedBonds) {
    const bond = mol.bonds[bondId]!;
    touchedSet.add(bond.from);
    touchedSet.add(bond.to);
  }

  const bondAtProduct = (place: Place): BondId | undefined => {
    if (place.kind !== "bond") return undefined;
    const key = placeKey(place);
    const minted = formedByKey.get(key);
    if (minted !== undefined) return minted;
    const existing = bondBetween(mol, place.ends[0], place.ends[1]);
    if (existing === undefined) return undefined;
    return changedBonds.get(existing.id) === null ? undefined : existing.id;
  };
  const touched = mol.atomIds.filter((id) => touchedSet.has(id));

  if (!atomsChanged && changedBonds.size === 0 && formed.length === 0) {
    return { product: mol, admitted, refusals, paired, bondAt: bondAtProduct, touched };
  }

  const bonds: Record<BondId, Bond> = {};
  const bondIds: BondId[] = [];
  for (const bondId of mol.bondIds) {
    const change = changedBonds.get(bondId);
    if (change === null) continue;
    bonds[bondId] = change ?? mol.bonds[bondId]!;
    bondIds.push(bondId);
  }
  for (const bond of formed) {
    bonds[bond.id] = bond;
    bondIds.push(bond.id);
  }
  const product = assembleMolecule({
    atoms: atomsChanged ? nextAtoms : mol.atoms,
    bonds,
    atomIds: mol.atomIds,
    bondIds,
    nextId,
    // Groups and joins name atoms, and a step creates and deletes none.
    stereoGroups: mol.stereoGroups,
    speciesJoins: mol.speciesJoins,
    abbreviations: mol.abbreviations,
  });
  return { product, admitted, refusals, paired, bondAt: bondAtProduct, touched };
}

/**
 * The molecule after one mechanism step: every arrow's electrons moved at
 * once, one charge, radical and bond-order delta per atom and bond.
 *
 * Never refuses the set. An arrow that asks for electrons that are not there,
 * or for a state the model cannot hold, is skipped and reported by
 * `mechanismIssues`; the rest applies. Returns `mol` itself when nothing
 * changes, so a caller can tell a no-op by identity.
 */
export function applyArrows(mol: Molecule, arrows: readonly ElectronMove[]): Molecule {
  return step(mol, arrows).product;
}

// ---------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------

/**
 * The arrows that take `applyArrows(reactant, arrows)` back to `reactant`,
 * named in the PRODUCT's vocabulary.
 *
 * Takes the reactant, not just the arrows, because a bond the step forms is
 * named by an id minted from the reactant's counter, and the reverse arrow
 * that breaks it again has to name it.
 *
 * TOTAL BY CONSTRUCTION. Every applied move has a reverse:
 *
 *   formation A-C from A's lone pair   -> the A-C pair back to A
 *   heterolysis of A-B toward A        -> A's lone pair back into A-B
 *   transfer from A's shell to C's     -> C's shell back to A's
 *   shift of the pair S-Z to S-W       -> the pair S-W back to S-Z
 *
 * and each is spelled so that it resolves back to exactly that move ON ITS
 * OWN: no reverse arrow is a bond's pair aimed at a third atom, so none goes
 * through the flow or adjacency rules, and none waits on the rest of the set.
 * A shift whose bond S-Z the step broke goes back as the S-W pair into the
 * NEW bond S-Z (decision 199) — a 1,2-shift reverses as the shift back, not as
 * a heterolysis to S and S's donation to Z, which bookkeeps the same and
 * draws a hydride or a methyl anion that never existed. An arrow the forward
 * step skipped did nothing and has no reverse.
 */
export function reverseArrows(
  reactant: Molecule,
  arrows: readonly ElectronMove[],
): readonly ElectronMove[] {
  const forward = step(reactant, arrows);
  const product = forward.product;
  return forward.admitted.map((move) => reverseOf(move));

  function reverseOf(move: Move): ElectronMove {
    const electrons: ElectronCount = move.electrons === 2 ? "pair" : "single";
    const source = sourceAt(move);
    const from = move.from;
    if (from.kind === "atom") {
      const a = from.atomId;
      // Electrons back into A's shell. A bond source reaching one of its own
      // ends is a heterolysis; a single electron that left a PAIR must pair
      // again, one that left an unpaired electron must come back unpaired.
      if (source.kind === "bond") {
        const sink: ElectronSink =
          move.electrons === 1 && move.takes === "lonePair"
            ? { kind: "lonePair", atomId: a }
            : { kind: "atom", atomId: a };
        return { electrons, source, sink };
      }
      return { electrons, source, sink: { kind: "lonePair", atomId: a } };
    }

    // Electrons back into the bond S-Z.
    const [x, y] = from.ends;
    if (source.kind !== "bond") {
      // From an atom's shell: that atom is one end; the other is the target.
      const donor = source.atomId;
      const other = donor === x ? y : x;
      return { electrons, source, sink: { kind: "atom", atomId: other } };
    }
    // A shift: the pair left S-Z for S-W, and `to` is S-W. S is the pivot.
    const to = move.to;
    const pivot = to.kind === "bond" ? to.ends.find((end) => end === x || end === y) : undefined;
    if (pivot === undefined) throw new Error("reverseArrows: a shift shares no atom");
    const far = pivot === x ? y : x;
    const existing = bondBetween(product, x, y);
    return {
      electrons,
      source,
      sink:
        existing !== undefined
          ? { kind: "bond", bondId: existing.id }
          : { kind: "newBond", atomIds: [pivot, far] },
    };
  }

  /** Where the reverse arrow starts: the place this move's electrons reached. */
  function sourceAt(move: Move): ElectronSource {
    const to = move.to;
    if (to.kind === "bond") {
      const bondId = forward.bondAt(to);
      // An admitted move's destination bond always exists in the product: it
      // only gained electrons, and nothing formed from nothing is at zero.
      if (bondId === undefined) throw new Error("reverseArrows: a reached bond is missing");
      return { kind: "bond", bondId };
    }
    const c = to.atomId;
    if (move.electrons === 2) return { kind: "lonePair", atomId: c };
    // One electron: back out of a pair if it paired, else it is unpaired.
    return forward.paired.get(move.index) === true
      ? { kind: "lonePair", atomId: c }
      : { kind: "radical", atomId: c };
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const SEVERITY: Readonly<Record<MechanismIssueKind, "error" | "warning">> = {
  "unknown-reference": "error",
  "self-target": "error",
  disconnected: "error",
  "ambiguous-bond-end": "error",
  "new-bond-end": "error",
  "aromatic-bond": "error",
  "pair-from-radical": "error",
  "no-lone-pair": "error",
  "no-radical": "error",
  "electron-conflict": "error",
  "bond-order-overflow": "error",
  "unpaired-bond-electron": "error",
  "electron-transfer": "warning",
  "hydrogens-changed": "error",
  "product-over-valent": "error",
  "resonance-formula-differs": "error",
  "resonance-charge-differs": "error",
};

function elementOf(mol: Molecule, atomId: AtomId): string {
  return ownAtom(mol, atomId)?.element ?? "?";
}

function bondName(mol: Molecule, bondId: BondId): string {
  const bond = ownBond(mol, bondId);
  return bond === undefined ? "a bond" : `the ${elementOf(mol, bond.from)}-${elementOf(mol, bond.to)} bond`;
}

/** The sentence and the canvas label for an issue about one arrow. */
function refusalText(mol: Molecule, refusal: Refusal): readonly [string, string] {
  const n = `Arrow ${refusal.index + 1}`;
  const first = refusal.atomIds[0];
  const atom = first === undefined ? "the atom" : elementOf(mol, first);
  const bond = refusal.bondIds[0] === undefined ? "the bond" : bondName(mol, refusal.bondIds[0]);
  const skipped = "; not applied";
  switch (refusal.kind) {
    case "unknown-reference":
      return [`${n} names an atom or bond that is not in the structure${skipped}`, "missing anchor"];
    case "self-target":
      return [`${n} ends where it starts${skipped}`, "arrow to itself"];
    case "disconnected":
      return [
        `${n} would move electrons to a place that shares no atom with where they are${skipped}`,
        "electrons cannot jump",
      ];
    case "ambiguous-bond-end":
      return [
        `${n} sends ${bond}'s electrons to a third atom, and nothing says which end bonds to it; aim it at the new bond between the two atoms that bond${skipped}`,
        "which end bonds?",
      ];
    case "new-bond-end": {
      // Written [the atom the electrons start at, the atom named first].
      const [start, named] = refusal.atomIds;
      const at = start === undefined ? "one atom" : elementOf(mol, start);
      const other = named === undefined ? "another" : elementOf(mol, named);
      return [
        `${n} names its new bond from ${other}, but its electrons start at ${at}: name ${at} first${skipped}`,
        "new bond backwards",
      ];
    }
    case "aromatic-bond":
      return [
        `${n} uses an aromatic bond, which has no single order to take electrons from or add them to${skipped}`,
        "aromatic bond",
      ];
    case "pair-from-radical":
      return [
        `${n} is double-barbed but starts at an unpaired electron on ${atom}; draw a fishhook, or start at a lone pair`,
        "pair from a radical",
      ];
    case "no-lone-pair":
      return [`${n} starts at a lone pair ${atom} does not have${skipped}`, "no lone pair"];
    case "no-radical":
      return [`${n} starts at an unpaired electron ${atom} does not have${skipped}`, "no unpaired electron"];
    case "electron-conflict": {
      const others = refusal.others.map((i) => `${i + 1}`).join(", ");
      return [
        `${n} claims electrons that ${others === "" ? "another arrow" : `arrow ${others}`} already moves${skipped}`,
        "electrons already used",
      ];
    }
    case "bond-order-overflow":
      return [`${n} would raise ${bond} past a triple bond${skipped}`, "beyond a triple bond"];
    case "unpaired-bond-electron":
      return [
        `${n} leaves one electron alone in ${bond}: a fishhook into a bond needs a partner${skipped}`,
        "half a bond",
      ];
    case "electron-transfer": {
      const [a, c] = refusal.atomIds;
      const from = a === undefined ? "one atom" : elementOf(mol, a);
      const to = c === undefined ? "another" : elementOf(mol, c);
      // Bonded or not, the pair goes shell to shell: a bond between the two
      // atoms keeps its order, which is the part worth saying.
      const where =
        refusal.bondIds[0] === undefined
          ? "through no bond"
          : `straight across; ${bondName(mol, refusal.bondIds[0])} between them does not change`;
      return [`${n} moves a pair from ${from}'s lone pairs to ${to}'s, ${where}`, "pair transfer"];
    }
    case "hydrogens-changed":
    case "product-over-valent":
    case "resonance-formula-differs":
    case "resonance-charge-differs":
      // Never a refusal: these are about atoms and structures, built below.
      return [`${n}`, ""];
  }
}

/**
 * `atomId` is the first atom concerned. It is empty only for an arrow none of
 * whose references exist, which pruning on delete makes unreachable from a
 * document and which a caller can still name by `arrowIndices`.
 */
function refusalIssue(mol: Molecule, refusal: Refusal): MechanismIssue {
  const [message, label] = refusalText(mol, refusal);
  return {
    kind: refusal.kind,
    atomId: refusal.atomIds[0] ?? "",
    atomIds: refusal.atomIds,
    bondIds: refusal.bondIds,
    arrowIndices: [refusal.index, ...refusal.others],
    severity: SEVERITY[refusal.kind],
    message,
    label,
  };
}

/**
 * Everything wrong with one mechanism step, in arrow order and then atom
 * order: the arrows `applyArrows` skipped and why, a pair moved from one
 * atom's lone pairs to another's, and what the applied arrows did to the atoms
 * they touched —
 * a DERIVED hydrogen count that changed, and an atom newly over-valent.
 *
 * The hydrogen check is what catches the arrow set that is wrong in a way
 * valence cannot see: hydroxide's arrow into bromomethane with the leaving
 * group's arrow forgotten leaves a C- with two bonds and ONE derived
 * hydrogen, which is a clean carbanion to `valenceIssues`, and three
 * hydrogens short of the carbon it started as.
 */
export function mechanismIssues(
  mol: Molecule,
  arrows: readonly ElectronMove[],
): readonly MechanismIssue[] {
  const result = step(mol, arrows);
  const issues: MechanismIssue[] = result.refusals.map((refusal) => refusalIssue(mol, refusal));

  for (const move of result.admitted) {
    if (move.electrons === 2 && move.from.kind === "atom" && move.to.kind === "atom") {
      const between = bondBetween(mol, move.from.atomId, move.to.atomId);
      issues.push(
        refusalIssue(mol, {
          index: move.index,
          kind: "electron-transfer",
          atomIds: [move.from.atomId, move.to.atomId],
          bondIds: between === undefined ? [] : [between.id],
          others: [],
        }),
      );
    }
  }
  issues.sort((p, q) => p.arrowIndices[0]! - q.arrowIndices[0]!);

  const product = result.product;
  if (product === mol) return issues;
  for (const atomId of result.touched) {
    const element = elementOf(mol, atomId);
    const before = implicitHydrogenCount(mol, atomId);
    const after = implicitHydrogenCount(product, atomId);
    if (before !== after) {
      issues.push({
        kind: "hydrogens-changed",
        atomId,
        atomIds: [atomId],
        bondIds: [],
        arrowIndices: arrowsTouching(result.admitted, atomId),
        severity: SEVERITY["hydrogens-changed"],
        message: `${element} goes from ${before} to ${after} implied ${after === 1 ? "hydrogen" : "hydrogens"}: the charge and bonds the arrows leave on it read as a different hydrogen count`,
        label: `${element}: H ${before} to ${after}`,
      });
    }
    if (isOverValent(product, atomId) && !isOverValent(mol, atomId)) {
      issues.push({
        kind: "product-over-valent",
        atomId,
        atomIds: [atomId],
        bondIds: [],
        arrowIndices: arrowsTouching(result.admitted, atomId),
        severity: SEVERITY["product-over-valent"],
        message: `${element} is over-valent after the arrows are applied`,
        label: `${element} over-valent after`,
      });
    }
  }
  return issues;
}

function arrowsTouching(moves: readonly Move[], atomId: AtomId): number[] {
  return moves
    .filter((m) => placeAtoms(m.from).includes(atomId) || placeAtoms(m.to).includes(atomId))
    .map((m) => m.index);
}

// ---------------------------------------------------------------------------
// Composition, counted three ways
// ---------------------------------------------------------------------------

/**
 * What a set of atoms is made of, with the hydrogens kept in TWO piles: the H
 * atoms actually drawn, and the implicit ones valence derives (a pinned count
 * included). Comparing only the total hides a promotion's bookkeeping — one
 * hydrogen moves from the implicit pile to the drawn one with nothing gained
 * or lost — and comparing only the implicit pile reports that promotion as a
 * lost hydrogen. Kept apart, both read correctly.
 */
export interface Composition {
  /** Non-hydrogen atoms by element. */
  readonly heavyAtoms: Readonly<Record<ElementSymbol, number>>;
  /** Hydrogen atoms drawn in the graph, isotopes included. */
  readonly hydrogenAtoms: number;
  /** Hydrogens derived from valence, pinned counts included. */
  readonly implicitHydrogens: number;
  readonly netCharge: number;
}

/** The composition of `atomIds` (default: every atom). Unknown ids are skipped. */
export function composition(mol: Molecule, atomIds: readonly AtomId[] = mol.atomIds): Composition {
  const heavyAtoms: Record<ElementSymbol, number> = {};
  let hydrogenAtoms = 0;
  let implicitHydrogens = 0;
  let netCharge = 0;
  for (const atomId of unique(atomIds)) {
    const atom = ownAtom(mol, atomId);
    if (atom === undefined) continue;
    if (atom.element === "H") hydrogenAtoms++;
    else heavyAtoms[atom.element] = (heavyAtoms[atom.element] ?? 0) + 1;
    implicitHydrogens += implicitHydrogenCount(mol, atomId);
    netCharge += atom.charge;
  }
  return { heavyAtoms, hydrogenAtoms, implicitHydrogens, netCharge };
}

// ---------------------------------------------------------------------------
// Two structures joined by a straight arrow
// ---------------------------------------------------------------------------

/**
 * What a straight arrow between species claims. `resonance`: the two sides
 * are one compound drawn two ways. `reaction`: one turns into the other,
 * routinely with a by-product left undrawn.
 */
export type SpeciesRelation = "resonance" | "reaction";

/**
 * The problems with joining the species named by `from` and `to` (one atom
 * per species, as a scheme arrow names them) under `relation`.
 *
 * RESONANCE forms are one compound, so their formulas and net charges must
 * agree; a difference means a hydrogen or a charge was lost in the redrawing.
 * A REACTION is NOT checked: "A -> B" routinely leaves the water, the salt or
 * the leaving group off the page, and flagging every such scheme would bury
 * the one real error. Hence the relation argument rather than two functions a
 * caller could mix up.
 */
export function speciesRelationIssues(
  mol: Molecule,
  relation: SpeciesRelation,
  from: readonly AtomId[],
  to: readonly AtomId[],
): readonly MechanismIssue[] {
  if (relation === "reaction") return [];
  const side = (refs: readonly AtomId[]): AtomId[] => {
    const atoms: AtomId[] = [];
    for (const ref of refs) {
      if (ownAtom(mol, ref) === undefined) continue;
      atoms.push(...(speciesOf(mol, ref)?.atomIds ?? [ref]));
    }
    return unique(atoms);
  };
  const left = side(from);
  const right = side(to);
  const anchor = [...from, ...to].find((ref) => ownAtom(mol, ref) !== undefined);
  if (anchor === undefined) return [];
  const a = composition(mol, left);
  const b = composition(mol, right);
  const issues: MechanismIssue[] = [];
  const refs = unique([...from, ...to].filter((ref) => ownAtom(mol, ref) !== undefined));
  if (formulaKey(a) !== formulaKey(b)) {
    issues.push({
      kind: "resonance-formula-differs",
      atomId: anchor,
      atomIds: refs,
      bondIds: [],
      arrowIndices: [],
      severity: SEVERITY["resonance-formula-differs"],
      message: `Resonance forms must have one formula; these are ${formulaKey(a)} and ${formulaKey(b)}`,
      label: "formula differs",
    });
  }
  if (a.netCharge !== b.netCharge) {
    issues.push({
      kind: "resonance-charge-differs",
      atomId: anchor,
      atomIds: refs,
      bondIds: [],
      arrowIndices: [],
      severity: SEVERITY["resonance-charge-differs"],
      message: `Resonance forms must have one net charge; these carry ${a.netCharge} and ${b.netCharge}`,
      label: "charge differs",
    });
  }
  return issues;
}

/** Element counts with every hydrogen folded in, in Hill order: a formula. */
function formulaKey(c: Composition): string {
  const counts: Record<ElementSymbol, number> = { ...c.heavyAtoms };
  const h = c.hydrogenAtoms + c.implicitHydrogens;
  if (h > 0) counts["H"] = h;
  return hillOrder(counts)
    .map((symbol) => {
      const n = counts[symbol] ?? 0;
      return n === 1 ? symbol : `${symbol}${n}`;
    })
    .join("");
}
