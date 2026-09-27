import type { ElementSymbol } from "./elements.js";
import type { Vec2 } from "./vec.js";

export type AtomId = string;
export type BondId = string;

export type BondOrder = 1 | 2 | 3;

/**
 * Stereo annotation on a bond. Direction is always "narrow end at `from`",
 * matching the molfile convention where the wedge begins at the first atom.
 * Swapping `from`/`to` therefore inverts a wedge — see `flipBond` in ops.ts.
 *
 * `wedge`, `hash` and `wavy` describe a SINGLE bond: out of the page, into the
 * page, and "configuration unknown at this centre". `either` describes a
 * DOUBLE bond — the crossed double bond, meaning cis/trans unspecified.
 * They are separate members rather than one "unknown" because they are two
 * different statements about two different kinds of uncertainty, and because
 * the model has to be able to hold one: V2000 bond stereo code 3 is `either`,
 * and a real SDF hands you one on any double bond whose geometry was never
 * determined. Folding it into `wavy` would export code 4 on a double bond,
 * which readers interpret as a stereocentre rather than a geometry.
 *
 * A MIRROR (flipAtoms in transform.ts) exchanges `wedge` and `hash` and leaves
 * `wavy` and `either` alone: an undetermined configuration has no handedness
 * to reverse.
 */
export type BondStereo = "none" | "wedge" | "hash" | "wavy" | "either";

/**
 * Which side of the bond axis the second line of a double bond sits on.
 * `auto` lets the renderer decide from ring membership and substituents,
 * which is right almost always; the other values are a manual override for
 * the cases where a chemist wants it the other way for a figure.
 */
export type DoubleBondSide = "auto" | "left" | "right" | "centered";

/**
 * Enhanced stereochemistry: what a SET of stereocentres asserts about its own
 * configuration (decision 24).
 *
 *   `abs`  the drawn configuration is the one present — a single enantiomer.
 *   `and`  the sample holds this configuration AND the one with every centre in
 *          the group inverted together: a racemate, labelled `rac-`.
 *   `or`   ONE of those two is present and which one is unknown: relative
 *          configuration only, labelled `rel-`.
 *
 * A GROUP OF ATOM IDS, NOT A PER-ATOM TAG, because the claim is about the set
 * and a tag cannot express it. Two atoms each tagged `and` would be
 * indistinguishable from two atoms in ONE `and` group, and those are different
 * compounds: one group says the two centres invert together, which is two
 * species; two groups say they invert independently, which is four.
 *
 * ABSENT IS NOT AN `abs` GROUP (decision 91). No groups at all means nothing
 * was ever said about configuration, which is what a plain drawing and almost
 * every V2000 file mean. An `abs` group is a positive assertion that these
 * centres are absolute — it is what earns a per-centre `abs` tag on a figure
 * and a V3000 STEABS line. Folding the two together would normalise a file's
 * own statement away on a round trip.
 */
export type StereoGroupKind = "abs" | "and" | "or";

/**
 * One ABS/AND/OR collection.
 *
 * THE INDEX IS STORED, NEVER DERIVED FROM ARRAY POSITION (decision 92). The
 * `&1` / `&2` of a V3000 file and the `and1` / `or1` of a figure tag are the
 * file's own numbering. Deriving the number from a position here would renumber
 * a group on any unrelated edit — deleting group 1's atoms would promote group 2
 * to `&1` — so two writes of the same imported file would differ. Indices run
 * PER KIND, so `and` 1 and `or` 1 are different groups; `ABS_STEREO_GROUP_INDEX`
 * in stereo-groups.ts says why an `abs` group's is always 1.
 *
 * AN ATOM IS IN AT MOST ONE GROUP. That is MDL collection semantics, and it is
 * what makes a figure's per-centre tag single-valued. `withStereoGroups` in
 * stereo-groups.ts enforces it on every write, and the document schema enforces
 * it on decode.
 */
export interface StereoGroup {
  readonly kind: StereoGroupKind;
  /** 1-based and per kind. Stored, never derived — see above. */
  readonly index: number;
  /** Deduplicated and ascending by `compareIds`; never empty. */
  readonly atomIds: readonly AtomId[];
}

export interface Atom {
  readonly id: AtomId;
  readonly element: ElementSymbol;
  readonly pos: Vec2;
  /** Formal charge. */
  readonly charge: number;
  /** Unpaired electrons: 0 normal, 1 radical, 2 carbene/diradical. */
  readonly radicalElectrons: number;
  /** Mass number for a labelled atom, e.g. 13 for 13-C. Undefined = natural. */
  readonly isotope?: number;
  /**
   * Pins the hydrogen count instead of deriving it from valence. Undefined
   * means "derive", which is what you want for almost every atom.
   */
  readonly explicitHydrogenCount?: number;
  /**
   * Set by aromaticity perception, never by the user directly.
   */
  readonly aromatic: boolean;
  /**
   * Pins the lone-pair count instead of deriving it from the electron count.
   * Undefined means "derive", which is what you want for almost every atom.
   *
   * DERIVED WITH AN OVERRIDE (decision 4), exactly like the hydrogens, and
   * for the same reason: a lone pair is bookkeeping the model can do from
   * valence electrons, formal charge and bonding, so storing one per atom
   * would be a second copy of a number that is already implied — and the two
   * would disagree the first time a bond order changed.
   *
   * The override exists because two readings of the same drawing are both
   * standard and no rule can pick between them. A sulfone's sulfur has zero
   * lone pairs under the expanded-octet reading the model stores and two
   * under the charge-separated one, and a chemist drawing a resonance form
   * means a particular one. Same for hypervalent phosphorus. So the pin
   * carries the reading, and nothing else does.
   *
   * PURELY DISPLAY-ADJACENT: it feeds `lonePairCount` and therefore the Lewis
   * view, and nothing in valence, formula or mass reads it. V2000 has no field
   * for it, so `writeMolblock` drops it — silently, unlike a display label,
   * because a dropped lone pair changes no chemistry the file records.
   */
  readonly lonePairs?: number;
  /**
   * Free-text label that replaces the element symbol when drawing, for
   * abbreviations and placeholders: "R", "Ph", "Boc", "X". Purely a display
   * concern — valence and formula still use `element`.
   */
  readonly label?: string;
}

export interface Bond {
  readonly id: BondId;
  /** Narrow end of a wedge/hash. */
  readonly from: AtomId;
  readonly to: AtomId;
  readonly order: BondOrder;
  readonly stereo: BondStereo;
  readonly doubleBondSide: DoubleBondSide;
  /** Set by aromaticity perception, never by the user directly. */
  readonly aromatic: boolean;
}

/**
 * A 2D structure.
 *
 * Flat and acyclic by construction: atoms reference each other only through
 * ids held on bonds. The old model hung `Atom` object references off each
 * bond, which made the structure a cyclic graph of mutable class instances —
 * unserializable, uncomparable, and impossible to snapshot for undo.
 *
 * `atomIds` / `bondIds` carry insertion order, which molfile round-trips and
 * stereo parity both depend on.
 *
 * `nextId` is a monotonic counter. Ids are never reused, so a stale reference
 * held by an undo entry can never silently resolve to a different atom.
 */
export interface Molecule {
  readonly atoms: Readonly<Record<AtomId, Atom>>;
  readonly bonds: Readonly<Record<BondId, Bond>>;
  readonly atomIds: readonly AtomId[];
  readonly bondIds: readonly BondId[];
  readonly nextId: number;
  /**
   * Enhanced stereochemistry groups (decision 24).
   *
   * ON THE MOLECULE because a group is CONFIGURATION, not view state: it
   * changes which compound the drawing names, so it has to survive a save, a
   * copy, a merge and an export exactly the way a wedge does. Decision 12 keeps
   * view state off the molecule and puts configuration on it.
   *
   * THE KEY IS OMITTED when the molecule says nothing about grouping, never
   * present holding an empty array. `{}` and `{ stereoGroups: [] }` would be two
   * spellings of one statement that no `toEqual` and no `JSON.stringify` would
   * match, and absent already means something different from an `abs` group
   * (decision 91). `assembleMolecule` in builders.ts is the one place the key is
   * written and it drops an empty list; `withStereoGroups` in stereo-groups.ts is
   * the one place the list is validated and put in canonical order.
   */
  readonly stereoGroups?: readonly StereoGroup[];
}

/**
 * Input for creating an atom. Everything except the element has a default.
 *
 * The optional fields admit an explicit `undefined` — meaning "use the
 * default" — because under `exactOptionalPropertyTypes` a bare `x?: number`
 * rejects `{ isotope: labelled ? 13 : undefined }`, which is how a caller
 * threading a maybe-value naturally writes it.
 */
export interface AtomInit {
  readonly element: ElementSymbol;
  readonly pos?: Vec2 | undefined;
  readonly charge?: number | undefined;
  readonly radicalElectrons?: number | undefined;
  readonly isotope?: number | undefined;
  readonly explicitHydrogenCount?: number | undefined;
  readonly aromatic?: boolean | undefined;
  readonly lonePairs?: number | undefined;
  readonly label?: string | undefined;
}

/** Input for creating a bond. Optionals are widened as in `AtomInit`. */
export interface BondInit {
  readonly from: AtomId;
  readonly to: AtomId;
  readonly order?: BondOrder | undefined;
  readonly stereo?: BondStereo | undefined;
  readonly doubleBondSide?: DoubleBondSide | undefined;
  readonly aromatic?: boolean | undefined;
}
