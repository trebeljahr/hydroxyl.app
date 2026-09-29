/**
 * Where an atom label's glyphs, dots and clear space actually sit.
 *
 * INPUTS ARE SCENE PX WITH Y ALREADY FLIPPED. `centre` is
 * `modelToPx(style, atom.pos)` and each `neighbourCentres[i]` is
 * `modelToPx(style, neighbour.pos)`, both computed by `scene/build.ts`, which
 * is already the only caller of `modelToPx`. Differencing two points that have
 * both been through that conversion is neither a scale nor a flip, so the bond
 * directions derived here are correctly y-down with no negation anywhere in
 * this file — and there must never be one. Every direction, every offset and
 * every box below lives in that one space.
 *
 * The trap this arrangement exists to close: taking bond directions from the
 * MODEL (y-up) and then placing the label in scene px. Hydrogens end up on the
 * wrong side vertically, every horizontal fixture still looks perfect, and no
 * test fails except one mirrored in y. Hence `AtomLabelInput` admits only
 * `ScenePoint`, and this module imports neither `modelToPx` nor `Vec2` nor any
 * chem-core vector helper.
 *
 * "north" in this file therefore means scene −y — visually UP on the page —
 * which is the opposite of what north would mean in chem-core's y-up space.
 *
 * NO `Math.atan2` AND NO `Math.hypot`. ECMAScript leaves both
 * implementation-approximated, so a sort key or a length derived from either
 * can in principle order two candidates differently on another engine. These
 * bytes get committed and diffed. Ordering here is done with half-plane tests
 * and cross products, and lengths with `Math.sqrt(x*x + y*y)`. (chem-core's
 * own vector helpers use `Math.hypot`; that is pre-existing, is not on this
 * path, and is not being "fixed" from here.)
 */

import type { AtomId, ElementSymbol } from "@starter/chem-core";

import type { ScenePoint, TextSpan } from "../scene/types.js";
import type { RenderStyle } from "../style.js";
import { EM_CAP_HEIGHT } from "../text/metrics.js";
import { glyphInkRects, measureTextRun, measurerFor } from "../text/measurer.js";
import type { MeasuredSpan } from "../text/measurer.js";
import { labelSpans, symbolSpanIndex } from "./compose.js";
import type { ComposedLabel, LabelSide } from "./compose.js";

/**
 * An axis-aligned rectangle in scene px. `minY` is the TOP edge, because y
 * grows downward here.
 */
export interface LabelBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * One piece of the space a label occupies.
 *
 * A UNION of small shapes rather than one bounding box, because the bounding
 * box of "O" with a superscript charge and a radical dot is mostly empty air:
 * a bond arriving from below would be trimmed as though the charge were in its
 * way. Each span gets its own rect and each dot its own disc, and the trimmer
 * asks the union.
 */
export type LabelObstacle =
  | { readonly kind: "rect"; readonly box: LabelBox }
  | { readonly kind: "disc"; readonly centre: ScenePoint; readonly radius: number };

/**
 * The glyph run, ready to become a `TextRunPrimitive`.
 *
 * `anchor` is a literal type, not a free field: every box below is computed
 * for start-anchored text on an alphabetic-baseline origin and is simply wrong
 * for anything else. See `placeAtomLabel` for why.
 */
export interface PlacedTextRun {
  readonly origin: ScenePoint;
  readonly spans: readonly TextSpan[];
  readonly fontSizePx: number;
  readonly anchor: "start";
}

export interface PlacedDot {
  readonly centre: ScenePoint;
  readonly radius: number;
}

export interface AtomLabelInput {
  readonly atomId: AtomId;
  /** Scene px, y-down: `modelToPx(style, atom.pos)`. */
  readonly centre: ScenePoint;
  /** Scene px, y-down, one per bonded neighbour. Order is irrelevant. */
  readonly neighbourCentres: readonly ScenePoint[];
  /**
   * UNIT directions, scene px y-down, of the phantom hydrogens the
   * fully-explicit and Lewis views fan off this atom. Empty everywhere else.
   *
   * A DERIVED HYDROGEN IS A BOND AS FAR AS THIS FILE IS CONCERNED. It is not
   * in the graph, so it never reaches `neighbourCentres`, and the electron
   * marks below choose their slots by asking which direction the bonds leave
   * emptiest — the same question `fanDirections` asks to place the hydrogen.
   * Ask it of the same inputs and the two agree; ask it of the real bonds
   * alone and they pick the SAME direction, which put a lone pair on
   * ethanol's O–H and let `rayExit` trim the whole stem away, leaving an "H"
   * floating with no bond to it.
   *
   * Directions rather than centres because the caller has already normalised
   * them: a hydrogen's distance from its host depends on how far the host's
   * own label reaches, which is decided from THIS placement's obstacles and
   * therefore cannot be known before it exists. The direction can.
   */
  readonly derivedHydrogenDirections?: readonly ScenePoint[];
  readonly label: ComposedLabel;
  readonly style: RenderStyle;
  /**
   * The orientation, when the caller already knows it. A projection's
   * condensed group arrives spelled for the side it hangs on — "CH2OH" on a
   * Fischer's right arm, "HOH2C" on its left — and choosing a side here from
   * the bonds could put "H2OH" before a "C" that was meant to lead. Omitted,
   * the side follows the hydrogens as for any atom.
   */
  readonly side?: LabelSide;
}

export interface AtomLabelPlacement {
  readonly atomId: AtomId;
  readonly centre: ScenePoint;
  readonly run: PlacedTextRun;
  readonly dots: readonly PlacedDot[];
  /**
   * The Lewis view's lone pairs, two dots per pair. Empty everywhere else.
   *
   * Their padded discs go into `obstacles` with everything else, which is what
   * makes bond trimming clear them for free — a bond arriving at an oxygen
   * that has a pair in the way stops short of the pair, with no second rule
   * anywhere. It does mean the Lewis view's bond GEOMETRY differs from the
   * other three views', which is correct: there is more on the page.
   */
  readonly lonePairs: readonly PlacedDot[];
  /**
   * The charge, when it left the run — see `ComposedLabel.chargeDetached`.
   * Undefined for every view but Lewis, and for a Lewis atom with no charge.
   */
  readonly detachedCharge?: PlacedTextRun;
  /** Padded per-span rects and padded dot discs. A union, never one bbox. */
  readonly obstacles: readonly LabelObstacle[];
  /**
   * WHERE THE BLACK ACTUALLY IS: one box per drawn glyph and per electron dot,
   * from the vendored ink table, side bearings and all (decision 55).
   *
   * A DIFFERENT QUESTION FROM `obstacles`, not a cheaper version of it.
   * `obstacles` answers "where may a bond not go", and its answer is the cap
   * band over the ADVANCE plus `style.labelPaddingPx` of deliberate white
   * space — so two labels whose obstacles touch are correctly drawn and merely
   * close. `inkBoxes` answers "is there a glyph here", and two of THESE
   * meeting is a reader seeing one mark where the chemistry means two. At
   * Publication an "H" is 12.0 px of advance around 8.9 px of ink, so the two
   * questions differ by a third of the glyph.
   *
   * It is the same ink the annotation pass measures an overprint against, and
   * `buildScene` feeds these boxes straight into `AnnotationContext.glyphInk`
   * rather than re-measuring the run — the explicit-H separation search and
   * the annotation ladder must not disagree about where a letter is.
   */
  readonly inkBoxes: readonly LabelBox[];
  /** Bounding box of `obstacles`. Debug and quick-reject only — NOT trimming. */
  readonly clearBox: LabelBox;
  /** The padded rect of the symbol span alone. Always contains `centre`. */
  readonly symbolBox: LabelBox;
  /** undefined when the label draws no hydrogens. */
  readonly hydrogenSide: LabelSide | undefined;
  /** Unit, scene px, y-down: the emptiest direction around the atom. */
  readonly freeDirection: ScenePoint;
}

/**
 * Elements whose binary hydride is written hydrogen-first: H₂O, H₂S, HF, HCl.
 *
 * Consulted ONLY for an atom with no bonds, where there is no geometry to
 * decide from. The moment there is a bond, geometry decides and this set is
 * irrelevant — a hydroxyl hanging off a chain to the west is "HO" whatever
 * this set says about oxygen.
 *
 * The membership is the convention, not a rule derived from electronegativity:
 * chalcogens and halogens, which is where the hydride names actually fall.
 */
export const HYDROGEN_FIRST_ELEMENTS: ReadonlySet<ElementSymbol> = new Set<
  ElementSymbol
>(["O", "S", "Se", "Te", "F", "Cl", "Br", "I", "At"]);

export const LABEL_PLACEMENT = Object.freeze({
  /** Below this, two scene points are the same point and give no direction. */
  coincidentEpsilonPx: 1e-6,
  /**
   * How short the summed unit bond vector may get before the mean's DIRECTION
   * stops meaning anything. 0.15 is about 8.6 degrees from collinear for a
   * two-bond atom; inside that band the mean swings wildly for a pixel of
   * drag, and a label that changes sides mid-drag is worse than one that picks
   * a stable answer from the angular gaps instead.
   */
  degenerateMeanEpsilon: 0.15,
  /**
   * A bond within this many degrees of horizontal blocks that side for the
   * hydrogen block. Documentation- and test-facing; `horizontalBlockCos` is
   * the value actually compared.
   *
   * 25 degrees is set by the box, not by taste: a bond shallower than the
   * label box's corner angle leaves the box through the same side the
   * hydrogens are on, so the trimmed line stops beyond the H and the drawing
   * reads as though the bond were to the hydrogen. At publication size "OH" is
   * 15.0 px wide against a 6.88 px cap band, which puts the corner at about
   * 29 degrees.
   */
  horizontalBlockHalfAngleDeg: 25,
  /** cos(25°), as a literal so no `Math.cos` runs on this path. */
  horizontalBlockCos: 0.906307787036650,
  /** Radical dot radius as a fraction of the font size. */
  radicalDotRadiusEm: 0.1,
  /**
   * Floor on the dot radius, as a multiple of the bond line width. A dot finer
   * than the figure's own hairline vanishes when the SVG is downscaled into a
   * journal column — and because `radicalElectrons` feeds
   * `implicitHydrogenCount`, a vanished dot means the picture silently
   * disagrees with the formula printed beside it.
   */
  radicalDotMinStrokeFactor: 0.5,
  /**
   * Dot centre-to-centre spacing, in radii. Above two diameters on purpose:
   * closer than that and a pair of dots reads as a dash, which is a bond.
   */
  radicalDotSpacingFactor: 2.6,
});

/* ------------------------------------------------------------------ *
 * Two-line vector helpers, declared locally.
 *
 * chem-core has all of these, and importing them would be the shortest path
 * to a `Vec2` — a MODEL-space type, y-up — flowing into this file and taking
 * a model position with it. The duplication is four lines and buys a hard
 * boundary.
 * ------------------------------------------------------------------ */

function sub(a: ScenePoint, b: ScenePoint): ScenePoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: ScenePoint, b: ScenePoint): number {
  return a.x * b.x + a.y * b.y;
}

/** Length via `sqrt`, which IS exactly specified, unlike `Math.hypot`. */
function magnitude(v: ScenePoint): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function normalise(v: ScenePoint): ScenePoint {
  const length = magnitude(v);
  return { x: v.x / length, y: v.y / length };
}

function negate(v: ScenePoint): ScenePoint {
  return { x: -v.x, y: -v.y };
}

/**
 * Cross product oriented so a positive result means "b is counter-clockwise
 * from a AS DRAWN". Scene y points down, so the usual `a.x*b.y - a.y*b.x`
 * would answer for the mirrored page.
 */
function crossOnPage(a: ScenePoint, b: ScenePoint): number {
  return a.y * b.x - a.x * b.y;
}

/**
 * 0 for directions in the upper half of the page (visually 0 to 180 degrees
 * measured counter-clockwise from east), 1 for the lower half. East itself is
 * upper; west is lower. Together with `crossOnPage` this totally orders
 * directions by drawn angle using nothing but comparisons and multiplies.
 */
function angleHalf(v: ScenePoint): 0 | 1 {
  return v.y < 0 || (v.y === 0 && v.x > 0) ? 0 : 1;
}

function compareByDrawnAngle(a: ScenePoint, b: ScenePoint): number {
  const halfA = angleHalf(a);
  const halfB = angleHalf(b);
  if (halfA !== halfB) return halfA - halfB;
  const cross = crossOnPage(a, b);
  return cross > 0 ? -1 : cross < 0 ? 1 : 0;
}

const EAST: ScenePoint = Object.freeze({ x: 1, y: 0 });
const NORTH: ScenePoint = Object.freeze({ x: 0, y: -1 });

/**
 * Unit directions from `centre` towards each neighbour, in scene px.
 *
 * A neighbour sitting on top of the atom is SKIPPED rather than normalised.
 * Normalising a zero vector yields NaN, which survives every subsequent
 * arithmetic step untouched and first surfaces in the serialiser's
 * `formatNumber`, pointing nowhere near the cause.
 */
function bondDirectionsOf(
  centre: ScenePoint,
  neighbourCentres: readonly ScenePoint[],
): ScenePoint[] {
  const directions: ScenePoint[] = [];
  for (const neighbour of neighbourCentres) {
    const offset = sub(neighbour, centre);
    if (magnitude(offset) < LABEL_PLACEMENT.coincidentEpsilonPx) continue;
    directions.push(normalise(offset));
  }
  return directions;
}

/**
 * The normalised sum of the UNIT directions to each neighbour, or undefined
 * when that sum is too short to have a meaningful direction.
 *
 * Unit vectors, not raw offsets: bond lengths vary mid-drag and in imported
 * geometry, and summing raw offsets lets one long bond outvote two short ones.
 * Which side an H sits on would then depend on the drawing's scale rather than
 * on its shape.
 */
export function meanBondDirection(
  centre: ScenePoint,
  neighbourCentres: readonly ScenePoint[],
): ScenePoint | undefined {
  const directions = bondDirectionsOf(centre, neighbourCentres);
  if (directions.length === 0) return undefined;
  let sumX = 0;
  let sumY = 0;
  for (const direction of directions) {
    sumX += direction.x;
    sumY += direction.y;
  }
  const sum = { x: sumX, y: sumY };
  if (magnitude(sum) < LABEL_PLACEMENT.degenerateMeanEpsilon) return undefined;
  return normalise(sum);
}

/**
 * The bisector of the widest angular gap between the bond directions.
 *
 * A strict generalisation of "opposite the mean": for one bond the single gap
 * is the whole turn and bisects to exactly the reverse of that bond, and for a
 * 120-degree chain vertex it lands on the same direction the mean does. It
 * earns its keep only where the mean is degenerate — a linear atom, a
 * symmetric trisubstituted one — where it still returns the emptiest place on
 * the page instead of a normalised zero.
 */
function widestGapBisector(directions: readonly ScenePoint[]): ScenePoint {
  if (directions.length === 1) return negate(directions[0]!);

  const sorted = [...directions].sort(compareByDrawnAngle);

  let best: ScenePoint | undefined;
  // The gap angle is carried as its own (cos, sin) rather than as an angle, so
  // no inverse trig is needed to compare two of them.
  let bestCos = 0;
  let bestSin = 0;

  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]!;
    const to = sorted[(i + 1) % sorted.length]!;
    const gapCos = dot(from, to);
    const gapSin = crossOnPage(from, to);
    const bisector = gapBisector(from, to, gapSin);
    if (
      best === undefined ||
      isWiderGap(gapCos, gapSin, bestCos, bestSin) ||
      (sameGap(gapCos, gapSin, bestCos, bestSin) &&
        beatsOnTieBreak(bisector, best))
    ) {
      best = bisector;
      bestCos = gapCos;
      bestSin = gapSin;
    }
  }
  return best!;
}

/**
 * The direction halfway across the gap running counter-clockwise on the page
 * from `from` to `to`.
 *
 * The sum of the two bounds bisects a gap narrower than a half turn; for a
 * wider one it points across the OTHER side and has to be reversed. At exactly
 * a half turn the sum is zero and carries no direction at all, so the bisector
 * is `from` turned a quarter turn counter-clockwise on the page.
 */
function gapBisector(
  from: ScenePoint,
  to: ScenePoint,
  gapSin: number,
): ScenePoint {
  if (gapSin === 0 && dot(from, to) < 0) return { x: from.y, y: -from.x };
  const sum = { x: from.x + to.x, y: from.y + to.y };
  const bisector = normalise(sum);
  return gapSin < 0 ? negate(bisector) : bisector;
}

/**
 * Compares two gap angles given as (cos, sin) pairs, without recovering
 * either angle. Same half-plane trick as `compareByDrawnAngle`, one dimension
 * up: a gap of 0 to 180 degrees is "lower" than one of 180 to 360.
 */
function gapHalf(gapCos: number, gapSin: number): 0 | 1 {
  return gapSin > 0 || (gapSin === 0 && gapCos > 0) ? 0 : 1;
}

function isWiderGap(
  cosA: number,
  sinA: number,
  cosB: number,
  sinB: number,
): boolean {
  const halfA = gapHalf(cosA, sinA);
  const halfB = gapHalf(cosB, sinB);
  if (halfA !== halfB) return halfA > halfB;
  return cosB * sinA - sinB * cosA > 0;
}

function sameGap(
  cosA: number,
  sinA: number,
  cosB: number,
  sinB: number,
): boolean {
  return cosA === cosB && sinA === sinB;
}

/**
 * Breaks a tie between two equally wide gaps: nearest north wins, then
 * nearest east.
 *
 * ENTIRELY GEOMETRIC, never the neighbour's index. `bondsAt` order is bond
 * insertion order, which changes when an atom is deleted and redrawn, when a
 * fragment is pasted, and when a file round-trips through molfile — all
 * without the geometry changing at all. A label that jumped on any of those
 * would put a spurious diff into an exported figure nobody edited.
 */
function beatsOnTieBreak(candidate: ScenePoint, incumbent: ScenePoint): boolean {
  const northCandidate = dot(candidate, NORTH);
  const northIncumbent = dot(incumbent, NORTH);
  if (northCandidate !== northIncumbent) return northCandidate > northIncumbent;
  return dot(candidate, EAST) > dot(incumbent, EAST);
}

/**
 * The emptiest direction around the atom: unit, scene px, y-down.
 *
 * An atom with no bonds gets north — visually up. A lone atom's decorations
 * belong above it, and a purely vertical answer carries no horizontal bias,
 * which hands the east/west question cleanly to `HYDROGEN_FIRST_ELEMENTS`
 * instead of half-answering it.
 */
export function freeDirection(
  centre: ScenePoint,
  neighbourCentres: readonly ScenePoint[],
): ScenePoint {
  const directions = bondDirectionsOf(centre, neighbourCentres);
  if (directions.length === 0) return NORTH;
  const mean = meanBondDirection(centre, neighbourCentres);
  return mean === undefined ? widestGapBisector(directions) : negate(mean);
}

/**
 * "OH" or "HO": which side of the symbol the hydrogen block goes.
 *
 * A side is BLOCKED when some bond leaves within
 * `horizontalBlockHalfAngleDeg` of it — compared as a cosine, since every
 * vector here is a unit vector and a larger dot product is a smaller angle.
 *
 * With neither side blocked the free direction decides, which is what makes a
 * hydroxyl hanging to the north-east read "OH" and its mirror image "HO". A
 * free direction with no horizontal component at all (the apex of a symmetric
 * zig-zag) falls to east: with nothing forcing the issue, a chemist writes
 * left to right.
 */
export function chooseHydrogenSide(
  bondDirections: readonly ScenePoint[],
  free: ScenePoint,
  element: ElementSymbol,
): LabelSide {
  if (bondDirections.length === 0) {
    return HYDROGEN_FIRST_ELEMENTS.has(element) ? "west" : "east";
  }

  let eastCos = -Infinity;
  let westCos = -Infinity;
  for (const direction of bondDirections) {
    if (direction.x > eastCos) eastCos = direction.x;
    if (-direction.x > westCos) westCos = -direction.x;
  }

  const eastBlocked = eastCos > LABEL_PLACEMENT.horizontalBlockCos;
  const westBlocked = westCos > LABEL_PLACEMENT.horizontalBlockCos;

  if (eastBlocked && !westBlocked) return "west";
  if (westBlocked && !eastBlocked) return "east";
  // Both blocked: take whichever has more room. A horizontal chain vertex
  // reaches this, and a horizontal label with the greater clearance is at
  // least legible — stacking the hydrogens above or below the symbol is the
  // proper answer and belongs with the bond-geometry pass that will consume
  // these boxes.
  if (eastBlocked && westBlocked) return westCos < eastCos ? "west" : "east";
  return free.x < 0 ? "west" : "east";
}

/** Grows a rect by `padding` on all four sides. */
function pad(box: LabelBox, padding: number): LabelBox {
  return {
    minX: box.minX - padding,
    minY: box.minY - padding,
    maxX: box.maxX + padding,
    maxY: box.maxY + padding,
  };
}

/**
 * The padded cap-band rect of one measured span.
 *
 * THE CAP BAND, not the em box. A label's perceived body is the band from its
 * baseline up to the cap height: chemical labels are capitals, digits and the
 * odd lowercase second letter. Using the ascender/descender box instead would
 * make chlorine's box taller than oxygen's because of the "l", and would let a
 * superscript charge stop an arriving bond a full em short of its atom. The
 * ink box — which is the ascender box, and which never clips — is a different
 * rectangle, and `sceneBounds` owns it.
 *
 * `style.labelPaddingPx` is applied HERE AND ONLY HERE. It is the clear space
 * a bond stops short of a label; a trimmer that pads again doubles it, and
 * every bond in the figure comes out visibly short.
 */
function spanBox(
  span: MeasuredSpan,
  origin: ScenePoint,
  paddingPx: number,
): LabelBox {
  const baselineY = origin.y + span.dyPx;
  const capPx = EM_CAP_HEIGHT * span.fontSizePx;
  const minX = origin.x + span.startXPx;
  return pad(
    {
      minX,
      minY: baselineY - capPx,
      maxX: minX + span.advanceWidthPx,
      maxY: baselineY,
    },
    paddingPx,
  );
}

function unionOf(obstacles: readonly LabelObstacle[]): LabelBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obstacle of obstacles) {
    const box =
      obstacle.kind === "rect"
        ? obstacle.box
        : {
            minX: obstacle.centre.x - obstacle.radius,
            minY: obstacle.centre.y - obstacle.radius,
            maxX: obstacle.centre.x + obstacle.radius,
            maxY: obstacle.centre.y + obstacle.radius,
          };
    if (box.minX < minX) minX = box.minX;
    if (box.minY < minY) minY = box.minY;
    if (box.maxX > maxX) maxX = box.maxX;
    if (box.maxY > maxY) maxY = box.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * How far along `direction` the union of `obstacles` extends from `origin`.
 *
 * The exact union query — a slab test per rect, the circle quadratic per disc
 * — rather than a query against the bounding box, which for a charged label is
 * mostly empty air. 0 when the ray hits nothing.
 *
 * `direction` is assumed to be a unit vector and is NOT renormalised: the
 * result is a distance, and quietly rescaling a caller's direction would make
 * that distance mean something different from what they asked for.
 */
function rayExit(
  obstacles: readonly LabelObstacle[],
  origin: ScenePoint,
  direction: ScenePoint,
): number {
  let furthest = 0;
  for (const obstacle of obstacles) {
    const hit =
      obstacle.kind === "rect"
        ? rectHit(obstacle.box, origin, direction)
        : discHit(obstacle.centre, obstacle.radius, origin, direction);
    if (hit === undefined) continue;
    if (hit > furthest) furthest = hit;
  }
  return furthest;
}

/** Slab method. Returns the exit parameter, or undefined for a miss. */
function rectHit(
  box: LabelBox,
  origin: ScenePoint,
  direction: ScenePoint,
): number | undefined {
  let entry = -Infinity;
  let exit = Infinity;

  for (const axis of ["x", "y"] as const) {
    const d = direction[axis];
    const o = origin[axis];
    const lo = axis === "x" ? box.minX : box.minY;
    const hi = axis === "x" ? box.maxX : box.maxY;
    if (d === 0) {
      // Parallel to this pair of edges: either always inside the slab or never.
      if (o < lo || o > hi) return undefined;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    const near = t1 < t2 ? t1 : t2;
    const far = t1 < t2 ? t2 : t1;
    if (near > entry) entry = near;
    if (far < exit) exit = far;
  }

  if (!(entry < exit) || exit <= 0) return undefined;
  return exit;
}

function discHit(
  centre: ScenePoint,
  radius: number,
  origin: ScenePoint,
  direction: ScenePoint,
): number | undefined {
  const toCentre = sub(centre, origin);
  const along = dot(toCentre, direction);
  const discriminant =
    along * along - (dot(toCentre, toCentre) - radius * radius);
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  const entry = along - root;
  const exit = along + root;
  if (!(entry < exit) || exit <= 0) return undefined;
  return exit;
}

/**
 * The eight compass directions a radical dot cluster may take, in the order
 * they are preferred when nothing distinguishes them.
 *
 * North first: that is where a chemist draws an unpaired electron, and it is
 * the direction least likely to collide with the 30-degree bonds a skeletal
 * drawing is made of. Eight rather than four because a dot has no baseline to
 * align to, and on a trisubstituted atom the diagonals are often the only free
 * space left. `Math.SQRT1_2` is an exactly specified double, so the diagonals
 * are reproducible.
 */
const DOT_DIRECTIONS: readonly (readonly [string, ScenePoint])[] = Object.freeze([
  ["N", { x: 0, y: -1 }],
  ["NE", { x: Math.SQRT1_2, y: -Math.SQRT1_2 }],
  ["NW", { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }],
  ["E", { x: 1, y: 0 }],
  ["W", { x: -1, y: 0 }],
  ["SE", { x: Math.SQRT1_2, y: Math.SQRT1_2 }],
  ["SW", { x: -Math.SQRT1_2, y: Math.SQRT1_2 }],
  ["S", { x: 0, y: 1 }],
] as const);

/**
 * Places the label for one atom: the glyph run, the radical dots, and the
 * clear space around both.
 *
 * Geometry only. It returns no ids and no colours — `scene/build.ts` owns
 * identity and paint, and a placement pass that minted ids would be a second
 * place the id scheme lived.
 *
 * Pure: no clock, no `Math.random`, no counters, no mutation of the input.
 */
export function placeAtomLabel(input: AtomLabelInput): AtomLabelPlacement {
  const { atomId, centre, label, style } = input;
  if (label.symbol.length === 0) {
    // "This atom has no label" is a decision made upstream, where
    // `composeAtomLabel` returns undefined. An empty symbol reaching here is a
    // programmer error, and this package would rather stop than draw a
    // plausible wrong picture — the same call `exactMass()` makes.
    throw new Error(`Atom ${atomId} was placed with an empty label symbol`);
  }

  const bondDirections = bondDirectionsOf(centre, input.neighbourCentres);
  // Every direction an electron mark has to keep out of: the real bonds, plus
  // the derived hydrogens this view will draw. See `derivedHydrogenDirections`.
  const derivedHydrogens = input.derivedHydrogenDirections ?? [];
  const markDirections =
    derivedHydrogens.length === 0
      ? bondDirections
      : [...bondDirections, ...derivedHydrogens];
  const free = freeDirection(centre, input.neighbourCentres);
  const hydrogenSide =
    label.hydrogens.length > 0
      ? (input.side ?? chooseHydrogenSide(bondDirections, free, label.element))
      : undefined;
  // With no hydrogen block the two orientations produce the same run, so the
  // choice is arbitrary and must not be reported as if it meant something.
  const side: LabelSide = hydrogenSide ?? input.side ?? "east";

  const spans = labelSpans(label, side);
  const symbolIndex = symbolSpanIndex(label, side);
  const box = measureTextRun(
    spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx: style.fontSizePx,
      subscriptScale: style.subscriptScale,
      // Both fixed, and both load-bearing. `text-anchor: middle` would re-centre
      // the run using whatever advance the VIEWER's resolved font reports,
      // while we know the exact advances — anchoring at the start makes our
      // computed left edge and the drawn left edge the same edge.
      // `dominant-baseline: middle` is ignored by Illustrator, and Chromium
      // and Inkscape centre it on half the x-height rather than on the cap
      // band a label is read on (the same reason the serialiser refuses
      // `baseline-shift`).
      anchor: "start",
      baseline: "alphabetic",
    },
    measurerFor(style),
  );

  const symbolSpan = box.spans[symbolIndex]!;

  // THE detail that separates a correct label from an approximate one: the
  // SYMBOL block's advance midpoint sits on the atom, not the run's. "OH" puts
  // its O on the atom with the H hanging east and "HO" is the exact mirror; a
  // carbon-13 keeps its C on the bond with the mass number as a satellite. Fix
  // the run's midpoint instead and every bond meets the gap between two
  // letters — a bug that only becomes visible once bonds are trimmed, and gets
  // debugged in the wrong file.
  const originX = centre.x - symbolSpan.startXPx - symbolSpan.advanceWidthPx / 2;
  // Plus, because scene y grows downward: dropping the baseline half a cap
  // height BELOW the atom puts the cap band's midline on the atom. Cap height,
  // not the ascender, which reserves room for accents no chemical label
  // carries and would visibly sink every label below its bond.
  const originY = centre.y + box.capHeightPx / 2;
  const origin: ScenePoint = { x: originX, y: originY };

  const spanObstacles: LabelObstacle[] = [];
  let symbolBox: LabelBox | undefined;
  for (let i = 0; i < box.spans.length; i++) {
    const measured = box.spans[i]!;
    const rect = spanBox(measured, origin, style.labelPaddingPx);
    if (i === symbolIndex) symbolBox = rect;
    // A zero-advance span has no ink to keep clear of; a padded rect around
    // nothing would be pure phantom clearance.
    if (measured.advanceWidthPx === 0) continue;
    spanObstacles.push({ kind: "rect", box: rect });
  }
  // The run's ink, asked of the same measured run the obstacles came from, so
  // the two readings cannot be of two different layouts.
  const inkBoxes: LabelBox[] = glyphInkRects(
    box,
    origin,
    measurerFor(style),
    style.fontFamily,
  );

  // ONE ALLOCATION OF THE EIGHT SLOTS, SHARED. The radical cluster picks
  // first, because an unpaired electron is a stronger claim on a direction
  // than a pair is; the lone pairs take what is left; the charge takes the
  // emptiest slot after both. Running three independent searches instead
  // would let two marks choose the same direction and draw on top of each
  // other, which is exactly the failure `radicalDotId`'s note warns about for
  // the ids.
  const taken = new Set<string>();
  if (hydrogenSide === "east") taken.add("E");
  if (hydrogenSide === "west") taken.add("W");
  // A derived hydrogen occupies its nearest slot outright, on top of scoring
  // against it above. Scoring alone already pushes a mark away from a
  // hydrogen's direction, but only until every better slot is gone; the
  // reservation is what makes "a pair never shares a hydrogen's slot" a
  // property of the code rather than of how crowded the atom happens to be.
  for (const direction of derivedHydrogens) {
    taken.add(nearestDirectionName(direction));
  }

  const dotRadius = markRadius(style);
  const dots = placeDotCluster(
    label.radicalDotCount,
    centre,
    markDirections,
    taken,
    spanObstacles,
    dotRadius,
    // A radical is ONE cluster of N dots, however many electrons there are:
    // three dots on a triplet carbene are three marks on one direction, not
    // three directions.
    "single-direction",
  );

  const lonePairs = placeDotCluster(
    // Two dots per pair, and each PAIR gets its own direction.
    label.lonePairCount,
    centre,
    markDirections,
    taken,
    spanObstacles,
    dotRadius,
    "one-direction-each",
  );

  const obstacles: LabelObstacle[] = [...spanObstacles];
  for (const placedDot of [...dots, ...lonePairs]) {
    obstacles.push({
      kind: "disc",
      centre: placedDot.centre,
      radius: placedDot.radius + style.labelPaddingPx,
    });
    // A radical or lone-pair dot IS ink — unlike the bare-vertex dot, which
    // `buildScene` deliberately keeps out of the ink set (decision 61). Its
    // disc is squared off because every consumer here asks a rectangle
    // question, and the bounding square is the conservative answer.
    inkBoxes.push({
      minX: placedDot.centre.x - placedDot.radius,
      minY: placedDot.centre.y - placedDot.radius,
      maxX: placedDot.centre.x + placedDot.radius,
      maxY: placedDot.centre.y + placedDot.radius,
    });
  }

  const detachedCharge =
    label.chargeDetached && label.charge.length > 0
      ? placeDetachedCharge(label.charge, centre, markDirections, taken, obstacles, style)
      : undefined;
  if (detachedCharge !== undefined) {
    obstacles.push({ kind: "rect", box: detachedCharge.box });
    inkBoxes.push(...detachedCharge.ink);
  }

  const placement: { -readonly [K in keyof AtomLabelPlacement]: AtomLabelPlacement[K] } = {
    atomId,
    centre,
    run: {
      origin,
      spans,
      fontSizePx: style.fontSizePx,
      anchor: "start",
    },
    dots,
    lonePairs,
    obstacles,
    inkBoxes,
    clearBox: unionOf(obstacles),
    // Always defined: the symbol span index is in range because
    // `symbolSpanIndex` indexes the same array `labelSpans` produced.
    symbolBox: symbolBox!,
    hydrogenSide,
    freeDirection: free,
  };
  // Omitted, not assigned `undefined`: the placement is compared by tests and
  // the two forms are different objects to `toEqual`.
  if (detachedCharge !== undefined) placement.detachedCharge = detachedCharge.run;
  return placement;
}

/** The radius every electron mark is drawn at — radical dot and lone-pair dot
 *  alike, because they are the same kind of mark at the same weight. */
function markRadius(style: RenderStyle): number {
  return Math.max(
    LABEL_PLACEMENT.radicalDotRadiusEm * style.fontSizePx,
    LABEL_PLACEMENT.radicalDotMinStrokeFactor * style.bondLineWidthPx,
  );
}

/**
 * The emptiest compass direction not already spoken for, or undefined when
 * every one of the eight has been taken.
 *
 * "Emptiest" is measured against the BONDS, by worst alignment: the candidate
 * whose closest bond is furthest away wins. Ties fall to the earlier compass
 * point, which is why `DOT_DIRECTIONS` is ordered by preference rather than
 * by angle — north first, because that is where a chemist puts an electron.
 */
function claimDirection(
  bondDirections: readonly ScenePoint[],
  taken: Set<string>,
): ScenePoint | undefined {
  let chosen: ScenePoint | undefined;
  let chosenName: string | undefined;
  let bestScore = Infinity;
  for (const [name, candidate] of DOT_DIRECTIONS) {
    if (taken.has(name)) continue;
    let score = -Infinity;
    for (const bond of bondDirections) {
      const alignment = dot(candidate, bond);
      if (alignment > score) score = alignment;
    }
    // Strictly less, so ties fall to the earlier — and more preferred —
    // compass point rather than to whichever the loop reached last.
    if (score < bestScore) {
      bestScore = score;
      chosen = candidate;
      chosenName = name;
    }
  }
  if (chosenName !== undefined) taken.add(chosenName);
  return chosen;
}

/**
 * Which of the eight slots a direction sits in.
 *
 * The compass points are 45 degrees apart, so every direction is within 22.5
 * degrees of exactly one of them and "nearest" is never a judgement call. Ties
 * — a direction exactly on a boundary — fall to the earlier compass point, the
 * same rule `claimDirection` uses, so the reservation is deterministic.
 */
function nearestDirectionName(direction: ScenePoint): string {
  let best = DOT_DIRECTIONS[0]![0];
  let bestScore = -Infinity;
  for (const [name, candidate] of DOT_DIRECTIONS) {
    const alignment = dot(candidate, direction);
    if (alignment > bestScore) {
      bestScore = alignment;
      best = name;
    }
  }
  return best;
}

/**
 * Electron marks around a label: `count` dots on one direction, or `count`
 * pairs of two dots each on a direction apiece.
 *
 * Both callers place a cluster at the exact distance a bond arriving along the
 * same direction would be trimmed to — through `rayExit`, over the same
 * obstacle set — so there is no second clearance constant to drift out of step
 * with the first. The two dots of a lone pair sit PERPENDICULAR to their
 * direction, which is what makes a pair read as a pair rather than as a
 * double-length radical.
 */
function placeDotCluster(
  count: number,
  centre: ScenePoint,
  bondDirections: readonly ScenePoint[],
  taken: Set<string>,
  spanObstacles: readonly LabelObstacle[],
  radius: number,
  mode: "single-direction" | "one-direction-each",
): PlacedDot[] {
  if (count <= 0) return [];
  const spacing = LABEL_PLACEMENT.radicalDotSpacingFactor * radius;
  const dots: PlacedDot[] = [];

  const emit = (direction: ScenePoint, howMany: number): void => {
    const distance = rayExit(spanObstacles, centre, direction) + radius;
    const clusterCentre: ScenePoint = {
      x: centre.x + direction.x * distance,
      y: centre.y + direction.y * distance,
    };
    const perpendicular: ScenePoint = { x: -direction.y, y: direction.x };
    for (let k = 0; k < howMany; k++) {
      const offset = (k - (howMany - 1) / 2) * spacing;
      dots.push({
        centre: {
          x: clusterCentre.x + perpendicular.x * offset,
          y: clusterCentre.y + perpendicular.y * offset,
        },
        radius,
      });
    }
  };

  if (mode === "single-direction") {
    const direction = claimDirection(bondDirections, taken);
    // Every slot gone. An atom that crowded has nowhere honest to put the
    // mark, and drawing it on top of a bond would state an electron the
    // reader cannot attribute — `detectCollisions` reports the crowding.
    if (direction === undefined) return dots;
    emit(direction, count);
    return dots;
  }

  for (let pair = 0; pair < count; pair++) {
    const direction = claimDirection(bondDirections, taken);
    if (direction === undefined) break;
    emit(direction, 2);
  }
  return dots;
}

/**
 * The Lewis view's charge, set in the least crowded direction left.
 *
 * A STANDALONE RUN, not a span inside the label. `labelSpans` puts the charge
 * at the end of the run everywhere else and gives a good reason — the
 * top-right corner is where a chemist reads a charge, and a leading
 * superscript reads as a mass number. In a Lewis diagram that corner is
 * usually a lone pair, so the charge has to move, and a span in a text run
 * cannot. Keeping it a separate primitive leaves the other three views' runs
 * untouched rather than branching the run's order.
 *
 * It is placed AFTER the electrons and queries the obstacle set they are
 * already in, so it sits clear of them by the same ray-exit rule.
 */
function placeDetachedCharge(
  spans: readonly TextSpan[],
  centre: ScenePoint,
  bondDirections: readonly ScenePoint[],
  taken: Set<string>,
  obstacles: readonly LabelObstacle[],
  style: RenderStyle,
):
  | {
      readonly run: PlacedTextRun;
      readonly box: LabelBox;
      readonly ink: readonly LabelBox[];
    }
  | undefined {
  const direction = claimDirection(bondDirections, taken);
  if (direction === undefined) return undefined;

  // Measured as an ordinary run at the label's own size; the spans already
  // carry `script: "super"`, so the measurer applies the subscript scale.
  const box = measureTextRun(
    spans,
    {
      fontFamily: style.fontFamily,
      fontSizePx: style.fontSizePx,
      subscriptScale: style.subscriptScale,
      anchor: "start",
      baseline: "alphabetic",
    },
    measurerFor(style),
  );
  const halfWidth = box.advanceWidthPx / 2;
  const halfHeight = box.capHeightPx / 2;
  // Far enough out that the glyph's own half-diagonal clears whatever the ray
  // exited, rather than straddling it.
  const distance =
    rayExit(obstacles, centre, direction) +
    Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);
  const anchor: ScenePoint = {
    x: centre.x + direction.x * distance,
    y: centre.y + direction.y * distance,
  };
  const origin: ScenePoint = { x: anchor.x - halfWidth, y: anchor.y + halfHeight };
  return {
    run: {
      origin,
      spans,
      fontSizePx: style.fontSizePx,
      anchor: "start",
    },
    box: {
      minX: origin.x - style.labelPaddingPx,
      minY: anchor.y - halfHeight - style.labelPaddingPx,
      maxX: origin.x + box.advanceWidthPx + style.labelPaddingPx,
      maxY: anchor.y + halfHeight + style.labelPaddingPx,
    },
    // Measured, not the padded box with the padding taken back off: the box
    // above is the charge's CLEAR SPACE, a cap band about the anchor, while
    // its ink is the glyphs themselves — for a detached charge, a "+" or a
    // "−" set as a superscript, which is most of an em narrower.
    ink: glyphInkRects(box, origin, measurerFor(style), style.fontFamily),
  };
}

/**
 * How far from `origin` the label's occupied region extends along `direction`
 * — where a line running that way should stop.
 *
 * Queries the obstacle UNION exactly, not the bounding box. `direction` is
 * taken as a unit vector and is not renormalised.
 *
 * `origin` DEFAULTS TO THE ATOM CENTRE, which is the bond-axis case: the
 * padded symbol rect always contains the centre, so a ray from any neighbour
 * hits something and comes back with a sensible distance rather than 0.
 *
 * It is a parameter because the parallel copies of a multiple bond do NOT
 * start at the centre. Shifting the axis's answer sideways is not the same
 * number: a ray leaving a rectangle through a vertical face and then displaced
 * perpendicular re-enters the slab, which is how the second line of a diagonal
 * C=O ended up inside the "O" it had just been trimmed clear of. Each parallel
 * copy runs its OWN ray-exit from its own origin. Off-centre origins are
 * handled by the same slab test: a ray that misses every obstacle trims 0, one
 * that crosses from outside trims to the far exit.
 */
export function trimDistance(
  placement: AtomLabelPlacement,
  direction: ScenePoint,
  origin: ScenePoint = placement.centre,
): number {
  return rayExit(placement.obstacles, origin, direction);
}

/**
 * The label's largest half-extent about the atom centre, in PX.
 *
 * For a hit-test radius. PX, deliberately: converting to model units would be
 * a second place that knew the scale, and this package has exactly one. A
 * caller wiring this into chem-core's hit-testing divides by
 * `pxPerModelUnit(style)` — never by `style.bondLengthPx` directly.
 */
export function labelRadiusPx(placement: AtomLabelPlacement): number {
  const { centre, clearBox } = placement;
  return Math.max(
    centre.x - clearBox.minX,
    clearBox.maxX - centre.x,
    centre.y - clearBox.minY,
    clearBox.maxY - centre.y,
  );
}
