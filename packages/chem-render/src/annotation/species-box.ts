/**
 * Where each species is drawn in one panel: the box its ink fills.
 *
 * Everything drawn BETWEEN species — a reaction arrow, a plus sign — and
 * everything drawn AROUND them — a bracket — is placed against these boxes,
 * never against model coordinates (decision 103: a reaction arrow stores no
 * shaft; it is placed between its species at render time, so dragging a
 * species carries its arrow). The box is read off what THIS panel drew, which
 * is what makes a re-projected panel place its arrows against its own layout
 * with no code of its own.
 *
 * A species' box is the union of:
 *
 *   - every placed atom: its label's measured ink (glyphs, electron dots, a
 *     detached charge), or a bare vertex's dot;
 *   - every bond that starts on one of its atoms, as drawn: both lines of a
 *     double bond, a wedge's outline, each at its stroke half-width;
 *   - the derived hydrogens the explicit-H and Lewis views fan off its atoms;
 *   - the label annotations drawn beside its atoms (descriptors, locants, a
 *     delta), so an arrow does not run through an "(R)";
 *   - its coefficient, once the layer has placed one (`extend`).
 *
 * Species are chem-core's (`speciesIndexOf`, decision 102), read on the SOURCE
 * molecule: a projection re-poses atoms, never regroups them.
 *
 * Scene px, y-down, like everything the layer sees.
 */

import { speciesIndexOf, species as speciesOfMolecule } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import type { LabelBox } from "../label/placement.js";
import type { RenderStyle } from "../style.js";
import type { SchemeLayerSite } from "./layer.js";

/** A box in scene px, y-down: `minY` is the top edge. */
export type SchemeBox = LabelBox;

/** The smallest box holding both; either may be absent. */
export function unionBoxes(a: SchemeBox | undefined, b: SchemeBox | undefined): SchemeBox | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boxCentre(box: SchemeBox): { readonly x: number; readonly y: number } {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Ink drawn beside an atom by the label pass: a descriptor, a locant, a delta. */
export interface AtomInk {
  readonly atomId: AtomId;
  readonly box: SchemeBox;
}

/**
 * Each species' drawn box in one panel, built on first ask and grown by
 * `extend`. One instance per scene build.
 */
export class SpeciesBoxes {
  readonly #source: Molecule;
  readonly #site: SchemeLayerSite;
  readonly #style: RenderStyle;
  readonly #labelInk: readonly AtomInk[];
  readonly #boxes = new Map<number, SchemeBox | undefined>();

  constructor(source: Molecule, site: SchemeLayerSite, style: RenderStyle, labelInk: readonly AtomInk[]) {
    this.#source = source;
    this.#site = site;
    this.#style = style;
    this.#labelInk = labelInk;
  }

  /** The index of the species `atomId` belongs to, or undefined for an unknown atom. */
  speciesIndex(atomId: AtomId): number | undefined {
    return speciesIndexOf(this.#source, atomId);
  }

  /** The box of the species `atomId` belongs to; undefined if the panel draws none of it. */
  boxOf(atomId: AtomId): SchemeBox | undefined {
    const index = this.speciesIndex(atomId);
    if (index === undefined) return undefined;
    if (!this.#boxes.has(index)) this.#boxes.set(index, this.#measure(index));
    return this.#boxes.get(index);
  }

  /** The union of the boxes of every species the atoms name. */
  unionOf(atomIds: readonly AtomId[]): SchemeBox | undefined {
    let out: SchemeBox | undefined;
    for (const atomId of atomIds) out = unionBoxes(out, this.boxOf(atomId));
    return out;
  }

  /** Grows the box of `atomId`'s species to hold `box` — a coefficient printed before it. */
  extend(atomId: AtomId, box: SchemeBox): void {
    const index = this.speciesIndex(atomId);
    if (index === undefined) return;
    this.#boxes.set(index, unionBoxes(this.boxOf(atomId), box));
  }

  #measure(index: number): SchemeBox | undefined {
    const members = speciesOfMolecule(this.#source)[index]?.atomIds ?? [];
    const inSpecies = new Set<AtomId>(members);
    const site = this.#site;
    let box: SchemeBox | undefined;
    const add = (b: SchemeBox): void => {
      box = unionBoxes(box, b);
    };
    const dot = Math.max(this.#style.atomDotRadiusPx, this.#style.bondLineWidthPx / 2);
    for (const atomId of members) {
      const centre = site.centres.get(atomId);
      const label = site.placements.get(atomId);
      if (label !== undefined) {
        for (const ink of label.inkBoxes) add(ink);
        // A label whose ink is all space still occupies its symbol box.
        if (label.inkBoxes.length === 0) add(label.symbolBox);
      } else if (centre !== undefined) {
        add({ minX: centre.x - dot, minY: centre.y - dot, maxX: centre.x + dot, maxY: centre.y + dot });
      }
    }
    for (const bond of site.bonds) {
      if (!inSpecies.has(bond.from)) continue;
      const lines = bond.lines.length > 0 ? bond.lines : [{ a: bond.a, b: bond.b }];
      for (const line of lines) {
        const half = ("halfWidth" in line ? line.halfWidth : undefined) ?? this.#style.bondLineWidthPx / 2;
        add({
          minX: Math.min(line.a.x, line.b.x) - half,
          minY: Math.min(line.a.y, line.b.y) - half,
          maxX: Math.max(line.a.x, line.b.x) + half,
          maxY: Math.max(line.a.y, line.b.y) + half,
        });
      }
    }
    for (const hydrogen of site.hydrogenLabels) {
      if (!inSpecies.has(hydrogen.atomId)) continue;
      for (const obstacle of hydrogen.obstacles) {
        add(
          obstacle.kind === "rect"
            ? obstacle.box
            : {
                minX: obstacle.centre.x - obstacle.radius,
                minY: obstacle.centre.y - obstacle.radius,
                maxX: obstacle.centre.x + obstacle.radius,
                maxY: obstacle.centre.y + obstacle.radius,
              },
        );
      }
    }
    for (const ink of this.#labelInk) {
      if (inSpecies.has(ink.atomId)) add(ink.box);
    }
    return box;
  }
}
