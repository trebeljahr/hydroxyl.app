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
  /**
   * Draw each atom's CHEMICAL locant — "1", "4a", "C3′" — beside it.
   *
   * Real numbering only (decision 18). The numbers come from the caller
   * (`SceneBuildOptions.locants`, `FigureOptions.locants`; the editor passes
   * chem-core's `atomNumbering` of the document, decision 168), and
   * an atom with no locant draws nothing. It NEVER falls back to the atom's
   * position in `atomIds` or to its id: ids come from a monotonic counter and
   * are never reused, so an unrelated deletion would renumber everything
   * between the draft the author checked and the export they submitted — and
   * the result would reach a manuscript looking exactly like IUPAC numbering.
   *
   * Replaces `showAtomIndices`, which was persisted but never drawn. A
   * developer id overlay, if one is wanted, is client UI state, never a
   * member of this interface.
   */
  readonly showLocants: boolean;
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
  /**
   * Set an `(R)`, `(S)`, `(E)` or `(Z)` beside every stereogenic unit whose
   * configuration chem-core can prove.
   *
   * PER STRUCTURE, like `aromaticCircles` and for the same reason: one panel
   * of a figure often carries the descriptors while its neighbour, drawn
   * larger for a mechanism, does not. A style preset owns physical vocabulary
   * — bond length, line width, font — and cannot express "this panel is
   * annotated"; @starter/shared already stores the choice per panel as
   * `RepresentationDisplay.showStereoDescriptors`, and a preset may only seed
   * it the way `AROMATIC_CIRCLES_BY_PRESET` seeds the circle.
   *
   * A DIFFERENT THING FROM `showStereoBonds`. Wedges are geometry the author
   * drew; a descriptor is a computed claim about what that geometry means, and
   * chem-core returns `undetermined` rather than a letter wherever it cannot
   * prove one. A centre with no letter simply gets no annotation — a wrong one
   * is worse than none.
   */
  readonly showStereoDescriptors: boolean;
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

/**
 * Every view kind and every display-flag key, listed once and checked against
 * the type in BOTH directions.
 *
 * These lists are the contract decision 10 rests on: chem-render owns the
 * display-flag set and `@starter/shared` imports it, so the document codec's
 * zod schema is GENERATED from `DISPLAY_FLAG_KEYS` and `VIEW_KINDS` rather
 * than restating them. A hardcoded `z.enum` over there had already gone stale
 * once for `BondStereo` — the `either` member encoded fine and then failed to
 * decode, which made one imported bond enough to render a saved sketch
 * unopenable.
 *
 * `as const satisfies` catches a member REMOVED from the union; the
 * `…IsTotal` guards catch one ADDED to it. Between them, a new flag or a new
 * view is a compile error here rather than a toggle the user can set and
 * never save.
 */
export const STRUCTURAL_VIEW_KINDS = [
  "skeletal",
  "kekule",
  "explicitH",
  "lewis",
] as const satisfies readonly StructuralViewKind[];

type StructuralKindsAreTotal =
  StructuralViewKind extends (typeof STRUCTURAL_VIEW_KINDS)[number] ? true : never;
const STRUCTURAL_KINDS_ARE_TOTAL: StructuralKindsAreTotal = true;
void STRUCTURAL_KINDS_ARE_TOTAL;

export const TEXT_VIEW_KINDS = [
  "condensed",
  "sumFormula",
] as const satisfies readonly TextViewKind[];

type TextKindsAreTotal =
  TextViewKind extends (typeof TEXT_VIEW_KINDS)[number] ? true : never;
const TEXT_KINDS_ARE_TOTAL: TextKindsAreTotal = true;
void TEXT_KINDS_ARE_TOTAL;

/** Structural kinds first: that is the order a view picker should offer them. */
export const VIEW_KINDS = [
  ...STRUCTURAL_VIEW_KINDS,
  ...TEXT_VIEW_KINDS,
] as const satisfies readonly ViewKind[];

export type DisplayFlagKey = keyof DisplayFlags;

/**
 * Every key of `DisplayFlags`, in the order a settings surface should offer
 * them: what is drawn first, then the two per-figure annotations.
 *
 * The list, not the interface, is what `@starter/shared` iterates to build
 * and to reassemble a panel's stored flags — key by key, never by spreading a
 * parsed object, because a key present with the value `undefined` is a
 * different object to `toEqual` and to `JSON.stringify` than an absent one.
 */
export const DISPLAY_FLAG_KEYS = [
  "showCarbonLabels",
  "showImplicitHydrogens",
  "showLonePairs",
  "showCharges",
  "showStereoBonds",
  "showLocants",
  "aromaticCircles",
  "showStereoDescriptors",
] as const satisfies readonly DisplayFlagKey[];

type FlagKeysAreTotal =
  DisplayFlagKey extends (typeof DISPLAY_FLAG_KEYS)[number] ? true : never;
const FLAG_KEYS_ARE_TOTAL: FlagKeysAreTotal = true;
void FLAG_KEYS_ARE_TOTAL;

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
  // Off: numbering is what a figure ABOUT a numbering scheme turns on, and
  // with no locants supplied it would draw nothing anyway.
  showLocants: false,
  // Off by default even on skeletal: chem-core stores benzene as an explicit
  // Kekule ring, so a circle drawn ON TOP of the alternation would state the
  // delocalisation twice. Switching the flag on is what makes the renderer
  // suppress the alternation and draw the circle instead.
  aromaticCircles: false,
  // Off by default everywhere: descriptors are what a chemist turns on for a
  // figure that is ABOUT the stereochemistry, and on a busy structure they are
  // four more glyphs competing with the labels.
  showStereoDescriptors: false,
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
  // THE ONE PRESET THAT DEFAULTS TO THE CIRCLE, and it is a forced
  // consequence of decision 11 rather than a taste call of its own. Kekulé
  // means "alternating bonds, bare carbons"; with its carbon labels gone it
  // is drawn from exactly the same primitives skeletal was, so leaving both
  // on the alternation makes the two views byte-identical and the Kekulé
  // entry in the menu a lie. Skeletal takes the circle, Kekulé keeps the
  // alternation, and picking a view now changes the picture.
  //
  // Reversible in one line, and per structure regardless: `aromaticCircles`
  // is stored per panel, so a figure that wants the alternation under a
  // skeletal heading still says so.
  skeletal: Object.freeze({ ...DEFAULT_DISPLAY_FLAGS, aromaticCircles: true }),
  // Kekulé draws the localised alternating double bonds — and BARE CARBONS
  // (decision 11). A ring carbon spelled out as "C" is what `explicitH` is
  // for; Kekulé's whole content is the alternation, which is why it must not
  // also take the circle above.
  kekule: DEFAULT_DISPLAY_FLAGS,
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
    // A Lewis diagram makes no 3D claim, so there is no configuration for a
    // descriptor to describe. Off with the wedges it would be labelling.
    showStereoDescriptors: false,
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
 * defaults, so a caller can say "explicitH, but with locants" without
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

/**
 * The flags a view kind opens with — including a TEXT kind, which has none of
 * its own.
 *
 * A text view genuinely ignores every flag (`Representation` makes setting one
 * on a sum formula unrepresentable), but the DOCUMENT still stores a full set
 * per panel so that flipping a panel from skeletal to sumFormula and back does
 * not lose the settings the chemist had chosen. That codec needs an answer for
 * all six kinds, and this is it: the neutral baseline, so a round trip through
 * a text kind leaves the flags where they were rather than inventing values.
 */
export function defaultFlagsFor(kind: ViewKind): DisplayFlags {
  return isStructuralViewKind(kind)
    ? DEFAULT_FLAGS_BY_KIND[kind]
    : DEFAULT_DISPLAY_FLAGS;
}

/**
 * What each view is called where a person reads it: the panel list, the
 * representation switcher, and the marked placeholder a figure draws for a
 * panel whose view cannot be produced. One table, so the placeholder in an
 * exported file and the menu item that created the panel use the same words.
 */
export const VIEW_KIND_TITLES: Readonly<Record<ViewKind, string>> = Object.freeze({
  skeletal: "Skeletal",
  kekule: "Kekulé",
  explicitH: "Explicit H",
  lewis: "Lewis",
  condensed: "Condensed formula",
  sumFormula: "Sum formula",
});
