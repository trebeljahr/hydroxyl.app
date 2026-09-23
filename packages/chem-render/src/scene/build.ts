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
  hashBars,
  hashPathData,
  STEREO_MARKS,
  wavyPathData,
  wedgePoints,
} from "../bond/stereo.js";
import {
  canonicalFreeDirection,
  EMPTY_ANNOTATION_LAYOUT,
  placeAnnotations,
} from "../label/annotations.js";
import type {
  AnnotationAtomCentre,
  AnnotationBondSegment,
  AnnotationCircle,
  AnnotationLayout,
  AnnotationObstacleSet,
  AnnotationRequest,
  AnnotationSegment,
} from "../label/annotations.js";
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
import type { PhantomHydrogen } from "../modes/explicitH.js";
import { placeAtomLabel } from "../label/placement.js";
import type {
  AtomLabelPlacement,
  LabelBox,
  LabelObstacle,
  PlacedTextRun,
} from "../label/placement.js";
import { isStructural } from "../representation.js";
import type {
  Representation,
  StructuralRepresentation,
  TextViewKind,
} from "../representation.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";
import { glyphInkRects, measurerFor, measureTextRun, textRunRect } from "../text/measurer.js";
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
 * `showStereoDescriptors` and `showLocants` add a final ANNOTATION pass
 * (`label/annotations.ts`): `(R)`/`(S)`/`(E)`/`(Z)` runs and locants, placed
 * together in decision 17's priority order. It is LAST because it has to see
 * everything else first: an annotation looks for the hole nothing else wanted.
 *
 * `options` carries what the molecule itself does not: today, the locants.
 * Omitting it changes nothing about any scene built before it existed.
 */
export function buildScene(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
  options?: SceneBuildOptions,
): RenderScene {
  return buildAnnotatedScene(mol, style, representation, options).scene;
}

/** A scene and the annotation report of the SAME build. */
export interface AnnotatedScene {
  readonly scene: RenderScene;
  /** `EMPTY_ANNOTATION_LAYOUT` for a text view, or when nothing is annotated. */
  readonly annotations: AnnotationLayout;
}

/**
 * `buildScene`, plus the annotation pass's report from the very same build.
 *
 * For a caller that draws the scene AND tells the user what could not be
 * placed (the editor's status bar, decision 62): one placement run, so the
 * report cannot disagree with the picture and nothing is placed twice.
 */
export function buildAnnotatedScene(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
  options?: SceneBuildOptions,
): AnnotatedScene {
  const built = isStructural(representation)
    ? buildStructural(mol, style, representation, options)
    : { primitives: [buildFormulaRun(mol, style, representation.kind)], annotations: EMPTY_ANNOTATION_LAYOUT };
  const { primitives } = built;
  return {
    scene: {
      primitives,
      bounds: sceneBounds(primitives, style),
      style,
      representation,
    },
    annotations: built.annotations,
  };
}

/**
 * Inputs to a scene that do not live on the molecule.
 *
 * INJECTED rather than read from anywhere, so every existing call site stays
 * untouched and chem-render keeps its one dependency. The document-level
 * numbering map a later task adds is what a caller will pass here.
 */
export interface SceneBuildOptions {
  /**
   * Each atom's CHEMICAL locant: "1", "4a", "3′". Drawn only while
   * `flags.showLocants` is on.
   *
   * An atom the record or callback has no string for gets NOTHING — never its
   * id, never its position in `atomIds` (decision 18). An empty string also
   * draws nothing. A record is read with `Object.hasOwn`, so an atom id of
   * "constructor" cannot resolve up the prototype chain.
   */
  readonly locants?:
    | Readonly<Record<AtomId, string>>
    | ((atomId: AtomId) => string | undefined);
}

/**
 * The annotation pass's REPORT for a scene: every placement, and the ones that
 * could not be placed clear.
 *
 * A free function rather than a field on `RenderScene`, for the reason
 * `detectCollisions` is one (see scene/collide.ts): a report hanging off the
 * scene is paid for inside every drag-loop build and is a field somebody
 * eventually serialises. It rebuilds the structural scene to get the same
 * obstacles the drawing used, so its placements are the scene's exactly, and
 * `drawn` says which of them the scene emits (decision 58).
 */
export function annotationLayout(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
  options?: SceneBuildOptions,
): AnnotationLayout {
  if (!isStructural(representation)) return EMPTY_ANNOTATION_LAYOUT;
  return buildStructural(mol, style, representation, options).annotations;
}

/**
 * The obstacles and glyph ink the annotation pass searched, for a scene with
 * something to annotate; undefined otherwise. Diagnostic, like
 * `annotationLayout`: it rebuilds the structural scene.
 */
export function annotationObstacles(
  mol: Molecule,
  style: RenderStyle,
  representation: Representation,
  options?: SceneBuildOptions,
): AnnotationObstacleSet | undefined {
  if (!isStructural(representation)) return undefined;
  return buildStructural(mol, style, representation, options).context;
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
  options: SceneBuildOptions | undefined,
): {
  readonly primitives: readonly ScenePrimitive[];
  readonly annotations: AnnotationLayout;
  readonly context?: AnnotationObstacleSet;
} {
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

  // The bond corridors: one segment per bond whatever shape actually drew
  // it, which is where a bond annotation anchors and what it must not cross.
  const corridors = new Map<BondId, AnnotationSegment>();
  // Everything bonds and hydrogen stems actually DREW, as segments: both lines
  // of a double bond, a wedge's outline, a hash ladder's bars and rails. The
  // corridor alone lets a locant graze the second line of a ring bond.
  const drawn: AnnotationSegment[] = [];

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
      drawn,
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

  const hydrogens = phantomHydrogens(mol, style, representation, placements);
  pushHydrogenPrimitives(primitives, style, hydrogens, centres, placements, drawn);

  const requests = annotationRequests(mol, representation, centres, corridors, options);
  if (requests.length === 0) {
    return { primitives, annotations: EMPTY_ANNOTATION_LAYOUT };
  }

  const obstacles: LabelObstacle[] = [];
  // Decisions 55 and 58: the unpadded INK of every label glyph and electron
  // dot, one box each — what an unclear annotation's overprint is measured
  // against, and what decides whether it is drawn at all. `obstacles` are
  // clearance boxes and name one glyph several times.
  const glyphInk: LabelBox[] = [];
  const atomCentres: AnnotationAtomCentre[] = [];
  for (const atomId of mol.atomIds) {
    const centre = centres.get(atomId);
    if (centre !== undefined) atomCentres.push({ atomId, centre });
    const placement = placements.get(atomId);
    if (placement !== undefined) {
      obstacles.push(...placement.obstacles);
      obstacles.push(...glyphBandObstacles(placement.run, style));
      glyphInk.push(...runGlyphInk(placement.run, style));
      for (const dot of placement.dots) glyphInk.push(discInk(dot.centre, dot.radius));
      for (const dot of placement.lonePairs) glyphInk.push(discInk(dot.centre, dot.radius));
      if (placement.detachedCharge !== undefined) {
        obstacles.push(...glyphBandObstacles(placement.detachedCharge, style));
        glyphInk.push(...runGlyphInk(placement.detachedCharge, style));
      }
    } else if (style.atomDotRadiusPx > 0 && centre !== undefined) {
      // Decision 61: a bare-vertex dot stops a slot counting as clear, but it
      // is not glyph ink — crossing one is "crowded", never a drop — while
      // radical and lone-pair dots above are glyph ink.
      obstacles.push({ kind: "disc", centre, radius: style.atomDotRadiusPx });
    }
  }
  for (const hydrogen of hydrogens) {
    obstacles.push(...hydrogen.placement.obstacles);
    obstacles.push(...glyphBandObstacles(hydrogen.placement.run, style));
    glyphInk.push(...runGlyphInk(hydrogen.placement.run, style));
  }
  // Decision 65: a FILLED shape is ink like a glyph — a solid wedge is a
  // black triangle, and a locant printed inside one is as unreadable as one
  // printed on a letter. Taken from the primitives already emitted, so a
  // filled shape added later is covered without a second rule. A hashed
  // wedge and every plain line stay lines (their strokes are in `drawn`),
  // and the filled dots are added above, each for its own reason
  // (decision 61).
  for (const primitive of primitives) {
    if (primitive.type !== "polygon" || primitive.fill === undefined) continue;
    glyphInk.push(...filledShapeInk(primitive.points));
  }

  const circleOutlines: AnnotationCircle[] = circles.primitives.map((circle) => ({
    centre: circle.centre,
    radius: circle.radius,
    halfWidth: (circle.stroke?.width ?? 0) / 2,
  }));

  // EVERY kind searches the full set (decision 34): label glyphs, bare-vertex
  // dots, derived hydrogens, every drawn line and outline, and the circles.
  // Decision 68: every bond as drawn, so a bond annotation competes against
  // the other bonds and not against its own two atoms.
  const bondSegments: AnnotationBondSegment[] = [];
  for (const [bondId, corridor] of corridors) {
    bondSegments.push({ bondId, a: corridor.a, b: corridor.b });
  }
  const context: AnnotationObstacleSet = {
    obstacles,
    segments: [...corridors.values(), ...drawn],
    circles: circleOutlines,
    glyphInk,
  };
  const annotations = placeAnnotations(requests, {
    ...context,
    style,
    atomCentres,
    bondSegments,
  });

  // Emitted in PLACEMENT order — priority, then source id — so the scene's
  // order is the same function of the molecule the placements are.
  for (const placed of annotations.placements) {
    // Reported and printing on text (decision 58): listed, not drawn.
    if (!placed.drawn) continue;
    const run: TextRunPrimitive = {
      id: placed.id,
      source: placed.source,
      type: "textRun",
      origin: placed.origin,
      spans: [{ text: placed.text }],
      fontFamily: style.fontFamily,
      fontSizePx: placed.fontSizePx,
      fill: { color: style.colors.label },
      // `origin` is already the alphabetic baseline (decision 53): no
      // baseline mode travels with the run.
      anchor: "middle",
    };
    primitives.push(run);
  }

  return { primitives, annotations, context };
}

/**
 * One rect per span of a drawn label run, each its span's FULL ascent-to-
 * descent band at its own size and script shift.
 *
 * For the annotation pass only, on top of the label's own obstacles. Those are
 * cap-band boxes, tight on purpose: a bond is trimmed against them and should
 * reach as near the glyph as its ink allows. An annotation is a second run of
 * text set beside the first, and two runs whose line bands meet read as one
 * crowded line even where no stroke touches; the close ladder steps near
 * enough to find exactly that spot.
 */
function glyphBandObstacles(run: PlacedTextRun, style: RenderStyle): LabelObstacle[] {
  const measurer = measurerFor(style);
  const options = {
    fontFamily: style.fontFamily,
    fontSizePx: run.fontSizePx,
    subscriptScale: style.subscriptScale,
  };
  const whole = measureTextRun(
    run.spans,
    // A placed run's origin is always its alphabetic baseline (decision 53).
    { ...options, anchor: run.anchor, baseline: "alphabetic" },
    measurer,
  );
  const baseline = { x: run.origin.x + whole.startXPx, y: run.origin.y + whole.baselineYPx };
  return whole.spans.flatMap((measured): LabelObstacle[] => {
    if (measured.span.text.length === 0) return [];
    const alone = measureTextRun(
      [measured.span],
      { ...options, anchor: "start", baseline: "alphabetic" },
      measurer,
    );
    return [
      {
        kind: "rect",
        box: textRunRect(alone, { x: baseline.x + measured.startXPx, y: baseline.y }),
      },
    ];
  });
}

/** One unpadded ink box per drawn glyph of a placed run (decision 55). */
function runGlyphInk(run: PlacedTextRun, style: RenderStyle): LabelBox[] {
  const measurer = measurerFor(style);
  const measured = measureTextRun(
    run.spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx: run.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: run.anchor,
      baseline: "alphabetic",
    },
    measurer,
  );
  return glyphInkRects(measured, run.origin, measurer, style.fontFamily);
}

/**
 * A filled polygon's ink, as boxes: `FILLED_SHAPE_SLICES` slabs across its
 * longer side, each bounding only the part of the shape inside that slab.
 *
 * A single bounding box would be far too coarse for the shape this exists
 * for: a wedge is a thin triangle whose box is nearly twice its ink and
 * mostly empty page beside the narrow end, and an annotation there would be
 * dropped for touching nothing. Slabs follow the taper closely enough that
 * the error is a fraction of a slab, and for a convex shape (every filled
 * shape this package draws) the bound is exact at each slab's edges: the
 * extremes over a slab lie on the boundary, which is what is sampled.
 */
const FILLED_SHAPE_SLICES = 8;

function filledShapeInk(points: readonly ScenePoint[]): LabelBox[] {
  if (points.length < 3) return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const alongX = maxX - minX >= maxY - minY;
  const low = alongX ? minX : minY;
  const high = alongX ? maxX : maxY;
  const span = high - low;
  if (!(span > 0)) return [{ minX, minY, maxX, maxY }];
  const step = span / FILLED_SHAPE_SLICES;
  const boxes: LabelBox[] = [];
  for (let slice = 0; slice < FILLED_SHAPE_SLICES; slice++) {
    const from = low + slice * step;
    const to = slice === FILLED_SHAPE_SLICES - 1 ? high : from + step;
    // Every boundary point inside the slab: the vertices in it, and where
    // each edge crosses its two ends.
    let boxMinX = Number.POSITIVE_INFINITY;
    let boxMinY = Number.POSITIVE_INFINITY;
    let boxMaxX = Number.NEGATIVE_INFINITY;
    let boxMaxY = Number.NEGATIVE_INFINITY;
    const add = (point: ScenePoint): void => {
      if (point.x < boxMinX) boxMinX = point.x;
      if (point.y < boxMinY) boxMinY = point.y;
      if (point.x > boxMaxX) boxMaxX = point.x;
      if (point.y > boxMaxY) boxMaxY = point.y;
    };
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const aAt = alongX ? a.x : a.y;
      const bAt = alongX ? b.x : b.y;
      if (aAt >= from && aAt <= to) add(a);
      for (const edge of [from, to]) {
        // The edge crosses this slab boundary: interpolate the crossing.
        if ((aAt < edge && bAt > edge) || (aAt > edge && bAt < edge)) {
          const t = (edge - aAt) / (bAt - aAt);
          add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
    }
    if (boxMinX <= boxMaxX && boxMinY <= boxMaxY) {
      boxes.push({ minX: boxMinX, minY: boxMinY, maxX: boxMaxX, maxY: boxMaxY });
    }
  }
  return boxes;
}

/** A dot's ink box: the square its disc fills. */
function discInk(centre: ScenePoint, radius: number): LabelBox {
  return {
    minX: centre.x - radius,
    minY: centre.y - radius,
    maxX: centre.x + radius,
    maxY: centre.y + radius,
  };
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
  style: RenderStyle,
  hydrogens: readonly PhantomHydrogen[],
  centres: ReadonlyMap<AtomId, ScenePoint>,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
  drawn: AnnotationSegment[],
): void {
  for (const hydrogen of hydrogens) {
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
      drawn.push({ a: axis.a, b: axis.b, halfWidth: style.bondLineWidthPx / 2 });
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
 * Every annotation the representation asks for, as requests — unordered.
 *
 * `placeAnnotations` sorts them (decision 17), so the order built here decides
 * nothing; it is atoms then bonds only because that reads naturally.
 *
 * DESCRIPTORS ONLY WHERE CHEM-CORE PROVED ONE. `cipDescriptor` returns
 * `undetermined` for a centre whose ranking it could not resolve and for one
 * nobody drew a wedge on, and `descriptorText` renders that as nothing at all
 * rather than as a "(?)" — a question mark beside a centre reads as a wavy
 * bond, which is a chemical claim, not a note about the software.
 *
 * LOCANTS ONLY WHERE THE CALLER SUPPLIED ONE (decision 18). Walked over
 * `mol.atomIds`, never over the keys of the supplied record, so a locant for
 * an atom that no longer exists is silently not drawn; and an atom with no
 * locant gets nothing — no fallback to its id or its index.
 *
 * alphaBeta and torsion have no producer yet; the pass accepts them.
 */
function annotationRequests(
  mol: Molecule,
  representation: StructuralRepresentation,
  centres: ReadonlyMap<AtomId, ScenePoint>,
  corridors: ReadonlyMap<BondId, AnnotationSegment>,
  options: SceneBuildOptions | undefined,
): AnnotationRequest[] {
  const requests: AnnotationRequest[] = [];
  const descriptors = representation.flags.showStereoDescriptors;
  const locants = representation.flags.showLocants ? options?.locants : undefined;
  if (!descriptors && locants === undefined) return requests;

  for (const atomId of mol.atomIds) {
    const centre = centres.get(atomId);
    if (centre === undefined) continue;
    const source = { kind: "atom", atomId } as const;
    let preferred: ScenePoint | undefined;
    const preferredDirection = (): ScenePoint =>
      (preferred ??= atomAnnotationDirection(mol, atomId, centre, centres));

    if (descriptors) {
      const text = descriptorText(cipDescriptor(mol, atomId));
      if (text !== undefined) {
        requests.push({
          kind: "descriptor",
          source,
          text,
          anchor: centre,
          preferred: preferredDirection(),
        });
      }
    }

    if (locants !== undefined) {
      const text = locantOf(locants, atomId);
      if (text !== undefined) {
        requests.push({
          kind: "locant",
          source,
          text,
          anchor: centre,
          preferred: preferredDirection(),
        });
      }
    }
  }

  if (descriptors) {
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
      const bond = mol.bonds[bondId];
      requests.push({
        kind: "descriptor",
        source: { kind: "bond", bondId },
        text,
        anchor: midpoint,
        preferred,
        anchorSegment: corridor,
        // Decision 68: its own two atoms never compete with it.
        ...(bond === undefined ? {} : { ownAtomIds: [bond.from, bond.to] }),
      });
    }
  }

  return requests;
}

/**
 * The locant text for `atomId`, or undefined for "draw nothing".
 *
 * `Object.hasOwn` on a record, because the ids are data: `locants.constructor`
 * is a function on every plain object, and "constructor" is a legal atom id in
 * an imported file.
 */
function locantOf(
  locants: NonNullable<SceneBuildOptions["locants"]>,
  atomId: AtomId,
): string | undefined {
  const text =
    typeof locants === "function"
      ? locants(atomId)
      : Object.hasOwn(locants, atomId)
        ? locants[atomId]
        : undefined;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

/**
 * The direction that ranks an atom annotation's candidates: the atom's free
 * direction with its neighbours in canonical order (`canonicalFreeDirection`),
 * not the one stored on `AtomLabelPlacement`, which sums them in bond
 * insertion order. The centres are already scene px, so nothing here flips.
 */
function atomAnnotationDirection(
  mol: Molecule,
  atomId: AtomId,
  centre: ScenePoint,
  centres: ReadonlyMap<AtomId, ScenePoint>,
): ScenePoint {
  const neighbours = neighborIds(mol, atomId).flatMap((id) => {
    const point = centres.get(id);
    return point === undefined ? [] : [point];
  });
  return canonicalFreeDirection(centre, neighbours);
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
  corridors: Map<BondId, AnnotationSegment>,
  drawn: AnnotationSegment[],
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
  // Every segment below is inked at the bond stroke, except a wedge's
  // outline, which is a filled edge with no stroke of its own.
  const halfWidth = style.bondLineWidthPx / 2;
  corridors.set(bondId, { a: axis.a, b: axis.b, halfWidth });

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
    drawn.push({ a: ends.a, b: ends.b, halfWidth });
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
      const points = wedgePoints(axis, style.stereoWedgeWidthPx);
      const wedge: PolygonPrimitive = {
        id: `bond:${bondId}:wedge`,
        source: { kind: "bond", bondId },
        type: "polygon",
        points,
        fill: { color: style.colors.bond },
      };
      primitives.push(wedge);
      pushOutline(drawn, points);
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
      const bars = hashBars(axis, style.stereoWedgeWidthPx, style.stereoHashPeriodPx);
      for (const bar of bars) drawn.push({ a: bar.a, b: bar.b, halfWidth });
      const firstBar = bars[0];
      const lastBar = bars[bars.length - 1];
      if (firstBar !== undefined && lastBar !== undefined) {
        drawn.push(
          { a: firstBar.a, b: lastBar.a, halfWidth },
          { a: firstBar.b, b: lastBar.b, halfWidth },
        );
      }
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
      // The wave's envelope: two rails at its amplitude either side of the
      // axis (already in the corridors). A box that clears all three cannot
      // reach the curve between them.
      const amplitude = style.stereoWavyPeriodPx * STEREO_MARKS.wavyAmplitudeRatio;
      const normal = leftNormal(axis.unit);
      for (const side of [amplitude, -amplitude]) {
        drawn.push({
          a: { x: axis.a.x + normal.x * side, y: axis.a.y + normal.y * side },
          b: { x: axis.b.x + normal.x * side, y: axis.b.y + normal.y * side },
          halfWidth,
        });
      }
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

/** A closed polygon's edges, as segments. */
function pushOutline(drawn: AnnotationSegment[], points: readonly ScenePoint[]): void {
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a !== undefined && b !== undefined) drawn.push({ a, b });
  }
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
