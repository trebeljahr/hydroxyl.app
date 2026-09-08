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
