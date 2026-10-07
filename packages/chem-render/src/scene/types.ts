/**
 * The scene IR: a flat, backend-agnostic description of a drawn molecule.
 *
 * A scene sits between the chemistry and any particular output. SVG is the
 * first consumer, but a canvas painter, a PDF writer and a hit-tester all want
 * the same thing — "there is a line from here to there, this thick, and it
 * came from bond b3" — and none of them should have to re-derive it from the
 * molecule.
 *
 * ALL COORDINATES HERE ARE FINAL PX WITH Y ALREADY FLIPPED (y-down, as SVG
 * wants it). `modelToPx` in style.ts is the only place that conversion
 * happens; by the time a value reaches this file it is done. A consumer that
 * multiplies by a bond length or negates a y is a bug.
 *
 * Every primitive carries a `source` back-reference to the atom or bond it was
 * drawn for. That is what makes a click on a line select the right bond, and
 * what lets a later pass restyle "the primitives belonging to this atom"
 * without re-running the build.
 */

import type { AtomId, BondId } from "@starter/chem-core";

import type { Representation } from "../representation.js";
import type { SchemeAnnotationId } from "../scheme/annotation.js";
import type { RenderStyle } from "../style.js";
import type { FontWeight } from "../text/metrics.js";

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What a primitive was drawn for.
 *
 * `ring` exists for the one thing a molecule draws that is neither an atom nor
 * a bond: the inscribed circle of an aromatic ring. A ring has no id in
 * chem-core — it is an index into `rings(mol)`, and an index is exactly the
 * iteration counter the determinism note below forbids — so the ring names
 * itself by its ATOM SET, ordered by index in `mol.atomIds`. Clicking the
 * circle can then select the ring the delocalisation belongs to.
 *
 * `hydrogen` is the fully-explicit view's phantom vertex. It has no id in
 * chem-core either — hydrogens are IMPLICIT, derived from valence and never
 * stored as atoms — so it names itself by its host and its index within that
 * host’s own fan.
 *
 * IT IS NOT SOURCED FROM THE HOST ATOM, and the temptation to do that is
 * exactly the trap. The editor buckets primitives by `source.atomId` to size
 * an atom’s pick target, so a phantom hydrogen filed under its host would
 * swell that target to enclose the hydrogens and undo the bond-length fix that
 * pick radius already needed. A separate arm also makes every exhaustive
 * switch on `SceneSource` a compile error until it is handled, which is how
 * the SVG serialiser and the canvas layer learned about it.
 *
 * `projected` is a node a PROJECTION drew that is not one atom: a Fischer
 * arm's synthetic hydrogen (`a3.H`), a condensed "CH2OH" (`a11.CH2OH`). It
 * names the layout node and every source atom the node stands for — the
 * layout's provenance (decision 147) — so a click on "CH2OH" selects C6 AND
 * O6, and a synthetic H selects its centre. Not the `atom` arm, for the
 * reason `hydrogen` is not: filing a condensed label under one atom would
 * grow that atom's pick target to the whole word and select half the group.
 *
 * `annotation` is a STORED scheme annotation the document holds beside its
 * molecule — today a curly arrow's shaft and head — named by its `ann_<n>` id
 * so a click on the arrow can select it and a delete can remove it. Not
 * `decoration`: that is what hit-testing ignores, and an arrow filed there
 * could be neither selected nor deleted. Not the `atom` or `bond` arm of an
 * end it is anchored to, either, or a click on the arrow would select the
 * atom it points at.
 *
 * `decoration` covers the things that belong to no model entity — the
 * background rect, a frame, the glyph run of a sum formula. Hit-testing
 * ignores them, and they must never be handed an atom or bond id just to make
 * the type simpler.
 */
export type SceneSource =
  | { readonly kind: "atom"; readonly atomId: AtomId }
  | { readonly kind: "bond"; readonly bondId: BondId }
  | { readonly kind: "ring"; readonly atomIds: readonly AtomId[] }
  | {
      readonly kind: "hydrogen";
      readonly hostAtomId: AtomId;
      readonly index: number;
    }
  | {
      readonly kind: "projected";
      readonly nodeId: string;
      readonly atomIds: readonly AtomId[];
    }
  | { readonly kind: "annotation"; readonly annotationId: SchemeAnnotationId }
  | { readonly kind: "decoration" };

export interface SceneStroke {
  readonly color: string;
  readonly width: number;
  readonly cap?: "butt" | "round" | "square";
  readonly join?: "miter" | "round" | "bevel";
  /** Dash pattern in px, as SVG's stroke-dasharray takes it. */
  readonly dash?: readonly number[];
}

export interface SceneFill {
  readonly color: string;
}

interface PrimitiveBase {
  /**
   * Stable, deterministic identity — derived from the source, never from a
   * counter that increments as iteration happens to reach things. See the
   * note on `RenderScene` about byte-determinism.
   */
  readonly id: string;
  readonly source: SceneSource;
}

export interface LinePrimitive extends PrimitiveBase {
  readonly type: "line";
  readonly a: ScenePoint;
  readonly b: ScenePoint;
  readonly stroke: SceneStroke;
}

export interface PolylinePrimitive extends PrimitiveBase {
  readonly type: "polyline";
  readonly points: readonly ScenePoint[];
  readonly stroke: SceneStroke;
}

/** Filled shapes: a stereo wedge, an arrowhead. Either paint may be omitted. */
export interface PolygonPrimitive extends PrimitiveBase {
  readonly type: "polygon";
  readonly points: readonly ScenePoint[];
  readonly fill?: SceneFill;
  readonly stroke?: SceneStroke;
}

/**
 * An escape hatch for curves — a hashed wedge's taper, a curly arrow. `d` is
 * raw SVG path data, already in scene px, and is passed through verbatim.
 */
export interface PathPrimitive extends PrimitiveBase {
  readonly type: "path";
  readonly d: string;
  readonly fill?: SceneFill;
  readonly stroke?: SceneStroke;
}

export interface CirclePrimitive extends PrimitiveBase {
  readonly type: "circle";
  readonly centre: ScenePoint;
  readonly radius: number;
  readonly fill?: SceneFill;
  readonly stroke?: SceneStroke;
}

/**
 * One piece of a text run. `script` is what lets "H2O" set its 2 as a real
 * subscript and a charge as a superscript, instead of the renderer parsing
 * digits back out of a flat string.
 */
export interface TextSpan {
  readonly text: string;
  readonly script?: "sub" | "super";
}

export interface TextRunPrimitive extends PrimitiveBase {
  readonly type: "textRun";
  readonly origin: ScenePoint;
  readonly spans: readonly TextSpan[];
  readonly fontFamily: string;
  /** Emitted as `font-weight` only when not "normal" (decision 250). */
  readonly fontWeight: FontWeight;
  readonly fontSizePx: number;
  readonly fill: SceneFill;
  readonly anchor: "start" | "middle" | "end";
  /*
   * No baseline mode: `origin.y` is ALWAYS the alphabetic baseline, and a run
   * that is laid out centred converts with the measurer's `baselineYPx` before
   * it becomes a primitive. `dominant-baseline` cannot carry it. Illustrator
   * ignores the property on import and draws `middle` text on the baseline;
   * Chromium and Inkscape honour `middle` but define it as half the x-height,
   * not the centre of the box the measurer placed; and Chromium re-aligns a
   * smaller sub/superscript span on its own middle line where Inkscape uses
   * the run's. An explicit baseline y lands the same in all three, and on the
   * box that placement and the viewBox were computed from (decision 53).
   */
}

/** Primitives that belong together — the several strokes of one atom label. */
export interface GroupPrimitive extends PrimitiveBase {
  readonly type: "group";
  readonly children: readonly ScenePrimitive[];
}

export type ScenePrimitive =
  | LinePrimitive
  | PolylinePrimitive
  | PolygonPrimitive
  | PathPrimitive
  | CirclePrimitive
  | TextRunPrimitive
  | GroupPrimitive;

export interface SceneBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderScene {
  /**
   * Draw order, and iteration order. Bonds are emitted before atoms so atom
   * decorations paint over the lines that meet them.
   *
   * The order is derived from the molecule's insertion order, and primitive
   * ids from their sources, so rendering the same molecule twice produces
   * byte-identical output. Figures get committed to repositories and diffed;
   * a scene that reshuffles itself between runs makes that worthless.
   */
  readonly primitives: readonly ScenePrimitive[];
  /** Primitive extents grown by style.marginPx. Drives the viewBox. */
  readonly bounds: SceneBounds;
  readonly style: RenderStyle;
  readonly representation: Representation;
}
