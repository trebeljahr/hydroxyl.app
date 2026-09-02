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

import { formulaParts, getAtom } from "@starter/chem-core";
import type { Molecule } from "@starter/chem-core";

import { isStructural } from "../representation.js";
import type { Representation } from "../representation.js";
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
 * This is the foundation pass only. Atom labels, the bond trimming that keeps
 * a line clear of a label, the second line of a double bond and stereo wedges
 * all land in later tasks; a double bond is deliberately still one plain line
 * here, so benzene is exactly six lines and six dots.
 */
export function buildScene(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
): RenderScene {
  const primitives = isStructural(representation)
    ? buildStructural(mol, style)
    : [buildFormulaRun(mol, style, representation.kind)];

  return {
    primitives,
    bounds: sceneBounds(primitives, style),
    style,
    representation,
  };
}

/** Bonds then atoms, each in the molecule's own insertion order. */
function buildStructural(
  mol: Molecule,
  style: RenderStyle,
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

  if (style.atomDotRadiusPx > 0) {
    for (const atomId of mol.atomIds) {
      const atom = getAtom(mol, atomId);
      if (atom === undefined) continue;

      // The dot stands in for the atom label that a later task will draw, so
      // it takes the label colour rather than the bond colour: swapping one
      // for the other should not shift the palette of the drawing.
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
