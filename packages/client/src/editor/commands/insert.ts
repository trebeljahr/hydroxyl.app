/**
 * Putting an inserted structure on the canvas: the insert box's last step.
 *
 * The molecule arrives at the standard bond from `@/lib/io/insert`; this file
 * decides where it goes and commits it as one undo entry.
 *
 * ── BESIDE THE DRAWING, NEVER ON IT ────────────────────────────────────────
 *
 * The structure lands to the right of everything already drawn, two bond
 * lengths clear and centred on the drawing's height; on an empty sketch it is
 * centred on the origin. Dropping it at the view centre instead would put it
 * on top of whatever is there as often as not, and overlapping atoms are
 * neither a valence error nor anything else the editor can surface. The view
 * then fits the whole drawing, so the new structure is on screen however far
 * it had to go.
 *
 * ── AT THE DRAWING'S OWN BOND LENGTH ───────────────────────────────────────
 *
 * Scaled to `documentBondLength`, the same median every drawing gesture uses,
 * so caffeine inserted beside a structure imported in Angstroms matches it
 * rather than printing at a different size.
 *
 * ── A COPY LANDS BESIDE ITS SOURCE, NEVER ON ANYTHING ──────────────────────
 *
 * Paste and Duplicate follow the same rule, through `clearOfDrawingOffset`
 * (decision 200): the copy keeps its row and moves right, to the first place
 * `INSERT_GAP_BONDS` clear of every structure already drawn. It used to land
 * half a bond off its original, so three copies of a sugar sat on top of each
 * other — unreadable, and crowding out each other's descriptors until they
 * were dragged apart by hand.
 *
 * ── SYNCHRONOUS ON PURPOSE ─────────────────────────────────────────────────
 *
 * The reading (possibly RDKit, possibly seconds while the wasm loads) happens
 * before this is called, and this reads the molecule fresh from the store. A
 * bond drawn during the wait is therefore kept: the insert is added to the
 * molecule as it is NOW, not to the one that was there when Enter was pressed.
 */

import {
  bounds,
  DEFAULT_BOND_LENGTH,
  isEmpty,
  molecularFormulaUnicode,
  normalizeBondLength,
  positions,
  species,
  type AtomId,
  type Molecule,
  type Vec2,
} from "@starter/chem-core";
import { modelToPx } from "@starter/chem-render";

import { fitBounds } from "@/canvas/metrics";
import { buildCanvasScene } from "@/canvas/scene-bridge";
import { documentBondLength } from "@/editor/interaction/machine";
import { guardedOps } from "@/state/chem-guard";
import { visibleBounds } from "@/state/viewport";
import type { EditorStore } from "@/state";

/** Clear space between the drawing and the inserted structure, in bonds. */
export const INSERT_GAP_BONDS = 2;

/**
 * Where the structure goes, as the offset to add to its coordinates.
 *
 * Pure, so the placement rule is testable without a store.
 */
export function insertOffset(current: Molecule, incoming: Molecule, bondLength: number): Vec2 {
  const box = bounds(positions(incoming));
  const centre = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
  };
  if (isEmpty(current)) return { x: -centre.x, y: -centre.y };
  const drawn = bounds(positions(current));
  return {
    x: drawn.max.x + INSERT_GAP_BONDS * bondLength - box.min.x,
    y: (drawn.min.y + drawn.max.y) / 2 - centre.y,
  };
}

interface Box {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** True when `a` and `b` come within `gap` of each other on both axes. */
function within(a: Box, b: Box, gap: number): boolean {
  return (
    a.min.x < b.max.x + gap &&
    b.min.x < a.max.x + gap &&
    a.min.y < b.max.y + gap &&
    b.min.y < a.max.y + gap
  );
}

/**
 * Where a copy goes, as the offset to add to its coordinates: `incoming` is
 * the box of its atoms where they are now, and the copy slides right along
 * its own row until it is `INSERT_GAP_BONDS` clear of every structure in
 * `current` (decision 200). Nothing moves vertically, so a copy stays level
 * with its source and a scheme built by duplicating reads left to right.
 *
 * With nothing in the way the offset is zero: a structure cut and pasted
 * back comes back where it was. A duplicate's source is in `current`, so its
 * copy always lands to the right of the source's whole structure.
 *
 * THE LOOP MOVES THE LEFT EDGE, NOT THE OFFSET. Each jump sets the edge to
 * exactly `box.max.x + gap`, the expression `within` compares it against, so
 * a box once passed can never be hit again. Carried as an offset instead,
 * `min.x + (right + gap - min.x)` can round a hair short of `right + gap`, hit
 * the same box and recompute the same offset forever. Every jump is past a
 * box's right edge and there are finitely many, so it ends.
 *
 * Pure, so the rule is testable without a store.
 */
export function clearOfDrawingOffset(current: Molecule, incoming: Box, bondLength: number): Vec2 {
  const gap = INSERT_GAP_BONDS * bondLength;
  const drawn = species(current).map((unit) =>
    bounds(unit.atomIds.map((id) => current.atoms[id]!.pos)),
  );
  const width = incoming.max.x - incoming.min.x;
  let left = incoming.min.x;
  for (;;) {
    const moved: Box = {
      min: { x: left, y: incoming.min.y },
      max: { x: left + width, y: incoming.max.y },
    };
    const hit = drawn.filter((box) => within(moved, box, gap));
    if (hit.length === 0) return { x: left - incoming.min.x, y: 0 };
    left = Math.max(...hit.map((box) => box.max.x + gap));
  }
}

/**
 * Fit the view to the drawing when any of `atomIds` is outside it, as the
 * insert does. A copy that landed off screen reads as a copy that never
 * happened; one that is already in view leaves the view alone.
 */
export function revealAtoms(store: EditorStore, atomIds: readonly AtomId[]): void {
  const state = store.getState();
  const mol = state.document.molecule;
  const scene = buildCanvasScene(state.document, state.ui.activePanelId);
  const view = visibleBounds(state.viewport);
  const hidden = atomIds.some((id) => {
    const atom = mol.atoms[id];
    if (atom === undefined) return false;
    const p = modelToPx(scene.style, atom.pos);
    return p.x < view.min.x || p.x > view.max.x || p.y < view.min.y || p.y > view.max.y;
  });
  if (hidden) state.zoomToFit(fitBounds(scene), 0);
}

/**
 * Add `molecule` to the open sketch as one undo entry, select it, and bring it
 * into view. `title` names the entry in the history and the status line.
 */
export function insertStructure(store: EditorStore, molecule: Molecule, title: string): void {
  if (isEmpty(molecule)) {
    store.getState().setStatusMessage(`“${title}” has no atoms, so nothing was inserted`);
    return;
  }
  const state = store.getState();
  const current = state.document.molecule;
  const bondLength = isEmpty(current) ? DEFAULT_BOND_LENGTH : documentBondLength(current);
  const scaled = normalizeBondLength(molecule, bondLength);
  const inserted = guardedOps.insertFragment(current, scaled, {
    offset: insertOffset(current, scaled, bondLength),
  });
  const label = `Insert ${title}`;
  state.transact(label, () => {
    state.applyMoleculeEdit(label, () => inserted.molecule);
    // Selected, so the next drag moves what just arrived and an unwanted
    // insert is one Delete away — the same courtesy paste extends.
    state.setSelection({
      atomIds: inserted.atomIds,
      bondIds: inserted.bondIds,
      annotationIds: [],
    });
  });
  const after = store.getState();
  after.zoomToFit(fitBounds(buildCanvasScene(after.document, after.ui.activePanelId)), 0);
  after.setStatusMessage(`Inserted ${title} (${molecularFormulaUnicode(scaled)})`);
}
