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

import {
  aromaticRings,
  formulaParts,
  getAtom,
  neighborIds,
  ringAt,
} from "@starter/chem-core";
import type { AtomId, BondId, Molecule } from "@starter/chem-core";

import { aromaticCircleId, inscribedCircle } from "../bond/aromatic.js";
import {
  BOND_GEOMETRY,
  bondAxis,
  insetForVertex,
  leftNormal,
  offsetSegment,
} from "../bond/geometry.js";
import type { BondAxis } from "../bond/geometry.js";
import { resolveDoubleBondSide } from "../bond/doubleBond.js";
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
  ScenePoint,
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
 * Bond geometry is resolved here too: a line stops short of the label it meets
 * (`bond/geometry.ts`), a double bond gets its second line on the side
 * `bond/doubleBond.ts` resolves, and an aromatic ring can draw one inscribed
 * circle instead of its alternation (`bond/aromatic.ts`). Benzene skeletal is
 * therefore nine lines and six bare-vertex dots — six ring edges and the three
 * inner lines of its Kekule double bonds.
 *
 * Stereo marks are still absent; they are `stereochemistry-perception-and-marks`.
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
 * `buildScene` uses it to emit the primitives; the bond pass trims a line back
 * against `obstacles`, through `trimDistance`, so it stops clear of the
 * glyphs; the editor uses `symbolBox` to size an atom's pick target. All three
 * must agree to the pixel, and the only way to guarantee that is for all three
 * to call the same function rather than re-measure the scene's output.
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

/**
 * Bonds, then aromatic circles, then atoms — each in the molecule's own
 * insertion order.
 *
 * Every atom's label placement is computed ONCE, into a map both passes share.
 * `atomLabelPlacement` is pure but deliberately not memoised (its own doc says
 * a per-pointer-move caller must cache), and the bond pass wants it at both
 * ends of every bond: placing each label afresh there would measure a benzene
 * carbon's label three times over.
 */
function buildStructural(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
): readonly ScenePrimitive[] {
  const primitives: ScenePrimitive[] = [];

  const centres = new Map<AtomId, ScenePoint>();
  const placements = new Map<AtomId, AtomLabelPlacement | undefined>();
  for (const atomId of mol.atomIds) {
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;
    centres.set(atomId, modelToPx(style, atom.pos));
    placements.set(
      atomId,
      atomLabelPlacement(mol, atomId, style, representation),
    );
  }

  const circles = representation.flags.aromaticCircles
    ? aromaticCirclePrimitives(mol, style, centres)
    : EMPTY_CIRCLES;

  for (const bondId of mol.bondIds) {
    pushBondPrimitives(
      primitives,
      mol,
      style,
      bondId,
      centres,
      placements,
      circles.suppressedBondIds,
    );
  }

  primitives.push(...circles.primitives);

  for (const atomId of mol.atomIds) {
    const centre = centres.get(atomId);
    if (centre === undefined) continue;

    // ONE decision, made in `composeAtomLabel` and already taken above:
    // undefined means bare vertex. A second condition here — "is it a carbon",
    // "does it have a charge" — would be a place the two could disagree, and
    // the symptom is an atom drawn twice or not at all.
    const placement = placements.get(atomId);

    if (placement === undefined) {
      // The dot marks a BARE vertex only. A labelled atom must never also
      // carry one: a dot beside a symbol is the universal notation for an
      // unpaired electron, so a plain methyl would read as a methyl radical.
      if (style.atomDotRadiusPx > 0) {
        const dot: CirclePrimitive = {
          id: `atom:${atomId}:dot`,
          source: { kind: "atom", atomId },
          type: "circle",
          centre,
          radius: style.atomDotRadiusPx,
          fill: { color: style.colors.label },
        };
        primitives.push(dot);
      }
      continue;
    }

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
 * One bond's lines: the axis, plus the second and third where the order asks
 * for them.
 *
 * A bond that draws NOTHING is a real outcome, not a failure — a dangling
 * endpoint mid-edit, two coincident atoms after a template drop that did not
 * merge, or two labels whose clear boxes meet. Every one of them is a picture
 * the author can see is wrong; `detectCollisions` names them.
 */
function pushBondPrimitives(
  primitives: ScenePrimitive[],
  mol: Molecule,
  style: RenderStyle,
  bondId: BondId,
  centres: ReadonlyMap<AtomId, ScenePoint>,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
  suppressedBondIds: ReadonlySet<BondId>,
): void {
  const bond = mol.bonds[bondId];
  if (bond === undefined) return;
  const from = centres.get(bond.from);
  const to = centres.get(bond.to);
  // A dangling endpoint means the molecule is mid-edit, not corrupt. Drop
  // the line and draw the rest rather than blanking the whole canvas.
  if (from === undefined || to === undefined) return;

  const axis = bondAxis(
    from,
    to,
    placements.get(bond.from),
    placements.get(bond.to),
    // A bond shorter than it is thick is not a line. Below this the two
    // labels have met and the honest picture is the gap between them.
    style.bondLineWidthPx,
  );
  if (axis === undefined) return;

  const stroke = { color: style.colors.bond, width: style.bondLineWidthPx };
  const line = (suffix: string, ends: { a: ScenePoint; b: ScenePoint }): void => {
    const primitive: LinePrimitive = {
      id: `bond:${bondId}:${suffix}`,
      source: { kind: "bond", bondId },
      type: "line",
      a: ends.a,
      b: ends.b,
      stroke,
    };
    primitives.push(primitive);
  };

  const gap = style.doubleBondGapPx;

  // A TRIPLE BOND IS ALWAYS CENTRED, and its outer pair sits a FULL gap out,
  // not half of one: a centred double's two lines are a gap apart, so half a
  // gap here would make every alkyne read as a slightly thick double bond.
  if (bond.order === 3) {
    const normal = leftNormal(axis.unit);
    line("line", offsetSegment(axis, normal, 0));
    line("line2", offsetSegment(axis, normal, gap));
    line("line3", offsetSegment(axis, normal, -gap));
    return;
  }

  if (bond.order !== 2 || suppressedBondIds.has(bondId)) {
    line("line", { a: axis.a, b: axis.b });
    return;
  }

  const resolution = resolveDoubleBondSide(mol, bondId);
  if (resolution.kind === "centered") {
    const normal = leftNormal(axis.unit);
    // Both lines full length and symmetric about the axis, which is how a
    // centred double bond is drawn. There is deliberately NO line on the axis
    // itself; `bond:<id>:line` is the first line drawn, not the centreline.
    line("line", offsetSegment(axis, normal, gap / 2));
    line("line2", offsetSegment(axis, normal, -gap / 2));
    return;
  }

  // The lean is a POINT in model space; converting it here and differencing
  // against a converted endpoint keeps `modelToPx` the only scale and the only
  // flip. Reading a sign off the difference is neither.
  const toward = modelToPx(style, resolution.point);
  const left = leftNormal(axis.unit);
  const lean = (toward.x - axis.a.x) * left.x + (toward.y - axis.a.y) * left.y;
  const normal: ScenePoint = lean >= 0 ? left : { x: -left.x, y: -left.y };

  line("line", { a: axis.a, b: axis.b });
  line(
    "line2",
    offsetSegment(
      axis,
      normal,
      gap,
      innerLineInset(mol, bond.from, bond.to, centres, axis, normal, gap, axis.unit),
      innerLineInset(
        mol,
        bond.to,
        bond.from,
        centres,
        axis,
        normal,
        gap,
        { x: -axis.unit.x, y: -axis.unit.y },
      ),
    ),
  );
}

/**
 * How far short of `vertexId` the inner line stops.
 *
 * Only the neighbours on the SAME side as the inner line bound it, so those
 * are the only ones consulted, and the largest of their insets wins — clearing
 * the nearest one is not enough when a fused vertex has two. A vertex with no
 * neighbour on that side (a chain terminus) needs no inset at all.
 */
function innerLineInset(
  mol: Molecule,
  vertexId: AtomId,
  farId: AtomId,
  centres: ReadonlyMap<AtomId, ScenePoint>,
  axis: BondAxis,
  normal: ScenePoint,
  gap: number,
  outward: ScenePoint,
): number {
  const vertex = centres.get(vertexId);
  if (vertex === undefined) return 0;

  let inset = 0;
  for (const neighbourId of neighborIds(mol, vertexId)) {
    if (neighbourId === farId) continue;
    const neighbour = centres.get(neighbourId);
    if (neighbour === undefined) continue;
    const dx = neighbour.x - vertex.x;
    const dy = neighbour.y - vertex.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < BOND_GEOMETRY.coincidentEpsilonPx) continue;
    const direction: ScenePoint = { x: dx / length, y: dy / length };
    if (direction.x * normal.x + direction.y * normal.y <= 0) continue;
    const candidate = insetForVertex(outward, direction, gap);
    if (candidate > inset) inset = candidate;
  }

  const limit = BOND_GEOMETRY.maxInsetFraction * axis.length;
  return inset > limit ? limit : inset;
}

interface AromaticCircles {
  readonly primitives: readonly CirclePrimitive[];
  /** Ring bonds whose second line the circle replaces. */
  readonly suppressedBondIds: ReadonlySet<BondId>;
}

const EMPTY_CIRCLES: AromaticCircles = Object.freeze({
  primitives: Object.freeze([]),
  suppressedBondIds: new Set<BondId>(),
});

/**
 * One inscribed circle per perceived aromatic ring, plus the ring bonds it
 * speaks for.
 *
 * Suppression is keyed on membership of a ring THAT ACTUALLY GOT A CIRCLE, not
 * on `isAromaticBond`: a ring whose drawn geometry is too degenerate for a
 * circle keeps its Kekule alternation instead of coming out as a bare polygon
 * with nothing inside it. An exocyclic C=O or a styrene's vinyl keeps its
 * second line either way, because neither bond is in the ring.
 */
function aromaticCirclePrimitives(
  mol: Molecule,
  style: RenderStyle,
  centres: ReadonlyMap<AtomId, ScenePoint>,
): AromaticCircles {
  const order = new Map<AtomId, number>();
  mol.atomIds.forEach((id, index) => order.set(id, index));

  const primitives: CirclePrimitive[] = [];
  const suppressedBondIds = new Set<BondId>();

  for (const ringIndex of aromaticRings(mol)) {
    const ring = ringAt(mol, ringIndex);
    const points: ScenePoint[] = [];
    for (const atomId of ring.atomIds) {
      const centre = centres.get(atomId);
      if (centre === undefined) break;
      points.push(centre);
    }
    if (points.length !== ring.atomIds.length) continue;

    const circle = inscribedCircle(
      points,
      style.aromaticCircleRatio,
      // Below a couple of line widths the circle is barely thicker than the
      // strokes around it, and drawing it is worse than reporting it.
      2 * style.bondLineWidthPx,
    );
    if (circle === undefined) continue;

    // Sorted by INSERTION INDEX, never lexicographically: "a10" sorts before
    // "a2" as a string, and the ring's own walk order starts wherever
    // canonicalisation put it.
    const atomIds = [...ring.atomIds].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
    primitives.push({
      id: aromaticCircleId(atomIds),
      source: { kind: "ring", atomIds },
      type: "circle",
      centre: circle.centre,
      radius: circle.radius,
      stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
    });
    for (const bondId of ring.bondIds) suppressedBondIds.add(bondId);
  }

  return { primitives, suppressedBondIds };
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
