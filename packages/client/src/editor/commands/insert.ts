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
  type Molecule,
  type Vec2,
} from "@starter/chem-core";

import { fitBounds } from "@/canvas/metrics";
import { buildCanvasScene } from "@/canvas/scene-bridge";
import { documentBondLength } from "@/editor/interaction/machine";
import { guardedOps } from "@/state/chem-guard";
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
