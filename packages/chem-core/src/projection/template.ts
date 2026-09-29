/**
 * What a template is to the engine, and the draft layout it writes into.
 *
 * A template does two things, and the split is the cache boundary:
 *
 *   resolve   TOPOLOGY ONLY — which atoms fold into which labels, which ids
 *             the derived nodes get, whether the molecule fits the template
 *             at all. The engine caches it on the topology fingerprint, so a
 *             drag that moves atoms re-uses it frame after frame.
 *   place     the configuration-dependent half, `placeConfiguration`:
 *             positions and marks chosen so the layout states the given
 *             configuration, found by placing, reading back through the
 *             template's own convention, and correcting. Never by a rule
 *             that restates the convention.
 *
 * A DRAFT, NOT A LAYOUT. `PlacedLayout` holds maps a template fills in any
 * order; the engine checks it, orders it and freezes it into the
 * `ProjectedLayout` value, so output order is the engine's one rule rather
 * than each template's habit.
 */

import { medianBondLength } from "../transform.js";
import type { PlacedMark, Placement, DepthConvention, StereoConfig } from "../stereo-config.js";
import type { AtomId, BondId, Molecule } from "../types.js";
import type { Vec2 } from "../vec.js";
import type {
  BondDepth,
  DerivedNode,
  LayoutBond,
  LayoutBondId,
  LayoutMark,
  LayoutNodeId,
  ProjectionCoverage,
  ProjectionNeedsChoice,
  ProjectionUnavailable,
  ProjectionView,
  ResolvedProjectionFrame,
  UnplacedUnit,
} from "./types.js";

/**
 * The shared bond length `b` of decision 145: the drawing's own median bond,
 * or 1 (the house standard bond) for a molecule with no bond to measure.
 */
export function projectionBondLength(mol: Molecule): number {
  return medianBondLength(mol) ?? 1;
}

/** A layout under construction. Insertion order carries no meaning. */
export interface PlacedLayout {
  readonly convention: DepthConvention;
  readonly bondLength: number;
  readonly positions: Map<LayoutNodeId, Vec2>;
  readonly bonds: Map<LayoutBondId, LayoutBond>;
  readonly marks: Map<LayoutBondId, LayoutMark>;
  readonly depth: Map<LayoutBondId, BondDepth>;
  readonly derivedNodes: Map<LayoutNodeId, DerivedNode>;
  readonly provenance: Map<LayoutNodeId, readonly AtomId[]>;
  readonly drawnAs: Map<AtomId, LayoutNodeId>;
  readonly unplaced: UnplacedUnit[];
}

export function emptyPlacedLayout(convention: DepthConvention, bondLength: number): PlacedLayout {
  return {
    convention,
    bondLength,
    positions: new Map(),
    bonds: new Map(),
    marks: new Map(),
    depth: new Map(),
    derivedNodes: new Map(),
    provenance: new Map(),
    drawnAs: new Map(),
    unplaced: [],
  };
}

/** A source atom drawn as itself. */
export function placeLayoutAtom(draft: PlacedLayout, atomId: AtomId, pos: Vec2): void {
  draft.positions.set(atomId, pos);
  draft.provenance.set(atomId, Object.freeze([atomId]));
  draft.drawnAs.set(atomId, atomId);
}

/** A derived node standing for `atoms`, each of which it draws unless drawn already. */
export function placeLayoutDerivedNode(
  draft: PlacedLayout,
  node: DerivedNode,
  pos: Vec2,
  atoms: readonly AtomId[],
): void {
  draft.positions.set(node.id, pos);
  draft.derivedNodes.set(node.id, node);
  draft.provenance.set(node.id, Object.freeze([...atoms]));
  // A synthetic hydrogen's provenance is its host, which draws itself.
  for (const atomId of atoms) if (!draft.drawnAs.has(atomId)) draft.drawnAs.set(atomId, node.id);
}

export function placeLayoutBond(draft: PlacedLayout, bond: LayoutBond, depth: BondDepth): void {
  draft.bonds.set(bond.id, bond);
  draft.depth.set(bond.id, depth);
}

/**
 * What a template's topology half returns: the skeleton `place` works from,
 * or why the molecule does not fit the template.
 */
export type ProjectionTemplateResolution<S> =
  | { readonly kind: "available"; readonly skeleton: S }
  | ProjectionNeedsChoice
  | ProjectionUnavailable;

/**
 * A template, as the engine calls it. `V` is the view kind it draws, `S` the
 * skeleton its topology half hands its placement half.
 *
 * `place` receives only the units it must place: the frame's coverage
 * restricted to units the configuration states. It records what it could not
 * state in `draft.unplaced`; the engine then reads the draft back and moves
 * anything else that disagrees there too (decision 146), so a template never
 * has to be trusted to report its own mistakes.
 */
export interface ProjectionTemplateImplementation<V extends ProjectionView, S> {
  resolve(
    mol: Molecule,
    view: V,
    frame: ResolvedProjectionFrame,
  ): ProjectionTemplateResolution<S>;
  place(
    mol: Molecule,
    config: StereoConfig,
    view: V,
    skeleton: S,
    toPlace: ProjectionCoverage,
  ): PlacedLayout;
}

/**
 * How a draft or a finished layout is read by `readConfig`: every source
 * atom at the position of the node that draws it, and every source bond with
 * the mark the layout drew on it — `none` where it drew none, so no mark of
 * the author's leaks into the reading of a panel that did not draw it.
 *
 * An atom the layout does not show (another species beside a Fischer's
 * backbone) is parked at one shared point: its bonds then have no length and
 * read as undetermined, where its drawn coordinates could have made a
 * Fischer reading refuse the whole placement over a centre nobody projected.
 */
export interface LayoutAccess {
  readonly convention: DepthConvention;
  position(node: LayoutNodeId): Vec2 | undefined;
  nodeOf(atomId: AtomId): LayoutNodeId | undefined;
  bondFor(sourceBondId: BondId): LayoutBond | undefined;
  mark(layoutBondId: LayoutBondId): LayoutMark | undefined;
  /** Where an undrawn atom is parked. */
  readonly parking: Vec2;
}

export function placementOfLayout(mol: Molecule, layout: LayoutAccess): Placement {
  const positions: Record<AtomId, Vec2> = {};
  for (const atomId of mol.atomIds) {
    const node = layout.nodeOf(atomId);
    const pos = node === undefined ? undefined : layout.position(node);
    positions[atomId] = pos ?? layout.parking;
  }
  const marks: Record<BondId, PlacedMark> = {};
  for (const bondId of mol.bondIds) {
    const bond = Object.hasOwn(mol.bonds, bondId) ? mol.bonds[bondId] : undefined;
    if (bond === undefined) continue;
    const drawn = layout.bondFor(bondId);
    const mark = drawn === undefined ? undefined : layout.mark(drawn.id);
    // The layout names its narrow end by NODE; map it back to the atom that
    // node draws at one end of this bond. A mark whose end is neither is not
    // a mark on this bond.
    let placed: PlacedMark = { stereo: "none", narrowEnd: bond.from };
    if (mark !== undefined) {
      if (mark.narrowEnd === layout.nodeOf(bond.from)) placed = { stereo: mark.stereo, narrowEnd: bond.from };
      else if (mark.narrowEnd === layout.nodeOf(bond.to)) placed = { stereo: mark.stereo, narrowEnd: bond.to };
    }
    marks[bondId] = placed;
  }
  return { mol, positions, marks };
}

/** `LayoutAccess` over a draft. */
export function draftLayoutAccess(draft: PlacedLayout): LayoutAccess {
  const bySource = new Map<BondId, LayoutBond>();
  for (const bond of draft.bonds.values()) {
    if (bond.sourceBondId !== undefined) bySource.set(bond.sourceBondId, bond);
  }
  const first = draft.positions.values().next();
  return {
    convention: draft.convention,
    position: (node) => draft.positions.get(node),
    nodeOf: (atomId) => draft.drawnAs.get(atomId),
    bondFor: (bondId) => bySource.get(bondId),
    mark: (bondId) => draft.marks.get(bondId),
    parking: first.done === true ? { x: 0, y: 0 } : first.value,
  };
}
