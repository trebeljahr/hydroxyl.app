/**
 * The projection engine's vocabulary: views, frames, characteristic lengths
 * and the layout VALUE a projection returns.
 *
 * WHAT A PROJECTION IS. A molecule, a configuration and a chosen viewpoint in,
 * derived coordinates and marks out — and a reader that gets the
 * configuration back from them. Twelve depictions (decision 13) collapse onto
 * FIVE frame kinds, and each depiction is a TEMPLATE over one of them:
 *
 *   planar             the drawn layout, rotated or mirrored, plus a mark
 *                      policy: wedge-dash, Mills, steroid alpha/beta
 *   chain              an ordered backbone drawn vertically: Fischer, Natta
 *   ring               a ring atom-id SET plus reference atom and face:
 *                      Haworth, chair
 *   sightedBond        an ordered front/back pair: Newman, sawhorse
 *   annotationOverlay  the drawing itself with marks laid over it: the torsion
 *                      labels that are this build's extended zig-zag
 *
 * So a thirteenth depiction is a template, not a renderer. Every template
 * lives under chem-core/src/projection, and chem-render only draws the
 * resulting layout.
 *
 * AN ORTHOGONAL AXIS TO THE VIEW KIND (decision 128). A panel keeps its
 * `representation.kind` — skeletal, kekule, explicitH, lewis — and gains an
 * optional `view` of type `ProjectionView`, so a Fischer can be drawn skeletal
 * or with explicit hydrogens. The shape here is the one the panel stores:
 * `kind` and `template` name the projection, `frame` is the chemistry it looks
 * at (a backbone, a ring atom-id SET, a sighted bond) and `params` are the view
 * knobs, conformation included (decision 12 puts a torsion or a pucker on the
 * panel, never on the molecule). Every field is plain JSON: ids, numbers,
 * strings, booleans. No Set, no function, no index into `rings(mol)`, so
 * `panel-view-parameters-and-conformation-records` can add it to the document
 * schema without a second migration.
 *
 * READ-ONLY IN v1 (decision 129). A projection panel takes view gestures and
 * provenance selection; configuration is edited on the main drawing only, so
 * nothing here inverts a placement back into the model.
 *
 * A LAYOUT, NEVER A MOLECULE. `ProjectedLayout` is positions in MODEL UNITS,
 * y-UP, marks, a per-bond depth enum, derived nodes, provenance and what could
 * not be placed. A view must not be able to mint a molecule (decision 12), and
 * a derived Molecule is indistinguishable from the document's own: something
 * would eventually save one. Nothing in the engine scales to px or negates a
 * y; `modelToPx` in chem-render stays the one function that does.
 */

import type { FormulaPart } from "../formula.js";
import type { AcceptedSkeleton, FaceLigand, SkeletonFace } from "../skeleton/table.js";
import type { DepthConvention } from "../stereo-config.js";
import type { AtomId, BondId, BondOrder, BondStereo } from "../types.js";
import type { Vec2 } from "../vec.js";

// ---------------------------------------------------------------------------
// Frames and templates
// ---------------------------------------------------------------------------

/** The five frame kinds. Stored in documents, so never renamed. */
export const FRAME_KINDS = Object.freeze([
  "planar",
  "chain",
  "ring",
  "sightedBond",
  "annotationOverlay",
] as const);

export type FrameKind = (typeof FRAME_KINDS)[number];

/**
 * Every template, by the frame kind it draws on.
 *
 * The WHOLE decision-13 list is here, built or not, so the document schema
 * can enumerate it once: a template landing later changes what `project`
 * returns for it, not the set of values a saved panel may hold. A template
 * with no implementation yet projects as `unavailable` with reason
 * `template-not-built`, never as an empty panel. Built today: planar
 * `wedgeDash` and chain `fischer` (decision 148), and planar `mills` and
 * `steroid` (decisions 164, 182).
 *
 * Boat, half-chair and twist-boat are FORMS of the chair template's
 * conformer, not templates; the extended zig-zag is the torsion overlay
 * (the synthesized zig-zag is deferred by the architectural ruling).
 */
export const PROJECTION_TEMPLATES = Object.freeze({
  planar: Object.freeze(["wedgeDash", "mills", "steroid"] as const),
  chain: Object.freeze(["fischer", "natta"] as const),
  ring: Object.freeze(["haworth", "chair"] as const),
  sightedBond: Object.freeze(["newman", "sawhorse"] as const),
  annotationOverlay: Object.freeze(["torsion"] as const),
});

export type PlanarProjectionTemplate = (typeof PROJECTION_TEMPLATES.planar)[number];
export type ChainProjectionTemplate = (typeof PROJECTION_TEMPLATES.chain)[number];
export type RingProjectionTemplate = (typeof PROJECTION_TEMPLATES.ring)[number];
export type SightedBondProjectionTemplate = (typeof PROJECTION_TEMPLATES.sightedBond)[number];
export type AnnotationOverlayProjectionTemplate = (typeof PROJECTION_TEMPLATES.annotationOverlay)[number];

/** The drawing itself. There is nothing to choose: every atom is in view. */
export type PlanarFrame = Readonly<Record<never, never>>;

/**
 * An ordered backbone, first atom first. Which end is drawn at the top is a
 * view parameter (`ChainParams.top`), so swapping the ends of a Fischer
 * rewrites no chemistry selection.
 */
export interface ChainFrame {
  readonly backbone: readonly AtomId[];
}

/**
 * A ring named by its atom-id SET — never by an index into `rings(mol)`, which
 * renumbers on any topology edit and whose COUNT changes with RDKit's
 * symmetrisation.
 *
 * The set may be the whole ring, a part of it, or empty. The whole ring
 * resolves exactly; a part or an empty set resolves when one ring of the
 * molecule contains it and asks the caller to choose (`needsChoice`) when
 * several do. Order is not significant: the engine canonicalises it.
 *
 * `referenceAtomId` is the ring atom a template puts at its reference vertex
 * (a Haworth's right-hand vertex, where the anomeric carbon goes). Omitted,
 * the template picks by a rule fixed by the atom ids alone.
 */
export interface RingFrame {
  readonly ringAtomIds: readonly AtomId[];
  readonly referenceAtomId?: AtomId;
}

/**
 * A bond seen end on: `front` nearer the viewer, `back` behind it. The
 * reference substituents are STORED by id, not derived from CIP priority: a
 * bromine added elsewhere reorders priorities, and a picture keyed on them
 * would spin. An omitted or deleted reference, or one no longer bonded to its
 * end, falls back to the lowest `compareIds` substituent, and the resolved
 * frame's `referenceFallbacks` says so; it never makes the frame unavailable.
 */
export interface SightedBondFrame {
  readonly front: AtomId;
  readonly back: AtomId;
  readonly frontReference?: AtomId;
  readonly backReference?: AtomId;
}

/** The drawing, with the bonds an overlay annotates (torsion labels). */
export interface AnnotationOverlayFrame {
  readonly bondIds: readonly BondId[];
}

/**
 * A page rotation and a mirror of the drawn layout.
 *
 * `rotationDeg` is counter-clockwise on the page (y up) and canonicalised to
 * [0, 360), so 370 and 10 are one view. The mirror is applied first, across
 * the vertical axis through the drawing's centre, and EXCHANGES wedge and
 * hash: a mirrored panel is the same enantiomer re-posed, exactly as
 * `flipAtoms` is, never the other enantiomer (decision 12 keeps configuration
 * on the molecule).
 */
export interface PlanarParams {
  readonly rotationDeg: number;
  readonly mirror: boolean;
  /**
   * A skeleton the user ACCEPTED for this panel (decision 163): suggested by
   * `suggestSteroidSkeleton`, confirmed, and stored here with the view. While
   * it is set and still fits the molecule, a planar panel of any template
   * carries the skeleton's numbering and alpha/beta labels; the `steroid`
   * template needs it to know where the core is. One that no longer fits
   * makes the panel `unavailable: skeleton-mismatch` rather than guess.
   * Omitted when nothing was accepted.
   */
  readonly skeleton?: AcceptedSkeleton;
}

/** Which end of the backbone is drawn at the top of the page. */
export interface ChainParams {
  readonly top: "first" | "last";
}

/**
 * Which puckered form a ring template draws: decision 12's "which chair
 * conformer", a VIEW parameter and never model state (decision 154).
 *
 * PINNED BY ATOM ID, never by an index or by "up" and "down". `frontAtomId`
 * is a ring atom displaced toward the ring's FRONT face (`ringFace`'s
 * meaning, as `RingParams.face` uses it). A chair's atoms alternate, so one
 * named atom fixes the chair, and a ring flip is the same panel naming one
 * of that atom's ring neighbours instead. Two ids naming the same chair are
 * the same picture; the chair template resolves them, since that needs the
 * ring and a view alone does not have it.
 *
 * `form` is the discriminant later forms extend. A boat, a half-chair and a
 * twist-boat each need more than one pinned atom, so they arrive with the
 * chair template as new arms; a value a panel already saved stays valid.
 */
export interface ChairConformer {
  readonly form: "chair";
  readonly frontAtomId: AtomId;
}

export type RingConformer = ChairConformer;

/**
 * `face` is which named face of the ring the template shows toward the TOP of
 * its picture. Front and back are the ring's two faces against the reference
 * normal of its canonical walk, exactly `ringFace`'s meaning — never "up" and
 * "down", which denote different geometries in a Haworth and a steroid.
 * Choosing the other face mirrors the page and changes no descriptor.
 *
 * `conformer` is the puckered form for a template that draws one (the
 * chair). Omitted, the template picks one by a rule fixed by the atom ids
 * alone; a Haworth, which is flat by convention, ignores it.
 */
export interface RingParams {
  readonly face: "front" | "back";
  readonly conformer?: RingConformer;
}

/**
 * The torsion about the sighted bond (chemistry: a conformation) and a roll
 * of the whole picture (cosmetic: turning the figure to fit a column). They
 * are two numbers because "straighten the figure" must never rewrite a
 * reported dihedral. Both in degrees, canonicalised to [0, 360).
 */
export interface SightedBondParams {
  readonly torsionDeg: number;
  readonly rollDeg: number;
}

/** Nothing yet: the torsion overlay's own knobs arrive with it. */
export type AnnotationOverlayParams = Readonly<Record<never, never>>;

export interface PlanarView {
  readonly kind: "planar";
  readonly template: PlanarProjectionTemplate;
  readonly frame: PlanarFrame;
  readonly params: PlanarParams;
}

export interface ChainView {
  readonly kind: "chain";
  readonly template: ChainProjectionTemplate;
  readonly frame: ChainFrame;
  readonly params: ChainParams;
}

export interface RingView {
  readonly kind: "ring";
  readonly template: RingProjectionTemplate;
  readonly frame: RingFrame;
  readonly params: RingParams;
}

export interface SightedBondView {
  readonly kind: "sightedBond";
  readonly template: SightedBondProjectionTemplate;
  readonly frame: SightedBondFrame;
  readonly params: SightedBondParams;
}

export interface AnnotationOverlayView {
  readonly kind: "annotationOverlay";
  readonly template: AnnotationOverlayProjectionTemplate;
  readonly frame: AnnotationOverlayFrame;
  readonly params: AnnotationOverlayParams;
}

/**
 * What a panel stores to be a projection (decision 128): the projection
 * (`kind` plus `template`), its frame and its parameters, discriminated on the
 * frame kind so a Haworth panel cannot hold Fischer parameters.
 */
export type ProjectionView =
  | PlanarView
  | ChainView
  | RingView
  | SightedBondView
  | AnnotationOverlayView;

/**
 * The part of a view `applyConformation` acts on. `none` for every frame
 * whose conformation is fixed by convention: a planar drawing, and a Fischer,
 * which is eclipsed by definition. `torsion` is a sighted bond's dihedral,
 * and `ringConformer` a ring's pucker (`RingParams.conformer`).
 */
export type Conformation =
  | { readonly kind: "none" }
  | { readonly kind: "torsion"; readonly torsionDeg: number }
  | { readonly kind: "ringConformer"; readonly conformer: RingConformer };

// ---------------------------------------------------------------------------
// Characteristic lengths — decision 5, ruled here before any template
// ---------------------------------------------------------------------------

/**
 * EVERY LENGTH A TEMPLATE DRAWS IS A MULTIPLE OF ONE SHARED BOND LENGTH `b`
 * (decision 145, ruling decision 5 for projections).
 *
 * Decision 5 puts every panel of a figure on one bond-length scale. A Fischer
 * arm and rung, a Haworth hexagon edge, a Newman circle and a chair's bond are
 * not bond lengths, so without one table four templates would each pick a
 * number and the same molecule would appear at visibly different sizes in one
 * figure. So each frame declares its lengths HERE, in units of `b`, and a
 * template multiplies; no template holds a length constant of its own.
 *
 * `b` IS THE DRAWING'S OWN MEDIAN BOND (`projectionBondLength`): the number
 * figure composition already records as the drawn bond length. A projected
 * panel of a molecule drawn at 1.5 units per bond therefore prints its rungs
 * at the same 1.5 as the skeletal panel beside it, and the print scale that
 * turns one of them into 0.508 cm turns the other into the same.
 *
 * The values, in `b`:
 *
 *   chain.rung          1     backbone spacing: a Fischer rung is one bond
 *   chain.arm           1     a horizontal arm: the cross is square, as
 *                             textbooks draw it, so no arm reads as a longer
 *                             bond than the backbone beside it
 *   ring.edge           1     a Haworth ring edge in the ring's own plane,
 *                             before the viewing tilt foreshortens the sides
 *   ring.substituent    0.75  a Haworth's vertical substituent stub: shorter
 *                             than an edge, as drawn, so the stubs of adjacent
 *                             atoms do not reach each other's labels
 *   ring.chairBond      1     the chair's 3D bond; its projected edges come
 *                             out shorter, by the viewing geometry alone
 *   sightedBond.radius  0.5   the Newman back circle
 *   sightedBond.spoke   1     a Newman spoke, and a sawhorse's sighted bond
 *   planar.revealedHydrogen
 *                       1     the line to a hydrogen the mark writer reveals
 *                             to carry a centre's wedge (decision 178): a
 *                             wedge shorter than a bond is a blob once its
 *                             "H" label trims it
 *
 * Otherwise the planar and overlay frames draw the author's bonds, which ARE
 * `b` by definition, and Mills re-lays its rings with edges of `b`.
 */
export const CHARACTERISTIC_LENGTHS = Object.freeze({
  planar: Object.freeze({ revealedHydrogen: 1 }),
  chain: Object.freeze({ rung: 1, arm: 1 }),
  ring: Object.freeze({ edge: 1, substituent: 0.75, chairBond: 1 }),
  sightedBond: Object.freeze({ radius: 0.5, spoke: 1 }),
});

/**
 * Two layout nodes nearer than this many `b` are REPORTED as a collision
 * (never nudged). A quarter bond is well inside any two labels' glyphs and
 * well outside any two properly placed neighbours, so it flags a real overlap
 * (a crowded arm, 1,3-diaxial substituents, two atoms dropped on each other)
 * without flagging an ordinary drawing.
 */
export const LAYOUT_COLLISION_DISTANCE = 0.25;

// ---------------------------------------------------------------------------
// The layout value
// ---------------------------------------------------------------------------

/** A node of a layout: a source atom's id, or a derived node's id. */
export type LayoutNodeId = string;

/**
 * A bond of a layout: a source bond's id, or `<derived node id>.bond` for the
 * line joining a derived hydrogen to its host.
 */
export type LayoutBondId = string;

/**
 * Where a bond lies relative to the page, for drawing order: `front` toward
 * the viewer, `back` away, `inPlane` on it. A Fischer's horizontal bonds are
 * `front` and its vertical ones `back`; a Haworth's near edge is `front`; in
 * a planar layout a wedge is `front`, a hash `back` and every other bond
 * `inPlane`, as the marks the layout finally draws say.
 *
 * DEPTH IS CARRIED, NEVER RE-DERIVED from the 2D y: a projected chair's near
 * and far bonds overlap in y, so front/back cannot be recovered from the
 * picture once it is flattened.
 */
export const BOND_DEPTHS = Object.freeze(["front", "back", "inPlane"] as const);
export type BondDepth = (typeof BOND_DEPTHS)[number];

export interface LayoutBond {
  readonly id: LayoutBondId;
  readonly from: LayoutNodeId;
  readonly to: LayoutNodeId;
  readonly order: BondOrder;
  /** The molecule's bond this line draws; absent for a derived line. */
  readonly sourceBondId?: BondId;
}

/**
 * A stereo mark as the layout draws it, with its narrow end NAMED: a panel
 * moves marks without editing bonds, so the end is not implied by
 * `bond.from`.
 */
export interface LayoutMark {
  readonly stereo: Exclude<BondStereo, "none">;
  readonly narrowEnd: LayoutNodeId;
}

/**
 * A node the layout draws that is not one atom of the molecule.
 *
 *   hydrogen   a synthetic hydrogen on `host`: a Fischer arm's H, a Haworth's
 *              axial H. Hydrogens are implicit in the model, so the node is
 *              the only place this one exists.
 *   condensed  a group of atoms drawn as one label ("CH2OH", "CHO") hanging
 *              off the rest of the drawing at `host`, the group's attachment
 *              atom.
 *
 * `label` is the text as it reads on the page, in drawing order — "HO" on a
 * left-hand arm, "OH" on a right-hand one.
 *
 * Ids come from `derivedNodeId` (decision 147): `a3.H`, `a7.CH2OH`. Never
 * from the document's `nextId`, which would turn a view into a model edit.
 */
export type DerivedNodeKind = "hydrogen" | "condensed";

/**
 * One piece of a derived node's text: `FormulaPart`'s symbol, count and
 * charge, plus `mass`, a mass number set superscript immediately BEFORE the
 * symbol it labels ("¹³CH2OH", "C²H3"). Decision 155.
 *
 * A condensed label is the only place a folded atom is drawn, so it must
 * name the nuclide. Spelled without it, a CD3 reads "CH3" and a 13C-labelled
 * terminus reads as natural carbon: a plausible wrong answer, which this
 * package refuses everywhere else (`exactMass` throws rather than guess).
 * `mass` is a kind of its own, not a FormulaPart, because a sum formula
 * counts elements and has no place to put one.
 */
export type DerivedLabelPart = FormulaPart | { readonly kind: "mass"; readonly text: string };

export interface DerivedNode {
  readonly id: LayoutNodeId;
  readonly kind: DerivedNodeKind;
  readonly host: AtomId;
  readonly label: readonly DerivedLabelPart[];
  /**
   * Which part of `label` sits ON the node's position: the attachment atom's
   * own symbol, the C of "CH2OH" and of "HOH2C" alike, so the bond meets the
   * atom it is bonded to and not the middle of the word. A `mass` part just
   * before it belongs to the same atom and is set with it.
   */
  readonly anchor: number;
}

/**
 * The stereo units a projection STATES. Everything outside is unreported,
 * never "unspecified": a Newman covers one bond and a Fischer one backbone,
 * and a centre elsewhere in the molecule is simply not in the picture.
 *
 * TWO OF THEM (decision 146). The FRAME's coverage (`projectionCoverage`) is
 * what the frame reaches; a LAYOUT's is what that layout verifiably states,
 * the frame's minus everything in `unplaced`. The round-trip law —
 * `readProjection` of a layout equals the configuration, restricted to the
 * layout's coverage — is stated on the second, because only the projection
 * knows which units it managed to draw.
 */
export interface ProjectionCoverage {
  /** Stereocentre atom ids, ascending by `compareIds`. */
  readonly centres: readonly AtomId[];
  /** Stereogenic double bond ids, ascending by `compareIds`. */
  readonly doubleBonds: readonly BondId[];
}

/**
 * Why a unit the frame reaches is not stated by the layout.
 *
 *   no-mark-to-carry        planar: the configuration states the centre and
 *                           no bond the placement policy allows can show it
 *                           (marks.ts, decision 178): every candidate is
 *                           barred or reads ambiguous where it is drawn
 *   unspecified-in-config   the configuration does not state this unit, and
 *                           the template cannot draw "not stated": every
 *                           Fischer cross claims a configuration
 *   drawn-geometry-disagrees planar: a double bond drawn with the other
 *                           geometry, which no mark can change
 *   not-reproduced          the layout was read back and did not say what the
 *                           configuration says. Never expected; reported
 *                           rather than asserted so a template bug is
 *                           visible instead of fatal.
 */
export type UnplacedReason =
  | "no-mark-to-carry"
  | "unspecified-in-config"
  | "drawn-geometry-disagrees"
  | "not-reproduced";

export type StereoUnitRef =
  | { readonly kind: "centre"; readonly atomId: AtomId }
  | { readonly kind: "doubleBond"; readonly bondId: BondId };

export interface UnplacedUnit {
  readonly unit: StereoUnitRef;
  readonly reason: UnplacedReason;
}

/**
 * One alpha/beta statement a layout makes (decision 182): the ligand off the
 * skeleton's core at `atomId`, and which face of the reference plane it is
 * on. Only for centres in the layout's coverage.
 *
 * `group` is what the label names after its hyphen when the ligand is
 * exactly a hydrogen, a hydroxyl, a thiol or a halogen ("H", "OH", "SH",
 * "Cl"); absent for anything else, which the label then leaves at locant and
 * letter ("10β"), since an annotation run has no subscript to spell "CH3".
 */
export interface FaceLabel {
  readonly atomId: AtomId;
  readonly locant: string;
  readonly ligand: FaceLigand;
  readonly face: SkeletonFace;
  readonly group?: string;
}

/** Two nodes closer than `LAYOUT_COLLISION_DISTANCE` bond lengths. */
export interface LayoutCollision {
  readonly a: LayoutNodeId;
  readonly b: LayoutNodeId;
  /** In model units. */
  readonly distance: number;
}

/**
 * What `project` returns: a VALUE, never a Molecule.
 *
 * Positions are MODEL UNITS, y-UP, like `atom.pos`. Every object's keys are
 * written in a fixed order — source atoms in `mol.atomIds` order, then
 * derived nodes in their hosts' order — so two runs serialise byte for byte.
 */
export interface ProjectedLayout {
  readonly kind: FrameKind;
  readonly template: string;
  /**
   * How this layout encodes depth, which is how it is read back: wedge/hash
   * for a planar drawing, the Fischer axes for a chain, the Haworth verticals
   * for a ring. Carried so `readProjection` needs no template knowledge.
   */
  readonly convention: DepthConvention;
  /** The shared bond length `b` every characteristic length multiplies. */
  readonly bondLength: number;
  /** Every node drawn: source atoms by their own id, derived nodes by theirs. */
  readonly positions: Readonly<Record<LayoutNodeId, Vec2>>;
  readonly bonds: readonly LayoutBond[];
  /** Keyed by layout bond id; a bond with no mark has no entry. */
  readonly marks: Readonly<Record<LayoutBondId, LayoutMark>>;
  /** Keyed by layout bond id; total over `bonds`. */
  readonly depth: Readonly<Record<LayoutBondId, BondDepth>>;
  readonly derivedNodes: readonly DerivedNode[];
  /**
   * TOTAL over `positions`: every node names the source atoms it stands for,
   * so a click on a condensed CH2OH selects its carbon AND its oxygen, and a
   * synthetic H selects the centre it belongs to. Many-to-one: a centre and
   * its synthetic hydrogen both lead back to the centre.
   */
  readonly provenance: Readonly<Record<LayoutNodeId, readonly AtomId[]>>;
  /**
   * Which node draws each source atom the layout shows: the atom's own node,
   * or the condensed node it is folded into. An atom the layout does not show
   * (another species beside a Fischer's backbone) has no entry.
   */
  readonly drawnAs: Readonly<Record<AtomId, LayoutNodeId>>;
  /** The units this layout states; `readProjection` reports exactly these. */
  readonly coverage: ProjectionCoverage;
  /** Units the frame reaches that the layout could not state, with why. */
  readonly unplaced: readonly UnplacedUnit[];
  /**
   * The numbering this panel applies, by source atom: an accepted
   * skeleton's (decision 181), empty otherwise. Keys in `mol.atomIds` order;
   * read with `Object.hasOwn`.
   */
  readonly locants: Readonly<Record<AtomId, string>>;
  /** Alpha/beta statements, for covered centres only (decision 182); empty without a skeleton. */
  readonly faceLabels: readonly FaceLabel[];
  /** Reported, never nudged. */
  readonly collisions: readonly LayoutCollision[];
}

// ---------------------------------------------------------------------------
// Availability: available | needsChoice | unavailable
// ---------------------------------------------------------------------------

/**
 * Why a projection cannot be produced for this molecule, as data. The
 * sentence a panel prints is chem-render's (`projectedViewAvailability`).
 */
export type ProjectionUnavailableReason =
  /** Nothing has been drawn. */
  | "empty-molecule"
  /** An atom whose element is not in the table: no valence, so no stereo topology. */
  | "unknown-element"
  /** The frame names an atom the molecule no longer has. */
  | "missing-atom"
  /** The frame names a bond the molecule no longer has. */
  | "missing-bond"
  /** A backbone lists one atom twice. */
  | "repeated-atom"
  /** Consecutive backbone atoms are not bonded. */
  | "not-a-path"
  /** A backbone of fewer than three atoms has no centre to draw a cross at. */
  | "backbone-too-short"
  /** A backbone atom bonds a non-adjacent backbone atom, or a substituent loops back to it. */
  | "backbone-in-ring"
  /** A backbone atom has more than the two arms a cross offers. */
  | "too-many-substituents"
  /** A substituent that cannot be condensed to a label (it contains a ring). */
  | "substituent-too-large"
  /** A ring frame on a molecule with no ring. */
  | "no-ring"
  /** The named atoms are not one ring, and no ring of the molecule contains them. */
  | "not-a-ring"
  /** The ring's size is not one the template draws. */
  | "ring-size"
  /** A sighted bond's two atoms are not bonded. */
  | "not-bonded"
  /** A parameter is not a finite number. */
  | "invalid-parameter"
  /** The configuration names a unit this molecule does not have, or other ligands. */
  | "config-mismatch"
  /** A derived node's id would equal an atom id of the molecule. */
  | "id-conflict"
  /**
   * Mills: two rings of one system share two or more bonds (norbornane, a
   * kaurane's C/D rings), so no layout of regular polygons exists.
   */
  | "bridged-ring-system"
  /** The steroid template, with no skeleton accepted for the panel (decision 163). */
  | "skeleton-not-accepted"
  /**
   * The accepted skeleton no longer fits: an atom gone, or a core bond
   * broken or added. The atoms are the ones to look at; accept again.
   */
  | "skeleton-mismatch"
  /** The template is listed but owed by a later task. */
  | "template-not-built";

export interface ProjectionUnavailable {
  readonly kind: "unavailable";
  readonly reason: ProjectionUnavailableReason;
  /** The atoms responsible, where the reason has any. */
  readonly atomIds: readonly AtomId[];
  /** The bonds responsible, where the reason has any. */
  readonly bondIds: readonly BondId[];
}

/**
 * More than one thing fits the frame and the engine will not pick one: three
 * rings and a ring frame that names none of them. Each candidate is a
 * complete ring atom-id set in canonical walk order, ready to be stored as
 * `RingFrame.ringAtomIds`. Listed in a fixed order (by first atom in
 * `mol.atomIds`), so the picker does not reshuffle between renders.
 */
export interface ProjectionNeedsChoice {
  readonly kind: "needsChoice";
  readonly choice: "ring";
  readonly candidates: readonly (readonly AtomId[])[];
}

/**
 * A frame after resolution against one molecule: every name checked, and a
 * ring's atom-id set turned into its canonical walk (the start and direction
 * `rings()` uses), with the reference atom settled.
 */
export type ResolvedProjectionFrame =
  | { readonly kind: "planar" }
  | { readonly kind: "chain"; readonly backbone: readonly AtomId[] }
  | {
      readonly kind: "ring";
      readonly ringAtomIds: readonly AtomId[];
      readonly referenceAtomId: AtomId;
    }
  | {
      readonly kind: "sightedBond";
      readonly front: AtomId;
      readonly back: AtomId;
      readonly bondId: BondId;
      /**
       * The substituent of `front` (other than `back`) at the template's
       * reference position: the stored one when it still is a substituent of
       * `front`, else the lowest by `compareIds`. Absent when `front` carries
       * only implicit hydrogens, which the template then draws.
       */
      readonly frontReference?: AtomId;
      /** The same for `back`. */
      readonly backReference?: AtomId;
      /** Each end whose stored reference was not used, and why: the resolution saying so. */
      readonly referenceFallbacks: readonly SightedBondReferenceFallback[];
    }
  | { readonly kind: "annotationOverlay"; readonly bondIds: readonly BondId[] };

/**
 * Why a sighted bond's stored reference was not used and the lowest-id
 * substituent stands in: none was stored, the stored atom is gone, or it is
 * no longer bonded to its end (an edit moved it).
 */
export interface SightedBondReferenceFallback {
  readonly end: "front" | "back";
  readonly reason: "omitted" | "missing-atom" | "not-a-substituent";
}

/** The frame resolves: what it names, and what a layout could state. */
export interface ProjectionResolved {
  readonly kind: "available";
  readonly frame: ResolvedProjectionFrame;
  /** The units the FRAME reaches; a layout states these or lists them unplaced. */
  readonly coverage: ProjectionCoverage;
}

export type ProjectionAvailability =
  | ProjectionResolved
  | ProjectionNeedsChoice
  | ProjectionUnavailable;

export type ProjectionResult =
  | { readonly kind: "available"; readonly layout: ProjectedLayout }
  | ProjectionNeedsChoice
  | ProjectionUnavailable;
