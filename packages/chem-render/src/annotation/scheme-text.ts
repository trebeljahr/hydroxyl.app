/**
 * The two scheme marks that are only text: the stoichiometric coefficient
 * before a species, and a free label at a stored position.
 *
 * A COEFFICIENT (decision 204) is set at the LABEL size, not the formal-charge
 * size and not the descriptor size: the 2 of `2 H2O` is as large as the
 * formula it multiplies. It sits a quarter em before its species' ink, and
 * its box then widens the species' box (species-box.ts `extend`), so an arrow
 * or a plus sign keeps clear of it exactly as it keeps clear of the
 * structure. Vertically it sits ON THE BASELINE of the species' label that
 * runs through the species' middle — the leftmost label whose cap band holds
 * the box's vertical centre (decision 217) — because the box of `H2O` reaches
 * down to its subscript and a coefficient has none: centred on that box, the
 * 2 sat 0.12 em below the formula's baseline. A species with no label across
 * its middle (a skeletal ring or chain) has no line to sit on and is centred
 * on its box by the cap band, as decision 204 said.
 *
 * A FREE LABEL is printed exactly as typed, centred on its `at` point
 * horizontally and on the cap band vertically, like an atom label. It anchors
 * to the MODEL FRAME (decision 112), so only a panel drawing the molecule at
 * its own coordinates places it.
 *
 * Both are measured through the one measurer, and an unmeasured code point is
 * a finding, never an exception (decision 206).
 */

import type { AtomId } from "@starter/chem-core";

import type { AtomLabelPlacement } from "../label/placement.js";
import type { ScenePoint, TextRunPrimitive } from "../scene/types.js";
import type { CoefficientAnnotation, TextAnnotation } from "../scheme/annotation.js";
import { modelToPx } from "../style.js";
import type { RenderStyle } from "../style.js";
import { faceMetricsFor } from "../text/metrics.js";
import type { Measurer } from "../text/measurer.js";
import { unmeasuredCodePoints } from "../text/typography.js";
import { formatQuantity } from "./conditions.js";
import { annotationSource, primitivesBox, SCHEME_LAYOUT, schemeMarkPrimitiveId } from "./scheme-mark.js";
import type { SchemeMarkFinding, SchemeMarkLayout, SchemeMarkSite } from "./scheme-mark.js";
import { boxCentre } from "./species-box.js";
import type { SchemeBox } from "./species-box.js";

export interface CoefficientLayout extends SchemeMarkLayout {
  readonly text: string;
  /** The run's baseline origin; the run is end-anchored there. */
  readonly origin: ScenePoint;
  /** The species' box it was set against, before its own box widened it. */
  readonly speciesBox: SchemeBox;
  /** The atom whose label's baseline it sits on; undefined when it is centred on the box (decision 217). */
  readonly sitsOn: AtomId | undefined;
}

export interface SchemeTextLayout extends SchemeMarkLayout {
  /** The run's baseline origin; the run is middle-anchored there. */
  readonly origin: ScenePoint;
}

function findingsFor(text: string, measurer: Measurer, style: RenderStyle): SchemeMarkFinding[] {
  const codePoints = unmeasuredCodePoints(text, measurer, style.fontFamily, style.fontWeight);
  return codePoints.length === 0 ? [] : [{ kind: "unmeasured-glyphs", codePoints }];
}

/**
 * The label a coefficient sits on (decision 217): of the species' labels whose
 * cap band holds the box's vertical centre, the one whose ink starts furthest
 * left, nearest the coefficient; the first in atom order on a tie.
 */
function labelOnTheLine(
  labels: readonly AtomLabelPlacement[],
  box: SchemeBox,
  capEm: number,
): AtomLabelPlacement | undefined {
  const middle = boxCentre(box).y;
  let best: AtomLabelPlacement | undefined;
  let bestLeft = Infinity;
  for (const label of labels) {
    const baseline = label.run.origin.y;
    if (middle > baseline || middle < baseline - capEm * label.run.fontSizePx) continue;
    const left = Math.min(label.symbolBox.minX, ...label.inkBoxes.map((ink) => ink.minX));
    if (left < bestLeft) {
      best = label;
      bestLeft = left;
    }
  }
  return best;
}

/** The coefficient, before its species' box; undefined when the panel draws none of it. */
export function layoutCoefficient(annotation: CoefficientAnnotation, site: SchemeMarkSite): CoefficientLayout | undefined {
  const { style, measurer } = site;
  const box = site.boxes.boxOf(annotation.species);
  if (box === undefined) return undefined;
  const text = formatQuantity(annotation.value);
  const size = style.fontSizePx;
  const capEm = faceMetricsFor(style.fontFamily, style.fontWeight).emCapHeight;
  const line = labelOnTheLine(site.boxes.labelsOf(annotation.species), box, capEm);
  const origin = {
    x: box.minX - SCHEME_LAYOUT.coefficientGapEm * size,
    y: line === undefined ? boxCentre(box).y + (capEm * size) / 2 : line.run.origin.y,
  };
  const run: TextRunPrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, "coefficient"),
    source: annotationSource(annotation.id),
    type: "textRun",
    origin,
    spans: [{ text }],
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSizePx: size,
    fill: { color: style.colors.label },
    anchor: "end",
  };
  const primitives = [run];
  return {
    annotationId: annotation.id,
    primitives,
    box: primitivesBox(primitives, style),
    findings: findingsFor(text, measurer, style),
    text,
    origin,
    speciesBox: box,
    sitsOn: line?.atomId,
  };
}

/** The free label, centred on its stored point. Always laid out: the caller checks the frame. */
export function layoutSchemeText(annotation: TextAnnotation, style: RenderStyle, measurer: Measurer): SchemeTextLayout {
  const size = style.fontSizePx;
  const at = modelToPx(style, annotation.at);
  const capEm = faceMetricsFor(style.fontFamily, style.fontWeight).emCapHeight;
  const origin = { x: at.x, y: at.y + (capEm * size) / 2 };
  const run: TextRunPrimitive = {
    id: schemeMarkPrimitiveId(annotation.id, "text"),
    source: annotationSource(annotation.id),
    type: "textRun",
    origin,
    spans: [{ text: annotation.text }],
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSizePx: size,
    fill: { color: style.colors.label },
    anchor: "middle",
  };
  const primitives = [run];
  return {
    annotationId: annotation.id,
    primitives,
    box: primitivesBox(primitives, style),
    findings: findingsFor(annotation.text, measurer, style),
    origin,
  };
}
