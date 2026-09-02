/**
 * What to draw: which of the several standard views of a structure is being
 * rendered, and which optional annotations are switched on.
 *
 * The whole reason this editor exists is that one molecule has to appear in a
 * figure in several representations. A representation is therefore a first
 * class value that travels with a scene, not a pile of booleans on a
 * component.
 */

/** Structural 2D views: drawn as a graph, so the display flags all apply. */
export type StructuralViewKind = "skeletal" | "kekule" | "explicitH" | "lewis";

/** Text-shaped views: a run of glyphs, not a graph. Flags are meaningless here. */
export type TextViewKind = "condensed" | "sumFormula";

export type ViewKind = StructuralViewKind | TextViewKind;

export interface DisplayFlags {
  readonly showCarbonLabels: boolean;
  readonly showImplicitHydrogens: boolean;
  readonly showLonePairs: boolean;
  readonly showCharges: boolean;
  readonly showStereoBonds: boolean;
  readonly showAtomIndices: boolean;
  /**
   * Draw a perceived aromatic ring as one inscribed circle instead of the
   * stored Kekule alternation.
   *
   * PER STRUCTURE, not per style preset. Both benzene.svg and
   * circular-benzene.svg were wanted in the toolbar, so a figure has to be
   * able to say "this one draws the circle" — a preset-wide choice cannot
   * express that. The preset only supplies the INITIAL value, which
   * `defaultRepresentation` in @starter/shared reads when a document is
   * created.
   *
   * It is a display flag and nothing more: the bond orders in the model stay
   * Kekule, which is the storage form. Turning it on suppresses the second
   * line of every bond in a ring that actually got a circle — a ring below the
   * geometry floor draws no circle and therefore keeps its alternation, rather
   * than coming out as a bare hexagon with nothing inside it.
   */
  readonly aromaticCircles: boolean;
}

export interface StructuralRepresentation {
  readonly kind: StructuralViewKind;
  readonly flags: DisplayFlags;
}

export interface TextRepresentation {
  readonly kind: TextViewKind;
}

/**
 * A discriminated union, not one struct with a flags field that some kinds
 * ignore.
 *
 * "C6H6" has no carbon vertices to label, no lone pairs to draw and no bonds
 * to wedge. A flags bag hanging off it would be dead state: the UI could set
 * `showLonePairs` on a sum formula, the toggle would light up, and nothing
 * anywhere would honour it. Making it unrepresentable is cheaper than
 * explaining it.
 */
export type Representation = StructuralRepresentation | TextRepresentation;

export const STRUCTURAL_VIEW_KINDS: readonly StructuralViewKind[] = Object.freeze([
  "skeletal",
  "kekule",
  "explicitH",
  "lewis",
]);

export const TEXT_VIEW_KINDS: readonly TextViewKind[] = Object.freeze([
  "condensed",
  "sumFormula",
]);

/** Structural kinds first: that is the order a view picker should offer them. */
export const VIEW_KINDS: readonly ViewKind[] = Object.freeze([
  ...STRUCTURAL_VIEW_KINDS,
  ...TEXT_VIEW_KINDS,
]);

/**
 * The neutral baseline: a plain skeletal drawing.
 *
 * Carbons and their hydrogens are implied rather than drawn — that is what
 * makes a skeletal formula readable — while charges and stereochemistry stay
 * on, because hiding either changes what the structure *means* rather than
 * how busy it looks.
 */
export const DEFAULT_DISPLAY_FLAGS: DisplayFlags = Object.freeze({
  showCarbonLabels: false,
  showImplicitHydrogens: false,
  showLonePairs: false,
  showCharges: true,
  showStereoBonds: true,
  showAtomIndices: false,
  // Off by default even on skeletal: chem-core stores benzene as an explicit
  // Kekule ring, so a circle drawn ON TOP of the alternation would state the
  // delocalisation twice. Switching the flag on is what makes the renderer
  // suppress the alternation and draw the circle instead.
  aromaticCircles: false,
});

/**
 * What each structural view is understood to mean, expressed as flags.
 *
 * These are the defaults a user gets when they pick a view from a menu; every
 * one of them stays overridable, because "Kekulé but without the carbon
 * labels" is a legitimate thing to want in a figure.
 */
export const DEFAULT_FLAGS_BY_KIND: Readonly<
  Record<StructuralViewKind, DisplayFlags>
> = Object.freeze({
  skeletal: DEFAULT_DISPLAY_FLAGS,
  // Kekulé draws the localised alternating double bonds and spells the atoms
  // out; the hydrogens still ride along on the labels rather than as vertices.
  kekule: Object.freeze({ ...DEFAULT_DISPLAY_FLAGS, showCarbonLabels: true }),
  // Every hydrogen becomes a drawn atom — the view you switch to when a
  // mechanism turns on which proton moved.
  explicitH: Object.freeze({
    ...DEFAULT_DISPLAY_FLAGS,
    showCarbonLabels: true,
    showImplicitHydrogens: true,
  }),
  // Lewis is electron bookkeeping: lone pairs are the whole point, and wedges
  // are off because the diagram is deliberately not making a 3D claim.
  lewis: Object.freeze({
    ...DEFAULT_DISPLAY_FLAGS,
    showCarbonLabels: true,
    showImplicitHydrogens: true,
    showLonePairs: true,
    showStereoBonds: false,
  }),
});

export function isStructuralViewKind(
  kind: ViewKind,
): kind is StructuralViewKind {
  return STRUCTURAL_VIEW_KINDS.includes(kind as StructuralViewKind);
}

export function isTextViewKind(kind: ViewKind): kind is TextViewKind {
  return !isStructuralViewKind(kind);
}

/** Narrows a representation to the structural arm, where `flags` exists. */
export function isStructural(r: Representation): r is StructuralRepresentation {
  return isStructuralViewKind(r.kind);
}

/**
 * Builds a representation for `kind`.
 *
 * The overloads are the enforcement point for the union above: passing flags
 * alongside a text kind is a compile error, not a value quietly dropped on the
 * floor. For a structural kind the given flags are layered over that kind's
 * defaults, so a caller can say "explicitH, but with indices" without
 * restating all six.
 */
export function representation(
  kind: StructuralViewKind,
  flags?: Partial<DisplayFlags>,
): StructuralRepresentation;
export function representation(kind: TextViewKind): TextRepresentation;
export function representation(
  kind: ViewKind,
  flags?: Partial<DisplayFlags>,
): Representation {
  if (!isStructuralViewKind(kind)) return Object.freeze({ kind });
  const base = DEFAULT_FLAGS_BY_KIND[kind];
  return Object.freeze({
    kind,
    flags: flags ? Object.freeze({ ...base, ...flags }) : base,
  });
}
