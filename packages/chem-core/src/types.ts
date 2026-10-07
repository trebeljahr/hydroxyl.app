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
 * What a query or generic atom stands for (decisions 228 and 238). An atom
 * carrying one is NOT an element: its `element` is always `QUERY_ELEMENT`
 * ("*"), which has no valence list, no weight and no monoisotopic mass, so
 * hydrogens, formula and mass treat it as a placeholder rather than guess.
 *
 *   `rgroup`   R, R1, R2… — a Markush substituent. `index` undefined is the
 *              bare "R"; a number is the R-group the molfile's `M  RGP`
 *              names. Indices are 1-based.
 *   `any`      MDL's "A" (any atom but hydrogen) or "*" (any atom at all).
 *   `list`     an element list, `[Cl,Br,I]`, or with `negated` a NOT-list:
 *              any atom except these. MDL's `M  ALS` / V3000's bracket list.
 *   `generic`  a named generic group drawn as a label: X, Ar, Q, Hal… The
 *              label is the whole statement; nothing is inferred from it.
 *
 * Frozen data, compared by value through `atomQueriesEqual`, never by
 * reference: two separately built `{ kind: "any", symbol: "A" }` are the same
 * query, and an edit that rebuilt one must not look like a change.
 */
export type AtomQuery =
  | { readonly kind: "rgroup"; readonly index?: number | undefined }
  | { readonly kind: "any"; readonly symbol: "A" | "*" }
  | {
      readonly kind: "list";
      readonly elements: readonly ElementSymbol[];
      readonly negated: boolean;
    }
  | { readonly kind: "generic"; readonly label: string };

/**
 * A query bond (decisions 228 and 238): the bond is ONE of several orders and
 * the drawing does not say which. Molfile bond types 8, 5, 6 and 7.
 *
 * The bond still carries an `order`, and it is the LOWEST integer order the
 * query admits — 1 for `any`, `single-or-double` and `single-or-aromatic`,
 * 2 for `double-or-aromatic`. Hydrogen counting, over-valence and layout read
 * that order, so a query bond never invents capacity the structure may not
 * have; the issue message says when a query bond was counted that way.
 */
export type BondQuery =
  | "any"
  | "single-or-double"
  | "single-or-aromatic"
  | "double-or-aromatic";

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

/**
 * A statement that several disconnected pieces of the drawing are ONE species
 * (decision 102): the two ions of a salt, a compound and its solvent of
 * crystallisation.
 *
 * A species is otherwise a connected component. Sodium chloride drawn beside
 * an ester is three components, and without this record a scheme would count
 * three reagents, put a plus sign between the ions and give each its own
 * stoichiometric coefficient. The join says the components containing these
 * atoms are one thing, and `species(mol)` in species.ts unions them.
 *
 * JOIN-ONLY. Nothing can split one component into two species: a bond between
 * two reagents has no chemical meaning, so there is no record for it to make.
 *
 * The atoms NAME components rather than enumerate them, so an atom drawn later
 * onto a joined component is in the species with no edit here, and a join
 * whose components the user has since bonded together is redundant, not
 * invalid. `withSpeciesJoins` keeps the list canonical: every join has at
 * least two atoms, no atom is in two joins (overlapping joins are unioned, as
 * joining is transitive), atom ids ascend by `compareIds`, and the joins
 * ascend by their first atom.
 */
export interface SpeciesJoin {
  /** At least two, deduplicated, ascending by `compareIds`. */
  readonly atomIds: readonly AtomId[];
}

/**
 * A contracted abbreviation (decision 225): real atoms drawn as one label —
 * "Boc", "OTBS", "Ph" — with the one bond that joins them to the rest of the
 * structure left in place.
 *
 * A DISPLAY GROUPING OVER ATOMS THAT STAY IN THE GRAPH. Formula, mass,
 * valence, issues and SMILES read the atoms exactly as if the label were not
 * there; only drawing (`contractedView` in abbreviations.ts) and the molfile's
 * `SUP` S-group read this record. That is the line decision 8 draws: an
 * `Atom.label` with no atoms behind it is still refused at export, because
 * nothing says what it stands for, while a superatom says exactly that.
 *
 * NO ATTACHMENT FIELD. The atom a label sits on and the bond it is joined by
 * are DERIVED: the one bond with exactly one end inside the group, and its
 * inside end. Storing them would be a second copy of a fact the bonds already
 * hold, and every bond edit would have to keep the two in step. A group with
 * more than one such bond no longer has one place to sit and is drawn
 * expanded (decision 240) until the extra bond goes.
 *
 * NO EXPANDED STATE. Expanding removes the record; the label is cheap to
 * offer again, and a stored-but-hidden grouping would be a second thing a
 * user could not see and an export would still write.
 */
export interface Abbreviation {
  /** What is drawn in place of the atoms, as typed. Never blank. */
  readonly label: string;
  /** Deduplicated, ascending by `compareIds`; never empty. */
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
   * placeholders: "R", "X". Purely a display concern — valence and formula
   * still use `element`, and molblock export refuses it (decision 8). An
   * abbreviation with real atoms behind it ("Boc" over seven atoms) is an
   * `Abbreviation` on the molecule instead (decision 225), which exports.
   */
  readonly label?: string;
  /**
   * Set exactly when the atom is a query or generic atom, and then `element`
   * is `QUERY_ELEMENT`. See `AtomQuery`.
   */
  readonly query?: AtomQuery;
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
  /**
   * A dative (coordinate) bond, donor `from` -> acceptor `to` (decision 226):
   * the H3N->BH3 of an adduct, the N->Pt of a metal complex. Drawn as an arrow
   * toward the acceptor.
   *
   * A REAL BOND, NOT AN ANNOTATION, because it joins the two pieces into one
   * species and has to survive a molfile round trip as V3000 bond type 9.
   * It contributes NOTHING to the donor's valence and 1 to the acceptor's,
   * which is exactly RDKit's `Bond::getValenceContrib` for DATIVE — measured:
   * RDKit reads `N->B` as NH3 and BH2, and refuses `[NH3]->[BH3]` outright.
   * Diverging would make hydrogens appear or vanish across the round trip.
   *
   * Always a single, non-aromatic bond: `updateBond` clears the flag when the
   * order changes and refuses to set it on a double or triple bond.
   *
   * THE KEY IS OMITTED when false, never present holding `false`, so a
   * document saved before the field existed and one saved after compare equal.
   */
  readonly dative?: true;
  /**
   * Drawn as a wide line (decision 226): the front edge of a Haworth ring or a
   * chair, or emphasis in a figure. PURELY DISPLAY, like `doubleBondSide`:
   * valence, formula and stereo never read it, and the molfile has no field
   * for it, so `writeMolblock` drops it. Omitted when false, as `dative`.
   */
  readonly bold?: true;
  /** A query bond; `order` is then its lowest admitted order. See `BondQuery`. */
  readonly query?: BondQuery;
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
  /**
   * Components that are one species (decision 102). See `SpeciesJoin`.
   *
   * ON THE MOLECULE, not the document, for the reason `stereoGroups` is: which
   * pieces make one compound is a statement about the chemistry, and it has to
   * survive a copy, a paste, a duplicate and a delete exactly as a bond does.
   * Here it rides through `fragment.ts` and `ops.ts` like the stereo groups
   * do; on the document every one of those paths would need a second channel.
   *
   * THE KEY IS OMITTED when nothing is joined, never present holding `[]`, by
   * the same two-spellings argument as `stereoGroups`. `assembleMolecule` is
   * the one place the key is written; `withSpeciesJoins` in species.ts is the
   * one place the list is validated and put in canonical order.
   */
  readonly speciesJoins?: readonly SpeciesJoin[];
  /**
   * Contracted abbreviations (decision 225). See `Abbreviation`.
   *
   * ON THE MOLECULE for `speciesJoins`' reason: a copy, a paste, a delete and
   * an undo have to carry the grouping with its atoms, and a molfile writes it
   * as an S-group. The key is OMITTED when nothing is contracted, never
   * `[]`; `withAbbreviations` in abbreviations.ts validates and orders it.
   */
  readonly abbreviations?: readonly Abbreviation[];
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
  readonly query?: AtomQuery | undefined;
}

/** Input for creating a bond. Optionals are widened as in `AtomInit`. */
export interface BondInit {
  readonly from: AtomId;
  readonly to: AtomId;
  readonly order?: BondOrder | undefined;
  readonly stereo?: BondStereo | undefined;
  readonly doubleBondSide?: DoubleBondSide | undefined;
  readonly aromatic?: boolean | undefined;
  readonly dative?: boolean | undefined;
  readonly bold?: boolean | undefined;
  readonly query?: BondQuery | undefined;
}
