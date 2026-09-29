/**
 * The fully-explicit view's phantom hydrogens.
 *
 * Hydrogens are IMPLICIT in chem-core and always will be — they are derived
 * from valence at query time and never stored as atoms, because the model that
 * stored them made every traversal, layout pass and export filter them back
 * out. So the fully-explicit view cannot ask the graph where its hydrogens
 * are; it has to DERIVE a position for each one, at render time, and throw the
 * result away again. That is this file, and nothing it produces ever reaches
 * chem-core.
 *
 * WHERE THEY GO: into the angular gaps the atom's real bonds leave, fanned by
 * chem-core's `hydrogenFan` — the generalisation of the same
 * `largestGapBisector` the drawing tool uses to decide where a new bond
 * sprouts, with a ring's inside counted as occupied just as `templateAngle`
 * counts it. Asking the same question one way keeps a derived hydrogen from
 * landing somewhere the editor would refuse to put a bond.
 *
 * THE FAN IS COMPUTED IN MODEL SPACE, y-up, and converted once through
 * `modelToPx`. Doing it in scene px instead would mean re-deriving the gap
 * search inside `label/placement.ts`, whose header refuses to import a
 * chem-core vector helper at all — a second copy of the geometry, with its own
 * rounding, on a y-flipped axis. The shortened bond length is a RATIO on
 * `RenderStyle`, applied here in model units, so `bondLengthPx` is still
 * multiplied in exactly one function in the package.
 *
 * THE RENDERER MOVES THE HYDROGENS IT DERIVES, AND NOTHING ELSE (decision
 * 134). A derived hydrogen has no coordinate in the molecule, so every number
 * about it — its direction, its distance, its glyph — is this file's
 * invention, and rearranging an invention is not the act `detectCollisions`
 * refuses to perform. What that pass refuses to do is move an ATOM, because
 * the move would survive into the SVG, the molfile and the next reader's
 * understanding of the geometry. A hydrogen has nothing to survive into. A
 * hydrogen the author DREW is an atom like any other and is never touched;
 * nor is a heavy atom or a bond. The boundary is exactly the boundary between
 * a stored coordinate and a derived one.
 *
 * WHAT IS THE AUTHOR'S HERE IS THE GAP, NOT THE ANGLE. The fan puts each
 * hydrogen inside an angular gap the author's bonds left empty; any other
 * angle inside that same gap is a direction those same bonds also left empty.
 * So a crowded hydrogen is TURNED, in 3-degree steps out to 60, and stood
 * further off, in twentieths of a bond out to 0.4, and a crowded fan is
 * turned and SPREAD as a whole — but no hydrogen is ever turned to within 25
 * degrees of either bond that bounds its gap, and so never past one. That is
 * also what keeps a stereocentre's picture true: a hydrogen beside a wedge
 * stays on the same side of it, so the cyclic order of the four
 * substituents, which is what a reader reads the configuration from, is the
 * order the author drew. The one hydrogen that may change gap is a lone one
 * on a branch or ring-fusion carbon with no stereo bond, whose picture
 * asserts no configuration to contradict — see `fallbackGaps`.
 *
 * WHAT COUNTS AS CROWDED IS WHAT `detectCollisions` REPORTS, AND WORSE
 * (decision 183). Every place is scored in four tiers, compared in order
 * (`Score`): bonds the hydrogen is across from its host; glyphs its "H"
 * shares ink with; other ink its glyph or stem touches — a bond's stroke, a
 * wedge's edge, another stem; and marks whose padded clear space it enters,
 * which is the `hydrogen-over-atom` test itself, over labels, other hydrogens
 * and the bonds not at its own host. Across a bond is a wrong picture, two letters
 * sharing ink a misreading ("HH" beside one carbon is a formula), a line
 * through a glyph a crowded one, and a mark merely short of white space is
 * still two marks. The fanned place is kept whenever every tier is zero, so
 * an uncrowded structure gets exactly the fan it always got.
 *
 * ONE HYDROGEN AT A TIME, THEN AGAIN. Each hydrogen is placed in the
 * molecule's own order, against every mark already on the page; then every
 * hydrogen still scoring above zero is placed again against all of them,
 * including the ones placed after it, and then its host's whole fan is turned
 * and spread; either moves only when that strictly lowers its score. Its
 * score is exactly its share of the page's total — a clash between two
 * hydrogens counts once on each — so every move lowers the total and the
 * passes cannot cycle. A first-placed hydrogen that took the pocket a later
 * one needed is how most of the crowding left over from a single pass arose;
 * the second pass is what lets it step aside.
 *
 * THE DISTANCE IS PUSHED OUT FOR A DIFFERENT REASON, and was here first. 0.66
 * of a bond length is not far enough to clear a wide label: a carbon-13 sets
 * its mass number as a superscript to the west, and the hydrogen fanned west
 * landed inside it, so the stem trimmed to nothing and the "H" drew with no
 * bond at all. The distance is therefore pushed until the stem clears both
 * labels by `style.explicitHydrogenMinStemRatio` of a bond (and never less
 * than `MIN_STEM_LINE_WIDTHS` line widths). At Publication's 10 pt labels that
 * push applies to nearly every hydrogen: the two trims alone exceed the 0.66
 * stand-off.
 *
 * CROWDING THAT REMAINS IS STILL REPORTED. A vertex with more marks around it
 * than its gap has page — Publication's 10 pt "H" on a 14.4 pt bond, at a
 * fused-ring vertex whose neighbours all carry hydrogens of their own — has
 * no place with a score of zero, and the hydrogen keeps the best one it has
 * and comes out of `detectCollisions` as `hydrogen-over-atom`. An honest
 * overlap beats a mark shoved outside its own gap to make a count come out at
 * zero.
 */

import {
  angularGaps,
  bondDirections,
  bondsAt,
  DEG,
  fromPolar,
  getAtom,
  hydrogenFan,
  implicitHydrogenCount,
  neighborIds,
  normalizeAnglePositive,
} from "@starter/chem-core";
import type { AtomId, BondId, FanSector, Molecule, Vec2 } from "@starter/chem-core";

import type { AnnotationSegment } from "../label/annotations.js";
import { drawsHydrogenVertices } from "../label/visibility.js";
import { placeAtomLabel, trimDistance } from "../label/placement.js";
import type { AtomLabelPlacement, LabelBox, LabelObstacle } from "../label/placement.js";
import type { ComposedLabel } from "../label/compose.js";
import type { StructuralRepresentation } from "../representation.js";
import type { ScenePoint } from "../scene/types.js";
import { modelToPx, pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";

/** One derived hydrogen: whose it is, which of that atom's fan it is, and
 *  where its glyph sits — all in scene px, y already flipped. */
export interface PhantomHydrogen {
  readonly hostAtomId: AtomId;
  /** Index within THIS host's own fan, never a scene-wide counter. */
  readonly index: number;
  readonly centre: ScenePoint;
  /** The "H" glyph's placement, so bond trimming and collision detection see
   *  the same box the drawing does. */
  readonly placement: AtomLabelPlacement;
}

/**
 * What every bond drew, segment by segment, keyed by the bond.
 *
 * Both lines of a double bond, a wedge's outline, a hash ladder's bars and
 * rails — the same segments `buildScene` hands the annotation pass, so a
 * hydrogen and a locant are kept off the same ink. Keyed by bond because a
 * hydrogen ignores the bonds at its own host, exactly as `detectCollisions`
 * does: its stem leaves from among them by construction.
 */
export type BondInk = ReadonlyMap<BondId, readonly AnnotationSegment[]>;

/**
 * The least clear stem a derived hydrogen gets, in bond line widths, whatever
 * the style's `explicitHydrogenMinStemRatio` says.
 *
 * Two, not one. `scene/build.ts` passes `style.bondLineWidthPx` to `bondAxis`
 * as the length below which a bond draws nothing, so one line width is exactly
 * the threshold and floating-point noise decides; two is the shortest stem
 * that reads as a line rather than as a smudge between two glyphs.
 */
const MIN_STEM_LINE_WIDTHS = 2;

/**
 * How far a crowded hydrogen may be moved out of its fanned place, and in what
 * increments: turned, in degrees applied in model space, and stretched, as a
 * fraction of a bond added to its stand-off.
 *
 * THE TURN IS WITHIN THE AUTHOR'S OWN GAP, which is why it is allowed at all.
 * See `turnLimits`: the gap's two bounding bonds, less `GAP_CLEARANCE_DEG`
 * each, are the hard limits, and this is the cap inside them.
 *
 * 60 degrees is the cap because a hydrogen turned further no longer reads as
 * belonging to the vertex it is drawn from: the eye follows the stem, and past
 * a right angle the stem crosses the reader's line to the next atom. 3 degrees
 * is the step — at Publication's stand-off of 16 to 21 px one step moves the
 * glyph about a px, so the search cannot stride over the one place a mark
 * would have fitted.
 *
 * THE STRETCH IS THE SAME LEVER `explicitHydrogenMinStemRatio` ALREADY PULLS,
 * and is here because turning alone cannot always work. Two hosts a bond apart
 * fanning into the pocket between them have no free angle left: every
 * direction either side is another bond's, and turning either one only feeds
 * it further into the other. Standing one of them further off separates two
 * glyphs that no rotation would.
 *
 * 0.4 of a bond is the cap. It is added ON TOP of whatever stand-off the
 * clearance floor already demanded, so at Publication — where the floor runs
 * to about 0.87 of a bond — the longest stem this can produce is about 1.33,
 * which is a long stem and still not a length anyone would read as a C–C.
 */
const ROTATION_LIMIT_DEG = 60;
const ROTATION_STEP_DEG = 3;
const STRETCH_LIMIT_RATIO = 0.4;
const STRETCH_STEP_RATIO = 0.05;

/**
 * How close to a bond bounding its gap a turned hydrogen may come.
 *
 * 25 degrees, the same figure `LABEL_PLACEMENT.horizontalBlockHalfAngleDeg`
 * uses for the same underlying reason: inside that angle a mark and a line
 * share enough of the page that the reader attaches the mark to the line. A
 * hydrogen that has drifted within 25 degrees of its host's C–C bond reads as
 * hanging off the wrong end of it.
 */
const GAP_CLEARANCE_DEG = 25;

/**
 * How many times the hydrogens still scoring above zero are placed again.
 *
 * The passes stop by themselves once a pass moves nothing, and every move
 * lowers the page's total score, so this is a bound on the work rather than
 * on the answer's correctness. Measured over the fixture set, the steroid,
 * perhydrophenanthrene and a 300-atom chain, at nine rotations in both views
 * and at both presets: no drawing moves anything in a third pass, and only
 * the steroid, at one rotation in each view, in a second.
 */
const MAX_REPAIR_PASSES = 3;

/** One trial place for a crowded hydrogen: a turn in radians, and an extra
 *  stand-off in bond lengths. */
interface SeparationCandidate {
  readonly turn: number;
  readonly stretch: number;
}

/**
 * The trial places a crowded hydrogen works through: every combination of
 * turn and stretch, in increasing order of how far it departs from the fanned
 * place.
 *
 * DEPARTURE IS COUNTED IN STEPS, NOT IN PX. A turn and a stretch are not
 * commensurable — one is an angle and the other a length — so the ladder
 * counts each in its own steps and tries every pair summing to 1 before every
 * pair summing to 2. Comparing them by how far they move the glyph would mean
 * a float sort key, and a float sort key on a committed, diffed figure is the
 * thing this package refuses everywhere else.
 *
 * At equal cost the TURN is preferred, because every hydrogen on an atom is
 * drawn at the same stand-off and a fan with one long arm reads as a mistake,
 * while a fan with one arm swung wide reads as a crowded vertex. At equal cost
 * and equal split the positive turn is preferred, which is a rule rather than
 * a reason: what matters is that the same molecule always gets the same
 * answer. Model space is y-up, so a positive turn is counter-clockwise in the
 * molecule and clockwise on the page.
 */
const SEPARATION_CANDIDATES: readonly SeparationCandidate[] = Object.freeze(
  buildSeparationLadder(),
);

function buildSeparationLadder(): SeparationCandidate[] {
  const turnSteps = Math.round(ROTATION_LIMIT_DEG / ROTATION_STEP_DEG);
  const stretchSteps = Math.round(STRETCH_LIMIT_RATIO / STRETCH_STEP_RATIO);
  // The fanned place itself is not in here — it is tried by name before any
  // of these, and kept when none of them does better.
  const out: SeparationCandidate[] = [];
  for (let cost = 1; cost <= turnSteps + stretchSteps; cost++) {
    for (let stretch = 0; stretch <= Math.min(cost, stretchSteps); stretch++) {
      const turn = cost - stretch;
      if (turn > turnSteps) continue;
      const distance = stretch * STRETCH_STEP_RATIO;
      if (turn === 0) {
        out.push({ turn: 0, stretch: distance });
        continue;
      }
      out.push({ turn: turn * ROTATION_STEP_DEG * DEG, stretch: distance });
      out.push({ turn: -turn * ROTATION_STEP_DEG * DEG, stretch: distance });
    }
  }
  return out;
}

/**
 * How far from a host a mark has to be before it cannot possibly be hit, in
 * bond lengths.
 *
 * The furthest a hydrogen can get is the clearance floor plus the stretch cap,
 * which is a little over one and a quarter bonds, and its glyph reaches a
 * fraction of a bond past that; `style.fontSizePx` is added on top of these
 * three bonds for the glyph. It is a SPEED filter and nothing else — the
 * margin is wide enough that widening it further cannot change a placement,
 * only the time taken to reach it. Two hosts further apart than twice this
 * cannot have hydrogens that meet.
 */
const SEARCH_RADIUS_BONDS = 3;

/**
 * STRICTLY inside, by a hairline — `detectCollisions`' own margin, for its
 * reason: a stem trimmed exactly onto an obstacle's edge is touching it, not
 * in it.
 */
const TOUCHING_EPSILON_PX = 1e-6;

const NO_HOSTS: ReadonlySet<AtomId> = new Set();

/** `atom:a2:h:0`. Derived from the host and the fan index, per the
 *  byte-determinism rule that a primitive id never comes from a counter. */
export function phantomHydrogenId(hostAtomId: AtomId, index: number): string {
  return `atom:${hostAtomId}:h:${index}`;
}

/**
 * The scene-px directions `atomId`'s derived hydrogens take — unit vectors,
 * y already flipped, empty when the view draws none.
 *
 * SPLIT OUT FROM THE POSITIONS because the host's own label placement needs
 * them and cannot wait for the positions: a lone pair must not claim the slot
 * a hydrogen is about to take (see `AtomLabelInput.derivedHydrogenDirections`),
 * while a hydrogen's DISTANCE depends on how far that finished placement's
 * glyphs reach. Directions first, then the label, then the positions — the
 * order is what keeps the two from being a cycle. These are the FANNED
 * directions; a crowded hydrogen is later turned inside the same gap, which a
 * lone pair placed against the fanned one was already keeping clear of. A
 * lone hydrogen moved to another gap (`fallbackGaps`) has no such promise,
 * and meets any dot there as ink, which its score counts.
 *
 * The fan itself is still computed in model space, by chem-core, and converted
 * through `modelToPx`: a unit step along the angle is taken from the atom and
 * both ends go through the one conversion, so the flip happens exactly once
 * and this file still never negates a y.
 */
export function derivedHydrogenDirections(
  mol: Molecule,
  atomId: AtomId,
  style: RenderStyle,
  representation: StructuralRepresentation,
): ScenePoint[] {
  const atom = getAtom(mol, atomId);
  if (atom === undefined) return [];
  return fan(mol, atomId, representation).map((sector) =>
    sceneDirection(style, atom.pos, sector.angle),
  );
}

/**
 * The MODEL-space sectors `atomId`'s derived hydrogens are fanned into: the
 * angle each starts at, and the gap it may be turned within.
 *
 * Angles rather than scene vectors because the separation pass below turns
 * them: a rotation is one addition here and a matrix everywhere else, and
 * doing it in model space keeps `modelToPx` the only function that knows
 * which way is up.
 */
function fan(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): FanSector[] {
  if (!drawsHydrogenVertices(mol, atomId, representation)) return [];
  if (getAtom(mol, atomId) === undefined) return [];
  return hydrogenFan(mol, atomId, implicitHydrogenCount(mol, atomId));
}

/**
 * The turns a hydrogen may take off its fanned angle, in radians: out to
 * `ROTATION_LIMIT_DEG` either way, and never within `GAP_CLEARANCE_DEG` of
 * either bond bounding its gap.
 *
 * AN INTERVAL, NOT A TEST AGAINST EACH BOND, because what matters is not how
 * far the finished direction is from a bond but whether the turn PASSED one.
 * Tested at the far end only, a 60-degree turn in a 60-degree gap lands 30
 * degrees beyond the bond it crossed and passes; the hydrogen is then on the
 * wrong side of a wedge, and the stereocentre reads inverted. Measured from
 * the gap's own edges, which chem-core computed from the same sorted angles
 * as the fan, it cannot.
 *
 * A gap too narrow to turn in at all leaves only the fanned angle, and the
 * ladder then offers that hydrogen stretches only.
 */
function turnLimits(
  offset: number,
  width: number,
): { readonly min: number; readonly max: number } {
  const clearance = GAP_CLEARANCE_DEG * DEG;
  const limit = ROTATION_LIMIT_DEG * DEG;
  // Zero is always inside: it is where the fan put the hydrogen.
  return {
    min: Math.min(0, Math.max(-limit, -offset + clearance)),
    max: Math.max(0, Math.min(limit, width - offset - clearance)),
  };
}

/**
 * One model-space angle as a unit direction in scene px, y already flipped.
 *
 * A unit step along the angle is taken from the atom and BOTH ends go through
 * `modelToPx`, so the flip happens exactly once and this file still never
 * negates a y.
 */
function sceneDirection(
  style: RenderStyle,
  atomPos: Vec2,
  angle: number,
): ScenePoint {
  const offset = fromPolar(angle, 1);
  const centre = modelToPx(style, atomPos);
  const tip = modelToPx(style, {
    x: atomPos.x + offset.x,
    y: atomPos.y + offset.y,
  });
  const dx = tip.x - centre.x;
  const dy = tip.y - centre.y;
  // `Math.sqrt`, never `Math.hypot` — the same rule the placement pass
  // states in its header, for the same byte-determinism reason.
  const length = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / length, y: dy / length };
}

/** Another atom's label as a hydrogen sees it: where its black is, the clear
 *  space round it, and the box round both for a quick reject. */
interface LabelMarks {
  readonly atomId: AtomId;
  readonly ink: readonly LabelBox[];
  readonly clear: readonly LabelBox[];
  readonly bounds: LabelBox;
}

/**
 * A bond as a hydrogen sees it: what it drew, and the whole line between its
 * two atoms' centres.
 *
 * THE UNTRIMMED AXIS IS WHAT SAYS WHICH SIDE OF THE BOND A HYDROGEN IS ON.
 * A bond is drawn short of each label it meets, so between a labelled atom
 * and the drawn end of its bond there is a gap of white — and a stem can pass
 * through that gap, or stop short of the bond while its glyph straddles the
 * line, without touching a drawn mark. Either way the hydrogen is on the far
 * side of the bond from its host: that is how the steroid's C19 methyl put a
 * hydrogen inside ring A. So the test is centre to centre — the host's to
 * the hydrogen's, against the bond's own two atoms' — and trims play no part.
 */
interface NearBond {
  readonly bondId: BondId;
  readonly segments: readonly AnnotationSegment[];
  readonly axis: { readonly a: ScenePoint; readonly b: ScenePoint };
  readonly bounds: LabelBox;
}

/**
 * A gap a hydrogen may be placed in: the angle it starts from, how far either
 * way it may turn without leaving the gap, and where in the gap it starts —
 * `offset` round from the gap's first edge, of `width` — which is what a
 * spread of the whole fan is measured from.
 */
interface SlotGap {
  readonly angle: number;
  readonly minTurn: number;
  readonly maxTurn: number;
  readonly offset: number;
  readonly width: number;
}

/** One derived hydrogen to place, and everything fixed that it could hit. */
interface Slot {
  readonly id: string;
  readonly hostAtomId: AtomId;
  readonly index: number;
  readonly hostPos: Vec2;
  /**
   * The gap the fan put it in first, then any it may fall back to. See
   * `fallbackGaps` for who has any.
   */
  readonly gaps: readonly [SlotGap, ...SlotGap[]];
  readonly hostCentre: ScenePoint;
  readonly hostPlacement: AtomLabelPlacement | undefined;
  readonly baseDistance: number;
  readonly minStem: number;
  /** Nearby labels whose INK it must not share. Its own host is in here. */
  readonly inkLabels: readonly LabelMarks[];
  /** Nearby labels whose CLEAR space it would rather not enter. Its own host
   *  is not: the stem is trimmed against that label, and `detectCollisions`
   *  leaves it out for the same reason. */
  readonly clearLabels: readonly LabelMarks[];
  /** Nearby bonds not at its host, one entry per bond. */
  readonly bonds: readonly NearBond[];
  /** The other slots whose hydrogens could reach this one's, ascending. */
  readonly neighbours: readonly number[];
}

/**
 * A derived hydrogen where it stands: the glyph, the stem that will be drawn
 * to it — from the edge of its host's label to the edge of its "H" — its
 * padded clear space as boxes, and how crowded it is against everything that
 * never moves, which is worked out once per place.
 */
interface Placed {
  readonly hydrogen: PhantomHydrogen;
  readonly stem: { readonly a: ScenePoint; readonly b: ScenePoint };
  readonly clearBoxes: readonly LabelBox[];
  /** Round everything above, stroke included: two places whose bounds are
   *  apart cannot touch, and most pairs on a page are. */
  readonly bounds: LabelBox;
  readonly fixed: Score;
}

/**
 * How crowded a place is, worst first: bonds the hydrogen is on the far side
 * of from its host; glyphs its "H" shares ink with; other marks whose ink its
 * glyph or stem touches; marks whose clear space it enters. Lower is better,
 * compared in that order.
 *
 * ACROSS A BOND IS ITS OWN TIER, above everything. A hydrogen touching a
 * label is a crowded mark; a hydrogen across a bond is a WRONG one — it reads
 * as attached to whatever is on that side, inside a ring it has nothing to do
 * with. Counted with the ink, the two tied, and a methyl's hydrogen took the
 * inside of the ring next to it as no worse than a brush with a label.
 *
 * LETTERS COME NEXT. Two glyphs sharing ink print as one word — "HH" beside
 * one carbon is a formula, "HC" a group — which is a misreading; a line
 * touching a glyph, or a stem grazing one, is a crowded picture that still
 * reads.
 */
interface Score {
  readonly across: number;
  readonly letters: number;
  readonly ink: number;
  readonly clear: number;
}

const ZERO: Score = Object.freeze({ across: 0, letters: 0, ink: 0, clear: 0 });

/**
 * Every phantom hydrogen the representation asks for, in the molecule's own
 * insertion order.
 *
 * Empty unless `showImplicitHydrogens` is on, which in practice means the
 * explicitH and lewis views — so the other two pay one boolean for it.
 *
 * `placements` AND `bondInk` ARE REQUIRED, not optional with a fallback.
 * Where a hydrogen ends up depends on how far its host's label reaches and on
 * which bonds are drawn where, so a caller that could omit either would get a
 * different answer from the one that supplied them — and `scene/build.ts`
 * would then trim the stem against a label `scene/collide.ts` had never seen.
 * `derivedHydrogens` in `scene/build.ts` builds both the way `buildScene` does,
 * and is what a caller outside the scene build should use.
 *
 * `skipHosts` is the one input that may be left out: the atoms whose
 * hydrogens a projection draws itself, folds into a group's word, or does not
 * show. Their hydrogens are not placed and are not in anyone's way, so a
 * hydrogen the page never shows cannot turn one it does.
 *
 * PURE AND NOT MEMOISED, exactly like `atomLabelPlacement`, which it is a
 * sibling of: a caller running it per pointer-move should cache on the
 * molecule instance rather than expect this to.
 *
 * ORDER-DEPENDENT, AND THE ORDER IS THE MOLECULE'S. Which of two crowded
 * hydrogens gets the pocket between them is decided by `mol.atomIds`, and by
 * the fixed ladders each works through. That is the same trade
 * `pushDescriptorPrimitives` makes for the same reason: the alternative is a
 * global arrangement search whose answer would reshuffle on a float tie, and
 * a figure that reshuffles between two runs of the same molecule is not a
 * figure anyone can diff. Placing a hydrogen ONE AT A TIME rather than a whole
 * atom's fan at a time is what lets a lone crowded hydrogen turn while its
 * siblings stay exactly where the fan put them.
 */
export function phantomHydrogens(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
  bondInk: BondInk,
  skipHosts: ReadonlySet<AtomId> = NO_HOSTS,
): PhantomHydrogen[] {
  if (!representation.flags.showImplicitHydrogens) return [];

  const slots = hydrogenSlots(mol, style, representation, placements, bondInk, skipHosts);
  const page: Page = {
    slots,
    style,
    placed: slots.map(() => undefined),
    memo: slots.map((slot) => slot.gaps.map(() => [])),
    aims: slots.map((slot) => slot.gaps.map(() => new Map<number, Aim>())),
    clock: 0,
    touched: slots.map(() => 0),
    searched: slots.map(() => 0),
  };

  // ONE AT A TIME, against everything already on the page.
  for (let s = 0; s < slots.length; s++) {
    move(page, [s], [bestPlace(page, s).placed]);
    page.searched[s] = page.clock;
  }

  // THEN AGAIN, for whatever is still crowded, against the whole page: first
  // each crowded hydrogen on its own, then its host's whole fan turned and
  // spread together. Either moves only when that strictly lowers the page's
  // total. A hydrogen, or a fan, is looked at again only once something near
  // it has moved since it last was: the same search against the same page
  // gives the same answer.
  const hosts = hostGroups(slots);
  const fanned = hosts.map(() => 0);
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const before = page.clock;
    hosts.forEach((group, h) => {
      for (let s = group.first; s <= group.last; s++) {
        if (page.touched[s]! <= page.searched[s]!) continue;
        const current = slotScore(page, s, page.placed[s]!);
        page.searched[s] = page.clock;
        if (isZero(current)) continue;
        const next = bestPlace(page, s);
        if (better(next.score, current)) {
          move(page, [s], [next.placed]);
          page.searched[s] = page.clock;
        }
      }
      if (group.last === group.first) return;
      let stale = false;
      for (let s = group.first; s <= group.last; s++) {
        if (page.touched[s]! > fanned[h]!) stale = true;
      }
      if (!stale) return;
      fanned[h] = page.clock;
      if (spreadFan(page, group)) fanned[h] = page.clock;
    });
    if (page.clock === before) break;
  }

  return page.placed.map((placed) => placed!.hydrogen);
}

/** The hydrogens being placed, where each currently stands, and the
 *  bookkeeping that keeps the repair passes from repeating a search. */
interface Page {
  readonly slots: readonly Slot[];
  readonly style: RenderStyle;
  readonly placed: (Placed | undefined)[];
  /** Every place tried, per slot, per gap, per rung: a place depends only on
   *  the slot, never on where anything else is, so it is built once. */
  readonly memo: (Placed | undefined)[][][];
  /** Every direction tried, per slot, per gap, by turn. */
  readonly aims: Map<number, Aim>[][];
  /** Bumped by every move. */
  clock: number;
  /** When something near each slot last moved. */
  readonly touched: number[];
  /** When each slot was last searched, or found uncrowded. */
  readonly searched: number[];
}

/** Put hydrogens down, and mark everything near them as having seen a move. */
function move(page: Page, indices: readonly number[], places: readonly Placed[]): void {
  page.clock++;
  indices.forEach((s, i) => {
    page.placed[s] = places[i]!;
    for (const o of page.slots[s]!.neighbours) page.touched[o] = page.clock;
  });
}

/** One host's slots, which `hydrogenSlots` emits contiguously. */
interface HostGroup {
  readonly first: number;
  readonly last: number;
}

function hostGroups(slots: readonly Slot[]): HostGroup[] {
  const out: HostGroup[] = [];
  let first = 0;
  for (let s = 1; s <= slots.length; s++) {
    if (s === slots.length || slots[s]!.hostAtomId !== slots[first]!.hostAtomId) {
      out.push({ first, last: s - 1 });
      first = s;
    }
  }
  return slots.length === 0 ? [] : out;
}

/**
 * The hydrogens to place, in order, each with the fixed marks near it.
 *
 * Every atom label is placed before any hydrogen is — `atomLabelPlacements`
 * runs to completion first — and every bond is drawn before any hydrogen is,
 * so all of it is known up front and only the hydrogens move.
 */
function hydrogenSlots(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
  bondInk: BondInk,
  skipHosts: ReadonlySet<AtomId>,
): Slot[] {
  const bondPx = pxPerModelUnit(style);
  const localRadius = SEARCH_RADIUS_BONDS * bondPx + style.fontSizePx;

  // THE FIXED MARKS, BUCKETED. A hydrogen three rings away cannot reach this
  // one, and asking every label and bond in a 300-atom import about every
  // host made the setup quadratic; a grid a search radius wide means each
  // host looks at the few cells round it. Each mark goes into every cell its
  // box touches, and a host collects the cells within one of its own, so
  // nothing within the radius is missed. Only WHICH marks are near comes out
  // of the grid, and the lists are put back in the molecule's order, so the
  // answer is the one a scan of everything would give.
  const labels: LabelMarks[] = [];
  for (const atomId of mol.atomIds) {
    const placement = placements.get(atomId);
    if (placement === undefined) continue;
    const clear = placement.obstacles.map(boxOf);
    labels.push({
      atomId,
      ink: placement.inkBoxes,
      clear,
      bounds: unionOf([...clear, ...placement.inkBoxes]),
    });
  }
  const bonds: NearBond[] = [];
  for (const bondId of mol.bondIds) {
    const bond = mol.bonds[bondId];
    const from = bond === undefined ? undefined : getAtom(mol, bond.from);
    const to = bond === undefined ? undefined : getAtom(mol, bond.to);
    if (from === undefined || to === undefined) continue;
    const axis = { a: modelToPx(style, from.pos), b: modelToPx(style, to.pos) };
    const segments = bondInk.get(bondId) ?? [];
    bonds.push({
      bondId,
      segments,
      axis,
      bounds: unionOf([segmentBox(axis), ...segments.map(segmentBox)]),
    });
  }
  const labelGrid = new Grid(localRadius);
  labels.forEach((label, i) => labelGrid.add(label.bounds, i));
  const bondGrid = new Grid(localRadius);
  bonds.forEach((bond, i) => bondGrid.add(bond.bounds, i));

  const slots: Slot[] = [];
  for (const atomId of mol.atomIds) {
    if (skipHosts.has(atomId)) continue;
    const sectors = fan(mol, atomId, representation);
    if (sectors.length === 0) continue;
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;

    const hostCentre = modelToPx(style, atom.pos);
    // MODEL SPACE, then one conversion. The ratio is in bond lengths and
    // `modelToPx` does the only scaling and the only y-flip; the scale is
    // isotropic, so one measurement serves every direction.
    const ratioTip = modelToPx(style, {
      x: atom.pos.x + style.explicitHydrogenLengthRatio,
      y: atom.pos.y,
    });
    const baseDistance = Math.abs(ratioTip.x - hostCentre.x);
    // The visible-stem floor, measured the same way. Never below the
    // line-width floor, which is what keeps a style with a tiny or zero ratio
    // from drawing a stem `bondAxis` would refuse.
    const stemTip = modelToPx(style, {
      x: atom.pos.x + style.explicitHydrogenMinStemRatio,
      y: atom.pos.y,
    });
    const minStem = Math.max(
      Math.abs(stemTip.x - hostCentre.x),
      MIN_STEM_LINE_WIDTHS * style.bondLineWidthPx,
    );

    const near = labelGrid
      .around(hostCentre, 1)
      .map((i) => labels[i]!)
      .filter((label) => withinRadius(label.bounds, hostCentre, localRadius));
    const own = new Set(bondsAt(mol, atomId).map((bond) => bond.id));
    const nearBonds = bondGrid
      .around(hostCentre, 1)
      .map((i) => bonds[i]!)
      .filter(
        (bond) => !own.has(bond.bondId) && withinRadius(bond.bounds, hostCentre, localRadius),
      );

    const hostPlacement = placements.get(atomId);
    const fallbacks = fallbackGaps(mol, atomId, sectors);
    sectors.forEach((sector, index) => {
      slots.push({
        id: phantomHydrogenId(atomId, index),
        hostAtomId: atomId,
        index,
        hostPos: atom.pos,
        gaps: [slotGap(sector), ...fallbacks],
        hostCentre,
        hostPlacement,
        baseDistance,
        minStem,
        inkLabels: near,
        clearLabels: near.filter((label) => label.atomId !== atomId),
        bonds: nearBonds,
        neighbours: [],
      });
    });
  }

  // Which slots can reach which: hosts within twice the radius, since each
  // hydrogen stays within the radius of its own host. A host's siblings are
  // always in its list.
  const hostGrid = new Grid(2 * localRadius);
  slots.forEach((slot, s) => hostGrid.add(pointBox(slot.hostCentre), s));
  const reach = 2 * localRadius;
  return slots.map((slot, s) => ({
    ...slot,
    neighbours: hostGrid
      .around(slot.hostCentre, 1)
      .filter(
        (o) =>
          o !== s &&
          Math.abs(slots[o]!.hostCentre.x - slot.hostCentre.x) <= reach &&
          Math.abs(slots[o]!.hostCentre.y - slot.hostCentre.y) <= reach,
      ),
  }));
}

/**
 * A square grid of buckets, for finding the marks near a point without
 * looking at all of them. `around` returns indices ascending, so a caller
 * iterating it sees the same order a full scan would have.
 */
class Grid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly size: number) {}

  add(box: LabelBox, index: number): void {
    const x0 = Math.floor(box.minX / this.size);
    const x1 = Math.floor(box.maxX / this.size);
    const y0 = Math.floor(box.minY / this.size);
    const y1 = Math.floor(box.maxY / this.size);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y);
        const cell = this.cells.get(key);
        if (cell === undefined) this.cells.set(key, [index]);
        else if (cell[cell.length - 1] !== index) cell.push(index);
      }
    }
  }

  around(point: ScenePoint, rings: number): number[] {
    const cx = Math.floor(point.x / this.size);
    const cy = Math.floor(point.y / this.size);
    const out: number[] = [];
    for (let x = cx - rings; x <= cx + rings; x++) {
      for (let y = cy - rings; y <= cy + rings; y++) {
        const cell = this.cells.get(cellKey(x, y));
        if (cell !== undefined) out.push(...cell);
      }
    }
    out.sort((a, b) => a - b);
    // A mark spanning several cells is listed once per cell.
    return out.filter((index, i) => i === 0 || out[i - 1] !== index);
  }
}

/** One number per cell. A figure is thousands of px across and a cell a
 *  hundred, so a cell index never comes near the 2^20 this packs into. */
function cellKey(x: number, y: number): number {
  return (x + 0x80000) * 0x100000 + (y + 0x80000);
}

/**
 * The other gaps a hydrogen may be placed in when its own has no room: every
 * gap between the host's bonds but the one the fan chose.
 *
 * ONLY A LONE HYDROGEN ON A BRANCH OR FUSED CARBON, AND ONLY AWAY FROM
 * STEREO (decision 183). The case is a ring-fusion CH, whose one outside gap
 * can hold another ring's angular methyl — the steroid's C9, facing C19 — so
 * that its hydrogen has nowhere outside to go. Steroid figures put such a hydrogen
 * inside the ring beside its junction, and so may this, since a ring's inside
 * is also room the host's bonds leave. A second hydrogen on the same carbon
 * could not follow its sibling into another gap without splitting the fan, so
 * a host with more than one keeps its gap.
 *
 * NEVER AT A CENTRE WITH A STEREO BOND. Moving the hydrogen into another gap
 * changes the cyclic order of the substituents round the host, and beside a
 * wedge or a hash that order is the configuration the reader reads. Only a
 * host whose bonds are all plain may change gap: its picture asserts no
 * configuration for the hydrogen's side to contradict.
 */
function fallbackGaps(
  mol: Molecule,
  atomId: AtomId,
  sectors: readonly FanSector[],
): SlotGap[] {
  const only = sectors[0];
  if (only === undefined || sectors.length !== 1) return [];
  const bonds = bondsAt(mol, atomId);
  if (bonds.length < 3 || bonds.some((bond) => bond.stereo !== "none")) return [];
  return angularGaps(bondDirections(mol, atomId))
    .filter((gap) => normalizeAnglePositive(only.angle - gap.start) >= gap.width)
    .map(slotGap);
}

function slotGap(sector: FanSector): SlotGap {
  // How far round the gap the angle sits. Strictly inside it by
  // construction, so this never wraps.
  const offset = normalizeAnglePositive(sector.angle - sector.start);
  const limits = turnLimits(offset, sector.width);
  return {
    angle: sector.angle,
    minTurn: limits.min,
    maxTurn: limits.max,
    offset,
    width: sector.width,
  };
}

/**
 * The least crowded place for one hydrogen, against every other hydrogen on
 * the page: the fanned place if nothing is crowded there, otherwise the first
 * rung of the ladder that does strictly better than everything before it,
 * stopping at the first rung with nothing crowded at all. The ladder is
 * climbed in the fan's own gap first, then in each fallback gap, so a
 * hydrogen changes gap only for a place strictly better than any its own gap
 * has.
 *
 * THE FANNED PLACE IS BOTH THE FIRST ANSWER AND THE LAST. It is tried before
 * any departure, so an uncrowded structure gets exactly the drawing it always
 * got; and it is what a hydrogen keeps when no departure does better, because
 * moving a mark that stays exactly as crowded has invented a place for nothing.
 */
function bestPlace(page: Page, s: number): { readonly placed: Placed; readonly score: Score } {
  const slot = page.slots[s]!;
  let placed = rung(page, s, 0, 0);
  let best = slotScore(page, s, placed);
  for (let g = 0; g < slot.gaps.length && !isZero(best); g++) {
    const gap = slot.gaps[g]!;
    // Rung 0 is the fanned place, already tried for the fan's own gap.
    for (let r = g === 0 ? 1 : 0; r < RUNGS.length; r++) {
      const candidate = RUNGS[r]!;
      // A turn that has left the gap is no answer at all, however free the
      // page is out there.
      if (candidate.turn < gap.minTurn || candidate.turn > gap.maxTurn) continue;
      const trial = rung(page, s, g, r);
      // Other hydrogens only ever add to a place's score, so one whose fixed
      // marks alone are no better than the best cannot become better.
      if (!better(trial.fixed, best)) continue;
      const score = slotScore(page, s, trial);
      if (!better(score, best)) continue;
      placed = trial;
      best = score;
      if (isZero(best)) break;
    }
  }
  return { placed, score: best };
}

/** The fanned place and then the ladder, as one list of rungs. */
const RUNGS: readonly SeparationCandidate[] = Object.freeze([
  { turn: 0, stretch: 0 },
  ...SEPARATION_CANDIDATES,
]);

/** Slot `s` on rung `r` of gap `g`, built once. */
function rung(page: Page, s: number, g: number, r: number): Placed {
  const row = page.memo[s]![g]!;
  const known = row[r];
  if (known !== undefined) return known;
  const slot = page.slots[s]!;
  const candidate = RUNGS[r]!;
  const placed = placeHydrogen(
    slot,
    slot.gaps[g]!,
    candidate.turn,
    candidate.stretch,
    page.style,
    page.aims[s]![g],
  );
  row[r] = placed;
  return placed;
}

/**
 * Turn and spread a crowded host's whole fan, when that does better than
 * where its hydrogens stand now.
 *
 * WHY THE FAN AS WELL AS EACH HYDROGEN. A methyl's three hydrogens split its
 * one gap into thirds, and when one of them lands on a neighbour's bond the
 * way out is a place a sibling already has: that hydrogen cannot turn onto
 * its sibling, and the sibling, being uncrowded itself, never moves. Turning
 * all of them together keeps their spacing; SPREADING them — drawing the fan
 * in towards the middle of its gap, each hydrogen's offset from the middle
 * cut to `SPREAD_STEPS` of what the fan gave it — frees both edges at once,
 * which is what a methyl wedged between two rings needs. Each hydrogen still
 * stays inside its gap, by the same limits a lone turn has; a combination any
 * of them could not take is skipped.
 *
 * In order of departure, as the ladder is: a turn step and a spread step
 * cost one each, every combination costing 1 is tried before any costing 2,
 * and at equal cost the turn is preferred, because a fan turned is still the
 * fan and a fan squeezed is not. Turns and spreads only — a stretch is a lone
 * hydrogen's lever, and the next pass offers it one.
 */
function spreadFan(page: Page, group: HostGroup): boolean {
  const current: Placed[] = [];
  for (let s = group.first; s <= group.last; s++) current.push(page.placed[s]!);
  let best = fanScore(page, group, current);
  if (isZero(best)) return false;
  let chosen: Placed[] | undefined;
  for (const { turn, keep } of FAN_MOVES) {
    const turns: number[] = [];
    for (let s = group.first; s <= group.last; s++) {
      const gap = page.slots[s]!.gaps[0];
      const t = turn + (keep - 1) * (gap.offset - gap.width / 2);
      if (t < gap.minTurn || t > gap.maxTurn) break;
      turns.push(t);
    }
    if (turns.length !== group.last - group.first + 1) continue;
    const trial = turns.map((t, i) => {
      const slot = page.slots[group.first + i]!;
      return placeHydrogen(slot, slot.gaps[0], t, 0, page.style);
    });
    const score = fanScore(page, group, trial);
    if (!better(score, best)) continue;
    best = score;
    chosen = trial;
    if (isZero(best)) break;
  }
  if (chosen === undefined) return false;
  move(
    page,
    chosen.map((_placed, i) => group.first + i),
    chosen,
  );
  return true;
}

/**
 * How far a fan may be drawn in towards the middle of its gap: each
 * hydrogen's offset from the middle kept at 0.9, 0.8 ... 0.5 of what the fan
 * gave it. Half is the floor because a methyl's three hydrogens at half their
 * spread are 45 degrees apart, which at Publication's stand-off is a glyph's
 * width and its padding and no more.
 */
const SPREAD_STEPS = 5;
const SPREAD_STEP = 0.1;

/** Every turn-and-spread of a fan, in increasing departure: see `spreadFan`. */
const FAN_MOVES: readonly { readonly turn: number; readonly keep: number }[] = Object.freeze(
  buildFanMoves(),
);

function buildFanMoves(): { turn: number; keep: number }[] {
  const turnSteps = Math.round(ROTATION_LIMIT_DEG / ROTATION_STEP_DEG);
  const out: { turn: number; keep: number }[] = [];
  for (let cost = 1; cost <= turnSteps + SPREAD_STEPS; cost++) {
    for (let spread = 0; spread <= Math.min(cost, SPREAD_STEPS); spread++) {
      const turn = cost - spread;
      if (turn > turnSteps) continue;
      const keep = 1 - spread * SPREAD_STEP;
      if (turn === 0) {
        out.push({ turn: 0, keep });
        continue;
      }
      out.push({ turn: turn * ROTATION_STEP_DEG * DEG, keep });
      out.push({ turn: -turn * ROTATION_STEP_DEG * DEG, keep });
    }
  }
  return out;
}

/** Tier by tier: a hydrogen across a bond is worse than any amount of
 *  shared ink, and a mark sharing another's black is worse than any number
 *  of marks merely short of white space. */
function better(a: Score, b: Score): boolean {
  if (a.across !== b.across) return a.across < b.across;
  if (a.letters !== b.letters) return a.letters < b.letters;
  if (a.ink !== b.ink) return a.ink < b.ink;
  return a.clear < b.clear;
}

function isZero(score: Score): boolean {
  return score.across === 0 && score.letters === 0 && score.ink === 0 && score.clear === 0;
}

function plus(a: Score, b: Score): Score {
  return {
    across: a.across + b.across,
    letters: a.letters + b.letters,
    ink: a.ink + b.ink,
    clear: a.clear + b.clear,
  };
}

/**
 * How crowded hydrogen `s` would be at `placed`, against the fixed marks and
 * every other hydrogen on the page.
 *
 * Counted PER MARK — per atom label, per bond, per other hydrogen — which is
 * how `detectCollisions` counts its findings, so the clear count is this
 * hydrogen's share of what that pass would report. A clash with another
 * hydrogen is one count on each of them, and that symmetry is what makes the
 * repair passes a descent: moving this hydrogen changes no count but its own
 * and the ones it shares.
 */
function slotScore(page: Page, s: number, placed: Placed): Score {
  let score = placed.fixed;
  for (const o of page.slots[s]!.neighbours) {
    const other = page.placed[o];
    if (other === undefined) continue;
    score = plus(score, pairScore(placed, other, page.style));
  }
  return score;
}

/**
 * How crowded a host's whole fan would be at `trial`: each hydrogen against
 * the fixed marks and the other hosts' hydrogens, and each pair of siblings
 * once — the fan's exact share of the page's total, so a move that lowers it
 * lowers the total.
 */
function fanScore(page: Page, group: HostGroup, trial: readonly Placed[]): Score {
  let score = ZERO;
  trial.forEach((placed, i) => {
    score = plus(score, placed.fixed);
    for (const o of page.slots[group.first + i]!.neighbours) {
      if (o >= group.first && o <= group.last) continue;
      const other = page.placed[o];
      if (other === undefined) continue;
      score = plus(score, pairScore(placed, other, page.style));
    }
    for (let j = i + 1; j < trial.length; j++) {
      score = plus(score, pairScore(placed, trial[j]!, page.style));
    }
  });
  return score;
}

/**
 * A hydrogen against what never moves: the labels and the bonds near it.
 *
 * ACROSS counts a bond whose axis lies between the hydrogen and its host.
 *
 * LETTERS counts a label whose glyphs or dots its own glyph shares ink with.
 *
 * INK counts a label its stem runs through, and a bond whose stroke its glyph
 * touches or whose drawn line its stem crosses. A stem across a ring bond
 * puts the hydrogen visibly on the far side of it, attached to nothing a
 * reader can follow.
 *
 * CLEAR counts what `detectCollisions` reports: a label whose padded clear
 * space the glyph's enters, and a bond whose line runs through the glyph's.
 */
function fixedScore(
  slot: Slot,
  hydrogen: PhantomHydrogen,
  stem: { readonly a: ScenePoint; readonly b: ScenePoint },
  clearBoxes: readonly LabelBox[],
  style: RenderStyle,
): Score {
  const glyphInk = hydrogen.placement.inkBoxes;
  const obstacles = hydrogen.placement.obstacles;
  const stemHalf = style.bondLineWidthPx / 2;
  // Round the glyph, its padding, its stem and the line back to the host:
  // a mark whose box is clear of this cannot touch any of them.
  const reach = growTo(growTo(emptyBox(), clearBoxes), glyphInk);
  growBy(reach, slot.hostCentre, 0);
  growBy(reach, hydrogen.centre, 0);
  let across = 0;
  let letters = 0;
  let ink = 0;
  let clear = 0;
  for (const label of slot.inkLabels) {
    if (apart(label.bounds, reach, stemHalf)) continue;
    if (anyMeet(glyphInk, label.ink)) letters++;
    else if (stemMeetsInk(stem, stemHalf, label.ink)) ink++;
  }
  for (const label of slot.clearLabels) {
    if (apart(label.bounds, reach, 0)) continue;
    if (anyMeet(clearBoxes, label.clear)) clear++;
  }
  for (const bond of slot.bonds) {
    if (apart(bond.bounds, reach, stemHalf)) continue;
    if (segmentsCross(slot.hostCentre, hydrogen.centre, bond.axis.a, bond.axis.b)) across++;
    if (
      bond.segments.some(
        (segment) =>
          segmentMeetsInk(segment, glyphInk) || segmentsCross(stem.a, stem.b, segment.a, segment.b),
      )
    ) {
      ink++;
    }
    if (bond.segments.some((segment) => segmentEntersObstacles(segment, obstacles))) clear++;
  }
  return { across, letters, ink, clear };
}

/**
 * Two hydrogens against each other: one letters count if their glyphs share
 * ink, otherwise one ink count if either's stem touches the other's glyph or
 * stem, and one clear count if their padded clear spaces meet. Symmetric, so
 * it is the same count whichever of the two is asking.
 */
function pairScore(a: Placed, b: Placed, style: RenderStyle): Score {
  if (apart(a.bounds, b.bounds, 0)) return ZERO;
  const inkA = a.hydrogen.placement.inkBoxes;
  const inkB = b.hydrogen.placement.inkBoxes;
  const stemHalf = style.bondLineWidthPx / 2;
  const letters = anyMeet(inkA, inkB) ? 1 : 0;
  const ink =
    letters === 0 &&
    (stemMeetsInk(a.stem, stemHalf, inkB) ||
      stemMeetsInk(b.stem, stemHalf, inkA) ||
      segmentsCross(a.stem.a, a.stem.b, b.stem.a, b.stem.b))
      ? 1
      : 0;
  const clear = anyMeet(a.clearBoxes, b.clearBoxes) ? 1 : 0;
  return { across: 0, letters, ink, clear };
}

/**
 * One derived hydrogen at one departure from its fanned place: the direction,
 * the stand-off, the glyph, the stem `bondAxis` will draw to it, and how
 * crowded that is against what never moves.
 *
 * The stand-off is the pre-existing rule and is unchanged by the separation
 * search — base ratio, pushed out only far enough that the two trims
 * `bondAxis` will apply leave `minStem` of visible line between them — and the
 * search's stretch is added on top.
 */
function placeHydrogen(
  slot: Slot,
  gap: SlotGap,
  turn: number,
  stretchRatio: number,
  style: RenderStyle,
  aims?: Map<number, Aim>,
): Placed {
  const aim = aimAt(slot, gap, turn, style, aims);
  const { direction, back, hostReach, hydrogenReach } = aim;
  const hostCentre = slot.hostCentre;
  let centre = aim.centre;
  let placement = aim.placement;

  const clear = hostReach + hydrogenReach + slot.minStem;
  // THE SEPARATION SEARCH'S STRETCH IS ADDED AFTER THE FLOOR, NOT FOLDED INTO
  // IT. Folded in, `Math.max` ate it: at Publication the two trims alone come
  // to more than the 0.66 stand-off, so the floor wins, and the first several
  // steps of the ladder moved the glyph nowhere at all — the search burned
  // through them and then reported a crowding it could have resolved. Added
  // afterwards, every step of the ladder is a step on the page.
  const distance = Math.max(slot.baseDistance, clear) + stretchRatio * pxPerModelUnit(style);
  if (distance > slot.baseDistance) {
    centre = along(hostCentre, direction, distance);
    placement = placeHydrogenLabel(slot, centre, style);
  }

  const hydrogen: PhantomHydrogen = {
    hostAtomId: slot.hostAtomId,
    index: slot.index,
    centre,
    placement,
  };
  const stem = {
    a: along(hostCentre, direction, hostReach),
    b: along(centre, back, hydrogenReach),
  };
  const clearBoxes = placement.obstacles.map(boxOf);
  const half = style.bondLineWidthPx / 2;
  const bounds = growTo(growTo(emptyBox(), clearBoxes), placement.inkBoxes);
  growBy(bounds, stem.a, half);
  growBy(bounds, stem.b, half);
  return {
    hydrogen,
    stem,
    clearBoxes,
    bounds,
    fixed: fixedScore(slot, hydrogen, stem, clearBoxes, style),
  };
}

/**
 * One direction off the host, and what does not depend on how far along it
 * the hydrogen stands: the glyph at the base stand-off, and the two trims.
 *
 * Kept per direction because the ladder tries every stretch at each turn,
 * and every one of them starts here.
 */
interface Aim {
  readonly direction: ScenePoint;
  readonly back: ScenePoint;
  readonly centre: ScenePoint;
  readonly placement: AtomLabelPlacement;
  readonly hostReach: number;
  readonly hydrogenReach: number;
}

function aimAt(
  slot: Slot,
  gap: SlotGap,
  turn: number,
  style: RenderStyle,
  aims: Map<number, Aim> | undefined,
): Aim {
  const known = aims?.get(turn);
  if (known !== undefined) return known;
  const direction = sceneDirection(style, slot.hostPos, gap.angle + turn);
  const back: ScenePoint = { x: -direction.x, y: -direction.y };
  const centre = along(slot.hostCentre, direction, slot.baseDistance);
  const placement = placeHydrogenLabel(slot, centre, style);
  // EXACTLY the two trims `bondAxis` will apply to the stem, asked of the
  // same placements through the same function, so the arithmetic in
  // `placeHydrogen` is the stem's real length and not an estimate of it. A
  // "H" carries no dots and no hydrogens of its own, so its obstacles are a
  // translation of themselves and this reach does not change when the glyph
  // moves.
  const aim: Aim = {
    direction,
    back,
    centre,
    placement,
    hostReach:
      slot.hostPlacement === undefined ? 0 : trimDistance(slot.hostPlacement, direction),
    hydrogenReach: trimDistance(placement, back),
  };
  aims?.set(turn, aim);
  return aim;
}

function placeHydrogenLabel(
  slot: Slot,
  centre: ScenePoint,
  style: RenderStyle,
): AtomLabelPlacement {
  return placeAtomLabel({
    atomId: slot.id,
    centre,
    // Its one neighbour is its host, which is what orients the glyph and
    // gives `freeDirection` something to work from.
    neighbourCentres: [slot.hostCentre],
    label: hydrogenLabel(slot.id),
    style,
  });
}

/** A box that grows: see `growTo` and `growBy`. */
interface GrowingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyBox(): GrowingBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growTo(box: GrowingBox, boxes: readonly LabelBox[]): GrowingBox {
  for (const other of boxes) {
    if (other.minX < box.minX) box.minX = other.minX;
    if (other.minY < box.minY) box.minY = other.minY;
    if (other.maxX > box.maxX) box.maxX = other.maxX;
    if (other.maxY > box.maxY) box.maxY = other.maxY;
  }
  return box;
}

function growBy(box: GrowingBox, point: ScenePoint, margin: number): GrowingBox {
  if (point.x - margin < box.minX) box.minX = point.x - margin;
  if (point.y - margin < box.minY) box.minY = point.y - margin;
  if (point.x + margin > box.maxX) box.maxX = point.x + margin;
  if (point.y + margin > box.maxY) box.maxY = point.y + margin;
  return box;
}

function boxOf(obstacle: LabelObstacle): LabelBox {
  if (obstacle.kind === "rect") return obstacle.box;
  return {
    minX: obstacle.centre.x - obstacle.radius,
    minY: obstacle.centre.y - obstacle.radius,
    maxX: obstacle.centre.x + obstacle.radius,
    maxY: obstacle.centre.y + obstacle.radius,
  };
}

/** True when the two boxes are further apart than `margin`: nothing inside
 *  one can touch anything inside the other. */
function apart(a: LabelBox, b: LabelBox, margin: number): boolean {
  return (
    a.maxX < b.minX - margin ||
    a.minX > b.maxX + margin ||
    a.maxY < b.minY - margin ||
    a.minY > b.maxY + margin
  );
}

/** True when any of `a` meets any of `b`. */
function anyMeet(a: readonly LabelBox[], b: readonly LabelBox[]): boolean {
  for (const box of a) {
    for (const other of b) {
      if (boxesMeet(box, other)) return true;
    }
  }
  return false;
}

/** Strict overlap. Two boxes sharing an edge are touching, not overlapping. */
function boxesMeet(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) &&
    Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY)
  );
}

/** Whether a drawn segment's stroke touches any of a glyph's ink boxes. The
 *  stroke's half width is taken off the segment and added to the box, as a
 *  negative inset. */
function segmentMeetsInk(segment: AnnotationSegment, ink: readonly LabelBox[]): boolean {
  const half = segment.halfWidth ?? 0;
  for (const box of ink) {
    if (segmentEntersBox(segment.a, segment.b, box, -half)) return true;
  }
  return false;
}

/** Whether a stem, stroked at `half` either side, touches any ink box. */
function stemMeetsInk(
  stem: { readonly a: ScenePoint; readonly b: ScenePoint },
  half: number,
  ink: readonly LabelBox[],
): boolean {
  for (const box of ink) {
    if (segmentEntersBox(stem.a, stem.b, box, -half)) return true;
  }
  return false;
}

/** Proper crossing of two open segments: sharing an end is not crossing. */
function segmentsCross(p1: ScenePoint, p2: ScenePoint, q1: ScenePoint, q2: ScenePoint): boolean {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return false;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / denominator;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / denominator;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * Whether a drawn segment's centre line enters the glyph's padded clear
 * space — `detectCollisions`' bond test, answered exactly rather than by its
 * 33 samples, so a line the samples would miss across a corner is still one
 * this search keeps off.
 */
function segmentEntersObstacles(
  segment: AnnotationSegment,
  obstacles: readonly LabelObstacle[],
): boolean {
  for (const obstacle of obstacles) {
    if (segmentEntersBox(segment.a, segment.b, boxOf(obstacle), TOUCHING_EPSILON_PX)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the segment a→b passes through the open box shrunk by `inset` —
 * Liang–Barsky, so the answer is exact and a segment that only touches an
 * edge does not count.
 */
function segmentEntersBox(
  a: ScenePoint,
  b: ScenePoint,
  box: LabelBox,
  inset: number,
): boolean {
  const minX = box.minX + inset;
  const maxX = box.maxX - inset;
  const minY = box.minY + inset;
  const maxY = box.maxY - inset;
  if (minX >= maxX || minY >= maxY) return false;
  // The segment's own box first: most boxes asked about are nowhere near.
  if (
    Math.max(a.x, b.x) <= minX ||
    Math.min(a.x, b.x) >= maxX ||
    Math.max(a.y, b.y) <= minY ||
    Math.min(a.y, b.y) >= maxY
  ) {
    return false;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Clipped against x, then y, written out rather than looped or wrapped in
  // a closure: this runs for every mark near every trial place.
  let t0 = 0;
  let t1 = 1;
  if (dx === 0) {
    if (a.x <= minX || a.x >= maxX) return false;
  } else {
    let near = (minX - a.x) / dx;
    let far = (maxX - a.x) / dx;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
  }
  if (dy === 0) {
    if (a.y <= minY || a.y >= maxY) return false;
  } else {
    let near = (minY - a.y) / dy;
    let far = (maxY - a.y) / dy;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
  }
  return t0 < t1;
}

function withinRadius(box: LabelBox, point: ScenePoint, radius: number): boolean {
  return (
    box.minX <= point.x + radius &&
    box.maxX >= point.x - radius &&
    box.minY <= point.y + radius &&
    box.maxY >= point.y - radius
  );
}

/** The box round a segment's two ends. */
function segmentBox(segment: { readonly a: ScenePoint; readonly b: ScenePoint }): LabelBox {
  return {
    minX: Math.min(segment.a.x, segment.b.x),
    minY: Math.min(segment.a.y, segment.b.y),
    maxX: Math.max(segment.a.x, segment.b.x),
    maxY: Math.max(segment.a.y, segment.b.y),
  };
}

function pointBox(point: ScenePoint): LabelBox {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

/** The box round several boxes. */
function unionOf(boxes: readonly LabelBox[]): LabelBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    if (box.minX < minX) minX = box.minX;
    if (box.minY < minY) minY = box.minY;
    if (box.maxX > maxX) maxX = box.maxX;
    if (box.maxY > maxY) maxY = box.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/** `from` plus `distance` along a unit direction. Scene px throughout — no
 *  scaling, no flip, nothing this file is not allowed to do. */
function along(from: ScenePoint, direction: ScenePoint, distance: number): ScenePoint {
  return {
    x: from.x + direction.x * distance,
    y: from.y + direction.y * distance,
  };
}

/**
 * The label a phantom hydrogen draws: a bare "H", and nothing else.
 *
 * Built here rather than through `composeAtomLabel`, which takes an atom id
 * that has to resolve in the molecule — and a phantom hydrogen deliberately
 * has no atom to resolve to. A derived hydrogen carries no isotope (the mass
 * number belongs to the atom it was derived FROM), no charge, no radical and
 * no lone pair of its own: every one of those is a property of the heavy atom
 * whose valence produced it, and drawing one on the H would attribute it to
 * the wrong centre.
 */
function hydrogenLabel(atomId: AtomId): ComposedLabel {
  return {
    atomId,
    element: "H",
    reason: "non-carbon",
    isotope: [],
    symbol: [{ text: "H" }],
    hydrogens: [],
    charge: [],
    hydrogenCount: 0,
    radicalDotCount: 0,
    lonePairCount: 0,
    chargeDetached: false,
  };
}

/**
 * The atoms a phantom hydrogen could plausibly collide with: its host's
 * neighbours and its host's neighbours' neighbours.
 *
 * Not used for drawing — `detectCollisions` walks every atom anyway — but
 * exported because it is the honest statement of what "crowded" means here:
 * a hydrogen fanned off a fused-ring vertex has nowhere to go but toward the
 * ring's other side.
 */
export function crowdingCandidates(
  mol: Molecule,
  hostAtomId: AtomId,
): readonly AtomId[] {
  const out = new Set<AtomId>();
  for (const neighbourId of neighborIds(mol, hostAtomId)) {
    out.add(neighbourId);
    for (const second of neighborIds(mol, neighbourId)) {
      if (second !== hostAtomId) out.add(second);
    }
  }
  return [...out];
}
