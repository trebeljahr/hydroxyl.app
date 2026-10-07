/**
 * Where a mouse or pen pointer is resting over the canvas, in canvas-local
 * px, or null when it is not over the canvas at all.
 *
 * Paste reads it: Mod+V with the pointer over the drawing drops the clipboard
 * centred there, as PubChem's sketcher does, and with the pointer anywhere
 * else it falls back to landing beside its source (decision 200).
 *
 * A MODULE VARIABLE, NOT STORE STATE. It changes on every pointer move, and a
 * store write per move would re-render every subscriber for a value only a
 * keystroke ever reads. The internal clipboard sits beside it in the registry
 * for the same reason.
 *
 * CANVAS PX, NOT MODEL UNITS. A wheel pan or a zoom moves the drawing under a
 * pointer that has not moved, and no pointer event follows to say so; kept in
 * px it is converted through the viewport at the moment of the paste, which is
 * the one that is current.
 *
 * Touch never sets it: a finger has no hover, so its last position is where
 * it LEFT the glass, which is not an aim at anything.
 */

import type { Vec2 } from "@starter/chem-core";

let anchor: Vec2 | null = null;

export function setCanvasPointer(point: Vec2 | null): void {
  anchor = point;
}

export function canvasPointer(): Vec2 | null {
  return anchor;
}
