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
  canCondense,
  cipDescriptor,
  condensedParts,
  descriptorText,
  doubleBondDescriptor,
  formulaParts,
  getAtom,
  neighborIds,
  ringAt,
} from "@starter/chem-core";
import type { FormulaPart } from "@starter/chem-core";
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
  crossedDouble,
  hashPathData,
  wavyPathData,
  wedgePoints,
} from "../bond/stereo.js";
import { placeDescriptor } from "../label/descriptors.js";
import type { DescriptorSegment } from "../label/descriptors.js";
import {
  composeAtomLabel,
  detachedChargeId,
  labelRunId,
  lonePairDotId,
  radicalDotId,
} from "../label/compose.js";
import {
  derivedHydrogenDirections,
  phantomHydrogenId,
  phantomHydrogens,
} from "../modes/explicitH.js";
import { freeDirection, placeAtomLabel } from "../label/placement.js";
import type { AtomLabelPlacement, LabelObstacle } from "../label/placement.js";
import { isStructural } from "../representation.js";
import type {
  Representation,
  StructuralRepresentation,
  TextViewKind,
} from "../representation.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";
import { measurerFor, measureTextRun } from "../text/measurer.js";
import { sceneBounds } from "./bounds.js";
import type {
  CirclePrimitive,
  LinePrimitive,
  PathPrimitive,
  PolygonPrimitive,
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
 * Stereo marks ride on the same axis: `showStereoBonds` turns a single bond
 * carrying a wedge, hash or wavy into that mark INSTEAD of its line, and an
 * `either` double bond into the crossed pair. Because they are built from the
 * trimmed axis, whose `a` is `bond.from`, the narrow end lands where chem-core
 * says it does and `flipBond` inverts the picture with no second rule.
 *
 * `showStereoDescriptors` adds a final pass of `(R)`/`(S)`/`(E)`/`(Z)` runs.
 * It is LAST because it has to see everything else first: a descriptor is
 * annotation and looks for the hole nothing else wanted.
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
    // The hydrogens the explicitH and Lewis views are about to fan off this
    // atom. They are not in the graph, so nothing above finds them, and a
    // lone pair that does not know they are coming picks the same direction
    // one of them will take. Empty for every other view.
    derivedHydrogenDirections: derivedHydrogenDirections(
      mol,
      atomId,
      style,
      representation,
    ),
    label,
    style,
  });
}

/**
 * Every atom's label placement, in the molecule's own insertion order.
 *
 * ONE MAP, built once and passed down. `atomLabelPlacement` is pure but
 * deliberately not memoised, and three passes want it: the bonds want it at
 * both ends of every bond, the phantom hydrogens want their host's to know how
 * far to stand off it, and `detectCollisions` wants all of them. Placing each
 * label afresh in each pass measured a benzene carbon's label three times over
 * — and, once the hydrogens started reading the host's obstacles, opened the
 * door to two passes trimming against two different measurements of the same
 * glyph.
 *
 * An atom whose element the periodic table does not know THROWS out of here,
 * as it always has. `representationAvailability` is the total, non-throwing
 * question a caller asks first.
 */
export function atomLabelPlacements(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
): Map<AtomId, AtomLabelPlacement | undefined> {
  const out = new Map<AtomId, AtomLabelPlacement | undefined>();
  for (const atomId of mol.atomIds) {
    out.set(atomId, atomLabelPlacement(mol, atomId, style, representation));
  }
  return out;
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
  for (const atomId of mol.atomIds) {
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;
    centres.set(atomId, modelToPx(style, atom.pos));
  }
  const placements = atomLabelPlacements(mol, style, representation);

  const circles = representation.flags.aromaticCircles
    ? aromaticCirclePrimitives(mol, style, centres)
    : EMPTY_CIRCLES;

  // The bond corridors, kept as the descriptor pass sees them: one segment
  // per bond whatever shape actually drew it, so a wedge and a hash ladder
  // fence off the same space a plain line would.
  const corridors = new Map<BondId, DescriptorSegment>();

  for (const bondId of mol.bondIds) {
    pushBondPrimitives(
      primitives,
      mol,
      style,
      bondId,
      centres,
      placements,
      circles.suppressedBondIds,
      representation,
      corridors,
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

    // Lone pairs come back as a flat list of two dots per pair, in pair
    // order, so the id carries both indices — a pair and a radical on the
    // same atom must not be able to name the same primitive.
    placement.lonePairs.forEach((placedDot, index) => {
      const lonePairDot: CirclePrimitive = {
        id: lonePairDotId(atomId, Math.floor(index / 2), index % 2),
        source: { kind: "atom", atomId },
        type: "circle",
        centre: placedDot.centre,
        radius: placedDot.radius,
        fill: { color: style.colors.label },
      };
      primitives.push(lonePairDot);
    });

    // The Lewis view's charge, which left the glyph run so it could take a
    // free direction instead of the top-right corner a lone pair is in.
    const charge = placement.detachedCharge;
    if (charge !== undefined) {
      const chargeRun: TextRunPrimitive = {
        id: detachedChargeId(atomId),
        source: { kind: "atom", atomId },
        type: "textRun",
        origin: charge.origin,
        spans: charge.spans,
        fontFamily: style.fontFamily,
        fontSizePx: charge.fontSizePx,
        fill: { color: style.colors.label },
        anchor: charge.anchor,
      };
      primitives.push(chargeRun);
    }
  }

  pushHydrogenPrimitives(primitives, mol, style, representation, centres, placements);

  if (representation.flags.showStereoDescriptors) {
    pushDescriptorPrimitives(primitives, mol, style, centres, placements, corridors);
  }

  return primitives;
}

/**
 * The fully-explicit view's derived hydrogens: a stem and an "H" apiece.
 *
 * AFTER the atoms, so a hydrogen paints over the bond lines that reach its
 * host, and in the molecule's own insertion order for the same determinism
 * reason everything else here follows it.
 *
 * The stem goes through `bondAxis`, exactly as a real bond does, so it is
 * trimmed against the host's label at one end and the hydrogen's own glyph at
 * the other by the same ray-exit rule. Reimplementing the trim here would be
 * a second clearance constant, and the symptom — a stem ending inside the "H"
 * — is only visible at one preset.
 *
 * A STEM CANNOT TRIM TO NOTHING, unlike a real bond between two crowded
 * labels. `phantomHydrogens` has already stood the hydrogen far enough off its
 * host for the two trims to leave its minimum stem between them (see
 * `style.explicitHydrogenMinStemRatio`), using these very placements, so `bondAxis` always returns an axis
 * here. The `undefined` branch is the type's, not a case: dropping it would
 * mean asserting non-null on a function that is honestly allowed to return
 * one.
 */
function pushHydrogenPrimitives(
  primitives: ScenePrimitive[],
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
  centres: ReadonlyMap<AtomId, ScenePoint>,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
): void {
  for (const hydrogen of phantomHydrogens(mol, style, representation, placements)) {
    const hostCentre = centres.get(hydrogen.hostAtomId);
    if (hostCentre === undefined) continue;
    const id = phantomHydrogenId(hydrogen.hostAtomId, hydrogen.index);
    const source = {
      kind: "hydrogen",
      hostAtomId: hydrogen.hostAtomId,
      index: hydrogen.index,
    } as const;

    const axis = bondAxis(
      hostCentre,
      hydrogen.centre,
      placements.get(hydrogen.hostAtomId),
      hydrogen.placement,
      style.bondLineWidthPx,
    );
    if (axis !== undefined) {
      const stem: LinePrimitive = {
        id: `${id}:line`,
        source,
        type: "line",
        a: axis.a,
        b: axis.b,
        stroke: { color: style.colors.bond, width: style.bondLineWidthPx },
      };
      primitives.push(stem);
    }

    const run: TextRunPrimitive = {
      id: `${id}:label`,
      source,
      type: "textRun",
      origin: hydrogen.placement.run.origin,
      spans: hydrogen.placement.run.spans,
      fontFamily: style.fontFamily,
      fontSizePx: hydrogen.placement.run.fontSizePx,
      fill: { color: style.colors.label },
      anchor: hydrogen.placement.run.anchor,
    };
    primitives.push(run);
  }
}

/**
 * The `(R)`, `(S)`, `(E)` and `(Z)` runs, in the molecule's own order: atoms
 * first, then bonds.
 *
 * ONLY WHERE CHEM-CORE PROVED ONE. `cipDescriptor` returns `undetermined` for
 * a centre whose ranking it could not resolve and for one nobody drew a wedge
 * on, and `descriptorText` renders that as nothing at all rather than as a
 * "(?)" — a question mark beside a centre reads as a wavy bond, which is a
 * chemical claim, not a note about the software.
 *
 * Each placed descriptor becomes an obstacle for the next, so two centres a
 * bond apart cannot both take the space between them. That makes the result
 * order-dependent, which is why the order is the molecule's insertion order
 * and not a sort.
 */
function pushDescriptorPrimitives(
  primitives: ScenePrimitive[],
  mol: Molecule,
  style: RenderStyle,
  centres: ReadonlyMap<AtomId, ScenePoint>,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
  corridors: ReadonlyMap<BondId, DescriptorSegment>,
): void {
  const obstacles: LabelObstacle[] = [];
  for (const atomId of mol.atomIds) {
    const placement = placements.get(atomId);
    if (placement !== undefined) obstacles.push(...placement.obstacles);
  }
  const segments = [...corridors.values()];

  const emit = (
    id: string,
    source: ScenePrimitive["source"],
    text: string,
    anchor: ScenePoint,
    preferred: ScenePoint,
  ): void => {
    const placed = placeDescriptor({
      text,
      anchor,
      preferred,
      style,
      obstacles,
      segments,
    });
    // Every descriptor blocks the next one, itself included in the union the
    // following call queries.
    obstacles.push({ kind: "rect", box: placed.box });
    const run: TextRunPrimitive = {
      id,
      source,
      type: "textRun",
      origin: placed.origin,
      spans: [{ text }],
      fontFamily: style.fontFamily,
      fontSizePx: placed.fontSizePx,
      fill: { color: style.colors.label },
      anchor: "middle",
    };
    primitives.push(run);
  };

  for (const atomId of mol.atomIds) {
    const centre = centres.get(atomId);
    if (centre === undefined) continue;
    const text = descriptorText(cipDescriptor(mol, atomId));
    if (text === undefined) continue;
    const placement = placements.get(atomId);
    // The label pass already worked out the emptiest direction around this
    // atom; a bare vertex has no placement, so it is asked for directly.
    const preferred =
      placement?.freeDirection ??
      freeDirection(
        centre,
        neighborIds(mol, atomId).flatMap((id) => {
          const point = centres.get(id);
          return point === undefined ? [] : [point];
        }),
      );
    emit(
      `atom:${atomId}:descriptor`,
      { kind: "atom", atomId },
      text,
      centre,
      preferred,
    );
  }

  for (const bondId of mol.bondIds) {
    const text = descriptorText(doubleBondDescriptor(mol, bondId));
    if (text === undefined) continue;
    const corridor = corridors.get(bondId);
    if (corridor === undefined) continue;
    const midpoint: ScenePoint = {
      x: (corridor.a.x + corridor.b.x) / 2,
      y: (corridor.a.y + corridor.b.y) / 2,
    };
    const dx = corridor.b.x - corridor.a.x;
    const dy = corridor.b.y - corridor.a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    // Perpendicular to the bond, which is the only direction with room beside
    // a double bond. The ladder tries the other side next.
    const preferred: ScenePoint =
      length === 0 ? { x: 0, y: -1 } : { x: dy / length, y: -dx / length };
    emit(
      `bond:${bondId}:descriptor`,
      { kind: "bond", bondId },
      text,
      midpoint,
      preferred,
    );
  }
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
  representation: StructuralRepresentation,
  corridors: Map<BondId, DescriptorSegment>,
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
  corridors.set(bondId, { a: axis.a, b: axis.b });

  const stroke = { color: style.colors.bond, width: style.bondLineWidthPx };
  const line = (
    suffix: string,
    ends: { a: ScenePoint; b: ScenePoint } | undefined,
  ): void => {
    // `undefined` is a parallel copy that its own trimming left with nothing:
    // the axis cleared both labels but this line, running a gap to one side,
    // did not. Drawing the stub anyway would put a dash inside a glyph, which
    // is the exact failure trimming exists to prevent — and a single-looking
    // double bond at least matches what a reader can see is crowded. The bond
    // losing EVERY line is reported as `bond-swallowed-by-labels`.
    if (ends === undefined) return;
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
  // The same floor the axis was held to: below its own stroke width a line is
  // a blob, not a segment.
  const minimum = style.bondLineWidthPx;

  // STEREO FIRST, before order and before the aromatic circle. A wedge is not
  // a decoration on top of a line, it REPLACES the line: drawing both leaves a
  // hairline down the middle of the triangle, and on a hash ladder it turns
  // the rungs into a fishbone.
  //
  // Only where the mark means something. wedge/hash/wavy describe a SINGLE
  // bond and `either` a DOUBLE one (types.ts), so a wedge stored on a double
  // bond — which an importer can hand you — draws as an ordinary double rather
  // than as a triangle asserting a configuration nobody can read off it.
  if (representation.flags.showStereoBonds) {
    if (bond.order === 1 && bond.stereo === "wedge") {
      const wedge: PolygonPrimitive = {
        id: `bond:${bondId}:wedge`,
        source: { kind: "bond", bondId },
        type: "polygon",
        points: wedgePoints(axis, style.stereoWedgeWidthPx),
        fill: { color: style.colors.bond },
      };
      primitives.push(wedge);
      return;
    }
    if (bond.order === 1 && bond.stereo === "hash") {
      const hash: PathPrimitive = {
        id: `bond:${bondId}:hash`,
        source: { kind: "bond", bondId },
        type: "path",
        d: hashPathData(
          axis,
          style.stereoWedgeWidthPx,
          style.stereoHashPeriodPx,
          style.coordinatePrecision,
          `bond:${bondId}:hash`,
        ),
        stroke,
      };
      primitives.push(hash);
      return;
    }
    if (bond.order === 1 && bond.stereo === "wavy") {
      const wavy: PathPrimitive = {
        id: `bond:${bondId}:wavy`,
        source: { kind: "bond", bondId },
        type: "path",
        d: wavyPathData(
          axis,
          style.stereoWavyPeriodPx,
          style.coordinatePrecision,
          `bond:${bondId}:wavy`,
        ),
        stroke,
      };
      primitives.push(wavy);
      return;
    }
    if (bond.order === 2 && bond.stereo === "either") {
      // The crossed pair speaks for the whole bond, aromatic circle or not:
      // a ring bond whose geometry was never determined is not a ring bond
      // anyone should be drawing a delocalisation circle over.
      const cross = crossedDouble(axis, gap, minimum);
      if (cross !== undefined) {
        line("cross", cross.first);
        line("cross2", cross.second);
      }
      return;
    }
  }

  // A TRIPLE BOND IS ALWAYS CENTRED, and its outer pair sits a FULL gap out,
  // not half of one: a centred double's two lines are a gap apart, so half a
  // gap here would make every alkyne read as a slightly thick double bond.
  if (bond.order === 3) {
    const normal = leftNormal(axis.unit);
    line("line", offsetSegment(axis, normal, 0, 0, 0, minimum));
    line("line2", offsetSegment(axis, normal, gap, 0, 0, minimum));
    line("line3", offsetSegment(axis, normal, -gap, 0, 0, minimum));
    return;
  }

  if (bond.order !== 2 || suppressedBondIds.has(bondId)) {
    line("line", { a: axis.a, b: axis.b });
    return;
  }

  const resolution = resolveDoubleBondSide(mol, bondId);
  if (resolution.kind === "centered") {
    const normal = leftNormal(axis.unit);
    // Both lines symmetric about the axis, which is how a centred double bond
    // is drawn. There is deliberately NO line on the axis itself;
    // `bond:<id>:line` is the first line drawn, not the centreline.
    //
    // They are NOT necessarily the same length. Each is trimmed against the
    // labels it actually runs into, so at a diagonal "OH" the two stop on the
    // box outline at different distances — which is the label's shape showing
    // through, not an asymmetry bug.
    line("line", offsetSegment(axis, normal, gap / 2, 0, 0, minimum));
    line("line2", offsetSegment(axis, normal, -gap / 2, 0, 0, minimum));
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
      minimum,
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
 * TWO DIFFERENT WALKS OF THE MOLECULE, not one shared placeholder any more.
 * `formulaParts` sums the atoms and orders the totals by Hill — "C2H6O" — and
 * `condensedParts` walks the graph — "CH3CH2OH". Ethanol and dimethyl ether
 * are the same sum formula and different condensed ones, which is the whole
 * reason the second view exists.
 *
 * A cyclic molecule has no condensed spelling, and `condensedParts` throws
 * rather than invent one. It cannot throw HERE, because
 * `representationAvailability` is what a panel consults before asking for the
 * scene at all — but the fallback to the sum formula is kept anyway, because
 * a scene builder that throws blanks a canvas and a caller that skipped the
 * availability check deserves a true formula rather than an exception.
 *
 * The run belongs to no atom or bond, hence a `decoration` source: a click on
 * "C6H6" selects nothing, which is the correct behaviour for a text view.
 */
function buildFormulaRun(
  mol: Molecule,
  style: RenderStyle,
  kind: TextViewKind,
): TextRunPrimitive {
  const parts: readonly FormulaPart[] =
    kind === "condensed" && canCondense(mol) ? condensedParts(mol) : formulaParts(mol);
  const spans: TextSpan[] = parts.map((part) => {
    if (part.kind === "count") return { text: part.text, script: "sub" };
    // U+2212 MINUS SIGN, not the ASCII hyphen `formulaParts` produces. That
    // divergence is deliberate on chem-core's side — it is producing plain
    // text a user pastes elsewhere — and this is the drawing, where a hyphen
    // beside a superscript reads as a bond. `compose.ts` makes the same
    // substitution for an atom label's charge, for the same reason.
    if (part.kind === "charge") {
      return { text: part.text.replace("-", "\u2212"), script: "super" };
    }
    return { text: part.text };
  });

  // Centred both ways on the scene origin: a text view has no molecular
  // geometry to anchor to, and the margin in `sceneBounds` gives it its box.
  // Vertical centring is done here, as a baseline y measured from the run's
  // own ink band (scripts included), because the primitive has no baseline
  // mode to ask a renderer for it — see `TextRunPrimitive`.
  const centred = measureTextRun(
    spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx: style.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: "middle",
      baseline: "middle",
    },
    measurerFor(style),
  );

  return {
    id: `text:${kind}:formula`,
    source: { kind: "decoration" },
    type: "textRun",
    origin: { x: 0, y: centred.baselineYPx },
    spans,
    fontFamily: style.fontFamily,
    fontSizePx: style.fontSizePx,
    fill: { color: style.colors.label },
    anchor: "middle",
  };
}
