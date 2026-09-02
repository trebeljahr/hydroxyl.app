/**
 * Measuring a built scene: where each atom and bond ended up, and how big the
 * ink around them is.
 *
 * The scene IR carries a `source` back-reference on every primitive, but it is
 * a flat draw-ordered list — answering "how big is atom a1 drawn?" from it
 * means walking the whole list. Hover fires on every pointer move, so the walk
 * happens ONCE here, at scene-build time, and everything after is a map
 * lookup.
 *
 * ALL PX HERE ARE SCENE PX, y-down, exactly as `buildScene` emitted them. The
 * one function that returns model units says so in its name's documentation
 * and in the header of every caller: `labelRadius`, which feeds chem-core's
 * `hitTest` and must therefore be in bond lengths.
 *
 * IDS ARE UNTRUSTED, because they arrive from a document — a dropped molfile,
 * localStorage, a selection restored with a saved sketch. A bond called
 * "constructor" indexed into a plain object resolves up Object.prototype and
 * hands back a function instead of a miss. Two places therefore guard: the
 * primitives are bucketed into `Map`s, which have no prototype chain to fall
 * through, and every reach into the molecule itself goes via `lookupAtom` /
 * `lookupBond` at the foot of this file rather than chem-core's `getAtom`
 * directly. Both halves are needed — the maps alone still leave `atomCentre`
 * reading `.pos` off a function.
 */

import { getAtom, getBond, DEFAULT_LABEL_RADIUS } from "@starter/chem-core";
import type { AtomId, BondId, Molecule } from "@starter/chem-core";
import {
  atomLabelPlacement,
  isStructural,
  modelToPx,
  pxPerModelUnit,
  sceneBounds,
  withStyle,
} from "@starter/chem-render";
import type {
  LinePrimitive,
  RenderScene,
  RenderStyle,
  ScenePoint,
  ScenePrimitive,
} from "@starter/chem-render";

import type { Bounds } from "@/state";

export interface SceneIndex {
  readonly scene: RenderScene;
  /** Scene px. `undefined` when the molecule has no such atom. */
  atomCentre(id: AtomId): ScenePoint | undefined;
  /** Measured ink radius around that centre, scene px; 0 when nothing is drawn. */
  atomRadiusPx(id: AtomId): number;
  /** Scene px. The drawn line if there is one, else the two atom positions. */
  bondSegment(id: BondId): { readonly a: ScenePoint; readonly b: ScenePoint } | undefined;
  /** MODEL UNITS (bond lengths), for chem-core's `hitTest`. */
  labelRadius(id: AtomId): number;
}

/**
 * The furthest corner of `box` from `centre`.
 *
 * Circumscribed rather than inscribed because even the symbol block is not
 * exactly centred on the atom — `labelPaddingPx` and the cap band are not
 * symmetric about it — and a radius that stopped at the nearest edge would
 * leave part of the drawn glyph unclickable.
 */
function circumscribedRadius(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  centre: ScenePoint,
): number {
  return Math.max(
    Math.hypot(box.minX - centre.x, box.minY - centre.y),
    Math.hypot(box.maxX - centre.x, box.minY - centre.y),
    Math.hypot(box.minX - centre.x, box.maxY - centre.y),
    Math.hypot(box.maxX - centre.x, box.maxY - centre.y),
  );
}

/** Sole entry point: one walk of the scene, then constant-time lookups. */
export function createSceneIndex(
  scene: RenderScene,
  molecule: Molecule,
): SceneIndex {
  const atomPrimitives = new Map<AtomId, ScenePrimitive[]>();
  const bondPrimitives = new Map<BondId, ScenePrimitive[]>();
  for (const primitive of scene.primitives) {
    bucket(primitive, atomPrimitives, bondPrimitives);
  }

  const style = scene.style;

  /**
   * The same style with no margin, for measuring a single atom's ink.
   *
   * `sceneBounds` grows every box it returns by `style.marginPx` — that is
   * what gives the viewBox its whitespace — and a margin baked into a per-atom
   * radius would inflate every pick target by 16px at the screen preset.
   */
  const zeroMargin = withStyle(style, { marginPx: 0 });

  // The scene and the molecule are both immutable, so a measured radius can
  // never go stale. Caching matters because `labelRadius` is called once per
  // atom per `hitTest`, and `hitTest` runs on every pointer move.
  const radiusCache = new Map<AtomId, number>();

  function atomCentre(id: AtomId): ScenePoint | undefined {
    const atom = lookupAtom(molecule, id);
    if (atom === undefined) return undefined;
    // The MOLECULE is authoritative for where an atom is, not the primitives.
    // An atom that draws nothing at all — `atomDotRadiusPx: 0`, or a carbon
    // whose label is suppressed once labels land — still has a position, and
    // still has to be hoverable and selectable.
    return modelToPx(style, atom.pos);
  }

  function atomRadiusPx(id: AtomId): number {
    const cached = radiusCache.get(id);
    if (cached !== undefined) return cached;
    const measured = measureAtomRadiusPx(id);
    radiusCache.set(id, measured);
    return measured;
  }

  function measureAtomRadiusPx(id: AtomId): number {
    const centre = atomCentre(id);
    if (centre === undefined) return 0;

    // A LABELLED atom is measured from its SYMBOL block, not from everything
    // it draws.
    //
    // The pick radius chem-core's `hitTest` takes is a scalar, so it is the
    // same in every direction. A label's ink box is not: "OH" hangs its
    // hydrogen east of the oxygen the bond actually arrives at. Taking the
    // whole box's furthest corner therefore projects the hydrogen's reach back
    // WEST along the bond, where there is no glyph at all — and at the
    // publication preset that came to 0.52 bond lengths, so the oxygen won the
    // hit test at the midpoint of its own C-O bond. The symbol block is the
    // part that is genuinely centred on the atom, measures 0.31, and leaves
    // the middle half of the bond clickable, which is the property the floor
    // below exists to buy.
    //
    // The trade is deliberate: clicking the hanging "H" of an "OH" picks the
    // bond rather than the oxygen. A directional pick target would serve both,
    // and is not something a single number can express.
    if (isStructural(scene.representation)) {
      const placement = atomLabelPlacement(
        molecule,
        id,
        style,
        scene.representation,
      );
      // Taken from chem-render's own placement rather than re-derived from the
      // emitted `textRun`: the primitive carries the run's origin but not
      // which of its spans is the atom's symbol, so re-splitting it here would
      // be a second implementation of the block order, free to drift.
      if (placement !== undefined) {
        return circumscribedRadius(placement.symbolBox, centre);
      }
    }

    // A bare vertex, or a text view: fall back to the ink the atom actually
    // drew. Measured with chem-render's OWN bounds pass rather than by reading
    // the radii and font sizes back off the primitives here — chem-render is
    // the only thing that knows the half-width a stroke straddles its
    // centreline by, and a second estimate in the client would drift silently,
    // as a pick target that no longer matches the mark under it.
    const primitives = atomPrimitives.get(id);
    if (primitives === undefined || primitives.length === 0) return 0;
    return circumscribedRadius(sceneBounds(primitives, zeroMargin), centre);
  }

  function bondSegment(
    id: BondId,
  ): { readonly a: ScenePoint; readonly b: ScenePoint } | undefined {
    const primitives = bondPrimitives.get(id);
    const line = primitives?.find(isLine);
    // The DRAWN line wins where there is one, and the FIRST of them: the
    // renderer trims bond lines back so they stop clear of an atom label, and
    // a highlight over the untrimmed geometry would stick out past both ends
    // of the line it is meant to be highlighting. A double or triple bond
    // emits several lines and the first is taken: the axis for a leaning
    // double and for a triple, and one of the pair for a centred double,
    // which sits half a gap off the axis — inside the halo's own width.
    if (line !== undefined) return { a: line.a, b: line.b };

    // No line primitive: a text view, or a bond whose whole rendering is
    // something else. Fall back to the model geometry so the overlay still has
    // somewhere to draw, exactly as `atomCentre` falls back to the molecule.
    const bond = lookupBond(molecule, id);
    if (bond === undefined) return undefined;
    const from = lookupAtom(molecule, bond.from);
    const to = lookupAtom(molecule, bond.to);
    if (from === undefined || to === undefined) return undefined;
    return { a: modelToPx(style, from.pos), b: modelToPx(style, to.pos) };
  }

  /**
   * The atom's pick radius in MODEL UNITS, for chem-core's `hitTest`.
   *
   * The measured ink, converted out of px — but never smaller than chem-core's
   * `DEFAULT_LABEL_RADIUS`, and the FLOOR is the whole point of this function.
   *
   * Today an atom is a placeholder dot: 0.9px at the publication preset, 2px
   * at the screen one, which converts to roughly 0.04-0.09 bond lengths. Handed
   * to `hitTest` literally, that is a pick target a twentieth of a bond wide,
   * and a vertex carbon becomes something you have to aim at. The dot is a
   * stand-in for a label the renderer draws only where there is one, not a
   * statement about how big the atom is to click — measuring it as if it were
   * confuses a missing feature with a small one. 0.18 is chem-core's documented bare-vertex
   * target, chosen so the target reaches 0.30 along a standard bond and leaves
   * the middle 40% of every bond clickable.
   *
   * When real labels land, the measured value overtakes the floor on its own —
   * an "OCH3" is far wider than 0.18 bond lengths — and nothing in this file
   * changes. That is why it is a floor and not a special case to be removed.
   *
   * THIS RADIUS DOES NOT CHANGE WITH ZOOM, deliberately: it is in model units
   * because the glyph is a fixed size in the drawing, and zooming in shows a
   * bigger picture of the same molecule rather than a molecule with bigger
   * labels. Only the grab TOLERANCE is zoom-dependent, and converting that is
   * pick.ts's job.
   */
  function labelRadius(id: AtomId): number {
    return Math.max(DEFAULT_LABEL_RADIUS, atomRadiusPx(id) / scale(style));
  }

  return { scene, atomCentre, atomRadiusPx, bondSegment, labelRadius };
}

/**
 * `getAtom`/`getBond` behind an own-property guard.
 *
 * chem-core indexes with a plain `mol.atoms[id]`, which is correct for ids it
 * minted itself but not for ids that arrived from a document — a dropped
 * molfile, localStorage, a selection restored from a saved sketch. An atom id
 * of "constructor" resolves up Object.prototype and hands back a function, and
 * the next line reads `.pos` off it and throws; the overlay asks for a centre
 * per selected id, so one poisoned id takes the whole canvas down instead of
 * drawing one halo fewer. `pruneSelection` in the store guards the same way
 * and for the same reason.
 */
function lookupAtom(molecule: Molecule, id: AtomId) {
  return Object.hasOwn(molecule.atoms, id) ? getAtom(molecule, id) : undefined;
}

function lookupBond(molecule: Molecule, id: BondId) {
  return Object.hasOwn(molecule.bonds, id) ? getBond(molecule, id) : undefined;
}

/**
 * px per model unit, guarded.
 *
 * `bondLengthPx` comes from a frozen preset and is always positive today, but
 * a zero would turn every `labelRadius` into Infinity and make the whole
 * canvas one enormous atom — a failure with no visible connection to the
 * style that caused it.
 */
function scale(style: RenderStyle): number {
  const px = pxPerModelUnit(style);
  return Number.isFinite(px) && px > 0 ? px : 1;
}

function isLine(primitive: ScenePrimitive): primitive is LinePrimitive {
  return primitive.type === "line";
}

/**
 * Files a primitive under its source, recursing into groups.
 *
 * A group is filed under its OWN source and its children are then filed under
 * theirs, so a group belonging to atom a1 whose children are individually
 * sourced still measures correctly from either end. The double entry is
 * harmless: `sceneBounds` takes the union of everything it is given, and the
 * union of a box with itself is that box.
 */
function bucket(
  primitive: ScenePrimitive,
  atoms: Map<AtomId, ScenePrimitive[]>,
  bonds: Map<BondId, ScenePrimitive[]>,
): void {
  const source = primitive.source;
  // `decoration` is filed nowhere on purpose: the background rect and the
  // glyph run of a sum formula belong to no atom or bond, and giving them an
  // id just to make the map total is how a click on the formula ends up
  // selecting something.
  if (source.kind === "atom") push(atoms, source.atomId, primitive);
  else if (source.kind === "bond") push(bonds, source.bondId, primitive);

  if (primitive.type === "group") {
    for (const child of primitive.children) bucket(child, atoms, bonds);
  }
}

function push<K>(map: Map<K, ScenePrimitive[]>, key: K, value: ScenePrimitive): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * The scene's extents as the store's `zoomToFit` wants them, in scene px.
 *
 * `scene.bounds` ALREADY INCLUDES `style.marginPx` — `sceneBounds` grows the
 * ink box by the margin on all four sides before returning it. That is why the
 * canvas calls `zoomToFit(fitBounds(scene), 0)` with a zero FRACTIONAL margin:
 * the preset's whitespace is inside the box already, and applying both would
 * inset the figure twice and leave it noticeably small on a fresh load.
 */
export function fitBounds(scene: RenderScene): Bounds {
  const { minX, minY, maxX, maxY } = scene.bounds;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
