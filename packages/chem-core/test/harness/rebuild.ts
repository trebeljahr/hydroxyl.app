/**
 * The layout-to-Molecule builder the molblock oracle needs (the architectural
 * ruling; decision 210). TEST TREE ONLY: nothing under src/ imports this
 * file, the package's published barrel does not export it, and everything it
 * returns is branded `TEST_ONLY_MOLECULE`, which shared's `createDocument`
 * and `encodeDocument` refuse. A projection is a view of the document's
 * molecule and never a molecule of its own (decision 12); this exists so a
 * layout can be handed to the molblock writer and to RDKit like a drawing.
 *
 * WHAT IT BUILDS. Every source atom where the layout draws it; a condensed
 * node's attachment atom ON the node, the atoms it folds strung out beyond it
 * away from the rest of the drawing (their places carry no stereo, only
 * their bonds do); an atom the layout does not show (another species beside
 * a Fischer) where the molecule has it. Every derived hydrogen becomes an
 * explicit H atom at its node, bonded to its host, carrying the layout's mark
 * on that line, so a revealed 5α-H and a Fischer's H arm are atoms a reader
 * and RDKit can both see. Each bond carries the mark the layout drew on it,
 * narrow end first, and no other: the author's marks never leak into a panel
 * that did not draw them.
 */

import { cloneAtomWith, makeAtom } from "../../src/molecule.js";
import { assembleMolecule } from "../../src/builders.js";
import { derivedBondId } from "../../src/projection/nodes.js";
import type { LayoutNodeId, ProjectedLayout } from "../../src/projection/types.js";
import { TEST_ONLY_MOLECULE, type TestOnlyMolecule } from "../../src/test-only.js";
import type { Atom, AtomId, Bond, BondId, Molecule } from "../../src/types.js";
import type { Vec2 } from "../../src/vec.js";

export interface RebuiltLayout {
  readonly molecule: TestOnlyMolecule;
  /** The rebuilt atom each layout node stands on: a source atom, or a derived hydrogen's new atom. */
  readonly atomOfNode: ReadonlyMap<LayoutNodeId, AtomId>;
}

export function moleculeFromLayout(mol: Molecule, layout: ProjectedLayout): RebuiltLayout {
  const bondLength = layout.bondLength;
  const derived = new Map(layout.derivedNodes.map((node) => [node.id, node]));
  const atomOfNode = new Map<LayoutNodeId, AtomId>();

  // Where each source atom goes.
  const positions = new Map<AtomId, Vec2>();
  const foldedCount = new Map<LayoutNodeId, number>();
  for (const atomId of mol.atomIds) {
    const node = Object.hasOwn(layout.drawnAs, atomId) ? layout.drawnAs[atomId]! : undefined;
    if (node === undefined) {
      positions.set(atomId, mol.atoms[atomId]!.pos);
      continue;
    }
    const at = layout.positions[node]!;
    const group = derived.get(node);
    if (group === undefined || group.host === atomId) {
      positions.set(atomId, at);
      if (!atomOfNode.has(node)) atomOfNode.set(node, atomId);
      continue;
    }
    // A folded atom: beyond its node, away from what the node is bonded to.
    const k = (foldedCount.get(node) ?? 0) + 1;
    foldedCount.set(node, k);
    const outward = outwardFrom(layout, node);
    positions.set(atomId, { x: at.x + outward.x * 0.5 * k * bondLength, y: at.y + outward.y * 0.5 * k * bondLength });
  }

  let next = mol.nextId;
  const hydrogensOn = new Map<AtomId, number>();
  const newAtoms: Atom[] = [];
  const newBonds: Bond[] = [];
  for (const node of layout.derivedNodes) {
    if (node.kind !== "hydrogen") continue;
    const id = `a${next++}`;
    atomOfNode.set(node.id, id);
    newAtoms.push(makeAtom(id, { element: "H", pos: layout.positions[node.id]! }));
    hydrogensOn.set(node.host, (hydrogensOn.get(node.host) ?? 0) + 1);
    const mark = Object.hasOwn(layout.marks, derivedBondId(node.id)) ? layout.marks[derivedBondId(node.id)] : undefined;
    newBonds.push({
      id: `b${next++}`,
      from: node.host,
      to: id,
      order: 1,
      stereo: mark !== undefined && mark.narrowEnd === layout.drawnAs[node.host] ? mark.stereo : "none",
      doubleBondSide: "auto",
      aromatic: false,
    });
  }

  const atoms: Record<AtomId, Atom> = {};
  for (const atomId of mol.atomIds) {
    const atom = mol.atoms[atomId]!;
    const pinned = atom.explicitHydrogenCount;
    const drawn = hydrogensOn.get(atomId) ?? 0;
    atoms[atomId] = cloneAtomWith(atom, {
      pos: positions.get(atomId)!,
      // A pinned count is the IMPLICIT hydrogens; one now drawn is no longer one of them.
      ...(pinned === undefined || drawn === 0 ? {} : { explicitHydrogenCount: Math.max(0, pinned - drawn) }),
    });
  }
  for (const atom of newAtoms) atoms[atom.id] = atom;

  const lineOf = new Map<BondId, ProjectedLayout["bonds"][number]>();
  for (const line of layout.bonds) if (line.sourceBondId !== undefined) lineOf.set(line.sourceBondId, line);
  const bonds: Record<BondId, Bond> = {};
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId]!;
    const line = lineOf.get(bondId);
    const mark = line === undefined || !Object.hasOwn(layout.marks, line.id) ? undefined : layout.marks[line.id];
    let rebuilt: Bond = { ...bond, stereo: "none" };
    if (mark !== undefined) {
      if (mark.narrowEnd === layout.drawnAs[bond.from]) rebuilt = { ...bond, stereo: mark.stereo };
      else if (mark.narrowEnd === layout.drawnAs[bond.to]) rebuilt = { ...bond, from: bond.to, to: bond.from, stereo: mark.stereo };
    }
    bonds[bondId] = rebuilt;
  }
  for (const bond of newBonds) bonds[bond.id] = bond;

  const molecule = assembleMolecule({
    atoms,
    bonds,
    atomIds: [...mol.atomIds, ...newAtoms.map((a) => a.id)],
    bondIds: [...mol.bondIds, ...newBonds.map((b) => b.id)],
    nextId: next,
    stereoGroups: mol.stereoGroups,
    speciesJoins: mol.speciesJoins,
    abbreviations: mol.abbreviations,
  });
  // Non-enumerable, so it never reaches JSON; every chem-core edit returns a
  // fresh object, so an edited copy is no longer branded.
  Object.defineProperty(molecule, TEST_ONLY_MOLECULE, { value: true, enumerable: false });
  return { molecule: molecule as TestOnlyMolecule, atomOfNode };
}

/** A unit vector from the layout node a derived node hangs off, through it. */
function outwardFrom(layout: ProjectedLayout, node: LayoutNodeId): Vec2 {
  const at = layout.positions[node]!;
  const line = layout.bonds.find((b) => b.from === node || b.to === node);
  if (line === undefined) return { x: 0, y: 1 };
  const other = layout.positions[line.from === node ? line.to : line.from]!;
  const dx = at.x - other.x;
  const dy = at.y - other.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 0, y: 1 } : { x: dx / length, y: dy / length };
}
