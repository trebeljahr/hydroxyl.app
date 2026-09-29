/**
 * Drawing a projection: chem-core's `ProjectedLayout` through the passes that
 * draw a molecule.
 *
 * chem-core decides everything a projection means — where each atom goes,
 * which marks are drawn, which atoms fold into a "CH2OH", which hydrogens are
 * synthesised — and hands over a layout VALUE in model units, y up. This
 * module only turns that value into inputs the existing label, bond and
 * annotation passes already understand, so a Fischer's bonds are trimmed by
 * the same ray-exit rule, and its labels placed by the same measured ink, as
 * any skeletal drawing's. `modelToPx` stays the one function that scales and
 * flips: nothing here multiplies by a bond length or negates a y.
 *
 * THE GEOMETRY COPY. The passes read `atom.pos` and a bond's mark, so the
 * layout's positions and marks are written onto a private copy of the
 * molecule — same ids, same topology, so every hydrogen count and label is
 * the source molecule's — which is built and dropped inside one scene build.
 * It is never returned and never reaches a caller: a projection must not be
 * able to mint a molecule (decision 12), and this one exists only as long as
 * the function that draws it.
 *
 * WHAT IS NOT DRAWN AS ITSELF. An atom folded into a condensed group is not
 * drawn (its letters are in the group's label), nor is an atom the layout
 * does not show at all (another species beside a Fischer's backbone). The
 * atom a condensed group is attached by keeps its place and its bonds but
 * draws the group's label instead of its own, with its symbol on the node.
 * A synthetic hydrogen is drawn like the explicit-H view's derived ones: a
 * stem and an "H".
 */

import type {
  Atom,
  AtomId,
  Bond,
  BondId,
  DerivedNode,
  FormulaPart,
  Molecule,
  ProjectedLayout,
} from "@starter/chem-core";

import type { ComposedLabel, LabelSide } from "../label/compose.js";
import type { SceneSource, TextSpan } from "./types.js";

export interface LayoutDrawing {
  /** The molecule at the layout's positions, carrying the layout's marks. */
  readonly geometry: Molecule;
  /** Source atoms not drawn as themselves: folded into a group, or not shown. */
  readonly hidden: ReadonlySet<AtomId>;
  /** Each condensed group, by the atom it is attached by. */
  readonly condensedAt: ReadonlyMap<AtomId, DerivedNode>;
  /** The synthetic hydrogens, in layout order. */
  readonly hydrogens: readonly DerivedNode[];
  /** Hosts whose hydrogens the layout places itself. */
  readonly hydrogenHosts: ReadonlySet<AtomId>;
  readonly layout: ProjectedLayout;
}

export function layoutDrawing(mol: Molecule, layout: ProjectedLayout): LayoutDrawing {
  const condensedAt = new Map<AtomId, DerivedNode>();
  const hydrogens: DerivedNode[] = [];
  for (const node of layout.derivedNodes) {
    if (node.kind === "condensed") condensedAt.set(node.host, node);
    else hydrogens.push(node);
  }
  const nodeOf = (atomId: AtomId): string | undefined =>
    Object.hasOwn(layout.drawnAs, atomId) ? layout.drawnAs[atomId] : undefined;

  const hidden = new Set<AtomId>();
  const atoms: Record<AtomId, Atom> = {};
  for (const atomId of mol.atomIds) {
    const atom = Object.hasOwn(mol.atoms, atomId) ? mol.atoms[atomId] : undefined;
    if (atom === undefined) continue;
    const node = nodeOf(atomId);
    const pos = node !== undefined && Object.hasOwn(layout.positions, node) ? layout.positions[node] : undefined;
    if (pos === undefined) {
      hidden.add(atomId);
      atoms[atomId] = atom;
      continue;
    }
    if (node !== atomId && condensedAt.get(atomId)?.id !== node) hidden.add(atomId);
    atoms[atomId] = { ...atom, pos };
  }

  const bySource = new Map<BondId, ProjectedLayout["bonds"][number]>();
  for (const bond of layout.bonds) if (bond.sourceBondId !== undefined) bySource.set(bond.sourceBondId, bond);
  const bonds: Record<BondId, Bond> = {};
  for (const bondId of mol.bondIds) {
    const bond = Object.hasOwn(mol.bonds, bondId) ? mol.bonds[bondId] : undefined;
    if (bond === undefined) continue;
    const drawn = bySource.get(bondId);
    const mark = drawn !== undefined && Object.hasOwn(layout.marks, drawn.id) ? layout.marks[drawn.id] : undefined;
    if (mark === undefined) {
      bonds[bondId] = bond.stereo === "none" ? bond : { ...bond, stereo: "none" };
      continue;
    }
    // The model's convention is narrow end at `from`; a layout names its
    // narrow end by node, so the copy's ends are ordered to match. Only the
    // copy — the source bond is not edited.
    const narrowAtTo =
      mark.stereo !== "either" &&
      mark.narrowEnd !== nodeOf(bond.from) &&
      mark.narrowEnd === nodeOf(bond.to);
    bonds[bondId] = narrowAtTo
      ? { ...bond, from: bond.to, to: bond.from, stereo: mark.stereo }
      : { ...bond, stereo: mark.stereo };
  }

  return {
    geometry: { ...mol, atoms, bonds },
    hidden,
    condensedAt,
    hydrogens,
    hydrogenHosts: new Set(hydrogens.map((node) => node.host)),
    layout,
  };
}

/** The scene source of a derived node: the node and every atom it stands for. */
export function projectedSource(layout: ProjectedLayout, node: DerivedNode): SceneSource {
  const atomIds = Object.hasOwn(layout.provenance, node.id) ? layout.provenance[node.id]! : [node.host];
  return { kind: "projected", nodeId: node.id, atomIds };
}

/** `projected:a11.CH2OH:label`: the node's own id, never a counter. */
export function projectedPrimitiveId(nodeId: string, part: "label" | "line"): string {
  return `projected:${nodeId}:${part}`;
}

/**
 * A derived node's label as the placement pass takes it, and the side it
 * must be set on.
 *
 * The part at `node.anchor` — the attached atom's own symbol — becomes the
 * one-span symbol the placement centres on the node. Whatever reads after it
 * goes east, whatever reads before it goes west: "CH2OH" sets C on the node
 * with "H2OH" trailing, "HOH2C" sets it with "HOH2" leading. The side is
 * FORCED, because the text was already spelled for it.
 */
export function derivedNodeLabel(node: DerivedNode, element: string): { label: ComposedLabel; side: LabelSide } {
  const spans = node.label.map(spanOf);
  const anchor = Math.min(Math.max(0, Math.trunc(node.anchor)), Math.max(0, spans.length - 1));
  const symbol = spans[anchor] ?? { text: element };
  const before = spans.slice(0, anchor);
  const after = spans.slice(anchor + 1);
  const west = before.length > 0;
  return {
    label: {
      atomId: node.host,
      element,
      reason: "override",
      isotope: [],
      symbol: [symbol],
      // East, everything after the symbol trails it; west, everything before
      // it leads, and anything after (a charge on the attached atom) stays in
      // the run's closing block.
      hydrogens: west ? before : after,
      charge: west ? after : [],
      hydrogenCount: 0,
      radicalDotCount: 0,
      lonePairCount: 0,
      chargeDetached: false,
    },
    side: west ? "west" : "east",
  };
}

function spanOf(part: FormulaPart): TextSpan {
  switch (part.kind) {
    case "symbol":
      return { text: part.text };
    case "count":
      return { text: part.text, script: "sub" };
    case "charge":
      // U+2212, as every drawn charge in this package: a hyphen reads as a bond.
      return { text: part.text.replace("-", "−"), script: "super" };
  }
}
