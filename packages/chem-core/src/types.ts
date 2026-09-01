import type { ElementSymbol } from "./elements.js";
import type { Vec2 } from "./vec.js";

export type AtomId = string;
export type BondId = string;

export type BondOrder = 1 | 2 | 3;

/**
 * Stereo annotation on a bond. Direction is always "narrow end at `from`",
 * matching the molfile convention where the wedge begins at the first atom.
 * Swapping `from`/`to` therefore inverts a wedge — see `flipBond` in ops.ts.
 */
export type BondStereo = "none" | "wedge" | "hash" | "wavy";

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

/** Input for creating an atom. Everything except the element has a default. */
export interface AtomInit {
  readonly element: ElementSymbol;
  readonly pos?: Vec2;
  readonly charge?: number;
  readonly radicalElectrons?: number;
  readonly isotope?: number;
  readonly explicitHydrogenCount?: number;
  readonly aromatic?: boolean;
  readonly label?: string;
}

/** Input for creating a bond. */
export interface BondInit {
  readonly from: AtomId;
  readonly to: AtomId;
  readonly order?: BondOrder;
  readonly stereo?: BondStereo;
  readonly doubleBondSide?: DoubleBondSide;
  readonly aromatic?: boolean;
}
