/**
 * Molecule -> scene.
 *
 * The one place a chemistry graph becomes geometry. Positions go through
 * `modelToPx`, so everything that leaves here is final px, y-down.
 *
 * A bond whose endpoint atom is missing is skipped rather than thrown on: a
 * scene is a view of a possibly-mid-edit molecule, and an undo landing while a
 * drag is in flight is an ordinary UI race, not a programming error.
 */

import { formulaParts, getAtom, neighborIds } from "@starter/chem-core";
import type { AtomId, Molecule } from "@starter/chem-core";

import {
  composeAtomLabel,
  labelRunId,
  radicalDotId,
} from "../label/compose.js";
import { placeAtomLabel } from "../label/placement.js";
import type { AtomLabelPlacement } from "../label/placement.js";
import { isStructural } from "../representation.js";
import type {
  Representation,
  StructuralRepresentation,
} from "../representation.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";
import { sceneBounds } from "./bounds.js";
import type {
  CirclePrimitive,
  LinePrimitive,
  RenderScene,
  ScenePrimitive,
  TextRunPrimitive,
  TextSpan,
} from "./types.js";

/**
 * Builds the scene for `mol` under `style` and `representation`.
 *
 * Emission order is `mol.bondIds` then `mol.atomIds` — the molecule's
 * insertion order — so the output is deterministic and bonds paint under the
 * atom decorations that sit on their ends.
 *
 * Atom labels are drawn here; bond geometry is not. The trimming that keeps a
 * line clear of a label, the second line of a double bond and the stereo
 * wedges are the next pass, which consumes the label boxes this one produces —
 * so a double bond is still one plain line, and a bond still runs under the
 * label it meets. Benzene skeletal is therefore exactly six lines and six
 * bare-vertex dots.
 */
export function buildScene(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
): RenderScene {
  const primitives = isStructural(representation)
    ? buildStructural(mol, style, representation)
    : [buildFormulaRun(mol, style, representation.kind)];

  return {
    primitives,
    bounds: sceneBounds(primitives, style),
    style,
    representation,
  };
}

/**
 * Where `atomId`'s label sits, or undefined if it is a bare vertex.
 *
 * THE seam for everything downstream of a label that is not the label itself.
 * `buildScene` uses it to emit the primitives; bond geometry will use
 * `clearBox` to trim a line back so it stops clear of the glyphs; the editor
 * uses `symbolBox` to size an atom's pick target. All three must agree to the
 * pixel, and the only way to guarantee that is for all three to call the same
 * function rather than re-measure the scene's output.
 *
 * Deriving it from the scene instead was the obvious alternative and is worse:
 * a `textRun` primitive carries the run's origin but not which of its spans is
 * the atom's own symbol, so a consumer would have to re-split the run — and a
 * radius taken from the WHOLE run's far corner reaches past the hanging
 * hydrogen of an "OH" and, projected back along the bond where no glyph is,
 * beats the bond at its own midpoint.
 *
 * Pure and cheap: the same inputs give the same answer, so a caller that wants
 * it per atom per pointer-move should cache on the molecule instance rather
 * than expect this to memoise.
 *
 * Both the atom and its neighbours go through `modelToPx` HERE, so the
 * placement pass differences two points that are already in scene px. It
 * therefore never scales and never flips — the whole reason it takes
 * `ScenePoint`s rather than a molecule. See the header of placement.ts.
 */
export function atomLabelPlacement(
  mol: Molecule,
  atomId: AtomId,
  style: RenderStyle,
  representation: StructuralRepresentation,
): AtomLabelPlacement | undefined {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return undefined;
  const label = composeAtomLabel(mol, atomId, representation);
  if (label === undefined) return undefined;

  const neighbourCentres = neighborIds(mol, atomId).flatMap((neighbourId) => {
    const neighbour = getAtom(mol, neighbourId);
    return neighbour === undefined ? [] : [modelToPx(style, neighbour.pos)];
  });

  return placeAtomLabel({
    atomId,
    centre: modelToPx(style, atom.pos),
    neighbourCentres,
    label,
    style,
  });
}

/** Bonds then atoms, each in the molecule's own insertion order. */
function buildStructural(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
): readonly ScenePrimitive[] {
  const primitives: ScenePrimitive[] = [];

  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    if (bond === undefined) continue;
    const from = getAtom(mol, bond.from);
    const to = getAtom(mol, bond.to);
    // A dangling endpoint means the molecule is mid-edit, not corrupt. Drop
    // the line and draw the rest rather than blanking the whole canvas.
    if (from === undefined || to === undefined) continue;

    const line: LinePrimitive = {
      id: `bond:${bondId}:line`,
      source: { kind: "bond", bondId },
      type: "line",
      a: modelToPx(style, from.pos),
      b: modelToPx(style, to.pos),
      stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
    };
    primitives.push(line);
  }

  for (const atomId of mol.atomIds) {
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;

    // ONE decision, made in `composeAtomLabel`: undefined means bare vertex.
    // A second condition here — "is it a carbon", "does it have a charge" —
    // would be a place the two could disagree, and the symptom is an atom
    // drawn twice or not at all.
    const label = composeAtomLabel(mol, atomId, representation);

    if (label === undefined) {
      // The dot marks a BARE vertex only. A labelled atom must never also
      // carry one: a dot beside a symbol is the universal notation for an
      // unpaired electron, so a plain methyl would read as a methyl radical.
      if (style.atomDotRadiusPx > 0) {
        const dot: CirclePrimitive = {
          id: `atom:${atomId}:dot`,
          source: { kind: "atom", atomId },
          type: "circle",
          centre: modelToPx(style, atom.pos),
          radius: style.atomDotRadiusPx,
          fill: { color: style.colors.label },
        };
        primitives.push(dot);
      }
      continue;
    }

    const placement = atomLabelPlacement(mol, atomId, style, representation);
    // Unreachable: the same `composeAtomLabel` call decided there is a label.
    if (placement === undefined) continue;

    // Identity and paint are decided here, not in the placement pass, which
    // returns geometry and nothing else. Keeping the id scheme in one place is
    // what makes the output byte-deterministic across an edit history.
    const run: TextRunPrimitive = {
      id: labelRunId(atomId),
      source: { kind: "atom", atomId },
      type: "textRun",
      origin: placement.run.origin,
      spans: placement.run.spans,
      fontFamily: style.fontFamily,
      fontSizePx: placement.run.fontSizePx,
      fill: { color: style.colors.label },
      anchor: placement.run.anchor,
      baseline: placement.run.baseline,
    };
    primitives.push(run);

    // Flat siblings rather than a `group`: the existing scheme is flat
    // (`bond:b3:line`, `atom:a2:dot`), a group would make the primitive shape
    // depend on whether the atom happens to be a radical, and both the bounds
    // pass and the serialiser already handle a flat list.
    placement.dots.forEach((placedDot, index) => {
      const radicalDot: CirclePrimitive = {
        id: radicalDotId(atomId, index),
        source: { kind: "atom", atomId },
        type: "circle",
        centre: placedDot.centre,
        radius: placedDot.radius,
        fill: { color: style.colors.label },
      };
      primitives.push(radicalDot);
    });
  }

  return primitives;
}

/**
 * Condensed and sum-formula views, as one glyph run at the scene origin.
 *
 * Both are placeholders sharing chem-core's Hill-ordered formula parts for
 * now. A condensed formula is really "CH3CH2OH" — walked from the graph, not
 * summed over it — and gets its own pass later; until then showing the sum
 * formula is at least chemically true rather than blank.
 *
 * The run belongs to no atom or bond, hence a `decoration` source: a click on
 * "C6H6" selects nothing, which is the correct behaviour for a text view.
 */
function buildFormulaRun(
  mol: Molecule,
  style: RenderStyle,
  kind: string,
): TextRunPrimitive {
  const spans: TextSpan[] = formulaParts(mol).map((part) => {
    if (part.kind === "count") return { text: part.text, script: "sub" };
    if (part.kind === "charge") return { text: part.text, script: "super" };
    return { text: part.text };
  });

  return {
    id: `text:${kind}:formula`,
    source: { kind: "decoration" },
    type: "textRun",
    // The origin, centred both ways: a text view has no molecular geometry to
    // anchor to, and the margin in `sceneBounds` gives it its box.
    origin: { x: 0, y: 0 },
    spans,
    fontFamily: style.fontFamily,
    fontSizePx: style.fontSizePx,
    fill: { color: style.colors.label },
    anchor: "middle",
    baseline: "middle",
  };
}
