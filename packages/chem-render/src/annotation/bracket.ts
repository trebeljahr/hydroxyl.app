/**
 * Square brackets around species — a resonance set, a transition state —
 * with the net charge and the double dagger outside the closing one.
 *
 * WHAT A BRACKET ENCLOSES (decisions 204 and 213). The boxes of the species
 * it names (their ink, their coefficients and the label marks beside their
 * atoms, species-box.ts), and every scheme mark drawn between or across them
 * alone: the resonance arrows and plus signs between the forms, a transition
 * state's partial bonds, and any smaller bracket inside. The caller hands
 * those in already laid out; this module only takes their boxes. A mark that
 * reaches a species OUTSIDE the bracket is not enclosed — the arrow from a
 * transition state to its products starts at the bracket, not inside it.
 *
 * THE SUPERSCRIPT, top right OUTSIDE the closing bracket (decision 194, after
 * the IUPAC 2008 graphical-representation recommendations): the transition
 * state's double dagger first, then the charge, both on the bracket's top
 * edge. The charge is text at the formal-charge size — the label size times
 * `subscriptScale`, the size a formal charge on an atom is set at — so the two
 * read as the same kind of statement. The dagger is DRAWN (decision 204):
 * U+2021 is not in the vendored subset, and a glyph from the next face in the
 * stack would be measured at `.notdef` and drawn as a box by resvg.
 *
 * THE CHARGE IS CHECKED, never corrected (decision 212). A resonance
 * bracket's forms each carry the whole charge; a transition state's fragments
 * carry it between them when they carry formal charges at all, and when none
 * does the bracket states it alone (its deltas say where it sits). A stored
 * charge that disagrees is reported.
 *
 * Scene px, y-down.
 */

import { composition, speciesOf } from "@starter/chem-core";
import type { AtomId } from "@starter/chem-core";

import type { LinePrimitive, PolylinePrimitive, ScenePoint, ScenePrimitive, TextRunPrimitive } from "../scene/types.js";
import type { BracketAnnotation } from "../scheme/annotation.js";
import { pxPerModelUnit } from "../style.js";
import type { RenderStyle } from "../style.js";
import { EM_CAP_HEIGHT, glyphInkUnits, UNITS_PER_EM } from "../text/metrics.js";
import { MINUS_SIGN } from "./conditions.js";
import { annotationSource, primitivesBox, SCHEME_LAYOUT, schemeMarkPrimitiveId } from "./scheme-mark.js";
import type { SchemeMarkFinding, SchemeMarkLayout, SchemeMarkSite } from "./scheme-mark.js";
import { unionBoxes } from "./species-box.js";
import type { SchemeBox } from "./species-box.js";

export interface BracketLayout extends SchemeMarkLayout {
  /** The box the two brackets stand on: what they enclose, padded. */
  readonly enclosure: SchemeBox;
  /** One atom per species inside, as stored. */
  readonly species: readonly AtomId[];
  /** The charge's text as printed (`+`, `2−`), when there is one. */
  readonly chargeText?: string;
  /** The superscript's baseline origin, when there is a charge. */
  readonly chargeOrigin?: ScenePoint;
}

/**
 * A charge as a superscript prints it: the number, then the sign, with a real
 * minus; a single charge has no `1` (`+`, `2+`, `−`, `3−`).
 */
export function chargeText(charge: number): string {
  const magnitude = Math.abs(charge);
  const sign = charge > 0 ? "+" : MINUS_SIGN;
  return magnitude === 1 ? sign : `${String(magnitude)}${sign}`;
}

/** The size a bracket's superscript is set at: a formal charge's size. */
export function superscriptSizePx(style: RenderStyle): number {
  return style.fontSizePx * style.subscriptScale;
}

/**
 * The first enclosed species whose net charge disagrees with the stored one
 * — or, for a transition state, the SUM over every enclosed species when that
 * disagrees (decision 212). Undefined when the charge is consistent, or when
 * no charge is stored.
 */
function chargeMismatch(annotation: BracketAnnotation, site: SchemeMarkSite): SchemeMarkFinding | undefined {
  const stored = annotation.charge;
  if (stored === undefined) return undefined;
  const speciesAtoms = (atomId: AtomId): readonly AtomId[] => speciesOf(site.source, atomId)?.atomIds ?? [];
  if (annotation.transitionState === true) {
    // A transition state drawn the usual way carries no formal charge on any
    // atom: its deltas say where the charge sits, and the bracket states it
    // alone. Only a drawing that DOES put formal charges on its fragments is
    // held to them, and then by their sum.
    const all = annotation.species.flatMap(speciesAtoms);
    const charged = all.some((atomId) => (Object.hasOwn(site.source.atoms, atomId) ? site.source.atoms[atomId]!.charge : 0) !== 0);
    if (!charged) return undefined;
    const netCharge = composition(site.source, all).netCharge;
    const first = annotation.species[0];
    return netCharge === stored || first === undefined
      ? undefined
      : { kind: "charge-mismatch", atomId: first, netCharge };
  }
  for (const atomId of annotation.species) {
    const netCharge = composition(site.source, speciesAtoms(atomId)).netCharge;
    if (netCharge !== stored) return { kind: "charge-mismatch", atomId, netCharge };
  }
  return undefined;
}

/**
 * The bracket laid out around its species and `enclosed`, the boxes of the
 * marks inside it; undefined when the panel draws none of its species.
 */
export function layoutBracket(
  annotation: BracketAnnotation,
  site: SchemeMarkSite,
  enclosed: readonly SchemeBox[],
): BracketLayout | undefined {
  const { style } = site;
  let inner = site.boxes.unionOf(annotation.species);
  if (inner === undefined) return undefined;
  for (const box of enclosed) inner = unionBoxes(inner, box);
  if (inner === undefined) return undefined;

  const bond = pxPerModelUnit(style);
  const pad = SCHEME_LAYOUT.bracketPadBonds * bond;
  const serif = SCHEME_LAYOUT.bracketSerifBonds * bond;
  const enclosure: SchemeBox = {
    minX: inner.minX - pad,
    minY: inner.minY - pad,
    maxX: inner.maxX + pad,
    maxY: inner.maxY + pad,
  };
  const id = annotation.id;
  const source = annotationSource(id);
  const stroke = { color: style.colors.bond, width: style.bondLineWidthPx };
  const { minX, minY, maxX, maxY } = enclosure;
  const primitives: ScenePrimitive[] = [
    {
      id: schemeMarkPrimitiveId(id, "open"),
      source,
      type: "polyline",
      points: [
        { x: minX + serif, y: minY },
        { x: minX, y: minY },
        { x: minX, y: maxY },
        { x: minX + serif, y: maxY },
      ],
      stroke,
    } satisfies PolylinePrimitive,
    {
      id: schemeMarkPrimitiveId(id, "close"),
      source,
      type: "polyline",
      points: [
        { x: maxX - serif, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: maxX - serif, y: maxY },
      ],
      stroke,
    } satisfies PolylinePrimitive,
  ];

  // The superscript band: its cap top on the bracket's top edge.
  const size = superscriptSizePx(style);
  const capHeight = EM_CAP_HEIGHT * size;
  const gap = SCHEME_LAYOUT.superscriptGapEm * size;
  let pen = maxX + stroke.width / 2 + gap;
  if (annotation.transitionState === true) {
    const weight = daggerStrokePx(size, style);
    primitives.push(...daggerPrimitives(id, { x: pen, y: minY }, capHeight, weight, style));
    pen += 2 * SCHEME_LAYOUT.daggerCrossbarHalfWidth * capHeight + weight + gap;
  }
  const findings: SchemeMarkFinding[] = [];
  const mismatch = chargeMismatch(annotation, site);
  if (mismatch !== undefined) findings.push(mismatch);

  let charge: { readonly text: string; readonly origin: ScenePoint } | undefined;
  if (annotation.charge !== undefined) {
    const text = chargeText(annotation.charge);
    const origin = { x: pen, y: minY + capHeight };
    charge = { text, origin };
    const run: TextRunPrimitive = {
      id: schemeMarkPrimitiveId(id, "charge"),
      source,
      type: "textRun",
      origin,
      spans: [{ text }],
      fontFamily: style.fontFamily,
      fontSizePx: size,
      fill: { color: style.colors.label },
      anchor: "start",
    };
    primitives.push(run);
  }

  return {
    annotationId: id,
    primitives,
    box: primitivesBox(primitives, style),
    findings,
    enclosure,
    species: annotation.species,
    ...(charge === undefined ? {} : { chargeText: charge.text, chargeOrigin: charge.origin }),
  };
}

/**
 * The weight the double dagger strokes at: the vendored face's own minus sign,
 * its ink height at the superscript's size, so the drawn dagger is exactly as
 * heavy as the `−` printed beside it. At the bond line width it was a bold
 * glyph at Screen's 2 px next to a regular charge. The bond line width only
 * for a measurer whose table has no minus at all.
 */
export function daggerStrokePx(sizePx: number, style: RenderStyle): number {
  const minus = glyphInkUnits(0x2212);
  return minus === undefined ? style.bondLineWidthPx : ((minus.yMax - minus.yMin) * sizePx) / UNITS_PER_EM;
}

/**
 * The double dagger, drawn: a stem `height` tall hanging from `top` (its
 * left edge at `top.x`), crossed by two bars, all at `weight` — a text weight,
 * since it is set beside text.
 */
function daggerPrimitives(
  annotationId: string,
  top: ScenePoint,
  height: number,
  weight: number,
  style: RenderStyle,
): LinePrimitive[] {
  const halfBar = SCHEME_LAYOUT.daggerCrossbarHalfWidth * height;
  const x = top.x + weight / 2 + halfBar;
  const stroke = { color: style.colors.label, width: weight };
  const source = annotationSource(annotationId);
  const [upper, lower] = SCHEME_LAYOUT.daggerCrossbars;
  const bar = (fraction: number, part: string): LinePrimitive => ({
    id: schemeMarkPrimitiveId(annotationId, part),
    source,
    type: "line",
    a: { x: x - halfBar, y: top.y + fraction * height },
    b: { x: x + halfBar, y: top.y + fraction * height },
    stroke,
  });
  return [
    {
      id: schemeMarkPrimitiveId(annotationId, "dagger-stem"),
      source,
      type: "line",
      a: { x, y: top.y },
      b: { x, y: top.y + height },
      stroke,
    },
    bar(upper, "dagger-upper"),
    bar(lower, "dagger-lower"),
  ];
}
