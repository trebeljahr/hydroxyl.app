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
 * chem-core's `fanDirections` — the generalisation of the same
 * `largestGapBisector` the drawing tool uses to decide where a new bond
 * sprouts. Asking the same question one way keeps a derived hydrogen from
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
 * NOTHING THE AUTHOR DREW IS EVER MOVED. A derived hydrogen has no coordinate
 * in the molecule, so every number about it — its direction, its distance, its
 * glyph — is this file's invention, and rearranging an invention is not the
 * act `detectCollisions` refuses to perform. What that pass refuses to do is
 * move an ATOM, because the move would survive into the SVG, the molfile and
 * the next reader's understanding of the geometry. A hydrogen has nothing to
 * survive into. The two rules are therefore not in tension, and the boundary
 * between them is exactly the boundary between a stored coordinate and a
 * derived one.
 *
 * WHAT IS THE AUTHOR'S HERE IS THE GAP, NOT THE ANGLE. The fan puts each
 * hydrogen at the middle of an angular gap the author's bonds left empty; any
 * other angle inside that same gap is a direction those same bonds also left
 * empty. So a hydrogen whose glyph lands on a mark already drawn is TURNED,
 * in 3-degree steps out to 60, until it clears — and refused a turn that
 * brings it within 25 degrees of a real bond, which is what keeps it inside
 * the gap it started in. The turn is the smallest that works, so an uncrowded
 * structure gets exactly the fan it always got.
 *
 * TWO STANDARDS, IN THAT ORDER. The search first looks for a place clear of
 * the PADDED boxes `detectCollisions` judges by, which is a mark with white
 * space around it; failing that it settles for the least departure clear of
 * the other marks' INK, which is a mark a reader can still tell from its
 * neighbour. Only the second is guaranteed, and it is the one that matters:
 * two "H" glyphs sharing ink print as "HH" beside one carbon, which is a
 * formula. Asking only for the first was measurably worse — a hydrogen that
 * could not have its padding fell all the way back to the fan and printed on
 * its neighbour after all.
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
 * CROWDING IS STILL REPORTED WHEN NOTHING CLEARS. A vertex with more marks
 * around it than there is page — a style whose labels are half a bond tall,
 * say — exhausts the ladder, and the hydrogen keeps its fanned place and
 * comes out of `detectCollisions` as `hydrogen-over-atom`. An honest overlap
 * beats a mark shoved somewhere it does not belong to make a count come out
 * at zero.
 */

import {
  bondDirections,
  DEG,
  fanDirections,
  fromPolar,
  getAtom,
  implicitHydrogenCount,
  neighborIds,
} from "@starter/chem-core";
import type { AtomId, Molecule, Vec2 } from "@starter/chem-core";

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
 * THE TURN IS WITHIN THE AUTHOR'S OWN GAPS, which is why it is allowed at all.
 * A derived hydrogen has no coordinate in the molecule: the DIRECTION comes
 * out of the angular gaps the author's bonds leave, and anywhere else in that
 * same gap is a direction those same bonds also left empty. `clearsBonds` is
 * what keeps the turn inside the gap — a direction that has come within
 * `MIN_BOND_CLEARANCE_COS`'s angle of a real bond is refused, whatever it
 * would have solved.
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
 * Nothing in the fixture set comes near it; the steroid's two angular methyls
 * do, and they are the most crowded vertices in the corpus.
 */
const ROTATION_LIMIT_DEG = 60;
const ROTATION_STEP_DEG = 3;
const STRETCH_LIMIT_RATIO = 0.4;
const STRETCH_STEP_RATIO = 0.05;

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
  // of these, and kept when none of them works.
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
 * How close to a real bond a turned hydrogen may come, as a cosine.
 *
 * 25 degrees, the same figure `LABEL_PLACEMENT.horizontalBlockHalfAngleDeg`
 * uses for the same underlying reason: inside that angle a mark and a line
 * share enough of the page that the reader attaches the mark to the line. A
 * hydrogen that has drifted within 25 degrees of its host's C–C bond reads as
 * hanging off the wrong end of it.
 *
 * Written as the literal cosine so no `Math.cos` and no `Math.acos` runs on
 * this path — the determinism rule from the placement pass's header.
 */
const MIN_BOND_CLEARANCE_COS = 0.906307787036650;

/**
 * How far from a host a mark has to be before it cannot possibly be hit, in
 * bond lengths.
 *
 * The furthest a hydrogen can get is the clearance floor plus the stretch cap,
 * which is a little over one and a quarter bonds, and its glyph reaches a
 * fraction of a bond past that; `style.fontSizePx` is added on top of these
 * three bonds for the glyph. It is a SPEED filter and nothing else — the
 * margin is wide enough that widening it further cannot change a placement,
 * only the time taken to reach it.
 */
const SEARCH_RADIUS_BONDS = 3;

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
 * order is what keeps the two from being a cycle.
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
  return fanAngles(mol, atomId, representation).map((angle) =>
    sceneDirection(style, atom.pos, angle),
  );
}

/**
 * The MODEL-space angles `atomId`'s derived hydrogens are fanned to, before
 * any separation is applied.
 *
 * Angles rather than scene vectors because the separation pass below turns
 * them: a rotation is one addition here and a matrix everywhere else, and
 * doing it in model space keeps `modelToPx` the only function that knows
 * which way is up.
 */
function fanAngles(
  mol: Molecule,
  atomId: AtomId,
  representation: StructuralRepresentation,
): number[] {
  if (!drawsHydrogenVertices(mol, atomId, representation)) return [];
  if (getAtom(mol, atomId) === undefined) return [];
  const count = implicitHydrogenCount(mol, atomId);
  return fanDirections(bondDirections(mol, atomId), count);
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
  return sceneUnit(style, atomPos, fromPolar(angle, 1));
}

/**
 * A model-space offset from `atomPos` as a unit direction in scene px.
 *
 * Both ends go through `modelToPx`, which is what makes this a conversion
 * rather than a second opinion about which way is up. No `Math.atan2`
 * anywhere near it: a bond's scene direction is its model offset converted,
 * never an angle recovered and re-applied.
 */
function sceneUnit(style: RenderStyle, atomPos: Vec2, offset: Vec2): ScenePoint {
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

/**
 * Every phantom hydrogen the representation asks for, in the molecule's own
 * insertion order.
 *
 * Empty unless `showImplicitHydrogens` is on, which in practice means the
 * explicitH and lewis views — so the other two pay one boolean for it.
 *
 * `placements` IS REQUIRED, not optional with a fallback. Where a hydrogen
 * ends up depends on how far its host's label reaches, so a caller that could
 * omit the placements would get a different answer from the one that supplied
 * them — and `scene/build.ts` would then trim the stem against a label
 * `scene/collide.ts` had never seen. `atomLabelPlacements` builds the map both
 * of them pass.
 *
 * PURE AND NOT MEMOISED, exactly like `atomLabelPlacement`, which it is a
 * sibling of: a caller running it per pointer-move should cache on the
 * molecule instance rather than expect this to. The separation search is what
 * that advice is now worth: a full `buildScene` of the steroid in this view
 * went from 0.28 ms to 0.96 ms with it, and of a 300-atom chain from 2.28 to
 * 3.85 — still a fraction of a frame, and paid only by the two views that
 * draw hydrogens.
 *
 * ORDER-DEPENDENT, AND THE ORDER IS THE MOLECULE'S. Each hydrogen placed
 * becomes a mark the next one has to clear, in both of the sizes a mark has,
 * so which of two crowded hydrogens gets the pocket between them is decided
 * by `mol.atomIds`. That is the same
 * trade `pushDescriptorPrimitives` makes for the same reason: the alternative
 * is a global arrangement search whose answer would reshuffle on a float tie,
 * and a figure that reshuffles between two runs of the same molecule is not a
 * figure anyone can diff. Placing a hydrogen ONE AT A TIME rather than a whole
 * atom's fan at a time is what lets a lone crowded hydrogen turn while its
 * siblings stay exactly where the fan put them.
 */
export function phantomHydrogens(
  mol: Molecule,
  style: RenderStyle,
  representation: StructuralRepresentation,
  placements: ReadonlyMap<AtomId, AtomLabelPlacement | undefined>,
): PhantomHydrogen[] {
  if (!representation.flags.showImplicitHydrogens) return [];

  // EVERY MARK ALREADY ON THE PAGE, in both of the sizes a mark has. All the
  // atom labels are placed before any hydrogen is — `atomLabelPlacements`
  // runs to completion first — so the whole set is known up front and the
  // pass never has to revisit one. `claimed` is the ink, which a hydrogen may
  // never share; `claimedClear` the padded space, which it would rather have.
  const claimed: LabelBox[] = [];
  const claimedClear: LabelBox[] = [];
  for (const atomId of mol.atomIds) {
    const placement = placements.get(atomId);
    if (placement === undefined) continue;
    claimed.push(...placement.inkBoxes);
    for (const obstacle of placement.obstacles) claimedClear.push(boxOf(obstacle));
  }
  const localRadius = SEARCH_RADIUS_BONDS * pxPerModelUnit(style) + style.fontSizePx;

  const out: PhantomHydrogen[] = [];
  for (const atomId of mol.atomIds) {
    const angles = fanAngles(mol, atomId, representation);
    if (angles.length === 0) continue;
    const atom = getAtom(mol, atomId);
    if (atom === undefined) continue;

    const hostCentre = modelToPx(style, atom.pos);
    const hostPlacement = placements.get(atomId);
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
    // The real bonds, as scene unit vectors, so a turned hydrogen can be
    // tested against them with one dot product apiece.
    const bondPx = pxPerModelUnit(style);
    const bondAxes = bondDirections(mol, atomId).map((offset) =>
      sceneUnit(style, atom.pos, offset),
    );
    // Only what is near enough to be hit. The search is O(candidates x marks)
    // and the marks are the whole figure; a hydrogen three rings away cannot
    // reach this one, and filtering once per host keeps a 300-atom import from
    // paying for that. Siblings are appended as they are placed — they are
    // near by construction.
    const nearby = claimed.filter((box) => withinRadius(box, hostCentre, localRadius));
    const nearbyClear = claimedClear.filter((box) =>
      withinRadius(box, hostCentre, localRadius),
    );

    angles.forEach((angle, index) => {
      const id = phantomHydrogenId(atomId, index);
      const at = (turn: number, stretch: number): PhantomHydrogen =>
        placeHydrogen(
          id,
          atomId,
          index,
          sceneDirection(style, atom.pos, angle + turn),
          hostCentre,
          hostPlacement,
          baseDistance,
          stretch * bondPx,
          minStem,
          style,
        );

      // THE FANNED PLACE IS BOTH THE FIRST ANSWER AND THE LAST. It is tried
      // before any departure, so an uncrowded structure gets exactly the
      // drawing it always got; and it is what a hydrogen with nowhere to go
      // keeps, because a drawing that admits it is crowded beats one that has
      // invented somewhere to hide the mark. `detectCollisions` then reports
      // it as `hydrogen-over-atom`, the same call every other overlap in this
      // package gets.
      let chosen = at(0, 0);
      if (!meetsNothing(chosen.placement.inkBoxes, nearby)) {
        const tried: PhantomHydrogen[] = [];
        for (const candidate of SEPARATION_CANDIDATES) {
          // A turn that has swung onto a real bond is no answer at all,
          // however free the page is out there.
          if (
            !clearsBonds(sceneDirection(style, atom.pos, angle + candidate.turn), bondAxes)
          ) {
            continue;
          }
          const placed = at(candidate.turn, candidate.stretch);
          tried.push(placed);
          // FIRST CHOICE IS A PLACE WITH ROOM TO BREATHE — clear of the padded
          // boxes `detectCollisions` judges by, so the hydrogen reads as its
          // own mark rather than as one crammed against its neighbour.
          if (!meetsNothing(clearBoxesOf(placed), nearbyClear)) continue;
          chosen = placed;
          break;
        }
        if (chosen === undefined || !meetsNothing(chosen.placement.inkBoxes, nearby)) {
          // Nowhere with room to breathe. Settle for the least departure that
          // at least keeps the GLYPHS apart, which is the failure a reader
          // actually sees.
          chosen =
            tried.find((placed) => meetsNothing(placed.placement.inkBoxes, nearby)) ??
            chosen;
        }
      }

      out.push(chosen);
      for (const box of chosen.placement.inkBoxes) {
        claimed.push(box);
        nearby.push(box);
      }
      for (const obstacle of chosen.placement.obstacles) {
        const box = boxOf(obstacle);
        claimedClear.push(box);
        nearbyClear.push(box);
      }
    });
  }
  return out;
}

/**
 * One derived hydrogen at one angle: the direction, the stand-off, the glyph.
 *
 * The stand-off is the pre-existing rule and is unchanged by the separation
 * search — base ratio, pushed out only far enough that the two trims
 * `bondAxis` will apply leave `minStem` of visible line between them.
 */
function placeHydrogen(
  id: string,
  hostAtomId: AtomId,
  index: number,
  direction: ScenePoint,
  hostCentre: ScenePoint,
  hostPlacement: AtomLabelPlacement | undefined,
  baseDistance: number,
  stretch: number,
  minStem: number,
  style: RenderStyle,
): PhantomHydrogen {
  const back: ScenePoint = { x: -direction.x, y: -direction.y };
  const place = (centre: ScenePoint): AtomLabelPlacement =>
    placeAtomLabel({
      atomId: id,
      centre,
      // Its one neighbour is its host, which is what orients the glyph and
      // gives `freeDirection` something to work from.
      neighbourCentres: [hostCentre],
      label: hydrogenLabel(id),
      style,
    });

  let centre = along(hostCentre, direction, baseDistance);
  let placement = place(centre);

  // EXACTLY the two trims `bondAxis` will apply to the stem, asked of the
  // same placements through the same function, so the arithmetic below is
  // the stem's real length and not an estimate of it. A "H" carries no
  // dots and no hydrogens of its own, so its obstacles are a translation
  // of themselves and this reach does not change when the glyph moves.
  const hostReach = hostPlacement === undefined ? 0 : trimDistance(hostPlacement, direction);
  const hydrogenReach = trimDistance(placement, back);
  const clear = hostReach + hydrogenReach + minStem;
  // THE SEPARATION SEARCH'S STRETCH IS ADDED AFTER THE FLOOR, NOT FOLDED INTO
  // IT. Folded in, `Math.max` ate it: at Publication the two trims alone come
  // to more than the 0.66 stand-off, so the floor wins, and the first several
  // steps of the ladder moved the glyph nowhere at all — the search burned
  // through them and then reported a crowding it could have resolved. Added
  // afterwards, every step of the ladder is a step on the page.
  const distance = Math.max(baseDistance, clear) + stretch;
  if (distance > baseDistance) {
    centre = along(hostCentre, direction, distance);
    placement = place(centre);
  }

  return { hostAtomId, index, centre, placement };
}

/** The padded boxes a placed hydrogen claims: its glyph's clear space. */
function clearBoxesOf(hydrogen: PhantomHydrogen): LabelBox[] {
  return hydrogen.placement.obstacles.map(boxOf);
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

/** True when none of `boxes` meets a mark already placed. */
function meetsNothing(
  boxes: readonly LabelBox[],
  claimed: readonly LabelBox[],
): boolean {
  for (const box of boxes) {
    for (const other of claimed) {
      if (boxesMeet(box, other)) return false;
    }
  }
  return true;
}

/** Strict overlap. Two boxes sharing an edge are touching, not overlapping. */
function boxesMeet(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) &&
    Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY)
  );
}

function withinRadius(box: LabelBox, point: ScenePoint, radius: number): boolean {
  return (
    box.minX <= point.x + radius &&
    box.maxX >= point.x - radius &&
    box.minY <= point.y + radius &&
    box.maxY >= point.y - radius
  );
}

/**
 * Whether a turned direction is still far enough from every real bond.
 *
 * A dot product against a literal cosine, so no angle is ever recovered and
 * nothing on this path calls `Math.acos` — the determinism rule the placement
 * pass states in its header.
 */
function clearsBonds(
  direction: ScenePoint,
  bondAxes: readonly ScenePoint[],
): boolean {
  for (const axis of bondAxes) {
    if (direction.x * axis.x + direction.y * axis.y > MIN_BOND_CLEARANCE_COS) {
      return false;
    }
  }
  return true;
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
